import { env } from "cloudflare:workers";
import { currentDayKey, getStatus, performAction } from "@/lib/server/reception";

type ActionInput = NonNullable<Parameters<typeof performAction>[1]>;

type DirectEntryState = {
  revision: number;
  current_count: number;
  normal_capacity: number;
  overflow_capacity: number;
  overflow_enabled: number;
  called_party_size: number;
  id: number | null;
  party_size: number | null;
  direct_entry: number;
};

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

function resultRows<T>(result: unknown) {
  return ((result as { results?: T[] }).results ?? []);
}

function operationId(input: ActionInput) {
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  return requestId && requestId.length <= 100 ? requestId : crypto.randomUUID();
}

function activeCapacity(state: { normal_capacity: number; overflow_capacity: number; overflow_enabled: number }) {
  return state.overflow_enabled ? state.overflow_capacity : state.normal_capacity;
}

export async function prepareDirectEntryTicket(input: ActionInput) {
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 30) throw new Error("グループ人数は1〜30人で入力してください");

  const dayKey = currentDayKey();
  const state = await db().prepare(`
    SELECT d.current_count, d.normal_capacity, d.overflow_capacity, d.overflow_enabled,
      COALESCE((
        SELECT g.party_size FROM visitor_groups g
        WHERE g.day_key = d.day_key AND g.status = 'called' AND g.ticket_number = d.called_ticket_number
        LIMIT 1
      ), 0) AS called_party_size
    FROM day_state d WHERE d.day_key = ?
  `).bind(dayKey).first<{
    current_count: number;
    normal_capacity: number;
    overflow_capacity: number;
    overflow_enabled: number;
    called_party_size: number;
  }>();
  if (!state) throw new Error("当日の状態を取得できませんでした");

  const capacity = activeCapacity(state);
  const freeForDirect = Math.max(0, capacity - state.current_count - state.called_party_size);
  if (partySize > freeForDirect) {
    const calledNote = state.called_party_size > 0 ? `（案内中グループ ${state.called_party_size}人分を確保中）` : "";
    throw new Error(`現在はあと${freeForDirect}人まで入場できます${calledNote}`);
  }

  const directRequestId = operationId(input);
  const result = await performAction("QUEUE_CREATE_GROUP", {
    ...input,
    requestId: `direct:${directRequestId}`,
  });
  return { ...result, directEntryPending: true };
}

export async function confirmDirectTicketHandoff(input: ActionInput) {
  const ticketNumber = Number(input.ticketNumber);
  if (!Number.isInteger(ticketNumber) || ticketNumber < 1) return null;

  const dayKey = currentDayKey();
  const now = Date.now();
  const database = db();
  const state = await database.prepare(`
    SELECT d.revision, d.current_count, d.normal_capacity, d.overflow_capacity, d.overflow_enabled,
      COALESCE((
        SELECT called.party_size FROM visitor_groups called
        WHERE called.day_key = d.day_key AND called.status = 'called' AND called.ticket_number = d.called_ticket_number
        LIMIT 1
      ), 0) AS called_party_size,
      g.id, g.party_size,
      EXISTS(
        SELECT 1 FROM events e
        WHERE e.day_key = d.day_key AND e.group_id = g.id
          AND e.type = 'QUEUE_RESERVE' AND e.undone = 0 AND e.op_id LIKE 'direct:%'
      ) AS direct_entry
    FROM day_state d
    LEFT JOIN visitor_groups g
      ON g.day_key = d.day_key AND g.ticket_number = ? AND g.status = 'issuing'
    WHERE d.day_key = ?
  `).bind(ticketNumber, dayKey).first<DirectEntryState>();

  if (!state || state.id == null || state.party_size == null || !state.direct_entry) return null;

  const capacity = activeCapacity(state);
  const freeForDirect = Math.max(0, capacity - state.current_count - state.called_party_size);
  if (state.party_size > freeForDirect) {
    const calledNote = state.called_party_size > 0 ? `（案内中グループ ${state.called_party_size}人分を確保中）` : "";
    throw new Error(`現在はあと${freeForDirect}人まで入場できます${calledNote}`);
  }

  const opId = operationId(input);
  const revision = state.revision + 1;
  const results = await database.batch([
    database.prepare(`
      UPDATE day_state
      SET next_ticket = MAX(next_ticket, ?),
          current_count = current_count + ?,
          total_count = total_count + ?,
          max_current = MAX(max_current, current_count + ?),
          revision = revision + 1,
          updated_at = ?
      WHERE day_key = ? AND revision = ?
        AND current_count + ? + ? <= ?
        AND EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'issuing')
      RETURNING current_count, total_count, max_current, revision, updated_at
    `).bind(
      ticketNumber + 1,
      state.party_size,
      state.party_size,
      state.party_size,
      now,
      dayKey,
      state.revision,
      state.party_size,
      state.called_party_size,
      capacity,
      state.id,
    ),
    database.prepare(`
      UPDATE visitor_groups
      SET status = 'inside', admitted_at = ?, called_at = NULL
      WHERE id = ? AND status = 'issuing'
        AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)
    `).bind(now, state.id, dayKey, revision),
    database.prepare(`
      INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at)
      SELECT ?, ?, 'ADMIT', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'inside' AND admitted_at = ?)
        AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)
    `).bind(dayKey, opId, ticketNumber, state.id, state.party_size, now, state.id, now, dayKey, revision),
  ]);

  const summary = resultRows<{
    current_count: number;
    total_count: number;
    max_current: number;
    revision: number;
    updated_at: number;
  }>(results[0])[0];
  if (!summary) throw new Error("この紙整理券は別の端末で処理済みです");

  return {
    status: await getStatus(dayKey, undefined, { skipEnsure: true }),
    confirmedTicket: ticketNumber,
    directEntry: true,
  };
}

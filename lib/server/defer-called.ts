import { env } from "cloudflare:workers";
import { currentDayKey, getStatus } from "@/lib/server/reception";

type Input = {
  ticketNumber?: number;
  requestId?: string;
};

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function deferCalled(input: Input, dayKey = currentDayKey()) {
  const ticketNumber = Number(input.ticketNumber);
  if (!Number.isInteger(ticketNumber) || ticketNumber < 1) throw new Error("整理券番号を指定してください");

  const database = db();
  const state = await database.prepare(`
    SELECT d.revision, d.called_ticket_number, g.id, g.party_size
    FROM day_state d
    LEFT JOIN visitor_groups g
      ON g.day_key = d.day_key
      AND g.ticket_number = d.called_ticket_number
      AND g.status = 'called'
    WHERE d.day_key = ?
  `).bind(dayKey).first<{
    revision: number;
    called_ticket_number: number | null;
    id: number | null;
    party_size: number | null;
  }>();

  if (!state || state.called_ticket_number !== ticketNumber || state.id == null || state.party_size == null) {
    throw new Error(`${ticketNumber}番は現在案内中ではありません`);
  }

  const now = Date.now();
  const opId = typeof input.requestId === "string" && input.requestId.trim()
    ? input.requestId.trim().slice(0, 100)
    : crypto.randomUUID();
  const revision = state.revision + 1;

  const results = await database.batch([
    database.prepare(`
      UPDATE day_state
      SET called_ticket_number = NULL,
          revision = revision + 1,
          updated_at = ?
      WHERE day_key = ? AND revision = ? AND called_ticket_number = ?
      RETURNING revision
    `).bind(now, dayKey, state.revision, ticketNumber),
    database.prepare(`
      UPDATE visitor_groups
      SET status = 'waiting', called_at = NULL, created_at = ?
      WHERE id = ? AND day_key = ? AND status = 'called'
        AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number IS NULL)
    `).bind(now, state.id, dayKey, dayKey, revision),
    database.prepare(`
      INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at)
      SELECT ?, ?, 'RETURN_TO_WAITING', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM visitor_groups
        WHERE id = ? AND day_key = ? AND status = 'waiting' AND called_at IS NULL AND created_at = ?
      ) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number IS NULL)
    `).bind(dayKey, opId, ticketNumber, state.id, state.party_size, now, state.id, dayKey, now, dayKey, revision),
  ]);

  const updated = ((results[0] as { results?: Array<{ revision: number }> }).results ?? [])[0];
  if (!updated) throw new Error(`${ticketNumber}番は別の端末で処理済みです`);

  return {
    status: await getStatus(dayKey, undefined, { skipEnsure: true }),
    deferredTicket: ticketNumber,
  };
}

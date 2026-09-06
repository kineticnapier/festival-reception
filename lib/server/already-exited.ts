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

export async function markAlreadyExited(input: Input, dayKey = currentDayKey()) {
  const ticketNumber = Number(input.ticketNumber);
  if (!Number.isInteger(ticketNumber) || ticketNumber < 1) throw new Error("整理券番号を指定してください");

  const database = db();
  const [day, group] = await Promise.all([
    database.prepare(`
      SELECT current_count, total_count, max_current, called_ticket_number, revision
      FROM day_state WHERE day_key = ?
    `).bind(dayKey).first<{
      current_count: number;
      total_count: number;
      max_current: number;
      called_ticket_number: number | null;
      revision: number;
    }>(),
    database.prepare(`
      SELECT id, party_size, status
      FROM visitor_groups
      WHERE day_key = ? AND ticket_number = ? AND status IN ('waiting', 'called')
      ORDER BY id DESC LIMIT 1
    `).bind(dayKey, ticketNumber).first<{ id: number; party_size: number; status: string }>(),
  ]);

  if (!day) throw new Error("当日の状態を取得できませんでした");
  if (!group) throw new Error(`${ticketNumber}番は待機中または案内中ではありません`);

  const now = Date.now();
  const opId = typeof input.requestId === "string" && input.requestId.trim()
    ? input.requestId.trim().slice(0, 100)
    : crypto.randomUUID();
  const revision = day.revision + 1;

  const results = await database.batch([
    database.prepare(`
      UPDATE day_state
      SET total_count = total_count + ?,
          called_ticket_number = CASE WHEN called_ticket_number = ? THEN NULL ELSE called_ticket_number END,
          revision = revision + 1,
          updated_at = ?
      WHERE day_key = ? AND revision = ?
        AND EXISTS (
          SELECT 1 FROM visitor_groups
          WHERE id = ? AND day_key = ? AND status IN ('waiting', 'called')
        )
      RETURNING current_count, total_count, max_current, revision, updated_at
    `).bind(group.party_size, ticketNumber, now, dayKey, day.revision, group.id, dayKey),
    database.prepare(`
      UPDATE visitor_groups
      SET status = 'exited', admitted_at = NULL, exited_at = ?, cancelled_at = NULL
      WHERE id = ? AND day_key = ? AND status IN ('waiting', 'called')
        AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)
    `).bind(now, group.id, dayKey, dayKey, revision),
    database.prepare(`
      INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at)
      SELECT ?, ?, 'ADMIT', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM visitor_groups
        WHERE id = ? AND day_key = ? AND status = 'exited' AND admitted_at IS NULL AND exited_at = ?
      ) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)
    `).bind(dayKey, opId, ticketNumber, group.id, group.party_size, now, group.id, dayKey, now, dayKey, revision),
    database.prepare(`
      INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at)
      SELECT ?, ?, 'EXIT_GROUP', ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM visitor_groups
        WHERE id = ? AND day_key = ? AND status = 'exited' AND admitted_at IS NULL AND exited_at = ?
      ) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)
    `).bind(dayKey, opId, ticketNumber, group.id, group.party_size, now, group.id, dayKey, now, dayKey, revision),
  ]);

  const summary = ((results[0] as { results?: Array<{
    current_count: number;
    total_count: number;
    max_current: number;
    revision: number;
    updated_at: number;
  }> }).results ?? [])[0];
  if (!summary) throw new Error(`${ticketNumber}番は別の端末で処理済みです`);

  return {
    status: await getStatus(dayKey, undefined, { skipEnsure: true }),
    markedAlreadyExited: ticketNumber,
  };
}

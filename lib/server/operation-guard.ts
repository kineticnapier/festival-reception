import { env } from "cloudflare:workers";
import { normalizeRequestId } from "@/lib/safety";

const LOCK_MS = 30_000;

type OperationRow = {
  request_id: string;
  day_key: string;
  action: string;
  state: "started" | "completed" | "failed";
  response_json: string | null;
  error_message: string | null;
  created_at: number;
};

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export class MutationBusyError extends Error {
  constructor(message = "別の操作を処理中です。少し待ってもう一度お試しください") {
    super(message);
    this.name = "MutationBusyError";
  }
}

async function acquireLock(dayKey: string, requestId: string, now: number) {
  return db().prepare(`
    INSERT INTO mutation_locks (day_key, owner_request_id, acquired_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(day_key) DO UPDATE SET
      owner_request_id = excluded.owner_request_id,
      acquired_at = excluded.acquired_at,
      expires_at = excluded.expires_at
    WHERE mutation_locks.expires_at <= ? OR mutation_locks.owner_request_id = excluded.owner_request_id
    RETURNING owner_request_id
  `).bind(dayKey, requestId, now, now + LOCK_MS, now).first<{ owner_request_id: string }>();
}

async function releaseLock(dayKey: string, requestId: string) {
  await db().prepare("DELETE FROM mutation_locks WHERE day_key = ? AND owner_request_id = ?").bind(dayKey, requestId).run();
}

export async function runIdempotentMutation<T>(options: {
  requestId?: unknown;
  dayKey: string;
  action: string;
  execute: (requestId: string) => Promise<T>;
}) {
  const database = db();
  const now = Date.now();
  const requestId = normalizeRequestId(options.requestId) ?? crypto.randomUUID();

  const claimed = await database.prepare(`
    INSERT INTO operation_requests (request_id, day_key, action, state, created_at)
    VALUES (?, ?, ?, 'started', ?)
    ON CONFLICT(request_id) DO NOTHING
    RETURNING request_id
  `).bind(requestId, options.dayKey, options.action, now).first<{ request_id: string }>();

  if (!claimed) {
    const previous = await database.prepare(`
      SELECT request_id, day_key, action, state, response_json, error_message, created_at
      FROM operation_requests WHERE request_id = ?
    `).bind(requestId).first<OperationRow>();
    if (!previous) throw new MutationBusyError("同じ操作の状態を確認できませんでした。画面を更新してください");
    if (previous.day_key !== options.dayKey || previous.action !== options.action) {
      throw new Error("同じrequestIdが別の操作に使用されています");
    }
    if (previous.state === "completed" && previous.response_json) {
      return { value: JSON.parse(previous.response_json) as T, requestId, replayed: true };
    }
    if (previous.state === "failed") throw new Error(previous.error_message || "前回の同じ操作は失敗しました");
    throw new MutationBusyError("同じ操作がまだ処理中です。画面を更新して結果を確認してください");
  }

  const lock = await acquireLock(options.dayKey, requestId, now);
  if (!lock) {
    await database.prepare("DELETE FROM operation_requests WHERE request_id = ? AND state = 'started'").bind(requestId).run();
    throw new MutationBusyError();
  }

  try {
    const value = await options.execute(requestId);
    const responseJson = JSON.stringify(value);
    await database.prepare(`
      UPDATE operation_requests
      SET state = 'completed', response_json = ?, completed_at = ?, error_message = NULL
      WHERE request_id = ? AND state = 'started'
    `).bind(responseJson, Date.now(), requestId).run();
    return { value, requestId, replayed: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "操作に失敗しました";
    await database.prepare(`
      UPDATE operation_requests
      SET state = 'failed', error_message = ?, completed_at = ?
      WHERE request_id = ? AND state = 'started'
    `).bind(message.slice(0, 500), Date.now(), requestId).run();
    throw error;
  } finally {
    await releaseLock(options.dayKey, requestId);
  }
}

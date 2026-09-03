import { env } from "cloudflare:workers";

let schemaReady: Promise<void> | null = null;

function database() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

async function createHardeningSchema() {
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS operation_requests (
      request_id text PRIMARY KEY NOT NULL,
      day_key text NOT NULL,
      action text NOT NULL,
      state text NOT NULL DEFAULT 'started',
      response_json text,
      error_message text,
      created_at integer NOT NULL,
      completed_at integer
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS operation_requests_day_created_idx ON operation_requests (day_key, created_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS mutation_locks (
      day_key text PRIMARY KEY NOT NULL,
      owner_request_id text NOT NULL,
      acquired_at integer NOT NULL,
      expires_at integer NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS mutation_locks_expires_idx ON mutation_locks (expires_at)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS auth_rate_limits (
      scope_key text PRIMARY KEY NOT NULL,
      failure_count integer NOT NULL DEFAULT 0,
      window_started_at integer NOT NULL,
      blocked_until integer NOT NULL DEFAULT 0,
      updated_at integer NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_idx ON auth_rate_limits (updated_at)"),
  ]);
}

export function ensureHardeningSchema() {
  if (!schemaReady) {
    schemaReady = createHardeningSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

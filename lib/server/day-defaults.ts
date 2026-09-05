import { env } from "cloudflare:workers";

export const DEFAULT_NORMAL_CAPACITY = 17;
export const DEFAULT_PRIOR_STAY_MINUTES = 6;
export const DEFAULT_PRIOR_STAY_SECONDS = DEFAULT_PRIOR_STAY_MINUTES * 60;

export async function ensureDayDefaults(dayKey: string, now = Date.now()) {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  await env.DB.prepare(`
    INSERT INTO day_state (
      day_key,
      normal_capacity,
      prior_stay_minutes,
      prior_stay_seconds,
      updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(day_key) DO NOTHING
  `).bind(
    dayKey,
    DEFAULT_NORMAL_CAPACITY,
    DEFAULT_PRIOR_STAY_MINUTES,
    DEFAULT_PRIOR_STAY_SECONDS,
    now,
  ).run();
}

import { env } from "cloudflare:workers";
import { currentDayKey } from "@/lib/server/reception";

/**
 * Passive waiting tickets must not turn into capacity debt for every new arrival.
 * Only an unfinished paper handoff blocks direct entry here; called-group seats and
 * actual capacity are checked again by REGISTER_DIRECT itself.
 */
export async function assertDirectEntryAllowed() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");

  const pending = await env.DB.prepare(`
    SELECT ticket_number
    FROM visitor_groups
    WHERE day_key = ? AND status = 'issuing'
    ORDER BY id
    LIMIT 1
  `).bind(currentDayKey()).first<{ ticket_number: number | null }>();

  if (!pending) return;
  const ticket = pending.ticket_number == null ? "" : `${pending.ticket_number}番の`;
  throw new Error(`${ticket}「紙を渡した」を先に確認してください`);
}

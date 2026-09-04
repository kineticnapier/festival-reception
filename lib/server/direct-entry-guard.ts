import { env } from "cloudflare:workers";
import { currentDayKey } from "@/lib/server/reception";

export async function assertDirectEntryAllowed() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");

  const activeTicket = await env.DB.prepare(`
    SELECT ticket_number
    FROM visitor_groups
    WHERE day_key = ? AND status IN ('issuing', 'waiting', 'called')
    LIMIT 1
  `).bind(currentDayKey()).first<{ ticket_number: number | null }>();

  if (activeTicket) {
    throw new Error("整理券グループがいるため、直接入場できません。整理券を発行してください");
  }
}

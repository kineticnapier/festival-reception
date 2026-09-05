import { env } from "cloudflare:workers";
import { currentDayKey } from "@/lib/server/reception";

export async function assertDirectEntryAllowed() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");

  const activeTicket = await env.DB.prepare(`
    SELECT ticket_number, status
    FROM visitor_groups
    WHERE day_key = ? AND status IN ('issuing', 'waiting', 'called')
    ORDER BY CASE status WHEN 'issuing' THEN 0 WHEN 'called' THEN 1 ELSE 2 END, id
    LIMIT 1
  `).bind(currentDayKey()).first<{ ticket_number: number | null; status: string }>();

  if (!activeTicket) return;
  if (activeTicket.status === "issuing") {
    const ticket = activeTicket.ticket_number == null ? "" : `${activeTicket.ticket_number}番の`;
    throw new Error(`${ticket}「紙を渡した」を先に確認してください`);
  }
  throw new Error("整理券グループがいるため、直接入場できません。整理券を発行してください");
}

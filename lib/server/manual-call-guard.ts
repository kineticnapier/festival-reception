import { env } from "cloudflare:workers";
import { currentDayKey } from "@/lib/server/reception";

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function assertManualCallFits(ticketNumberValue: unknown, dayKey = currentDayKey()) {
  const ticketNumber = Number(ticketNumberValue);
  if (!Number.isInteger(ticketNumber) || ticketNumber < 1) throw new Error("呼び出す整理券番号を選んでください");

  const database = db();
  const [day, group] = await Promise.all([
    database.prepare(`
      SELECT current_count, normal_capacity, overflow_capacity, overflow_enabled, called_ticket_number
      FROM day_state WHERE day_key = ?
    `).bind(dayKey).first<{
      current_count: number;
      normal_capacity: number;
      overflow_capacity: number;
      overflow_enabled: number;
      called_ticket_number: number | null;
    }>(),
    database.prepare(`
      SELECT party_size FROM visitor_groups
      WHERE day_key = ? AND ticket_number = ? AND status = 'waiting'
      ORDER BY id DESC LIMIT 1
    `).bind(dayKey, ticketNumber).first<{ party_size: number }>(),
  ]);

  if (!day) throw new Error("当日の状態を取得できませんでした");
  if (!group) throw new Error(`${ticketNumber}番は待機中ではありません`);
  if (day.called_ticket_number != null) throw new Error(`${day.called_ticket_number}番を案内中です`);

  const capacity = day.overflow_enabled ? day.overflow_capacity : day.normal_capacity;
  const freeSeats = Math.max(0, capacity - day.current_count);
  if (group.party_size > freeSeats) {
    throw new Error(`${ticketNumber}番は${group.party_size}人ですが、空きは${freeSeats}人です`);
  }
}

import { env } from "cloudflare:workers";
import { calculateQueueGuidance } from "@/lib/queue-guidance";
import { pickSplitContinuation, type SplitCohortMembership } from "@/lib/split-continuation";
import { currentDayKey } from "@/lib/server/reception";

type DayState = {
  current_count: number;
  called_ticket_number: number | null;
  normal_capacity: number;
  overflow_capacity: number;
  overflow_enabled: number;
  prior_stay_seconds: number;
  reserve_wait_seconds: number;
};

type WaitingGroup = {
  id: number;
  ticket_number: number;
  party_size: number;
  created_at: number;
};

type CohortRow = {
  op_id: string;
  group_id: number;
  status: "waiting" | "inside";
};

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

export async function chooseSplitContinuationTicket() {
  const database = db();
  const dayKey = currentDayKey();
  const day = await database.prepare(`
    SELECT current_count, called_ticket_number, normal_capacity, overflow_capacity,
      overflow_enabled, prior_stay_seconds, reserve_wait_seconds
    FROM day_state WHERE day_key = ?
  `).bind(dayKey).first<DayState>();
  if (!day || day.called_ticket_number != null) return null;

  const capacity = day.overflow_enabled ? day.overflow_capacity : day.normal_capacity;
  const freeSeats = Math.max(0, capacity - day.current_count);
  if (freeSeats <= 0) return null;

  const [waitingResult, cohortResult] = await database.batch([
    database.prepare(`
      SELECT id, ticket_number, party_size, created_at
      FROM visitor_groups
      WHERE day_key = ? AND status = 'waiting'
      ORDER BY ticket_number
    `).bind(dayKey),
    database.prepare(`
      SELECT e.op_id, g.id AS group_id, g.status
      FROM events e
      JOIN visitor_groups g ON g.id = e.group_id
      WHERE e.day_key = ?
        AND e.type = 'QUEUE_RESERVE'
        AND e.undone = 0
        AND g.status IN ('waiting', 'inside')
    `).bind(dayKey),
  ]);

  const waiting = (waitingResult.results ?? []) as unknown as WaitingGroup[];
  if (!waiting.length) return null;

  const guidance = calculateQueueGuidance({
    capacity,
    currentCount: day.current_count,
    cycleMinutes: day.prior_stay_seconds / 60,
    reserveWaitMinutes: day.reserve_wait_seconds / 60,
    now: Date.now(),
    waiting: waiting.map((group) => ({
      id: group.id,
      ticketNumber: group.ticket_number,
      partySize: group.party_size,
      createdAt: group.created_at,
    })),
  });

  // Long-wait seat reservation stays authoritative. Split siblings only get a
  // preference when the normal guidance is free to choose a group that fits now.
  if (guidance.mode !== "recommended") return null;

  const memberships: SplitCohortMembership[] = ((cohortResult.results ?? []) as unknown as CohortRow[]).map((row) => ({
    groupId: row.group_id,
    cohortId: row.op_id,
    status: row.status,
  }));
  const target = pickSplitContinuation(guidance.scores, memberships);
  return target?.ticketNumber ?? null;
}

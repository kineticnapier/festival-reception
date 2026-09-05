import { env } from "cloudflare:workers";
import { currentDayKey, getStatus } from "@/lib/server/reception";

type GroupStatus = "issuing" | "waiting" | "called" | "inside" | "exited" | "cancelled";
type EventRow = {
  id: number;
  op_id: string;
  type: string;
  ticket_number: number | null;
  group_id: number | null;
  details: string | null;
  party_size: number;
  created_at: number;
};
type TargetEvent = Pick<EventRow, "id" | "type" | "ticket_number" | "group_id">;

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}
type Database = ReturnType<typeof db>;
type PreparedStatement = ReturnType<Database["prepare"]>;

function normalizeOperationId(value: unknown) {
  if (typeof value !== "string") return null;
  const operationId = value.trim();
  if (!operationId || operationId.length > 140) return null;
  return operationId;
}

export async function undoSpecificOperation(operationIdValue: unknown, dayKey = currentDayKey()) {
  const operationId = normalizeOperationId(operationIdValue);
  if (!operationId) throw new Error("取り消す操作を指定してください");

  const database = db();
  const now = Date.now();
  const targetResult = await database.prepare(`
    SELECT id, type, ticket_number, group_id
    FROM events
    WHERE day_key = ? AND op_id = ? AND undone = 0
    ORDER BY id
  `).bind(dayKey, operationId).all<TargetEvent>();
  const targetEvents = targetResult.results ?? [];
  if (!targetEvents.length) throw new Error("この操作はすでに取り消されているか、履歴にありません");

  const targetMaxId = Math.max(...targetEvents.map((event) => event.id));
  const groupIds = [...new Set(targetEvents.flatMap((event) => event.group_id == null ? [] : [event.group_id]))];

  let dependent: { id: number; type: string; ticket_number: number | null } | null = null;
  if (groupIds.length) {
    const placeholders = groupIds.map(() => "?").join(",");
    dependent = await database.prepare(`
      SELECT id, type, ticket_number
      FROM events
      WHERE day_key = ? AND undone = 0 AND id > ? AND op_id <> ?
        AND (group_id IN (${placeholders}) OR type IN ('ADMIN_CORRECT', 'ADMIN_GROUP_STATUS'))
      ORDER BY id
      LIMIT 1
    `).bind(dayKey, targetMaxId, operationId, ...groupIds).first<{ id: number; type: string; ticket_number: number | null }>();
  } else {
    dependent = await database.prepare(`
      SELECT id, type, ticket_number
      FROM events
      WHERE day_key = ? AND undone = 0 AND id > ? AND op_id <> ?
      ORDER BY id
      LIMIT 1
    `).bind(dayKey, targetMaxId, operationId).first<{ id: number; type: string; ticket_number: number | null }>();
  }

  if (dependent) {
    throw new Error("この操作の後に関連する処理があります。新しい処理から先に取り消してください");
  }

  const reserveGroups = targetEvents
    .filter((event) => event.type === "QUEUE_RESERVE" && event.group_id != null)
    .map((event) => event.group_id as number);

  await database.batch([
    database.prepare("UPDATE events SET undone = 1 WHERE day_key = ? AND op_id = ? AND undone = 0").bind(dayKey, operationId),
    ...reserveGroups.map((groupId) => database.prepare(`
      UPDATE visitor_groups
      SET status = 'cancelled', ticket_number = NULL, called_at = NULL, admitted_at = NULL,
          exited_at = NULL, cancelled_at = ?
      WHERE id = ?
    `).bind(now, groupId)),
  ]);

  await replayActiveEvents(dayKey, now);

  return {
    status: await getStatus(dayKey, undefined, { skipEnsure: true }),
    undoneOperationId: operationId,
  };
}

async function replayActiveEvents(dayKey: string, now: number) {
  const database = db();
  const result = await database.prepare(`
    SELECT id, op_id, type, ticket_number, group_id, details, party_size, created_at
    FROM events
    WHERE day_key = ? AND undone = 0
    ORDER BY id
  `).bind(dayKey).all<EventRow>();
  const events = result.results ?? [];

  let current = 0;
  let total = 0;
  let max = 0;
  let called: number | null = null;
  const status = new Map<number, {
    value: GroupStatus;
    ticketNumber: number | null;
    calledAt: number | null;
    admittedAt: number | null;
    exitedAt: number | null;
    cancelledAt: number | null;
  }>();

  for (const event of events) {
    if (event.type === "ENTER") {
      current += event.party_size;
      total += event.party_size;
    }
    if (event.type === "EXIT") current = Math.max(0, current - event.party_size);
    if (event.type === "ENTER_GROUP" && event.group_id != null) {
      status.set(event.group_id, { value: "inside", ticketNumber: null, calledAt: null, admittedAt: event.created_at, exitedAt: null, cancelledAt: null });
      current += event.party_size;
      total += event.party_size;
    }
    if (event.type === "QUEUE_CREATE" && event.group_id != null) {
      status.set(event.group_id, { value: "waiting", ticketNumber: event.ticket_number, calledAt: null, admittedAt: null, exitedAt: null, cancelledAt: null });
    }
    if (event.type === "QUEUE_RESERVE" && event.group_id != null) {
      status.set(event.group_id, { value: "issuing", ticketNumber: event.ticket_number, calledAt: null, admittedAt: null, exitedAt: null, cancelledAt: null });
    }
    if (event.type === "QUEUE_CONFIRM" && event.group_id != null) {
      const previous = status.get(event.group_id);
      status.set(event.group_id, { value: "waiting", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: null, admittedAt: null, exitedAt: null, cancelledAt: null });
    }
    if (event.type === "RETURN_TO_WAITING" && event.group_id != null) {
      const previous = status.get(event.group_id);
      status.set(event.group_id, { value: "waiting", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: null, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: null });
      if (called === event.ticket_number) called = null;
    }
    if (event.type === "CALL" && event.group_id != null) {
      const previous = status.get(event.group_id);
      status.set(event.group_id, { value: "called", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: event.created_at, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: null });
      called = event.ticket_number;
    }
    if (event.type === "ADMIT" && event.group_id != null) {
      const previous = status.get(event.group_id);
      status.set(event.group_id, { value: "inside", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: previous?.calledAt ?? null, admittedAt: event.created_at, exitedAt: null, cancelledAt: null });
      if (called === event.ticket_number) called = null;
      current += event.party_size;
      total += event.party_size;
    }
    if (event.type === "EXIT_GROUP" && event.group_id != null) {
      const previous = status.get(event.group_id);
      status.set(event.group_id, { value: "exited", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: previous?.calledAt ?? null, admittedAt: previous?.admittedAt ?? null, exitedAt: event.created_at, cancelledAt: null });
      current = Math.max(0, current - event.party_size);
    }
    if (event.type === "CANCEL" && event.group_id != null) {
      const previous = status.get(event.group_id);
      status.set(event.group_id, {
        value: "cancelled",
        ticketNumber: previous?.value === "issuing" ? null : (previous?.ticketNumber ?? event.ticket_number),
        calledAt: previous?.calledAt ?? null,
        admittedAt: previous?.admittedAt ?? null,
        exitedAt: null,
        cancelledAt: event.created_at,
      });
      if (called === event.ticket_number) called = null;
    }
    if ((event.type === "ADMIN_CORRECT" || event.type === "ADMIN_GROUP_STATUS") && event.details) {
      try {
        const details = JSON.parse(event.details) as {
          currentCount?: number;
          totalCount?: number;
          calledNumber?: number | null;
          status?: GroupStatus;
          groupId?: number;
          pendingGroupId?: number;
          pendingTicketNumber?: number;
        };
        if (typeof details.currentCount === "number") current = details.currentCount;
        if (typeof details.totalCount === "number") total = details.totalCount;
        called = details.calledNumber ?? null;
        for (const [id, item] of status) {
          if (item.value === "called") status.set(id, { ...item, value: "waiting", calledAt: null });
        }
        const correctedGroupId = details.groupId ?? event.group_id;
        if (event.type === "ADMIN_CORRECT" && correctedGroupId != null && called != null) {
          const previous = status.get(correctedGroupId);
          status.set(correctedGroupId, { value: "called", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: event.created_at, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: null });
        }
        if (event.type === "ADMIN_CORRECT" && details.pendingGroupId != null && details.pendingTicketNumber != null) {
          const previous = status.get(details.pendingGroupId);
          status.set(details.pendingGroupId, { value: "issuing", ticketNumber: details.pendingTicketNumber, calledAt: null, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: null });
        }
        if (event.type === "ADMIN_GROUP_STATUS" && correctedGroupId != null && details.status) {
          const previous = status.get(correctedGroupId);
          status.set(correctedGroupId, {
            value: details.status,
            ticketNumber: previous?.ticketNumber ?? event.ticket_number,
            calledAt: details.status === "called" ? event.created_at : null,
            admittedAt: ["inside", "exited"].includes(details.status) ? (previous?.admittedAt ?? event.created_at) : null,
            exitedAt: details.status === "exited" ? event.created_at : null,
            cancelledAt: details.status === "cancelled" ? event.created_at : null,
          });
        }
      } catch {
        // Ignore malformed legacy details during replay.
      }
    }
    max = Math.max(max, current);
  }

  const pendingTicketNumbers = [...status.values()]
    .filter((item) => item.value === "issuing" && item.ticketNumber != null)
    .map((item) => item.ticketNumber as number);
  const pendingTicketNumber = pendingTicketNumbers.length ? Math.min(...pendingTicketNumbers) : null;

  const statements: PreparedStatement[] = [
    database.prepare(`
      UPDATE day_state
      SET current_count = ?, total_count = ?, max_current = ?, called_ticket_number = ?,
          next_ticket = CASE WHEN ? IS NULL THEN next_ticket ELSE ? END,
          revision = revision + 1, updated_at = ?
      WHERE day_key = ?
    `).bind(current, total, max, called, pendingTicketNumber, pendingTicketNumber, now, dayKey),
    database.prepare(`
      UPDATE visitor_groups
      SET status = 'cancelled', called_at = NULL, admitted_at = NULL, exited_at = NULL, cancelled_at = ?
      WHERE day_key = ?
    `).bind(now, dayKey),
  ];

  for (const [groupId, item] of status) {
    statements.push(database.prepare(`
      UPDATE visitor_groups
      SET status = ?, ticket_number = ?, called_at = ?, admitted_at = ?, exited_at = ?, cancelled_at = ?
      WHERE id = ?
    `).bind(item.value, item.ticketNumber, item.calledAt, item.admittedAt, item.exitedAt, item.cancelledAt, groupId));
  }

  await database.batch(statements);
}

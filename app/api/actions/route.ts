import { currentDayKey, performAction } from "@/lib/server/reception";
import { ensureDayDefaults } from "@/lib/server/day-defaults";
import { assertDirectEntryAllowed } from "@/lib/server/direct-entry-guard";
import { confirmDirectTicketHandoff, prepareDirectEntryTicket } from "@/lib/server/direct-entry-ticket";
import { assertManualCallFits } from "@/lib/server/manual-call-guard";
import { chooseSplitContinuationTicket } from "@/lib/server/split-continuation";
import { createSplitQueueIfNeeded } from "@/lib/server/split-queue";
import { undoSpecificOperation } from "@/lib/server/operation-undo";
import { MutationBusyError, runIdempotentMutation } from "@/lib/server/operation-guard";
import { verifyAdminSession, verifyStaffSession } from "@/lib/server/staff-auth";

const UNDOABLE_ACTIONS = new Set([
  "REGISTER_DIRECT",
  "QUEUE_CREATE_GROUP",
  "CONFIRM_TICKET_HANDOFF",
  "CALL_NEXT",
  "CALL_NUMBER",
  "ADMIT_CALLED",
  "CANCEL",
  "EXIT_GROUP",
  "EXIT_GROUPS",
]);

function operationEventId(action: string, requestId: string) {
  if (!UNDOABLE_ACTIONS.has(action)) return null;
  return action === "REGISTER_DIRECT" ? `direct:${requestId}` : requestId;
}

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    const body = await request.json() as Parameters<typeof performAction>[1] & { action?: string; operationId?: string };
    if (!body.action) return Response.json({ error: "action is required" }, { status: 400 });
    const adminOnly = ["SETTINGS", "RESET_DAY"].includes(body.action);
    const authorized = adminOnly ? await verifyAdminSession(request) : (await verifyStaffSession(request)) || (await verifyAdminSession(request));
    if (!authorized) return Response.json({ error: adminOnly ? "管理者認証が必要です" : "暗証番号をもう一度入力してください" }, { status: 401 });

    const dayKey = currentDayKey();
    await ensureDayDefaults(dayKey);

    const guarded = await runIdempotentMutation({
      requestId: body.requestId,
      dayKey,
      action: body.action,
      execute: async (requestId) => {
        const input = { ...body, requestId };
        if (body.action === "UNDO_OPERATION") {
          return undoSpecificOperation(input.operationId, dayKey);
        }
        if (body.action === "REGISTER_DIRECT") {
          await assertDirectEntryAllowed();
          return prepareDirectEntryTicket(input);
        }
        if (body.action === "CONFIRM_TICKET_HANDOFF") {
          const direct = await confirmDirectTicketHandoff(input);
          if (direct) return direct;
        }
        if (body.action === "QUEUE_CREATE_GROUP") {
          const split = await createSplitQueueIfNeeded(input);
          if (split) return split;
        }
        if (body.action === "CALL_NUMBER") {
          await assertManualCallFits(input.ticketNumber, dayKey);
        }
        if (body.action === "CALL_NEXT") {
          const continuationTicket = await chooseSplitContinuationTicket();
          if (continuationTicket != null) {
            const result = await performAction("CALL_NUMBER", { ...input, ticketNumber: continuationTicket });
            return { ...result, splitContinuation: true };
          }
        }
        return performAction(body.action!, input);
      },
    });

    const operationId = operationEventId(body.action, guarded.requestId);
    const value = operationId
      ? { ...(guarded.value as Record<string, unknown>), operationId }
      : guarded.value;

    return Response.json(value, {
      headers: {
        "cache-control": "no-store",
        "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
        "x-idempotent-replay": guarded.replayed ? "1" : "0",
      },
    });
  } catch (error) {
    const status = error instanceof MutationBusyError ? 409 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "操作に失敗しました" }, { status, headers: { "cache-control": "no-store", "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}` } });
  }
}

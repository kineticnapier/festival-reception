"use client";

import { useEffect } from "react";
import { toast } from "sonner";

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

type ActionBody = {
  action?: string;
  requestId?: string;
  operationId?: string;
  [key: string]: unknown;
};

type PendingUndo = {
  operationId: string;
  action: string;
  consumed: boolean;
  fallbackTimer: number | null;
};

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function isActionsRequest(input: RequestInfo | URL) {
  try {
    return new URL(requestUrl(input), window.location.href).pathname === "/api/actions";
  } catch {
    return false;
  }
}

function operationIdFor(action: string, requestId: string) {
  return action === "REGISTER_DIRECT" ? `direct:${requestId}` : requestId;
}

function fallbackSuccessMessage(action: string) {
  if (action === "ADMIT_CALLED") return "入場を登録しました";
  if (action === "CANCEL") return "整理券を取り消しました";
  return "操作を完了しました";
}

export default function OperationUndoFeedback() {
  useEffect(() => {
    const previousFetch = window.fetch;
    const toastApi = toast as unknown as { success: typeof toast.success };
    const previousSuccess = toastApi.success;
    const pending: PendingUndo[] = [];

    const removePending = (entry: PendingUndo) => {
      const index = pending.indexOf(entry);
      if (index >= 0) pending.splice(index, 1);
      if (entry.fallbackTimer != null) window.clearTimeout(entry.fallbackTimer);
      entry.fallbackTimer = null;
    };

    const undoOperation = async (operationId: string) => {
      try {
        const response = await previousFetch("/api/actions", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "UNDO_OPERATION",
            requestId: crypto.randomUUID(),
            operationId,
          }),
        });
        const data = await response.json() as { error?: string };
        if (!response.ok) throw new Error(data.error || "操作を取り消せませんでした");
        previousSuccess("操作を取り消しました");
        window.setTimeout(() => window.location.reload(), 180);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作を取り消せませんでした");
      }
    };

    const withUndoAction = (
      options: Parameters<typeof previousSuccess>[1],
      operationId: string,
    ): Parameters<typeof previousSuccess>[1] => ({
      ...(options ?? {}),
      duration: options?.duration ?? 6000,
      action: {
        label: "取り消す",
        onClick: () => void undoOperation(operationId),
      },
    });

    const wrappedSuccess = ((
      message: Parameters<typeof previousSuccess>[0],
      options?: Parameters<typeof previousSuccess>[1],
    ) => {
      const entry = pending.find((item) => !item.consumed);
      if (!entry) return previousSuccess(message, options);

      entry.consumed = true;
      removePending(entry);
      return previousSuccess(message, withUndoAction(options, entry.operationId));
    }) as typeof previousSuccess;

    toastApi.success = wrappedSuccess;

    const wrappedFetch: typeof window.fetch = async (input, init) => {
      if (!isActionsRequest(input) || (init?.method ?? "GET").toUpperCase() !== "POST" || typeof init?.body !== "string") {
        return previousFetch(input, init);
      }

      let body: ActionBody;
      try {
        body = JSON.parse(init.body) as ActionBody;
      } catch {
        return previousFetch(input, init);
      }

      const action = body.action ?? "";
      const response = await previousFetch(input, init);

      if (response.ok && UNDOABLE_ACTIONS.has(action)) {
        const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
        let operationId = requestId ? operationIdFor(action, requestId) : "";
        try {
          const data = await response.clone().json() as { operationId?: unknown };
          if (typeof data.operationId === "string" && data.operationId.trim()) operationId = data.operationId.trim();
        } catch {
          // The action response is still returned untouched to the caller.
        }

        if (operationId) {
          const entry: PendingUndo = { operationId, action, consumed: false, fallbackTimer: null };
          pending.push(entry);
          // Most actions already show a success toast. If one does not, add the normal
          // completion toast after the caller has had a chance to render its own.
          entry.fallbackTimer = window.setTimeout(() => {
            if (entry.consumed) return;
            entry.consumed = true;
            removePending(entry);
            previousSuccess(
              fallbackSuccessMessage(entry.action),
              withUndoAction(undefined, entry.operationId),
            );
          }, 500);
        }
      }

      return response;
    };

    window.fetch = wrappedFetch;

    return () => {
      for (const entry of pending) {
        if (entry.fallbackTimer != null) window.clearTimeout(entry.fallbackTimer);
      }
      pending.length = 0;
      if (window.fetch === wrappedFetch) window.fetch = previousFetch;
      if (toastApi.success === wrappedSuccess) toastApi.success = previousSuccess;
    };
  }, []);

  return null;
}

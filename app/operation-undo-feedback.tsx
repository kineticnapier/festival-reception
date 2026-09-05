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

const LEGACY_TOAST_UNDO_ACTIONS = new Set(["EXIT_GROUP", "EXIT_GROUPS"]);

type ActionBody = {
  action?: string;
  requestId?: string;
  operationId?: string;
  [key: string]: unknown;
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

export default function OperationUndoFeedback() {
  useEffect(() => {
    const previousFetch = window.fetch;
    const pendingLegacyUndoIds: string[] = [];

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
        toast.success("操作を取り消しました");
        window.setTimeout(() => window.location.reload(), 180);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "操作を取り消せませんでした");
      }
    };

    const tagLegacyUndoButtons = () => {
      const buttons = document.querySelectorAll<HTMLButtonElement>("[data-sonner-toast] button");
      for (const button of buttons) {
        if (button.textContent?.trim() !== "取り消す") continue;
        if (button.dataset.operationUndoId) continue;
        const toastElement = button.closest<HTMLElement>("[data-sonner-toast]");
        if (toastElement?.textContent?.includes("この操作は取り消せます")) continue;
        const operationId = pendingLegacyUndoIds.shift();
        if (!operationId) continue;
        button.dataset.operationUndoId = operationId;
      }
    };

    const observer = new MutationObserver(tagLegacyUndoButtons);
    observer.observe(document.body, { childList: true, subtree: true });

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

      let action = body.action ?? "";
      let rewrittenLegacyUndoId: string | null = null;

      if (action === "UNDO_LAST") {
        const activeButton = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
        if (activeButton?.textContent?.trim() === "取り消す") {
          const operationId = activeButton.dataset.operationUndoId;
          if (!operationId) {
            return new Response(JSON.stringify({ error: "この取り消しボタンは古くなっています。操作履歴を確認してください" }), {
              status: 409,
              headers: { "content-type": "application/json" },
            });
          }
          body = { ...body, action: "UNDO_OPERATION", operationId };
          action = "UNDO_OPERATION";
          rewrittenLegacyUndoId = operationId;
          init = { ...init, body: JSON.stringify(body) };
        }
      }

      const response = await previousFetch(input, init);

      if (response.ok && rewrittenLegacyUndoId) {
        toast.dismiss(`operation-undo:${rewrittenLegacyUndoId}`);
      }

      const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
      if (response.ok && requestId && UNDOABLE_ACTIONS.has(action)) {
        const operationId = operationIdFor(action, requestId);
        if (LEGACY_TOAST_UNDO_ACTIONS.has(action)) {
          pendingLegacyUndoIds.push(operationId);
          window.setTimeout(tagLegacyUndoButtons, 0);
        } else {
          window.setTimeout(() => {
            toast("この操作は取り消せます", {
              id: `operation-undo:${operationId}`,
              duration: 10_000,
              action: {
                label: "取り消す",
                onClick: () => void undoOperation(operationId),
              },
            });
          }, 0);
        }
      }

      return response;
    };

    window.fetch = wrappedFetch;
    tagLegacyUndoButtons();

    return () => {
      observer.disconnect();
      if (window.fetch === wrappedFetch) window.fetch = previousFetch;
    };
  }, []);

  return null;
}

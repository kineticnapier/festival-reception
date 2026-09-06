"use client";

import { useEffect } from "react";

type StatusGroup = {
  ticket_number: number | null;
  party_size: number;
  created_at: number;
  called_at?: number | null;
};

type StatusResponse = {
  waiting?: StatusGroup[];
  called?: StatusGroup | null;
};

function elapsedLabel(createdAt: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60_000));
  return minutes < 1 ? "受付から1分未満" : `受付から${minutes}分経過`;
}

function calledElapsedLabel(calledAt: number) {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - calledAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `呼出から ${minutes}分${String(seconds).padStart(2, "0")}秒`;
}

function setText(element: Element | null, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

export default function GuideWaitDisplay() {
  useEffect(() => {
    if (location.pathname !== "/") return;

    let stopped = false;
    let refreshTimer: number | null = null;
    let minuteTimer: number | null = null;
    let noShowTimer: number | null = null;
    let noShowBusy = false;
    let groups = new Map<number, StatusGroup>();
    let calledGroup: StatusGroup | null = null;

    if (!document.querySelector("style[data-called-no-show]")) {
      const style = document.createElement("style");
      style.dataset.calledNoShow = "true";
      style.textContent = `
        .called-no-show {
          display: grid;
          gap: 8px;
          padding: 10px 12px;
          border: 1px solid #efb4aa;
          border-radius: 12px;
          background: #fff4f1;
          color: #6f2b20;
        }
        .called-no-show-copy {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
        }
        .called-no-show-copy strong {
          font-size: 16px;
          font-variant-numeric: tabular-nums;
        }
        .called-no-show-copy span {
          color: #8a554b;
          font-size: 12px;
          font-weight: 800;
        }
        .called-no-show button {
          min-height: 42px;
          border: 0;
          border-radius: 10px;
          background: #c84b3a;
          color: white;
          font: inherit;
          font-weight: 900;
          cursor: pointer;
        }
        .called-no-show button:disabled {
          background: #d9cbc7;
          color: #735f59;
          cursor: default;
        }
      `;
      document.head.appendChild(style);
    }

    const renderWaiting = () => {
      document.querySelectorAll<HTMLElement>(".waiting-card .ticket-row").forEach((row) => {
        const ticketText = row.querySelector<HTMLElement>(":scope > strong")?.textContent ?? "";
        const ticketNumber = Number(ticketText.replace(/\D/g, ""));
        const detail = row.querySelector<HTMLElement>(":scope > span");
        const group = groups.get(ticketNumber);
        if (!detail || !group) return;
        setText(detail, `${group.party_size}人・${elapsedLabel(group.created_at)}`);
      });
    };

    const renderNoShow = () => {
      const callControl = document.querySelector<HTMLElement>(".call-control");
      if (!callControl || !calledGroup || calledGroup.ticket_number == null) {
        document.querySelector(".called-no-show")?.remove();
        return;
      }

      let panel = callControl.querySelector<HTMLElement>(".called-no-show");
      if (!panel) {
        panel = document.createElement("div");
        panel.className = "called-no-show";
        panel.innerHTML = `
          <div class="called-no-show-copy"><strong></strong><span></span></div>
          <button type="button"></button>
        `;
        callControl.prepend(panel);
      }

      const ticketNumber = calledGroup.ticket_number;
      const calledAt = calledGroup.called_at;
      const label = panel.querySelector("strong");
      const note = panel.querySelector("span");
      const button = panel.querySelector<HTMLButtonElement>("button");
      if (!button) return;

      setText(label, calledAt == null ? `${ticketNumber}番・呼出時刻不明` : calledElapsedLabel(calledAt));
      setText(note, "来なければ取消 → 後から来た場合は再発行");
      button.disabled = noShowBusy;
      setText(button, noShowBusy ? "取消中…" : `${ticketNumber}番を不在として取消`);

      button.onclick = async () => {
        if (button.disabled || noShowBusy) return;
        if (!window.confirm(`${ticketNumber}番を不在として取り消しますか？\n後から来た場合は新しい整理券を発行してください。`)) return;
        noShowBusy = true;
        renderNoShow();
        try {
          const response = await fetch("/api/actions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "CANCEL", requestId: crypto.randomUUID(), ticketNumber }),
          });
          const data = await response.json() as { error?: string };
          if (!response.ok) throw new Error(data.error || "取消に失敗しました");
          calledGroup = null;
          renderNoShow();
          window.setTimeout(() => void refresh(), 100);
        } catch (error) {
          window.alert(error instanceof Error ? error.message : "取消に失敗しました");
        } finally {
          noShowBusy = false;
          renderNoShow();
        }
      };
    };

    const render = () => {
      renderWaiting();
      renderNoShow();
    };

    const scheduleMinuteRender = () => {
      if (minuteTimer != null) window.clearTimeout(minuteTimer);
      const delay = 60_000 - (Date.now() % 60_000) + 100;
      minuteTimer = window.setTimeout(() => {
        renderWaiting();
        scheduleMinuteRender();
      }, delay);
    };

    const refresh = async () => {
      if (!document.querySelector(".reception-topbar")) return;
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as StatusResponse;
        if (stopped) return;
        groups = new Map((data.waiting ?? [])
          .filter((group): group is StatusGroup & { ticket_number: number } => group.ticket_number != null)
          .map((group) => [group.ticket_number, group]));
        calledGroup = data.called ?? null;
        render();
      } catch {
        // The main reception screen already shows connection errors.
      }
    };

    const requestRefresh = () => {
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(), 120);
    };

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) =>
        node instanceof Element && (
          node.matches(".reception-topbar, .ticket-row, .waiting-card, .guidance-result.called, .call-control") ||
          node.querySelector(".reception-topbar, .ticket-row, .guidance-result.called, .call-control")
        )
      ))) requestRefresh();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    requestRefresh();
    scheduleMinuteRender();
    noShowTimer = window.setInterval(renderNoShow, 1000);

    return () => {
      stopped = true;
      observer.disconnect();
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      if (minuteTimer != null) window.clearTimeout(minuteTimer);
      if (noShowTimer != null) window.clearInterval(noShowTimer);
    };
  }, []);

  return null;
}

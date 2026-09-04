"use client";

import { useEffect } from "react";

type StatusGroup = {
  ticket_number: number | null;
  party_size: number;
  created_at: number;
};

type StatusResponse = {
  waiting?: StatusGroup[];
};

function elapsedLabel(createdAt: number) {
  const minutes = Math.max(0, Math.floor((Date.now() - createdAt) / 60_000));
  return minutes < 1 ? "受付から1分未満" : `受付から${minutes}分経過`;
}

export default function GuideWaitDisplay() {
  useEffect(() => {
    if (location.pathname !== "/") return;

    let stopped = false;
    let refreshTimer: number | null = null;
    let minuteTimer: number | null = null;
    let groups = new Map<number, StatusGroup>();

    const render = () => {
      document.querySelectorAll<HTMLElement>(".waiting-card .ticket-row").forEach((row) => {
        const ticketText = row.querySelector<HTMLElement>(":scope > strong")?.textContent ?? "";
        const ticketNumber = Number(ticketText.replace(/\D/g, ""));
        const detail = row.querySelector<HTMLElement>(":scope > span");
        const group = groups.get(ticketNumber);
        if (!detail || !group) return;
        detail.textContent = `${group.party_size}人・${elapsedLabel(group.created_at)}`;
      });
    };

    const scheduleMinuteRender = () => {
      if (minuteTimer != null) window.clearTimeout(minuteTimer);
      const delay = 60_000 - (Date.now() % 60_000) + 100;
      minuteTimer = window.setTimeout(() => {
        render();
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
          node.matches(".reception-topbar, .ticket-row, .waiting-card") ||
          node.querySelector(".reception-topbar, .ticket-row")
        )
      ))) requestRefresh();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    requestRefresh();
    scheduleMinuteRender();

    return () => {
      stopped = true;
      observer.disconnect();
      if (refreshTimer != null) window.clearTimeout(refreshTimer);
      if (minuteTimer != null) window.clearTimeout(minuteTimer);
    };
  }, []);

  return null;
}

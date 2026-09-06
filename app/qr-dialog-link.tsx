"use client";

import { useEffect } from "react";
import { estimateQueueWaitMinutes } from "@/lib/queue-guidance";

type Group = {
  id: number;
  ticket_number: number | null;
  party_size: number;
  created_at: number;
  admitted_at: number | null;
};

type Status = {
  waiting: Group[];
  pendingHandoff: Group | null;
  called: Group | null;
  inside: Group[];
  settings: {
    activeCapacity: number;
    priorStayMinutes: number;
    reserveWaitMinutes: number;
  };
  estimate: {
    predictedStayMinutes: number;
  };
};

type AdmissionEstimate = {
  time: string;
  detail: string;
};

function waitPageHref(qr: Element) {
  const dialog = qr.closest("[role='dialog']") ?? qr.closest(".qr-dialog");
  const title = dialog?.querySelector("h2")?.textContent ?? "";
  const ticket = title.match(/整理券\s*(\d+)番/)?.[1];
  if (!ticket) return null;

  const params = new URLSearchParams({ ticket });
  return `/wait?${params.toString()}`;
}

function pendingTicketNumber() {
  const text = document.querySelector(".paper-ticket-number strong")?.textContent ?? "";
  const match = text.match(/(\d+)/);
  return match ? Number(match[1]) : null;
}

function setText(element: Element | null, text: string) {
  if (element && element.textContent !== text) element.textContent = text;
}

function ensureEstimateStyle() {
  if (document.querySelector("style[data-admission-estimate]")) return;
  const style = document.createElement("style");
  style.dataset.admissionEstimate = "true";
  style.textContent = `
    .paper-admission-estimate,
    .qr-admission-estimate {
      border: 2px solid #c84b3a;
      border-radius: 14px;
      background: #fff8f5;
      color: #6f2b20;
      text-align: center;
    }
    .paper-admission-estimate {
      padding: 10px 14px;
    }
    .qr-admission-estimate {
      margin-top: 10px;
      padding: 12px 14px;
    }
    .paper-admission-estimate > span,
    .qr-admission-estimate > span {
      display: block;
      font-size: 12px;
      font-weight: 900;
      letter-spacing: .06em;
    }
    .paper-admission-estimate > strong,
    .qr-admission-estimate > strong {
      display: block;
      margin-top: 2px;
      font-size: 28px;
      line-height: 1.15;
      letter-spacing: -.03em;
    }
    .paper-admission-estimate > small,
    .qr-admission-estimate > small {
      display: block;
      margin-top: 3px;
      color: #8a554b;
      font-size: 12px;
      font-weight: 800;
    }
  `;
  document.head.appendChild(style);
}

function renderEstimate(ticket: number, estimate: AdmissionEstimate) {
  if (pendingTicketNumber() !== ticket) return;

  const actions = document.querySelector(".paper-ticket-alert .paper-ticket-actions");
  if (actions) {
    let box = actions.querySelector(".paper-admission-estimate");
    if (!box) {
      box = document.createElement("div");
      box.className = "paper-admission-estimate";
      box.setAttribute("role", "status");
      box.innerHTML = "<span>紙に記入</span><strong></strong><small></small>";
      actions.prepend(box);
    }
    setText(box.querySelector("strong"), `推定入場 ${estimate.time}`);
    setText(box.querySelector("small"), estimate.detail);
  }

  document.querySelectorAll<HTMLElement>("[role='dialog'], .qr-dialog").forEach((dialog) => {
    const title = dialog.querySelector("h2")?.textContent ?? "";
    if (!new RegExp(`整理券\\s*${ticket}番`).test(title)) return;
    let box = dialog.querySelector(".qr-admission-estimate");
    if (!box) {
      box = document.createElement("div");
      box.className = "qr-admission-estimate";
      box.setAttribute("role", "status");
      box.innerHTML = "<span>推定入場時刻</span><strong></strong><small></small>";
      const qr = dialog.querySelector(".qr-code");
      if (qr) qr.before(box);
      else dialog.appendChild(box);
    }
    setText(box.querySelector("strong"), estimate.time);
    setText(box.querySelector("small"), estimate.detail);
  });
}

function formatJstTime(timestamp: number) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  }).format(timestamp);
}

export default function QrDialogLink() {
  useEffect(() => {
    let stopped = false;
    let requestingTicket: number | null = null;
    const cache = new Map<number, AdmissionEstimate>();

    const markQrCodes = () => {
      document.querySelectorAll<HTMLElement>(".qr-code").forEach((qr) => {
        qr.tabIndex = 0;
        qr.setAttribute("role", "link");
        qr.setAttribute("aria-label", "この整理券の確認ページを開く");
        qr.title = "確認ページを開く";
      });
    };

    const loadPendingEstimate = async () => {
      const ticket = pendingTicketNumber();
      if (ticket == null) return;

      const cached = cache.get(ticket);
      if (cached) {
        renderEstimate(ticket, cached);
        return;
      }
      if (requestingTicket === ticket) return;
      requestingTicket = ticket;

      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const status = await response.json() as Status;
        const pending = status.pendingHandoff;
        if (!pending || pending.ticket_number !== ticket) return;

        const now = Date.now();
        const estimates = estimateQueueWaitMinutes({
          capacity: status.settings.activeCapacity,
          stayMinutes: status.estimate.predictedStayMinutes,
          cycleMinutes: status.settings.priorStayMinutes,
          reserveWaitMinutes: status.settings.reserveWaitMinutes,
          now,
          inside: status.inside.map((group) => ({
            id: group.id,
            partySize: group.party_size,
            admittedAt: group.admitted_at,
          })),
          called: status.called == null || status.called.ticket_number == null ? null : {
            id: status.called.id,
            ticketNumber: status.called.ticket_number,
            partySize: status.called.party_size,
            createdAt: status.called.created_at,
          },
          waiting: [
            ...status.waiting.filter((group) => group.ticket_number != null).map((group) => ({
              id: group.id,
              ticketNumber: group.ticket_number!,
              partySize: group.party_size,
              createdAt: group.created_at,
            })),
            {
              id: pending.id,
              ticketNumber: ticket,
              partySize: pending.party_size,
              createdAt: pending.created_at,
            },
          ],
        });

        const minutes = estimates.get(pending.id);
        if (minutes == null || stopped) return;
        const estimate = {
          time: `${formatJstTime(now + minutes * 60_000)}ごろ`,
          detail: minutes < 1 ? "まもなく" : `約${minutes}分後`,
        };
        cache.set(ticket, estimate);
        renderEstimate(ticket, estimate);
      } catch {
        // The normal reception flow must keep working even if this optional estimate fails.
      } finally {
        if (requestingTicket === ticket) requestingTicket = null;
      }
    };

    const sync = () => {
      markQrCodes();
      const ticket = pendingTicketNumber();
      if (ticket != null) {
        const cached = cache.get(ticket);
        if (cached) renderEstimate(ticket, cached);
        else void loadPendingEstimate();
      }
    };

    const openQrPage = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      const qr = target.closest(".qr-code");
      if (!qr) return;
      const href = waitPageHref(qr);
      if (!href) return;
      window.open(href, "_blank", "noopener,noreferrer");
    };

    const onClick = (event: MouseEvent) => openQrPage(event.target);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!(event.target instanceof Element) || !event.target.matches(".qr-code")) return;
      event.preventDefault();
      openQrPage(event.target);
    };

    ensureEstimateStyle();
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      stopped = true;
      observer.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}

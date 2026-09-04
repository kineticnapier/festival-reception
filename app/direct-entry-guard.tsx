"use client";

import { useEffect } from "react";

export default function DirectEntryGuard() {
  useEffect(() => {
    let note: HTMLParagraphElement | null = null;

    const sync = () => {
      const actions = document.querySelector<HTMLElement>(".fast-entry-card .register-actions");
      const enterButton = actions?.querySelector<HTMLButtonElement>(".enter-button") ?? null;
      const queueActive = Boolean(actions?.classList.contains("queue-active"));
      const handoffPending = Boolean(document.querySelector(".paper-ticket-alert"));
      const locked = queueActive || handoffPending;

      if (enterButton) {
        if (locked) {
          enterButton.dataset.queueLocked = "true";
          enterButton.setAttribute("aria-disabled", "true");
        } else {
          delete enterButton.dataset.queueLocked;
          enterButton.removeAttribute("aria-disabled");
        }
      }

      const hasSpecificLockReason = Boolean(document.querySelector(
        ".fast-entry-card > .reserve-entry-lock:not(.queue-entry-lock-note)",
      ));

      if (actions && locked && !hasSpecificLockReason) {
        if (!note || !note.isConnected) {
          note = document.createElement("p");
          note.className = "reserve-entry-lock queue-entry-lock-note";
          note.textContent = "整理券グループがいるため、直接入場はできません";
          actions.before(note);
        }
      } else if (note) {
        note.remove();
        note = null;
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class"],
    });

    const blockLockedEntry = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".enter-button[data-queue-locked='true']")) return;
      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener("click", blockLockedEntry, true);
    sync();

    return () => {
      observer.disconnect();
      document.removeEventListener("click", blockLockedEntry, true);
      note?.remove();
      const enterButton = document.querySelector<HTMLButtonElement>(".enter-button[data-queue-locked='true']");
      if (enterButton) {
        delete enterButton.dataset.queueLocked;
        enterButton.removeAttribute("aria-disabled");
      }
    };
  }, []);

  return null;
}

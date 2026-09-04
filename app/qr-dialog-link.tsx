"use client";

import { useEffect } from "react";

function waitPageHref(qr: Element) {
  const dialog = qr.closest("[role='dialog']") ?? qr.closest(".qr-dialog");
  const title = dialog?.querySelector("h2")?.textContent ?? "";
  const ticket = title.match(/整理券\s*(\d+)番/)?.[1];
  const day = document.querySelector("main.app-shell footer span")?.textContent?.trim();
  if (!ticket || !day) return null;

  const params = new URLSearchParams({ day, ticket });
  return `/wait?${params.toString()}`;
}

export default function QrDialogLink() {
  useEffect(() => {
    const markQrCodes = () => {
      document.querySelectorAll<HTMLElement>(".qr-code").forEach((qr) => {
        qr.tabIndex = 0;
        qr.setAttribute("role", "link");
        qr.setAttribute("aria-label", "この整理券の確認ページを開く");
        qr.title = "確認ページを開く";
      });
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

    markQrCodes();
    const observer = new MutationObserver(markQrCodes);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      observer.disconnect();
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return null;
}

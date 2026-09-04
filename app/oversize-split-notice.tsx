"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { splitPartySizes } from "@/lib/group-split";
import styles from "./oversize-split-notice.module.css";

type Status = { settings?: { activeCapacity?: number } };

export default function OversizeSplitNotice() {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const [partySize, setPartySize] = useState(0);
  const [capacity, setCapacity] = useState<number | null>(null);

  useEffect(() => {
    let anchor: HTMLElement | null = null;

    const sync = () => {
      const number = document.querySelector<HTMLElement>(".party-readout strong");
      const actions = document.querySelector<HTMLElement>(".fast-entry-card .register-actions");
      const nextPartySize = Number(number?.textContent ?? 0);
      if (Number.isInteger(nextPartySize) && nextPartySize > 0) setPartySize(nextPartySize);

      if (!actions) {
        setTarget(null);
        return;
      }

      anchor = document.getElementById("oversize-split-notice-anchor");
      if (!anchor) {
        anchor = document.createElement("div");
        anchor.id = "oversize-split-notice-anchor";
        actions.before(anchor);
      }
      setTarget(anchor);
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    sync();

    return () => {
      observer.disconnect();
      anchor?.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const refreshCapacity = async () => {
      try {
        const response = await fetch("/api/status", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json() as Status;
        const next = Number(data.settings?.activeCapacity);
        if (!cancelled && Number.isInteger(next) && next > 0) setCapacity(next);
      } catch {
        // The main reception screen already handles connection errors.
      }
    };

    void refreshCapacity();
    const timer = window.setInterval(() => void refreshCapacity(), 10_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const sizes = useMemo(() => {
    if (capacity == null || partySize <= capacity) return [];
    return splitPartySizes(partySize, capacity);
  }, [partySize, capacity]);

  if (!target || capacity == null || sizes.length <= 1) return null;

  return createPortal(
    <div className={styles.notice} role="status">
      <strong>定員{capacity}人を超えるため、{sizes.length}組に分けて受付します</strong>
      <span>{partySize}人 → {sizes.map((size) => `${size}人`).join(" + ")}</span>
      <small>整理券は分割したグループごとに発行します。案内は別々になる場合があります。</small>
    </div>,
    target,
  );
}

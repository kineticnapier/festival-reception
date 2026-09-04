"use client";

import { useEffect } from "react";

const VALUE_SELECTOR = ".app-shell strong, .wait-public-shell strong";

export default function MotionFeedback() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let raf = 0;
    const animate = (element: Element) => {
      element.classList.remove("motion-value-pop");
      void (element as HTMLElement).offsetWidth;
      element.classList.add("motion-value-pop");
      window.setTimeout(() => element.classList.remove("motion-value-pop"), 240);
    };

    const observer = new MutationObserver((records) => {
      const changed = new Set<Element>();
      for (const record of records) {
        const base = record.target instanceof Element ? record.target : record.target.parentElement;
        const element = base?.closest(VALUE_SELECTOR);
        if (element) changed.add(element);
      }
      if (!changed.size) return;
      window.cancelAnimationFrame(raf);
      raf = window.requestAnimationFrame(() => changed.forEach(animate));
    });

    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, []);

  return null;
}

"use client";

import { useEffect } from "react";

function currentDayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export default function AdminDayPicker() {
  useEffect(() => {
    if (location.pathname !== "/admin") return;

    const today = currentDayKey();
    const selected = new URL(location.href).searchParams.get("day") || today;

    const mount = () => {
      if (document.querySelector(".admin-day-picker")) return;
      const topbar = document.querySelector<HTMLElement>(".admin-shell .topbar");
      if (!topbar) return;

      const picker = document.createElement("section");
      picker.className = "admin-day-picker";
      picker.innerHTML = `
        <label>
          <span>表示日</span>
          <input type="date" aria-label="表示する受付日" />
        </label>
        <button type="button">今日</button>
        <em></em>
      `;

      const input = picker.querySelector<HTMLInputElement>("input");
      const todayButton = picker.querySelector<HTMLButtonElement>("button");
      const note = picker.querySelector<HTMLElement>("em");
      if (!input || !todayButton || !note) return;

      input.value = selected;
      input.max = today;
      note.textContent = selected === today ? "本日のデータ" : "過去データ・閲覧専用";
      picker.classList.toggle("historical", selected !== today);

      input.addEventListener("change", () => {
        if (!input.value) return;
        const url = new URL(location.href);
        if (input.value === today) url.searchParams.delete("day");
        else url.searchParams.set("day", input.value);
        location.assign(url.toString());
      });

      todayButton.addEventListener("click", () => {
        const url = new URL(location.href);
        url.searchParams.delete("day");
        location.assign(url.toString());
      });

      topbar.insertAdjacentElement("afterend", picker);
    };

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => Array.from(mutation.addedNodes).some((node) =>
        node instanceof Element && (
          node.matches(".admin-shell, .topbar") || node.querySelector(".admin-shell .topbar")
        )
      ))) mount();
    });

    observer.observe(document.body, { childList: true, subtree: true });
    mount();

    return () => {
      observer.disconnect();
      document.querySelector(".admin-day-picker")?.remove();
    };
  }, []);

  return null;
}

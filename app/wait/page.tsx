"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink } from "lucide-react";

type TicketStatus = "issuing" | "waiting" | "called" | "inside" | "exited" | "cancelled";
type TicketInfo = { ticket_number: number; party_size: number; status: TicketStatus; ahead: number; estimatedMinutes: number | null };
type WaitStatus = { dayKey: string; called: { ticket_number: number } | null; ticket: TicketInfo | null; socialLinks: { id: number; label: string; url: string }[]; updatedAt: number };

export default function WaitPage() {
  const [status, setStatus] = useState<WaitStatus | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState<{ day: string | null; ticket: string } | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const refreshInFlightRef = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(location.search);
      setQuery({ day: params.get("day"), ticket: params.get("ticket") ?? "" });
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const refresh = useCallback(async () => {
    if (!query?.ticket || refreshInFlightRef.current || document.visibilityState === "hidden") return;
    refreshInFlightRef.current = true;
    try {
      const params = new URLSearchParams({ ticket: query.ticket });
      if (query.day) params.set("day", query.day);
      const response = await fetch(`/api/status?${params.toString()}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus((current) => !current || data.updatedAt >= current.updatedAt ? data : current);
      setLastUpdated(Date.now());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "更新できませんでした");
    } finally {
      refreshInFlightRef.current = false;
    }
  }, [query]);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 2000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  const ticket = status?.ticket;
  const tone = ticket ? ticketTone(ticket) : "waiting";
  const missingTicket = query != null && !query.ticket;

  return (
    <main className="wait-public-shell">
      <header className="wait-public-header">
        <div className="wait-public-brand"><strong>順番待ち状況</strong></div>
        <span className="wait-live"><i />自動更新</span>
      </header>

      <section className={`wait-public-ticket ${tone}`}>
        <p className="wait-public-ticket-label">受付番号</p>
        <div className="wait-public-number"><strong>{query?.ticket || "—"}</strong><span>番</span></div>
        {ticket && <span className="wait-state-badge">{stateLabel(ticket)}</span>}
      </section>

      {missingTicket ? <section className="wait-public-error"><h1>整理券番号がありません</h1><p>整理券のQRコードから開くか、受付番号付きのURLをご利用ください。</p></section>
        : error ? <section className="wait-public-error"><h1>接続を確認しています</h1><p>{error}</p></section>
          : !status ? <section className="wait-primary-card"><h1>読み込み中…</h1><p>最新の案内状況を確認しています。</p></section>
            : !ticket ? <section className="wait-public-error"><h1>整理券が見つかりません</h1><p>URLが途中で切れていないか、受付でご確認ください。</p></section>
              : <>
                <StatusCard ticket={ticket} />

                {ticket.status === "waiting" && <section className="wait-summary">
                  <div><span>待ち時間の目安</span><strong>{waitEstimate(ticket.estimatedMinutes)}</strong></div>
                  <div><span>参考：番号上、先に発行された待機</span><strong>{ticket.ahead}<small>組</small></strong></div>
                </section>}

                <section className="wait-current">
                  <span>現在の案内</span>
                  <strong>{status.called ? `${status.called.ticket_number}番` : "案内待ち"}</strong>
                </section>

                <section className="wait-party"><span>受付人数</span><strong>{ticket.party_size}人</strong></section>

                {(ticket.status === "waiting" || ticket.status === "called") && <section className="wait-notice">
                  {ticket.status === "called"
                    ? <>紙整理券をお持ちのうえ、<strong>グループ全員で受付へお越しください。</strong></>
                    : <>順番が近づいたら受付付近へお戻りください。<strong>グループ人数や混雑状況により案内順が前後する場合があります。</strong> 紙整理券は必ずお持ちください。</>}
                </section>}

                {status.socialLinks?.length > 0 && <section className="wait-public-links">
                  <h2>待ち時間にこちらもどうぞ</h2>
                  <div className="wait-public-links-list">{status.socialLinks.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer"><span>{link.label}</span><ExternalLink /></a>)}</div>
                </section>}
              </>}

      <footer className="wait-public-footer">
        <span>{status?.dayKey ?? query?.day ?? ""}</span>
        <span>{lastUpdated ? `最終更新 ${clockLabel(lastUpdated)}` : missingTicket ? "番号を確認してください" : "最新情報を取得中"}</span>
      </footer>
    </main>
  );
}

function StatusCard({ ticket }: { ticket: TicketInfo }) {
  const tone = ticketTone(ticket);
  if (ticket.status === "issuing") return <section className={`wait-primary-card ${tone}`}><h1>整理券を準備しています</h1><p>受付で紙整理券をお受け取りください。</p></section>;
  if (ticket.status === "called") return <section className={`wait-primary-card ${tone}`}><h1>受付へお越しください</h1><p>ただいま、この番号をご案内しています。</p></section>;
  if (ticket.status === "inside") return <section className={`wait-primary-card ${tone}`}><h1>ご案内済みです</h1><p>この整理券は入場済みです。</p></section>;
  if (ticket.status === "exited") return <section className={`wait-primary-card ${tone}`}><h1>ご案内済みです</h1><p>ご来場ありがとうございました。</p></section>;
  if (ticket.status === "cancelled") return <section className={`wait-primary-card ${tone}`}><h1>この整理券は取消済みです</h1><p>必要な場合は受付へお声がけください。</p></section>;
  if (isNear(ticket)) return <section className={`wait-primary-card ${tone}`}><h1>まもなくご案内です</h1><p>受付付近でお待ちください。</p></section>;
  return <section className={`wait-primary-card ${tone}`}><h1>順番待ち中です</h1><p>この画面は自動で最新の案内状況に更新されます。</p></section>;
}

function isNear(ticket: TicketInfo) {
  return ticket.status === "waiting" && ticket.estimatedMinutes != null && ticket.estimatedMinutes <= 1;
}

function ticketTone(ticket: TicketInfo) {
  if (ticket.status === "called") return "called";
  if (ticket.status === "inside" || ticket.status === "exited") return "done";
  if (ticket.status === "cancelled") return "cancelled";
  if (isNear(ticket)) return "near";
  return "waiting";
}

function stateLabel(ticket: TicketInfo) {
  if (ticket.status === "issuing") return "発券中";
  if (ticket.status === "called") return "お呼び出し中";
  if (ticket.status === "inside" || ticket.status === "exited") return "ご案内済み";
  if (ticket.status === "cancelled") return "取消済み";
  if (isNear(ticket)) return "まもなくご案内";
  return "順番待ち中";
}

function waitEstimate(minutes: number | null) {
  if (minutes == null) return "受付で確認";
  if (minutes <= 1) return "まもなく";
  return `約 ${minutes}分`;
}

function clockLabel(timestamp: number) {
  return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(timestamp);
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, ExternalLink, Radio, Ticket } from "lucide-react";

type TicketStatus = "issuing" | "waiting" | "called" | "inside" | "exited" | "cancelled";
type WaitStatus = { called: { ticket_number: number } | null; ticket: { ticket_number: number; party_size: number; status: TicketStatus; ahead: number; estimatedMinutes: number | null } | null; socialLinks: { id: number; label: string; url: string }[]; updatedAt: number };

export default function WaitPage() {
  const [status, setStatus] = useState<WaitStatus | null>(null);
  const [error, setError] = useState("");
  const [query, setQuery] = useState<{ day: string; ticket: string } | null>(null);
  const refreshInFlightRef = useRef(false);

  useEffect(() => { const timer = window.setTimeout(() => { const params = new URLSearchParams(location.search); setQuery({ day: params.get("day") ?? "", ticket: params.get("ticket") ?? "" }); }, 0); return () => window.clearTimeout(timer); }, []);
  const refresh = useCallback(async () => {
    if (!query?.day || !query.ticket || refreshInFlightRef.current || document.visibilityState === "hidden") return;
    refreshInFlightRef.current = true;
    try {
      const response = await fetch(`/api/status?day=${encodeURIComponent(query.day)}&ticket=${encodeURIComponent(query.ticket)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setStatus((current) => !current || data.updatedAt >= current.updatedAt ? data : current);
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
  return (
    <main className="wait-shell">
      <div className="wait-top"><span className="live-dot"><i />自動更新中</span><span>{query?.day}</span></div>
      <section className="wait-ticket"><Ticket /><p>あなたの整理番号</p><strong>{query?.ticket || "—"}</strong><span>番</span></section>
      {error ? <section className="wait-message error-message"><h1>接続を確認しています</h1><p>{error}</p></section> : !status ? <section className="wait-message"><h1>読み込み中…</h1></section> : !ticket ? <section className="wait-message error-message"><h1>整理券が見つかりません</h1><p>URLが途中で切れていないか受付で確認してください。</p></section> : <>
        <section className={`wait-message status-${ticket.status}`}><StatusMessage status={ticket.status} partySize={ticket.party_size} /></section>
        <section className="wait-grid">
          <div><Radio /><span>現在案内中</span><strong>{status.called?.ticket_number ?? "—"}<small>{status.called ? "番" : ""}</small></strong></div>
          <div><Clock3 /><span>受付順で前に</span><strong>{ticket.status === "waiting" ? ticket.ahead : 0}<small>組</small></strong></div>
        </section>
        <section className="estimate-card"><span>グループ全員が入れるまでの推定待ち時間</span><strong>{ticket.status === "waiting" ? (ticket.estimatedMinutes == null ? "受付で確認" : `約 ${ticket.estimatedMinutes} 分`) : "—"}</strong><p>目安です。案内順はグループ人数と待ち時間により前後します。表示より少し早めに受付付近へお戻りください。紙整理券を必ずお持ちください。</p></section>
        {status.socialLinks?.length > 0 && <section className="social-card"><p className="kicker">制作・活動リンク</p><h2>待ち時間にこちらもどうぞ</h2><div className="social-links">{status.socialLinks.map((link) => <a key={link.id} href={link.url} target="_blank" rel="noreferrer"><span>{link.label}</span><ExternalLink /></a>)}</div></section>}
      </>}
      <footer><span>画面を開いている間、2秒ごとに更新します</span></footer>
    </main>
  );
}

function StatusMessage({ status, partySize }: { status: TicketStatus; partySize: number }) {
  if (status === "issuing") return <><h1>紙整理券を準備中です</h1><p>受付で紙を受け取り、確認が終わるまでお待ちください。</p></>;
  if (status === "called") return <><h1>受付へお越しください</h1><p>{partySize}人のグループで受付へお越しください。</p></>;
  if (status === "inside" || status === "exited") return <><h1>ご案内済みです</h1><p>この整理券は入場済みです。</p></>;
  if (status === "cancelled") return <><h1>この整理券は取消済みです</h1><p>必要な場合は受付へお声がけください。</p></>;
  return <><h1>そのままお待ちください</h1><p>順番が近づいたら受付付近へお戻りください。</p></>;
}

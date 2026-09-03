"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { Download, KeyRound, Link2, LogOut, MonitorSmartphone, Plus, RefreshCw, RotateCcw, Save, Settings, Shield, Trash2, X } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

type Group = {
  id: number; ticket_number: number | null; status: string; party_size: number;
  student_count: number | null; external_count: number | null;
  middle_grade1_count: number | null; middle_grade2_count: number | null; middle_grade3_count: number | null;
  high_grade1_count: number | null; high_grade2_count: number | null; high_grade3_count: number | null;
  admitted_at: number | null; created_at: number;
};
type Session = { id: string; role: "staff" | "admin"; device_label: string | null; user_agent: string | null; created_at: number; expires_at: number; last_seen_at: number; revoked_at: number | null };
type SocialLink = { id?: number; label: string; url: string; enabled: boolean };
type EventRow = { id: number; type: string; ticket_number: number | null; group_id: number | null; party_size: number; details: string | null; undone: number; created_at: number };
type Dashboard = {
  status: {
    dayKey: string; currentCount: number; totalCount: number; maxCurrent: number; nextTicketNumber: number;
    waitingCount: number; waitingPeople: number; called: { ticket_number: number } | null;
    settings: { normalCapacity: number; overflowCapacity: number; overflowEnabled: boolean; activeCapacity: number; priorStayMinutes: number; reserveWaitMinutes: number };
    estimate: { predictedStayMinutes: number; actualSampleCount: number; actualWeight: number; peoplePerMinute: number };
    guidance: { mode: string; freeSeats: number; seatsNeeded: number; oversizedCount: number; target: { ticketNumber: number; partySize: number; waitMinutes: number; priority: number } | null; scores: { ticketNumber: number; partySize: number; waitMinutes: number; priority: number; eligibleNow: boolean }[] };
  };
  stats: {
    admittedGroups: number; averagePartySize: number; averageDwellMinutes: number | null; ticketGroups: number;
    source: { students: number; external: number }; grades: Record<string, number>; gender: { male: number; female: number }; age: { adult: number; child: number };
    hourly: { hour: number; people: number; groups: number }[];
  };
  groups: Group[]; sessions: Session[]; socialLinks: { id: number; label: string; url: string; enabled: number }[]; events: EventRow[]; generatedAt: number;
};

const statusLabels: Record<string, string> = { waiting: "待機中", called: "案内中", inside: "入場中", exited: "退場済", cancelled: "取消済" };
const eventLabels: Record<string, string> = {
  ENTER: "直接入場", EXIT: "退場", QUEUE_CREATE: "整理券発行", QUEUE_RESERVE: "紙整理券を準備", QUEUE_CONFIRM: "紙受け渡し確認", CALL: "呼出", ADMIT: "整理券入場", CANCEL: "取消",
  SETTINGS: "設定変更", ADMIN_CORRECT: "状態を手動修正", ADMIN_GROUP_STATUS: "グループ状態を修正",
};

export default function AdminPage() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("管理者端末");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [links, setLinks] = useState<SocialLink[]>([]);
  const [correction, setCorrection] = useState({ currentCount: "0", totalCount: "0", nextTicket: "1", calledNumber: "" });
  const [settings, setSettings] = useState({ normalCapacity: "13", overflowCapacity: "16", overflowEnabled: false, priorStayMinutes: "2.5", reserveWaitMinutes: "5" });
  const hydratedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/admin", { cache: "no-store" });
      const data = await response.json();
      if (response.status === 401) { setAuthenticated(false); setDashboard(null); return; }
      if (!response.ok) throw new Error(data.error);
      const next = data as Dashboard;
      setDashboard(next); setError("");
      if (!hydratedRef.current) {
        setLinks(next.socialLinks.map((link) => ({ id: link.id, label: link.label, url: link.url, enabled: Boolean(link.enabled) })));
        setCorrection({ currentCount: String(next.status.currentCount), totalCount: String(next.status.totalCount), nextTicket: String(next.status.nextTicketNumber), calledNumber: next.status.called?.ticket_number ? String(next.status.called.ticket_number) : "" });
        setSettings({ normalCapacity: String(next.status.settings.normalCapacity), overflowCapacity: String(next.status.settings.overflowCapacity), overflowEnabled: next.status.settings.overflowEnabled, priorStayMinutes: String(next.status.settings.priorStayMinutes), reserveWaitMinutes: String(next.status.settings.reserveWaitMinutes) });
        hydratedRef.current = true;
      }
    } catch (err) { setError(err instanceof Error ? err.message : "管理データを取得できませんでした"); }
  }, []);

  useEffect(() => {
    fetch("/api/admin-auth", { cache: "no-store" }).then((response) => response.json()).then((data) => { setAuthenticated(Boolean(data.authenticated)); setSessionId(data.sessionId ?? null); }).catch(() => setAuthenticated(false));
  }, []);
  useEffect(() => {
    if (!authenticated) return;
    const initial = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); };
  }, [authenticated, refresh]);
  async function login(event: FormEvent) {
    event.preventDefault(); setAuthBusy(true); setAuthError("");
    try {
      const response = await fetch("/api/admin-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin, deviceLabel }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      const check = await fetch("/api/admin-auth", { cache: "no-store" }).then((item) => item.json());
      setSessionId(check.sessionId ?? null); setPin(""); setAuthenticated(true);
    } catch (err) { setAuthError(err instanceof Error ? err.message : "認証できませんでした"); }
    finally { setAuthBusy(false); }
  }
  async function logout() { await fetch("/api/admin-auth", { method: "DELETE" }); hydratedRef.current = false; setDashboard(null); setAuthenticated(false); }
  async function action(actionName: string, extra: Record<string, unknown> = {}) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: actionName, ...extra }) });
      const data = await response.json();
      if (response.status === 401) { setAuthenticated(false); setDashboard(null); throw new Error(data.error); }
      if (!response.ok) throw new Error(data.error);
      setDashboard(data); toast.success("保存しました");
    } catch (err) { toast.error(err instanceof Error ? err.message : "操作に失敗しました"); }
    finally { setBusy(false); }
  }

  if (authenticated === null) return <main className="loading-screen"><p>管理者画面を確認中…</p></main>;
  if (!authenticated) return <main className="login-shell"><form className="login-card admin-login" onSubmit={login}><div className="login-icon"><Shield /></div><p className="kicker">上級機能</p><h1>管理者画面</h1><p>受付用PINとは別の、管理者専用8桁PINを入力してください。</p><Input aria-label="端末名" maxLength={40} value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="例：責任者iPad" /><Input aria-label="8桁の管理者PIN" inputMode="numeric" autoComplete="one-time-code" maxLength={8} pattern="[0-9]{8}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))} placeholder="00000000" autoFocus /><Button size="lg" disabled={authBusy || pin.length !== 8}><KeyRound />{authBusy ? "確認中…" : "管理者画面を開く"}</Button>{authError && <p className="login-error" role="alert">{authError}</p>}<Button asChild variant="ghost"><Link href="/">受付画面へ戻る</Link></Button></form></main>;
  if (!dashboard) return <main className="loading-screen"><p>{error || "管理データを読み込み中…"}</p></main>;

  const activeSessions = dashboard.sessions.filter((session) => !session.revoked_at && session.expires_at > dashboard.generatedAt);
  const visibleHours = dashboard.stats.hourly.filter((item) => item.people > 0 || (item.hour >= 8 && item.hour <= 17));
  const maxHourly = Math.max(1, ...visibleHours.map((item) => item.people));

  return <main className="app-shell admin-shell">
    <Toaster position="top-center" richColors />
    <header className="topbar"><div><p className="eyebrow">責任者専用・上級機能</p><h1>管理者コンソール</h1></div><div className="topbar-actions"><Button asChild variant="outline"><Link href="/">受付画面</Link></Button><Button variant="ghost" onClick={logout}><LogOut />終了</Button></div></header>
    {error && <div className="admin-error">自動更新に失敗しました：{error}<Button size="sm" variant="outline" onClick={() => refresh()}><RefreshCw />再試行</Button></div>}
    <section className="number-strip admin-metrics"><AdminMetric label="現在 / 定員" value={`${dashboard.status.currentCount}/${dashboard.status.settings.activeCapacity}`} /><AdminMetric label="累計来場者" value={`${dashboard.status.totalCount}人`} /><AdminMetric label="最大同時人数" value={`${dashboard.status.maxCurrent}人`} /><AdminMetric label="待機" value={`${dashboard.status.waitingCount}組・${dashboard.status.waitingPeople}人`} /></section>

    <Tabs defaultValue="overview" className="workspace">
      <TabsList className="mode-tabs admin-tabs"><TabsTrigger value="overview">概要・統計</TabsTrigger><TabsTrigger value="correct">手動修正</TabsTrigger><TabsTrigger value="social">SNS</TabsTrigger><TabsTrigger value="sessions">端末</TabsTrigger><TabsTrigger value="settings">設定・削除</TabsTrigger></TabsList>

      <TabsContent value="overview" className="admin-grid">
        <section className="control-card span-two"><div className="card-heading"><div><p className="kicker">時間帯別</p><h2>入場者数</h2></div><Button asChild variant="outline"><a href={`/api/admin/export?day=${dashboard.status.dayKey}`}><Download />CSV出力</a></Button></div><div className="hour-chart">{visibleHours.map((item) => <div key={item.hour}><span>{item.people}人</span><i style={{ height: `${Math.max(item.people ? 8 : 1, (item.people / maxHourly) * 120)}px` }} /><small>{item.hour}時</small></div>)}</div></section>
        <StatsCard title="入場の内訳" items={[["入場グループ", `${dashboard.stats.admittedGroups}組`], ["平均グループ人数", `${dashboard.stats.averagePartySize}人`], ["整理券利用", `${dashboard.stats.ticketGroups}組`], ["平均滞在", dashboard.stats.averageDwellMinutes == null ? "未計測" : `${dashboard.stats.averageDwellMinutes}分`]]} />
        <StatsCard title="在校生 / 外部" items={[["在校生", `${dashboard.stats.source.students}人`], ["外部", `${dashboard.stats.source.external}人`]]} />
        <StatsCard title="学年" items={[["中1", `${dashboard.stats.grades.middle1}人`], ["中2", `${dashboard.stats.grades.middle2}人`], ["中3", `${dashboard.stats.grades.middle3}人`], ["高1", `${dashboard.stats.grades.high1}人`], ["高2", `${dashboard.stats.grades.high2}人`]]} />
        <StatsCard title="その他の内訳" items={[["男", `${dashboard.stats.gender.male}人`], ["女", `${dashboard.stats.gender.female}人`], ["大人", `${dashboard.stats.age.adult}人`], ["子供", `${dashboard.stats.age.child}人`]]} />
      </TabsContent>

      <TabsContent value="correct" className="admin-grid">
        <section className="control-card"><p className="kicker">全体状態</p><h2>人数・番号を修正</h2><p className="admin-note">通信切れや押し間違いで表示がずれた場合だけ使います。紙の受け渡し確認中は、その紙番号も同時に修正されます。</p><div className="admin-form-grid"><label>現在人数<Input inputMode="numeric" value={correction.currentCount} onChange={(event) => setCorrection({ ...correction, currentCount: event.target.value })} /></label><label>累計人数<Input inputMode="numeric" value={correction.totalCount} onChange={(event) => setCorrection({ ...correction, totalCount: event.target.value })} /></label><label>次に発行する番号<Input inputMode="numeric" value={correction.nextTicket} onChange={(event) => setCorrection({ ...correction, nextTicket: event.target.value })} /></label><label>現在案内中（空欄可）<Input inputMode="numeric" value={correction.calledNumber} onChange={(event) => setCorrection({ ...correction, calledNumber: event.target.value })} /></label></div><Button size="lg" disabled={busy} onClick={() => action("CORRECT_STATE", { currentCount: Number(correction.currentCount), totalCount: Number(correction.totalCount), nextTicket: Number(correction.nextTicket), calledNumber: correction.calledNumber ? Number(correction.calledNumber) : null })}><Save />状態を保存</Button></section>
        <section className="control-card"><p className="kicker">整理券・グループ</p><h2>個別に状態を修正</h2><div className="admin-group-list">{dashboard.groups.slice(0, 40).map((group) => <div key={group.id}><div><strong>{group.ticket_number ? `${group.ticket_number}番` : `直接 #${group.id}`}</strong><span>{group.party_size}人・{timeLabel(group.created_at)}</span></div>{group.status === "issuing" ? <em className="admin-pending-ticket">紙受け渡し未確認</em> : <select aria-label={`${group.id}の状態`} value={group.status} disabled={busy} onChange={(event) => action("SET_GROUP_STATUS", { groupId: group.id, status: event.target.value })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}</div>)}</div></section>
      </TabsContent>

      <TabsContent value="social" className="admin-grid">
        <section className="control-card span-two"><div className="card-heading"><div><p className="kicker">利用者向け整理券ページ</p><h2>複数のSNS・活動リンク</h2></div><Button variant="outline" disabled={links.length >= 8} onClick={() => setLinks([...links, { label: "", url: "", enabled: true }])}><Plus />リンク追加</Button></div><p className="admin-note">登録順に表示します。URLが未確定なら、空の項目は削除して後から追加できます。</p><div className="social-editor">{links.length === 0 && <p className="empty">リンクはまだありません</p>}{links.map((link, index) => <div key={link.id ?? `new-${index}`}><Switch aria-label={`${index + 1}件目を表示`} checked={link.enabled} onCheckedChange={(enabled) => setLinks(links.map((item, itemIndex) => itemIndex === index ? { ...item, enabled } : item))} /><Input aria-label={`${index + 1}件目の名前`} value={link.label} onChange={(event) => setLinks(links.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item))} placeholder="例：Instagram" /><Input aria-label={`${index + 1}件目のURL`} inputMode="url" value={link.url} onChange={(event) => setLinks(links.map((item, itemIndex) => itemIndex === index ? { ...item, url: event.target.value } : item))} placeholder="https://…" /><Button variant="ghost" size="icon" aria-label="削除" onClick={() => setLinks(links.filter((_, itemIndex) => itemIndex !== index))}><X /></Button></div>)}</div><Button size="lg" disabled={busy} onClick={() => action("SAVE_SOCIALS", { links })}><Link2 />利用者ページへ反映</Button></section>
      </TabsContent>

      <TabsContent value="sessions" className="admin-grid">
        <section className="control-card span-two"><div className="card-heading"><div><p className="kicker">共有PINを教えても安全に止められる</p><h2>ログイン中の端末</h2></div><Button variant="destructive" disabled={busy || !activeSessions.some((item) => item.role === "staff")} onClick={() => action("REVOKE_ALL_STAFF")}><LogOut />受付端末をすべてログアウト</Button></div><div className="session-list">{activeSessions.map((session) => <div key={session.id}><MonitorSmartphone /><div><strong>{session.device_label || "名前なし端末"}</strong><span>{session.role === "admin" ? "管理者" : "受付"}・最終確認 {timeLabel(session.last_seen_at)}</span></div>{session.id === sessionId ? <em>この端末</em> : <Button variant="outline" disabled={busy} onClick={() => action("REVOKE_SESSION", { sessionId: session.id })}>ログアウト</Button>}</div>)}</div><p className="admin-note">ログアウトされた端末は、次の自動更新時にPIN入力画面へ戻ります。PINそのものは変わりません。</p></section>
      </TabsContent>

      <TabsContent value="settings" className="admin-grid">
        <section className="control-card settings-card"><p className="kicker">案内順・待ち時間計算</p><h2>定員と基準時間</h2><label>通常定員<Input inputMode="numeric" value={settings.normalCapacity} onChange={(event) => setSettings({ ...settings, normalCapacity: event.target.value })} /></label><label>状況により入れられる最大人数<Input inputMode="numeric" value={settings.overflowCapacity} onChange={(event) => setSettings({ ...settings, overflowCapacity: event.target.value })} /></label><label>平均滞在時間 T（分）<Input inputMode="decimal" value={settings.priorStayMinutes} onChange={(event) => setSettings({ ...settings, priorStayMinutes: event.target.value })} /></label><label>空き確保を始める待ち時間（分）<Input inputMode="decimal" value={settings.reserveWaitMinutes} onChange={(event) => setSettings({ ...settings, reserveWaitMinutes: event.target.value })} /><small>初期値は 2T = 5分。必要に応じて個別に変更できます。</small></label><div className="overflow-toggle"><div><strong>最大人数を使用</strong><span>現在の定員・案内判定・待ち予測に反映</span></div><Switch checked={settings.overflowEnabled} onCheckedChange={(overflowEnabled) => setSettings({ ...settings, overflowEnabled })} /></div><Button size="lg" disabled={busy} onClick={() => action("SETTINGS", { normalCapacity: Number(settings.normalCapacity), overflowCapacity: Number(settings.overflowCapacity), overflowEnabled: settings.overflowEnabled, priorStayMinutes: Number(settings.priorStayMinutes), reserveWaitMinutes: Number(settings.reserveWaitMinutes) })}><Settings />設定を保存</Button></section>
        <section className="control-card guidance-debug"><p className="kicker">計算確認</p><h2>現在の案内判定</h2><div className="guidance-debug-summary"><span>空き</span><strong>{dashboard.status.guidance.freeSeats}人</strong><span>基準 T</span><strong>{dashboard.status.settings.priorStayMinutes}分</strong><span>空き確保</span><strong>{dashboard.status.settings.reserveWaitMinutes}分から</strong></div>{dashboard.status.guidance.target ? <p className="guidance-debug-result"><strong>{dashboard.status.guidance.target.ticketNumber}番</strong>・{dashboard.status.guidance.target.partySize}人・待ち{formatAdminWait(dashboard.status.guidance.target.waitMinutes)}・P={dashboard.status.guidance.target.priority}</p> : <p className="empty">現在の推奨対象はありません</p>}<details><summary>待機グループの優先度</summary><div className="priority-list">{dashboard.status.guidance.scores.map((group) => <div key={group.ticketNumber}><strong>{group.ticketNumber}番</strong><span>{group.partySize}人</span><span>待ち{formatAdminWait(group.waitMinutes)}</span><span>P={group.priority}</span><em>{group.eligibleNow ? "案内可" : "空き不足"}</em></div>)}</div></details>{dashboard.status.guidance.oversizedCount > 0 && <p className="admin-note">定員を超えるグループが{dashboard.status.guidance.oversizedCount}組あります。自動案内の対象外です。</p>}</section>
        <section className="control-card"><p className="kicker">操作履歴</p><h2>直近100件</h2><Button variant="outline" disabled={busy || !dashboard.events.some((item) => !item.undone)} onClick={() => action("UNDO_LAST")}><RotateCcw />最後の操作を取り消す</Button><div className="admin-event-list">{dashboard.events.map((event) => <div key={event.id} className={event.undone ? "undone" : ""}><span>{eventLabels[event.type] ?? event.type}{event.ticket_number ? `・${event.ticket_number}番` : ""}</span><time>{timeLabel(event.created_at)}</time></div>)}</div></section>
        <section className="danger-card span-two"><div><p className="kicker">開発・動作確認用</p><h2>本日の受付データを削除</h2><p>人数、グループ、整理券、履歴を削除し、番号を1番へ戻します。SNS・設定・ログイン端末は残ります。</p></div><AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" size="lg" disabled={busy}><Trash2 />本日のデータを削除</Button></AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>本日のデータを削除しますか？</AlertDialogTitle><AlertDialogDescription>この操作は取り消せません。CSVが必要なら先に出力してください。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>やめる</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => action("RESET_DAY")}><Trash2 />削除する</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></section>
      </TabsContent>
    </Tabs>
    <footer><span>{dashboard.status.dayKey}</span><span>管理者データは5秒ごとに自動更新</span></footer>
  </main>;
}

function AdminMetric({ label, value }: { label: string; value: string }) { return <div className="metric"><span>{label}</span><strong>{value}</strong></div>; }
function StatsCard({ title, items }: { title: string; items: [string, string][] }) { return <section className="control-card stats-card"><p className="kicker">集計</p><h2>{title}</h2><div>{items.map(([label, value]) => <p key={label}><span>{label}</span><strong>{value}</strong></p>)}</div></section>; }
function timeLabel(timestamp: number) { return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp); }
function formatAdminWait(minutes: number) { return minutes < 1 ? "1分未満" : `${Math.floor(minutes)}分`; }

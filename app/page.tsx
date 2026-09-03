"use client";

import { lazy, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Check, DoorOpen, KeyRound, ListRestart, LogOut, Minus, Plus, QrCode, RotateCcw, Shield, Ticket, UserCheck, X } from "lucide-react";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { calculateQueueGuidance } from "@/lib/queue-guidance";

const QRCodeSVG = lazy(() => import("qrcode.react").then((module) => ({ default: module.QRCodeSVG })));

type Group = {
  id: number; ticket_number: number | null; party_size: number; status: string;
  created_at: number; admitted_at: number | null; estimatedMinutes?: number | null;
};
type GuidanceTarget = {
  id: number; ticketNumber: number; partySize: number; createdAt: number;
  waitMinutes: number; priority: number; eligibleNow: boolean;
};
type Status = {
  dayKey: string; currentCount: number; totalCount: number; maxCurrent: number;
  nextTicketNumber: number; waitingCount: number; waitingPeople: number;
  waiting: Group[]; pendingHandoff: Group | null; called: Group | null; inside: Group[];
  settings: { normalCapacity: number; overflowCapacity: number; overflowEnabled: boolean; activeCapacity: number; priorStayMinutes: number; reserveWaitMinutes: number };
  estimate: { predictedStayMinutes: number; actualMeanMinutes: number | null; actualSampleCount: number; actualWeight: number; peoplePerMinute: number };
  guidance: { mode: "recommended" | "reserve-ready" | "reserving" | "no-fit" | "empty"; freeSeats: number; reserveWaitMinutes: number; target: GuidanceTarget | null; seatsNeeded: number; oversizedCount: number; scores: GuidanceTarget[] };
  recent: { id: number | string; label: string; created_at: number }[]; revision: number; updatedAt: number;
};
type ActionPatch = {
  revision: number; updatedAt: number; currentCount: number; totalCount: number; maxCurrent: number;
  addedInside?: Group; removedInsideIds?: number[];
  recent?: { id: number | string; label: string; created_at: number };
};
type SourcePreset = "unknown" | "mixed";
type SourceCounts = {
  studentCount: number | null; externalCount: number | null;
  middleGrade1Count: number | null; middleGrade2Count: number | null; middleGrade3Count: number | null;
  highGrade1Count: number | null; highGrade2Count: number | null; highGrade3Count: number | null;
};

export default function ReceptionPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const busyRef = useRef(false);
  const statusRef = useRef<Status | null>(null);
  const refreshInFlightRef = useRef(false);
  const mutationEpochRef = useRef(0);
  const [error, setError] = useState("");
  const [partySize, setPartySize] = useState(2);
  const [sourcePreset, setSourcePreset] = useState<SourcePreset>("unknown");
  const [studentCount, setStudentCount] = useState(0);
  const [grades, setGrades] = useState({ m1: 0, m2: 0, m3: 0, h1: 0, h2: 0 });
  const [maleCount, setMaleCount] = useState<number | null>(null);
  const [adultCount, setAdultCount] = useState<number | null>(null);
  const [callDialogOpen, setCallDialogOpen] = useState(false);
  const [selectedExitIds, setSelectedExitIds] = useState<number[]>([]);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [pin, setPin] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("入口iPad");
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState("");

  const commitStatus = useCallback((next: Status | null) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (busyRef.current || refreshInFlightRef.current || (quiet && document.visibilityState === "hidden")) return;
    refreshInFlightRef.current = true;
    const epoch = mutationEpochRef.current;
    try {
      const since = quiet ? statusRef.current?.revision : undefined;
      const response = await fetch(since == null ? "/api/status" : `/api/status?since=${since}`, { cache: "no-store" });
      if (response.status === 401) { setAuthenticated(false); commitStatus(null); return; }
      if (response.status === 204) { setAuthenticated(true); setError(""); return; }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const current = statusRef.current;
      if (epoch === mutationEpochRef.current && (!current || data.revision >= current.revision)) commitStatus(data);
      setAuthenticated(true); setError("");
    } catch (err) { setError(err instanceof Error ? err.message : "更新できませんでした"); }
    finally { refreshInFlightRef.current = false; }
  }, [commitStatus]);

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    if (!authenticated) return;
    const timer = window.setInterval(() => refresh(true), 2000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(true); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [authenticated, refresh]);
  function resize(next: number) {
    const value = Math.max(1, Math.min(30, next));
    const nextStudentCount = Math.min(studentCount, value);
    setPartySize(value);
    setStudentCount(nextStudentCount);
    setGrades((old) => {
      let remaining = nextStudentCount;
      return Object.fromEntries(Object.entries(old).map(([key, count]) => {
        const kept = Math.min(count, remaining);
        remaining -= kept;
        return [key, kept];
      })) as typeof old;
    });
    setMaleCount((old) => old == null ? null : Math.min(old, value));
    setAdultCount((old) => old == null ? null : Math.min(old, value));
  }

  function selectSourcePreset(next: SourcePreset) {
    setSourcePreset(next);
    if (next === "mixed") {
      setMaleCount((current) => current ?? Math.round(partySize / 2));
      setAdultCount((current) => current ?? Math.round(partySize / 2));
    }
  }

  function changeStudentCount(next: number) {
    const value = Math.max(0, Math.min(partySize, next));
    setStudentCount(value);
    setGrades((old) => {
      let remaining = value;
      return Object.fromEntries(Object.entries(old).map(([key, count]) => {
        const kept = Math.min(count, remaining);
        remaining -= kept;
        return [key, kept];
      })) as typeof old;
    });
  }

  const groupPayload = useMemo(() => {
    const unknown: SourceCounts = { studentCount: null, externalCount: null, middleGrade1Count: null, middleGrade2Count: null, middleGrade3Count: null, highGrade1Count: null, highGrade2Count: null, highGrade3Count: null };
    let source: SourceCounts;
    if (sourcePreset === "unknown") source = unknown;
    else source = {
      studentCount, externalCount: partySize - studentCount,
      middleGrade1Count: grades.m1, middleGrade2Count: grades.m2, middleGrade3Count: grades.m3,
      highGrade1Count: grades.h1, highGrade2Count: grades.h2, highGrade3Count: 0,
    };
    return {
      partySize, ...source,
      maleCount: sourcePreset === "mixed" ? maleCount : null,
      femaleCount: sourcePreset === "mixed" && maleCount != null ? partySize - maleCount : null,
      adultCount: sourcePreset === "mixed" ? adultCount : null,
      childCount: sourcePreset === "mixed" && adultCount != null ? partySize - adultCount : null,
    };
  }, [partySize, sourcePreset, studentCount, grades, maleCount, adultCount]);
  const gradeTotal = Object.values(grades).reduce((sum, value) => sum + value, 0);
  const unassignedGradeCount = Math.max(0, studentCount - gradeTotal);
  const mixedInvalid = sourcePreset === "mixed" && gradeTotal > studentCount;

  async function act(action: string, extra: Record<string, unknown> = {}, optimistic?: (current: Status) => Status) {
    if (busyRef.current) return false;
    busyRef.current = true;
    mutationEpochRef.current += 1;
    const snapshot = statusRef.current;
    setBusy(true); setBusyAction(action); setError("");
    if (snapshot && optimistic) commitStatus(optimistic(snapshot));
    try {
      const response = await fetch("/api/actions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, requestId: crypto.randomUUID(), ...extra }) });
      const data = await response.json();
      if (response.status === 401) { setAuthenticated(false); commitStatus(null); throw new Error(data.error); }
      if (!response.ok) throw new Error(data.error);
      if (data.status) commitStatus(data.status);
      else if (data.patch && statusRef.current) commitStatus(applyServerPatch(statusRef.current, data.patch));
      else throw new Error("保存結果を確認できませんでした");
      if (data.issuedTicket) {
        toast.success(`紙整理券 ${data.issuedTicket}番を準備`, { description: "実物を渡してから「紙を渡した」を押してください", action: { label: "取り消す", onClick: () => void cancelIssuedTicket(data.issuedTicket) } });
      } else if (action === "REGISTER_DIRECT") toast.success(`${partySize}人グループを入場登録しました`, { action: { label: "取り消す", onClick: () => void act("UNDO_LAST") } });
      if (action === "RESET_DAY") toast.success("本日の試験データを削除しました");
      if (action === "CALL_NEXT" || action === "CALL_NUMBER") toast.success(`${data.status.called?.number ?? data.status.called?.ticket_number}番を案内中にしました`);
      return true;
    } catch (err) {
      if (snapshot) commitStatus(snapshot);
      toast.error(err instanceof Error ? `${err.message}（表示は元に戻しました）` : "操作に失敗しました（表示は元に戻しました）");
      return false;
    }
    finally { busyRef.current = false; setBusy(false); setBusyAction(null); }
  }

  async function register(action: "REGISTER_DIRECT" | "QUEUE_CREATE_GROUP") {
    if (mixedInvalid) { toast.error("学年人数が在校生人数を超えています"); return; }
    if (action === "REGISTER_DIRECT") {
      const optimisticId = -Date.now();
      await act(action, groupPayload, (current) => updateLocalStatus(current, {
        currentCount: current.currentCount + partySize,
        totalCount: current.totalCount + partySize,
        maxCurrent: Math.max(current.maxCurrent, current.currentCount + partySize),
        inside: [...current.inside, { id: optimisticId, ticket_number: null, party_size: partySize, status: "inside", created_at: Date.now(), admitted_at: Date.now() }],
      }));
    } else await act(action, groupPayload);
  }
  async function callNumber(ticketNumber: number) {
    if (await act("CALL_NUMBER", { ticketNumber })) setCallDialogOpen(false);
  }
  async function cancelIssuedTicket(ticketNumber: number) {
    if (await act("CANCEL", { ticketNumber })) {
      toast.success(`${ticketNumber}番を取り消しました`);
    }
  }
  async function confirmTicketHandoff(ticketNumber: number) {
    if (await act("CONFIRM_TICKET_HANDOFF", { ticketNumber })) toast.success(`${ticketNumber}番の紙受け渡しを確認しました`);
  }
  async function exitGroup(group: Group) {
    if (await act("EXIT_GROUP", { groupId: group.id }, (current) => updateLocalStatus(current, {
      currentCount: Math.max(0, current.currentCount - group.party_size),
      inside: current.inside.filter((item) => item.id !== group.id),
    }))) {
      toast.success(`${group.ticket_number ? `整理券 ${group.ticket_number}番` : "直接入場"}・${group.party_size}人を退場登録`, { action: { label: "取り消す", onClick: () => void act("UNDO_LAST") } });
    }
  }
  async function exitSelectedGroups() {
    if (!status) return;
    const selected = status.inside.filter((group) => selectedExitIds.includes(group.id));
    if (!selected.length) return;
    const people = selected.reduce((sum, group) => sum + group.party_size, 0);
    if (await act("EXIT_GROUPS", { groupIds: selected.map((group) => group.id) }, (current) => updateLocalStatus(current, {
      currentCount: Math.max(0, current.currentCount - people),
      inside: current.inside.filter((group) => !selectedExitIds.includes(group.id)),
    }))) {
      setSelectedExitIds([]);
      toast.success(`${selected.length}組・${people}人をまとめて退場登録`, { action: { label: "取り消す", onClick: () => void act("UNDO_LAST") } });
    }
  }
  function toggleExitSelection(groupId: number) {
    setSelectedExitIds((current) => current.includes(groupId) ? current.filter((id) => id !== groupId) : [...current, groupId]);
  }
  async function login(event: FormEvent) {
    event.preventDefault(); setAuthBusy(true); setAuthError("");
    try {
      const response = await fetch("/api/staff-auth", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin, deviceLabel }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setPin(""); setAuthenticated(true); await refresh();
    } catch (err) { setAuthError(err instanceof Error ? err.message : "認証できませんでした"); }
    finally { setAuthBusy(false); }
  }
  async function logout() { await fetch("/api/staff-auth", { method: "DELETE" }); commitStatus(null); setAuthenticated(false); }

  if (authenticated === null) return <main className="loading-screen"><p>スタッフ画面を確認中…</p></main>;
  if (!authenticated) return <main className="login-shell"><form className="login-card" onSubmit={login}><div className="login-icon"><KeyRound /></div><p className="kicker">スタッフ専用</p><h1>受付画面を開く</h1><p>担当者に共有された6桁の暗証番号を入力してください。</p><Input aria-label="端末名" maxLength={40} value={deviceLabel} onChange={(event) => setDeviceLabel(event.target.value)} placeholder="例：入口iPad" /><Input aria-label="6桁の暗証番号" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" autoFocus /><Button size="lg" disabled={authBusy || pin.length !== 6}><KeyRound />{authBusy ? "確認中…" : "受付画面を開く"}</Button>{authError && <p className="login-error" role="alert">{authError}</p>}<p className="login-note">端末名は管理者画面から個別にログアウトするときに使います。</p></form></main>;
  if (!status) return <main className="loading-screen"><p>{error || "受付データを読み込み中…"}</p></main>;
  const pageOrigin = typeof window === "undefined" ? "" : location.origin;
  const pendingTicket = status.pendingHandoff?.ticket_number ?? null;
  const ticketHandoffPending = pendingTicket != null;
  const qrUrl = pendingTicket == null ? "" : `${pageOrigin}/wait?day=${status.dayKey}&ticket=${pendingTicket}`;
  const calledReservedSeats = status.called?.party_size ?? 0;
  const walkInFreeSeats = Math.max(0, status.settings.activeCapacity - status.currentCount - calledReservedSeats);
  const overCapacity = partySize > walkInFreeSeats;
  const queueActive = status.waiting.length > 0 || status.called != null;
  const reserving = status.guidance.mode === "reserving" && status.guidance.target != null;
  const recommended = status.guidance.target;
  const selectedExitGroups = status.inside.filter((group) => selectedExitIds.includes(group.id));
  const selectedExitPeople = selectedExitGroups.reduce((sum, group) => sum + group.party_size, 0);

  return <main className="app-shell">
    <Toaster position="top-center" richColors />
    <header className="topbar reception-topbar"><div><p className="eyebrow">文化祭・グループ受付</p><h1>受付</h1></div><div className="topbar-actions"><div className={`sync-badge ${error ? "offline" : busyAction ? "processing" : ""}`}><span />{error ? "再接続中" : busyAction ? processingLabel(busyAction) : "同期済み"}</div><Button asChild variant="outline" size="sm"><a href="/admin"><Shield />管理</a></Button><Button variant="ghost" size="sm" onClick={logout}>終了</Button></div></header>
    <section className={`number-strip reception-metrics ${queueActive ? "queue-active" : ""}`}>
      <Metric label={`現在人数 / 定員${status.settings.overflowEnabled ? "（最大）" : ""}`} value={`${status.currentCount}/${status.settings.activeCapacity}`} unit="人" emphasis />
      <Metric label="本日の累計" value={status.totalCount} unit="人" />
      {queueActive && <Metric label="待機" value={`${status.waitingCount}組`} unit={`${status.waitingPeople}人`} warm />}
      {queueActive && <Metric label="案内中" value={status.called?.ticket_number ?? "—"} unit={status.called ? `番・${status.called.party_size}人` : ""} />}
    </section>

    {pendingTicket != null && <section className="paper-ticket-alert"><div className="paper-ticket-number"><span>受け渡し未確認・整理券操作を停止中</span><p>次に渡す紙</p><strong>{pendingTicket}<small>番</small></strong><p className="paper-ticket-instruction">実物の番号を確認して渡してください</p></div><div className="paper-ticket-actions"><Button className="handoff-confirm-button" disabled={busy} onClick={() => confirmTicketHandoff(pendingTicket)}><UserCheck />{busyAction === "CONFIRM_TICKET_HANDOFF" ? "確認中…" : "紙を渡した"}</Button><div className="paper-secondary-actions"><Dialog><DialogTrigger asChild><Button variant="outline"><QrCode />QRを表示</Button></DialogTrigger><DialogContent className="qr-dialog"><DialogHeader><DialogTitle>整理券 {pendingTicket}番</DialogTitle><DialogDescription>スマホを使える来場者向けの補助表示です。</DialogDescription></DialogHeader><div className="qr-code"><Suspense fallback={<span>QRを準備中…</span>}><QRCodeSVG value={qrUrl} size={260} level="M" marginSize={2} /></Suspense></div><Button asChild><a href={qrUrl} target="_blank" rel="noreferrer">利用者画面を開く</a></Button></DialogContent></Dialog><Button variant="destructive" disabled={busy} onClick={() => cancelIssuedTicket(pendingTicket)}><RotateCcw />{busyAction === "CANCEL" ? "取消中…" : "発行を取り消す"}</Button><Button asChild variant="outline"><a href="/admin"><Shield />番号を修正</a></Button></div><p>この確認が終わるまで、次の発券・呼び出し・入場確認はできません。</p></div></section>}

    <Tabs defaultValue="entrance" className="workspace">
      <TabsList className="mode-tabs"><TabsTrigger value="entrance">入口受付</TabsTrigger><TabsTrigger value="inside">退場・記録</TabsTrigger></TabsList>
      <TabsContent value="entrance" className={`panel-grid reception-panel ${queueActive ? "queue-mode" : "normal-mode"}`}>
        <section className="control-card span-two fast-entry-card">
          <div className="compact-heading"><h2>グループ人数</h2><span>選択中：{partySize}人</span></div>
          <div className="party-size-row">{[1,2,3,4].map((number) => <button key={number} className={partySize === number ? "selected" : ""} onClick={() => resize(number)}><strong>{number}</strong><span>人</span></button>)}<button className={partySize >= 5 ? "selected more-button" : "more-button"} onClick={() => resize(Math.max(5, partySize))}><strong>5</strong><span>人以上</span></button></div>
          {partySize >= 5 && <div className="party-adjust"><span>人数を調整</span><button className="step-button" onClick={() => resize(partySize - 1)} aria-label="1人減らす"><Minus /></button><div className="party-readout"><strong>{partySize}</strong><span>人</span></div><button className="step-button" onClick={() => resize(partySize + 1)} aria-label="1人増やす"><Plus /></button></div>}
          <div className="quick-source"><p><strong>内訳</strong></p><div>{([['unknown','内訳なし'],['mixed','詳細入力']] as [SourcePreset,string][]).map(([value,label]) => <button key={value} className={sourcePreset === value ? "selected" : ""} onClick={() => selectSourcePreset(value)}>{label}</button>)}</div></div>
          {sourcePreset === "mixed" && <div className="demographic-details"><div className="detail-grid">
            <section><SplitSlider title="在校生 / 外部" lead="在校生" follow="外部" total={partySize} value={studentCount} onChange={changeStudentCount} />{studentCount > 0 && <div className="grade-block"><h4>在校生の学年</h4><div className="grade-grid">{([['m1','中1'],['m2','中2'],['m3','中3'],['h1','高1'],['h2','高2']] as [keyof typeof grades,string][]).map(([key,label]) => <CountEditor key={key} label={label} value={grades[key]} max={grades[key] + Math.max(0, studentCount - gradeTotal)} onChange={(value) => setGrades({ ...grades, [key]: value })} />)}</div>{unassignedGradeCount > 0 && <p className="validation-hint">学年未入力 {unassignedGradeCount}人（このまま登録できます）</p>}{mixedInvalid && <p className="validation-error">学年人数が在校生 {studentCount}人を超えています</p>}</div>}</section>
            <SplitSlider title="男女" lead="男" follow="女" total={partySize} value={maleCount ?? Math.round(partySize / 2)} onChange={setMaleCount} />
            <SplitSlider title="大人 / 子供" lead="大人" follow="子供" total={partySize} value={adultCount ?? Math.round(partySize / 2)} onChange={setAdultCount} />
          </div></div>}
          {overCapacity && <p className="capacity-warning">直接入場できる空きは現在 {walkInFreeSeats}人です。{calledReservedSeats > 0 ? `案内中グループ ${calledReservedSeats}人分の席を確保しています。` : `定員は ${status.settings.activeCapacity}人です。`}</p>}
          {reserving && recommended && <p className="reserve-entry-lock">{recommended.ticketNumber}番のため空きを確保中です。直接入場も一時停止します。</p>}
          <div className={`register-actions ${queueActive ? "queue-active" : ""}`}><Button className="action-button enter-button" disabled={busy || mixedInvalid || reserving || overCapacity} onClick={() => register("REGISTER_DIRECT")}><DoorOpen /><span>{busyAction === "REGISTER_DIRECT" ? "登録中…" : reserving ? <><small>空き確保中</small>直接入場を一時停止</> : overCapacity ? <><small>空き {walkInFreeSeats}人</small>この人数では直接入場不可</> : `${partySize}人を入場登録`}</span></Button><div className={`ticket-action-zone ${ticketHandoffPending ? "handoff-pending" : ""}`}><span>{ticketHandoffPending ? `${pendingTicket}番の確認待ち` : queueActive ? "整理券運用中" : "混雑時のみ"}</span><Button className="action-button ticket-button" disabled={busy || mixedInvalid || ticketHandoffPending} onClick={() => register("QUEUE_CREATE_GROUP")}><Ticket /><span>{busyAction === "QUEUE_CREATE_GROUP" ? "発行中…" : ticketHandoffPending ? <><small>先に紙の受け渡しを確認</small>{pendingTicket}番を確認待ち</> : <><small>次に渡す紙</small>{status.nextTicketNumber}番を発行</>}</span></Button></div></div>
        </section>

        {!queueActive ? <section className="queue-empty-bar span-two"><Ticket /><strong>整理券：待機なし</strong><span>次に渡す紙は {status.nextTicketNumber}番</span></section> : <>
          <section className={`control-card call-card span-two ${reserving ? "reserving" : ""}`}><div className="queue-guidance"><div className="guidance-capacity"><span>現在</span><strong>{status.currentCount}<small>/ {status.settings.activeCapacity}人</small></strong><span>空き {status.guidance.freeSeats}人</span></div>{status.called ? <div className="guidance-result called"><span>現在案内中</span><strong>{status.called.ticket_number}<small>番</small></strong><p>{status.called.party_size}人グループ</p></div> : reserving && recommended ? <div className="guidance-result reserve"><span>空き確保中</span><strong>{recommended.ticketNumber}<small>番・{recommended.partySize}人</small></strong><p>待ち {formatWait(recommended.waitMinutes)}分</p><em>あと{status.guidance.seatsNeeded}人退場で案内可能</em></div> : recommended ? <div className="guidance-result recommended"><span>{status.guidance.mode === "reserve-ready" ? "空き確保対象を案内" : "推奨案内"}</span><strong>{recommended.ticketNumber}<small>番・{recommended.partySize}人</small></strong><p>待ち {formatWait(recommended.waitMinutes)}分</p></div> : <div className="guidance-result unavailable"><span>推奨案内</span><strong>—</strong><p>{status.guidance.oversizedCount > 0 ? "定員超過のグループは手動対応" : "現在の空きに入れるグループなし"}</p></div>}</div><div className="call-control">{ticketHandoffPending && <p className="call-lock-message">{pendingTicket}番の紙受け渡しを先に確認してください</p>}<div className="call-actions"><Button className="action-button call-button" disabled={busy || ticketHandoffPending || !!status.called || reserving || !recommended} onClick={() => act("CALL_NEXT")}><UserCheck />{busyAction === "CALL_NEXT" || busyAction === "CALL_NUMBER" ? "呼出中…" : status.called ? `${status.called.ticket_number}番を案内中` : reserving && recommended ? `${recommended.ticketNumber}番の空きを確保中` : recommended ? `${recommended.ticketNumber}番を呼ぶ` : "案内可能な組なし"}</Button><Button className="action-button admit-button" disabled={busy || ticketHandoffPending || !status.called} onClick={() => act("ADMIT_CALLED")}><DoorOpen />{busyAction === "ADMIT_CALLED" ? "入場処理中…" : status.called ? `${status.called.ticket_number}番の入場を確認` : "入場確認"}</Button></div><Dialog open={callDialogOpen} onOpenChange={setCallDialogOpen}><DialogTrigger asChild><Button className="exception-call-button" variant="ghost" disabled={busy || ticketHandoffPending || !status.waiting.length}><ListRestart />番号を選んで呼ぶ（例外操作）</Button></DialogTrigger><DialogContent className="call-dialog"><DialogHeader><DialogTitle>案内する番号を選択</DialogTitle><DialogDescription>{reserving && recommended ? `${recommended.ticketNumber}番のため空き確保中です。別番号を呼ぶ場合だけ選択してください。` : status.called ? `現在の${status.called.ticket_number}番は待機列へ戻ります。` : "待機中のグループを選んでください。"}</DialogDescription></DialogHeader><div className="number-picker">{status.waiting.map((item) => <Button key={item.id} variant="outline" disabled={busy} onClick={() => callNumber(item.ticket_number!)}><strong>{item.ticket_number}</strong><span>{busyAction === "CALL_NUMBER" ? "呼出中…" : `${item.party_size}人・約${item.estimatedMinutes ?? "—"}分`}</span></Button>)}</div></DialogContent></Dialog></div></section>
          {status.waiting.length > 0 && <section className="control-card span-two waiting-card"><div className="compact-heading"><h2>待機中の整理券</h2><span>{status.waitingCount}組・{status.waitingPeople}人</span></div><div className="ticket-list">{status.waiting.map((item) => <div className="ticket-row" key={item.id}><strong>{item.ticket_number}番</strong><span>{item.party_size}人・推定 約{item.estimatedMinutes ?? "—"}分</span><div className="ticket-actions"><Dialog><DialogTrigger asChild><Button variant="outline" size="sm"><QrCode />QR</Button></DialogTrigger><DialogContent className="qr-dialog"><DialogHeader><DialogTitle>整理券 {item.ticket_number}番</DialogTitle><DialogDescription>スマホを使える来場者向けの補助表示です。</DialogDescription></DialogHeader><div className="qr-code"><Suspense fallback={<span>QRを準備中…</span>}><QRCodeSVG value={`${pageOrigin}/wait?day=${status.dayKey}&ticket=${item.ticket_number}`} size={260} level="M" marginSize={2} /></Suspense></div></DialogContent></Dialog><Button variant="ghost" size="sm" disabled={busy || ticketHandoffPending} onClick={() => act("CANCEL", { ticketNumber: item.ticket_number })}><X />{busyAction === "CANCEL" ? "取消中…" : "取消"}</Button></div></div>)}</div></section>}
        </>}
      </TabsContent>

      <TabsContent value="inside" className="panel-grid">
        <section className="control-card span-two inside-card"><div className="card-heading"><div><p className="kicker">内部スタッフ用</p><h2>入場中のグループ</h2></div><LogOut /></div>{!status.inside.length ? <p className="empty">入場中のグループはありません</p> : <><div className="inside-selection-guide">カード左側をタップすると複数選択できます</div>{selectedExitGroups.length > 0 && <div className="bulk-exit-bar"><div><span>選択中</span><strong>{selectedExitGroups.length}組 / {selectedExitPeople}人</strong></div><Button variant="outline" disabled={busy} onClick={() => setSelectedExitIds([])}>選択解除</Button><AlertDialog><AlertDialogTrigger asChild><Button variant="destructive" disabled={busy}><LogOut />{busyAction === "EXIT_GROUPS" ? "処理中…" : "まとめて退場"}</Button></AlertDialogTrigger><AlertDialogContent className="bulk-exit-dialog"><AlertDialogHeader><AlertDialogTitle>{selectedExitGroups.length}組・{selectedExitPeople}人を退場にしますか？</AlertDialogTitle><AlertDialogDescription>選択したグループをまとめて退場処理します。処理直後は「取り消す」でまとめて元に戻せます。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>戻る</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={busy} onClick={() => void exitSelectedGroups()}>{busyAction === "EXIT_GROUPS" ? "退場処理中…" : "まとめて退場する"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></div>}<div className="inside-grid">{status.inside.map((group) => { const selected = selectedExitIds.includes(group.id); return <div className={`inside-group ${selected ? "selected" : ""}`} key={group.id}><button type="button" className="inside-group-select" aria-pressed={selected} onClick={() => toggleExitSelection(group.id)}><span className="selection-box" aria-hidden="true">{selected && <Check />}</span><span className="inside-group-copy"><span className="inside-group-identity">{group.ticket_number ? `整理券 ${group.ticket_number}番` : "直接入場"}</span><strong>{group.party_size}<small>人</small></strong><span className="inside-group-time">{group.admitted_at ? `${timeLabel(group.admitted_at)} 入場・${elapsedLabel(group.admitted_at)}` : ""}</span></span></button><Button className="exit-group-button" disabled={busy} onClick={() => void exitGroup(group)}><LogOut />{busyAction === "EXIT_GROUP" ? "退場処理中…" : "この組が退場"}</Button></div>})}</div></>}</section>
        <section className="control-card"><p className="kicker">本日の最大</p><p className="big-readout">{status.maxCurrent}<span>人</span></p></section>
        <section className="control-card"><p className="kicker">予測滞在時間</p><p className="big-readout">{status.estimate.predictedStayMinutes}<span>分</span></p><p className="hint">実測 {status.estimate.actualSampleCount}組・回転 約{status.estimate.peoplePerMinute}人/分</p></section>
        <section className="control-card span-two"><div className="card-heading"><div><p className="kicker">直近の操作</p><h2>操作履歴</h2></div><Button variant="outline" disabled={busy || !status.recent.length} onClick={() => act("UNDO_LAST")}><RotateCcw />最後を取り消す</Button></div><div className="history-list">{status.recent.map((item) => <div key={item.id}><span>{item.label}</span><time>{timeLabel(item.created_at)}</time></div>)}</div></section>
      </TabsContent>

    </Tabs>
    <footer><span>{status.dayKey}</span><span>2秒ごとに自動更新</span></footer>
  </main>;
}

function updateLocalStatus(status: Status, changes: Partial<Status>): Status {
  const next = { ...status, ...changes };
  const guidance = calculateQueueGuidance({
    capacity: next.settings.activeCapacity,
    currentCount: next.currentCount,
    cycleMinutes: next.settings.priorStayMinutes,
    reserveWaitMinutes: next.settings.reserveWaitMinutes,
    now: Date.now(),
    waiting: next.waiting.map((group) => ({ id: group.id, ticketNumber: group.ticket_number!, partySize: group.party_size, createdAt: group.created_at })),
  });
  return {
    ...next,
    waitingCount: next.waiting.length,
    waitingPeople: next.waiting.reduce((sum, group) => sum + group.party_size, 0),
    guidance,
  };
}

function applyServerPatch(status: Status, patch: ActionPatch): Status {
  const removed = new Set(patch.removedInsideIds ?? []);
  let inside = status.inside.filter((group) => group.id >= 0 && !removed.has(group.id));
  if (patch.addedInside) inside = [...inside.filter((group) => group.id !== patch.addedInside!.id), patch.addedInside];
  const recent = patch.recent
    ? [patch.recent, ...status.recent.filter((item) => item.id !== patch.recent!.id)].slice(0, 10)
    : status.recent;
  return updateLocalStatus(status, {
    revision: patch.revision,
    updatedAt: patch.updatedAt,
    currentCount: patch.currentCount,
    totalCount: patch.totalCount,
    maxCurrent: patch.maxCurrent,
    inside,
    recent,
  });
}

function processingLabel(action: string) {
  const labels: Record<string, string> = {
    REGISTER_DIRECT: "登録中…", QUEUE_CREATE_GROUP: "発行中…", CONFIRM_TICKET_HANDOFF: "確認中…",
    CALL_NEXT: "呼出中…", CALL_NUMBER: "呼出中…", ADMIT_CALLED: "入場処理中…",
    EXIT_GROUP: "退場処理中…", EXIT_GROUPS: "一括退場中…", CANCEL: "取消中…", UNDO_LAST: "復元中…",
  };
  return labels[action] ?? "保存中…";
}

const Metric = memo(function Metric({ label, value, unit, emphasis, warm }: { label: string; value: number | string; unit: string; emphasis?: boolean; warm?: boolean }) {
  return <div className={`metric ${emphasis ? "emphasis" : ""} ${warm ? "warm" : ""}`}><span>{label}</span><strong>{value}</strong><small>{unit}</small></div>;
});
function CountEditor({ label, value, min = 0, max, onChange }: { label: string; value: number; min?: number; max: number; onChange: (value: number) => void }) {
  return <div className="count-editor"><span>{label}</span><Button type="button" variant="outline" size="icon" aria-label={`${label}を1人減らす`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}><Minus /></Button><strong>{value}</strong><Button type="button" variant="outline" size="icon" aria-label={`${label}を1人増やす`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}><Plus /></Button></div>;
}
function SplitSlider({ title, lead, follow, total, value, onChange }: { title: string; lead: string; follow: string; total: number; value: number; onChange: (value: number) => void }) {
  return <div className="split-axis"><h3>{title}</h3><div className="split-labels"><span>{lead}</span><i>— / —</i><span>{follow}</span></div><div className="split-counts"><strong>{value}人</strong><strong>{total - value}人</strong></div><Slider className="split-slider" min={0} max={total} step={1} value={[value]} onValueChange={(next) => onChange(next[0] ?? 0)} aria-label={`${lead}と${follow}の人数`} /></div>;
}
function timeLabel(timestamp: number) { return new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", hour: "2-digit", minute: "2-digit" }).format(timestamp); }
function formatWait(minutes: number) { return minutes < 1 ? "<1" : String(Math.floor(minutes)); }
function elapsedLabel(timestamp: number) { const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000)); return minutes < 1 ? "1分未満" : `${minutes}分経過`; }

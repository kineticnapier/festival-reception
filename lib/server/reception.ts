import { env } from "cloudflare:workers";
import { calculateQueueGuidance, estimateQueueWaitMinutes } from "@/lib/queue-guidance";

type GroupStatus = "issuing" | "waiting" | "called" | "inside" | "exited" | "cancelled";
type DayRow = {
  day_key: string; current_count: number; total_count: number; max_current: number;
  next_ticket: number; called_ticket_number: number | null;
  normal_capacity: number; overflow_capacity: number; overflow_enabled: number;
  prior_stay_seconds: number; reserve_wait_seconds: number; revision: number; updated_at: number;
};
type GroupRow = {
  id: number; ticket_number: number | null; status: GroupStatus; party_size: number;
  created_at: number; called_at: number | null; admitted_at: number | null;
  exited_at: number | null; cancelled_at: number | null;
};
type EventRow = {
  id: number; op_id: string; type: string; ticket_number: number | null;
  group_id: number | null; details: string | null; party_size: number; created_at: number;
};
type GroupInput = {
  partySize?: number;
  studentCount?: number | null; externalCount?: number | null;
  grade1Count?: number | null; grade2Count?: number | null; grade3Count?: number | null;
  middleGrade1Count?: number | null; middleGrade2Count?: number | null; middleGrade3Count?: number | null;
  highGrade1Count?: number | null; highGrade2Count?: number | null; highGrade3Count?: number | null;
  maleCount?: number | null; femaleCount?: number | null;
  adultCount?: number | null; childCount?: number | null;
};
type ActionInput = GroupInput & {
  requestId?: string;
  ticketNumber?: number; groupId?: number; groupIds?: number[];
  normalCapacity?: number; overflowCapacity?: number; overflowEnabled?: boolean;
  priorStayMinutes?: number; reserveWaitMinutes?: number;
};

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}
type Database = ReturnType<typeof db>;
type PreparedStatement = ReturnType<Database["prepare"]>;

export function currentDayKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function ensureDay(dayKey: string, now = Date.now()) {
  await db().prepare("INSERT INTO day_state (day_key, updated_at) VALUES (?, ?) ON CONFLICT(day_key) DO NOTHING").bind(dayKey, now).run();
}

function resultRows<T>(result: unknown) {
  return ((result as { results?: T[] }).results ?? []);
}

function asOptionalCount(value: unknown, label: string) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 50) throw new Error(`${label}は0〜50人で入力してください`);
  return number;
}

function requestOperationId(input: ActionInput) {
  const requestId = typeof input.requestId === "string" ? input.requestId.trim() : "";
  return requestId && requestId.length <= 100 ? requestId : crypto.randomUUID();
}

function capacityOf(state: { normal_capacity: number; overflow_capacity: number; overflow_enabled: number }) {
  return state.overflow_enabled ? state.overflow_capacity : state.normal_capacity;
}

function normalizeGroup(input: GroupInput) {
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 30) throw new Error("グループ人数は1〜30人で入力してください");
  const group = {
    partySize,
    studentCount: asOptionalCount(input.studentCount, "在校生人数"),
    externalCount: asOptionalCount(input.externalCount, "外部人数"),
    middleGrade1Count: asOptionalCount(input.middleGrade1Count ?? input.grade1Count, "中学1年人数"),
    middleGrade2Count: asOptionalCount(input.middleGrade2Count ?? input.grade2Count, "中学2年人数"),
    middleGrade3Count: asOptionalCount(input.middleGrade3Count ?? input.grade3Count, "中学3年人数"),
    highGrade1Count: asOptionalCount(input.highGrade1Count, "高校1年人数"),
    highGrade2Count: asOptionalCount(input.highGrade2Count, "高校2年人数"),
    highGrade3Count: asOptionalCount(input.highGrade3Count, "高校3年人数"),
    maleCount: asOptionalCount(input.maleCount, "男性人数"),
    femaleCount: asOptionalCount(input.femaleCount, "女性人数"),
    adultCount: asOptionalCount(input.adultCount, "大人人数"),
    childCount: asOptionalCount(input.childCount, "子供人数"),
  };
  const sourceKnown = group.studentCount != null || group.externalCount != null;
  if (sourceKnown) {
    if (group.studentCount == null || group.externalCount == null || group.studentCount + group.externalCount !== partySize) throw new Error("在校生＋外部をグループ人数と同じにしてください");
    const grades = [group.middleGrade1Count, group.middleGrade2Count, group.middleGrade3Count, group.highGrade1Count, group.highGrade2Count, group.highGrade3Count];
    if (grades.some((value) => value == null) || grades.reduce<number>((sum, value) => sum + (value ?? 0), 0) > group.studentCount) throw new Error("学年人数が在校生人数を超えています");
  } else if ([group.middleGrade1Count, group.middleGrade2Count, group.middleGrade3Count, group.highGrade1Count, group.highGrade2Count, group.highGrade3Count].some((value) => value != null)) {
    throw new Error("学年を入力する場合は在校生・外部の内訳も入力してください");
  }
  const genderKnown = group.maleCount != null || group.femaleCount != null;
  if (genderKnown && (group.maleCount == null || group.femaleCount == null || group.maleCount + group.femaleCount !== partySize)) throw new Error("男＋女をグループ人数と同じにしてください");
  const ageKnown = group.adultCount != null || group.childCount != null;
  if (ageKnown && (group.adultCount == null || group.childCount == null || group.adultCount + group.childCount !== partySize)) throw new Error("大人＋子供をグループ人数と同じにしてください");
  return group;
}

function groupInsert(database: Database, dayKey: string, status: GroupStatus, ticketNumber: number | null, group: ReturnType<typeof normalizeGroup>, now: number) {
  return database.prepare(`
    INSERT INTO visitor_groups (
      day_key, ticket_number, status, party_size,
      student_count, external_count,
      grade1_count, grade2_count, grade3_count,
      middle_grade1_count, middle_grade2_count, middle_grade3_count,
      high_grade1_count, high_grade2_count, high_grade3_count,
      male_count, female_count, adult_count, child_count, created_at, admitted_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `).bind(
    dayKey, ticketNumber, status, group.partySize,
    group.studentCount, group.externalCount,
    group.middleGrade1Count, group.middleGrade2Count, group.middleGrade3Count,
    group.middleGrade1Count, group.middleGrade2Count, group.middleGrade3Count,
    group.highGrade1Count, group.highGrade2Count, group.highGrade3Count,
    group.maleCount, group.femaleCount, group.adultCount, group.childCount, now,
    status === "inside" ? now : null,
  );
}

function eventStatement(database: Database, values: { dayKey: string; opId: string; type: string; ticketNumber?: number | null; groupId?: number | null; partySize: number; now: number }) {
  return database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(
    values.dayKey, values.opId, values.type, values.ticketNumber ?? null, values.groupId ?? null, values.partySize, values.now,
  );
}

function eventLabel(event: EventRow) {
  const people = `${event.party_size}人`;
  const ticket = event.ticket_number == null ? "" : `${event.ticket_number}番 `;
  const labels: Record<string, string> = {
    ENTER: "入場 +1", EXIT: "退場 -1",
    ENTER_GROUP: `${people}グループが直接入場`,
    EXIT_GROUP: `${ticket}${people}グループが退場`,
    QUEUE_CREATE: `${ticket}${people}の整理券を発行`,
    QUEUE_RESERVE: `${ticket}${people}の紙整理券を準備`,
    QUEUE_CONFIRM: `${ticket}の紙受け渡しを確認`,
    CALL: `${ticket}を呼出`, RETURN_TO_WAITING: `${ticket}を待機へ戻す`,
    ADMIT: `${ticket}${people}が入場`, CANCEL: `${ticket}を取消`,
    ADMIN_CORRECT: "管理者が人数・整理券状態を修正",
    ADMIN_GROUP_STATUS: `${ticket}の状態を管理者が修正`,
  };
  return labels[event.type] ?? event.type;
}

export async function getStatus(dayKey = currentDayKey(), ticketNumber?: number, options: { day?: DayRow; skipEnsure?: boolean; includeRecent?: boolean; includeSocialLinks?: boolean } = {}) {
  const database = db();
  let knownDay = options.day;
  if (!knownDay && !options.skipEnsure) {
    knownDay = await database.prepare("SELECT * FROM day_state WHERE day_key = ?").bind(dayKey).first<DayRow>() ?? undefined;
    if (!knownDay) {
      await ensureDay(dayKey);
      knownDay = await database.prepare("SELECT * FROM day_state WHERE day_key = ?").bind(dayKey).first<DayRow>() ?? undefined;
    }
  }
  const selectGroup = `id, ticket_number, status, party_size, created_at, called_at, admitted_at, exited_at, cancelled_at`;
  const statements: PreparedStatement[] = [];
  if (!knownDay) statements.push(database.prepare("SELECT * FROM day_state WHERE day_key = ?").bind(dayKey));
  statements.push(
    database.prepare(`SELECT ${selectGroup} FROM visitor_groups WHERE day_key = ? AND status IN ('waiting','issuing','called','inside')`).bind(dayKey),
    database.prepare("SELECT admitted_at, exited_at FROM visitor_groups WHERE day_key = ? AND status = 'exited' AND admitted_at IS NOT NULL AND exited_at > admitted_at ORDER BY exited_at DESC LIMIT 30").bind(dayKey),
  );
  const includeRecent = options.includeRecent !== false;
  const includeSocialLinks = options.includeSocialLinks === true;
  if (includeRecent) statements.push(database.prepare("SELECT id, op_id, type, ticket_number, group_id, details, party_size, created_at FROM events WHERE day_key = ? AND undone = 0 ORDER BY id DESC LIMIT 10").bind(dayKey));
  if (includeSocialLinks) statements.push(database.prepare("SELECT id, label, url FROM social_links WHERE enabled = 1 ORDER BY sort_order, id"));
  const includeTicket = ticketNumber != null && Number.isInteger(ticketNumber);
  if (includeTicket) statements.push(database.prepare(`SELECT ${selectGroup} FROM visitor_groups WHERE day_key = ? AND ticket_number = ? ORDER BY CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END, id DESC LIMIT 1`).bind(dayKey, ticketNumber));
  const results = await database.batch(statements);
  let resultIndex = 0;
  const day = knownDay ?? resultRows<DayRow>(results[resultIndex++])[0];
  if (!day) throw new Error("当日の状態を取得できませんでした");
  const activeRows = resultRows<GroupRow>(results[resultIndex++]);
  const waitingRows = activeRows.filter((group) => group.status === "waiting").sort((a, b) => (a.ticket_number ?? 0) - (b.ticket_number ?? 0)).slice(0, 100);
  const pendingHandoff = activeRows.filter((group) => group.status === "issuing").sort((a, b) => b.id - a.id)[0] ?? null;
  const inside = activeRows.filter((group) => group.status === "inside").sort((a, b) => (a.admitted_at ?? 0) - (b.admitted_at ?? 0) || a.id - b.id);
  const called = day.called_ticket_number == null ? null : (activeRows.find((group) => group.status === "called" && group.ticket_number === day.called_ticket_number) ?? null);
  const completed = resultRows<{ admitted_at: number; exited_at: number }>(results[resultIndex++]);
  const actualMean = completed.length ? completed.reduce((sum, row) => sum + (row.exited_at - row.admitted_at) / 60_000, 0) / completed.length : null;
  const priorStayMinutes = day.prior_stay_seconds / 60;
  const actualWeight = completed.length / (completed.length + 8);
  const predictedStayMinutes = Math.max(0.5, Math.min(30, priorStayMinutes * (1 - actualWeight) + (actualMean ?? priorStayMinutes) * actualWeight));
  const activeCapacity = day.overflow_enabled ? day.overflow_capacity : day.normal_capacity;
  const reserveWaitMinutes = day.reserve_wait_seconds / 60;
  const calculationNow = Date.now();
  const guidance = calculateQueueGuidance({
    capacity: activeCapacity,
    currentCount: day.current_count,
    cycleMinutes: priorStayMinutes,
    reserveWaitMinutes,
    now: calculationNow,
    waiting: waitingRows.map((group) => ({
      id: group.id,
      ticketNumber: group.ticket_number!,
      partySize: group.party_size,
      createdAt: group.created_at,
    })),
  });
  const estimates = estimateQueueWaitMinutes({
    capacity: activeCapacity,
    stayMinutes: predictedStayMinutes,
    cycleMinutes: priorStayMinutes,
    reserveWaitMinutes,
    now: calculationNow,
    inside: inside.map((group) => ({ id: group.id, partySize: group.party_size, admittedAt: group.admitted_at })),
    called: called == null ? null : {
      id: called.id,
      ticketNumber: called.ticket_number!,
      partySize: called.party_size,
      createdAt: called.created_at,
    },
    waiting: waitingRows.map((group) => ({
      id: group.id,
      ticketNumber: group.ticket_number!,
      partySize: group.party_size,
      createdAt: group.created_at,
    })),
  });
  const waiting = waitingRows.map((group) => ({ ...group, estimatedMinutes: estimates.get(group.id) ?? null }));

  const recent = includeRecent
    ? resultRows<EventRow>(results[resultIndex++]).map((event) => ({ ...event, label: eventLabel(event) }))
    : [];
  const socialLinks = includeSocialLinks
    ? resultRows<{ id: number; label: string; url: string }>(results[resultIndex++])
    : [];

  let ticket: (GroupRow & { ahead: number; estimatedMinutes: number | null }) | null = null;
  if (ticketNumber != null && Number.isInteger(ticketNumber)) {
    const row = resultRows<GroupRow>(results[resultIndex++])[0];
    if (row) {
      const ahead = row.status === "waiting" ? waitingRows.findIndex((item) => item.id === row.id) + (called == null ? 0 : 1) : 0;
      ticket = { ...row, ahead: Math.max(0, ahead), estimatedMinutes: row.status === "waiting" ? (estimates.get(row.id) ?? null) : 0 };
    }
  }

  return {
    dayKey,
    currentCount: day.current_count,
    totalCount: day.total_count,
    maxCurrent: day.max_current,
    nextTicketNumber: day.next_ticket,
    waitingCount: waiting.length,
    waitingPeople: waiting.reduce((sum, group) => sum + group.party_size, 0),
    waiting,
    pendingHandoff,
    called,
    inside,
    settings: {
      normalCapacity: day.normal_capacity,
      overflowCapacity: day.overflow_capacity,
      overflowEnabled: Boolean(day.overflow_enabled),
      activeCapacity,
      priorStayMinutes,
      reserveWaitMinutes,
    },
    estimate: {
      predictedStayMinutes: Number(predictedStayMinutes.toFixed(1)),
      actualMeanMinutes: actualMean == null ? null : Number(actualMean.toFixed(1)),
      actualSampleCount: completed.length,
      actualWeight: Number(actualWeight.toFixed(2)),
      peoplePerMinute: Number((activeCapacity / predictedStayMinutes).toFixed(1)),
    },
    recent,
    guidance: {
      ...guidance,
      target: guidance.target ? {
        ...guidance.target,
        waitMinutes: Number(guidance.target.waitMinutes.toFixed(1)),
        priority: Number(guidance.target.priority.toFixed(3)),
      } : null,
      scores: guidance.scores.map((group) => ({
        ...group,
        waitMinutes: Number(group.waitMinutes.toFixed(1)),
        priority: Number(group.priority.toFixed(3)),
      })),
    },
    ticket,
    socialLinks,
    revision: day.revision,
    updatedAt: day.updated_at,
  };
}

export async function getStatusIfChanged(dayKey = currentDayKey(), sinceRevision?: number) {
  const database = db();
  let day = await database.prepare("SELECT * FROM day_state WHERE day_key = ?").bind(dayKey).first<DayRow>();
  if (!day) {
    await ensureDay(dayKey);
    day = await database.prepare("SELECT * FROM day_state WHERE day_key = ?").bind(dayKey).first<DayRow>();
  }
  if (!day) throw new Error("当日の状態を取得できませんでした");
  if (Number.isInteger(sinceRevision) && day.revision === sinceRevision) return null;
  return getStatus(dayKey, undefined, { day });
}

export async function performAction(action: string, input: ActionInput = {}) {
  const dayKey = currentDayKey();
  const now = Date.now();
  await ensureDay(dayKey, now);
  const database = db();

  if (action === "REGISTER_DIRECT") {
    const group = normalizeGroup(input);
    const reads = await database.batch([
      database.prepare(`
        SELECT d.current_count, d.normal_capacity, d.overflow_capacity, d.overflow_enabled,
          d.prior_stay_seconds, d.reserve_wait_seconds,
          COALESCE((
            SELECT g.party_size FROM visitor_groups g
            WHERE g.day_key = d.day_key AND g.status = 'called' AND g.ticket_number = d.called_ticket_number
            LIMIT 1
          ), 0) AS called_party_size
        FROM day_state d WHERE d.day_key = ?
      `).bind(dayKey),
      database.prepare("SELECT id, ticket_number, party_size, created_at FROM visitor_groups WHERE day_key = ? AND status = 'waiting' ORDER BY ticket_number").bind(dayKey),
    ]);
    const state = resultRows<{ current_count: number; normal_capacity: number; overflow_capacity: number; overflow_enabled: number; prior_stay_seconds: number; reserve_wait_seconds: number; called_party_size: number }>(reads[0])[0];
    if (!state) throw new Error("当日の状態を取得できませんでした");
    const activeCapacity = capacityOf(state);
    const freeForWalkIn = Math.max(0, activeCapacity - state.current_count - state.called_party_size);
    if (group.partySize > freeForWalkIn) {
      const calledNote = state.called_party_size > 0 ? `（案内中グループ ${state.called_party_size}人分を確保中）` : "";
      throw new Error(`現在はあと${freeForWalkIn}人まで入場できます${calledNote}`);
    }
    const waiting = resultRows<{ id: number; ticket_number: number; party_size: number; created_at: number }>(reads[1]);
    const guidance = calculateQueueGuidance({
      capacity: activeCapacity,
      currentCount: state.current_count,
      cycleMinutes: state.prior_stay_seconds / 60,
      reserveWaitMinutes: state.reserve_wait_seconds / 60,
      now,
      waiting: waiting.map((group) => ({ id: group.id, ticketNumber: group.ticket_number, partySize: group.party_size, createdAt: group.created_at })),
    });
    if (guidance.mode === "reserving" && guidance.target) throw new Error(`${guidance.target.ticketNumber}番のため空きを確保中です。直接入場は一時停止してください`);
    const inserted = await groupInsert(database, dayKey, "inside", null, group, now).first<{ id: number }>();
    if (!inserted) throw new Error("グループを登録できませんでした");
    const opId = requestOperationId(input);
    const writeResults = await database.batch([
      database.prepare("UPDATE day_state SET current_count = current_count + ?, total_count = total_count + ?, max_current = MAX(max_current, current_count + ?), revision = revision + 1, updated_at = ? WHERE day_key = ? RETURNING current_count, total_count, max_current, revision, updated_at").bind(group.partySize, group.partySize, group.partySize, now, dayKey),
      eventStatement(database, { dayKey, opId, type: "ENTER_GROUP", groupId: inserted.id, partySize: group.partySize, now }),
    ]);
    const summary = resultRows<{ current_count: number; total_count: number; max_current: number; revision: number; updated_at: number }>(writeResults[0])[0];
    if (!summary) throw new Error("人数状態を更新できませんでした");
    return { patch: {
      revision: summary.revision, updatedAt: summary.updated_at,
      currentCount: summary.current_count, totalCount: summary.total_count, maxCurrent: summary.max_current,
      addedInside: { id: inserted.id, ticket_number: null, status: "inside", party_size: group.partySize, created_at: now, admitted_at: now },
      recent: { id: opId, label: `${group.partySize}人グループが直接入場`, created_at: now },
    } };
  } else if (action === "QUEUE_CREATE_GROUP") {
    const group = normalizeGroup(input);
    const reads = await database.batch([
      database.prepare("SELECT ticket_number FROM visitor_groups WHERE day_key = ? AND status = 'issuing' LIMIT 1").bind(dayKey),
      database.prepare("SELECT next_ticket FROM day_state WHERE day_key = ?").bind(dayKey),
    ]);
    const pending = resultRows<{ ticket_number: number }>(reads[0])[0];
    if (pending) throw new Error(`${pending.ticket_number}番の「紙を渡した」を先に確認してください`);
    const day = resultRows<{ next_ticket: number }>(reads[1])[0];
    if (!day) throw new Error("整理券番号を発行できませんでした");
    const inserted = await groupInsert(database, dayKey, "issuing", day.next_ticket, group, now).first<{ id: number }>();
    if (!inserted) throw new Error("整理券グループを登録できませんでした");
    await database.batch([
      database.prepare("UPDATE day_state SET revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(now, dayKey),
      eventStatement(database, { dayKey, opId: requestOperationId(input), type: "QUEUE_RESERVE", ticketNumber: day.next_ticket, groupId: inserted.id, partySize: group.partySize, now }),
    ]);
    return { status: await getStatus(dayKey, undefined, { skipEnsure: true }), issuedTicket: day.next_ticket };
  } else if (action === "CONFIRM_TICKET_HANDOFF") {
    const ticketNumber = Number(input.ticketNumber);
    if (!Number.isInteger(ticketNumber) || ticketNumber < 1) throw new Error("確認する紙整理券番号を指定してください");
    const state = await database.prepare("SELECT d.revision, g.id, g.party_size FROM day_state d LEFT JOIN visitor_groups g ON g.day_key = d.day_key AND g.ticket_number = ? AND g.status = 'issuing' WHERE d.day_key = ?").bind(ticketNumber, dayKey).first<{ revision: number; id: number | null; party_size: number | null }>();
    if (!state || state.id == null || state.party_size == null) throw new Error("受け渡し未確認の整理券が見つかりません");
    const opId = requestOperationId(input);
    const revision = state.revision + 1;
    const results = await database.batch([
      database.prepare("UPDATE day_state SET next_ticket = MAX(next_ticket, ?), revision = revision + 1, updated_at = ? WHERE day_key = ? AND revision = ? AND EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'issuing') RETURNING revision").bind(ticketNumber + 1, now, dayKey, state.revision, state.id),
      database.prepare("UPDATE visitor_groups SET status = 'waiting' WHERE id = ? AND status = 'issuing' AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)").bind(state.id, dayKey, revision),
      database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at) SELECT ?, ?, 'QUEUE_CONFIRM', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'waiting') AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)").bind(dayKey, opId, ticketNumber, state.id, state.party_size, now, state.id, dayKey, revision),
    ]);
    if (!resultRows(results[0]).length) throw new Error("この紙整理券は別の端末で処理済みです");
    return { status: await getStatus(dayKey, undefined, { skipEnsure: true }), confirmedTicket: ticketNumber };
  } else if (action === "CALL_NEXT") {
    const reads = await database.batch([
      database.prepare("SELECT ticket_number FROM visitor_groups WHERE day_key = ? AND status = 'issuing' LIMIT 1").bind(dayKey),
      database.prepare("SELECT called_ticket_number, current_count, normal_capacity, overflow_capacity, overflow_enabled, prior_stay_seconds, reserve_wait_seconds, revision FROM day_state WHERE day_key = ?").bind(dayKey),
      database.prepare("SELECT id, ticket_number, party_size, created_at FROM visitor_groups WHERE day_key = ? AND status = 'waiting' ORDER BY ticket_number").bind(dayKey),
    ]);
    const pending = resultRows<{ ticket_number: number }>(reads[0])[0];
    if (pending) throw new Error(`${pending.ticket_number}番の「紙を渡した」を先に確認してください`);
    const state = resultRows<{ called_ticket_number: number | null; current_count: number; normal_capacity: number; overflow_capacity: number; overflow_enabled: number; prior_stay_seconds: number; reserve_wait_seconds: number; revision: number }>(reads[1])[0];
    if (state?.called_ticket_number != null) throw new Error("案内中の整理券を入場または取消してから次を呼んでください");
    if (!state) throw new Error("当日の状態を取得できませんでした");
    const waiting = resultRows<{ id: number; ticket_number: number; party_size: number; created_at: number }>(reads[2]);
    const guidance = calculateQueueGuidance({
      capacity: state.overflow_enabled ? state.overflow_capacity : state.normal_capacity,
      currentCount: state.current_count,
      cycleMinutes: state.prior_stay_seconds / 60,
      reserveWaitMinutes: state.reserve_wait_seconds / 60,
      now,
      waiting: waiting.map((group) => ({ id: group.id, ticketNumber: group.ticket_number, partySize: group.party_size, createdAt: group.created_at })),
    });
    if (guidance.mode === "reserving" && guidance.target) throw new Error(`${guidance.target.ticketNumber}番のため空きを確保中です。あと${guidance.seatsNeeded}人の退場を待ってください`);
    if (!guidance.target) throw new Error(guidance.oversizedCount > 0 ? "現在案内できるグループがありません。定員超過のグループは手動で対応してください" : "現在の空きに入れる待機グループがありません");
    const opId = requestOperationId(input);
    const revision = state.revision + 1;
    const results = await database.batch([
      database.prepare("UPDATE day_state SET called_ticket_number = ?, revision = revision + 1, updated_at = ? WHERE day_key = ? AND revision = ? AND called_ticket_number IS NULL AND NOT EXISTS (SELECT 1 FROM visitor_groups WHERE day_key = ? AND status = 'issuing') RETURNING revision").bind(guidance.target.ticketNumber, now, dayKey, state.revision, dayKey),
      database.prepare("UPDATE visitor_groups SET status = 'called', called_at = ? WHERE id = ? AND status = 'waiting' AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number = ?)").bind(now, guidance.target.id, dayKey, revision, guidance.target.ticketNumber),
      database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at) SELECT ?, ?, 'CALL', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'called' AND called_at = ?) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number = ?)").bind(dayKey, opId, guidance.target.ticketNumber, guidance.target.id, guidance.target.partySize, now, guidance.target.id, now, dayKey, revision, guidance.target.ticketNumber),
    ]);
    if (!resultRows(results[0]).length) throw new Error("待機状態が別の端末で更新されました。もう一度お試しください");
  } else if (action === "CALL_NUMBER") {
    const pending = await database.prepare("SELECT ticket_number FROM visitor_groups WHERE day_key = ? AND status = 'issuing' LIMIT 1").bind(dayKey).first<{ ticket_number: number }>();
    if (pending) throw new Error(`${pending.ticket_number}番の「紙を渡した」を先に確認してください`);
    const ticketNumber = Number(input.ticketNumber);
    if (!Number.isInteger(ticketNumber) || ticketNumber < 1) throw new Error("呼び出す整理券番号を選んでください");
    const state = await database.prepare("SELECT called_ticket_number, revision FROM day_state WHERE day_key = ?").bind(dayKey).first<{ called_ticket_number: number | null; revision: number }>();
    if (!state) throw new Error("当日の状態を取得できませんでした");
    if (state.called_ticket_number === ticketNumber) throw new Error(`${ticketNumber}番はすでに案内中です`);
    const target = await database.prepare("SELECT id, party_size, status FROM visitor_groups WHERE day_key = ? AND ticket_number = ?").bind(dayKey, ticketNumber).first<{ id: number; party_size: number; status: string }>();
    if (!target || target.status !== "waiting") throw new Error(`${ticketNumber}番は待機中ではありません`);
    const opId = requestOperationId(input);
    const revision = state.revision + 1;
    const statements: PreparedStatement[] = [
      database.prepare("UPDATE day_state SET called_ticket_number = ?, revision = revision + 1, updated_at = ? WHERE day_key = ? AND revision = ? AND called_ticket_number IS ? AND NOT EXISTS (SELECT 1 FROM visitor_groups WHERE day_key = ? AND status = 'issuing') RETURNING revision").bind(ticketNumber, now, dayKey, state.revision, state.called_ticket_number, dayKey),
    ];
    if (state?.called_ticket_number != null) {
      const previous = await database.prepare("SELECT id, party_size FROM visitor_groups WHERE day_key = ? AND ticket_number = ? AND status = 'called'").bind(dayKey, state.called_ticket_number).first<{ id: number; party_size: number }>();
      if (previous) statements.push(
        database.prepare("UPDATE visitor_groups SET status = 'waiting', called_at = NULL WHERE id = ? AND status = 'called' AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number = ?)").bind(previous.id, dayKey, revision, ticketNumber),
        database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at) SELECT ?, ?, 'RETURN_TO_WAITING', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'waiting' AND called_at IS NULL) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number = ?)").bind(dayKey, opId, state.called_ticket_number, previous.id, previous.party_size, now, previous.id, dayKey, revision, ticketNumber),
      );
    }
    statements.push(
      database.prepare("UPDATE visitor_groups SET status = 'called', called_at = ? WHERE id = ? AND status = 'waiting' AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number = ?)").bind(now, target.id, dayKey, revision, ticketNumber),
      database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at) SELECT ?, ?, 'CALL', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'called' AND called_at = ?) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number = ?)").bind(dayKey, opId, ticketNumber, target.id, target.party_size, now, target.id, now, dayKey, revision, ticketNumber),
    );
    const results = await database.batch(statements);
    if (!resultRows(results[0]).length) throw new Error("呼び出し状態が別の端末で更新されました。もう一度お試しください");
  } else if (action === "ADMIT_CALLED") {
    const state = await database.prepare(`
      SELECT d.called_ticket_number, d.revision, d.current_count, d.normal_capacity, d.overflow_capacity, d.overflow_enabled,
        g.id, g.party_size,
        EXISTS (SELECT 1 FROM visitor_groups p WHERE p.day_key = d.day_key AND p.status = 'issuing') AS has_pending
      FROM day_state d
      LEFT JOIN visitor_groups g ON g.day_key = d.day_key AND g.ticket_number = d.called_ticket_number AND g.status = 'called'
      WHERE d.day_key = ?
    `).bind(dayKey).first<{ called_ticket_number: number | null; revision: number; current_count: number; normal_capacity: number; overflow_capacity: number; overflow_enabled: number; id: number | null; party_size: number | null; has_pending: number }>();
    if (state?.has_pending) throw new Error("「紙を渡した」を先に確認してください");
    if (state?.called_ticket_number == null) throw new Error("案内中の整理券がありません");
    if (state.id == null || state.party_size == null) throw new Error("案内中グループを確認できませんでした");
    const activeCapacity = capacityOf(state);
    const freeSeats = Math.max(0, activeCapacity - state.current_count);
    if (state.party_size > freeSeats) throw new Error(`${state.called_ticket_number}番は${state.party_size}人です。あと${state.party_size - freeSeats}人の退場を待ってください`);
    const opId = requestOperationId(input);
    const revision = state.revision + 1;
    const results = await database.batch([
      database.prepare("UPDATE day_state SET called_ticket_number = NULL, current_count = current_count + ?, total_count = total_count + ?, max_current = MAX(max_current, current_count + ?), revision = revision + 1, updated_at = ? WHERE day_key = ? AND revision = ? AND called_ticket_number = ? AND current_count + ? <= CASE WHEN overflow_enabled = 1 THEN overflow_capacity ELSE normal_capacity END AND NOT EXISTS (SELECT 1 FROM visitor_groups WHERE day_key = ? AND status = 'issuing') RETURNING revision").bind(state.party_size, state.party_size, state.party_size, now, dayKey, state.revision, state.called_ticket_number, state.party_size, dayKey),
      database.prepare("UPDATE visitor_groups SET status = 'inside', admitted_at = ? WHERE id = ? AND status = 'called' AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number IS NULL)").bind(now, state.id, dayKey, revision),
      database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at) SELECT ?, ?, 'ADMIT', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'inside' AND admitted_at = ?) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ? AND called_ticket_number IS NULL)").bind(dayKey, opId, state.called_ticket_number, state.id, state.party_size, now, state.id, now, dayKey, revision),
    ]);
    if (!resultRows(results[0]).length) throw new Error("このグループは別の端末で処理済みです");
  } else if (action === "CANCEL") {
    const ticketNumber = Number(input.ticketNumber);
    if (!Number.isInteger(ticketNumber) || ticketNumber < 1) throw new Error("整理券番号を指定してください");
    const pending = await database.prepare("SELECT ticket_number FROM visitor_groups WHERE day_key = ? AND status = 'issuing' LIMIT 1").bind(dayKey).first<{ ticket_number: number }>();
    if (pending && pending.ticket_number !== ticketNumber) throw new Error(`${pending.ticket_number}番の「紙を渡した」を先に確認してください`);
    const group = await database.prepare("SELECT id, party_size, status FROM visitor_groups WHERE day_key = ? AND ticket_number = ?").bind(dayKey, ticketNumber).first<{ id: number; party_size: number; status: string }>();
    if (!group || !["issuing", "waiting", "called"].includes(group.status)) throw new Error("取消できる整理券が見つかりません");
    const statements = [
      database.prepare("UPDATE visitor_groups SET status = 'cancelled', ticket_number = CASE WHEN status = 'issuing' THEN NULL ELSE ticket_number END, cancelled_at = ? WHERE id = ? AND status IN ('issuing','waiting','called')").bind(now, group.id),
      eventStatement(database, { dayKey, opId: requestOperationId(input), type: "CANCEL", ticketNumber, groupId: group.id, partySize: group.party_size, now }),
    ];
    statements.push(database.prepare("UPDATE day_state SET called_ticket_number = CASE WHEN called_ticket_number = ? THEN NULL ELSE called_ticket_number END, revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(ticketNumber, now, dayKey));
    await database.batch(statements);
  } else if (action === "EXIT_GROUP") {
    const groupId = Number(input.groupId);
    if (!Number.isInteger(groupId) || groupId < 1) throw new Error("退場するグループを選んでください");
    const group = await database.prepare("SELECT ticket_number, party_size FROM visitor_groups WHERE day_key = ? AND id = ? AND status = 'inside'").bind(dayKey, groupId).first<{ ticket_number: number | null; party_size: number }>();
    if (!group) throw new Error("入場中のグループが見つかりません");
    const opId = requestOperationId(input);
    const writeResults = await database.batch([
      database.prepare("UPDATE day_state SET current_count = MAX(0, current_count - ?), revision = revision + 1, updated_at = ? WHERE day_key = ? AND EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND day_key = ? AND status = 'inside') RETURNING current_count, total_count, max_current, revision, updated_at").bind(group.party_size, now, dayKey, groupId, dayKey),
      database.prepare("UPDATE visitor_groups SET status = 'exited', exited_at = ? WHERE id = ? AND status = 'inside'").bind(now, groupId),
      database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at) SELECT ?, ?, 'EXIT_GROUP', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'exited' AND exited_at = ?)").bind(dayKey, opId, group.ticket_number, groupId, group.party_size, now, groupId, now),
    ]);
    const summary = resultRows<{ current_count: number; total_count: number; max_current: number; revision: number; updated_at: number }>(writeResults[0])[0];
    if (!summary) throw new Error("このグループはすでに退場処理されています");
    return { patch: {
      revision: summary.revision, updatedAt: summary.updated_at,
      currentCount: summary.current_count, totalCount: summary.total_count, maxCurrent: summary.max_current,
      removedInsideIds: [groupId],
      recent: { id: opId, label: `${group.ticket_number == null ? "" : `${group.ticket_number}番 `}${group.party_size}人グループが退場`, created_at: now },
    } };
  } else if (action === "EXIT_GROUPS") {
    if (!Array.isArray(input.groupIds)) throw new Error("退場するグループを選んでください");
    const groupIds = [...new Set(input.groupIds.map(Number))];
    if (!groupIds.length || groupIds.length > 100 || groupIds.some((id) => !Number.isInteger(id) || id < 1)) throw new Error("退場するグループを正しく選んでください");
    const placeholders = groupIds.map(() => "?").join(",");
    const result = await database.prepare(`SELECT id, ticket_number, party_size FROM visitor_groups WHERE day_key = ? AND status = 'inside' AND id IN (${placeholders}) ORDER BY id`).bind(dayKey, ...groupIds).all<{ id: number; ticket_number: number | null; party_size: number }>();
    const groups = result.results ?? [];
    if (groups.length !== groupIds.length) throw new Error("選択したグループの状態が変わりました。画面を更新して選び直してください");
    const day = await database.prepare("SELECT revision FROM day_state WHERE day_key = ?").bind(dayKey).first<{ revision: number }>();
    if (!day) throw new Error("当日の人数状態を取得できませんでした");
    const totalPeople = groups.reduce((sum, group) => sum + group.party_size, 0);
    const opId = requestOperationId(input);
    const revision = day.revision + 1;
    const writeResults = await database.batch([
      database.prepare(`UPDATE day_state SET current_count = MAX(0, current_count - ?), revision = revision + 1, updated_at = ? WHERE day_key = ? AND revision = ? AND (SELECT COUNT(*) FROM visitor_groups WHERE day_key = ? AND status = 'inside' AND id IN (${placeholders})) = ? RETURNING current_count, total_count, max_current, revision, updated_at`).bind(totalPeople, now, dayKey, day.revision, dayKey, ...groupIds, groupIds.length),
      database.prepare(`UPDATE visitor_groups SET status = 'exited', exited_at = ? WHERE day_key = ? AND status = 'inside' AND id IN (${placeholders}) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)`).bind(now, dayKey, ...groupIds, dayKey, revision),
      ...groups.map((group) => database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at) SELECT ?, ?, 'EXIT_GROUP', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM visitor_groups WHERE id = ? AND status = 'exited' AND exited_at = ?) AND EXISTS (SELECT 1 FROM day_state WHERE day_key = ? AND revision = ?)").bind(dayKey, opId, group.ticket_number, group.id, group.party_size, now, group.id, now, dayKey, revision)),
    ]);
    const summary = resultRows<{ current_count: number; total_count: number; max_current: number; revision: number; updated_at: number }>(writeResults[0])[0];
    if (!summary) throw new Error("選択したグループは別の端末で処理済みです");
    return { patch: {
      revision: summary.revision, updatedAt: summary.updated_at,
      currentCount: summary.current_count, totalCount: summary.total_count, maxCurrent: summary.max_current,
      removedInsideIds: groupIds,
      recent: { id: opId, label: `${groups.length}組・${totalPeople}人が退場`, created_at: now },
    } };
  } else if (action === "SETTINGS") {
    const normalCapacity = Number(input.normalCapacity);
    const overflowCapacity = Number(input.overflowCapacity);
    const priorStayMinutes = Number(input.priorStayMinutes);
    const reserveWaitMinutes = Number(input.reserveWaitMinutes);
    if (!Number.isInteger(normalCapacity) || normalCapacity < 1 || normalCapacity > 100) throw new Error("通常定員は1〜100人で指定してください");
    if (!Number.isInteger(overflowCapacity) || overflowCapacity < normalCapacity || overflowCapacity > 100) throw new Error("最大定員は通常定員以上、100人以下にしてください");
    if (!Number.isFinite(priorStayMinutes) || priorStayMinutes < 0.5 || priorStayMinutes > 180) throw new Error("平均滞在時間は0.5〜180分で指定してください");
    if (!Number.isFinite(reserveWaitMinutes) || reserveWaitMinutes < 0.5 || reserveWaitMinutes > 180) throw new Error("空き確保を始める待ち時間は0.5〜180分で指定してください");
    await database.prepare("UPDATE day_state SET normal_capacity = ?, overflow_capacity = ?, overflow_enabled = ?, prior_stay_seconds = ?, reserve_wait_seconds = ?, revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(normalCapacity, overflowCapacity, input.overflowEnabled ? 1 : 0, Math.round(priorStayMinutes * 60), Math.round(reserveWaitMinutes * 60), now, dayKey).run();
  } else if (action === "RESET_DAY") {
    await database.batch([
      database.prepare("DELETE FROM events WHERE day_key = ?").bind(dayKey),
      database.prepare("DELETE FROM tickets WHERE day_key = ?").bind(dayKey),
      database.prepare("DELETE FROM visitor_groups WHERE day_key = ?").bind(dayKey),
      database.prepare("UPDATE day_state SET current_count = 0, total_count = 0, max_current = 0, next_ticket = 1, called_ticket_number = NULL, revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(now, dayKey),
    ]);
  } else if (action === "UNDO_LAST") {
    await undoLast(dayKey, now);
  } else {
    throw new Error("不明な操作です");
  }
  return { status: await getStatus(dayKey, undefined, { skipEnsure: true }) };
}

async function undoLast(dayKey: string, now: number) {
  const database = db();
  const latest = await database.prepare("SELECT op_id FROM events WHERE day_key = ? AND undone = 0 ORDER BY id DESC LIMIT 1").bind(dayKey).first<{ op_id: string }>();
  if (!latest) throw new Error("取り消せる操作がありません");
  const latestEvents = await database.prepare("SELECT type, group_id FROM events WHERE day_key = ? AND op_id = ? AND undone = 0").bind(dayKey, latest.op_id).all<{ type: string; group_id: number | null }>();
  await database.batch([
    database.prepare("UPDATE events SET undone = 1 WHERE day_key = ? AND op_id = ?").bind(dayKey, latest.op_id),
    ...(latestEvents.results ?? []).filter((event) => event.type === "QUEUE_RESERVE" && event.group_id != null).map((event) => database.prepare("UPDATE visitor_groups SET status = 'cancelled', ticket_number = NULL, cancelled_at = ? WHERE id = ?").bind(now, event.group_id)),
  ]);
  const result = await database.prepare("SELECT id, op_id, type, ticket_number, group_id, details, party_size, created_at FROM events WHERE day_key = ? AND undone = 0 ORDER BY id").bind(dayKey).all<EventRow>();
  const events = result.results ?? [];
  let current = 0, total = 0, max = 0, called: number | null = null;
  const status = new Map<number, { value: GroupStatus; ticketNumber: number | null; calledAt: number | null; admittedAt: number | null; exitedAt: number | null; cancelledAt: number | null }>();
  for (const event of events) {
    if (event.type === "ENTER") { current += event.party_size; total += event.party_size; }
    if (event.type === "EXIT") current = Math.max(0, current - event.party_size);
    if (event.type === "ENTER_GROUP" && event.group_id != null) { status.set(event.group_id, { value: "inside", ticketNumber: null, calledAt: null, admittedAt: event.created_at, exitedAt: null, cancelledAt: null }); current += event.party_size; total += event.party_size; }
    if (event.type === "QUEUE_CREATE" && event.group_id != null) status.set(event.group_id, { value: "waiting", ticketNumber: event.ticket_number, calledAt: null, admittedAt: null, exitedAt: null, cancelledAt: null });
    if (event.type === "QUEUE_RESERVE" && event.group_id != null) status.set(event.group_id, { value: "issuing", ticketNumber: event.ticket_number, calledAt: null, admittedAt: null, exitedAt: null, cancelledAt: null });
    if (event.type === "QUEUE_CONFIRM" && event.group_id != null) { const previous = status.get(event.group_id); status.set(event.group_id, { value: "waiting", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: null, admittedAt: null, exitedAt: null, cancelledAt: null }); }
    if (event.type === "RETURN_TO_WAITING" && event.group_id != null) { const previous = status.get(event.group_id); status.set(event.group_id, { value: "waiting", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: null, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: null }); if (called === event.ticket_number) called = null; }
    if (event.type === "CALL" && event.group_id != null) { const previous = status.get(event.group_id); status.set(event.group_id, { value: "called", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: event.created_at, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: null }); called = event.ticket_number; }
    if (event.type === "ADMIT" && event.group_id != null) { const previous = status.get(event.group_id); status.set(event.group_id, { value: "inside", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: previous?.calledAt ?? null, admittedAt: event.created_at, exitedAt: null, cancelledAt: null }); if (called === event.ticket_number) called = null; current += event.party_size; total += event.party_size; }
    if (event.type === "EXIT_GROUP" && event.group_id != null) { const previous = status.get(event.group_id); status.set(event.group_id, { value: "exited", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: previous?.calledAt ?? null, admittedAt: previous?.admittedAt ?? null, exitedAt: event.created_at, cancelledAt: null }); current = Math.max(0, current - event.party_size); }
    if (event.type === "CANCEL" && event.group_id != null) { const previous = status.get(event.group_id); status.set(event.group_id, { value: "cancelled", ticketNumber: previous?.value === "issuing" ? null : (previous?.ticketNumber ?? event.ticket_number), calledAt: previous?.calledAt ?? null, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: event.created_at }); if (called === event.ticket_number) called = null; }
    if ((event.type === "ADMIN_CORRECT" || event.type === "ADMIN_GROUP_STATUS") && event.details) {
      try {
        const details = JSON.parse(event.details) as { currentCount?: number; totalCount?: number; calledNumber?: number | null; status?: GroupStatus; groupId?: number; pendingGroupId?: number; pendingTicketNumber?: number };
        if (typeof details.currentCount === "number") current = details.currentCount;
        if (typeof details.totalCount === "number") total = details.totalCount;
        called = details.calledNumber ?? null;
        for (const [id, item] of status) if (item.value === "called") status.set(id, { ...item, value: "waiting", calledAt: null });
        const correctedGroupId = details.groupId ?? event.group_id;
        if (event.type === "ADMIN_CORRECT" && correctedGroupId != null && called != null) {
          const previous = status.get(correctedGroupId);
          status.set(correctedGroupId, { value: "called", ticketNumber: previous?.ticketNumber ?? event.ticket_number, calledAt: event.created_at, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: null });
        }
        if (event.type === "ADMIN_CORRECT" && details.pendingGroupId != null && details.pendingTicketNumber != null) {
          const previous = status.get(details.pendingGroupId);
          status.set(details.pendingGroupId, { value: "issuing", ticketNumber: details.pendingTicketNumber, calledAt: null, admittedAt: previous?.admittedAt ?? null, exitedAt: null, cancelledAt: null });
        }
        if (event.type === "ADMIN_GROUP_STATUS" && correctedGroupId != null && details.status) {
          const previous = status.get(correctedGroupId);
          status.set(correctedGroupId, {
            value: details.status,
            ticketNumber: previous?.ticketNumber ?? event.ticket_number,
            calledAt: details.status === "called" ? event.created_at : null,
            admittedAt: ["inside", "exited"].includes(details.status) ? (previous?.admittedAt ?? event.created_at) : null,
            exitedAt: details.status === "exited" ? event.created_at : null,
            cancelledAt: details.status === "cancelled" ? event.created_at : null,
          });
        }
      } catch { /* Ignore malformed legacy details during replay. */ }
    }
    max = Math.max(max, current);
  }
  const pendingTicketNumber = [...status.values()].find((item) => item.value === "issuing")?.ticketNumber ?? null;
  const statements: PreparedStatement[] = [
    database.prepare("UPDATE day_state SET current_count = ?, total_count = ?, max_current = ?, called_ticket_number = ?, next_ticket = CASE WHEN ? IS NULL THEN next_ticket ELSE ? END, revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(current, total, max, called, pendingTicketNumber, pendingTicketNumber, now, dayKey),
    database.prepare("UPDATE visitor_groups SET status = 'cancelled', called_at = NULL, admitted_at = NULL, exited_at = NULL, cancelled_at = ? WHERE day_key = ?").bind(now, dayKey),
  ];
  for (const [groupId, item] of status) {
    statements.push(database.prepare(`UPDATE visitor_groups SET status = ?, ticket_number = ?, called_at = ?, admitted_at = ?, exited_at = ?, cancelled_at = ? WHERE id = ?`).bind(
      item.value,
      item.ticketNumber,
      item.calledAt,
      item.admittedAt,
      item.exitedAt,
      item.cancelledAt,
      groupId,
    ));
  }
  await database.batch(statements);
}

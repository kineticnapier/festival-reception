import { env } from "cloudflare:workers";
import { currentDayKey, getStatus, performAction } from "@/lib/server/reception";

type SocialInput = { label?: string; url?: string; enabled?: boolean };
type AdminInput = {
  sessionId?: string;
  links?: SocialInput[];
  currentCount?: number;
  totalCount?: number;
  nextTicket?: number;
  calledNumber?: number | null;
  groupId?: number;
  status?: string;
  normalCapacity?: number;
  overflowCapacity?: number;
  overflowEnabled?: boolean;
  priorStayMinutes?: number;
};

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

function integer(value: unknown, label: string, min = 0, max = 100_000) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label}は${min}〜${max}で入力してください`);
  return number;
}

function japaneseHour(timestamp: number) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Tokyo", hour: "2-digit", hourCycle: "h23" }).format(timestamp));
}

export async function getAdminDashboard(dayKey = currentDayKey()) {
  const database = db();
  const status = await getStatus(dayKey);
  const groupsResult = await database.prepare(`
    SELECT id, ticket_number, status, party_size, student_count, external_count,
      middle_grade1_count, middle_grade2_count, middle_grade3_count,
      high_grade1_count, high_grade2_count, high_grade3_count,
      male_count, female_count, adult_count, child_count,
      created_at, called_at, admitted_at, exited_at, cancelled_at
    FROM visitor_groups WHERE day_key = ? ORDER BY id DESC LIMIT 500
  `).bind(dayKey).all<Record<string, number | string | null>>();
  const groups = groupsResult.results ?? [];
  const visitors = groups.filter((group) => group.status === "inside" || group.status === "exited");
  const sum = (key: string) => visitors.reduce((total, group) => total + Number(group[key] ?? 0), 0);
  const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, people: 0, groups: 0 }));
  for (const group of visitors) {
    const admittedAt = Number(group.admitted_at ?? 0);
    if (!admittedAt) continue;
    const bucket = hourly[japaneseHour(admittedAt)];
    bucket.people += Number(group.party_size ?? 0);
    bucket.groups += 1;
  }
  const dwell = visitors
    .filter((group) => Number(group.exited_at ?? 0) > Number(group.admitted_at ?? 0))
    .map((group) => (Number(group.exited_at) - Number(group.admitted_at)) / 60_000);
  const sessionsResult = await database.prepare(`
    SELECT id, role, device_label, user_agent, created_at, expires_at, last_seen_at, revoked_at
    FROM auth_sessions ORDER BY created_at DESC LIMIT 100
  `).all<Record<string, number | string | null>>();
  const socialsResult = await database.prepare("SELECT id, label, url, enabled, sort_order FROM social_links ORDER BY sort_order, id").all<Record<string, number | string | null>>();
  const eventsResult = await database.prepare(`
    SELECT id, type, ticket_number, group_id, party_size, details, undone, created_at
    FROM events WHERE day_key = ? ORDER BY id DESC LIMIT 100
  `).bind(dayKey).all<Record<string, number | string | null>>();
  return {
    generatedAt: Date.now(),
    status,
    stats: {
      admittedGroups: visitors.length,
      averagePartySize: visitors.length ? Number((visitors.reduce((total, group) => total + Number(group.party_size), 0) / visitors.length).toFixed(1)) : 0,
      averageDwellMinutes: dwell.length ? Number((dwell.reduce((a, b) => a + b, 0) / dwell.length).toFixed(1)) : null,
      ticketGroups: groups.filter((group) => group.ticket_number != null && !["issuing", "cancelled"].includes(String(group.status))).length,
      source: { students: sum("student_count"), external: sum("external_count") },
      grades: {
        middle1: sum("middle_grade1_count"), middle2: sum("middle_grade2_count"), middle3: sum("middle_grade3_count"),
        high1: sum("high_grade1_count"), high2: sum("high_grade2_count"), high3: sum("high_grade3_count"),
      },
      gender: { male: sum("male_count"), female: sum("female_count") },
      age: { adult: sum("adult_count"), child: sum("child_count") },
      hourly,
    },
    groups,
    sessions: sessionsResult.results ?? [],
    socialLinks: socialsResult.results ?? [],
    events: eventsResult.results ?? [],
  };
}

function validatedLinks(input: SocialInput[]) {
  if (input.length > 8) throw new Error("SNSリンクは8件までです");
  return input.map((link, index) => {
    const label = link.label?.trim().slice(0, 40) ?? "";
    const urlText = link.url?.trim() ?? "";
    if (!label || !urlText) throw new Error(`${index + 1}件目の名前とURLを入力してください`);
    let url: URL;
    try { url = new URL(urlText); } catch { throw new Error(`${label}のURLが正しくありません`); }
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error(`${label}はWebページのURLを指定してください`);
    return { label, url: url.toString(), enabled: link.enabled !== false };
  });
}

export async function performAdminAction(action: string, input: AdminInput, currentAdminSessionId: string | null) {
  const database = db();
  const dayKey = currentDayKey();
  const now = Date.now();

  if (action === "SAVE_SOCIALS") {
    const links = validatedLinks(Array.isArray(input.links) ? input.links : []);
    const statements = [database.prepare("DELETE FROM social_links")];
    links.forEach((link, index) => statements.push(database.prepare("INSERT INTO social_links (label, url, sort_order, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").bind(link.label, link.url, index, link.enabled ? 1 : 0, now, now)));
    statements.push(database.prepare("UPDATE day_state SET revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(now, dayKey));
    await database.batch(statements);
  } else if (action === "REVOKE_SESSION") {
    if (!input.sessionId) throw new Error("ログアウトする端末を選んでください");
    if (input.sessionId === currentAdminSessionId) throw new Error("現在使用中の管理者端末はここではログアウトできません");
    await database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(now, input.sessionId).run();
  } else if (action === "REVOKE_ALL_STAFF") {
    await database.prepare("UPDATE auth_sessions SET revoked_at = ? WHERE role = 'staff' AND revoked_at IS NULL").bind(now).run();
  } else if (action === "CORRECT_STATE") {
    const currentCount = integer(input.currentCount, "現在人数", 0, 1000);
    const totalCount = integer(input.totalCount, "累計人数", currentCount, 100_000);
    const nextTicket = integer(input.nextTicket, "次の整理券番号", 1, 1_000_000);
    const calledNumber = input.calledNumber == null || input.calledNumber === 0 ? null : integer(input.calledNumber, "案内中番号", 1, 1_000_000);
    let calledGroup: { id: number; party_size: number } | null = null;
    const pendingGroup = await database.prepare("SELECT id, ticket_number FROM visitor_groups WHERE day_key = ? AND status = 'issuing' LIMIT 1").bind(dayKey).first<{ id: number; ticket_number: number }>();
    if (calledNumber != null) {
      calledGroup = await database.prepare("SELECT id, party_size FROM visitor_groups WHERE day_key = ? AND ticket_number = ? AND status IN ('waiting','called')").bind(dayKey, calledNumber).first<{ id: number; party_size: number }>() ?? null;
      if (!calledGroup) throw new Error(`${calledNumber}番は待機中ではありません`);
    }
    const opId = crypto.randomUUID();
    if (pendingGroup && pendingGroup.ticket_number !== nextTicket) {
      const conflict = await database.prepare("SELECT id FROM visitor_groups WHERE day_key = ? AND ticket_number = ? AND id != ? LIMIT 1").bind(dayKey, nextTicket, pendingGroup.id).first<{ id: number }>();
      if (conflict) throw new Error(`${nextTicket}番は別の整理券で使用中です`);
    }
    const details = JSON.stringify({ currentCount, totalCount, calledNumber, pendingGroupId: pendingGroup?.id, pendingTicketNumber: pendingGroup ? nextTicket : undefined });
    const statements = [];
    if (pendingGroup && pendingGroup.ticket_number !== nextTicket) statements.push(database.prepare("UPDATE visitor_groups SET ticket_number = ? WHERE id = ? AND status = 'issuing'").bind(nextTicket, pendingGroup.id));
    statements.push(database.prepare("UPDATE visitor_groups SET status = 'waiting', called_at = NULL WHERE day_key = ? AND status = 'called'").bind(dayKey));
    if (calledGroup) statements.push(database.prepare("UPDATE visitor_groups SET status = 'called', called_at = ? WHERE id = ?").bind(now, calledGroup.id));
    statements.push(
      database.prepare("UPDATE day_state SET current_count = ?, total_count = ?, max_current = MAX(max_current, ?), next_ticket = ?, called_ticket_number = ?, revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(currentCount, totalCount, currentCount, nextTicket, calledNumber, now, dayKey),
      database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, details, party_size, created_at) VALUES (?, ?, 'ADMIN_CORRECT', ?, ?, ?, 0, ?)").bind(dayKey, opId, calledNumber, calledGroup?.id ?? null, details, now),
    );
    await database.batch(statements);
  } else if (action === "SET_GROUP_STATUS") {
    const groupId = integer(input.groupId, "グループID", 1, 1_000_000_000);
    const target = input.status;
    if (!target || !["waiting", "called", "inside", "exited", "cancelled"].includes(target)) throw new Error("変更先の状態が正しくありません");
    const group = await database.prepare("SELECT id, ticket_number, status, party_size, admitted_at FROM visitor_groups WHERE day_key = ? AND id = ?").bind(dayKey, groupId).first<{ id: number; ticket_number: number | null; status: string; party_size: number; admitted_at: number | null }>();
    if (!group) throw new Error("グループが見つかりません");
    if (target === "called" && group.ticket_number == null) throw new Error("直接入場のグループは呼出中にできません");
    const oldCurrent = group.status === "inside" ? group.party_size : 0;
    const newCurrent = target === "inside" ? group.party_size : 0;
    const oldTotal = ["inside", "exited"].includes(group.status) ? group.party_size : 0;
    const newTotal = ["inside", "exited"].includes(target) ? group.party_size : 0;
    const day = await database.prepare("SELECT current_count, total_count FROM day_state WHERE day_key = ?").bind(dayKey).first<{ current_count: number; total_count: number }>();
    if (!day) throw new Error("当日の状態を取得できませんでした");
    const afterCurrent = Math.max(0, day.current_count - oldCurrent + newCurrent);
    const afterTotal = Math.max(afterCurrent, day.total_count - oldTotal + newTotal);
    const calledNumber = target === "called" ? group.ticket_number : null;
    const details = JSON.stringify({ groupId, status: target, currentCount: afterCurrent, totalCount: afterTotal, calledNumber });
    const statements = [
      database.prepare("UPDATE visitor_groups SET status = 'waiting', called_at = NULL WHERE day_key = ? AND status = 'called'").bind(dayKey),
      database.prepare(`UPDATE visitor_groups SET status = ?, called_at = ?, admitted_at = ?, exited_at = ?, cancelled_at = ? WHERE id = ?`).bind(
        target,
        target === "called" ? now : null,
        ["inside", "exited"].includes(target) ? (group.admitted_at ?? now) : null,
        target === "exited" ? now : null,
        target === "cancelled" ? now : null,
        groupId,
      ),
      database.prepare("UPDATE day_state SET current_count = ?, total_count = ?, max_current = MAX(max_current, ?), called_ticket_number = ?, revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(afterCurrent, afterTotal, afterCurrent, calledNumber, now, dayKey),
      database.prepare("INSERT INTO events (day_key, op_id, type, ticket_number, group_id, details, party_size, created_at) VALUES (?, ?, 'ADMIN_GROUP_STATUS', ?, ?, ?, ?, ?)").bind(dayKey, crypto.randomUUID(), group.ticket_number, groupId, details, group.party_size, now),
    ];
    await database.batch(statements);
  } else if (["SETTINGS", "RESET_DAY", "UNDO_LAST"].includes(action)) {
    await performAction(action, input);
  } else {
    throw new Error("不明な管理操作です");
  }
  return getAdminDashboard(dayKey);
}

export async function exportGroupsCsv(dayKey = currentDayKey()) {
  const result = await db().prepare(`
    SELECT id, ticket_number, status, party_size, student_count, external_count,
      middle_grade1_count, middle_grade2_count, middle_grade3_count,
      high_grade1_count, high_grade2_count, high_grade3_count,
      male_count, female_count, adult_count, child_count,
      created_at, called_at, admitted_at, exited_at, cancelled_at
    FROM visitor_groups WHERE day_key = ? ORDER BY id
  `).bind(dayKey).all<Record<string, number | string | null>>();
  const headers = ["group_id","ticket_number","status","party_size","student","external","middle_1","middle_2","middle_3","high_1","high_2","high_3","male","female","adult","child","created_at","called_at","admitted_at","exited_at","cancelled_at"];
  const keys = ["id","ticket_number","status","party_size","student_count","external_count","middle_grade1_count","middle_grade2_count","middle_grade3_count","high_grade1_count","high_grade2_count","high_grade3_count","male_count","female_count","adult_count","child_count","created_at","called_at","admitted_at","exited_at","cancelled_at"];
  const cell = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [headers.join(","), ...(result.results ?? []).map((row) => keys.map((key) => cell(row[key])).join(","))].join("\r\n");
}

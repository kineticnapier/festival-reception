import { env } from "cloudflare:workers";
import { splitGroupCounts, splitPartySizes, type SplittableGroup } from "@/lib/group-split";
import { currentDayKey, getStatus } from "@/lib/server/reception";

type GroupInput = {
  partySize?: number;
  studentCount?: number | null; externalCount?: number | null;
  grade1Count?: number | null; grade2Count?: number | null; grade3Count?: number | null;
  middleGrade1Count?: number | null; middleGrade2Count?: number | null; middleGrade3Count?: number | null;
  highGrade1Count?: number | null; highGrade2Count?: number | null; highGrade3Count?: number | null;
  maleCount?: number | null; femaleCount?: number | null;
  adultCount?: number | null; childCount?: number | null;
  requestId?: string;
};

type DaySettings = {
  next_ticket: number;
  normal_capacity: number;
  overflow_capacity: number;
  overflow_enabled: number;
};

function db() {
  if (!env.DB) throw new Error("D1 binding DB is unavailable");
  return env.DB;
}

function asOptionalCount(value: unknown, label: string) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 50) throw new Error(`${label}は0〜50人で入力してください`);
  return number;
}

function normalizeGroup(input: GroupInput): SplittableGroup {
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize < 1 || partySize > 30) throw new Error("グループ人数は1〜30人で入力してください");
  const group: SplittableGroup = {
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

function insertGroup(dayKey: string, ticketNumber: number, group: SplittableGroup, now: number) {
  return db().prepare(`
    INSERT INTO visitor_groups (
      day_key, ticket_number, status, party_size,
      student_count, external_count,
      grade1_count, grade2_count, grade3_count,
      middle_grade1_count, middle_grade2_count, middle_grade3_count,
      high_grade1_count, high_grade2_count, high_grade3_count,
      male_count, female_count, adult_count, child_count, created_at, admitted_at
    ) VALUES (?, ?, 'issuing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `).bind(
    dayKey, ticketNumber, group.partySize,
    group.studentCount, group.externalCount,
    group.middleGrade1Count, group.middleGrade2Count, group.middleGrade3Count,
    group.middleGrade1Count, group.middleGrade2Count, group.middleGrade3Count,
    group.highGrade1Count, group.highGrade2Count, group.highGrade3Count,
    group.maleCount, group.femaleCount, group.adultCount, group.childCount, now,
  );
}

function insertReserveEvent(dayKey: string, requestId: string, ticketNumber: number, partySize: number, now: number) {
  return db().prepare(`
    INSERT INTO events (day_key, op_id, type, ticket_number, group_id, party_size, created_at)
    SELECT ?, ?, 'QUEUE_RESERVE', ?, id, ?, ?
    FROM visitor_groups
    WHERE day_key = ? AND ticket_number = ? AND status = 'issuing'
    ORDER BY id DESC LIMIT 1
  `).bind(dayKey, requestId, ticketNumber, partySize, now, dayKey, ticketNumber);
}

export async function createSplitQueueIfNeeded(input: GroupInput) {
  const database = db();
  const dayKey = currentDayKey();
  const now = Date.now();
  await database.prepare("INSERT INTO day_state (day_key, updated_at) VALUES (?, ?) ON CONFLICT(day_key) DO NOTHING").bind(dayKey, now).run();

  const day = await database.prepare("SELECT next_ticket, normal_capacity, overflow_capacity, overflow_enabled FROM day_state WHERE day_key = ?").bind(dayKey).first<DaySettings>();
  if (!day) throw new Error("当日の状態を取得できませんでした");
  const activeCapacity = day.overflow_enabled ? day.overflow_capacity : day.normal_capacity;
  const partySize = Number(input.partySize);
  if (!Number.isInteger(partySize) || partySize <= activeCapacity) return null;

  const pending = await database.prepare("SELECT ticket_number FROM visitor_groups WHERE day_key = ? AND status = 'issuing' LIMIT 1").bind(dayKey).first<{ ticket_number: number }>();
  if (pending) throw new Error(`${pending.ticket_number}番の「紙を渡した」を先に確認してください`);

  const group = normalizeGroup(input);
  const sizes = splitPartySizes(group.partySize, activeCapacity);
  const groups = splitGroupCounts(group, sizes);
  const tickets = sizes.map((_, index) => day.next_ticket + index);
  const requestId = typeof input.requestId === "string" && input.requestId.trim() ? input.requestId.trim() : crypto.randomUUID();

  const statements = [];
  // getStatus() shows the newest issuing row. Insert in reverse so the smallest ticket is handed out first.
  for (let index = groups.length - 1; index >= 0; index -= 1) statements.push(insertGroup(dayKey, tickets[index], groups[index], now));
  statements.push(database.prepare("UPDATE day_state SET revision = revision + 1, updated_at = ? WHERE day_key = ?").bind(now, dayKey));
  for (let index = groups.length - 1; index >= 0; index -= 1) statements.push(insertReserveEvent(dayKey, requestId, tickets[index], groups[index].partySize, now));
  await database.batch(statements);

  return {
    status: await getStatus(dayKey, undefined, { skipEnsure: true }),
    issuedTicket: `${tickets[0]}〜${tickets[tickets.length - 1]}`,
    splitTickets: tickets,
    splitSizes: sizes,
  };
}

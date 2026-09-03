import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true },
});
const { calculateQueueGuidance } = await vite.ssrLoadModule("/lib/queue-guidance.ts");

after(async () => {
  await vite.close();
});

const now = 1_000_000;
function group(ticketNumber, partySize, waitMinutes, id = ticketNumber) {
  return { id, ticketNumber, partySize, createdAt: now - waitMinutes * 60_000 };
}
function guidance({ currentCount, waiting, reserveWaitMinutes = 20, capacity = 13, cycleMinutes = 2.5 }) {
  return calculateQueueGuidance({ capacity, currentCount, cycleMinutes, reserveWaitMinutes, now, waiting });
}

test("空きに入る1グループだけを優先度最大で推奨する", () => {
  const result = guidance({
    currentCount: 10,
    waiting: [group(1, 4, 8), group(2, 3, 2), group(3, 2, 5)],
  });
  assert.equal(result.mode, "recommended");
  assert.equal(result.target.ticketNumber, 3);
  assert.equal(result.target.priority, 4);
});

test("人数差より十分長い待ち時間を優先する", () => {
  const result = guidance({
    currentCount: 8,
    waiting: [group(1, 5, 0), group(2, 4, 2.5), group(3, 3, 7.5)],
  });
  assert.equal(result.target.ticketNumber, 3);
  assert.equal(result.target.priority, 6);
});

test("確保対象が入れない間は他グループを推奨しない", () => {
  const result = guidance({
    currentCount: 10,
    reserveWaitMinutes: 5,
    waiting: [group(18, 4, 6), group(19, 3, 1)],
  });
  assert.equal(result.mode, "reserving");
  assert.equal(result.target.ticketNumber, 18);
  assert.equal(result.seatsNeeded, 1);
});

test("確保対象が入れる空きになればその1組を推奨する", () => {
  const result = guidance({
    currentCount: 9,
    reserveWaitMinutes: 5,
    waiting: [group(18, 4, 6), group(19, 3, 10)],
  });
  assert.equal(result.mode, "reserve-ready");
  assert.equal(result.target.ticketNumber, 19);
  assert.equal(result.seatsNeeded, 0);
});

test("同点では待ち時間が長いグループを優先する", () => {
  const result = guidance({
    currentCount: 8,
    waiting: [group(1, 5, 0), group(2, 4, 2.5)],
  });
  assert.equal(result.target.ticketNumber, 2);
});

test("同じ優先度と受付時刻なら整理券番号が小さい方を選ぶ", () => {
  const result = guidance({
    currentCount: 10,
    waiting: [group(8, 2, 2), group(7, 2, 2)],
  });
  assert.equal(result.target.ticketNumber, 7);
});

test("定員超過グループは空き確保で全体を停止させない", () => {
  const result = guidance({
    currentCount: 10,
    reserveWaitMinutes: 5,
    waiting: [group(1, 14, 30), group(2, 3, 1)],
  });
  assert.equal(result.mode, "recommended");
  assert.equal(result.target.ticketNumber, 2);
  assert.equal(result.oversizedCount, 1);
});

test("待ち時間予測も実際の優先度順を使う", async () => {
  const { estimateQueueWaitMinutes } = await vite.ssrLoadModule("/lib/queue-guidance.ts");
  const estimates = estimateQueueWaitMinutes({
    capacity: 5,
    stayMinutes: 2.5,
    cycleMinutes: 2.5,
    reserveWaitMinutes: 20,
    now,
    inside: [],
    waiting: [group(1, 5, 0), group(2, 3, 7.5)],
  });
  assert.equal(estimates.get(2), 0);
  assert.equal(estimates.get(1), 3);
});

test("案内中グループの席を待ち時間予測でも予約する", async () => {
  const { estimateQueueWaitMinutes } = await vite.ssrLoadModule("/lib/queue-guidance.ts");
  const estimates = estimateQueueWaitMinutes({
    capacity: 13,
    stayMinutes: 2.5,
    cycleMinutes: 2.5,
    reserveWaitMinutes: 20,
    now,
    inside: [{ id: 100, partySize: 10, admittedAt: now }],
    called: group(50, 3, 1, 50),
    waiting: [group(51, 2, 1, 51)],
  });
  assert.equal(estimates.get(51), 3);
});

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
  server: { middlewareMode: true, hmr: false },
});
const { pickSplitContinuation } = await vite.ssrLoadModule("/lib/split-continuation.ts");

after(async () => {
  await vite.close();
});

function score(id, ticketNumber, partySize, priority, eligibleNow = true) {
  return { id, ticketNumber, partySize, createdAt: 0, waitMinutes: 0, priority, eligibleNow };
}

test("同じ団体の残りが今すぐ入れるなら通常優先度より先に選ぶ", () => {
  const target = pickSplitContinuation(
    [score(20, 20, 3, 99), score(12, 12, 15, 10)],
    [
      { groupId: 11, cohortId: "split-a", status: "inside" },
      { groupId: 12, cohortId: "split-a", status: "waiting" },
    ],
  );
  assert.equal(target?.ticketNumber, 12);
});

test("同じ団体でも空きに入らない間は優先しない", () => {
  const target = pickSplitContinuation(
    [score(12, 12, 15, 10, false), score(20, 20, 3, 9, true)],
    [
      { groupId: 11, cohortId: "split-a", status: "inside" },
      { groupId: 12, cohortId: "split-a", status: "waiting" },
    ],
  );
  assert.equal(target, null);
});

test("同団体の先行グループが中にいなければ特別扱いしない", () => {
  const target = pickSplitContinuation(
    [score(12, 12, 10, 10)],
    [
      { groupId: 11, cohortId: "split-a", status: "waiting" },
      { groupId: 12, cohortId: "split-a", status: "waiting" },
    ],
  );
  assert.equal(target, null);
});

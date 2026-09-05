import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({
  appType: "custom",
  configFile: false,
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
});

const {
  AUTH_BLOCK_MS,
  AUTH_FAILURE_LIMIT,
  AUTH_WINDOW_MS,
  nextAuthFailureState,
  normalizeRequestId,
  retryAfterSeconds,
} = await vite.ssrLoadModule("/lib/safety.ts");

after(async () => {
  await vite.close();
});

test("requestIdは空文字・長すぎる値を受け付けない", () => {
  assert.equal(normalizeRequestId("  abc-123  "), "abc-123");
  assert.equal(normalizeRequestId("   "), null);
  assert.equal(normalizeRequestId("x".repeat(101)), null);
  assert.equal(normalizeRequestId(undefined), null);
});

test("PIN失敗は5回で一時ロックになる", () => {
  const now = 1_000_000;
  let state = null;
  for (let i = 1; i <= AUTH_FAILURE_LIMIT; i += 1) {
    state = nextAuthFailureState(state, now + i);
    assert.equal(state.failureCount, i);
  }
  assert.ok(state.blockedUntil >= now + AUTH_BLOCK_MS);
  assert.ok(retryAfterSeconds(state.blockedUntil, now) > 0);
});

test("PIN失敗の集計窓を過ぎると1回目から数え直す", () => {
  const now = 1_000_000;
  const previous = { failureCount: 4, windowStartedAt: now, blockedUntil: 0 };
  const next = nextAuthFailureState(previous, now + AUTH_WINDOW_MS + 1);
  assert.equal(next.failureCount, 1);
  assert.equal(next.blockedUntil, 0);
});

test("公開整理券取得はスタッフ認証分岐より先に処理する", async () => {
  const source = await readFile(new URL("../app/api/status/route.ts", import.meta.url), "utf8");
  const ticketBranch = source.indexOf("if (ticketText != null)");
  const staffCheck = source.indexOf("verifyStaffSession(request)");
  assert.ok(ticketBranch >= 0);
  assert.ok(staffCheck >= 0);
  assert.ok(ticketBranch < staffCheck);
});

test("受付と管理の更新は同じD1 mutation guardを通る", async () => {
  const receptionRoute = await readFile(new URL("../app/api/actions/route.ts", import.meta.url), "utf8");
  const adminRoute = await readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8");
  const guard = await readFile(new URL("../lib/server/operation-guard.ts", import.meta.url), "utf8");
  assert.match(receptionRoute, /runIdempotentMutation/);
  assert.match(adminRoute, /runIdempotentMutation/);
  assert.match(guard, /mutation_locks/);
  assert.match(guard, /operation_requests/);
  assert.match(guard, /response_json/);
  assert.match(guard, /ensureHardeningSchema/);
});

test("直接入場も紙整理券の受け渡しを経て入場状態になる", async () => {
  const route = await readFile(new URL("../app/api/actions/route.ts", import.meta.url), "utf8");
  const directTicket = await readFile(new URL("../lib/server/direct-entry-ticket.ts", import.meta.url), "utf8");
  assert.match(route, /prepareDirectEntryTicket/);
  assert.match(route, /confirmDirectTicketHandoff/);
  assert.match(directTicket, /performAction\("QUEUE_CREATE_GROUP"/);
  assert.match(directTicket, /requestId: `direct:\$\{directRequestId\}`/);
  assert.match(directTicket, /g\.status = 'issuing'/);
  assert.match(directTicket, /SET status = 'inside', admitted_at = \?/);
  assert.match(directTicket, /SELECT \?, \?, 'ADMIT'/);
  assert.match(directTicket, /next_ticket = MAX\(next_ticket, \?\)/);
});

test("番号指定呼出はUIとサーバーの両方で空き不足を防ぐ", async () => {
  const route = await readFile(new URL("../app/api/actions/route.ts", import.meta.url), "utf8");
  const guard = await readFile(new URL("../lib/server/manual-call-guard.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../app/reception-page.tsx", import.meta.url), "utf8");
  assert.match(route, /assertManualCallFits\(input\.ticketNumber, dayKey\)/);
  assert.match(guard, /group\.party_size > freeSeats/);
  assert.match(guard, /status = 'waiting'/);
  assert.match(page, /item\.party_size <= status\.guidance\.freeSeats/);
  assert.match(page, /案内可/);
});

test("手動修正はタブを開いた時の最新revisionを使い、古い値の上書きを拒否する", async () => {
  const page = await readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../lib/server/admin.ts", import.meta.url), "utf8");
  assert.match(page, /if \(value !== "correct"\) return/);
  assert.match(page, /const latest = await refresh\(\)/);
  assert.match(page, /expectedRevision: correctionRevision/);
  assert.match(admin, /revisionRow\.revision !== expectedRevision/);
  assert.match(admin, /AND revision = \?/);
});

test("詳細内訳は従来どおり詳細選択時にまとめて入力する", async () => {
  const page = await readFile(new URL("../app/reception-page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /sourceKnown|genderKnown|ageKnown/);
  assert.match(page, /setMaleCount\(\(current\) => current \?\? Math\.round\(partySize \/ 2\)\)/);
  assert.match(page, /setAdultCount\(\(current\) => current \?\? Math\.round\(partySize \/ 2\)\)/);
  assert.match(page, /SplitSlider title="在校生 \/ 外部"/);
  assert.match(page, /SplitSlider title="男女"/);
  assert.match(page, /SplitSlider title="大人 \/ 子供"/);
  assert.match(page, /if \(success\) clearBreakdowns\(\)/);
});

test("受付画面は同期経過秒を表示する", async () => {
  const page = await readFile(new URL("../app/reception-page.tsx", import.meta.url), "utf8");
  assert.match(page, /lastSyncAt/);
  assert.match(page, /同期済み・\$\{syncAge\}秒前/);
});

test("公開待ちページは番号なしで読み込み続けず、案内順の断定を弱める", async () => {
  const page = await readFile(new URL("../app/wait/page.tsx", import.meta.url), "utf8");
  assert.match(page, /整理券番号がありません/);
  assert.match(page, /参考：番号上、先に発行された待機/);
  assert.match(page, /function isNear/);
  assert.doesNotMatch(page, /あなたより前の受付/);
});

test("操作ごとの取り消しは既存の完了ポップアップ内のボタンから対象op_idだけを戻す", async () => {
  const route = await readFile(new URL("../app/api/actions/route.ts", import.meta.url), "utf8");
  const undo = await readFile(new URL("../lib/server/operation-undo.ts", import.meta.url), "utf8");
  const feedback = await readFile(new URL("../app/operation-undo-feedback.tsx", import.meta.url), "utf8");
  assert.match(route, /UNDO_OPERATION/);
  assert.match(route, /operationEventId/);
  assert.match(undo, /op_id = \? AND undone = 0/);
  assert.match(undo, /id > \?/);
  assert.match(undo, /group_id IN/);
  assert.match(undo, /UPDATE events SET undone = 1/);
  assert.match(feedback, /toastApi\.success = wrappedSuccess/);
  assert.match(feedback, /withUndoAction/);
  assert.match(feedback, /label: "取り消す"/);
  assert.match(feedback, /duration: options\?\.duration \?\? 6000/);
  assert.match(feedback, /UNDO_OPERATION/);
  assert.doesNotMatch(feedback, /この操作は取り消せます/);
  assert.doesNotMatch(feedback, /MutationObserver/);
});

test("hardeningテーブルはWorker自身が安全に初期化できる", async () => {
  const schema = await readFile(new URL("../lib/server/hardening-schema.ts", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0005_festival_hardening.sql", import.meta.url), "utf8");
  assert.match(schema, /CREATE TABLE IF NOT EXISTS operation_requests/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS mutation_locks/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS auth_rate_limits/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS/);
});

test("CIはmigrationをローカル検証してからbuild・test・deployする", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  const localMigration = workflow.indexOf("migrations apply DB --local");
  const build = workflow.indexOf("npm run build");
  const tests = workflow.indexOf("npm test");
  const deploy = workflow.indexOf("npx wrangler deploy");
  assert.ok(localMigration >= 0);
  assert.ok(build >= 0);
  assert.ok(tests >= 0);
  assert.ok(deploy >= 0);
  assert.ok(localMigration < build);
  assert.ok(build < tests);
  assert.ok(tests < deploy);
  assert.doesNotMatch(workflow, /migrations apply DB --remote/);
});

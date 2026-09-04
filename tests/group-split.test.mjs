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
const { splitPartySizes, splitGroupCounts } = await vite.ssrLoadModule("/lib/group-split.ts");

after(async () => {
  await vite.close();
});

test("定員17人で30人を15人ずつに分ける", () => {
  assert.deepEqual(splitPartySizes(30, 17), [15, 15]);
});

test("定員17人で18人を9人ずつに分ける", () => {
  assert.deepEqual(splitPartySizes(18, 17), [9, 9]);
});

test("3組必要な場合もなるべく均等にする", () => {
  assert.deepEqual(splitPartySizes(30, 13), [10, 10, 10]);
});

test("定員以内なら分割しない", () => {
  assert.deepEqual(splitPartySizes(17, 17), [17]);
});

test("詳細内訳も合計を保ったまま分配する", () => {
  const source = {
    partySize: 30,
    studentCount: 12,
    externalCount: 18,
    middleGrade1Count: 3,
    middleGrade2Count: 3,
    middleGrade3Count: 2,
    highGrade1Count: 2,
    highGrade2Count: 2,
    highGrade3Count: 0,
    maleCount: 17,
    femaleCount: 13,
    adultCount: 18,
    childCount: 12,
  };
  const parts = splitGroupCounts(source, [15, 15]);
  assert.deepEqual(parts.map((part) => part.partySize), [15, 15]);
  for (const part of parts) {
    assert.equal(part.studentCount + part.externalCount, part.partySize);
    assert.equal(part.maleCount + part.femaleCount, part.partySize);
    assert.equal(part.adultCount + part.childCount, part.partySize);
    const grades = part.middleGrade1Count + part.middleGrade2Count + part.middleGrade3Count + part.highGrade1Count + part.highGrade2Count + part.highGrade3Count;
    assert.ok(grades <= part.studentCount);
  }
  assert.equal(parts.reduce((sum, part) => sum + part.studentCount, 0), source.studentCount);
  assert.equal(parts.reduce((sum, part) => sum + part.maleCount, 0), source.maleCount);
  assert.equal(parts.reduce((sum, part) => sum + part.adultCount, 0), source.adultCount);
});

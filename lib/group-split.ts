export type SplittableGroup = {
  partySize: number;
  studentCount: number | null;
  externalCount: number | null;
  middleGrade1Count: number | null;
  middleGrade2Count: number | null;
  middleGrade3Count: number | null;
  highGrade1Count: number | null;
  highGrade2Count: number | null;
  highGrade3Count: number | null;
  maleCount: number | null;
  femaleCount: number | null;
  adultCount: number | null;
  childCount: number | null;
};

const gradeKeys = [
  "middleGrade1Count",
  "middleGrade2Count",
  "middleGrade3Count",
  "highGrade1Count",
  "highGrade2Count",
  "highGrade3Count",
] as const;

export function splitPartySizes(total: number, capacity: number) {
  if (!Number.isInteger(total) || total < 1) throw new Error("グループ人数が不正です");
  if (!Number.isInteger(capacity) || capacity < 1) throw new Error("定員が不正です");

  const partCount = Math.ceil(total / capacity);
  const base = Math.floor(total / partCount);
  const remainder = total % partCount;
  return Array.from({ length: partCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

export function distributeCount(total: number, capacities: number[]) {
  const capacityTotal = capacities.reduce((sum, value) => sum + value, 0);
  if (!Number.isInteger(total) || total < 0 || total > capacityTotal) throw new Error("内訳人数が不正です");
  if (capacities.some((value) => !Number.isInteger(value) || value < 0)) throw new Error("分割定員が不正です");
  if (total === 0) return capacities.map(() => 0);
  if (capacityTotal === 0) throw new Error("内訳を分割できません");

  const raw = capacities.map((capacity) => total * capacity / capacityTotal);
  const result = raw.map((value) => Math.floor(value));
  let remaining = total - result.reduce((sum, value) => sum + value, 0);
  const order = capacities
    .map((capacity, index) => ({ index, fraction: raw[index] - result[index], room: capacity - result[index] }))
    .filter((item) => item.room > 0)
    .sort((a, b) => b.fraction - a.fraction || b.room - a.room || a.index - b.index);

  for (const item of order) {
    if (remaining <= 0) break;
    result[item.index] += 1;
    remaining -= 1;
  }
  if (remaining !== 0) throw new Error("内訳を分割できません");
  return result;
}

export function splitGroupCounts(group: SplittableGroup, sizes: number[]) {
  if (sizes.reduce((sum, value) => sum + value, 0) !== group.partySize) throw new Error("分割人数の合計が一致しません");
  const groups: SplittableGroup[] = sizes.map((partySize) => ({
    partySize,
    studentCount: null,
    externalCount: null,
    middleGrade1Count: null,
    middleGrade2Count: null,
    middleGrade3Count: null,
    highGrade1Count: null,
    highGrade2Count: null,
    highGrade3Count: null,
    maleCount: null,
    femaleCount: null,
    adultCount: null,
    childCount: null,
  }));

  if (group.studentCount != null && group.externalCount != null) {
    const students = distributeCount(group.studentCount, sizes);
    groups.forEach((item, index) => {
      item.studentCount = students[index];
      item.externalCount = item.partySize - students[index];
    });

    const gradeCapacities = [...students];
    for (const key of gradeKeys) {
      const total = group[key] ?? 0;
      const allocation = distributeCount(total, gradeCapacities);
      groups.forEach((item, index) => {
        item[key] = allocation[index];
        gradeCapacities[index] -= allocation[index];
      });
    }
  }

  if (group.maleCount != null && group.femaleCount != null) {
    const male = distributeCount(group.maleCount, sizes);
    groups.forEach((item, index) => {
      item.maleCount = male[index];
      item.femaleCount = item.partySize - male[index];
    });
  }

  if (group.adultCount != null && group.childCount != null) {
    const adults = distributeCount(group.adultCount, sizes);
    groups.forEach((item, index) => {
      item.adultCount = adults[index];
      item.childCount = item.partySize - adults[index];
    });
  }

  return groups;
}

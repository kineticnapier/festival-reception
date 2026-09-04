import type { ScoredQueueGroup } from "@/lib/queue-guidance";

export type SplitCohortMembership = {
  groupId: number;
  cohortId: string;
  status: "waiting" | "inside";
};

export function pickSplitContinuation(
  scores: ScoredQueueGroup[],
  memberships: SplitCohortMembership[],
) {
  const insideCohorts = new Set(
    memberships
      .filter((membership) => membership.status === "inside")
      .map((membership) => membership.cohortId),
  );
  if (!insideCohorts.size) return null;

  const waitingCohortByGroup = new Map(
    memberships
      .filter((membership) => membership.status === "waiting")
      .map((membership) => [membership.groupId, membership.cohortId] as const),
  );

  return scores.find((group) => {
    if (!group.eligibleNow) return false;
    const cohortId = waitingCohortByGroup.get(group.id);
    return cohortId != null && insideCohorts.has(cohortId);
  }) ?? null;
}

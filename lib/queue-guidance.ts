export type QueueGroupInput = {
  id: number;
  ticketNumber: number;
  partySize: number;
  createdAt: number;
};

export type ScoredQueueGroup = QueueGroupInput & {
  waitMinutes: number;
  priority: number;
  eligibleNow: boolean;
};

export type QueueGuidance = {
  mode: "recommended" | "reserve-ready" | "reserving" | "no-fit" | "empty";
  capacity: number;
  currentCount: number;
  freeSeats: number;
  cycleMinutes: number;
  reserveWaitMinutes: number;
  target: ScoredQueueGroup | null;
  seatsNeeded: number;
  oversizedCount: number;
  scores: ScoredQueueGroup[];
};

export type InsideGroupForEstimate = {
  id: number;
  partySize: number;
  admittedAt: number | null;
};

function compareGroups(a: ScoredQueueGroup, b: ScoredQueueGroup) {
  const priorityDifference = b.priority - a.priority;
  if (Math.abs(priorityDifference) > 1e-9) return priorityDifference;
  const waitDifference = b.waitMinutes - a.waitMinutes;
  if (Math.abs(waitDifference) > 1e-9) return waitDifference;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.ticketNumber - b.ticketNumber;
}

export function calculateQueueGuidance(input: {
  capacity: number;
  currentCount: number;
  cycleMinutes: number;
  reserveWaitMinutes: number;
  now: number;
  waiting: QueueGroupInput[];
}): QueueGuidance {
  const capacity = Math.max(1, input.capacity);
  const currentCount = Math.max(0, input.currentCount);
  const freeSeats = Math.max(0, capacity - currentCount);
  const cycleMinutes = Math.max(0.1, input.cycleMinutes);
  const reserveWaitMinutes = Math.max(0, input.reserveWaitMinutes);
  const scores = input.waiting.map((group) => {
    const waitMinutes = Math.max(0, (input.now - group.createdAt) / 60_000);
    return {
      ...group,
      waitMinutes,
      priority: group.partySize + waitMinutes / cycleMinutes,
      eligibleNow: group.partySize <= freeSeats,
    };
  }).sort(compareGroups);

  const serviceable = scores.filter((group) => group.partySize <= capacity);
  const reserveTargets = serviceable.filter((group) => group.waitMinutes >= reserveWaitMinutes);
  const reserveTarget = reserveTargets[0] ?? null;
  if (reserveTarget) {
    const seatsNeeded = Math.max(0, reserveTarget.partySize - freeSeats);
    return {
      mode: seatsNeeded > 0 ? "reserving" : "reserve-ready",
      capacity,
      currentCount,
      freeSeats,
      cycleMinutes,
      reserveWaitMinutes,
      target: reserveTarget,
      seatsNeeded,
      oversizedCount: scores.length - serviceable.length,
      scores,
    };
  }

  const target = serviceable.find((group) => group.eligibleNow) ?? null;
  return {
    mode: target ? "recommended" : (scores.length ? "no-fit" : "empty"),
    capacity,
    currentCount,
    freeSeats,
    cycleMinutes,
    reserveWaitMinutes,
    target,
    seatsNeeded: 0,
    oversizedCount: scores.length - serviceable.length,
    scores,
  };
}

/**
 * Estimate each waiting group's admission time using the same one-group-at-a-time
 * priority/reservation rules as the real call logic.
 *
 * The currently-called group is treated as entering immediately, so its seats stay
 * reserved while estimating the groups behind it. Direct walk-ins after `now` are
 * intentionally not predicted.
 */
export function estimateQueueWaitMinutes(input: {
  capacity: number;
  stayMinutes: number;
  cycleMinutes: number;
  reserveWaitMinutes: number;
  now: number;
  inside: InsideGroupForEstimate[];
  called?: QueueGroupInput | null;
  waiting: QueueGroupInput[];
}) {
  const capacity = Math.max(1, input.capacity);
  const stayMinutes = Math.max(0.1, input.stayMinutes);
  const estimates = new Map<number, number | null>();
  const remaining = input.waiting.filter((group) => {
    if (group.partySize <= capacity) return true;
    estimates.set(group.id, null);
    return false;
  });

  let occupancy = input.inside.reduce((sum, group) => sum + Math.max(0, group.partySize), 0);
  const departures = input.inside.map((group) => ({
    at: Math.max(input.now, (group.admittedAt ?? input.now) + stayMinutes * 60_000),
    size: Math.max(0, group.partySize),
  }));

  if (input.called && input.called.partySize <= capacity) {
    occupancy += input.called.partySize;
    departures.push({ at: input.now + stayMinutes * 60_000, size: input.called.partySize });
  }

  departures.sort((a, b) => a.at - b.at);
  let simulatedNow = input.now;
  let guard = 0;

  while (remaining.length > 0 && guard < 10_000) {
    guard += 1;
    const guidance = calculateQueueGuidance({
      capacity,
      currentCount: occupancy,
      cycleMinutes: input.cycleMinutes,
      reserveWaitMinutes: input.reserveWaitMinutes,
      now: simulatedNow,
      waiting: remaining,
    });

    const target = guidance.target;
    if (target && target.partySize <= Math.max(0, capacity - occupancy) && guidance.mode !== "reserving") {
      estimates.set(target.id, Math.max(0, Math.ceil((simulatedNow - input.now) / 60_000)));
      occupancy += target.partySize;
      departures.push({ at: simulatedNow + stayMinutes * 60_000, size: target.partySize });
      departures.sort((a, b) => a.at - b.at);
      const index = remaining.findIndex((group) => group.id === target.id);
      if (index >= 0) remaining.splice(index, 1);
      continue;
    }

    const nextDeparture = departures[0]?.at;
    if (nextDeparture == null) {
      for (const group of remaining) estimates.set(group.id, null);
      break;
    }

    simulatedNow = Math.max(simulatedNow, nextDeparture);
    while (departures.length > 0 && departures[0].at <= simulatedNow) {
      occupancy = Math.max(0, occupancy - departures.shift()!.size);
    }
  }

  if (guard >= 10_000) {
    for (const group of remaining) if (!estimates.has(group.id)) estimates.set(group.id, null);
  }

  return estimates;
}

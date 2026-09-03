export const AUTH_FAILURE_LIMIT = 5;
export const AUTH_WINDOW_MS = 5 * 60_000;
export const AUTH_BLOCK_MS = 60_000;

export type AuthAttemptState = {
  failureCount: number;
  windowStartedAt: number;
  blockedUntil: number;
};

export function normalizeRequestId(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= 100 ? trimmed : null;
}

export function nextAuthFailureState(previous: AuthAttemptState | null, now: number): AuthAttemptState {
  const windowExpired = previous == null || previous.windowStartedAt <= now - AUTH_WINDOW_MS;
  const failureCount = windowExpired ? 1 : previous.failureCount + 1;
  return {
    failureCount,
    windowStartedAt: windowExpired ? now : previous.windowStartedAt,
    blockedUntil: failureCount >= AUTH_FAILURE_LIMIT ? now + AUTH_BLOCK_MS : 0,
  };
}

export function retryAfterSeconds(blockedUntil: number, now: number) {
  return blockedUntil > now ? Math.max(1, Math.ceil((blockedUntil - now) / 1000)) : 0;
}

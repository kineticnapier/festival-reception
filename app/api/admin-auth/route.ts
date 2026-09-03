import {
  adminSessionCookie,
  checkAuthRateLimit,
  clearAdminSessionCookie,
  clearAuthFailures,
  currentSessionId,
  recordAuthFailure,
  revokeCurrentSession,
  verifyAdminPin,
  verifyAdminSession,
} from "@/lib/server/staff-auth";

const noStore = { "cache-control": "no-store" };

function rateLimited(retryAfterSeconds: number) {
  return Response.json(
    { error: `管理者PINの試行回数が多すぎます。${retryAfterSeconds}秒後にもう一度お試しください` },
    { status: 429, headers: { ...noStore, "retry-after": String(retryAfterSeconds) } },
  );
}

export async function GET(request: Request) {
  return Response.json({ authenticated: await verifyAdminSession(request), sessionId: await currentSessionId(request, "admin") }, { headers: noStore });
}

export async function POST(request: Request) {
  try {
    const limit = await checkAuthRateLimit(request, "admin");
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const body = await request.json() as { pin?: string; deviceLabel?: string };
    if (!body.pin || !verifyAdminPin(body.pin)) {
      const failed = await recordAuthFailure(request, "admin");
      if (failed.retryAfterSeconds > 0) return rateLimited(failed.retryAfterSeconds);
      return Response.json({ error: "管理者PINが違います" }, { status: 401, headers: noStore });
    }

    await clearAuthFailures(request, "admin");
    return Response.json({ authenticated: true }, { headers: { ...noStore, "set-cookie": await adminSessionCookie(body.deviceLabel, request.headers.get("user-agent") ?? undefined) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "認証できませんでした" }, { status: 500, headers: noStore });
  }
}

export async function DELETE(request: Request) {
  await revokeCurrentSession(request, "admin");
  return Response.json({ authenticated: false }, { headers: { ...noStore, "set-cookie": clearAdminSessionCookie() } });
}

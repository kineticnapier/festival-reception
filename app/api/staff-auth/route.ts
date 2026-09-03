import {
  checkAuthRateLimit,
  clearAuthFailures,
  clearStaffSessionCookie,
  recordAuthFailure,
  revokeCurrentSession,
  staffSessionCookie,
  verifyStaffPin,
  verifyStaffSession,
} from "@/lib/server/staff-auth";

const noStore = { "cache-control": "no-store" };

function rateLimited(retryAfterSeconds: number) {
  return Response.json(
    { error: `暗証番号の試行回数が多すぎます。${retryAfterSeconds}秒後にもう一度お試しください` },
    { status: 429, headers: { ...noStore, "retry-after": String(retryAfterSeconds) } },
  );
}

export async function GET(request: Request) {
  return Response.json({ authenticated: await verifyStaffSession(request) }, { headers: noStore });
}

export async function POST(request: Request) {
  try {
    const limit = await checkAuthRateLimit(request, "staff");
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const body = await request.json() as { pin?: string; deviceLabel?: string };
    if (!body.pin || !verifyStaffPin(body.pin)) {
      const failed = await recordAuthFailure(request, "staff");
      if (failed.retryAfterSeconds > 0) return rateLimited(failed.retryAfterSeconds);
      return Response.json({ error: "暗証番号が違います" }, { status: 401, headers: noStore });
    }

    await clearAuthFailures(request, "staff");
    return Response.json({ authenticated: true }, { headers: { ...noStore, "set-cookie": await staffSessionCookie(body.deviceLabel, request.headers.get("user-agent") ?? undefined) } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "認証できませんでした" }, { status: 500, headers: noStore });
  }
}

export async function DELETE(request: Request) {
  await revokeCurrentSession(request, "staff");
  return Response.json({ authenticated: false }, { headers: { ...noStore, "set-cookie": clearStaffSessionCookie() } });
}

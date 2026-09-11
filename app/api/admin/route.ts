import { getAdminDashboard, performAdminAction } from "@/lib/server/admin";
import { currentDayKey } from "@/lib/server/reception";
import { ensureDayDefaults } from "@/lib/server/day-defaults";
import { MutationBusyError, runIdempotentMutation } from "@/lib/server/operation-guard";
import { currentSessionId, verifyAdminSession } from "@/lib/server/staff-auth";

function validDay(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return null;
  return value;
}

function requestedDay(request: Request) {
  const requestUrl = new URL(request.url);
  const direct = validDay(requestUrl.searchParams.get("day"));
  if (direct) return direct;

  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const source = new URL(referer);
      if (source.origin === requestUrl.origin && source.pathname === "/admin") {
        const fromAdmin = validDay(source.searchParams.get("day"));
        if (fromAdmin) return fromAdmin;
      }
    } catch {
      // Ignore malformed Referer headers and fall back to today.
    }
  }

  return currentDayKey();
}

export async function GET(request: Request) {
  try {
    if (!(await verifyAdminSession(request))) return Response.json({ error: "管理者認証が必要です" }, { status: 401 });
    const dayKey = requestedDay(request);
    await ensureDayDefaults(dayKey);
    return Response.json(await getAdminDashboard(dayKey));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "管理データを取得できませんでした" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionId = await currentSessionId(request, "admin");
    if (!sessionId) return Response.json({ error: "管理者認証が必要です" }, { status: 401 });
    const body = await request.json() as Parameters<typeof performAdminAction>[1] & { action?: string; requestId?: string };
    if (!body.action) return Response.json({ error: "操作を指定してください" }, { status: 400 });

    const dayKey = currentDayKey();
    if (requestedDay(request) !== dayKey) {
      return Response.json({ error: "過去日のデータは閲覧専用です。操作する場合は今日へ戻してください" }, { status: 400 });
    }
    await ensureDayDefaults(dayKey);

    const guarded = await runIdempotentMutation({
      requestId: body.requestId,
      dayKey,
      action: `ADMIN:${body.action}`,
      execute: () => performAdminAction(body.action!, body, sessionId),
    });

    return Response.json(guarded.value, { headers: { "cache-control": "no-store", "x-idempotent-replay": guarded.replayed ? "1" : "0" } });
  } catch (error) {
    const status = error instanceof MutationBusyError ? 409 : 400;
    return Response.json({ error: error instanceof Error ? error.message : "管理操作に失敗しました" }, { status, headers: { "cache-control": "no-store" } });
  }
}

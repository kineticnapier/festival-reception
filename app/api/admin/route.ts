import { getAdminDashboard, performAdminAction } from "@/lib/server/admin";
import { currentSessionId, verifyAdminSession } from "@/lib/server/staff-auth";

export async function GET(request: Request) {
  try {
    if (!(await verifyAdminSession(request))) return Response.json({ error: "管理者認証が必要です" }, { status: 401 });
    const day = new URL(request.url).searchParams.get("day") ?? undefined;
    return Response.json(await getAdminDashboard(day));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "管理データを取得できませんでした" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const sessionId = await currentSessionId(request, "admin");
    if (!sessionId) return Response.json({ error: "管理者認証が必要です" }, { status: 401 });
    const body = await request.json() as Parameters<typeof performAdminAction>[1] & { action?: string };
    if (!body.action) return Response.json({ error: "操作を指定してください" }, { status: 400 });
    return Response.json(await performAdminAction(body.action, body, sessionId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "管理操作に失敗しました" }, { status: 400 });
  }
}

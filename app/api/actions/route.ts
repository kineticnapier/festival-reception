import { performAction } from "@/lib/server/reception";
import { verifyAdminSession, verifyStaffSession } from "@/lib/server/staff-auth";

export async function POST(request: Request) {
  const startedAt = performance.now();
  try {
    const body = await request.json() as Parameters<typeof performAction>[1] & { action?: string };
    if (!body.action) return Response.json({ error: "action is required" }, { status: 400 });
    const adminOnly = ["SETTINGS", "RESET_DAY"].includes(body.action);
    const authorized = adminOnly ? await verifyAdminSession(request) : (await verifyStaffSession(request)) || (await verifyAdminSession(request));
    if (!authorized) return Response.json({ error: adminOnly ? "管理者認証が必要です" : "暗証番号をもう一度入力してください" }, { status: 401 });
    const result = await performAction(body.action, body);
    return Response.json(result, { headers: { "cache-control": "no-store", "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}` } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "操作に失敗しました" }, { status: 400, headers: { "cache-control": "no-store", "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}` } });
  }
}

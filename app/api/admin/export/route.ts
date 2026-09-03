import { exportGroupsCsv } from "@/lib/server/admin";
import { verifyAdminSession } from "@/lib/server/staff-auth";

export async function GET(request: Request) {
  if (!(await verifyAdminSession(request))) return Response.json({ error: "管理者認証が必要です" }, { status: 401 });
  const day = new URL(request.url).searchParams.get("day") ?? undefined;
  const csv = await exportGroupsCsv(day);
  return new Response(`\uFEFF${csv}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="festival-${day ?? "today"}.csv"`,
      "cache-control": "no-store",
    },
  });
}

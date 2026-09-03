import { getStatus, getStatusIfChanged } from "@/lib/server/reception";
import { verifyStaffSession } from "@/lib/server/staff-auth";

export async function GET(request: Request) {
  try {
    const startedAt = performance.now();
    const url = new URL(request.url);
    const day = url.searchParams.get("day") ?? undefined;
    const ticketText = url.searchParams.get("ticket");
    const ticketNumber = ticketText == null ? undefined : Number(ticketText);
    const staff = await verifyStaffSession(request);
    if (staff) {
      const sinceText = url.searchParams.get("since");
      const sinceRevision = sinceText == null ? undefined : Number(sinceText);
      const status = await getStatusIfChanged(day, sinceRevision);
      const headers = { "cache-control": "no-store", "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}` };
      if (!status) return new Response(null, { status: 204, headers });
      return Response.json(status, { headers });
    }
    if (ticketNumber == null || !Number.isInteger(ticketNumber)) return Response.json({ error: "スタッフ認証が必要です" }, { status: 401 });
    const status = await getStatus(day, ticketNumber, { includeRecent: false, includeSocialLinks: true });
    return Response.json({
      dayKey: status.dayKey,
      called: status.called == null ? null : { ticket_number: status.called.ticket_number },
      ticket: status.ticket == null ? null : {
        ticket_number: status.ticket.ticket_number,
        party_size: status.ticket.party_size,
        status: status.ticket.status,
        ahead: status.ticket.ahead,
        estimatedMinutes: status.ticket.estimatedMinutes,
      },
      socialLinks: status.socialLinks,
      updatedAt: status.updatedAt,
    }, { headers: { "cache-control": "no-store", "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}` } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "状態を取得できませんでした" }, { status: 500 });
  }
}

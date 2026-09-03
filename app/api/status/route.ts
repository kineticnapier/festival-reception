import { getStatus, getStatusIfChanged } from "@/lib/server/reception";
import { verifyStaffSession } from "@/lib/server/staff-auth";
import { env } from "cloudflare:workers";

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

    // The public ticket page must remain usable even if the optional ticket result
    // from the combined status batch is missing. Active tickets are already present
    // in the status payload, so recover from those first without another D1 query.
    const activeTicket = status.pendingHandoff?.ticket_number === ticketNumber
      ? status.pendingHandoff
      : status.called?.ticket_number === ticketNumber
        ? status.called
        : status.waiting.find((group) => group.ticket_number === ticketNumber)
          ?? status.inside.find((group) => group.ticket_number === ticketNumber)
          ?? null;

    let publicTicket = status.ticket;
    if (!publicTicket && activeTicket) {
      const waitingIndex = activeTicket.status === "waiting"
        ? status.waiting.findIndex((group) => group.id === activeTicket.id)
        : -1;
      const waitingEntry = waitingIndex >= 0 ? status.waiting[waitingIndex] : null;
      publicTicket = {
        ...activeTicket,
        ahead: waitingIndex >= 0 ? waitingIndex + (status.called == null ? 0 : 1) : 0,
        estimatedMinutes: waitingEntry?.estimatedMinutes ?? 0,
      };
    }

    // Exited/cancelled tickets are intentionally absent from the active status set.
    // Only if both normal and active lookups miss do one direct point lookup.
    if (!publicTicket) {
      const historical = await env.DB.prepare(`
        SELECT id, ticket_number, status, party_size, created_at, called_at,
          admitted_at, exited_at, cancelled_at
        FROM visitor_groups
        WHERE day_key = ? AND ticket_number = ?
        ORDER BY CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END, id DESC
        LIMIT 1
      `).bind(status.dayKey, ticketNumber).first<{
        id: number; ticket_number: number; status: "issuing" | "waiting" | "called" | "inside" | "exited" | "cancelled";
        party_size: number; created_at: number; called_at: number | null;
        admitted_at: number | null; exited_at: number | null; cancelled_at: number | null;
      }>();
      if (historical) publicTicket = { ...historical, ahead: 0, estimatedMinutes: 0 };
    }

    return Response.json({
      dayKey: status.dayKey,
      called: status.called == null ? null : { ticket_number: status.called.ticket_number },
      ticket: publicTicket == null ? null : {
        ticket_number: publicTicket.ticket_number,
        party_size: publicTicket.party_size,
        status: publicTicket.status,
        ahead: publicTicket.ahead,
        estimatedMinutes: publicTicket.estimatedMinutes,
      },
      socialLinks: status.socialLinks,
      updatedAt: status.updatedAt,
    }, { headers: { "cache-control": "no-store", "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}` } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "状態を取得できませんでした" }, { status: 500 });
  }
}

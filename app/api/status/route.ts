import { env } from "cloudflare:workers";
import { currentDayKey, getStatus } from "@/lib/server/reception";
import { ensureDayDefaults } from "@/lib/server/day-defaults";
import { verifyStaffSession } from "@/lib/server/staff-auth";

export async function GET(request: Request) {
  try {
    const startedAt = performance.now();
    const url = new URL(request.url);
    const day = url.searchParams.get("day") ?? undefined;
    const dayKey = day ?? currentDayKey();
    const ticketText = url.searchParams.get("ticket");
    const ticketNumber = ticketText == null ? null : Number(ticketText);
    await ensureDayDefaults(dayKey);

    // A ticket query is always a public-ticket request, even when this browser also
    // has a staff session cookie. Otherwise opening a QR from the reception browser
    // returns the staff-wide status payload and the wait page sees ticket: null.
    if (ticketText != null) {
      if (ticketNumber == null || !Number.isInteger(ticketNumber) || ticketNumber < 1) {
        return Response.json({ error: "整理券番号が正しくありません" }, { status: 400 });
      }

      const status = await getStatus(dayKey, ticketNumber, { includeRecent: false, includeSocialLinks: true });

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

      // Exited/cancelled tickets are not in the active set. Fall back to one direct
      // lookup so an old paper ticket still shows its final state instead of 404-like UI.
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
    }

    const staff = await verifyStaffSession(request);
    if (!staff) return Response.json({ error: "スタッフ認証が必要です" }, { status: 401 });

    // Even when the stored revision has not changed, elapsed stay times, queue
    // priorities and wait estimates change as time passes. Return a fresh snapshot
    // on every staff poll so those live values keep moving without another mutation.
    const status = await getStatus(dayKey);
    const headers = { "cache-control": "no-store", "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}` };
    return Response.json(status, { headers });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "状態を取得できませんでした" }, { status: 500 });
  }
}

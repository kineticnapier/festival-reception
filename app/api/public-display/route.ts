import { getStatus } from "@/lib/server/reception";

export async function GET() {
  const startedAt = performance.now();

  try {
    const status = await getStatus(undefined, undefined, {
      includeRecent: false,
      includeSocialLinks: false,
    });

    return Response.json(
      {
        dayKey: status.dayKey,
        currentCount: status.currentCount,
        capacity: status.settings.activeCapacity,
        totalCount: status.totalCount,
        waitingGroups: status.waitingCount,
        waitingPeople: status.waitingPeople,
        called: status.called == null
          ? null
          : {
              ticketNumber: status.called.ticket_number,
              partySize: status.called.party_size,
            },
        updatedAt: status.updatedAt,
      },
      {
        headers: {
          "cache-control": "no-store",
          "server-timing": `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
        },
      },
    );
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "表示データを取得できませんでした" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

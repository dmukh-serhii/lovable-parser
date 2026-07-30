import { NextResponse } from "next/server";
import { getProgressCounts, getStats } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Read-only pipeline status — live queue depths + totals from Neon.
 * Public (read-only role); used to render current pipeline state without
 * triggering any mutation.
 */
export async function GET() {
  try {
    const [counts, stats] = await Promise.all([getProgressCounts(), getStats()]);
    const byStatus = (s: string) =>
      stats.byStatus.find((r) => r.status === s)?.count ?? 0;
    // A screenshot exists only for done/analyzed rows — not_found (deleted
    // projects) and failed rows have none.
    const screenshotted = byStatus("done") + byStatus("analyzed");
    return NextResponse.json({
      total: stats.total,
      screenshotted,
      notFound: byStatus("not_found"),
      analyzed: stats.analyzedCount,
      pending: counts.pending,
      screenshotPending: counts.pending,
      localPending: counts.localPending,
      aiPending: counts.aiPending,
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}

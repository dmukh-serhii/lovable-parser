import { NextRequest, NextResponse } from "next/server";
import { filtersFromSearchParams } from "@/lib/filters";
import { EXPORT_COLUMNS, queryForExport, toCsv } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * "Generate report" — the current filtered view as a CSV, generated directly
 * from Postgres (read-only) with RFC 4180 escaping. No subprocess, so it runs
 * on Cloudflare Workers as well as locally.
 */
export async function GET(req: NextRequest) {
  try {
    const filters = filtersFromSearchParams(req.nextUrl.searchParams);
    const rows = await queryForExport(filters);
    const csv = toCsv(rows, EXPORT_COLUMNS);

    const stamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="lovable-parser-report-${stamp}.csv"`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}

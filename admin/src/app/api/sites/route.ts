import { NextRequest, NextResponse } from "next/server";
import { querySites } from "@/lib/db";
import { filtersFromSearchParams } from "@/lib/filters";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const filters = filtersFromSearchParams(req.nextUrl.searchParams);
    return NextResponse.json(await querySites(filters));
  } catch (err) {
    return NextResponse.json(
      { error: String(err instanceof Error ? err.message : err) },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

/**
 * Pages are public (the /admin panel renders for everyone; anonymous
 * sessions get read-only status behavior client-side). Only the mutating
 * APIs are gated — they hard-401 without a valid session cookie, so
 * pipeline triggers are never reachable anonymously.
 */
export async function middleware(req: NextRequest) {
  // /api/pipeline/status is read-only and public — everything else under the
  // matcher is a mutation and requires a session.
  if (req.nextUrl.pathname === "/api/pipeline/status") {
    return NextResponse.next();
  }
  const authed = await verifyToken(req.cookies.get(COOKIE_NAME)?.value);
  if (authed) return NextResponse.next();
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}

export const config = {
  matcher: ["/api/pipeline/:path*", "/api/refetch/:path*"],
};

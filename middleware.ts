import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth";

const SESSION_COOKIE = "tvillinganalys_session";
const ADMIN_COOKIE = "tvillinganalys_admin";
const PUBLIC_PATHS = ["/login", "/api/login", "/admin/login", "/api/admin-login"];

// Kundens app (/) skyddas av SITE_PASSWORD (och valfritt SITE_USERNAME);
// saknas SITE_PASSWORD är den oskyddad, som innan.
// Teamets vy (/admin) kräver alltid ADMIN_PASSWORD - saknas den är /admin stängd.
// En admininloggning räcker även för kundens app.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const adminPassword = process.env.ADMIN_PASSWORD;
  const isAdmin = !!adminPassword && (await verifySessionToken(req.cookies.get(ADMIN_COOKIE)?.value, adminPassword));

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    if (isAdmin) return NextResponse.next();
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  const password = process.env.SITE_PASSWORD;
  if (!password || isAdmin) return NextResponse.next();

  const valid = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, password);
  if (valid) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

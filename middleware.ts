import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/auth";

const SESSION_COOKIE = "tvillinganalys_session";
const PUBLIC_PATHS = ["/login", "/api/login"];

// Skyddar hela appen bakom en egen inloggningssida (/login) istället för
// webbläsarens inbyggda inloggningsruta. Sätt SITE_PASSWORD (och valfritt
// SITE_USERNAME) i Vercel för att aktivera. Saknas SITE_PASSWORD är appen
// oskyddad, som innan.
export async function middleware(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = await verifySessionToken(token, password);
  if (valid) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

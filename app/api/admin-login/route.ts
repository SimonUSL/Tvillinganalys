import { NextRequest, NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";

const ADMIN_COOKIE = "tvillinganalys_admin";

export async function POST(req: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.json({ error: "Adminvyn är inte aktiverad (ADMIN_PASSWORD saknas)." }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  if (!body?.password || body.password !== adminPassword) {
    return NextResponse.json({ error: "Fel lösenord." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE, await createSessionToken("admin", adminPassword), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14, // 14 dagar
    path: "/",
  });
  return res;
}

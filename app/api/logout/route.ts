import { NextResponse } from "next/server";

const SESSION_COOKIE = "tvillinganalys_session";

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}

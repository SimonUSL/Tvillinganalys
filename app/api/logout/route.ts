import { NextResponse } from "next/server";

// Loggar ut från både kundens app och adminvyn.
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set("tvillinganalys_session", "", { path: "/", maxAge: 0 });
  res.cookies.set("tvillinganalys_admin", "", { path: "/", maxAge: 0 });
  return res;
}

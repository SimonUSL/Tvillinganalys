import { NextRequest, NextResponse } from "next/server";
import { createSessionToken } from "@/lib/auth";

const SESSION_COOKIE = "tvillinganalys_session";

export async function POST(req: NextRequest) {
  const password = process.env.SITE_PASSWORD;
  if (!password) {
    return NextResponse.json(
      { error: "Inloggning är inte aktiverad för den här appen." },
      { status: 400 }
    );
  }
  const configuredUsername = (process.env.SITE_USERNAME || "").trim();

  const body = await req.json().catch(() => null);
  const username = (body?.username || "").trim();
  const suppliedPassword = body?.password || "";

  const usernameOk = !configuredUsername || username === configuredUsername;
  if (!usernameOk || !suppliedPassword || suppliedPassword !== password) {
    return NextResponse.json({ error: "Fel användarnamn eller lösenord." }, { status: 401 });
  }

  const token = await createSessionToken(username, password);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 14, // 14 dagar
    path: "/",
  });
  return res;
}

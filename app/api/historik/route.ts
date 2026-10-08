import { NextRequest, NextResponse } from "next/server";
import { hamtaKorning, listaKorningar } from "@/lib/historik";

// Historiken (skyddas av inloggningen i middleware.ts).
// GET: alla körningar (sammanfattningar). GET ?id=...: en körning med tvillingarna.
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (id) {
    const korning = await hamtaKorning(id);
    return korning ? NextResponse.json({ korning }) : NextResponse.json({ error: "Körningen finns inte längre." }, { status: 404 });
  }
  return NextResponse.json({ korningar: await listaKorningar() });
}

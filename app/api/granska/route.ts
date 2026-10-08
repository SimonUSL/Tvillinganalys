import { NextRequest, NextResponse } from "next/server";
import { antalIKo, listaKo, taBortUrKo } from "@/lib/granskning";

// Granskningskön (skyddas av inloggningen i middleware.ts).
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("antal")) return NextResponse.json({ antal: await antalIKo() });
  return NextResponse.json({ poster: await listaKo() });
}

// { ids: [...] } - posterna är hanterade eller ska tas bort.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.map(String) : [];
  await taBortUrKo(ids);
  return NextResponse.json({ ok: true });
}

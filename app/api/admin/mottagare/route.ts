import { NextRequest, NextResponse } from "next/server";
import { hamtaMottagare, sparaMottagare } from "@/lib/installningar";

// Vilka som får mejlen. Bara för admin (middleware.ts).
export async function GET() {
  return NextResponse.json(await hamtaMottagare());
}

// { lista: ["namn@bolag.se", ...] }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!Array.isArray(body?.lista)) return NextResponse.json({ error: "lista saknas" }, { status: 400 });
  const lista = await sparaMottagare(body.lista.map(String));
  if (!lista.length) return NextResponse.json({ error: "Minst en mottagare behövs." }, { status: 400 });
  return NextResponse.json({ lista, sparad: true });
}

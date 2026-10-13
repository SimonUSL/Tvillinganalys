import { NextResponse } from "next/server";
import { hamtaKvot } from "@/lib/kvot";

// Sökningar kvar i det betalda registret (tic.io), senast kända värde.
export async function GET() {
  return NextResponse.json({ kvot: await hamtaKvot() }, { headers: { "Cache-Control": "no-store" } });
}

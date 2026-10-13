import { NextResponse } from "next/server";
import { hamtaKvot } from "@/lib/kvot";

// Anrop kvar hos tic.io (betalt, per period) och bolagsdataapi (fritt, per dygn), senast kända värden.
export async function GET() {
  const [tic, bolagsdata] = await Promise.all([hamtaKvot("tic"), hamtaKvot("bolagsdata")]);
  return NextResponse.json({ kvot: tic, bolagsdata }, { headers: { "Cache-Control": "no-store" } });
}

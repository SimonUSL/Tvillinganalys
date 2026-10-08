import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { forfraganFranFalt, formularFranNamn } from "@/lib/inkorg";
import { hanteraLead } from "@/lib/automatik";

// Webflow-webhook (Site settings → Apps & integrations → Webhooks →
// "Form submission"). URL: /api/webflow?nyckel=<WEBFLOW_WEBHOOK_SECRET>.
// Svarar Webflow direkt och arbetar sedan vidare i bakgrunden (waitUntil).
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const hemlig = process.env.WEBFLOW_WEBHOOK_SECRET;
  const nyckel = req.nextUrl.searchParams.get("nyckel");
  // Varje anrop loggas (aldrig själva nyckeln) så att det går att se om Webflow nått fram.
  if (!hemlig || nyckel !== hemlig) {
    console.log(
      JSON.stringify({
        steg: "webflow",
        status: "obehörig",
        orsak: !hemlig ? "WEBFLOW_WEBHOOK_SECRET saknas" : !nyckel ? "ingen nyckel i URL:en" : "fel nyckel",
        nyckel_langd: nyckel?.length ?? 0,
        vantad_langd: hemlig?.length ?? 0,
      })
    );
    return NextResponse.json({ error: "obehörig" }, { status: 401 });
  }
  const body = await req.json().catch(() => null);
  // Webflows nya format: { triggerType, payload: { name, data, submittedAt, id } };
  // äldre format: { name, data, d, _id }.
  const p = body?.payload ?? body;
  const data = p?.data;
  if (!data || typeof data !== "object") {
    console.log(JSON.stringify({ steg: "webflow", status: "inget formulärdata", triggerType: body?.triggerType ?? null }));
    return NextResponse.json({ ok: true, ignorerat: "inget formulärdata" });
  }
  const datum = new Date(p.submittedAt || p.d || Date.now());
  const f = forfraganFranFalt(data, formularFranNamn(String(p.name || "formulär")), isNaN(datum.getTime()) ? new Date() : datum);
  const id = String(p.id || p._id || `${f.epost}-${datum.getTime()}`);

  console.log(JSON.stringify({ steg: "webflow", status: "mottagen", formular: f.formular, doman: f.doman, falt: Object.keys(data) }));
  waitUntil(
    hanteraLead(f, id).catch((e) =>
      console.log(JSON.stringify({ steg: "automatik", utfall: "fel", detalj: String(e?.message || e) }))
    )
  );
  return NextResponse.json({ ok: true });
}

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { forfraganFranFalt, formularFranNamn } from "@/lib/inkorg";
import { hanteraLead } from "@/lib/automatik";

// Webflow-webhook (Site settings → Apps & integrations → Webhooks →
// "Form submission"). Två sätt att godkännas, med samma WEBFLOW_WEBHOOK_SECRET:
// 1. Webflows signatur (x-webflow-signature = HMAC-SHA256 av "tidsstämpel:kropp"
//    med webhookens "secret key" från Webflow) - det säkraste.
// 2. Nyckeln i URL:en: /api/webflow?nyckel=<WEBFLOW_WEBHOOK_SECRET>.
// Svarar Webflow direkt och arbetar sedan vidare i bakgrunden (waitUntil).
export const maxDuration = 300;
// tic.io tar bara emot anrop från Norden/Tyskland - kör alltid i Stockholm.
export const preferredRegion = "arn1";

// Webflow skickar tidsstämpeln i millisekunder; sekunder godtas också.
const MAX_ALDER_MS = 5 * 60 * 1000;

function giltigSignatur(hemlig: string, tid: string | null, signatur: string | null, kropp: string): string | null {
  if (!tid || !signatur) return "ingen signatur";
  const ms = Number(tid) < 1e12 ? Number(tid) * 1000 : Number(tid);
  if (!Number.isFinite(ms) || Math.abs(Date.now() - ms) > MAX_ALDER_MS) return "för gammal tidsstämpel";
  const vantad = createHmac("sha256", hemlig).update(`${tid}:${kropp}`).digest("hex");
  const a = Buffer.from(vantad, "hex");
  const b = Buffer.from(signatur.trim(), "hex");
  return a.length === b.length && timingSafeEqual(a, b) ? null : "fel signatur";
}

export async function POST(req: NextRequest) {
  const hemlig = process.env.WEBFLOW_WEBHOOK_SECRET;
  const nyckel = req.nextUrl.searchParams.get("nyckel");
  const kropp = await req.text();
  const signaturFel = hemlig
    ? giltigSignatur(hemlig, req.headers.get("x-webflow-timestamp"), req.headers.get("x-webflow-signature"), kropp)
    : "WEBFLOW_WEBHOOK_SECRET saknas";
  const nyckelOk = !!hemlig && nyckel === hemlig;
  // Varje anrop loggas (aldrig själva nyckeln) så att det går att se om Webflow nått fram.
  if (signaturFel && !nyckelOk) {
    console.log(
      JSON.stringify({
        steg: "webflow",
        status: "obehörig",
        signatur: signaturFel,
        url_nyckel: !nyckel ? "saknas" : "fel",
        nyckel_langd: nyckel?.length ?? 0,
        vantad_langd: hemlig?.length ?? 0,
      })
    );
    return NextResponse.json({ error: "obehörig" }, { status: 401 });
  }
  let body: any = null;
  try {
    body = JSON.parse(kropp);
  } catch {}
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

  console.log(
    JSON.stringify({
      steg: "webflow",
      status: "mottagen",
      via: signaturFel ? "url-nyckel" : "signatur",
      // Var funktionen faktiskt körs - tic.io tar bara emot anrop från Norden/Tyskland.
      korregion: process.env.VERCEL_REGION ?? null,
      formular: f.formular,
      doman: f.doman,
      falt: Object.keys(data),
    })
  );
  waitUntil(
    hanteraLead(f, id).catch((e) =>
      console.log(JSON.stringify({ steg: "automatik", utfall: "fel", detalj: String(e?.message || e) }))
    )
  );
  return NextResponse.json({ ok: true });
}

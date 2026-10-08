import { NextRequest, NextResponse } from "next/server";
import { namnUtanBolagsform, ticKlient } from "@/lib/twinfinder";
import { parseCsv } from "@/lib/csv";
import { Ctx, ResultRow, processLead } from "@/lib/korning";

export type { ResultRow } from "@/lib/korning";

// En veckas formulärförfrågningar tar längre än 60 s. 300 s kräver Fluid Compute
// (standard för nya Vercel-projekt).
export const maxDuration = 300;
// tic.io tar bara emot anrop från Norden/Tyskland - kör alltid i Stockholm.
export const preferredRegion = "arn1";

// Ett granskat lead som gränssnittet skickar.
interface GranskatLead {
  namn: string;
  org_nr?: string;
  geo?: string;
  sasong?: string;
  strikt?: string;
  extra?: Partial<ResultRow>;
}

// Händelser i den strömmade körningen (NDJSON).
export type Handelse =
  | { typ: "lead"; index: number; totalt: number; namn: string; lead_id?: number }
  | { typ: "rader"; rows: ResultRow[] }
  | { typ: "klar"; tic_anrop: number; tic_fran_cache: number }
  | { typ: "fel"; error: string };

export async function POST(req: NextRequest) {
  const bolagsdataKey = process.env.BOLAGSDATA_API_KEY;
  const ticKey = process.env.TIC_API_KEY;
  const foretagskontaktKey = process.env.FORETAGSKONTAKT_API_KEY;
  const typesafeKey = process.env.TYPESAFE_API_KEY; // valfri: utan den tas första träffen

  if (!ticKey) {
    return NextResponse.json(
      { error: "Saknar TIC_API_KEY i Vercel-projektets Environment Variables." },
      { status: 500 }
    );
  }

  const body = await req.json();
  // En tic.io-klient per körning: leads i samma bransch delar sökningar (cache).
  // Tak för tic.io-anrop i körningen (200/mån på nyckeln). Når vi taket får
  // resterande leads bara tvillingar från bolagsdataapi.
  const maxTic = Number.isFinite(Number(body.max_tic_anrop)) && body.max_tic_anrop !== null && body.max_tic_anrop !== undefined
    ? Math.max(0, Math.floor(Number(body.max_tic_anrop)))
    : null;
  const ctx: Ctx = {
    tic: ticKlient(ticKey, maxTic),
    bolagsdataKey,
    typesafeKey,
    foretagskontaktKey,
    knownCustomerOrgNrs: new Set(body.known_customer_org_nrs || []),
  };
  const rowsOut: ResultRow[] = [];
  const sedda = new Set<string>();

  if (Array.isArray(body.leads)) {
    // --- Granskade leads (formulärexporter eller CSV) från gränssnittet.
    const leads = (body.leads as GranskatLead[]).filter((l) => (l.namn || "").trim() || (l.org_nr || "").trim());
    const kor = async (skicka: (h: Handelse) => void) => {
      for (let i = 0; i < leads.length; i++) {
        const lead = leads[i];
        const namn = (lead.namn || "").trim();
        const orgNr = (lead.org_nr || "").replace(/\D/g, "");
        skicka({ typ: "lead", index: i, totalt: leads.length, namn: namn || orgNr, lead_id: lead.extra?.lead_id });
        let rader: ResultRow[];
        // Ett bolag med flera förfrågningar tvillingsöks en gång.
        const nyckel = orgNr || namnUtanBolagsform(namn).toLowerCase();
        if (sedda.has(nyckel)) {
          rader = [
            { ...lead.extra, lead_foretagsnamn: namn || orgNr, status_kod: "dublett", status: "dublett: samma bolag finns tidigare i listan" },
          ];
        } else {
          sedda.add(nyckel);
          rader = await processLead(
            { namn: namn || orgNr, orgNr, geo: lead.geo, sasong: lead.sasong, strikt: lead.strikt, extra: lead.extra },
            ctx
          );
        }
        skicka({ typ: "rader", rows: rader });
      }
      const klar = { typ: "klar" as const, tic_anrop: ctx.tic.anrop, tic_fran_cache: ctx.tic.cacheTraffar };
      console.log(JSON.stringify({ steg: "körning klar", leads: sedda.size, ...klar }));
      skicka(klar);
    };

    if (body.stream) {
      // NDJSON: en händelse per rad, så att gränssnittet kan visa förloppet.
      const enc = new TextEncoder();
      const strom = new ReadableStream({
        async start(controller) {
          const skicka = (h: Handelse) => controller.enqueue(enc.encode(JSON.stringify(h) + "\n"));
          try {
            await kor(skicka);
          } catch (e: any) {
            skicka({ typ: "fel", error: String(e.message || e) });
          }
          controller.close();
        },
      });
      return new Response(strom, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
    }
    let klar: any = {};
    await kor((h) => {
      if (h.typ === "rader") rowsOut.push(...h.rows);
      if (h.typ === "klar") klar = h;
    });
    return NextResponse.json({ rows: rowsOut, tic_anrop: klar.tic_anrop, tic_fran_cache: klar.tic_fran_cache });
  } else {
    // --- CSV med leads.
    const leads = parseCsv(body.csv || "");
    if (!leads.length) {
      return NextResponse.json({ error: "Tom eller oläsbar CSV." }, { status: 400 });
    }
    if (!("foretagsnamn" in leads[0])) {
      return NextResponse.json({ error: "CSV:n saknar kolumnen 'foretagsnamn'." }, { status: 400 });
    }
    for (const lead of leads) {
      const namn = (lead.foretagsnamn || "").trim();
      if (!namn) continue;
      const orgNr = (lead.org_nr || lead.orgnr || lead.organisationsnummer || "").trim();
      // Samma lead två gånger i CSV:n kostar inga nya anrop.
      const leadNyckel = orgNr.replace(/\D/g, "") || namnUtanBolagsform(namn).toLowerCase();
      if (sedda.has(leadNyckel)) {
        rowsOut.push({ lead_foretagsnamn: namn, status: "dublett: samma lead finns tidigare i listan" });
        continue;
      }
      sedda.add(leadNyckel);
      rowsOut.push(
        ...(await processLead(
          { namn, orgNr, geo: lead.geografi_relevant, sasong: lead.sasongseffekt, strikt: lead.storlek_strikt },
          ctx
        ))
      );
    }
  }

  console.log(
    JSON.stringify({ steg: "körning klar", leads: sedda.size, tic_anrop: ctx.tic.anrop, tic_fran_cache: ctx.tic.cacheTraffar })
  );
  return NextResponse.json({ rows: rowsOut, tic_anrop: ctx.tic.anrop, tic_fran_cache: ctx.tic.cacheTraffar });
}

import { NextRequest, NextResponse } from "next/server";
import {
  Company,
  LeadOptions,
  SourceResult,
  Tic,
  TicSource,
  Twin,
  arJa,
  enrichContact,
  fetchTicSource,
  findTwins,
  guessLeadOptions,
  namnUtanBolagsform,
  resolveSourceCompany,
  ticKlient,
} from "@/lib/twinfinder";
import { parseCsv } from "@/lib/csv";

// Säsongsceller som betyder "ingen säsong" (och inte ska gissas av Jev).
const INGEN_SASONG = new Set(["nej", "ingen", "-", "no", "none"]);

// En veckas formulärförfrågningar tar längre än 60 s. 300 s kräver Fluid Compute
// (standard för nya Vercel-projekt).
export const maxDuration = 300;

export interface ResultRow {
  // Vilken granskad rad i gränssnittet resultatet hör till.
  lead_id?: number;
  // Bara vid import av formulärexporter:
  forfragan_datum?: string;
  forfragan_formular?: string;
  forfragan_doman?: string | null;
  forfragan_typ?: string;
  forfragan_text?: string;
  lead_foretagsnamn: string;
  kall_org_nr?: string;
  kall_namn?: string;
  kall_sni?: string;
  kall_lan?: string | null;
  kall_matchning?: string | null;
  urval?: string | null;
  geografi_relevant?: string;
  storlek_strikt?: string;
  sasongseffekt?: string;
  tvilling_org_nr?: string;
  tvilling_namn?: string;
  tvilling_oms?: number | null;
  tvilling_anstallda?: number | null;
  tvilling_sni?: string;
  tvilling_lan?: string | null;
  tvilling_ort?: string | null;
  tvilling_likhet?: string | null;
  tvilling_poang?: number | null;
  tvilling_verksamhet?: string | null;
  kontakt_namn?: string | null;
  kontakt_mejl?: string | null;
  kontakt_telefon?: string | null;
  status: string;
}

// "2026-10-07 08:58" - formulärens klockslag tolkas och visas som de står i exporten.
function datumText(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

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

// Ett lead, oavsett om det kommer från en CSV eller en formulärförfrågan.
interface LeadIn {
  namn: string;
  orgNr?: string;
  geo?: string;
  sasong?: string;
  strikt?: string;
  // Redan identifierat bolag (formulärimporten gör det själv).
  resolved?: SourceResult;
  // Förfrågningskolumner som ska följa med på varje rad.
  extra?: Partial<ResultRow>;
}

interface Ctx {
  tic: Tic;
  bolagsdataKey?: string;
  typesafeKey?: string;
  foretagskontaktKey?: string;
  knownCustomerOrgNrs: Set<string>;
}

async function processLead(lead: LeadIn, ctx: Ctx): Promise<ResultRow[]> {
  const { tic, bolagsdataKey, typesafeKey, foretagskontaktKey, knownCustomerOrgNrs } = ctx;
  const bas = { ...lead.extra, lead_foretagsnamn: lead.namn };

  let res: SourceResult;
  try {
    res = lead.resolved ?? (await resolveSourceCompany(lead.namn, tic, bolagsdataKey, typesafeKey, lead.orgNr || undefined));
  } catch (e: any) {
    return [{ ...bas, status: `fel vid bolagssökning: ${e.message || e}` }];
  }
  const source: Company | null = res.company;
  if (!source) return [{ ...bas, kall_matchning: res.matchning, status: `ej hittat: ${res.matchning}` }];
  if (!source.sni_codes?.length) {
    return [
      { ...bas, kall_org_nr: source.org_nr, kall_namn: source.name, kall_matchning: source.matchning, status: "ingen SNI-kod hittad" },
    ];
  }

  const gemensamGrund = {
    ...bas,
    kall_org_nr: source.org_nr,
    kall_namn: source.name,
    kall_sni: source.sni_codes.join(";"),
    kall_lan: source.lan,
    kall_matchning: source.matchning,
  };

  let ticSource: TicSource;
  try {
    ticSource = res.ticSource ?? (await fetchTicSource(source, tic));
  } catch (e: any) {
    return [{ ...gemensamGrund, status: `fel vid tic.io-sökning: ${e.message || e}` }];
  }

  // Ifyllda CSV-celler gäller. Tomma geografi/säsong-celler gissar Jev
  // utifrån kallbolagets verksamhetsbeskrivning.
  const geoCell = (lead.geo || "").trim();
  const sasongCell = (lead.sasong || "").trim();
  const options: LeadOptions = {
    geografi_relevant: arJa(geoCell),
    storlek_strikt: arJa(lead.strikt),
    sasongseffekt: INGEN_SASONG.has(sasongCell.toLowerCase()) ? "" : sasongCell,
  };
  let geografiInfo = geoCell ? (options.geografi_relevant ? "ja" : "nej") : "nej";
  let sasongInfo = sasongCell;
  if ((!geoCell || !sasongCell) && typesafeKey) {
    try {
      const gissning = await guessLeadOptions(ticSource.profile, typesafeKey);
      if (!geoCell) {
        options.geografi_relevant = gissning.geografi_relevant;
        geografiInfo = gissning.geografi_info;
      }
      if (!sasongCell) {
        options.sasongseffekt = gissning.sasongseffekt;
        sasongInfo = gissning.sasong_info;
      }
    } catch (e: any) {
      if (!geoCell) geografiInfo = `nej (Jev-fel: ${e.message || e})`;
    }
  }

  const gemensam = {
    ...gemensamGrund,
    geografi_relevant: geografiInfo,
    storlek_strikt: options.storlek_strikt ? "ja" : "nej",
    sasongseffekt: sasongInfo,
  };

  let twins: Twin[] = [];
  let urval = "";
  try {
    ({ twins, urval } = await findTwins(source, ticSource, options, tic, knownCustomerOrgNrs, typesafeKey, bolagsdataKey));
  } catch (e: any) {
    return [{ ...gemensam, status: `fel vid tvillingsökning: ${e.message || e}` }];
  }
  if (!twins.length) return [{ ...gemensam, urval, status: "inga tvillingar hittade" }];

  const rows: ResultRow[] = [];
  for (const twin of twins) {
    if (foretagskontaktKey) {
      await enrichContact(twin, foretagskontaktKey);
    }
    rows.push({
      ...gemensam,
      urval,
      tvilling_org_nr: twin.org_nr,
      tvilling_namn: twin.name,
      tvilling_oms: twin.net_revenue ?? null,
      tvilling_anstallda: twin.employees ?? null,
      tvilling_sni: (twin.sni_codes || []).join(";"),
      tvilling_lan: twin.lan ?? null,
      tvilling_ort: twin.ort ?? null,
      tvilling_likhet: twin.likhet ?? null,
      tvilling_poang: twin.poang ?? null,
      tvilling_verksamhet: twin.verksamhet ?? null,
      kontakt_namn: twin.contact_name ?? null,
      kontakt_mejl: twin.contact_email ?? null,
      kontakt_telefon: twin.contact_phone ?? null,
      status: twin.contact_email ? "tvilling hittad" : "tvilling hittad (ingen kontakt)",
    });
  }
  return rows;
}

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
          rader = [{ ...lead.extra, lead_foretagsnamn: namn || orgNr, status: "dublett: samma bolag finns tidigare i listan" }];
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

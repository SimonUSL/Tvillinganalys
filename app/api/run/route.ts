import { NextRequest, NextResponse } from "next/server";
import {
  Company,
  LeadOptions,
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

export const maxDuration = 60; // försök be om längre körningstid på Vercel

export interface ResultRow {
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
  const csvText: string = body.csv || "";
  const leads = parseCsv(csvText);
  if (!leads.length) {
    return NextResponse.json({ error: "Tom eller oläsbar CSV." }, { status: 400 });
  }
  if (!("foretagsnamn" in leads[0])) {
    return NextResponse.json(
      { error: "CSV:n saknar kolumnen 'foretagsnamn'." },
      { status: 400 }
    );
  }
  const knownCustomerOrgNrs: Set<string> = new Set(body.known_customer_org_nrs || []);

  const rowsOut: ResultRow[] = [];
  // En tic.io-klient per körning: leads i samma bransch delar sökningar (cache).
  const tic = ticKlient(ticKey);
  const sedda = new Set<string>();

  for (const lead of leads) {
    const companyName = (lead.foretagsnamn || "").trim();
    if (!companyName) continue;
    const orgNrCell = (lead.org_nr || lead.orgnr || lead.organisationsnummer || "").trim();

    // Samma lead två gånger i CSV:n kostar inga nya anrop.
    const leadNyckel = orgNrCell.replace(/\D/g, "") || namnUtanBolagsform(companyName).toLowerCase();
    if (sedda.has(leadNyckel)) {
      rowsOut.push({ lead_foretagsnamn: companyName, status: "dublett: samma lead finns tidigare i listan" });
      continue;
    }
    sedda.add(leadNyckel);

    let source: Company | null = null;
    let matchning = "";
    let foundTicSource: TicSource | undefined;
    try {
      ({ company: source, matchning, ticSource: foundTicSource } = await resolveSourceCompany(
        companyName,
        tic,
        bolagsdataKey,
        typesafeKey,
        orgNrCell || undefined
      ));
    } catch (e: any) {
      rowsOut.push({
        lead_foretagsnamn: companyName,
        status: `fel vid bolagssökning: ${e.message || e}`,
      });
      continue;
    }

    if (!source) {
      rowsOut.push({ lead_foretagsnamn: companyName, kall_matchning: matchning, status: `ej hittat: ${matchning}` });
      continue;
    }
    if (!source.sni_codes?.length) {
      rowsOut.push({
        lead_foretagsnamn: companyName,
        kall_org_nr: source.org_nr,
        kall_namn: source.name,
        kall_matchning: source.matchning,
        status: "ingen SNI-kod hittad",
      });
      continue;
    }

    const gemensamGrund = {
      lead_foretagsnamn: companyName,
      kall_org_nr: source.org_nr,
      kall_namn: source.name,
      kall_sni: source.sni_codes.join(";"),
      kall_lan: source.lan,
      kall_matchning: source.matchning,
    };

    let ticSource: TicSource;
    try {
      ticSource = foundTicSource ?? (await fetchTicSource(source, tic));
    } catch (e: any) {
      rowsOut.push({ ...gemensamGrund, status: `fel vid tic.io-sökning: ${e.message || e}` });
      continue;
    }

    // Ifyllda CSV-celler gäller. Tomma geografi/säsong-celler gissar Jev
    // utifrån kallbolagets verksamhetsbeskrivning.
    const geoCell = (lead.geografi_relevant || "").trim();
    const sasongCell = (lead.sasongseffekt || "").trim();
    const options: LeadOptions = {
      geografi_relevant: arJa(geoCell),
      storlek_strikt: arJa(lead.storlek_strikt),
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
      ({ twins, urval } = await findTwins(source, ticSource, options, tic, knownCustomerOrgNrs, typesafeKey));
    } catch (e: any) {
      rowsOut.push({ ...gemensam, status: `fel vid tvillingsökning: ${e.message || e}` });
      continue;
    }

    if (!twins.length) {
      rowsOut.push({ ...gemensam, urval, status: "inga tvillingar hittade" });
      continue;
    }

    for (const twin of twins) {
      if (foretagskontaktKey) {
        await enrichContact(twin, foretagskontaktKey);
      }
      rowsOut.push({
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
  }

  console.log(JSON.stringify({ steg: "körning klar", leads: sedda.size, tic_anrop: tic.anrop }));
  return NextResponse.json({ rows: rowsOut });
}

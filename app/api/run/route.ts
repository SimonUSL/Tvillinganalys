import { NextRequest, NextResponse } from "next/server";
import {
  Company,
  LeadOptions,
  Twin,
  arJa,
  enrichContact,
  findTwins,
  resolveSourceCompany,
} from "@/lib/twinfinder";
import { parseCsv } from "@/lib/csv";

export const maxDuration = 60; // försök be om längre körningstid på Vercel

export interface ResultRow {
  lead_foretagsnamn: string;
  kall_org_nr?: string;
  kall_namn?: string;
  kall_sni?: string;
  kall_lan?: string | null;
  kall_matchning?: string | null;
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

  if (!bolagsdataKey) {
    return NextResponse.json(
      { error: "Saknar BOLAGSDATA_API_KEY i Vercel-projektets Environment Variables." },
      { status: 500 }
    );
  }
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

  for (const lead of leads) {
    const companyName = (lead.foretagsnamn || "").trim();
    if (!companyName) continue;

    const options: LeadOptions = {
      geografi_relevant: arJa(lead.geografi_relevant),
      storlek_strikt: arJa(lead.storlek_strikt),
      sasongseffekt: (lead.sasongseffekt || "").trim(),
    };

    let source: Company | null = null;
    try {
      source = await resolveSourceCompany(companyName, bolagsdataKey, typesafeKey);
    } catch (e: any) {
      rowsOut.push({
        lead_foretagsnamn: companyName,
        status: `fel vid bolagsdataapi-sökning: ${e.message || e}`,
      });
      continue;
    }

    if (!source) {
      rowsOut.push({ lead_foretagsnamn: companyName, status: "ej hittat" });
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

    const gemensam = {
      lead_foretagsnamn: companyName,
      kall_org_nr: source.org_nr,
      kall_namn: source.name,
      kall_sni: source.sni_codes.join(";"),
      kall_lan: source.lan,
      kall_matchning: source.matchning,
      geografi_relevant: options.geografi_relevant ? "ja" : "nej",
      storlek_strikt: options.storlek_strikt ? "ja" : "nej",
      sasongseffekt: options.sasongseffekt,
    };

    let twins: Twin[] = [];
    try {
      twins = await findTwins(source, options, ticKey, knownCustomerOrgNrs, typesafeKey);
    } catch (e: any) {
      rowsOut.push({ ...gemensam, status: `fel vid tvillingsökning: ${e.message || e}` });
      continue;
    }

    if (!twins.length) {
      rowsOut.push({ ...gemensam, status: "inga tvillingar hittade" });
      continue;
    }

    for (const twin of twins) {
      if (foretagskontaktKey) {
        await enrichContact(twin, foretagskontaktKey);
      }
      rowsOut.push({
        ...gemensam,
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

  return NextResponse.json({ rows: rowsOut });
}

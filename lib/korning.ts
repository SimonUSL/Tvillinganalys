// korning.ts — flödet för ett lead: hitta bolaget, gissa geografi/säsong,
// sök tvillingar. Delas av verktyget (/api/run) och Webflow-webhooken.

import { berikaKontakt } from "./foretagskontakt";
import {
  Company,
  LeadOptions,
  SourceResult,
  Tic,
  TicSource,
  Twin,
  arJa,
  fetchTicSource,
  findTwins,
  guessLeadOptions,
  resolveSourceCompany,
} from "./twinfinder";

// Säsongsceller som betyder "ingen säsong" (och inte ska gissas av Jev).
const INGEN_SASONG = new Set(["nej", "ingen", "-", "no", "none"]);

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
  urval?: string | null; // teknisk text (adminvyn)
  // Strukturerat, för klartext i gränssnittet:
  urval_kod?: string | null;
  tic_tak?: boolean;
  lokal?: boolean;
  sasong_kod?: string | null;
  status_kod?: "tvilling" | "ej_hittat" | "ingen_sni" | "inga_tvillingar" | "dublett" | "fel";
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
  beslutsfattare?: string | null;
  bolag_epost?: string | null;
  bolag_telefon?: string | null;
  bolag_webb?: string | null;
  // Avsändarens uppgifter ur formuläret (automatiska mejl).
  forfragan_namn?: string | null;
  forfragan_epost?: string | null;
  forfragan_telefon?: string | null;
  kontakt_namn?: string | null;
  kontakt_mejl?: string | null;
  kontakt_telefon?: string | null;
  status: string;
}

// Ett lead, oavsett om det kommer från en CSV eller en formulärförfrågan.
export interface LeadIn {
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

export interface Ctx {
  tic: Tic;
  bolagsdataKey?: string;
  typesafeKey?: string;
  foretagskontaktKey?: string;
  knownCustomerOrgNrs: Set<string>;
}

export async function processLead(lead: LeadIn, ctx: Ctx): Promise<ResultRow[]> {
  const { tic, bolagsdataKey, typesafeKey, foretagskontaktKey, knownCustomerOrgNrs } = ctx;
  const bas = { ...lead.extra, lead_foretagsnamn: lead.namn };

  let res: SourceResult;
  try {
    res = lead.resolved ?? (await resolveSourceCompany(lead.namn, tic, bolagsdataKey, typesafeKey, lead.orgNr || undefined));
  } catch (e: any) {
    return [{ ...bas, status_kod: "fel", status: `fel vid bolagssökning: ${e.message || e}` }];
  }
  const source: Company | null = res.company;
  if (!source) return [{ ...bas, kall_matchning: res.matchning, status_kod: "ej_hittat", status: `ej hittat: ${res.matchning}` }];
  if (!source.sni_codes?.length) {
    return [
      {
        ...bas,
        kall_org_nr: source.org_nr,
        kall_namn: source.name,
        kall_matchning: source.matchning,
        status_kod: "ingen_sni",
        status: "ingen SNI-kod hittad",
      },
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
    return [{ ...gemensamGrund, status_kod: "fel", status: `fel vid tic.io-sökning: ${e.message || e}` }];
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
    lokal: options.geografi_relevant,
    sasong_kod: options.sasongseffekt || null,
  };

  let twins: Twin[] = [];
  let urval = "";
  let urval_kod = "";
  let tic_tak = false;
  try {
    ({ twins, urval, urval_kod, tic_tak } = await findTwins(source, ticSource, options, tic, knownCustomerOrgNrs, typesafeKey, bolagsdataKey));
  } catch (e: any) {
    return [{ ...gemensam, status_kod: "fel", status: `fel vid tvillingsökning: ${e.message || e}` }];
  }
  const urvalFalt = { urval, urval_kod, tic_tak };
  if (!twins.length) return [{ ...gemensam, ...urvalFalt, status_kod: "inga_tvillingar", status: "inga tvillingar hittade" }];

  const rows: ResultRow[] = [];
  // Företagskontakt: köp bara det registren saknar (se lib/foretagskontakt.ts).
  if (foretagskontaktKey) {
    let kr = 0;
    for (const twin of twins) kr += await berikaKontakt(twin, foretagskontaktKey);
    console.log(JSON.stringify({ steg: "foretagskontakt", kallbolag: source.name, tvillingar: twins.length, kostnad_kr: Math.round(kr * 100) / 100 }));
  }
  for (const twin of twins) {
    rows.push({
      ...gemensam,
      ...urvalFalt,
      status_kod: "tvilling",
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
      beslutsfattare: twin.kontakt?.beslutsfattare ?? null,
      bolag_epost: twin.kontakt?.epost ?? null,
      bolag_telefon: twin.kontakt?.telefon ?? null,
      bolag_webb: twin.kontakt?.webb ?? null,
      kontakt_namn: twin.contact_name ?? null,
      kontakt_mejl: twin.contact_email ?? null,
      kontakt_telefon: twin.contact_phone ?? null,
      status: twin.contact_email ? "tvilling hittad" : "tvilling hittad (ingen kontakt)",
    });
  }
  return rows;
}

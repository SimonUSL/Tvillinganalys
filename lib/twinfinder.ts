// twinfinder.ts — portning av twin_finder.py:s sök-logik till webb-appen.
//
// Steg 2: namnsökning hos tic.io, Jev väljer rätt träff (bolagsdataapi.se som reserv)
// Steg 3-4: tic.io hämtar kandidater brett, TypeSafe Jev bedömer hur lika
//           de är kallbolaget, koden väger ihop med storlek (se findTwins)
// Steg 5: foretagskontakt.se (fortfarande OBEKRÄFTAD - kör bara om nyckel
//           finns, och misslyckas tyst/markeras i resultatet annars)

export interface LeadOptions {
  geografi_relevant: boolean;
  storlek_strikt: boolean;
  sasongseffekt: string;
}

export interface Company {
  org_nr: string;
  name: string;
  net_revenue?: number | null;
  employees?: number | null;
  sni_codes: string[];
  lan?: string | null;
  ort?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  // Hur kallbolaget valdes bland sökträffarna, t.ex. "Jev 94 %" eller
  // "osäker (Jev 41 %) – kontrollera".
  matchning?: string | null;
}

const JA_VARDEN = new Set(["ja", "yes", "true", "1", "x"]);
export function arJa(varde: string | undefined | null): boolean {
  return !!varde && JA_VARDEN.has(varde.trim().toLowerCase());
}

export const STRICT_REVENUE_TOLERANCE = 0.2;
export const STRICT_EMPLOYEE_TOLERANCE = 0.25;

// Storleksklasser - satta av Simon (snävare än de officiella EU/SCB-klasserna).
export const STORLEKSKLASSER: Array<[string, number, number | null]> = [
  ["0-9 anställda", 0, 9],
  ["10-25 anställda", 10, 25],
  ["26-50 anställda", 26, 50],
  ["51-150 anställda", 51, 150],
  ["151-300 anställda", 151, 300],
  ["300+ anställda", 301, null],
];

export function storleksklass(employees: number): [string, number, number | null] {
  for (const [namn, low, high] of STORLEKSKLASSER) {
    if ((high === null || employees <= high) && employees >= low) {
      return [namn, low, high];
    }
  }
  return STORLEKSKLASSER[STORLEKSKLASSER.length - 1];
}

const BOLAGSDATA_BASE = "https://bolagsdataapi.se/api/v1";
const TIC_SEARCH_URL = "https://lens-api.tic.io/search-public/companies";
const TIC_MAX_PER_PAGE = 50;
const FORETAGSKONTAKT_URL =
  "https://www.xn--fretagskontakt-vpb.se/api/verifiera-foretagsuppgifter"; // OBEKRAFTAD
const MAX_TWINS_PER_LEAD = 10;

// Steg 2b: TypeSafe Jev väljer vilken namnträff leadet avser.
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const SOURCE_SEARCH_LIMIT = 5; // bolagsdataapi (reserv)
// Under denna sannolikhet används Jevs val ändå, men markeras som osäkert.
export const SAKER_MATCHNING = 0.7;
// Jev måste vara så här säker på "ingen" för att leadet ska räknas som ej hittat.
const INGEN_MATCHNING = 0.7;

function docGet(doc: any, ...paths: string[]): any {
  for (const path of paths) {
    let current = doc;
    let ok = true;
    for (const part of path.split(".")) {
      if (part.endsWith("[0]")) {
        const key = part.slice(0, -3);
        current = current && typeof current === "object" ? current[key] : undefined;
        current = Array.isArray(current) && current.length ? current[0] : undefined;
      } else {
        current = current && typeof current === "object" ? current[part] : undefined;
      }
      if (current === undefined || current === null) {
        ok = false;
        break;
      }
    }
    if (ok && current !== undefined && current !== null) return current;
  }
  return null;
}

function normOrgNr(v: any): string {
  return v === null || v === undefined ? "" : String(v).replace(/\D/g, "");
}

// Bara enkla fält skickas till Jev - räcker för att skilja träffarna åt.
function candidateSummary(hit: any): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(hit || {})) {
    if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (typeof value === "string" && value.trim()) out[key] = value.slice(0, 200);
  }
  return out;
}

const procent = (p: number) => `${Math.round(p * 100)} %`;

// Låter Jev välja vilken sökträff leadet avser. Returnerar index i hits, eller
// null om Jev är säker på att ingen träff är rätt bolag. Misslyckas anropet
// faller vi tillbaka på första träffen (det gamla beteendet) och säger det.
async function pickSourceHit(
  companyName: string,
  candidates: Record<string, any>[],
  typesafeKey: string | undefined
): Promise<{ index: number | null; matchning: string }> {
  if (candidates.length === 1) return { index: 0, matchning: "enda träffen" };
  if (!typesafeKey) return { index: 0, matchning: "första träffen (TYPESAFE_API_KEY saknas)" };

  const criteria: Record<string, string> = {};
  candidates.forEach((c, i) => {
    const ort = c.ort ? `, ${c.ort}` : "";
    criteria[`kandidat_${i}`] = `\`candidates[${i}]\`: ${c.name ?? "?"} (org.nr ${c.org_nr ?? "?"}${ort})`;
  });
  criteria.ingen = "None of the candidates is plausibly the company the lead refers to.";

  try {
    const resp = await fetch(TYPESAFE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: { lead_name: companyName, candidates },
        questions: {
          kallbolag: {
            type: "choice",
            instructions: {
              question:
                "A Swedish salesperson listed `lead_name` as one of their business customers. " +
                "`candidates` are search results from the Swedish company register. " +
                "Which candidate is the company they most likely mean?",
              guidance: [
                "A subsidiary, property company or holding company that only shares the brand is not the same company as the group's main company named in `lead_name`.",
                "Prefer the candidate whose name matches `lead_name` most closely, ignoring legal-form suffixes such as AB, (publ), HB, KB and differences in case, spacing or punctuation.",
                "The lead is a business customer: prefer an active operating company over one that is dissolved, bankrupt, in liquidation or deregistered, and over housing cooperatives (bostadsrättsförening), non-profit associations, foundations or clubs that merely share the name.",
                "If both an operating company and its holding or parent company match, prefer the one with actual operations (revenue, employees).",
                "Choose `ingen` only if no candidate is plausibly the same company.",
              ],
            },
            criteria,
          },
          finns_matchning: {
            type: "noul",
            instructions:
              "Is any company in `candidates` the same company as `lead_name` (the same business, " +
              "possibly written with a different legal-form suffix, abbreviation or spelling)?",
            criteria: {
              true: "At least one candidate is that company.",
              false: "The candidates are only different companies with similar-looking names.",
            },
          },
        },
      }),
    });
    if (!resp.ok) throw new Error(`${resp.status}: ${(await resp.text()).slice(0, 120)}`);
    const answers = (await resp.json()).answers;
    const probs: Record<string, number> = answers.kallbolag.probabilities || {};
    const finns: number = answers.finns_matchning.noul;

    if ((answers.kallbolag.choice === "ingen" && (probs.ingen ?? 0) >= INGEN_MATCHNING) || finns < 1 - INGEN_MATCHNING) {
      const namn = candidates.map((c) => c.name ?? "?").join(", ");
      return {
        index: null,
        matchning: `Jev bedömde att ingen träff är leadet (${procent(Math.max(probs.ingen ?? 0, 1 - finns))}); träffar: ${namn}`,
      };
    }
    // Bästa riktiga kandidat, även när "ingen" vann med liten marginal.
    let best = 0;
    candidates.forEach((_, i) => {
      if ((probs[`kandidat_${i}`] ?? 0) > (probs[`kandidat_${best}`] ?? 0)) best = i;
    });
    const p = probs[`kandidat_${best}`] ?? 0;
    return {
      index: best,
      matchning: p >= SAKER_MATCHNING ? `Jev ${procent(p)}` : `osäker (Jev ${procent(p)}) – kontrollera`,
    };
  } catch (e: any) {
    return { index: 0, matchning: `första träffen (Jev-fel: ${e.message || e})` };
  }
}

// company är null när leadet inte kunde knytas till ett bolag; matchning säger varför.
// ticSource finns när bolaget hittades via tic.io (sparar ett anrop i steg 3).
export interface SourceResult {
  company: Company | null;
  matchning: string;
  ticSource?: TicSource;
}

const TIC_NAME_SEARCH_LIMIT = 10;

function companyFromTicDoc(doc: any, matchning: string): Company {
  const k = docGet(doc, "mostRecentFinancialSummary.rs_NetSalesK");
  return {
    org_nr: normOrgNr(docGet(doc, "registrationNumber")),
    name: docGet(doc, "names[0].nameOrIdentifier") || "",
    net_revenue: k === null ? null : k * 1000, // tic.io anger tusental kr
    employees: docGet(doc, "mostRecentFinancialSummary.fn_NumberOfEmployees"),
    sni_codes: (docGet(doc, "sniCodes") || []).map((c: any) => c.sni_2007Code).filter(Boolean),
    lan: docGet(doc, "registeredOffices[0].county", "mostRecentRegisteredAddress.county"),
    ort: docGet(doc, "mostRecentRegisteredAddress.city", "registeredOffices[0].municipality"),
    matchning,
  };
}

// Det Jev får se om varje namnträff från tic.io.
function ticCandidateSummary(doc: any): Record<string, any> {
  const p = ticProfile(doc);
  return {
    name: p.name,
    org_nr: normOrgNr(docGet(doc, "registrationNumber")),
    ort: p.municipality,
    legal_form: p.legal_form,
    employees: p.employees,
    industry: p.industry,
    business_description: p.business_description ? p.business_description.slice(0, 200) : null,
  };
}

// Steg 2: knyt leadet till ett bolag. Org.nr från CSV:n slås upp direkt.
// Annars namnsökning hos tic.io (rankar namnträffar bättre än bolagsdataapi,
// som t.ex. bara gav SkiStars dotterbolag för "SkiStar AB") och Jev väljer.
// bolagsdataapi används bara om tic.io inte hittar något.
export async function resolveSourceCompany(
  companyName: string,
  ticKey: string,
  bolagsdataKey: string | undefined,
  typesafeKey?: string,
  orgNr?: string
): Promise<SourceResult> {
  if (orgNr) {
    const [doc] = await ticSearch(ticKey, { q: normOrgNr(orgNr), query_by: "registrationNumber", per_page: 1 });
    if (!doc) return { company: null, matchning: `tic.io hittade inget bolag med org.nr ${orgNr}` };
    const company = companyFromTicDoc(doc, "org.nr från CSV");
    return { company, matchning: "org.nr från CSV", ticSource: ticSourceFromDoc(doc, company) };
  }

  const docs = await ticSearch(ticKey, {
    q: companyName,
    query_by: "names.nameOrIdentifier",
    per_page: TIC_NAME_SEARCH_LIMIT,
  });
  if (docs.length) {
    const { index, matchning } = await pickSourceHit(companyName, docs.map(ticCandidateSummary), typesafeKey);
    if (index === null) return { company: null, matchning };
    const company = companyFromTicDoc(docs[index], matchning);
    return { company, matchning, ticSource: ticSourceFromDoc(docs[index], company) };
  }

  if (!bolagsdataKey) return { company: null, matchning: "tic.io gav inga träffar på namnet" };
  return resolveViaBolagsdata(companyName, bolagsdataKey, typesafeKey);
}

async function resolveViaBolagsdata(
  companyName: string,
  bolagsdataKey: string,
  typesafeKey?: string
): Promise<SourceResult> {
  const searchUrl = `${BOLAGSDATA_BASE}/search?${new URLSearchParams({
    q: companyName,
    limit: String(SOURCE_SEARCH_LIMIT),
  })}`;
  const searchResp = await fetch(searchUrl, { headers: { "x-api-key": bolagsdataKey } });
  // Ett fel från API:et (fel nyckel, slut på kvot osv.) ska synas i statusen,
  // inte se ut som att bolaget inte finns.
  if (!searchResp.ok) {
    throw new Error(`${searchResp.status}: ${(await searchResp.text()).slice(0, 200)}`);
  }
  const searchData = await searchResp.json();
  const hits: any[] | undefined = Array.isArray(searchData)
    ? searchData
    : searchData.results || searchData.companies || searchData.data || searchData.hits;
  if (!Array.isArray(hits)) {
    throw new Error(`okänt svarsformat, fält: ${Object.keys(searchData || {}).join(", ")}`);
  }
  if (!hits.length) return { company: null, matchning: "varken tic.io eller bolagsdataapi gav träffar på namnet" };

  const { index, matchning } = await pickSourceHit(companyName, hits.map(candidateSummary), typesafeKey);
  if (index === null) return { company: null, matchning };
  const top = hits[index];
  const orgNr = top.org_nr;
  let details: any = {};
  try {
    const detailsResp = await fetch(`${BOLAGSDATA_BASE}/company/${orgNr}`, {
      headers: { "x-api-key": bolagsdataKey },
    });
    if (detailsResp.ok) details = await detailsResp.json();
  } catch {
    // ignorera - vi har redan grunddata fran sokningen
  }

  // Enligt docs ligger SNI-koderna i "sni", äldre svar använde "sni_codes".
  const sniFromDetails: string[] = (details.sni || details.sni_codes || [])
    .map((c: any) => c.sni_code)
    .filter(Boolean);
  const sniCodes = sniFromDetails.length ? sniFromDetails : [top.sni_code].filter(Boolean);

  const company: Company = {
    org_nr: orgNr,
    name: top.name || companyName,
    net_revenue: top.net_revenue ?? null,
    employees: top.employees ?? null,
    sni_codes: sniCodes,
    lan: top.lan ?? null,
    ort: top.ort ?? null,
    matchning,
  };
  return { company, matchning };
}

// --- Steg 3-4: hitta och ranka tvillingar ---------------------------------
//
// 1. Kallbolagets profil hämtas från tic.io (verksamhetsbeskrivning m.m.).
// 2. Kandidater hämtas brett: samma SNI-koder + bolag med liknande
//    verksamhetsbeskrivning, inom ett vidare storleksintervall än förut.
// 3. Jev bedömer varje kandidat mot kallbolaget (en request per kandidat):
//    hur lik verksamheten är, om den saknar egen verksamhet (holding o.d.),
//    om den hör till samma koncern, och ev. om säsongen stämmer.
// 4. Koden väger ihop Jevs likhet med hur nära i storlek bolaget är.

// Brett sökintervall: en tredjedel till tre gånger kallbolagets storlek.
const WIDE_SIZE_FACTOR = 3;
const PURPOSE_QUERY_CHARS = 200;
const JEV_CONCURRENCY = 20;
// Likhet 0-3 från Jev. Under 1.5 lutar det mot "annan typ av verksamhet".
export const MIN_LIKHET = 1.5;
// Över dessa sannolikheter sorteras kandidaten bort.
const MAX_UTAN_VERKSAMHET = 0.5;
const MAX_SAMMA_KONCERN = 0.5;
// Vikter i totalpoängen (skalas till 0-1).
const VIKT_LIKHET = 0.75;
const VIKT_STORLEK = 0.25;
const VIKT_SASONG = 0.1;

const LIKHET_NIVAER = ["annan bransch", "samma sektor", "samma bransch", "direkt konkurrent"];

export interface Twin extends Company {
  verksamhet?: string | null;
  likhet?: string | null;
  poang?: number | null;
}

export interface TicProfile {
  name: string;
  business_description: string | null;
  industry: string[];
  legal_form: string | null;
  employees: number | null;
  website: string | null;
  municipality: string | null;
  owned_through: string[];
}

function ticProfile(doc: any): TicProfile {
  const sni: any[] = docGet(doc, "sniCodes") || [];
  const owners: any[] = docGet(doc, "currentBeneficialOwners") || [];
  return {
    name: docGet(doc, "names[0].nameOrIdentifier", "name") || "",
    business_description: (docGet(doc, "mostRecentPurpose") || "").slice(0, 600) || null,
    industry: sni.map((c) => c.sni_2007Name || c.sni_2025Name).filter(Boolean),
    legal_form: docGet(doc, "legalEntityType"),
    employees: docGet(doc, "mostRecentFinancialSummary.fn_NumberOfEmployees"),
    website: docGet(doc, "hyperlinks[0].hyperlink"),
    municipality: docGet(doc, "registeredOffices[0].municipality", "mostRecentRegisteredAddress.city"),
    owned_through: Array.from(new Set(owners.map((o) => o.throughName).filter(Boolean))) as string[],
  };
}

async function ticSearch(ticKey: string, body: Record<string, any>): Promise<any[]> {
  const resp = await fetch(TIC_SEARCH_URL, {
    method: "POST",
    headers: { "x-api-key": ticKey, "Content-Type": "application/json" },
    body: JSON.stringify({ per_page: TIC_MAX_PER_PAGE, page: 1, ...body }),
  });
  if (!resp.ok) {
    throw new Error(`tic.io-sokning misslyckades (${resp.status}): ${(await resp.text()).slice(0, 300)}`);
  }
  const data = await resp.json();
  // POST svarar i Typesense multi-search-format: { results: [{ hits, ... }] }.
  // Ett fel i själva sökningen (t.ex. okänt filterfält) kommer då som HTTP 200
  // med "error" inuti results - det ska synas, inte se ut som noll träffar.
  const result = Array.isArray(data.results) ? data.results[0] || {} : data;
  if (result.error) {
    throw new Error(`tic.io-sokning misslyckades (${result.code ?? "?"}): ${String(result.error).slice(0, 300)}`);
  }
  return (result.hits || [])
    .map((hit: any) => hit.document || hit)
    .filter((doc: any) => doc && doc.registrationNumber);
}

function range(field: string, min: number, max: number): string {
  return `${field}:[${Math.max(0, Math.floor(min))}..${Math.ceil(max)}]`;
}

// 1 = samma storlek, 0 = WIDE_SIZE_FACTOR gånger större/mindre eller mer.
function sizeCloseness(source: Company, cand: Company): number | null {
  const parts: number[] = [];
  for (const [a, b] of [
    [source.employees, cand.employees],
    [source.net_revenue, cand.net_revenue],
  ]) {
    if (a && b && a > 0 && b > 0) {
      parts.push(Math.max(0, 1 - Math.abs(Math.log(b / a)) / Math.log(WIDE_SIZE_FACTOR)));
    }
  }
  return parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

interface JevBedomning {
  likhet: number;
  utan_verksamhet: number;
  samma_koncern: number;
  sasong: number | null;
}

async function judgeCandidate(
  source: TicProfile,
  candidate: TicProfile,
  season: string,
  typesafeKey: string
): Promise<JevBedomning> {
  const questions: Record<string, any> = {
    likhet: {
      type: "score",
      instructions: {
        question:
          "How similar is the business of `candidate` to the business of `source`? Compare what they " +
          "actually do and sell, and to whom, using `business_description`, `industry` and `name`.",
        note: "Ignore company size and location; those are compared separately.",
      },
      criteria: [
        "Different industry: `candidate` does something clearly different from `source`, e.g. a gym chain compared with a ski resort operator, or a software consultancy compared with an accounting firm.",
        "Same broad sector but a different kind of business, e.g. a sports retailer or travel agency compared with a ski resort operator.",
        "Same industry but a noticeably different offering or business model, e.g. a golf course or amusement park operator compared with a ski resort operator.",
        "Direct peer: essentially the same kind of business as `source`, e.g. another ski resort operator compared with a ski resort operator, or another accounting firm compared with an accounting firm.",
      ],
    },
    utan_verksamhet: {
      type: "noul",
      instructions:
        "Is `candidate` a holding company, a dormant company, or another entity that mainly exists to own " +
        "shares in other companies rather than running an operating business of its own?",
      criteria: {
        true: "`candidate` has no operating business of its own (holding, dormant, shelf company).",
        false: "`candidate` runs an operating business that sells products or services.",
      },
    },
    samma_koncern: {
      type: "noul",
      instructions:
        "Is `candidate` part of the same corporate group or brand as `source`, for example its subsidiary, " +
        "parent or sister company? Signs are a shared distinctive brand name in `name`, or `owned_through` naming `source`.",
      criteria: {
        true: "`candidate` belongs to the same group or brand as `source`.",
        false: "`candidate` is an independent company, such as a competitor.",
      },
    },
  };
  if (season) {
    questions.sasong = {
      type: "noul",
      instructions:
        "Does the business of `candidate` likely have a strong seasonal peak in demand around `season`, " +
        "like `source` has?",
    };
  }

  const resp = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: season ? { source, candidate, season } : { source, candidate },
      questions,
    }),
  });
  if (!resp.ok) throw new Error(`Jev ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
  const a = (await resp.json()).answers;
  return {
    likhet: a.likhet.score,
    utan_verksamhet: a.utan_verksamhet.noul,
    samma_koncern: a.samma_koncern.noul,
    sasong: a.sasong ? a.sasong.noul : null,
  };
}

export interface TicSource {
  profile: TicProfile;
  sni2007: Set<string>;
  sni2025: Set<string>;
  county: string | null;
}

// Kallbolagets egen post hos tic.io: verksamhetsbeskrivning, SNI 2007 + 2025 och län.
export async function fetchTicSource(source: Company, ticKey: string): Promise<TicSource> {
  const [sourceDoc] = await ticSearch(ticKey, {
    q: normOrgNr(source.org_nr),
    query_by: "registrationNumber",
    per_page: 1,
  });
  return ticSourceFromDoc(sourceDoc, source);
}

function ticSourceFromDoc(sourceDoc: any, source: Company): TicSource {
  const profile: TicProfile = sourceDoc
    ? ticProfile(sourceDoc)
    : {
        name: source.name,
        business_description: null,
        industry: [],
        legal_form: null,
        employees: source.employees ?? null,
        website: null,
        municipality: source.ort ?? null,
        owned_through: [],
      };
  const sni2007 = new Set(source.sni_codes);
  const sni2025 = new Set<string>();
  for (const c of (sourceDoc && docGet(sourceDoc, "sniCodes")) || []) {
    if (c.sni_2007Code) sni2007.add(c.sni_2007Code);
    if (c.sni_2025Code) sni2025.add(c.sni_2025Code);
  }
  const county = sourceDoc ? docGet(sourceDoc, "registeredOffices[0].county", "mostRecentRegisteredAddress.county") : null;
  return { profile, sni2007, sni2025, county };
}

// --- Steg 2c: Jev fyller i lead-kolumner som lämnats tomma i CSV:n -------

export const SASONGER: Record<string, string> = {
  ingen:
    "No strong seasonal peak: demand is fairly even over the year. This fits most businesses, e.g. plumbers, electricians and other trades, accounting, software and most business-to-business services.",
  vinter: "Demand peaks in winter, e.g. ski resorts, snow clearing, heating services.",
  sommar: "Demand peaks in summer, e.g. campsites, boat rentals, ice cream, garden maintenance.",
  jul: "Demand peaks around Christmas and year-end shopping, e.g. gift retail, Christmas events and catering.",
  var: "Demand peaks in spring, e.g. garden centres, bicycle shops, boat and garden supplies.",
  host: "Demand peaks in autumn, e.g. hunting supplies, harvest-related services.",
};
// Lägsta sannolikhet för att en säsong (annan än "ingen") ska användas.
const MIN_SASONG = 0.5;
// Över denna sannolikhet räknas bolaget som lokalt/regionalt -> geografi_relevant.
const MIN_LOKAL = 0.5;

export interface LeadGissning {
  geografi_relevant: boolean;
  geografi_info: string;
  sasongseffekt: string; // "" = ingen säsong
  sasong_info: string;
}

export async function guessLeadOptions(profile: TicProfile, typesafeKey: string): Promise<LeadGissning> {
  const resp = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: { company: profile },
      questions: {
        lokal: {
          type: "noul",
          instructions:
            "Does `company` mainly serve customers in its own local area or region, rather than customers " +
            "across all of Sweden or abroad? Judge from `business_description`, `industry` and `name`.",
          criteria: {
            true: "A local or regional business, e.g. a plumber, a local cleaning company, a regional builder, a restaurant or a local gym.",
            false: "Serves customers nationally or internationally, e.g. a software company, a manufacturer selling across the country, or a destination such as a ski resort that draws visitors from the whole country.",
          },
        },
        sasong: {
          type: "choice",
          instructions:
            "When in the year does demand for the business of `company` peak? Choose a season only if a large share " +
            "of its yearly sales clearly falls in that season; otherwise choose `ingen`. Judge from `business_description`, `industry` and `name`.",
          criteria: SASONGER,
        },
      },
    }),
  });
  if (!resp.ok) throw new Error(`Jev ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
  const a = (await resp.json()).answers;
  const lokal: number = a.lokal.noul;
  const sasong: string = a.sasong.choice;
  const pSasong: number = a.sasong.probabilities?.[sasong] ?? 0;
  const anvandSasong = sasong !== "ingen" && pSasong >= MIN_SASONG;
  return {
    geografi_relevant: lokal >= MIN_LOKAL,
    geografi_info: `${lokal >= MIN_LOKAL ? "ja" : "nej"} (Jev: lokalt bolag ${procent(lokal)})`,
    sasongseffekt: anvandSasong ? sasong : "",
    sasong_info: anvandSasong ? `${sasong} (Jev ${procent(pSasong)})` : `ingen (Jev)`,
  };
}

export async function findTwins(
  source: Company,
  ticSource: TicSource,
  options: LeadOptions,
  ticKey: string,
  excludeOrgNrs: Set<string>,
  typesafeKey?: string
): Promise<Twin[]> {
  const sourceOrgNr = normOrgNr(source.org_nr);
  const { profile: sourceProfile, sni2007, sni2025 } = ticSource;
  // Jämför län med samma källa (tic.io) på båda sidor när det går.
  const sourceLan = ticSource.county ?? source.lan;

  // Storleksfilter hos tic.io. Strikt läge behåller de snäva gränserna,
  // annars ett brett intervall - rankingen sköter resten.
  // Omsättning är i tusental kr hos tic.io (rs_NetSalesK) men i kronor hos bolagsdataapi.
  const sizeFilters: string[] = [];
  if (options.storlek_strikt) {
    if (source.net_revenue) {
      const revK = source.net_revenue / 1000;
      sizeFilters.push(
        range("mostRecentFinancialSummary.rs_NetSalesK", revK * (1 - STRICT_REVENUE_TOLERANCE), revK * (1 + STRICT_REVENUE_TOLERANCE))
      );
    }
    if (source.employees) {
      const [, klassMin, klassMax] = storleksklass(source.employees);
      const min = Math.max(klassMin, source.employees * (1 - STRICT_EMPLOYEE_TOLERANCE));
      let max = source.employees * (1 + STRICT_EMPLOYEE_TOLERANCE) + 1;
      if (klassMax !== null) max = Math.min(max, klassMax);
      sizeFilters.push(range("mostRecentFinancialSummary.fn_NumberOfEmployees", min, max));
    }
  } else {
    if (source.net_revenue) {
      const revK = source.net_revenue / 1000;
      sizeFilters.push(range("mostRecentFinancialSummary.rs_NetSalesK", revK / WIDE_SIZE_FACTOR, revK * WIDE_SIZE_FACTOR));
    }
    if (source.employees) {
      sizeFilters.push(
        range("mostRecentFinancialSummary.fn_NumberOfEmployees", source.employees / WIDE_SIZE_FACTOR, source.employees * WIDE_SIZE_FACTOR + 1)
      );
    }
  }

  const sniFilter = [
    sni2007.size ? `sniCodes.sni_2007Code:[${Array.from(sni2007).join(",")}]` : null,
    sni2025.size ? `sniCodes.sni_2025Code:[${Array.from(sni2025).join(",")}]` : null,
  ].filter(Boolean);

  // Två sökningar parallellt: samma SNI, och liknande verksamhetsbeskrivning
  // (fångar bolag som registrerat sig under en annan SNI-kod).
  const searches: Promise<any[]>[] = [];
  if (sniFilter.length) {
    searches.push(
      ticSearch(ticKey, {
        q: "*",
        query_by: "registrationNumber",
        filter_by: [`(${sniFilter.join(" || ")})`, ...sizeFilters].join(" && "),
      })
    );
  }
  if (sourceProfile.business_description) {
    searches.push(
      ticSearch(ticKey, {
        q: sourceProfile.business_description.slice(0, PURPOSE_QUERY_CHARS),
        query_by: "mostRecentPurpose",
        ...(sizeFilters.length ? { filter_by: sizeFilters.join(" && ") } : {}),
      }).catch(() => [] as any[]) // extra källa - får inte stoppa SNI-sökningen
    );
  }
  const docs = (await Promise.all(searches)).flat();

  const seen = new Set<string>();
  const pool: { company: Twin; profile: TicProfile }[] = [];
  for (const doc of docs) {
    const candOrgNr = normOrgNr(docGet(doc, "registrationNumber", "org_nr"));
    if (!candOrgNr || candOrgNr === sourceOrgNr || excludeOrgNrs.has(candOrgNr) || seen.has(candOrgNr)) continue;
    seen.add(candOrgNr);

    const candLan = docGet(doc, "registeredOffices[0].county", "mostRecentRegisteredAddress.county", "lan");
    if (options.geografi_relevant) {
      if (sourceLan && candLan && candLan.trim().toLowerCase() !== sourceLan.trim().toLowerCase()) {
        continue;
      }
    }

    const profile = ticProfile(doc);
    pool.push({
      profile,
      company: {
        org_nr: candOrgNr,
        name: profile.name,
        net_revenue: (() => {
          const k = docGet(doc, "mostRecentFinancialSummary.rs_NetSalesK", "rs_NetSalesK");
          return k === null ? null : k * 1000;
        })(),
        employees: profile.employees,
        sni_codes: (docGet(doc, "sniCodes") || [])
          .map((c: any) => (typeof c === "string" ? c : c.sni_2007Code))
          .filter(Boolean),
        lan: candLan,
        ort: docGet(doc, "mostRecentRegisteredAddress.city", "ort"),
        verksamhet: profile.business_description,
      },
    });
  }

  // Utan Jev: ranka bara på storlek (bättre än tic.io:s godtyckliga ordning).
  if (!typesafeKey) {
    for (const { company } of pool) {
      company.poang = sizeCloseness(source, company) ?? 0;
      company.likhet = "ej bedömd (TYPESAFE_API_KEY saknas)";
    }
    return pool
      .map((p) => p.company)
      .sort((a, b) => (b.poang ?? 0) - (a.poang ?? 0))
      .slice(0, MAX_TWINS_PER_LEAD);
  }

  const season = options.sasongseffekt;
  const judged = await mapLimit(pool, JEV_CONCURRENCY, async ({ company, profile }) => {
    try {
      return { company, jev: await judgeCandidate(sourceProfile, profile, season, typesafeKey) };
    } catch {
      return { company, jev: null };
    }
  });
  if (pool.length && judged.every((j) => !j.jev)) {
    throw new Error("Jev-bedömningen misslyckades för alla kandidater");
  }

  const twins: Twin[] = [];
  for (const { company, jev } of judged) {
    if (!jev) continue;
    if (jev.utan_verksamhet > MAX_UTAN_VERKSAMHET || jev.samma_koncern > MAX_SAMMA_KONCERN) continue;
    if (jev.likhet < MIN_LIKHET) continue;
    const storlek = sizeCloseness(source, company) ?? 0.5;
    const sasong = jev.sasong !== null ? VIKT_SASONG * jev.sasong : 0;
    const maxPoang = 1 + (jev.sasong !== null ? VIKT_SASONG : 0);
    company.poang =
      Math.round(((VIKT_LIKHET * (jev.likhet / 3) + VIKT_STORLEK * storlek + sasong) / maxPoang) * 100) / 100;
    company.likhet = `${LIKHET_NIVAER[Math.round(jev.likhet)]} (${jev.likhet.toFixed(1)}/3)`;
    twins.push(company);
  }
  return twins.sort((a, b) => (b.poang ?? 0) - (a.poang ?? 0)).slice(0, MAX_TWINS_PER_LEAD);
}

export async function enrichContact(company: Company, foretagskontaktKey: string): Promise<void> {
  try {
    const resp = await fetch(
      `${FORETAGSKONTAKT_URL}?${new URLSearchParams({ org_nr: company.org_nr })}`,
      { headers: { Authorization: `Bearer ${foretagskontaktKey}` } }
    );
    if (!resp.ok) return;
    const data = await resp.json();
    const person = data.decision_maker || data.beslutsfattare || {};
    company.contact_name = person.name ?? null;
    company.contact_email = person.email ?? null;
    company.contact_phone = person.phone ?? null;
  } catch {
    // foretagskontakt.se är OBEKRÄFTAD - misslyckas tyst, lead får statusen
    // "tvilling hittad (ingen kontakt)" istället för att krascha hela körningen.
  }
}

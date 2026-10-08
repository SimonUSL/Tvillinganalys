import { cacheGet, cacheNyckel, cacheSet } from "./cache";

// twinfinder.ts — portning av twin_finder.py:s sök-logik till webb-appen.
//
// Steg 2: namnsökning hos bolagsdataapi.se, Jev väljer rätt träff (tic.io som reserv)
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
  // true när antalet anställda är uppskattat från SCB:s storleksklass (t.ex. "500-999").
  employees_uppskattat?: boolean;
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
const SOURCE_SEARCH_LIMIT = 10; // bolagsdataapi:s namnsökning
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

// "Dalarnas län" (tic.io) och "Dalarna" (bolagsdataapi) ska räknas som samma län.
function normLan(lan: string): string {
  return lan.trim().toLowerCase().replace(/\s+län$/, "").replace(/s$/, "");
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
// Underlag från en formulärförfrågan: meddelandet (utan personuppgifter) och
// e-postdomänen. Hjälper Jev att skilja namnlika bolag åt (ort, signatur).
export interface LeadKontext {
  message: string;
  email_domain: string | null;
}

async function pickSourceHit(
  companyName: string,
  candidates: Record<string, any>[],
  typesafeKey: string | undefined,
  kontext?: LeadKontext
): Promise<{ index: number | null; matchning: string; forslag?: number }> {
  // Med kontext (sökterm gissad ur en förfrågan) kan även en ensam träff vara fel.
  if (candidates.length === 1 && !kontext) return { index: 0, matchning: "enda träffen" };
  if (!typesafeKey) return { index: 0, matchning: "första träffen (TYPESAFE_API_KEY saknas)" };

  const criteria: Record<string, string> = {};
  candidates.forEach((c, i) => {
    const ortNamn = c.ort ?? c.postal_town;
    const ort = ortNamn ? `, ${ortNamn}` : "";
    criteria[`kandidat_${i}`] = `\`candidates[${i}]\`: ${c.name ?? "?"} (org.nr ${c.org_nr ?? "?"}${ort})`;
  });
  criteria.ingen = "None of the candidates is plausibly the company the lead refers to.";

  try {
    const resp = await fetch(TYPESAFE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: kontext ? { lead_name: companyName, lead_context: kontext, candidates } : { lead_name: companyName, candidates },
        questions: {
          kallbolag: {
            type: "choice",
            instructions: {
              question: kontext
                ? "`lead_context` is an inquiry sent through a website form; `lead_name` is a search term taken from the " +
                  "sender's email domain or message. `candidates` are search results from the Swedish company register. " +
                  "Which candidate is the organisation that sent the inquiry? Use `lead_context.email_domain` and the " +
                  "message (city, signature, what they do) to tell candidates apart."
                : "A Swedish salesperson listed `lead_name` as one of their business customers. " +
                  "`candidates` are search results from the Swedish company register. " +
                  "Which candidate is the company they most likely mean?",
              guidance: [
                "A subsidiary, property company or holding company that only shares the brand is not the same company as the group's main company named in `lead_name`.",
                "Prefer the candidate whose name matches `lead_name` most closely, ignoring legal-form suffixes such as AB, (publ), HB, KB and differences in case, spacing or punctuation.",
                kontext
                  ? "Compare what the message says the sender does, sells or plans with each candidate's `business_description`. This matters more than the name: several companies can share a name, and the right one is the one whose business fits the message. Prefer an active organisation over one that is dissolved, bankrupt, in liquidation or deregistered. The sender may be a company, an association or a public body - follow what the message says."
                  : "The lead is a business customer: prefer an active operating company over one that is dissolved, bankrupt, in liquidation or deregistered, and over housing cooperatives (bostadsrättsförening), non-profit associations, foundations or clubs that merely share the name.",
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
      const namn =
        candidates.slice(0, 5).map((c) => c.name ?? "?").join(", ") +
        (candidates.length > 5 ? ` m.fl. (${candidates.length} st)` : "");
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
    // Söktermen är bara gissad ur en förfrågan: hellre nästa sökväg (eller
    // "kontrollera manuellt") än ett osäkert bolag. Tallnäs matchades annars
    // mot en elfirma med "Tallner" i namnet.
    if (kontext && p < SAKER_MATCHNING) {
      return { index: null, matchning: `osäker träff (Jev ${procent(p)}: ${candidates[best]?.name ?? "?"})`, forslag: best };
    }
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
  // Osäkert förslag som användaren kan godta med ett klick i granskningen.
  forslag?: { namn: string; org_nr: string };
}

const TIC_NAME_SEARCH_LIMIT = 10;

// Exakt antal anställda om det finns, annars mitten av SCB:s storleksklass.
function ticEmployees(doc: any): { employees: number | null; uppskattat: boolean } {
  const exakt = docGet(doc, "mostRecentFinancialSummary.fn_NumberOfEmployees");
  if (exakt !== null) return { employees: exakt, uppskattat: false };
  const klass: string = docGet(doc, "cNbrEmployeesInterval.categoryCodeDescription") || "";
  const tal = (klass.replace(/\s/g, "").match(/\d+/g) || []).map(Number);
  if (!tal.length) return { employees: null, uppskattat: false };
  const [low, high] = [tal[0], tal[1] ?? tal[0]];
  return { employees: Math.round(Math.sqrt(Math.max(low, 1) * Math.max(high, 1))), uppskattat: true };
}

function companyFromTicDoc(doc: any, matchning: string): Company {
  const k = docGet(doc, "mostRecentFinancialSummary.rs_NetSalesK");
  const anst = ticEmployees(doc);
  return {
    org_nr: normOrgNr(docGet(doc, "registrationNumber")),
    name: docGet(doc, "names[0].nameOrIdentifier") || "",
    net_revenue: k === null ? null : k * 1000, // tic.io anger tusental kr
    employees: anst.employees,
    employees_uppskattat: anst.uppskattat,
    // Huvudkoden (lägst rank) först.
    sni_codes: [...(docGet(doc, "sniCodes") || [])]
      .sort((a: any, b: any) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((c: any) => c.sni_2007Code)
      .filter(Boolean),
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

// Bolagsformen ("AB", "Aktiebolag", "(publ)" ...) tas bort ur söksträngen.
// SkiStar heter t.ex. "SkiStar Aktiebolag" i registret, så "SkiStar AB" missade
// moderbolaget både hos bolagsdataapi och tic.io. Jev väljer sedan bland träffarna.
const BOLAGSFORMER =
  /\(publ\)|\b(aktiebolaget|aktiebolag|ab|publ|handelsbolag|hb|kommanditbolag|kb|ekonomisk förening|ek\.? ?för\.?)\b/gi;
export function namnUtanBolagsform(namn: string): string {
  const kort = namn.replace(BOLAGSFORMER, " ").replace(/\s+/g, " ").trim();
  return kort || namn.trim();
}

// Steg 2: knyt leadet till ett bolag. Görs via bolagsdataapi (sökning +
// detaljer = 2 anrop) så att tic.io-kvoten (200/mån) räcker till tvillingarna.
// tic.io:s namnsökning används bara som reserv. Org.nr från CSV:n slås upp direkt.
export async function resolveSourceCompany(
  companyName: string,
  tic: Tic,
  bolagsdataKey: string | undefined,
  typesafeKey?: string,
  orgNr?: string
): Promise<SourceResult> {
  if (bolagsdataKey) {
    if (orgNr) {
      const result = await bolagsdataDetails(normOrgNr(orgNr), bolagsdataKey, null, "angivet org.nr");
      if (result.company) return result;
    } else {
      const result = await resolveViaBolagsdata(companyName, bolagsdataKey, typesafeKey);
      if (result.company) return result;
      // Inget säkert val hos bolagsdataapi - prova tic.io:s namnsökning.
      const viaTic = await resolveViaTic(companyName, tic, typesafeKey);
      return viaTic.company ? viaTic : { company: null, matchning: `${result.matchning}; tic.io: ${viaTic.matchning}` };
    }
  }
  if (orgNr) {
    const [doc] = await ticSearch(tic, { q: normOrgNr(orgNr), query_by: "registrationNumber", per_page: 1 });
    if (!doc) return { company: null, matchning: `hittade inget bolag med org.nr ${orgNr}` };
    const company = companyFromTicDoc(doc, "angivet org.nr");
    return { company, matchning: "angivet org.nr", ticSource: ticSourceFromDoc(doc, company) };
  }
  return resolveViaTic(companyName, tic, typesafeKey);
}

// bolagsdataapi saknar ibland storlek (t.ex. SkiStars moderbolag). Fylls i
// från kallbolagets egen tic.io-post (anställda, omsättning, branschnamn).
function applyTicSize(source: Company, ticSource: TicSource, doc: any): void {
  const fromTic = companyFromTicDoc(doc, source.matchning || "");
  source.employees = fromTic.employees;
  source.employees_uppskattat = fromTic.employees_uppskattat;
  source.net_revenue = fromTic.net_revenue;
  const profile = ticProfile(doc);
  if (!ticSource.profile.industry.length) ticSource.profile.industry = profile.industry;
  if (!ticSource.profile.employees) ticSource.profile.employees = profile.employees;
  if (!ticSource.countyCode) {
    const kod = docGet(doc, "registeredOfficeCountyCode");
    if (kod !== null) ticSource.countyCode = Number(kod);
  }
}

async function resolveViaTic(companyName: string, tic: Tic, typesafeKey?: string): Promise<SourceResult> {
  const docs = await ticSearch(tic, {
    q: namnUtanBolagsform(companyName),
    query_by: "names.nameOrIdentifier",
    per_page: TIC_NAME_SEARCH_LIMIT,
  });
  if (!docs.length) return { company: null, matchning: "tic.io gav inga träffar på namnet" };
  const { index, matchning } = await pickSourceHit(companyName, docs.map(ticCandidateSummary), typesafeKey);
  if (index === null) return { company: null, matchning };
  const company = companyFromTicDoc(docs[index], matchning);
  return { company, matchning, ticSource: ticSourceFromDoc(docs[index], company) };
}

async function bolagsdataGet(path: string, bolagsdataKey: string): Promise<any> {
  const nyckel = cacheNyckel("bd", path); // nyckeln är sökvägen, aldrig API-nyckeln
  const sparad = await cacheGet<any>(nyckel);
  if (sparad) return sparad;
  const resp = await fetch(`${BOLAGSDATA_BASE}${path}`, { headers: { "x-api-key": bolagsdataKey } });
  // Ett fel från API:et (fel nyckel, slut på kvot osv.) ska synas i statusen,
  // inte se ut som att bolaget inte finns. Fel cachas inte.
  if (!resp.ok) throw new Error(`bolagsdataapi ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  await cacheSet(nyckel, data);
  return data;
}

export async function resolveViaBolagsdata(
  companyName: string,
  bolagsdataKey: string,
  typesafeKey?: string,
  kontext?: LeadKontext
): Promise<SourceResult> {
  const searchData = await bolagsdataGet(
    `/search?${new URLSearchParams({ q: namnUtanBolagsform(companyName), limit: String(SOURCE_SEARCH_LIMIT) })}`,
    bolagsdataKey
  );
  const hits: any[] | undefined = Array.isArray(searchData) ? searchData : searchData.hits || searchData.results;
  if (!Array.isArray(hits)) {
    throw new Error(`okänt svarsformat från bolagsdataapi, fält: ${Object.keys(searchData || {}).join(", ")}`);
  }
  if (!hits.length) return { company: null, matchning: "bolagsdataapi gav inga träffar på namnet" };

  // Från en förfrågan: hämta verksamhetsbeskrivningen för de främsta träffarna
  // så att Jev kan jämföra med vad avsändaren skriver. Namnlika bolag skiljs
  // ofta bara åt av verksamheten ("Assistansgruppen" = personlig assistans i
  // Tollarp, men vägassistans i Kronoberg - förfrågan gällde fordonsägare).
  const urval = kontext ? hits.slice(0, KONTEXT_DETALJER) : hits;
  const kandidater = urval.map(candidateSummary) as Record<string, any>[];
  const detaljer: (any | null)[] = kontext
    ? await mapLimit(urval, KONTEXT_DETALJER, (h) =>
        bolagsdataGet(`/company/${normOrgNr(h.org_nr)}`, bolagsdataKey).catch(() => null)
      )
    : [];
  detaljer.forEach((d, i) => {
    const c = d?.company;
    if (!c) return;
    kandidater[i] = {
      ...kandidater[i],
      business_description: (c.business_description || "").slice(0, 300) || undefined,
      county: c.county_name || undefined,
      legal_form: c.legal_form_text || undefined,
    };
  });

  const { index, matchning, forslag } = await pickSourceHit(companyName, kandidater, typesafeKey, kontext);
  if (index === null) {
    const h = forslag !== undefined ? urval[forslag] : null;
    return { company: null, matchning, ...(h ? { forslag: { namn: h.name, org_nr: normOrgNr(h.org_nr) } } : {}) };
  }
  return bolagsdataDetails(urval[index].org_nr, bolagsdataKey, urval[index], matchning, detaljer[index] ?? undefined);
}

// Så många namnträffar får verksamhetsbeskrivning när bolaget ska hittas ur en förfrågan.
const KONTEXT_DETALJER = 5;

// Detaljanropet ger verksamhetsbeskrivning, län och SNI-koder. Storlek finns
// bara i sökträffen (hit), så vid uppslag på org.nr saknas den.
export async function bolagsdataDetails(
  orgNr: string,
  bolagsdataKey: string,
  hit: any | null,
  matchning: string,
  forladdad?: any // redan hämtade detaljer - inget nytt anrop
): Promise<SourceResult> {
  let data: any;
  try {
    data = forladdad ?? (await bolagsdataGet(`/company/${orgNr}`, bolagsdataKey));
  } catch (e: any) {
    if (!hit) return { company: null, matchning: `bolagsdataapi hittade inte org.nr ${orgNr}` };
    data = {};
  }
  const c = data.company || {};
  // Huvudkoden först (is_primary / ordinal) - den avgör branschen i steg 3.
  const sniCodes: string[] = [...(data.sni || data.sni_codes || [])]
    .sort((a: any, b: any) => Number(!!b.is_primary) - Number(!!a.is_primary) || (a.ordinal ?? 0) - (b.ordinal ?? 0))
    .map((x: any) => x.sni_code)
    .filter(Boolean);
  const company: Company = {
    org_nr: normOrgNr(orgNr),
    name: c.name || hit?.name || "",
    net_revenue: hit?.net_revenue || null,
    employees: hit?.employees ?? null,
    sni_codes: sniCodes,
    lan: c.county_name ?? null,
    ort: c.postal_town ?? hit?.postal_town ?? null,
    matchning,
  };
  const ticSource: TicSource = {
    profile: {
      name: company.name,
      business_description: (c.business_description || "").slice(0, 600) || null,
      industry: [],
      legal_form: c.legal_form_text ?? hit?.legal_form_text ?? null,
      employees: company.employees ?? null,
      website: c.website ?? null,
      municipality: company.ort ?? null,
      owned_through: [],
    },
    sni2007: new Set(sniCodes),
    sni2025: new Set(),
    county: company.lan ?? null,
    countyCode: c.county_code ? Number(c.county_code) : null,
  };
  return { company, matchning, ticSource };
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
// Storleksavstånd där storlekspoängen når 0.
const WIDER_SIZE_FACTOR = 10;
// Ger SNI-sökningen färre bolag än så här inom intervallet söks i stället
// "högst 3x större, störst först" - dvs. de närmaste i storlek underifrån.
// Behövs för bolag som är störst i sin bransch: SkiStar (4,7 mdr kr) har inga
// skidbolag inom 1/3-3x, men Branäs, Romme, Stöten m.fl. under 400 Mkr.
const MIN_SNI_POOL = 20;
// Högst så här många bolag med samma huvud-SNI = nischbransch: storlek
// ignoreras vid urvalet och väger lätt i poängen (t.ex. skidanläggningar, ~140).
// Fler = trång bransch (bagerier, städfirmor): storlek och geografi avgör.
export const NISCH_MAX_BOLAG = 300;
const VIKT_STORLEK_NISCH = 0.05;
const JEV_CONCURRENCY = 20;
// Likhet 0-3 från Jev. Under 1.5 lutar det mot "annan typ av verksamhet".
export const MIN_LIKHET = 1.5;
// "Stark" tvilling = i praktiken direkt konkurrent. Ger SNI-sökningen minst
// så här många starka hoppas nyckelordssökningen över (sparar ett tic.io-anrop).
const STARK_LIKHET = 2.5;
const MIN_STARKA_TVILLINGAR = 10;
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
    employees: ticEmployees(doc).employees,
    website: docGet(doc, "hyperlinks[0].hyperlink"),
    municipality: docGet(doc, "registeredOffices[0].municipality", "mostRecentRegisteredAddress.city"),
    owned_through: Array.from(new Set(owners.map((o) => o.throughName).filter(Boolean))) as string[],
  };
}

// Träffarna, plus "found" = hur många bolag som matchade totalt hos tic.io.
type TicHits = any[] & { found?: number };

// tic.io-nyckeln plus en cache som lever en körning (en CSV). Leads i samma
// bransch delar då t.ex. "hela branschen"-sökningen i stället för att betala
// för den igen. Kvoten är bara 200 anrop/mån.
export interface Tic {
  key: string;
  cache: Map<string, Promise<TicHits>>;
  anrop: number; // faktiska anrop mot tic.io i körningen
  cacheTraffar: number; // svar från Redis-cachen (kostar ingen kvot)
  maxAnrop: number | null; // tak för körningen; null = inget tak
}
export function ticKlient(key: string, maxAnrop: number | null = null): Tic {
  return { key, cache: new Map(), anrop: 0, cacheTraffar: 0, maxAnrop };
}

export class TicBudgetSlut extends Error {
  constructor() {
    super("taket för tic.io-anrop i körningen är nått");
  }
}
const ticBudgetKvar = (tic: Tic) => tic.maxAnrop === null || tic.anrop < tic.maxAnrop;

function ticSearch(tic: Tic, body: Record<string, any>): Promise<TicHits> {
  const cacheKey = JSON.stringify(body);
  const cached = tic.cache.get(cacheKey);
  if (cached) return cached;
  const promise = ticSearchUncached(tic, body);
  tic.cache.set(cacheKey, promise);
  promise.catch(() => tic.cache.delete(cacheKey)); // fel ska inte cachas
  return promise;
}

// Bara fälten appen använder sparas i cachen - hela tic.io-poster är stora.
const TIC_CACHE_FALT = [
  "registrationNumber", "names", "legalEntityType", "mostRecentPurpose", "sniCodes", "mostRecentFinancialSummary",
  "cNbrEmployeesInterval", "hyperlinks", "registeredOffices", "registeredOfficeCountyCode",
  "mostRecentRegisteredAddress", "currentBeneficialOwners",
];
function trimTicDoc(doc: any): any {
  const ut: any = {};
  for (const f of TIC_CACHE_FALT) if (doc[f] !== undefined && doc[f] !== null) ut[f] = doc[f];
  if (ut.names) ut.names = ut.names.slice(0, 1);
  if (ut.hyperlinks) ut.hyperlinks = ut.hyperlinks.slice(0, 3);
  if (ut.currentBeneficialOwners) ut.currentBeneficialOwners = ut.currentBeneficialOwners.map((o: any) => ({ throughName: o.throughName }));
  return ut;
}

async function ticSearchUncached(tic: Tic, body: Record<string, any>): Promise<TicHits> {
  const nyckel = cacheNyckel("tic", body);
  const sparad = await cacheGet<{ found: number; docs: any[] }>(nyckel);
  if (sparad) {
    tic.cacheTraffar++;
    const docs: TicHits = sparad.docs;
    docs.found = sparad.found;
    return docs;
  }
  if (!ticBudgetKvar(tic)) throw new TicBudgetSlut();
  tic.anrop++;
  const resp = await fetch(TIC_SEARCH_URL, {
    method: "POST",
    headers: { "x-api-key": tic.key, "Content-Type": "application/json" },
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
  const docs: TicHits = (result.hits || [])
    .map((hit: any) => trimTicDoc(hit.document || hit))
    .filter((doc: any) => doc && doc.registrationNumber);
  docs.found = result.found;
  await cacheSet(nyckel, { found: docs.found, docs });
  return docs;
}

function range(field: string, min: number, max: number): string {
  return `${field}:[${Math.max(0, Math.floor(min))}..${Math.ceil(max)}]`;
}

// 1 = samma storlek, 0 = WIDER_SIZE_FACTOR gånger större/mindre eller mer.
function sizeCloseness(source: Company, cand: Company): number | null {
  const parts: number[] = [];
  for (const [a, b] of [
    [source.employees, cand.employees],
    [source.net_revenue, cand.net_revenue],
  ]) {
    if (a && b && a > 0 && b > 0) {
      parts.push(Math.max(0, 1 - Math.abs(Math.log(b / a)) / Math.log(WIDER_SIZE_FACTOR)));
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
  // SCB:s länskod (20 = Dalarna) - samma i bolagsdataapi och tic.io.
  countyCode: number | null;
}

// Kallbolagets egen post hos tic.io: verksamhetsbeskrivning, SNI 2007 + 2025 och län.
export async function fetchTicSource(source: Company, tic: Tic): Promise<TicSource> {
  const [sourceDoc] = await ticSearch(tic, {
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
  const countyCode = sourceDoc ? docGet(sourceDoc, "registeredOfficeCountyCode", "registeredOffices[0].countyCode") : null;
  return { profile, sni2007, sni2025, county, countyCode: countyCode === null ? null : Number(countyCode) };
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

// Beskrivningssökningen hos tic.io kräver att ALLA ord i frågan matchar, så en
// hel mening ger nästan inga träffar. Därför plockar koden ut kandidatord ur
// verksamhetsbeskrivningen och Jev väljer det ord som bäst beskriver kärn-
// verksamheten ("välj i stället för att generera"). Sökningen görs på ordet.
const BESKRIVNING_STOPPORD = new Set(
  ("föremålet bolagets bolaget verksamhet verksamheten skall ska bedriva driva själv genom annat annan " +
    "bolag samt därmed förenlig förenliga jämte huvudsaklig huvudsakligen inriktning äga förvalta " +
    "försäljning handel tjänster aktier värdepapper egendom fastigheter fast övrig övriga också även " +
    "inom eller och med mot för till från vara utföra erbjuda andra direkt indirekt dotterbolag huvud saklig " +
    "privatpersoner företag kunder").split(" ")
);

export function beskrivningsord(text: string): string[] {
  const ord = (text.toLowerCase().match(/[a-zåäöéü][a-zåäöéü-]{4,}/g) || [])
    .map((o) => o.replace(/-+$/, ""))
    .filter((o) => o.length >= 5 && !BESKRIVNING_STOPPORD.has(o));
  return Array.from(new Set(ord)).slice(0, 60);
}

// "skidanläggningar" -> "skidanläggning", så att prefixsökningen även
// träffar singular och bestämd form.
function ordstam(ord: string): string {
  for (const suffix of ["arna", "erna", "orna", "ar", "er", "or", "en", "et", "na"]) {
    if (ord.endsWith(suffix) && ord.length - suffix.length >= 5) return ord.slice(0, -suffix.length);
  }
  return ord;
}

export async function pickPurposeKeyword(profile: TicProfile, typesafeKey: string): Promise<string | null> {
  const ord = beskrivningsord(profile.business_description || "");
  if (!ord.length) return null;
  if (ord.length === 1) return ordstam(ord[0]).replace(/-/g, " ");
  const criteria: Record<string, string | null> = {};
  for (const o of ord) criteria[o] = null;
  criteria.inget = "None of the words names what the company actually does.";
  const resp = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: { company: { name: profile.name, business_description: profile.business_description, industry: profile.industry } },
      questions: {
        nyckelord: {
          type: "choice",
          instructions:
            "Which single word from `company.business_description` most specifically names the company's core business, " +
            "i.e. what it mainly operates or sells? Choose the most specific word that separates this kind of business " +
            "from other kinds; avoid broad words that many different businesses share.",
          criteria,
        },
      },
    }),
  });
  if (!resp.ok) throw new Error(`Jev ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
  const choice: string = (await resp.json()).answers.nyckelord.choice;
  // "vvs-installation" -> "vvs installation" (tic.io delar ändå orden vid bindestreck)
  return choice === "inget" ? null : ordstam(choice).replace(/-/g, " ");
}

// tic.io:s filter släpper bara igenom bolag som HAR fältet. Många saknar
// exakt antal anställda (även SkiStar), så omsättning filtreras i första hand
// och anställda bara när omsättning saknas och antalet inte är uppskattat.
// Strikt läge behåller de snäva gränserna oavsett faktor.
// Omsättning är i tusental kr hos tic.io (rs_NetSalesK) men i kronor hos bolagsdataapi.
function buildSizeFilters(source: Company, strikt: boolean, factor: number, endastTak = false): string[] {
  if (source.net_revenue) {
    const revK = source.net_revenue / 1000;
    return [
      strikt
        ? range("mostRecentFinancialSummary.rs_NetSalesK", revK * (1 - STRICT_REVENUE_TOLERANCE), revK * (1 + STRICT_REVENUE_TOLERANCE))
        : range("mostRecentFinancialSummary.rs_NetSalesK", endastTak ? 0 : revK / factor, revK * factor),
    ];
  }
  if (source.employees && !source.employees_uppskattat) {
    if (strikt) {
      const [, klassMin, klassMax] = storleksklass(source.employees);
      const min = Math.max(klassMin, source.employees * (1 - STRICT_EMPLOYEE_TOLERANCE));
      let max = source.employees * (1 + STRICT_EMPLOYEE_TOLERANCE) + 1;
      if (klassMax !== null) max = Math.min(max, klassMax);
      return [range("mostRecentFinancialSummary.fn_NumberOfEmployees", min, max)];
    }
    return [
      range("mostRecentFinancialSummary.fn_NumberOfEmployees", endastTak ? 0 : source.employees / factor, source.employees * factor + 1),
    ];
  }
  return [];
}

// Fältet som storleksfiltret använder - för sortering "störst först".
function sizeSortField(source: Company): string | null {
  if (source.net_revenue) return "mostRecentFinancialSummary.rs_NetSalesK";
  if (source.employees && !source.employees_uppskattat) return "mostRecentFinancialSummary.fn_NumberOfEmployees";
  return null;
}

export interface TwinResult {
  twins: Twin[];
  // Hur kandidaterna valdes, t.ex. "nischbransch (139 bolag med SNI 93111): storlek ignorerad".
  urval: string;
}

export async function findTwins(
  source: Company,
  ticSource: TicSource,
  options: LeadOptions,
  tic: Tic,
  excludeOrgNrs: Set<string>,
  typesafeKey?: string,
  bolagsdataKey?: string
): Promise<TwinResult> {
  const sourceOrgNr = normOrgNr(source.org_nr);
  const { profile: sourceProfile, sni2007 } = ticSource;
  // Jämför län med samma källa (tic.io) på båda sidor när det går.
  const sourceLan = ticSource.county ?? source.lan;
  const filterBy = (filters: string[]) => (filters.length ? { filter_by: filters.join(" && ") } : {});
  const logg: Record<string, any> = { steg: "tvillingsökning", kallbolag: source.name };
  const anropFore = tic.anrop;
  const urvalDelar: string[] = [];

  // --- Gemensamt: kandidatpool, Jev-bedömning och poäng ---------------------
  const seen = new Set<string>([sourceOrgNr]);
  const koncernInfo = new Map<Twin, KoncernInfo>();
  const twins: Twin[] = [];
  const narhet = new Map<Twin, number>(); // storleksnärhet, för att bryta lika poäng
  const bort = { jev_fel: 0, utan_verksamhet: 0, samma_koncern: 0, for_olik: 0 };
  let kandidater = 0;
  let starka = 0;
  let nisch = false;
  const season = options.sasongseffekt;

  const judgePool = async (pool: { company: Twin; profile: TicProfile }[]) => {
    if (!typesafeKey) return;
    kandidater += pool.length;
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
    for (const { company, jev } of judged) {
      if (!jev) {
        bort.jev_fel++;
        continue;
      }
      if (jev.utan_verksamhet > MAX_UTAN_VERKSAMHET) {
        bort.utan_verksamhet++;
        continue;
      }
      if (jev.samma_koncern > MAX_SAMMA_KONCERN) {
        bort.samma_koncern++;
        continue;
      }
      if (jev.likhet < MIN_LIKHET) {
        bort.for_olik++;
        continue;
      }
      if (jev.likhet >= STARK_LIKHET) starka++;
      const storlek = sizeCloseness(source, company) ?? 0.5;
      const viktStorlek = nisch ? VIKT_STORLEK_NISCH : VIKT_STORLEK;
      narhet.set(company, storlek);
      const sasong = jev.sasong !== null ? VIKT_SASONG * jev.sasong : 0;
      const maxPoang = 1 + (jev.sasong !== null ? VIKT_SASONG : 0);
      company.poang =
        Math.round(
          ((VIKT_LIKHET * (jev.likhet / 3) + viktStorlek * storlek + sasong) / (maxPoang - VIKT_STORLEK + viktStorlek)) * 100
        ) / 100;
      company.likhet = `${LIKHET_NIVAER[Math.round(jev.likhet)]} (${jev.likhet.toFixed(1)}/3)`;
      twins.push(company);
    }
  };

  // --- Fas 0: bolagsdataapi (500 anrop/dygn) före tic.io (200/mån) ----------
  // Sök bolag vars NAMN innehåller branschordet (t.ex. "städ"), i samma län om
  // geografin är relevant och i samma storleksklass. Fungerar bäst för lokala
  // hantverks- och tjänstebolag - just de trånga branscher som kostar mest hos tic.io.
  if (bolagsdataKey && typesafeKey) {
    try {
      const fas0 = await bolagsdataCandidates(source, ticSource, options, bolagsdataKey, typesafeKey, seen, excludeOrgNrs);
      logg.bolagsdata = fas0.logg;
      for (const { company, profile, koncern } of fas0.pool) koncernInfo.set(company, koncern);
      await judgePool(fas0.pool.map(({ company, profile }) => ({ company, profile })));
      if (fas0.pool.length) urvalDelar.push(fas0.urval);
    } catch (e: any) {
      logg.bolagsdata_fel = String(e.message || e);
    }
  }

  // --- tic.io: bara om bolagsdataapi inte gav tillräckligt ------------------
  let medNyckelord = false;
  if (!typesafeKey || starka < MIN_STARKA_TVILLINGAR) {
    try {
      await ticPhases();
    } catch (e: any) {
      if (!(e instanceof TicBudgetSlut)) throw e;
      logg.tic_budget_slut = true;
      urvalDelar.push("tic.io-taket nått");
    }
  } else {
    logg.tic = "hoppades över (tillräckligt många starka tvillingar från bolagsdataapi)";
  }

  async function ticPhases() {
    // Huvud-SNI avgör branschen. Bisidokoder (SkiStar: uthyrning, utbildning)
    // drar in tusentals orelaterade bolag; den som registrerat sig annorlunda
    // fångas i stället av nyckelordssökningen nedan.
    const huvudSni = source.sni_codes[0] || Array.from(sni2007)[0] || null;
    logg.huvud_sni = huvudSni;
    // bolagsdataapi ger ibland SNI 2025-koder (t.ex. 78201), så båda systemen söks.
    let sniFilter: string | null = huvudSni
      ? `(sniCodes.sni_2007Code:[${huvudSni}] || sniCodes.sni_2025Code:[${huvudSni}])`
      : null;
    // Län i själva sökningen när geografin är relevant - annars blir 50 slumpvisa
    // bolag från hela landet ofta noll kvar efter länsfiltret (Devexa).
    const lanFilter: string[] =
      options.geografi_relevant && ticSource.countyCode ? [`registeredOfficeCountyCode:=${ticSource.countyCode}`] : [];

    // Steg A: hela branschen, störst omsättning först. "found" säger hur många
    // bolag som delar huvud-SNI - det avgör om storlek alls är relevant. Samma
    // sökning återanvänds (cache) för andra leads i samma bransch i körningen.
    const branschDocs: TicHits = sniFilter
      ? await ticSearch(tic, {
          q: "*",
          query_by: "registrationNumber",
          filter_by: sniFilter,
          sort_by: "mostRecentFinancialSummary.rs_NetSalesK:desc",
        })
      : [];
    const branschAntal = branschDocs.found ?? 0;
    if (sniFilter && branschAntal === 0) {
      logg.sni_utan_traffar = true;
      sniFilter = null; // koden finns inte hos tic.io - lita på nyckelordssökningen
    }
    nisch = !!sniFilter && !options.storlek_strikt && branschAntal <= NISCH_MAX_BOLAG;
    logg.bransch_antal = branschAntal;
    logg.nisch = nisch;

    // Saknar kallbolaget storlek: stora bolag finns oftast i steg A (SkiStar var
    // etta) och då är det gratis. Annars kostar det ett anrop - men bara i en
    // trång bransch, där storleken styr urvalet.
    if (!source.net_revenue && !source.employees) {
      let egen = branschDocs.find((d) => normOrgNr(d.registrationNumber) === sourceOrgNr);
      if (!egen && !nisch) {
        [egen] = await ticSearch(tic, { q: sourceOrgNr, query_by: "registrationNumber", per_page: 1 }).catch((e) => {
          if (e instanceof TicBudgetSlut) throw e;
          return [];
        });
      }
      if (egen) applyTicSize(source, ticSource, egen);
      logg.storlek_fran = egen ? (branschDocs.includes(egen) ? "steg A" : "eget anrop") : "saknas";
    }
    const sizeFilters = (factor: number, endastTak = false) =>
      buildSizeFilters(source, options.storlek_strikt, factor, endastTak);
    const sortField = sizeSortField(source);
    const sniSearch = (sizeFilter: string[], sortBySize: boolean) =>
      ticSearch(tic, {
        q: "*",
        query_by: "registrationNumber",
        filter_by: [sniFilter, ...sizeFilter, ...lanFilter].join(" && "),
        ...(sortBySize && sortField ? { sort_by: `${sortField}:desc` } : {}),
      });

    // Steg B: i en trång bransch används storleken. Nisch: steg A räcker (de
    // största bolagen i branschen = alla som spelar någon roll).
    let sniDocs: TicHits = sniFilter ? branschDocs : [];
    if (sniFilter && nisch && lanFilter.length) {
      // Nisch men lokal: hela branschen i länet, störst först.
      sniDocs = await sniSearch([], true);
      logg.sni_i_lanet = sniDocs.found ?? 0;
    } else if (sniFilter && !nisch && sizeFilters(WIDE_SIZE_FACTOR).length) {
      sniDocs = await sniSearch(sizeFilters(WIDE_SIZE_FACTOR), false);
      logg.sni_inom_storlek = sniDocs.found ?? 0;
      if (!options.storlek_strikt && (sniDocs.found ?? 0) < MIN_SNI_POOL) {
        sniDocs = await sniSearch(sizeFilters(WIDE_SIZE_FACTOR, true), true);
        logg.sni_tak = sniDocs.found ?? 0;
      }
    }

    urvalDelar.push(
      (!sniFilter
        ? logg.sni_utan_traffar
          ? `SNI ${huvudSni} gav inga bolag hos tic.io`
          : "ingen SNI-kod"
        : options.storlek_strikt
          ? `strikt storlek (${branschAntal} bolag med SNI ${huvudSni})`
          : nisch
            ? `nischbransch (${branschAntal} bolag med SNI ${huvudSni}): de största i branschen, storlek väger lätt`
            : `trång bransch (${branschAntal} bolag med SNI ${huvudSni}): urval på storlek` +
              (logg.sni_tak !== undefined ? ", närmast i storlek underifrån" : "")) +
        (lanFilter.length ? `, bara ${ticSource.county || "samma län"}` : "")
    );

    const toPool = (docs: any[]) => {
      const pool: { company: Twin; profile: TicProfile }[] = [];
      for (const doc of docs) {
        const candOrgNr = normOrgNr(docGet(doc, "registrationNumber", "org_nr"));
        if (!candOrgNr || excludeOrgNrs.has(candOrgNr) || seen.has(candOrgNr)) continue;
        seen.add(candOrgNr);

        const candLan = docGet(doc, "registeredOffices[0].county", "mostRecentRegisteredAddress.county", "lan");
        if (options.geografi_relevant && sourceLan && candLan && normLan(candLan) !== normLan(sourceLan)) continue;

        const profile = ticProfile(doc);
        const k = docGet(doc, "mostRecentFinancialSummary.rs_NetSalesK", "rs_NetSalesK");
        const company: Twin = {
          org_nr: candOrgNr,
          name: profile.name,
          net_revenue: k === null ? null : k * 1000,
          employees: profile.employees,
          employees_uppskattat: ticEmployees(doc).uppskattat,
          sni_codes: (docGet(doc, "sniCodes") || [])
            .map((c: any) => (typeof c === "string" ? c : c.sni_2007Code))
            .filter(Boolean),
          lan: candLan,
          ort: docGet(doc, "mostRecentRegisteredAddress.city", "ort"),
          verksamhet: profile.business_description,
        };
        pool.push({ profile, company });
        koncernInfo.set(company, {
          name: profile.name,
          address:
            [docGet(doc, "mostRecentRegisteredAddress.streetAddress"), docGet(doc, "mostRecentRegisteredAddress.city")]
              .filter(Boolean)
              .join(", ") || null,
          website: profile.website,
          owned_through: profile.owned_through,
        });
      }
      return pool;
    };

    // Utan Jev: ranka bara på storlek (bättre än tic.io:s godtyckliga ordning).
    if (!typesafeKey) {
      for (const { company } of toPool(sniDocs)) {
        company.poang = sizeCloseness(source, company) ?? 0;
        company.likhet = "ej bedömd (TYPESAFE_API_KEY saknas)";
        twins.push(company);
      }
      return;
    }

    // Fas 1: SNI-kandidaterna.
    await judgePool(toPool(sniDocs));

    // Fas 2: nyckelordssökningen (fångar bolag med annan SNI-kod) - bara om
    // SNI-sökningen inte redan gav tillräckligt många starka tvillingar.
    if (starka < MIN_STARKA_TVILLINGAR && sourceProfile.business_description) {
      medNyckelord = true;
      try {
        const nyckelord = await pickPurposeKeyword(sourceProfile, typesafeKey);
        logg.nyckelord = nyckelord;
        if (nyckelord) {
          // Nisch: ingen storleksgräns. Annars tak 3x: bästa textträff först,
          // sedan störst först (närmast i storlek underifrån).
          const size = [
            ...(nisch ? [] : options.storlek_strikt ? sizeFilters(WIDE_SIZE_FACTOR) : sizeFilters(WIDE_SIZE_FACTOR, true)),
            ...lanFilter,
          ];
          const purposeDocs = await ticSearch(tic, {
            q: nyckelord,
            query_by: "mostRecentPurpose",
            ...filterBy(size),
            ...(sortField && !options.storlek_strikt ? { sort_by: `_text_match:desc,${sortField}:desc` } : {}),
          });
          logg.beskrivning_found = purposeDocs.found ?? 0;
          await judgePool(toPool(purposeDocs));
          urvalDelar[urvalDelar.length - 1] += ` + nyckelord "${nyckelord}"`;
        }
      } catch (e: any) {
        if (e instanceof TicBudgetSlut) throw e;
        // extra källa - får inte stoppa resultatet, men ska synas i loggen
        logg.beskrivning_fel = String(e.message || e);
      }
    } else {
      logg.nyckelord = "hoppades över (tillräckligt många starka tvillingar)";
    }
  }

  logg.tic_anrop = tic.anrop - anropFore;
  console.log(JSON.stringify({ ...logg, kandidater, bortsorterade: bort, starka, kvar: twins.length }));
  const urval = urvalDelar.join("; ") || "inga kandidater";
  // Poäng inom samma 0,05-steg räknas som lika (skillnaderna där är brus i
  // Jevs sannolikheter, vanligt i nischbranscher där alla är direkta
  // konkurrenter) - då går den närmast kallbolaget i storlek först.
  const steg = (t: Twin) => Math.round((t.poang ?? 0) * 20);
  twins.sort((a, b) => steg(b) - steg(a) || (narhet.get(b) ?? 0) - (narhet.get(a) ?? 0));
  if (!typesafeKey) return { urval, twins: twins.slice(0, MAX_TWINS_PER_LEAD) };
  const { kvar, borttagna } = await dropSameGroup(twins.slice(0, KONCERN_KONTROLL_ANTAL), koncernInfo, typesafeKey);
  console.log(JSON.stringify({ steg: "koncernkontroll", kallbolag: source.name, borttagna }));
  return { urval, twins: kvar.slice(0, MAX_TWINS_PER_LEAD) };
}

// --- Fas 0: kandidater från bolagsdataapi --------------------------------

const BOLAGSDATA_NAMN_LIMIT = 100;
// Så många namnträffar får detaljanrop (verksamhetsbeskrivning + SNI) och Jev-bedömning.
const BOLAGSDATA_DETALJ_MAX = 25;
const MIN_NAMN_LIKHET = 0.4;

// Sammansatta ord delas vid vanliga efterled, så att "städverksamhet" ger
// "städ" - ordet som konkurrenterna har i sina bolagsnamn.
const EFTERLED = [
  "verksamheten", "verksamhet", "tjänster", "service", "arbeten", "installationer", "installation",
  "anläggningar", "anläggning", "försäljning", "handel", "uthyrning", "entreprenad", "entreprenader", "firma",
];
function namnordKandidater(text: string): string[] {
  const ut = new Set<string>();
  for (const ord of beskrivningsord(text)) {
    const rent = ord.replace(/-/g, "");
    ut.add(rent);
    for (const led of EFTERLED) {
      if (rent.endsWith(led) && rent.length - led.length >= 3) ut.add(rent.slice(0, -led.length));
    }
    if (ord.includes("-")) ut.add(ord.split("-")[0]);
  }
  return Array.from(ut).slice(0, 80);
}

async function pickNameKeyword(profile: TicProfile, typesafeKey: string): Promise<string | null> {
  const ord = namnordKandidater(profile.business_description || "");
  if (!ord.length) return null;
  const criteria: Record<string, string | null> = {};
  for (const o of ord) criteria[o] = null;
  criteria.inget = "None of the words is something competitors would typically have in their company names.";
  const resp = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: { company: { name: profile.name, business_description: profile.business_description, industry: profile.industry } },
      questions: {
        namnord: {
          type: "choice",
          instructions:
            "Which word would many Swedish companies doing the same kind of business as `company` have in their company " +
            "names? For example 'städ' for cleaning companies, 'bygg' for builders, 'vvs' for plumbers, 'assistans' for " +
            "personal-assistance providers. Choose `inget` if such companies rarely name themselves after their trade.",
          criteria,
        },
      },
    }),
  });
  if (!resp.ok) throw new Error(`Jev ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
  const choice: string = (await resp.json()).answers.namnord.choice;
  return choice === "inget" ? null : choice;
}

// bolagsdataapi:s län-filter tar t.ex. "Blekinge" eller "Västra Götaland".
function bolagsdataLan(lan: string): string {
  return lan.trim().replace(/\s+län$/i, "").replace(/s$/, "");
}

async function bolagsdataCandidates(
  source: Company,
  ticSource: TicSource,
  options: LeadOptions,
  bolagsdataKey: string,
  typesafeKey: string,
  seen: Set<string>,
  excludeOrgNrs: Set<string>
): Promise<{ pool: { company: Twin; profile: TicProfile; koncern: KoncernInfo }[]; urval: string; logg: Record<string, any> }> {
  const logg: Record<string, any> = {};
  const ord = await pickNameKeyword(ticSource.profile, typesafeKey);
  logg.namnord = ord;
  if (!ord) return { pool: [], urval: "", logg };

  const params: Record<string, string> = { q: ord, status: "Aktivt", limit: String(BOLAGSDATA_NAMN_LIMIT) };
  const lan = options.geografi_relevant ? ticSource.county ?? source.lan : null;
  if (lan) params.lan = bolagsdataLan(lan);
  if (source.net_revenue) {
    const f = options.storlek_strikt ? 1 + STRICT_REVENUE_TOLERANCE : WIDE_SIZE_FACTOR;
    params.oms_min = String(Math.floor(source.net_revenue / f));
    params.oms_max = String(Math.ceil(source.net_revenue * f));
  }
  const data = await bolagsdataGet(`/search?${new URLSearchParams(params)}`, bolagsdataKey);
  const hits: any[] = (data.hits || []).filter((h: any) => {
    const org = normOrgNr(h.org_nr);
    return org.length === 10 && !seen.has(org) && !excludeOrgNrs.has(org);
  });
  logg.namntraffar = hits.length;
  if (!hits.length) return { pool: [], urval: "", logg };

  // Jev sållar på namnen (gratis) innan detaljanropen (1 per bolag).
  const questions: Record<string, any> = {};
  hits.forEach((h, i) => {
    questions[`n_${i}`] = {
      type: "noul",
      instructions: `Does the company name \`names[${i}]\` suggest the same kind of business as \`source\`?`,
    };
  });
  const resp = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: {
        source: { name: ticSource.profile.name, business_description: ticSource.profile.business_description },
        names: hits.map((h) => h.name),
      },
      questions,
    }),
  });
  if (!resp.ok) throw new Error(`Jev ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
  const svar = (await resp.json()).answers;
  const valda = hits
    .map((h, i) => ({ h, p: svar[`n_${i}`]?.noul ?? 0 }))
    .filter((x) => x.p >= MIN_NAMN_LIKHET)
    .sort((a, b) => b.p - a.p)
    .slice(0, BOLAGSDATA_DETALJ_MAX);
  logg.detaljanrop = valda.length;

  const detaljer = await mapLimit(valda, 5, async ({ h }) => {
    try {
      return await bolagsdataDetails(normOrgNr(h.org_nr), bolagsdataKey, h, "");
    } catch {
      return null;
    }
  });
  const pool: { company: Twin; profile: TicProfile; koncern: KoncernInfo }[] = [];
  for (const d of detaljer) {
    if (!d?.company || !d.ticSource) continue;
    const org = d.company.org_nr;
    if (seen.has(org)) continue;
    seen.add(org);
    const company: Twin = { ...d.company, matchning: null, verksamhet: d.ticSource.profile.business_description };
    pool.push({
      company,
      profile: d.ticSource.profile,
      koncern: { name: company.name, address: company.ort ?? null, website: d.ticSource.profile.website, owned_through: [] },
    });
  }
  const urval =
    `bolagsdataapi: namn med "${ord}"` +
    (lan ? `, ${bolagsdataLan(lan)}` : "") +
    (params.oms_min ? ", liknande omsättning" : "");
  return { pool, urval, logg };
}

// --- Steg 4b: bara ett bolag per koncern bland tvillingarna --------------

const KONCERN_KONTROLL_ANTAL = 20;
const MAX_SAMMA_GRUPP = 0.5;

interface KoncernInfo {
  name: string;
  address: string | null;
  website: string | null;
  owned_through: string[];
}

// Varje tvilling jämförs med alla högre rankade (en Jev-request per tvilling,
// alla parallellt). Sedan går koden uppifrån och behåller en tvilling bara om
// den inte hör ihop med någon redan behållen - dvs. den högst rankade i varje
// koncern stannar kvar. Misslyckas Jev behålls tvillingen.
async function dropSameGroup(
  ranked: Twin[],
  info: Map<Twin, KoncernInfo>,
  typesafeKey: string
): Promise<{ kvar: Twin[]; borttagna: string[] }> {
  const sammaGrupp: number[][] = await Promise.all(
    ranked.map(async (twin, i) => {
      if (i === 0) return [];
      try {
        const questions: Record<string, any> = {};
        for (let j = 0; j < i; j++) {
          questions[`par_${j}`] = {
            type: "noul",
            instructions:
              `Are \`candidate\` and \`higher_ranked[${j}]\` part of the same corporate group, i.e. parent, subsidiary ` +
              "or sister companies under the same owner? Signs are a shared distinctive brand name, the same address, " +
              "the same website, or `owned_through` naming the other company.",
            criteria: {
              true: "They belong to the same group or are run by the same owner.",
              false:
                "They are independent companies. Sharing only a place name (such as a town, mountain or region) or an industry word does not make them the same group.",
            },
          };
        }
        const resp = await fetch(TYPESAFE_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "jev-latest",
            state: { candidate: info.get(twin), higher_ranked: ranked.slice(0, i).map((t) => info.get(t)) },
            questions,
          }),
        });
        if (!resp.ok) return [];
        const answers = (await resp.json()).answers;
        return Array.from({ length: i }, (_, j) => answers[`par_${j}`]?.noul ?? 0);
      } catch {
        return [];
      }
    })
  );

  const kvar: Twin[] = [];
  const kvarIndex: number[] = [];
  const borttagna: string[] = [];
  ranked.forEach((twin, i) => {
    const krock = kvarIndex.find((j) => (sammaGrupp[i][j] ?? 0) > MAX_SAMMA_GRUPP);
    if (krock !== undefined) {
      borttagna.push(`${twin.name} (samma koncern som ${ranked[krock].name})`);
    } else {
      kvar.push(twin);
      kvarIndex.push(i);
    }
  });
  return { kvar, borttagna };
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

// twinfinder.ts — portning av twin_finder.py:s sök-logik till webb-appen.
//
// Steg 2: bolagsdataapi.se (testat och fungerande sedan tidigare)
// Steg 3-4: tic.io (SNI, omsättning och anställda filtreras hos tic.io,
//           geografi filtreras här i koden)
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

export const REVENUE_TOLERANCE = 0.4;
export const EMPLOYEE_TOLERANCE = 0.5;
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

// Steg 2b: TypeSafe Jev väljer vilket av bolagsdataapi:s sökträffar leadet avser.
const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const SOURCE_SEARCH_LIMIT = 10;
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
  hits: any[],
  typesafeKey: string | undefined
): Promise<{ index: number | null; matchning: string }> {
  if (hits.length === 1) return { index: 0, matchning: "enda träffen" };
  if (!typesafeKey) return { index: 0, matchning: "första träffen (TYPESAFE_API_KEY saknas)" };

  const candidates = hits.map(candidateSummary);
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
      return { index: null, matchning: `ingen träff är samma bolag (Jev ${procent(Math.max(probs.ingen ?? 0, 1 - finns))})` };
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

export async function resolveSourceCompany(
  companyName: string,
  bolagsdataKey: string,
  typesafeKey?: string
): Promise<Company | null> {
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
  if (!hits.length) return null;

  const { index, matchning } = await pickSourceHit(companyName, hits, typesafeKey);
  if (index === null) return null;
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

  return {
    org_nr: orgNr,
    name: top.name || companyName,
    net_revenue: top.net_revenue ?? null,
    employees: top.employees ?? null,
    sni_codes: sniCodes,
    lan: top.lan ?? null,
    ort: top.ort ?? null,
    matchning,
  };
}

export async function findTwins(
  source: Company,
  options: LeadOptions,
  ticKey: string,
  excludeOrgNrs: Set<string>,
  debugSink?: (doc: any) => void
): Promise<Company[]> {
  const revenueTol = options.storlek_strikt ? STRICT_REVENUE_TOLERANCE : REVENUE_TOLERANCE;
  const employeeTol = options.storlek_strikt ? STRICT_EMPLOYEE_TOLERANCE : EMPLOYEE_TOLERANCE;

  let empMin: number | null = null;
  let empMax: number | null = null;
  if (source.employees) {
    empMin = Math.max(0, Math.floor(source.employees * (1 - employeeTol)));
    empMax = Math.floor(source.employees * (1 + employeeTol)) + 1;
    const [, klassMin, klassMax] = storleksklass(source.employees);
    empMin = Math.max(empMin, klassMin);
    if (klassMax !== null) empMax = Math.min(empMax, klassMax);
  }

  // Fältnamn enligt docs.tic.io/api-lens/search. Omsättning är i tusental kr
  // hos tic.io (rs_NetSalesK) men i kronor hos bolagsdataapi.
  const filters: string[] = [];
  if (source.sni_codes?.length) {
    filters.push(`sniCodes.sni_2007Code:[${source.sni_codes.join(",")}]`);
  }
  if (source.net_revenue) {
    const revK = source.net_revenue / 1000;
    const revMin = Math.floor(revK * (1 - revenueTol));
    const revMax = Math.ceil(revK * (1 + revenueTol));
    filters.push(`mostRecentFinancialSummary.rs_NetSalesK:[${revMin}..${revMax}]`);
  }
  if (empMin !== null && empMax !== null) {
    filters.push(`mostRecentFinancialSummary.fn_NumberOfEmployees:[${empMin}..${empMax}]`);
  }

  const params = new URLSearchParams({
    q: "*",
    query_by: "registrationNumber",
    filter_by: filters.join(" && "),
    per_page: String(TIC_MAX_PER_PAGE),
  });

  const resp = await fetch(`${TIC_SEARCH_URL}?${params}`, {
    headers: { "x-api-key": ticKey },
  });
  if (!resp.ok) {
    throw new Error(`tic.io-sokning misslyckades (${resp.status}): ${await resp.text()}`);
  }
  const data = await resp.json();
  const hits: any[] = data.hits || data.results || [];
  const sourceOrgNr = normOrgNr(source.org_nr);

  const twins: Company[] = [];
  for (const hit of hits) {
    const doc = hit.document || hit;
    if (debugSink && twins.length === 0) debugSink(doc);

    const candOrgNr = normOrgNr(docGet(doc, "registrationNumber", "org_nr"));
    if (!candOrgNr || candOrgNr === sourceOrgNr || excludeOrgNrs.has(candOrgNr)) continue;

    const candEmployees = docGet(doc, "mostRecentFinancialSummary.fn_NumberOfEmployees", "fn_NumberOfEmployees");
    if (empMin !== null && empMax !== null && candEmployees !== null) {
      if (!(empMin <= candEmployees && candEmployees <= empMax)) continue;
    }

    const candLan = docGet(doc, "registeredOffices[0].county", "mostRecentRegisteredAddress.county", "lan");
    if (options.geografi_relevant) {
      if (source.lan && candLan && candLan.trim().toLowerCase() !== source.lan.trim().toLowerCase()) {
        continue;
      }
    }

    twins.push({
      org_nr: candOrgNr,
      name:
        docGet(doc, "mostRecentName", "names[0].nameOrIdentifier", "names[0].legalName", "name") || "",
      net_revenue: (() => {
        const k = docGet(doc, "mostRecentFinancialSummary.rs_NetSalesK", "rs_NetSalesK");
        return k === null ? null : k * 1000;
      })(),
      employees: candEmployees,
      sni_codes: (docGet(doc, "sniCodes") || [])
        .map((c: any) => (typeof c === "string" ? c : c.sni_2007Code))
        .filter(Boolean),
      lan: candLan,
      ort: docGet(doc, "mostRecentRegisteredAddress.city", "ort"),
    });
    if (twins.length >= MAX_TWINS_PER_LEAD) break;
  }

  return twins;
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

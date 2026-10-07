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

export async function resolveSourceCompany(
  companyName: string,
  bolagsdataKey: string
): Promise<Company | null> {
  const searchUrl = `${BOLAGSDATA_BASE}/search?${new URLSearchParams({
    q: companyName,
    limit: "5",
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

  const top = hits[0];
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

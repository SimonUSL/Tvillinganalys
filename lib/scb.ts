// scb.ts — SCB:s allmänna företagsregister (https://apiafr.scb.se/), gratis
// med API-nyckel (SCB_API_KEY). Ger alla bolag med en viss branschkod (SNI),
// med säteskommun, län, storleksklass (anställda), omsättningsklass, telefon,
// e-post och reklamspärr. Saknar verksamhetsbeskrivning och beslutsfattare.
//
// API:et filtrerar på ett villkor i taget (bransch ELLER kommun ...), så vi
// hämtar hela branschen (5 000 bolag per anrop) och väljer ut i koden.

import { cacheGet, cacheSet } from "./cache";

const SCB_BASE = "https://apiafr.scb.se/v1";
const SIDA = 5000;
const MAX_SIDOR = 6; // 30 000 bolag - de största branscherna (t.ex. konsulter) är större och kapas

export interface ScbForetag {
  orgNr: string;
  namn: string;
  kommunKod: string;
  lanKod: string;
  postOrt: string | null;
  anstKl: number; // 0 = uppgift saknas, 1 = 0 anställda, 2 = 1–4 ... (se kodtabeller/anstklkoder)
  omsKl: number | null; // 0 = < 1 tkr, 3 = 1–5 Mkr ... (se kodtabeller/omsklkoder)
  aktiv: boolean;
  reklamSparr: boolean; // har frånsagt sig reklam
  telefon: string | null;
  epost: string | null;
  sni: string | null; // huvudbransch
}

async function scbGet(path: string, nyckel: string): Promise<any> {
  const resp = await fetch(`${SCB_BASE}${path}`, { headers: { "X-API-Key": nyckel } });
  if (!resp.ok) throw new Error(`SCB ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  return resp.json();
}

function tillForetag(j: any): ScbForetag {
  const sni = j.primarNaringsgren?.naringsgren ?? j.naringsgrenar?.find((n: any) => n.rangordning === 1)?.naringsgren ?? null;
  return {
    orgNr: String(j.orgNr || "").replace(/\D/g, ""),
    namn: j.namn || "",
    kommunKod: String(j.kommunSate || ""),
    lanKod: String(j.lanSate || ""),
    postOrt: j.postAdress?.postOrt || null,
    anstKl: Number(j.anstKl ?? 0),
    omsKl: j.omsKl !== undefined && j.omsKl !== null && j.omsKl !== "" ? Number(j.omsKl) : null,
    aktiv: String(j.ftgStat) === "1",
    reklamSparr: Number(j.reklamSparrTyp) === 2,
    telefon: String(j.tel || "").trim() || null,
    epost: String(j.epost || "").trim().toLowerCase() || null,
    sni,
  };
}

// Ett bolag med alla uppgifter (sparas 180 dagar).
export async function scbForetag(orgNr: string, nyckel: string): Promise<ScbForetag | null> {
  const nr = orgNr.replace(/\D/g, "");
  const ck = `scb:je:${nr}`;
  const sparad = await cacheGet<any>(ck);
  if (sparad) return tillForetag(sparad);
  try {
    const j = await scbGet(`/juridiskaenheter/16${nr}/full`, nyckel);
    await cacheSet(ck, j);
    return tillForetag(j);
  } catch {
    return null;
  }
}

// Alla aktiva bolag med en huvudbransch, i Sverige. Inte cachat (hela branscher
// är för stora för Redis); en bransch på 10 000 bolag är 2 anrop och ~5 s.
export async function scbBransch(sni: string, nyckel: string): Promise<{ foretag: ScbForetag[]; kapad: boolean; anrop: number }> {
  const ut: ScbForetag[] = [];
  let cursor: number | null = null;
  let anrop = 0;
  for (let sida = 0; sida < MAX_SIDOR; sida++) {
    const d = await scbGet(`/juridiskaenheter/naringsgren/${sni}?limit=${SIDA}${cursor !== null ? `&cursorId=${cursor}` : ""}`, nyckel);
    anrop++;
    for (const j of d.jes || []) {
      const f = tillForetag(j);
      if (f.aktiv && f.lanKod !== "99" && f.orgNr.length === 10) ut.push(f);
    }
    if (!d.pagination?.hasMore) return { foretag: ut, kapad: false, anrop };
    cursor = d.pagination.nextCursorId;
  }
  return { foretag: ut, kapad: true, anrop };
}

// Kommunkod -> namn ("1441" -> "Lerum"), sparas 180 dagar.
export async function scbKommuner(nyckel: string): Promise<Map<string, string>> {
  let lista = await cacheGet<any[]>("scb:kommunkoder");
  if (!lista) {
    lista = await scbGet(`/kodtabeller/kommunkoder`, nyckel);
    await cacheSet("scb:kommunkoder", lista);
  }
  return new Map((lista || []).map((k: any) => [String(k.kod).padStart(4, "0"), String(k.klartext)]));
}

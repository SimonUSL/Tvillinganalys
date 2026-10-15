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

// SCB spärrar nyckeln tillfälligt vid för många anrop (svar 429 med Retry-After,
// ingen fast gräns angiven). Anropen går därför ett i taget, och en spärr sparas
// i Redis så att alla körningar hoppar över SCB tills den släpper.
export class ScbSparrad extends Error {}
const SPARR_NYCKEL = "scb:sparr";
const delat: { ko: Promise<unknown>; sparrTill: number } = ((globalThis as any).__scb ??= { ko: Promise.resolve(), sparrTill: 0 });

async function sparrad(): Promise<boolean> {
  if (delat.sparrTill > Date.now()) return true;
  const till = await cacheGet<number>(SPARR_NYCKEL);
  if (till && till > Date.now()) delat.sparrTill = till;
  return delat.sparrTill > Date.now();
}

async function scbGet(path: string, nyckel: string): Promise<any> {
  if (await sparrad()) throw new ScbSparrad(`SCB spärrat till ${new Date(delat.sparrTill).toISOString()}`);
  // Ett anrop i taget, även när flera bolag söks samtidigt.
  const tur = delat.ko.then(async () => {
    if (await sparrad()) throw new ScbSparrad(`SCB spärrat till ${new Date(delat.sparrTill).toISOString()}`);
    const resp = await fetch(`${SCB_BASE}${path}`, { headers: { "X-API-Key": nyckel } });
    if (resp.status === 429) {
      const sek = Number(resp.headers.get("retry-after")) || 600;
      delat.sparrTill = Date.now() + sek * 1000;
      await cacheSet(SPARR_NYCKEL, delat.sparrTill, 1);
      console.log(JSON.stringify({ steg: "scb", fel: "spärrat (429)", sekunder: sek }));
      throw new ScbSparrad(`SCB spärrat i ${sek} s`);
    }
    if (!resp.ok) throw new Error(`SCB ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    return resp.json();
  });
  delat.ko = tur.catch(() => {});
  return tur;
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

// Alla aktiva bolag med en huvudbransch, i Sverige - eller bara i ett län.
// Första hämtningen av en bransch (5 000 bolag per anrop, upp till ~20 s för
// restauranger) sparas i 180 dagar i förkortad form, uppdelad per län, så att
// nästa bolag i samma bransch slipper hämta den igen.
const BRANSCH_DAGAR = 180;
const BRANSCH_HELA_MAX = 6000; // större branscher sparas bara per län (Redis-värden < 1 MB)
type Kort = [string, string, string, string, string | null, number, string | null];
const tillKort = (f: ScbForetag): Kort => [f.orgNr, f.namn, f.kommunKod, f.lanKod, f.postOrt, f.anstKl, f.sni];
const franKort = ([orgNr, namn, kommunKod, lanKod, postOrt, anstKl, sni]: Kort): ScbForetag => ({
  orgNr, namn, kommunKod, lanKod, postOrt, anstKl, sni, omsKl: null, aktiv: true, reklamSparr: false, telefon: null, epost: null,
});

export async function scbBransch(
  sni: string,
  nyckel: string,
  lanKod?: string | null
): Promise<{ foretag: ScbForetag[]; kapad: boolean; anrop: number; sparad?: boolean }> {
  const del = lanKod || "alla";
  const sparad = await cacheGet<{ kort: Kort[]; kapad: boolean }>(`scb:br:${sni}:${del}`);
  if (sparad) return { foretag: sparad.kort.map(franKort), kapad: sparad.kapad, anrop: 0, sparad: true };

  const ut: ScbForetag[] = [];
  let cursor: number | null = null;
  let anrop = 0;
  let kapad = true;
  for (let sida = 0; sida < MAX_SIDOR; sida++) {
    const d = await scbGet(`/juridiskaenheter/naringsgren/${sni}?limit=${SIDA}${cursor !== null ? `&cursorId=${cursor}` : ""}`, nyckel);
    anrop++;
    for (const j of d.jes || []) {
      const f = tillForetag(j);
      if (f.aktiv && f.lanKod !== "99" && f.orgNr.length === 10) ut.push(f);
    }
    if (!d.pagination?.hasMore) {
      kapad = false;
      break;
    }
    cursor = d.pagination.nextCursorId;
  }

  // Spara per län (alla 21 på en gång) och hela branschen om den är liten.
  const perLan = new Map<string, Kort[]>();
  for (const f of ut) perLan.set(f.lanKod, [...(perLan.get(f.lanKod) || []), tillKort(f)]);
  const lanKoder = ["01", "03", "04", "05", "06", "07", "08", "09", "10", "12", "13", "14", "17", "18", "19", "20", "21", "22", "23", "24", "25"];
  await Promise.all(lanKoder.map((l) => cacheSet(`scb:br:${sni}:${l}`, { kort: perLan.get(l) || [], kapad }, BRANSCH_DAGAR)));
  if (ut.length <= BRANSCH_HELA_MAX) await cacheSet(`scb:br:${sni}:alla`, { kort: ut.map(tillKort), kapad }, BRANSCH_DAGAR);

  return { foretag: lanKod ? ut.filter((f) => f.lanKod === lanKod) : ut, kapad, anrop };
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

// kvot.ts — hur många anrop som är kvar hos de två bolagsregistren:
// tic.io (200 per period) och bolagsdataapi (500 per dygn, fylls på vid midnatt).
// Båda skickar kvoten i svarshuvudena (x-ratelimit-*); det senaste värdet
// sparas i Redis så att verktyget kan visa det innan en körning.

import { cachePa, redis } from "./cache";

export type Register = "tic" | "bolagsdata";

export interface Kvot {
  kvar: number;
  grans: number | null;
  aterstalls: string | null; // ISO, när kvoten fylls på
  uppdaterad: string; // ISO, när kvoten senast lästes
}

// Ett nytt bolag använder ungefär så här många anrop hos bolagsdataapi
// (sökningar + verksamhetsbeskrivningar för kandidaterna). Sparade svar kostar inget.
export const BD_PER_BOLAG = 35;
// Så många anrop per dygn sparas åt förfrågningarna från webbplatsen: en
// manuell lista stannar innan den tar dem.
export const BD_RESERV = 60;

const NYCKEL: Record<Register, string> = { tic: "tic:kvot", bolagsdata: "bd:kvot" };
const minne: Partial<Record<Register, Kvot>> = ((globalThis as any).__kvoter ??= {});

// Nästa midnatt i svensk tid (bolagsdataapi:s dygn).
function nastaMidnatt(): string {
  const nu = new Date();
  const sv = new Date(nu.toLocaleString("en-US", { timeZone: "Europe/Stockholm" }));
  const skillnad = sv.getTime() - nu.getTime();
  const midnatt = new Date(sv);
  midnatt.setHours(24, 0, 0, 0);
  return new Date(midnatt.getTime() - skillnad).toISOString();
}

// Läser kvoten ur ett svar. Returnerar null om huvudena saknas.
export function kvotFranSvar(h: Headers, register: Register = "tic"): Kvot | null {
  const tal = (namn: string) => {
    const v = h.get(namn);
    return v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const kvar = tal("x-ratelimit-remaining");
  if (kvar === null) return null;
  const reset = tal("x-ratelimit-reset");
  // reset anges antingen som sekunder kvar eller som en tidpunkt (sekunder sedan 1970).
  const aterstalls =
    reset !== null ? new Date(reset > 1e9 ? reset * 1000 : Date.now() + reset * 1000).toISOString() : register === "bolagsdata" ? nastaMidnatt() : null;
  return { kvar, grans: tal("x-ratelimit-limit"), aterstalls, uppdaterad: new Date().toISOString() };
}

export async function sparaKvot(k: Kvot, register: Register = "tic"): Promise<void> {
  minne[register] = k;
  try {
    if (cachePa) await redis(["SET", NYCKEL[register], JSON.stringify(k)]);
  } catch (e: any) {
    console.log(JSON.stringify({ steg: "kvot", fel: String(e.message || e) }));
  }
}

// Gäller kvoten fortfarande? Efter påfyllningen är den inaktuell.
export const kvotGaller = (k: Kvot | null | undefined): boolean =>
  !!k && (!k.aterstalls || new Date(k.aterstalls).getTime() > Date.now());

export async function hamtaKvot(register: Register = "tic"): Promise<Kvot | null> {
  const lokal = minne[register];
  if (lokal && Date.now() - new Date(lokal.uppdaterad).getTime() < 5000) return lokal;
  try {
    const v = cachePa ? await redis(["GET", NYCKEL[register]]) : null;
    const k = v ? (JSON.parse(v) as Kvot) : lokal ?? null;
    if (k) minne[register] = k;
    return k;
  } catch {
    return lokal ?? null;
  }
}

// Anrop kvar just nu, eller null om okänt. En passerad påfyllning räknas som full kvot.
export async function kvarNu(register: Register): Promise<number | null> {
  const k = await hamtaKvot(register);
  if (!k) return null;
  return kvotGaller(k) ? k.kvar : k.grans;
}

// Senast kända värde i den här processen, utan Redis (för snabba kontroller per anrop).
export const kvarIMinnet = (register: Register): number | null => {
  const k = minne[register];
  return k && kvotGaller(k) ? k.kvar : null;
};

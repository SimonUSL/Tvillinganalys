// kvot.ts — hur många sökningar som är kvar hos tic.io (200 per period).
// tic.io skickar kvoten i svarshuvudena på varje sökning (x-ratelimit-*);
// den senaste sparas i Redis så att verktyget kan visa den innan en körning.

import { cachePa, redis } from "./cache";

export interface Kvot {
  kvar: number;
  grans: number | null;
  aterstalls: string | null; // ISO, när kvoten fylls på (om tic.io anger det)
  uppdaterad: string; // ISO, när kvoten senast lästes
}

const NYCKEL = "tic:kvot";
const minne: { kvot?: Kvot } = ((globalThis as any).__ticKvot ??= {});

// Läser kvoten ur ett tic.io-svar. Returnerar null om huvudena saknas.
export function kvotFranSvar(h: Headers): Kvot | null {
  const tal = (namn: string) => {
    const v = h.get(namn);
    return v !== null && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null;
  };
  const kvar = tal("x-ratelimit-remaining");
  if (kvar === null) return null;
  const reset = tal("x-ratelimit-reset");
  // reset anges antingen som sekunder kvar eller som en tidpunkt (sekunder sedan 1970).
  const aterstalls = reset === null ? null : new Date(reset > 1e9 ? reset * 1000 : Date.now() + reset * 1000).toISOString();
  return { kvar, grans: tal("x-ratelimit-limit"), aterstalls, uppdaterad: new Date().toISOString() };
}

export async function sparaKvot(k: Kvot): Promise<void> {
  try {
    if (cachePa) await redis(["SET", NYCKEL, JSON.stringify(k)]);
    else minne.kvot = k;
  } catch (e: any) {
    console.log(JSON.stringify({ steg: "kvot", fel: String(e.message || e) }));
  }
}

export async function hamtaKvot(): Promise<Kvot | null> {
  try {
    const v = cachePa ? await redis(["GET", NYCKEL]) : minne.kvot ? JSON.stringify(minne.kvot) : null;
    return v ? (JSON.parse(v) as Kvot) : null;
  } catch {
    return null;
  }
}

// historik.ts — alla körningar som gjorts (automatiska, i verktyget och från
// Granska) sparas i 12 månader, och varje tvilling som föreslagits kommer vi
// ihåg i 90 dagar så att den kan märkas "Föreslogs 3 okt" nästa gång.
// Sparas i Redis (Upstash); lokalt utan Redis i minnet.

import { cachePa, redis } from "./cache";
import type { ResultRow } from "./korning";

export type KorningsKalla = "automatik" | "verktyg" | "granska";

export const HISTORIK_DAGAR = 365;
export const FORESLAGEN_DAGAR = 90;

export interface Sammanfattning {
  id: string;
  skapad: string; // ISO
  kalla: KorningsKalla;
  bolag: string;
  org_nr: string | null;
  antal_tvillingar: number;
  forfragan: string | null; // t.ex. "Ny förfrågan · Företag via kontaktsida"
  avsandare: string | null; // namn/e-post ur formuläret
  urval: string | null;
}

export interface Korning extends Sammanfattning {
  rows: ResultRow[];
}

const INDEX = "historik:index"; // sorted set: id -> tid (ms)
const SAMMAN = "historik:samman"; // hash: id -> sammanfattning (JSON)
const RAD = (id: string) => `historik:korning:${id}`;
const FORESLAGEN = (org: string) => `historik:foreslagen:${org}`;

// Lokal utveckling: delas via globalThis eftersom varje route laddas för sig.
const minne: Map<string, string> = ((globalThis as any).__historikMinne ??= new Map<string, string>());

const dagar = (n: number) => n * 24 * 3600;

export async function sparaKorning(rows: ResultRow[], kalla: KorningsKalla): Promise<string | null> {
  const forsta = rows[0];
  if (!forsta || (!forsta.kall_namn && !forsta.lead_foretagsnamn)) return null;
  const nu = new Date();
  const id = `${nu.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const samman: Sammanfattning = {
    id,
    skapad: nu.toISOString(),
    kalla,
    bolag: forsta.kall_namn || forsta.lead_foretagsnamn,
    org_nr: forsta.kall_org_nr || null,
    antal_tvillingar: rows.filter((r) => r.tvilling_namn).length,
    forfragan: [forsta.forfragan_typ, forsta.forfragan_formular && `via ${forsta.forfragan_formular}`].filter(Boolean).join(" ") || null,
    avsandare: [forsta.forfragan_namn, forsta.forfragan_epost].filter(Boolean).join(" · ") || null,
    urval: forsta.urval || null,
  };
  const korning: Korning = { ...samman, rows };
  try {
    if (cachePa) {
      await redis(["SET", RAD(id), JSON.stringify(korning), "EX", dagar(HISTORIK_DAGAR)]);
      await redis(["HSET", SAMMAN, id, JSON.stringify(samman)]);
      await redis(["ZADD", INDEX, nu.getTime(), id]);
    } else {
      minne.set(RAD(id), JSON.stringify(korning));
      minne.set(`samman:${id}`, JSON.stringify(samman));
    }
  } catch (e: any) {
    console.log(JSON.stringify({ steg: "historik", fel: String(e.message || e) }));
    return null;
  }
  return id;
}

export async function listaKorningar(): Promise<Sammanfattning[]> {
  if (!cachePa) {
    return [...minne.entries()]
      .filter(([k]) => k.startsWith("samman:"))
      .map(([, v]) => JSON.parse(v) as Sammanfattning)
      .sort((a, b) => b.skapad.localeCompare(a.skapad));
  }
  // Rensa körningar äldre än 12 månader ur indexet (själva körningen har gått ut).
  const grans = Date.now() - dagar(HISTORIK_DAGAR) * 1000;
  const gamla: string[] = (await redis(["ZRANGEBYSCORE", INDEX, 0, grans])) || [];
  if (gamla.length) {
    await redis(["ZREM", INDEX, ...gamla]);
    await redis(["HDEL", SAMMAN, ...gamla]);
  }
  const ids: string[] = (await redis(["ZREVRANGE", INDEX, 0, 999])) || [];
  if (!ids.length) return [];
  const varden: (string | null)[] = (await redis(["HMGET", SAMMAN, ...ids])) || [];
  return varden.filter(Boolean).map((v) => JSON.parse(v as string) as Sammanfattning);
}

export async function hamtaKorning(id: string): Promise<Korning | null> {
  const v = cachePa ? await redis(["GET", RAD(id)]) : minne.get(RAD(id));
  return v ? (JSON.parse(v) as Korning) : null;
}

// Märker tvillingar som föreslagits tidigare (inom 90 dagar) och kommer ihåg
// de nya: `tidigare_datum` ("2026-10-03") och `tidigare_kallbolag` (vem den föreslogs till).
export async function markeraOchKomIhag(rows: ResultRow[]): Promise<void> {
  const tvillingar = rows.filter((r) => r.tvilling_org_nr);
  if (!tvillingar.length) return;
  const nycklar = tvillingar.map((r) => FORESLAGEN(r.tvilling_org_nr!));
  try {
    const tidigare: (string | null)[] = cachePa
      ? (await redis(["MGET", ...nycklar])) || []
      : nycklar.map((k) => minne.get(k) ?? null);
    tvillingar.forEach((r, i) => {
      const t = tidigare[i];
      if (!t) return;
      const { datum, kallbolag } = JSON.parse(t);
      // Samma kallbolag igen (t.ex. en omkörning) räknas inte som "tidigare".
      if (kallbolag !== (r.kall_namn || r.lead_foretagsnamn)) {
        r.tidigare_datum = datum;
        r.tidigare_kallbolag = kallbolag;
      }
    });
    const nu = JSON.stringify({ datum: new Date().toISOString().slice(0, 10), kallbolag: rows[0].kall_namn || rows[0].lead_foretagsnamn });
    for (let i = 0; i < tvillingar.length; i++) {
      // Behåll det första förslaget så att "föreslogs" pekar på första gången.
      if (tidigare[i]) continue;
      if (cachePa) await redis(["SET", nycklar[i], nu, "EX", dagar(FORESLAGEN_DAGAR)]);
      else minne.set(nycklar[i], nu);
    }
  } catch (e: any) {
    console.log(JSON.stringify({ steg: "historik", fel: String(e.message || e) }));
  }
}

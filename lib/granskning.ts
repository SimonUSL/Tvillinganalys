// granskning.ts — kön av automatiska leads som behöver en människa: bolaget
// är osäkert, inga tvillingar hittades eller något gick fel. Visas på
// /granska i verktyget. Sparas i Redis (Upstash); lokalt utan Redis i minnet.

import { cachePa, redis } from "./cache";

export type GranskaOrsak = "osaker" | "ingen" | "inget_namn" | "inga_tvillingar" | "fel";

export interface GranskaPost {
  id: string;
  skapad: string; // ISO-tid då posten lades i kön
  datum: string; // när förfrågan skickades
  formular: string;
  doman: string | null;
  namn: string;
  epost: string;
  telefon: string;
  text: string; // hela meddelandet
  typ_kod: string;
  avsandare_kod: string;
  orsak_kod: GranskaOrsak;
  forslag: { namn: string; org_nr: string } | null; // osäkert förslag
  bolag: { namn: string; org_nr: string } | null; // känt bolag (t.ex. inga tvillingar)
}

const NYCKEL = "granska:poster";
// Äldre poster rensas bort när kön läses - de innehåller personuppgifter.
const MAX_DAGAR = 60;

// Lokal utveckling utan Redis. Delas via globalThis eftersom varje API-route
// laddas för sig i utvecklingsservern.
const minne: Map<string, string> = ((globalThis as any).__granskaMinne ??= new Map<string, string>());

export async function laggIKo(post: GranskaPost): Promise<void> {
  const json = JSON.stringify(post);
  if (cachePa) await redis(["HSET", NYCKEL, post.id, json]);
  else minne.set(post.id, json);
}

export async function listaKo(): Promise<GranskaPost[]> {
  let falt: string[] = [];
  if (cachePa) falt = (await redis(["HGETALL", NYCKEL])) || [];
  else for (const [k, v] of minne) falt.push(k, v);
  const poster: GranskaPost[] = [];
  const gamla: string[] = [];
  const grans = Date.now() - MAX_DAGAR * 24 * 3600 * 1000;
  for (let i = 0; i + 1 < falt.length; i += 2) {
    try {
      const p = JSON.parse(falt[i + 1]) as GranskaPost;
      if (new Date(p.skapad).getTime() < grans) gamla.push(p.id);
      else poster.push(p);
    } catch {
      gamla.push(falt[i]);
    }
  }
  if (gamla.length) await taBortUrKo(gamla);
  return poster.sort((a, b) => b.datum.localeCompare(a.datum));
}

export async function taBortUrKo(ids: string[]): Promise<void> {
  if (!ids.length) return;
  if (cachePa) await redis(["HDEL", NYCKEL, ...ids]);
  else for (const id of ids) minne.delete(id);
}

export async function antalIKo(): Promise<number> {
  if (cachePa) return Number(await redis(["HLEN", NYCKEL])) || 0;
  return minne.size;
}

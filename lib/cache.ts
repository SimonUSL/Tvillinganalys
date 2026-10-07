// cache.ts — sparar API-svar i Upstash Redis (Vercel Marketplace) mellan
// körningar, så att samma sökning inte kostar tic.io-kvot (200/mån) igen.
// Saknas variablerna, eller strular Redis, körs allt som vanligt utan cache.

import { createHash } from "crypto";

// Bolagsdata ändras långsamt (bokslut en gång om året), men nya bolag startar
// och andra går i konkurs - därför inte för evigt.
export const CACHE_DAGAR = 180;

function env(...namn: string[]): string | undefined {
  for (const n of namn) if (process.env[n]) return process.env[n];
  return undefined;
}
const URL = env("KV_REST_API_URL", "UPSTASH_REDIS_REST_URL", "CACHE_KV_REST_API_URL", "CACHE_UPSTASH_REDIS_REST_URL");
const TOKEN = env("KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_TOKEN", "CACHE_KV_REST_API_TOKEN", "CACHE_UPSTASH_REDIS_REST_TOKEN");

export const cachePa = !!(URL && TOKEN);

export function cacheNyckel(prefix: string, data: unknown): string {
  return `${prefix}:${createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 32)}`;
}

async function kommando(args: (string | number)[]): Promise<any> {
  const resp = await fetch(URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!resp.ok) throw new Error(`Upstash ${resp.status}`);
  return (await resp.json()).result;
}

export async function cacheGet<T>(nyckel: string): Promise<T | null> {
  if (!cachePa) return null;
  try {
    const v = await kommando(["GET", nyckel]);
    return v ? (JSON.parse(v) as T) : null;
  } catch (e: any) {
    console.log(JSON.stringify({ steg: "cache", fel: String(e.message || e) }));
    return null;
  }
}

export async function cacheSet(nyckel: string, varde: unknown, dagar = CACHE_DAGAR): Promise<void> {
  if (!cachePa) return;
  try {
    await kommando(["SET", nyckel, JSON.stringify(varde), "EX", dagar * 24 * 3600]);
  } catch (e: any) {
    console.log(JSON.stringify({ steg: "cache", fel: String(e.message || e) }));
  }
}

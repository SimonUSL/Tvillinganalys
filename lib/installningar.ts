// installningar.ts — inställningar som teamet ändrar själva i adminvyn
// (/admin/installningar), sparade i Redis. Just nu: vilka som får mejlen.

import { cachePa, redis } from "./cache";

const MOTTAGARE = "installningar:mottagare";
const minne: { mottagare?: string[] } = ((globalThis as any).__installningar ??= {});

const fran = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));

// Listan i adminvyn gäller. Är den aldrig sparad används MAIL_TO från Vercel.
export async function hamtaMottagare(): Promise<{ lista: string[]; sparad: boolean }> {
  try {
    const v = cachePa ? await redis(["GET", MOTTAGARE]) : minne.mottagare ? JSON.stringify(minne.mottagare) : null;
    if (v) return { lista: JSON.parse(v), sparad: true };
  } catch (e: any) {
    console.log(JSON.stringify({ steg: "installningar", fel: String(e.message || e) }));
  }
  return { lista: fran(process.env.MAIL_TO || ""), sparad: false };
}

export async function sparaMottagare(adresser: string[]): Promise<string[]> {
  const lista = [...new Set(fran(adresser.join(",")))];
  if (!lista.length) return lista; // en tom lista sparas aldrig
  if (cachePa) await redis(["SET", MOTTAGARE, JSON.stringify(lista)]);
  else minne.mottagare = lista;
  return lista;
}

export const giltigAdress = (s: string) => fran(s).length === 1;

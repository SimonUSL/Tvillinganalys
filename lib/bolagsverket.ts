// bolagsverket.ts — Bolagsverkets API för värdefulla datamängder (gratis, ingen
// dygnskvot, 60 anrop/minut). Ger verksamhetsbeskrivning, SNI, postadress och
// om bolaget är verksamt, per organisationsnummer. Används för kandidaternas
// verksamhetsbeskrivningar, så att bolagsdataapi (500/dygn) bara behövs för
// de bolag som blir tvillingar.
//
// Inloggning: OAuth2 client credentials (BOLAGSVERKET_CLIENT_ID/_SECRET).
// API-beskrivning: https://portal.api.bolagsverket.se/devportal/apis

import { cacheGet, cacheSet } from "./cache";

const TOKEN_URL = "https://portal.api.bolagsverket.se/oauth2/token";
const BAS = "https://gw.api.bolagsverket.se/vardefulla-datamangder/v1";
const PER_MINUT = 55; // under Bolagsverkets gräns på 60

export interface BvOrganisation {
  orgNr: string;
  namn: string;
  beskrivning: string | null;
  sni: string[];
  postort: string | null;
  verksam: boolean | null;
}

export const bolagsverketPa = () => !!(process.env.BOLAGSVERKET_CLIENT_ID && process.env.BOLAGSVERKET_CLIENT_SECRET);

// Token (gäller en timme) och anropstakt delas inom processen.
const delat: { token?: string; giltigTill?: number; anrop: number[] } = ((globalThis as any).__bolagsverket ??= { anrop: [] });

async function token(): Promise<string> {
  if (delat.token && delat.giltigTill! > Date.now() + 60_000) return delat.token;
  const id = process.env.BOLAGSVERKET_CLIENT_ID!;
  const hemlighet = process.env.BOLAGSVERKET_CLIENT_SECRET!;
  const resp = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${hemlighet}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=vardefulla-datamangder:read",
  });
  if (!resp.ok) throw new Error(`Bolagsverket token ${resp.status}`);
  const d = await resp.json();
  delat.token = d.access_token;
  delat.giltigTill = Date.now() + (Number(d.expires_in) || 3600) * 1000;
  return delat.token!;
}

const vanta = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Minutens anrop är slut: anroparen hämtar beskrivningen någon annanstans i
// stället för att vänta (en lista med 30 bolag skulle annars ta ~15 minuter).
export class BolagsverketUpptaget extends Error {}

// Högst PER_MINUT anrop per rullande minut.
async function vantaPaTur(vantaInte: boolean): Promise<void> {
  for (;;) {
    const nu = Date.now();
    delat.anrop = delat.anrop.filter((t) => nu - t < 60_000);
    if (delat.anrop.length < PER_MINUT) {
      delat.anrop.push(nu);
      return;
    }
    if (vantaInte) throw new BolagsverketUpptaget("minutens anrop till Bolagsverket är slut");
    await vanta(60_000 - (nu - delat.anrop[0]) + 50);
  }
}

function tolka(orgNr: string, o: any): BvOrganisation {
  const namn = o?.organisationsnamn?.organisationsnamnLista?.find((n: any) => n?.organisationsnamntyp?.kod === "FORETAGSNAMN")?.namn
    ?? o?.organisationsnamn?.organisationsnamnLista?.[0]?.namn ?? "";
  const beskrivning = String(o?.verksamhetsbeskrivning?.beskrivning || "").replace(/-\n/g, "").replace(/\s+/g, " ").trim() || null;
  const verksamKod = o?.verksamOrganisation?.kod;
  return {
    orgNr,
    namn,
    beskrivning,
    sni: (o?.naringsgrenOrganisation?.sni || []).map((s: any) => String(s?.kod || "").trim()).filter(Boolean),
    postort: o?.postadressOrganisation?.postadress?.postort || null,
    verksam: verksamKod === "JA" ? true : verksamKod === "NEJ" ? false : null,
  };
}

// Ett bolag (sparas 180 dagar). null om det inte finns. vantaInte: kasta
// BolagsverketUpptaget i stället för att vänta när minutens anrop är slut.
export async function bvOrganisation(orgNr: string, vantaInte = false): Promise<BvOrganisation | null> {
  const nr = orgNr.replace(/\D/g, "");
  const nyckel = `bv:org:${nr}`;
  const sparad = await cacheGet<BvOrganisation>(nyckel);
  if (sparad) return sparad;
  for (let forsok = 0; forsok < 3; forsok++) {
    await vantaPaTur(vantaInte);
    const resp = await fetch(`${BAS}/organisationer`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ identitetsbeteckning: nr }),
    });
    if (resp.status === 401) {
      delat.token = undefined; // ny token nästa varv
      continue;
    }
    if (resp.status === 429) {
      if (vantaInte) throw new BolagsverketUpptaget("Bolagsverket svarade 429");
      await vanta(Number(resp.headers.get("retry-after")) * 1000 || 5000);
      continue;
    }
    if (resp.status === 404) return null;
    if (!resp.ok) throw new Error(`Bolagsverket ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    const o = (await resp.json())?.organisationer?.[0];
    if (!o) return null;
    const org = tolka(nr, o);
    await cacheSet(nyckel, org);
    return org;
  }
  throw new Error("Bolagsverket svarade inte (för många försök)");
}

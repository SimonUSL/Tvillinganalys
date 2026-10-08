// foretagskontakt.ts — köper kontaktuppgifter från Företagskontakt /
// Marknadsinformation, men bara det de fria registren (tic.io, bolagsdataapi)
// inte redan gett oss:
//
// 1. Beslutsfattarens personliga e-post + direkttelefon köps alltid (registren
//    har aldrig dem).
// 2. info@-adressen köps BARA om registren saknade e-post OCH steg 1 varken
//    gav personlig e-post eller direkttelefon.
//
// OBS: Företagskontakts riktiga API är inte känt än. Själva anropet ligger i
// `fragaForetagskontakt` och anpassas när dokumentationen finns; reglerna
// ovan (`behoverInfoEpost`) och kostnadsräkningen gäller oavsett.

import type { Company } from "./twinfinder";

// Prislista (kr, organisationsnummerfråga). Grundavgiften 790 kr/mån tillkommer.
export const PRIS = {
  fraga: 1.65, // namn, adress, telefon, org.nr per svar
  personligEpost: 4.9,
  direkttelefon: 4.0,
  infoEpost: 2.9,
};

export interface FkUrval {
  personligEpost?: boolean;
  direkttelefon?: boolean;
  infoEpost?: boolean;
}

export interface FkSvar {
  kontaktNamn: string | null;
  personligEpost: string | null;
  direkttelefon: string | null;
  infoEpost: string | null;
}

const FORETAGSKONTAKT_URL = "https://www.xn--fretagskontakt-vpb.se/api/verifiera-foretagsuppgifter"; // OBEKRÄFTAD

// Ett anrop för ett bolag med valda tillägg. Anpassas till det riktiga API:t.
async function fragaForetagskontakt(orgNr: string, urval: FkUrval, nyckel: string): Promise<FkSvar | null> {
  const params = new URLSearchParams({ org_nr: orgNr });
  if (urval.personligEpost) params.set("personlig_epost", "1");
  if (urval.direkttelefon) params.set("direkttelefon", "1");
  if (urval.infoEpost) params.set("info_epost", "1");
  const resp = await fetch(`${FORETAGSKONTAKT_URL}?${params}`, { headers: { Authorization: `Bearer ${nyckel}` } });
  if (!resp.ok) return null;
  const data = await resp.json();
  const person = data.decision_maker || data.beslutsfattare || {};
  return {
    kontaktNamn: person.name ?? null,
    personligEpost: person.email ?? null,
    direkttelefon: person.phone ?? person.direct_phone ?? null,
    infoEpost: data.info_email ?? data.email ?? null,
  };
}

// Kostnad för ett svar: frågan + de tillägg som faktiskt levererades
// (tilläggen debiteras per styck, alltså bara när uppgiften finns).
export function kostnad(urval: FkUrval, svar: FkSvar | null): number {
  if (!svar) return 0;
  return (
    PRIS.fraga +
    (urval.personligEpost && svar.personligEpost ? PRIS.personligEpost : 0) +
    (urval.direkttelefon && svar.direkttelefon ? PRIS.direkttelefon : 0) +
    (urval.infoEpost && svar.infoEpost ? PRIS.infoEpost : 0)
  );
}

// info@ behövs bara när varken registren eller Företagskontakt gav någon väg in.
export function behoverInfoEpost(company: Company, svar: FkSvar | null): boolean {
  return !company.kontakt?.epost && !svar?.personligEpost && !svar?.direkttelefon;
}

// Berikar en tvilling. Returnerar vad det kostade (kr).
export async function berikaKontakt(
  company: Company,
  nyckel: string,
  fraga: typeof fragaForetagskontakt = fragaForetagskontakt
): Promise<number> {
  let kr = 0;
  try {
    const forstaUrval: FkUrval = { personligEpost: true, direkttelefon: true };
    const svar = await fraga(company.org_nr, forstaUrval, nyckel);
    kr += kostnad(forstaUrval, svar);
    if (svar) {
      company.contact_name = svar.kontaktNamn;
      company.contact_email = svar.personligEpost;
      company.contact_phone = svar.direkttelefon;
    }
    if (behoverInfoEpost(company, svar)) {
      const infoUrval: FkUrval = { infoEpost: true };
      const info = await fraga(company.org_nr, infoUrval, nyckel);
      kr += kostnad(infoUrval, info);
      if (info?.infoEpost) {
        company.kontakt = { ...(company.kontakt || { beslutsfattare: null, telefon: null, webb: null }), epost: info.infoEpost };
      }
    }
  } catch {
    // Misslyckas tyst: tvillingen visas ändå, med registrens kontaktuppgifter.
  }
  return kr;
}

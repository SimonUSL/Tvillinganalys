// postorter.ts — vilka postorter som hör till varje kommun (Lerum → Lerum,
// Gråbo, Floda, Stenkullen …), så att en lokal tvillingsökning kan ta hela
// kommunen. bolagsdataapi filtrerar bara på postort.
//
// Källa: GeoNames postnummer för Sverige (download.geonames.org/export/zip/SE.zip,
// hämtad 2026-10-12), licens CC BY 4.0, www.geonames.org. postorter.json byggs
// ur filen: postorter per kommun, de med flest postnummer först. 287 av 290
// kommuner finns med; saknas en kommun söks bara postorten själv.

import POSTORTER from "./postorter.json";

const PER_KOMMUN = POSTORTER as Record<string, string[]>;
const nyckel = (s: string) => s.trim().toUpperCase();

// Postort → kommun(er). Ett fåtal postorter ligger i flera kommuner; den
// kommun där orten har flest postnummer kommer först.
const KOMMUN_FOR = new Map<string, string[]>();
for (const [kommun, orter] of Object.entries(PER_KOMMUN)) {
  orter.forEach((ort, i) => {
    const k = nyckel(ort);
    const lista = KOMMUN_FOR.get(k) || [];
    lista.push(kommun);
    KOMMUN_FOR.set(k, i === 0 ? [kommun, ...lista.filter((x) => x !== kommun)] : lista);
  });
}

export const kommunForPostort = (ort: string | null | undefined): string | null =>
  (ort && KOMMUN_FOR.get(nyckel(ort))?.[0]) || null;

export const postorterIKommun = (kommun: string): string[] => PER_KOMMUN[kommun] || [kommun];

// "Lerum" → "Lerums kommun", "Borås" → "Borås kommun", "Uppsala" → "Uppsala kommun"
export const kommunNamn = (kommun: string) => `${kommun}${/[aeiouyåäösxz]$/i.test(kommun) ? "" : "s"} kommun`;

// Orterna att söka för ett lokalt bolag: bolagets egen postort, sedan alla
// postorter i dess kommun och i kommuner som förfrågan nämner - varannan från
// varje kommun, så att alla kommuner kommer med när antalet sökningar är begränsat.
export function naraOrter(egenOrt: string | null | undefined, namndaKommuner: string[]): { orter: string[]; kommuner: string[] } {
  const snygg = (o: string) => o.trim().charAt(0).toUpperCase() + o.trim().slice(1).toLowerCase();
  const kommuner = [...new Set([kommunForPostort(egenOrt), ...namndaKommuner].filter(Boolean) as string[])];
  const listor = kommuner.map(postorterIKommun);
  const varvade = Array.from({ length: Math.max(0, ...listor.map((l) => l.length)) }, (_, i) => listor.map((l) => l[i])).flat();
  const orter = [egenOrt ? snygg(egenOrt) : null, ...varvade].filter(Boolean) as string[];
  const sedda = new Set<string>();
  return { orter: orter.filter((o) => !sedda.has(nyckel(o)) && !!sedda.add(nyckel(o))), kommuner };
}

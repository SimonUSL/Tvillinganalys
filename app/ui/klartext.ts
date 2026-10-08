// Klartext för kunden. Kunden ska se VAD som hände, inte hur (Jev, tic.io,
// bolagsdataapi, procent, SNI-koder) - det visas bara i adminvyn (/admin).

const TYP: Record<string, string> = {
  ny_forfragan: "Ny förfrågan",
  befintlig_kund: "Befintlig kund",
  saljer_till_optimal: "Säljförsök",
  avregistrering: "Avregistrering",
  ovrigt: "Övrigt",
  oklart: "Oklar",
};
const AVSANDARE: Record<string, string> = {
  foretag: "Företag",
  forening: "Förening",
  offentlig: "Offentlig aktör",
  privatperson: "Privatperson",
};

export function forfraganEtikett(typ?: string | null, avsandare?: string | null): string {
  return [TYP[typ || ""] || "Förfrågan", AVSANDARE[avsandare || ""]].filter(Boolean).join(" · ");
}

const HOPPA: Record<string, string> = {
  befintlig_kund: "Befintlig kund",
  maklare: "Mäklare",
  privatperson: "Privatperson",
  utlandsk: "Utländskt bolag",
  saljer_till_optimal: "Säljförsök eller spam",
  avregistrering: "Vill bli borttagen från utskick",
  ovrigt: "Gäller inte våra tjänster",
  oklart: "För kort eller otydlig förfrågan",
  fel: "Kunde inte läsas",
};
export const hoppaText = (kod?: string | null) => HOPPA[kod || ""] || "Hoppas över";

export function matchningText(kod?: string | null): string | null {
  switch (kod) {
    case "osaker":
      return "Osäker matchning – kontrollera bolaget.";
    case "ingen":
      return "Hittade inget matchande bolag – fyll i bolagsnamn eller org.nr.";
    case "inget_namn":
      return "Förfrågan saknar bolagsnamn – fyll i bolagsnamn eller org.nr.";
    case "fel":
      return "Bolaget kunde inte slås upp – fyll i själv.";
    default:
      return null; // säker matchning behöver ingen kommentar
  }
}

// "Dalarnas län" -> "Dalarna", "Blekinge" -> "Blekinge"
const kortLan = (lan?: string | null) => (lan || "").replace(/s?\s+län$/i, "").trim();

export function urvalText(kod?: string | null, lokal?: boolean, lan?: string | null): string | null {
  const iLan = lokal && kortLan(lan) ? ` i ${kortLan(lan)}` : "";
  switch (kod) {
    case "namn":
    case "nyckelord":
      return `Bolag med liknande verksamhet${iLan}`;
    case "nisch":
      return `De största bolagen i branschen${iLan}`;
    case "storlek":
      return `Bolag av liknande storlek${iLan}`;
    case "strikt":
      return `Bolag av samma storlek${iLan}`;
    default:
      return null;
  }
}

export const lokalText = (lokal?: boolean) => (lokal === undefined ? null : lokal ? "Lokalt bolag" : "Rikstäckande");

export const sasongText = (kod?: string | null) =>
  kod ? `Säsong: ${{ var: "vår", host: "höst" }[kod] ?? kod}` : null;

export function statusText(kod?: string | null): string {
  switch (kod) {
    case "ej_hittat":
      return "Bolaget hittades inte.";
    case "ingen_sni":
      return "Bolaget saknar uppgift om bransch, så det går inte att hitta liknande bolag.";
    case "inga_tvillingar":
      return "Hittade inga tillräckligt lika bolag.";
    case "dublett":
      return "Samma bolag fanns redan tidigare i listan.";
    case "fel":
      return "Något gick fel vid sökningen. Försök igen.";
    default:
      return "";
  }
}

// Varför en automatisk förfrågan hamnat i granskningskön.
export const GRANSKA_ORSAK: Record<string, string> = {
  osaker: "Vi är osäkra på vilket bolag som skickade förfrågan.",
  ingen: "Vi hittade inget bolag i registret som matchar avsändaren.",
  inget_namn: "Förfrågan innehåller inget bolagsnamn och skickades från en privat e-postadress.",
  inga_tvillingar: "Vi hittade inga tillräckligt lika bolag.",
  fel: "Något gick fel när förfrågan behandlades.",
};

// "direkt konkurrent (2.9/3)" -> "Direkt konkurrent"
export function likhetText(t?: string | null): string {
  if (!t) return "";
  const s = t.replace(/\s*\(.*\)$/, "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

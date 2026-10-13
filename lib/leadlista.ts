// leadlista.ts — läser säljarnas leadlista (mallen public/mallar/leadlista-mall.xlsx,
// eller samma kolumner som CSV) till leads. Körs i webbläsaren.
// Rubrikerna och värdena får skrivas på flera sätt; okända värden blir
// varningar per rad i stället för att stoppa hela listan.

import { raderTillPoster } from "./csv";
import { KOMMUNER } from "./kommuner";

export interface ListLead {
  rad: number; // radnumret i filen (rubrikraden = 1)
  namn: string;
  org: string;
  geo: string; // "ja" | "nej" | "" (verktyget avgör)
  sasong: string; // "ingen" | "vinter" | "var" | "sommar" | "host" | "jul" | "" (verktyget avgör)
  strikt: string; // "ja" | ""
  kommun: string; // en av de 290 kommunerna, eller ""
}

export const MALL_KOLUMNER = ["Bolagsnamn", "Org.nr", "Lokalt bolag", "Säsong", "Samma storlek", "Kommun"] as const;
export const VERKTYGET_AVGOR = "Låt verktyget avgöra";
export const VAL_LOKALT = [VERKTYGET_AVGOR, "Ja", "Nej"];
export const VAL_SASONG = [VERKTYGET_AVGOR, "Ingen", "Vinter", "Vår", "Sommar", "Höst", "Jul"];
export const VAL_STORLEK = ["Nej", "Ja"];

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

// Rubrik i filen -> fält. Även de gamla CSV-rubrikerna fungerar.
const RUBRIKER: Record<string, keyof Omit<ListLead, "rad">> = {
  bolagsnamn: "namn",
  bolag: "namn",
  foretagsnamn: "namn",
  foretag: "namn",
  orgnr: "org",
  organisationsnummer: "org",
  lokaltbolag: "geo",
  lokalt: "geo",
  geografirelevant: "geo",
  sasong: "sasong",
  sasongseffekt: "sasong",
  sammastorlek: "strikt",
  storlekstrikt: "strikt",
  kommun: "kommun",
};

const SASONG: Record<string, string> = {
  ingen: "ingen", nej: "ingen", vinter: "vinter", var: "var", sommar: "sommar", host: "host", jul: "jul",
};
const KOMMUN_FRAN_NORM = new Map(KOMMUNER.map((k) => [norm(k), k]));

export function lasLeadlista(rader: string[][]): { leads: ListLead[]; varningar: string[]; fel: string | null } {
  // Hoppa över tomma rader före rubriken.
  const start = rader.findIndex((r) => r.some((c) => String(c ?? "").trim()));
  if (start < 0) return { leads: [], varningar: [], fel: "Filen är tom." };
  const rubriker = rader[start].map((h) => RUBRIKER[norm(String(h ?? ""))]);
  if (!rubriker.includes("namn") && !rubriker.includes("org")) {
    return { leads: [], varningar: [], fel: "Hittar ingen kolumn Bolagsnamn eller Org.nr. Använd mallen, eller se till att första raden har kolumnnamnen." };
  }
  const poster = raderTillPoster([rubriker.map((r, i) => r || `_okand${i}`), ...rader.slice(start + 1).map((r) => r.map((c) => String(c ?? "")))]);
  const leads: ListLead[] = [];
  const varningar: string[] = [];
  poster.forEach((p, i) => {
    const radNr = start + i + 2;
    const namn = (p.namn || "").trim();
    const org = (p.org || "").replace(/[^\d]/g, "");
    if (!namn && !org) return; // tom rad
    const geoN = norm(p.geo || "");
    const geo = ["ja", "yes", "x", "1"].includes(geoN) ? "ja" : ["nej", "no", "0"].includes(geoN) ? "nej" : "";
    const sasongN = norm(p.sasong || "");
    const sasong = SASONG[sasongN] ?? "";
    if (sasongN && !SASONG[sasongN] && sasongN !== norm(VERKTYGET_AVGOR)) varningar.push(`Rad ${radNr}: okänd säsong "${p.sasong}", verktyget avgör i stället.`);
    const strikt = ["ja", "yes", "x", "1"].includes(norm(p.strikt || "")) ? "ja" : "";
    const kommunText = (p.kommun || "").replace(/s?\s+kommun$/i, "").trim();
    let kommun = "";
    if (kommunText) {
      kommun = KOMMUN_FRAN_NORM.get(norm(kommunText)) || KOMMUN_FRAN_NORM.get(norm(kommunText.replace(/s$/, ""))) || "";
      if (!kommun) varningar.push(`Rad ${radNr}: okänd kommun "${p.kommun}", den hoppas över.`);
    }
    if (org && org.length !== 10) {
      if (!namn) {
        varningar.push(`Rad ${radNr}: org.nr "${p.org}" har inte 10 siffror och bolagsnamn saknas, raden hoppas över.`);
        return;
      }
      varningar.push(`Rad ${radNr}: org.nr "${p.org}" har inte 10 siffror, bolaget söks på namnet.`);
    }
    leads.push({ rad: radNr, namn, org: org.length === 10 ? org : "", geo, sasong, strikt, kommun });
  });
  if (!leads.length) return { leads, varningar, fel: "Listan innehåller inga bolag." };
  return { leads, varningar, fel: null };
}

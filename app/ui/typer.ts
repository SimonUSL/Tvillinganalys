import type { ResultRow } from "../api/run/route";

export type Steg = "underlag" | "granska" | "resultat";
export type Kalla = "export" | "csv";
export type Grupp = "valda" | "behover" | "hoppas";

// En rad i granskningen: en förfrågan (formulärexport) eller ett lead (CSV).
export interface Rad {
  id: number;
  grupp: Grupp; // sätts vid förhandsgranskningen och ändras inte medan man redigerar
  vald: boolean;
  namn: string;
  org: string;
  // formulärexporter
  datum?: string;
  formular?: string;
  doman?: string | null;
  typ?: string; // teknisk beskrivning (admin)
  typ_kod?: string | null;
  avsandare_kod?: string | null;
  hoppa_kod?: string | null;
  matchning_kod?: string | null;
  text?: string;
  kommentar?: string; // Jevs matchning eller orsaken till att den hoppas över
  forslag?: { namn: string; org_nr: string }; // osäkert förslag som kan godtas med ett klick
  koId?: string; // post i granskningskön (/granska)
  orsak?: string; // varför posten ligger i granskningskön (klartext)
  avsandare?: string; // namn · e-post · telefon ur formuläret
  avsandare_falt?: { namn?: string | null; epost?: string | null; telefon?: string | null };
  // CSV
  geo?: string;
  sasong?: string;
  strikt?: string;
}

export interface Korning {
  status: "kor" | "klar" | "fel";
  index: number;
  totalt: number;
  aktuellt: string;
  rows: ResultRow[];
  ticAnrop: number;
  ticCache: number;
  fel?: string;
}

export { KOLUMNER } from "@/lib/csvexport";
import { byggCsv } from "@/lib/csvexport";

export function laddaNerCsv(rows: ResultRow[], filnamn: string, admin = false) {
  // BOM så att Excel läser å/ä/ö rätt.
  const blob = new Blob(["\uFEFF" + byggCsv(rows, admin)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filnamn;
  a.click();
  URL.revokeObjectURL(url);
}

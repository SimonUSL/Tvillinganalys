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
  typ?: string;
  text?: string;
  kommentar?: string; // Jevs matchning eller orsaken till att den hoppas över
  forslag?: { namn: string; org_nr: string }; // osäkert förslag som kan godtas med ett klick
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

export const KOLUMNER: { key: keyof ResultRow; label: string }[] = [
  { key: "forfragan_datum", label: "Datum" },
  { key: "forfragan_formular", label: "Formulär" },
  { key: "forfragan_doman", label: "Domän" },
  { key: "forfragan_typ", label: "Förfrågan" },
  { key: "forfragan_text", label: "Meddelande" },
  { key: "lead_foretagsnamn", label: "Lead" },
  { key: "kall_namn", label: "Kallbolag" },
  { key: "kall_org_nr", label: "Kall org.nr" },
  { key: "kall_matchning", label: "Matchning" },
  { key: "urval", label: "Urval" },
  { key: "tvilling_namn", label: "Tvilling" },
  { key: "tvilling_org_nr", label: "Tvilling org.nr" },
  { key: "tvilling_likhet", label: "Likhet" },
  { key: "tvilling_poang", label: "Poäng" },
  { key: "tvilling_oms", label: "Omsättning (kr)" },
  { key: "tvilling_anstallda", label: "Anställda" },
  { key: "tvilling_ort", label: "Ort" },
  { key: "tvilling_lan", label: "Län" },
  { key: "kontakt_namn", label: "Kontakt" },
  { key: "kontakt_mejl", label: "Mejl" },
  { key: "kontakt_telefon", label: "Telefon" },
  { key: "geografi_relevant", label: "Geografi" },
  { key: "sasongseffekt", label: "Säsong" },
  { key: "tvilling_verksamhet", label: "Verksamhet" },
  { key: "status", label: "Status" },
];

// Bara kolumner som har värden exporteras.
export function laddaNerCsv(rows: ResultRow[], filnamn: string) {
  const kolumner = KOLUMNER.filter((c) => rows.some((r) => r[c.key] !== null && r[c.key] !== undefined && r[c.key] !== ""));
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rader = [kolumner.map((k) => cell(k.label)).join(",")];
  for (const r of rows) rader.push(kolumner.map((k) => cell(r[k.key])).join(","));
  // BOM så att Excel läser å/ä/ö rätt.
  const blob = new Blob(["﻿" + rader.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filnamn;
  a.click();
  URL.revokeObjectURL(url);
}

import type { ResultRow } from "../api/run/route";
import { likhetText, statusText } from "./klartext";

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

// Kundens export: bara det som behövs för att arbeta med tvillingarna, i klartext.
type Kolumn = { key: keyof ResultRow | "kommentar"; label: string; varde?: (r: ResultRow) => unknown };
const KUND_KOLUMNER: Kolumn[] = [
  { key: "forfragan_datum", label: "Datum" },
  { key: "forfragan_formular", label: "Formulär" },
  { key: "forfragan_typ", label: "Förfrågan" },
  { key: "forfragan_text", label: "Meddelande" },
  { key: "kall_namn", label: "Bolag", varde: (r) => r.kall_namn || r.lead_foretagsnamn },
  { key: "kall_org_nr", label: "Org.nr" },
  { key: "tvilling_namn", label: "Tvilling" },
  { key: "tvilling_org_nr", label: "Tvilling org.nr" },
  { key: "tvilling_likhet", label: "Likhet", varde: (r) => likhetText(r.tvilling_likhet) },
  { key: "tvilling_ort", label: "Ort" },
  { key: "tvilling_lan", label: "Län" },
  { key: "tvilling_oms", label: "Omsättning (kr)" },
  { key: "tvilling_anstallda", label: "Anställda" },
  { key: "tvilling_verksamhet", label: "Verksamhet" },
  { key: "kontakt_namn", label: "Kontakt" },
  { key: "kontakt_mejl", label: "Mejl" },
  { key: "kontakt_telefon", label: "Telefon" },
  { key: "kommentar", label: "Kommentar", varde: (r) => (r.tvilling_namn ? "" : statusText(r.status_kod)) },
];

// Bara kolumner som har värden exporteras. Adminvyn får alla tekniska kolumner.
export function laddaNerCsv(rows: ResultRow[], filnamn: string, admin = false) {
  const alla: Kolumn[] = admin ? KOLUMNER : KUND_KOLUMNER;
  const hamta = (r: ResultRow, k: Kolumn) => (k.varde ? k.varde(r) : (r as any)[k.key]);
  const kolumner = alla.filter((c) => rows.some((r) => { const v = hamta(r, c); return v !== null && v !== undefined && v !== ""; }));
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rader = [kolumner.map((k) => cell(k.label)).join(",")];
  for (const r of rows) rader.push(kolumner.map((k) => cell(hamta(r, k))).join(","));
  // BOM så att Excel läser å/ä/ö rätt.
  const blob = new Blob(["﻿" + rader.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filnamn;
  a.click();
  URL.revokeObjectURL(url);
}

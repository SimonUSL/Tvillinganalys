// csvexport.ts — tvillingarna som CSV (öppnas i Excel). Används både i
// webbläsaren (nedladdning) och på servern (bilaga i mejlet).
import type { ResultRow } from "./korning";
import { likhetText, statusText, tidigareText } from "@/app/ui/klartext";

type Kolumn = { key: keyof ResultRow | "kommentar"; label: string; varde?: (r: ResultRow) => unknown };
export const KOLUMNER: Kolumn[] = [
  { key: "forfragan_datum", label: "Datum" },
  { key: "forfragan_formular", label: "Formulär" },
  { key: "forfragan_doman", label: "Domän" },
  { key: "forfragan_typ", label: "Förfrågan" },
  { key: "forfragan_namn", label: "Avsändare" },
  { key: "forfragan_epost", label: "Avsändarens e-post" },
  { key: "forfragan_telefon", label: "Avsändarens telefon" },
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
  { key: "beslutsfattare", label: "Beslutsfattare" },
  { key: "bolag_epost", label: "Bolagets e-post" },
  { key: "bolag_telefon", label: "Bolagets telefon" },
  { key: "bolag_webb", label: "Webbplats" },
  { key: "kontakt_namn", label: "Kontakt" },
  { key: "kontakt_mejl", label: "Mejl" },
  { key: "kontakt_telefon", label: "Telefon" },
  { key: "tidigare_datum", label: "Föreslogs tidigare", varde: (r) => tidigareText(r) },
  { key: "geografi_relevant", label: "Geografi" },
  { key: "sasongseffekt", label: "Säsong" },
  { key: "tvilling_verksamhet", label: "Verksamhet" },
  { key: "status", label: "Status" },
];

// Kundens export: bara det som behövs för att arbeta med tvillingarna, i klartext.
const KUND_KOLUMNER: Kolumn[] = [
  { key: "forfragan_datum", label: "Datum" },
  { key: "forfragan_formular", label: "Formulär" },
  { key: "forfragan_typ", label: "Förfrågan" },
  { key: "forfragan_namn", label: "Avsändare" },
  { key: "forfragan_epost", label: "Avsändarens e-post" },
  { key: "forfragan_telefon", label: "Avsändarens telefon" },
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
  { key: "beslutsfattare", label: "Beslutsfattare" },
  { key: "bolag_epost", label: "Bolagets e-post" },
  { key: "bolag_telefon", label: "Bolagets telefon" },
  { key: "bolag_webb", label: "Webbplats" },
  { key: "kontakt_namn", label: "Kontakt" },
  { key: "kontakt_mejl", label: "Mejl" },
  { key: "kontakt_telefon", label: "Telefon" },
  { key: "tidigare_datum", label: "Föreslogs tidigare", varde: (r) => tidigareText(r) },
  { key: "kommentar", label: "Kommentar", varde: (r) => (r.tvilling_namn ? "" : statusText(r.status_kod)) },
];

// Bara kolumner som har värden exporteras. Adminvyn får alla tekniska kolumner.
export function byggCsv(rows: ResultRow[], admin = false): string {
  const alla: Kolumn[] = admin ? KOLUMNER : KUND_KOLUMNER;
  const hamta = (r: ResultRow, k: Kolumn) => (k.varde ? k.varde(r) : (r as any)[k.key]);
  const kolumner = alla.filter((c) => rows.some((r) => { const v = hamta(r, c); return v !== null && v !== undefined && v !== ""; }));
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rader = [kolumner.map((k) => cell(k.label)).join(",")];
  for (const r of rows) rader.push(kolumner.map((k) => cell(hamta(r, k))).join(","));
  return rader.join("\n");
}

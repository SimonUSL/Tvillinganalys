"use client";

import { useState } from "react";
import type { ResultRow } from "./api/run/route";

const EXEMPEL = `foretagsnamn,geografi_relevant,storlek_strikt,sasongseffekt
SkiStar AB,,,
Acme Bygg AB,ja,nej,
Nordic Städ AB,nej,ja,jul`;

const KOLUMNER: { key: keyof ResultRow; label: string }[] = [
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
  { key: "tvilling_anstallda", label: "Anställda" },
  { key: "tvilling_lan", label: "Län" },
  { key: "kontakt_namn", label: "Kontakt" },
  { key: "kontakt_mejl", label: "Mejl" },
  { key: "kontakt_telefon", label: "Telefon" },
  { key: "geografi_relevant", label: "Geografi" },
  { key: "sasongseffekt", label: "Säsong" },
  { key: "tvilling_verksamhet", label: "Verksamhet" },
  { key: "status", label: "Status" },
];

const ACCENT = "#EB5F62";
const DARK = "#2B2B2B";
const BORDER = "#EEF0F3";
const CARD_BG = "#FFFFFF";
const LOGO_SRC =
  "https://cdn.prod.website-files.com/5dd4488fdda3ce628d8173ce/5ddfe48c64e4a62b7bd48be9_optimal_kommunikation_logo.svg";

// Långa texter kortas i tabellen; hela texten finns i CSV:n och vid hovring.
const LANGA_KOLUMNER = new Set<keyof ResultRow>(["tvilling_verksamhet", "forfragan_text"]);

function isoDag(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

type Lage = "csv" | "export";

export default function Home() {
  const [lage, setLage] = useState<Lage>("csv");
  const [csv, setCsv] = useState(EXEMPEL);
  const [filer, setFiler] = useState<{ name: string; text: string }[]>([]);
  const [fran, setFran] = useState(() => isoDag(new Date(Date.now() - 7 * 24 * 3600 * 1000)));
  const [till, setTill] = useState(() => isoDag(new Date()));
  const [rows, setRows] = useState<ResultRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setRows(null);
    try {
      const resp = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lage === "csv" ? { csv } : { exports: filer, from: fran, to: till }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setError(data.error || "Något gick fel.");
      } else {
        setRows(data.rows);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  async function valjFiler(lista: FileList | null) {
    if (!lista) return;
    setFiler(await Promise.all(Array.from(lista).map(async (f) => ({ name: f.name, text: await f.text() }))));
  }

  // Bara kolumner som har något värde i resultatet visas och exporteras.
  const synliga = rows
    ? KOLUMNER.filter((c) => rows.some((r) => { const v = (r as any)[c.key]; return v !== null && v !== undefined && v !== ""; }))
    : KOLUMNER;

  function downloadCsv() {
    if (!rows) return;
    const headers = synliga.map((k) => k.key as string);
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(
        headers
          .map((h) => {
            const v = (row as any)[h];
            const s = v === null || v === undefined ? "" : String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
          })
          .join(",")
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tvillingar.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 28 }}>
        <img src={LOGO_SRC} alt="Optimal Kommunikation" style={{ height: 32 }} />
        <button
          onClick={handleLogout}
          style={{
            background: "none",
            border: "none",
            color: "#64646A",
            fontFamily: "'Poppins', system-ui, sans-serif",
            fontSize: 13,
            cursor: "pointer",
            textDecoration: "underline",
          }}
        >
          Logga ut
        </button>
      </div>

      <div
        style={{
          background: CARD_BG,
          border: `1px solid ${BORDER}`,
          borderRadius: 8,
          padding: 28,
        }}
      >
        <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 4, color: DARK }}>
          Tvillinganalys
        </h1>
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
          {(
            [
              ["csv", "CSV med leads"],
              ["export", "Formulärexporter"],
            ] as [Lage, string][]
          ).map(([v, text]) => (
            <button
              key={v}
              onClick={() => setLage(v)}
              style={{
                background: lage === v ? DARK : "white",
                color: lage === v ? "white" : DARK,
                border: `1px solid ${DARK}`,
                borderRadius: 6,
                padding: "6px 14px",
                fontFamily: "'Poppins', system-ui, sans-serif",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              {text}
            </button>
          ))}
        </div>

        {lage === "csv" ? (
          <>
            <p style={{ color: "#64646A", marginTop: 0, marginBottom: 24, fontSize: 14 }}>
              Klistra in leads.csv nedan och kör sökningen. Bara foretagsnamn krävs (lägg gärna till kolumnen org_nr för bolag med många namnlika träffar). Lämnar du
              geografi_relevant eller sasongseffekt tomma gissar Jev dem utifrån bolagets
              verksamhet; ifyllda värden gäller alltid (skriv &quot;ingen&quot; för ingen säsong).
            </p>
            <textarea
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              rows={10}
              style={{
                width: "100%",
                fontFamily: "monospace",
                fontSize: 13,
                padding: 12,
                borderRadius: 6,
                border: `1px solid ${BORDER}`,
                boxSizing: "border-box",
              }}
            />
          </>
        ) : (
          <>
            <p style={{ color: "#64646A", marginTop: 0, marginBottom: 16, fontSize: 14 }}>
              Ladda upp webbplatsens formulärexporter (boka demo, kontaktformulär, kontaktsida, offertförfrågan) och välj
              period. Jev klassar varje förfrågan; bara nya förfrågningar från företag, föreningar och offentliga aktörer
              tvillingsöks. Övriga visas med orsak. Mäklare och befintliga kunder hoppas över tills vidare.
            </p>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", fontSize: 13 }}>
              <input type="file" accept=".csv" multiple onChange={(e) => valjFiler(e.target.files)} />
              <label>
                Från <input type="date" value={fran} onChange={(e) => setFran(e.target.value)} />
              </label>
              <label>
                Till <input type="date" value={till} onChange={(e) => setTill(e.target.value)} />
              </label>
            </div>
            {filer.length > 0 && (
              <p style={{ color: "#64646A", fontSize: 13, marginBottom: 0 }}>
                {filer.length} fil{filer.length > 1 ? "er" : ""}: {filer.map((f) => f.name).join(", ")}
              </p>
            )}
          </>
        )}

        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={run}
            disabled={loading || (lage === "export" && !filer.length)}
            style={{
              background: ACCENT,
              color: "white",
              border: `2px solid ${ACCENT}`,
              borderRadius: 6,
              padding: "10px 22px 8px",
              fontFamily: "'Poppins', system-ui, sans-serif",
              fontWeight: 600,
              fontSize: 13,
              textTransform: "uppercase",
              cursor: loading ? "default" : "pointer",
              opacity: loading ? 0.6 : 1,
            }}
          >
            {loading ? "Kör..." : "Kör sökning"}
          </button>
          {rows && (
            <button
              onClick={downloadCsv}
              style={{
                background: "white",
                color: DARK,
                border: `2px solid ${DARK}`,
                borderRadius: 6,
                padding: "10px 22px 8px",
                fontFamily: "'Poppins', system-ui, sans-serif",
                fontWeight: 600,
                fontSize: 13,
                textTransform: "uppercase",
                cursor: "pointer",
              }}
            >
              Ladda ner som CSV
            </button>
          )}
          {rows && <span style={{ color: "#64646A", fontSize: 13 }}>{rows.length} rader</span>}
        </div>

        {error && (
          <p style={{ color: ACCENT, marginTop: 16, whiteSpace: "pre-wrap" }}>{error}</p>
        )}

        {rows && (
          <div style={{ overflowX: "auto", marginTop: 28 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr>
                  {synliga.map((c) => (
                    <th
                      key={c.key as string}
                      style={{
                        textAlign: "left",
                        padding: "8px 10px",
                        borderBottom: `2px solid ${DARK}`,
                        whiteSpace: "nowrap",
                        color: DARK,
                        fontWeight: 600,
                      }}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                    {synliga.map((c) => {
                      const value = (row as any)[c.key] ?? "";
                      if (LANGA_KOLUMNER.has(c.key)) {
                        const text = String(value);
                        return (
                          <td key={c.key as string} title={text} style={{ padding: "8px 10px", minWidth: 280 }}>
                            {text.length > 140 ? `${text.slice(0, 140)}…` : text}
                          </td>
                        );
                      }
                      return (
                        <td key={c.key as string} style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                          {value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

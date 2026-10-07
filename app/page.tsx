"use client";

import { useState } from "react";
import type { ResultRow } from "./api/run/route";

const EXEMPEL = `foretagsnamn,geografi_relevant,storlek_strikt,sasongseffekt
Acme Bygg AB,ja,nej,
Nordic Städ AB,nej,ja,jul`;

const KOLUMNER: { key: keyof ResultRow; label: string }[] = [
  { key: "lead_foretagsnamn", label: "Lead" },
  { key: "kall_namn", label: "Kallbolag" },
  { key: "kall_org_nr", label: "Kall org.nr" },
  { key: "tvilling_namn", label: "Tvilling" },
  { key: "tvilling_org_nr", label: "Tvilling org.nr" },
  { key: "tvilling_anstallda", label: "Anställda" },
  { key: "tvilling_lan", label: "Län" },
  { key: "kontakt_namn", label: "Kontakt" },
  { key: "kontakt_mejl", label: "Mejl" },
  { key: "kontakt_telefon", label: "Telefon" },
  { key: "sasongseffekt", label: "Säsong" },
  { key: "status", label: "Status" },
];

const ACCENT = "#EB5F62";
const DARK = "#2B2B2B";
const BORDER = "#EEF0F3";
const CARD_BG = "#FFFFFF";
const LOGO_SRC =
  "https://cdn.prod.website-files.com/5dd4488fdda3ce628d8173ce/5ddfe48c64e4a62b7bd48be9_optimal_kommunikation_logo.svg";

export default function Home() {
  const [csv, setCsv] = useState(EXEMPEL);
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
        body: JSON.stringify({ csv }),
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

  function downloadCsv() {
    if (!rows) return;
    const headers = KOLUMNER.map((k) => k.key as string);
    const lines = [headers.join(",")];
    for (const row of rows) {
      lines.push(
        headers
          .map((h) => {
            const v = (row as any)[h];
            const s = v === null || v === undefined ? "" : String(v);
            return s.includes(",") ? `"${s.replace(/"/g, '""')}"` : s;
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
        <p style={{ color: "#64646A", marginTop: 0, marginBottom: 24, fontSize: 14 }}>
          Klistra in leads.csv nedan (kolumner: foretagsnamn, geografi_relevant,
          storlek_strikt, sasongseffekt) och kör sökningen.
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

        <div style={{ marginTop: 16, display: "flex", gap: 10, alignItems: "center" }}>
          <button
            onClick={run}
            disabled={loading}
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
                  {KOLUMNER.map((c) => (
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
                    {KOLUMNER.map((c) => (
                      <td key={c.key as string} style={{ padding: "8px 10px", whiteSpace: "nowrap" }}>
                        {(row as any)[c.key] ?? ""}
                      </td>
                    ))}
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

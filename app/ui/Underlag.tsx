"use client";

import { useState } from "react";
import { parseCsvRader } from "@/lib/csv";
import { lasLeadlista, type ListLead } from "@/lib/leadlista";

export interface Lista {
  filnamn: string;
  leads: ListLead[];
  varningar: string[];
}

interface Props {
  lista: Lista | null;
  setLista: (l: Lista | null) => void;
  onNasta: () => void;
}

// Leadlistan läses i webbläsaren: Excel (mallen) eller CSV.
async function lasFil(fil: File): Promise<string[][]> {
  const namn = fil.name.toLowerCase();
  if (namn.endsWith(".xlsx") || namn.endsWith(".xls")) {
    const XLSX = await import("xlsx");
    const bok = XLSX.read(await fil.arrayBuffer(), { type: "array" });
    // Första bladet är listan (mallen har bara ett blad med bolag).
    const blad = bok.Sheets[bok.SheetNames[0]];
    return XLSX.utils.sheet_to_json<string[]>(blad, { header: 1, raw: false, defval: "" });
  }
  if (namn.endsWith(".csv") || namn.endsWith(".txt")) return parseCsvRader(await fil.text());
  throw new Error("Välj en Excel-fil (.xlsx) eller en CSV-fil.");
}

export default function Underlag({ lista, setLista, onNasta }: Props) {
  const [over, setOver] = useState(false);
  const [fel, setFel] = useState<string | null>(null);
  const [laser, setLaser] = useState(false);

  async function valj(filer: FileList | null) {
    const fil = filer?.[0];
    if (!fil) return;
    setFel(null);
    setLaser(true);
    try {
      const r = lasLeadlista(await lasFil(fil));
      if (r.fel) {
        setLista(null);
        setFel(r.fel);
      } else setLista({ filnamn: fil.name, leads: r.leads, varningar: r.varningar });
    } catch (e: any) {
      setLista(null);
      setFel(e.message || "Filen kunde inte läsas.");
    } finally {
      setLaser(false);
    }
  }

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (lista) onNasta();
      }}
    >
      <div className="field">
        <span className="field-label" id="fil-rubrik">
          Leadlista
        </span>
        <label
          className={`dropzone${over ? " over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            valj(e.dataTransfer.files);
          }}
        >
          <input
            type="file"
            id="leadlista"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="visually-hidden"
            aria-labelledby="fil-rubrik"
            aria-describedby="fil-hjalp"
            onChange={(e) => {
              valj(e.target.files);
              e.target.value = "";
            }}
          />
          {laser ? (
            <>
              <span className="spinner" aria-hidden="true" /> Läser filen…
            </>
          ) : (
            <>
              <strong>Dra hit leadlistan</strong> eller klicka för att välja
            </>
          )}
          <p className="hint" id="fil-hjalp">
            Fyll i mallen i Excel och dra in den här. CSV med samma kolumner fungerar också.
          </p>
        </label>
        <p className="hint">
          <a href="/mallar/leadlista-mall.xlsx" download>
            Ladda ner mallen (Excel)
          </a>{" "}
          ·{" "}
          <a href="/mallar/leadlista-forklaring.pdf" target="_blank" rel="noreferrer">
            Förklaring av kolumnerna (PDF)
          </a>
        </p>
      </div>

      {fel && (
        <p className="alert" role="alert">
          {fel}
        </p>
      )}

      {lista && (
        <div className="stack" style={{ gap: 8 }}>
          <ul className="file-list" aria-label="Vald fil">
            <li>
              <span>
                <strong style={{ color: "var(--ink)" }}>{lista.leads.length} bolag</strong> · {lista.filnamn}
              </span>
              <button type="button" className="btn-link" onClick={() => setLista(null)}>
                Ta bort
              </button>
            </li>
          </ul>
          {lista.varningar.length > 0 && (
            <details className="note warn">
              <summary>
                {lista.varningar.length} {lista.varningar.length === 1 ? "sak" : "saker"} att kontrollera i filen
              </summary>
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {lista.varningar.map((v) => (
                  <li key={v}>{v}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <p className="hint">Du granskar listan innan något söks.</p>
        <button type="submit" className="btn btn-primary" aria-disabled={!lista}>
          Granska listan →
        </button>
      </div>
    </form>
  );
}

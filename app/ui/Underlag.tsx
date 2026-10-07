"use client";

import { useState } from "react";
import type { Kalla } from "./typer";

export const CSV_EXEMPEL = `foretagsnamn,org_nr,geografi_relevant,storlek_strikt,sasongseffekt
SkiStar AB,,,,
Nordic Städ AB,,ja,nej,`;

function formularFranFilnamn(namn: string): string {
  const f = namn.toLowerCase();
  if (f.includes("demo")) return "Boka demo";
  if (f.includes("offer")) return "Offertförfrågan";
  if (f.includes("kontakt")) return "Kontaktsida";
  if (f.includes("contact")) return "Kontaktformulär";
  return "Okänt formulär";
}

export function isoDag(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const dagarSedan = (n: number) => isoDag(new Date(Date.now() - n * 24 * 3600 * 1000));

interface Props {
  kalla: Kalla;
  setKalla: (k: Kalla) => void;
  filer: { name: string; text: string }[];
  setFiler: (f: { name: string; text: string }[]) => void;
  fran: string;
  setFran: (s: string) => void;
  till: string;
  setTill: (s: string) => void;
  csv: string;
  setCsv: (s: string) => void;
  laddar: boolean;
  onNasta: () => void;
}

export default function Underlag(p: Props) {
  const [over, setOver] = useState(false);

  async function lasFiler(lista: FileList | null) {
    if (!lista) return;
    const nya = await Promise.all(
      Array.from(lista)
        .filter((f) => f.name.toLowerCase().endsWith(".csv"))
        .map(async (f) => ({ name: f.name, text: await f.text() }))
    );
    // Samma filnamn ersätts, nya läggs till.
    const behall = p.filer.filter((f) => !nya.some((n) => n.name === f.name));
    p.setFiler([...behall, ...nya]);
  }

  const kanFortsatta = p.kalla === "export" ? p.filer.length > 0 : p.csv.trim().split("\n").length > 1;

  return (
    <form
      className="card stack"
      onSubmit={(e) => {
        e.preventDefault();
        if (kanFortsatta && !p.laddar) p.onNasta();
      }}
    >
      <fieldset>
        <legend className="field-label">Vad vill du hitta tvillingar till?</legend>
        <div className="choice-grid">
          <label className="choice">
            <input
              type="radio"
              name="kalla"
              value="export"
              checked={p.kalla === "export"}
              onChange={() => p.setKalla("export")}
            />
            <strong>Förfrågningar från webbplatsen</strong>
            <span>Ladda upp formulärexporterna. Jev sorterar ut vilka som är värda att tvillingsöka.</span>
          </label>
          <label className="choice">
            <input type="radio" name="kalla" value="csv" checked={p.kalla === "csv"} onChange={() => p.setKalla("csv")} />
            <strong>Egen lista med bolag</strong>
            <span>Klistra in en CSV med bolagsnamn, till exempel befintliga kunder.</span>
          </label>
        </div>
      </fieldset>

      {p.kalla === "export" ? (
        <>
          <div className="field">
            <span className="field-label" id="filer-rubrik">
              Formulärexporter
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
                lasFiler(e.dataTransfer.files);
              }}
            >
              <input
                type="file"
                accept=".csv,text/csv"
                multiple
                className="visually-hidden"
                aria-labelledby="filer-rubrik"
                aria-describedby="filer-hjalp"
                onChange={(e) => lasFiler(e.target.files)}
              />
              <strong>Dra hit filerna</strong> eller klicka för att välja
              <p className="hint" id="filer-hjalp">
                CSV-exporterna från boka demo, kontaktformulär, kontaktsida och offertförfrågan. Du kan välja flera på en gång.
              </p>
            </label>
            {p.filer.length > 0 && (
              <ul className="file-list" aria-label="Valda filer">
                {p.filer.map((f) => (
                  <li key={f.name}>
                    <span>
                      <strong style={{ color: "var(--ink)" }}>{formularFranFilnamn(f.name)}</strong> · {f.name}
                    </span>
                    <button type="button" className="btn-link" onClick={() => p.setFiler(p.filer.filter((x) => x.name !== f.name))}>
                      Ta bort
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <fieldset className="field">
            <legend className="field-label">Period</legend>
            <div className="row">
              <div className="field">
                <label htmlFor="fran">Från</label>
                <input id="fran" type="date" value={p.fran} max={p.till} onChange={(e) => p.setFran(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="till">Till</label>
                <input id="till" type="date" value={p.till} min={p.fran} onChange={(e) => p.setTill(e.target.value)} />
              </div>
              <div className="chips-select" role="group" aria-label="Snabbval">
                {[
                  ["Senaste veckan", 7],
                  ["Senaste 2 veckorna", 14],
                  ["Senaste månaden", 30],
                ].map(([text, dagar]) => (
                  <button
                    key={text}
                    type="button"
                    className="btn"
                    style={{ minHeight: 40, padding: "6px 14px", fontWeight: 500 }}
                    aria-pressed={p.fran === dagarSedan(dagar as number) && p.till === isoDag(new Date())}
                    onClick={() => {
                      p.setFran(dagarSedan(dagar as number));
                      p.setTill(isoDag(new Date()));
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </fieldset>
        </>
      ) : (
        <div className="field">
          <label htmlFor="csv">Lista med bolag (CSV)</label>
          <p className="hint" id="csv-hjalp">
            Bara <code>foretagsnamn</code> krävs. Valfritt: <code>org_nr</code> (pekar ut bolaget exakt),{" "}
            <code>geografi_relevant</code>, <code>sasongseffekt</code> och <code>storlek_strikt</code> (ja/nej). Tomma
            geografi- och säsongsceller gissar Jev utifrån bolagets verksamhet.
          </p>
          <textarea id="csv" rows={9} aria-describedby="csv-hjalp" value={p.csv} onChange={(e) => p.setCsv(e.target.value)} />
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <p className="hint">Nästa steg använder inga tic.io-anrop — du granskar listan innan något söks.</p>
        <button type="submit" className="btn btn-primary" aria-disabled={!kanFortsatta || p.laddar}>
          {p.laddar ? (
            <>
              <span className="spinner" aria-hidden="true" /> Jev läser förfrågningarna…
            </>
          ) : p.kalla === "export" ? (
            "Förhandsgranska förfrågningar →"
          ) : (
            "Granska listan →"
          )}
        </button>
      </div>
    </form>
  );
}

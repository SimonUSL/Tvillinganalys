"use client";

import { useEffect, useState } from "react";
import type { ResultRow } from "../api/run/route";
import { laddaNerCsv, type Korning, type Rad } from "./typer";
import { likhetText, lokalText, sasongText, statusText, urvalText } from "./klartext";

interface Props {
  admin: boolean;
  korning: Korning;
  leads: Rad[]; // i den ordning de körs
  onTillbaka: () => void;
  onNy: () => void;
}

const mkr = (kr: number | null | undefined) =>
  kr === null || kr === undefined ? "–" : `${(Math.max(0, kr) / 1e6).toLocaleString("sv-SE", { maximumFractionDigits: kr < 1e7 ? 1 : 0 })} Mkr`;

function likhetBadge(text: string | null | undefined, admin: boolean) {
  if (!text) return null;
  const klass = text.startsWith("direkt")
    ? "badge-ok"
    : text.startsWith("samma bransch")
      ? "badge-info"
      : text.startsWith("ej bedömd")
        ? ""
        : "badge-warn";
  return <span className={`badge ${klass}`}>{admin ? text.replace(/\s*\(.*\)$/, "") : likhetText(text)}</span>;
}

const harKontakt = (t: ResultRow) =>
  !!(t.kontakt_namn || t.kontakt_mejl || t.beslutsfattare || t.bolag_epost || t.bolag_telefon || t.bolag_webb);

// Statusen förklarad i klartext för leads utan tvillingar.
function forklaring(status: string, urval?: string | null): string {
  if (status.startsWith("inga tvillingar") && urval?.includes("tic.io-taket"))
    return "bolagsdataapi räckte inte för det här bolaget, och taket för tic.io-anrop nåddes innan tic.io kunde användas. Kör igen med ett högre tak (oftast 1–3 anrop per bolag).";
  if (status.startsWith("ej hittat")) return `Bolaget hittades inte: ${status.replace(/^ej hittat:\s*/, "")}`;
  if (status.startsWith("inga tvillingar")) return "Inga tillräckligt lika bolag hittades.";
  if (status.startsWith("dublett")) return "Samma bolag fanns redan tidigare i listan.";
  if (status.startsWith("ingen SNI-kod")) return "Bolaget saknar branschkod (SNI), så det går inte att söka tvillingar.";
  return status;
}

function LeadKort({ lead, rows, vantar, aktiv, admin }: { lead: Rad; rows: ResultRow[]; vantar: boolean; aktiv: boolean; admin: boolean }) {
  const forsta = rows[0];
  const tvillingar = rows.filter((r) => r.tvilling_namn);
  const namn = forsta?.kall_namn || lead.namn || lead.org || lead.doman || "Okänt bolag";
  // Öppnas av sig själv när tvillingarna kommer; sedan styr användaren.
  const [oppen, setOppen] = useState(false);
  const harTvillingar = !vantar && tvillingar.length > 0;
  useEffect(() => {
    if (harTvillingar) setOppen(true);
  }, [harTvillingar]);
  // Bolaget valdes i granskningen: visa hur (Jevs bedömning eller manuellt).
  const matchning =
    forsta?.kall_matchning === "angivet org.nr"
      ? lead.kommentar && /^Jev \d+ %$/.test(lead.kommentar)
        ? `${lead.kommentar} säker`
        : "valt i granskningen"
      : forsta?.kall_matchning;
  return (
    <details
      className="result-card"
      open={oppen}
      onToggle={(e) => setOppen((e.currentTarget as HTMLDetailsElement).open)}
    >
      <summary>
        <h3>
          {namn}
          {forsta?.kall_org_nr && <span className="badge">{forsta.kall_org_nr}</span>}
          {vantar ? (
            aktiv ? (
              <span className="badge badge-info">
                <span className="spinner" aria-hidden="true" style={{ width: 12, height: 12, borderWidth: 2 }} /> söker…
              </span>
            ) : (
              <span className="badge">väntar</span>
            )
          ) : tvillingar.length ? (
            <span className="badge badge-ok">{tvillingar.length} tvillingar</span>
          ) : (
            <span className="badge badge-warn">inga tvillingar</span>
          )}
        </h3>
        {forsta &&
          (admin ? (
            <div className="chips">
              {matchning && <span className="badge">bolag: {matchning}</span>}
              {forsta.geografi_relevant && <span className="badge">lokal: {forsta.geografi_relevant}</span>}
              {forsta.sasongseffekt && <span className="badge">säsong: {forsta.sasongseffekt}</span>}
              {forsta.urval && <span className="badge badge-info">{forsta.urval}</span>}
            </div>
          ) : (
            <div className="chips">
              {[lokalText(forsta.lokal), sasongText(forsta.sasong_kod), urvalText(forsta.urval_kod, forsta.lokal, forsta.kall_lan)]
                .filter(Boolean)
                .map((t, i) => (
                  <span key={i} className={`badge${i === 2 ? " badge-info" : ""}`}>
                    {t}
                  </span>
                ))}
            </div>
          ))}
        {lead.text && (
          <p className="hint" style={{ margin: 0 }}>
            Förfrågan {lead.datum}: “{lead.text.length > 160 ? `${lead.text.slice(0, 160)}…` : lead.text}”
          </p>
        )}
      </summary>
      {!vantar &&
        (tvillingar.length ? (
          <div className="result-body table-wrap">
            <table className="twins">
              <thead>
                <tr>
                  <th scope="col">Tvilling</th>
                  <th scope="col">Likhet</th>
                  <th scope="col">Ort</th>
                  <th scope="col">Omsättning</th>
                  <th scope="col">Anställda</th>
                  <th scope="col">Verksamhet</th>
                  {tvillingar.some(harKontakt) && <th scope="col">Kontakt</th>}
                </tr>
              </thead>
              <tbody>
                {tvillingar.map((t) => (
                  <tr key={t.tvilling_org_nr}>
                    <td>
                      <div className="name">{t.tvilling_namn}</div>
                      <div className="hint">{t.tvilling_org_nr}</div>
                    </td>
                    <td>{likhetBadge(t.tvilling_likhet, admin)}</td>
                    <td>
                      {t.tvilling_ort || "–"}
                      {t.tvilling_lan && <div className="hint">{t.tvilling_lan}</div>}
                    </td>
                    <td className="num">{mkr(t.tvilling_oms)}</td>
                    <td className="num">{t.tvilling_anstallda ?? "–"}</td>
                    <td className="desc" title={t.tvilling_verksamhet || ""}>
                      {t.tvilling_verksamhet
                        ? t.tvilling_verksamhet.length > 120
                          ? `${t.tvilling_verksamhet.slice(0, 120)}…`
                          : t.tvilling_verksamhet
                        : "–"}
                    </td>
                    {tvillingar.some(harKontakt) && (
                      <td style={{ fontSize: 13, minWidth: 180 }}>
                        {t.kontakt_namn || t.beslutsfattare}
                        {(t.kontakt_telefon || t.bolag_telefon) && (
                          <div>
                            <a href={`tel:${(t.kontakt_telefon || t.bolag_telefon)!.replace(/[^\d+]/g, "")}`}>{t.kontakt_telefon || t.bolag_telefon}</a>
                          </div>
                        )}
                        {(t.kontakt_mejl || t.bolag_epost) && (
                          <div>
                            <a href={`mailto:${t.kontakt_mejl || t.bolag_epost}`}>{t.kontakt_mejl || t.bolag_epost}</a>
                          </div>
                        )}
                        {t.bolag_webb && (
                          <div>
                            <a href={/^https?:/.test(t.bolag_webb) ? t.bolag_webb : `https://${t.bolag_webb}`} target="_blank" rel="noreferrer">
                              webbplats
                            </a>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            {!forsta ? "Inget resultat." : admin ? forklaring(forsta.status, forsta.urval) : statusText(forsta.status_kod) || forsta.status}
          </p>
        ))}
    </details>
  );
}

export default function Resultat({ admin, korning, leads, onTillbaka, onNy }: Props) {
  const raderPerLead = new Map<number, ResultRow[]>();
  for (const r of korning.rows) {
    const id = r.lead_id ?? -1;
    raderPerLead.set(id, [...(raderPerLead.get(id) || []), r]);
  }
  const antalTvillingar = korning.rows.filter((r) => r.tvilling_namn).length;
  const medTvillingar = leads.filter((l) => (raderPerLead.get(l.id) || []).some((r) => r.tvilling_namn)).length;
  const klar = korning.status !== "kor";

  return (
    <div className="stack">
      <div className="card stack progress-panel">
        {klar ? (
          <>
            <dl className="summary">
              <div>
                <dt>Sökta bolag</dt>
                <dd>{leads.length}</dd>
              </div>
              <div>
                <dt>Med tvillingar</dt>
                <dd>{medTvillingar}</dd>
              </div>
              <div>
                <dt>Tvillingar totalt</dt>
                <dd>{antalTvillingar}</dd>
              </div>
              {admin && (
              <div>
                <dt>tic.io-anrop</dt>
                <dd>
                  {korning.ticAnrop}
                  {korning.ticCache > 0 && (
                    <span className="hint" style={{ fontWeight: 400 }}>
                      {" "}
                      +{korning.ticCache} sparade
                    </span>
                  )}
                </dd>
              </div>
              )}
            </dl>
            {korning.fel && (
              <p className="alert" role="alert">
                Körningen avbröts: {korning.fel}
              </p>
            )}
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <div className="row" style={{ alignItems: "center" }}>
                <button type="button" className="btn" onClick={onTillbaka}>
                  ← Tillbaka till granskningen
                </button>
                <button type="button" className="btn-link" onClick={onNy}>
                  Ny sökning
                </button>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                aria-disabled={!korning.rows.length}
                onClick={() =>
                  korning.rows.length && laddaNerCsv(korning.rows, `tvillingar-${new Date().toISOString().slice(0, 10)}.csv`, admin)
                }
              >
                Ladda ner resultatet (CSV)
              </button>
            </div>
          </>
        ) : (
          <>
            <div aria-live="polite">
              <strong style={{ color: "var(--ink)" }}>
                <span className="spinner" aria-hidden="true" /> Söker tvillingar för {korning.aktuellt || "…"} (
                {Math.min(korning.index + 1, korning.totalt || leads.length)} av {korning.totalt || leads.length})
              </strong>
            </div>
            <progress
              value={korning.index}
              max={korning.totalt || leads.length}
              aria-label="Förlopp för tvillingsökningen"
            />
            <p className="hint">
              {admin
                ? "Varje bolag tar några sekunder: bolagsdataapi först, tic.io bara vid behov, och Jev bedömer varje kandidat."
                : "Det tar några sekunder per bolag."}{" "}
              Resultaten dyker upp nedan allteftersom.
            </p>
          </>
        )}
      </div>

      {leads.map((l, i) => (
        <LeadKort
          key={l.id}
          lead={l}
          rows={raderPerLead.get(l.id) || []}
          vantar={!raderPerLead.has(l.id) && !klar}
          aktiv={!klar && i === korning.index}
          admin={admin}
        />
      ))}
    </div>
  );
}

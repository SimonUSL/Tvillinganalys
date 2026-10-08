"use client";

import { useEffect, useMemo, useState } from "react";
import type { Korning, Sammanfattning } from "@/lib/historik";
import { LeadKort } from "./Resultat";
import Sidhuvud from "./Sidhuvud";
import { laddaNerCsv } from "./typer";
import { KALLA_TEXT, kortDatum } from "./klartext";

const tid = (iso: string) =>
  `${kortDatum(iso)} ${new Date(iso).getFullYear() !== new Date().getFullYear() ? new Date(iso).getFullYear() + " " : ""}${new Date(
    iso
  ).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;

// Alla körningar de senaste 12 månaderna: automatiska, i verktyget och från Granska.
export default function Historik({ admin = false }: { admin?: boolean }) {
  const [lista, setLista] = useState<Sammanfattning[] | null>(null);
  const [fel, setFel] = useState<string | null>(null);
  const [sok, setSok] = useState("");
  const [kalla, setKalla] = useState("");
  const [baraTvillingar, setBaraTvillingar] = useState(true);
  const [vald, setVald] = useState<Korning | null>(null);
  const [laddar, setLaddar] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/historik")
      .then((r) => r.json())
      .then((d) => setLista(d.korningar || []))
      .catch((e) => setFel(String(e?.message || e)));
  }, []);

  const filtrerad = useMemo(() => {
    const q = sok.trim().toLowerCase();
    return (lista || []).filter(
      (k) =>
        (!kalla || k.kalla === kalla) &&
        (!baraTvillingar || k.antal_tvillingar > 0) &&
        (!q || [k.bolag, k.org_nr, k.avsandare].some((v) => (v || "").toLowerCase().includes(q)))
    );
  }, [lista, sok, kalla, baraTvillingar]);

  async function oppna(id: string) {
    setLaddar(id);
    setFel(null);
    try {
      const resp = await fetch(`/api/historik?id=${encodeURIComponent(id)}`);
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.error || `Servern svarade ${resp.status}`);
      setVald(d.korning);
      window.scrollTo({ top: 0 });
    } catch (e: any) {
      setFel(e.message || String(e));
    } finally {
      setLaddar(null);
    }
  }

  return (
    <>
      <Sidhuvud admin={admin} vy="historik" />
      <main className="app-main">
        <div className="title-row">
          <div>
            <h1>{vald ? vald.bolag : "Historik"}</h1>
            <p className="lead-text">
              {vald
                ? `${KALLA_TEXT[vald.kalla]} ${tid(vald.skapad)}`
                : "Alla tvillingsökningar de senaste 12 månaderna, både automatiska och de som körts i verktyget."}
            </p>
          </div>
        </div>

        {fel && (
          <p className="alert" role="alert" style={{ marginBottom: 16 }}>
            {fel}
          </p>
        )}

        {vald ? (
          <div className="stack">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <button type="button" className="btn" onClick={() => setVald(null)}>
                ← Tillbaka till historiken
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => laddaNerCsv(vald.rows, `tvillingar-${vald.bolag.toLowerCase().replace(/[^a-z0-9åäö]+/g, "-")}-${vald.skapad.slice(0, 10)}.csv`, admin)}
              >
                Ladda ner (CSV)
              </button>
            </div>
            <LeadKort
              lead={{
                id: 0,
                grupp: "valda",
                vald: true,
                namn: vald.bolag,
                org: vald.org_nr || "",
                datum: vald.rows[0]?.forfragan_datum,
                text: vald.rows[0]?.forfragan_text,
              }}
              rows={vald.rows}
              vantar={false}
              aktiv={false}
              admin={admin}
            />
            {vald.avsandare && <p className="hint">Avsändare: {vald.avsandare}</p>}
          </div>
        ) : (
          <div className="stack">
            <div className="card row" style={{ alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
              <label className="field" style={{ flex: "1 1 240px" }}>
                <span className="field-label">Sök</span>
                <input type="search" value={sok} onChange={(e) => setSok(e.target.value)} placeholder="Bolag, org.nr eller avsändare" />
              </label>
              <label className="field">
                <span className="field-label">Källa</span>
                <select value={kalla} onChange={(e) => setKalla(e.target.value)}>
                  <option value="">Alla</option>
                  {Object.entries(KALLA_TEXT).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row" style={{ alignItems: "center", gap: 8, paddingBottom: 10 }}>
                <input type="checkbox" checked={baraTvillingar} onChange={(e) => setBaraTvillingar(e.target.checked)} />
                Bara med tvillingar
              </label>
            </div>

            {lista === null ? (
              <p className="hint">
                <span className="spinner" aria-hidden="true" /> Hämtar historiken…
              </p>
            ) : !filtrerad.length ? (
              <p className="empty-state">{lista.length ? "Inga körningar matchar filtret." : "Inga körningar sparade än."}</p>
            ) : (
              <div className="card table-wrap" style={{ padding: 0 }}>
                <table className="twins">
                  <thead>
                    <tr>
                      <th scope="col">Datum</th>
                      <th scope="col">Bolag</th>
                      <th scope="col">Avsändare</th>
                      <th scope="col">Källa</th>
                      <th scope="col" className="num">
                        Tvillingar
                      </th>
                      <th scope="col">
                        <span className="visually-hidden">Öppna</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtrerad.map((k) => (
                      <tr key={k.id}>
                        <td style={{ whiteSpace: "nowrap" }}>{tid(k.skapad)}</td>
                        <td>
                          <div className="name">{k.bolag}</div>
                          {k.org_nr && <div className="hint">{k.org_nr}</div>}
                        </td>
                        <td style={{ fontSize: 13 }}>{k.avsandare || "–"}</td>
                        <td>
                          <span className="badge">{KALLA_TEXT[k.kalla]}</span>
                        </td>
                        <td className="num">{k.antal_tvillingar || "–"}</td>
                        <td>
                          <button type="button" className="btn" onClick={() => oppna(k.id)} aria-busy={laddar === k.id}>
                            {laddar === k.id ? "Öppnar…" : "Visa"}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {lista && lista.length > 0 && (
              <p className="hint">
                Visar {filtrerad.length} av {lista.length} körningar. Körningar sparas i 12 månader.
              </p>
            )}
          </div>
        )}
      </main>
    </>
  );
}

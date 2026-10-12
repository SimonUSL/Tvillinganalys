"use client";

import { useEffect, useState } from "react";
import Sidhuvud from "./Sidhuvud";

// Adminvyn: vilka som får mejlen (tvillingar och "Att granska").
export default function Installningar() {
  const [lista, setLista] = useState<string[] | null>(null);
  const [sparad, setSparad] = useState(true);
  const [ny, setNy] = useState("");
  const [fel, setFel] = useState<string | null>(null);
  const [meddelande, setMeddelande] = useState<string | null>(null);
  const [sparar, setSparar] = useState(false);

  useEffect(() => {
    fetch("/api/admin/mottagare")
      .then((r) => r.json())
      .then((d) => {
        setLista(d.lista || []);
        setSparad(!!d.sparad);
      })
      .catch((e) => setFel(String(e?.message || e)));
  }, []);

  async function spara(nyLista: string[]) {
    setFel(null);
    setMeddelande(null);
    setSparar(true);
    try {
      const resp = await fetch("/api/admin/mottagare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lista: nyLista }),
      });
      const d = await resp.json();
      if (!resp.ok) throw new Error(d.error || `Servern svarade ${resp.status}`);
      setLista(d.lista);
      setSparad(true);
      setMeddelande("Sparat. Nästa mejl går till listan nedan.");
    } catch (e: any) {
      setFel(e.message || String(e));
    } finally {
      setSparar(false);
    }
  }

  function laggTill(e: React.FormEvent) {
    e.preventDefault();
    const adress = ny.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adress)) {
      setFel("Skriv en giltig e-postadress.");
      return;
    }
    if (lista?.includes(adress)) {
      setFel("Adressen finns redan i listan.");
      return;
    }
    setNy("");
    spara([...(lista || []), adress]);
  }

  function taBort(adress: string) {
    if (!lista) return;
    if (lista.length === 1) {
      setFel("Minst en mottagare behövs.");
      return;
    }
    spara(lista.filter((a) => a !== adress));
  }

  return (
    <>
      <Sidhuvud admin vy="installningar" />
      <main className="app-main">
        <div className="title-row">
          <div>
            <h1>Inställningar</h1>
            <p className="lead-text">Vilka som får mejlen med tvillingar och mejlen om förfrågningar att granska.</p>
          </div>
        </div>

        {fel && (
          <p className="alert" role="alert" style={{ marginBottom: 16 }}>
            {fel}
          </p>
        )}

        <div className="card stack">
          <h2 style={{ margin: 0, fontSize: 18 }}>Mottagare</h2>
          {lista === null ? (
            <p className="hint">
              <span className="spinner" aria-hidden="true" /> Hämtar…
            </p>
          ) : (
            <>
              {!lista.length ? (
                <p className="empty-state">Inga mottagare än. Lägg till minst en, annars skickas inga mejl.</p>
              ) : (
                <ul className="review-list">
                  {lista.map((a) => (
                    <li key={a} className="row" style={{ justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid #eef0f3" }}>
                      <span>{a}</span>
                      <button type="button" className="btn-link" onClick={() => taBort(a)} disabled={sparar}>
                        Ta bort
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <form className="row" style={{ alignItems: "flex-end", gap: 12, flexWrap: "wrap" }} onSubmit={laggTill}>
                <label className="field" style={{ flex: "1 1 260px" }}>
                  <span className="field-label">Lägg till mottagare</span>
                  <input type="email" value={ny} onChange={(e) => setNy(e.target.value)} placeholder="namn@optimalkommunikation.se" autoComplete="off" />
                </label>
                <button type="submit" className="btn btn-primary" disabled={sparar}>
                  {sparar ? "Sparar…" : "Lägg till"}
                </button>
              </form>
              {meddelande && (
                <p className="hint" role="status">
                  {meddelande}
                </p>
              )}
              {!sparad && lista.length > 0 && (
                <p className="hint">Listan kommer från grundinställningen. När du ändrar den här gäller den nya listan.</p>
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}

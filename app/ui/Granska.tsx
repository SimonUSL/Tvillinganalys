"use client";

import { useState } from "react";
import type { Grupp, Kalla, Rad } from "./typer";

interface Props {
  kalla: Kalla;
  rader: Rad[];
  andra: (id: number, falt: Partial<Rad>) => void;
  maxTic: string;
  setMaxTic: (s: string) => void;
  standardTak: number;
  onTillbaka: () => void;
  onKor: () => void;
}

const GRUPPER: { grupp: Grupp; rubrik: string; hjalp: string }[] = [
  {
    grupp: "valda",
    rubrik: "Föreslås för tvillingsökning",
    hjalp: "Jev hittade bolaget. Kontrollera att det stämmer — ändra namnet eller org.nr om fel bolag valts.",
  },
  {
    grupp: "behover",
    rubrik: "Behöver bolag",
    hjalp: "Nya förfrågningar där Jev inte är säker på vilket bolag som skickat dem. Fyll i bolagsnamn eller org.nr för att ta med dem.",
  },
  {
    grupp: "hoppas",
    rubrik: "Hoppas över",
    hjalp: "Inte nya förfrågningar från organisationer (befintliga kunder, mäklare, privatpersoner, spam m.m.). Bocka i för att ta med ändå.",
  },
];

export const harBolag = (r: Rad) => !!(r.namn.trim() || r.org.trim());

// "Jev 95 %" -> en mening som går att förstå utan förkunskaper.
function kommentarText(k: string): string {
  const m = k.match(/^Jev (\d+ %)$/);
  return m ? `Jev är ${m[1]} säker på att det är rätt bolag.` : k;
}

function Rad({ r, andra, kalla }: { r: Rad; andra: Props["andra"]; kalla: Kalla }) {
  const [oppen, setOppen] = useState(false);
  const saknarBolag = r.vald && !harBolag(r);
  return (
    <li className={`review-item${r.vald ? "" : " av"}`}>
      <input
        type="checkbox"
        checked={r.vald}
        aria-label={`Tvillingsök ${r.namn || r.doman || "denna förfrågan"}`}
        onChange={(e) => andra(r.id, { vald: e.target.checked })}
        style={{ marginTop: 2 }}
      />
      <div>
        {kalla === "export" ? (
          <>
            <div className="meta">
              <span>{r.datum}</span>
              <span>· {r.formular}</span>
              {r.doman && <span>· {r.doman}</span>}
              {r.typ && <span className="badge">{r.typ}</span>}
            </div>
            {r.text && (
              <>
                <p className={`msg${oppen ? " open" : ""}`}>{r.text}</p>
                {r.text.length > 140 && (
                  <button type="button" className="btn-link" aria-expanded={oppen} onClick={() => setOppen(!oppen)}>
                    {oppen ? "Visa mindre" : "Visa hela meddelandet"}
                  </button>
                )}
              </>
            )}
          </>
        ) : (
          <div className="meta">
            {r.geo && <span className="badge">geografi: {r.geo}</span>}
            {r.sasong && <span className="badge">säsong: {r.sasong}</span>}
            {r.strikt && <span className="badge">strikt storlek: {r.strikt}</span>}
            {!r.geo && !r.sasong && <span>Geografi och säsong gissas av Jev.</span>}
          </div>
        )}
      </div>
      <div className="company company-fields">
        <div>
          <label htmlFor={`namn-${r.id}`}>Bolag</label>
          <input
            id={`namn-${r.id}`}
            type="text"
            value={r.namn}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) =>
              // Nytt namn: töm org.nr så att namnet slås upp, och ta med raden.
              andra(r.id, { namn: e.target.value, org: "", vald: e.target.value.trim() ? true : r.vald })
            }
          />
        </div>
        <div>
          <label htmlFor={`org-${r.id}`}>Org.nr</label>
          <input
            id={`org-${r.id}`}
            type="text"
            inputMode="numeric"
            value={r.org}
            autoComplete="off"
            onChange={(e) => andra(r.id, { org: e.target.value, vald: e.target.value.trim() ? true : r.vald })}
          />
        </div>
      </div>
      {(r.kommentar || saknarBolag) && (
        <p className={`note${saknarBolag ? " warn" : ""}`}>
          {saknarBolag ? "Fyll i bolagsnamn eller org.nr, annars hoppas raden över." : kommentarText(r.kommentar!)}
        </p>
      )}
      {r.forslag && !harBolag(r) && (
        <p className="note">
          <button
            type="button"
            className="btn"
            style={{ minHeight: 36, padding: "4px 12px", fontSize: 13 }}
            onClick={() => andra(r.id, { namn: r.forslag!.namn, org: r.forslag!.org_nr, vald: true })}
          >
            Använd förslaget: {r.forslag.namn}
          </button>
        </p>
      )}
    </li>
  );
}

export default function Granska(p: Props) {
  const valda = p.rader.filter((r) => r.vald && harBolag(r));
  const antal = (g: Grupp) => p.rader.filter((r) => r.grupp === g).length;

  return (
    <div>
      <div className="card">
        <dl className="summary">
          <div>
            <dt>{p.kalla === "export" ? "Förfrågningar" : "Bolag i listan"}</dt>
            <dd>{p.rader.length}</dd>
          </div>
          <div>
            <dt>Valda för sökning</dt>
            <dd>{valda.length}</dd>
          </div>
          {p.kalla === "export" && (
            <>
              <div>
                <dt>Behöver bolag</dt>
                <dd>{antal("behover")}</dd>
              </div>
              <div>
                <dt>Hoppas över</dt>
                <dd>{antal("hoppas")}</dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {GRUPPER.filter((g) => antal(g.grupp) > 0).map((g) => {
        const rader = p.rader.filter((r) => r.grupp === g.grupp);
        const innehall = (
          <>
            <p className="hint" style={{ marginBottom: 10 }}>
              {p.kalla === "csv" && g.grupp === "valda"
                ? "Bolagen i din lista. Rätta namnet eller lägg till org.nr om ett bolag har många namnlika träffar — bolaget slås upp när sökningen körs."
                : g.hjalp}
            </p>
            <ul className="review-list">
              {rader.map((r) => (
                <Rad key={r.id} r={r} andra={p.andra} kalla={p.kalla} />
              ))}
            </ul>
          </>
        );
        const rubrik = (
          <h2>
            {p.kalla === "csv" && g.grupp === "valda" ? "Bolag att tvillingsöka" : g.rubrik}{" "}
            <span className="badge">{rader.length}</span>
          </h2>
        );
        return g.grupp === "hoppas" ? (
          <details key={g.grupp} className="group">
            <summary className="group-head">{rubrik}</summary>
            {innehall}
          </details>
        ) : (
          <section key={g.grupp} aria-label={g.rubrik}>
            <div className="group-head">{rubrik}</div>
            {innehall}
          </section>
        );
      })}

      <div className="action-bar">
        <button type="button" className="btn" onClick={p.onTillbaka}>
          ← Tillbaka
        </button>
        <div className="budget">
          <label htmlFor="maxtic">Max tic.io-anrop</label>
          <input
            id="maxtic"
            type="text"
            inputMode="numeric"
            value={p.maxTic}
            placeholder={String(p.standardTak)}
            aria-describedby="maxtic-hjalp"
            onChange={(e) => p.setMaxTic(e.target.value.replace(/\D/g, ""))}
          />
          <span className="hint" id="maxtic-hjalp" style={{ maxWidth: 300 }}>
            Lokala branscher klaras oftast med bolagsdataapi (0 anrop). Sparade sökningar kostar inget.
          </span>
        </div>
        <button type="button" className="btn btn-primary" aria-disabled={!valda.length} onClick={() => valda.length && p.onKor()}>
          Hitta tvillingar för {valda.length} bolag →
        </button>
      </div>
    </div>
  );
}

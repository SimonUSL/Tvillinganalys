"use client";

import { useState } from "react";
import type { Grupp, Kalla, Rad } from "./typer";
import type { Kvot } from "@/lib/kvot";
import { kortDatum } from "./klartext";
import { forfraganEtikett, hoppaText, matchningText, sasongText } from "./klartext";

interface Props {
  admin: boolean;
  kalla: Kalla;
  rader: Rad[];
  andra: (id: number, falt: Partial<Rad>) => void;
  maxTic: string;
  setMaxTic: (s: string) => void;
  standardTak: number;
  kvot: Kvot | null; // sökningar kvar i det betalda registret (tic.io)
  bdKvot: Kvot | null; // anrop kvar i dag i det fria registret (bolagsdataapi)
  onTillbaka: () => void;
  onKor: () => void;
  onTaBort?: (r: Rad) => void; // granskningskön: ta bort posten
}

const GRUPPER: { grupp: Grupp; rubrik: string; hjalp: string }[] = [
  {
    grupp: "valda",
    rubrik: "Föreslås för tvillingsökning",
    hjalp: "Bolaget är identifierat. Kontrollera att det stämmer — ändra namnet eller org.nr om fel bolag valts.",
  },
  {
    grupp: "behover",
    rubrik: "Behöver bolag",
    hjalp: "Nya förfrågningar där vi inte kunde avgöra vilket bolag som skickat dem. Fyll i bolagsnamn eller org.nr för att ta med dem.",
  },
  {
    grupp: "hoppas",
    rubrik: "Hoppas över",
    hjalp: "Befintliga kunder, mäklare, privatpersoner, säljförsök och otydliga förfrågningar. Bocka i för att ta med ändå.",
  },
];

export const harBolag = (r: Rad) => !!(r.namn.trim() || r.org.trim());

// "Jev 95 %" -> en mening som går att förstå utan förkunskaper.
function kommentarText(k: string): string {
  const m = k.match(/^Jev (\d+ %)$/);
  return m ? `Jev är ${m[1]} säker på att det är rätt bolag.` : k;
}

function Rad({ r, andra, kalla, admin, onTaBort }: { r: Rad; andra: Props["andra"]; kalla: Kalla; admin: boolean; onTaBort?: Props["onTaBort"] }) {
  const [oppen, setOppen] = useState(false);
  const saknarBolag = r.vald && !harBolag(r);
  // Kunden ser klartext, adminvyn den tekniska kommentaren (Jevs säkerhet m.m.).
  const kommentar = r.orsak
    ? r.orsak
    : admin
    ? r.kommentar && kommentarText(r.kommentar)
    : r.grupp === "hoppas"
      ? hoppaText(r.hoppa_kod)
      : matchningText(r.matchning_kod);
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
              {(r.typ || r.typ_kod) && <span className="badge">{admin ? r.typ : forfraganEtikett(r.typ_kod, r.avsandare_kod)}</span>}
            </div>
            {r.avsandare && <p className="msg" style={{ fontWeight: 600 }}>{r.avsandare}</p>}
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
            {r.kommun && <span className="badge badge-info">Kommun: {r.kommun}</span>}
            {r.geo && !r.kommun && <span className="badge">{r.geo === "ja" ? "Lokalt bolag" : "Rikstäckande"}</span>}
            {r.sasong && <span className="badge">{sasongText(r.sasong === "ingen" ? null : r.sasong) || "Ingen säsong"}</span>}
            {r.strikt && <span className="badge">Samma storlek</span>}
            {!r.geo && !r.sasong && !r.kommun && <span>Geografi och säsong fylls i automatiskt.</span>}
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
      {(kommentar || saknarBolag) && (
        <p className={`note${saknarBolag ? " warn" : ""}`}>
          {saknarBolag ? "Fyll i bolagsnamn eller org.nr, annars hoppas raden över." : kommentar}
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
            Är det {r.forslag.namn}? Använd
          </button>
        </p>
      )}
      {onTaBort && r.koId && (
        <p className="note">
          <button type="button" className="btn-link" onClick={() => onTaBort(r)}>
            Ta bort ur granskningen
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
              {antal("hoppas") > 0 && (
                <div>
                  <dt>Hoppas över</dt>
                  <dd>{antal("hoppas")}</dd>
                </div>
              )}
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
                <Rad key={r.id} r={r} andra={p.andra} kalla={p.kalla} admin={p.admin} onTaBort={p.onTaBort} />
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

      <KvotRad admin={p.admin} tak={p.maxTic.trim() !== "" ? Number(p.maxTic) : p.standardTak} kvot={p.kvot} bdKvot={p.bdKvot} antal={valda.length} />

      <div className="action-bar">
        <button type="button" className="btn" onClick={p.onTillbaka}>
          ← Tillbaka
        </button>
        {p.admin && (
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
        )}
        <button type="button" className="btn btn-primary" aria-disabled={!valda.length} onClick={() => valda.length && p.onKor()}>
          Hitta tvillingar för {valda.length} bolag →
        </button>
      </div>
    </div>
  );
}

// Hur många sökningar i det betalda registret körningen kan använda, mot hur många som finns kvar.
export const kvotGaller = (k: Kvot | null) => !!k && (!k.aterstalls || new Date(k.aterstalls).getTime() > Date.now());

// Måste stämma med BD_PER_BOLAG och BD_RESERV i lib/kvot.ts.
const BD_PER_BOLAG = 25;
const BD_RESERV = 150;

function KvotRad({ admin, tak, kvot, bdKvot, antal }: { admin: boolean; tak: number; kvot: Kvot | null; bdKvot: Kvot | null; antal: number }) {
  if (!antal) return null;
  // Fria registret: efter midnatt är dygnskvoten full igen.
  const bdKvar = bdKvot ? (kvotGaller(bdKvot) ? bdKvot.kvar : bdKvot.grans ?? null) : null;
  const bdBehov = antal * BD_PER_BOLAG;
  const bdRacker = bdKvar === null ? antal : Math.max(0, Math.floor((bdKvar - BD_RESERV) / BD_PER_BOLAG));
  const fritt = admin ? "bolagsdataapi" : "det fria registret";
  const register = admin ? "tic.io" : "det betalda registret";
  const kand = kvotGaller(kvot) ? kvot! : null;
  const tid = (iso: string) => `${kortDatum(iso)} ${new Date(iso).toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" })}`;
  const forManga = !!kand && tak > kand.kvar;
  return (
    <div className={`note${forManga || bdRacker < antal ? " warn" : ""}`} style={{ marginTop: 16 }} role="status">
      <p style={{ margin: 0 }}>
        Listan använder <strong>högst {tak} sökningar</strong> i {register}
        {kand ? (
          <>
            {" "}av <strong>{kand.kvar} kvar</strong>
            {kand.grans ? ` (av ${kand.grans})` : ""}
            {kand.aterstalls ? `, fylls på ${kortDatum(kand.aterstalls)}` : ""}.
          </>
        ) : (
          "."
        )}{" "}
        Bolag och branscher som redan sökts kostar inget, så det blir oftast färre.
      </p>
      {forManga && (
        <p style={{ margin: "6px 0 0" }}>
          Det är fler än som finns kvar. Körningen stannar vid {kand!.kvar}; bolagen efter det får tvillingar bara från det fria registret, vilket ofta räcker för lokala bolag.
        </p>
      )}
      <p style={{ margin: "10px 0 0" }}>
        Den använder också upp till cirka <strong>{bdBehov} anrop</strong> i {fritt}
        {bdKvar !== null ? (
          <>
            {" "}av <strong>{bdKvar} kvar i dag</strong> (fylls på vid midnatt)
          </>
        ) : null}
        . {BD_RESERV} anrop om dagen sparas åt förfrågningarna från webbplatsen.
      </p>
      {bdRacker < antal && (
        <p style={{ margin: "6px 0 0" }}>
          <strong>
            Det räcker till cirka {bdRacker} av {antal} bolag i dag.
          </strong>{" "}
          Resten markeras "Kör igen i morgon" och söks inte, varken här eller i det betalda registret. Bolag som redan sökts tidigare kostar inget och går oftast igenom ändå.
        </p>
      )}
      <p className="hint" style={{ margin: "6px 0 0" }}>
        {kand ? `Kvar uppdaterades ${tid(kand.uppdaterad)}.` : "Hur många som är kvar i det betalda registret visas efter nästa sökning där."}
      </p>
    </div>
  );
}

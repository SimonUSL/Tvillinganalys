"use client";

import { useState } from "react";
import type { Forhandsrad } from "./api/preview/route";
import type { Handelse } from "./api/run/route";
import { parseCsv } from "@/lib/csv";
import Underlag, { CSV_EXEMPEL, isoDag } from "./ui/Underlag";
import Granska, { harBolag } from "./ui/Granska";
import Resultat from "./ui/Resultat";
import type { Kalla, Korning, Rad, Steg } from "./ui/typer";

const LOGO_SRC =
  "https://cdn.prod.website-files.com/5dd4488fdda3ce628d8173ce/5ddfe48c64e4a62b7bd48be9_optimal_kommunikation_logo.svg";

const STEG: { id: Steg; text: string }[] = [
  { id: "underlag", text: "Underlag" },
  { id: "granska", text: "Granska" },
  { id: "resultat", text: "Tvillingar" },
];

export default function Home() {
  const [steg, setSteg] = useState<Steg>("underlag");
  const [kalla, setKalla] = useState<Kalla>("export");
  const [filer, setFiler] = useState<{ name: string; text: string }[]>([]);
  const [fran, setFran] = useState(() => isoDag(new Date(Date.now() - 7 * 24 * 3600 * 1000)));
  const [till, setTill] = useState(() => isoDag(new Date()));
  const [csv, setCsv] = useState(CSV_EXEMPEL);
  const [rader, setRader] = useState<Rad[]>([]);
  const [maxTic, setMaxTic] = useState("");
  const [korning, setKorning] = useState<Korning | null>(null);
  const [korda, setKorda] = useState<Rad[]>([]);
  const [laddar, setLaddar] = useState(false);
  const [fel, setFel] = useState<string | null>(null);

  const valda = rader.filter((r) => r.vald && harBolag(r));
  // Förval för taket: 3 tic.io-anrop per bolag (nyckeln har 200/mån).
  const standardTak = 3 * valda.length;

  function andra(id: number, falt: Partial<Rad>) {
    setRader((rs) => rs.map((r) => (r.id === id ? { ...r, ...falt } : r)));
  }

  async function tillGranskning() {
    setFel(null);
    if (kalla === "csv") {
      const leads = parseCsv(csv);
      if (!leads.length || !("foretagsnamn" in leads[0])) {
        setFel("CSV:n behöver en rubrikrad med kolumnen foretagsnamn.");
        return;
      }
      setRader(
        leads
          .filter((l) => (l.foretagsnamn || "").trim() || (l.org_nr || "").trim())
          .map((l, id) => ({
            id,
            grupp: "valda",
            vald: true,
            namn: (l.foretagsnamn || "").trim(),
            org: (l.org_nr || l.orgnr || l.organisationsnummer || "").trim(),
            geo: (l.geografi_relevant || "").trim(),
            sasong: (l.sasongseffekt || "").trim(),
            strikt: (l.storlek_strikt || "").trim(),
          }))
      );
      setSteg("granska");
      return;
    }
    setLaddar(true);
    try {
      const resp = await fetch("/api/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ exports: filer, from: fran, to: till }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Förhandsgranskningen misslyckades.");
      setRader(
        (data.rader as Forhandsrad[]).map((r) => ({
          id: r.id,
          grupp: r.hoppa ? "hoppas" : r.bolag_org_nr ? "valda" : "behover",
          vald: !r.hoppa && !!r.bolag_org_nr,
          namn: r.bolag_namn || "",
          org: r.bolag_org_nr || "",
          datum: r.datum,
          formular: r.formular,
          doman: r.doman,
          typ: r.typ,
          text: r.text,
          kommentar: r.hoppa || r.matchning,
          forslag: r.forslag ?? undefined,
        }))
      );
      setSteg("granska");
    } catch (e: any) {
      setFel(e.message || String(e));
    } finally {
      setLaddar(false);
    }
  }

  async function kor() {
    const leads = valda;
    setKorda(leads);
    setKorning({ status: "kor", index: 0, totalt: leads.length, aktuellt: "", rows: [], ticAnrop: 0, ticCache: 0 });
    setSteg("resultat");
    window.scrollTo({ top: 0 });
    try {
      const resp = await fetch("/api/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stream: true,
          max_tic_anrop: maxTic.trim() === "" ? standardTak : Number(maxTic),
          leads: leads.map((r) => ({
            namn: r.namn.trim(),
            org_nr: r.org.trim(),
            geo: r.geo,
            sasong: r.sasong,
            strikt: r.strikt,
            extra: {
              lead_id: r.id,
              ...(kalla === "export"
                ? {
                    forfragan_datum: r.datum,
                    forfragan_formular: r.formular,
                    forfragan_doman: r.doman,
                    forfragan_typ: r.typ,
                    forfragan_text: r.text,
                  }
                : {}),
            },
          })),
        }),
      });
      if (!resp.ok || !resp.body) {
        const data = await resp.json().catch(() => ({}));
        throw new Error(data.error || `Servern svarade ${resp.status}`);
      }
      // NDJSON: en händelse per rad.
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buffert = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffert += dec.decode(value, { stream: true });
        const delar = buffert.split("\n");
        buffert = delar.pop() || "";
        for (const del of delar) {
          if (!del.trim()) continue;
          const h = JSON.parse(del) as Handelse;
          setKorning((k) => {
            if (!k) return k;
            if (h.typ === "lead") return { ...k, index: h.index, totalt: h.totalt, aktuellt: h.namn };
            if (h.typ === "rader") return { ...k, rows: [...k.rows, ...h.rows] };
            if (h.typ === "klar") return { ...k, status: "klar", index: k.totalt, ticAnrop: h.tic_anrop, ticCache: h.tic_fran_cache };
            return { ...k, status: "fel", fel: h.error };
          });
        }
      }
      // Avbröts strömmen utan "klar" (t.ex. tidsgräns) visas det som fel.
      setKorning((k) => (k && k.status === "kor" ? { ...k, status: "fel", fel: "anslutningen bröts innan körningen var klar" } : k));
    } catch (e: any) {
      setKorning((k) => (k ? { ...k, status: "fel", fel: e.message || String(e) } : k));
    }
  }

  function nySokning() {
    setRader([]);
    setKorning(null);
    setMaxTic("");
    setSteg("underlag");
  }

  async function loggaUt() {
    await fetch("/api/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const stegIndex = STEG.findIndex((s) => s.id === steg);
  const rubrik =
    steg === "underlag"
      ? ["Hitta tvillingbolag", "Välj underlag. Du granskar listan innan något söks, och kan ändra vilka bolag som tas med."]
      : steg === "granska"
        ? [
            kalla === "export" ? "Granska förfrågningarna" : "Granska listan",
            "Kontrollera bolagen och välj vilka som ska tvillingsökas. Inget har sökts än.",
          ]
        : korning?.status === "kor"
          ? ["Söker tvillingar…", "Låt sidan vara öppen tills sökningen är klar."]
          : ["Tvillingar", "Klicka på ett bolag för att visa eller dölja dess tvillingar. Ladda ner allt som CSV."];

  return (
    <>
      <header className="app-header">
        <img src={LOGO_SRC} alt="Optimal Kommunikation" />
        <button type="button" className="btn-link" onClick={loggaUt}>
          Logga ut
        </button>
      </header>
      <main className="app-main">
        <nav aria-label="Steg">
          <ol className="stepper">
            {STEG.map((s, i) => (
              <li key={s.id} aria-current={s.id === steg ? "step" : undefined} className={i < stegIndex ? "klar" : undefined}>
                <span>{s.text}</span>
              </li>
            ))}
          </ol>
        </nav>
        <div className="title-row">
          <div>
            <h1>{rubrik[0]}</h1>
            <p className="lead-text">{rubrik[1]}</p>
          </div>
        </div>

        {fel && (
          <p className="alert" role="alert" style={{ marginBottom: 16 }}>
            {fel}
          </p>
        )}

        {steg === "underlag" && (
          <Underlag
            kalla={kalla}
            setKalla={setKalla}
            filer={filer}
            setFiler={setFiler}
            fran={fran}
            setFran={setFran}
            till={till}
            setTill={setTill}
            csv={csv}
            setCsv={setCsv}
            laddar={laddar}
            onNasta={tillGranskning}
          />
        )}
        {steg === "granska" && (
          <Granska
            kalla={kalla}
            rader={rader}
            andra={andra}
            maxTic={maxTic}
            setMaxTic={setMaxTic}
            standardTak={standardTak}
            onTillbaka={() => setSteg("underlag")}
            onKor={kor}
          />
        )}
        {steg === "resultat" && korning && (
          <Resultat korning={korning} leads={korda} onTillbaka={() => setSteg("granska")} onNy={nySokning} />
        )}
      </main>
    </>
  );
}

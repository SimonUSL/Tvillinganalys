"use client";

import { useEffect, useState } from "react";
import type { GranskaPost } from "@/lib/granskning";
import type { Handelse } from "../api/run/route";
import Underlag, { type Lista } from "./Underlag";
import Granska, { harBolag, kvotGaller } from "./Granska";
import type { Kvot } from "@/lib/kvot";
import Resultat from "./Resultat";
import Sidhuvud from "./Sidhuvud";
import type { Kalla, Korning, Rad, Steg } from "./typer";
import { GRANSKA_ORSAK, forfraganEtikett } from "./klartext";

const STEG: { id: Steg; text: string }[] = [
  { id: "underlag", text: "Underlag" },
  { id: "granska", text: "Granska" },
  { id: "resultat", text: "Tvillingar" },
];

// Samma app för kunden (/) och teamet (/admin). Adminvyn visar dessutom de
// tekniska detaljerna: Jevs säkerhet, hur urvalet gjordes, tic.io-taket och -anrop.
// ko: granskningskön (/granska) - automatiska förfrågningar som behöver en människa.
export default function App({ admin = false, ko = false }: { admin?: boolean; ko?: boolean }) {
  const [steg, setSteg] = useState<Steg>(ko ? "granska" : "underlag");
  const [koLaddad, setKoLaddad] = useState(!ko);
  // Granskningskön har förfrågningar; verktyget en uppladdad leadlista.
  const kalla: Kalla = ko ? "export" : "csv";
  const [lista, setLista] = useState<Lista | null>(null);
  const [kvot, setKvot] = useState<Kvot | null>(null);
  const [bdKvot, setBdKvot] = useState<Kvot | null>(null);
  const hamtaKvot = () =>
    fetch("/api/kvot")
      .then((r) => r.json())
      .then((d) => {
        setKvot(d.kvot || null);
        setBdKvot(d.bolagsdata || null);
      })
      .catch(() => {});
  useEffect(() => {
    hamtaKvot();
  }, []);
  const [rader, setRader] = useState<Rad[]>([]);
  const [maxTic, setMaxTic] = useState("");
  const [korning, setKorning] = useState<Korning | null>(null);
  const [korda, setKorda] = useState<Rad[]>([]);
  const [fel, setFel] = useState<string | null>(null);

  const valda = rader.filter((r) => r.vald && harBolag(r));
  // Förval för taket: 3 tic.io-anrop per bolag (nyckeln har 200/mån).
  const standardTak = 3 * valda.length;

  function andra(id: number, falt: Partial<Rad>) {
    setRader((rs) => rs.map((r) => (r.id === id ? { ...r, ...falt } : r)));
  }

  function tillGranskning() {
    if (!lista) return;
    setFel(null);
    setRader(
      lista.leads.map((l, id) => ({
        id,
        grupp: "valda",
        vald: true,
        namn: l.namn,
        org: l.org,
        geo: l.geo,
        sasong: l.sasong,
        strikt: l.strikt,
        kommun: l.kommun,
      }))
    );
    setSteg("granska");
  }

  // Granskningskön: hämta posterna.
  useEffect(() => {
    if (!ko) return;
    fetch("/api/granska")
      .then((r) => r.json())
      .then((d) => {
        setRader(
          ((d.poster || []) as GranskaPost[]).map((p, id) => ({
            id,
            koId: p.id,
            grupp: p.bolag ? "valda" : "behover",
            vald: !!p.bolag,
            namn: p.bolag?.namn || "",
            org: p.bolag?.org_nr || "",
            datum: p.datum.slice(0, 16).replace("T", " "),
            formular: p.formular,
            doman: p.doman,
            typ: forfraganEtikett(p.typ_kod, p.avsandare_kod),
            typ_kod: p.typ_kod,
            avsandare_kod: p.avsandare_kod,
            text: p.text,
            orsak: GRANSKA_ORSAK[p.orsak_kod],
            avsandare: [p.namn, p.epost, p.telefon].filter(Boolean).join(" · "),
            avsandare_falt: { namn: p.namn, epost: p.epost, telefon: p.telefon },
            forslag: p.forslag ?? undefined,
          }))
        );
      })
      .catch((e) => setFel(String(e?.message || e)))
      .finally(() => setKoLaddad(true));
  }, [ko]);

  async function taBortUrKo(r: Rad) {
    if (!r.koId) return;
    await fetch("/api/granska", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: [r.koId] }) });
    setRader((rs) => rs.filter((x) => x.id !== r.id));
  }

  async function kor() {
    const leads = valda;
    const allaRader: Handelse[] = [];
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
          // Från granskningskön: resultatet mejlas till säljarna som de automatiska.
          kalla: ko ? "granska" : "verktyg",
          // Kunden ser inte taket; standardtaket gäller då alltid.
          // Aldrig fler än som finns kvar hos tic.io (sparade svar kostar inget).
          max_tic_anrop: Math.min(admin && maxTic.trim() !== "" ? Number(maxTic) : standardTak, kvotGaller(kvot) ? kvot!.kvar : Infinity),
          leads: leads.map((r) => ({
            namn: r.namn.trim(),
            org_nr: r.org.trim(),
            geo: r.geo,
            sasong: r.sasong,
            strikt: r.strikt,
            kommun: r.kommun,
            extra: {
              lead_id: r.id,
              ...(kalla === "export"
                ? {
                    forfragan_datum: r.datum,
                    forfragan_formular: r.formular,
                    forfragan_doman: r.doman,
                    forfragan_typ: admin ? r.typ : forfraganEtikett(r.typ_kod, r.avsandare_kod),
                    forfragan_text: r.text,
                    forfragan_namn: r.avsandare_falt?.namn || null,
                    forfragan_epost: r.avsandare_falt?.epost || null,
                    forfragan_telefon: r.avsandare_falt?.telefon || null,
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
          allaRader.push(h);
          setKorning((k) => {
            if (!k) return k;
            if (h.typ === "lead") return { ...k, index: h.index, totalt: h.totalt, aktuellt: h.namn };
            if (h.typ === "rader") return { ...k, rows: [...k.rows, ...h.rows] };
            if (h.typ === "klar") return { ...k, status: "klar", index: k.totalt, ticAnrop: h.tic_anrop, ticCache: h.tic_fran_cache };
            return { ...k, status: "fel", fel: h.error };
          });
        }
      }
      hamtaKvot();
      // Avbröts strömmen utan "klar" (t.ex. tidsgräns) visas det som fel.
      setKorning((k) => (k && k.status === "kor" ? { ...k, status: "fel", fel: "anslutningen bröts innan körningen var klar" } : k));
      // Granskningskön: leads som fick tvillingar är hanterade och tas bort ur kön.
      if (ko) {
        const medTvillingar = new Set(
          allaRader.flatMap((h) => (h.typ === "rader" ? h.rows.filter((r) => r.tvilling_namn).map((r) => r.lead_id) : []))
        );
        const ids = leads.filter((l) => medTvillingar.has(l.id) && l.koId).map((l) => l.koId!);
        if (ids.length) {
          await fetch("/api/granska", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
          setRader((rs) => rs.filter((r) => !r.koId || !ids.includes(r.koId)));
        }
      }
    } catch (e: any) {
      setKorning((k) => (k ? { ...k, status: "fel", fel: e.message || String(e) } : k));
    }
  }

  function nySokning() {
    if (ko) {
      window.location.href = admin ? "/admin" : "/";
      return;
    }
    setRader([]);
    setKorning(null);
    setMaxTic("");
    setSteg("underlag");
  }


  const stegLista = ko ? STEG.filter((s) => s.id !== "underlag") : STEG;
  const stegIndex = stegLista.findIndex((s) => s.id === steg);
  const rubrik =
    ko && steg === "granska"
      ? rader.length || !koLaddad
        ? ["Leads att granska", "Förfrågningar som kom in automatiskt men behöver din hjälp: fyll i eller rätta bolaget och ta fram tvillingarna."]
        : ["Inget att granska", "Alla automatiska förfrågningar är hanterade."]
      : steg === "underlag"
      ? ["Hitta tvillingbolag", "Ladda upp en leadlista. Du granskar listan innan något söks, och kan ändra vilka bolag som tas med."]
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
      <Sidhuvud admin={admin} vy={ko ? "granska" : "verktyg"} />
      <main className="app-main">
        <nav aria-label="Steg">
          <ol className="stepper">
            {stegLista.map((s, i) => (
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
          <Underlag lista={lista} setLista={setLista} onNasta={tillGranskning} />
        )}
        {steg === "granska" && (
          <Granska
            admin={admin}
            kalla={kalla}
            rader={rader}
            andra={andra}
            maxTic={maxTic}
            setMaxTic={setMaxTic}
            standardTak={standardTak}
            kvot={kvot}
            bdKvot={bdKvot}
            onTillbaka={() => (ko ? (window.location.href = admin ? "/admin" : "/") : setSteg("underlag"))}
            onTaBort={ko ? taBortUrKo : undefined}
            onKor={kor}
          />
        )}
        {steg === "resultat" && korning && (
          <Resultat admin={admin} korning={korning} leads={korda} onTillbaka={() => setSteg("granska")} onNy={nySokning} />
        )}
      </main>
    </>
  );
}

// automatik.ts — en ny förfrågan från Webflow hanteras helt automatiskt:
// klassning, bolag, tvillingar och ett mejl till säljarna (MAIL_TO).
//
// - Inte värd att söka på (befintlig kund, mäklare, spam, privatperson ...):
//   inget mejl, bara en loggrad.
// - Osäkert bolag, inga tvillingar eller fel: förfrågan läggs i granskningskön
//   (/granska i verktyget) och mejlet säger varför, med en knapp dit.
// - Bolaget hittat: tvillingsökning och mejl med listan + Excel-bilaga.
// Samma inskick hanteras bara en gång, och samma bolag får tvillingar högst
// en gång per AUTO_SAMMA_BOLAG_DAGAR.

import { cacheGet, cacheSet } from "./cache";
import { byggCsv } from "./csvexport";
import { Forfragan, classifyInquiry, identifyCompany, skalAttHoppaOver, utanPersonuppgifter } from "./inkorg";
import { ResultRow, processLead } from "./korning";
import { mottagare, skickaMejl } from "./mail";
import { GranskaOrsak, GranskaPost, laggIKo } from "./granskning";
import { markeraOchKomIhag, sparaKorning } from "./historik";
import type { Klassning } from "./inkorg";
import { ticKlient } from "./twinfinder";
import { GRANSKA_ORSAK, forfraganEtikett, likhetText, lokalText, sasongText, tidigareText, urvalText } from "@/app/ui/klartext";

// Tak för tic.io-anrop per automatiskt lead (nyckeln har 200/mån).
const AUTO_MAX_TIC = 4;
const AUTO_SAMMA_BOLAG_DAGAR = 30;
const APP_URL = process.env.APP_URL || "https://tvillinganalys.vercel.app";

export type Utfall = "dublett" | "hoppas_over" | "granskas" | "redan_skickat" | "skickat" | "fel";


export async function hanteraLead(f: Forfragan, inskickId: string): Promise<{ utfall: Utfall; detalj?: string }> {
  const logg = (utfall: Utfall, detalj?: string) => {
    console.log(JSON.stringify({ steg: "automatik", utfall, detalj, doman: f.doman, formular: f.formular }));
    return { utfall, detalj };
  };
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  const bolagsdataKey = process.env.BOLAGSDATA_API_KEY;
  const ticKey = process.env.TIC_API_KEY;
  if (!typesafeKey || !ticKey) return logg("fel", "TYPESAFE_API_KEY eller TIC_API_KEY saknas");

  // Webflow kan skicka samma inskick igen.
  const inskickNyckel = `auto:inskick:${inskickId}`;
  if (await cacheGet(inskickNyckel)) return logg("dublett", inskickId);
  await cacheSet(inskickNyckel, 1, 7);

  let k: Klassning | null = null;
  try {
    k = await classifyInquiry(f, typesafeKey);
    const hoppa = skalAttHoppaOver(f, k);
    if (hoppa) return logg("hoppas_over", hoppa.text);

    const r = await identifyCompany(f, k, bolagsdataKey, typesafeKey);
    const etikett = forfraganEtikett(k.typ, k.avsandare);
    if (!r.company) {
      const orsak: GranskaOrsak = r.forslag ? "osaker" : r.sokterm ? "ingen" : "inget_namn";
      await tillGranskning(f, k, inskickId, orsak, r.forslag ?? null, null);
      return logg("granskas", `${orsak}: ${r.matchning}`);
    }

    const bolagNyckel = `auto:bolag:${r.company.org_nr}`;
    if (await cacheGet(bolagNyckel)) return logg("redan_skickat", r.company.name);

    const rows = await processLead(
      {
        namn: r.company.name,
        orgNr: r.company.org_nr,
        resolved: r,
        extra: {
          forfragan_datum: f.datum.toISOString().slice(0, 10),
          forfragan_formular: f.formular,
          forfragan_doman: f.doman,
          forfragan_typ: etikett,
          // Säljarnas eget mejl: hela förfrågan med avsändarens uppgifter (inte maskad).
          forfragan_namn: f.namn || null,
          forfragan_epost: f.epost || null,
          forfragan_telefon: f.telefon || null,
          forfragan_text: f.meddelande.trim(),
        },
      },
      {
        tic: ticKlient(ticKey, AUTO_MAX_TIC),
        bolagsdataKey,
        typesafeKey,
        foretagskontaktKey: process.env.FORETAGSKONTAKT_API_KEY,
        knownCustomerOrgNrs: new Set(),
      }
    );
    const tvillingar = rows.filter((x) => x.tvilling_namn);
    if (!tvillingar.length) {
      await tillGranskning(f, k, inskickId, "inga_tvillingar", null, { namn: r.company.name, org_nr: r.company.org_nr });
      return logg("granskas", `inga_tvillingar: ${r.company.name}: ${rows[0]?.status}`);
    }

    await markeraOchKomIhag(rows);
    await sparaKorning(rows, "automatik");
    const svar = await skickaTvillingMejl(rows);
    return logg(svar.skickat ? "skickat" : "fel", svar.fel || `${r.company.name}: ${tvillingar.length} tvillingar`);
  } catch (e: any) {
    // Hellre en post att granska än en förfrågan som försvinner.
    await tillGranskning(f, k, inskickId, "fel", null, null).catch(() => {});
    return logg("fel", String(e?.message || e));
  }
}

// Mejlet med tvillingarna till säljarna (MAIL_TO). Används av automatiken och
// när en förfrågan körs från Granska. Samma bolag mejlas sedan inte automatiskt
// igen på AUTO_SAMMA_BOLAG_DAGAR.
// granskad: förfrågan har gått via Granska, vilket syns i ämne och mejl.
export async function skickaTvillingMejl(rows: ResultRow[], granskad = false): Promise<{ skickat: boolean; fel?: string }> {
  const forsta = rows[0];
  const tvillingar = rows.filter((x) => x.tvilling_namn);
  if (!forsta || !tvillingar.length) return { skickat: false, fel: "inga tvillingar" };
  const namn = forsta.kall_namn || forsta.lead_foretagsnamn;
  const svar = await skickaMejl({
    till: mottagare(),
    amne: `Förslag på tvillingar: ${namn} (${tvillingar.length} bolag)${granskad ? " – efter manuell granskning" : ""}`,
    html: tvillingMejl(rows, granskad),
    bilagor: [{ filnamn: `tvillingar-${slug(namn)}.csv`, innehall: "\uFEFF" + byggCsv(rows) }],
  });
  if (svar.skickat && forsta.kall_org_nr) await cacheSet(`auto:bolag:${forsta.kall_org_nr}`, 1, AUTO_SAMMA_BOLAG_DAGAR);
  return svar;
}

async function tillGranskning(
  f: Forfragan,
  k: Klassning | null,
  inskickId: string,
  orsak: GranskaOrsak,
  forslag: GranskaPost["forslag"],
  bolag: GranskaPost["bolag"]
): Promise<void> {
  const post: GranskaPost = {
    id: inskickId,
    skapad: new Date().toISOString(),
    datum: f.datum.toISOString(),
    formular: f.formular,
    doman: f.doman,
    namn: f.namn,
    epost: f.epost,
    telefon: f.telefon,
    text: f.meddelande,
    typ_kod: k?.typ || "ny_forfragan",
    avsandare_kod: k?.avsandare || "oklart",
    orsak_kod: orsak,
    forslag,
    bolag,
  };
  await laggIKo(post);
  const vem = bolag?.namn || f.namn || f.doman || f.epost || "okänd avsändare";
  await skickaMejl({
    till: mottagare(),
    amne: `Att granska: ny förfrågan från ${vem}`,
    html: granskaMejl(f, k ? forfraganEtikett(k.typ, k.avsandare) : "Ny förfrågan", orsak, forslag?.namn, bolag?.namn),
  });
}

// --- Mejlen (enkel HTML med inbäddade stilar, fungerar i Outlook/Gmail) ----

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9åäö]+/g, "-").replace(/^-|-$/g, "");
const mkr = (kr?: number | null) =>
  kr == null ? "–" : `${(Math.max(0, kr) / 1e6).toLocaleString("sv-SE", { maximumFractionDigits: kr < 1e7 ? 1 : 0 })} Mkr`;

const RAM = (inne: string) => `<!doctype html><html lang="sv"><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b">
<div style="max-width:900px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border:1px solid #eef0f3;border-radius:10px;padding:24px">${inne}</div>
<p style="font-size:12px;color:#74747a;margin:14px 4px">Skickat automatiskt av Tvillinganalys · <a href="${APP_URL}" style="color:#74747a">Öppna verktyget</a></p>
</div></body></html>`;

// Hela förfrågan med avsändarens uppgifter - mejlet går till säljarna själva.
type Avsandare = { namn?: string | null; epost?: string | null; telefon?: string | null; meddelande: string };
function citat(f: Avsandare): string {
  const rader = [
    ["Namn", esc(f.namn)],
    ["E-post", f.epost ? `<a href="mailto:${esc(f.epost)}" style="color:#c9474a">${esc(f.epost)}</a>` : ""],
    ["Telefon", f.telefon ? `<a href="tel:${esc(f.telefon.replace(/[^\d+]/g, ""))}" style="color:#c9474a">${esc(f.telefon)}</a>` : ""],
  ]
    .filter(([, v]) => v)
    .map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#74747a">${k}</td><td style="padding:2px 0">${v}</td></tr>`)
    .join("");
  const text = (f.meddelande || "").trim();
  return `<div style="border-left:3px solid #eb5f62;background:#fdeced;padding:10px 14px;margin:14px 0;font-size:14px">
${rader ? `<table style="border-collapse:collapse;font-size:14px;margin-bottom:${text ? 8 : 0}px">${rader}</table>` : ""}
${text ? `<div style="white-space:pre-wrap">${esc(text)}</div>` : ""}
</div>`;
}

function kontaktCell(t: ResultRow): string {
  const delar = [
    t.beslutsfattare ? esc(t.beslutsfattare) : "",
    t.bolag_telefon ? `<a href="tel:${esc(t.bolag_telefon.replace(/[^\d+]/g, ""))}" style="color:#c9474a">${esc(t.bolag_telefon)}</a>` : "",
    t.bolag_epost ? `<a href="mailto:${esc(t.bolag_epost)}" style="color:#c9474a">${esc(t.bolag_epost)}</a>` : "",
    t.bolag_webb ? `<a href="${esc(/^https?:/.test(t.bolag_webb) ? t.bolag_webb : "https://" + t.bolag_webb)}" style="color:#c9474a">webbplats</a>` : "",
  ].filter(Boolean);
  return delar.length ? delar.join("<br>") : "–";
}

function tvillingMejl(rows: ResultRow[], granskad = false): string {
  const forsta = rows[0];
  const avs: Avsandare = {
    namn: forsta.forfragan_namn,
    epost: forsta.forfragan_epost,
    telefon: forsta.forfragan_telefon,
    meddelande: forsta.forfragan_text || "",
  };
  const kalla = [forsta.forfragan_typ, forsta.forfragan_formular && `via ${forsta.forfragan_formular}`, forsta.forfragan_datum]
    .filter(Boolean)
    .join(" ");
  const tvillingar = rows.filter((x) => x.tvilling_namn);
  const fakta = [lokalText(forsta.lokal), sasongText(forsta.sasong_kod), urvalText(forsta.urval_kod, forsta.lokal, forsta.kall_lan)]
    .filter(Boolean)
    .join(" · ");
  const rader = tvillingar
    .map(
      (t) => `<tr>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top"><strong>${esc(t.tvilling_namn)}</strong><br><span style="color:#74747a;font-size:12px">${esc(t.tvilling_org_nr)}</span>${t.tidigare_datum ? `<br><span style="display:inline-block;margin-top:3px;background:#fff4e0;color:#8a5a00;font-size:11px;padding:1px 6px;border-radius:4px">${esc(tidigareText(t))}</span>` : ""}</td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top">${esc(t.tvilling_ort || "–")}<br><span style="color:#74747a;font-size:12px">${esc(t.tvilling_lan || "")}</span></td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;text-align:right;white-space:nowrap">${mkr(t.tvilling_oms)}</td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;text-align:right">${esc(t.tvilling_anstallda ?? "–")}</td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;font-size:12px;color:#4a4a50">${esc((t.tvilling_verksamhet || "").slice(0, 140))}${(t.tvilling_verksamhet || "").length > 140 ? "…" : ""}</td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;font-size:12px;white-space:nowrap">${esc(likhetText(t.tvilling_likhet))}</td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;font-size:12px">${kontaktCell(t)}</td>
</tr>`
    )
    .join("");
  const th = (s: string, hoger = false) =>
    `<th style="text-align:${hoger ? "right" : "left"};padding:8px;border-bottom:2px solid #2b2b2b;font-size:12px">${s}</th>`;
  const granskadRad = granskad
    ? `<p style="display:inline-block;margin:0 0 10px;background:#fff4e0;color:#8a5a00;font-size:13px;font-weight:bold;padding:4px 10px;border-radius:6px">Efter manuell granskning – förfrågan kom in tidigare och bolaget har fyllts i eller rättats för hand.</p>`
    : "";
  return RAM(`${granskadRad}<h1 style="font-size:20px;margin:0 0 6px">${esc(forsta.kall_namn)} – ${tvillingar.length} liknande bolag</h1>
${kalla || forsta.kall_lan ? `<p style="margin:0;color:#4a4a50;font-size:14px">${esc(kalla)}${forsta.kall_lan ? ` · ${esc(forsta.kall_lan)}` : ""}</p>` : ""}
${avs.namn || avs.epost || avs.telefon || avs.meddelande ? citat(avs) : ""}
${fakta ? `<p style="font-size:13px;color:#4a4a50;margin:0 0 12px">${esc(fakta)}</p>` : ""}
<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr>${th("Bolag")}${th("Ort")}${th("Omsättning", true)}${th("Anställda", true)}${th("Verksamhet")}${th("Likhet")}${th("Kontakt")}</tr>
${rader}
</table>
<p style="font-size:13px;color:#4a4a50;margin:16px 0 0">Hela listan finns som bilaga (öppnas i Excel) och under <a href="${APP_URL}/historik" style="color:#c9474a">Historik</a> i verktyget.</p>`);
}

function granskaMejl(f: Forfragan, etikett: string, orsak: GranskaOrsak, forslag?: string, bolag?: string): string {
  const knapp = `<a href="${APP_URL}/granska" style="display:inline-block;background:#eb5f62;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:8px;font-size:14px">Granska i Tvillinganalys</a>`;
  return RAM(`<h1 style="font-size:20px;margin:0 0 6px">Ny förfrågan att granska${bolag ? `: ${esc(bolag)}` : ""}</h1>
<p style="margin:0;color:#4a4a50;font-size:14px">${esc(etikett)} via ${esc(f.formular)} ${esc(f.datum.toLocaleDateString("sv-SE"))}${f.doman ? ` från ${esc(f.doman)}` : ""}</p>
<p style="font-size:14px;margin:14px 0 0"><strong>Varför granskning:</strong> ${esc(GRANSKA_ORSAK[orsak])}${forslag ? ` Kanske <strong>${esc(forslag)}</strong>?` : ""}</p>
${citat({ ...f, meddelande: f.meddelande })}
<p style="font-size:14px;margin:0 0 14px">Förfrågan ligger under <em>Granska</em> i verktyget. Där kan du fylla i eller rätta bolaget och ta fram tvillingarna.</p>
${knapp}`);
}

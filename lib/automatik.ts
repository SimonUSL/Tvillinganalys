// automatik.ts — en ny förfrågan från Webflow hanteras helt automatiskt:
// klassning, bolag, tvillingar och ett mejl till säljarna (MAIL_TO).
//
// - Inte värd att söka på (befintlig kund, mäklare, spam, privatperson ...):
//   inget mejl, bara en loggrad.
// - Osäkert vilket bolag det är: kort mejl med förfrågan och en uppmaning att
//   lägga in bolaget i verktyget.
// - Bolaget hittat: tvillingsökning och mejl med listan + Excel-bilaga.
// Samma inskick hanteras bara en gång, och samma bolag får tvillingar högst
// en gång per AUTO_SAMMA_BOLAG_DAGAR.

import { cacheGet, cacheSet } from "./cache";
import { byggCsv } from "./csvexport";
import { Forfragan, classifyInquiry, identifyCompany, skalAttHoppaOver, utanPersonuppgifter } from "./inkorg";
import { ResultRow, processLead } from "./korning";
import { mottagare, skickaMejl } from "./mail";
import { ticKlient } from "./twinfinder";
import { forfraganEtikett, likhetText, lokalText, sasongText, urvalText } from "@/app/ui/klartext";

// Tak för tic.io-anrop per automatiskt lead (nyckeln har 200/mån).
const AUTO_MAX_TIC = 4;
const AUTO_SAMMA_BOLAG_DAGAR = 30;
const APP_URL = process.env.APP_URL || "https://tvillinganalys.vercel.app";

export type Utfall = "dublett" | "hoppas_over" | "osaker_bolag" | "redan_skickat" | "inga_tvillingar" | "skickat" | "fel";

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

  const k = await classifyInquiry(f, typesafeKey);
  const hoppa = skalAttHoppaOver(f, k);
  if (hoppa) return logg("hoppas_over", hoppa.text);

  const r = await identifyCompany(f, k, bolagsdataKey, typesafeKey);
  const etikett = forfraganEtikett(k.typ, k.avsandare);
  if (!r.company) {
    await skickaMejl({ till: mottagare(), amne: `Ny förfrågan – vilket bolag? (${f.doman || f.epost || "okänd avsändare"})`, html: osakertMejl(f, etikett, r.forslag?.namn) });
    return logg("osaker_bolag", r.matchning);
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
        forfragan_text: utanPersonuppgifter(f.meddelande).replace(/\s+/g, " ").slice(0, 300),
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
  if (!tvillingar.length) return logg("inga_tvillingar", `${r.company.name}: ${rows[0]?.status}`);

  const svar = await skickaMejl({
    till: mottagare(),
    amne: `Förslag på tvillingar: ${r.company.name} (${tvillingar.length} bolag)`,
    html: tvillingMejl(f, etikett, rows),
    bilagor: [{ filnamn: `tvillingar-${slug(r.company.name)}.csv`, innehall: "﻿" + byggCsv(rows) }],
  });
  if (svar.skickat) await cacheSet(bolagNyckel, 1, AUTO_SAMMA_BOLAG_DAGAR);
  return logg(svar.skickat ? "skickat" : "fel", svar.fel || `${r.company.name}: ${tvillingar.length} tvillingar`);
}

// --- Mejlen (enkel HTML med inbäddade stilar, fungerar i Outlook/Gmail) ----

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9åäö]+/g, "-").replace(/^-|-$/g, "");
const mkr = (kr?: number | null) =>
  kr == null ? "–" : `${(kr / 1e6).toLocaleString("sv-SE", { maximumFractionDigits: kr < 1e7 ? 1 : 0 })} Mkr`;

const RAM = (inne: string) => `<!doctype html><html lang="sv"><body style="margin:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#2b2b2b">
<div style="max-width:720px;margin:0 auto;padding:24px 16px">
<div style="background:#ffffff;border:1px solid #eef0f3;border-radius:10px;padding:24px">${inne}</div>
<p style="font-size:12px;color:#74747a;margin:14px 4px">Skickat automatiskt av Tvillinganalys · <a href="${APP_URL}" style="color:#74747a">Öppna verktyget</a></p>
</div></body></html>`;

function citat(f: Forfragan): string {
  const text = utanPersonuppgifter(f.meddelande).trim();
  if (!text) return "";
  const kort = text.length > 600 ? `${text.slice(0, 600)}…` : text;
  return `<div style="border-left:3px solid #eb5f62;background:#fdeced;padding:10px 14px;margin:14px 0;font-size:14px;white-space:pre-wrap">${esc(kort)}</div>`;
}

function tvillingMejl(f: Forfragan, etikett: string, rows: ResultRow[]): string {
  const forsta = rows[0];
  const tvillingar = rows.filter((x) => x.tvilling_namn);
  const fakta = [lokalText(forsta.lokal), sasongText(forsta.sasong_kod), urvalText(forsta.urval_kod, forsta.lokal, forsta.kall_lan)]
    .filter(Boolean)
    .join(" · ");
  const rader = tvillingar
    .map(
      (t) => `<tr>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top"><strong>${esc(t.tvilling_namn)}</strong><br><span style="color:#74747a;font-size:12px">${esc(t.tvilling_org_nr)}</span></td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top">${esc(t.tvilling_ort || "–")}<br><span style="color:#74747a;font-size:12px">${esc(t.tvilling_lan || "")}</span></td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;text-align:right;white-space:nowrap">${mkr(t.tvilling_oms)}</td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;text-align:right">${esc(t.tvilling_anstallda ?? "–")}</td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;font-size:12px;color:#4a4a50">${esc((t.tvilling_verksamhet || "").slice(0, 140))}${(t.tvilling_verksamhet || "").length > 140 ? "…" : ""}</td>
<td style="padding:8px;border-bottom:1px solid #eef0f3;vertical-align:top;font-size:12px;white-space:nowrap">${esc(likhetText(t.tvilling_likhet))}</td>
</tr>`
    )
    .join("");
  const th = (s: string, hoger = false) =>
    `<th style="text-align:${hoger ? "right" : "left"};padding:8px;border-bottom:2px solid #2b2b2b;font-size:12px">${s}</th>`;
  return RAM(`<h1 style="font-size:20px;margin:0 0 6px">${esc(forsta.kall_namn)} – ${tvillingar.length} liknande bolag</h1>
<p style="margin:0;color:#4a4a50;font-size:14px">${esc(etikett)} via ${esc(f.formular)} ${esc(f.datum.toLocaleDateString("sv-SE"))}${forsta.kall_lan ? ` · ${esc(forsta.kall_lan)}` : ""}</p>
${citat(f)}
${fakta ? `<p style="font-size:13px;color:#4a4a50;margin:0 0 12px">${esc(fakta)}</p>` : ""}
<table style="width:100%;border-collapse:collapse;font-size:13px">
<tr>${th("Bolag")}${th("Ort")}${th("Omsättning", true)}${th("Anställda", true)}${th("Verksamhet")}${th("Likhet")}</tr>
${rader}
</table>
<p style="font-size:13px;color:#4a4a50;margin:16px 0 0">Hela listan finns som bilaga (öppnas i Excel).</p>`);
}

function osakertMejl(f: Forfragan, etikett: string, forslag?: string): string {
  return RAM(`<h1 style="font-size:20px;margin:0 0 6px">Ny förfrågan – vilket bolag?</h1>
<p style="margin:0;color:#4a4a50;font-size:14px">${esc(etikett)} via ${esc(f.formular)} ${esc(f.datum.toLocaleDateString("sv-SE"))} från ${esc(f.doman || "okänd avsändare")}</p>
${citat(f)}
<p style="font-size:14px;margin:0 0 8px">Vi kunde inte säkert avgöra vilket bolag som skickat förfrågan${forslag ? ` (kanske <strong>${esc(forslag)}</strong>?)` : ""}, så inga tvillingar har tagits fram.</p>
<p style="font-size:14px;margin:0">Lägg in bolaget i verktyget under <em>Egen lista med bolag</em> så tas tvillingarna fram: <a href="${APP_URL}" style="color:#c9474a">${esc(APP_URL)}</a></p>`);
}

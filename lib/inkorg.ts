// inkorg.ts — läser webbplatsens formulärexporter (boka demo, kontaktformulär,
// kontaktsida, offertförfrågan), låter Jev klassa varje förfrågan och
// identifierar avsändarens bolag. Bara nya förfrågningar från organisationer
// går vidare till tvillingsökningen; resten får en orsak.

import { parseCsv } from "./csv";
import { LeadKontext, SourceResult, namnUtanBolagsform, resolveViaBolagsdata } from "./twinfinder";

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";

// Meddelandet ligger i olika kolumner i olika exporter (och i äldre versioner
// av samma formulär).
const MEDDELANDEKOLUMNER = new Set([
  "message",
  "message 2",
  "question",
  "förfrågan",
  "footer frågan",
  "footer fragan",
  "footer-fr-gan",
  "f rfr gan 3",
]);
const GRATISMEJL = new Set(
  ("gmail.com hotmail.com outlook.com live.se yahoo.com icloud.com hotmail.se telia.com msn.com yahoo.se " +
    "me.com outlook.se spray.se bredband.net live.com comhem.se protonmail.com mail.com").split(" ")
);
// Landsdomäner utanför Sverige: bolaget finns inte i det svenska registret.
const UTLANDSKA_TLD = new Set("dk no fi de uk nl pl ee lv lt fr es it at ch be is".split(" "));
// Samma förfrågan hamnar ofta i två formulär inom någon minut.
const DUBBLETT_SEKUNDER = 600;

export interface Forfragan {
  formular: string;
  datum: Date;
  epost: string;
  doman: string | null;
  gratismejl: boolean;
  meddelande: string;
  namn: string; // avsändarens namn, om formuläret har ett namnfält
  telefon: string;
}

// "10/07/2026 8:58:20 am" (månad/dag/år, 12-timmarsklocka)
function parseDatum(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[4]) % 12;
  if (m[7]?.toLowerCase() === "pm") h += 12;
  return new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), h, Number(m[5]), Number(m[6]));
}

function formularNamn(filnamn: string): string {
  const f = filnamn.toLowerCase();
  if (f.includes("demo")) return "boka demo";
  if (f.includes("offer")) return "offertförfrågan";
  if (f.includes("kontakt")) return "kontaktsida";
  if (f.includes("contact")) return "kontaktformulär";
  return filnamn.replace(/\.csv$/i, "");
}

export function parseFormExports(filer: { name: string; text: string }[], fran: Date, till: Date): Forfragan[] {
  const alla: Forfragan[] = [];
  for (const fil of filer) {
    for (const rad of parseCsv(fil.text.replace(/^﻿/, ""))) {
      const datum = parseDatum(rad.Date || "");
      if (!datum || datum < fran || datum > till) continue;
      alla.push(forfraganFranFalt(rad, formularNamn(fil.name), datum));
    }
  }
  alla.sort((a, b) => a.datum.getTime() - b.datum.getTime());
  const unika: Forfragan[] = [];
  for (const f of alla) {
    const dubblett = unika.some(
      (u) => u.epost && u.epost === f.epost && Math.abs(u.datum.getTime() - f.datum.getTime()) < DUBBLETT_SEKUNDER * 1000
    );
    if (!dubblett) unika.push(f);
  }
  return unika;
}

// En förfrågan ur formulärets fält (en exportrad eller en Webflow-webhook -
// fälten heter likadant). E-post: första fältet med "mail" i namnet som
// innehåller ett @; meddelandet: de kända meddelandefälten.
export function forfraganFranFalt(falt: Record<string, unknown>, formular: string, datum: Date): Forfragan {
  const varden = Object.entries(falt).map(([k, v]) => [k, typeof v === "string" ? v : v == null ? "" : String(v)] as const);
  const epost = varden.find(([k, v]) => k.toLowerCase().includes("mail") && v.includes("@"))?.[1].trim().toLowerCase() || "";
  const meddelande = varden
    .filter(([k, v]) => MEDDELANDEKOLUMNER.has(k.toLowerCase()) && v.trim())
    .map(([, v]) => v.trim().replace(/^"+|"+$/g, ""))
    .join("\n");
  const doman = epost.includes("@") ? epost.split("@")[1] : null;
  const forsta = (re: RegExp) => varden.find(([k, v]) => re.test(k) && v.trim())?.[1].trim() || "";
  return {
    formular,
    datum,
    epost,
    doman,
    gratismejl: !!doman && GRATISMEJL.has(doman),
    meddelande,
    namn: forsta(/^(name|namn)( \d)?$|full ?name|ditt namn/i),
    telefon: forsta(/phone|telefon|^tel/i),
  };
}

// Webflow-formulärets namn ("Book a demo form", "Get offer request form" ...) -> vårt namn.
export const formularFranNamn = (namn: string) => formularNamn(namn.replace(/\s+/g, "-"));

// E-postadresser och telefonnummer skickas aldrig till Jev.
export function utanPersonuppgifter(text: string): string {
  return text.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[e-post]").replace(/(\+46|0)[\d\s-]{7,13}\d/g, "[telefon]");
}

// Namnkandidater ur meddelandet: ord/fraser med versal (t.ex. "Xpendio",
// "Husman Hagberg Hemavan"). Jev väljer bland dem - genererar aldrig själv.
const INTE_NAMN = new Set(
  ("Hej Hejsan Vi Jag Mvh Med Tack Vänliga Hälsningar Hälsning Ni Det Den Vad Hur Kan Är Finns Har Om Och " +
    "Thank We Our Could Hello Hi Best Regards Initially Whether Which What How Please Kind Stort God Bästa " +
    "Trevlig Önskar Behöver Alternativ Färdigt Distribution Cirka Eventuell Eventuella Inklusive Transport " +
    "Tryck Dubbelsidigt Skulle Vill Hejhej Tjena Tjenare Tack").split(" ")
);

function namnkandidater(f: Forfragan): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.doman && !f.gratismejl) out.doman = f.doman.replace(/\.[a-z]+$/, "");
  const text = utanPersonuppgifter(f.meddelande);
  const re = /\b([A-ZÅÄÖ][\wåäöÅÄÖ&-]+(?:\s+(?:[A-ZÅÄÖ&][\wåäöÅÄÖ&-]*|AB|i|och|&)){0,3})/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) && i < 25) {
    const fras = m[1].trim();
    if (fras.length < 3 || INTE_NAMN.has(fras.split(/\s+/)[0])) continue;
    if (Object.values(out).includes(fras)) continue;
    out[`fras_${i++}`] = fras;
  }
  return out;
}

const OPTIMAL =
  "Optimal Kommunikation is a Swedish B2B company selling: address registers for consumers and companies, email " +
  "addresses for decision-makers, register cleaning (registervård), housing-association (BRF) registers, graphic " +
  "design, print, automated web-to-print, direct mail / mass mailings / flyer distribution, statutory consultation " +
  "mailings (samrådsutskick) and telemarketing.";

export const TYPER: Record<string, string> = {
  ny_forfragan:
    "Wants to buy, get a price or quote, or learn more about one of Optimal's services for their own organisation's marketing or communication.",
  befintlig_kund:
    "Already a customer: about an existing order, delivery, login, account, invoice, changing a placed order, or blocking addresses from their own mailing.",
  saljer_till_optimal:
    "Someone offering their own services or products to Optimal (agencies, SEO, recruitment, partnerships), or spam.",
  avregistrering:
    "A private person asking to be removed from lists, to stop receiving advertising, or about their own personal data.",
  ovrigt: "Job applications, students, research or other messages that are not about buying Optimal's services.",
  oklart: "Too short or vague to tell what the sender wants.",
};
const TYP_TEXT: Record<string, string> = {
  ny_forfragan: "ny förfrågan",
  befintlig_kund: "befintlig kund",
  saljer_till_optimal: "säljer till Optimal / spam",
  avregistrering: "avregistrering",
  ovrigt: "övrigt",
  oklart: "oklart",
};
const AVSANDARE_TEXT: Record<string, string> = {
  foretag: "företag",
  forening: "förening",
  offentlig: "offentlig",
  privatperson: "privatperson",
  oklart: "oklar avsändare",
};

// Över denna sannolikhet räknas avsändaren som mäklare (utesluts tills vidare).
const MIN_MAKLARE = 0.5;

export interface Klassning {
  typ: string;
  typ_p: number;
  avsandare: string;
  maklare: number;
  namnfras: string | null;
  beskrivning: string; // t.ex. "ny förfrågan · företag (Jev 100 %)"
}

const procent = (p: number) => `${Math.round(p * 100)} %`;

export async function classifyInquiry(f: Forfragan, typesafeKey: string): Promise<Klassning> {
  const kandidater = namnkandidater(f);
  const questions: Record<string, any> = {
    typ: {
      type: "choice",
      instructions:
        "The `inquiry` was sent to Optimal Kommunikation (see `about_optimal`) through a website form. What kind of inquiry is it?",
      criteria: TYPER,
    },
    avsandare: {
      type: "choice",
      instructions:
        "Who is the sender of `inquiry`? Use the message and `inquiry.email_domain` (a company domain suggests a company; a free email provider says nothing by itself).",
      criteria: {
        foretag: "A business.",
        forening: "An association, housing cooperative (bostadsrättsförening), club, foundation or other non-profit organisation.",
        offentlig: "A municipality, region, government authority, school or other public body.",
        privatperson: "A private individual acting for themselves.",
        oklart: "Cannot tell.",
      },
    },
    maklare: {
      type: "noul",
      instructions: "Is the sender of `inquiry` a real-estate agency or real-estate agent (fastighetsmäklare)?",
    },
  };
  if (Object.keys(kandidater).length) {
    questions.namn = {
      type: "choice",
      instructions:
        "Which option is the name of the company or organisation that sent `inquiry`? `doman` is derived from the sender's email domain.",
      criteria: { ...kandidater, inget: "None of the options is the sender's company or organisation name." },
    };
  }
  const resp = await fetch(TYPESAFE_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${typesafeKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: {
        about_optimal: OPTIMAL,
        inquiry: {
          form: f.formular,
          email_domain: f.doman,
          free_email_provider: f.gratismejl,
          message: utanPersonuppgifter(f.meddelande).slice(0, 1500),
        },
      },
      questions,
    }),
  });
  if (!resp.ok) throw new Error(`Jev ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
  const a = (await resp.json()).answers;
  const typ: string = a.typ.choice;
  const typ_p: number = a.typ.probabilities?.[typ] ?? 0;
  const avsandare: string = a.avsandare.choice;
  const namnVal: string | undefined = a.namn?.choice;
  return {
    typ,
    typ_p,
    avsandare,
    maklare: a.maklare.noul,
    namnfras: namnVal && namnVal !== "inget" ? kandidater[namnVal] : null,
    beskrivning: `${TYP_TEXT[typ] ?? typ} · ${AVSANDARE_TEXT[avsandare] ?? avsandare} (Jev ${procent(typ_p)})`,
  };
}

// null = gå vidare till tvillingsökning, annars orsaken (kod för gränssnittet
// + teknisk text för adminvyn) till att hoppa över.
export interface HoppaOver {
  kod: string; // befintlig_kund | maklare | privatperson | utlandsk | <typ> (t.ex. oklart)
  text: string;
}
export function skalAttHoppaOver(f: Forfragan, k: Klassning): HoppaOver | null {
  if (k.typ === "befintlig_kund") return { kod: "befintlig_kund", text: "befintlig kund (tvillingar från kunder är ett eget projekt)" };
  if (k.typ !== "ny_forfragan") return { kod: k.typ, text: `inte en ny förfrågan: ${TYP_TEXT[k.typ] ?? k.typ}` };
  if (k.avsandare === "privatperson") return { kod: "privatperson", text: "privatperson" };
  if (k.maklare >= MIN_MAKLARE) return { kod: "maklare", text: `mäklare, utesluts tills vidare (Jev ${procent(k.maklare)})` };
  const tld = f.doman?.split(".").pop() || "";
  if (UTLANDSKA_TLD.has(tld)) return { kod: "utlandsk", text: `utländsk domän (.${tld}), finns inte i svenska registret` };
  return null;
}

// Hitta avsändarens bolag via bolagsdataapi: söktermen är ett namn ur
// meddelandet eller e-postdomänens stam. Inga tic.io-anrop. Är Jev osäker
// lämnas fältet tomt i förhandsgranskningen och användaren fyller i själv.
export async function identifyCompany(
  f: Forfragan,
  k: Klassning,
  bolagsdataKey: string | undefined,
  typesafeKey: string | undefined
): Promise<SourceResult & { sokterm: string }> {
  const kontext: LeadKontext = { message: utanPersonuppgifter(f.meddelande).slice(0, 800), email_domain: f.doman };
  const sokterm = k.namnfras || (f.doman && !f.gratismejl ? f.doman.replace(/\.[a-z]+$/, "") : "");
  if (!sokterm) return { company: null, matchning: "inget bolagsnamn i förfrågan – fyll i själv", sokterm };
  if (!bolagsdataKey) return { company: null, matchning: "BOLAGSDATA_API_KEY saknas – fyll i själv", sokterm };
  const r = await resolveViaBolagsdata(namnUtanBolagsform(sokterm), bolagsdataKey, typesafeKey, kontext);
  return r.company ? { ...r, sokterm } : { ...r, matchning: `${r.matchning} – fyll i själv`, sokterm };
}

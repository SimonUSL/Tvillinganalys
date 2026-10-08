// kontakt.ts — kontaktuppgifter till ett bolag ur registren (tic.io och
// bolagsdataapi): bolagets e-post, telefon, webbplats och beslutsfattare
// (VD, ordförande m.fl. från Bolagsverket). Personnummer används aldrig och
// personer med skyddad identitet tas inte med.

export interface Kontakt {
  beslutsfattare: string | null; // t.ex. "Anna Svensson (VD), Per Olsson (ordförande)"
  epost: string | null;
  telefon: string | null;
  webb: string | null;
}

const GRATISMEJL = /@(gmail|hotmail|outlook|live|yahoo|icloud|me|msn|telia|spray|bredband|comhem|protonmail|mail)\./i;

// Redovisnings- och bokföringsbyråers adresser står ofta i registret i stället
// för bolagets egen (byrån sköter bolagets ärenden). De används aldrig.
const BYRA_DOMANER = new Set(
  (
    "wint.se fortnox.se bokio.se visma.com visma.se spiris.se azets.com azets.se aspia.se accountor.se " +
    "grantthornton.se pwc.com pwc.se kpmg.se kpmg.com ey.com se.ey.com deloitte.se deloitte.com bdo.se " +
    "bakertilly.se mazars.se forvismazars.com rsm.se ludvig.se srfkonsult.se " +
    "redovisningsbyra.se bokforingsbyra.se ekonomibyra.se"
  ).split(" ")
);
// Domäner som ser ut att höra till en byrå (redovisning, bokföring, revision ...).
const BYRA_ORD = /redovisning|bokforing|bokföring|revision|revisor|ekonomibyra|ekonomibyrå|bokslut|accounting|lonebyra|lönebyrå|ekonomitjanst|ekonomitjänst/i;

const normera = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

// true = adressen tillhör en annan byrå än bolaget självt.
function arByra(adress: string, bolagsDoman: string | null, bolagsnamn: string): boolean {
  const doman = adress.split("@")[1] || "";
  if (bolagsDoman && (doman === bolagsDoman || doman.endsWith("." + bolagsDoman))) return false; // bolagets egen
  // Bolaget är själv en byrå: domänen motsvarar namnet (t.ex. info@ekbokforing.se för "Ek Bokföring AB").
  const stam = normera(doman.split(".").slice(-2, -1)[0] || "");
  if (stam.length >= 4 && normera(bolagsnamn).includes(stam)) return false;
  return BYRA_DOMANER.has(doman) || [...BYRA_DOMANER].some((d) => doman.endsWith("." + d)) || BYRA_ORD.test(doman);
}

// Roller i prioritetsordning. Suppleanter, revisorer m.fl. tas inte med.
const ROLLER: [RegExp, string][] = [
  [/VERKSTÄLLANDE DIREKTÖR|^VD\b/i, "VD"],
  [/ORDFÖRANDE/i, "ordförande"],
  [/INNEHAVARE/i, "innehavare"],
  [/KOMPLEMENTÄR|BOLAGSMAN/i, "delägare"],
  [/^(STYRELSE)?LEDAMOT/i, "styrelseledamot"],
];
const MAX_PERSONER = 2;

// "ANNA SVENSSON" -> "Anna Svensson" (registret skriver ibland versaler).
function snyggtNamn(namn: string): string {
  if (namn !== namn.toUpperCase()) return namn.trim();
  return namn
    .toLowerCase()
    .replace(/(^|[\s-])([a-zåäöéü])/g, (_, a, b) => a + b.toUpperCase())
    .trim();
}

function domanAv(url?: string | null): string | null {
  const m = (url || "").toLowerCase().match(/^(?:https?:\/\/)?(?:www\.)?([^/:?#]+)/);
  return m ? m[1] : null;
}

// Bolagets egen domän först, sedan andra företagsadresser, gratismejl sist.
// Byråers adresser tas aldrig med.
function valjEpost(adresser: string[], webb: string | null, bolagsnamn = ""): string | null {
  const doman = domanAv(webb);
  const unika = Array.from(new Set(adresser.map((a) => a.trim().toLowerCase()).filter((a) => a.includes("@")))).filter(
    (a) => !arByra(a, doman, bolagsnamn)
  );
  if (!unika.length) return null;
  const poang = (a: string) => (doman && a.endsWith("@" + doman) ? 0 : GRATISMEJL.test(a) ? 2 : 1);
  return unika.sort((x, y) => poang(x) - poang(y))[0];
}

function beslutsfattare(personer: any[]): string | null {
  const valda: { namn: string; roll: string; prio: number }[] = [];
  for (const p of personer || []) {
    if (!p || p.isProtected || !p.fullName) continue;
    const beskrivning = String(p.positionDescription || "");
    const idx = ROLLER.findIndex(([re]) => re.test(beskrivning));
    if (idx < 0) continue;
    const namn = snyggtNamn(String(p.fullName));
    const finns = valda.find((v) => v.namn === namn);
    if (finns) {
      if (idx < finns.prio) Object.assign(finns, { roll: ROLLER[idx][1], prio: idx });
      continue;
    }
    valda.push({ namn, roll: ROLLER[idx][1], prio: idx });
  }
  if (!valda.length) return null;
  return valda
    .sort((a, b) => a.prio - b.prio)
    .slice(0, MAX_PERSONER)
    .map((v) => `${v.namn} (${v.roll})`)
    .join(", ");
}

export function kontaktFranTic(doc: any): Kontakt {
  const webb = (doc?.hyperlinks || []).map((l: any) => l?.hyperlink).find((u: string) => u && !/facebook|linkedin|instagram/i.test(u)) || null;
  const telefon = (doc?.phoneNumbers || []).map((p: any) => p?.e164PhoneNumber).find(Boolean) || null;
  return {
    beslutsfattare: beslutsfattare(doc?.currentRepresentatives || []),
    epost: valjEpost(
      (doc?.emailAddresses || []).map((e: any) => e?.emailAddress || ""),
      webb,
      doc?.names?.[0]?.nameOrIdentifier || ""
    ),
    telefon,
    webb,
  };
}

export function kontaktFranBolagsdata(c: any): Kontakt {
  const webb = c?.website || null;
  return {
    beslutsfattare: null,
    epost: valjEpost(c?.email ? [c.email] : [], webb, c?.name || ""),
    telefon: c?.phone || null,
    webb,
  };
}

// Fyller bara i det som saknas.
export function slaIhop(a: Kontakt | undefined, b: Kontakt): Kontakt {
  return {
    beslutsfattare: a?.beslutsfattare || b.beslutsfattare,
    epost: a?.epost || b.epost,
    telefon: a?.telefon || b.telefon,
    webb: a?.webb || b.webb,
  };
}

import { NextRequest, NextResponse } from "next/server";
import { classifyInquiry, identifyCompany, parseFormExports, skalAttHoppaOver, utanPersonuppgifter } from "@/lib/inkorg";

// Förhandsgranskning av formulärexporter: klassning (Jev) och bolagsförslag
// (bolagsdataapi). Inga tic.io-anrop - de görs först när användaren har
// granskat listan och kör tvillingsökningen.
export const maxDuration = 300;
// tic.io tar bara emot anrop från Norden/Tyskland - kör alltid i Stockholm.
export const preferredRegion = "arn1";

export interface Forhandsrad {
  id: number;
  datum: string;
  formular: string;
  doman: string | null;
  typ: string; // teknisk beskrivning (adminvyn)
  typ_kod: string | null; // ny_forfragan | befintlig_kund | ...
  avsandare_kod: string | null; // foretag | forening | offentlig | privatperson | oklart
  text: string;
  hoppa: string | null; // orsak att inte tvillingsöka (teknisk text), null = föreslås för sökning
  hoppa_kod: string | null;
  bolag_namn: string | null;
  bolag_org_nr: string | null;
  matchning: string; // teknisk text (adminvyn)
  matchning_kod: "saker" | "osaker" | "ingen" | "inget_namn" | "fel" | null;
  sakerhet: number | null;
  forslag?: { namn: string; org_nr: string } | null; // osäkert förslag, godtas med ett klick
}

function datumText(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export async function POST(req: NextRequest) {
  const typesafeKey = process.env.TYPESAFE_API_KEY;
  const bolagsdataKey = process.env.BOLAGSDATA_API_KEY;
  if (!typesafeKey) {
    return NextResponse.json({ error: "Import av formulärexporter kräver TYPESAFE_API_KEY." }, { status: 500 });
  }
  const body = await req.json();
  if (!Array.isArray(body.exports) || !body.exports.length) {
    return NextResponse.json({ error: "Inga filer." }, { status: 400 });
  }
  const forfragningar = parseFormExports(body.exports, new Date(`${body.from}T00:00:00`), new Date(`${body.to}T23:59:59`));
  if (!forfragningar.length) {
    return NextResponse.json({ error: "Inga förfrågningar i valt datumintervall." }, { status: 400 });
  }

  const rader: Forhandsrad[] = await Promise.all(
    forfragningar.map(async (f, id): Promise<Forhandsrad> => {
      const bas: Forhandsrad = {
        id,
        datum: datumText(f.datum),
        formular: f.formular,
        doman: f.doman,
        // E-post och telefonnummer maskas även i gränssnittet - granskningen behöver dem inte.
        text: utanPersonuppgifter(f.meddelande).replace(/\s+/g, " ").slice(0, 300),
        typ: "",
        typ_kod: null,
        avsandare_kod: null,
        hoppa: null,
        hoppa_kod: null,
        bolag_namn: null,
        bolag_org_nr: null,
        matchning: "",
        matchning_kod: null,
        sakerhet: null,
      };
      let k;
      try {
        k = await classifyInquiry(f, typesafeKey);
      } catch (e: any) {
        return { ...bas, hoppa: `fel vid klassning: ${e.message || e}`, hoppa_kod: "fel" };
      }
      const klass = { ...bas, typ: k.beskrivning, typ_kod: k.typ, avsandare_kod: k.avsandare };
      const hoppa = skalAttHoppaOver(f, k);
      if (hoppa) return { ...klass, hoppa: hoppa.text, hoppa_kod: hoppa.kod };
      try {
        const r = await identifyCompany(f, k, bolagsdataKey, typesafeKey);
        return {
          ...klass,
          bolag_namn: r.company?.name ?? null,
          bolag_org_nr: r.company?.org_nr ?? null,
          matchning: r.matchning,
          matchning_kod: r.company ? "saker" : r.forslag ? "osaker" : r.sokterm ? "ingen" : "inget_namn",
          sakerhet: r.sakerhet ?? null,
          forslag: r.forslag ?? null,
        };
      } catch (e: any) {
        return { ...klass, matchning: `fel vid bolagssökning: ${e.message || e}`, matchning_kod: "fel" };
      }
    })
  );
  return NextResponse.json({ rader });
}

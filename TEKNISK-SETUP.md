# Tvillinganalys — teknisk setup och status

Appen: https://tvillinganalys.vercel.app
Vercel-projekt: `tvillinganalys` (team `team_TVRKbPHDZaAR0OC5etLKu3Il`, projekt-ID `prj_NXmuWF23ntHAu247bWaDz1UKvRxM`)
Kod: GitHub-repot `SimonUSL/Tvillinganalys`. **Varje push till `main` deployas automatiskt till produktion.**

## Stack

- Next.js 14 (App Router), TypeScript, inga externa npm-paket förutom React/Next.
- Ingen databas. All state är cookies (inloggning) eller körs i minnet per request.
- Funktionerna körs i Stockholm (`regions: ["arn1"]` i `vercel.json`) — tic.io tar bara emot anrop från SE/NO/DK/FI/DE.

## Filstruktur

```
app/
  page.tsx             — huvudsidan: klistra in CSV, kör sökning, se resultat, ladda ner CSV, logga ut
  layout.tsx           — global HTML-skal, laddar Poppins-fonten
  login/page.tsx       — inloggningssida
  api/run/route.ts     — tar emot CSV, kör hela flödet per lead, returnerar resultatrader
  api/login, api/logout — sessions-cookie
lib/
  twinfinder.ts        — all sök-, matchnings- och rankningslogik (se "Flödet" nedan)
  csv.ts               — enkel CSV-parser
  auth.ts              — signerar/verifierar sessions-cookien
middleware.ts          — skyddar appen bakom /login om SITE_PASSWORD är satt
```

## Miljövariabler (Vercel → Project Settings → Environment Variables)

| Variabel | Krävs för |
|---|---|
| `TIC_API_KEY` | Tvillingsökningen (tic.io LENS). Krävs. |
| `TYPESAFE_API_KEY` | Jev: väljer rätt bolag, gissar geografi/säsong, bedömer tvillingar. Utan den faller appen tillbaka på enkla regler. |
| `BOLAGSDATA_API_KEY` | Uppslag av kallbolaget (bolagsdataapi.se). Utan den används tic.io även för det (dyrare för kvoten). |
| `FORETAGSKONTAKT_API_KEY` | Valfri, obekräftad integration för kontaktpersoner. |
| `SITE_PASSWORD` / `SITE_USERNAME` | Valfritt inloggningsskydd. |

Lokalt: samma variabler i `.env.local` (ignoreras av git). `npx next dev` kör appen mot riktiga API:er — **varje körning drar på tic.io-kvoten.**

## API-budget

| API | Kvot (observerad 2026-10-07) | Används till |
|---|---|---|
| tic.io LENS | **200 anrop/månad**, 120/min, max 20 olika IP per nyckel/månad | tvillingsökning |
| bolagsdataapi.se | 500 anrop (period anges inte i svaret) | uppslag av kallbolaget (2 per lead) |
| TypeSafe Jev | ingen praktisk gräns, ~0,03 kr per lead | alla bedömningar |

tic.io-anrop per lead i dag: **nischbransch ~1, trång bransch ~2–3**, 0 för leads i en bransch som redan sökts i samma körning, 0 för dubbletter. Varje körning loggar `tic_anrop` i Vercels runtime-loggar.

## Flödet per lead

1. **Kallbolaget** (`resolveSourceCompany`): namnsökning hos bolagsdataapi utan bolagsform (SkiStar heter "SkiStar *Aktiebolag*"), Jev väljer rätt träff eller svarar "ingen". Detaljanropet ger verksamhetsbeskrivning, län och SNI. Valfri CSV-kolumn `org_nr` pekar ut bolaget direkt. tic.io:s namnsökning är reserv.
2. **Geografi och säsong** (`guessLeadOptions`): tomma CSV-celler gissas av Jev från verksamhetsbeskrivningen. Ifyllda celler gäller alltid.
3. **Tvillingar** (`findTwins`):
   - Steg A: alla bolag med samma huvud-SNI, störst först. Antalet avgör läget: **≤ 300 = nischbransch** (de största i branschen tas, storlek väger lätt), **fler = trång bransch** (urval på storlek ⅓×–3×, annars "närmast underifrån").
   - Jev bedömer varje kandidat: hur lik verksamheten är, holding/vilande, samma koncern som kallbolaget, ev. säsong. Koden väger ihop till en poäng.
   - Ger SNI-sökningen färre än 10 starka tvillingar körs en nyckelordssökning på verksamhetsbeskrivningen (Jev väljer ordet) för att fånga bolag med annan SNI-kod.
   - Bara en tvilling per koncern: Jev jämför topp 20 parvis.
4. **Kontaktperson** (foretagskontakt.se, valfri).

Kolumnerna Matchning, Urval, Geografi, Säsong och Likhet visar varför varje val gjordes.

## Nästa steg: cache mellan körningar (rekommenderas när appen används skarpt)

Det största kvarvarande sättet att spara tic.io-anrop är att **cacha tic.io-svar i ~30 dagar** i en liten nyckel–värde-databas, t.ex. **Upstash Redis via Vercel Marketplace** (gratisnivå räcker). Då kostar en omkörning av samma leads, eller nya leads i en bransch som redan sökts, inga tic.io-anrop alls. Bolagsdata ändras långsamt, så 30 dagar är rimligt.

Görs när vi bekräftat att appen ska användas på riktiga kundlistor. Det kräver:
1. Lägg till Upstash Redis i Vercel-projektet (Storage → Marketplace) — det sätter miljövariablerna automatiskt.
2. I koden: `ticSearch` i `lib/twinfinder.ts` har redan en cache per körning (`Tic.cache`). Den byggs ut så att den först läser från Redis och skriver dit efter ett lyckat anrop, med nyckeln = sökningens JSON och 30 dagars livslängd.

Alternativ till cache: en större tic.io-plan (200 anrop/mån är lite för det här användningsområdet).

## Planerat: importera formulärexporter direkt ("inkorgen")

Mål: ladda upp veckans råa formulärexporter från webbplatsen (boka demo, kontaktformulär, kontaktsida, offertförfrågan) i stället för en handgjord CSV. Testat 2026-10-07 på senaste veckans 17 förfrågningar (efter dubblettrensning):

1. Koden läser alla fyra formaten, mappar kolumnerna (e-post- och meddelandefälten heter olika i varje export), slår ihop, tar bort dubbletter (samma e-post inom 10 min — samma förfrågan hamnar ofta i två formulär) och väljer datumintervall.
2. Jev klassar varje förfrågan med Optimals erbjudande som kontext: typ (ny förfrågan / befintlig kund / säljer till Optimal / avregistrering / övrigt / oklart), avsändare (företag / förening / offentlig / privatperson) och om det är en mäklare. Klassningen stämde på alla 17 i testet.
3. Bolaget identifieras: e-postdomänens stam söks hos bolagsdataapi (träffade ungefär hälften), annars tic.io-sökning på webbplats/e-post (`hyperlinks.hyperlink`, `emailAddresses.emailAddress`, 1 anrop, bara som reserv). Gratismejl: koden plockar ut namnkandidater ur meddelandet och Jev väljer. Inget säkert → "kontrollera manuellt".
4. Bara nya förfrågningar från företag, föreningar och offentliga aktörer går vidare till tvillingsökningen. Privatpersoner, säljare, spam och oklara hoppas över med orsak. Mäklare är inte ett prioriterat segment för Optimal.

Personuppgifter: e-postadresser och telefonnummer rensas ur meddelandet innan det skickas till Jev; bara e-postdomänen skickas.

## Senare: befintliga kunder som tvillingkällor (separat projekt)

Supportärendena i formulären (fel i order, inloggning, ändra tryckoriginal, blockera adress) avslöjar bolag som redan köper av Optimal. De är sannolikt de bästa källorna för tvillingar — deras tvillingar är nya prospekt av samma slag. Inkorgsimporten klassar dem redan som `befintlig_kund`; i dag hoppas de över. Att använda dem som källor är ett eget projekt, t.ex. en körning över hela historiken (5 000+ förfrågningar sedan 2019) — kräver en större tic.io-kvot eller cachen ovan.

## Kända begränsningar

- tic.io:s filter släpper bara igenom bolag som har fältet: bolag utan omsättning hos tic.io kommer inte med i storleksfiltrerade sökningar.
- tic.io:s nyckelordssökning kräver att alla ord matchar — därför ett enda ord.
- Med många leads per körning kan Vercels tidsgräns (`maxDuration = 60` s) och tic.io:s 120 anrop/min bli begränsande.
- foretagskontakt.se-integrationen är obekräftad och misslyckas tyst.

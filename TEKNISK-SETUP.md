# Tvillinganalys — teknisk setup och status

Appen: https://tvillinganalys.vercel.app
Vercel-projekt: `tvillinganalys` (team `team_TVRKbPHDZaAR0OC5etLKu3Il`, projekt-ID `prj_NXmuWF23ntHAu247bWaDz1UKvRxM`)
Kod: GitHub-repot `SimonUSL/Tvillinganalys`. **Varje push till `main` deployas automatiskt till produktion.**

## Stack

- Next.js 14 (App Router), TypeScript, inga externa npm-paket förutom React/Next.
- Ingen databas. All state är cookies (inloggning) eller körs i minnet per request.
- Funktionerna körs i Stockholm (`regions: ["arn1"]` i `vercel.json`) — tic.io tar bara emot anrop från SE/NO/DK/FI/DE.

## Automatik: nya leads från Webflow — `app/api/webflow`, `lib/automatik.ts`

Varje formulärinskick på webbplatsen skickas av Webflow till `/api/webflow?nyckel=<WEBFLOW_WEBHOOK_SECRET>` (Webflow → Site settings → Apps & integrations → Webhooks → *Form submission*). Appen svarar direkt och arbetar sedan i bakgrunden:

- **Inte värd att söka på** (befintlig kund, mäklare, privatperson, spam, oklar, utländsk): inget mejl, bara en loggrad.
- **Osäkert bolag, inga tvillingar eller fel:** förfrågan läggs i **granskningskön** (`/granska`, `lib/granskning.ts`, Redis-hashen `granska:poster`) och mejlet "Att granska: ny förfrågan från …" säger varför, med knappen *Granska i Tvillinganalys*. På `/granska` fyller man i eller rättar bolaget och kör tvillingsökningen; resultatet mejlas till mottagarna precis som de automatiska ("Förslag på tvillingar … – efter manuell granskning", med en markering överst i mejlet; `skickaTvillingMejl`), och leads som får tvillingar tas bort ur kön, och poster kan tas bort för hand. Poster äldre än 60 dagar rensas (de innehåller personuppgifter). Sidhuvudet visar "Granska (N)".
- **Bolaget hittat:** tvillingsökning (högst 4 tic.io-anrop) och mejl "Förslag på tvillingar: X (N bolag)" med tabell och Excel-bilaga till mottagarna.
- Samma inskick hanteras en gång (7 dagar), samma bolag får tvillingar högst en gång per 30 dagar (kräver Redis-cachen).
- Mejlet innehåller hela förfrågan (avsändarens namn, e-post, telefon, meddelande) och för varje tvilling kontaktuppgifter ur registren (`lib/kontakt.ts`): beslutsfattare med roll (VD, ordförande, innehavare, delägare, styrelseledamot – från tic.io, aldrig personnummer eller skyddade identiteter), bolagets e-post (egen domän först), telefon och webbplats. Tvillingar från bolagsdataapi får beslutsfattare via ett gemensamt tic.io-anrop (upp till 10 bolag). Företagskontakt (`lib/foretagskontakt.ts`, när `FORETAGSKONTAKT_API_KEY` finns) köper bara det registren saknar: beslutsfattarens personliga e-post + direkttelefon alltid, info@-adressen bara om registren saknade e-post **och** Företagskontakt varken gav personlig e-post eller direkttelefon. Kostnaden per lead loggas (`"steg":"foretagskontakt"`, `kostnad_kr`). Själva API-anropet (`fragaForetagskontakt`) är byggt på antaganden och anpassas när dokumentationen finns.

## Historik — `/historik`, `lib/historik.ts`, `app/api/historik`

Varje körning sparas i Redis i **12 månader**: automatiska (med tvillingar), i verktyget och från Granska. En körning = ett bolag: förfrågan, avsändare, bolaget och tvillingarna med kontaktuppgifter. Nycklar: `historik:korning:<id>` (hela körningen, går ut efter 365 dagar), hashen `historik:samman` (sammanfattningar för listan) och sorted set `historik:index` (tid → id; gamla rensas när listan hämtas).

- **`/historik`** (och `/admin/historik`): lista med sök (bolag, org.nr, avsändare), filter på källa och "bara med tvillingar". *Visa* öppnar körningen med tvillingtabellen och CSV-nedladdning.
- **Redan föreslagna tvillingar märks**, de tas inte bort: varje föreslagen tvilling minns i 90 dagar (`historik:foreslagen:<orgnr>` → datum + vilket bolag den föreslogs till). Föreslås den igen till ett *annat* bolag får raden `tidigare_datum`/`tidigare_kallbolag` och visas som "Föreslogs 3 okt (till SkiStar AB)" i verktyget, mejlet och CSV:n (kolumnen *Föreslogs tidigare*). Datumet pekar på första gången.
- Utan Redis (lokalt) sparas historiken i minnet.

**Mottagare** styrs i adminvyn under *Inställningar* (`/admin/installningar`, `lib/installningar.ts`, Redis-nyckeln `installningar:mottagare`). Är listan aldrig sparad där används `MAIL_TO`. Listan kan aldrig sparas tom.

Mejl skickas via **Resend** från `MAIL_FROM` (en adress på en domän verifierad i Resend). Saknas `RESEND_API_KEY` loggas mejlen bara (torrkörning). Lokalt sparar `MAIL_TORR_MAPP=<mapp>` mejlen som HTML-filer.

## Kundvy och adminvy

- **`/`** — kundens vy. Klartext utan teknik: inga omnämnanden av Jev, tic.io, bolagsdataapi, procent eller SNI-koder. Kundens CSV-export innehåller bara arbetskolumner (bolag, tvilling, likhet, ort, storlek, verksamhet, kontakt, kommentar).
- **`/admin`** — teamets vy, samma flöde plus tekniska detaljer: Jevs säkerhet, klassning med sannolikheter, hur urvalet gjordes, taket för tic.io-anrop, antal anrop och den fullständiga tekniska CSV-exporten. Inloggning på `/admin/login` med **`ADMIN_PASSWORD`** (miljövariabel; saknas den är `/admin` stängd). En admininloggning räcker även för kundvyn.
- Klartexterna för kunden finns i `app/ui/klartext.ts`. Backend skickar koder (`typ_kod`, `hoppa_kod`, `matchning_kod`, `urval_kod`, `status_kod`, `lokal`, `sasong_kod`) som gränssnittet formulerar.

## Gränssnittet — tre steg

1. **Underlag** (`app/ui/Underlag.tsx`): dra in en leadlista, Excel eller CSV (`lib/leadlista.ts` läser den i webbläsaren med SheetJS). Mallen `public/mallar/leadlista-mall.xlsx` har kolumnerna Bolagsnamn, Org.nr, Lokalt bolag, Säsong, Samma storlek och Kommun, med rullistor (de 290 kommunerna ligger på ett dolt blad). Förklaringen `public/mallar/leadlista-forklaring.pdf` skrivs ut ur `docs/leadlista-forklaring.html` med Chrome (kommandot står i filen). CSV får ha komma eller semikolon. En ifylld kommun gör alltid urvalet lokalt och söks som bolagets egen kommun. Formulärexporter och datumval finns inte längre i gränssnittet (`/api/preview` används inte).
2. **Granska** (`app/ui/Granska.tsx`): förfrågningarna i tre grupper — *Föreslås*, *Behöver bolag* (fyll i namn/org.nr eller godta Jevs osäkra förslag med ett klick) och *Hoppas över* (med orsak, går att ta med ändå). Åtgärdsfältet längst ned har taket för tic.io-anrop. Ovanför står hur många tic.io-sökningar listan använder som mest (3 per bolag) mot hur många som är kvar; körningens tak blir aldrig högre än det som är kvar. Inget har sökts i det här steget.
3. **Tvillingar** (`app/ui/Resultat.tsx`): listan skickas till `/api/run` i omgångar om 6 bolag (`OMGANG` i `app/ui/App.tsx`), och servern söker 3 bolag samtidigt (`SAMTIDIGA` i `app/api/run/route.ts`). Testat 2026-10-15: 12 bolag på 59 s, eftersom en körning får hålla på i högst 5 minuter och ett nytt bolag tar 10–60 s. Taket för tic.io delas av alla omgångar, och servern skickar tillbaka vilka bolag som redan sökts (`sokta` → `redan_sokta`) så att dubbletter fångas även mellan omgångarna. Förloppet strömmas (NDJSON, ett bolag i taget) och resultaten visas per bolag med varför det valdes, hur tvillingarna togs fram och tvillingtabellen. Sammanfattning och CSV-nedladdning överst.

Stilar och färger: `app/globals.css` (Optimals röd #EB5F62, Poppins).

## Filstruktur

```
app/
  page.tsx             — stegflödet (underlag → granska → tvillingar)
  ui/                  — stegens komponenter, typer och CSV-export
  globals.css          — design (färger, knappar, kort, tabeller)
  api/preview/route.ts — förhandsgranskning av formulärexporter (inga tic.io-anrop)
  layout.tsx           — global HTML-skal, laddar Poppins-fonten
  login/page.tsx       — inloggningssida
  granska/, historik/  — granskningskön och historiken (även under /admin)
  api/historik         — historiken: lista, eller en körning med ?id=
  api/run/route.ts     — tar emot CSV, kör hela flödet per lead, returnerar resultatrader
  api/login, api/logout — sessions-cookie
lib/
  twinfinder.ts        — all sök-, matchnings- och rankningslogik (se "Flödet" nedan)
  csv.ts               — enkel CSV-parser
  historik.ts          — sparade körningar (12 mån) och redan föreslagna tvillingar (90 dagar)
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
| `SITE_PASSWORD` / `SITE_USERNAME` | Valfritt inloggningsskydd för kundvyn. |
| `ADMIN_PASSWORD` | Lösenord till teamets adminvy (`/admin`). Saknas den är adminvyn stängd. |
| `WEBFLOW_WEBHOOK_SECRET` | Webhookens "secret key" från Webflow (64 tecken). Appen kontrollerar Webflows signatur (`x-webflow-signature`) med den; alternativt godtas samma värde som `?nyckel=` i URL:en. Saknas den tas inga webhooks emot. |
| `RESEND_API_KEY` | Nyckel till Resend för automatiska mejl. |
| `MAIL_FROM` | Avsändare, t.ex. `Tvillinganalys <tvillingar@upstrategylab.com>` (domänen verifierad i Resend). |
| `BOLAGSVERKET_CLIENT_ID`, `BOLAGSVERKET_CLIENT_SECRET` | Bolagsverkets API för värdefulla datamängder (verksamhetsbeskrivningar). Utan dem hämtas beskrivningarna från bolagsdataapi. Kontot stängs efter 6 månader utan användning. |
| `SCB_API_KEY` | SCB:s företagsregister (gratis nyckel via registreraafr.scb.se). Utan den används inte SCB-steget. |
| `MAIL_TO` | Grundinställning för mottagarna, kommaseparerade. Gäller bara tills listan sparats under *Inställningar* i adminvyn. |
| `APP_URL` | Valfri. Länken i mejlen (standard https://tvillinganalys.vercel.app). |

Lokalt: samma variabler i `.env.local` (ignoreras av git). `npx next dev` kör appen mot riktiga API:er — **varje körning drar på tic.io-kvoten.**

## API-budget

| API | Kvot (observerad 2026-10-07) | Används till |
|---|---|---|
| tic.io LENS | **200 anrop/månad**, 120/min, max 20 olika IP per nyckel/månad | tvillingsökning |
| bolagsdataapi.se | **2 500 anrop/dygn** (höjd från 500 i okt 2026, nollställs vid midnatt, gratis) | uppslag av kallbolaget (2 per lead) och tvillingar i första hand (~25 per lead) |
| TypeSafe Jev | ingen praktisk gräns, ~0,03 kr per lead | alla bedömningar |

tic.io-anrop per lead: **0 när bolagsdataapi räcker** (typiskt lokala hantverks- och tjänstebolag), annars ~1–3. Varje körning har ett tak (fältet "Max tic.io-anrop", förval 3 per lead); när taket nås får resterande leads bara tvillingar från bolagsdataapi. Körningen visar och loggar antalet tic.io-anrop.

**Testa utan att röra tic.io-kvoten:** kör med "Max tic.io-anrop" = 0 (eller `max_tic_anrop: 0` mot `/api/run`).

## Flödet per lead

1. **Kallbolaget** (`resolveSourceCompany`): namnsökning hos bolagsdataapi utan bolagsform (SkiStar heter "SkiStar *Aktiebolag*"), Jev väljer rätt träff eller svarar "ingen". Detaljanropet ger verksamhetsbeskrivning, län och SNI. Valfri CSV-kolumn `org_nr` pekar ut bolaget direkt. tic.io:s namnsökning är reserv.
2. **Geografi och säsong** (`guessLeadOptions`): tomma CSV-celler gissas av Jev från verksamhetsbeskrivningen. Ifyllda celler gäller alltid.
3. **Tvillingar** (`findTwins`):
   - Fas 0, bolagsdataapi: Jev väljer ett branschord som konkurrenter brukar ha i bolagsnamnet ("städ", "assistans"), bolagsdataapi söker namn med ordet (+ liknande omsättning). Är bolaget lokalt söks först hela bolagets kommun och kommuner som förfrågan nämner (`lib/kommuner.ts` hittar kommunnamn i texten, t.ex. "Lerums kommun"), sedan hela länet. bolagsdataapi filtrerar bara på postort, så varje kommun blir sina postorter (`lib/postorter.ts`: Lerum → Lerum, Floda, Gråbo, Stenkullen, Sjövik …). Högst 8 orter söks per lead (ett anrop per ort, sparas 180 dagar), varvat mellan kommunerna. Tvillingar i de kommunerna går först i listan, resten fylls på från länet. I klartext: "i Lerums kommun och övriga Västra Götaland". Jev sållar på namnen, de 25 bästa får detaljanrop och full Jev-bedömning. Ger det minst 10 starka tvillingar används inte tic.io alls.
   - Annars tic.io, steg A: alla bolag med samma huvud-SNI, störst först. Antalet avgör läget: **≤ 300 = nischbransch** (de största i branschen tas, storlek väger lätt), **fler = trång bransch** (urval på storlek ⅓×–3×, annars "närmast underifrån").
   - Jev bedömer varje kandidat: hur lik verksamheten är, holding/vilande, samma koncern som kallbolaget, ev. säsong. Koden väger ihop till en poäng.
   - Ger SNI-sökningen färre än 10 starka tvillingar körs en nyckelordssökning på verksamhetsbeskrivningen (Jev väljer ordet) för att fånga bolag med annan SNI-kod.
   - Bara en tvilling per koncern: Jev jämför topp 20 parvis.
4. **Kontaktperson** (foretagskontakt.se, valfri).

Kolumnerna Matchning, Urval, Geografi, Säsong och Likhet visar varför varje val gjordes.

## Kvoter — `lib/kvot.ts`, `/api/kvot`

Båda registren skickar kvoten i svarshuvudena (`x-ratelimit-remaining`, `-limit`, ev. `-reset`). Senaste värdet sparas i Redis (`tic:kvot`, `bd:kvot`) och visas i Granska-steget.

- **tic.io** (200 per period): varje sökning loggar `"steg":"tic-kvot"`; saknas huvudena loggas vilka rate-limit-huvuden som fanns. Körningens tak blir aldrig högre än det som är kvar.
- **bolagsdataapi** (2 500 per dygn, fylls på vid midnatt svensk tid): ett nytt bolag använder upp till ca 25 anrop (`BD_PER_BOLAG`; ca 11–12 i testet med SCB och Bolagsverket), sparade svar inget. En manuell körning startar inte ett nytt bolag om det skulle ta av de 150 anrop per dygn som sparas åt förfrågningarna från webbplatsen (`BD_RESERV`); de bolagen får status "kör igen i morgon". Tar kvoten slut mitt i ett bolag (`BolagsdataSlut`, även vid svar 429) stoppas bolaget i stället för att falla tillbaka på tic.io. Automatiska förfrågningar hamnar då i Granska med orsaken "Dagens sökningar … tog slut".
- **Färre anrop för lokala bolag**: 15 kandidater får detaljanrop först; bara om det ger färre än 10 starka tvillingar hämtas resten (upp till 25) innan tic.io används. Testat 2026-10-13 på fyra lokala bolag: lika många direkta konkurrenter, 24–25 anrop i stället för 35 när 15 räckte.
- **Verksamhetsbeskrivningar från Bolagsverket** (`lib/bolagsverket.ts`, värdefulla datamängder, OAuth2 client credentials med `BOLAGSVERKET_CLIENT_ID`/`_SECRET`, gratis, ingen dygnskvot, 60 anrop/min): alla kandidaters beskrivningar hämtas härifrån (sparas 180 dagar). Är minutens anrop slut (55 per process) hämtas beskrivningen från bolagsdataapi i stället för att vänta. De 10 som blir tvillingar får län och kontaktuppgifter från bolagsdataapi (`fyllDetaljer`). Testat 2026-10-15: samma kvalitet (SkiStar 10 direkta, Rolling Mill Service 7), 11–12 anrop till bolagsdataapi per bolag.
- **Sökordningen** (`findTwins`), billigast först:
  1. **SCB** (`lib/scb.ts`, `SCB_API_KEY`, gratis, ingen kvot): alla aktiva bolag med källbolagets huvudbransch enligt SCB (5 000 per anrop). Lokala bolag: samma län och närmaste orter först. Sedan närmast i storlek (omsättnings- eller anställdaklass) och Jevs namnsållning bland de 300 närmaste. 15 (lokala) eller 25 kandidater får verksamhetsbeskrivning från bolagsdataapi och bedöms av Jev.
  2. **bolagsdataapi, namnsökning** (branschordet i namnet): om SCB gav färre än 10 starka tvillingar. Hittar rätt bolag även när branschkoden är fel.
  3. **Sökning i verksamhetsbeskrivningar** (de tre ord Jev tycker bäst beskriver verksamheten, hos bolagsdataapi): om det fortfarande finns färre än 3 starka.
  4. **tic.io**: bara om det fortfarande finns färre än 3 starka (utan SCB-nyckel: färre än 10, som förut).
  - Tar bolagsdataapi:s dygnskvot slut mitt i sökningen visas SCB:s närmaste bolag i branschen, med telefon och e-post från SCB, märkta "ej bedömd – samma bransch" (verksamhetsbeskrivningarna kunde inte hämtas).
  - Testat 2026-10-13/14 utan tic.io: SkiStar och Branäs 10 direkta konkurrenter (6 av SkiStars samma som tic.io gav); fyra lokala bolag 39 av 40 direkta med ca 16 anrop till bolagsdataapi per bolag (förut 35). Bolag med missvisande branschkod (ett kyllager registrerat som bageri) får fortfarande inga tvillingar; Granska är rätt väg för dem.
  - SCB:s branschlistor sparas i 180 dagar i förkortad form, per län (alla 21 sparas vid första hämtningen) och hela branschen om den har högst 6 000 bolag (större branscher slås ihop av de 21 länsdelarna vid en rikstäckande sökning). Nästa bolag i samma bransch slipper hämta listan (restauranger: 6 anrop, ~20 s).
  - SCB spärrar nyckeln tillfälligt vid för många anrop (429 med Retry-After, ingen fast gräns angiven; hände 2026-10-15 vid tre parallella bolag). Anropen går därför ett i taget (`lib/scb.ts`), och en spärr sparas i Redis (`scb:sparr`) så att alla körningar hoppar över SCB tills den släpper. SCB är dessutom otillgängligt 04:00–04:30 varje natt.
  - Tid per steg loggas som `"steg":"tider"` (ms). Mätt 2026-10-15: SCB-branschlistan och verksamhetsbeskrivningarna tar mest tid, Jev under en sekund.
  - SCB filtrerar på ett villkor i taget och använder i vissa branscher SNI 2025-koder; därför används källbolagets egen kod hos SCB. Reklamspärr (SCB) används inte, se beslut 2026-10-13.
- **Testat och inte infört (2026-10-13)**: sökning i verksamhetsbeskrivningar hos bolagsdataapi i stället för tic.io:s nyckelordssökning. Lika bra för lokala bolag (som inte använder tic.io ändå), sämre för rikstäckande nischbolag (SkiStar). Branschkodssökningen hos SCB är tänkt att ersätta tic.io där.

## Cache mellan körningar — `lib/cache.ts`

tic.io- och bolagsdataapi-svar sparas i **Upstash Redis** (kopplad via Vercel → Storage) i **180 dagar** (`CACHE_DAGAR`). En omkörning av samma leads, eller nya leads i en bransch som redan sökts, kostar då inga tic.io-anrop. Cacheträffar räknas inte mot taket; körningen visar "(+N från cache)".

- Variablerna sätts automatiskt av Vercel (`KV_REST_API_URL`, `KV_REST_API_TOKEN`; även `UPSTASH_REDIS_REST_*` och `CACHE_`-prefix fungerar). Lokalt: lägg samma två i `.env.local`.
- Saknas variablerna eller strular Redis körs allt som vanligt utan cache.
- tic.io-poster trimmas till de fält appen använder innan de sparas (hela poster är flera kB).
- 180 dagar är en avvägning: bokslut uppdateras årligen, men nya bolag startar och andra går i konkurs. Ändra `CACHE_DAGAR` vid behov. Fel cachas aldrig.

## Import av formulärexporter ("inkorgen") — `lib/inkorg.ts`, `app/api/preview`

Läget "Formulärexporter" i appen: ladda upp webbplatsens råa formulärexporter (boka demo, kontaktformulär, kontaktsida, offertförfrågan) och välj period. Två steg:

- **Förhandsgranska** (inga tic.io-anrop): Jev klassar, bolagsdataapi föreslår bolag. Du bockar i vilka som ska tvillingsökas och rättar eller fyller i bolagsnamn/org.nr där Jev är osäker.
- **Kör tvillingsökning** för de valda, inom taket för tic.io-anrop. Testat 2026-10-07 på senaste veckans förfrågningar (17 efter dubblettrensning, 6 tvillingsökta bolag, ~20 tic.io-anrop, 22 s):

1. Koden läser alla fyra formaten, mappar kolumnerna (e-post- och meddelandefälten heter olika i varje export), slår ihop, tar bort dubbletter (samma e-post inom 10 min — samma förfrågan hamnar ofta i två formulär) och väljer datumintervall.
2. Jev klassar varje förfrågan med Optimals erbjudande som kontext: typ (ny förfrågan / befintlig kund / säljer till Optimal / avregistrering / övrigt / oklart), avsändare (företag / förening / offentlig / privatperson) och om det är en mäklare. Klassningen stämde på alla 17 i testet.
3. Bolaget identifieras via bolagsdataapi: ett namn ur meddelandet (Jev väljer bland kandidater som koden plockat ut) eller e-postdomänens stam. Inget säkert → fältet lämnas tomt för användaren. (En tic.io-sökning på webbplats/e-post, `hyperlinks.hyperlink`, fungerar men kostar ett anrop per bolag och togs bort till förmån för manuell ifyllnad.)
4. Bara nya förfrågningar från företag, föreningar och offentliga aktörer går vidare till tvillingsökningen. Privatpersoner, säljare, spam, oklara, utländska avsändare och befintliga kunder hoppas över med orsak. Utländsk = utländsk landsdomän (.de, .no …) eller att Jev bedömer avsändaren som ett utländskt bolag utan svenskt bolag (≥ 80 %, `MIN_UTLANDSK`; engelska eller .com räcker inte, svenska dotterbolag räknas som svenska). Mäklare hoppas över tills vidare (se nedan).
5. En osäker bolagsmatchning (under 70 %) godtas inte när söktermen är gissad ur en förfrågan — då provas nästa sökväg, annars "kontrollera manuellt".

Jev får en kort beskrivning av Optimals erbjudande (från skillsen `optimal-business-context` och `optimal-products`) som kontext, så att "vill köpa" skiljs från "säljer till oss".

Personuppgifter: e-postadresser och telefonnummer rensas ur meddelandet innan det skickas till Jev; bara e-postdomänen skickas.

## Senare: mäklare som tvillingkällor

Mäklare hoppas över i dag. Idé: många små mäklarbyråer är säljbara kunder, men de stora kontoren är nyckelkunder och många använder andra system. Ett framtida läge kan tvillingsöka mäklarförfrågningar men exkludera befintliga kunder (inklusive deras franchisekontor) och större kontor.

## Senare: befintliga kunder som tvillingkällor (separat projekt)

Supportärendena i formulären (fel i order, inloggning, ändra tryckoriginal, blockera adress) avslöjar bolag som redan köper av Optimal. De är sannolikt de bästa källorna för tvillingar — deras tvillingar är nya prospekt av samma slag. Inkorgsimporten klassar dem redan som `befintlig_kund`; i dag hoppas de över. Att använda dem som källor är ett eget projekt, t.ex. en körning över hela historiken (5 000+ förfrågningar sedan 2019) — kräver en större tic.io-kvot eller cachen ovan.

## Kända begränsningar

- tic.io:s filter släpper bara igenom bolag som har fältet: bolag utan omsättning hos tic.io kommer inte med i storleksfiltrerade sökningar.
- tic.io:s nyckelordssökning kräver att alla ord matchar — därför ett enda ord. Ibland väljer Jev ett för allmänt ord (t.ex. "andel" för ett finansbolag) och nyckelordskandidaterna blir svaga.
- bolagsdataapi returnerar ibland SNI 2025-koder; sökningen täcker båda systemen, men bolag som bara har den motsvarande 2007-koden kan missas.
- Vercels tidsgräns är 5 minuter per anrop (`maxDuration = 300`); därför körs listor i omgångar om 3 bolag. Testat 2026-10-15: 12 bolag i 3 omgångar på ca 4 minuter, dubbletter fångades mellan omgångarna.
- Företagskontakt-integrationen är obekräftad (API:t okänt) och misslyckas tyst; köpreglerna är testade med simulerade svar.

## Källor och licenser

- **Postorter per kommun** (`lib/postorter.json`): GeoNames postnummer för Sverige, <https://download.geonames.org/export/zip/SE.zip>, hämtad 2026-10-12, licens [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), www.geonames.org. 287 av 290 kommuner finns med; några postorter ligger i flera kommuner och GeoNames placering är inte alltid exakt (t.ex. Mölnlycke under Mölndal). Uppdatera genom att hämta filen igen och bygga om listan (postorter per kommun, de med flest postnummer först).

# Tvillinganalys — teknisk setup och status

Appen: https://tvillinganalys.vercel.app
Vercel-projekt: `tvillinganalys` (team `team_TVRKbPHDZaAR0OC5etLKu3Il`, projekt-ID `prj_NXmuWF23ntHAu247bWaDz1UKvRxM`)

Ingen GitHub-repo är kopplad än. Koden finns bara lokalt i den här sessionens arbetskatalog och deployas direkt till Vercel (se "Deploy" nedan). Om du vill köra från Claude Code: ladda ner filerna från den här sessionen, lägg dem i en mapp, kör `git init`, skapa en repo på GitHub och pusha. Därefter kan Claude Code jobba mot samma Vercel-projekt med samma deploy-metod, eller du kopplar Git-deploy i Vercel istället.

## Stack

- Next.js 14 (App Router), TypeScript, inga externa npm-paket förutom React/Next.
- Inget CRM, ingen databas. All state är cookies (inloggning) eller körs i minnet per request.
- Deploy: Vercel, utan Git — filerna skickas direkt i deploy-anropet (`create_deployment` med `files`-array, `encoding: utf-8`). Varje deploy måste skicka ALLA filer, inte bara ändrade — annars bryts bygget.
- `projectSettings: { framework: "nextjs" }` måste skickas med i varje deploy. Vercel-projektets egen framework-inställning sparas inte (visar `null` i projektet), troligen pga behörighetsbegränsning på detta Vercel-konto/MCP-koppling.

## Filstruktur

```
app/
  page.tsx            — huvudsidan: klistra in CSV, kör sökning, se resultat, ladda ner CSV, logga ut
  layout.tsx           — global HTML-skal, laddar Poppins-fonten
  login/page.tsx        — inloggningssida (Optimals stil: logga, vit box, röd knapp)
  api/run/route.ts       — tar emot CSV, kör hela sök-flödet, returnerar resultatrader
  api/login/route.ts      — validerar användarnamn/lösenord, sätter sessions-cookie
  api/logout/route.ts      — rensar sessions-cookien
lib/
  twinfinder.ts          — all sök-logik (steg 2–5), portning av twin_finder.py
  csv.ts               — enkel CSV-parser
  auth.ts              — signerar/verifierar sessions-cookien (Web Crypto, funkar i Edge-middleware)
middleware.ts            — skyddar hela appen bakom /login om SITE_PASSWORD är satt
next.config.js, package.json, tsconfig.json, next-env.d.ts — standard Next.js-uppsättning
```

## Miljövariabler (Vercel → Project Settings → Environment Variables)

| Variabel | Krävs för | Status |
|---|---|---|
| `BOLAGSDATA_API_KEY` | Steg 2 — slå upp bolag via namn | Satt, bekräftat fungerande sedan tidigare |
| `TIC_API_KEY` | Steg 3–4 — söka tvillingar | Okänt om den är satt — jag har inte behörighet att lista env-variabler via Vercel MCP just nu (403 Forbidden) |
| `FORETAGSKONTAKT_API_KEY` | Steg 5 — hämta kontaktperson | Valfri. Om den saknas hoppas steget bara över (ingen kontakt, men tvillingen visas) |
| `SITE_PASSWORD` | Inloggningsskydd | Valfri. Om den saknas är appen helt oskyddad |
| `SITE_USERNAME` | Inloggningsskydd | Valfri — om satt krävs både användarnamn och lösenord, annars bara lösenord |

**Viktigast att kontrollera just nu:** att `TIC_API_KEY` faktiskt är satt och giltig. Utan den, eller med en ogiltig nyckel som ändå ger svar från tic.io, kommer sökningen att ge "inga tvillingar hittade" på alla rader utan att visa ett tydligt fel.

## Kända osäkerheter i sök-logiken (ärvt från `twin_finder.py`-planen)

- tic.io-sökningen (fält som `sni_2007Code`, `rs_NetSalesK`, `fn_NumberOfEmployees`, länsfiltret) bygger på tic.io:s publika dokumentation, **aldrig bekräftad mot ett skarpt konto**. Om fältnamnen är fel ger tic.io troligen 0 träffar istället för ett fel — vilket ser ut exakt som "inga tvillingar hittade".
- företagskontakt.se-integrationen är på samma sätt obekräftad, men misslyckas tyst (påverkar inte om en tvilling hittas, bara om kontaktuppgifter visas).

## Statuskolumnen — så läser du en misslyckad körning

Varje rad i resultatet får en status. Vilken status som visas talar om var i kedjan det stannade:

- **"ej hittat"** → bolagsdataapi.se hittade inte företaget på namnet (steg 2 — borde fungera, redan bekräftat)
- **"ingen SNI-kod hittad"** → bolaget hittades men saknar bransch-kod att söka tvillingar på
- **"inga tvillingar hittade"** → tic.io-sökningen (steg 3–4) gav inga träffar — mest troliga platsen för dagens problem
- **"fel vid tic.io-sökning: ..."** → ett riktigt fel från tic.io, t.ex. saknad/ogiltig nyckel — texten efter kolon visar exakt vad
- **"tvilling hittad" / "tvilling hittad (ingen kontakt)"** → fungerade hela vägen, med eller utan kontaktuppgift

**Nästa steg för att felsöka dagens "hittade inget":** vilken av dessa statusar visades i Status-kolumnen för raderna i körningen? Det avgör om problemet är en saknad/fel `TIC_API_KEY`, eller att fält-gissningarna mot tic.io behöver justeras.

## Deploy-process (utan Git)

1. Läs alla filer som ska ingå (hela listan i "Filstruktur" ovan — alltid alla, inte bara ändrade).
2. Anropa Vercel MCP `create_deployment` med `teamId`, `project: "tvillinganalys"`, `target: "production"`, `projectSettings: { framework: "nextjs" }` och hela `files`-arrayen.
3. Polla `get_deployment` tills `readyState` är `READY`.
4. Produktions-URL:en (tvillinganalys.vercel.app) pekar automatiskt om till den senaste READY-deployen.

## Nästa steg

1. Bekräfta att `TIC_API_KEY` är satt i Vercel och giltig.
2. Kör en känd testsökning och läs av statuskolumnen enligt tabellen ovan.
3. Om tic.io ger 0 träffar trots en bekräftat giltig nyckel: fältnamnen i `lib/twinfinder.ts` → `findTwins()` behöver justeras mot tic.io:s faktiska svar (kräver att man loggar/inspekterar ett riktigt svar från deras API).
4. Koppla en GitHub-repo om arbetet ska fortsätta i Claude Code — se anteckning längst upp.

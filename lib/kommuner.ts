// kommuner.ts — Sveriges 290 kommuner, för att hitta orter som nämns i en
// förfrågan ("ett utskick till alla i Lerums kommun"). Ren textmatchning.

export const KOMMUNER = (
  // Stockholm
  "Botkyrka,Danderyd,Ekerö,Haninge,Huddinge,Järfälla,Lidingö,Nacka,Norrtälje,Nykvarn,Nynäshamn,Salem,Sigtuna,Sollentuna,Solna," +
  "Stockholm,Sundbyberg,Södertälje,Tyresö,Täby,Upplands-Bro,Upplands Väsby,Vallentuna,Vaxholm,Värmdö,Österåker," +
  // Uppsala, Södermanland, Östergötland
  "Enköping,Heby,Håbo,Knivsta,Tierp,Uppsala,Älvkarleby,Östhammar," +
  "Eskilstuna,Flen,Gnesta,Katrineholm,Nyköping,Oxelösund,Strängnäs,Trosa,Vingåker," +
  "Boxholm,Finspång,Kinda,Linköping,Mjölby,Motala,Norrköping,Söderköping,Vadstena,Valdemarsvik,Ydre,Åtvidaberg,Ödeshög," +
  // Jönköping, Kronoberg, Kalmar, Gotland, Blekinge
  "Aneby,Eksjö,Gislaved,Gnosjö,Habo,Jönköping,Mullsjö,Nässjö,Sävsjö,Tranås,Vaggeryd,Vetlanda,Värnamo," +
  "Alvesta,Lessebo,Ljungby,Markaryd,Tingsryd,Uppvidinge,Växjö,Älmhult," +
  "Borgholm,Emmaboda,Hultsfred,Högsby,Kalmar,Mönsterås,Mörbylånga,Nybro,Oskarshamn,Torsås,Vimmerby,Västervik," +
  "Gotland," +
  "Karlshamn,Karlskrona,Olofström,Ronneby,Sölvesborg," +
  // Skåne, Halland
  "Bjuv,Bromölla,Burlöv,Båstad,Eslöv,Helsingborg,Hässleholm,Höganäs,Hörby,Höör,Klippan,Kristianstad,Kävlinge,Landskrona,Lomma," +
  "Lund,Malmö,Osby,Perstorp,Simrishamn,Sjöbo,Skurup,Staffanstorp,Svalöv,Svedala,Tomelilla,Trelleborg,Vellinge,Ystad,Åstorp," +
  "Ängelholm,Örkelljunga,Östra Göinge," +
  "Falkenberg,Halmstad,Hylte,Kungsbacka,Laholm,Varberg," +
  // Västra Götaland
  "Ale,Alingsås,Bengtsfors,Bollebygd,Borås,Dals-Ed,Essunga,Falköping,Färgelanda,Grästorp,Gullspång,Göteborg,Götene,Herrljunga," +
  "Hjo,Härryda,Karlsborg,Kungälv,Lerum,Lidköping,Lilla Edet,Lysekil,Mariestad,Mark,Mellerud,Munkedal,Mölndal,Orust,Partille," +
  "Skara,Skövde,Sotenäs,Stenungsund,Strömstad,Svenljunga,Tanum,Tibro,Tidaholm,Tjörn,Tranemo,Trollhättan,Töreboda,Uddevalla," +
  "Ulricehamn,Vara,Vårgårda,Vänersborg,Åmål,Öckerö," +
  // Värmland, Örebro, Västmanland, Dalarna, Gävleborg
  "Arvika,Eda,Filipstad,Forshaga,Grums,Hagfors,Hammarö,Karlstad,Kil,Kristinehamn,Munkfors,Storfors,Sunne,Säffle,Torsby,Årjäng," +
  "Askersund,Degerfors,Hallsberg,Hällefors,Karlskoga,Kumla,Laxå,Lekeberg,Lindesberg,Ljusnarsberg,Nora,Örebro," +
  "Arboga,Fagersta,Hallstahammar,Kungsör,Köping,Norberg,Sala,Skinnskatteberg,Surahammar,Västerås," +
  "Avesta,Borlänge,Falun,Gagnef,Hedemora,Leksand,Ludvika,Malung-Sälen,Mora,Orsa,Rättvik,Smedjebacken,Säter,Vansbro,Älvdalen," +
  "Bollnäs,Gävle,Hofors,Hudiksvall,Ljusdal,Nordanstig,Ockelbo,Ovanåker,Sandviken,Söderhamn," +
  // Norrland
  "Härnösand,Kramfors,Sollefteå,Sundsvall,Timrå,Ånge,Örnsköldsvik," +
  "Berg,Bräcke,Härjedalen,Krokom,Ragunda,Strömsund,Åre,Östersund," +
  "Bjurholm,Dorotea,Lycksele,Malå,Nordmaling,Norsjö,Robertsfors,Skellefteå,Sorsele,Storuman,Umeå,Vilhelmina,Vindeln,Vännäs,Åsele," +
  "Arjeplog,Arvidsjaur,Boden,Gällivare,Haparanda,Jokkmokk,Kalix,Kiruna,Luleå,Pajala,Piteå,Älvsbyn,Överkalix,Övertorneå"
).split(",");

// Kommunnamn som också är vanliga ord eller förnamn räknas bara med "kommun" efter.
const KRAVER_KOMMUN = new Set(["Ale", "Mark", "Vara", "Berg", "Kil", "Eda", "Nora", "Salem", "Mora", "Sala", "Habo", "Orsa", "Hjo"]);

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const MONSTER = KOMMUNER.map((k) => ({
  namn: k,
  // Versal krävs (namn, inte ord), genitiv-s tillåts: "Lerums kommun".
  re: new RegExp(`(?<!\\p{L})${esc(k)}s?(?!\\p{L})${KRAVER_KOMMUN.has(k) ? "\\s+[Kk]ommun" : ""}`, "u"),
}));

// Kommuner som nämns i texten, i den ordning de står.
export function kommunerIText(text: string | null | undefined): string[] {
  if (!text) return [];
  return MONSTER.map(({ namn, re }) => ({ namn, i: text.search(re) }))
    .filter((x) => x.i >= 0)
    .sort((a, b) => a.i - b.i)
    .map((x) => x.namn);
}

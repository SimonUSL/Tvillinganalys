// Minimal CSV-parser (hanterar citattecken med kommatecken inuti, t.ex. en
// "anteckning"-kolumn). Inte en fullständig RFC4180-parser, men räcker för
// vår enkla leads.csv.

// Svenskt Excel sparar CSV med semikolon - avgränsaren gissas från rubrikraden.
export function parseCsv(text: string): Record<string, string>[] {
  return raderTillPoster(parseCsvRader(text));
}

export function parseCsvRader(text: string): string[][] {
  const forsta = text.replace(/^\uFEFF/, "").split("\n")[0] || "";
  const sep = (forsta.match(/;/g) || []).length > (forsta.match(/,/g) || []).length ? ";" : ",";
  return splitCsvLines(text.replace(/^\uFEFF/, ""), sep);
}

// Rubrikrad + rader -> en post per rad, nycklad på rubrikerna.
export function raderTillPoster(rows: string[][]): Record<string, string>[] {
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cols) => {
    const row: Record<string, string> = {};
    header.forEach((key, i) => {
      row[key] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

function splitCsvLines(text: string, sep = ","): string[][] {
  const lines: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, "\n");

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized[i];
    if (inQuotes) {
      if (c === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === sep) {
        row.push(field);
        field = "";
      } else if (c === "\n") {
        row.push(field);
        field = "";
        if (row.some((v) => v.trim() !== "")) lines.push(row);
        row = [];
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    if (row.some((v) => v.trim() !== "")) lines.push(row);
  }
  return lines;
}

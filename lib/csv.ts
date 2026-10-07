// Minimal CSV-parser (hanterar citattecken med kommatecken inuti, t.ex. en
// "anteckning"-kolumn). Inte en fullständig RFC4180-parser, men räcker för
// vår enkla leads.csv.

export function parseCsv(text: string): Record<string, string>[] {
  const rows = splitCsvLines(text);
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

function splitCsvLines(text: string): string[][] {
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
      } else if (c === ",") {
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

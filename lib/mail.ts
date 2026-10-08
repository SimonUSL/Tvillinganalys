// mail.ts — skickar mejl via Resend (https://resend.com). Avsändaren är en
// adress på en domän som verifierats i Resend (MAIL_FROM). Saknas
// RESEND_API_KEY skickas inget; mejlet loggas i stället (torrkörning).

export interface Mejl {
  till: string[];
  amne: string;
  html: string;
  bilagor?: { filnamn: string; innehall: string }[]; // innehåll som text
}

export const mottagare = () =>
  (process.env.MAIL_TO || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.includes("@"));

export async function skickaMejl(m: Mejl): Promise<{ skickat: boolean; fel?: string }> {
  const nyckel = process.env.RESEND_API_KEY;
  const fran = process.env.MAIL_FROM;
  if (!nyckel || !fran || !m.till.length) {
    console.log(JSON.stringify({ steg: "mejl (torrkörning)", till: m.till, amne: m.amne, html_langd: m.html.length }));
    // Lokalt: MAIL_TORR_MAPP sparar mejlet som HTML-fil för granskning.
    if (process.env.MAIL_TORR_MAPP) {
      const { writeFileSync } = await import("fs");
      writeFileSync(`${process.env.MAIL_TORR_MAPP}/${Date.now()}.html`, m.html);
    }
    return { skickat: false, fel: "RESEND_API_KEY, MAIL_FROM eller MAIL_TO saknas" };
  }
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${nyckel}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: fran,
      to: m.till,
      subject: m.amne,
      html: m.html,
      attachments: (m.bilagor || []).map((b) => ({
        filename: b.filnamn,
        content: Buffer.from(b.innehall, "utf8").toString("base64"),
      })),
    }),
  });
  if (!resp.ok) {
    const fel = `Resend ${resp.status}: ${(await resp.text()).slice(0, 200)}`;
    console.log(JSON.stringify({ steg: "mejl", fel }));
    return { skickat: false, fel };
  }
  console.log(JSON.stringify({ steg: "mejl skickat", till: m.till, amne: m.amne }));
  return { skickat: true };
}

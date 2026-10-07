// Enkel sessions-signering med Web Crypto (fungerar i Next.js Edge-middleware,
// till skillnad från Node:s "crypto"-modul). Används för att teckna/verifiera
// en inloggnings-cookie utan någon databas.

const enc = new TextEncoder();

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

export async function createSessionToken(username: string, secret: string): Promise<string> {
  const payload = btoa(username || "");
  const sig = await sign(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  secret: string
): Promise<boolean> {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [payload, sig] = parts;
  const expected = await sign(secret, payload);
  return expected === sig;
}

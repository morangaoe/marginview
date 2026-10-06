import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

function key(): Buffer {
  const b = Buffer.from(process.env.ENCRYPTION_KEY ?? "", "base64");
  if (b.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64 encoded");
  return b;
}

/** AES-256-GCM. Output: iv.tag.ciphertext (base64 parts). */
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  // BUG FIX: validate the payload has exactly 3 base64 parts before
  // destructuring. A malformed or tampered string would otherwise crash
  // with a TypeError from Buffer.from(undefined).
  const parts = payload.split(".");
  if (parts.length !== 3) throw new Error("Malformed encrypted payload");
  const [iv, tag, enc] = parts.map((p) => Buffer.from(p, "base64"));
  if (!iv.length || !tag.length || !enc.length) throw new Error("Malformed encrypted payload");
  const d = createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

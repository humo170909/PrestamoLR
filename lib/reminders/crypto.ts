import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/** Cifrado AES-256-GCM para secretos en reposo. Formato: iv.tag.datos (base64). Solo servidor. */
function keyFrom(hex: string | undefined): Buffer {
  if (!hex || !/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("TELEGRAM_ENCRYPTION_KEY debe ser 64 caracteres hexadecimales (32 bytes).");
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string, hexKey = process.env.TELEGRAM_ENCRYPTION_KEY): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", keyFrom(hexKey), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

export function decryptSecret(blob: string, hexKey = process.env.TELEGRAM_ENCRYPTION_KEY): string {
  const [iv, tag, data] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  if (!iv || !tag || !data) throw new Error("Secreto con formato inválido.");
  const d = createDecipheriv("aes-256-gcm", keyFrom(hexKey), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(data), d.final()]).toString("utf8");
}

export const hasEncryptionKey = () => /^[0-9a-fA-F]{64}$/.test(process.env.TELEGRAM_ENCRYPTION_KEY ?? "");

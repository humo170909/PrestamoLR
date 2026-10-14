/**
 * Logs estructurados mínimos (una línea JSON por evento) para Vercel Logs. Módulo puro y sin dependencias de Next:
 * se usa en rutas API, en el middleware y en `lib/reminders`.
 * NUNCA registra tokens, claves, DNI ni teléfonos: se redacta por nombre de campo y se depura el texto libre.
 */
import { maskChat } from "./reminders/mask.ts";

export type LogLevel = "info" | "warn" | "error";

const SECRET_KEY = /token|secret|password|passwd|authorization|api[-_]?key|service[-_]?role|encryption|cookie|bearer/i;
const PII_KEY = /^(dni|document(_id)?|phone|telefono|tel|full_name|client_?name|name|address|direccion|email|correo)$/i;
const CHAT_KEY = /chat/i;

/** Depura texto libre: tokens de bot, JWT, Bearer, claves hexadecimales largas, correos y números largos (DNI, teléfonos, chat ids). */
export function scrubText(s: string): string {
  return s
    .replace(/\b\d{6,12}:[A-Za-z0-9_-]{30,}/g, "[token]")
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{4,}/g, "[jwt]")
    .replace(/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [redactado]")
    .replace(/\b[0-9a-fA-F]{40,}\b/g, "[clave]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[correo]")
    .replace(/-?\b\d{8,13}\b/g, "[nro]")
    .slice(0, 500);
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) return scrubText(value.message);
  if (typeof value === "string") return scrubText(value);
  if (typeof value !== "object") return value;
  if (depth >= 3) return "[…]";
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(k) || PII_KEY.test(k)) out[k] = "[redactado]";
    else if (CHAT_KEY.test(k) && v !== null && v !== undefined) out[k] = Array.isArray(v) ? v.map((c) => maskChat(String(c))) : maskChat(String(v));
    else out[k] = redact(v, depth + 1);
  }
  return out;
}

export function logEvent(level: LogLevel, event: string, fields: Record<string, unknown> = {}): void {
  try {
    const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(fields) as Record<string, unknown>) });
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
  } catch {
    /* el registro nunca debe romper la operación */
  }
}

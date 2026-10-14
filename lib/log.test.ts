// M-09: logs estructurados mínimos que NUNCA incluyen tokens, claves, DNI ni teléfonos completos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { logEvent, redact, scrubText } from "./log.ts";

const TOKEN = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const capture = (fn: () => void) => {
  const out: { level: string; line: string }[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  console.log = (l: string) => out.push({ level: "info", line: l });
  console.warn = (l: string) => out.push({ level: "warn", line: l });
  console.error = (l: string) => out.push({ level: "error", line: l });
  try { fn(); } finally { Object.assign(console, orig); }
  return out;
};

test("cada evento es una línea JSON con fecha, nivel y nombre", () => {
  const [o] = capture(() => logEvent("error", "cron_failed", { job: "morning", sent: 2 }));
  const j = JSON.parse(o.line);
  assert.equal(o.level, "error");
  assert.equal(j.event, "cron_failed"); assert.equal(j.level, "error"); assert.equal(j.job, "morning"); assert.equal(j.sent, 2);
  assert.ok(!Number.isNaN(Date.parse(j.ts)));
});

test("se redactan tokens, claves y secretos por nombre de campo y por contenido", () => {
  const r = JSON.stringify(redact({
    token: TOKEN, bot_token_enc: "abc", service_role_key: "k", CRON_SECRET: "s", authorization: "Bearer xyz", password: "p",
    detail: `fallo con ${TOKEN} y Bearer abc.def.ghi y ${"ab".repeat(32)} y eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firmafirma`,
  }));
  for (const bad of [TOKEN, "Bearer abc", "ab".repeat(32), "eyJhbGciOiJIUzI1NiJ9"]) assert.ok(!r.includes(bad), `filtra ${bad}`);
});

test("DNI, teléfono, nombre y dirección no se registran; el chat solo con sus últimos 4 dígitos", () => {
  const r = JSON.stringify(redact({ dni: "12345678", document_id: "12345678", phone: "987654321", full_name: "Jorge Ramírez", address: "Av. X 123", chat_id: "-1001234567890", note: "cliente 12345678 tel 987654321" }));
  for (const bad of ["12345678", "987654321", "Jorge", "Av. X", "1001234567890"]) assert.ok(!r.includes(bad), `filtra ${bad}`);
  assert.ok(r.includes("••••7890"));
});

test("los Error se registran por su mensaje depurado (sin pila ni token)", () => {
  const [o] = capture(() => logEvent("error", "x", { err: new Error(`HTTP 401 con ${TOKEN}`) }));
  assert.ok(!o.line.includes(TOKEN)); assert.ok(o.line.includes("HTTP 401"));
});

test("scrubText conserva fechas y cantidades normales", () => {
  assert.equal(scrubText("pago de 150.00 el 2026-10-12, 3 intentos"), "pago de 150.00 el 2026-10-12, 3 intentos");
});

test("un fallo del propio logger nunca lanza", () => {
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.doesNotThrow(() => capture(() => logEvent("info", "ciclo", circular)));
});

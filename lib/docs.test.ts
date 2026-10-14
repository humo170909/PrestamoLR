// B-08: docs/ARQUITECTURA.md no puede contradecir el código (discrepancias D1–D9 de la auditoría).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const doc = fs.readFileSync(new URL("docs/ARQUITECTURA.md", root), "utf8");
const migrations = fs.readdirSync(new URL("supabase/migrations/", root)).filter((f) => f.endsWith(".sql")).sort();

test("D1: el número de migraciones y la lista coinciden con supabase/migrations", () => {
  assert.match(doc, new RegExp(`\\b${migrations.length} migraciones\\b`), `debe decir "${migrations.length} migraciones"`);
  for (const m of migrations) assert.ok(doc.includes(m.replace(/\.sql$/, "").replace(/^\d+_/, "")) || doc.includes(m.slice(0, 14)), `falta la migración ${m}`);
  assert.doesNotMatch(doc, /46 comprobaciones/);
});

test("D2: la devolución de capital se describe como imputación al capital programado más antiguo, no 'al vencimiento final'", () => {
  assert.doesNotMatch(doc, /se imputa al vencimiento final/i);
  assert.match(doc, /m[aá]s antiguo/i);
});

test("D3: no afirma que las migraciones carecen de DROP/DELETE (hay DROP FUNCTION/VIEW/TRIGGER/CONSTRAINT y UPDATE de relleno)", () => {
  assert.doesNotMatch(doc, /sin DROP\/DELETE/i);
  assert.match(doc, /DROP FUNCTION/);
});

test("D4: el interés del préstamo abierto se calcula sobre el capital pendiente", () => {
  assert.match(doc, /abierto[^\n]*capital pendiente|capital pendiente[^\n]*abierto/i);
});

test("D6: describe cómo se pagina (conteo exacto, tope de 1 000 filas del servidor)", () => {
  assert.match(doc, /1\s?000 filas/);
  assert.match(doc, /paginad/i);
});

test("D8: documenta TODAS las variables de .env.example y marca SUPABASE_SERVICE_ROLE_KEY como obligatoria", () => {
  const vars = fs.readFileSync(new URL(".env.example", root), "utf8").split(/\r?\n/).map((l) => /^([A-Z][A-Z0-9_]+)=/.exec(l)?.[1]).filter(Boolean) as string[];
  assert.ok(vars.length >= 9);
  for (const v of vars) assert.ok(doc.includes(v), `ARQUITECTURA.md no menciona ${v}`);
  assert.match(doc, /SUPABASE_SERVICE_ROLE_KEY[^\n]*obligatoria/i);
});

test("D9: avisa de que Vercel Hobby no garantiza la hora exacta del cron", () => {
  assert.match(doc, /Hobby[^\n]*(hora exacta|aproximad|ventana)/i);
});

test("incluye los cambios de los lotes 1 y 2: 503 sin cerrar sesión, CSP en modo informe, logs y alerta del cron, menú por rol", () => {
  for (const re of [/503/, /Report-Only/i, /csp-report/, /notification_runs/, /por rol/i, /is_unpaid/]) assert.match(doc, re, String(re));
});

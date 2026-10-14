// M-04: Content-Security-Policy en modo Report-Only (sin romper Next, framer-motion ni recharts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCsp, summarizeCspReport } from "./csp.ts";

const directives = (csp: string) => Object.fromEntries(csp.split(";").map((d) => d.trim()).filter(Boolean).map((d) => { const [k, ...v] = d.split(/\s+/); return [k, v]; }));

test("política base: solo mismo origen + el origen de Supabase para conexiones; sin plugins ni marcos ajenos", () => {
  const d = directives(buildCsp("https://abcd1234.supabase.co"));
  assert.deepEqual(d["default-src"], ["'self'"]);
  assert.ok(d["connect-src"].includes("'self'") && d["connect-src"].includes("https://abcd1234.supabase.co"));
  assert.deepEqual(d["object-src"], ["'none'"]);
  assert.deepEqual(d["frame-ancestors"], ["'none'"]);
  assert.deepEqual(d["base-uri"], ["'self'"]);
  assert.deepEqual(d["form-action"], ["'self'"]);
  assert.ok(d["report-uri"].includes("/api/csp-report"));
});

test("compatible con Next (scripts en línea), framer-motion y recharts (estilos en línea) e imágenes data:/blob:", () => {
  const d = directives(buildCsp("https://x.supabase.co"));
  assert.ok(d["script-src"].includes("'self'") && d["script-src"].includes("'unsafe-inline'"), "Next inyecta scripts en línea");
  assert.ok(d["style-src"].includes("'unsafe-inline'"), "framer-motion y recharts usan style=...");
  assert.ok(d["img-src"].includes("data:") && d["img-src"].includes("blob:"));
  assert.ok(d["font-src"].includes("data:"));
});

test("nunca permite eval ni orígenes comodín", () => {
  const csp = buildCsp("https://x.supabase.co");
  assert.ok(!csp.includes("unsafe-eval"));
  assert.ok(!/\s\*(\s|;|$)/.test(csp), "comodín *");
});

test("sin URL de Supabase o con una URL inválida no rompe y solo permite el propio origen", () => {
  for (const u of [undefined, "", "no es una url"]) assert.deepEqual(directives(buildCsp(u))["connect-src"], ["'self'"]);
});

test("un resumen de informe CSP conserva directiva y destino bloqueado, y descarta lo demás", () => {
  const body = { "csp-report": { "violated-directive": "script-src-elem", "blocked-uri": "https://evil.example/x.js?token=abc", "document-uri": "https://app.example/prestamos?loan=123456789", "source-file": "https://app.example/_next/a.js", "original-policy": "default-src 'self'; ..." } };
  const s = summarizeCspReport(body);
  assert.equal(s.directive, "script-src-elem");
  assert.ok(s.blocked.startsWith("https://evil.example/x.js"));
  assert.ok(!JSON.stringify(s).includes("token=abc"), "sin query string");
  assert.ok(!JSON.stringify(s).includes("123456789"), "sin identificadores de la URL del documento");
  assert.equal(summarizeCspReport(null).directive, "desconocida");
  assert.equal(summarizeCspReport("basura").directive, "desconocida");
});

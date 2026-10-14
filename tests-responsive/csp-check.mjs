// M-04 / I-02 / I-03 contra la app compilada y el mock. Uso: PW_CHANNEL=chrome node tests-responsive/csp-check.mjs  (salida 1 si algo falla)
//  - cabecera Content-Security-Policy-Report-Only presente y sin X-Powered-By
//  - /api/* sin sesión → 401 JSON (no 307)
//  - recorrer las 14 pantallas con sesión SIN violaciones de CSP en consola ni errores de página (Next, framer-motion, recharts)
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3100";
const ROUTES = ["/dashboard", "/nuevo-prestamo", "/prestamos", "/simulador", "/registro-pagos", "/morosidad", "/clientes", "/caja", "/trabajadores", "/reportes", "/auditoria", "/usuarios", "/configuracion"];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
let fail = 0;
const check = (name, ok, detail) => { if (!ok) fail++; console.log(`${ok ? "OK   " : "FALLA"} ${name} — ${detail}`); };

const ctx = await browser.newContext();
const page = await ctx.newPage();
const violations = [], pageErrors = [];
page.on("console", (m) => { if (/Content Security Policy|\[Report Only\]/i.test(m.text())) violations.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => pageErrors.push(e.message.slice(0, 160)));

// cabeceras y API sin sesión (contexto sin cookies)
const anon = await (await browser.newContext()).request;
const login = await anon.get(BASE + "/", { maxRedirects: 0 });
const h = login.headers();
check("Content-Security-Policy-Report-Only presente", !!h["content-security-policy-report-only"], (h["content-security-policy-report-only"] ?? "ausente").slice(0, 90) + "…");
check("No se envía Content-Security-Policy bloqueante todavía (modo informe)", !h["content-security-policy"], h["content-security-policy"] ?? "ausente");
check("X-Powered-By ausente", h["x-powered-by"] === undefined, h["x-powered-by"] ?? "ausente");
for (const [method, path] of [["POST", "/api/admin/users"], ["POST", "/api/admin/telegram"], ["POST", "/api/notify/payment"], ["GET", "/api/admin/telegram"]]) {
  const r = await anon.fetch(BASE + path, { method, data: {}, maxRedirects: 0 });
  let body = ""; try { body = JSON.stringify(await r.json()); } catch { body = "(no JSON)"; }
  check(`${method} ${path} sin sesión → 401 JSON`, r.status() === 401 && /No autenticado/.test(body), `estado ${r.status()} ${body.slice(0, 60)}`);
}
const dash = await anon.get(BASE + "/dashboard", { maxRedirects: 0 });
check("Las páginas sin sesión siguen redirigiendo al login", dash.status() === 307, `estado ${dash.status()}`);
const rep = await anon.post(BASE + "/api/csp-report", { data: { "csp-report": { "violated-directive": "script-src", "blocked-uri": "https://x.example/a.js?t=1" } }, headers: { "content-type": "application/csp-report" } });
check("/api/csp-report es pública y responde 204", rep.status() === 204, `estado ${rep.status()}`);

// recorrido con sesión
await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill('input[name="email"]', "admin@lromero.test");
await page.fill('input[type="password"]', "Prueba12345");
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 20000 });
for (const r of ROUTES) { await page.goto(BASE + r, { waitUntil: "networkidle" }); await page.waitForTimeout(500); }
await page.goto(BASE + "/prestamos?loan=11111111-1111-1111-1111-111111111111", { waitUntil: "networkidle" });
await page.waitForTimeout(600);
check(`Sin violaciones de CSP en ${ROUTES.length + 2} pantallas (incluye gráficos y animaciones)`, violations.length === 0, violations.length ? [...new Set(violations)].slice(0, 3).join(" | ") : "0 violaciones");
check("Sin errores de JavaScript en esas pantallas", pageErrors.length === 0, pageErrors.join(" | ") || "0 errores");

await browser.close();
process.exit(fail ? 1 : 0);

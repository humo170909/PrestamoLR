// A-03: con más de 1 000 filas en el servidor, ninguna lista ni reporte puede truncarse en silencio.
// Uso (ver README): MOCK_BIG=2500 node tests-responsive/mock-supabase.mjs &  (compilar y arrancar la app contra el mock)  &&  node tests-responsive/big-lists.mjs
// Salida: una línea por comprobación y código de salida 1 si alguna falla.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3100";
const BIG = Number(process.env.MOCK_BIG ?? 2500);
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
let fail = 0;
const check = (name, ok, detail) => { if (!ok) fail++; console.log(`${ok ? "OK   " : "FALLA"} ${name} — ${detail}`); };
const go = async (path) => { await page.goto(BASE + path, { waitUntil: "networkidle" }); await page.waitForTimeout(1200); };

await page.goto(BASE + "/", { waitUntil: "networkidle" });
await page.fill('input[name="email"]', "admin@lromero.test");
await page.fill('input[type="password"]', "Prueba12345");
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 20000 });

// Lista de préstamos: una tarjeta por préstamo (4 de demostración + BIG)
await go("/prestamos");
const cards = await page.locator('[id^="loan-"]').count();
const loanNotice = await page.getByText(/La lista está incompleta/).count();
check("Lista de préstamos muestra todos", cards === BIG + 4, `${cards} tarjetas de ${BIG + 4} esperadas; aviso de truncamiento=${loanNotice}`);

// Clientes: la tabla informa "N registros"
await go("/clientes");
const clientsText = await page.getByText(/registros · página/).first().innerText().catch(() => "");
const n = Number((clientsText.match(/(\d+) registros/) ?? [])[1] ?? 0);
check("Clientes: todos cargados", n === BIG + 15, `"${clientsText}" (esperados ${BIG + 15})`);

// Nuevo préstamo: el selector de clientes contiene al último cliente (el 2 515.º por nombre)
await go("/nuevo-prestamo");
const opts = await page.locator("select").first().locator("option").count();
const hasLast = await page.locator("select").first().locator("option", { hasText: `Cliente masivo ${BIG}` }).count();
check("Nuevo préstamo: el selector encuentra a cualquier cliente", hasLast === 1, `${opts} opciones; ¿incluye 'Cliente masivo ${BIG}'? ${hasLast}`);

// Registro de pagos: el selector incluye todos los préstamos vigentes
await go("/registro-pagos");
const loanOpts = await page.locator("select").first().locator("option").count();
check("Registro de pagos: todos los préstamos vigentes en el selector", loanOpts >= BIG, `${loanOpts} opciones (≥ ${BIG})`);

// Reportes: carga completa y sin avisos de conciliación con report_totals()
await go("/reportes");
const alert = (await page.getByRole("alert").allInnerTexts()).filter((t) => t.trim());
check("Reportes: datos completos y conciliados con report_totals()", alert.length === 0, alert.length ? alert.join(" | ").slice(0, 300) : "sin avisos");
await page.getByRole("tab", { name: "Préstamos otorgados" }).click();
const rep = await page.locator("tbody tr").count();
check("Reportes: la tabla de préstamos incluye todas las filas", rep === BIG + 4, `${rep} filas de ${BIG + 4}`);

await browser.close();
process.exit(fail ? 1 : 0);

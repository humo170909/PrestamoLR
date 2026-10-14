// B-09: la campana de alertas del administrador avisa si el cron de recordatorios no se ejecutó hoy (Lima) pasadas las 09:00.
// Uso (app compilada contra tests-responsive/mock-supabase.mjs): PW_CHANNEL=chrome node tests-responsive/alerts-check.mjs
// Nota: la regla depende de la hora real de Lima; antes de las 09:00 la alerta nunca aparece (ver lib/reminders/health.test.ts).
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3100", MOCK = "http://127.0.0.1:54399";
const limaHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", hour12: false }).format(new Date())) % 24;
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
let fail = 0;
const check = (name, ok, detail) => { if (!ok) fail++; console.log(`${ok ? "OK   " : "FALLA"} ${name} — ${detail}`); };

async function bellText(mode) {
  await fetch(`${MOCK}/__runs?mode=${mode}`);
  const page = await (await browser.newContext()).newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "admin@lromero.test");
  await page.fill('input[type="password"]', "Prueba12345");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.getByRole("button", { name: /^Alertas/ }).click();
  await page.waitForTimeout(400);
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ");
  await page.context().close();
  return text;
}

if (limaHour < 9) {
  console.log(`OMITIDA: son las ${limaHour}:xx en Lima (antes de las 09:00 la alerta no aparece por diseño).`);
} else {
  const without = await bellText("empty");
  check("Sin ejecuciones hoy: aparece la alerta del cron", /Los recordatorios de hoy no se ejecutaron/.test(without), "campana abierta");
  const withRun = await bellText("today");
  check("Con una ejecución hoy: NO aparece", !/Los recordatorios de hoy no se ejecutaron/.test(withRun), "campana abierta");
}
await fetch(`${MOCK}/__runs?mode=today`);
await browser.close();
process.exit(fail ? 1 : 0);

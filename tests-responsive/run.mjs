import { chromium } from "playwright";
import fs from "node:fs";

const BASE = "http://127.0.0.1:3100";
const WIDTHS = (process.env.WIDTHS ?? "320,360,390,430,768,1024,1280,1440").split(",").map(Number);
const OUT = process.env.OUT ?? "shots";
fs.mkdirSync(OUT, { recursive: true });
const LOAN = "11111111-1111-1111-1111-111111111111";
const ROUTES = [
  ["dashboard", "/dashboard"], ["nuevo-prestamo", "/nuevo-prestamo"], ["simulador", "/simulador"], ["prestamos", "/prestamos"],
  ["detalle", `/prestamos?loan=${LOAN}`], ["pagos", `/registro-pagos?loan=${LOAN}`], ["morosidad", "/morosidad"], ["clientes", "/clientes"],
  ["caja", "/caja"], ["trabajadores", "/trabajadores"], ["reportes", "/reportes"], ["auditoria", "/auditoria"], ["usuarios", "/usuarios"], ["configuracion", "/configuracion"],
];

// Mide desbordes: el documento no debe tener scroll horizontal y ningún elemento visible debe salirse de la pantalla
// salvo dentro de un contenedor con scroll propio (overflow-x auto/scroll/hidden).
const MEASURE = () => {
  const vw = document.documentElement.clientWidth;
  const clipped = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true; } return false; };
  const bad = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !clipped(el)) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} «${(el.textContent || "").trim().slice(0, 30)}» r=${Math.round(r.right)}`);
  }
  const small = [];
  for (const el of document.querySelectorAll("main button, main a[href], main input:not([type=checkbox]):not([type=hidden]), main select, header button")) {
    const cs = getComputedStyle(el); if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect(); if (r.width === 0) continue;
    if (r.height < 36) small.push(`${el.tagName.toLowerCase()} «${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 25)}» h=${Math.round(r.height)}`);
  }
  const tiny = [...document.querySelectorAll("main *")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 11).length;
  return { pageOverflow: document.documentElement.scrollWidth - vw, bad: bad.slice(0, 6), badCount: bad.length, small: small.slice(0, 6), smallCount: small.length, tiny };
};

const browser = await chromium.launch();
const report = [];
for (const w of WIDTHS) {
  const mobile = w <= 768;
  const ctx = await browser.newContext({ viewport: { width: w, height: 800 }, hasTouch: mobile, isMobile: false, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource.*(404|406)/.test(m.text())) errors.push(m.text().slice(0, 140)); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 140)));

  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const loginM = await page.evaluate(MEASURE);
  report.push({ w, route: "login", ...loginM });
  await page.fill('input[name="email"]', "admin@lromero.test");
  await page.fill('input[type="password"]', "Prueba12345");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });

  for (const [name, path] of ROUTES) {
    await page.goto(BASE + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    if (name === "detalle") { const b = page.getByRole("button", { name: /Ver cronograma/ }); if (await b.count()) await b.click(); await page.waitForTimeout(200); }
    const m = await page.evaluate(MEASURE);
    report.push({ w, route: name, ...m });
    if (w === 360 || w === 1280 || (w === 320 && ["pagos", "detalle", "reportes"].includes(name))) await page.screenshot({ path: `${OUT}/${name}-${w}.png`, fullPage: false });
  }

  // Menú móvil / tablet: se abre, se puede cerrar y navegar
  if (w < 1024) {
    await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
    const open = page.getByRole("button", { name: "Abrir menú" });
    await open.click(); await page.waitForTimeout(450);
    const nav = page.getByRole("navigation", { name: "Principal" });
    const box = await nav.boundingBox();
    const opened = !!box && box.x >= -1 && box.x + box.width <= w + 1;
    await page.screenshot({ path: `${OUT}/menu-${w}.png` });
    await page.getByRole("link", { name: "Clientes" }).first().click();
    await page.waitForURL(/clientes/); await page.waitForTimeout(500);
    const closed = (await page.getByRole("navigation", { name: "Principal" }).count()) === 0;
    // abrir y cerrar con la X
    await page.getByRole("button", { name: "Abrir menú" }).click(); await page.waitForTimeout(400);
    await page.getByRole("button", { name: "Cerrar menú" }).click(); await page.waitForTimeout(450);
    const closedX = (await page.getByRole("navigation", { name: "Principal" }).count()) === 0;
    report.push({ w, route: "MENÚ", menuOpened: opened, closesAfterNav: closed, closesWithX: closedX });
  }

  // Modal de edición de cliente y de eliminación de préstamo: caben en pantalla y los botones son accesibles
  const modalChecks = async (label, trigger, btnNames) => {
    await trigger(); await page.waitForTimeout(400);
    const dlg = page.getByRole("dialog");
    if (!(await dlg.count())) { report.push({ w, route: label, modal: "NO ABRE" }); return; }
    const r = await dlg.boundingBox();
    const btns = [];
    for (const n of btnNames) { const b = dlg.getByRole("button", { name: n }); const bb = (await b.count()) ? await b.first().boundingBox() : null; btns.push(!!bb && bb.y >= 0 && bb.y + bb.height <= 800 && bb.x >= 0 && bb.x + bb.width <= w + 1); }
    report.push({ w, route: label, modalFits: r.y >= -1 && r.y + r.height <= 801 && r.x >= -1 && r.x + r.width <= w + 1, buttonsVisible: btns.every(Boolean) });
    if (w === 360) await page.screenshot({ path: `${OUT}/modal-${label}-${w}.png` });
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  };
  await page.goto(BASE + "/clientes", { waitUntil: "networkidle" }); await page.waitForTimeout(400);
  await modalChecks("modal-editar-cliente", () => page.getByRole("button", { name: /Editar a/ }).first().click(), ["Cancelar", "Guardar cambios"]);
  await page.goto(BASE + "/prestamos", { waitUntil: "networkidle" }); await page.waitForTimeout(400);
  await modalChecks("modal-eliminar-prestamo", () => page.getByRole("button", { name: /Eliminar préstamo/ }).first().click(), ["Cancelar", "Confirmar eliminación"]);
  await page.goto(BASE + "/nuevo-prestamo", { waitUntil: "networkidle" }); await page.waitForTimeout(600);
  await modalChecks("modal-desembolso", () => page.getByRole("button", { name: "Registrar y desembolsar" }).click(), ["Cancelar", "Confirmar desembolso"]);

  report.push({ w, route: "CONSOLA", errors: [...new Set(errors)].slice(0, 5) });
  await ctx.close();
}
await browser.close();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 1));

// Resumen legible
const bad = report.filter((r) => r.pageOverflow > 0 || r.badCount > 0 || r.menuOpened === false || r.closesAfterNav === false || r.closesWithX === false || r.modal || r.modalFits === false || r.buttonsVisible === false || r.errors?.length);
console.log(`Medidas: ${report.length} · con problemas: ${bad.length}`);
for (const r of bad) console.log(JSON.stringify(r));
const smalls = report.filter((r) => r.smallCount > 0);
console.log(`\nControles de menos de 36 px de alto: ${smalls.length} páginas`);
for (const r of smalls.filter((x) => [320, 390].includes(x.w))) console.log(r.w, r.route, r.smallCount, JSON.stringify(r.small.slice(0, 3)));
const tinies = report.filter((r) => r.tiny > 0 && [320, 390].includes(r.w));
console.log("\nTextos < 11px:", tinies.map((r) => `${r.w}/${r.route}:${r.tiny}`).join(" "));

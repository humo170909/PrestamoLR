// Lote 2 (B-04, B-05, B-06, B-11, M-03) en navegador real contra la app compilada y el mock.
// Uso: PW_CHANNEL=chrome node tests-responsive/nav-check.mjs  (salida 1 si algo falla). Las comprobaciones se agrupan por hallazgo.
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3100", MOCK = "http://127.0.0.1:54399";
const ctl = (p) => fetch(MOCK + p).then((r) => r.json());
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
let fail = 0;
const check = (name, ok, detail) => { if (!ok) fail++; console.log(`${ok ? "OK   " : "FALLA"} ${name} — ${detail}`); };

async function login(role = "admin") {
  await ctl(`/__role?r=${role}`); await ctl("/__fail?on=0");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "admin@lromero.test");
  await page.fill('input[type="password"]', "Prueba12345");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  await page.waitForTimeout(500);
  return { ctx, page };
}
const menu = (page) => page.getByRole("navigation", { name: "Principal" }).locator("a").allInnerTexts().then((a) => a.map((s) => s.trim()).filter(Boolean));

// ── B-04: menú por rol ──
const EXPECT = {
  admin: { has: ["Dashboard", "Nuevo préstamo", "Trabajadores / Cobradores", "Auditoría", "Usuarios y permisos", "Configuración"], not: [] },
  advisor: { has: ["Nuevo préstamo", "Registro de pagos", "Clientes", "Caja y flujos", "Reportes"], not: ["Trabajadores / Cobradores", "Auditoría", "Usuarios y permisos", "Configuración"] },
  collector: { has: ["Dashboard", "Lista de préstamos", "Registro de pagos", "Gestión de morosidad", "Clientes", "Reportes"], not: ["Nuevo préstamo", "Trabajadores / Cobradores", "Auditoría", "Usuarios y permisos", "Configuración"] },
};
for (const [role, e] of Object.entries(EXPECT)) {
  const { ctx, page } = await login(role);
  const items = await menu(page);
  const ok = e.has.every((x) => items.includes(x)) && e.not.every((x) => !items.includes(x));
  check(`B-04 menú del ${role}`, ok, `${items.length} entradas: ${items.join(", ")}`);
  await ctx.close();
}
await ctl("/__role?r=admin");

// ── B-05: /reportes con el servidor en fallo no muestra detalles técnicos ──
{
  const { ctx, page } = await login("admin");
  await ctl("/__fail?on=1&except=profiles");
  await page.goto(BASE + "/reportes", { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  const t = (await page.innerText("main")).replace(/\s+/g, " ");
  check("B-05 /reportes: mensaje genérico con botón Reintentar", /No se pudieron cargar los reportes/.test(t) && /Reintentar/.test(t), t.slice(t.indexOf("No se pudieron"), t.indexOf("No se pudieron") + 90));
  check("B-05 /reportes: no filtra tablas ni mensajes del servidor", !/payments|installments|cash_movements|fallo simulado|XX000|PGRST/i.test(t), /payments|fallo simulado/i.test(t) ? "FILTRA: " + t.match(/(payments|fallo simulado)[^.]*/i)?.[0] : "sin detalle técnico");
  await ctl("/__fail?on=0");
  await ctx.close();
}


// ── B-11: con error al cargar clientes no se dice "No hay clientes visibles" ──
{
  const { ctx, page } = await login("admin");
  await ctl("/__fail?on=1&except=profiles");
  await page.goto(BASE + "/nuevo-prestamo", { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  const t = (await page.innerText("main")).replace(/\s+/g, " ");
  check("B-11 muestra el error de carga de clientes", /No se pudieron cargar los clientes/.test(t), (t.match(/No se pudieron cargar los clientes[^.]*\.?/) ?? ["(sin mensaje de error)"])[0]);
  check("B-11 NO afirma que no hay clientes", !/No hay clientes visibles/.test(t), /No hay clientes visibles/.test(t) ? "mensaje engañoso presente" : "ausente");
  await ctl("/__fail?on=0");
  await page.goto(BASE + "/nuevo-prestamo", { waitUntil: "networkidle" }).catch(() => {});
  await ctx.close();
}
{
  // sin errores, el selector de clientes aparece
  const { ctx, page } = await login("admin");
  await page.goto(BASE + "/nuevo-prestamo", { waitUntil: "networkidle" }); await page.waitForTimeout(900);
  check("B-11 sin errores el selector de clientes aparece", (await page.locator("select").first().locator("option").count()) > 0, "selector con opciones");
  await ctx.close();
}


// ── B-06: la casilla "Recordar mi correo" tiene nombre accesible ──
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const byName = await page.getByRole("checkbox", { name: "Recordar mi correo" }).count();
  check("B-06 la casilla se expone a tecnologías de apoyo con el nombre «Recordar mi correo»", byName === 1, `getByRole('checkbox', {name}) → ${byName}`);
  const named = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button[role="checkbox"], input[type="checkbox"]:not([aria-hidden="true"])')];
    return els.map((e) => ({ tag: e.tagName, labels: e.labels ? e.labels.length : null, text: e.labels?.[0]?.textContent?.trim() ?? null }));
  });
  check("B-06 el control visible está asociado a su etiqueta (label for)", named.length > 0 && named.every((n) => n.labels === 1 && /Recordar mi correo/.test(n.text ?? "")), JSON.stringify(named));
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab");
  await page.getByRole("checkbox", { name: "Recordar mi correo" }).focus();
  await page.keyboard.press("Space");
  check("B-06 se puede marcar con el teclado (Espacio)", (await page.getByRole("checkbox", { name: "Recordar mi correo" }).getAttribute("aria-checked")) === "true", "aria-checked=true tras Espacio");
  await ctx.close();
}


// ── M-03: ¿Olvidaste tu contraseña?, Contáctanos y Ayuda ya no son anclas vacías ──
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const hashLinks = await page.locator('a[href^="#"]').count();
  check("M-03 el login ya no tiene enlaces de ancla vacíos (#recuperar, #contacto, #ayuda)", hashLinks === 0, `${hashLinks} enlaces '#…'`);
  for (const [label, expected] of [["¿Olvidaste tu contraseña?", /administrador/i], ["Contáctanos", /administrador de LRomero/i], ["Ayuda", /Correo o contraseña incorrectos/i]]) {
    await page.getByText(label, { exact: true }).first().click();
    await page.waitForTimeout(350);
    const dlg = page.getByRole("dialog");
    const shown = (await dlg.count()) === 1;
    const text = shown ? (await dlg.innerText()).replace(/\s+/g, " ") : "";
    check(`M-03 «${label}» abre una ventana informativa`, shown && expected.test(text) && !page.url().includes("#"), shown ? text.slice(0, 80) + "…" : `sin diálogo; url ${page.url().replace(BASE, "")}`);
    if (shown) { await page.keyboard.press("Escape"); await page.waitForTimeout(250); check(`M-03 «${label}»: Esc cierra la ventana y devuelve al login`, (await page.getByRole("dialog").count()) === 0, "cerrada"); }
  }
  await ctx.close();
}

// @@FIN@@
await browser.close();
process.exit(fail ? 1 : 0);

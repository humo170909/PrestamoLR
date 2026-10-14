// M-06: comportamiento real del middleware contra el mock. Uso (ver README): app compilada y arrancada contra tests-responsive/mock-supabase.mjs.
//   PW_CHANNEL=chrome node tests-responsive/middleware-check.mjs     (código de salida 1 si alguna comprobación falla)
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:3100", MOCK = "http://127.0.0.1:54399";
const ctl = (p) => fetch(MOCK + p).then((r) => r.json());
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
let fail = 0;
const check = (name, ok, detail) => { if (!ok) fail++; console.log(`${ok ? "OK   " : "FALLA"} ${name} — ${detail}`); };

async function session() {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await ctl("/__fail?on=0"); await ctl("/__profile?mode=ok");
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', "admin@lromero.test");
  await page.fill('input[type="password"]', "Prueba12345");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
  const cookies = async () => (await ctx.cookies()).filter((c) => /^sb-.*auth-token/.test(c.name)).length;
  return { ctx, page, cookies };
}

// 1) Error de infraestructura al consultar el perfil → 503, sesión conservada, y se recupera sola
{
  const { ctx, page, cookies } = await session();
  const before = await cookies();
  await ctl("/__fail?on=1");
  const r = await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
  const body = await page.innerText("body");
  check("Error en la consulta de perfil: responde 503 con página de reintento", r.status() === 503 && /Servicio no disponible/.test(body), `estado ${r.status()}, texto="${body.replace(/\s+/g, " ").slice(0, 60)}"`);
  check("Error en la consulta de perfil: NO se borran las cookies de sesión", (await cookies()) === before && before > 0, `cookies antes=${before}, después=${await cookies()}`);
  const api = await page.request.post(BASE + "/api/admin/users", { data: {}, maxRedirects: 0 });
  check("Error en la consulta de perfil: las API responden 503 JSON", api.status() === 503, `estado ${api.status()}`);
  await ctl("/__fail?on=0");
  const ok = await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  check("Al volver el servicio, la MISMA sesión entra sin volver a iniciar sesión", ok.status() === 200 && /dashboard/.test(page.url()), `estado ${ok.status()}, url ${page.url().replace(BASE, "")}`);
  await ctx.close();
}

// 2) Perfil inactivo → se cierra la sesión y se vuelve al login
for (const mode of ["inactive", "missing"]) {
  const { ctx, page, cookies } = await session();
  await ctl(`/__profile?mode=${mode}`);
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  const left = new URL(page.url()).pathname === "/" && (await cookies()) === 0;
  check(`Perfil ${mode === "inactive" ? "inactivo (active:false)" : "inexistente"}: cierra la sesión y vuelve al login`, left, `url ${page.url().replace(BASE, "")}, cookies de sesión=${await cookies()}`);
  await ctx.close();
}

// 3) Sin sesión: el panel redirige al login (sin cambios)
{
  const ctx = await browser.newContext(); const page = await ctx.newPage();
  await ctl("/__fail?on=0"); await ctl("/__profile?mode=ok");
  await page.goto(BASE + "/dashboard", { waitUntil: "networkidle" });
  check("Sin sesión: /dashboard redirige al login", new URL(page.url()).pathname === "/", `url ${page.url().replace(BASE, "")}`);
  await ctx.close();
}

await browser.close();
process.exit(fail ? 1 : 0);

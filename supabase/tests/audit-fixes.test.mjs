// Pruebas de las correcciones del lote 1 de la auditoría (migración 20261013000900_audit_fixes_1.sql). Ejecutar: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const dir = new URL("../migrations/", import.meta.url);
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
for (const f of fs.readdirSync(dir).sort()) {
  try { await db.exec(fs.readFileSync(new URL(f, dir), "utf8")); }
  catch (e) { console.log("FALLA migración", f, "->", e.message); process.exit(1); }
}

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const ADV = "00000000-0000-0000-0000-0000000000b2";
const COL = "00000000-0000-0000-0000-0000000000c3";
await db.exec(`
  insert into auth.users values ('${ADMIN}','a@x'),('${ADV}','b@x'),('${COL}','c@x');
  insert into public.profiles (id, full_name, role) values ('${ADMIN}','Admin','admin'),('${ADV}','Asesor','advisor'),('${COL}','Cobrador','collector');
`);

let pass = 0, fail = 0;
async function as(uid, sql) {
  await db.exec(`select set_config('request.jwt.sub','${uid}', false); set role ${uid === "anon" ? "anon" : "authenticated"};`);
  try { return await db.query(sql); } finally { await db.exec(`reset role; select set_config('request.jwt.sub','', false);`); }
}
async function ok(name, fn) { try { await fn(); pass++; console.log("  ✔", name); } catch (e) { fail++; console.log("  ✘", name, "->", e.message); } }
async function rejects(name, fn) { try { await fn(); fail++; console.log("  ✘", name, "(debía fallar)"); } catch (e) { pass++; console.log("  ✔", name, "[rechazado:", e.message.slice(0, 70) + "]"); } }
const eq = (a, b, m = "") => { if (Number(a) !== Number(b) && String(a) !== String(b)) throw new Error(`${m} esperado ${b}, obtenido ${a}`); };
const one = async (s) => (await db.query(s)).rows[0];
const today = (await one(`select (now() at time zone 'America/Lima')::date::text d`)).d;
const daysAgo = async (n) => (await one(`select (date '${today}' - ${n})::text d`)).d;
let k = 0; const key = () => `af-${++k}-${Math.random().toString(36).slice(2)}`;
const client = async (doc) => (await as(ADV, `insert into clients (full_name, document_id, assigned_collector) values ('C${doc}','${doc}','${COL}') returning id`)).rows[0].id;
const loan = async (c, o = {}) => (await as(o.by ?? ADV, `select public.create_loan('${c}', ${o.p ?? 1000}, ${o.r ?? 10}, '${o.f ?? "monthly"}', ${o.n ?? 3}, '${o.s}', '${key()}', '${o.t ?? "interest_only"}') as id`)).rows[0].id;
const pay = (uid, l, i, c) => as(uid, `select public.register_payment('${l}', ${i}, ${c}, 'cash', '${key()}') as id`);

// ───────── B-01 / I-07: privilegios sobrantes ─────────
console.log("B-01 / I-07");
const tp = async (role, rel, priv) => (await one(`select has_table_privilege('${role}', '${rel}', '${priv}') h`)).h;
const fp = async (role, sig) => (await one(`select has_function_privilege('${role}', '${sig}', 'EXECUTE') h`)).h;
await ok("anon no tiene NINGÚN privilegio sobre v_loan_portfolio", async () => {
  for (const p of ["SELECT", "INSERT", "UPDATE", "DELETE"]) if (await tp("anon", "public.v_loan_portfolio", p)) throw new Error("anon conserva " + p);
});
await ok("authenticated solo conserva SELECT en v_loan_portfolio (y en v_loan_summary)", async () => {
  for (const v of ["v_loan_portfolio", "v_loan_summary"]) {
    if (!(await tp("authenticated", `public.${v}`, "SELECT"))) throw new Error(v + ": falta SELECT");
    for (const p of ["INSERT", "UPDATE", "DELETE"]) if (await tp("authenticated", `public.${v}`, p)) throw new Error(`${v}: authenticated conserva ${p}`);
  }
});
await ok("la app sigue leyendo la vista como authenticated (admin y cobrador)", async () => {
  const c = await client("91000001"); const l = await loan(c, { s: await daysAgo(40) });
  eq((await as(ADMIN, `select count(*) c from v_loan_portfolio where id='${l}'`)).rows[0].c, 1);
  eq((await as(COL, `select count(*) c from v_loan_portfolio where id='${l}'`)).rows[0].c, 1);
});
await ok("anon no puede ejecutar app.current_role, can_see_client, can_see_loan ni due_date_of", async () => {
  for (const sig of ["app.current_role()", "app.can_see_client(uuid)", "app.can_see_loan(uuid)", "app.due_date_of(date, public.pay_frequency, int)"])
    if (await fp("anon", sig)) throw new Error("anon ejecuta " + sig);
});
await ok("authenticated SÍ las conserva (las evalúan las políticas RLS)", async () => {
  for (const sig of ["app.current_role()", "app.can_see_client(uuid)", "app.can_see_loan(uuid)", "app.due_date_of(date, public.pay_frequency, int)"])
    if (!(await fp("authenticated", sig))) throw new Error("authenticated perdió " + sig);
});


// ───────── M-01: monthly_cash no cuenta pagos revertidos ─────────
console.log("M-01");
await ok("monthly_cash coincide con report_totals tras pagar y revertir (caso de la auditoría)", async () => {
  const c = await client("91000002");
  const l1 = await loan(c, { p: 1000, r: 10, n: 4, t: "fixed", s: await daysAgo(100) });
  const l2 = await loan(c, { p: 500, r: 10, n: 2, t: "interest_only", s: await daysAgo(70) });
  const p1 = (await pay(ADMIN, l1, 100, 250)).rows[0].id;
  await pay(ADMIN, l1, 100, 0);
  const p3 = (await pay(ADMIN, l2, 50, 100)).rows[0].id;
  await as(ADMIN, `select public.reverse_payment('${p1}', 'reversión de prueba')`);
  await as(ADMIN, `select public.reverse_payment('${p3}', 'reversión de prueba')`);
  const mc = (await as(ADMIN, `select coalesce(sum(interest),0) i, coalesce(sum(capital),0) c from public.monthly_cash()`)).rows[0];
  const rt = (await as(ADMIN, `select interest i, capital c from public.report_totals()`)).rows[0];
  eq(rt.i, 100, "report_totals interés (solo el pago no revertido)"); eq(rt.c, 0, "report_totals capital");
  eq(mc.i, rt.i, "monthly_cash interés"); eq(mc.c, rt.c, "monthly_cash capital");
});
await ok("monthly_cash sigue mostrando los desembolsos", async () => {
  const mc = (await as(ADMIN, `select coalesce(sum(disbursed),0) d from public.monthly_cash()`)).rows[0];
  if (Number(mc.d) < 1500) throw new Error("desembolsos: " + mc.d);
});

// ───────── M-10: sin escrituras directas sobre loans ─────────
console.log("M-10");
let mc, ml;
await ok("preparación: cliente y préstamo creados con create_loan (asesor)", async () => {
  mc = await client("91000010");
  ml = await loan(mc, { p: 1000, r: 10, n: 2, t: "interest_only", s: await daysAgo(40) });
});
await ok("authenticated y anon no tienen INSERT/UPDATE/DELETE sobre loans (solo SELECT)", async () => {
  for (const role of ["authenticated", "anon"]) for (const p of ["INSERT", "UPDATE", "DELETE"]) if (await tp(role, "public.loans", p)) throw new Error(`${role} conserva ${p}`);
  if (!(await tp("authenticated", "public.loans", "SELECT"))) throw new Error("authenticated perdió SELECT");
});
await rejects("admin NO puede poner principal_outstanding en 0 por UPDATE directo", () => as(ADMIN, `update loans set principal_outstanding = 0 where id='${ml}'`));
await rejects("admin NO puede cambiar el estado por UPDATE directo", () => as(ADMIN, `update loans set status = 'defaulted' where id='${ml}'`));
await rejects("asesor NO puede insertar un préstamo 'draft' directamente", () => as(ADV, `insert into loans (code, client_id, principal, principal_outstanding, rate_pct, frequency, periods, start_date, status, loan_type) values ('X-1','${mc}',100,100,10,'monthly',1,'${today}','draft','interest_only')`));
await rejects("admin NO puede insertar un préstamo 'draft' directamente (ni activarlo después)", () => as(ADMIN, `insert into loans (code, client_id, principal, principal_outstanding, rate_pct, frequency, periods, start_date, status, loan_type) values ('X-2','${mc}',100,100,10,'monthly',1,'${today}','draft','interest_only')`));
await ok("el saldo y el estado del préstamo quedaron intactos", async () => {
  const l = await one(`select principal_outstanding p, status s from loans where id='${ml}'`);
  eq(l.p, 1000); eq(l.s, "active");
});
await ok("create_loan sigue funcionando (admin y asesor) para las 3 modalidades", async () => {
  for (const [by, t, n] of [[ADMIN, "fixed", 3], [ADV, "interest_only", 2], [ADV, "open", "null"]]) await loan(mc, { by, t, n, s: await daysAgo(35) });
});
await ok("register_payment + cierre automático a paid_off (trigger) siguen funcionando", async () => {
  const l = await loan(mc, { p: 300, r: 10, n: 3, t: "fixed", s: await daysAgo(100) });
  await pay(COL, l, 90, 300);
  eq((await one(`select status s from loans where id='${l}'`)).s, "paid_off");
});
await ok("reverse_payment reabre el préstamo y restaura el capital", async () => {
  const l = await loan(mc, { p: 300, r: 10, n: 3, t: "fixed", s: await daysAgo(100) });
  const p = (await pay(ADMIN, l, 90, 300)).rows[0].id;
  await as(ADMIN, `select public.reverse_payment('${p}', 'prueba de reversión M-10')`);
  const r = await one(`select status s, principal_outstanding o from loans where id='${l}'`);
  eq(r.s, "active"); eq(r.o, 300);
});
await ok("cancel_loan (admin) sigue funcionando", async () => {
  const l = await loan(mc, { p: 200, r: 10, n: 2, t: "fixed", s: await daysAgo(5) });
  await as(ADMIN, `select public.cancel_loan('${l}', 'anulado por prueba M-10')`);
  eq((await one(`select status s from loans where id='${l}'`)).s, "cancelled");
});
await rejects("el asesor sigue sin poder cancelar ni revertir", () => as(ADV, `select public.cancel_loan('${ml}', 'intento no autorizado')`));
await ok("el cobrador sigue viendo su préstamo (SELECT con RLS)", async () => {
  eq((await as(COL, `select count(*) c from loans where id='${ml}'`)).rows[0].c, 1);
});


// ───────── La migración es idempotente y no toca datos ─────────
console.log("Idempotencia");
await ok("20261013000900_audit_fixes_1.sql se puede ejecutar de nuevo sin error y deja los mismos privilegios", async () => {
  const before = (await one(`select count(*) c from loans`)).c;
  await db.exec(fs.readFileSync(new URL("20261013000900_audit_fixes_1.sql", dir), "utf8"));
  eq((await one(`select count(*) c from loans`)).c, before);
  if (await tp("authenticated", "public.loans", "UPDATE") || await tp("anon", "public.v_loan_portfolio", "SELECT")) throw new Error("privilegios distintos tras repetir");
  eq((await as(ADMIN, `select count(*) c from public.monthly_cash()`)).rows[0].c, 6);
});

// @@FIN@@
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);

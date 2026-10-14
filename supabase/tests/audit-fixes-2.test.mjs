// Pruebas de las correcciones del lote 2 de la auditoría (migración 20261013001000_audit_fixes_2.sql). Ejecutar: npm run test:db
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

const tp = async (role, rel, priv) => (await one(`select has_table_privilege('${role}', '${rel}', '${priv}') h`)).h;


// ───────── M-07: installments.is_unpaid (filtro de cuotas impagas en SQL para el cron) ─────────
console.log("M-07");
let c07, l07;
await ok("la columna is_unpaid existe y es generada", async () => {
  const r = await one(`select is_generated g from information_schema.columns where table_schema='public' and table_name='installments' and column_name='is_unpaid'`);
  if (!r) throw new Error("no existe la columna installments.is_unpaid");
  eq(r.g, "ALWAYS");
});
await ok("is_unpaid = (interés o capital pendiente) y sigue a los pagos y a su reversión", async () => {
  c07 = await client("92000001");
  l07 = await loan(c07, { p: 1000, r: 10, n: 3, t: "interest_only", s: await daysAgo(70) });
  eq((await one(`select count(*) c from installments where loan_id='${l07}' and is_unpaid`)).c, 3);
  const p = (await pay(ADMIN, l07, 100, 0)).rows[0].id;             // paga el interés de la cuota 1
  eq((await one(`select is_unpaid u from installments where loan_id='${l07}' and n=1`)).u, false);
  eq((await one(`select count(*) c from installments where loan_id='${l07}' and is_unpaid`)).c, 2);
  await as(ADMIN, `select public.reverse_payment('${p}', 'prueba M-07 reversión')`);
  eq((await one(`select is_unpaid u from installments where loan_id='${l07}' and n=1`)).u, true);
});
await ok("coincide con la definición para TODAS las cuotas de la base", async () => {
  const bad = await one(`select count(*) c from installments where is_unpaid is distinct from (interest_paid < interest_due or capital_paid < capital_due)`);
  eq(bad.c, 0);
});
await ok("hay un índice parcial sobre las cuotas impagas por fecha de vencimiento", async () => {
  const r = await one(`select count(*) c from pg_indexes where schemaname='public' and tablename='installments' and indexdef ilike '%is_unpaid%' and indexdef ilike '%due_date%'`);
  eq(r.c, 1);
});
await ok("los clientes de la API siguen sin escribir cuotas (la columna generada no abre permisos)", async () => {
  await as(ADMIN, `update installments set interest_paid = 0`).then(() => { throw new Error("UPDATE permitido"); }, () => {});
});


// ───────── M-08: huecos de pruebas (mutantes que sobrevivían) ─────────
console.log("M-08");
let c08, l08;
await ok("preparación", async () => { c08 = await client("92000008"); l08 = await loan(c08, { p: 1000, r: 10, n: 3, t: "interest_only", s: await daysAgo(70) }); });

// motivo obligatorio en reverse_payment
for (const [name, reason] of [["NULL", "null"], ["vacío", "''"], ["solo espacios", "'      '"], ["4 caracteres", "'abcd'"], ["4 + espacios", "'  abcd  '"]]) {
  await rejects(`reverse_payment rechaza motivo ${name}`, async () => {
    const id = (await pay(ADMIN, l08, 1, 0)).rows[0].id;
    await as(ADMIN, `select public.reverse_payment('${id}', ${reason})`);
  });
}
await ok("reverse_payment acepta un motivo de 5 caracteres, lo conserva y deja el pago revertido", async () => {
  const id = (await pay(ADMIN, l08, 1, 0)).rows[0].id;
  await as(ADMIN, `select public.reverse_payment('${id}', 'abcde')`);
  const p = await one(`select status s, reversal_reason r from payments where id='${id}'`);
  eq(p.s, "reversed"); eq(p.r, "abcde");
});
await ok("tras los rechazos por motivo, ningún pago quedó revertido a medias", async () => {
  const n = await one(`select count(*) c from payments where loan_id='${l08}' and status='reversed'`);
  eq(n.c, 1);
});

// condiciones contractuales inmutables (loan_guard), incluida start_date
for (const [col, val] of [["start_date", `date '${today}'`], ["principal", "5"], ["rate_pct", "99"], ["frequency", "'weekly'"], ["periods", "9"], ["client_id", `'${c08}'`]]) {
  await rejects(`loan_guard: no se puede cambiar ${col} de un préstamo activo`, async () => {
    // client_id: se usa un cliente distinto para que sea un cambio real
    const v = col === "client_id" ? `(select id from clients where id <> '${c08}' limit 1)` : val;
    await db.query(`update loans set ${col} = ${v} where id='${l08}'`);
  });
}
await ok("start_date, capital y tasa siguen intactos y el estado sí puede evolucionar por las funciones", async () => {
  const l = await one(`select start_date::text s, principal p, rate_pct r from loans where id='${l08}'`);
  eq(l.s, await daysAgo(70)); eq(l.p, 1000); eq(l.r, 10);
});

// monthly_cash: ni suma pagos revertidos ni pierde los confirmados (bloquea el mutante "interés × 0")
await ok("monthly_cash devuelve el interés de los pagos confirmados (no cero) y excluye el revertido", async () => {
  const l = await loan(c08, { p: 400, r: 10, n: 2, t: "interest_only", s: await daysAgo(70) });
  const keep = await pay(ADMIN, l, 40, 0);
  const drop = (await pay(ADMIN, l, 40, 0)).rows[0].id;
  await as(ADMIN, `select public.reverse_payment('${drop}', 'prueba M-08')`);
  const mc = (await as(ADMIN, `select coalesce(sum(interest),0) i from public.monthly_cash()`)).rows[0];
  const rt = (await as(ADMIN, `select interest i from public.report_totals()`)).rows[0];
  if (Number(mc.i) <= 0) throw new Error("monthly_cash devolvió 0 de interés");
  eq(mc.i, rt.i, "monthly_cash vs report_totals");
  void keep;
});


// ───────── B-02 / I-04: idempotencia atada a préstamo e importes; NULL con mensaje claro ─────────
console.log("B-02 / I-04");
const msgOf = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message); } };
const expectMsg = async (name, fn, re) => ok(name, async () => {
  const m = await msgOf(fn);
  if (m === null) throw new Error("debía fallar y fue aceptado");
  if (!re.test(m)) throw new Error("mensaje inesperado: " + m);
});
let ca, cb, la, lb, ka, pa;
await ok("preparación: 2 clientes (de COL y de COL2) y un préstamo cada uno", async () => {
  ca = await client("93000001");
  cb = (await as(ADV, `insert into clients (full_name, document_id, assigned_collector) values ('Otro','93000002',null) returning id`)).rows[0].id;
  la = await loan(ca, { p: 1000, r: 10, n: 3, t: "interest_only", s: await daysAgo(70) });
  lb = await loan(cb, { p: 500, r: 10, n: 2, t: "interest_only", s: await daysAgo(70) });
});
await ok("mismo reintento (misma clave, préstamo e importes) devuelve el MISMO pago: 1 fila, 1 asiento de caja", async () => {
  ka = key();
  pa = (await as(ADMIN, `select public.register_payment('${la}', 30, 0, 'cash', '${ka}') as id`)).rows[0].id;
  const again = (await as(ADMIN, `select public.register_payment('${la}', 30, 0, 'cash', '${ka}') as id`)).rows[0].id;
  eq(again, pa);
  eq((await one(`select count(*) c from payments where idempotency_key='${ka}'`)).c, 1);
  eq((await one(`select count(*) c from cash_movements where payment_id='${pa}'`)).c, 1);
});
await expectMsg("la misma clave en OTRO préstamo da error (antes devolvía éxito sin aplicar nada)",
  () => as(ADMIN, `select public.register_payment('${lb}', 25, 0, 'cash', '${ka}')`), /clave de idempotencia ya se us/i);
await expectMsg("la misma clave con importes distintos en el mismo préstamo da error",
  () => as(ADMIN, `select public.register_payment('${la}', 31, 0, 'cash', '${ka}')`), /clave de idempotencia ya se us/i);
await expectMsg("la misma clave con capital distinto da error",
  () => as(ADMIN, `select public.register_payment('${la}', 30, 1, 'cash', '${ka}')`), /clave de idempotencia ya se us/i);
await ok("tras esos rechazos no se aplicó nada al otro préstamo ni se duplicó el cobro", async () => {
  eq((await one(`select coalesce(sum(interest_paid),0) s from installments where loan_id='${lb}'`)).s, 0);
  eq((await one(`select count(*) c from payments where loan_id='${la}'`)).c, 1);
});
const kb = key();
await as(ADMIN, `select public.register_payment('${lb}', 20, 0, 'cash', '${kb}')`);   // préstamo del cliente SIN cobrador asignado
await expectMsg("un cobrador SIN acceso al préstamo ya no obtiene el UUID de un pago ajeno con su clave (antes lo recibía)",
  () => as(COL, `select public.register_payment('${lb}', 20, 0, 'cash', '${kb}')`), /Préstamo no encontrado/i);
await ok("el cobrador SÍ asignado puede reintentar el mismo cobro y recibe el mismo pago", async () => {
  const kc = key();
  await db.exec(`update clients set assigned_collector='${COL}' where id='${ca}'`);
  const p1 = (await as(COL, `select public.register_payment('${la}', 10, 0, 'cash', '${kc}') as id`)).rows[0].id;
  const p2 = (await as(COL, `select public.register_payment('${la}', 10, 0, 'cash', '${kc}') as id`)).rows[0].id;
  eq(p1, p2);
});
await expectMsg("interés NULL: mensaje claro (antes: error técnico de amount NOT NULL)",
  () => as(ADMIN, `select public.register_payment('${la}', null, 1, 'cash', '${key()}')`), /importe de intereses y el de capital/i);
await expectMsg("capital NULL: mensaje claro",
  () => as(ADMIN, `select public.register_payment('${la}', 1, null, 'cash', '${key()}')`), /importe de intereses y el de capital/i);
await expectMsg("clave de idempotencia vacía o NULL: mensaje claro",
  () => as(ADMIN, `select public.register_payment('${la}', 1, 0, 'cash', '')`), /clave de idempotencia es obligatoria/i);
await expectMsg("clave NULL", () => as(ADMIN, `select public.register_payment('${la}', 1, 0, 'cash', null)`), /clave de idempotencia es obligatoria/i);
await ok("el reparto de pagos no cambió: interés más antiguo primero y capital al final", async () => {
  const l = await loan(ca, { p: 600, r: 10, n: 2, t: "fixed", s: await daysAgo(70) });
  await pay(ADMIN, l, 90, 300);
  const r = (await db.query(`select n, interest_paid ip, capital_paid cp from installments where loan_id='${l}' order by n`)).rows;
  eq(r[0].ip, 60); eq(r[1].ip, 30); eq(r[0].cp, 300); eq(r[1].cp, 0);
});

// ───────── B-03: create_loan valida escala y rango de fecha ─────────
console.log("B-03");
const mk = (p, r, s, t = "interest_only", n = 2) => as(ADV, `select public.create_loan('${ca}', ${p}, ${r}, 'monthly', ${t === "open" ? "null" : n}, ${s}, '${key()}', '${t}')`);
await expectMsg("capital con 3 decimales (100.005) rechazado (antes se guardaba como 100.01)", () => mk("100.005", 10, `'${today}'`), /capital admite como m[aá]ximo 2 decimales/i);
await expectMsg("capital 0.001 rechazado", () => mk("0.001", 10, `'${today}'`), /capital admite como m[aá]ximo 2 decimales/i);
await expectMsg("tasa con 5 decimales rechazada", () => mk(100, "10.12345", `'${today}'`), /tasa admite como m[aá]ximo 4 decimales/i);
await expectMsg("capital NULL: mensaje claro", () => mk("null", 10, `'${today}'`), /capital es obligatorio/i);
await expectMsg("tasa NULL: mensaje claro", () => mk(100, "null", `'${today}'`), /tasa es obligatoria/i);
await expectMsg("fecha NULL: mensaje claro", () => mk(100, 10, "null"), /fecha de desembolso es obligatoria/i);
await expectMsg("fecha 1990-01-01 (abierto semanal creaba 1 920 períodos) rechazada", () => mk(100, 10, "'1990-01-01'", "open"), /fecha de desembolso est[aá] fuera del rango/i);
await expectMsg("fecha 0100-01-01 rechazada", () => mk(100, 10, "'0100-01-01'"), /fecha de desembolso est[aá] fuera del rango/i);
await expectMsg("fecha 2999-01-01 rechazada", () => mk(100, 10, "'2999-01-01'"), /fecha de desembolso est[aá] fuera del rango/i);
await ok("límites aceptados: 2000-01-01, hoy y hoy + 366 días; capital 100.05 y tasa 10.1234", async () => {
  await mk("100.05", "10.1234", `'${today}'`);
  await mk(100, 10, "'2000-01-01'");
  await mk(100, 10, `date '${today}' + 366`);
});
await expectMsg("hoy + 367 días rechazada", () => mk(100, 10, `date '${today}' + 367`), /fecha de desembolso est[aá] fuera del rango/i);
await ok("create_loan sigue idempotente y generando el mismo cronograma (cuotas fijas 1000/3)", async () => {
  const k = key();
  const a = (await as(ADV, `select public.create_loan('${ca}', 1000, 10, 'monthly', 3, '${today}', '${k}', 'fixed') as id`)).rows[0].id;
  const b = (await as(ADV, `select public.create_loan('${ca}', 1000, 10, 'monthly', 3, '${today}', '${k}', 'fixed') as id`)).rows[0].id;
  eq(a, b);
  const r = (await db.query(`select capital_due c from installments where loan_id='${a}' order by n`)).rows.map((x) => Number(x.c));
  eq(r.join(), "333.33,333.33,333.34");
});


// ───────── La migración es idempotente y no toca datos ─────────
console.log("Idempotencia");
await ok("20261013001000_audit_fixes_2.sql se puede ejecutar de nuevo sin error y sin alterar datos", async () => {
  const before = await one(`select (select count(*) from payments) p, (select count(*) from installments where is_unpaid) u, (select count(*) from loans) l`);
  await db.exec(fs.readFileSync(new URL("20261013001000_audit_fixes_2.sql", dir), "utf8"));
  const after = await one(`select (select count(*) from payments) p, (select count(*) from installments where is_unpaid) u, (select count(*) from loans) l`);
  eq(JSON.stringify(after), JSON.stringify(before));
  const r = await as(ADV, `select public.create_loan('${ca}', 50, 10, 'monthly', 1, '${today}', '${key()}', 'fixed') as id`);
  if (!r.rows[0].id) throw new Error("create_loan dejó de funcionar");
});

// @@FIN@@
console.log(`
${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);

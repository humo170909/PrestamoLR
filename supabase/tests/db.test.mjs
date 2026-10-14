// Prueba las migraciones y reglas financieras/RLS en un Postgres local (PGlite). Ejecutar: npm run test:db
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
  try { await db.exec(fs.readFileSync(new URL(f, dir), "utf8")); console.log("OK migración", f); }
  catch (e) { console.log("FALLA migración", f, "->", e.message); process.exit(1); }
}

const ADMIN = "00000000-0000-0000-0000-0000000000a1";
const ADV = "00000000-0000-0000-0000-0000000000b2";
const COL = "00000000-0000-0000-0000-0000000000c3";
await db.exec(`
  insert into auth.users values ('${ADMIN}','a@x'),('${ADV}','b@x'),('${COL}','c@x');
  insert into public.profiles (id, full_name, role) values
   ('${ADMIN}','Admin','admin'),('${ADV}','Asesor','advisor'),('${COL}','Cobrador','collector');
`);

let pass = 0, fail = 0;
async function as(uid, sql) {
  await db.exec(`select set_config('request.jwt.sub','${uid}', false); set role authenticated;`);
  try { return await db.query(sql); }
  finally { await db.exec(`reset role; select set_config('request.jwt.sub','', false);`); }
}
async function ok(name, fn) { try { await fn(); pass++; console.log("  ✔", name); } catch (e) { fail++; console.log("  ✘", name, "->", e.message); } }
async function rejects(name, fn) { try { await fn(); fail++; console.log("  ✘", name, "(debía fallar)"); } catch (e) { pass++; console.log("  ✔", name, "[rechazado:", e.message.slice(0, 60) + "]"); } }
const eq = (a, b) => { const na = Number(a), nb = Number(b); const same = Number.isNaN(na) || Number.isNaN(nb) ? String(a) === String(b) : na === nb; if (!same) throw new Error(`esperado ${b}, obtenido ${a}`); };

let client, loan, pay1;
await ok("asesor crea cliente", async () => {
  const r = await as(ADV, `insert into clients (full_name, document_id) values ('Cliente Uno','12345678') returning id`);
  client = r.rows[0].id;
});
await rejects("cobrador no puede crear cliente", () => as(COL, `insert into clients (full_name, document_id) values ('X','87654321')`));
await ok("create_loan 1000 al 10% x3 mensual (inicio pasado)", async () => {
  const r = await as(ADV, `select public.create_loan('${client}', 1000, 10, 'monthly', 3, '2026-07-01', 'k1') as id`);
  loan = r.rows[0].id;
});
await ok("create_loan idempotente", async () => {
  const r = await as(ADV, `select public.create_loan('${client}', 1000, 10, 'monthly', 3, '2026-07-01', 'k1') as id`);
  eq(r.rows[0].id, loan);
  eq((await db.query(`select count(*) c from loans`)).rows[0].c, 1);
});
await ok("cronograma: 3 cuotas, interés 100, capital solo al final", async () => {
  const r = await db.query(`select n, due_date::text d, interest_due, capital_due from installments order by n`);
  eq(r.rows.length, 3); eq(r.rows[0].interest_due, 100); eq(r.rows[0].capital_due, 0); eq(r.rows[2].capital_due, 1000);
  eq(r.rows[0].d, "2026-08-01"); eq(r.rows[2].d, "2026-10-01");
});
await ok("desembolso en caja como salida", async () => {
  const r = await db.query(`select direction, amount from cash_movements where kind='disbursement'`);
  eq(r.rows[0].direction, "out"); eq(r.rows[0].amount, 1000);
});
await ok("pago de solo intereses NO cambia capital pendiente", async () => {
  const r = await as(ADMIN, `select public.register_payment('${loan}', 100, 0, 'cash', 'p1') as id`);
  pay1 = r.rows[0].id;
  eq((await db.query(`select principal_outstanding p from loans`)).rows[0].p, 1000);
  eq((await db.query(`select interest_paid i from installments where n=1`)).rows[0].i, 100);
});
await ok("pago idempotente (misma clave)", async () => {
  const r = await as(ADMIN, `select public.register_payment('${loan}', 100, 0, 'cash', 'p1') as id`);
  eq(r.rows[0].id, pay1); eq((await db.query(`select count(*) c from payments`)).rows[0].c, 1);
});
await rejects("exceso de intereses rechazado", () => as(ADMIN, `select public.register_payment('${loan}', 9999, 0, 'cash', 'p2')`));
await ok("tras rechazo no quedó nada a medias", async () => {
  eq((await db.query(`select count(*) c from payments`)).rows[0].c, 1);
});
await ok("devolución de capital 200 reduce pendiente, original intacto", async () => {
  await as(ADMIN, `select public.register_payment('${loan}', 0, 200, 'cash', 'p3')`);
  const r = (await db.query(`select principal p, principal_outstanding o from loans`)).rows[0];
  eq(r.p, 1000); eq(r.o, 800);
});
await rejects("capital mayor al pendiente rechazado", () => as(ADMIN, `select public.register_payment('${loan}', 0, 900, 'cash', 'p4')`));
await ok("caja separa intereses y capital", async () => {
  const r = await db.query(`select kind, sum(amount) s from cash_movements group by kind order by kind`);
  const m = Object.fromEntries(r.rows.map((x) => [x.kind, Number(x.s)]));
  eq(m.interest_income, 100); eq(m.capital_recovery, 200); eq(m.disbursement, 1000);
});
await rejects("asesor no puede revertir", () => as(ADV, `select public.reverse_payment('${pay1}', 'motivo de prueba')`));
await ok("admin revierte pago de intereses", async () => {
  await as(ADMIN, `select public.reverse_payment('${pay1}', 'error de digitación')`);
  eq((await db.query(`select interest_paid i from installments where n=1`)).rows[0].i, 0);
  eq((await db.query(`select status s from payments where id='${pay1}'`)).rows[0].s, "reversed");
});
await rejects("no se puede revertir dos veces", () => as(ADMIN, `select public.reverse_payment('${pay1}', 'otra vez')`));
await ok("vista de cartera: mora detectada", async () => {
  const r = (await as(ADMIN, `select days_overdue, interest_overdue, capital_overdue, principal_outstanding from v_loan_portfolio`)).rows[0];
  if (Number(r.days_overdue) <= 0) throw new Error("sin mora: " + JSON.stringify(r));
  console.log("    vista:", JSON.stringify(r));
});
await ok("cobrador sin clientes asignados no ve préstamos ni cartera", async () => {
  eq((await as(COL, `select count(*) c from loans`)).rows[0].c, 0);
  eq((await as(COL, `select count(*) c from v_loan_portfolio`)).rows[0].c, 0);
});
await ok("al asignarle el cliente, el cobrador ve su préstamo", async () => {
  await db.exec(`update clients set assigned_collector='${COL}'`);
  eq((await as(COL, `select count(*) c from loans`)).rows[0].c, 1);
});
await rejects("cobrador no lee auditoría", async () => { const r = await as(COL, `select count(*) c from audit_log`); if (Number(r.rows[0].c) > 0) throw new Error("vio auditoría"); throw new Error("sin filas (RLS)"); });
await rejects("nadie cambia su propio rol", () => as(ADMIN, `update profiles set role='collector' where id='${ADMIN}'`));
await rejects("inserción directa en payments denegada", () => as(ADMIN, `insert into payments (loan_id, amount, interest_amount, capital_amount, idempotency_key) values ('${loan}', 1, 1, 0, 'zz')`));
await rejects("borrar pagos prohibido", () => db.query(`delete from payments`));
await rejects("condiciones contractuales inmutables", () => db.query(`update loans set principal = 5`));
await ok("auditoría registró pagos y reversión", async () => {
  const r = await db.query(`select action from audit_log where action in ('REGISTER_PAYMENT','REVERSE_PAYMENT') order by id`);
  eq(r.rows.length, 3);
});
await ok("settings: admin guarda, asesor no", async () => {
  await as(ADMIN, `insert into settings (key, value) values ('business', '{"a":1}')`);
});
await rejects("asesor no puede escribir settings", () => as(ADV, `insert into settings (key, value) values ('x', '{}')`));

const ins = (key) => `insert into notification_log (kind, for_date, chat_id, dedupe_key, status) values ('today', '2026-10-09', '1', '${key}', 'sent')`;
await ok("notification_log: solo admin lee", async () => {
  await db.exec(ins("today:2026-10-09:1"));
  eq((await as(ADMIN, `select count(*) c from notification_log`)).rows[0].c, 1);
  eq((await as(ADV, `select count(*) c from notification_log`)).rows[0].c, 0);
});
await rejects("authenticated no puede insertar en notification_log", () => as(ADMIN, ins("k2")));
await rejects("clave de deduplicación única", () => db.query(ins("today:2026-10-09:1")));

await ok("telegram_settings: el servidor guarda el token cifrado", async () => {
  await db.exec(`insert into telegram_settings (id, bot_token_enc, chat_ids) values (1, 'iv.tag.datos', '{123}')`);
});
for (const [who, name] of [[ADMIN, "admin"], [ADV, "asesor"], [COL, "cobrador"]]) {
  await rejects(`${name} no puede leer telegram_settings (ni el token cifrado)`, () => as(who, `select bot_token_enc from telegram_settings`));
  await rejects(`${name} no puede escribir telegram_settings`, () => as(who, `update telegram_settings set chat_ids = '{999}'`));
}
await rejects("telegram_settings admite una sola fila", () => db.query(`insert into telegram_settings (id) values (2)`));

// ── Cierre automático, totales SQL y cobradores asignables ──
let loan2, payFull;
await ok("préstamo pagado por completo pasa a paid_off", async () => {
  const c = await as(ADV, `insert into clients (full_name, document_id) values ('Cliente Dos','22222222') returning id`);
  loan2 = (await as(ADV, `select public.create_loan('${c.rows[0].id}', 500, 10, 'monthly', 1, '2026-09-01', 'k2') as id`)).rows[0].id;
  eq((await db.query(`select status from loans where id='${loan2}'`)).rows[0].status, "active");
  await as(ADMIN, `select public.register_payment('${loan2}', 0, 500, 'cash', 'f1')`);
  eq((await db.query(`select status from loans where id='${loan2}'`)).rows[0].status, "active"); // aún debe el interés
  payFull = (await as(ADMIN, `select public.register_payment('${loan2}', 50, 0, 'cash', 'f2') as id`)).rows[0].id;
  eq((await db.query(`select status from loans where id='${loan2}'`)).rows[0].status, "paid_off");
});
await ok("el préstamo 1 (con deuda) sigue activo", async () => {
  eq((await db.query(`select status from loans where id='${loan}'`)).rows[0].status, "active");
});
await ok("revertir el último pago reabre el préstamo", async () => {
  await as(ADMIN, `select public.reverse_payment('${payFull}', 'prueba de reversión')`);
  eq((await db.query(`select status from loans where id='${loan2}'`)).rows[0].status, "active");
});
await ok("report_totals coincide con la suma real de pagos confirmados", async () => {
  const t = (await as(ADMIN, `select * from public.report_totals()`)).rows[0];
  const r = (await db.query(`select sum(interest_amount) i, sum(capital_amount) c from payments where status='confirmed'`)).rows[0];
  eq(t.interest, r.i); eq(t.capital, r.c);
  eq(t.disbursed, (await db.query(`select sum(amount) a from disbursements`)).rows[0].a);
});
await ok("monthly_cash devuelve 6 meses", async () => {
  eq((await as(ADMIN, `select * from public.monthly_cash()`)).rows.length, 6);
});
await ok("worker_stats lista al personal", async () => {
  eq((await as(ADMIN, `select * from public.worker_stats()`)).rows.length, 3);
});
await ok("asesor ve la lista de cobradores; el cobrador no", async () => {
  eq((await as(ADV, `select * from public.list_collectors()`)).rows.length, 1);
  eq((await as(COL, `select * from public.list_collectors()`)).rows.length, 0);
});
await rejects("anon no puede ejecutar list_collectors", async () => {
  await db.exec(`set role anon`);
  try { await db.query(`select * from public.list_collectors()`); } finally { await db.exec(`reset role`); }
});

// ── Tres modalidades: abierto, cuotas fijas, solo intereses ──
const LIMA = `(now() at time zone 'America/Lima')::date`;
const summary = async (id) => (await db.query(`select * from v_loan_summary where id='${id}'`)).rows[0];
let cOpen, open1, open2, fixed1, fixed2;
await ok("préstamo abierto 1000 al 15 % mensual: sin plazo y sin cuotas ficticias", async () => {
  const c = await as(ADV, `insert into clients (full_name, document_id) values ('Cliente Abierto','33333333') returning id`);
  cOpen = c.rows[0].id;
  open1 = (await as(ADV, `select public.create_loan('${cOpen}', 1000, 15, 'monthly', null, ${LIMA} - 45, 'o1', 'open') as id`)).rows[0].id;
  const l = (await db.query(`select periods, loan_type from loans where id='${open1}'`)).rows[0];
  if (l.periods !== null || l.loan_type !== "open") throw new Error("periods debe ser null");
  const n = (await db.query(`select count(*) c, max(due_date) > ${LIMA} as future from installments where loan_id='${open1}'`)).rows[0];
  eq(n.c, 2); if (!n.future) throw new Error("debe existir el siguiente cobro");
});
await ok("devengo repetido no duplica intereses", async () => {
  await as(ADV, `select public.refresh_open_loans()`); await as(ADV, `select public.refresh_open_loans()`);
  eq((await db.query(`select count(*) c from installments where loan_id='${open1}'`)).rows[0].c, 2);
});
await ok("préstamo abierto vencido: 150 de interés exigible, estado derivado 'overdue'", async () => {
  const s = await summary(open1);
  eq(s.interest_pending, 150); eq(s.interest_generated, 150); eq(s.derived_status, "overdue"); eq(s.principal_outstanding, 1000);
});
await rejects("abono de capital superior al pendiente (abierto)", () => as(ADMIN, `select public.register_payment('${open1}', 0, 1000.01, 'cash', 'o-big')`));
await rejects("cobro de intereses superior al exigible (abierto)", () => as(ADMIN, `select public.register_payment('${open1}', 400, 0, 'cash', 'o-int')`));
await rejects("importe negativo rechazado", () => as(ADMIN, `select public.register_payment('${open1}', -1, 10, 'cash', 'o-neg')`));
await rejects("fecha de pago futura rechazada", () => as(ADMIN, `select public.register_payment('${open1}', 10, 0, 'cash', 'o-fut', null, ${LIMA} + 1)`));
await ok("cobro de 150 de intereses no reduce el capital", async () => {
  await as(ADMIN, `select public.register_payment('${open1}', 150, 0, 'cash', 'o-p1', null, ${LIMA} - 10)`);
  const s = await summary(open1);
  eq(s.principal_outstanding, 1000); eq(s.interest_paid, 150); eq(s.interest_pending, 0); eq(s.derived_status, "active");
});
await ok("pago duplicado (misma clave) no se contabiliza dos veces", async () => {
  await as(ADMIN, `select public.register_payment('${open1}', 150, 0, 'cash', 'o-p1', null, ${LIMA} - 10)`);
  eq((await db.query(`select count(*) c from payments where loan_id='${open1}'`)).rows[0].c, 1);
  eq((await summary(open1)).interest_paid, 150);
});
await ok("periodo siguiente: 150 de interés + 200 de capital → capital pendiente 800", async () => {
  await db.exec(`update installments set due_date = ${LIMA} - 1 where loan_id='${open1}' and n=2`); // simula que el período 2 ya venció
  open2 = (await as(ADMIN, `select public.register_payment('${open1}', 150, 200, 'yape', 'o-p2') as id`)).rows[0].id;
  const s = await summary(open1);
  eq(s.principal_outstanding, 800); eq(s.capital_paid, 200); eq(s.principal, 1000); eq(s.interest_paid, 300);
});
await ok("el abono no altera intereses ya generados (el siguiente período sigue en 150)", async () => {
  const r = await db.query(`select interest_due from installments where loan_id='${open1}' order by n`);
  if (!r.rows.every((x) => Number(x.interest_due) === 150)) throw new Error("intereses alterados: " + JSON.stringify(r.rows));
});
await ok("pagar un período de intereses NO cierra el préstamo abierto mientras haya capital", async () => {
  eq((await db.query(`select status from loans where id='${open1}'`)).rows[0].status, "active");
});
await ok("revertir el pago conserva el registro, el motivo y el asiento de caja", async () => {
  await as(ADMIN, `select public.reverse_payment('${open2}', 'cobro registrado por error')`);
  const p = (await db.query(`select status, reversal_reason from payments where id='${open2}'`)).rows[0];
  eq(p.status, "reversed"); eq(p.reversal_reason, "cobro registrado por error");
  eq((await db.query(`select count(*) c from cash_movements where payment_id='${open2}' and kind='reversal'`)).rows[0].c, 1);
  eq((await summary(open1)).principal_outstanding, 1000);
});
await ok("abierto: saldar capital e intereses exigibles lo marca pagado", async () => {
  await as(ADMIN, `select public.register_payment('${open1}', 150, 1000, 'cash', 'o-end')`);
  const s = await summary(open1);
  eq(s.principal_outstanding, 0); eq(s.derived_status, "paid");
});
await ok("cuotas fijas: 1200 al 10 % x4 → cuota de 400 (300 capital + 100 interés)", async () => {
  fixed1 = (await as(ADV, `select public.create_loan('${cOpen}', 1200, 10, 'monthly', 4, ${LIMA} - 10, 'fx1', 'fixed') as id`)).rows[0].id;
  const r = await db.query(`select interest_due i, capital_due c from installments where loan_id='${fixed1}' order by n`);
  eq(r.rows.length, 4); if (!r.rows.every((x) => Number(x.i) === 120 && Number(x.c) === 300)) throw new Error(JSON.stringify(r.rows));
});
await ok("cuotas fijas: el capital se imputa a la cuota más antigua y el saldo baja", async () => {
  await as(ADMIN, `select public.register_payment('${fixed1}', 120, 300, 'cash', 'fx-p1')`);
  const s = await summary(fixed1);
  eq(s.principal_outstanding, 900); eq(s.periods_paid, 1); eq(s.derived_status, "active");
});
await rejects("cuotas fijas: capital mayor al pendiente", () => as(ADMIN, `select public.register_payment('${fixed1}', 0, 901, 'cash', 'fx-big')`));
await ok("dos préstamos del mismo cliente no mezclan saldos ni pagos", async () => {
  const a = await summary(open1), b = await summary(fixed1);
  eq(a.principal_outstanding, 0); eq(b.principal_outstanding, 900); eq(a.client_id, b.client_id);
  eq((await db.query(`select count(*) c from payments where loan_id='${fixed1}'`)).rows[0].c, 1);
});
await ok("cuotas fijas: redondeo, el último absorbe centavos (1000 / 3)", async () => {
  fixed2 = (await as(ADV, `select public.create_loan('${cOpen}', 1000, 10, 'weekly', 3, ${LIMA}, 'fx2', 'fixed') as id`)).rows[0].id;
  const r = await db.query(`select capital_due c from installments where loan_id='${fixed2}' order by n`);
  eq(r.rows.map((x) => x.c).join(","), "333.33,333.33,333.34");
});
await ok("tarjetas: total pagado y último pago provienen de pagos confirmados", async () => {
  const s = await summary(fixed1);
  eq(s.total_paid, 420); eq(s.last_payment_on !== null, true);
});

await ok("un fallo de Telegram (notification_log 'failed') no afecta a los cobros", async () => {
  await db.exec(`insert into notification_log (kind, for_date, chat_id, dedupe_key, status, last_error) values ('overdue', ${LIMA}, '1', 'overdue:fallo:1', 'failed', 'Telegram caído')`);
  const before = (await db.query(`select count(*) c from payments`)).rows[0].c;
  await as(ADMIN, `select public.register_payment('${fixed1}', 120, 0, 'cash', 'fx-after-tg')`);
  eq((await db.query(`select count(*) c from payments`)).rows[0].c, Number(before) + 1);
});
await ok("exportación: el resumen coincide con la suma de pagos confirmados", async () => {
  const s = await summary(fixed1);
  const p = (await db.query(`select sum(interest_amount) i, sum(capital_amount) c from payments where loan_id='${fixed1}' and status='confirmed'`)).rows[0];
  eq(s.total_paid, Number(p.i) + Number(p.c)); eq(s.interest_paid, p.i); eq(s.capital_paid, p.c);
});

// ── Vencimientos, cierre y caja ──
let dueLoan, upLoan;
await ok("vence hoy: aparece como 'Vence hoy' (no vencido) con su importe", async () => {
  dueLoan = (await as(ADV, `select public.create_loan('${cOpen}', 1000, 15, 'monthly', null, (${LIMA} - interval '1 month')::date, 'due-today', 'open') as id`)).rows[0].id;
  const s = await summary(dueLoan);
  eq((await db.query(`select next_due_date::text d from v_loan_summary where id='${dueLoan}'`)).rows[0].d, (await db.query(`select ${LIMA}::text d`)).rows[0].d);
  eq(s.due_today_pending, 150); eq(s.interest_overdue, 0); eq(s.derived_status, "active"); eq(s.periods_overdue, 0);
});
await ok("pago parcial del período: sigue como próximo vencimiento con el saldo pendiente", async () => {
  await as(ADMIN, `select public.register_payment('${dueLoan}', 100, 0, 'cash', 'due-p1')`);
  const s = await summary(dueLoan);
  eq(s.due_today_pending, 50); eq(s.next_due_amount, 50); eq(s.periods_paid, 0);
});
await ok("período pagado por completo: el próximo vencimiento pasa al siguiente (futuro)", async () => {
  await as(ADMIN, `select public.register_payment('${dueLoan}', 50, 0, 'cash', 'due-p2')`);
  const s = await summary(dueLoan);
  eq(s.due_today_pending, 0); eq(s.periods_paid, 1);
  if (String(s.next_due_date).slice(0, 10) <= (await db.query(`select ${LIMA}::text d`)).rows[0].d) throw new Error("debía ser futuro: " + s.next_due_date);
});
await ok("próximo vencimiento futuro (cuotas fijas recién creadas)", async () => {
  upLoan = (await as(ADV, `select public.create_loan('${cOpen}', 600, 10, 'weekly', 3, ${LIMA}, 'up1', 'fixed') as id`)).rows[0].id;
  const s = await summary(upLoan);
  eq(s.due_today_pending, 0); eq(s.derived_status, "active"); eq(s.periods_overdue, 0);
});
await ok("préstamo cancelado: closed_on se fija y desaparece de obligaciones activas", async () => {
  const s = await summary(open1);
  eq(s.derived_status, "paid"); eq(s.closed_on !== null, true);
});
await ok("reabrir (reversión) limpia closed_on", async () => {
  const pid = (await db.query(`select id from payments where idempotency_key='o-end'`)).rows[0].id;
  await as(ADMIN, `select public.reverse_payment('${pid}', 'prueba de reapertura')`);
  const s = await summary(open1);
  eq(s.closed_on, null); eq(s.derived_status === "paid", false);
});
await rejects("caja: no se duplica el movimiento de un mismo pago y tipo", () =>
  db.query(`insert into cash_movements (kind, direction, amount, loan_id, payment_id, created_by) select kind, direction, amount, loan_id, payment_id, '${ADMIN}' from cash_movements where kind='interest_income' and payment_id is not null limit 1`));
await ok("reversión: ingresos de caja y pagos confirmados siguen conciliados", async () => {
  const r = (await db.query(`
    select coalesce(sum(case when c.kind in ('interest_income','capital_recovery') then c.amount when c.kind='reversal' then -c.amount end),0) cash,
           (select coalesce(sum(amount),0) from payments where status='confirmed') conf
    from cash_movements c where c.payment_id is not null`)).rows[0];
  eq(r.cash, r.conf);
});

// ── Abierto: interés sobre el capital PENDIENTE (S/2,000 al 15 %) ──
let ob, obPay;
const periods = async (id) => (await db.query(`select n, due_date::text d, interest_due i, interest_paid ip from installments where loan_id='${id}' order by n`)).rows;
const sched = async (id) => (await as(ADMIN, `select * from public.loan_schedule('${id}')`)).rows;
await ok("abierto 2000 al 15 %: período 1 = 300 y el siguiente (aún no vence) también 300", async () => {
  ob = (await as(ADV, `select public.create_loan('${cOpen}', 2000, 15, 'monthly', null, (${LIMA} - interval '1 month')::date, 'ob1', 'open') as id`)).rows[0].id;
  const p = await periods(ob);
  eq(p.length, 2); eq(p[0].i, 300); eq(p[1].i, 300);
});
await ok("paga 300 de interés + 1000 de capital → capital 1000 y el siguiente período pasa a 150", async () => {
  obPay = (await as(ADMIN, `select public.register_payment('${ob}', 300, 1000, 'cash', 'ob-p1') as id`)).rows[0].id;
  eq((await summary(ob)).principal_outstanding, 1000);
  const p = await periods(ob);
  eq(p.length, 2); eq(p[0].i, 300); eq(p[0].ip, 300);   // el período cobrado conserva su historial
  eq(p[1].i, 150); eq(p[1].ip, 0);                       // el siguiente usa el capital pendiente
});
await ok("recargar/consultar varias veces no duplica períodos ni cambia importes", async () => {
  for (let k = 0; k < 3; k++) await as(ADV, `select public.refresh_open_loans()`);
  const p = await periods(ob);
  eq(p.length, 2); eq(p[0].i, 300); eq(p[1].i, 150);
});
await ok("cronograma: capital de referencia, capital abonado e interés por período", async () => {
  const s = await sched(ob);
  eq(s[0].reference_capital, 2000); eq(s[0].capital_applied, 1000); eq(s[0].interest_due, 300);
  eq(s[1].reference_capital, 1000); eq(s[1].capital_applied, 0); eq(s[1].interest_due, 150);
});
await ok("solo intereses: el capital no cambia y el siguiente interés tampoco", async () => {
  await db.exec(`update installments set due_date = ${LIMA} - 1 where loan_id='${ob}' and n=2`); // el período 2 ya venció
  await as(ADMIN, `select public.register_payment('${ob}', 150, 0, 'cash', 'ob-p2')`);
  eq((await summary(ob)).principal_outstanding, 1000);
  const p = await periods(ob);
  eq(p[1].i, 150); eq(p[1].ip, 150);
});
await ok("pago parcial de intereses conserva el saldo y no genera un segundo cobro por el mismo interés", async () => {
  const q = (await as(ADV, `select public.create_loan('${cOpen}', 2000, 15, 'monthly', null, (${LIMA} - interval '1 month')::date, 'ob2', 'open') as id`)).rows[0].id;
  await as(ADMIN, `select public.register_payment('${q}', 100, 0, 'cash', 'ob2-p1')`);
  const p = await periods(q);
  eq(p[0].i, 300); eq(p[0].ip, 100);
  eq((await summary(q)).interest_pending, 200);
  await as(ADMIN, `select public.register_payment('${q}', 100, 0, 'cash', 'ob2-p2')`); // dos pagos en el mismo período
  eq((await periods(q))[0].ip, 200);
  eq((await summary(q)).interest_pending, 100);
});
await ok("abono extraordinario de capital actualiza la base del siguiente período", async () => {
  const q = (await as(ADV, `select public.create_loan('${cOpen}', 2000, 15, 'monthly', null, ${LIMA}, 'ob3', 'open') as id`)).rows[0].id;
  eq((await periods(q))[0].i, 300);
  await as(ADMIN, `select public.register_payment('${q}', 0, 500, 'cash', 'ob3-p1')`);   // período 1 aún no vence y sin cobro de interés
  eq((await periods(q))[0].i, 225);                                                       // (2000-500) × 15 %
});
await ok("revertir el pago restaura el interés del siguiente período y conserva el historial", async () => {
  await as(ADMIN, `select public.reverse_payment('${obPay}', 'pago registrado por error')`);
  eq((await summary(ob)).principal_outstanding, 2000);
  const p = await periods(ob);
  eq(p[0].i, 300); eq(p[0].ip, 0);
  eq((await db.query(`select status from payments where id='${obPay}'`)).rows[0].status, "reversed");
});
await ok("fijas y solo intereses mantienen su lógica: el interés no cambia tras abonar capital", async () => {
  const f = (await as(ADV, `select public.create_loan('${cOpen}', 1000, 10, 'monthly', 3, ${LIMA}, 'ob-fx', 'interest_only') as id`)).rows[0].id;
  await as(ADMIN, `select public.register_payment('${f}', 0, 400, 'cash', 'ob-fx-p1')`);
  const p = await periods(f);
  if (!p.every((x) => Number(x.i) === 100)) throw new Error(JSON.stringify(p));
});
await ok("préstamo abierto cancelado no genera más períodos", async () => {
  const q = (await as(ADV, `select public.create_loan('${cOpen}', 500, 10, 'monthly', null, ${LIMA}, 'ob4', 'open') as id`)).rows[0].id;
  await as(ADMIN, `select public.register_payment('${q}', 0, 500, 'cash', 'ob4-p1')`);
  const before = (await periods(q)).length;
  await as(ADV, `select public.refresh_open_loans()`);
  eq((await periods(q)).length, before);
  eq((await summary(q)).derived_status, "paid");
});

// ── Anulación (eliminación lógica) de préstamos ──
let cl1, cl2;
const cashNet = async (id) => (await db.query(`select coalesce(sum(case when direction='in' then amount else -amount end),0) n from cash_movements where loan_id='${id}'`)).rows[0].n;
await ok("préstamo sin pagos: el administrador lo anula, se conserva todo y la caja queda neta en 0", async () => {
  cl1 = (await as(ADV, `select public.create_loan('${cOpen}', 700, 10, 'monthly', 2, ${LIMA}, 'cl1', 'fixed') as id`)).rows[0].id;
  eq(await cashNet(cl1), -700);
  await as(ADMIN, `select public.cancel_loan('${cl1}', 'registrado por error')`);
  eq((await db.query(`select status from loans where id='${cl1}'`)).rows[0].status, "cancelled");
  eq(await cashNet(cl1), 0);
  eq((await db.query(`select count(*) c from cash_movements where loan_id='${cl1}'`)).rows[0].c, 2);   // desembolso + contra-asiento
  eq((await db.query(`select count(*) c from disbursements where loan_id='${cl1}'`)).rows[0].c, 1);
  eq((await db.query(`select count(*) c from installments where loan_id='${cl1}'`)).rows[0].c, 2);
  eq((await db.query(`select count(*) c from audit_log where action='CANCEL_LOAN' and entity_id='${cl1}'`)).rows[0].c, 1);
});
await rejects("no se anula dos veces", () => as(ADMIN, `select public.cancel_loan('${cl1}', 'otra vez por error')`));
await ok("el anulado deja de contar como desembolsado y como cartera", async () => {
  eq((await summary(cl1)).derived_status, "cancelled");
  const t = (await as(ADMIN, `select * from public.report_totals()`)).rows[0];
  eq(t.disbursed, (await db.query(`select sum(d.amount) a from disbursements d join loans l on l.id=d.loan_id where l.status<>'cancelled'`)).rows[0].a);
});
await ok("préstamo con pagos confirmados NO se anula y conserva su historial", async () => {
  cl2 = (await as(ADV, `select public.create_loan('${cOpen}', 400, 10, 'monthly', 2, ${LIMA}, 'cl2', 'interest_only') as id`)).rows[0].id;
  await as(ADMIN, `select public.register_payment('${cl2}', 0, 100, 'cash', 'cl2-p1')`);
  let msg = "";
  try { await as(ADMIN, `select public.cancel_loan('${cl2}', 'intento con pagos')`); } catch (e) { msg = e.message; }
  if (!msg.includes("pagos confirmados")) throw new Error("debía rechazarse: " + msg);
  eq((await db.query(`select status from loans where id='${cl2}'`)).rows[0].status, "active");
  eq((await db.query(`select count(*) c from payments where loan_id='${cl2}'`)).rows[0].c, 1);
});
await rejects("asesor no puede anular préstamos", () => as(ADV, `select public.cancel_loan('${cl2}', 'sin permiso para esto')`));
await rejects("cobrador no puede anular préstamos", () => as(COL, `select public.cancel_loan('${cl2}', 'sin permiso para esto')`));
await rejects("el motivo es obligatorio", () => as(ADMIN, `select public.cancel_loan('${cl2}', 'x')`));
await ok("con el pago revertido (historial intacto) el préstamo ya puede anularse", async () => {
  const pid = (await db.query(`select id from payments where idempotency_key='cl2-p1'`)).rows[0].id;
  await as(ADMIN, `select public.reverse_payment('${pid}', 'cobro registrado por error')`);
  await as(ADMIN, `select public.cancel_loan('${cl2}', 'préstamo duplicado')`);
  eq((await db.query(`select status from payments where id='${pid}'`)).rows[0].status, "reversed");
  eq((await db.query(`select count(*) c from payments where loan_id='${cl2}'`)).rows[0].c, 1);
  eq(await cashNet(cl2), 0);
});
await rejects("borrar físicamente un préstamo sigue prohibido", () => db.query(`delete from loans where id='${cl2}'`));
await ok("doble envío con la misma clave no duplica el préstamo ni el desembolso", async () => {
  const k = "dbl-click-1";
  const [a, b] = [await as(ADV, `select public.create_loan('${cOpen}', 300, 10, 'monthly', 2, ${LIMA}, '${k}', 'fixed') as id`), await as(ADV, `select public.create_loan('${cOpen}', 300, 10, 'monthly', 2, ${LIMA}, '${k}', 'fixed') as id`)];
  eq(a.rows[0].id, b.rows[0].id);
  eq((await db.query(`select count(*) c from disbursements where loan_id='${a.rows[0].id}'`)).rows[0].c, 1);
});

// ── Edición de clientes ──
const snap = async () => JSON.stringify([
  (await db.query(`select id, loan_id, interest_amount, capital_amount, status from payments order by receipt_no`)).rows,
  (await db.query(`select id, client_id, principal, principal_outstanding, rate_pct from loans order by code`)).rows,
  (await db.query(`select id, kind, amount from cash_movements order by created_at, id`)).rows,
]);
await ok("asesor edita nombre, teléfono, dirección y cobrador; préstamos y pagos no cambian", async () => {
  const before = await snap();
  const loansBefore = (await db.query(`select count(*) c from loans where client_id='${client}'`)).rows[0].c;
  const r = await as(ADV, `update clients set full_name='Cliente Uno Editado', phone='987654321', address='Av. Nueva 123', assigned_collector='${COL}' where id='${client}' returning id`);
  eq(r.rows.length, 1); eq(r.rows[0].id, client);
  const c = (await db.query(`select full_name, phone, address, assigned_collector from clients where id='${client}'`)).rows[0];
  eq(c.full_name, "Cliente Uno Editado"); eq(c.phone, "987654321"); eq(c.address, "Av. Nueva 123"); eq(c.assigned_collector, COL);
  eq(await snap(), before);                                                                       // pagos, préstamos y caja intactos
  eq((await db.query(`select count(*) c from loans where client_id='${client}'`)).rows[0].c, loansBefore);   // siguen asociados
  eq((await db.query(`select count(*) c from clients where document_id='12345678'`)).rows[0].c, 1);        // sin duplicados
});
await rejects("DNI duplicado de otro cliente", () => as(ADV, `update clients set document_id='22222222' where id='${client}'`));
await rejects("el id del cliente no se puede cambiar", () => as(ADV, `update clients set id=gen_random_uuid() where id='${client}'`));
await rejects("cobrador asignado inexistente", () => as(ADV, `update clients set assigned_collector=gen_random_uuid() where id='${client}'`));
await rejects("no se puede asignar un asesor como cobrador", () => as(ADV, `update clients set assigned_collector='${ADV}' where id='${client}'`));
await rejects("teléfono con formato inválido", () => as(ADV, `update clients set phone='abc' where id='${client}'`));
await ok("el cobrador no puede editar clientes (RLS: 0 filas)", async () => {
  const r = await as(COL, `update clients set full_name='Hackeado' where id='${client}' returning id`);
  eq(r.rows.length, 0);
  eq((await db.query(`select full_name from clients where id='${client}'`)).rows[0].full_name, "Cliente Uno Editado");
});
await ok("desactivar y reactivar al cliente no toca sus préstamos", async () => {
  const before = await snap();
  await as(ADMIN, `update clients set active=false where id='${client}'`);
  await as(ADMIN, `update clients set active=true where id='${client}'`);
  eq(await snap(), before);
});

// ── Alertas de Telegram: la migración conserva lo guardado y amplía el registro ──
await ok("telegram_settings conserva token y chat; nuevos campos con valores por defecto", async () => {
  const r = (await db.query(`select bot_token_enc, chat_ids, send_payments, overdue_intervals, overdue_repeat_days, last_run_at from telegram_settings where id=1`)).rows[0];
  eq(r.bot_token_enc, "iv.tag.datos"); eq(String(r.chat_ids), "123");
  eq(r.send_payments, true); eq(String(r.overdue_intervals), "1,3,5,7"); eq(r.overdue_repeat_days, 7); eq(r.last_run_at, null);
});
await rejects("intervalos de atraso inválidos (0 o vacío)", () => db.query(`update telegram_settings set overdue_intervals='{0,3}'`));
await ok("el registro admite avisos de pago y reversión, una vez por pago y chat", async () => {
  await db.exec(`insert into notification_log (kind, for_date, chat_id, dedupe_key, status, item_keys) values ('payment', ${LIMA}, '1', 'payment:P:1', 'sent', '{p1}')`);
  await db.exec(`insert into notification_log (kind, for_date, chat_id, dedupe_key, status) values ('reversal', ${LIMA}, '1', 'reversal:P:1', 'sent')`);
});
await rejects("el mismo aviso de pago no se duplica", () => db.query(`insert into notification_log (kind, for_date, chat_id, dedupe_key, status) values ('payment', ${LIMA}, '1', 'payment:P:1', 'sent')`));
await rejects("tipo de aviso desconocido rechazado", () => db.query(`insert into notification_log (kind, for_date, chat_id, dedupe_key, status) values ('spam', ${LIMA}, '1', 'x', 'sent')`));

// ── Registro de ejecuciones ──
await ok("notification_runs: solo el servidor escribe y solo el administrador lee", async () => {
  await db.exec(`insert into notification_runs (job, trigger, started_at, finished_at, status, obligations_checked, sent, skipped, failed, errors)
    values ('morning', 'cron', now(), now(), 'partial', 4, 2, 1, 1, '{"Bad Request: chat not found"}')`);
  eq((await as(ADMIN, `select count(*) c from notification_runs`)).rows[0].c, 1);
  eq((await as(ADV, `select count(*) c from notification_runs`)).rows[0].c, 0);
  eq((await db.query(`select timezone from notification_runs`)).rows[0].timezone, "America/Lima");
});
await rejects("authenticated no puede escribir en notification_runs", () => as(ADMIN, `insert into notification_runs (job, started_at, finished_at, status) values ('all', now(), now(), 'ok')`));
await ok("la revisión horaria registra sus ejecuciones (job 'hourly')", async () => {
  await db.exec(`insert into notification_runs (job, trigger, started_at, finished_at, status) values ('hourly', 'cron', now(), now(), 'skipped')`);
});
await rejects("estado de ejecución inválido", () => db.query(`insert into notification_runs (job, started_at, finished_at, status) values ('all', now(), now(), 'raro')`));

// ── Auditoría: permisos efectivos, cobrador y vistas ──
await rejects("authenticated no puede ejecutar funciones internas (app.accrue_open_loan)", () => as(ADMIN, `select app.accrue_open_loan('${ob}')`));
await rejects("authenticated no puede ejecutar app.recompute_open_future", () => as(ADMIN, `select app.recompute_open_future('${ob}')`));
await rejects("authenticated no puede ejecutar app.sync_loan_status", () => as(ADMIN, `select app.sync_loan_status('${ob}')`));
await rejects("authenticated no puede escribir en loan_events", () => as(ADMIN, `insert into loan_events (loan_id, kind) values ('${ob}', 'x')`));
await rejects("anon no puede leer las vistas de cartera", async () => {
  await db.exec(`set role anon`);
  try { await db.query(`select * from v_loan_summary`); } finally { await db.exec(`reset role`); }
});
await rejects("authenticated no puede modificar las vistas", () => as(ADMIN, `update v_loan_summary set principal = 1`));
await ok("las políticas de lectura siguen funcionando tras el endurecimiento (RLS evalúa app.can_see_loan)", async () => {
  eq((await as(ADV, `select count(*) c from v_loan_summary`)).rows[0].c > 0, true);
});
let colLoan;
await ok("cobrador registra pagos de un cliente asignado y NO de uno ajeno", async () => {
  await db.exec(`update clients set assigned_collector='${COL}' where id='${client}'`);
  colLoan = (await as(ADV, `select public.create_loan('${client}', 300, 10, 'monthly', 2, ${LIMA}, 'col-mine', 'interest_only') as id`)).rows[0].id;
  await as(COL, `select public.register_payment('${colLoan}', 0, 50, 'cash', 'col-pay-1')`);
  eq((await db.query(`select principal_outstanding p from loans where id='${colLoan}'`)).rows[0].p, 250);
  const other = (await as(ADV, `insert into clients (full_name, document_id) values ('Ajeno','99999991') returning id`)).rows[0].id;
  const foreign = (await as(ADV, `select public.create_loan('${other}', 300, 10, 'monthly', 2, ${LIMA}, 'col-foreign', 'interest_only') as id`)).rows[0].id;
  let msg = ""; try { await as(COL, `select public.register_payment('${foreign}', 0, 50, 'cash', 'col-pay-2')`); } catch (e) { msg = e.message; }
  if (!msg.includes("no encontrado")) throw new Error("debía rechazarse: " + msg);
  let msg2 = ""; try { await as(COL, `select public.cancel_loan('${colLoan}', 'sin permiso de cobrador')`); } catch (e) { msg2 = e.message; }
  if (!msg2.includes("administrador")) throw new Error("cobrador anuló: " + msg2);
});
await ok("v_loan_portfolio y v_loan_summary usan la MISMA definición de intereses pendientes", async () => {
  const a = (await db.query(`select id, interest_pending, interest_overdue, capital_overdue, days_overdue from v_loan_portfolio order by id`)).rows;
  const b = (await db.query(`select id, interest_pending, interest_overdue, capital_overdue, days_overdue from v_loan_summary where db_status in ('active','defaulted') order by id`)).rows;
  eq(JSON.stringify(a), JSON.stringify(b));
});
await ok("el interés futuro (aún no vencido) NO cuenta como 'pendiente' en la cartera", async () => {
  const fut = (await as(ADV, `select public.create_loan('${client}', 1000, 10, 'monthly', 3, ${LIMA}, 'pf-1', 'interest_only') as id`)).rows[0].id;
  const r = (await db.query(`select interest_pending, interest_total from v_loan_portfolio where id='${fut}'`)).rows[0];
  eq(r.interest_pending, 0); eq(r.interest_total, 300);
});
await ok("refresh_open_loans ya no recorre préstamos que no necesitan período nuevo", async () => {
  const fresh = (await as(ADV, `select public.create_loan('${client}', 800, 10, 'monthly', null, ${LIMA}, 'rf-1', 'open') as id`)).rows[0].id;
  await db.exec(`update installments set interest_due = interest_due where loan_id='${fresh}'`);
  const n = (await as(ADV, `select public.refresh_open_loans() as n`)).rows[0].n;
  const need = (await db.query(`select count(*) c from loans l where loan_type='open' and status='active' and principal_outstanding>0 and coalesce((select max(due_date) from installments where loan_id=l.id), '-infinity') <= (now() at time zone 'America/Lima')::date`)).rows[0].c;
  eq(n, Number(need));
  eq((await db.query(`select count(*) c from installments where loan_id='${fresh}'`)).rows[0].c, 1);
});

console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);

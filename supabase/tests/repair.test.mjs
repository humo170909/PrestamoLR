// Simula una base ya migrada a la que le faltan objetos de 20261008000700 y comprueba que 20261012000800 la repara y es repetible.
// Ejecutar: node supabase/tests/repair.test.mjs
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";

const dir = new URL("../migrations/", import.meta.url);
const db = new PGlite();
await db.exec(`
  create role anon nologin; create role authenticated nologin; create schema auth;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated; grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
  alter default privileges in schema public grant execute on functions to anon, authenticated;
`);
const files = fs.readdirSync(dir).sort();
const last = "20261012000800_hardening_perf.sql";
for (const f of files.filter((x) => x !== last)) await db.exec(fs.readFileSync(new URL(f, dir), "utf8"));

// Estado del usuario: faltan los triggers/funciones de cierre automático y de trabajadores/cobradores.
await db.exec(`
  drop trigger loan_status_sync_loan on public.loans;
  drop trigger loan_status_sync_installment on public.installments;
  drop function app.sync_loan_status_from_loan();
  drop function app.sync_loan_status_from_installment();
  drop function public.worker_stats();
  drop function public.list_collectors();
`);
const sql = fs.readFileSync(new URL(last, dir), "utf8");
let pass = 0, fail = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ✔", name); } else { fail++; console.log("  ✘", name); } };
try { await db.exec(sql); check("la migración 0800 se ejecuta sobre una base a la que le faltan objetos", true); }
catch (e) { check("la migración 0800 se ejecuta (" + e.message + ")", false); }
try { await db.exec(sql); check("es repetible (idempotente)", true); } catch (e) { check("es repetible (" + e.message + ")", false); }
const q = async (s) => (await db.query(s)).rows;
check("recreó los triggers de cierre automático", (await q(`select count(*) c from pg_trigger where tgname in ('loan_status_sync_loan','loan_status_sync_installment')`))[0].c == 2);
check("recreó worker_stats y list_collectors", (await q(`select count(*) c from pg_proc where proname in ('worker_stats','list_collectors')`))[0].c == 2);
check("las funciones internas quedaron sin permiso de ejecución para authenticated",
  (await q(`select has_function_privilege('authenticated', 'app.accrue_open_loan(uuid)', 'execute') x`))[0].x === false);
check("v_loan_portfolio existe y es legible por authenticated", (await q(`select has_table_privilege('authenticated','public.v_loan_portfolio','select') x`))[0].x === true);

// Un préstamo pagado debe cerrarse solo gracias a los triggers reparados.
await db.exec(`
  insert into auth.users values ('00000000-0000-0000-0000-0000000000a1','a@x');
  insert into profiles (id, full_name, role) values ('00000000-0000-0000-0000-0000000000a1','Admin','admin');
  select set_config('request.jwt.sub','00000000-0000-0000-0000-0000000000a1', false);
`);
await db.exec(`set role authenticated`);
const cid = (await db.query(`insert into clients (full_name, document_id) values ('Cli','11112222') returning id`)).rows[0].id;
const lid = (await db.query(`select public.create_loan('${cid}', 100, 10, 'monthly', 1, (now() at time zone 'America/Lima')::date, 'rp1', 'interest_only') as id`)).rows[0].id;
await db.query(`select public.register_payment('${lid}', 10, 100, 'cash', 'rp-pay')`);
await db.exec(`reset role`);
check("un préstamo pagado por completo pasa solo a 'paid_off'", (await q(`select status from loans where id='${lid}'`))[0].status === "paid_off");
console.log(`\n${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);

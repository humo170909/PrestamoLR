// M-07: una sola lectura de cuotas por ejecución y filtrada en SQL (solo impagas).
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runJob, fetchPending } from "./dispatch.ts";
import { encryptSecret } from "./crypto.ts";

type Row = Record<string, unknown>;
const TOKEN = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY = "ab".repeat(32);
const TODAY = "2026-10-12";

const loans = { id: "L1", code: "PR-0016", status: "active", principal_outstanding: "1000.00", clients: { full_name: "Jorge Ramírez", phone: "987654321" } };
const row = (n: number, due: string, paid = "0.00"): Row => ({ n, due_date: due, interest_due: "150.00", interest_paid: paid, capital_due: "0.00", capital_paid: "0.00", loans });

/** Registra cada consulta a `installments` con sus filtros; el servidor simulado devuelve lo que se le indique. */
const fake = (installments: Row[]) => {
  const queries: { filters: [string, unknown][] }[] = [];
  const settings: Row = { id: 1, bot_token_enc: encryptSecret(TOKEN, KEY), chat_ids: ["123456789"], enabled: true, send_today: true, send_overdue: true, send_tomorrow: true };
  const log: Row[] = [];
  const q = (t: string) => {
    let op = "select"; let payload: Row = {}; const preds: ((r: Row) => boolean)[] = [];
    const rec = t === "installments" ? { filters: [] as [string, unknown][] } : null;
    if (rec) queries.push(rec);
    const self: Record<string, unknown> = {
      select() { return self; }, insert(p: Row) { op = "insert"; payload = p; return self; }, update(p: Row) { op = "update"; payload = p; return self; },
      eq(k: string, v: unknown) { preds.push((r) => r[k] === v); return self; },
      in(k: string, v: unknown) { rec?.filters.push([k, v]); return self; },
      lte(k: string, v: unknown) { rec?.filters.push([k, v]); return self; },
      order() { return self; }, range() { return self; },
      maybeSingle() { return exec().then((r) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })); },
      then(f: (v: unknown) => unknown, r?: (e: unknown) => unknown) { return exec().then(f, r); },
    };
    const exec = async (): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
      if (t === "notification_log" && op === "insert") { log.push({ ...payload }); return { data: null, error: null }; }
      if (t === "notification_log" && op === "update") { log.filter((r) => preds.every((p) => p(r))).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      if (t === "notification_runs") return { data: null, error: null };
      const table = t === "telegram_settings" ? [settings] : t === "installments" ? installments : t === "payments" ? [] : log;
      return { data: table.filter((r) => preds.every((p) => p(r))), error: null };
    };
    return self;
  };
  return { sb: { from: q } as unknown as SupabaseClient, queries };
};

beforeEach(() => {
  process.env.TELEGRAM_ENCRYPTION_KEY = KEY; process.env.TELEGRAM_BOT_TOKEN = ""; process.env.TELEGRAM_CHAT_ID = "";
  globalThis.fetch = (async () => ({ status: 200, json: async () => ({ ok: true, result: {} }) })) as unknown as typeof fetch;
});

test("fetchPending pide solo cuotas impagas (is_unpaid) y hasta la fecha límite", async () => {
  const { sb, queries } = fake([row(1, TODAY)]);
  await fetchPending(sb, "2026-10-20");
  assert.equal(queries.length, 1);
  assert.ok(queries[0].filters.some(([k, v]) => k === "is_unpaid" && JSON.stringify(v) === "[true]"), "falta el filtro is_unpaid: " + JSON.stringify(queries[0].filters));
  assert.ok(queries[0].filters.some(([k, v]) => k === "due_date" && v === "2026-10-20"));
});

test("el trabajo de la tarde (hoy + atrasos + mañana) lee las cuotas UNA sola vez, no una por tipo de aviso", async () => {
  const { sb, queries } = fake([row(1, TODAY), row(2, "2026-10-13")]);
  const r = await runJob(sb, "evening", TODAY);
  assert.ok(r.length >= 3, "debe procesar los 3 tipos: " + JSON.stringify(r.map((x) => x.kind)));
  assert.equal(queries.length, 1, `consultas a installments: ${queries.length}`);
});

test("el trabajo de la mañana y el 'all' también leen una sola vez", async () => {
  for (const job of ["morning", "all", "hourly"] as const) {
    const { sb, queries } = fake([row(1, TODAY)]);
    await runJob(sb, job, TODAY, "manual", new Date("2026-10-12T17:00:00Z"));   // 12:00 Lima: dentro de la ventana horaria
    assert.equal(queries.length, 1, `${job}: ${queries.length} consultas`);
  }
});

test("las cuotas ya saldadas que lleguen igualmente no generan avisos (defensa adicional)", async () => {
  const { sb } = fake([row(1, TODAY, "150.00")]);
  assert.deepEqual(await fetchPending(sb, "2026-10-20"), []);
});

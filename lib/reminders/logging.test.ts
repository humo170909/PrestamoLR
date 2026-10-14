// M-09: dispatch registra fallos con logs estructurados y sin datos sensibles.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runJob, runKind } from "./dispatch.ts";
import { encryptSecret } from "./crypto.ts";

type Row = Record<string, unknown>;
const TOKEN = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY = "ab".repeat(32);
const TODAY = "2026-10-12";

/** Supabase mínimo en memoria; `failInstallments` simula un error en la consulta de cuotas y `failRuns` en el registro de ejecuciones. */
const fake = (o: { failInstallments?: boolean; failRuns?: boolean } = {}) => {
  const log: Row[] = [];
  const settings: Row = { id: 1, bot_token_enc: encryptSecret(TOKEN, KEY), chat_ids: ["-1001234567890"], enabled: true, send_today: true, send_overdue: true, send_tomorrow: true };
  const inst: Row[] = [{ n: 1, due_date: TODAY, interest_due: "150.00", interest_paid: "0.00", capital_due: "0.00", capital_paid: "0.00",
    loans: { id: "L1", code: "PR-0016", status: "active", principal_outstanding: "1000.00", clients: { full_name: "Jorge Ramírez", phone: "987654321" } } }];
  const q = (t: string) => {
    let op = "select"; let payload: Row = {}; const preds: ((r: Row) => boolean)[] = [];
    const self: Record<string, unknown> = {
      select() { return self; }, insert(p: Row) { op = "insert"; payload = p; return self; }, update(p: Row) { op = "update"; payload = p; return self; },
      eq(k: string, v: unknown) { preds.push((r) => r[k] === v); return self; }, in() { return self; }, lte() { return self; }, order() { return self; }, range() { return self; },
      maybeSingle() { return exec().then((r) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })); },
      then(f: (v: unknown) => unknown, r?: (e: unknown) => unknown) { return exec().then(f, r); },
    };
    const exec = async (): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
      if (t === "installments" && o.failInstallments) return { data: null, error: { message: `boom con ${TOKEN}` } };
      if (t === "notification_runs") return o.failRuns ? { data: null, error: { message: "runs caído" } } : { data: null, error: null };
      if (t === "notification_log" && op === "insert") { log.push({ ...payload }); return { data: null, error: null }; }
      if (t === "notification_log" && op === "update") { log.filter((r) => preds.every((p) => p(r))).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
      const table = t === "telegram_settings" ? [settings] : t === "installments" ? inst : t === "payments" ? [] : log;
      return { data: table.filter((r) => preds.every((p) => p(r))), error: null };
    };
    return self;
  };
  return { from: q } as unknown as SupabaseClient;
};

let lines: string[];
const orig = { log: console.log, warn: console.warn, error: console.error };
const events = () => lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) as Row[];
const done = () => Object.assign(console, orig);
beforeEach(() => {
  process.env.TELEGRAM_ENCRYPTION_KEY = KEY; process.env.TELEGRAM_BOT_TOKEN = ""; process.env.TELEGRAM_CHAT_ID = "";
  lines = [];
  console.log = (l: string) => { lines.push(String(l)); };
  console.warn = console.log; console.error = console.log;
  globalThis.fetch = (async () => ({ status: 400, json: async () => ({ ok: false, description: "Bad Request: chat not found" }) })) as unknown as typeof fetch;
});

test("un envío fallido a Telegram deja un log estructurado, con el chat enmascarado y sin token ni teléfono", async () => {
  try {
    await runKind(fake(), "today", TODAY);
    const e = events().find((x) => x.event === "telegram_delivery_failed");
    assert.ok(e, "falta el evento telegram_delivery_failed; líneas: " + lines.join(" | "));
    assert.equal(e.kind, "today"); assert.equal(e.level, "warn");
    const all = lines.join("\n");
    for (const bad of [TOKEN, "987654321", "1001234567890", "Jorge", KEY]) assert.ok(!all.includes(bad), `filtra ${bad}`);
    assert.ok(all.includes("••••7890"));
  } finally { done(); }
});

test("un error al leer las cuotas se registra con nivel error y token depurado", async () => {
  try {
    const r = await runKind(fake({ failInstallments: true }), "today", TODAY);
    assert.equal(r[0].status, "failed");
    const e = events().find((x) => x.event === "pending_fetch_failed");
    assert.ok(e, "falta pending_fetch_failed"); assert.equal(e.level, "error");
    assert.ok(!lines.join("\n").includes(TOKEN));
  } finally { done(); }
});

test("si falla el registro de la ejecución (notification_runs) se avisa en vez de callar", async () => {
  try {
    await runJob(fake({ failRuns: true }), "morning", TODAY);
    assert.ok(events().some((x) => x.event === "run_record_failed"), "falta run_record_failed");
    assert.ok(events().some((x) => x.event === "job_finished" && x.job === "morning"), "falta job_finished");
  } finally { done(); }
});

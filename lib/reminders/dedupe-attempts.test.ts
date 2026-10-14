// M-08: reintentos de deduplicación (máx. MAX_ATTEMPTS por clave; lo ya enviado nunca se repite). El mutante que quitaba el tope sobrevivía.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MAX_ATTEMPTS, runKind } from "./dispatch.ts";
import { encryptSecret } from "./crypto.ts";

type Row = Record<string, unknown>;
const TOKEN = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY = "ab".repeat(32);
const TODAY = "2026-10-12";
const CHAT = "123456789";
const DEDUPE = `today:${TODAY}:${CHAT}`;

const world = (existing?: Row) => {
  const log: Row[] = existing ? [{ id: "log-0", dedupe_key: DEDUPE, kind: "today", chat_id: CHAT, ...existing }] : [];
  const settings: Row = { id: 1, bot_token_enc: encryptSecret(TOKEN, KEY), chat_ids: [CHAT], enabled: true, send_today: true, send_overdue: true, send_tomorrow: true };
  const inst: Row[] = [{ n: 1, due_date: TODAY, interest_due: "150.00", interest_paid: "0.00", capital_due: "0.00", capital_paid: "0.00",
    loans: { id: "L1", code: "PR-0016", status: "active", principal_outstanding: "1000.00", clients: { full_name: "Jorge", phone: null } } }];
  const q = (t: string) => {
    let op = "select"; let payload: Row = {}; let wantRows = false; const preds: ((r: Row) => boolean)[] = [];
    const self: Record<string, unknown> = {
      select() { if (op !== "select") wantRows = true; return self; },
      insert(p: Row) { op = "insert"; payload = p; return self; }, update(p: Row) { op = "update"; payload = p; return self; },
      eq(k: string, v: unknown) { preds.push((r) => r[k] === v); return self; }, in() { return self; }, lte() { return self; }, order() { return self; }, range() { return self; },
      maybeSingle() { return exec().then((r) => ({ data: Array.isArray(r.data) ? r.data[0] ?? null : r.data, error: r.error })); },
      then(f: (v: unknown) => unknown, r?: (e: unknown) => unknown) { return exec().then(f, r); },
    };
    const exec = async (): Promise<{ data: unknown; error: { code?: string; message: string } | null }> => {
      if (t === "notification_runs") return { data: null, error: null };
      if (t === "notification_log" && op === "insert") {
        if (log.some((r) => r.dedupe_key === payload.dedupe_key)) return { data: null, error: { code: "23505", message: "duplicate" } };
        log.push({ id: `log-${log.length + 1}`, ...payload }); return { data: null, error: null };
      }
      if (t === "notification_log" && op === "update") {
        const m = log.filter((r) => preds.every((p) => p(r))); m.forEach((r) => Object.assign(r, payload));
        return { data: wantRows ? m.map((r) => ({ id: r.id })) : null, error: null };
      }
      const table = t === "telegram_settings" ? [settings] : t === "installments" ? inst : t === "payments" ? [] : log;
      return { data: table.filter((r) => preds.every((p) => p(r))), error: null };
    };
    return self;
  };
  return { sb: { from: q } as unknown as SupabaseClient, log };
};

let sends = 0;
beforeEach(() => {
  process.env.TELEGRAM_ENCRYPTION_KEY = KEY; process.env.TELEGRAM_BOT_TOKEN = ""; process.env.TELEGRAM_CHAT_ID = "";
  sends = 0;
  globalThis.fetch = (async () => { sends++; return { status: 200, json: async () => ({ ok: true, result: {} }) }; }) as unknown as typeof fetch;
});

test("MAX_ATTEMPTS es 3", () => assert.equal(MAX_ATTEMPTS, 3));

test("un aviso que ya agotó sus intentos NO se vuelve a enviar", async () => {
  const w = world({ status: "failed", attempts: MAX_ATTEMPTS, last_error: "chat not found" });
  const r = await runKind(w.sb, "today", TODAY);
  assert.equal(sends, 0);
  assert.equal(r[0].status, "skipped");
  assert.equal(w.log[0].attempts, MAX_ATTEMPTS);
});

test("un aviso fallido con intentos disponibles SÍ se reintenta y sube el contador", async () => {
  const w = world({ status: "failed", attempts: MAX_ATTEMPTS - 1, last_error: "503" });
  const r = await runKind(w.sb, "today", TODAY);
  assert.equal(sends, 1);
  assert.equal(r[0].status, "sent");
  assert.equal(w.log[0].attempts, MAX_ATTEMPTS);
  assert.equal(w.log[0].status, "sent");
});

test("un aviso ya enviado nunca se repite, aunque le queden intentos", async () => {
  const w = world({ status: "sent", attempts: 1 });
  const r = await runKind(w.sb, "today", TODAY);
  assert.equal(sends, 0);
  assert.equal(r[0].status, "skipped");
});

test("un reintento concurrente (otro proceso ya subió el contador) no envía dos veces", async () => {
  const w = world({ status: "failed", attempts: 1 });
  const a = runKind(w.sb, "today", TODAY);
  const b = runKind(w.sb, "today", TODAY);
  await Promise.all([a, b]);
  assert.equal(sends, 1);
});

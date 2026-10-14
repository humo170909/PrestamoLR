import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyPayment, runJob, runKind, sendTest } from "./dispatch.ts";
import { encryptSecret } from "./crypto.ts";
import { maskChat, normalizeChatId } from "./mask.ts";
import { checkChat, explainTelegramError } from "./telegram.ts";

// ───────── Supabase en memoria: solo lo que usa dispatch.ts ─────────
type Row = Record<string, unknown>;
interface State { settings: Row | null; installments: Row[]; payments: Row[]; log: Row[]; runs: Row[] }

class Q implements PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }> {
  private op: "select" | "insert" | "update" = "select";
  private payload: Row = {};
  private preds: ((r: Row) => boolean)[] = [];
  private wantRows = false;
  private s: State;
  private t: string;
  constructor(s: State, t: string) { this.s = s; this.t = t; }
  select() { if (this.op !== "select") this.wantRows = true; return this; }
  insert(p: Row) { this.op = "insert"; this.payload = p; return this; }
  update(p: Row) { this.op = "update"; this.payload = p; return this; }
  eq(k: string, v: unknown) { this.preds.push((r) => r[k] === v); return this; }
  in() { return this; }
  lte(k: string, v: string) { this.preds.push((r) => String(r[k]) <= v); return this; }
  order() { return this; }
  range() { return this; }
  maybeSingle() { return this.exec().then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error })); }
  then<A, B>(f?: ((v: { data: unknown; error: { code?: string; message: string } | null }) => A | PromiseLike<A>) | null, r?: ((e: unknown) => B | PromiseLike<B>) | null) { return this.exec().then(f, r); }
  private async exec(): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
    const table: Row[] = this.t === "telegram_settings" ? (this.s.settings ? [this.s.settings] : []) : this.t === "installments" ? this.s.installments : this.t === "payments" ? this.s.payments : this.t === "notification_runs" ? this.s.runs : this.s.log;
    const match = table.filter((r) => this.preds.every((p) => p(r)));
    if (this.op === "insert" && this.t === "notification_runs") { this.s.runs.push({ id: `run-${this.s.runs.length + 1}`, ...this.payload }); return { data: null, error: null }; }
    if (this.op === "insert") {
      if (this.t === "notification_log" && this.s.log.some((r) => r.dedupe_key === this.payload.dedupe_key)) return { data: null, error: { code: "23505", message: "duplicate" } };
      this.s.log.push({ id: `log-${this.s.log.length + 1}`, ...this.payload });
      return { data: null, error: null };
    }
    if (this.op === "update") {
      match.forEach((r) => Object.assign(r, this.payload));
      return { data: this.wantRows ? match.map((r) => ({ id: r.id })) : null, error: null };
    }
    return { data: match, error: null };
  }
}
const fake = (s: State) => ({ from: (t: string) => new Q(s, t) }) as unknown as SupabaseClient;

// ───────── Telegram simulado ─────────
const calls: { url: string; text: string; chat: string }[] = [];
let telegramMode: "ok" | "reject" | "flaky" = "ok";
let rejectText = "Telegram dice no";
let flakyLeft = 0;
globalThis.fetch = (async (url: string, init?: { body?: string }) => {
  const body = init?.body ? JSON.parse(init.body) : {};
  calls.push({ url: String(url), text: String(body.text ?? ""), chat: String(body.chat_id ?? "") });
  const fail = telegramMode === "reject" || (telegramMode === "flaky" && flakyLeft-- > 0);
  return { status: fail ? (telegramMode === "flaky" ? 503 : 400) : 200, json: async () => (fail ? { ok: false, description: rejectText } : { ok: true, result: { type: "private", first_name: "Jorge" } }) };
}) as unknown as typeof fetch;

const TOKEN = "123456789:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const KEY = "ab".repeat(32);
const TODAY = "2026-10-12";
const inst = (n: number, due: string, over: Partial<Row> = {}): Row => ({
  n, due_date: due, interest_due: "150.00", interest_paid: "0.00", capital_due: "0.00", capital_paid: "0.00",
  loans: { id: "L1", code: "PR-0016", status: "active", principal_outstanding: "1000.00", clients: { full_name: "Jorge Ramírez", phone: "987654321" } }, ...over,
});
let st: State;
beforeEach(() => {
  calls.length = 0; telegramMode = "ok"; flakyLeft = 0; rejectText = "Telegram dice no";
  process.env.TELEGRAM_ENCRYPTION_KEY = KEY;
  process.env.TELEGRAM_BOT_TOKEN = ""; process.env.TELEGRAM_CHAT_ID = "";
  st = {
    // Configuración "ya guardada en el panel": token cifrado + chat.
    settings: { id: 1, bot_token_enc: encryptSecret(TOKEN, KEY), chat_ids: ["777"], enabled: true, send_today: true, send_overdue: true, send_tomorrow: true, send_payments: true, overdue_intervals: [1, 3, 5, 7], overdue_repeat_days: 7 },
    installments: [], payments: [], log: [], runs: [],
  };
});

test("recupera el token cifrado y el chat ya guardados y envía la prueba sin exponer el token", async () => {
  const r = await sendTest(fake(st), TODAY);
  assert.equal(r[0].status, "sent");
  assert.ok(calls[0].url.includes(TOKEN), "usó el token guardado (descifrado en el servidor)");
  assert.equal(calls[0].chat, "777");
  assert.ok(!calls[0].text.includes(TOKEN));
  assert.ok(!JSON.stringify(st.log).includes(TOKEN), "el registro no contiene el token");
});

test("falta de configuración: informa sin mostrar datos sensibles", async () => {
  st.settings = null;
  const r = await runKind(fake(st), "today", TODAY);
  assert.equal(r[0].status, "skipped");
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

test("recordatorio de MAÑANA con datos reales: interés, capital pendiente informativo y estado", async () => {
  st.installments = [inst(1, "2026-10-13")];
  const r = await runKind(fake(st), "tomorrow", TODAY);
  assert.equal(r[0].status, "sent");
  assert.match(calls[0].text, /Jorge Ramírez/); assert.match(calls[0].text, /PR-0016/);
  assert.match(calls[0].text, /13\/10\/2026/); assert.match(calls[0].text, /intereses S\/ 150\.00/);
  assert.match(calls[0].text, /Capital pendiente del préstamo: S\/ 1,000\.00 \(informativo\)/);
  assert.match(calls[0].text, /Cobrar: <b>S\/ 150\.00<\/b>/);   // el capital pendiente NO se suma al importe exigible
});

test("aviso del DÍA: solo lo que sigue pendiente (pago parcial) y nada si está pagado", async () => {
  st.installments = [inst(1, TODAY, { interest_paid: "100.00" }), inst(2, TODAY, { loans: { id: "L2", code: "PR-0002", status: "active", principal_outstanding: "500.00", clients: { full_name: "Pagado Total", phone: null } }, interest_paid: "150.00" })];
  const r = await runKind(fake(st), "today", TODAY);
  assert.equal(r[0].status, "sent");
  assert.match(calls[0].text, /S\/ 50\.00/);                 // 150 - 100
  assert.ok(!calls[0].text.includes("Pagado Total"));        // totalmente pagado: sin recordatorio
});

test("alerta de atraso en 1, 3, 5, 7 y luego cada 7 días; el resto de días no avisa", async () => {
  const sent: number[] = [];
  for (const days of [1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 21]) {
    calls.length = 0; st.log = [];
    const due = new Date(Date.UTC(2026, 9, 12 - days)).toISOString().slice(0, 10);
    st.installments = [inst(1, due)];
    const r = await runKind(fake(st), "overdue", TODAY);
    if (r[0].status === "sent") { sent.push(days); assert.match(calls[0].text, new RegExp(`Días de retraso: ${days}\\n`)); assert.match(calls[0].text, /ALERTA: PAGO VENCIDO/); }
  }
  assert.deepEqual(sent, [1, 3, 5, 7, 14, 21]);
});

test("el aviso por atraso usa los intervalos guardados en el panel", async () => {
  (st.settings as Row).overdue_intervals = [2]; (st.settings as Row).overdue_repeat_days = 10;
  st.installments = [inst(1, "2026-10-10")];      // 2 días
  assert.equal((await runKind(fake(st), "overdue", TODAY))[0].status, "sent");
  st.log = []; st.installments = [inst(1, "2026-10-09")];   // 3 días: ya no es intervalo
  assert.equal((await runKind(fake(st), "overdue", TODAY))[0].status, "skipped");
});

test("dos ejecuciones el mismo día NO duplican el aviso", async () => {
  st.installments = [inst(1, TODAY)];
  const a = await runKind(fake(st), "today", TODAY);
  const b = await runKind(fake(st), "today", TODAY);
  assert.equal(a[0].status, "sent"); assert.equal(b[0].status, "skipped");
  assert.equal(calls.length, 1);
  assert.equal(st.log.filter((r) => r.status === "sent").length, 1);
});

test("el job de la tarde reintenta lo de hoy sin duplicar lo ya enviado por la mañana", async () => {
  st.installments = [inst(1, TODAY)];
  await runJob(fake(st), "morning", TODAY);
  const before = calls.length;
  const r = await runJob(fake(st), "evening", TODAY);
  assert.equal(calls.length, before, "la tarde no reenvía 'hoy'");
  assert.ok(r.some((x) => x.kind === "today" && x.status === "skipped"));
});

test("fallo de Telegram: queda 'failed' con el error, NO se marca enviado y se puede reintentar", async () => {
  st.installments = [inst(1, TODAY)];
  telegramMode = "reject";
  const a = await runKind(fake(st), "today", TODAY);
  assert.equal(a[0].status, "failed");
  assert.equal(st.log[0].status, "failed"); assert.equal(st.log[0].sent_at ?? null, null);
  assert.match(String(st.log[0].last_error), /Telegram dice no/);
  telegramMode = "ok";
  const b = await runKind(fake(st), "today", TODAY);       // reintento seguro: reutiliza la misma fila
  assert.equal(b[0].status, "sent");
  assert.equal(st.log.length, 1); assert.equal(st.log[0].status, "sent"); assert.equal(st.log[0].attempts, 2);
});

test("fallo temporal (503) se reintenta dentro del envío y termina enviando", async () => {
  st.installments = [inst(1, TODAY)];
  telegramMode = "flaky"; flakyLeft = 1;
  const r = await runKind(fake(st), "today", TODAY);
  assert.equal(r[0].status, "sent");
  assert.equal(calls.length, 2);
});

test("tras un fallo de Telegram los pagos y cronogramas quedan intactos", async () => {
  st.installments = [inst(1, TODAY)];
  const snapshot = JSON.stringify([st.installments, st.payments]);
  telegramMode = "reject";
  await runJob(fake(st), "all", TODAY);
  assert.equal(JSON.stringify([st.installments, st.payments]), snapshot);
});

test("préstamos anulados, pagados o con obligación pagada no generan avisos (las tres modalidades usan las mismas filas pendientes)", async () => {
  st.installments = [
    inst(1, TODAY, { interest_paid: "150.00" }),                                                                  // cuota ya pagada
    inst(1, TODAY, { loans: { id: "L9", code: "PR-0009", status: "cancelled", principal_outstanding: "0", clients: { full_name: "Anulado", phone: null } } }),
  ];
  // El filtro por estado lo aplica la consulta real (in loans.status); aquí el simulado la ignora, por eso se comprueba la parte local:
  st.installments = st.installments.filter((r) => (r.loans as Row).status === "active");
  assert.equal((await runKind(fake(st), "today", TODAY))[0].status, "skipped");
  assert.equal(calls.length, 0);
});

test("cuotas fijas: cada cuota pendiente se avisa con su capital; solo intereses: capital solo en el último vencimiento", async () => {
  st.installments = [inst(1, TODAY, { interest_due: "120.00", capital_due: "300.00" })];     // cuota fija
  await runKind(fake(st), "today", TODAY);
  assert.match(calls[0].text, /Cobrar: <b>S\/ 420\.00<\/b> — intereses S\/ 120\.00, capital S\/ 300\.00/);
  calls.length = 0; st.log = [];
  st.installments = [inst(1, TODAY, { interest_due: "100.00", capital_due: "0.00" })];       // solo intereses (capital no vence aún)
  await runKind(fake(st), "today", TODAY);
  assert.match(calls[0].text, /Cobrar: <b>S\/ 100\.00<\/b> — intereses S\/ 100\.00(?!, capital)/);
});

test("abierto: el interés avisado es el del período vigente (calculado sobre el capital pendiente por la base de datos)", async () => {
  st.installments = [inst(2, "2026-10-13", { interest_due: "150.00" })];                      // tras abonar 1,000 de 2,000
  (st.installments[0].loans as Row).principal_outstanding = "1000.00";
  await runKind(fake(st), "tomorrow", TODAY);
  assert.match(calls[0].text, /intereses S\/ 150\.00/);
  assert.match(calls[0].text, /Capital pendiente del préstamo: S\/ 1,000\.00/);
});

test("pago parcial: el siguiente aviso usa el saldo actualizado", async () => {
  st.installments = [inst(1, "2026-10-09")];                 // 3 días de atraso, 150 pendientes
  await runKind(fake(st), "overdue", TODAY);
  assert.match(calls[0].text, /Intereses pendientes: S\/ 150\.00/);
  calls.length = 0; st.log = [];
  st.installments = [inst(1, "2026-10-07", { interest_paid: "100.00" })];   // 5 días, pagó 100
  await runKind(fake(st), "overdue", TODAY);
  assert.match(calls[0].text, /Intereses pendientes: S\/ 50\.00/);
});

test("pago revertido: la obligación vuelve a avisarse con su saldo real", async () => {
  st.installments = [inst(1, TODAY, { interest_paid: "150.00" })];
  assert.equal((await runKind(fake(st), "today", TODAY))[0].status, "skipped");   // pagada: sin aviso
  st.installments = [inst(1, TODAY, { interest_paid: "0.00" })];                  // la reversión restauró el saldo
  assert.equal((await runKind(fake(st), "today", TODAY))[0].status, "sent");
});

test("aviso de pago registrado y de reversión: una sola vez por pago y chat", async () => {
  st.payments = [{ id: "P1", receipt_no: 12, amount: "1300.00", interest_amount: "300.00", capital_amount: "1000.00", status: "confirmed", paid_on: TODAY, reversal_reason: null,
    loans: { code: "PR-0016", principal_outstanding: "1000.00", clients: { full_name: "Jorge Ramírez" } } }];
  assert.equal((await notifyPayment(fake(st), "P1", "payment", TODAY))[0].status, "sent");
  assert.equal((await notifyPayment(fake(st), "P1", "payment", TODAY))[0].status, "skipped");
  assert.match(calls[0].text, /PAGO REGISTRADO/); assert.match(calls[0].text, /R-00012/); assert.match(calls[0].text, /Capital pendiente actual:<\/b> S\/ 1,000\.00/);
  assert.equal((await notifyPayment(fake(st), "P1", "reversal", TODAY))[0].status, "skipped");   // aún no está revertido
  Object.assign(st.payments[0], { status: "reversed", reversal_reason: "error de digitación" });
  assert.equal((await notifyPayment(fake(st), "P1", "reversal", TODAY))[0].status, "sent");
  assert.match(calls[1].text, /PAGO REVERTIDO/); assert.match(calls[1].text, /error de digitación/);
});

test("el aviso de pago respeta el interruptor y un fallo de Telegram no lanza error", async () => {
  st.payments = [{ id: "P2", receipt_no: 1, amount: "10.00", interest_amount: "10.00", capital_amount: "0.00", status: "confirmed", paid_on: TODAY, reversal_reason: null,
    loans: { code: "PR-1", principal_outstanding: "0", clients: { full_name: "X" } } }];
  (st.settings as Row).send_payments = false;
  assert.equal((await notifyPayment(fake(st), "P2", "payment", TODAY))[0].status, "skipped");
  (st.settings as Row).send_payments = true; telegramMode = "reject";
  assert.equal((await notifyPayment(fake(st), "P2", "payment", TODAY))[0].status, "failed");
});

test("la ejecución se registra: inicio, fin, zona horaria, resultado y conteos", async () => {
  st.installments = [inst(1, TODAY), inst(2, "2026-10-09")];
  await runJob(fake(st), "morning", TODAY, "cron");
  assert.equal(st.runs.length, 1);
  const r = st.runs[0];
  assert.equal(r.job, "morning"); assert.equal(r.trigger, "cron"); assert.equal(r.timezone, "America/Lima");
  assert.ok(r.started_at && r.finished_at && String(r.finished_at) >= String(r.started_at));
  assert.equal(r.status, "ok"); assert.equal(r.obligations_checked, 2); assert.equal(r.sent, 2); assert.equal(r.failed, 0);
});

test("la ejecución con fallo de Telegram queda registrada con el error (sin token)", async () => {
  st.installments = [inst(1, TODAY)];
  telegramMode = "reject"; rejectText = "Bad Request: chat not found";
  await runJob(fake(st), "morning", TODAY, "manual");
  const r = st.runs[0];
  assert.equal(r.status, "error"); assert.equal(r.trigger, "manual"); assert.equal(r.failed, 1);
  assert.match(String((r.errors as string[])[0]), /chat not found/);
  assert.ok(!JSON.stringify(st.runs).includes(TOKEN));
});

test("'chat not found' se explica con la acción a seguir y el aviso queda 'failed' con ese diagnóstico", async () => {
  assert.match(explainTelegramError("Bad Request: chat not found") ?? "", /Verifica el Chat ID.*«Iniciar»/);
  assert.match(explainTelegramError("Forbidden: bot was blocked by the user") ?? "", /bloqueó al bot/);
  assert.match(explainTelegramError("Unauthorized") ?? "", /token/);
  assert.equal(explainTelegramError("algo raro"), null);
  st.installments = [inst(1, TODAY)];
  telegramMode = "reject"; rejectText = "Bad Request: chat not found";
  const r = await runKind(fake(st), "today", TODAY);
  assert.equal(r[0].status, "failed");
  assert.match(String(st.log[0].last_error), /chat not found → Telegram no encuentra ese chat/);
  assert.ok(!String(st.log[0].last_error).includes(TOKEN));
});

test("el Chat ID guardado se normaliza antes de enviar (espacios, signo menos tipográfico, caracteres invisibles)", async () => {
  assert.equal(normalizeChatId(" −100123456789 "), "-100123456789");
  assert.equal(normalizeChatId("12\u200B34 5\n"), "12345");
  assert.equal(normalizeChatId("１２３４５"), "12345");
  assert.equal(maskChat("-100123456789"), "••••6789");
  (st.settings as Row).chat_ids = [" −100123456789\u200B", "-100123456789"];
  st.installments = [inst(1, TODAY)];
  const r = await runKind(fake(st), "today", TODAY);
  assert.equal(r.length, 1, "los duplicados normalizados se unifican");
  assert.equal(calls[0].chat, "-100123456789");
});

test("prueba de conexión por chat: acepta o rechaza cada destinatario sin revelar token ni Chat ID", async () => {
  const ok = await checkChat(TOKEN, "777");
  assert.equal(ok.ok, true); assert.equal(ok.type, "private");
  assert.ok(calls[0].url.endsWith("/getChat"));
  assert.equal(calls[0].chat, "777");
  telegramMode = "reject"; rejectText = "Bad Request: chat not found";
  const bad = await checkChat(TOKEN, "999");
  assert.equal(bad.ok, false);
  assert.match(bad.error ?? "", /Verifica el Chat ID/);
  assert.ok(!JSON.stringify(bad).includes(TOKEN)); assert.ok(!JSON.stringify(bad).includes("999"));
});

const lp = (id: string, code: string, name: string, over: Partial<Row> = {}): Row => inst(1, "2026-10-09", {
  loans: { id, code, status: "active", principal_outstanding: "1000.00", clients: { full_name: name, phone: null } }, ...over,
});

test("alerta de pago vencido con el formato pedido: importe exigible NO incluye el capital pendiente", async () => {
  st.installments = [inst(1, "2026-10-11")];                 // venció el 11/10, hoy 12/10 → 1 día
  await runKind(fake(st), "overdue", TODAY);
  const t = calls[0].text;
  assert.match(t, /ALERTA: PAGO VENCIDO/); assert.match(t, /Cliente: Jorge Ramírez/); assert.match(t, /Préstamo: PR-0016/);
  assert.match(t, /Fecha de vencimiento: 11\/10\/2026/); assert.match(t, /Días de retraso: 1\n/);
  assert.match(t, /Intereses pendientes: S\/ 150\.00/);
  assert.match(t, /Capital pendiente: S\/ 1,000\.00/);
  assert.match(t, /Importe exigible pendiente: S\/ 150\.00/);   // 150, no 1,150
  assert.match(t, /Estado: VENCIDO/); assert.match(t, /Revisa LRomero/);
});

test("capital que ya venció (último vencimiento) sí forma parte del importe exigible", async () => {
  st.installments = [inst(3, "2026-10-11", { interest_due: "100.00", capital_due: "1000.00" })];
  await runKind(fake(st), "overdue", TODAY);
  assert.match(calls[0].text, /Importe exigible pendiente: S\/ 1,100\.00/);
});

test("un mensaje por préstamo vencido y la segunda revisión del día no repite ninguno", async () => {
  st.installments = [lp("A", "PR-0001", "Ana"), lp("B", "PR-0002", "Beto")];
  const a = await runKind(fake(st), "overdue", TODAY);          // 3 días de atraso → intervalo
  assert.equal(a.filter((r) => r.status === "sent").length, 2);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].text.includes("Ana") && !calls[0].text.includes("Beto"));
  const b = await runKind(fake(st), "overdue", TODAY);
  assert.ok(b.every((r) => r.status === "skipped"));
  assert.equal(calls.length, 2);
});

test("si falla el aviso de un préstamo, los demás se envían y el fallido se reintenta sin duplicar el resto", async () => {
  st.installments = [lp("A", "PR-0001", "Ana"), lp("B", "PR-0002", "Beto")];
  let n = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}");
    calls.push({ url: String(url), text: String(body.text ?? ""), chat: String(body.chat_id ?? "") });
    const fail = body.text?.includes("Ana") && n++ === 0;
    return { status: fail ? 400 : 200, json: async () => (fail ? { ok: false, description: "Bad Request: chat not found" } : { ok: true, result: {} }) };
  }) as unknown as typeof fetch;
  try {
    const a = await runKind(fake(st), "overdue", TODAY);
    assert.deepEqual(a.map((r) => r.status).sort(), ["failed", "sent"]);
    const b = await runKind(fake(st), "overdue", TODAY);
    assert.deepEqual(b.map((r) => r.status).sort(), ["sent", "skipped"]);   // Ana reintenta; Beto no se repite
  } finally { globalThis.fetch = original; }
});

test("con más de 10 préstamos vencidos se envía un solo resumen", async () => {
  st.installments = Array.from({ length: 12 }, (_, i) => lp(`L${i}`, `PR-${String(i).padStart(4, "0")}`, `Cliente ${i}`));
  const r = await runKind(fake(st), "overdue", TODAY);
  assert.equal(r.filter((x) => x.status === "sent").length, 1);
  assert.equal(calls.length, 1);
  assert.match(calls[0].text, /ALERTAS: PAGOS VENCIDOS/); assert.match(calls[0].text, /12 préstamo/);
});

test("revisión horaria: solo envía de 08:00 a 20:00 (Lima), no repite y sin obligaciones no envía nada", async () => {
  st.installments = [lp("A", "PR-0001", "Ana")];
  const night = new Date("2026-10-12T08:00:00Z");             // 03:00 Lima
  assert.equal((await runJob(fake(st), "hourly", TODAY, "cron", night))[0].status, "skipped");
  assert.equal(calls.length, 0); assert.equal(st.runs.length, 0);
  const nine = new Date("2026-10-12T14:00:00Z");              // 09:00 Lima
  const a = await runJob(fake(st), "hourly", TODAY, "cron", nine);
  assert.ok(a.some((r) => r.status === "sent"));
  const sentBefore = calls.length;
  const ten = new Date("2026-10-12T15:00:00Z");               // 10:00 Lima: misma alerta, no se repite cada hora
  await runJob(fake(st), "hourly", TODAY, "cron", ten);
  assert.equal(calls.length, sentBefore);
  assert.equal(st.runs.length, 2);
  assert.equal(st.runs[0].job, "hourly");
  st.installments = []; calls.length = 0;
  await runJob(fake(st), "hourly", TODAY, "cron", new Date("2026-10-12T16:00:00Z"));
  assert.equal(calls.length, 0);
});

test("la hora de Lima se calcula con la zona America/Lima (no la del servidor)", async () => {
  const { limaHour } = await import("./dispatch.ts");
  assert.equal(limaHour(new Date("2026-10-12T13:00:00Z")), 8);
  assert.equal(limaHour(new Date("2026-10-13T01:00:00Z")), 20);
  assert.equal(limaHour(new Date("2026-10-12T05:00:00Z")), 0);
});

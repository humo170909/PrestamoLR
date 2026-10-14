import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  addDays, entriesDueOn, formatOverdueAlert, formatOverdueAlerts, formatPaymentEvent, formatToday, formatTomorrow, overdueAlerts,
  type ClosingSummary, type OverdueConfig, type PendingInstallment,
} from "./build.ts";
import { loadTelegramConfig } from "./config.ts";
import { sendTelegram } from "./telegram.ts";
import { SEND_FROM_HOUR, SEND_UNTIL_HOUR } from "./schedule.ts";
import { logEvent } from "../log.ts";

export type Kind = "today" | "overdue" | "tomorrow";
export type Job = "morning" | "evening" | "hourly" | "all";
/** La tarde repite "hoy" y "atrasos": si la mañana falló se reintenta; si ya se envió, la clave de deduplicación lo omite. */
export const JOBS: Record<Job, Kind[]> = { morning: ["today", "overdue"], evening: ["today", "overdue", "tomorrow"], hourly: ["today", "overdue"], all: ["today", "overdue", "tomorrow"] };
export const MAX_ATTEMPTS = 3;
/** Revisión horaria: solo se ENVÍA dentro de este horario de Lima (no hay avisos de madrugada). */
/** Con más préstamos vencidos que esto se envía un solo resumen (límite de mensajes de Telegram por minuto). */
export const MAX_SEPARATE_ALERTS = 10;

export function limaHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", hour12: false }).format(now)) % 24;
}
const UPCOMING_DAYS = 7;

export interface DispatchResult { kind: Kind | "test" | "payment" | "reversal"; chat: string; status: "sent" | "failed" | "skipped"; detail?: string; /** obligaciones pendientes revisadas */ checked?: number }

/** Fecha de hoy en Lima (UTC-5, sin horario de verano). */
export function limaToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const cents = (v: unknown) => Math.round(Number(v) * 100);

/** Vencimientos con importe pendiente real de préstamos vigentes (paginado: PostgREST limita a 1000 filas). */
export async function fetchPending(sb: SupabaseClient, throughDate: string): Promise<PendingInstallment[]> {
  const out: PendingInstallment[] = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("installments")
      .select("n, due_date, interest_due, interest_paid, capital_due, capital_paid, loans!inner(id, code, status, principal_outstanding, clients(full_name, phone))")
      .in("loans.status", ["active", "defaulted"])
      .in("is_unpaid", [true])   // columna generada (migración 20261013001000): solo cuotas con algo pendiente; antes se traían todas
      .lte("due_date", throughDate)
      .order("due_date").order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const r of (data ?? []) as unknown as {
      n: number; due_date: string; interest_due: string; interest_paid: string; capital_due: string; capital_paid: string;
      loans: { id: string; code: string; principal_outstanding: string; clients: { full_name: string; phone: string | null } | null };
    }[]) {
      const interestCents = cents(r.interest_due) - cents(r.interest_paid);
      const capitalCents = cents(r.capital_due) - cents(r.capital_paid);
      if (interestCents <= 0 && capitalCents <= 0) continue;
      out.push({
        loanId: r.loans.id, loanCode: r.loans.code, clientName: r.loans.clients?.full_name ?? "—", phone: r.loans.clients?.phone ?? null,
        n: r.n, dueDate: r.due_date, interestCents: Math.max(0, interestCents), capitalCents: Math.max(0, capitalCents),
        principalOutstandingCents: cents(r.loans.principal_outstanding),
      });
    }
    if ((data ?? []).length < PAGE) break;
  }
  return out;
}

/** Pagos confirmados durante el día de Lima indicado. */
async function closingOf(sb: SupabaseClient, day: string): Promise<ClosingSummary> {
  const { data, error } = await sb.from("payments").select("interest_amount, capital_amount")
    .eq("status", "confirmed").eq("paid_on", day);
  if (error) throw new Error(error.message);
  const rows = data ?? [];
  return {
    paymentsCount: rows.length,
    interestCents: rows.reduce((s, r) => s + cents(r.interest_amount), 0),
    capitalCents: rows.reduce((s, r) => s + cents(r.capital_amount), 0),
  };
}

interface Part { text: string; items: number; itemKeys: string[]; keyOf: (chat: string) => string }
interface Built { text: string | null; items: number; itemKeys: string[]; checked: number; parts?: Part[] }

/** Fecha límite de la lectura de cuotas: mañana + próximos 7 días (lo máximo que necesita cualquier tipo de aviso). */
const pendingThrough = (today: string) => addDays(addDays(today, 1), UPCOMING_DAYS);

export async function buildMessage(sb: SupabaseClient, kind: Kind, today: string, overdue?: OverdueConfig, pending?: () => Promise<PendingInstallment[]>): Promise<Built> {
  const tomorrow = addDays(today, 1);
  const rows = await (pending ?? (() => fetchPending(sb, pendingThrough(today))))();
  if (kind === "today") {
    const e = entriesDueOn(rows, today);
    return { text: formatToday(e, today), items: e.length, itemKeys: e.map((x) => `${x.loanId}:${x.installmentN}:0`), checked: rows.length };
  }
  if (kind === "overdue") {
    const a = overdueAlerts(rows, today, overdue);
    const itemKeys = a.flatMap((x) => x.items.map((i) => i.key));
    // Un mensaje por préstamo (clave por préstamo y día): un fallo no impide los demás ni se repite lo ya enviado.
    const parts: Part[] | undefined = a.length > 0 && a.length <= MAX_SEPARATE_ALERTS
      ? a.map((x) => ({ text: formatOverdueAlert(x), items: 1, itemKeys: x.items.map((i) => i.key), keyOf: (chat: string) => `overdue:${today}:${x.loanId}:${chat}` }))
      : undefined;
    return { text: formatOverdueAlerts(a, today), items: a.length, itemKeys, checked: rows.length, parts };
  }
  const tm = entriesDueOn(rows, tomorrow);
  const upcoming: ReturnType<typeof entriesDueOn> = [];
  for (let k = 2; k <= UPCOMING_DAYS + 1; k++) upcoming.push(...entriesDueOn(rows, addDays(today, k)));
  const pendingToday = entriesDueOn(rows, today).length;
  const closing = await closingOf(sb, today);
  return {
    text: formatTomorrow(tm, upcoming, today, closing, pendingToday), items: tm.length + upcoming.length,
    itemKeys: tm.map((x) => `${x.loanId}:${x.installmentN}:-1`), checked: rows.length,
  };
}

/**
 * Envía un tipo de aviso a todos los chats configurados, sin duplicar:
 * la fila de `notification_log` (clave kind:fecha:chat) se reserva ANTES de enviar y solo pasa a "sent" si Telegram lo confirma.
 * Un fallo de Telegram solo queda registrado (y se puede reintentar); nunca afecta pagos ni cronogramas.
 */
export async function runKind(sb: SupabaseClient, kind: Kind, today = limaToday(), pending?: () => Promise<PendingInstallment[]>): Promise<DispatchResult[]> {
  const cfg = await loadTelegramConfig(sb);
  if (!cfg) return [{ kind, chat: "-", status: "skipped", detail: "Telegram no configurado" }];
  if (!cfg.enabled) return [{ kind, chat: "-", status: "skipped", detail: "Recordatorios desactivados" }];
  if (!cfg.kinds[kind]) return [{ kind, chat: "-", status: "skipped", detail: "Este aviso está desactivado" }];

  let built: Built;
  try { built = await buildMessage(sb, kind, today, cfg.overdue, pending); }
  catch (e) {
    logEvent("error", "pending_fetch_failed", { kind, date: today, error: e });
    return [{ kind, chat: "-", status: "failed", detail: e instanceof Error ? e.message : "error al preparar" }];
  }
  if (!built.text) return [{ kind, chat: "-", status: "skipped", detail: "Sin obligaciones para avisar", checked: built.checked }];

  const sent: DispatchResult[] = [];
  if (built.parts) {
    for (const part of built.parts) sent.push(...(await deliver(sb, cfg, kind, today, part.text, part.items, part.itemKeys, part.keyOf)));
  } else {
    sent.push(...(await deliver(sb, cfg, kind, today, built.text, built.items, built.itemKeys, (chat) => `${kind}:${today}:${chat}`)));
  }
  return sent.map((r) => ({ ...r, checked: built.checked }));
}

async function deliver(
  sb: SupabaseClient, cfg: { token: string; chatIds: string[] }, kind: DispatchResult["kind"] & string, date: string,
  text: string, items: number, itemKeys: string[], keyOf: (chat: string) => string,
): Promise<DispatchResult[]> {
  const results: DispatchResult[] = [];
  for (const chat of cfg.chatIds) {
    const key = keyOf(chat);
    let claimed: "go" | "skip";
    try { claimed = await claim(sb, key, kind, date, chat, items, itemKeys); }
    catch (e) {
      logEvent("warn", "notification_claim_failed", { kind, chat, error: e });
      results.push({ kind, chat, status: "failed", detail: e instanceof Error ? e.message : "no se pudo reservar el aviso" });
      continue;
    }
    if (claimed === "skip") { results.push({ kind, chat, status: "skipped", detail: "Ya enviado o sin reintentos" }); continue; }
    const r = await sendTelegram(cfg, chat, text);
    await sb.from("notification_log").update({
      status: r.ok ? "sent" : "failed", last_error: r.ok ? null : r.error ?? "error", sent_at: r.ok ? new Date().toISOString() : null,
    }).eq("dedupe_key", key);
    if (!r.ok) logEvent("warn", "telegram_delivery_failed", { kind, date, chat, items, error: r.error });
    results.push({ kind, chat, status: r.ok ? "sent" : "failed", detail: r.error });
  }
  return results;
}

async function claim(sb: SupabaseClient, key: string, kind: string, date: string, chat: string, items: number, itemKeys: string[]): Promise<"go" | "skip"> {
  const ins = await sb.from("notification_log").insert({
    kind, for_date: date, chat_id: chat, dedupe_key: key, status: "failed", attempts: 1, items, item_keys: itemKeys, last_error: "en curso",
  });
  if (!ins.error) return "go";
  if (ins.error.code !== "23505") throw new Error(ins.error.message);

  const { data } = await sb.from("notification_log").select("status, attempts").eq("dedupe_key", key).maybeSingle();
  if (!data || data.status === "sent" || data.attempts >= MAX_ATTEMPTS) return "skip";
  // Reintento controlado: actualización optimista para que solo una ejecución concurrente gane.
  const upd = await sb.from("notification_log").update({ attempts: data.attempts + 1, items, item_keys: itemKeys, last_error: "en curso" })
    .eq("dedupe_key", key).eq("status", "failed").eq("attempts", data.attempts).select("id");
  return upd.data && upd.data.length > 0 ? "go" : "skip";
}

/**
 * Guarda de forma persistente cada ejecución: inicio y fin (UTC; se muestran en America/Lima), zona horaria, resultado y conteos.
 * Un error al registrar nunca interrumpe los avisos ni afecta a pagos.
 */
async function recordRun(sb: SupabaseClient, job: Job, trigger: "cron" | "manual", startedAt: Date, results: DispatchResult[]): Promise<void> {
  try {
    const count = (st: DispatchResult["status"]) => results.filter((r) => r.status === st).length;
    const sent = count("sent"), failed = count("failed");
    const { error } = await sb.from("notification_runs").insert({
      job, trigger, started_at: startedAt.toISOString(), finished_at: new Date().toISOString(), timezone: "America/Lima",
      status: failed > 0 ? (sent > 0 ? "partial" : "error") : sent > 0 ? "ok" : "skipped",
      obligations_checked: Math.max(0, ...results.map((r) => r.checked ?? 0)),
      sent, skipped: count("skipped"), failed,
      errors: [...new Set(results.filter((r) => r.status === "failed" && r.detail).map((r) => String(r.detail)))].slice(0, 5),
    });
    if (error) throw new Error(error.message);
  } catch (e) {
    // Solo diagnóstico: no interrumpe los avisos, pero deja rastro (sin él, un cron roto pasaba desapercibido).
    logEvent("error", "run_record_failed", { job, trigger, error: e });
  }
}

export async function runJob(sb: SupabaseClient, job: Job, today = limaToday(), trigger: "cron" | "manual" = "cron", now = new Date()): Promise<DispatchResult[]> {
  // La revisión horaria solo envía de día (hora de Lima); de noche no hace nada ni deja registros.
  if (job === "hourly" && (limaHour(now) < SEND_FROM_HOUR || limaHour(now) >= SEND_UNTIL_HOUR)) {
    return [{ kind: "overdue", chat: "-", status: "skipped", detail: `Fuera del horario de envío (${SEND_FROM_HOUR}:00–${SEND_UNTIL_HOUR}:00, Lima)` }];
  }
  const startedAt = new Date();
  const all: DispatchResult[] = [];
  // UNA sola lectura de cuotas por ejecución, compartida por todos los tipos de aviso (antes: una por tipo, hasta 3).
  let shared: Promise<PendingInstallment[]> | undefined;
  const pending = () => (shared ??= fetchPending(sb, pendingThrough(today)));
  for (const kind of JOBS[job]) all.push(...(await runKind(sb, kind, today, pending)));
  await recordRun(sb, job, trigger, startedAt, all);
  const n = (st: DispatchResult["status"]) => all.filter((r) => r.status === st).length;
  logEvent(n("failed") > 0 ? "warn" : "info", "job_finished", { job, trigger, date: today, sent: n("sent"), skipped: n("skipped"), failed: n("failed"), ms: Date.now() - startedAt.getTime() });
  return all;
}

/** Aviso inmediato de un pago registrado o revertido. Idempotente por pago y destinatario; nunca afecta al pago. */
export async function notifyPayment(sb: SupabaseClient, paymentId: string, event: "payment" | "reversal", today = limaToday()): Promise<DispatchResult[]> {
  const cfg = await loadTelegramConfig(sb);
  if (!cfg) return [{ kind: event, chat: "-", status: "skipped", detail: "Telegram no configurado" }];
  if (!cfg.enabled || !cfg.kinds.payments) return [{ kind: event, chat: "-", status: "skipped", detail: "Avisos de pagos desactivados" }];

  const { data, error } = await sb.from("payments")
    .select("receipt_no, amount, interest_amount, capital_amount, status, paid_on, reversal_reason, loans(code, principal_outstanding, clients(full_name))")
    .eq("id", paymentId).maybeSingle();
  if (error || !data) return [{ kind: event, chat: "-", status: "failed", detail: "No se encontró el pago" }];
  const p = data as unknown as {
    receipt_no: number; amount: string; interest_amount: string; capital_amount: string; status: string; paid_on: string;
    reversal_reason: string | null; loans: { code: string; principal_outstanding: string; clients: { full_name: string } | null } | null;
  };
  if ((event === "payment" && p.status !== "confirmed") || (event === "reversal" && p.status !== "reversed")) {
    return [{ kind: event, chat: "-", status: "skipped", detail: "El estado del pago no corresponde a este aviso" }];
  }
  const text = formatPaymentEvent({
    event, receiptNo: p.receipt_no, clientName: p.loans?.clients?.full_name ?? "—", loanCode: p.loans?.code ?? "—",
    amountCents: cents(p.amount), interestCents: cents(p.interest_amount), capitalCents: cents(p.capital_amount), paidOn: p.paid_on,
    principalOutstandingCents: cents(p.loans?.principal_outstanding ?? 0), reason: p.reversal_reason,
  });
  return deliver(sb, cfg, event, today, text, 1, [`${paymentId}`], (chat) => `${event}:${paymentId}:${chat}`);
}

/** Mensaje de prueba a todos los chats (no se deduplica; queda en el registro). */
export async function sendTest(sb: SupabaseClient, today = limaToday()): Promise<DispatchResult[]> {
  const cfg = await loadTelegramConfig(sb);
  if (!cfg) return [{ kind: "test", chat: "-", status: "skipped", detail: "Falta TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID" }];
  const out: DispatchResult[] = [];
  for (const chat of cfg.chatIds) {
    const r = await sendTelegram(cfg, chat, "✅ <b>LRomero</b>: conexión con Telegram correcta. Esta es una notificación de prueba.");
    await sb.from("notification_log").insert({
      kind: "test", for_date: today, chat_id: chat, dedupe_key: `test:${today}:${chat}:${Date.now()}`,
      status: r.ok ? "sent" : "failed", last_error: r.ok ? null : r.error ?? "error", sent_at: r.ok ? new Date().toISOString() : null,
    });
    out.push({ kind: "test", chat, status: r.ok ? "sent" : "failed", detail: r.error });
  }
  return out;
}

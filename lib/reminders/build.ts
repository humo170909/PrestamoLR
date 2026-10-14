/**
 * Lógica pura de recordatorios de cobranza (sin red ni base de datos; se prueba con `npm test`).
 * Entrada: vencimientos con importes PENDIENTES reales (ya descontados los pagos parciales).
 * Importes en céntimos enteros. Fechas YYYY-MM-DD en hora de Lima.
 */

export interface PendingInstallment {
  loanId: string;
  loanCode: string;
  clientName: string;
  phone: string | null;
  n: number;
  dueDate: string;
  interestCents: number;  // interés aún sin pagar de este vencimiento
  capitalCents: number;   // capital aún sin pagar de este vencimiento
  /** Capital pendiente de todo el préstamo (opcional). */
  principalOutstandingCents?: number;
}

export interface ClosingSummary { paymentsCount: number; interestCents: number; capitalCents: number }

export interface Entry {
  loanId: string; loanCode: string; clientName: string; phone: string | null;
  interestCents: number; capitalCents: number;       // lo que vence en la fecha objetivo
  priorInterestCents: number; priorCapitalCents: number; // pendiente de períodos anteriores
  dueDate: string; installmentN: number;
  principalOutstandingCents?: number;
}

export interface OverdueEntry {
  loanId: string; loanCode: string; clientName: string; phone: string | null;
  oldestDueDate: string; daysOverdue: number; interestCents: number; capitalCents: number;
  periodsOverdue: number; principalOutstandingCents?: number;
}

export const addDays = (iso: string, k: number): string => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + k)).toISOString().slice(0, 10);
};
export const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

const positive = (r: PendingInstallment) => r.interestCents > 0 || r.capitalCents > 0;

/** Entradas por préstamo con obligaciones pendientes que vencen exactamente en `date`. */
export function entriesDueOn(rows: PendingInstallment[], date: string): Entry[] {
  const pending = rows.filter(positive);
  const loans = new Map<string, PendingInstallment[]>();
  for (const r of pending) loans.set(r.loanId, [...(loans.get(r.loanId) ?? []), r]);

  const out: Entry[] = [];
  for (const list of loans.values()) {
    const due = list.filter((r) => r.dueDate === date);
    if (due.length === 0) continue;
    const prior = list.filter((r) => r.dueDate < date);
    const first = due[0];
    out.push({
      loanId: first.loanId, loanCode: first.loanCode, clientName: first.clientName, phone: first.phone,
      interestCents: sum(due, "interestCents"), capitalCents: sum(due, "capitalCents"),
      priorInterestCents: sum(prior, "interestCents"), priorCapitalCents: sum(prior, "capitalCents"),
      dueDate: date, installmentN: first.n, principalOutstandingCents: first.principalOutstandingCents,
    });
  }
  return out.sort((a, b) => a.clientName.localeCompare(b.clientName, "es"));
}

/** Entradas por préstamo con obligaciones vencidas (fecha anterior a `today`). */
export function overdueEntries(rows: PendingInstallment[], today: string): OverdueEntry[] {
  const late = rows.filter((r) => positive(r) && r.dueDate < today);
  const loans = new Map<string, PendingInstallment[]>();
  for (const r of late) loans.set(r.loanId, [...(loans.get(r.loanId) ?? []), r]);

  return [...loans.values()]
    .map((list) => {
      const oldest = list.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b));
      return {
        loanId: oldest.loanId, loanCode: oldest.loanCode, clientName: oldest.clientName, phone: oldest.phone,
        oldestDueDate: oldest.dueDate, daysOverdue: daysBetween(oldest.dueDate, today),
        interestCents: sum(list, "interestCents"), capitalCents: sum(list, "capitalCents"),
        periodsOverdue: list.length, principalOutstandingCents: oldest.principalOutstandingCents,
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);
}

function sum(rows: PendingInstallment[], k: "interestCents" | "capitalCents") {
  return rows.reduce((s, r) => s + r[k], 0);
}

// ───────── Formato de mensajes (Telegram, parse_mode HTML) ─────────

export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const fmt = (cents: number) =>
  "S/ " + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const dmy = (iso: string) => iso.split("-").reverse().join("/");

function line(e: Entry): string {
  const total = e.interestCents + e.capitalCents;
  const parts = [
    `• <b>${esc(e.clientName)}</b> (${esc(e.loanCode)}, cuota ${e.installmentN})`,
    `   Cobrar: <b>${fmt(total)}</b> — intereses ${fmt(e.interestCents)}` + (e.capitalCents > 0 ? `, capital ${fmt(e.capitalCents)}` : ""),
  ];
  const prior = e.priorInterestCents + e.priorCapitalCents;
  if (prior > 0) {
    parts.push(`   Atrasado de períodos anteriores: ${fmt(prior)} (intereses ${fmt(e.priorInterestCents)}` + (e.priorCapitalCents > 0 ? `, capital ${fmt(e.priorCapitalCents)}` : "") + ")");
    parts.push(`   Total exigible: <b>${fmt(total + prior)}</b>`);
  }
  if (e.principalOutstandingCents !== undefined) parts.push(`   Capital pendiente del préstamo: ${fmt(e.principalOutstandingCents)} (informativo)`);
  parts.push(`   Fecha de vencimiento: ${dmy(e.dueDate)}`);
  if (e.phone) parts.push(`   Tel: ${esc(e.phone)}`);
  return parts.join("\n");
}

export function totalOf(entries: Entry[]) {
  return entries.reduce((s, e) => s + e.interestCents + e.capitalCents + e.priorInterestCents + e.priorCapitalCents, 0);
}

export function formatToday(entries: Entry[], date: string): string | null {
  if (entries.length === 0) return null;
  return [
    `📅 <b>Cobros de HOY</b> — ${dmy(date)}`,
    `${entries.length} cliente(s) · exigible total ${fmt(totalOf(entries))}`,
    "",
    ...entries.map(line),
  ].join("\n");
}

export function formatTomorrow(
  tomorrow: Entry[], upcoming: Entry[], date: string, closing: ClosingSummary, pendingToday: number,
): string | null {
  if (tomorrow.length === 0 && upcoming.length === 0) return null;
  const out = [
    `🔔 <b>Cobros de MAÑANA</b> — ${dmy(date)}`,
    `Cierre de hoy: ${closing.paymentsCount} pago(s) registrados por ${fmt(closing.interestCents + closing.capitalCents)} ` +
      `(intereses ${fmt(closing.interestCents)}, capital ${fmt(closing.capitalCents)}). ` +
      (pendingToday > 0 ? `Siguen pendientes de hoy: ${pendingToday} cliente(s).` : "No quedan pendientes de hoy."),
    "",
  ];
  if (tomorrow.length) {
    out.push(`<b>Mañana:</b> ${tomorrow.length} cliente(s) · ${fmt(totalOf(tomorrow))}`, ...tomorrow.map(line), "");
  } else {
    out.push("Mañana no hay vencimientos.", "");
  }
  if (upcoming.length) {
    out.push(`<b>Próximos días:</b>`, ...upcoming.map((e) => `• ${dmy(e.dueDate)} — <b>${esc(e.clientName)}</b> (${esc(e.loanCode)}): ${fmt(e.interestCents + e.capitalCents)}`));
  }
  return out.join("\n").trimEnd();
}

export function formatOverdue(entries: OverdueEntry[], date: string): string | null {
  if (entries.length === 0) return null;
  const total = entries.reduce((s, e) => s + e.interestCents + e.capitalCents, 0);
  return [
    `⚠️ <b>Pagos VENCIDOS</b> — ${dmy(date)}`,
    `${entries.length} préstamo(s) · exigible total ${fmt(total)}`,
    "",
    ...entries.map((e) =>
      `• <b>${esc(e.clientName)}</b> (${esc(e.loanCode)}) — ${e.daysOverdue} día(s) de atraso desde ${dmy(e.oldestDueDate)}\n` +
      `   Exigible: <b>${fmt(e.interestCents + e.capitalCents)}</b> — intereses ${fmt(e.interestCents)}` +
      (e.capitalCents > 0 ? `, capital ${fmt(e.capitalCents)}` : "") +
      `\n   Períodos vencidos: ${e.periodsOverdue}` +
      (e.principalOutstandingCents !== undefined ? `\n   Capital pendiente del préstamo: ${fmt(e.principalOutstandingCents)}` : "") +
      (e.phone ? `\n   Tel: ${esc(e.phone)}` : ""),
    ),
  ].join("\n");
}

// ───────── Alertas de atraso por intervalos ─────────

export interface OverdueConfig { intervals: number[]; repeatDays: number }
export const DEFAULT_OVERDUE: OverdueConfig = { intervals: [1, 3, 5, 7], repeatDays: 7 };

/** ¿Corresponde avisar con `days` de atraso? Intervalos configurados y, después del último, cada `repeatDays`. */
export function isAlertDay(days: number, cfg: OverdueConfig = DEFAULT_OVERDUE): boolean {
  if (!Number.isInteger(days) || days < 1) return false;
  const sorted = [...cfg.intervals].filter((d) => d >= 1).sort((a, b) => a - b);
  if (sorted.includes(days)) return true;
  const last = sorted[sorted.length - 1] ?? 0;
  return cfg.repeatDays >= 1 && days > last && (days - last) % cfg.repeatDays === 0;
}

export interface AlertItem { n: number; dueDate: string; days: number; interestCents: number; capitalCents: number; key: string }
export interface AlertEntry {
  loanId: string; loanCode: string; clientName: string; phone: string | null;
  items: AlertItem[]; maxDays: number; principalOutstandingCents?: number;
}

/**
 * Una alerta por obligación (cuota/período) vencida y aún pendiente cuyo atraso coincide con un intervalo.
 * Las obligaciones pagadas no entran; en un pago parcial solo cuenta lo que sigue pendiente.
 * Se agrupan por préstamo para no enviar mensajes repetidos del mismo préstamo.
 */
export function overdueAlerts(rows: PendingInstallment[], today: string, cfg: OverdueConfig = DEFAULT_OVERDUE): AlertEntry[] {
  const byLoan = new Map<string, AlertEntry>();
  for (const r of rows) {
    if (!positive(r) || r.dueDate >= today) continue;
    const days = daysBetween(r.dueDate, today);
    if (!isAlertDay(days, cfg)) continue;
    const e = byLoan.get(r.loanId) ?? {
      loanId: r.loanId, loanCode: r.loanCode, clientName: r.clientName, phone: r.phone, items: [], maxDays: 0,
      principalOutstandingCents: r.principalOutstandingCents,
    };
    e.items.push({ n: r.n, dueDate: r.dueDate, days, interestCents: r.interestCents, capitalCents: r.capitalCents, key: `${r.loanId}:${r.n}:${days}` });
    e.maxDays = Math.max(e.maxDays, days);
    byLoan.set(r.loanId, e);
  }
  return [...byLoan.values()].sort((a, b) => b.maxDays - a.maxDays || a.clientName.localeCompare(b.clientName, "es"));
}

/**
 * Alerta de UN préstamo con obligaciones vencidas. El importe exigible es solo lo vencido (intereses + capital que ya
 * debía pagarse); el capital pendiente del préstamo se muestra como información y NO se suma.
 */
export function formatOverdueAlert(e: AlertEntry): string {
  const interest = e.items.reduce((s, i) => s + i.interestCents, 0);
  const capitalDue = e.items.reduce((s, i) => s + i.capitalCents, 0);
  const oldest = e.items.reduce((a, b) => (a.dueDate <= b.dueDate ? a : b));
  return [
    "🚨 <b>ALERTA: PAGO VENCIDO</b>",
    "",
    `👤 Cliente: ${esc(e.clientName)}`,
    `📄 Préstamo: ${esc(e.loanCode)}`,
    `📅 Fecha de vencimiento: ${dmy(oldest.dueDate)}`,
    `⏰ Días de retraso: ${e.maxDays}`,
    ...(e.items.length > 1 ? e.items.map((i) => `   · Cuota ${i.n} (${dmy(i.dueDate)}): intereses ${fmt(i.interestCents)}` + (i.capitalCents > 0 ? `, capital ${fmt(i.capitalCents)}` : "")) : []),
    "",
    `💰 Intereses pendientes: ${fmt(interest)}`,
    ...(e.principalOutstandingCents !== undefined ? [`💵 Capital pendiente: ${fmt(e.principalOutstandingCents)}`] : []),
    `📌 Importe exigible pendiente: ${fmt(interest + capitalDue)}`,
    "",
    "⚠️ Estado: VENCIDO",
    "",
    "Revisa LRomero para consultar el préstamo y registrar el cobro.",
  ].join("\n");
}

/** Resumen cuando hay muchos préstamos a la vez (evita superar los límites de envío de Telegram). */
export function formatOverdueAlerts(entries: AlertEntry[], date: string): string | null {
  if (entries.length === 0) return null;
  return [`🚨 <b>ALERTAS: PAGOS VENCIDOS</b> — ${dmy(date)}`, `${entries.length} préstamo(s)`, "", ...entries.flatMap((e) => [formatOverdueAlert(e).split("\n").slice(2, -2).join("\n"), ""])].join("\n").trimEnd();
}

// ───────── Avisos de pago registrado / revertido ─────────

export interface PaymentEvent {
  event: "payment" | "reversal"; receiptNo: number; clientName: string; loanCode: string;
  amountCents: number; interestCents: number; capitalCents: number; paidOn: string;
  principalOutstandingCents: number; reason?: string | null;
}

export function formatPaymentEvent(p: PaymentEvent): string {
  const head = p.event === "payment" ? "✅ <b>PAGO REGISTRADO</b>" : "↩️ <b>PAGO REVERTIDO</b>";
  return [
    head,
    `<b>Recibo:</b> R-${String(p.receiptNo).padStart(5, "0")}`,
    `<b>Cliente:</b> ${esc(p.clientName)}`,
    `<b>Préstamo:</b> ${esc(p.loanCode)}`,
    `<b>Fecha del pago:</b> ${dmy(p.paidOn)}`,
    `<b>Importe:</b> ${fmt(p.amountCents)} (intereses ${fmt(p.interestCents)}, capital ${fmt(p.capitalCents)})`,
    `<b>Capital pendiente actual:</b> ${fmt(p.principalOutstandingCents)}`,
    ...(p.event === "reversal" && p.reason ? [`<b>Motivo:</b> ${esc(p.reason)}`] : []),
  ].join("\n");
}

/** Telegram admite 4096 caracteres por mensaje: se corta por líneas completas. */
export function splitMessage(text: string, max = 3800): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let cur = "";
  for (const l of text.split("\n")) {
    if ((cur + "\n" + l).length > max && cur) { chunks.push(cur); cur = l; }
    else cur = cur ? cur + "\n" + l : l;
  }
  if (cur) chunks.push(cur);
  return chunks;
}

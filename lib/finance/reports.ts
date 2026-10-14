/**
 * Cálculo de los reportes financieros (módulo puro: sin red, importes en soles con 2 decimales).
 * Reglas:
 *  - Solo los pagos CONFIRMADOS suman en los totales efectivos. Los revertidos se listan, marcados, pero no suman.
 *  - El capital recuperado sale únicamente de abonos de capital confirmados; los intereses nunca lo aumentan.
 *  - Los intereses "previstos" (cronograma) no se confunden con los "cobrados" (pagos confirmados).
 *  - Los filtros de fecha se aplican a la fecha del hecho de cada reporte (desembolso, cobro, vencimiento o cancelación).
 */
import { dueState, DUE_STATE_LABEL } from "./due-status.ts";
import { LOAN_TYPE_LABEL, STATUS_LABEL, deriveStatus, type LoanType } from "./loan-rules.ts";

export interface ReportLoan {
  id: string; code: string; loan_type: LoanType; db_status: string; client_id: string; full_name: string; document_id: string;
  principal: number; principal_outstanding: number; capital_paid: number; rate_pct: number; frequency: string;
  start_date: string; closed_on: string | null; interest_paid: number; interest_pending: number; interest_overdue: number;
  capital_overdue: number; days_overdue: number; next_due_date: string | null; business_today: string; total_paid: number;
}
export interface ReportPayment {
  id: string; loan_id: string; receipt_no: number; paid_on: string; amount: number; interest_amount: number; capital_amount: number;
  method: string; status: string;
}
export interface ReportInstallment {
  loan_id: string; n: number; due_date: string; interest_due: number; interest_paid: number; capital_due: number; capital_paid: number;
}
export interface ReportCash {
  payment_id: string | null; kind: string; direction: string; amount: number;
}

export interface Filters {
  from: string; to: string; client: string; code: string; loanType: "" | LoanType; status: "" | "active" | "overdue" | "paid"; method: string;
}
export const EMPTY_FILTERS: Filters = { from: "", to: "", client: "", code: "", loanType: "", status: "", method: "" };

export type ColKind = "text" | "money" | "date" | "pct" | "num";
export interface Col { key: string; label: string; kind?: ColKind }
export type Cell = string | number | null;
export interface ReportTable {
  title: string;
  columns: Col[];
  rows: Record<string, Cell>[];
  /** Fila de totales (mismas claves que las columnas). */
  totals: Record<string, Cell> | null;
  empty: string;
}

export const NO_DATA = "No hay datos para el periodo seleccionado.";
export const r2 = (n: number) => Math.round(n * 100) / 100;
const sum = <T,>(xs: T[], f: (x: T) => number) => r2(xs.reduce((s, x) => s + f(x), 0));
const inRange = (d: string | null, f: Filters) => !!d && (!f.from || d >= f.from) && (!f.to || d <= f.to);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const loanStatus = (l: ReportLoan) => deriveStatus(l.db_status, l.interest_overdue + l.capital_overdue);

/** Filtros que no dependen de fechas (cliente, código, modalidad, estado). */
export function matchesLoan(l: ReportLoan, f: Filters): boolean {
  if (l.db_status === "cancelled") return false; // los préstamos anulados no son cartera
  if (f.client && !norm(`${l.full_name} ${l.document_id}`).includes(norm(f.client))) return false;
  if (f.code && !norm(l.code).includes(norm(f.code))) return false;
  if (f.loanType && l.loan_type !== f.loanType) return false;
  if (f.status && loanStatus(l) !== f.status) return false;
  return true;
}

const byId = (loans: ReportLoan[]) => new Map(loans.map((l) => [l.id, l]));

// ───────── 1. Préstamos otorgados ─────────
export function loansReport(loans: ReportLoan[], f: Filters): ReportTable {
  const rows = loans.filter((l) => matchesLoan(l, f) && inRange(l.start_date, f)).sort((a, b) => b.start_date.localeCompare(a.start_date));
  return {
    title: "Préstamos otorgados", empty: NO_DATA,
    columns: [
      { key: "code", label: "Código" }, { key: "client", label: "Cliente" }, { key: "start", label: "Desembolso", kind: "date" },
      { key: "principal", label: "Capital original", kind: "money" }, { key: "type", label: "Modalidad" }, { key: "rate", label: "Tasa" },
      { key: "freq", label: "Frecuencia" }, { key: "status", label: "Estado" }, { key: "outstanding", label: "Capital pendiente", kind: "money" },
      { key: "recovered", label: "Total recuperado", kind: "money" },
    ],
    rows: rows.map((l) => ({
      code: l.code, client: l.full_name, start: l.start_date, principal: l.principal, type: LOAN_TYPE_LABEL[l.loan_type],
      rate: `${l.rate_pct}%`, freq: FREQ[l.frequency] ?? l.frequency, status: STATUS_LABEL[loanStatus(l)],
      outstanding: l.principal_outstanding, recovered: l.total_paid,
    })),
    totals: rows.length ? { code: `${rows.length} préstamo(s)`, principal: sum(rows, (l) => l.principal), outstanding: sum(rows, (l) => l.principal_outstanding), recovered: sum(rows, (l) => l.total_paid) } : null,
  };
}
const FREQ: Record<string, string> = { monthly: "Mensual", biweekly: "Quincenal", weekly: "Semanal" };
export const METHOD_LABEL: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", yape: "Yape / Plin" };

/** Pagos que cumplen los filtros (fecha de cobro + filtros del préstamo + método). */
export function selectPayments(payments: ReportPayment[], loans: ReportLoan[], f: Filters): ReportPayment[] {
  const map = byId(loans);
  return payments.filter((p) => {
    const l = map.get(p.loan_id);
    return !!l && matchesLoan(l, f) && inRange(p.paid_on, f) && (!f.method || p.method === f.method);
  });
}

// ───────── 2. Cobros realizados ─────────
export function paymentsReport(payments: ReportPayment[], loans: ReportLoan[], f: Filters): ReportTable {
  const map = byId(loans);
  const rows = selectPayments(payments, loans, f).sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.receipt_no - a.receipt_no);
  const ok = rows.filter((p) => p.status === "confirmed");
  const rev = rows.filter((p) => p.status === "reversed");
  return {
    title: "Cobros realizados", empty: NO_DATA,
    columns: [
      { key: "receipt", label: "Recibo" }, { key: "date", label: "Fecha de cobro", kind: "date" }, { key: "client", label: "Cliente" },
      { key: "code", label: "Préstamo" }, { key: "amount", label: "Importe recibido", kind: "money" },
      { key: "interest", label: "Intereses", kind: "money" }, { key: "capital", label: "Capital", kind: "money" },
      { key: "method", label: "Método" }, { key: "status", label: "Estado" },
    ],
    rows: rows.map((p) => ({
      receipt: `R-${String(p.receipt_no).padStart(5, "0")}`, date: p.paid_on, client: map.get(p.loan_id)?.full_name ?? "—",
      code: map.get(p.loan_id)?.code ?? "—", amount: p.amount, interest: p.interest_amount, capital: p.capital_amount,
      method: METHOD_LABEL[p.method] ?? p.method, status: p.status === "reversed" ? "Revertido" : p.status === "confirmed" ? "Confirmado" : "Pendiente",
    })),
    // Totales efectivos: solo confirmados. Los revertidos se informan aparte y no suman.
    totals: rows.length ? {
      receipt: `${ok.length} confirmado(s)${rev.length ? ` · ${rev.length} revertido(s) no suman` : ""}`,
      amount: sum(ok, (p) => p.amount), interest: sum(ok, (p) => p.interest_amount), capital: sum(ok, (p) => p.capital_amount),
    } : null,
  };
}

// ───────── 3. Capital recuperado ─────────
export type GroupBy = "loan" | "client";

export function capitalReport(loans: ReportLoan[], payments: ReportPayment[], f: Filters, group: GroupBy): ReportTable {
  const sel = loans.filter((l) => matchesLoan(l, f));
  const pays = selectPayments(payments, sel, { ...f, method: "" }).filter((p) => p.status === "confirmed");
  const periodByLoan = new Map<string, number>();
  for (const p of pays) periodByLoan.set(p.loan_id, r2((periodByLoan.get(p.loan_id) ?? 0) + p.capital_amount));

  type Acc = { key: string; label: string; code: string; principal: number; period: number; recovered: number; outstanding: number };
  const acc = new Map<string, Acc>();
  for (const l of sel) {
    const k = group === "loan" ? l.id : l.client_id;
    const a = acc.get(k) ?? { key: k, label: l.full_name, code: group === "loan" ? l.code : "", principal: 0, period: 0, recovered: 0, outstanding: 0 };
    a.principal = r2(a.principal + l.principal); a.period = r2(a.period + (periodByLoan.get(l.id) ?? 0));
    a.recovered = r2(a.recovered + l.capital_paid); a.outstanding = r2(a.outstanding + l.principal_outstanding);
    acc.set(k, a);
  }
  const list = [...acc.values()].sort((a, b) => a.label.localeCompare(b.label, "es"));
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10000) / 100 : 0);
  const periodLabel = f.from || f.to ? "Abonado en el periodo" : "Abonado (confirmado)";
  return {
    title: group === "loan" ? "Capital recuperado por préstamo" : "Capital recuperado por cliente", empty: NO_DATA,
    columns: [
      { key: "client", label: "Cliente" }, ...(group === "loan" ? [{ key: "code", label: "Préstamo" }] : []),
      { key: "principal", label: "Capital prestado", kind: "money" as ColKind }, { key: "period", label: periodLabel, kind: "money" as ColKind },
      { key: "recovered", label: "Capital recuperado acumulado", kind: "money" as ColKind }, { key: "outstanding", label: "Capital pendiente", kind: "money" as ColKind },
      { key: "pct", label: "% recuperación", kind: "pct" as ColKind },
    ],
    rows: list.map((a) => ({ client: a.label, code: a.code, principal: a.principal, period: a.period, recovered: a.recovered, outstanding: a.outstanding, pct: pct(a.recovered, a.principal) })),
    totals: list.length ? (() => {
      const principal = sum(list, (a) => a.principal), recovered = sum(list, (a) => a.recovered);
      return { client: "Total general", principal, period: sum(list, (a) => a.period), recovered, outstanding: sum(list, (a) => a.outstanding), pct: pct(recovered, principal) };
    })() : null,
  };
}

// ───────── 4. Intereses ─────────
export type InterestGroup = "period" | "client" | "loan";

export function interestReport(loans: ReportLoan[], inst: ReportInstallment[], f: Filters, group: InterestGroup): ReportTable {
  const map = byId(loans.filter((l) => matchesLoan(l, f)));
  const rows = inst.filter((i) => map.has(i.loan_id) && inRange(i.due_date, f));
  type Acc = { label: string; code: string; planned: number; generated: number; paid: number; pending: number; overdue: number };
  const acc = new Map<string, Acc>();
  for (const i of rows) {
    const l = map.get(i.loan_id) as ReportLoan;
    const today = l.business_today;
    const k = group === "period" ? i.due_date.slice(0, 7) : group === "client" ? l.client_id : l.id;
    const a = acc.get(k) ?? { label: group === "period" ? i.due_date.slice(0, 7) : l.full_name, code: group === "loan" ? l.code : "", planned: 0, generated: 0, paid: 0, pending: 0, overdue: 0 };
    const generated = i.due_date <= today;
    a.planned = r2(a.planned + i.interest_due);
    if (generated) { a.generated = r2(a.generated + i.interest_due); a.pending = r2(a.pending + Math.max(0, i.interest_due - i.interest_paid)); }
    if (i.due_date < today) a.overdue = r2(a.overdue + Math.max(0, i.interest_due - i.interest_paid));
    a.paid = r2(a.paid + i.interest_paid);
    acc.set(k, a);
  }
  const list = [...acc.entries()].sort(([a], [b]) => (group === "period" ? a.localeCompare(b) : a.localeCompare(b))).map(([, v]) => v);
  return {
    title: group === "period" ? "Intereses por período" : group === "client" ? "Intereses por cliente" : "Intereses por préstamo", empty: NO_DATA,
    columns: [
      { key: "label", label: group === "period" ? "Período (mes de vencimiento)" : "Cliente" }, ...(group === "loan" ? [{ key: "code", label: "Préstamo" }] : []),
      { key: "planned", label: "Previstos (cronograma)", kind: "money" as ColKind }, { key: "generated", label: "Generados (exigibles)", kind: "money" as ColKind },
      { key: "paid", label: "Cobrados", kind: "money" as ColKind }, { key: "pending", label: "Pendientes", kind: "money" as ColKind },
      { key: "overdue", label: "Vencidos", kind: "money" as ColKind },
    ],
    rows: list.map((a) => ({ ...a })),
    totals: list.length ? { label: "Total", planned: sum(list, (a) => a.planned), generated: sum(list, (a) => a.generated), paid: sum(list, (a) => a.paid), pending: sum(list, (a) => a.pending), overdue: sum(list, (a) => a.overdue) } : null,
  };
}

// ───────── 5. Préstamos cancelados ─────────
export function closedReport(loans: ReportLoan[], payments: ReportPayment[], f: Filters): ReportTable {
  const rows = loans.filter((l) => l.db_status === "paid_off" && matchesLoan({ ...l }, { ...f, status: "" }) && inRange(l.closed_on ?? l.start_date, f))
    .sort((a, b) => (b.closed_on ?? "").localeCompare(a.closed_on ?? ""));
  const conf = payments.filter((p) => p.status === "confirmed");
  const per = (id: string, k: "interest_amount" | "capital_amount") => sum(conf.filter((p) => p.loan_id === id), (p) => p[k]);
  const count = (id: string) => payments.filter((p) => p.loan_id === id).length;
  return {
    title: "Préstamos cancelados", empty: NO_DATA,
    columns: [
      { key: "client", label: "Cliente" }, { key: "code", label: "Préstamo" }, { key: "start", label: "Inicio", kind: "date" },
      { key: "closed", label: "Cancelación", kind: "date" }, { key: "principal", label: "Capital original", kind: "money" },
      { key: "capital", label: "Capital recuperado", kind: "money" }, { key: "interest", label: "Intereses cobrados", kind: "money" },
      { key: "paid", label: "Total pagado", kind: "money" }, { key: "payments", label: "Pagos", kind: "num" }, { key: "status", label: "Estado final" },
    ],
    rows: rows.map((l) => ({
      client: l.full_name, code: l.code, start: l.start_date, closed: l.closed_on, principal: l.principal,
      capital: per(l.id, "capital_amount"), interest: per(l.id, "interest_amount"), paid: l.total_paid, payments: count(l.id), status: "Pagado",
    })),
    totals: rows.length ? {
      client: `${rows.length} préstamo(s)`, principal: sum(rows, (l) => l.principal), capital: sum(rows, (l) => per(l.id, "capital_amount")),
      interest: sum(rows, (l) => per(l.id, "interest_amount")), paid: sum(rows, (l) => l.total_paid),
    } : null,
  };
}

// ───────── 6. Saldos pendientes y morosidad ─────────
export function balancesReport(loans: ReportLoan[], f: Filters): ReportTable {
  const rows = loans.filter((l) => l.db_status !== "paid_off" && matchesLoan(l, f)).sort((a, b) => b.days_overdue - a.days_overdue || a.full_name.localeCompare(b.full_name, "es"));
  const stateText = (l: ReportLoan) => {
    const s = dueState({ nextDue: l.next_due_date, today: l.business_today });
    return s === "upcoming" ? (l.next_due_date as string) : DUE_STATE_LABEL[s];
  };
  return {
    title: "Saldos pendientes y morosidad", empty: NO_DATA,
    columns: [
      { key: "client", label: "Cliente" }, { key: "code", label: "Préstamo" }, { key: "capital", label: "Capital pendiente", kind: "money" },
      { key: "interest", label: "Intereses pendientes", kind: "money" }, { key: "overdue", label: "Obligaciones vencidas", kind: "money" },
      { key: "days", label: "Días de atraso", kind: "num" }, { key: "next", label: "Próximo vencimiento" },
      { key: "total", label: "Total pendiente", kind: "money" },
    ],
    rows: rows.map((l) => ({
      client: l.full_name, code: l.code, capital: l.principal_outstanding, interest: l.interest_pending,
      overdue: r2(l.interest_overdue + l.capital_overdue), days: l.days_overdue, next: stateText(l), total: r2(l.principal_outstanding + l.interest_pending),
    })),
    totals: rows.length ? {
      client: `${rows.length} préstamo(s)`, capital: sum(rows, (l) => l.principal_outstanding), interest: sum(rows, (l) => l.interest_pending),
      overdue: sum(rows, (l) => l.interest_overdue + l.capital_overdue), total: sum(rows, (l) => l.principal_outstanding + l.interest_pending),
    } : null,
  };
}

// ───────── 7. Caja vs cobros ─────────
export function cashReport(payments: ReportPayment[], loans: ReportLoan[], cash: ReportCash[], f: Filters): ReportTable {
  const map = byId(loans);
  const rows = selectPayments(payments, loans, f).sort((a, b) => b.paid_on.localeCompare(a.paid_on) || b.receipt_no - a.receipt_no);
  const cashOf = (id: string) => cash.filter((c) => c.payment_id === id);
  const lines = rows.map((p) => {
    const c = cashOf(p.id);
    const inI = sum(c.filter((x) => x.kind === "interest_income"), (x) => x.amount);
    const inC = sum(c.filter((x) => x.kind === "capital_recovery"), (x) => x.amount);
    const rev = sum(c.filter((x) => x.kind === "reversal"), (x) => x.amount);
    const net = r2(inI + inC - rev);
    const expected = p.status === "confirmed" ? p.amount : 0;
    return { p, inI, inC, rev, net, expected, ok: net === expected && (p.status !== "confirmed" || (inI === p.interest_amount && inC === p.capital_amount)) };
  });
  const confirmed = lines.filter((x) => x.p.status === "confirmed");
  return {
    title: "Caja vs cobros registrados", empty: NO_DATA,
    columns: [
      { key: "receipt", label: "Recibo" }, { key: "date", label: "Fecha", kind: "date" }, { key: "code", label: "Préstamo" }, { key: "status", label: "Pago" },
      { key: "paidInterest", label: "Intereses cobrados", kind: "money" }, { key: "paidCapital", label: "Capital cobrado", kind: "money" },
      { key: "cashInterest", label: "Caja: intereses", kind: "money" }, { key: "cashCapital", label: "Caja: capital", kind: "money" },
      { key: "cashRev", label: "Caja: reversión", kind: "money" }, { key: "check", label: "Conciliación" },
    ],
    rows: lines.map((x) => ({
      receipt: `R-${String(x.p.receipt_no).padStart(5, "0")}`, date: x.p.paid_on, code: map.get(x.p.loan_id)?.code ?? "—",
      status: x.p.status === "reversed" ? "Revertido" : "Confirmado", paidInterest: x.p.interest_amount, paidCapital: x.p.capital_amount,
      cashInterest: x.inI, cashCapital: x.inC, cashRev: x.rev, check: x.ok ? "Coincide" : "Diferencia",
    })),
    totals: lines.length ? {
      receipt: `${confirmed.length} confirmado(s) · ${lines.filter((x) => !x.ok).length} diferencia(s)`,
      paidInterest: sum(confirmed, (x) => x.p.interest_amount), paidCapital: sum(confirmed, (x) => x.p.capital_amount),
      cashInterest: sum(confirmed, (x) => x.inI), cashCapital: sum(confirmed, (x) => x.inC), cashRev: sum(lines, (x) => x.rev),
    } : null,
  };
}

// ───────── Exportación ─────────
export function describeFilters(f: Filters): string[] {
  const out: string[] = [];
  if (f.from || f.to) out.push(`Fechas: ${f.from || "inicio"} a ${f.to || "hoy"}`);
  if (f.client) out.push(`Cliente: ${f.client}`);
  if (f.code) out.push(`Código: ${f.code}`);
  if (f.loanType) out.push(`Modalidad: ${LOAN_TYPE_LABEL[f.loanType]}`);
  if (f.status) out.push(`Estado: ${STATUS_LABEL[f.status]}`);
  if (f.method) out.push(`Método: ${METHOD_LABEL[f.method] ?? f.method}`);
  return out.length ? out : ["Sin filtros"];
}

const dmy = (iso: string) => iso.split("-").reverse().join("/");
const fmtMoney = (n: number) => n.toFixed(2);

/** Texto de una celda tal como se ve en pantalla/exportación. */
export function cellText(c: Col, v: Cell, plainMoney = false): string {
  if (v === null || v === undefined || v === "") return "";
  if (c.kind === "money") return plainMoney ? fmtMoney(Number(v)) : `S/ ${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (c.kind === "pct") return `${Number(v).toFixed(2)}%`;
  if (c.kind === "date" && typeof v === "string") return dmy(v);
  return String(v);
}

/** Excel evalúa como fórmula lo que empieza por = + - @ (o tab/CR): se antepone ' para que sea texto. Los números ("-5.00") no se tocan. */
const neutralize = (s: string) => (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s);
const csvCell = (raw: string) => {
  const s = neutralize(raw);
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** CSV (separador ;, para Excel en español) con filtros, fecha de generación, filas y totales: coincide con la pantalla. */
export function toCsv(t: ReportTable, f: Filters, generatedAt: string): string {
  const lines: string[] = [
    csvCell(`LRomero Préstamos - ${t.title}`),
    csvCell(`Generado: ${generatedAt}`),
    csvCell(`Filtros: ${describeFilters(f).join(" | ")}`),
    "",
    t.columns.map((c) => csvCell(c.label)).join(";"),
    ...t.rows.map((r) => t.columns.map((c) => csvCell(cellText(c, r[c.key], true))).join(";")),
  ];
  if (t.totals) lines.push(t.columns.map((c) => csvCell(cellText(c, t.totals?.[c.key] ?? null, true))).join(";"));
  if (!t.rows.length) lines.push(csvCell(t.empty));
  return "﻿" + lines.join("\r\n");
}

import { createClient } from "@/lib/supabase/client";
import { fetchLoanSummaries } from "@/lib/data/loans";
import { fetchAllPages, reconcileTotals } from "@/lib/data/paginate";
import type { ReportCash, ReportInstallment, ReportLoan, ReportPayment } from "@/lib/finance/reports";

async function all<T>(table: string, columns: string, order: string): Promise<T[] & { total: number }> {
  // Paginado con conteo exacto (PostgREST corta en 1 000 filas sin avisar) y orden estable (columna + id).
  return fetchAllPages<T>(async (from, to) => {
    const { data, error, count } = await createClient().from(table).select(columns, { count: "exact" }).order(order).order("id").range(from, to);
    if (error) throw new Error(`${table}: ${error.message}`);
    return { rows: (data ?? []) as unknown as T[], total: count };
  });
}

export interface ReportData {
  loans: ReportLoan[]; payments: ReportPayment[]; installments: ReportInstallment[]; cash: ReportCash[]; generatedAt: string;
  /** Avisos visibles: datos que no se cargaron completos o que no concilian con report_totals() (SQL). Vacío = todo en orden. */
  notices: string[];
}

/** Datos reales de Supabase (RLS aplica según el rol). Los importes numeric llegan como texto y se convierten aquí. */
export async function fetchReportData(): Promise<ReportData> {
  const [summaries, pays, inst, cash] = await Promise.all([
    fetchLoanSummaries(),
    all<Record<string, unknown>>("payments", "id, loan_id, receipt_no, paid_on, amount, interest_amount, capital_amount, method, status", "paid_on"),
    all<Record<string, unknown>>("installments", "id, loan_id, n, due_date, interest_due, interest_paid, capital_due, capital_paid", "due_date"),
    all<Record<string, unknown>>("cash_movements", "id, payment_id, kind, direction, amount", "created_at"),
  ]);
  const num = (v: unknown) => Number(v);
  const notices: string[] = [];
  const parts: [string, { length: number; total: number }][] = [["préstamos", summaries], ["pagos", pays], ["cuotas", inst], ["movimientos de caja", cash]];
  for (const [what, rows] of parts) if (rows.total > rows.length) notices.push(`Se cargaron ${rows.length} de ${rows.total} ${what}: el reporte está incompleto.`);
  // Conciliación con la fuente de verdad en SQL: si no coincide, hay datos truncados o inconsistentes.
  const rt = await createClient().rpc("report_totals");
  const srv = (rt.data as { interest: unknown; capital: unknown; disbursed: unknown }[] | null)?.[0];
  if (srv) {
    const confirmed = pays.filter((p) => String(p.status) === "confirmed");
    notices.push(...reconcileTotals({
      interest: confirmed.reduce((t, p) => t + Math.round(num(p.interest_amount) * 100), 0) / 100,
      capital: confirmed.reduce((t, p) => t + Math.round(num(p.capital_amount) * 100), 0) / 100,
      disbursed: summaries.filter((l) => l.db_status !== "cancelled").reduce((t, l) => t + Math.round(l.principal * 100), 0) / 100,
    }, srv));
  }
  return {
    loans: summaries as unknown as ReportLoan[],
    payments: pays.map((p) => ({
      id: String(p.id), loan_id: String(p.loan_id), receipt_no: num(p.receipt_no), paid_on: String(p.paid_on), amount: num(p.amount),
      interest_amount: num(p.interest_amount), capital_amount: num(p.capital_amount), method: String(p.method), status: String(p.status),
    })),
    installments: inst.map((i) => ({
      loan_id: String(i.loan_id), n: num(i.n), due_date: String(i.due_date), interest_due: num(i.interest_due),
      interest_paid: num(i.interest_paid), capital_due: num(i.capital_due), capital_paid: num(i.capital_paid),
    })),
    cash: cash.map((c) => ({ payment_id: (c.payment_id as string | null) ?? null, kind: String(c.kind), direction: String(c.direction), amount: num(c.amount) })),
    generatedAt: new Date().toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }),
    notices,
  };
}

import { createClient } from "@/lib/supabase/client";
import { limaToday } from "@/lib/format";
import type { NewLoanTerms, LoanType } from "@/lib/finance/loan-rules";
import { fetchAllPages, type Paged } from "@/lib/data/paginate";

export interface ClientOption { id: string; full_name: string; document_id: string }

/** Clientes visibles para el usuario (RLS filtra por rol). */
export async function listClients(): Promise<Paged<ClientOption>> {
  // Paginado: PostgREST corta en 1 000 filas sin avisar y el selector de "Nuevo préstamo" no encontraría al resto.
  return fetchAllPages<ClientOption>(async (from, to) => {
    const { data, error, count } = await createClient()
      .from("clients").select("id, full_name, document_id", { count: "exact" }).eq("active", true)
      .order("full_name").order("id").range(from, to);
    if (error) throw new Error(error.message);
    return { rows: data ?? [], total: count };
  });
}

/** Crea y desembolsa el préstamo en el servidor. Devuelve el id solo si la base de datos lo confirmó. */
export async function createLoan(clientId: string, t: NewLoanTerms, idempotencyKey: string): Promise<string> {
  const { data, error } = await createClient().rpc("create_loan", {
    p_client_id: clientId,
    p_principal: t.principalCents / 100,
    p_rate_pct: t.rateBps / 100,
    p_frequency: t.frequency,
    p_periods: t.periods,
    p_start_date: t.startDate,
    p_idempotency_key: idempotencyKey,
    p_loan_type: t.loanType,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Fila de `v_loan_summary`: todos los importes vienen calculados por la base de datos (numeric → string/number). */
export interface LoanSummary {
  id: string; code: string; loan_type: LoanType; db_status: string; client_id: string;
  full_name: string; document_id: string; phone: string | null;
  principal: number; principal_outstanding: number; capital_paid: number;
  rate_pct: number; frequency: "monthly" | "biweekly" | "weekly"; periods: number | null; start_date: string;
  interest_generated: number; interest_paid: number; interest_pending: number; interest_overdue: number;
  capital_overdue: number; interest_projected: number | null;
  next_due_date: string | null; oldest_overdue_date: string | null; days_overdue: number;
  periods_elapsed: number; periods_paid: number; periods_overdue: number;
  total_paid: number; last_payment_on: string | null; derived_status: string;
  closed_on: string | null; interest_scheduled: number; periods_unpaid_exigible: number;
  due_today_pending: number; next_due_amount: number; business_today: string;
}

const NUMERIC: (keyof LoanSummary)[] = [
  "principal", "principal_outstanding", "capital_paid", "rate_pct", "interest_generated", "interest_paid",
  "interest_pending", "interest_overdue", "capital_overdue", "interest_projected", "days_overdue",
  "periods", "periods_elapsed", "periods_paid", "periods_overdue", "total_paid",
  "interest_scheduled", "periods_unpaid_exigible", "due_today_pending", "next_due_amount",
];

function normalize(r: Record<string, unknown>): LoanSummary {
  const out = { ...r };
  for (const k of NUMERIC) if (out[k] !== null && out[k] !== undefined) out[k] = Number(out[k]);
  // Si la migración de reportes aún no se aplicó, la vista no trae estas columnas: valores seguros.
  out.business_today ??= limaToday();
  out.closed_on ??= null;
  for (const k of ["interest_scheduled", "periods_unpaid_exigible", "due_today_pending", "next_due_amount"]) out[k] ??= 0;
  return out as unknown as LoanSummary;
}

/** Devenga los períodos de los préstamos abiertos (idempotente) y devuelve el resumen actualizado. */
let lastRefresh = 0;
export async function fetchLoanSummaries(opts: { onlyActive?: boolean } = {}): Promise<Paged<LoanSummary>> {
  const sb = createClient();
  // El devengo es idempotente y barato en la base de datos; aun así no se pide más de una vez cada 30 s (lista, detalle, cobros y reportes la comparten).
  if (Date.now() - lastRefresh > 30_000) { lastRefresh = Date.now(); await sb.rpc("refresh_open_loans"); }
  // Paginado con conteo exacto (PostgREST corta en 1 000 filas sin avisar). Orden estable: fecha y, como desempate, id.
  const all = await fetchAllPages<Record<string, unknown>>(async (from, to) => {
    let q = sb.from("v_loan_summary").select("*", { count: "exact" });
    if (opts.onlyActive) q = q.eq("db_status", "active");
    const { data, error, count } = await q.order("created_at", { ascending: false }).order("id").range(from, to);
    if (error) throw new Error(error.message);
    return { rows: (data ?? []) as Record<string, unknown>[], total: count };
  });
  return Object.assign(all.map((r) => normalize(r)), { total: all.total });
}

export interface ScheduleItem {
  n: number; due_date: string; interest_due: number; interest_paid: number; capital_due: number; capital_paid: number;
  /** Capital sobre el que se calculó el interés del período. */
  reference_capital: number; /** Capital abonado asociado al período. */ capital_applied: number;
}

/** Cronograma calculado por la base de datos (función loan_schedule). Si esa migración falta, usa las cuotas tal cual (reference_capital = -1). */
export async function fetchSchedule(loanId: string): Promise<{ rows: ScheduleItem[]; degraded: boolean }> {
  const sb = createClient();
  const rpc = await sb.rpc("loan_schedule", { p_loan: loanId });
  if (!rpc.error) {
    return {
      degraded: false,
      rows: ((rpc.data ?? []) as Record<string, unknown>[]).map((r) => ({
        n: Number(r.n), due_date: String(r.due_date), interest_due: Number(r.interest_due), interest_paid: Number(r.interest_paid),
        capital_due: Number(r.capital_due), capital_paid: Number(r.capital_paid),
        reference_capital: Number(r.reference_capital), capital_applied: Number(r.capital_applied),
      })),
    };
  }
  const { data, error } = await sb.from("installments").select("n, due_date, interest_due, interest_paid, capital_due, capital_paid").eq("loan_id", loanId).order("n");
  if (error) throw new Error(error.message);
  return {
    degraded: true,
    rows: (data ?? []).map((r) => ({
      n: r.n, due_date: r.due_date, interest_due: Number(r.interest_due), interest_paid: Number(r.interest_paid),
      capital_due: Number(r.capital_due), capital_paid: Number(r.capital_paid), reference_capital: -1, capital_applied: Number(r.capital_paid),
    })),
  };
}

export interface LoanPayment {
  id: string; receipt_no: number; paid_on: string; interest_amount: number; capital_amount: number;
  method: string; status: string; reversal_reason: string | null; note: string | null;
}

export async function fetchLoanPayments(loanId: string): Promise<LoanPayment[]> {
  const { data, error } = await createClient()
    .from("payments").select("id, receipt_no, paid_on, interest_amount, capital_amount, method, status, reversal_reason, note")
    .eq("loan_id", loanId).order("paid_on", { ascending: false }).order("receipt_no", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({ ...r, interest_amount: Number(r.interest_amount), capital_amount: Number(r.capital_amount) }));
}

/** Código real (PR-0001) del préstamo recién creado, leído de Supabase. */
export async function fetchLoanCode(loanId: string): Promise<string | null> {
  const { data } = await createClient().from("loans").select("code").eq("id", loanId).maybeSingle();
  return (data as { code: string } | null)?.code ?? null;
}

/** Eliminación lógica y auditable (solo administrador; la base de datos lo exige y rechaza si hay pagos confirmados). */
export async function cancelLoan(loanId: string, reason: string): Promise<void> {
  const { error } = await createClient().rpc("cancel_loan", { p_loan_id: loanId, p_reason: reason });
  if (error) throw new Error(error.message);
}

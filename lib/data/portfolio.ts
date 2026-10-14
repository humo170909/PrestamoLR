import { createClient } from "@/lib/supabase/client";
import { limaToday } from "@/lib/format";

export interface PortfolioRow {
  id: string; code: string; status: string; principal: number; principal_outstanding: number;
  full_name: string; document_id: string; phone: string | null;
  interest_total: number; interest_paid: number; interest_pending: number; interest_overdue: number;
  capital_overdue: number; days_overdue: number;
}

const NUM_KEYS = [
  "principal", "principal_outstanding", "interest_total", "interest_paid", "interest_pending",
  "interest_overdue", "capital_overdue", "days_overdue",
] as const;

const PAGE = 1000; // PostgREST devuelve como máximo 1000 filas por consulta: se pagina para no truncar la cartera.

export async function fetchPortfolio(): Promise<PortfolioRow[]> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await createClient().from("v_loan_portfolio").select("*").order("id").range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < PAGE) break;
  }
  return rows.map((r) => {
    const row = { ...r };
    NUM_KEYS.forEach((k) => { row[k] = Number(row[k]); });
    return row as unknown as PortfolioRow;
  });
}

export interface DueToday {
  n: number; interest_due: number; interest_paid: number; loans: { code: string; clients: { full_name: string } | null } | null;
}

/** Vencimientos de hoy con intereses aún sin cobrar. */
export async function fetchDueToday(): Promise<DueToday[]> {
  const iso = limaToday();
  const { data, error } = await createClient()
    .from("installments").select("n, interest_due, interest_paid, loans!inner(code, status, clients(full_name))").eq("due_date", iso).in("loans.status", ["active", "defaulted"]);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as DueToday[])
    .map((r) => ({ ...r, interest_due: Number(r.interest_due), interest_paid: Number(r.interest_paid) }))
    .filter((r) => r.interest_paid < r.interest_due);
}

export const sumBy = <T,>(rows: T[], f: (r: T) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 100) / 100;

export function moraBuckets(rows: PortfolioRow[]) {
  const late = rows.filter((r) => r.days_overdue > 0);
  const n = (a: number, b: number) => late.filter((r) => r.days_overdue >= a && r.days_overdue <= b).length;
  return [
    { name: "1–7 días", value: n(1, 7) }, { name: "8–30 días", value: n(8, 30) },
    { name: "31–60 días", value: n(31, 60) }, { name: "Más de 60", value: n(61, Infinity) },
  ];
}

const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

/** Últimos 6 meses de caja (mes calendario de Lima), sumados en la base de datos. Las reversiones se ven en Caja, no se restan aquí. */
export async function fetchMonthlyCash() {
  const { data, error } = await createClient().rpc("monthly_cash");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { month: string; disbursed: string; interest: string; capital: string }[]).map((r) => ({
    mes: MONTHS[Number(r.month.slice(5, 7)) - 1],
    desembolsado: Number(r.disbursed), intereses: Number(r.interest), capital: Number(r.capital),
  }));
}

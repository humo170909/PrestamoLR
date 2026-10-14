import { createClient } from "@/lib/supabase/client";

export type CashKind = "disbursement" | "interest_income" | "capital_recovery" | "reversal" | "other_in" | "other_out";

export interface CashRow {
  id: string; kind: CashKind; direction: "in" | "out"; amount: number; concept: string | null; created_at: string;
  loans: { code: string } | null;
}

export const CASH_LABEL: Record<CashKind, string> = {
  disbursement: "Desembolso",
  interest_income: "Cobro de intereses",
  capital_recovery: "Devolución de capital",
  reversal: "Reversión de pago",
  other_in: "Otro ingreso",
  other_out: "Otra salida",
};

export async function fetchCash(): Promise<CashRow[]> {
  const { data, error } = await createClient()
    .from("cash_movements").select("id, kind, direction, amount, concept, created_at, loans(code)")
    .order("created_at", { ascending: false }).limit(500);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as CashRow[]).map((r) => ({ ...r, amount: Number(r.amount) }));
}

export function summarize(rows: CashRow[]) {
  const sum = (f: (r: CashRow) => boolean) => Math.round(rows.filter(f).reduce((s, r) => s + r.amount, 0) * 100) / 100;
  const interest = sum((r) => r.kind === "interest_income");
  const capital = sum((r) => r.kind === "capital_recovery");
  const disbursed = sum((r) => r.kind === "disbursement");
  // Reversión de pago = salida; anulación de desembolso = entrada (la dirección manda).
  const reversalOut = sum((r) => r.kind === "reversal" && r.direction === "out");
  const reversalIn = sum((r) => r.kind === "reversal" && r.direction === "in");
  const reversed = reversalOut;
  const otherIn = sum((r) => r.kind === "other_in");
  const otherOut = sum((r) => r.kind === "other_out");
  return { interest, capital, disbursed, reversed, balance: Math.round((interest + capital + otherIn + reversalIn - disbursed - reversalOut - otherOut) * 100) / 100 };
}

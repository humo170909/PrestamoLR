import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

export interface InstallmentRow {
  n: number; due_date: string; interest_due: number; interest_paid: number; capital_due: number; capital_paid: number;
}

export async function fetchInstallments(loanId: string): Promise<InstallmentRow[]> {
  const { data, error } = await createClient()
    .from("installments").select("n, due_date, interest_due, interest_paid, capital_due, capital_paid").eq("loan_id", loanId).order("n");
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => ({
    ...r, interest_due: Number(r.interest_due), interest_paid: Number(r.interest_paid),
    capital_due: Number(r.capital_due), capital_paid: Number(r.capital_paid),
  }));
}

export const paymentSchema = z
  .object({
    interest: z.number().min(0),
    capital: z.number().min(0),
    method: z.enum(["cash", "transfer", "yape"]),
  })
  .refine((v) => v.interest + v.capital > 0, "Ingresa un importe mayor que cero");

/** Redondea a 2 decimales (soles/céntimos) para enviar importes exactos a numeric(14,2). */
export const round2 = (n: number) => Math.round(n * 100) / 100;

export async function registerPayment(p: {
  loanId: string; interest: number; capital: number; method: string; note?: string; paidOn?: string; idempotencyKey: string;
}): Promise<string> {
  const { data, error } = await createClient().rpc("register_payment", {
    p_loan_id: p.loanId,
    p_interest: round2(p.interest),
    p_capital: round2(p.capital),
    p_method: p.method,
    p_idempotency_key: p.idempotencyKey,
    p_note: p.note || null,
    p_paid_on: p.paidOn || null,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export interface PaymentRow {
  id: string; receipt_no: number; received_at: string; paid_on: string; interest_amount: number; capital_amount: number;
  method: string; status: string; loans: { code: string; clients: { full_name: string } | null } | null;
}

export async function fetchPayments(): Promise<PaymentRow[]> {
  const { data, error } = await createClient()
    .from("payments")
    .select("id, receipt_no, received_at, paid_on, interest_amount, capital_amount, method, status, loans(code, clients(full_name))")
    .order("paid_on", { ascending: false }).order("receipt_no", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as PaymentRow[];
}

/** Reversión auditable (solo administrador; la base de datos lo exige). No borra el pago. */
export async function reversePayment(paymentId: string, reason: string): Promise<void> {
  const { error } = await createClient().rpc("reverse_payment", { p_payment_id: paymentId, p_reason: reason });
  if (error) throw new Error(error.message);
}

/** Número de recibo real del pago recién registrado. */
export async function fetchReceiptNo(paymentId: string): Promise<number | null> {
  const { data } = await createClient().from("payments").select("receipt_no").eq("id", paymentId).maybeSingle();
  return (data as { receipt_no: number } | null)?.receipt_no ?? null;
}

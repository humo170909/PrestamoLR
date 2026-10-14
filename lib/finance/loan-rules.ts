/**
 * Reglas centrales de las tres modalidades de préstamo. Módulo puro (céntimos enteros, sin red):
 * lo usan el formulario, la vista previa, el cobro y el detalle. La base de datos aplica las MISMAS reglas
 * (supabase/migrations/20261012000000_loan_types.sql) y es la autoridad final.
 *
 * Regla de interés (sin cambios): cada período cobra  capital ORIGINAL × tasa del período.
 *  - Un abono de capital baja el saldo pero NO modifica intereses ya generados ni futuros.
 *  - Alternativa (interés sobre el saldo pendiente): reduciría el interés tras cada abono (p. ej. S/1,000 al 15 % con
 *    abono de S/200 → 120 en vez de 150). No está implementada: cambiaría el dinero adeudado y requiere decisión del negocio.
 */
import { addPeriods, periodInterest, validateTerms, MAX_PERIODS, type Frequency } from "./interest-only.ts";

export type LoanType = "fixed" | "interest_only" | "open";

export const LOAN_TYPE_LABEL: Record<LoanType, string> = {
  fixed: "Cuotas fijas",
  interest_only: "Solo intereses + abonos",
  open: "Abierto (sin plazo)",
};
export const LOAN_TYPE_HINT: Record<LoanType, string> = {
  fixed: "Cuotas periódicas con capital e interés; termina en la última cuota.",
  interest_only: "Se pagan intereses cada período y el capital al final; se puede abonar capital cuando se quiera.",
  open: "Sin cuotas ni fecha final: cada cobro se registra a mano. Solo se cierra cuando el capital llega a cero.",
};

export interface NewLoanTerms {
  loanType: LoanType;
  principalCents: number;
  rateBps: number;
  /** null en préstamos abiertos. */
  periods: number | null;
  frequency: Frequency;
  startDate: string;
}

export interface PreviewRow {
  n: number;
  dueDate: string;
  interestCents: number;
  capitalCents: number;
  totalCents: number;
  capitalAfterCents: number;
}

export interface LoanPreview {
  rows: PreviewRow[];
  periodInterestCents: number;
  /** Primer cobro previsto. */
  next: PreviewRow;
  /** null en préstamos abiertos (no hay fecha final ni total contractual). */
  totalInterestCents: number | null;
  totalContractCents: number | null;
  totalCapitalCents: number;
}

/** Fecha YYYY-MM-DD real (rechaza 2026-02-31). */
export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function validateLoan(t: NewLoanTerms): string[] {
  const errors: string[] = [];
  if (t.loanType === "open") {
    // Reutiliza las validaciones de capital/tasa/fecha con un plazo neutro (el abierto no tiene plazo).
    errors.push(...validateTerms({ principalCents: t.principalCents, rateBps: t.rateBps, periods: 1, frequency: t.frequency, startDate: t.startDate }));
  } else {
    errors.push(...validateTerms({ ...t, periods: t.periods ?? 0 }));
  }
  if (t.startDate && !isValidIsoDate(t.startDate) && !errors.some((e) => e.includes("fecha"))) errors.push("La fecha de desembolso no es válida.");
  return errors;
}

/**
 * Vista previa del cronograma. Cuotas fijas: capital en partes iguales (el último absorbe los céntimos) + interés sobre el original.
 * Solo intereses: interés constante y todo el capital en el último vencimiento. Abierto: únicamente el siguiente cobro.
 */
export function previewLoan(t: NewLoanTerms): LoanPreview {
  const errors = validateLoan(t);
  if (errors.length) throw new Error(errors.join(" "));
  const interest = periodInterest(t.principalCents, t.rateBps);

  if (t.loanType === "open") {
    const next: PreviewRow = {
      n: 1, dueDate: addPeriods(t.startDate, t.frequency, 1), interestCents: interest, capitalCents: 0,
      totalCents: interest, capitalAfterCents: t.principalCents,
    };
    return { rows: [next], periodInterestCents: interest, next, totalInterestCents: null, totalContractCents: null, totalCapitalCents: t.principalCents };
  }

  const periods = t.periods as number;
  const slice = Math.floor(t.principalCents / periods);
  let remaining = t.principalCents;
  const rows: PreviewRow[] = Array.from({ length: periods }, (_, i) => {
    const last = i === periods - 1;
    const capitalCents = t.loanType === "fixed" ? (last ? remaining : slice) : last ? t.principalCents : 0;
    if (t.loanType === "fixed") remaining -= capitalCents;
    return {
      n: i + 1, dueDate: addPeriods(t.startDate, t.frequency, i + 1), interestCents: interest, capitalCents,
      totalCents: interest + capitalCents,
      capitalAfterCents: t.loanType === "fixed" ? remaining : last ? 0 : t.principalCents,
    };
  });
  const totalInterestCents = interest * periods;
  return {
    rows, periodInterestCents: interest, next: rows[0], totalInterestCents,
    totalCapitalCents: t.principalCents, totalContractCents: totalInterestCents + t.principalCents,
  };
}

// ───────── Cobros ─────────

export interface PaymentCheck {
  interestCents: number;
  capitalCents: number;
  /** Intereses generados o programados aún sin cobrar (lo máximo que se puede cobrar de intereses). */
  interestCollectableCents: number;
  capitalOutstandingCents: number;
  paidOn: string;
  today: string;
  loanStartDate: string;
}

/** Misma validación que `register_payment` en la base de datos (que sigue siendo la autoridad). */
export function validatePayment(p: PaymentCheck): string[] {
  const errors: string[] = [];
  if (![p.interestCents, p.capitalCents].every((v) => Number.isInteger(v) && v >= 0)) errors.push("Los importes deben ser positivos y con máximo 2 decimales.");
  else if (p.interestCents + p.capitalCents <= 0) errors.push("Ingresa un importe mayor que cero.");
  if (p.interestCents > p.interestCollectableCents) errors.push("Los intereses exceden lo que corresponde cobrar.");
  if (p.capitalCents > p.capitalOutstandingCents) errors.push("El abono de capital supera el capital pendiente.");
  if (!isValidIsoDate(p.paidOn)) errors.push("La fecha de pago no es válida.");
  else if (p.paidOn > p.today) errors.push("La fecha de pago no puede ser futura.");
  else if (p.paidOn < p.loanStartDate) errors.push("La fecha de pago es anterior al desembolso.");
  return errors;
}

// ───────── Estado y progreso ─────────

export type DerivedStatus = "active" | "overdue" | "paid" | "cancelled" | "refinanced";

/** Activo: hay saldo u obligación vigente. Vencido: obligación exigible impaga. Pagado: solo si la base lo cerró. */
export function deriveStatus(dbStatus: string, overdueCents: number): DerivedStatus {
  if (dbStatus === "paid_off") return "paid";
  if (dbStatus === "cancelled") return "cancelled";
  if (dbStatus === "refinanced") return "refinanced";
  return overdueCents > 0 ? "overdue" : "active";
}

export const STATUS_LABEL: Record<DerivedStatus, string> = {
  active: "Activo", overdue: "Vencido", paid: "Pagado", cancelled: "Anulado", refinanced: "Refinanciado",
};

/** % del capital original recuperado. Solo cuentan los abonos de capital: los intereses nunca lo incrementan. */
export function capitalRecoveredPct(principalCents: number, capitalPaidCents: number): number {
  if (principalCents <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((capitalPaidCents * 10000) / principalCents) / 100));
}

export { MAX_PERIODS };

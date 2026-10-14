/**
 * Reparto de un cobro entre intereses y capital (módulo puro, céntimos enteros).
 * Misma mecánica que `register_payment` en la BD: intereses al período más antiguo primero; capital al capital programado
 * más antiguo y, si no hay capital programado (préstamo abierto / abono extraordinario), solo reduce el saldo.
 *
 * Reparto AUTOMÁTICO del importe recibido:
 *  1. Período a período (del más antiguo al más nuevo) entre los YA EXIGIBLES: primero su interés y luego su capital programado.
 *  2. Lo que sobra es un EXCEDENTE: en "solo intereses" y "abierto" se propone como abono a capital (el usuario lo confirma);
 *     en "cuotas fijas" se adelanta a las siguientes cuotas, en orden.
 *  3. Nunca se baja el capital por un pago menor al interés exigible.
 */
import type { LoanType } from "./loan-rules.ts";

export interface Obligation {
  n: number;
  dueDate: string;
  interestPendingCents: number;
  capitalPendingCents: number;
}

export interface PeriodApplied {
  n: number;
  dueDate: string;
  interestApplied: number;
  capitalApplied: number;
  interestLeft: number;
  capitalLeft: number;
}

export interface AllocationContext {
  loanType: LoanType;
  /** Pendientes (impagos), ordenados por n. */
  obligations: Obligation[];
  today: string;
  capitalOutstandingCents: number;
}

export interface Allocation {
  interestCents: number;
  capitalCents: number;
  /** Parte del capital que NO corresponde a capital programado exigible (excedente / abono extraordinario). */
  extraCapitalCents: number;
  periods: PeriodApplied[];
  unallocatedCents: number;
  /** Intereses generados (vencidos o de hoy) que seguirán pendientes. */
  interestPendingAfterCents: number;
  capitalAfterCents: number;
  totalPendingAfterCents: number;
  errors: string[];
}

const exigible = (o: Obligation, today: string) => o.dueDate <= today;

/** Aplica importes ya decididos (manual o automático) y calcula el estado resultante. */
export function applyAmounts(interestCents: number, capitalCents: number, ctx: AllocationContext): Allocation {
  const errors: string[] = [];
  if (![interestCents, capitalCents].every((v) => Number.isInteger(v) && v >= 0)) errors.push("Los importes deben ser positivos y con máximo 2 decimales.");

  let iLeft = Math.max(0, interestCents);
  let cLeft = Math.max(0, capitalCents);
  const periods: PeriodApplied[] = ctx.obligations.map((o) => {
    const ia = Math.min(iLeft, o.interestPendingCents);
    iLeft -= ia;
    const ca = Math.min(cLeft, o.capitalPendingCents);
    cLeft -= ca;
    return { n: o.n, dueDate: o.dueDate, interestApplied: ia, capitalApplied: ca, interestLeft: o.interestPendingCents - ia, capitalLeft: o.capitalPendingCents - ca };
  });

  if (iLeft > 0) errors.push("Los intereses exceden lo que corresponde cobrar.");
  if (capitalCents > ctx.capitalOutstandingCents) errors.push("El abono de capital supera el capital pendiente.");
  else if (cLeft > 0 && ctx.loanType !== "open") errors.push("El capital excede el capital programado pendiente.");

  const capitalAfter = ctx.capitalOutstandingCents - capitalCents;
  const interestPendingAfter = periods.filter((p) => p.dueDate <= ctx.today).reduce((s, p) => s + p.interestLeft, 0);
  return {
    interestCents, capitalCents,
    // Capital que excede lo exigible hoy (excedente / abono extraordinario): el usuario debe confirmarlo.
    extraCapitalCents: capitalCents - periods.filter((p) => p.dueDate <= ctx.today).reduce((s, p) => s + p.capitalApplied, 0),
    periods, unallocatedCents: 0,
    interestPendingAfterCents: interestPendingAfter,
    capitalAfterCents: capitalAfter,
    totalPendingAfterCents: capitalAfter + interestPendingAfter,
    errors,
  };
}

/** Reparto automático del importe recibido (ver reglas arriba). */
export function autoAllocate(receivedCents: number, ctx: AllocationContext): Allocation {
  let left = Math.max(0, Math.trunc(receivedCents));
  let interest = 0;
  let capital = 0;

  const take = (want: number) => { const x = Math.min(left, want); left -= x; return x; };
  for (const o of ctx.obligations.filter((x) => exigible(x, ctx.today))) {
    interest += take(o.interestPendingCents);
    capital += take(o.capitalPendingCents);
  }
  if (left > 0) {
    if (ctx.loanType === "fixed") {
      for (const o of ctx.obligations.filter((x) => !exigible(x, ctx.today))) {
        interest += take(o.interestPendingCents);
        capital += take(o.capitalPendingCents);
      }
    } else {
      capital += take(Math.max(0, ctx.capitalOutstandingCents - capital));
    }
  }
  const a = applyAmounts(interest, capital, ctx);
  a.unallocatedCents = left;
  if (left > 0) a.errors.push("El importe recibido excede el saldo pendiente del préstamo.");
  return a;
}

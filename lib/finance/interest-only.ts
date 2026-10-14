/**
 * Modelo financiero: interés periódico sobre el CAPITAL ORIGINAL + capital al vencimiento.
 *
 * - Todo el dinero se maneja en céntimos enteros (nunca float) para evitar errores de redondeo.
 * - La tasa se expresa en puntos básicos (bps): 10 % = 1000 bps. Es la tasa POR PERÍODO DE PAGO.
 * - Módulo puro y sin dependencias: se prueba con `npm test` y se reutiliza en servidor y cliente.
 */

export type Frequency = "monthly" | "biweekly" | "weekly";

export interface LoanTerms {
  /** Capital original en céntimos (> 0). */
  principalCents: number;
  /** Tasa por período de pago, en puntos básicos (0..99999). */
  rateBps: number;
  /** Número de períodos de pago (1..120). */
  periods: number;
  frequency: Frequency;
  /** Fecha de desembolso, formato YYYY-MM-DD. */
  startDate: string;
}

export interface ScheduleRow {
  n: number;
  dueDate: string;
  interestCents: number;
  /** Capital que se devuelve en este vencimiento (solo > 0 en el último). */
  capitalCents: number;
  totalCents: number;
  /** Capital pendiente después de este vencimiento. */
  capitalAfterCents: number;
}

export interface LoanProjection {
  rows: ScheduleRow[];
  totalInterestCents: number;
  totalCapitalCents: number;
  totalContractCents: number;
  /** Interés de cada período (constante: se calcula sobre el capital original). */
  periodInterestCents: number;
}

export const FREQUENCY_LABEL: Record<Frequency, { rate: string; period: string; periods: string }> = {
  monthly: { rate: "Tasa mensual (%)", period: "mes", periods: "Plazo (meses)" },
  biweekly: { rate: "Tasa quincenal (%)", period: "quincena", periods: "Plazo (quincenas)" },
  weekly: { rate: "Tasa semanal (%)", period: "semana", periods: "Plazo (semanas)" },
};

export const MAX_PERIODS = 120;

/** Convierte soles (p. ej. 1234.56) a céntimos enteros. */
export const toCents = (amount: number): number => Math.round(amount * 100);
/** Convierte un porcentaje (p. ej. 10.25) a puntos básicos enteros. */
export const percentToBps = (pct: number): number => Math.round(pct * 100);

/** Interés de un período sobre el capital original, redondeado al céntimo (half-up). */
export function periodInterest(principalCents: number, rateBps: number): number {
  return Math.round((principalCents * rateBps) / 10000);
}

export function validateTerms(t: LoanTerms): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(t.principalCents) || t.principalCents <= 0) errors.push("El capital debe ser mayor que cero.");
  if (!Number.isInteger(t.rateBps) || t.rateBps < 0 || t.rateBps > 99999) errors.push("La tasa debe estar entre 0 % y 999,99 %.");
  if (!Number.isInteger(t.periods) || t.periods < 1 || t.periods > MAX_PERIODS) errors.push(`El plazo debe estar entre 1 y ${MAX_PERIODS} períodos.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.startDate) || Number.isNaN(Date.parse(t.startDate))) errors.push("La fecha de desembolso no es válida.");
  return errors;
}

/** Suma `k` períodos a una fecha YYYY-MM-DD (UTC). En meses, ajusta al último día si no existe (31 → 28/30). */
export function addPeriods(startDate: string, frequency: Frequency, k: number): string {
  const [y, m, d] = startDate.split("-").map(Number);
  if (frequency === "monthly") {
    const total = m - 1 + k;
    const year = y + Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12;
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return new Date(Date.UTC(year, month, Math.min(d, last))).toISOString().slice(0, 10);
  }
  const days = frequency === "weekly" ? 7 : 15;
  return new Date(Date.UTC(y, m - 1, d + days * k)).toISOString().slice(0, 10);
}

/**
 * Genera la proyección. Lanza si los términos son inválidos (validar antes con `validateTerms`).
 * Cada vencimiento cobra el interés sobre el capital ORIGINAL; el capital se devuelve íntegro en el último.
 */
export function buildSchedule(t: LoanTerms): LoanProjection {
  const errors = validateTerms(t);
  if (errors.length) throw new Error(errors.join(" "));

  const interest = periodInterest(t.principalCents, t.rateBps);
  const rows: ScheduleRow[] = Array.from({ length: t.periods }, (_, i) => {
    const last = i === t.periods - 1;
    const capitalCents = last ? t.principalCents : 0;
    return {
      n: i + 1,
      dueDate: addPeriods(t.startDate, t.frequency, i + 1),
      interestCents: interest,
      capitalCents,
      totalCents: interest + capitalCents,
      capitalAfterCents: t.principalCents - capitalCents,
    };
  });

  const totalInterestCents = interest * t.periods;
  return {
    rows,
    periodInterestCents: interest,
    totalInterestCents,
    totalCapitalCents: t.principalCents,
    totalContractCents: totalInterestCents + t.principalCents,
  };
}

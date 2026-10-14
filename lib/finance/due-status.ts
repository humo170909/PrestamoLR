/**
 * ÚNICA regla de estado de vencimiento. La usan el listado, el detalle, el cobro, la morosidad y los reportes.
 * Entradas: la fecha del vencimiento pendiente más antiguo (YYYY-MM-DD, null si no hay nada pendiente) y "hoy" en Lima.
 * Se comparan fechas ISO (YYYY-MM-DD) como cadenas de la MISMA zona horaria; nunca Date en UTC.
 */
export type DueState = "overdue" | "due_today" | "upcoming" | "none" | "paid";

export const DUE_STATE_LABEL: Record<DueState, string> = {
  overdue: "Vencido", due_today: "Vence hoy", upcoming: "Próximo vencimiento", none: "Sin obligaciones pendientes", paid: "Pagado",
};

/** Fecha de negocio en Lima (YYYY-MM-DD). */
export const limaDate = (now = new Date()): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

export function dueState(input: { nextDue: string | null; today: string; loanClosed?: boolean }): DueState {
  if (input.loanClosed) return "paid";
  if (!input.nextDue) return "none";
  if (input.nextDue < input.today) return "overdue";
  if (input.nextDue === input.today) return "due_today";
  return "upcoming";
}

export const daysLate = (dueDate: string, today: string): number =>
  Math.max(0, Math.round((Date.parse(today) - Date.parse(dueDate)) / 86_400_000));

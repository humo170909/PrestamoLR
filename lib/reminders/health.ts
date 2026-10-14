/** Salud del cron de avisos: ¿hubo alguna ejecución registrada hoy (día de Lima)? Módulo puro (sin red). */
const LIMA = "America/Lima";
/** Hora de Lima desde la que la ausencia de ejecuciones se considera un fallo (el cron de las 08:00 puede tardar hasta una hora en Hobby). */
export const ALERT_FROM_HOUR = 9;

const limaDate = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: LIMA, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const limaHour = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: LIMA, hour: "2-digit", hour12: false }).format(d)) % 24;

/** Instante UTC (ISO) en que empieza el día de Lima de `now` (Lima = UTC-5, sin horario de verano). */
export const limaDayStartUtc = (now = new Date()): string => `${limaDate(now)}T05:00:00.000Z`;

/** true si ya pasaron las 09:00 de Lima y ninguna de las ejecuciones (`started_at`, ISO) cae en el día de Lima de hoy. */
export function cronMissingToday(now: Date, startedAts: string[]): boolean {
  if (limaHour(now) < ALERT_FROM_HOUR) return false;
  const start = Date.parse(limaDayStartUtc(now));
  return !startedAts.some((s) => Date.parse(s) >= start);
}

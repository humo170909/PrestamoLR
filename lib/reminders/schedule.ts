/**
 * Programación EFECTIVA de los avisos, leída del propio vercel.json que se despliega (no una fecha escrita en el código).
 * Vercel Cron interpreta las expresiones en UTC. Perú (America/Lima) es UTC-5 todo el año, sin horario de verano:
 *   "0 13 * * *" = 08:00 Lima   ·   "0 23 * * *" = 18:00 Lima
 * Solo se admiten expresiones diarias "M H * * *"; cualquier otra se ignora y, si no queda ninguna, la próxima
 * ejecución se informa como "no determinada" en lugar de inventarla.
 */
import vercel from "../../vercel.json" with { type: "json" };

export const TIMEZONE = "America/Lima";
/** Horario de ENVÍO de la revisión horaria (hora de Lima): no se escribe de madrugada. */
export const SEND_FROM_HOUR = 8;
export const SEND_UNTIL_HOUR = 20;

export interface ScheduledJob { job: string; /** null = cada hora */ utcHour: number | null; utcMinute: number; limaTime: string; label: string }

const WHAT: Record<string, string> = { morning: "cobros de hoy y atrasos", evening: "cobros de mañana (reintenta hoy y atrasos)", hourly: "revisión horaria: vencimientos nuevos y reintentos" };

const limaClock = (utcHour: number, utcMinute: number) =>
  new Intl.DateTimeFormat("es-PE", { timeZone: TIMEZONE, hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(Date.UTC(2026, 0, 15, utcHour, utcMinute)));

export function parseCrons(crons: { path: string; schedule: string }[]): ScheduledJob[] {
  const out: ScheduledJob[] = [];
  for (const c of crons) {
    const job = /[?&]job=(\w+)/.exec(c.path)?.[1];
    if (!job || !c.path.startsWith("/api/cron/reminders")) continue;
    const hourly = /^(\d{1,2}) \* \* \* \*$/.exec(c.schedule.trim());
    if (hourly && Number(hourly[1]) <= 59) {
      out.push({ job, utcHour: null, utcMinute: Number(hourly[1]), limaTime: `${SEND_FROM_HOUR}:00–${SEND_UNTIL_HOUR}:00`, label: `cada hora, de ${SEND_FROM_HOUR}:00 a ${SEND_UNTIL_HOUR}:00 (Lima) · ${WHAT[job] ?? job}` });
      continue;
    }
    const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(c.schedule.trim());
    if (!m) continue;
    const utcMinute = Number(m[1]), utcHour = Number(m[2]);
    if (utcMinute > 59 || utcHour > 23) continue;
    const limaTime = limaClock(utcHour, utcMinute);
    out.push({ job, utcHour, utcMinute, limaTime, label: `${limaTime} (Lima) · ${WHAT[job] ?? job}` });
  }
  return out;
}

export const SCHEDULE: ScheduledJob[] = parseCrons((vercel as { crons?: { path: string; schedule: string }[] }).crons ?? []);

const limaHourOf = (d: Date) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, hour: "2-digit", hour12: false }).format(d)) % 24;

/** Siguiente ejecución a partir de la programación efectiva; null si no se puede determinar. */
export function nextRun(now = new Date(), schedule: ScheduledJob[] = SCHEDULE): { job: string; at: Date; label: string } | null {
  const candidates: { job: string; label: string; at: Date }[] = [];
  for (const s of schedule) {
    if (s.utcHour === null) {
      // Cada hora: solo cuentan las horas dentro de la ventana de envío (de noche la tarea no escribe).
      for (let h = 0; h < 49; h++) {
        const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() + h, s.utcMinute, 0));
        const lh = limaHourOf(at);
        if (lh >= SEND_FROM_HOUR && lh < SEND_UNTIL_HOUR) candidates.push({ job: s.job, label: s.label, at });
      }
    } else {
      for (const d of [0, 1]) candidates.push({ job: s.job, label: s.label, at: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + d, s.utcHour, s.utcMinute, 0)) });
    }
  }
  return candidates.filter((c) => c.at.getTime() > now.getTime()).sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

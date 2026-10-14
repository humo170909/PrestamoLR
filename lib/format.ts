export const money = (n: number) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", maximumFractionDigits: 0 }).format(n);
export const moneyDec = (n: number) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency: "PEN", minimumFractionDigits: 2 }).format(n);
export const compact = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

/** Fecha de hoy (YYYY-MM-DD) en Lima, igual que usan la base de datos y los recordatorios. */
export const limaToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

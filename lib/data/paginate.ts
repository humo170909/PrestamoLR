/**
 * Lectura completa por páginas. PostgREST/Supabase devuelve como máximo `max_rows` filas por petición (1 000 por defecto) y
 * NO avisa al truncar. Aquí se pide siempre el conteo exacto, se avanza desde las filas ya recibidas (no desde un múltiplo fijo,
 * así también funciona si el servidor responde menos filas que `pageSize`) y se informa `total` para poder avisar si algo queda fuera.
 * Módulo puro (sin red ni dependencias): se prueba con `npm test`.
 */
export type Paged<T> = T[] & { /** Total de filas que existen en el servidor (puede ser mayor que `length` si se alcanzó `maxRows`). */ total: number };

export interface PageResult<T> { rows: T[]; /** Conteo exacto del servidor (`count: "exact"`), null si no lo informó. */ total: number | null }

export const PAGE_SIZE = 1000;
/** Límite de seguridad para no descargar sin fin; si se supera, `total > length` y la interfaz lo avisa. */
export const MAX_ROWS = 20_000;

export async function fetchAllPages<T>(
  page: (from: number, to: number) => Promise<PageResult<T>>,
  opts: { pageSize?: number; maxRows?: number } = {},
): Promise<Paged<T>> {
  const pageSize = opts.pageSize ?? PAGE_SIZE;
  const maxRows = opts.maxRows ?? MAX_ROWS;
  const rows: T[] = [];
  let total: number | null = null;
  for (;;) {
    const from = rows.length;
    const r = await page(from, from + pageSize - 1);
    if (r.total !== null) total = r.total;
    if (r.rows.length === 0) break;
    rows.push(...r.rows);
    if (total !== null ? rows.length >= total : r.rows.length < pageSize) break;
    if (rows.length >= maxRows) break;
  }
  return Object.assign(rows, { total: Math.max(total ?? rows.length, rows.length) });
}

const cents = (v: unknown) => Math.round(Number(v) * 100);

/**
 * Concilia lo cargado en el navegador con `report_totals()` (fuente de verdad en SQL). Devuelve un mensaje por cada diferencia
 * (tolerancia: menos de 1 céntimo). Una diferencia indica datos truncados o inconsistentes.
 */
export function reconcileTotals(
  loaded: { interest: number; capital: number; disbursed: number },
  server: { interest: unknown; capital: unknown; disbursed: unknown },
): string[] {
  const out: string[] = [];
  const check = (label: string, mine: number, theirs: unknown) => {
    if (cents(mine) !== cents(theirs)) out.push(`${label}: los datos cargados suman ${mine.toFixed(2)} y la base de datos informa ${Number(theirs).toFixed(2)}.`);
  };
  check("Intereses cobrados", loaded.interest, server.interest);
  check("Capital recuperado", loaded.capital, server.capital);
  check("Capital desembolsado", loaded.disbursed, server.disbursed);
  return out;
}

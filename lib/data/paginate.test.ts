// A-03: ninguna lista ni reporte debe truncarse en silencio al superar el tope de filas del servidor (1 000 en Supabase).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAllPages, reconcileTotals } from "./paginate.ts";

/** Simula PostgREST: devuelve como máximo `serverMax` filas por petición e informa el total exacto. */
const server = (n: number, serverMax = 1000) => {
  const calls: [number, number][] = [];
  const page = async (from: number, to: number) => {
    calls.push([from, to]);
    const end = Math.min(to, from + serverMax - 1, n - 1);
    return { rows: Array.from({ length: Math.max(0, end - from + 1) }, (_, i) => from + i), total: n };
  };
  return { page, calls };
};

test("2 500 filas con tope de 1 000 por petición: se cargan TODAS, sin duplicados y en orden", async () => {
  const s = server(2500);
  const r = await fetchAllPages(s.page);
  assert.equal(r.length, 2500);
  assert.equal(r.total, 2500);
  assert.deepEqual(r.slice(998, 1002), [998, 999, 1000, 1001]);
  assert.equal(new Set(r).size, 2500);
  assert.equal(s.calls.length, 3);
});

test("si el servidor devuelve MENOS que el tamaño de página (tope de 500), sigue pidiendo hasta el total", async () => {
  const r = await fetchAllPages(server(1700, 500).page);
  assert.equal(r.length, 1700);
});

test("exactamente 1 000 filas y 0 filas", async () => {
  assert.equal((await fetchAllPages(server(1000).page)).length, 1000);
  const empty = await fetchAllPages(server(0).page);
  assert.equal(empty.length, 0);
  assert.equal(empty.total, 0);
});

test("por encima del límite de seguridad se corta y `total` permite avisar al usuario", async () => {
  const r = await fetchAllPages(server(5000).page, { pageSize: 1000, maxRows: 2000 });
  assert.equal(r.length, 2000);
  assert.equal(r.total, 5000);
  assert.ok(r.total > r.length);
});

test("una página vacía inesperada no provoca un bucle infinito", async () => {
  let n = 0;
  const r = await fetchAllPages(async () => (++n > 3 ? { rows: [], total: 9999 } : { rows: [1, 2, 3], total: 9999 }), { pageSize: 3 });
  assert.equal(r.length, 9);
});

test("los errores del servidor se propagan (no se devuelve una lista parcial como si fuera completa)", async () => {
  await assert.rejects(fetchAllPages(async (from) => { if (from > 0) throw new Error("boom"); return { rows: [1, 2], total: 5 }; }, { pageSize: 2 }), /boom/);
});

test("conciliación con report_totals: coincide, difiere y tolera céntimos", () => {
  const srv = { interest: "300.00", capital: "1000", disbursed: "3700" };
  assert.deepEqual(reconcileTotals({ interest: 300, capital: 1000, disbursed: 3700 }, srv), []);
  assert.deepEqual(reconcileTotals({ interest: 300.004, capital: 1000, disbursed: 3700 }, srv), []);
  const bad = reconcileTotals({ interest: 150, capital: 1000, disbursed: 3000 }, srv);
  assert.equal(bad.length, 2);
  assert.match(bad[0], /intereses/i);
  assert.match(bad[1], /desembolsado/i);
});

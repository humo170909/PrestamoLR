import { test } from "node:test";
import assert from "node:assert/strict";
import { addDays, entriesDueOn, formatOverdue, formatToday, formatTomorrow, overdueEntries, splitMessage, type PendingInstallment } from "./build.ts";

// Ejemplo del contrato: S/1000, interés 100 por mes, 3 meses desde 2026-07-15 (cuotas 08-15, 09-15, 10-15).
const mk = (n: number, dueDate: string, interestCents: number, capitalCents = 0, loanId = "L1", client = "Ana"): PendingInstallment =>
  ({ loanId, loanCode: "PR-0001", clientName: client, phone: "999", n, dueDate, interestCents, capitalCents });

test("vence hoy: interés 100, capital solo en la última cuota", () => {
  const rows = [mk(3, "2026-10-15", 10000, 100000)];
  const [e] = entriesDueOn(rows, "2026-10-15");
  assert.equal(e.interestCents, 10000);
  assert.equal(e.capitalCents, 100000);
  assert.equal(e.priorInterestCents, 0);
});

test("pago parcial: se recuerda solo lo pendiente (40 de 100)", () => {
  const [e] = entriesDueOn([mk(1, "2026-08-15", 4000)], "2026-08-15");
  assert.equal(e.interestCents, 4000);
});

test("vencimiento totalmente pagado no genera recordatorio", () => {
  assert.equal(entriesDueOn([mk(1, "2026-08-15", 0)], "2026-08-15").length, 0);
});

test("atrasado de períodos anteriores se suma aparte", () => {
  const rows = [mk(1, "2026-08-15", 10000), mk(2, "2026-09-15", 10000)];
  const [e] = entriesDueOn(rows, "2026-09-15");
  assert.equal(e.interestCents, 10000);
  assert.equal(e.priorInterestCents, 10000);
  assert.match(formatToday([e], "2026-09-15")!, /Total exigible: <b>S\/ 200\.00<\/b>/);
});

test("vencidos: días desde el más antiguo y capital vencido separado", () => {
  const rows = [mk(1, "2026-08-15", 10000), mk(2, "2026-09-15", 10000), mk(3, "2026-10-15", 10000, 100000)];
  const [o] = overdueEntries(rows, "2026-10-20");
  assert.equal(o.daysOverdue, 66);
  assert.equal(o.interestCents, 30000);
  assert.equal(o.capitalCents, 100000);
  assert.equal(overdueEntries(rows, "2026-08-15").length, 0); // el día del vencimiento aún no está vencido
});

test("capital pendiente no vence con solo pagar intereses", () => {
  const rows = [mk(3, "2026-10-15", 0, 100000)]; // intereses pagados, capital pendiente
  const [e] = entriesDueOn(rows, "2026-10-15");
  assert.equal(e.interestCents, 0);
  assert.equal(e.capitalCents, 100000);
});

test("mensaje de mañana incluye cierre del día y próximos", () => {
  const rows = [mk(1, "2026-08-16", 10000), mk(2, "2026-08-19", 10000, 0, "L2", "Beto")];
  const tomorrow = entriesDueOn(rows, "2026-08-16");
  const upcoming = entriesDueOn(rows, "2026-08-19");
  const msg = formatTomorrow(tomorrow, upcoming, "2026-08-15", { paymentsCount: 2, interestCents: 15000, capitalCents: 0 }, 1)!;
  assert.match(msg, /2 pago\(s\)/);
  assert.match(msg, /Siguen pendientes de hoy: 1/);
  assert.match(msg, /Beto/);
});

test("sin obligaciones no hay mensaje; los nombres se escapan en HTML", () => {
  assert.equal(formatToday([], "2026-08-15"), null);
  assert.equal(formatOverdue([], "2026-08-15"), null);
  const [e] = entriesDueOn([mk(1, "2026-08-15", 100, 0, "L1", "A<b>&Co")], "2026-08-15");
  assert.ok(formatToday([e], "2026-08-15")!.includes("A&lt;b&gt;&amp;Co"));
});

test("fechas y división de mensajes largos", () => {
  assert.equal(addDays("2026-02-28", 1), "2026-03-01");
  const big = Array.from({ length: 500 }, (_, i) => `línea ${i} ${"x".repeat(30)}`).join("\n");
  const parts = splitMessage(big);
  assert.ok(parts.length > 1 && parts.every((p) => p.length <= 4096));
  assert.equal(parts.join("\n"), big);
});

test("recordatorio incluye capital pendiente del préstamo y períodos vencidos", () => {
  const rows = [
    { ...mk(1, "2026-08-15", 15000), principalOutstandingCents: 80000 },
    { ...mk(2, "2026-09-15", 15000), principalOutstandingCents: 80000 },
  ];
  const [o] = overdueEntries(rows, "2026-10-01");
  assert.equal(o.periodsOverdue, 2);
  const text = formatOverdue([o], "2026-10-01") ?? "";
  assert.match(text, /Períodos vencidos: 2/);
  assert.match(text, /Capital pendiente del préstamo: S\/ 800\.00/);
  const [t] = entriesDueOn(rows, "2026-09-15");
  assert.match(formatToday([t], "2026-09-15") ?? "", /Capital pendiente del préstamo: S\/ 800\.00/);
});

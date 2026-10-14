import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAmounts, autoAllocate, type AllocationContext } from "./allocation.ts";
import { dueState, daysLate } from "./due-status.ts";

// S/1,000 al 15 % mensual, interés exigible S/150 (período 1 vencido), siguiente período aún no vence.
const io: AllocationContext = {
  loanType: "interest_only", today: "2026-10-10", capitalOutstandingCents: 100000,
  obligations: [
    { n: 1, dueDate: "2026-10-01", interestPendingCents: 15000, capitalPendingCents: 0 },
    // El capital programado vence en el último período (como en la BD); un abono se aplica ahí sin cambiar los intereses.
    { n: 2, dueDate: "2026-11-01", interestPendingCents: 15000, capitalPendingCents: 100000 },
  ],
};

test("caso 1: paga S/150 → interés 150, capital 0, capital pendiente 1,000, interés pendiente 0", () => {
  const a = autoAllocate(15000, io);
  assert.equal(a.interestCents, 15000); assert.equal(a.capitalCents, 0);
  assert.equal(a.capitalAfterCents, 100000); assert.equal(a.interestPendingAfterCents, 0);
  assert.deepEqual(a.errors, []);
});

test("caso 2: paga S/250 → interés 150, capital 100, capital pendiente 900", () => {
  const a = autoAllocate(25000, io);
  assert.equal(a.interestCents, 15000); assert.equal(a.capitalCents, 10000);
  assert.equal(a.extraCapitalCents, 10000); // excedente que el usuario debe confirmar
  assert.equal(a.capitalAfterCents, 90000); assert.equal(a.interestPendingAfterCents, 0);
});

test("caso 3: paga S/100 → interés 100, capital 0, quedan S/50 de interés pendiente y capital 1,000", () => {
  const a = autoAllocate(10000, io);
  assert.equal(a.interestCents, 10000); assert.equal(a.capitalCents, 0);
  assert.equal(a.interestPendingAfterCents, 5000); assert.equal(a.capitalAfterCents, 100000);
  assert.equal(a.periods[0].interestLeft, 5000);
});

test("caso 4: abono directo de S/200 a capital → interés 0, capital 800 y el interés exigible sigue pendiente", () => {
  const a = applyAmounts(0, 20000, io);
  assert.equal(a.interestCents, 0); assert.equal(a.capitalAfterCents, 80000);
  assert.equal(a.interestPendingAfterCents, 15000);
  assert.deepEqual(a.errors, []);
});

test("varios períodos vencidos: se paga el más antiguo primero y se muestra cada desglose", () => {
  const ctx: AllocationContext = { ...io, obligations: [
    { n: 1, dueDate: "2026-08-01", interestPendingCents: 15000, capitalPendingCents: 0 },
    { n: 2, dueDate: "2026-09-01", interestPendingCents: 15000, capitalPendingCents: 0 },
    { n: 3, dueDate: "2026-10-01", interestPendingCents: 15000, capitalPendingCents: 0 },
  ] };
  const a = autoAllocate(20000, ctx);
  assert.deepEqual(a.periods.map((p) => p.interestApplied), [15000, 5000, 0]);
  assert.deepEqual(a.periods.map((p) => p.interestLeft), [0, 10000, 15000]);
  assert.equal(a.interestPendingAfterCents, 25000);
});

test("validaciones: capital mayor al pendiente, interés de más y exceso total", () => {
  assert.ok(applyAmounts(0, 100001, io).errors.length);
  assert.ok(applyAmounts(30001, 0, io).errors.length);
  assert.ok(autoAllocate(100000 + 30000 + 1, io).errors.length);
});

// Cuotas fijas: S/1,200 al 10 % × 4 → cuota 300 capital + 120 interés. Cuota 1 vencida.
const fx: AllocationContext = {
  loanType: "fixed", today: "2026-10-10", capitalOutstandingCents: 120000,
  obligations: [1, 2, 3, 4].map((n) => ({ n, dueDate: `2026-${String(9 + n).padStart(2, "0")}-01`, interestPendingCents: 12000, capitalPendingCents: 30000 })),
};

test("cuota fija: pago parcial deja saldo en la cuota y no la cancela", () => {
  const a = autoAllocate(20000, fx);
  assert.equal(a.interestCents, 12000); assert.equal(a.capitalCents, 8000);
  assert.equal(a.periods[0].capitalLeft, 22000);
  assert.ok(a.periods[0].interestLeft + a.periods[0].capitalLeft > 0);
});

test("cuota fija: pago completo cancela la cuota", () => {
  const a = autoAllocate(42000, fx);
  assert.equal(a.periods[0].interestLeft + a.periods[0].capitalLeft, 0);
  assert.equal(a.capitalAfterCents, 90000);
});

test("estado de vencimiento: mañana, hoy, vencido, pagado, sin obligaciones, cancelado", () => {
  const today = "2026-10-10";
  assert.equal(dueState({ nextDue: "2026-10-11", today }), "upcoming");
  assert.equal(dueState({ nextDue: "2026-10-10", today }), "due_today");
  assert.equal(dueState({ nextDue: "2026-10-09", today }), "overdue");
  assert.equal(dueState({ nextDue: null, today }), "none");
  assert.equal(dueState({ nextDue: "2026-10-09", today, loanClosed: true }), "paid");
  assert.equal(daysLate("2026-10-01", today), 9);
  assert.equal(daysLate("2026-10-12", today), 0);
});

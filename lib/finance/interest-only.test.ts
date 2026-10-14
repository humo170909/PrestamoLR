import { test } from "node:test";
import assert from "node:assert/strict";
import { addPeriods, buildSchedule, percentToBps, toCents, validateTerms } from "./interest-only.ts";

const base = { principalCents: toCents(1000), rateBps: percentToBps(10), periods: 3, frequency: "monthly" as const, startDate: "2026-01-15" };

test("ejemplo del contrato: S/1000, 10 % mensual, 3 meses", () => {
  const p = buildSchedule(base);
  assert.deepEqual(p.rows.map((r) => r.interestCents), [10000, 10000, 10000]);
  assert.deepEqual(p.rows.map((r) => r.capitalCents), [0, 0, 100000]);
  assert.deepEqual(p.rows.map((r) => r.capitalAfterCents), [100000, 100000, 0]);
  assert.equal(p.totalInterestCents, 30000);
  assert.equal(p.totalCapitalCents, 100000);
  assert.equal(p.totalContractCents, 130000);
  assert.deepEqual(p.rows.map((r) => r.dueDate), ["2026-02-15", "2026-03-15", "2026-04-15"]);
});

test("la tasa no está fija en 10 %: 4,5 % sobre S/5000 x 12", () => {
  const p = buildSchedule({ ...base, principalCents: toCents(5000), rateBps: percentToBps(4.5), periods: 12 });
  assert.equal(p.periodInterestCents, 22500);
  assert.equal(p.totalInterestCents, 270000);
  assert.equal(p.rows[11].capitalCents, 500000);
});

test("tasa 0 %: sin intereses, capital al final", () => {
  const p = buildSchedule({ ...base, rateBps: 0 });
  assert.equal(p.totalInterestCents, 0);
  assert.equal(p.totalContractCents, 100000);
});

test("redondeo al céntimo sin float", () => {
  const p = buildSchedule({ ...base, principalCents: 33333, rateBps: 1000 });
  assert.equal(p.periodInterestCents, 3333);
});

test("fin de mes se ajusta", () => {
  assert.equal(addPeriods("2026-01-31", "monthly", 1), "2026-02-28");
  assert.equal(addPeriods("2026-01-31", "monthly", 2), "2026-03-31");
  assert.equal(addPeriods("2026-01-01", "weekly", 2), "2026-01-15");
  assert.equal(addPeriods("2026-01-01", "biweekly", 1), "2026-01-16");
});

test("validación rechaza términos inválidos", () => {
  assert.ok(validateTerms({ ...base, principalCents: 0 }).length);
  assert.ok(validateTerms({ ...base, periods: 0 }).length);
  assert.ok(validateTerms({ ...base, rateBps: -1 }).length);
  assert.throws(() => buildSchedule({ ...base, periods: 0 }));
});

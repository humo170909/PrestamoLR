import { test } from "node:test";
import assert from "node:assert/strict";
import { capitalRecoveredPct, deriveStatus, isValidIsoDate, previewLoan, validateLoan, validatePayment } from "./loan-rules.ts";

const open = { loanType: "open" as const, principalCents: 100000, rateBps: 1500, periods: null, frequency: "monthly" as const, startDate: "2026-01-31" };

test("abierto: S/1,000 al 15 % mensual → un solo cobro previsto, sin plazo ni total contractual", () => {
  const p = previewLoan(open);
  assert.equal(p.rows.length, 1);
  assert.equal(p.next.interestCents, 15000);
  assert.equal(p.next.capitalCents, 0);
  assert.equal(p.next.dueDate, "2026-02-28");
  assert.equal(p.totalContractCents, null);
  assert.equal(p.totalInterestCents, null);
});

test("vencimientos mensuales y cambio de mes/año", () => {
  const rows = previewLoan({ ...open, loanType: "interest_only", periods: 4, startDate: "2026-11-30" }).rows;
  assert.deepEqual(rows.map((r) => r.dueDate), ["2026-12-30", "2027-01-30", "2027-02-28", "2027-03-30"]);
});

test("cuotas fijas: capital en partes iguales y el último absorbe los céntimos", () => {
  const p = previewLoan({ ...open, loanType: "fixed", principalCents: 100000, rateBps: 1000, periods: 3 });
  assert.deepEqual(p.rows.map((r) => r.capitalCents), [33333, 33333, 33334]);
  assert.deepEqual(p.rows.map((r) => r.interestCents), [10000, 10000, 10000]);
  assert.equal(p.rows.reduce((s, r) => s + r.capitalCents, 0), 100000);
  assert.deepEqual(p.rows.map((r) => r.capitalAfterCents), [66667, 33334, 0]);
  assert.equal(p.totalContractCents, 130000);
});

test("solo intereses: interés constante y capital al final", () => {
  const p = previewLoan({ ...open, loanType: "interest_only", periods: 3 });
  assert.deepEqual(p.rows.map((r) => r.capitalCents), [0, 0, 100000]);
  assert.equal(p.totalInterestCents, 45000);
});

test("validaciones del formulario: capital, tasa, plazo y fecha", () => {
  assert.ok(validateLoan({ ...open, principalCents: 0 }).length);
  assert.ok(validateLoan({ ...open, principalCents: -5 }).length);
  assert.ok(validateLoan({ ...open, rateBps: -1 }).length);
  assert.ok(validateLoan({ ...open, rateBps: 100000 }).length);
  assert.ok(validateLoan({ ...open, startDate: "2026-02-31" }).length);
  assert.ok(validateLoan({ ...open, loanType: "fixed", periods: null }).length);
  assert.equal(validateLoan(open).length, 0);
  assert.equal(isValidIsoDate("2026-02-29"), false);
  assert.equal(isValidIsoDate("2028-02-29"), true);
});

const pay = { interestCents: 15000, capitalCents: 0, interestCollectableCents: 15000, capitalOutstandingCents: 100000, paidOn: "2026-03-01", today: "2026-03-01", loanStartDate: "2026-01-31" };

test("cobro: S/150 de intereses es válido y S/150 + S/200 de capital también", () => {
  assert.deepEqual(validatePayment(pay), []);
  assert.deepEqual(validatePayment({ ...pay, capitalCents: 20000 }), []);
});

test("cobro: rechaza capital superior al pendiente, intereses de más, negativos, fecha futura y anterior al desembolso", () => {
  assert.ok(validatePayment({ ...pay, capitalCents: 100001 }).some((e) => e.includes("capital")));
  assert.ok(validatePayment({ ...pay, interestCents: 15001 }).some((e) => e.includes("intereses")));
  assert.ok(validatePayment({ ...pay, interestCents: -1 }).length);
  assert.ok(validatePayment({ ...pay, interestCents: 0, capitalCents: 0 }).length);
  assert.ok(validatePayment({ ...pay, paidOn: "2026-03-02" }).length);
  assert.ok(validatePayment({ ...pay, paidOn: "2026-01-01" }).length);
});

test("estado: vencido nunca es pagado; pagado solo si la base lo cerró; pagos parciales conservan el saldo", () => {
  assert.equal(deriveStatus("active", 0), "active");
  assert.equal(deriveStatus("active", 5000), "overdue");
  assert.equal(deriveStatus("paid_off", 0), "paid");
  assert.equal(deriveStatus("paid_off", 5000), "paid");
});

test("% de capital recuperado usa solo abonos de capital", () => {
  assert.equal(capitalRecoveredPct(100000, 0), 0);      // solo se pagaron intereses
  assert.equal(capitalRecoveredPct(100000, 20000), 20); // S/200 de S/1,000
  assert.equal(capitalRecoveredPct(100000, 100000), 100);
  assert.equal(capitalRecoveredPct(0, 0), 0);
});

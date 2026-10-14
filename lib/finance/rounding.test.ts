// M-08: el redondeo del interés es "half-up" al céntimo, igual que `round(numeric, 2)` de PostgreSQL (el mutante `Math.floor` sobrevivía).
import { test } from "node:test";
import assert from "node:assert/strict";
import { periodInterest } from "./interest-only.ts";
import { previewLoan } from "./loan-rules.ts";

test("medios céntimos suben (half-up) como en SQL: capital en céntimos × tasa en bps", () => {
  // [capital en céntimos, tasa en bps, interés esperado en céntimos]
  const cases: [number, number, number][] = [
    [5, 1000, 1],       // 0.05 × 10 % = 0.005  → 0.01
    [15, 1000, 2],      // 0.015                → 0.02
    [105, 1000, 11],    // 0.105                → 0.11
    [25, 2000, 5],      // 0.05 exacto (no medio) → 0.05
    [1005, 1500, 151],  // 1.5075               → 1.51
    [99999, 1, 10],     // 0.099999             → 0.10
    [4, 1000, 0],       // 0.004                → 0.00 (por debajo del medio)
    [123456789, 99999, 1234555544],
  ];
  for (const [p, bps, want] of cases) assert.equal(periodInterest(p, bps), want, `${p} × ${bps} bps`);
});

test("el interés nunca es menor que el real por truncamiento: round(x) ≥ floor(x) y difiere en los medios céntimos", () => {
  assert.notEqual(periodInterest(5, 1000), Math.floor((5 * 1000) / 10000));
});

test("la vista previa usa el mismo redondeo en cada cuota", () => {
  const p = previewLoan({ loanType: "interest_only", principalCents: 15, rateBps: 1000, periods: 2, frequency: "monthly", startDate: "2026-01-01" });
  assert.deepEqual(p.rows.map((r) => r.interestCents), [2, 2]);
});

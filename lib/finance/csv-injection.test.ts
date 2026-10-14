// M-05: las exportaciones CSV no deben permitir inyección de fórmulas en Excel.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTERS, loansReport, toCsv, type ReportLoan } from "./reports.ts";

const loan = (name: string): ReportLoan => ({
  id: "1", code: "PR-0001", loan_type: "interest_only", db_status: "active", client_id: "c", full_name: name, document_id: "12345678", phone: null,
  principal: 1000, principal_outstanding: 1000, capital_paid: 0, rate_pct: 10, frequency: "monthly", periods: 3, start_date: "2026-01-01",
  created_at: "2026-01-01T00:00:00Z", interest_generated: 0, interest_paid: 0, interest_pending: 0, interest_overdue: 0, capital_overdue: 0,
  interest_projected: 0, next_due_date: null, oldest_overdue_date: null, days_overdue: 0, periods_elapsed: 0, periods_paid: 0, periods_overdue: 0,
  total_paid: 0, last_payment_on: null, derived_status: "active", closed_on: null, interest_scheduled: 0, periods_unpaid_exigible: 0,
  due_today_pending: 0, next_due_amount: 0, business_today: "2026-10-13",
} as unknown as ReportLoan);

const cells = (name: string) => {
  const csv = toCsv(loansReport([loan(name)], EMPTY_FILTERS), EMPTY_FILTERS, "ahora");
  return csv.split("\r\n").find((l) => l.includes("PR-0001"))!;
};

test("los 4 payloads de la auditoría salen con apóstrofo delante (Excel los trata como texto)", () => {
  for (const [payload, expected] of [
    ['=HYPERLINK("http://evil.example","clic")', `"'=HYPERLINK(""http://evil.example"",""clic"")"`],
    ["+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"],
    ["@SUM(1+1)", "'@SUM(1+1)"],
    ["-2+3", "'-2+3"],
  ] as const) {
    assert.ok(cells(payload).split(";").includes(expected), `${payload} → ${cells(payload)}`);
  }
});

test("también se neutralizan tabulador y retorno de carro iniciales", () => {
  assert.ok(cells("\t=1+1").includes("'\t=1+1"));
  assert.ok(cells("\r=1+1").includes(`"'\r=1+1"`));
});

test("los nombres normales y los números (incluso negativos) NO se alteran", () => {
  assert.ok(cells("Juan Pérez").split(";").includes("Juan Pérez"));
  assert.ok(cells("María O'Brien-Smith").split(";").includes("María O'Brien-Smith"));
  assert.ok(cells("-5.00").split(";").includes("-5.00"));
});

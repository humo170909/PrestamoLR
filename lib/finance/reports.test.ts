import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_FILTERS, balancesReport, capitalReport, cashReport, closedReport, interestReport, loansReport, paymentsReport, toCsv,
  type ReportCash, type ReportInstallment, type ReportLoan, type ReportPayment,
} from "./reports.ts";

const TODAY = "2026-10-12";
const loan = (o: Partial<ReportLoan>): ReportLoan => ({
  id: "L1", code: "PR-0001", loan_type: "open", db_status: "active", client_id: "C1", full_name: "Ana Pérez", document_id: "11111111",
  principal: 1000, principal_outstanding: 800, capital_paid: 200, rate_pct: 15, frequency: "monthly", start_date: "2026-08-12", closed_on: null,
  interest_paid: 300, interest_pending: 0, interest_overdue: 0, capital_overdue: 0, days_overdue: 0, next_due_date: "2026-11-12",
  business_today: TODAY, total_paid: 500, ...o,
});
const pay = (o: Partial<ReportPayment>): ReportPayment => ({
  id: "P1", loan_id: "L1", receipt_no: 1, paid_on: "2026-09-12", amount: 150, interest_amount: 150, capital_amount: 0, method: "cash", status: "confirmed", ...o,
});

const L1 = loan({});
const L2 = loan({ id: "L2", code: "PR-0002", principal: 500, principal_outstanding: 500, capital_paid: 0, total_paid: 0, start_date: "2026-09-01" }); // mismo cliente
const payments = [
  pay({}),
  pay({ id: "P2", receipt_no: 2, paid_on: "2026-10-12", amount: 350, interest_amount: 150, capital_amount: 200 }),
  pay({ id: "P3", receipt_no: 3, paid_on: "2026-10-05", amount: 999, interest_amount: 999, capital_amount: 0, status: "reversed" }),
];

test("cobros: los revertidos se listan pero no suman en los totales efectivos", () => {
  const t = paymentsReport(payments, [L1, L2], EMPTY_FILTERS);
  assert.equal(t.rows.length, 3);
  assert.equal(t.totals?.amount, 500);
  assert.equal(t.totals?.interest, 300);
  assert.equal(t.totals?.capital, 200);
  assert.ok(t.rows.some((r) => r.status === "Revertido"));
});

test("filtro por fechas aplica a la fecha de cobro", () => {
  const t = paymentsReport(payments, [L1, L2], { ...EMPTY_FILTERS, from: "2026-10-01", to: "2026-10-31" });
  assert.equal(t.rows.length, 2);
  assert.equal(t.totals?.amount, 350);
});

test("sin datos: mensaje claro y sin totales ficticios", () => {
  const t = paymentsReport(payments, [L1, L2], { ...EMPTY_FILTERS, from: "2030-01-01" });
  assert.equal(t.rows.length, 0);
  assert.equal(t.totals, null);
  assert.match(t.empty, /No hay datos para el periodo seleccionado/);
  assert.equal(loansReport([], EMPTY_FILTERS).rows.length, 0);
});

test("capital recuperado: solo abonos de capital confirmados; dos préstamos del mismo cliente no se mezclan por préstamo", () => {
  const byLoan = capitalReport([L1, L2], payments, EMPTY_FILTERS, "loan");
  assert.equal(byLoan.rows.length, 2);
  assert.equal(byLoan.rows[0].period, 200);   // PR-0001: S/200 de capital; los intereses (150, 150) no cuentan
  assert.equal(byLoan.rows[1].period, 0);
  assert.equal(byLoan.totals?.principal, 1500);
  assert.equal(byLoan.totals?.recovered, 200);
  assert.equal(byLoan.rows[0].pct, 20);
  const byClient = capitalReport([L1, L2], payments, EMPTY_FILTERS, "client");
  assert.equal(byClient.rows.length, 1);       // agrupado por cliente: suma ambos préstamos
  assert.equal(byClient.rows[0].principal, 1500);
});

test("intereses: previstos ≠ cobrados, sin duplicar al consultar varias veces", () => {
  const inst: ReportInstallment[] = [
    { loan_id: "L1", n: 1, due_date: "2026-09-12", interest_due: 150, interest_paid: 150, capital_due: 0, capital_paid: 0 },
    { loan_id: "L1", n: 2, due_date: "2026-10-12", interest_due: 150, interest_paid: 100, capital_due: 0, capital_paid: 0 },
    { loan_id: "L1", n: 3, due_date: "2026-11-12", interest_due: 150, interest_paid: 0, capital_due: 0, capital_paid: 0 },
  ];
  const a = interestReport([L1], inst, EMPTY_FILTERS, "loan");
  const b = interestReport([L1], inst, EMPTY_FILTERS, "loan");
  assert.deepEqual(a, b);
  assert.equal(a.totals?.planned, 450);
  assert.equal(a.totals?.generated, 300);  // el período 3 aún no vence
  assert.equal(a.totals?.paid, 250);
  assert.equal(a.totals?.pending, 50);
  const periods = interestReport([L1], inst, EMPTY_FILTERS, "period");
  assert.deepEqual(periods.rows.map((r) => r.label), ["2026-09", "2026-10", "2026-11"]);
});

test("cancelados: solo préstamos pagados, con fecha de cancelación y totales", () => {
  const done = loan({ id: "L3", code: "PR-0003", db_status: "paid_off", closed_on: "2026-10-01", principal_outstanding: 0, capital_paid: 1000, total_paid: 1450 });
  const t = closedReport([L1, done], [pay({ id: "Q1", loan_id: "L3", amount: 1000, interest_amount: 0, capital_amount: 1000 }), pay({ id: "Q2", loan_id: "L3", receipt_no: 5, amount: 450, interest_amount: 450, capital_amount: 0 })], EMPTY_FILTERS);
  assert.equal(t.rows.length, 1);
  assert.equal(t.rows[0].closed, "2026-10-01");
  assert.equal(t.rows[0].capital, 1000);
  assert.equal(t.rows[0].interest, 450);
  assert.equal(t.totals?.paid, 1450);
});

test("saldos: desglose capital / intereses y préstamos pagados excluidos", () => {
  const late = loan({ id: "L4", code: "PR-0004", interest_pending: 150, interest_overdue: 150, days_overdue: 12, next_due_date: "2026-09-30", principal_outstanding: 1000 });
  const done = loan({ id: "L5", db_status: "paid_off", principal_outstanding: 0 });
  const t = balancesReport([L1, late, done], EMPTY_FILTERS);
  assert.equal(t.rows.length, 2);
  assert.equal(t.rows[0].code, "PR-0004");        // el más atrasado primero
  assert.equal(t.rows[0].total, 1150);
  assert.equal(t.rows[0].next, "Vencido");
});

test("caja: confirmados coinciden con caja; revertido neto cero; diferencia detectada", () => {
  const cash: ReportCash[] = [
    { payment_id: "P1", kind: "interest_income", direction: "in", amount: 150 },
    { payment_id: "P2", kind: "interest_income", direction: "in", amount: 150 },
    { payment_id: "P2", kind: "capital_recovery", direction: "in", amount: 200 },
    { payment_id: "P3", kind: "interest_income", direction: "in", amount: 999 },
    { payment_id: "P3", kind: "reversal", direction: "out", amount: 999 },
  ];
  const ok = cashReport(payments, [L1], cash, EMPTY_FILTERS);
  assert.ok(ok.rows.every((r) => r.check === "Coincide"));
  assert.equal(ok.totals?.paidInterest, ok.totals?.cashInterest);
  const bad = cashReport(payments, [L1], cash.filter((c) => c.payment_id !== "P2" || c.kind !== "capital_recovery"), EMPTY_FILTERS);
  assert.ok(bad.rows.some((r) => r.check === "Diferencia"));
});

test("CSV coincide con la tabla: filtros, fecha de generación, filas y totales", () => {
  const f = { ...EMPTY_FILTERS, from: "2026-10-01" };
  const t = paymentsReport(payments, [L1], f);
  const csv = toCsv(t, f, "12/10/2026 10:00");
  assert.match(csv, /Generado: 12\/10\/2026 10:00/);
  assert.match(csv, /Fechas: 2026-10-01 a hoy/);
  assert.equal(csv.split("\r\n").filter((l) => l.startsWith("R-")).length, t.rows.length);
  assert.match(csv, /350\.00;150\.00;200\.00/);  // fila de totales = pantalla
  assert.match(toCsv(paymentsReport([], [L1], f), f, "x"), /No hay datos para el periodo seleccionado/);
});

test("préstamos otorgados: datos reales y filtros por modalidad/cliente", () => {
  const t = loansReport([L1, L2], { ...EMPTY_FILTERS, client: "ana" });
  assert.equal(t.rows.length, 2);
  assert.equal(loansReport([L1, L2], { ...EMPTY_FILTERS, loanType: "fixed" }).rows.length, 0);
  assert.equal(t.totals?.principal, 1500);
});

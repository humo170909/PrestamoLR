// B-09: indicador "no hubo ejecución del cron hoy (Lima) pasadas las 09:00".
import { test } from "node:test";
import assert from "node:assert/strict";
import { cronMissingToday, limaDayStartUtc } from "./health.ts";

const at = (iso: string) => new Date(iso);   // las horas se dan en UTC; Lima = UTC-5

test("antes de las 09:00 de Lima nunca alerta (el cron de las 08:00 puede tardar)", () => {
  assert.equal(cronMissingToday(at("2026-10-13T13:59:00Z"), []), false);   // 08:59 Lima
});
test("desde las 09:00 de Lima sin ejecuciones del día: alerta", () => {
  assert.equal(cronMissingToday(at("2026-10-13T14:00:00Z"), []), true);    // 09:00 Lima
  assert.equal(cronMissingToday(at("2026-10-14T02:00:00Z"), []), true);    // 21:00 Lima del 13
});
test("una ejecución del día de Lima (aunque en UTC sea otro día) quita la alerta", () => {
  assert.equal(cronMissingToday(at("2026-10-13T15:00:00Z"), ["2026-10-13T13:00:05Z"]), false);
  assert.equal(cronMissingToday(at("2026-10-14T03:30:00Z"), ["2026-10-14T01:00:00Z"]), false);  // 20:00 Lima del 13
});
test("una ejecución de AYER (Lima) no cuenta para hoy", () => {
  assert.equal(cronMissingToday(at("2026-10-13T15:00:00Z"), ["2026-10-13T04:59:59Z"]), true);   // 23:59 Lima del 12
});
test("el inicio del día de Lima en UTC es 05:00Z", () => {
  assert.equal(limaDayStartUtc(at("2026-10-13T20:00:00Z")), "2026-10-13T05:00:00.000Z");
  assert.equal(limaDayStartUtc(at("2026-10-14T03:00:00Z")), "2026-10-13T05:00:00.000Z");
});

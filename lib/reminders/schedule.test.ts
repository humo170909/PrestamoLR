import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SCHEDULE, nextRun, parseCrons } from "./schedule.ts";

test("la programación efectiva sale de vercel.json (UTC) y equivale a 08:00 y 18:00 de Lima", () => {
  const vercel = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons: { path: string; schedule: string }[] };
  assert.equal(SCHEDULE.length, vercel.crons.length, "ningún cron queda sin interpretar");
  const morning = SCHEDULE.find((s) => s.job === "morning");
  const evening = SCHEDULE.find((s) => s.job === "evening");
  assert.equal(morning?.utcHour, 13); assert.equal(morning?.limaTime, "08:00");   // 13:00 UTC = 08:00 Lima (UTC-5)
  assert.equal(evening?.utcHour, 23); assert.equal(evening?.limaTime, "18:00");
});

test("cálculo de zona: Lima es UTC-5 sin cambio estacional (verano e invierno)", () => {
  const [a] = parseCrons([{ path: "/api/cron/reminders?job=morning", schedule: "0 13 * * *" }]);
  assert.equal(a.limaTime, "08:00");
  const [b] = parseCrons([{ path: "/api/cron/reminders?job=x", schedule: "30 3 * * *" }]);
  assert.equal(b.limaTime, "22:30");          // 03:30 UTC = 22:30 del día anterior en Lima
});

test("próxima ejecución desde la programación efectiva (hoy o mañana)", () => {
  assert.equal(nextRun(new Date("2026-10-12T10:00:00Z"))?.at.toISOString(), "2026-10-12T13:00:00.000Z");
  assert.equal(nextRun(new Date("2026-10-12T14:00:00Z"))?.at.toISOString(), "2026-10-12T23:00:00.000Z");
  assert.equal(nextRun(new Date("2026-10-12T23:30:00Z"))?.at.toISOString(), "2026-10-13T13:00:00.000Z");
});

test("si no se puede determinar la programación NO se inventa una fecha", () => {
  assert.deepEqual(parseCrons([{ path: "/api/cron/reminders?job=morning", schedule: "*/5 * * * *" }, { path: "/otra?job=x", schedule: "0 13 * * *" }]), []);
  assert.equal(nextRun(new Date("2026-10-12T10:00:00Z"), []), null);
});

test("cron horario: se interpreta y la próxima ejecución cae dentro del horario de envío (08:00–20:00 Lima)", () => {
  const sched = parseCrons([{ path: "/api/cron/reminders?job=hourly", schedule: "0 * * * *" }]);
  assert.equal(sched.length, 1); assert.equal(sched[0].utcHour, null);
  assert.equal(nextRun(new Date("2026-10-12T14:20:00Z"), sched)?.at.toISOString(), "2026-10-12T15:00:00.000Z");   // 10:00 Lima
  assert.equal(nextRun(new Date("2026-10-13T01:30:00Z"), sched)?.at.toISOString(), "2026-10-13T13:00:00.000Z");   // 20:30 Lima → mañana 08:00
});

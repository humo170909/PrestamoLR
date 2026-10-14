// M-08: la comprobación del CRON_SECRET (antes embebida en la ruta, sin pruebas: el mutante `return true` sobrevivía).
import { test } from "node:test";
import assert from "node:assert/strict";
import { isCronAuthorized } from "./cron-auth.ts";

const SECRET = "s3cr3t-".padEnd(48, "x");

test("acepta únicamente `Bearer <secreto>` exacto", () => {
  assert.equal(isCronAuthorized(`Bearer ${SECRET}`, SECRET), true);
});

test("rechaza sin cabecera, vacía, sin esquema o con otro esquema", () => {
  for (const h of [null, undefined, "", SECRET, `Basic ${SECRET}`, `bearer ${SECRET}`, `Bearer ${SECRET} `, ` Bearer ${SECRET}`]) {
    assert.equal(isCronAuthorized(h, SECRET), false, JSON.stringify(h));
  }
});

test("rechaza un secreto incorrecto del mismo largo y de largo distinto", () => {
  assert.equal(isCronAuthorized(`Bearer ${"y".repeat(SECRET.length)}`, SECRET), false);
  assert.equal(isCronAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET), false);
  assert.equal(isCronAuthorized(`Bearer ${SECRET}x`, SECRET), false);
});

test("sin secreto configurado NADIE está autorizado (ni siquiera `Bearer undefined` o `Bearer `)", () => {
  for (const secret of [undefined, ""]) {
    for (const h of ["Bearer ", "Bearer undefined", "Bearer", "", null]) assert.equal(isCronAuthorized(h, secret), false, JSON.stringify([h, secret]));
  }
});

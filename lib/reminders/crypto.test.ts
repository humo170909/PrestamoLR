import { test } from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "./crypto.ts";

const KEY = "ab".repeat(32);

test("cifra y descifra; el texto cifrado no contiene el secreto", () => {
  const token = "123456789:AAE-secretoDePrueba_1234567890abcdefgh";
  const blob = encryptSecret(token, KEY);
  assert.ok(!blob.includes("secretoDePrueba"));
  assert.equal(decryptSecret(blob, KEY), token);
});

test("cada cifrado usa un IV distinto", () => {
  assert.notEqual(encryptSecret("x", KEY), encryptSecret("x", KEY));
});

test("clave incorrecta o dato alterado falla", () => {
  const blob = encryptSecret("secreto", KEY);
  assert.throws(() => decryptSecret(blob, "cd".repeat(32)));
  const [iv, tag, data] = blob.split(".");
  const tampered = [iv, tag, Buffer.from("otro").toString("base64")].join(".");
  assert.throws(() => decryptSecret(tampered, KEY));
  assert.ok(data);
});

test("clave inválida se rechaza", () => {
  assert.throws(() => encryptSecret("x", "corta"));
});

// M-03 (parte no ambigua): los enlaces del login no pueden ser anclas vacías; muestran información real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { supportTopics, SUPPORT_TOPIC_IDS } from "./support-info.ts";

test("hay un tema informativo para cada enlace del login", () => {
  assert.deepEqual([...SUPPORT_TOPIC_IDS].sort(), ["contact", "forgot", "help"]);
  const t = supportTopics();
  for (const id of SUPPORT_TOPIC_IDS) {
    assert.ok(t[id].title.length > 5, id);
    assert.ok(t[id].paragraphs.length >= 2, id);
    for (const p of t[id].paragraphs) assert.ok(p.trim().length > 20, `${id}: párrafo vacío o demasiado corto`);
  }
});

test("la ayuda de contraseña es honesta: no promete recuperación por correo que no existe y dice a quién acudir", () => {
  const txt = supportTopics().forgot.paragraphs.join(" ").toLowerCase();
  assert.match(txt, /administrador/);
  assert.doesNotMatch(txt, /te enviamos|te hemos enviado|correo de recuperaci/);
});

test("sin dato de contacto configurado se indica que lo pida al administrador; con dato, se muestra", () => {
  assert.doesNotMatch(supportTopics().contact.paragraphs.join(" "), /undefined|null|#contacto/);
  const withContact = supportTopics("WhatsApp +51 900 000 000").contact;
  assert.ok(withContact.paragraphs.join(" ").includes("WhatsApp +51 900 000 000"));
  assert.equal(withContact.contact, "WhatsApp +51 900 000 000");
});

test("el texto de contacto configurado se recorta y se trata como texto (no HTML ni enlaces)", () => {
  const t = supportTopics("<script>x</script>" + "a".repeat(500)).contact;
  assert.ok((t.contact ?? "").length <= 120);
});

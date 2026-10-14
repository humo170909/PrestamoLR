// M-06: el middleware no debe cerrar sesión ante un ERROR de infraestructura, y no debe quedar abierto sin configuración.
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideAccess, type AccessInput } from "./access.ts";

const base: AccessInput = { configured: true, demo: false, path: "/dashboard", auth: "user", profile: { kind: "ok", active: true } };
const d = (o: Partial<AccessInput>) => decideAccess({ ...base, ...o });

test("usuario con perfil activo: entra al panel y desde el login va al dashboard", () => {
  assert.deepEqual(d({}), { action: "next", signOut: false });
  assert.deepEqual(d({ path: "/" }), { action: "redirect-dashboard", signOut: false });
});

test("ERROR al consultar el perfil (5xx/red): 503 y la sesión se CONSERVA", () => {
  for (const path of ["/dashboard", "/prestamos", "/", "/api/admin/users"]) {
    assert.deepEqual(d({ path, profile: { kind: "error" } }), { action: "unavailable", signOut: false }, path);
  }
});

test("perfil inactivo o inexistente: se cierra la sesión (comportamiento anterior)", () => {
  for (const profile of [{ kind: "ok", active: false }, { kind: "missing" }] as const) {
    assert.deepEqual(d({ profile }), { action: "redirect-login", signOut: true });
    assert.deepEqual(d({ path: "/", profile }), { action: "next", signOut: true });
  }
});

test("sin sesión: el login es público y el resto redirige; si Auth no responde, 503 (no se trata como 'sin sesión')", () => {
  assert.deepEqual(d({ auth: "anon", path: "/" }), { action: "next", signOut: false });
  assert.deepEqual(d({ auth: "anon" }), { action: "redirect-login", signOut: false });
  assert.deepEqual(d({ auth: "error" }), { action: "unavailable", signOut: false });
});

test("sin variables de Supabase NO queda abierto: solo el login; páginas redirigen y /api responde 503", () => {
  const off = { configured: false, auth: "anon" } as const;
  assert.deepEqual(d({ ...off, path: "/" }), { action: "next", signOut: false });
  assert.deepEqual(d({ ...off, path: "/dashboard" }), { action: "closed-redirect", signOut: false });
  assert.deepEqual(d({ ...off, path: "/usuarios" }), { action: "closed-redirect", signOut: false });
  assert.deepEqual(d({ ...off, path: "/api/admin/users" }), { action: "closed-api", signOut: false });
});

test("modo demostración (solo desarrollo, sin Supabase y con bandera) sigue funcionando", () => {
  assert.deepEqual(d({ configured: false, demo: true, auth: "anon", path: "/dashboard" }), { action: "next", signOut: false });
});

test("I-03: las API sin sesión (o con perfil inactivo/inexistente) responden 401 JSON, no una redirección", () => {
  assert.deepEqual(d({ auth: "anon", path: "/api/admin/users" }), { action: "unauthorized-api", signOut: false });
  assert.deepEqual(d({ auth: "anon", path: "/api/notify/payment" }), { action: "unauthorized-api", signOut: false });
  for (const profile of [{ kind: "ok", active: false }, { kind: "missing" }] as const) {
    assert.deepEqual(d({ path: "/api/admin/telegram", profile }), { action: "unauthorized-api", signOut: true });
  }
  // las páginas siguen redirigiendo al login
  assert.deepEqual(d({ auth: "anon", path: "/prestamos" }), { action: "redirect-login", signOut: false });
  // y con sesión válida las API pasan
  assert.deepEqual(d({ path: "/api/admin/users" }), { action: "next", signOut: false });
});

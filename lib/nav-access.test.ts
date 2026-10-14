// B-04: el menú solo muestra lo que cada rol puede usar. La protección REAL sigue siendo RLS y las funciones de la base de datos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SECTION_IDS, visibleSections, canSeeSection } from "./nav-access.ts";

test("el administrador ve las 13 secciones", () => {
  assert.equal(SECTION_IDS.length, 13);
  assert.deepEqual(visibleSections("admin"), SECTION_IDS);
});

test("el asesor no ve Trabajadores, Auditoría, Usuarios ni Configuración, pero sí crea préstamos y clientes", () => {
  const v = visibleSections("advisor");
  for (const hidden of ["trabajadores", "auditoria", "usuarios", "configuracion"]) assert.ok(!v.includes(hidden), hidden);
  for (const shown of ["dashboard", "nuevo-prestamo", "prestamos", "registro-pagos", "clientes", "caja", "reportes"]) assert.ok(v.includes(shown), shown);
});

test("el cobrador no ve Nuevo préstamo, Trabajadores, Auditoría, Usuarios ni Configuración, pero sí cobra y consulta lo suyo", () => {
  const v = visibleSections("collector");
  for (const hidden of ["nuevo-prestamo", "trabajadores", "auditoria", "usuarios", "configuracion"]) assert.ok(!v.includes(hidden), hidden);
  for (const shown of ["dashboard", "prestamos", "simulador", "registro-pagos", "morosidad", "clientes", "caja", "reportes"]) assert.ok(v.includes(shown), shown);
});

test("toda sección existente aparece para al menos un rol y el administrador nunca pierde ninguna", () => {
  for (const id of SECTION_IDS) assert.ok(canSeeSection(id, "admin"), id);
});

test("un rol desconocido o ausente no ve nada (por defecto, sin acceso)", () => {
  assert.deepEqual(visibleSections("otro" as never), []);
  assert.deepEqual(visibleSections(undefined as never), []);
  assert.equal(canSeeSection("dashboard", "otro" as never), false);
});

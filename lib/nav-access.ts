/**
 * Qué secciones del menú ve cada rol (solo interfaz; módulo puro). NO es una barrera de seguridad: el acceso real lo deciden
 * RLS y las funciones de la base de datos. Ocultar entradas evita que cada usuario vea opciones que la base rechazaría.
 */
export type RoleKey = "admin" | "advisor" | "collector";

const ALL: RoleKey[] = ["admin", "advisor", "collector"];
const STAFF: RoleKey[] = ["admin", "advisor"];

/** Orden = orden del menú. Un rol ausente de la lista no ve la sección en el menú. */
export const SECTION_ROLES: Record<string, RoleKey[]> = {
  dashboard: ALL,
  "nuevo-prestamo": STAFF,          // create_loan exige admin o asesor
  prestamos: ALL,                   // el cobrador ve solo los suyos (RLS)
  simulador: ALL,
  "registro-pagos": ALL,
  morosidad: ALL,
  clientes: ALL,                    // el cobrador ve solo los suyos y no edita
  caja: ALL,                        // el cobrador ve solo su caja (RLS)
  trabajadores: ["admin"],          // worker_stats completo solo lo ve el administrador
  reportes: ALL,
  auditoria: ["admin"],
  usuarios: ["admin"],
  configuracion: ["admin"],
};

export const SECTION_IDS = Object.keys(SECTION_ROLES);

export const canSeeSection = (id: string, role: RoleKey): boolean => !!SECTION_ROLES[id]?.includes(role);

export const visibleSections = (role: RoleKey): string[] => SECTION_IDS.filter((id) => canSeeSection(id, role));

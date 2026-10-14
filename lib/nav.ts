import {
  BarChart3, Calculator, FilePlus2, LayoutDashboard, ListChecks, Receipt, Route,
  ScrollText, Settings, ShieldCheck, TriangleAlert, Users, Wallet, type LucideIcon,
} from "lucide-react";
import { canSeeSection, type RoleKey } from "./nav-access";

export interface NavItem { id: string; label: string; icon: LucideIcon }
export interface NavGroup { group: string; items: NavItem[] }

export const NAV: NavGroup[] = [
  { group: "Principal", items: [{ id: "dashboard", label: "Dashboard", icon: LayoutDashboard }] },
  {
    group: "Préstamos",
    items: [
      { id: "nuevo-prestamo", label: "Nuevo préstamo", icon: FilePlus2 },
      { id: "prestamos", label: "Lista de préstamos", icon: ListChecks },
      { id: "simulador", label: "Simulador", icon: Calculator },
    ],
  },
  {
    group: "Cobranzas",
    items: [
      { id: "registro-pagos", label: "Registro de pagos", icon: Receipt },
      { id: "morosidad", label: "Gestión de morosidad", icon: TriangleAlert },
    ],
  },
  {
    group: "Gestión y finanzas",
    items: [
      { id: "clientes", label: "Clientes", icon: Users },
      { id: "caja", label: "Caja y flujos", icon: Wallet },
      { id: "trabajadores", label: "Trabajadores / Cobradores", icon: Route },
      { id: "reportes", label: "Reportes", icon: BarChart3 },
    ],
  },
  {
    group: "Control y sistema",
    items: [
      { id: "auditoria", label: "Auditoría", icon: ScrollText },
      { id: "usuarios", label: "Usuarios y permisos", icon: ShieldCheck },
      { id: "configuracion", label: "Configuración", icon: Settings },
    ],
  },
];

/** Menú filtrado por rol (ver lib/nav-access.ts); los grupos que quedan vacíos se omiten. */
export const navFor = (role: RoleKey): NavGroup[] =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => canSeeSection(i.id, role)) })).filter((g) => g.items.length > 0);

export const NAV_IDS = NAV.flatMap((g) => g.items.map((i) => i.id));
export const hrefOf = (id: string) => `/${id}`;

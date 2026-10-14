"use client";

import { useState } from "react";
import { notFound } from "next/navigation";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, Clock, Percent, Scale, Users, Wallet, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { money } from "@/lib/format";
import { NAV } from "@/lib/nav";
import * as M from "@/lib/mock";
import { BarCard, type Serie } from "./charts";
import { DataTable, type Column } from "./DataTable";
import { LoanCalculator } from "./LoanCalculator";
import { LiveClients } from "./LiveViews";
import { LoanBoard } from "./LoanBoard";
import { LivePayments } from "./LivePayments";
import { LiveCash } from "./LiveCash";
import { LiveMora } from "./LiveDashboard";
import { LiveSettings } from "./LiveSettings";
import { LiveAudit, LiveUsers, LiveWorkers } from "./LiveAdmin";
import { ReportsView } from "./ReportsView";
import { DemoBanner, PendingState, isDemoData } from "./DataSourceNotice";
import { Card, CardHeader, KpiCard, PageHeader, Reveal, fieldClass } from "./ui";

interface Def {
  desc: string;
  kpis?: { label: string; value: string; hint?: string; icon: LucideIcon }[];
  chart?: { title: string; data: Record<string, string | number>[]; xKey: string; series: Serie[] };
  table?: { title: string; columns: Column[]; rows: M.Row[] };
}

const c1 = "var(--chart-1)";
const c3 = "var(--chart-3)";

const DEFS: Record<string, Def> = {
  prestamos: {
    desc: "Control y detalle de los créditos otorgados: vigentes, cancelados o en mora.",
    kpis: [
      { label: "Vigentes", value: "128", icon: CheckCircle2, hint: "préstamos activos" },
      { label: "En mora", value: "19", icon: Clock, hint: "requieren seguimiento" },
      { label: "Cancelados (mes)", value: "14", icon: Scale },
    ],
    table: {
      title: "Préstamos",
      columns: [
        { key: "id", label: "N.º" }, { key: "client", label: "Cliente" },
        { key: "amount", label: "Monto", kind: "money", align: "right" }, { key: "rate", label: "Tasa", kind: "muted" },
        { key: "term", label: "Plazo", kind: "muted" }, { key: "balance", label: "Capital pendiente", kind: "money", align: "right" },
        { key: "next", label: "Próx. venc.", kind: "muted" }, { key: "estado", label: "Estado", kind: "status" },
      ],
      rows: M.LOANS,
    },
  },
  "registro-pagos": {
    desc: "Cada pago se imputa por separado a intereses, capital o mora; un pago de solo intereses nunca reduce el capital pendiente.",
    kpis: [
      { label: "Cobrado hoy", value: money(2140), icon: Wallet },
      { label: "Recibos emitidos", value: "23", icon: CheckCircle2, hint: "en lo que va del día" },
      { label: "Multas aplicadas", value: money(210), icon: Percent },
    ],
    table: {
      title: "Pagos recientes",
      columns: [
        { key: "recibo", label: "Recibo" }, { key: "fecha", label: "Fecha", kind: "muted" }, { key: "client", label: "Cliente" },
        { key: "prestamo", label: "Préstamo", kind: "muted" }, { key: "capital", label: "Capital", kind: "money", align: "right" },
        { key: "interes", label: "Interés", kind: "money", align: "right" }, { key: "multa", label: "Multa", kind: "money", align: "right" },
        { key: "metodo", label: "Método", kind: "muted" },
      ],
      rows: M.PAYMENTS,
    },
  },
  morosidad: {
    desc: "Seguimiento exclusivo de clientes con cuotas atrasadas.",
    kpis: [
      { label: "Clientes en mora", value: "95", icon: Users },
      { label: "Deuda en mora", value: money(37540), icon: Wallet },
      { label: "Índice de morosidad", value: "7,8%", icon: Percent },
    ],
    table: {
      title: "Clientes con cuotas atrasadas",
      columns: [
        { key: "client", label: "Cliente" }, { key: "dni", label: "DNI", kind: "muted" },
        { key: "cuotas", label: "Cuotas", kind: "num", align: "right" }, { key: "dias", label: "Días", kind: "num", align: "right" },
        { key: "deuda", label: "Deuda", kind: "money", align: "right" }, { key: "cobrador", label: "Cobrador", kind: "muted" },
        { key: "phone", label: "Teléfono", kind: "muted" },
      ],
      rows: M.MORA,
    },
  },
  clientes: {
    desc: "Administración de prestatarios y su historial crediticio interno.",
    kpis: [
      { label: "Clientes totales", value: "412", icon: Users },
      { label: "Activos", value: "287", icon: CheckCircle2 },
      { label: "Nuevos (mes)", value: "21", icon: ArrowUpRight },
    ],
    table: {
      title: "Clientes",
      columns: [
        { key: "name", label: "Nombre" }, { key: "dni", label: "DNI", kind: "muted" }, { key: "phone", label: "Teléfono", kind: "muted" },
        { key: "loans", label: "Préstamos", kind: "num", align: "right" }, { key: "saldo", label: "Saldo", kind: "money", align: "right" },
        { key: "historial", label: "Historial", kind: "status" }, { key: "estado", label: "Estado", kind: "status" },
      ],
      rows: M.CLIENTS,
    },
  },
  caja: {
    desc: "Cuadre diario: cobros de intereses, devoluciones de capital, desembolsos y otros movimientos autorizados.",
    kpis: [
      { label: "Entradas hoy", value: money(1585), icon: ArrowDownLeft },
      { label: "Salidas hoy", value: money(3120), icon: ArrowUpRight },
      { label: "Saldo de caja", value: money(8460), icon: Wallet },
    ],
    chart: {
      title: "Flujo de la semana", data: M.CASH_WEEK, xKey: "dia",
      series: [{ key: "entradas", label: "Entradas", color: c3 }, { key: "salidas", label: "Salidas", color: c1 }],
    },
    table: {
      title: "Movimientos de hoy",
      columns: [
        { key: "hora", label: "Hora", kind: "muted" }, { key: "concepto", label: "Concepto" },
        { key: "tipo", label: "Tipo", kind: "status" }, { key: "monto", label: "Monto", kind: "money", align: "right" },
      ],
      rows: M.CASH,
    },
  },
  trabajadores: {
    desc: "Gestión de personal y asignación de rutas de cobranza.",
    kpis: [
      { label: "Personal activo", value: "9", icon: Users },
      { label: "Rutas", value: "5", icon: Scale },
      { label: "Recaudo del mes", value: money(57350), icon: Wallet },
    ],
    table: {
      title: "Equipo",
      columns: [
        { key: "name", label: "Nombre" }, { key: "rol", label: "Rol", kind: "muted" }, { key: "ruta", label: "Ruta asignada", kind: "muted" },
        { key: "clientes", label: "Clientes", kind: "num", align: "right" }, { key: "recaudo", label: "Recaudo", kind: "money", align: "right" },
        { key: "estado", label: "Estado", kind: "status" },
      ],
      rows: M.WORKERS,
    },
  },
  reportes: {
    desc: "Capital desembolsado, recuperado y pendiente; intereses cobrados, pendientes y vencidos; mora y rendimiento por cobrador.",
    kpis: [
      { label: "Intereses cobrados", value: money(16200), icon: Percent, hint: "septiembre" },
      { label: "Capital pendiente", value: money(482350), icon: Wallet },
      { label: "Mora", value: "7,8%", icon: Clock },
    ],
    chart: {
      title: "Rendimiento por cobrador", data: M.COLLECTOR_PERF, xKey: "cobrador",
      series: [{ key: "meta", label: "Meta", color: c1 }, { key: "recaudo", label: "Recaudo", color: c3 }],
    },
  },
  auditoria: {
    desc: "Registro histórico de quién hizo qué en el sistema: pagos, anulaciones y más.",
    table: {
      title: "Actividad del sistema",
      columns: [
        { key: "fecha", label: "Fecha", kind: "muted" }, { key: "usuario", label: "Usuario" }, { key: "accion", label: "Acción" },
        { key: "modulo", label: "Módulo", kind: "muted" }, { key: "detalle", label: "Detalle", kind: "muted" },
      ],
      rows: M.AUDIT,
    },
  },
  usuarios: {
    desc: "Control de acceso según el rol: administrador, asesor o cobrador de ruta.",
    table: {
      title: "Usuarios",
      columns: [
        { key: "name", label: "Nombre" }, { key: "email", label: "Correo", kind: "muted" }, { key: "rol", label: "Rol" },
        { key: "acceso", label: "Último acceso", kind: "muted" }, { key: "estado", label: "Estado", kind: "status" },
      ],
      rows: M.USER_ROWS,
    },
  },
};

function Settings() {
  const [ok, setOk] = useState(false);
  const F = ({ l, v, t = "text" }: { l: string; v: string; t?: string }) => (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-muted-foreground">{l}</span>
      <input type={t} defaultValue={v} onChange={() => setOk(false)} className={fieldClass} />
    </label>
  );
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="space-y-4">
        <CardHeader title="Datos del negocio" />
        <F l="Razón social" v="LRomero Préstamos y Soluciones" />
        <F l="RUC" v="20601234567" />
        <F l="Dirección" v="Av. Principal 123, Lima" />
        <label className="block">
          <span className="mb-1.5 block text-[13px] text-muted-foreground">Moneda</span>
          <select className={fieldClass} defaultValue="PEN"><option value="PEN">Sol peruano (S/)</option><option value="USD">Dólar (US$)</option></select>
        </label>
      </Card>
      <Card className="space-y-4">
        <CardHeader title="Reglas de crédito" />
        <F l="Tasa de interés mensual por defecto (%)" v="4.5" t="number" />
        <F l="Multa por mora (% sobre la cuota)" v="2" t="number" />
        <F l="Días de gracia" v="2" t="number" />
        <Button type="button" onClick={() => setOk(true)} className="h-12 w-full rounded-xl bg-mint-400 font-semibold text-primary-foreground transition-all duration-200 ease-out-expo hover:-translate-y-0.5 hover:bg-mint-500 active:scale-[0.97]">
          Guardar cambios
        </Button>
        <div aria-live="polite">{ok && <p className="flex items-center gap-2 text-[13px] text-mint-600"><CheckCircle2 className="size-4" /> Guardado aún no disponible: se conectará a Supabase (los valores no se persisten).</p>}</div>
      </Card>
    </div>
  );
}

export function SectionView({ id }: { id: string }) {
  if (id === "simulador") return <LoanCalculator mode="sim" />;
  if (id === "nuevo-prestamo") return <LoanCalculator mode="new" />;
  const label = NAV.flatMap((g) => g.items).find((i) => i.id === id)?.label;
  if (!label) notFound();
  const def = DEFS[id];
  return (
    <>
      <Reveal><PageHeader title={label} desc={def?.desc ?? "Reglas de tasas, multas por mora, moneda y datos del negocio."} /></Reveal>
      {id !== "configuracion" && isDemoData && <DemoBanner />}
      {id === "configuracion" && !isDemoData ? (
        <LiveSettings />
      ) : id === "configuracion" ? (
        <Settings />
      ) : !isDemoData && id === "clientes" ? (
        <LiveClients />
      ) : !isDemoData && id === "registro-pagos" ? (
        <LivePayments />
      ) : !isDemoData && id === "caja" ? (
        <LiveCash />
      ) : !isDemoData && id === "morosidad" ? (
        <LiveMora />
      ) : !isDemoData && id === "reportes" ? (
        <ReportsView />
      ) : !isDemoData && id === "auditoria" ? (
        <LiveAudit />
      ) : !isDemoData && id === "usuarios" ? (
        <LiveUsers />
      ) : !isDemoData && id === "trabajadores" ? (
        <LiveWorkers />
      ) : !isDemoData && id === "prestamos" ? (
        <LoanBoard />
      ) : !isDemoData ? (
        <PendingState module={label} />
      ) : (
        def && (
          <div className="space-y-4">
            {def.kpis && (
              <div className="grid gap-4 sm:grid-cols-3">
                {def.kpis.map((k, i) => <Reveal key={k.label} i={i + 1}><KpiCard {...k} /></Reveal>)}
              </div>
            )}
            {def.chart && <Reveal i={4}><BarCard {...def.chart} height={260} /></Reveal>}
            {def.table && <Reveal i={5}><DataTable {...def.table} /></Reveal>}
          </div>
        )
      )}
    </>
  );
}

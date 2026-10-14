"use client";

import { AlertTriangle, Banknote, CalendarCheck, Landmark } from "lucide-react";
import { MONTHLY, MORA_TRAMOS, TODAY_DUES } from "@/lib/mock";
import { money } from "@/lib/format";
import { SEDES } from "@/lib/mock";
import { AreaCard, BarCard, DonutCard } from "./charts";
import { DataTable } from "./DataTable";
import { usePanel } from "./PanelContext";
import { DemoBanner, isDemoData } from "./DataSourceNotice";
import { LiveDashboard } from "./LiveDashboard";
import { KpiCard, PageHeader, Reveal } from "./ui";

export function DashboardView() {
  const { sede, user } = usePanel();
  const f = SEDES.find((s) => s.id === sede)?.f ?? 1;
  const scale = (n: number) => Math.round(n * f);
  const monthly = MONTHLY.map((m) => ({ ...m, desembolsado: scale(m.desembolsado), cobrado: scale(m.cobrado), intereses: scale(m.intereses) }));
  const dues = TODAY_DUES.map((d) => ({ ...d, monto: scale(Number(d.monto)) || d.monto }));

  if (!isDemoData) {
    return (
      <>
        <PageHeader title={`Hola, ${user.name.split(" ")[0]}`} desc="Resumen de tu cartera: capital, intereses, vencimientos y morosidad." />
        <LiveDashboard />
      </>
    );
  }

  return (
    <>
      <DemoBanner />
      <Reveal>
        <PageHeader title={`Hola, ${user.name.split(" ")[0]}`} desc="Resumen de tu cartera: capital en la calle, intereses, cobranza del día y morosidad." />
      </Reveal>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Reveal i={1}><KpiCard label="Capital pendiente" value={money(scale(482350))} icon={Landmark} delta={6.4} hint="vs. mes anterior" /></Reveal>
        <Reveal i={2}><KpiCard label="Intereses cobrados" value={money(scale(68420))} icon={Banknote} delta={11.2} hint="acumulado del año" /></Reveal>
        <Reveal i={3}><KpiCard label="Cuotas a cobrar hoy" value={String(Math.max(1, scale(38)))} icon={CalendarCheck} hint={`${money(scale(14860))} por recaudar`} /></Reveal>
        <Reveal i={4}><KpiCard label="Morosidad" value="7,8%" icon={AlertTriangle} delta={-1.3} hint="cartera en mora" /></Reveal>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Reveal i={5} className="xl:col-span-2">
          <BarCard
            title="Desembolsos y cobranza"
            desc="Últimos 6 meses"
            data={monthly}
            xKey="mes"
            series={[
              { key: "desembolsado", label: "Desembolsado", color: "var(--chart-1)" },
              { key: "cobrado", label: "Cobrado", color: "var(--chart-3)" },
            ]}
          />
        </Reveal>
        <Reveal i={6}>
          <DonutCard title="Niveles de morosidad" desc="Clientes por días de atraso" data={MORA_TRAMOS} centerValue="95" centerLabel="clientes en mora" />
        </Reveal>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-5">
        <Reveal i={7} className="xl:col-span-2">
          <AreaCard title="Intereses cobrados" desc="Evolución mensual (no incluye capital recuperado)" data={monthly} xKey="mes" dataKey="intereses" label="Intereses" />
        </Reveal>
        <Reveal i={8} className="xl:col-span-3">
          <DataTable
            title="Cuotas a cobrar hoy"
            desc="Seguimiento de la ruta del día"
            searchable={false}
            pageSize={6}
            rows={dues}
            columns={[
              { key: "cliente", label: "Cliente" },
              { key: "prestamo", label: "Préstamo", kind: "muted" },
              { key: "cuota", label: "Cuota", kind: "muted" },
              { key: "monto", label: "Monto", kind: "money", align: "right" },
              { key: "estado", label: "Estado", kind: "status" },
            ]}
          />
        </Reveal>
      </div>
    </>
  );
}

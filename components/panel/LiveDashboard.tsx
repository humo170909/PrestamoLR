"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Banknote, CalendarCheck, Clock, Landmark, Percent, Users, Wallet } from "lucide-react";
import { moneyDec } from "@/lib/format";
import {
  fetchDueToday, fetchMonthlyCash, fetchPortfolio, moraBuckets, sumBy,
  type DueToday, type PortfolioRow,
} from "@/lib/data/portfolio";
import { BarCard, DonutCard } from "./charts";
import { DataTable } from "./DataTable";
import { Card, KpiCard, Reveal } from "./ui";

type Monthly = Awaited<ReturnType<typeof fetchMonthlyCash>>;

function usePortfolio() {
  const [rows, setRows] = useState<PortfolioRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { fetchPortfolio().then(setRows).catch(() => setError(true)); }, []);
  return { rows, error };
}

const Msg = ({ children }: { children: React.ReactNode }) => (
  <Card><p className="py-6 text-center text-[13px] text-muted-foreground">{children}</p></Card>
);

const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1).replace(".", ",")}%` : "0%");

export function LiveDashboard() {
  const { rows, error } = usePortfolio();
  const [due, setDue] = useState<DueToday[]>([]);
  const [monthly, setMonthly] = useState<Monthly>([]);
  useEffect(() => {
    fetchDueToday().then(setDue).catch(() => undefined);
    fetchMonthlyCash().then(setMonthly).catch(() => undefined);
  }, []);

  if (error) return <Msg>No se pudo cargar la cartera.</Msg>;
  if (!rows) return <Msg>Cargando cartera…</Msg>;
  if (rows.length === 0) return <Msg>Aún no hay préstamos vigentes. Registra el primero en “Nuevo préstamo”.</Msg>;

  const outstanding = sumBy(rows, (r) => r.principal_outstanding);
  const interestPaid = sumBy(rows, (r) => r.interest_paid);
  const interestPending = sumBy(rows, (r) => r.interest_pending);
  const late = rows.filter((r) => r.days_overdue > 0);
  const lateCapital = sumBy(late, (r) => r.principal_outstanding);
  const dueAmount = sumBy(due, (r) => r.interest_due - r.interest_paid);

  return (
    <>
      <div className="grid gap-3 min-[420px]:grid-cols-2 sm:gap-4 xl:grid-cols-4">
        <Reveal i={1}><KpiCard label="Capital pendiente" value={moneyDec(outstanding)} icon={Landmark} hint="en la calle" /></Reveal>
        <Reveal i={2}><KpiCard label="Intereses cobrados" value={moneyDec(interestPaid)} icon={Banknote} hint={`Pendiente exigible: ${moneyDec(interestPending)}`} /></Reveal>
        <Reveal i={3}><KpiCard label="Vencen hoy" value={String(due.length)} icon={CalendarCheck} hint={`${moneyDec(dueAmount)} en intereses`} /></Reveal>
        <Reveal i={4}><KpiCard label="Morosidad" value={pct(lateCapital, outstanding)} icon={AlertTriangle} hint={`${late.length} préstamo(s) con atraso`} /></Reveal>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <Reveal i={5} className="xl:col-span-2">
          <BarCard
            title="Caja por mes"
            desc="Desembolsos frente a lo cobrado (intereses y capital por separado)"
            data={monthly} xKey="mes"
            series={[
              { key: "desembolsado", label: "Desembolsado", color: "var(--chart-1)" },
              { key: "intereses", label: "Intereses", color: "var(--chart-3)" },
              { key: "capital", label: "Capital recuperado", color: "var(--chart-2)" },
            ]}
          />
        </Reveal>
        <Reveal i={6}>
          <DonutCard title="Niveles de morosidad" desc="Préstamos por días de atraso" data={moraBuckets(rows)} centerValue={String(late.length)} centerLabel="en mora" />
        </Reveal>
      </div>

      <Reveal i={7} className="mt-4">
        {due.length === 0 ? <Msg>No hay vencimientos pendientes para hoy.</Msg> : (
          <DataTable
            title="Intereses que vencen hoy" searchable={false} pageSize={6}
            columns={[
              { key: "cliente", label: "Cliente" }, { key: "prestamo", label: "Préstamo", kind: "muted" },
              { key: "cuota", label: "Cuota", kind: "muted" }, { key: "monto", label: "Pendiente", kind: "money", align: "right" },
            ]}
            rows={due.map((d) => ({
              cliente: d.loans?.clients?.full_name ?? "—", prestamo: d.loans?.code ?? "—", cuota: `N.º ${d.n}`,
              monto: Math.round((d.interest_due - d.interest_paid) * 100) / 100,
            }))}
          />
        )}
      </Reveal>
    </>
  );
}

export function LiveMora() {
  const { rows, error } = usePortfolio();
  if (error) return <Msg>No se pudo cargar la morosidad.</Msg>;
  if (!rows) return <Msg>Cargando…</Msg>;

  const late = rows.filter((r) => r.days_overdue > 0).sort((a, b) => b.days_overdue - a.days_overdue);
  const outstanding = sumBy(rows, (r) => r.principal_outstanding);
  const exigible = sumBy(late, (r) => r.interest_overdue + r.capital_overdue);
  const lateCapital = sumBy(late, (r) => r.principal_outstanding);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard label="Préstamos en mora" value={String(late.length)} icon={Users} />
        <KpiCard label="Total exigible" value={moneyDec(exigible)} icon={Wallet} hint="intereses vencidos + capital vencido" />
        <KpiCard label="Índice de morosidad" value={pct(lateCapital, outstanding)} icon={Percent} hint="capital en mora / capital pendiente" />
      </div>
      {late.length === 0 ? <Msg><Clock className="mx-auto mb-2 size-5" />No hay préstamos con atraso.</Msg> : (
        <DataTable
          title="Préstamos con atraso"
          columns={[
            { key: "client", label: "Cliente" }, { key: "dni", label: "DNI", kind: "muted" }, { key: "loan", label: "Préstamo", kind: "muted" },
            { key: "dias", label: "Días", kind: "num", align: "right" },
            { key: "interes", label: "Intereses vencidos", kind: "money", align: "right" },
            { key: "capital", label: "Capital vencido", kind: "money", align: "right" },
            { key: "total", label: "Exigible", kind: "money", align: "right" },
            { key: "phone", label: "Teléfono", kind: "muted" },
          ]}
          rows={late.map((r) => ({
            client: r.full_name, dni: r.document_id, loan: r.code, dias: r.days_overdue,
            interes: r.interest_overdue, capital: r.capital_overdue, total: Math.round((r.interest_overdue + r.capital_overdue) * 100) / 100,
            phone: r.phone ?? "—",
          }))}
        />
      )}
    </div>
  );
}

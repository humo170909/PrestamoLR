"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { moneyDec } from "@/lib/format";
import { fetchReportData, type ReportData } from "@/lib/data/reports";
import {
  EMPTY_FILTERS, METHOD_LABEL, balancesReport, capitalReport, cashReport, cellText, closedReport, describeFilters, interestReport,
  loansReport, paymentsReport, toCsv, type Filters, type GroupBy, type InterestGroup, type ReportTable,
} from "@/lib/finance/reports";
import { LOAN_TYPE_LABEL } from "@/lib/finance/loan-rules";
import { Card, CardHeader, fieldClass } from "./ui";

const TABS = [
  ["loans", "Préstamos otorgados"], ["payments", "Cobros"], ["capital", "Capital recuperado"], ["interest", "Intereses"],
  ["closed", "Cancelados"], ["balances", "Saldos y morosidad"], ["cash", "Caja"],
] as const;
type Tab = (typeof TABS)[number][0];

const lbl = "mb-1 block text-xs text-muted-foreground";

function Table({ t }: { t: ReportTable }) {
  if (t.rows.length === 0) return <p className="py-8 text-center text-[13px] text-muted-foreground">{t.empty}</p>;
  return (
    <div className="-mx-5 overflow-x-auto">
      <table className="w-full min-w-[720px] text-left text-sm tabular-nums">
        <thead>
          <tr className="border-y border-border text-xs text-muted-foreground">
            {t.columns.map((c) => <th key={c.key} className={`px-4 py-2.5 font-medium ${c.kind === "money" || c.kind === "pct" || c.kind === "num" ? "text-right" : ""}`}>{c.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i} className={`border-b border-border/60 last:border-0 ${r.status === "Revertido" ? "text-muted-foreground line-through" : ""} ${r.check === "Diferencia" ? "bg-destructive/10" : ""}`}>
              {t.columns.map((c) => <td key={c.key} className={`px-4 py-2.5 ${c.kind === "money" || c.kind === "pct" || c.kind === "num" ? "text-right" : ""}`}>{cellText(c, r[c.key])}</td>)}
            </tr>
          ))}
        </tbody>
        {t.totals && (
          <tfoot>
            <tr className="border-t-2 border-border bg-mint-50 font-semibold">
              {t.columns.map((c) => <td key={c.key} className={`px-4 py-2.5 ${c.kind === "money" || c.kind === "pct" || c.kind === "num" ? "text-right" : ""}`}>{cellText(c, t.totals?.[c.key] ?? null)}</td>)}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

export function ReportsView() {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("loans");
  const [f, setF] = useState<Filters>(EMPTY_FILTERS);
  const [capGroup, setCapGroup] = useState<GroupBy>("loan");
  const [intGroup, setIntGroup] = useState<InterestGroup>("period");

  const load = () => { setError(null); setData(null); fetchReportData().then(setData).catch(() => setError("carga")); };   // el detalle técnico (tablas, mensajes de PostgREST) no se muestra al usuario
  useEffect(load, []);

  const table: ReportTable | null = useMemo(() => {
    if (!data) return null;
    switch (tab) {
      case "loans": return loansReport(data.loans, f);
      case "payments": return paymentsReport(data.payments, data.loans, f);
      case "capital": return capitalReport(data.loans, data.payments, f, capGroup);
      case "interest": return interestReport(data.loans, data.installments, f, intGroup);
      case "closed": return closedReport(data.loans, data.payments, f);
      case "balances": return balancesReport(data.loans, f);
      case "cash": return cashReport(data.payments, data.loans, data.cash, f);
    }
  }, [data, tab, f, capGroup, intGroup]);

  if (error) {
    return (
      <Card>
        <p className="py-4 text-center text-[13px] text-destructive">No se pudieron cargar los reportes. Inténtalo de nuevo en unos segundos.</p>
        <div className="text-center"><Button type="button" variant="outline" onClick={load}>Reintentar</Button></div>
      </Card>
    );
  }
  if (!data || !table) return <Card><p className="py-6 text-center text-[13px] text-muted-foreground">Cargando reportes…</p></Card>;

  const set = (k: keyof Filters, v: string) => setF((p) => ({ ...p, [k]: v }));
  const stamp = new Date().toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" });
  const fileBase = `reporte-${tab}-${new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" })}`;
  const k = table.totals;

  return (
    <div className="space-y-4">
      {data.notices.length > 0 && (
        <div role="alert" className="space-y-1 rounded-xl bg-amber-100 px-3.5 py-2.5 text-[13px] text-amber-900">
          <p className="font-semibold">Los reportes pueden estar incompletos o no conciliar con la base de datos:</p>
          {data.notices.map((n) => <p key={n}>{n}</p>)}
        </div>
      )}
      <div className="print:hidden">
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Reportes">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
              className={`h-9 rounded-full px-4 text-sm transition-colors ${tab === id ? "bg-mint-400 font-semibold text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
              {label}
            </button>
          ))}
        </div>

        <Card className="mt-4">
          <CardHeader title="Filtros" desc={`Los totales y las exportaciones respetan estos filtros. ${tab === "closed" ? "La fecha filtra por cancelación." : tab === "loans" ? "La fecha filtra por desembolso." : tab === "interest" ? "La fecha filtra por vencimiento del período." : tab === "balances" ? "El saldo es el actual (la fecha no aplica)." : "La fecha filtra por cobro."}`}
            action={<Button type="button" variant="outline" className="h-9" onClick={() => setF(EMPTY_FILTERS)}>Limpiar</Button>} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <label><span className={lbl}>Desde</span><input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} className={fieldClass} /></label>
            <label><span className={lbl}>Hasta</span><input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} className={fieldClass} /></label>
            <label><span className={lbl}>Cliente o documento</span><input value={f.client} onChange={(e) => set("client", e.target.value)} className={fieldClass} /></label>
            <label><span className={lbl}>Código de préstamo</span><input value={f.code} onChange={(e) => set("code", e.target.value)} className={fieldClass} /></label>
            <label><span className={lbl}>Modalidad</span>
              <select value={f.loanType} onChange={(e) => set("loanType", e.target.value)} className={fieldClass}>
                <option value="">Todas</option>{Object.entries(LOAN_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            <label><span className={lbl}>Estado del préstamo</span>
              <select value={f.status} onChange={(e) => set("status", e.target.value)} className={fieldClass}>
                <option value="">Todos</option><option value="active">Activo</option><option value="overdue">Vencido</option><option value="paid">Pagado</option>
              </select></label>
            <label><span className={lbl}>Método de pago</span>
              <select value={f.method} onChange={(e) => set("method", e.target.value)} className={fieldClass}>
                <option value="">Todos</option>{Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select></label>
            {tab === "capital" && (
              <label><span className={lbl}>Detalle por</span>
                <select value={capGroup} onChange={(e) => setCapGroup(e.target.value as GroupBy)} className={fieldClass}><option value="loan">Préstamo</option><option value="client">Cliente</option></select></label>
            )}
            {tab === "interest" && (
              <label><span className={lbl}>Detalle por</span>
                <select value={intGroup} onChange={(e) => setIntGroup(e.target.value as InterestGroup)} className={fieldClass}><option value="period">Período</option><option value="client">Cliente</option><option value="loan">Préstamo</option></select></label>
            )}
          </div>
        </Card>
      </div>

      <div id="report-print">
        <Card>
          <CardHeader title={table.title}
            desc={`Generado: ${stamp} · ${describeFilters(f).join(" · ")}`}
            action={
              <div className="flex flex-wrap gap-2 print:hidden">
                <Button type="button" variant="outline" className="h-9" onClick={() => download(`${fileBase}.csv`, toCsv(table, f, stamp))}><Download className="mr-1.5 size-4" />CSV</Button>
                <Button type="button" variant="outline" className="h-9" onClick={() => window.print()}><FileDown className="mr-1.5 size-4" />PDF</Button>
                <Button type="button" variant="outline" className="h-9" onClick={load}>Actualizar</Button>
              </div>
            } />
          {k && (
            <p className="mb-3 text-[13px] text-muted-foreground">
              {table.columns.filter((c) => c.kind === "money" && k[c.key] !== undefined && k[c.key] !== null).map((c) => `${c.label}: ${moneyDec(Number(k[c.key]))}`).join(" · ")}
            </p>
          )}
          <Table t={table} />
        </Card>
      </div>
    </div>
  );
}

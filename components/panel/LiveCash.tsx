"use client";

import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, Banknote, Wallet } from "lucide-react";
import { moneyDec as money } from "@/lib/format";
import { CASH_LABEL, fetchCash, summarize, type CashRow } from "@/lib/data/cash";
import { DataTable } from "./DataTable";
import { Card, KpiCard } from "./ui";

export function LiveCash() {
  const [rows, setRows] = useState<CashRow[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { fetchCash().then(setRows).catch(() => setError(true)); }, []);

  if (error) return <Card><p className="py-6 text-center text-[13px] text-muted-foreground">No se pudo cargar la caja.</p></Card>;
  if (!rows) return <Card><p className="py-6 text-center text-[13px] text-muted-foreground">Cargando caja…</p></Card>;
  if (rows.length === 0) return <Card><p className="py-6 text-center text-[13px] text-muted-foreground">Aún no hay movimientos de caja.</p></Card>;

  const s = summarize(rows);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Intereses cobrados" value={money(s.interest)} icon={Banknote} hint="ingreso por intereses" />
        <KpiCard label="Capital recuperado" value={money(s.capital)} icon={ArrowDownLeft} hint="no es ganancia" />
        <KpiCard label="Desembolsado" value={money(s.disbursed)} icon={ArrowUpRight} hint={s.reversed ? `Reversiones: ${money(s.reversed)}` : "salidas por préstamos"} />
        <KpiCard label="Saldo de caja" value={money(s.balance)} icon={Wallet} hint="entradas − salidas" />
      </div>
      <DataTable
        title="Movimientos"
        desc="Últimos 500 movimientos"
        columns={[
          { key: "fecha", label: "Fecha", kind: "muted" }, { key: "concepto", label: "Concepto" },
          { key: "prestamo", label: "Préstamo", kind: "muted" }, { key: "tipo", label: "Tipo", kind: "status" },
          { key: "monto", label: "Monto", kind: "money", align: "right" },
        ]}
        rows={rows.map((r) => ({
          fecha: new Date(r.created_at).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }),
          concepto: CASH_LABEL[r.kind] ?? r.kind, prestamo: r.loans?.code ?? "—",
          tipo: r.direction === "in" ? "Entrada" : "Salida", monto: r.amount,
        }))}
      />
    </div>
  );
}

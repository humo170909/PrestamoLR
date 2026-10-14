"use client";

import { motion } from "framer-motion";
import { TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { EASE } from "@/components/login/field-styles";

export const fieldClass =
  "h-11 w-full rounded-xl border border-border bg-mint-50 px-3.5 text-sm text-foreground outline-none " +
  "transition-[border-color,box-shadow,background-color] duration-200 ease-out-expo " +
  "focus:border-mint-500 focus:bg-raised focus:ring-4 focus:ring-mint-400/40";

export function Reveal({ i = 0, className, children }: { i?: number; className?: string; children: React.ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: EASE, delay: i * 0.05 }}
    >
      {children}
    </motion.div>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return <section className={cn("min-w-0 rounded-2xl border border-border bg-card p-5 shadow-[0_1px_2px_rgba(0,0,0,0.04)]", className)}>{children}</section>;
}

export function CardHeader({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {desc && <p className="mt-0.5 text-[13px] text-muted-foreground">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, desc, action }: { title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[34px] leading-none text-foreground sm:text-[42px]">{title}</h1>
        {desc && <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{desc}</p>}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({
  label, value, hint, icon: Icon, delta,
}: { label: string; value: string; hint?: string; icon: LucideIcon; delta?: number }) {
  return (
    <Card className="flex flex-col gap-2.5 p-4 sm:gap-3 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted-foreground">{label}</span>
        <span className="flex size-9 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
          <Icon className="size-[18px]" />
        </span>
      </div>
      <div className="min-w-0 break-words text-[22px] font-semibold leading-none tracking-tight text-foreground tabular-nums sm:text-[28px]">{value}</div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {delta !== undefined && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium",
              delta >= 0 ? "bg-mint-100 text-mint-600" : "bg-destructive/15 text-destructive",
            )}
          >
            {delta >= 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
            {Math.abs(delta).toFixed(1).replace(".", ",")}%
          </span>
        )}
        {hint}
      </div>
    </Card>
  );
}

const TONES: Record<string, string> = {
  good: "bg-mint-100 text-mint-600",
  bad: "bg-destructive/15 text-destructive",
  warn: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  info: "bg-sky-100 text-sky-800 dark:bg-sky-400/15 dark:text-sky-300",
  neutral: "bg-muted text-muted-foreground",
};
const STATUS_TONE: Record<string, string> = {
  Vigente: "good", Activo: "good", Pagada: "good", Entrada: "good", Excelente: "good", Bueno: "good",
  "En mora": "bad", Moroso: "bad", Salida: "bad", Riesgo: "bad",
  Pendiente: "warn", Regular: "warn", "En ruta": "info",
  Confirmado: "good", Revertido: "bad", Pagado: "good", Vencido: "bad", Anulado: "neutral", Refinanciado: "neutral",
  Cancelado: "neutral", Inactivo: "neutral",
};

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", TONES[STATUS_TONE[value] ?? "neutral"])}>
      {value}
    </span>
  );
}

/** Aviso visible cuando una lista cargada no incluye todas las filas del servidor (ver lib/data/paginate.ts). No muestra nada si está completa. */
export function TruncationNotice({ rows, what }: { rows: unknown[]; what: string }) {
  const total = (rows as { total?: number }).total ?? rows.length;
  if (total <= rows.length) return null;
  return (
    <p role="alert" className="rounded-xl bg-amber-100 px-3.5 py-2.5 text-[13px] text-amber-900">
      Se muestran {rows.length} de {total} {what}. La lista está incompleta: usa el buscador o contacta al administrador.
    </p>
  );
}

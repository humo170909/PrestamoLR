"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { moneyDec as money } from "@/lib/format";
import type { Row } from "@/lib/mock";
import { cn } from "@/lib/utils";
import { Card, CardHeader, StatusBadge, fieldClass } from "./ui";

export interface Column {
  key: string;
  label: string;
  kind?: "money" | "status" | "muted" | "num";
  align?: "right";
}

export function DataTable({
  title, desc, columns, rows, pageSize = 8, searchable = true, className, actions, actionsLabel = "Acciones",
}: {
  title: string; desc?: string; columns: Column[]; rows: Row[]; pageSize?: number; searchable?: boolean; className?: string;
  /** Celda de acciones por fila. Las claves de fila que empiezan por "_" (p. ej. _id) no se buscan ni se muestran. */
  actions?: (row: Row) => React.ReactNode; actionsLabel?: string;
}) {
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? rows.filter((r) => Object.entries(r).some(([k, v]) => !k.startsWith("_") && String(v).toLowerCase().includes(s))) : rows;
  }, [q, rows]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, pages - 1);
  const slice = filtered.slice(cur * pageSize, cur * pageSize + pageSize);

  return (
    <Card className={className}>
      <CardHeader
        title={title}
        desc={desc}
        action={
          searchable ? (
            <div className="relative w-full max-w-[220px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => { setQ(e.target.value); setPage(0); }}
                placeholder="Filtrar…"
                aria-label={`Filtrar ${title}`}
                className={cn(fieldClass, "h-10 pl-9")}
              />
            </div>
          ) : undefined
        }
      />
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-y border-border text-xs text-muted-foreground">
              {columns.map((c) => (
                <th key={c.key} className={cn("px-5 py-2.5 font-medium", c.align === "right" && "text-right")}>{c.label}</th>
              ))}
              {actions && <th className="px-5 py-2.5 text-right font-medium">{actionsLabel}</th>}
            </tr>
          </thead>
          <tbody>
            {slice.map((r, i) => (
              <tr key={i} className="border-b border-border/60 transition-colors duration-150 last:border-0 hover:bg-mint-50">
                {columns.map((c) => {
                  const v = r[c.key];
                  return (
                    <td key={c.key} className={cn("px-5 py-3 text-foreground", c.align === "right" && "text-right tabular-nums", c.kind === "muted" && "text-muted-foreground", c.kind === "num" && "tabular-nums")}>
                      {c.kind === "money" ? money(Number(v)) : c.kind === "status" ? <StatusBadge value={String(v)} /> : v}
                    </td>
                  );
                })}
                {actions && <td className="px-5 py-2 text-right">{actions(r)}</td>}
              </tr>
            ))}
            {!slice.length && (
              <tr><td colSpan={columns.length + (actions ? 1 : 0)} className="px-5 py-8 text-center text-muted-foreground">Sin resultados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{filtered.length} registros · página {cur + 1} de {pages}</span>
          <div className="flex gap-1.5">
            {[{ d: -1, Icon: ChevronLeft, l: "Anterior" }, { d: 1, Icon: ChevronRight, l: "Siguiente" }].map(({ d, Icon, l }) => (
              <button
                key={l}
                type="button"
                aria-label={l}
                disabled={cur + d < 0 || cur + d >= pages}
                onClick={() => setPage(cur + d)}
                className="flex size-9 items-center justify-center rounded-lg border border-border bg-raised text-foreground transition-all duration-150 hover:border-mint-400 active:scale-95 disabled:opacity-40"
              >
                <Icon className="size-4" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

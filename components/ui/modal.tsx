"use client";

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal reutilizable (reemplaza alert/confirm nativos).
 * - Fondo semitransparente, tarjeta centrada y con scroll en pantallas pequeñas.
 * - Foco atrapado dentro del diálogo, Esc y clic fuera cierran SOLO si no hay una operación en curso (`busy`).
 * - Devuelve el foco al elemento que lo abrió.
 */
export function Modal({
  open, title, icon: Icon, tone = "brand", busy = false, onClose, children, footer,
}: {
  open: boolean; title: string; icon?: LucideIcon; tone?: "brand" | "danger"; busy?: boolean;
  onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = ref.current;
    (node?.querySelector<HTMLElement>("[data-autofocus]") ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busyRef.current) { e.stopPropagation(); closeRef.current(); return; }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (items.length === 0) { e.preventDefault(); return; }
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-2xl outline-none sm:rounded-3xl">
        <div className="flex items-start gap-3 px-5 pb-3 pt-5 sm:px-6">
          {Icon && (
            <span className={cn("flex size-11 shrink-0 items-center justify-center rounded-2xl",
              tone === "danger" ? "bg-destructive/15 text-destructive" : "bg-mint-100 text-mint-600")}>
              <Icon className="size-5" />
            </span>
          )}
          <h2 id={titleId} className="pt-1.5 text-lg font-semibold leading-snug text-foreground">{title}</h2>
        </div>
        <div className="overflow-y-auto px-5 pb-4 text-sm text-muted-foreground sm:px-6">{children}</div>
        {footer && <div className="flex flex-col-reverse gap-2 border-t border-border bg-mint-50/60 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/** Lista "etiqueta — valor" para los resúmenes dentro de los modales. */
export function SummaryList({ items }: { items: [string, string][] }) {
  return (
    <dl className="mt-3 divide-y divide-border/60 rounded-2xl border border-border bg-background px-4">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-[13px] text-muted-foreground">{k}</dt>
          <dd className="text-right text-[13px] font-semibold tabular-nums text-foreground">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CalendarClock, FileDown, Loader2, Receipt, Search, Trash2 } from "lucide-react";
import { Modal, SummaryList } from "@/components/ui/modal";
import { usePanel } from "./PanelContext";
import { Button } from "@/components/ui/button";
import { moneyDec } from "@/lib/format";
import {
  cancelLoan, fetchLoanPayments, fetchLoanSummaries, fetchSchedule, type LoanPayment, type LoanSummary, type ScheduleItem,
} from "@/lib/data/loans";
import { FREQUENCY_LABEL } from "@/lib/finance/interest-only";
import { LOAN_TYPE_LABEL, STATUS_LABEL, capitalRecoveredPct, deriveStatus, type DerivedStatus } from "@/lib/finance/loan-rules";
import { DUE_STATE_LABEL, dueState } from "@/lib/finance/due-status";
import { Card, CardHeader, StatusBadge, TruncationNotice, fieldClass } from "./ui";

const METHOD: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", yape: "Yape / Plin" };
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");
const toCents = (n: number) => Math.round(n * 100);
const FILTERS = [["all", "Todos"], ["active", "Activo"], ["paid", "Pagado"], ["overdue", "Vencido"]] as const;
type Filter = (typeof FILTERS)[number][0];

const statusOf = (l: LoanSummary): DerivedStatus => deriveStatus(l.db_status, l.interest_overdue + l.capital_overdue);
/** Texto único del próximo vencimiento (usa la regla central de due-status). */
function nextDueText(l: LoanSummary): { state: ReturnType<typeof dueState>; text: string } {
  const state = dueState({ nextDue: l.next_due_date, today: l.business_today, loanClosed: l.db_status !== "active" && l.db_status !== "defaulted" });
  if (state === "overdue") return { state, text: `Vencido desde ${dmy(l.oldest_overdue_date)}${l.periods_unpaid_exigible > 1 ? ` (${l.periods_unpaid_exigible} períodos)` : ""}` };
  if (state === "due_today") return { state, text: "Vence hoy" };
  if (state === "upcoming") return { state, text: dmy(l.next_due_date) };
  return { state, text: state === "paid" ? "Préstamo cancelado" : DUE_STATE_LABEL[state] };
}
const receipt = (n: number) => `R-${String(n).padStart(5, "0")}`;
const rateText = (l: LoanSummary) => `${l.rate_pct}% por ${FREQUENCY_LABEL[l.frequency].period}`;

function Stat({ label, value, tone }: { label: string; value: string; tone?: "bad" | "good" }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-0.5 text-[15px] font-semibold tabular-nums ${tone === "bad" ? "text-destructive" : tone === "good" ? "text-mint-600" : "text-foreground"}`}>{value}</div>
    </div>
  );
}

/** Eliminación lógica: la base de datos anula el préstamo conservando pagos, caja, cronograma y auditoría. */
function DeleteLoanModal({ loan, onClose, onDone }: { loan: LoanSummary | null; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReason(""); setError(null); }, [loan?.id]);
  const hasPayments = (loan?.total_paid ?? 0) > 0;
  const run = async () => {
    if (!loan || busy || hasPayments) return;
    if (reason.trim().length < 5) { setError("Indica el motivo (mínimo 5 caracteres)."); return; }
    setBusy(true); setError(null);
    try { await cancelLoan(loan.id, reason.trim()); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo eliminar el préstamo."); }
    finally { setBusy(false); }
  };
  return (
    <Modal open={!!loan} busy={busy} tone="danger" icon={Trash2} title="¿Eliminar este préstamo?" onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" data-autofocus disabled={busy} onClick={onClose} className="h-11 rounded-xl">Cancelar</Button>
          <Button type="button" disabled={busy || hasPayments} onClick={() => void run()} className="h-11 rounded-xl bg-destructive px-5 font-semibold text-background hover:opacity-90 disabled:opacity-50">
            {busy ? <><Loader2 className="mr-2 size-4 animate-spin" />Eliminando…</> : "Confirmar eliminación"}
          </Button>
        </>
      }>
      <p className="text-foreground">Esta acción puede afectar el historial financiero. Revisa la información antes de continuar.</p>
      {loan && <SummaryList items={[["Cliente", loan.full_name], ["Código del préstamo", loan.code], ["Capital original", moneyDec(loan.principal)], ["Estado actual", STATUS_LABEL[statusOf(loan)]]]} />}
      {hasPayments ? (
        <p role="alert" className="mt-3 rounded-xl bg-amber-100 px-3.5 py-2.5 text-[13px] text-amber-900">Este préstamo tiene pagos confirmados ({moneyDec(loan?.total_paid ?? 0)}), por lo que no se puede eliminar. Alternativa: en «Registro de pagos» un administrador revierte esos pagos (queda el motivo y la caja se corrige); después podrás eliminarlo. Ningún registro se borra.</p>
      ) : (
        <>
          <p className="mt-3 text-[13px]">Los registros no se borran físicamente: el préstamo queda <b>anulado</b>, se conserva su historial y el desembolso se contra-asienta en caja. Solo administradores.</p>
          <label className="mt-3 block"><span className="mb-1.5 block text-[13px] text-muted-foreground">Motivo</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} disabled={busy} /></label>
        </>
      )}
      {error && <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">{error}</p>}
    </Modal>
  );
}

function LoanCard({ l, onOpen, onDelete, highlight }: { l: LoanSummary; onOpen: (id: string, print?: boolean) => void; onDelete?: (l: LoanSummary) => void; highlight?: boolean }) {
  const st = statusOf(l);
  const overdue = l.interest_overdue + l.capital_overdue;
  return (
    <Card className={`flex flex-col gap-4 transition-shadow duration-500 ${highlight ? "ring-2 ring-mint-400 shadow-lg" : ""}`}>
      <div id={`loan-${l.id}`} className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-foreground">{l.full_name}</h3>
          <p className="text-xs text-muted-foreground">{l.code} · DNI {l.document_id}</p>
        </div>
        <StatusBadge value={STATUS_LABEL[st]} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Stat label="Capital original" value={moneyDec(l.principal)} />
        <Stat label="Capital pendiente" value={moneyDec(l.principal_outstanding)} />
        <Stat label="Intereses pendientes" value={moneyDec(l.interest_pending)} tone={l.interest_pending > 0 ? "bad" : undefined} />
        <Stat label="Tasa" value={rateText(l)} />
        <Stat label="Modalidad" value={LOAN_TYPE_LABEL[l.loan_type]} />
        <Stat label="Frecuencia" value={FREQUENCY_LABEL[l.frequency].period} />
        <Stat label="Inicio" value={dmy(l.start_date)} />
        <Stat label="Próximo cobro" value={nextDueText(l).text} tone={nextDueText(l).state === "overdue" ? "bad" : undefined} />
        <Stat label="Pagos realizados" value={`${l.periods_paid}${l.periods ? ` de ${l.periods}` : ""}`} />
      </div>
      {overdue > 0 && (
        <p className="rounded-xl bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
          Vencido: {moneyDec(overdue)} · {l.days_overdue} día(s) de atraso · {l.periods_overdue} período(s)
        </p>
      )}
      <div className="mt-auto flex flex-wrap gap-2">
        <Button type="button" onClick={() => onOpen(l.id)} className="h-10 rounded-xl bg-mint-400 px-4 text-sm font-semibold text-primary-foreground hover:bg-mint-500">Ver detalle</Button>
        <Button type="button" variant="outline" onClick={() => onOpen(l.id, true)} className="h-10 rounded-xl px-4 text-sm"><FileDown className="mr-1.5 size-4" />Exportar estado</Button>
        {onDelete && st !== "paid" && st !== "cancelled" && (
          <Button type="button" variant="outline" onClick={() => onDelete(l)} className="h-10 rounded-xl px-4 text-sm text-destructive hover:text-destructive"><Trash2 className="mr-1.5 size-4" />Eliminar préstamo</Button>
        )}
      </div>
    </Card>
  );
}

function Detail({ loanId, autoPrint, onBack }: { loanId: string; autoPrint: boolean; onBack: () => void }) {
  const { user } = usePanel();
  const [deleting, setDeleting] = useState<LoanSummary | null>(null);
  const [loan, setLoan] = useState<LoanSummary | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [payments, setPayments] = useState<LoanPayment[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [reason, setReason] = useState("");
  const [degraded, setDegraded] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  useEffect(() => {
    let alive = true;
    // Datos frescos de Supabase en cada apertura: lo que se ve (y se exporta) es lo registrado.
    // Cada consulta es independiente: si una falla, el resto del detalle se sigue mostrando.
    Promise.allSettled([fetchLoanSummaries(), fetchSchedule(loanId), fetchLoanPayments(loanId)]).then(([sum, sch, pay]) => {
      if (!alive) return;
      const found = sum.status === "fulfilled" ? sum.value.find((x) => x.id === loanId) ?? null : null;
      if (sch.status === "fulfilled") { setSchedule(sch.value.rows); setDegraded(sch.value.degraded); }
      if (pay.status === "fulfilled") setPayments(pay.value);
      const failed = [sum, sch, pay].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
      setReason(failed ? String((failed.reason as Error)?.message ?? failed.reason) : found ? "" : "El préstamo no está disponible para tu usuario.");
      setLoan(found); setState(found ? "ok" : "error");
    });
    return () => { alive = false; };
  }, [loanId]);

  useEffect(() => {
    if (state === "ok" && autoPrint) { const t = setTimeout(() => window.print(), 300); return () => clearTimeout(t); }
  }, [state, autoPrint]);

  if (state === "loading") return <Card><p className="py-6 text-center text-[13px] text-muted-foreground">Cargando préstamo…</p></Card>;
  if (state === "error" || !loan) {
    return (
      <Card>
        <p className="py-6 text-center text-[13px] text-muted-foreground">No se pudo cargar el préstamo.{reason ? ` Motivo: ${reason}` : ""}</p>
        <div className="text-center"><Button type="button" variant="outline" onClick={onBack}>Volver</Button></div>
      </Card>
    );
  }

  const st = statusOf(loan);
  const pct = capitalRecoveredPct(toCents(loan.principal), toCents(loan.capital_paid));
  const confirmed = payments.filter((p) => p.status === "confirmed");
  const isOpen = loan.loan_type === "open";
  // Siguiente obligación: la primera pendiente por fecha (su interés ya usa el capital pendiente actualizado).
  const nextRow = schedule.find((r) => r.interest_paid < r.interest_due || r.capital_paid < r.capital_due);

  return (
    <div id="loan-statement" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button type="button" variant="outline" onClick={onBack} className="h-10 rounded-xl"><ArrowLeft className="mr-1.5 size-4" />Volver a la lista</Button>
        <div className="flex flex-wrap gap-2">
          {st !== "paid" && (
            <Link href={`/registro-pagos?loan=${loan.id}`} className="inline-flex h-10 items-center rounded-xl bg-mint-400 px-4 text-sm font-semibold text-primary-foreground hover:bg-mint-500">
              <Receipt className="mr-1.5 size-4" />Registrar pago
            </Link>
          )}
          <Button type="button" variant="outline" onClick={() => setShowSchedule((v) => !v)} className="h-10 rounded-xl"><CalendarClock className="mr-1.5 size-4" />{showSchedule ? "Ocultar cronograma" : "Ver cronograma"}</Button>
          <Button type="button" variant="outline" onClick={() => window.print()} className="h-10 rounded-xl"><FileDown className="mr-1.5 size-4" />Exportar a PDF</Button>
          {user.roleKey === "admin" && st !== "paid" && st !== "cancelled" && (
            <Button type="button" variant="outline" onClick={() => setDeleting(loan)} className="h-10 rounded-xl text-destructive hover:text-destructive"><Trash2 className="mr-1.5 size-4" />Eliminar préstamo</Button>
          )}
        </div>
      </div>

      {degraded && <p role="note" className="rounded-xl bg-amber-100 px-3.5 py-2.5 text-[13px] text-amber-900 print:hidden">El cronograma se muestra sin capital de referencia: falta aplicar la migración 20261012000200 en Supabase.</p>}
      <DeleteLoanModal loan={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); onBack(); }} />
      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">LRomero Préstamos — Estado del préstamo {loan.code}</h1>
        <p className="text-xs">Generado el {new Date().toLocaleString("es-PE", { timeZone: "America/Lima" })} con los datos registrados.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Cliente" />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Nombre" value={loan.full_name} />
            <Stat label="DNI" value={loan.document_id} />
            <Stat label="Teléfono" value={loan.phone ?? "—"} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Información del préstamo" action={<StatusBadge value={STATUS_LABEL[st]} />} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Código" value={loan.code} />
            <Stat label="Modalidad" value={LOAN_TYPE_LABEL[loan.loan_type]} />
            <Stat label="Capital original" value={moneyDec(loan.principal)} />
            <Stat label="Tasa" value={rateText(loan)} />
            <Stat label="Frecuencia" value={FREQUENCY_LABEL[loan.frequency].period} />
            <Stat label="Inicio" value={dmy(loan.start_date)} />
            {loan.periods && <Stat label="Plazo" value={`${loan.periods} ${FREQUENCY_LABEL[loan.frequency].period}(s)`} />}
            {loan.interest_projected !== null && <Stat label="Intereses proyectados" value={moneyDec(loan.interest_projected)} />}
            {loan.interest_projected !== null && <Stat label="Total proyectado" value={moneyDec(loan.principal + loan.interest_projected)} />}
          </div>
          {isOpen && <p className="mt-3 text-xs text-muted-foreground">Préstamo abierto: sin plazo ni cuotas. Los intereses se generan período a período.</p>}
        </Card>
      </div>

      <Card>
        <CardHeader title="Progreso financiero" desc="El porcentaje de capital recuperado solo cuenta abonos de capital; los intereses no lo incrementan." />
        <div className="mb-4 h-2.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Capital recuperado">
          <div className="h-full rounded-full bg-mint-400" style={{ width: `${pct}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
          <Stat label="Capital recuperado" value={`${pct.toFixed(2).replace(".", ",")} %`} tone="good" />
          <Stat label="Capital abonado" value={moneyDec(loan.capital_paid)} />
          <Stat label="Capital pendiente" value={moneyDec(loan.principal_outstanding)} />
          <Stat label="Total efectivamente pagado" value={moneyDec(loan.total_paid)} />
          <Stat label="Intereses generados" value={moneyDec(loan.interest_generated)} />
          <Stat label="Intereses cobrados" value={moneyDec(loan.interest_paid)} />
          <Stat label="Intereses pendientes" value={moneyDec(loan.interest_pending)} tone={loan.interest_pending > 0 ? "bad" : undefined} />
          <Stat label="Próximo vencimiento" value={nextDueText(loan).text} tone={nextDueText(loan).state === "overdue" ? "bad" : undefined} />
          <Stat label="Interés del próximo período" value={nextRow && st !== "paid" ? moneyDec(nextRow.interest_due - nextRow.interest_paid) : "—"} />
          <Stat label="Importe del próximo cobro" value={nextDueText(loan).state === "paid" || nextDueText(loan).state === "none" ? "—" : moneyDec(loan.next_due_amount)} />
          <Stat label="Períodos transcurridos / cobrados" value={`${loan.periods_elapsed} / ${loan.periods_paid}`} />
          <Stat label="Períodos vencidos" value={String(loan.periods_overdue)} tone={loan.periods_overdue > 0 ? "bad" : undefined} />
          <Stat label="Días de atraso" value={String(loan.days_overdue)} tone={loan.days_overdue > 0 ? "bad" : undefined} />
          <Stat label="Último pago" value={dmy(loan.last_payment_on)} />
        </div>
      </Card>

      {(showSchedule || autoPrint) && (
        <Card>
          <CardHeader title="Cronograma" desc={isOpen ? "El interés de cada período se calcula sobre el capital pendiente (capital de referencia). Los períodos cobrados conservan su importe histórico." : undefined} />
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm tabular-nums">
              <thead>
                <tr className="border-y border-border text-xs text-muted-foreground">
                  {["Período", "Vence", "Capital de referencia", "Interés previsto", "Interés cobrado", "Capital abonado", "Pendiente", "Estado"].map((h, i) => <th key={h} className={`px-4 py-2.5 font-medium ${i > 1 && i < 7 ? "text-right" : ""}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {schedule.map((r) => {
                  const pend = Math.max(0, r.interest_due - r.interest_paid) + Math.max(0, r.capital_due - r.capital_paid);
                  const done = pend === 0;
                  const st = done ? "Pagado" : dueState({ nextDue: r.due_date, today: loan.business_today }) === "overdue" ? "Vencido" : r.due_date === loan.business_today ? "Vence hoy" : "Pendiente";
                  return (
                    <tr key={r.n} className="border-b border-border/60 last:border-0">
                      <td className="px-4 py-2.5">{r.n}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{dmy(r.due_date)}</td>
                      <td className="px-4 py-2.5 text-right">{r.reference_capital < 0 ? "—" : moneyDec(r.reference_capital)}</td>
                      <td className="px-4 py-2.5 text-right">{moneyDec(r.interest_due)}</td>
                      <td className="px-4 py-2.5 text-right">{moneyDec(r.interest_paid)}</td>
                      <td className="px-4 py-2.5 text-right">{moneyDec(r.capital_applied)}</td>
                      <td className="px-4 py-2.5 text-right">{moneyDec(pend)}</td>
                      <td className="px-4 py-2.5"><StatusBadge value={st} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Historial de pagos" desc={`${confirmed.length} pago(s) confirmado(s)`} />
        {payments.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-muted-foreground">Aún no hay pagos registrados.</p>
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm tabular-nums">
              <thead>
                <tr className="border-y border-border text-xs text-muted-foreground">
                  {["Recibo", "Fecha", "Interés", "Capital", "Total", "Método", "Estado"].map((h, i) => <th key={h} className={`px-5 py-2.5 font-medium ${i > 1 && i < 5 ? "text-right" : ""}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id} className={`border-b border-border/60 last:border-0 ${p.status === "reversed" ? "text-muted-foreground line-through" : ""}`}>
                    <td className="px-5 py-2.5">{receipt(p.receipt_no)}</td>
                    <td className="px-5 py-2.5">{dmy(p.paid_on)}</td>
                    <td className="px-5 py-2.5 text-right">{moneyDec(p.interest_amount)}</td>
                    <td className="px-5 py-2.5 text-right">{moneyDec(p.capital_amount)}</td>
                    <td className="px-5 py-2.5 text-right font-medium">{moneyDec(p.interest_amount + p.capital_amount)}</td>
                    <td className="px-5 py-2.5">{METHOD[p.method] ?? p.method}</td>
                    <td className="px-5 py-2.5 no-underline" title={p.reversal_reason ?? undefined}><StatusBadge value={p.status === "reversed" ? "Revertido" : "Confirmado"} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

export function LoanBoard() {
  const [loans, setLoans] = useState<LoanSummary[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const { user } = usePanel();
  const [open, setOpen] = useState<{ id: string; print: boolean } | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<LoanSummary | null>(null);

  // Rutas reales: /prestamos?loan=<id> abre el detalle; /prestamos?highlight=<id> resalta el préstamo en la lista.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const loan = q.get("loan"), hl = q.get("highlight");
    if (loan) setOpen({ id: loan, print: false });
    if (hl) { setHighlight(hl); const t = setTimeout(() => setHighlight(null), 6000); return () => clearTimeout(t); }
  }, []);
  useEffect(() => { if (highlight && state === "ok") document.getElementById(`loan-${highlight}`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [highlight, state]);

  const load = useCallback(() => {
    setState("loading");
    fetchLoanSummaries().then((r) => { setLoans(r); setState("ok"); }).catch(() => setState("error"));
  }, []);
  useEffect(load, [load]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return loans.filter((l) => {
      if (filter !== "all" && statusOf(l) !== filter) return false;
      return !needle || [l.full_name, l.document_id, l.code].some((v) => v.toLowerCase().includes(needle));
    });
  }, [loans, q, filter]);

  if (open) return <Detail loanId={open.id} autoPrint={open.print} onBack={() => { setOpen(null); load(); }} />;

  return (
    <div className="space-y-4">
      <DeleteLoanModal loan={deleting} onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); load(); }} />
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por cliente, documento o código" aria-label="Buscar préstamos" className={`${fieldClass} pl-10`} />
        </div>
        <Link href="/nuevo-prestamo" className="inline-flex h-11 items-center rounded-xl bg-mint-400 px-5 text-sm font-semibold text-primary-foreground hover:bg-mint-500">Nuevo préstamo</Link>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtrar por estado">
        {FILTERS.map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)}
            className={`h-9 rounded-full px-4 text-sm transition-colors ${filter === k ? "bg-mint-400 font-semibold text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>
            {label}{k !== "all" && <span className="ml-1.5 text-xs opacity-80">{loans.filter((l) => statusOf(l) === k).length}</span>}
          </button>
        ))}
      </div>

      {state === "ok" && loans.some((l) => nextDueText(l).state === "due_today") && (
        <Card>
          <CardHeader title="Cobros de hoy" desc="Obligaciones que vencen hoy y siguen pendientes" />
          <ul className="divide-y divide-border/60 text-sm">
            {loans.filter((l) => nextDueText(l).state === "due_today").map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span><b>{l.full_name}</b> · {l.code}</span>
                <span className="tabular-nums">{moneyDec(l.due_today_pending)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <TruncationNotice rows={loans} what="préstamos" />
      {state === "loading" ? <Card><p className="py-6 text-center text-[13px] text-muted-foreground">Cargando préstamos…</p></Card>
        : state === "error" ? <Card><p className="py-6 text-center text-[13px] text-muted-foreground">No se pudieron cargar los préstamos.</p><div className="text-center"><Button type="button" variant="outline" onClick={load}>Reintentar</Button></div></Card>
        : shown.length === 0 ? <Card><p className="py-6 text-center text-[13px] text-muted-foreground">{loans.length === 0 ? "Aún no hay préstamos. Regístralos en “Nuevo préstamo”." : "Ningún préstamo coincide con la búsqueda."}</p></Card>
        : (
          <div className="grid gap-4 xl:grid-cols-2">
            {shown.map((l) => <LoanCard key={l.id} l={l} highlight={l.id === highlight} onOpen={(id, print) => setOpen({ id, print: !!print })} onDelete={user.roleKey === "admin" ? setDeleting : undefined} />)}
          </div>
        )}
    </div>
  );
}

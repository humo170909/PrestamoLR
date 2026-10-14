"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, HandCoins, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal, SummaryList } from "@/components/ui/modal";
import { limaToday, moneyDec } from "@/lib/format";
import {
  fetchInstallments, fetchPayments, fetchReceiptNo, paymentSchema, registerPayment, reversePayment, round2,
  type InstallmentRow, type PaymentRow,
} from "@/lib/data/payments";
import { fetchLoanSummaries, type LoanSummary } from "@/lib/data/loans";
import { LOAN_TYPE_LABEL, validatePayment } from "@/lib/finance/loan-rules";
import { applyAmounts, autoAllocate, type AllocationContext, type Obligation } from "@/lib/finance/allocation";
import { DUE_STATE_LABEL, dueState } from "@/lib/finance/due-status";
import { DataTable } from "./DataTable";
import { usePanel } from "./PanelContext";
import { Card, CardHeader, TruncationNotice, fieldClass } from "./ui";

const METHOD: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", yape: "Yape / Plin" };
const num = (v: string) => (Number.isFinite(parseFloat(v)) ? Math.max(0, parseFloat(v)) : 0);
const lbl = "mb-1.5 block text-[13px] text-muted-foreground";

/** Aviso por Telegram (lo envía el servidor con el token guardado). Nunca bloquea ni afecta al pago. */
function notifyTelegram(paymentId: string, event: "payment" | "reversal") {
  void fetch("/api/notify/payment", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paymentId, event }),
  }).catch(() => undefined);
}

function ReverseCard({ payments, onDone }: { payments: PaymentRow[]; onDone: () => void }) {
  const options = payments.filter((p) => p.status === "confirmed");
  const [id, setId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    if (!id || reason.trim().length < 5) { setMsg({ ok: false, text: "Elige un pago e indica el motivo (mín. 5 caracteres)." }); return; }
    if (!window.confirm("¿Revertir este pago? Quedará registrado en auditoría y caja.")) return;
    setBusy(true); setMsg(null);
    try { await reversePayment(id, reason.trim()); notifyTelegram(id, "reversal"); setMsg({ ok: true, text: "Pago revertido." }); setId(""); setReason(""); onDone(); }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo revertir." }); }
    finally { setBusy(false); }
  };
  if (options.length === 0) return null;
  return (
    <Card>
      <CardHeader title="Revertir un pago" desc="Solo administradores. El pago no se borra: se marca como revertido y se contra-asienta en caja." />
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <label className="block"><span className={lbl}>Pago</span>
          <select value={id} onChange={(e) => setId(e.target.value)} className={fieldClass}>
            <option value="">Selecciona…</option>
            {options.map((p) => <option key={p.id} value={p.id}>R-{String(p.receipt_no).padStart(5, "0")} · {p.loans?.code} · {moneyDec(Number(p.interest_amount) + Number(p.capital_amount))}</option>)}
          </select></label>
        <label className="block"><span className={lbl}>Motivo</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} className={fieldClass} /></label>
        <Button type="button" disabled={busy} onClick={() => void run()} className="h-11 rounded-xl bg-destructive px-6 font-semibold text-background hover:opacity-90">{busy ? "Revirtiendo…" : "Revertir"}</Button>
      </div>
      {msg && <p aria-live="polite" className={`mt-3 text-[13px] ${msg.ok ? "text-mint-600" : "text-destructive"}`}>{msg.text}</p>}
    </Card>
  );
}

const cents = (n: number) => Math.round(n * 100);
const dmy = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "—");

function Row({ k, v, strong, bad }: { k: string; v: string; strong?: boolean; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
      <span className="text-muted-foreground">{k}</span>
      <span className={`tabular-nums ${strong ? "text-base font-semibold text-foreground" : "text-foreground"} ${bad ? "text-destructive" : ""}`}>{v}</span>
    </div>
  );
}

export function LivePayments() {
  const { user } = usePanel();
  const [loans, setLoans] = useState<LoanSummary[]>([]);
  const [loanId, setLoanId] = useState("");
  const [inst, setInst] = useState<InstallmentRow[]>([]);
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [received, setReceived] = useState(0);
  const [manual, setManual] = useState<{ interest: number; capital: number } | null>(null);
  const [method, setMethod] = useState("cash");
  const [paidOn, setPaidOn] = useState("");
  const [moneyOk, setMoneyOk] = useState(false);
  const [excessOk, setExcessOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [done, setDone] = useState<{ loanId: string; receipt: string; client: string; total: number; interest: number; capital: number; capitalLeft: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadError, setLoadError] = useState(false);
  // La misma clave se reutiliza en reintentos idénticos (evita cobro doble) y se renueva al cambiar datos o tras éxito.
  const key = useRef(crypto.randomUUID());

  const loadPayments = useCallback(() => { fetchPayments().then(setPayments).catch(() => setLoadError(true)); }, []);
  const loadInst = useCallback((id: string) => { if (id) fetchInstallments(id).then(setInst).catch(() => setInst([])); else setInst([]); }, []);
  const loadLoans = useCallback(() => fetchLoanSummaries({ onlyActive: true }).then((l) => { setLoans(l); return l; }), []);

  useEffect(() => {
    setPaidOn(limaToday());
    const wanted = new URLSearchParams(window.location.search).get("loan");
    loadLoans().then((l) => setLoanId(l.find((x) => x.id === wanted)?.id ?? l[0]?.id ?? "")).catch(() => setLoadError(true));
    loadPayments();
  }, [loadPayments, loadLoans]);
  useEffect(() => loadInst(loanId), [loanId, loadInst]);
  useEffect(() => { setReceived(0); setManual(null); setMoneyOk(false); setExcessOk(false); setMsg(null); }, [loanId]);

  const loan = loans.find((l) => l.id === loanId);
  const today = limaToday();

  const obligations: Obligation[] = useMemo(
    () => inst
      .filter((r) => r.interest_paid < r.interest_due || r.capital_paid < r.capital_due)
      .map((r) => ({
        n: r.n, dueDate: r.due_date,
        interestPendingCents: cents(r.interest_due) - cents(r.interest_paid),
        capitalPendingCents: cents(r.capital_due) - cents(r.capital_paid),
      })),
    [inst],
  );
  const ctx: AllocationContext | null = loan
    ? { loanType: loan.loan_type, obligations, today, capitalOutstandingCents: cents(loan.principal_outstanding) }
    : null;

  const alloc = ctx ? (manual ? applyAmounts(cents(manual.interest), cents(manual.capital), ctx) : autoAllocate(cents(received), ctx)) : null;
  const interest = alloc ? alloc.interestCents / 100 : 0;
  const capital = alloc ? alloc.capitalCents / 100 : 0;
  const total = round2(interest + capital);
  const exigibleInterest = obligations.filter((o) => o.dueDate <= today).reduce((s, o) => s + o.interestPendingCents, 0);
  const exigibleTotal = exigibleInterest + obligations.filter((o) => o.dueDate <= today).reduce((s, o) => s + o.capitalPendingCents, 0);
  const nextOb = obligations.find((o) => o.dueDate > today) ?? obligations[0];
  const nextInterestCents = loan && nextOb ? nextOb.interestPendingCents : null;
  const collectable = obligations.reduce((s, o) => s + o.interestPendingCents, 0);

  const problems = [
    ...(alloc ? alloc.errors : []),
    ...(loan && alloc
      ? validatePayment({
          interestCents: alloc.interestCents, capitalCents: alloc.capitalCents, interestCollectableCents: collectable,
          capitalOutstandingCents: cents(loan.principal_outstanding), paidOn, today, loanStartDate: loan.start_date,
        }).filter((e) => !alloc.errors.includes(e) && !e.startsWith("Los intereses exceden") && !e.startsWith("El abono de capital supera"))
      : []),
  ];
  const showProblems = total > 0 ? problems : problems.filter((p) => !p.includes("mayor que cero"));
  const needsExcess = !!alloc && alloc.extraCapitalCents > 0;
  const canSave = !!loan && !!alloc && total > 0 && problems.length === 0 && moneyOk && (!needsExcess || excessOk) && !saving;

  // Clave nueva cada vez que cambia lo que se va a cobrar.
  useEffect(() => { key.current = crypto.randomUUID(); }, [loanId, interest, capital, method, paidOn]);

  // Primer paso: solo abre el modal con el desglose REAL del formulario. No registra nada.
  const submit = () => {
    if (!loan || !alloc || !canSave) return;
    const parsed = paymentSchema.safeParse({ interest: round2(interest), capital: round2(capital), method });
    if (!parsed.success || cents(interest) + cents(capital) !== cents(total)) { setMsg({ ok: false, text: "Revisa los importes." }); return; }
    setMsg(null); setConfirmError(null); setConfirmOpen(true);
  };

  // Segundo paso (tras confirmar): registro real. La misma clave se reutiliza en reintentos, así que no se duplica el cobro.
  const runPayment = async () => {
    if (!loan || !alloc || !canSave || saving) return;
    setSaving(true); setConfirmError(null);
    try {
      const id = await registerPayment({ loanId: loan.id, interest, capital, method, paidOn, idempotencyKey: key.current });
      notifyTelegram(id, "payment");   // aviso best-effort: el pago ya está guardado y un fallo aquí no lo afecta
      const [receipt, fresh] = await Promise.all([fetchReceiptNo(id).catch(() => null), loadLoans().catch(() => null)]);
      loadInst(loan.id); loadPayments();
      // Capital pendiente actualizado: dato confirmado por Supabase (si no se pudo leer, el cálculo previsto).
      const serverLeft = fresh?.find((l) => l.id === loan.id)?.principal_outstanding;
      setDone({
        loanId: loan.id, client: loan.full_name, total, interest, capital,
        receipt: receipt ? `R-${String(receipt).padStart(5, "0")}` : "—",
        capitalLeft: serverLeft ?? (alloc.capitalAfterCents / 100),
      });
      setConfirmOpen(false);
      setReceived(0); setManual(null); setMoneyOk(false); setExcessOk(false);
      key.current = crypto.randomUUID();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "No se pudo registrar el pago. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  if (loadError) return <Card><p className="py-6 text-center text-[13px] text-muted-foreground">No se pudieron cargar los datos.</p></Card>;

  const overdue = loan ? loan.interest_overdue + loan.capital_overdue : 0;
  const nextState = loan ? dueState({ nextDue: loan.next_due_date, today: loan.business_today }) : "none";

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Registrar cobro" desc="Escribe el importe recibido: se reparte solo (primero intereses del período más antiguo). Puedes ajustar la distribución a mano." />
        <TruncationNotice rows={loans} what="préstamos vigentes" />
        {loans.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">No hay préstamos vigentes.</p>
        ) : (
          <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
            <div className="space-y-4">
              <label className="block"><span className={lbl}>Préstamo</span>
                <select value={loanId} onChange={(e) => setLoanId(e.target.value)} className={fieldClass}>
                  {loans.map((l) => <option key={l.id} value={l.id}>{l.code} — {l.full_name} ({LOAN_TYPE_LABEL[l.loan_type]})</option>)}
                </select></label>

              {loan && (
                <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-mint-50 p-3 text-[13px] text-muted-foreground sm:grid-cols-3">
                  <div>Cliente<div className="mt-1 font-semibold text-foreground">{loan.full_name}</div></div>
                  <div>Código<div className="mt-1 font-semibold text-foreground">{loan.code}</div></div>
                  <div>Capital pendiente<div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{moneyDec(loan.principal_outstanding)}</div></div>
                  <div>Interés exigible<div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{moneyDec(exigibleInterest / 100)}</div></div>
                  <div>Vencido<div className={`mt-1 text-lg font-semibold tabular-nums ${overdue > 0 ? "text-destructive" : "text-foreground"}`}>{moneyDec(overdue)}</div>
                    {loan.days_overdue > 0 && <span className="text-xs">{loan.days_overdue} día(s) de atraso</span>}</div>
                  <div>{DUE_STATE_LABEL[nextState]}<div className={`mt-1 font-semibold ${nextState === "overdue" ? "text-destructive" : "text-foreground"}`}>
                    {loan.next_due_date ? dmy(loan.next_due_date) : "—"}{loan.periods_unpaid_exigible > 1 ? ` · ${loan.periods_unpaid_exigible} períodos pendientes` : ""}</div></div>
                  <div>Último pago<div className="mt-1 font-semibold text-foreground">{dmy(loan.last_payment_on)}</div></div>
                  {nextInterestCents !== null && <div>Interés próximo período<div className="mt-1 font-semibold tabular-nums text-foreground">{moneyDec(nextInterestCents / 100)}</div></div>}
                </div>
              )}

              {obligations.length > 0 && (
                <div className="-mx-1 overflow-x-auto">
                  <table className="w-full min-w-[620px] text-left text-[13px] tabular-nums">
                    <thead><tr className="border-y border-border text-xs text-muted-foreground">
                      {["Período", "Vence", "Estado", "Pagado antes", "Interés pend.", "Capital pend.", "Se aplicará", "Quedará"].map((h, i) => <th key={h} className={`px-2 py-2 font-medium ${i > 2 ? "text-right" : ""}`}>{h}</th>)}
                    </tr></thead>
                    <tbody>
                      {obligations.map((o) => {
                        const before = inst.find((r) => r.n === o.n);
                        const ap = alloc?.periods.find((p) => p.n === o.n);
                        const st = dueState({ nextDue: o.dueDate, today });
                        return (
                          <tr key={o.n} className="border-b border-border/60 last:border-0">
                            <td className="px-2 py-2">{o.n}</td>
                            <td className="px-2 py-2 text-muted-foreground">{dmy(o.dueDate)}</td>
                            <td className="px-2 py-2"><span className={st === "overdue" ? "text-destructive" : st === "due_today" ? "font-semibold text-amber-700" : "text-muted-foreground"}>{DUE_STATE_LABEL[st]}</span></td>
                            <td className="px-2 py-2 text-right">{moneyDec(before ? before.interest_paid + before.capital_paid : 0)}</td>
                            <td className="px-2 py-2 text-right">{moneyDec(o.interestPendingCents / 100)}</td>
                            <td className="px-2 py-2 text-right">{moneyDec(o.capitalPendingCents / 100)}</td>
                            <td className="px-2 py-2 text-right">{ap ? moneyDec((ap.interestApplied + ap.capitalApplied) / 100) : "—"}</td>
                            <td className="px-2 py-2 text-right font-medium">{ap ? moneyDec((ap.interestLeft + ap.capitalLeft) / 100) : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block"><span className={lbl}>Importe recibido (S/)</span>
                  <input type="number" min={0} step={0.01} value={manual ? total || "" : received || ""} onChange={(e) => { setManual(null); setReceived(num(e.target.value)); setMoneyOk(false); setExcessOk(false); }} className={fieldClass} /></label>
                <div className="flex items-end">
                  <Button type="button" variant="outline" disabled={exigibleTotal <= 0} onClick={() => { setManual(null); setReceived(exigibleTotal / 100); setMoneyOk(false); }} className="h-11 rounded-xl">
                    Cobrar lo exigible ({moneyDec(exigibleTotal / 100)})
                  </Button>
                </div>
                <label className="block"><span className={lbl}>Interés aplicado (S/)</span>
                  <input type="number" min={0} step={0.01} value={interest || ""} onChange={(e) => { setManual({ interest: num(e.target.value), capital }); setMoneyOk(false); setExcessOk(false); }} className={fieldClass} /></label>
                <label className="block"><span className={lbl}>Capital aplicado (S/)</span>
                  <input type="number" min={0} step={0.01} value={capital || ""} onChange={(e) => { setManual({ interest, capital: num(e.target.value) }); setMoneyOk(false); setExcessOk(false); }} className={fieldClass} /></label>
                <label className="block"><span className={lbl}>Fecha del pago</span>
                  <input type="date" value={paidOn} max={today} min={loan?.start_date} onChange={(e) => setPaidOn(e.target.value)} className={fieldClass} /></label>
                <label className="block"><span className={lbl}>Método</span>
                  <select value={method} onChange={(e) => setMethod(e.target.value)} className={fieldClass}>
                    {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select></label>
              </div>
              {manual && <p className="text-xs text-muted-foreground">Distribución manual. <button type="button" className="underline" onClick={() => { setReceived(total); setManual(null); }}>Volver al reparto automático</button></p>}
            </div>

            <aside className="h-fit rounded-xl border border-border bg-card p-4" aria-label="Desglose antes de guardar">
              <h3 className="mb-2 text-[13px] font-semibold text-foreground">Desglose antes de guardar</h3>
              <div className="divide-y divide-border/60">
                <Row k="Importe recibido" v={moneyDec(total)} strong />
                <Row k="Interés aplicado" v={moneyDec(interest)} />
                <Row k="Capital aplicado" v={moneyDec(capital)} />
                <Row k="Intereses pendientes" v={moneyDec((alloc?.interestPendingAfterCents ?? 0) / 100)} bad={(alloc?.interestPendingAfterCents ?? 0) > 0} />
                <Row k="Capital restante" v={moneyDec((alloc?.capitalAfterCents ?? cents(loan?.principal_outstanding ?? 0)) / 100)} />
                <Row k="Saldo total pendiente" v={moneyDec((alloc?.totalPendingAfterCents ?? 0) / 100)} strong />
              </div>
              {needsExcess && !problems.length && (
                <label className="mt-3 flex gap-2 rounded-lg bg-amber-100 p-2.5 text-xs text-amber-900">
                  <input type="checkbox" checked={excessOk} onChange={(e) => setExcessOk(e.target.checked)} className="mt-0.5" />
                  <span>El excedente de <b>{moneyDec((alloc?.extraCapitalCents ?? 0) / 100)}</b> se aplicará como abono a capital. Confirmo que es lo que corresponde.</span>
                </label>
              )}
              <label className="mt-3 flex gap-2 text-xs text-foreground">
                <input type="checkbox" checked={moneyOk} onChange={(e) => setMoneyOk(e.target.checked)} className="mt-0.5" />
                <span>Confirmo que recibí {moneyDec(total)} del cliente.</span>
              </label>
              <Button type="button" disabled={!canSave || confirmOpen} onClick={submit}
                className="mt-3 h-11 w-full rounded-xl bg-mint-400 font-semibold text-primary-foreground hover:bg-mint-500 disabled:opacity-50">
                Registrar cobro
              </Button>
              <div aria-live="polite" className="mt-2 space-y-1">
                {showProblems.map((p) => <p key={p} className="text-[13px] text-destructive">{p}</p>)}
                {msg && <p className={`text-[13px] ${msg.ok ? "text-mint-600" : "text-destructive"}`}>{msg.text}</p>}
              </div>
            </aside>
          </div>
        )}
      </Card>

      <Modal open={confirmOpen} busy={saving} icon={HandCoins} title="Confirmar registro de pago" onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmOpen(false)} className="h-11 rounded-xl">Cancelar</Button>
            <Button type="button" data-autofocus disabled={saving} onClick={() => void runPayment()} className="h-11 rounded-xl bg-mint-400 px-5 font-semibold text-primary-foreground hover:bg-mint-500">
              {saving ? <><Loader2 className="mr-2 size-4 animate-spin" />Registrando…</> : confirmError ? "Reintentar" : "Confirmar pago"}
            </Button>
          </>
        }>
        <p className="text-foreground">Verifica los datos del cobro antes de confirmar la operación.</p>
        <SummaryList items={[
          ["Cliente", loan?.full_name ?? "—"],
          ["Código del préstamo", loan?.code ?? "—"],
          ["Importe total recibido", moneyDec(total)],
          ["Intereses aplicados", moneyDec(interest)],
          ["Capital aplicado", moneyDec(capital)],
          ["Intereses pendientes después del pago", moneyDec((alloc?.interestPendingAfterCents ?? 0) / 100)],
          ["Capital restante después del pago", moneyDec((alloc?.capitalAfterCents ?? 0) / 100)],
          ["Fecha del pago", dmy(paidOn)],
          ["Método de pago", METHOD[method] ?? method],
        ]} />
        {confirmError && <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">{confirmError} Los datos siguen en el formulario; al reintentar no se duplicará el cobro.</p>}
      </Modal>

      <Modal open={!!done} icon={BadgeCheck} title="¡Pago registrado correctamente!" onClose={() => setDone(null)}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setDone(null)} className="h-11 rounded-xl">Volver a pagos</Button>
            <Button type="button" data-autofocus onClick={() => router.push(`/prestamos?loan=${done?.loanId}`)} className="h-11 rounded-xl bg-mint-400 px-5 font-semibold text-primary-foreground hover:bg-mint-500">Ver préstamo</Button>
          </>
        }>
        <SummaryList items={[
          ["Número de recibo", done?.receipt ?? "—"],
          ["Cliente", done?.client ?? "—"],
          ["Importe recibido", moneyDec(done?.total ?? 0)],
          ["Intereses aplicados", moneyDec(done?.interest ?? 0)],
          ["Capital aplicado", moneyDec(done?.capital ?? 0)],
          ["Capital pendiente actualizado", moneyDec(done?.capitalLeft ?? 0)],
        ]} />
      </Modal>

      {user.roleKey === "admin" && <ReverseCard payments={payments} onDone={() => { loadPayments(); loadInst(loanId); loadLoans().catch(() => undefined); }} />}

      {payments.length === 0 ? (
        <Card><p className="py-6 text-center text-[13px] text-muted-foreground">Aún no hay pagos registrados.</p></Card>
      ) : (
        <DataTable
          title="Pagos recientes"
          columns={[
            { key: "recibo", label: "Recibo" }, { key: "fecha", label: "Fecha", kind: "muted" }, { key: "client", label: "Cliente" },
            { key: "prestamo", label: "Préstamo", kind: "muted" }, { key: "interes", label: "Interés", kind: "money", align: "right" },
            { key: "capital", label: "Capital", kind: "money", align: "right" }, { key: "metodo", label: "Método", kind: "muted" },
            { key: "estado", label: "Estado", kind: "status" },
          ]}
          rows={payments.map((p) => ({
            recibo: `R-${String(p.receipt_no).padStart(5, "0")}`,
            fecha: dmy(p.paid_on),
            client: p.loans?.clients?.full_name ?? "—", prestamo: p.loans?.code ?? "—",
            interes: Number(p.interest_amount), capital: Number(p.capital_amount),
            metodo: METHOD[p.method] ?? p.method, estado: p.status === "reversed" ? "Revertido" : "Confirmado",
          }))}
        />
      )}
    </div>
  );
}

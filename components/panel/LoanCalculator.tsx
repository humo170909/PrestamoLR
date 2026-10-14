"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BadgeCheck, Banknote, Info, Loader2, TriangleAlert } from "lucide-react";
import { Modal, SummaryList } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { CLIENTS } from "@/lib/mock";
import { limaToday, moneyDec } from "@/lib/format";
import { FREQUENCY_LABEL, MAX_PERIODS, percentToBps, toCents, type Frequency } from "@/lib/finance/interest-only";
import {
  LOAN_TYPE_HINT, LOAN_TYPE_LABEL, previewLoan, validateLoan, type LoanPreview, type LoanType, type NewLoanTerms,
} from "@/lib/finance/loan-rules";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createLoan, fetchLoanCode, listClients, type ClientOption } from "@/lib/data/loans";
import { loadSettings } from "@/lib/data/settings";
import { BarCard } from "./charts";
import { Card, CardHeader, PageHeader, TruncationNotice, fieldClass } from "./ui";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const cents = (c: number) => moneyDec(c / 100);
const num = (v: string) => (Number.isFinite(parseFloat(v)) ? Math.max(0, parseFloat(v)) : 0);
const fmtDate = (iso: string) => iso.split("-").reverse().join("/");

// Sin Supabase: clientes de demostración. Con Supabase: clientes reales (se cargan en el componente).
const DEMO_OPTIONS: ClientOption[] = isSupabaseConfigured ? [] : CLIENTS.map((c) => ({ id: String(c.dni), full_name: String(c.name), document_id: String(c.dni) }));

export function LoanCalculator({ mode }: { mode: "sim" | "new" }) {
  const [loanType, setLoanType] = useState<LoanType>("interest_only");
  const [monto, setMonto] = useState(1000);
  const [tasa, setTasa] = useState(10); // % por período de pago
  const [plazo, setPlazo] = useState(3);
  const [frecuencia, setFrecuencia] = useState<Frequency>("monthly");
  const [fecha, setFecha] = useState("");
  const [options, setOptions] = useState<ClientOption[]>(DEMO_OPTIONS);
  const [cliente, setCliente] = useState(DEMO_OPTIONS[0]?.id ?? "");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [clientsError, setClientsError] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; code: string; summary: [string, string][] } | null>(null);
  // Misma clave en reintentos idénticos (si falla la red tras desembolsar no se duplica el préstamo); se renueva al cambiar las condiciones.
  const loanKey = useRef(crypto.randomUUID());

  // La fecha por defecto se fija en el cliente para no desincronizar la hidratación.
  useEffect(() => {
    setFecha(limaToday());
  }, []);
  useEffect(() => { setPrepared(false); setResult(null); loanKey.current = crypto.randomUUID(); }, [loanType, monto, tasa, plazo, frecuencia, fecha, cliente]);
  useEffect(() => {
    if (mode !== "new" || !isSupabaseConfigured) return;
    loadSettings().then((s) => setTasa(s.default_rate_pct)).catch(() => undefined);
    listClients()
      .then((l) => { setOptions(l); setCliente(l[0]?.id ?? ""); setClientsError(false); })
      .catch(() => setClientsError(true));
  }, [mode]);

  const terms: NewLoanTerms = useMemo(
    () => ({ loanType, principalCents: toCents(monto), rateBps: percentToBps(tasa), periods: loanType === "open" ? null : plazo, frequency: frecuencia, startDate: fecha }),
    [loanType, monto, tasa, plazo, frecuencia, fecha],
  );
  const errors = useMemo(() => (fecha ? validateLoan(terms) : []), [terms, fecha]);
  const projection: LoanPreview | null = useMemo(
    () => (fecha && errors.length === 0 ? previewLoan(terms) : null),
    [terms, fecha, errors],
  );
  const isOpen = loanType === "open";
  const labels = FREQUENCY_LABEL[frecuencia];
  const noClients = mode === "new" && options.length === 0;
  const live = isSupabaseConfigured;

  const clientName = options.find((o) => o.id === cliente)?.full_name ?? "—";
  const summaryItems = (): [string, string][] => [
    ["Cliente", clientName],
    ["Capital del préstamo", cents(terms.principalCents)],
    ["Modalidad", LOAN_TYPE_LABEL[loanType]],
    ["Tasa de interés", `${tasa}% por ${labels.period}`],
    ["Frecuencia de pago", { monthly: "Mensual", biweekly: "Quincenal", weekly: "Semanal" }[frecuencia]],
    ["Fecha de desembolso", fmtDate(fecha)],
  ];

  // El préstamo se crea SOLO tras confirmar en el modal. La misma clave se reutiliza en reintentos: nunca se duplica.
  const runLoan = async () => {
    if (!projection || saving) return;
    setSaving(true); setConfirmError(null);
    try {
      const id = await createLoan(cliente, terms, loanKey.current);
      const code = (await fetchLoanCode(id).catch(() => null)) ?? "—";
      setCreated({ id, code, summary: summaryItems() });
      setConfirmOpen(false);
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "No se pudo registrar el préstamo. Inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <PageHeader
        title={mode === "new" ? "Nuevo préstamo" : "Simulador"}
        desc={
          mode === "new"
            ? "Elige la modalidad, define las condiciones y revisa la vista previa. El interés siempre se calcula sobre el capital original."
            : "Proyecta intereses y vencimiento del capital para mostrar al cliente. No se guarda nada."
        }
      />
      <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
        <Card className="space-y-4 self-start">
          <CardHeader title="Condiciones del crédito" />
          {mode === "new" && (
            <Field label="Cliente">
              <TruncationNotice rows={options} what="clientes" />
              {clientsError ? (
                <p role="alert" className="rounded-xl border border-border bg-amber-100 px-3.5 py-3 text-[13px] text-amber-900">
                  No se pudieron cargar los clientes. Recarga la página para reintentar.
                </p>
              ) : noClients ? (
                <p className="rounded-xl border border-border bg-mint-50 px-3.5 py-3 text-[13px] text-muted-foreground">
                  No hay clientes visibles. Registra primero un cliente.
                </p>
              ) : (
                <select value={cliente} onChange={(e) => setCliente(e.target.value)} className={fieldClass}>
                  {options.map((o) => <option key={o.id} value={o.id}>{o.full_name}</option>)}
                </select>
              )}
            </Field>
          )}
          <Field label="Tipo de préstamo">
            <select value={loanType} onChange={(e) => setLoanType(e.target.value as LoanType)} className={fieldClass}>
              {(Object.keys(LOAN_TYPE_LABEL) as LoanType[]).map((k) => <option key={k} value={k}>{LOAN_TYPE_LABEL[k]}</option>)}
            </select>
            <span className="mt-1.5 block text-xs text-muted-foreground">{LOAN_TYPE_HINT[loanType]}</span>
          </Field>
          <Field label="Capital (S/)">
            <input type="number" min={1} step={50} value={monto} onChange={(e) => setMonto(num(e.target.value))} className={fieldClass} />
          </Field>
          <input aria-label="Ajustar capital" type="range" style={{ minHeight: 32 }} min={100} max={30000} step={100} value={Math.min(Math.max(monto, 100), 30000)} onChange={(e) => setMonto(Number(e.target.value))} className="w-full accent-[var(--mint-500)]" />
          <Field label="Frecuencia de pago">
            <select value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as Frequency)} className={fieldClass}>
              <option value="monthly">Mensual</option>
              <option value="biweekly">Quincenal</option>
              <option value="weekly">Semanal</option>
            </select>
          </Field>
          <div className={isOpen ? "" : "grid grid-cols-2 gap-3"}>
            <Field label={labels.rate}>
              <input type="number" min={0} step={0.1} value={tasa} onChange={(e) => setTasa(num(e.target.value))} className={fieldClass} />
            </Field>
            {!isOpen && (
              <Field label={labels.periods}>
                <input type="number" min={1} max={MAX_PERIODS} value={plazo} onChange={(e) => setPlazo(Math.min(MAX_PERIODS, Math.max(0, Math.round(num(e.target.value)))))} className={fieldClass} />
              </Field>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {isOpen ? `La tasa se aplica por ${labels.period} sobre el capital PENDIENTE: cada abono baja el interés de los períodos siguientes (los ya cobrados no cambian).` : `La tasa se aplica por ${labels.period} sobre el capital original (interés directo). Los abonos de capital bajan el saldo pero no cambian los intereses.`}
          </p>
          <Field label="Fecha de desembolso">
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={fieldClass} />
          </Field>

          {errors.length > 0 && (
            <ul role="alert" className="space-y-1 text-[13px] text-destructive">
              {errors.map((e) => <li key={e} className="flex gap-2"><TriangleAlert className="mt-0.5 size-4 shrink-0" />{e}</li>)}
            </ul>
          )}

          {mode === "new" && (
            <>
              <Button
                type="button"
                disabled={!projection || noClients || saving || confirmOpen}
                onClick={() => (live ? (setConfirmError(null), setConfirmOpen(true)) : setPrepared(true))}
                className="h-12 w-full rounded-xl bg-mint-400 font-semibold text-primary-foreground transition-all duration-200 ease-out-expo hover:-translate-y-0.5 hover:bg-mint-500 active:scale-[0.97] disabled:opacity-50"
              >
                {live ? "Registrar y desembolsar" : "Validar y generar cronograma"}
              </Button>
              <div aria-live="polite">
                {result && <p className={`flex gap-2 text-[13px] ${result.ok ? "text-mint-600" : "text-destructive"}`}>{result.msg}</p>}
                {!live && prepared && projection && (
                  <p className="flex gap-2 text-[13px] text-muted-foreground">
                    <Info className="mt-0.5 size-4 shrink-0 text-mint-600" />
                    Condiciones válidas (demostración). El préstamo NO se registra sin Supabase.
                  </p>
                )}
              </div>
            </>
          )}
        </Card>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[
              ["Fecha del siguiente cobro", projection ? fmtDate(projection.next.dueDate) : "—"],
              ["Interés previsto", projection ? cents(projection.next.interestCents) : "—"],
              ["Capital previsto", projection ? cents(projection.next.capitalCents) : "—"],
              ["Importe total previsto", projection ? cents(projection.next.totalCents) : "—"],
              ["Capital pendiente estimado", projection ? cents(projection.next.capitalAfterCents) : "—"],
              ...(isOpen ? [] : [["Total proyectado (capital + intereses)", projection?.totalContractCents != null ? cents(projection.totalContractCents) : "—"]]),
            ].map(([l, v]) => (
              <Card key={l}>
                <div className="text-[13px] text-muted-foreground">{l}</div>
                <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{v}</div>
              </Card>
            ))}
          </div>
          {isOpen && (
            <p className="flex gap-2 rounded-xl border border-border bg-mint-50 px-3.5 py-3 text-[13px] text-muted-foreground">
              <Info className="mt-0.5 size-4 shrink-0 text-mint-600" />
              Préstamo abierto: no hay cuotas ni fecha final. Cada cobro se registra a mano y el préstamo solo se cierra cuando el capital pendiente llega a cero.
            </p>
          )}

          {projection && !isOpen && (
            <BarCard
              title="Capital e interés por vencimiento"
              data={projection.rows.map((r) => ({ cuota: `N.º ${r.n}`, capital: r.capitalCents / 100, interes: r.interestCents / 100 }))}
              xKey="cuota"
              height={220}
              series={[
                { key: "capital", label: "Capital", color: "var(--chart-3)" },
                { key: "interes", label: "Interés", color: "var(--chart-1)" },
              ]}
            />
          )}

          {!isOpen && <Card>
            <CardHeader title="Cronograma" desc={loanType === "fixed" ? "Capital en partes iguales más interés sobre el capital original" : "Interés sobre el capital original; el capital se devuelve en el último vencimiento"} />
            <div className="-mx-5 max-h-[360px] overflow-auto">
              <table className="w-full min-w-[620px] text-left text-sm">
                <thead className="sticky top-0 bg-card">
                  <tr className="border-y border-border text-xs text-muted-foreground">
                    {["N.º", "Vence", "Interés", "Capital", "Total a pagar", "Capital pendiente"].map((h, i) => (
                      <th key={h} className={`px-5 py-2.5 font-medium ${i > 1 ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {projection?.rows.map((r) => (
                    <tr key={r.n} className="border-b border-border/60 last:border-0">
                      <td className="px-5 py-2.5">{r.n}</td>
                      <td className="px-5 py-2.5 text-muted-foreground">{fmtDate(r.dueDate)}</td>
                      <td className="px-5 py-2.5 text-right">{cents(r.interestCents)}</td>
                      <td className="px-5 py-2.5 text-right">{cents(r.capitalCents)}</td>
                      <td className="px-5 py-2.5 text-right font-medium">{cents(r.totalCents)}</td>
                      <td className="px-5 py-2.5 text-right">{cents(r.capitalAfterCents)}</td>
                    </tr>
                  ))}
                  {!projection && (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">Completa condiciones válidas para ver el cronograma.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>}
        </div>
      </div>

      <Modal open={confirmOpen} busy={saving} icon={Banknote} title="Confirmar desembolso" onClose={() => setConfirmOpen(false)}
        footer={
          <>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmOpen(false)} className="h-11 rounded-xl">Cancelar</Button>
            <Button type="button" data-autofocus disabled={saving} onClick={() => void runLoan()} className="h-11 rounded-xl bg-mint-400 px-5 font-semibold text-primary-foreground hover:bg-mint-500">
              {saving ? <><Loader2 className="mr-2 size-4 animate-spin" />Registrando…</> : confirmError ? "Reintentar" : "Confirmar desembolso"}
            </Button>
          </>
        }>
        <p className="text-foreground">¿Estás seguro de que deseas registrar y desembolsar este préstamo?</p>
        <SummaryList items={[...summaryItems(), ["Importe que se entregará al cliente", cents(terms.principalCents)]]} />
        {confirmError && <p role="alert" className="mt-3 rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">{confirmError} Tus datos siguen en el formulario; al reintentar no se duplicará el préstamo.</p>}
      </Modal>

      <Modal open={!!created} icon={BadgeCheck} title="¡Préstamo registrado correctamente!" onClose={() => setCreated(null)}
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => router.push(`/prestamos?highlight=${created?.id}`)} className="h-11 rounded-xl">Ir a la lista de préstamos</Button>
            <Button type="button" data-autofocus onClick={() => router.push(`/prestamos?loan=${created?.id}`)} className="h-11 rounded-xl bg-mint-400 px-5 font-semibold text-primary-foreground hover:bg-mint-500">Ver préstamo</Button>
          </>
        }>
        <p className="text-foreground">El préstamo se registró y desembolsó correctamente. Ahora puedes consultar su información, revisar el cronograma y registrar los próximos cobros.</p>
        <SummaryList items={[["Código del préstamo", created?.code ?? "—"], ...(created?.summary.filter(([k]) => ["Cliente", "Capital del préstamo", "Modalidad", "Fecha de desembolso"].includes(k)) ?? [])]} />
      </Modal>
    </>
  );
}

"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { DEFAULT_SETTINGS, loadSettings, saveSettings, settingsSchema, type Settings } from "@/lib/data/settings";
import { LiveTelegram } from "./LiveTelegram";
import { usePanel } from "./PanelContext";
import { Card, CardHeader, fieldClass } from "./ui";

const lbl = "mb-1.5 block text-[13px] text-muted-foreground";

export function LiveSettings() {
  const { user } = usePanel();
  const canEdit = user.roleKey === "admin";
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    loadSettings().then(setS).catch(() => setMsg({ ok: false, text: "No se pudo cargar la configuración." })).finally(() => setReady(true));
  }, []);

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setS((p) => ({ ...p, [k]: v })); setMsg(null); };
  const n = (v: string) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0);

  const save = async () => {
    const r = settingsSchema.safeParse(s);
    if (!r.success) { setMsg({ ok: false, text: r.error.issues[0].message }); return; }
    setBusy(true);
    try { await saveSettings(r.data); setMsg({ ok: true, text: "Configuración guardada." }); }
    catch { setMsg({ ok: false, text: "No se pudo guardar (solo administradores)." }); }
    finally { setBusy(false); }
  };

  if (!ready) return <Card><p className="py-6 text-center text-[13px] text-muted-foreground">Cargando…</p></Card>;

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="space-y-4">
        <CardHeader title="Datos del negocio" />
        <label className="block"><span className={lbl}>Razón social</span>
          <input disabled={!canEdit} value={s.business_name} onChange={(e) => set("business_name", e.target.value)} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>RUC</span>
          <input disabled={!canEdit} inputMode="numeric" maxLength={11} value={s.ruc} onChange={(e) => set("ruc", e.target.value)} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>Dirección</span>
          <input disabled={!canEdit} value={s.address} onChange={(e) => set("address", e.target.value)} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>Moneda</span>
          <select disabled={!canEdit} value={s.currency} onChange={(e) => set("currency", e.target.value as Settings["currency"])} className={fieldClass}>
            <option value="PEN">Sol peruano (S/)</option><option value="USD">Dólar (US$)</option></select></label>
      </Card>
      <Card className="space-y-4">
        <CardHeader title="Reglas de crédito" desc="La tasa es la sugerida al crear un préstamo. La multa y los días de gracia se guardan, pero aún no se aplican automáticamente." />
        <label className="block"><span className={lbl}>Tasa por período de pago por defecto (%)</span>
          <input disabled={!canEdit} type="number" min={0} step={0.1} value={s.default_rate_pct} onChange={(e) => set("default_rate_pct", n(e.target.value))} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>Multa por mora (%)</span>
          <input disabled={!canEdit} type="number" min={0} step={0.1} value={s.late_fee_pct} onChange={(e) => set("late_fee_pct", n(e.target.value))} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>Días de gracia</span>
          <input disabled={!canEdit} type="number" min={0} value={s.grace_days} onChange={(e) => set("grace_days", Math.round(n(e.target.value)))} className={fieldClass} /></label>
        {canEdit ? (
          <Button type="button" disabled={busy} onClick={() => void save()} className="h-12 w-full rounded-xl bg-mint-400 font-semibold text-primary-foreground hover:bg-mint-500">
            {busy ? "Guardando…" : "Guardar cambios"}
          </Button>
        ) : <p className="text-[13px] text-muted-foreground">Solo los administradores pueden modificar la configuración.</p>}
        <p aria-live="polite" className={`text-[13px] ${msg?.ok ? "text-mint-600" : "text-destructive"}`}>{msg?.text}</p>
      </Card>
      {canEdit && <LiveTelegram />}
    </div>
  );
}

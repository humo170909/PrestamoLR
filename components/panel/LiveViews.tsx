"use client";

import { useCallback, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { BadgeCheck, Loader2, Pencil, UserCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { usePanel } from "./PanelContext";
import {
  clientEditSchema, clientSchema, fetchClients, fetchCollectors, insertClient, updateClient,
  type ClientInput, type ClientRow,
} from "@/lib/data/clients";
import { DataTable } from "./DataTable";
import { Card, CardHeader, TruncationNotice, fieldClass } from "./ui";


function useLoad<T>(fn: () => Promise<T[]>) {
  const [rows, setRows] = useState<T[]>([]);
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const reload = useCallback(() => {
    setState("loading");
    fn().then((r) => { setRows(r); setState("ok"); }).catch(() => setState("error"));
  }, [fn]);
  useEffect(reload, [reload]);
  return { rows, state, reload };
}

const Msg = ({ children }: { children: React.ReactNode }) => (
  <Card><p className="py-6 text-center text-[13px] text-muted-foreground">{children}</p></Card>
);

function ClientForm({ onSaved }: { onSaved: () => void }) {
  const [collectors, setCollectors] = useState<{ id: string; full_name: string }[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<ClientInput>({
    resolver: zodResolver(clientSchema),
    defaultValues: { full_name: "", document_id: "", phone: "", address: "", assigned_collector: "" },
  });
  useEffect(() => { void fetchCollectors().then(setCollectors); }, []);

  const submit = handleSubmit(async (v) => {
    setMsg(null);
    try {
      await insertClient(v);
      reset();
      setMsg({ ok: true, text: "Cliente registrado." });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo registrar." });
    }
  });
  const err = (m?: string) => m && <span className="mt-1 block text-xs text-destructive">{m}</span>;
  const lbl = "mb-1.5 block text-[13px] text-muted-foreground";

  return (
    <Card>
      <CardHeader title="Nuevo cliente" />
      <form onSubmit={submit} noValidate className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <label className="block"><span className={lbl}>Nombre completo</span>
          <input {...register("full_name")} className={fieldClass} />{err(errors.full_name?.message)}</label>
        <label className="block"><span className={lbl}>DNI</span>
          <input {...register("document_id")} inputMode="numeric" maxLength={8} className={fieldClass} />{err(errors.document_id?.message)}</label>
        <label className="block"><span className={lbl}>Teléfono</span>
          <input {...register("phone")} className={fieldClass} /></label>
        <label className="block md:col-span-2"><span className={lbl}>Dirección</span>
          <input {...register("address")} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>Cobrador asignado</span>
          <select {...register("assigned_collector")} className={fieldClass}>
            <option value="">Sin asignar</option>
            {collectors.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select></label>
        <div className="flex items-center gap-3 md:col-span-2 xl:col-span-3">
          <Button type="submit" disabled={isSubmitting} className="h-11 rounded-xl bg-mint-400 px-6 font-semibold text-primary-foreground hover:bg-mint-500">
            {isSubmitting ? "Guardando…" : "Registrar cliente"}
          </Button>
          <span aria-live="polite" className={`text-[13px] ${msg?.ok ? "text-mint-600" : "text-destructive"}`}>{msg?.text}</span>
        </div>
      </form>
    </Card>
  );
}

type Collector = { id: string; full_name: string };

/** Edición de un cliente: solo datos personales/administrativos; se identifica por su id y no se tocan préstamos ni pagos. */
function EditClientModal({ client, collectors, onClose, onSaved }: {
  client: ClientRow | null; collectors: Collector[]; onClose: () => void; onSaved: (name: string) => void;
}) {
  const blank = { full_name: "", document_id: "", phone: "", address: "", assigned_collector: "", active: true };
  const [f, setF] = useState(blank);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [clearOk, setClearOk] = useState(false);

  useEffect(() => {
    if (!client) return;
    setF({ full_name: client.full_name, document_id: client.document_id, phone: client.phone ?? "", address: client.address ?? "", assigned_collector: client.assigned_collector ?? "", active: client.active });
    setError(null); setFieldErr({}); setClearOk(false);
  }, [client]);

  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => { setF((p) => ({ ...p, [k]: v })); setError(null); setFieldErr((e) => ({ ...e, [k]: "" })); };
  // Vaciar un dato que ya existía es decisión explícita del usuario: se pide confirmarlo.
  const clearing = client ? ([["phone", "teléfono"], ["address", "dirección"], ["assigned_collector", "cobrador asignado"]] as const)
    .filter(([k]) => (client[k] ?? "") !== "" && f[k].trim() === "").map(([, label]) => label) : [];
  const changed = !!client && (f.full_name !== client.full_name || f.document_id !== client.document_id || f.phone !== (client.phone ?? "")
    || f.address !== (client.address ?? "") || f.assigned_collector !== (client.assigned_collector ?? "") || f.active !== client.active);
  const known = client?.assigned_collector && !collectors.some((c) => c.id === client.assigned_collector);

  const save = async () => {
    if (!client || saving) return;
    const parsed = clientEditSchema.safeParse(f);
    if (!parsed.success) {
      const e: Record<string, string> = {};
      for (const i of parsed.error.issues) e[String(i.path[0])] = i.message;
      setFieldErr(e); return;
    }
    if (clearing.length > 0 && !clearOk) { setError("Confirma que quieres vaciar: " + clearing.join(", ") + "."); return; }
    setSaving(true); setError(null);
    try { await updateClient(client.id, parsed.data); onSaved(parsed.data.full_name); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar. Inténtalo de nuevo."); }
    finally { setSaving(false); }
  };

  const lbl = "mb-1.5 block text-[13px] text-muted-foreground";
  const err = (k: string) => fieldErr[k] && <span className="mt-1 block text-xs text-destructive">{fieldErr[k]}</span>;
  return (
    <Modal open={!!client} busy={saving} icon={UserCog} title="Editar cliente" onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose} className="h-11 rounded-xl">Cancelar</Button>
          <Button type="button" disabled={saving || !changed} onClick={() => void save()} className="h-11 rounded-xl bg-mint-400 px-5 font-semibold text-primary-foreground hover:bg-mint-500">
            {saving ? <><Loader2 className="mr-2 size-4 animate-spin" />Guardando…</> : "Guardar cambios"}
          </Button>
        </>
      }>
      <p className="text-[13px]">Solo se actualizan los datos del cliente. Sus préstamos, pagos y caja no se modifican.</p>
      <form className="mt-3 grid gap-3" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <label className="block"><span className={lbl}>Nombre completo *</span>
          <input data-autofocus value={f.full_name} onChange={(e) => set("full_name", e.target.value)} className={fieldClass} disabled={saving} />{err("full_name")}</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block"><span className={lbl}>DNI *</span>
            <input value={f.document_id} inputMode="numeric" maxLength={8} onChange={(e) => set("document_id", e.target.value)} className={fieldClass} disabled={saving} />{err("document_id")}</label>
          <label className="block"><span className={lbl}>Teléfono</span>
            <input value={f.phone} inputMode="tel" onChange={(e) => set("phone", e.target.value)} className={fieldClass} disabled={saving} />{err("phone")}</label>
        </div>
        <label className="block"><span className={lbl}>Dirección</span>
          <input value={f.address} onChange={(e) => set("address", e.target.value)} className={fieldClass} disabled={saving} />{err("address")}</label>
        <label className="block"><span className={lbl}>Cobrador asignado</span>
          <select value={f.assigned_collector} onChange={(e) => set("assigned_collector", e.target.value)} className={fieldClass} disabled={saving}>
            <option value="">Sin asignar</option>
            {known && client?.assigned_collector && <option value={client.assigned_collector}>Asignación actual (no disponible para nuevas asignaciones)</option>}
            {collectors.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>{err("assigned_collector")}</label>
        <label className="flex items-center gap-2.5 text-[13px] text-foreground">
          <input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} disabled={saving} className="size-4 accent-[var(--mint-500)]" />
          Cliente activo <span className="text-xs text-muted-foreground">(un cliente inactivo no aparece al crear préstamos; sus préstamos siguen igual)</span>
        </label>
        {clearing.length > 0 && (
          <label className="flex gap-2 rounded-xl bg-amber-100 p-3 text-xs text-amber-900">
            <input type="checkbox" checked={clearOk} onChange={(e) => setClearOk(e.target.checked)} className="mt-0.5" />
            <span>Vas a vaciar: <b>{clearing.join(", ")}</b>. Confirmo que quiero borrar ese dato.</span>
          </label>
        )}
        {error && <p role="alert" className="rounded-xl bg-destructive/10 px-3.5 py-2.5 text-[13px] text-destructive">{error} Tus cambios siguen en el formulario.</p>}
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

export function LiveClients() {
  const { rows, state, reload } = useLoad<ClientRow>(fetchClients);
  const { user } = usePanel();
  const canEdit = user.roleKey === "admin" || user.roleKey === "advisor";   // la base de datos (RLS) lo exige igualmente
  const [collectors, setCollectors] = useState<Collector[]>([]);
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [savedName, setSavedName] = useState<string | null>(null);
  useEffect(() => { if (canEdit) void fetchCollectors().then(setCollectors); }, [canEdit]);
  return (
    <div className="space-y-4">
      <ClientForm onSaved={reload} />
      <EditClientModal client={editing} collectors={collectors} onClose={() => setEditing(null)}
        onSaved={(name) => { setEditing(null); setSavedName(name); reload(); }} />
      <Modal open={savedName !== null} icon={BadgeCheck} title="Cliente actualizado correctamente" onClose={() => setSavedName(null)}
        footer={<Button type="button" data-autofocus onClick={() => setSavedName(null)} className="h-11 rounded-xl bg-mint-400 px-5 font-semibold text-primary-foreground hover:bg-mint-500">Aceptar</Button>}>
        <p className="text-foreground">Los datos de <b>{savedName}</b> se guardaron. Sus préstamos y pagos siguen asociados sin cambios.</p>
      </Modal>
      <TruncationNotice rows={rows} what="clientes" />
      {state === "loading" ? <Msg>Cargando clientes…</Msg> : state === "error" ? <Msg>No se pudieron cargar los clientes.</Msg> : rows.length === 0 ? <Msg>Aún no hay clientes registrados.</Msg> : (
        <DataTable
          title="Clientes"
          columns={[{ key: "name", label: "Nombre" }, { key: "dni", label: "DNI", kind: "muted" }, { key: "phone", label: "Teléfono", kind: "muted" }, { key: "estado", label: "Estado", kind: "status" }]}
          rows={rows.map((c) => ({ _id: c.id, name: c.full_name, dni: c.document_id, phone: c.phone ?? "—", estado: c.active ? "Activo" : "Inactivo" }))}
          actions={canEdit ? (r) => {
            const c = rows.find((x) => x.id === r._id);
            return c ? (
              <Button type="button" variant="outline" onClick={() => setEditing(c)} aria-label={`Editar a ${c.full_name}`} className="h-9 rounded-lg px-3 text-sm">
                <Pencil className="mr-1.5 size-4" />Editar
              </Button>
            ) : null;
          } : undefined}
        />
      )}
    </div>
  );
}

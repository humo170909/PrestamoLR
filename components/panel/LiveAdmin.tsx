"use client";

import { useEffect, useState } from "react";
import { ROLE_LABEL, type Role } from "@/lib/auth";
import {
  createUserRequest, fetchAudit, fetchProfiles, fetchWorkerStats, updateProfile,
  type AuditRow, type ProfileRow, type WorkerStat,
} from "@/lib/data/admin";
import { DataTable } from "./DataTable";
import { usePanel } from "./PanelContext";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, fieldClass } from "./ui";

const Msg = ({ children }: { children: React.ReactNode }) => (
  <Card><p className="py-6 text-center text-[13px] text-muted-foreground">{children}</p></Card>
);

const ACTION: Record<string, string> = {
  INSERT: "Creación", UPDATE: "Modificación", REGISTER_PAYMENT: "Pago registrado", REVERSE_PAYMENT: "Pago revertido",
};
const ENTITY: Record<string, string> = {
  profiles: "Usuarios", clients: "Clientes", loans: "Préstamos", payments: "Pagos", loan_events: "Eventos de préstamo",
};

export function LiveAudit() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);

  useEffect(() => {
    Promise.all([fetchAudit(), fetchProfiles()])
      .then(([a, p]) => { setRows(a); setNames(Object.fromEntries(p.map((x) => [x.id, x.full_name]))); })
      .catch(() => setError(true));
  }, []);

  if (error) return <Msg>No se pudo cargar la auditoría (solo administradores).</Msg>;
  if (!rows) return <Msg>Cargando…</Msg>;
  if (rows.length === 0) return <Msg>Aún no hay actividad registrada.</Msg>;

  return (
    <DataTable
      title="Actividad del sistema" desc="Últimos 200 registros"
      columns={[
        { key: "fecha", label: "Fecha", kind: "muted" }, { key: "usuario", label: "Usuario" }, { key: "accion", label: "Acción" },
        { key: "modulo", label: "Módulo", kind: "muted" }, { key: "detalle", label: "Detalle", kind: "muted" },
      ]}
      rows={rows.map((r) => {
        const a = r.after ?? {};
        const detalle = r.action === "REGISTER_PAYMENT" ? `Interés ${a.interest}, capital ${a.capital}`
          : r.action === "REVERSE_PAYMENT" ? `Motivo: ${a.reason}`
          : typeof a.code === "string" ? a.code : (r.entity_id ?? "").slice(0, 8);
        return {
          fecha: new Date(r.created_at).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" }),
          usuario: r.actor ? (names[r.actor] ?? "Usuario") : "Sistema",
          accion: ACTION[r.action] ?? r.action, modulo: ENTITY[r.entity] ?? r.entity, detalle,
        };
      })}
    />
  );
}

const ROLES: Role[] = ["admin", "advisor", "collector"];
const lbl = "mb-1.5 block text-[13px] text-muted-foreground";

function NewUserForm({ onCreated }: { onCreated: () => void }) {
  const [f, setF] = useState({ full_name: "", email: "", password: "", role: "collector" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof typeof f, v: string) => { setF((p) => ({ ...p, [k]: v })); setMsg(null); };

  const submit = async () => {
    if (f.full_name.trim().length < 3 || !f.email.includes("@") || f.password.length < 8) {
      setMsg({ ok: false, text: "Completa nombre, correo válido y contraseña de al menos 8 caracteres." }); return;
    }
    setBusy(true);
    try {
      await createUserRequest(f);
      setF({ full_name: "", email: "", password: "", role: "collector" });
      setMsg({ ok: true, text: "Usuario creado." });
      onCreated();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "No se pudo crear." });
    } finally { setBusy(false); }
  };

  return (
    <Card>
      <CardHeader title="Nuevo usuario" desc="Se crea con acceso inmediato. Comparte la contraseña por un canal seguro." />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="block"><span className={lbl}>Nombre completo</span><input value={f.full_name} onChange={(e) => set("full_name", e.target.value)} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>Correo</span><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>Contraseña</span><input type="password" autoComplete="new-password" value={f.password} onChange={(e) => set("password", e.target.value)} className={fieldClass} /></label>
        <label className="block"><span className={lbl}>Rol</span>
          <select value={f.role} onChange={(e) => set("role", e.target.value)} className={fieldClass}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select></label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <Button type="button" disabled={busy} onClick={() => void submit()} className="h-11 rounded-xl bg-mint-400 px-6 font-semibold text-primary-foreground hover:bg-mint-500">{busy ? "Creando…" : "Crear usuario"}</Button>
        <span aria-live="polite" className={`text-[13px] ${msg?.ok ? "text-mint-600" : "text-destructive"}`}>{msg?.text}</span>
      </div>
    </Card>
  );
}

export function LiveUsers() {
  const { user } = usePanel();
  const [rows, setRows] = useState<ProfileRow[] | null>(null);
  const [error, setError] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const load = () => { fetchProfiles().then(setRows).catch(() => setError(true)); };
  useEffect(load, []);

  if (user.roleKey !== "admin") return <Msg>Solo los administradores pueden gestionar usuarios.</Msg>;
  if (error) return <Msg>No se pudieron cargar los usuarios.</Msg>;
  if (!rows) return <Msg>Cargando…</Msg>;

  const change = async (id: string, patch: { role?: string; active?: boolean }) => {
    setMsg(null);
    try { await updateProfile(id, patch); load(); } catch (e) { setMsg(e instanceof Error ? e.message : "No se pudo actualizar."); }
  };

  return (
    <div className="space-y-4">
      <NewUserForm onCreated={load} />
      <Card>
        <CardHeader title="Usuarios" desc="Cambiar rol o desactivar. No puedes modificar tu propio usuario." />
        <div className="-mx-5 overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead><tr className="border-y border-border text-xs text-muted-foreground">
              <th className="px-5 py-2.5 font-medium">Nombre</th><th className="px-5 py-2.5 font-medium">Rol</th><th className="px-5 py-2.5 font-medium">Estado</th>
            </tr></thead>
            <tbody>
              {rows.map((p) => {
                const self = p.id === user.id;
                return (
                  <tr key={p.id} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-2.5">{p.full_name}</td>
                    <td className="px-5 py-2.5">
                      <select disabled={self} value={p.role} onChange={(e) => void change(p.id, { role: e.target.value })} className={`${fieldClass} h-9 max-w-[200px]`}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</select>
                    </td>
                    <td className="px-5 py-2.5">
                      <button type="button" disabled={self} onClick={() => void change(p.id, { active: !p.active })}
                        className="min-h-10 rounded-full border border-border px-4 py-2 text-xs hover:bg-mint-50 disabled:opacity-50">{p.active ? "Activo · desactivar" : "Inactivo · activar"}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {msg && <p role="alert" className="mt-3 text-[13px] text-destructive">{msg}</p>}
      </Card>
    </div>
  );
}

export function LiveWorkers() {
  const { user } = usePanel();
  const [rows, setRows] = useState<WorkerStat[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => { fetchWorkerStats().then(setRows).catch(() => setError(true)); }, []);

  if (user.roleKey !== "admin") return <Msg>Solo los administradores ven el rendimiento del personal.</Msg>;
  if (error) return <Msg>No se pudo cargar el personal.</Msg>;
  if (!rows) return <Msg>Cargando…</Msg>;
  return (
    <DataTable
      title="Equipo" desc="Clientes asignados y total cobrado (intereses + capital, pagos confirmados)"
      columns={[
        { key: "name", label: "Nombre" }, { key: "rol", label: "Rol", kind: "muted" },
        { key: "clientes", label: "Clientes asignados", kind: "num", align: "right" },
        { key: "cobrado", label: "Cobrado", kind: "money", align: "right" }, { key: "estado", label: "Estado", kind: "status" },
      ]}
      rows={rows.map((w) => ({
        name: w.full_name, rol: ROLE_LABEL[w.role as Role] ?? w.role, clientes: w.clients, cobrado: w.collected, estado: w.active ? "Activo" : "Inactivo",
      }))}
    />
  );
}

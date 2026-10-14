import { createClient } from "@/lib/supabase/client";

export interface ProfileRow { id: string; full_name: string; role: string; active: boolean; created_at: string }
export interface AuditRow {
  id: number; actor: string | null; action: string; entity: string; entity_id: string | null;
  after: Record<string, unknown> | null; created_at: string;
}

/** Solo el administrador ve todos los perfiles (RLS). */
export async function fetchProfiles(): Promise<ProfileRow[]> {
  const { data, error } = await createClient().from("profiles").select("id, full_name, role, active, created_at").order("created_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Solo el administrador puede leer la auditoría (RLS). */
export async function fetchAudit(): Promise<AuditRow[]> {
  const { data, error } = await createClient()
    .from("audit_log").select("id, actor, action, entity, entity_id, after, created_at")
    .order("created_at", { ascending: false }).limit(200);
  if (error) throw new Error(error.message);
  return (data ?? []) as AuditRow[];
}

export interface WorkerStat { id: string; full_name: string; role: string; active: boolean; clients: number; collected: number }

/** Personal con clientes asignados y total cobrado (pagos confirmados). Requiere rol administrador (RLS). */
export async function fetchWorkerStats(): Promise<WorkerStat[]> {
  const { data, error } = await createClient().rpc("worker_stats");
  if (error) throw new Error(error.message);
  return ((data ?? []) as { id: string; full_name: string; role: string; active: boolean; clients: number | string; collected: string }[]).map((w) => ({
    ...w, clients: Number(w.clients), collected: Math.round(Number(w.collected) * 100) / 100,
  }));
}

/** Cambia rol o estado. La base de datos exige administrador y prohíbe cambiarse a sí mismo. */
export async function updateProfile(id: string, patch: { role?: string; active?: boolean }): Promise<void> {
  const { error } = await createClient().from("profiles").update(patch).eq("id", id);
  if (error) throw new Error(error.message.includes("propio") ? "No puedes cambiar tu propio rol ni estado." : error.message);
}

export async function createUserRequest(input: { email: string; password: string; full_name: string; role: string }): Promise<void> {
  const res = await fetch("/api/admin/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? "No se pudo crear el usuario.");
}

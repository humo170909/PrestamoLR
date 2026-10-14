import { z } from "zod";
import { createClient } from "@/lib/supabase/client";
import { fetchAllPages, type Paged } from "@/lib/data/paginate";

export const clientSchema = z.object({
  full_name: z.string().trim().min(3, "Ingresa el nombre completo"),
  document_id: z.string().trim().regex(/^\d{8}$/, "El DNI debe tener 8 dígitos"),
  phone: z.string().trim().regex(/^[0-9+() -]{6,20}$/, "Teléfono no válido (6 a 20 dígitos; se admiten + ( ) y guiones)").optional().or(z.literal("")),
  address: z.string().trim().max(200).optional(),
  assigned_collector: z.string().uuid().optional().or(z.literal("")),
});
export type ClientInput = z.infer<typeof clientSchema>;

export interface ClientRow {
  id: string; full_name: string; document_id: string; phone: string | null; active: boolean;
  address: string | null; assigned_collector: string | null;
}

export async function fetchClients(): Promise<Paged<ClientRow>> {
  // Paginado con conteo exacto: PostgREST corta en 1 000 filas sin avisar.
  return fetchAllPages<ClientRow>(async (from, to) => {
    const { data, error, count } = await createClient()
      .from("clients").select("id, full_name, document_id, phone, active, address, assigned_collector", { count: "exact" })
      .order("full_name").order("id").range(from, to);
    if (error) throw new Error(error.message);
    return { rows: data ?? [], total: count };
  });
}

export async function insertClient(input: ClientInput): Promise<void> {
  const v = clientSchema.parse(input);
  const { error } = await createClient().from("clients").insert({
    full_name: v.full_name,
    document_id: v.document_id,
    phone: v.phone || null,
    address: v.address || null,
    assigned_collector: v.assigned_collector || null,
  });
  if (error) throw new Error(error.code === "23505" ? "Ya existe un cliente con ese DNI." : error.message);
}

export const clientEditSchema = clientSchema.extend({ active: z.boolean() });
export type ClientEditInput = z.infer<typeof clientEditSchema>;

/**
 * Actualiza SOLO los datos personales y administrativos de un cliente, identificado por su id único.
 * No toca préstamos, pagos ni caja. La base de datos (RLS + trigger client_guard) valida permisos, DNI único,
 * cobrador válido e inmutabilidad del id; aquí se traducen sus errores a mensajes comprensibles.
 */
export async function updateClient(id: string, input: ClientEditInput): Promise<void> {
  const v = clientEditSchema.parse(input);
  const { data, error } = await createClient().from("clients").update({
    full_name: v.full_name,
    document_id: v.document_id,
    phone: v.phone || null,
    address: v.address || null,
    assigned_collector: v.assigned_collector || null,
    active: v.active,
  }).eq("id", id).select("id").maybeSingle();
  if (error) {
    if (error.code === "23505") throw new Error("Ya existe otro cliente con ese DNI. No se guardó el cambio.");
    if (error.code === "23514") throw new Error("El teléfono no tiene un formato válido.");
    throw new Error(error.message);
  }
  // RLS no devuelve error cuando no hay permiso: simplemente no actualiza ninguna fila.
  if (!data) throw new Error("No se pudo actualizar: no tienes permiso para editar clientes o el cliente ya no existe.");
}

/** Cobradores activos asignables (función de la base de datos: el RLS de profiles oculta la lista a los asesores). */
export async function fetchCollectors(): Promise<{ id: string; full_name: string }[]> {
  const { data } = await createClient().rpc("list_collectors");
  return (data ?? []) as { id: string; full_name: string }[];
}

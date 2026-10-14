import { createClient as createAdminClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SUPABASE_URL, isSupabaseConfigured } from "@/lib/supabase/config";

const bodySchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  full_name: z.string().trim().min(3),
  role: z.enum(["admin", "advisor", "collector"]),
});

/**
 * Alta de usuarios: solo un administrador autenticado y activo.
 * Usa la clave service_role EXCLUSIVAMENTE aquí, en el servidor (variable sin NEXT_PUBLIC_).
 */
export async function POST(request: Request) {
  if (!isSupabaseConfigured) return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor (.env.local)." }, { status: 503 });
  }

  // 0) Defensa CSRF adicional: solo peticiones del mismo origen.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });

  // 1) Verificar en el servidor quién llama y que sea administrador activo.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  const { data: me } = await supabase.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
  if (!me?.active || me.role !== "admin") return NextResponse.json({ error: "Solo administradores." }, { status: 403 });

  // 2) Validar entrada.
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  const { email, password, full_name, role } = parsed.data;

  // 3) Crear usuario de Auth y su perfil; si el perfil falla, se deshace el usuario.
  const admin = createAdminClient(SUPABASE_URL, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
  if (error || !created.user) {
    return NextResponse.json({ error: error?.message.includes("already") ? "Ya existe un usuario con ese correo." : "No se pudo crear el usuario." }, { status: 400 });
  }
  const { error: pErr } = await admin.from("profiles").insert({ id: created.user.id, full_name, role, active: true });
  if (pErr) {
    await admin.auth.admin.deleteUser(created.user.id);
    return NextResponse.json({ error: "No se pudo crear el perfil." }, { status: 500 });
  }
  return NextResponse.json({ ok: true }, { status: 201 });
}

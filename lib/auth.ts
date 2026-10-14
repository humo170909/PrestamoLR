import { createClient } from "@/lib/supabase/client";
import { isDemoAuthEnabled, isSupabaseConfigured } from "@/lib/supabase/config";

export type Role = "admin" | "advisor" | "collector";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  advisor: "Asesor",
  collector: "Cobrador de ruta",
};

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  roleKey: Role;
}

/**
 * Autenticación:
 *  - Supabase configurado  -> Supabase Auth (el rol sale de public.profiles; las rutas se protegen en middleware.ts y RLS).
 *  - Sin Supabase + NEXT_PUBLIC_ENABLE_DEMO_AUTH=true + desarrollo -> usuarios de demostración (solo para UI).
 *  - Cualquier otro caso -> no hay acceso (error AUTH_NOT_CONFIGURED).
 */
const DEMO_USERS = [
  { email: "admin@lromero.com", password: "Admin12345", name: "Luis Romero", roleKey: "admin" as Role },
  { email: "cobrador@lromero.com", password: "Cobrador123", name: "Carlos Quispe", roleKey: "collector" as Role },
];

const SESSION_KEY = "lromero:session";

async function loadSupabaseUser(): Promise<SessionUser | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name, role, active").eq("id", user.id).maybeSingle();
  if (!profile || !profile.active) return null;
  const roleKey = profile.role as Role;
  return { id: user.id, name: profile.full_name, email: user.email ?? "", role: ROLE_LABEL[roleKey] ?? roleKey, roleKey };
}

export async function loginRequest(email: string, password: string): Promise<SessionUser> {
  if (isSupabaseConfigured) {
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    if (error) throw new Error("INVALID_CREDENTIALS");
    const user = await loadSupabaseUser();
    if (!user) {
      await supabase.auth.signOut();
      throw new Error("NO_PROFILE");
    }
    return user;
  }

  if (!isDemoAuthEnabled) throw new Error("AUTH_NOT_CONFIGURED");

  await new Promise((r) => setTimeout(r, 600));
  const found = DEMO_USERS.find((u) => u.email === email.trim().toLowerCase() && u.password === password);
  if (!found) throw new Error("INVALID_CREDENTIALS");
  const user: SessionUser = { id: "demo-" + found.email, name: found.name, email: found.email, role: ROLE_LABEL[found.roleKey], roleKey: found.roleKey };
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  } catch {
    /* almacenamiento no disponible */
  }
  return user;
}

export async function getSession(): Promise<SessionUser | null> {
  if (isSupabaseConfigured) return loadSupabaseUser();
  if (!isDemoAuthEnabled) return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as SessionUser) : null;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  if (isSupabaseConfigured) {
    await createClient().auth.signOut();
    return;
  }
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

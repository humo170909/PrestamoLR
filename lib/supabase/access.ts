/**
 * Decisión de acceso del middleware (módulo puro, sin red ni dependencias; se prueba con `npm test`).
 * Regla clave: un ERROR de infraestructura (Auth o consulta de perfil caída) NO equivale a "sin sesión" ni a "perfil inactivo":
 * se responde 503 y la sesión se conserva. Solo un perfil realmente inexistente/inactivo cierra la sesión.
 */
export type ProfileLookup = { kind: "ok"; active: boolean } | { kind: "missing" } | { kind: "error" };

export interface AccessInput {
  /** Hay variables públicas de Supabase. */
  configured: boolean;
  /** Modo demostración válido (sin Supabase, fuera de producción y con la bandera explícita). */
  demo: boolean;
  path: string;
  /** Resultado de `auth.getUser()`: con usuario, sin sesión válida, o fallo de infraestructura. */
  auth: "user" | "anon" | "error";
  /** Solo se evalúa si `auth === "user"`. */
  profile?: ProfileLookup;
}

export type AccessAction = "next" | "redirect-login" | "unauthorized-api" | "redirect-dashboard" | "unavailable" | "closed-redirect" | "closed-api";

export function decideAccess(i: AccessInput): { action: AccessAction; signOut: boolean } {
  const isLogin = i.path === "/";
  const isApi = i.path.startsWith("/api/");
  /** Sin acceso: las páginas redirigen al login; las API responden 401 JSON (no un 307 con HTML). */
  const denied = (): AccessAction => (isApi ? "unauthorized-api" : "redirect-login");
  if (!i.configured) {
    if (i.demo || isLogin) return { action: "next", signOut: false };
    // Sin configuración el panel NO queda abierto (antes el middleware dejaba pasar todo).
    return { action: isApi ? "closed-api" : "closed-redirect", signOut: false };
  }
  if (i.auth === "error") return { action: "unavailable", signOut: false };
  if (i.auth === "anon") return { action: isLogin ? "next" : denied(), signOut: false };

  const p = i.profile ?? { kind: "missing" as const };
  if (p.kind === "error") return { action: "unavailable", signOut: false };
  if (p.kind === "missing" || !p.active) return { action: isLogin ? "next" : denied(), signOut: true };
  return { action: isLogin ? "redirect-dashboard" : "next", signOut: false };
}

/** Error de Auth por red o servidor (reintentable), distinto de un token inválido o caducado. */
export const isRetryableAuthError = (e: { name?: string; status?: number } | null | undefined): boolean =>
  !!e && (e.name === "AuthRetryableFetchError" || (typeof e.status === "number" && (e.status >= 500 || e.status === 0)));

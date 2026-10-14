import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isDemoAuthEnabled, isSupabaseConfigured } from "@/lib/supabase/config";
import { decideAccess, isRetryableAuthError, type ProfileLookup } from "@/lib/supabase/access";
import { logEvent } from "@/lib/log";

const UNAVAILABLE_HTML = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Servicio no disponible</title></head>
<body style="font-family:system-ui,sans-serif;max-width:32rem;margin:15vh auto;padding:0 1rem;text-align:center"><h1>Servicio no disponible</h1>
<p>No pudimos verificar tu sesión en este momento. Tu sesión sigue abierta: espera unos segundos y reintenta.</p><p><a href="">Reintentar</a></p></body></html>`;

/**
 * Con Supabase configurado: refresca la sesión y protege las rutas del panel EN EL SERVIDOR.
 * Un fallo de Auth o de la consulta de perfil responde 503 y conserva la sesión (no cierra sesión a todos ante una caída breve).
 * Sin Supabase: solo queda público el login (y el modo demostración de desarrollo, ver lib/auth.ts); el resto está cerrado.
 */
export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const unavailable = (response?: NextResponse) => {
    const wantsJson = path.startsWith("/api/");
    const out = wantsJson
      ? NextResponse.json({ error: "Servicio no disponible. Reintenta en unos segundos." }, { status: 503, headers: { "Retry-After": "10" } })
      : new NextResponse(UNAVAILABLE_HTML, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8", "Retry-After": "10", "Cache-Control": "no-store" } });
    response?.cookies.getAll().forEach((c) => out.cookies.set(c)); // conserva cookies de sesión (p. ej. un token ya refrescado)
    return out;
  };

  if (!isSupabaseConfigured) {
    const { action } = decideAccess({ configured: false, demo: isDemoAuthEnabled, path, auth: "anon" });
    if (action === "closed-api") return NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 });
    if (action === "closed-redirect") return NextResponse.redirect(new URL("/", request.url));
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(list) {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // getUser() valida el token con el servidor de Auth (getSession() no es fiable aquí).
  const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();
  const auth = authUser ? "user" : authError && isRetryableAuthError(authError) ? "error" : "anon";

  // Distinguir ERROR de la consulta (5xx/red) de "perfil inexistente o inactivo".
  let profile: ProfileLookup | undefined;
  if (authUser) {
    const { data, error } = await supabase.from("profiles").select("active").eq("id", authUser.id).maybeSingle();
    profile = error ? { kind: "error" } : data ? { kind: "ok", active: !!data.active } : { kind: "missing" };
  }

  const { action, signOut } = decideAccess({ configured: true, demo: false, path, auth, profile });
  if (action === "unavailable") {
    logEvent("error", "auth_unavailable", { path, reason: auth === "error" ? "auth" : "profile_lookup" });
    return unavailable(response);
  }

  // Un usuario de Auth sin perfil activo NO tiene acceso: se cierra su sesión (evita bucle login <-> dashboard).
  if (signOut) await supabase.auth.signOut();

  if (action === "unauthorized-api") {
    const denied = NextResponse.json({ error: "No autenticado." }, { status: 401 });
    response.cookies.getAll().forEach((c) => denied.cookies.set(c)); // conserva la limpieza de cookies del signOut
    return denied;
  }
  if (action === "redirect-login") {
    const redirect = NextResponse.redirect(new URL("/", request.url));
    response.cookies.getAll().forEach((c) => redirect.cookies.set(c)); // conserva la limpieza de cookies del signOut
    return redirect;
  }
  if (action === "redirect-dashboard") return NextResponse.redirect(new URL("/dashboard", request.url));
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|images|logo.png|favicon.ico|api/cron|api/csp-report).*)"],
};

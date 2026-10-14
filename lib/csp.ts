/**
 * Content-Security-Policy (se publica en modo Report-Only, ver next.config.ts). Módulo puro, sin dependencias.
 *
 * Es deliberadamente permisiva en `script-src`/`style-src` ('unsafe-inline'): Next inyecta scripts en línea, el script de tema también,
 * y framer-motion y recharts usan `style=`. Una política estricta requiere nonces por petición (siguiente paso, ver informe).
 * Mientras tanto ya aporta: sin objetos/plugins, sin marcos ajenos, sin <base> ni formularios hacia otros orígenes, conexiones solo a
 * este origen y a Supabase, y sin `eval`. Las violaciones llegan a /api/csp-report (logs de Vercel).
 */
export function buildCsp(supabaseUrl?: string): string {
  let supabaseOrigin = "";
  try { if (supabaseUrl) supabaseOrigin = new URL(supabaseUrl).origin; } catch { /* URL inválida: solo el propio origen */ }
  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", ["'self'", "'unsafe-inline'"]],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    ["img-src", ["'self'", "data:", "blob:"]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", ["'self'", ...(supabaseOrigin ? [supabaseOrigin] : [])]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    ["form-action", ["'self'"]],
    ["frame-ancestors", ["'none'"]],
    ["report-uri", ["/api/csp-report"]],
  ];
  return directives.map(([k, v]) => `${k} ${v.join(" ")}`).join("; ");
}

const stripQuery = (u: unknown): string => {
  if (typeof u !== "string") return "";
  try { const x = new URL(u); return `${x.origin}${x.pathname}`.slice(0, 200); } catch { return u.split(/[?#]/)[0].slice(0, 200); }
};

/** Resumen mínimo de un informe de violación (formato `report-uri` o Reporting API): sin query strings ni política completa. */
export function summarizeCspReport(body: unknown): { directive: string; blocked: string; page: string } {
  const root = Array.isArray(body) ? (body[0] as { body?: unknown } | undefined)?.body : body;
  const r = ((root as { "csp-report"?: unknown } | null | undefined)?.["csp-report"] ?? root) as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") return { directive: "desconocida", blocked: "", page: "" };
  const directive = r["violated-directive"] ?? r["effectiveDirective"] ?? r["effective-directive"];
  const blocked = r["blocked-uri"] ?? r["blockedURL"] ?? r["blocked-url"];
  const page = r["document-uri"] ?? r["documentURL"] ?? r["document-url"];
  return { directive: typeof directive === "string" ? directive.slice(0, 60) : "desconocida", blocked: stripQuery(blocked) || (typeof blocked === "string" ? blocked.slice(0, 20) : ""), page: stripQuery(page) };
}

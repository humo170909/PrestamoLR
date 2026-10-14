import { createClient } from "@/lib/supabase/client";
import { fetchDueToday, fetchPortfolio, sumBy } from "@/lib/data/portfolio";
import { moneyDec } from "@/lib/format";
import { cronMissingToday, limaDayStartUtc } from "@/lib/reminders/health";

export interface SearchHit { key: string; type: string; title: string; sub: string; href: string }
export interface AlertItem { id: number; tone: "danger" | "warn" | "info"; title: string; detail: string; time: string }

/** Busca clientes (nombre/DNI) y préstamos (código). RLS limita el resultado al rol del usuario. */
export async function searchLive(q: string): Promise<SearchHit[]> {
  const s = q.trim().replace(/[%,()]/g, "");
  if (s.length < 2) return [];
  const sb = createClient();
  const [clients, loans] = await Promise.all([
    sb.from("clients").select("id, full_name, document_id").or(`full_name.ilike.%${s}%,document_id.ilike.%${s}%`).limit(4),
    sb.from("loans").select("id, code, clients(full_name)").ilike("code", `%${s}%`).limit(4),
  ]);
  return [
    ...(clients.data ?? []).map((c) => ({ key: `c${c.id}`, type: "Cliente", title: c.full_name, sub: `DNI ${c.document_id}`, href: "/clientes" })),
    ...((loans.data ?? []) as unknown as { id: string; code: string; clients: { full_name: string } | null }[])
      .map((l) => ({ key: `l${l.id}`, type: "Préstamo", title: l.code, sub: l.clients?.full_name ?? "", href: `/prestamos?loan=${l.id}` })),
  ];
}

/** Alertas derivadas de la cartera real: mora y vencimientos de hoy (y, solo para el administrador, el estado del cron de avisos). */
export async function fetchAlerts(isAdmin = false): Promise<AlertItem[]> {
  const [portfolio, due] = await Promise.all([fetchPortfolio(), fetchDueToday()]);
  const out: AlertItem[] = [];
  const late = portfolio.filter((r) => r.days_overdue > 0);
  if (late.length) {
    out.push({
      id: 1, tone: "danger", title: `${late.length} préstamo(s) en mora`,
      detail: `${moneyDec(sumBy(late, (r) => r.interest_overdue + r.capital_overdue))} exigibles`, time: "Ahora",
    });
  }
  if (due.length) {
    out.push({
      id: 2, tone: "warn", title: `${due.length} vencimiento(s) hoy`,
      detail: `${moneyDec(sumBy(due, (d) => d.interest_due - d.interest_paid))} en intereses`, time: "Hoy",
    });
  }
  if (isAdmin) {
    // notification_runs solo la lee el administrador (RLS). Sin ninguna ejecución del día de Lima pasadas las 09:00, el cron no está corriendo.
    const now = new Date();
    const runs = await createClient().from("notification_runs").select("started_at").gte("started_at", limaDayStartUtc(now)).limit(5);
    if (!runs.error && cronMissingToday(now, (runs.data ?? []).map((r) => String(r.started_at)))) {
      out.push({
        id: 3, tone: "danger", title: "Los recordatorios de hoy no se ejecutaron",
        detail: "No hay ninguna ejecución registrada hoy pasadas las 09:00 (Lima). Revisa Vercel Cron y Configuración > Telegram.", time: "Hoy",
      });
    }
  }
  return out;
}

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { runJob, type Job } from "@/lib/reminders/dispatch";
import { logEvent } from "@/lib/log";
import { isCronAuthorized } from "@/lib/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const authorized = (request: Request) => isCronAuthorized(request.headers.get("authorization"), process.env.CRON_SECRET);

/**
 * Lo invoca Vercel Cron (envía `Authorization: Bearer $CRON_SECRET`).
 *   ?job=morning  -> cobros de hoy + vencidos
 *   ?job=evening  -> cobros de mañana + próximos (+ cierre del día)
 *   ?job=hourly   -> revisión horaria (solo envía de 08:00 a 20:00 Lima): reintenta fallos y avisa vencimientos nuevos
 * Es idempotente: se puede invocar varias veces sin duplicar avisos (reintenta solo los fallidos).
 */
export async function GET(request: Request) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET no configurado." }, { status: 503 });
  if (!authorized(request)) {
    logEvent("warn", "cron_unauthorized", {});
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const job = new URL(request.url).searchParams.get("job") ?? "all";
  if (!["morning", "evening", "hourly", "all"].includes(job)) return NextResponse.json({ error: "job inválido." }, { status: 400 });

  try {
    const sb = createServiceClient();
    // Devenga los períodos de los préstamos abiertos (idempotente). Si falla, los avisos siguen con lo ya registrado.
    logEvent("info", "cron_started", { job });
    const refreshed = await sb.rpc("refresh_open_loans").then((r) => r.error, (e: unknown) => e);
    if (refreshed) logEvent("warn", "refresh_open_loans_failed", { job, error: refreshed instanceof Error ? refreshed : (refreshed as { message?: string }).message });
    const results = await runJob(sb, job as Job);
    return NextResponse.json({ ok: true, results });
  } catch (e) {
    logEvent("error", "cron_failed", { job, error: e });
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}

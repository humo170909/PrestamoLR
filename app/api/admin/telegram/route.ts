import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { runJob, sendTest } from "@/lib/reminders/dispatch";
import { loadTelegramConfig, readRow } from "@/lib/reminders/config";
import { encryptSecret, hasEncryptionKey } from "@/lib/reminders/crypto";
import { checkBot, checkChat, detectChats } from "@/lib/reminders/telegram";
import { SCHEDULE, TIMEZONE, nextRun } from "@/lib/reminders/schedule";
import { maskChat } from "@/lib/reminders/mask";

export const dynamic = "force-dynamic";

/** Devuelve el cliente del usuario y su id solo si es administrador activo; si no, la respuesta de error. */
async function requireAdmin() {
  if (!isSupabaseConfigured) return { error: NextResponse.json({ error: "Supabase no está configurado." }, { status: 503 }) };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) };
  const { data: me } = await supabase.from("profiles").select("role, active").eq("id", user.id).maybeSingle();
  if (!me?.active || me.role !== "admin") return { error: NextResponse.json({ error: "Solo administradores." }, { status: 403 }) };
  return { supabase, userId: user.id };
}

/** Estado de la configuración y últimos envíos. Nunca devuelve el token (ni cifrado). */
export async function GET() {
  const a = await requireAdmin();
  if (a.error) return a.error;
  const serviceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  let row = null;
  let source: "panel" | "env" | "none" = "none";
  if (serviceKey) {
    const sb = createServiceClient();
    row = await readRow(sb).catch(() => null);
    source = (await loadTelegramConfig(sb))?.source ?? "none";
  }
  const { data: log } = await a.supabase
    .from("notification_log").select("id, kind, for_date, chat_id, status, attempts, items, last_error, created_at")
    .order("created_at", { ascending: false }).limit(20);
  const [sentCount, lastSent, lastFailed] = await Promise.all([
    a.supabase.from("notification_log").select("id", { count: "exact", head: true }).eq("status", "sent").neq("kind", "test"),
    a.supabase.from("notification_log").select("sent_at, kind").eq("status", "sent").not("sent_at", "is", null).order("sent_at", { ascending: false }).limit(1).maybeSingle(),
    a.supabase.from("notification_log").select("last_error, created_at").eq("status", "failed").not("last_error", "is", null).neq("last_error", "en curso").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const next = nextRun();
  // Última ejecución registrada (tabla notification_runs). Si la migración falta, se avisa en vez de mostrar un vacío engañoso.
  const lastRun = await a.supabase.from("notification_runs")
    .select("job, trigger, started_at, finished_at, timezone, status, obligations_checked, sent, skipped, failed, errors")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({
    configured: source !== "none", source,
    tokenSet: Boolean(row?.bot_token_enc), chatIds: row?.chat_ids ?? [],
    enabled: row?.enabled ?? true,
    kinds: { today: row?.send_today ?? true, overdue: row?.send_overdue ?? true, tomorrow: row?.send_tomorrow ?? true, payments: row?.send_payments ?? true },
    overdue: { intervals: row?.overdue_intervals ?? [1, 3, 5, 7], repeatDays: row?.overdue_repeat_days ?? 7 },
    run: lastRun.error ? null : lastRun.data, runsTable: !lastRun.error,
    timezone: TIMEZONE, schedule: SCHEDULE.map((s) => ({ job: s.job, limaTime: s.limaTime, label: s.label })),
    stats: { sent: sentCount.count ?? 0, lastSentAt: lastSent.data?.sent_at ?? null, lastError: lastFailed.data?.last_error ?? null, lastErrorAt: lastFailed.data?.created_at ?? null },
    next: next ? { at: next.at.toISOString(), label: next.label } : null,
    encryptionKey: hasEncryptionKey(), cron: Boolean(process.env.CRON_SECRET), serviceKey,
    log: (log ?? []).map((l) => ({ ...l, chat_id: maskChat(String(l.chat_id)) })),
  });
}

const chatId = z.string().trim().regex(/^(-?\d{5,20}|@[A-Za-z][\w]{4,31})$/, "Chat id inválido (número, grupos con signo menos, o @canal)");
const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("check") }),
  z.object({ action: z.literal("test") }),
  z.object({ action: z.literal("detect") }),
  z.object({ action: z.literal("run"), job: z.enum(["morning", "evening", "all"]).optional() }),
  z.object({ action: z.literal("clear_token") }),
  z.object({
    action: z.literal("save"),
    token: z.string().trim().regex(/^\d{6,12}:[A-Za-z0-9_-]{30,60}$/, "El token no tiene el formato de BotFather").optional(),
    chatIds: z.array(chatId).max(10),
    enabled: z.boolean(),
    kinds: z.object({ today: z.boolean(), overdue: z.boolean(), tomorrow: z.boolean(), payments: z.boolean().optional() }),
    overdueIntervals: z.array(z.number().int().min(1).max(365)).min(1).max(12).optional(),
    overdueRepeat: z.number().int().min(1).max(90).optional(),
  }),
]);

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  const a = await requireAdmin();
  if (a.error) return a.error;
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en el servidor." }, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Solicitud inválida." }, { status: 400 });
  const body = parsed.data;
  const sb = createServiceClient();

  if (body.action === "save" || body.action === "clear_token") {
    const patch: Record<string, unknown> = { id: 1, updated_by: a.userId, updated_at: new Date().toISOString() };
    if (body.action === "clear_token") {
      patch.bot_token_enc = null;
    } else {
      patch.chat_ids = [...new Set(body.chatIds)];
      patch.enabled = body.enabled;
      patch.send_today = body.kinds.today; patch.send_overdue = body.kinds.overdue; patch.send_tomorrow = body.kinds.tomorrow;
      if (body.kinds.payments !== undefined) patch.send_payments = body.kinds.payments;
      if (body.overdueIntervals) patch.overdue_intervals = [...new Set(body.overdueIntervals)].sort((x, y) => x - y);
      if (body.overdueRepeat) patch.overdue_repeat_days = body.overdueRepeat;
      if (body.token) {
        if (!hasEncryptionKey()) return NextResponse.json({ error: "Falta TELEGRAM_ENCRYPTION_KEY (64 hex) en el servidor para guardar el token cifrado." }, { status: 503 });
        const bot = await checkBot(body.token);
        if (!bot.ok) return NextResponse.json({ error: `Telegram rechazó el token: ${bot.error}` }, { status: 400 });
        patch.bot_token_enc = encryptSecret(body.token);
      }
    }
    const { error } = await sb.from("telegram_settings").upsert(patch);
    if (error) return NextResponse.json({ error: "No se pudo guardar la configuración." }, { status: 500 });
    // Auditoría sin secretos: solo qué cambió.
    await sb.from("audit_log").insert({
      actor: a.userId, action: "TELEGRAM_CONFIG", entity: "telegram_settings", entity_id: "1",
      after: { token_changed: body.action === "clear_token" || Boolean("token" in body && body.token), chats: patch.chat_ids ?? null, enabled: patch.enabled ?? null },
    });
    return NextResponse.json({ ok: true });
  }

  const cfg = await loadTelegramConfig(sb);
  if (!cfg) return NextResponse.json({ error: "Telegram no está configurado: guarda el token y al menos un chat." }, { status: 503 });

  if (body.action === "check") {
    // La conexión solo se da por buena si Telegram acepta el token Y encuentra cada chat configurado (getMe + getChat).
    const bot = await checkBot(cfg.token);
    if (!bot.ok) return NextResponse.json({ ok: false, error: bot.error }, { status: 502 });
    const chats = [];
    for (const id of cfg.chatIds) {
      const c = await checkChat(cfg.token, id);
      chats.push({ chat: maskChat(id), ok: c.ok, type: c.type, title: c.title, error: c.error });
    }
    return NextResponse.json({ ok: chats.every((c) => c.ok), bot: bot.username, chats }, { status: chats.every((c) => c.ok) ? 200 : 502 });
  }
  if (body.action === "detect") {
    const d = await detectChats(cfg.token);
    return NextResponse.json(d.ok ? { ok: true, chats: d.chats } : { ok: false, error: d.error }, { status: d.ok ? 200 : 502 });
  }
  const results = body.action === "test" ? await sendTest(sb) : await runJob(sb, body.job ?? "all", undefined, "manual");
  return NextResponse.json({ ok: results.every((r) => r.status !== "failed"), results: results.map((r) => ({ ...r, chat: r.chat === "-" ? r.chat : maskChat(r.chat) })) });
}

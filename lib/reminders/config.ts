import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, hasEncryptionKey } from "./crypto.ts";
import { getTelegramConfig as envConfig } from "./telegram.ts";
import { DEFAULT_OVERDUE, type OverdueConfig } from "./build.ts";
import { normalizeChatId } from "./mask.ts";
import { logEvent } from "../log.ts";

export interface ResolvedTelegram {
  token: string;
  chatIds: string[];
  enabled: boolean;
  kinds: { today: boolean; overdue: boolean; tomorrow: boolean; payments: boolean };
  overdue: OverdueConfig;
  source: "panel" | "env";
}

export interface TelegramRow {
  bot_token_enc: string | null; chat_ids: string[]; enabled: boolean;
  send_today: boolean; send_overdue: boolean; send_tomorrow: boolean;
  send_payments?: boolean; overdue_intervals?: number[]; overdue_repeat_days?: number;
  last_run_at?: string | null; last_run_job?: string | null; last_run_summary?: unknown;
}

const LEGACY_COLS = "bot_token_enc, chat_ids, enabled, send_today, send_overdue, send_tomorrow";
const FULL_COLS = `${LEGACY_COLS}, send_payments, overdue_intervals, overdue_repeat_days, last_run_at, last_run_job, last_run_summary`;

/**
 * Lee la fila de configuración. Si la migración de alertas aún no se aplicó, reintenta con las columnas originales:
 * así NUNCA se pierde el token ni el chat guardados por una columna que falta.
 */
export async function readRow(sb: SupabaseClient): Promise<TelegramRow | null> {
  const full = await sb.from("telegram_settings").select(FULL_COLS).eq("id", 1).maybeSingle();
  if (!full.error) return (full.data as TelegramRow | null) ?? null;
  const legacy = await sb.from("telegram_settings").select(LEGACY_COLS).eq("id", 1).maybeSingle();
  return (legacy.data as TelegramRow | null) ?? null;
}

const overdueOf = (row: TelegramRow | null): OverdueConfig => ({
  intervals: row?.overdue_intervals?.length ? row.overdue_intervals : DEFAULT_OVERDUE.intervals,
  repeatDays: row?.overdue_repeat_days ?? DEFAULT_OVERDUE.repeatDays,
});

/**
 * Configuración efectiva: lo guardado en el panel (token cifrado) tiene prioridad;
 * si falta, se usan las variables de entorno. Devuelve null si no hay token o chats.
 */
export async function loadTelegramConfig(sb: SupabaseClient): Promise<ResolvedTelegram | null> {
  const row = await readRow(sb).catch(() => null);
  const kinds = {
    today: row?.send_today ?? true, overdue: row?.send_overdue ?? true, tomorrow: row?.send_tomorrow ?? true, payments: row?.send_payments ?? true,
  };
  if (row?.bot_token_enc && row.chat_ids.length > 0 && hasEncryptionKey()) {
    try {
      return { token: decryptSecret(row.bot_token_enc).trim(), chatIds: [...new Set(row.chat_ids.map(normalizeChatId).filter(Boolean))], enabled: row.enabled, source: "panel", kinds, overdue: overdueOf(row) };
    } catch (e) {
      /* clave cambiada o dato corrupto: se intenta el respaldo por variables de entorno */
      logEvent("warn", "telegram_decrypt_failed", { hint: "TELEGRAM_ENCRYPTION_KEY cambió o el token guardado está corrupto; se usa el respaldo por variables de entorno", error: e });
    }
  }
  const env = envConfig();
  if (!env) return null;
  return { ...env, source: "env", enabled: row?.enabled ?? true, kinds, overdue: overdueOf(row) };
}

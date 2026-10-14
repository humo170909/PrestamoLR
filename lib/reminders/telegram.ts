import "server-only";
import { splitMessage } from "./build.ts";
import { normalizeChatId } from "./mask.ts";

export interface TelegramConfig { token: string; chatIds: string[] }

/** Lee la configuración del servidor. El token nunca sale de aquí ni se escribe en logs. */
export function getTelegramConfig(): TelegramConfig | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const chatIds = (process.env.TELEGRAM_CHAT_ID ?? "").split(",").map(normalizeChatId).filter(Boolean);
  return token && chatIds.length ? { token, chatIds } : null;
}

export interface SendResult { ok: boolean; error?: string; retryable?: boolean }

const scrub = (s: string, token: string) => s.split(token).join("***").slice(0, 300);

/** Traduce el error de Telegram a una causa y una acción concretas (sin revelar token ni Chat ID). */
export function explainTelegramError(description?: string): string | null {
  const d = (description ?? "").toLowerCase();
  if (d.includes("chat not found")) return "Telegram no encuentra ese chat. Verifica el Chat ID (sin espacios ni guiones raros) y que el destinatario haya abierto el bot y pulsado «Iniciar» (/start); si es un grupo, que el bot haya sido añadido.";
  if (d.includes("blocked by the user")) return "El destinatario bloqueó al bot. Debe desbloquearlo y pulsar «Iniciar».";
  if (d.includes("not a member") || d.includes("was kicked") || d.includes("bot was removed")) return "El bot ya no pertenece a ese grupo o canal. Vuelve a añadirlo (en canales, como administrador).";
  if (d.includes("upgraded to a supergroup")) return "El grupo pasó a supergrupo y cambió de Chat ID. Detecta el nuevo ID y guárdalo.";
  if (d.includes("unauthorized")) return "Telegram rechaza el token del bot (inválido o revocado). Genera uno nuevo en @BotFather y guárdalo en el panel.";
  if (d.includes("have no rights") || d.includes("not enough rights")) return "El bot no tiene permiso para escribir en ese chat. Dale permiso de envío.";
  if (d.includes("too many requests")) return "Telegram limitó los envíos temporalmente; se reintentará.";
  return null;
}
const withHint = (msg: string, description?: string) => { const h = explainTelegramError(description); return h ? `${msg} → ${h}` : msg; };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call(token: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; description?: string; result?: unknown }> {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string; result?: unknown };
  return { ok: Boolean(json.ok), status: res.status, description: json.description, result: json.result };
}

/** Comprueba el token (getMe). */
export async function checkBot(token: string): Promise<{ ok: boolean; username?: string; error?: string }> {
  try {
    const r = await call(token, "getMe");
    if (!r.ok) return { ok: false, error: withHint(scrub(r.description ?? `HTTP ${r.status}`, token), r.description) };
    return { ok: true, username: (r.result as { username?: string }).username };
  } catch (e) {
    return { ok: false, error: scrub(e instanceof Error ? e.message : "Sin conexión", token) };
  }
}

/** Envía un texto HTML a un chat (divide si es largo). Reintenta 3 veces solo fallos transitorios (red, 429, 5xx). */
export async function sendTelegram(cfg: { token: string }, chatId: string, text: string): Promise<SendResult> {
  for (const part of splitMessage(text)) {
    let last: SendResult = { ok: false, error: "sin intentos" };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await call(cfg.token, "sendMessage", { chat_id: chatId, text: part, parse_mode: "HTML", disable_web_page_preview: true });
        if (r.ok) { last = { ok: true }; break; }
        const retryable = r.status === 429 || r.status >= 500;
        last = { ok: false, error: withHint(scrub(r.description ?? `HTTP ${r.status}`, cfg.token), r.description), retryable };
        if (!retryable) break;
      } catch (e) {
        last = { ok: false, error: scrub(e instanceof Error ? e.message : "Sin conexión", cfg.token), retryable: true };
      }
      if (attempt < 3) await sleep(attempt * 1000);
    }
    if (!last.ok) return last;
  }
  return { ok: true };
}

/**
 * Comprueba UN chat con getChat (no envía nada): confirma que el Chat ID existe y que el bot puede verlo.
 * Devuelve solo tipo y título; nunca el token. Lo usa la prueba de conexión del panel.
 */
export async function checkChat(token: string, chatId: string): Promise<{ ok: boolean; type?: string; title?: string; error?: string }> {
  try {
    const r = await call(token, "getChat", { chat_id: normalizeChatId(chatId) });
    if (!r.ok) return { ok: false, error: withHint(scrub(r.description ?? `HTTP ${r.status}`, token), r.description) };
    const c = r.result as { type?: string; title?: string; first_name?: string };
    return { ok: true, type: c.type, title: c.title ?? c.first_name };
  } catch (e) {
    return { ok: false, error: scrub(e instanceof Error ? e.message : "Sin conexión", token) };
  }
}

export interface DetectedChat { id: string; type: string; name: string }

/** Chats que han escrito al bot recientemente (getUpdates), para que el administrador elija su chat id. */
export async function detectChats(token: string): Promise<{ ok: boolean; chats: DetectedChat[]; error?: string }> {
  try {
    const r = await call(token, "getUpdates", { limit: 100, timeout: 0 });
    if (!r.ok) return { ok: false, chats: [], error: scrub(r.description ?? `HTTP ${r.status}`, token) };
    const seen = new Map<string, DetectedChat>();
    for (const u of (r.result as { message?: { chat?: Record<string, unknown> }; my_chat_member?: { chat?: Record<string, unknown> }; channel_post?: { chat?: Record<string, unknown> } }[]) ?? []) {
      const chat = u.message?.chat ?? u.my_chat_member?.chat ?? u.channel_post?.chat;
      if (!chat || chat.id === undefined) continue;
      const id = String(chat.id);
      const name = [chat.first_name, chat.last_name].filter(Boolean).join(" ") || String(chat.title ?? chat.username ?? "");
      seen.set(id, { id, type: String(chat.type ?? ""), name });
    }
    return { ok: true, chats: [...seen.values()] };
  } catch (e) {
    return { ok: false, chats: [], error: scrub(e instanceof Error ? e.message : "Sin conexión", token) };
  }
}

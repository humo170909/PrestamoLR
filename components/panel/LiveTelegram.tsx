"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, fieldClass } from "./ui";

interface LogRow { id: string; kind: string; for_date: string; chat_id: string; status: string; attempts: number; items: number; last_error: string | null; created_at: string }
interface Kinds { today: boolean; overdue: boolean; tomorrow: boolean; payments: boolean }
interface Status {
  configured: boolean; source: "panel" | "env" | "none"; tokenSet: boolean; chatIds: string[]; enabled: boolean; kinds: Kinds;
  encryptionKey: boolean; cron: boolean; serviceKey: boolean; log: LogRow[];
  overdue?: { intervals: number[]; repeatDays: number };
  run?: { job: string; trigger: string; started_at: string; finished_at: string; timezone: string; status: string; obligations_checked: number; sent: number; skipped: number; failed: number; errors: string[] } | null;
  runsTable?: boolean; timezone?: string; schedule?: { job: string; limaTime: string; label: string }[];
  stats?: { sent: number; lastSentAt: string | null; lastError: string | null; lastErrorAt: string | null };
  next?: { at: string; label: string } | null;
}
interface Detected { id: string; type: string; name: string }
interface ChatCheck { chat: string; ok: boolean; type?: string; title?: string; error?: string }
interface ActionResult { ok?: boolean; bot?: string; error?: string; chats?: ChatCheck[] & Detected[]; results?: { kind: string; chat: string; status: string; detail?: string }[] }

const KIND: Record<string, string> = { today: "Hoy", tomorrow: "Mañana", overdue: "Atrasos", test: "Prueba", payment: "Pago registrado", reversal: "Pago revertido" };
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }) : "—");
const STATUS: Record<string, string> = { sent: "Enviado", failed: "Fallido", skipped: "Omitido" };
const RUN_STATUS: Record<string, string> = { ok: "correcta", partial: "con errores parciales", error: "con error", skipped: "sin avisos que enviar" };
const SOURCE: Record<string, string> = { panel: "panel (token cifrado)", env: "variables de entorno", none: "sin configurar" };
const lbl = "mb-1.5 block text-[13px] text-muted-foreground";
const btn = "h-10 rounded-xl border border-border bg-raised px-4 text-sm font-medium text-foreground hover:bg-mint-50 disabled:opacity-50";

export function LiveTelegram() {
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [detected, setDetected] = useState<Detected[] | null>(null);
  const [token, setToken] = useState("");
  const [chats, setChats] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [kinds, setKinds] = useState<Kinds>({ today: true, overdue: true, tomorrow: true, payments: true });
  const [intervals, setIntervals] = useState("1, 3, 5, 7");
  const [repeat, setRepeat] = useState(7);

  const load = useCallback(() => {
    fetch("/api/admin/telegram", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .then((s) => {
        setSt(s);
        if (s) {
          setChats(s.chatIds.join("\n")); setEnabled(s.enabled); setKinds(s.kinds);
          if (s.overdue) { setIntervals(s.overdue.intervals.join(", ")); setRepeat(s.overdue.repeatDays); }
        }
      })
      .catch(() => setSt(null));
  }, []);
  useEffect(load, [load]);

  const post = async (payload: object): Promise<ActionResult> => {
    const res = await fetch("/api/admin/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    return (await res.json().catch(() => ({}))) as ActionResult;
  };

  const act = async (action: "check" | "test" | "run", job?: string) => {
    setBusy(action + (job ?? "")); setMsg(null);
    try {
      const j = await post({ action, job });
      if (action === "check") {
        if (j.bot && Array.isArray(j.chats)) {
          const lines = (j.chats as ChatCheck[]).map((c) => (c.ok ? `✔ Chat ${c.chat}: Telegram lo encuentra (${c.type === "private" ? "privado" : c.type ?? "chat"}${c.title ? `, ${c.title}` : ""}).` : `✘ Chat ${c.chat}: ${c.error ?? "no accesible"}`));
          setMsg({ ok: !!j.ok, text: `Bot @${j.bot} aceptado por Telegram.\n${lines.join("\n")}\n${j.ok ? "Los envíos deberían llegar." : "Corrige el destinatario indicado; no hace falta volver a escribir el token."}` });
        } else {
          setMsg({ ok: false, text: j.error ?? "No se pudo conectar con Telegram." });
        }
      } else if (j.results) {
        const sent = j.results.filter((r) => r.status === "sent").length;
        const failed = j.results.filter((r) => r.status === "failed");
        const skipped = j.results.filter((r) => r.status === "skipped");
        setMsg({
          ok: failed.length === 0,
          text: `Enviados: ${sent} · Omitidos: ${skipped.length}${skipped[0]?.detail ? ` (${skipped[0].detail})` : ""} · Fallidos: ${failed.length}${failed[0]?.detail ? ` (${failed[0].detail})` : ""}`,
        });
      } else {
        setMsg({ ok: false, text: j.error ?? "No se pudo completar la acción." });
      }
      load();
    } catch {
      setMsg({ ok: false, text: "No se pudo contactar con el servidor." });
    } finally { setBusy(null); }
  };

  const addChat = (id: string) =>
    setChats((p) => Array.from(new Set([...p.split(/[\s,;]+/).filter(Boolean), id])).join("\n"));

  const detect = async () => {
    setBusy("detect"); setMsg(null); setDetected(null);
    try {
      const j = await post({ action: "detect" });
      if (j.ok) {
        setDetected(j.chats ?? []);
        if (!j.chats?.length) setMsg({ ok: false, text: "Telegram no ve mensajes recientes. Abre tu bot, pulsa Iniciar (o escribe /start) y vuelve a intentarlo." });
      } else setMsg({ ok: false, text: j.error ?? "No se pudo consultar a Telegram." });
    } catch { setMsg({ ok: false, text: "No se pudo contactar con el servidor." }); }
    finally { setBusy(null); }
  };

  const save = async () => {
    const chatIds = chats.split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean);
    if (chatIds.length === 0) { setMsg({ ok: false, text: "Indica al menos un chat id." }); return; }
    const days = intervals.split(/[\s,;]+/).filter(Boolean).map(Number);
    if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) { setMsg({ ok: false, text: "Los días de atraso deben ser números enteros entre 1 y 365 separados por comas." }); return; }
    setBusy("save"); setMsg(null);
    try {
      const j = await post({ action: "save", token: token.trim() || undefined, chatIds, enabled, kinds, overdueIntervals: days, overdueRepeat: repeat });
      if (j.ok) { setToken(""); setMsg({ ok: true, text: token.trim() ? "Configuración guardada; el token se verificó con Telegram y se almacenó cifrado." : "Configuración guardada." }); load(); }
      else setMsg({ ok: false, text: j.error ?? "No se pudo guardar." });
    } catch { setMsg({ ok: false, text: "No se pudo contactar con el servidor." }); }
    finally { setBusy(null); }
  };

  const clearToken = async () => {
    if (!window.confirm("¿Eliminar el token guardado en el panel? Los avisos se detendrán salvo que haya uno en variables de entorno.")) return;
    setBusy("clear"); setMsg(null);
    try {
      const j = await post({ action: "clear_token" });
      setMsg(j.ok ? { ok: true, text: "Token eliminado." } : { ok: false, text: j.error ?? "No se pudo eliminar." });
      load();
    } finally { setBusy(null); }
  };

  const Check = ({ k, label }: { k: keyof Kinds; label: string }) => (
    <label className="flex items-center gap-2 text-sm text-foreground">
      <input type="checkbox" checked={kinds[k]} onChange={(e) => setKinds((p) => ({ ...p, [k]: e.target.checked }))} className="size-4 accent-[var(--mint-500)]" />
      {label}
    </label>
  );

  return (
    <Card className="space-y-4 xl:col-span-2">
      <CardHeader title="Recordatorios por Telegram" desc="Avisos automáticos de cobranza a tu chat o grupo privado. Un fallo de Telegram nunca afecta pagos ni cronogramas." />
      {!st ? (
        <p className="text-[13px] text-muted-foreground">No se pudo leer el estado (solo administradores).</p>
      ) : (
        <>
          <ul className="grid gap-1 text-[13px] sm:grid-cols-2 xl:grid-cols-4">
            <li className={st.configured ? "text-mint-600" : "text-destructive"}>Origen: {SOURCE[st.source]}</li>
            <li className={st.cron ? "text-mint-600" : "text-destructive"}>{st.cron ? "Cron protegido (CRON_SECRET)" : "Falta CRON_SECRET"}</li>
            <li className={st.serviceKey ? "text-mint-600" : "text-destructive"}>{st.serviceKey ? "Clave de servidor presente" : "Falta SUPABASE_SERVICE_ROLE_KEY"}</li>
            <li className={st.encryptionKey ? "text-mint-600" : "text-destructive"}>{st.encryptionKey ? "Clave de cifrado presente" : "Falta TELEGRAM_ENCRYPTION_KEY"}</li>
          </ul>

          <div className="grid gap-3 rounded-xl border border-border bg-mint-50 p-4 text-[13px] sm:grid-cols-2 xl:grid-cols-5" aria-label="Estado de las notificaciones">
            <div><div className="text-muted-foreground">Credenciales</div><div className={`mt-0.5 font-semibold ${st.configured ? "text-foreground" : "text-destructive"}`}>{st.configured ? "Guardadas" : "Sin configurar"}</div>
              <div className="text-xs text-muted-foreground">La conexión real se confirma con «Comprobar conexión».</div></div>
            <div><div className="text-muted-foreground">Última ejecución</div>
              {st.runsTable === false ? <div className="mt-0.5 font-semibold text-destructive">Sin registro: falta la migración de ejecuciones</div>
                : st.run ? <>
                  <div className="mt-0.5 font-semibold text-foreground">{when(st.run.started_at)}</div>
                  <div className="text-xs text-muted-foreground">{st.run.trigger === "manual" ? "manual" : "automática"} · {RUN_STATUS[st.run.status] ?? st.run.status} · revisadas {st.run.obligations_checked}</div>
                  <div className="text-xs text-muted-foreground">enviadas {st.run.sent} · omitidas {st.run.skipped} · fallidas {st.run.failed}</div></>
                : <div className="mt-0.5 font-semibold text-foreground">Aún no se ha ejecutado</div>}</div>
            <div><div className="text-muted-foreground">Último envío exitoso</div><div className="mt-0.5 font-semibold text-foreground">{when(st.stats?.lastSentAt)}</div></div>
            <div><div className="text-muted-foreground">Notificaciones enviadas</div><div className="mt-0.5 font-semibold tabular-nums text-foreground">{st.stats?.sent ?? 0}</div></div>
            <div><div className="text-muted-foreground">Próxima ejecución</div>
              {st.next ? <><div className="mt-0.5 font-semibold text-foreground">{when(st.next.at)}</div><div className="text-xs text-muted-foreground">{st.next.label}</div></>
                : <div className="mt-0.5 font-semibold text-destructive">No se puede determinar la programación</div>}</div>
            <div className="sm:col-span-2 xl:col-span-5 text-xs text-muted-foreground">Zona horaria: {st.timezone ?? "America/Lima"} (UTC−5, sin horario de verano){st.schedule?.length ? ` · Programación: ${st.schedule.map((x) => x.limaTime).join(" y ")} (hora de Lima)` : ""}</div>
            <div className="sm:col-span-2 xl:col-span-5"><span className="text-muted-foreground">Último error: </span>
              <span className={st.stats?.lastError ? "text-destructive" : "text-foreground"}>{st.stats?.lastError ? `${st.stats.lastError} (${when(st.stats.lastErrorAt)})` : "ninguno"}</span></div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className={lbl}>Token del bot {st.tokenSet && <em className="not-italic text-mint-600">(guardado; escribe uno nuevo para reemplazarlo)</em>}</span>
              <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => setToken(e.target.value)}
                placeholder={st.tokenSet ? "••••••••••••••••" : "123456789:AA…  (de @BotFather)"} className={fieldClass} />
              <span className="mt-1 block text-xs text-muted-foreground">Se verifica con Telegram y se guarda cifrado. Nunca se vuelve a mostrar.</span></label>
            <label className="block"><span className={lbl}>Chat id(s) — uno por línea</span>
              <textarea rows={3} value={chats} onChange={(e) => setChats(e.target.value)} placeholder={"123456789\n-1001234567890"}
                className={`${fieldClass} h-auto py-2.5 font-mono`} />
              <span className="mt-1 block text-xs text-muted-foreground">Chat privado: número positivo. Grupo: número negativo.</span></label>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} className="size-4 accent-[var(--mint-500)]" /> Recordatorios activados
            </label>
            <Check k="today" label="Cobros de hoy" />
            <Check k="overdue" label="Alertas de atraso" />
            <Check k="tomorrow" label="Cobros de mañana" />
            <Check k="payments" label="Pagos registrados / revertidos" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block"><span className={lbl}>Alertar con estos días de atraso</span>
              <input value={intervals} onChange={(e) => setIntervals(e.target.value)} className={fieldClass} placeholder="1, 3, 5, 7" /></label>
            <label className="block"><span className={lbl}>Después del último, repetir cada (días)</span>
              <input type="number" min={1} max={90} value={repeat} onChange={(e) => setRepeat(Math.max(1, Number(e.target.value) || 1))} className={fieldClass} /></label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!!busy} onClick={() => void save()}
              className="h-10 rounded-xl bg-mint-400 px-5 text-sm font-semibold text-primary-foreground hover:bg-mint-500 disabled:opacity-50">{busy === "save" ? "Guardando…" : "Guardar configuración"}</Button>
            <Button type="button" className={btn} disabled={!!busy || !st.configured} onClick={() => void detect()}>{busy === "detect" ? "Buscando…" : "Detectar chats"}</Button>
            <Button type="button" className={btn} disabled={!!busy || !st.configured} onClick={() => void act("check")}>{busy === "check" ? "Comprobando…" : "Comprobar conexión"}</Button>
            <Button type="button" className={btn} disabled={!!busy || !st.configured} onClick={() => void act("test")}>{busy === "test" ? "Enviando…" : "Enviar prueba"}</Button>
            <Button type="button" className={btn} disabled={!!busy || !st.configured} onClick={() => void act("run", "morning")}>Enviar ahora: hoy + vencidos</Button>
            <Button type="button" className={btn} disabled={!!busy || !st.configured} onClick={() => void act("run", "evening")}>Enviar ahora: mañana</Button>
            {st.tokenSet && <Button type="button" className={`${btn} text-destructive`} disabled={!!busy} onClick={() => void clearToken()}>Eliminar token</Button>}
          </div>
          {detected && detected.length > 0 && (
            <div className="rounded-xl border border-border bg-mint-50 p-3 text-sm">
              <p className="mb-2 text-[13px] text-muted-foreground">Chats que han escrito a tu bot. Elige uno para usarlo y luego pulsa Guardar configuración:</p>
              <ul className="space-y-1.5">
                {detected.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-3">
                    <span className="font-mono">{c.id}</span><span className="text-muted-foreground">{c.name || "(sin nombre)"} · {c.type === "private" ? "privado" : c.type}</span>
                    <button type="button" onClick={() => addChat(c.id)} className="rounded-full border border-border px-3 py-0.5 text-xs hover:bg-raised">Usar</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p aria-live="polite" className={`whitespace-pre-line text-[13px] ${msg?.ok ? "text-mint-600" : "text-destructive"}`}>{msg?.text}</p>

          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead><tr className="border-y border-border text-xs text-muted-foreground">
                {["Fecha", "Aviso", "Chat", "Estado", "Intentos", "Clientes", "Detalle"].map((h) => <th key={h} className="px-5 py-2.5 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {st.log.length === 0 && <tr><td colSpan={7} className="px-5 py-6 text-center text-muted-foreground">Aún no hay envíos registrados.</td></tr>}
                {st.log.map((r) => (
                  <tr key={r.id} className="border-b border-border/60 last:border-0">
                    <td className="px-5 py-2.5 text-muted-foreground">{new Date(r.created_at).toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td className="px-5 py-2.5">{KIND[r.kind] ?? r.kind}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-muted-foreground">{r.chat_id}</td>
                    <td className={`px-5 py-2.5 ${r.status === "sent" ? "text-mint-600" : "text-destructive"}`}>{STATUS[r.status] ?? r.status}</td>
                    <td className="px-5 py-2.5 tabular-nums">{r.attempts}</td>
                    <td className="px-5 py-2.5 tabular-nums">{r.items}</td>
                    <td className="px-5 py-2.5 text-muted-foreground">{r.last_error ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Card>
  );
}

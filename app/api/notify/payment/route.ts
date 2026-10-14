import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { notifyPayment } from "@/lib/reminders/dispatch";
import { logEvent } from "@/lib/log";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ paymentId: z.string().uuid(), event: z.enum(["payment", "reversal"]) });

/**
 * Aviso por Telegram de un pago registrado o revertido. Lo llama el navegador DESPUÉS de que Supabase confirmó la operación.
 * Seguridad: exige sesión; el pago se lee con el cliente del usuario (RLS), así que solo se puede avisar de pagos que ese
 * usuario puede ver. El token nunca sale del servidor. Es idempotente (un aviso por pago, evento y chat) y un fallo aquí
 * NUNCA afecta al pago, que ya está guardado.
 */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== request.headers.get("host")) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  if (!isSupabaseConfigured || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ ok: false, skipped: true }, { status: 202 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autenticado." }, { status: 401 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });

  const visible = await supabase.from("payments").select("id").eq("id", parsed.data.paymentId).maybeSingle();
  if (!visible.data) return NextResponse.json({ error: "Pago no encontrado." }, { status: 404 });

  try {
    const results = await notifyPayment(createServiceClient(), parsed.data.paymentId, parsed.data.event);
    return NextResponse.json({ ok: results.every((r) => r.status !== "failed"), results: results.map((r) => ({ status: r.status })) });
  } catch (e) {
    logEvent("error", "notify_payment_failed", { event: parsed.data.event, error: e });
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

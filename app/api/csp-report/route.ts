import { NextResponse } from "next/server";
import { logEvent } from "@/lib/log";
import { summarizeCspReport } from "@/lib/csp";

export const dynamic = "force-dynamic";

/**
 * Destino de `report-uri` de la CSP en modo Report-Only. Pública a propósito (el navegador envía los informes sin sesión):
 * solo registra un resumen mínimo (directiva, destino bloqueado y página, sin query strings) y descarta cuerpos grandes.
 */
export async function POST(request: Request) {
  try {
    const text = await request.text();
    if (text.length > 0 && text.length <= 16_384) logEvent("warn", "csp_violation", summarizeCspReport(JSON.parse(text)));
  } catch {
    /* informe mal formado: se ignora */
  }
  return new NextResponse(null, { status: 204 });
}

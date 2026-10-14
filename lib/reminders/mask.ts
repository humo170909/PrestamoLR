/** Utilidades de Chat ID sin dependencias (se usan en servidor y en el panel). */

/**
 * Deja el Chat ID exactamente como lo espera Telegram: sin espacios ni caracteres invisibles, y con el signo menos
 * normal ("-") aunque se haya copiado de Word/WhatsApp con un guion largo (− – —) o con dígitos de ancho completo.
 */
export function normalizeChatId(raw: string): string {
  return raw
    .normalize("NFKC")
    .replace(/[−‒–—―]/g, "-")
    .replace(/[​-‍⁠﻿\s]/g, "")
    .trim();
}

/** Muestra solo los últimos 4 caracteres (para diagnóstico sin revelar el Chat ID completo). */
export const maskChat = (id: string): string => (id.length <= 4 ? "••••" : `••••${id.slice(-4)}`);

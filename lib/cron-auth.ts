import { timingSafeEqual } from "node:crypto";

/**
 * Autorización del cron: la cabecera debe ser exactamente `Bearer <CRON_SECRET>`. Comparación en tiempo constante
 * (solo el largo es observable) y sin secreto configurado nadie queda autorizado.
 */
export function isCronAuthorized(authorization: string | null | undefined, secret: string | undefined): boolean {
  if (!secret) return false;
  const a = Buffer.from(authorization ?? "");
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

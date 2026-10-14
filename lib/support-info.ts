/**
 * Textos de ayuda del login (módulo puro). Antes "¿Olvidaste tu contraseña?", "Contáctanos" y "Ayuda" eran anclas vacías (#recuperar, #contacto, #ayuda).
 * NO hay recuperación de contraseña por correo todavía: el texto lo dice con claridad y orienta a quién acudir.
 * El dato de contacto es opcional (NEXT_PUBLIC_SUPPORT_CONTACT, p. ej. "WhatsApp +51 …"); se muestra como texto plano.
 */
export const SUPPORT_TOPIC_IDS = ["forgot", "contact", "help"] as const;
export type SupportTopicId = (typeof SUPPORT_TOPIC_IDS)[number];
export interface SupportTopic { title: string; paragraphs: string[]; contact?: string }

export function supportTopics(contactRaw?: string): Record<SupportTopicId, SupportTopic> {
  const contact = (contactRaw ?? "").replace(/[<>]/g, "").trim().slice(0, 120) || undefined;
  return {
    forgot: {
      title: "¿Olvidaste tu contraseña?",
      paragraphs: [
        "Por ahora la contraseña no se puede recuperar desde esta pantalla ni por correo.",
        "Pide a un administrador de LRomero que restablezca tu contraseña y te entregue una temporal; cámbiala en cuanto ingreses y no la compartas.",
        "Si eres el administrador y no puedes ingresar, la contraseña se restablece desde el panel de Supabase (Authentication > Users).",
      ],
    },
    contact: {
      title: "Contáctanos",
      paragraphs: [
        "Para consultas, accesos nuevos o problemas con tu cuenta, comunícate con el administrador de LRomero.",
        contact ? `Contacto: ${contact}` : "Pídele al administrador sus datos de contacto; todavía no hay un canal de soporte publicado en esta pantalla.",
      ],
      contact,
    },
    help: {
      title: "Ayuda para ingresar",
      paragraphs: [
        "Ingresa con el correo y la contraseña que te dio el administrador. Marca «Recordar mi correo» solo en tu equipo personal; la contraseña nunca se guarda.",
        "Si ves «Correo o contraseña incorrectos», revisa mayúsculas y espacios; tras varios intentos fallidos espera unos minutos antes de reintentar.",
        "Si ves «Servicio no disponible», tu sesión sigue abierta: espera unos segundos y reintenta.",
      ],
    },
  };
}

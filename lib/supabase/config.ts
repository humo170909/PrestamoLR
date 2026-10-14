/** Estado de configuración de Supabase (seguro en cliente y servidor: solo variables públicas). */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/** Los usuarios de demostración solo existen en desarrollo, sin Supabase y con la bandera explícita. */
export const isDemoAuthEnabled =
  !isSupabaseConfigured &&
  process.env.NODE_ENV !== "production" &&
  process.env.NEXT_PUBLIC_ENABLE_DEMO_AUTH === "true";

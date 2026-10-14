import { z } from "zod";
import { createClient } from "@/lib/supabase/client";

export const settingsSchema = z.object({
  business_name: z.string().trim().min(2, "Ingresa la razón social"),
  ruc: z.string().trim().regex(/^\d{11}$/, "El RUC debe tener 11 dígitos"),
  address: z.string().trim().max(200),
  currency: z.enum(["PEN", "USD"]),
  default_rate_pct: z.number().min(0).max(1000),
  late_fee_pct: z.number().min(0).max(100),
  grace_days: z.number().int().min(0).max(60),
});
export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  business_name: "", ruc: "", address: "", currency: "PEN", default_rate_pct: 10, late_fee_pct: 0, grace_days: 0,
};

const KEY = "business";

export async function loadSettings(): Promise<Settings> {
  const { data, error } = await createClient().from("settings").select("value").eq("key", KEY).maybeSingle();
  if (error) throw new Error(error.message);
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(data?.value ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

/** Solo el administrador puede guardar (RLS). */
export async function saveSettings(s: Settings): Promise<void> {
  const v = settingsSchema.parse(s);
  const { error } = await createClient().from("settings").upsert({ key: KEY, value: v });
  if (error) throw new Error(error.message);
}

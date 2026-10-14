import { DatabaseZap, FlaskConical } from "lucide-react";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { Card } from "./ui";

/** Aviso de procedencia de los datos. Los datos de lib/mock.ts NUNCA se muestran cuando hay Supabase. */
export function DemoBanner() {
  return (
    <div role="note" className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-[13px] text-foreground">
      <FlaskConical className="size-4 shrink-0 text-amber-600" />
      <span><strong>Datos de demostración.</strong> Las cifras, clientes y préstamos de esta pantalla son ficticios y no corresponden al negocio.</span>
    </div>
  );
}

export function PendingState({ module }: { module: string }) {
  return (
    <Card className="grid place-items-center gap-3 py-14 text-center">
      <DatabaseZap className="size-8 text-mint-600" />
      <h2 className="text-[15px] font-semibold text-foreground">Sin datos todavía</h2>
      <p className="max-w-md text-[13px] text-muted-foreground">
        {module} se conectará a Supabase en la siguiente etapa. Hasta entonces no se muestran cifras para no confundir datos de prueba con datos reales.
      </p>
    </Card>
  );
}

export const isDemoData = !isSupabaseConfigured;

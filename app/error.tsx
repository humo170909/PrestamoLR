"use client";

import { Button } from "@/components/ui/button";

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Algo salió mal</h1>
      <p className="max-w-sm text-sm text-muted-foreground">No se pudo mostrar esta pantalla. Tus datos no se han modificado. Inténtalo de nuevo.</p>
      <Button type="button" onClick={reset} className="rounded-xl bg-mint-400 px-6 font-semibold text-primary-foreground hover:bg-mint-500">Reintentar</Button>
    </main>
  );
}

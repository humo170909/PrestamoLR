import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-xl font-semibold">Página no encontrada</h1>
      <p className="text-sm text-muted-foreground">La dirección no existe o no tienes acceso.</p>
      <Link href="/dashboard" className="rounded-xl bg-mint-400 px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-mint-500">Ir al panel</Link>
    </main>
  );
}

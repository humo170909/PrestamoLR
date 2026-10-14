import { AnimatedBackdrop } from "./AnimatedBackdrop";
import { LoginForm } from "./LoginForm";
import { LoginVisual } from "./LoginVisual";

export function LoginCard() {
  return (
    <main className="page-bg grain relative flex min-h-dvh items-center justify-center overflow-x-hidden px-4 py-8 sm:px-6">
      <AnimatedBackdrop />
      <section
        className="grain relative z-10 grid w-full max-w-[480px] overflow-hidden rounded-card border border-white/70 dark:border-white/10 bg-card shadow-card
                   lg:h-[min(780px,calc(100dvh-4rem))] lg:min-h-[640px] lg:max-w-[1180px] lg:grid-cols-2 lg:p-5"
      >
        {/* Oculto por completo bajo lg */}
        <LoginVisual className="relative z-10 hidden lg:block" />
        <LoginForm />
      </section>
    </main>
  );
}

/** Fondo decorativo (solo visual): degradados verde → blanco (claro) / violeta → negro (oscuro) con movimientos distintos. */
export function AnimatedBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Barrido cónico muy lento */}
      <div
        className="absolute left-1/2 top-1/2 h-[150vmax] w-[150vmax] opacity-60 blur-[70px]"
        style={{
          transform: "translate(-50%,-50%)",
          background: "var(--bd-conic)",
          animation: "sheen 70s linear infinite",
        }}
      />
      {/* Menta */}
      <div className="blob -left-[8vmax] -top-[10vmax] h-[42vmax] w-[42vmax] bg-[var(--bd-a)]" style={{ animation: "drift-a 22s ease-in-out infinite" }} />
      {/* Lima pálido */}
      <div className="blob -bottom-[12vmax] -right-[6vmax] h-[40vmax] w-[40vmax] bg-[var(--bd-b)]" style={{ animation: "drift-b 28s ease-in-out infinite" }} />
      {/* Turquesa claro */}
      <div className="blob -right-[10vmax] -top-[8vmax] h-[30vmax] w-[30vmax] bg-[var(--bd-c)]" style={{ animation: "drift-c 34s ease-in-out infinite" }} />
      {/* Blanco, para mantener luz en el centro */}
      <div className="blob bottom-[5vmax] left-[18vmax] h-[28vmax] w-[28vmax] bg-[var(--bd-d)]" style={{ animation: "drift-a 30s ease-in-out infinite reverse" }} />
    </div>
  );
}

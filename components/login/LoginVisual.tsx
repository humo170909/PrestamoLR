"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { TypewriterText } from "./TypewriterText";
import { EASE } from "./field-styles";

const SLIDE_MS = 5000;
const FADE_S = 0.9;

// Coloca tus imágenes en  public/images/  con estos nombres exactos.
const slides = [
  { src: "/images/fondo1.png", text: "Soluciones claras para cada meta que te propones" },
  { src: "/images/fondo2.png", text: "Tu crédito, con respaldo y atención cercana" },
  { src: "/images/fondo3.png", text: "Estamos contigo en cada paso de tu camino" },
];

export function LoginVisual({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const elapsed = useRef(0);

  useEffect(() => {
    if (paused) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      if (elapsed.current >= SLIDE_MS) {
        elapsed.current = 0;
        setProgress(0);
        setActive((i) => (i + 1) % slides.length);
      } else {
        setProgress(elapsed.current / SLIDE_MS);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [paused]);

  const goTo = (i: number) => {
    elapsed.current = 0;
    setProgress(0);
    setActive(i);
  };

  return (
    <div
      className={cn("relative overflow-hidden rounded-[20px] bg-[#183428]", className)}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Imágenes: crossfade + Ken Burns sutil */}
      {slides.map((s, i) => {
        const on = i === active;
        return (
          <motion.div
            key={s.src}
            className="absolute inset-0"
            initial={false}
            animate={{ opacity: on ? 1 : 0, scale: reduce ? 1 : on ? 1.05 : 1 }}
            transition={{
              opacity: { duration: FADE_S, ease: EASE },
              scale: on ? { duration: (SLIDE_MS + 1000) / 1000, ease: "linear" } : { duration: 0, delay: FADE_S },
            }}
          >
            <Image
              src={s.src}
              alt=""
              fill
              priority={i === 0}
              sizes="(min-width: 1024px) 50vw, 0px"
              unoptimized
              className="object-cover"
            />
          </motion.div>
        );
      })}

      {/* Tinte violeta solo en modo oscuro */}
      <div className="pointer-events-none absolute inset-0 hidden bg-[#3b2a7d]/35 mix-blend-multiply dark:block" />

      {/* Overlays para legibilidad */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/25 to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[48%] bg-gradient-to-t from-black/65 via-black/20 to-transparent" />

      {/* Logo fijo */}
      <Image
        src="/logo.png"
        alt="LRomero Préstamos y Soluciones"
        width={190}
        height={63}
        priority
        className="absolute left-8 top-8 h-auto w-[190px]"
      />

      {/* Texto + indicadores */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center px-10 pb-8">
        <div className="min-h-[5.5rem] w-full max-w-[26rem] text-center">
          <AnimatePresence mode="wait">
            <motion.p
              key={active}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease: EASE }}
              className="font-display text-balance text-[32px] leading-[1.12] text-white"
            >
              <TypewriterText text={slides[active].text} />
            </motion.p>
          </AnimatePresence>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Ir a la imagen ${i + 1}`}
              aria-current={i === active}
              className="flex h-11 items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              <span
                className={cn(
                  "block h-[3px] overflow-hidden rounded-full bg-white/35 transition-[width] duration-300 ease-out-expo",
                  i === active ? "w-14" : "w-9",
                )}
              >
                <span
                  className="block h-full rounded-full bg-white"
                  style={{ width: i === active ? `${progress * 100}%` : "0%" }}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

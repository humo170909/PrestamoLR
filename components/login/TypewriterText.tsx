"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";

interface TypewriterTextProps {
  text: string;
  /** ms por letra */
  speed?: number;
  startDelay?: number;
  className?: string;
}

export function TypewriterText({ text, speed = 38, startDelay = 300, className }: TypewriterTextProps) {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (reduce) {
      setCount(text.length);
      return;
    }
    setCount(0);
    let i = 0;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        i += 1;
        setCount(i);
        if (i >= text.length && interval) clearInterval(interval);
      }, speed);
    }, startDelay);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [text, speed, startDelay, reduce]);

  return (
    <span className={className}>
      <span className="sr-only">{text}</span>
      {/* El texto completo, invisible, reserva el espacio y evita saltos de línea */}
      <span aria-hidden className="relative inline-block">
        <span className="invisible">{text}</span>
        <span className="absolute inset-0 text-center">
          {text.slice(0, count)}
          <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[0.14em] animate-blink bg-current" />
        </span>
      </span>
    </span>
  );
}

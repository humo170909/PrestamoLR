"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";

const KEY = "lromero:theme";

export function ThemeToggle({ className }: { className?: string }) {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    setMounted(true);
  }, []);

  const toggle = () => {
    const next = !dark;
    const root = document.documentElement;
    root.classList.add("theme-fade");
    root.classList.toggle("dark", next);
    window.setTimeout(() => root.classList.remove("theme-fade"), 350);
    setDark(next);
    try {
      window.localStorage.setItem(KEY, next ? "dark" : "light");
    } catch {
      /* almacenamiento no disponible */
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={mounted ? dark : undefined}
      aria-label={mounted ? (dark ? "Activar modo claro" : "Activar modo oscuro") : "Cambiar tema"}
      className={cn(
        "relative z-20 flex size-11 items-center justify-center rounded-full border border-border bg-raised text-muted-foreground",
        "transition-[color,transform,border-color] duration-200 ease-out-expo hover:border-mint-400 hover:text-foreground active:scale-[0.94]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-500",
        className,
      )}
    >
      <Sun className="absolute size-5 rotate-0 scale-100 opacity-100 transition-all duration-300 ease-out-expo dark:-rotate-90 dark:scale-50 dark:opacity-0" />
      <Moon className="absolute size-5 rotate-90 scale-50 opacity-0 transition-all duration-300 ease-out-expo dark:rotate-0 dark:scale-100 dark:opacity-100" />
    </button>
  );
}

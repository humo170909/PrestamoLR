"use client";

import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClass, labelClass } from "./field-styles";

interface PasswordInputProps extends Omit<React.ComponentProps<"input">, "type"> {
  label: string;
  error?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const auto = useId();
    const inputId = id ?? auto;
    const errorId = `${inputId}-error`;
    const [visible, setVisible] = useState(false);

    return (
      <div>
        <div className="relative">
          <input
            ref={ref}
            id={inputId}
            type={visible ? "text" : "password"}
            placeholder=" "
            autoComplete="current-password"
            aria-invalid={!!error}
            aria-describedby={error ? errorId : undefined}
            className={cn(inputClass, "pr-14", className)}
            {...props}
          />
          <label htmlFor={inputId} className={labelClass}>
            {label}
          </label>
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={visible}
            className="absolute right-1.5 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-2 focus-visible:outline-mint-500"
          >
            {visible ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
          </button>
        </div>
        <div aria-live="polite" className="min-h-5">
          {error && (
            <p id={errorId} className="mt-1.5 text-[13px] text-destructive">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  },
);
PasswordInput.displayName = "PasswordInput";

"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Mail, X } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { inputClass, labelClass } from "./field-styles";

interface SavedEmailsDropdownProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  inputRef?: React.Ref<HTMLInputElement>;
  emails: string[];
  onRemove: (email: string) => void;
  /** Se llama al elegir un correo guardado */
  onPick?: (email: string) => void;
  error?: string;
  name?: string;
}

export function SavedEmailsDropdown({
  label,
  value,
  onChange,
  onBlur,
  inputRef,
  emails,
  onRemove,
  onPick,
  error,
  name,
}: SavedEmailsDropdownProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const listId = `${id}-list`;
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [highlight, setHighlight] = useState("");
  const innerRef = useRef<HTMLInputElement | null>(null);
  const setRefs = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof inputRef === "function") inputRef(el);
    else if (inputRef) (inputRef as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };

  const options = useMemo(() => {
    const q = value.trim().toLowerCase();
    return emails.filter((e) => !q || e.includes(q));
  }, [emails, value]);

  const open = focused && !dismissed && options.length > 0;

  const pick = (email: string) => {
    onChange(email);
    onPick?.(email);
    setDismissed(true);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") return setDismissed(true);
    if (!options.length) return;
    const idx = options.indexOf(highlight);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setDismissed(false);
      setHighlight(options[(idx + 1) % options.length]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setDismissed(false);
      setHighlight(options[(idx - 1 + options.length) % options.length]);
    } else if (e.key === "Enter" && open && idx >= 0) {
      e.preventDefault();
      pick(options[idx]);
    }
  };

  return (
    <div>
      <Popover open={open}>
        <PopoverAnchor asChild>
          <div className="relative">
            <input
              ref={setRefs}
              id={id}
              name={name}
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder=" "
              value={value}
              role="combobox"
              aria-expanded={open}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-invalid={!!error}
              aria-describedby={error ? errorId : undefined}
              className={cn(inputClass, emails.length > 0 && "pr-12")}
              onClick={() => setDismissed(false)}
              onChange={(e) => {
                setDismissed(false);
                onChange(e.target.value);
              }}
              onFocus={() => {
                setFocused(true);
                setDismissed(false);
              }}
              onBlur={() => {
                setFocused(false);
                onBlur();
              }}
              onKeyDown={onKeyDown}
            />
            <label htmlFor={id} className={labelClass}>
              {label}
            </label>
            {emails.length > 0 && (
              <button
                type="button"
                aria-label={open ? "Ocultar correos guardados" : "Ver correos guardados"}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  innerRef.current?.focus();
                  setFocused(true);
                  setDismissed(open);
                }}
                className="absolute right-1.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-mint-500"
              >
                <ChevronDown className={cn("size-5 transition-transform duration-200 ease-out-expo", open && "rotate-180")} />
              </button>
            )}
          </div>
        </PopoverAnchor>

        <PopoverContent
          align="start"
          sideOffset={6}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
          className="w-(--radix-popover-trigger-width) rounded-xl border-border bg-popover p-1.5 shadow-[0_16px_40px_-16px_rgba(38,48,44,0.28)] duration-200 ease-out-expo"
        >
          <Command shouldFilter={false} value={highlight} onValueChange={setHighlight} className="bg-transparent">
            <CommandList id={listId} className="max-h-60">
              <CommandGroup heading="Correos guardados">
                {options.map((email) => (
                  <CommandItem
                    key={email}
                    value={email}
                    onSelect={() => pick(email)}
                    onMouseDown={(e) => e.preventDefault()} /* mantiene el foco en el input */
                    className="min-h-11 gap-3 rounded-lg px-3 data-[selected=true]:bg-mint-100 data-[selected=true]:text-foreground"
                  >
                    <Mail className="size-4 text-mint-600" />
                    <span className="flex-1 truncate text-sm">{email}</span>
                    <button
                      type="button"
                      aria-label={`Olvidar ${email}`}
                      title="Olvidar este correo"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(email);
                      }}
                      className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:bg-raised hover:text-foreground"
                    >
                      <X className="size-3.5" /> Olvidar
                    </button>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <div aria-live="polite" className="min-h-5">
        {error && (
          <p id={errorId} className="mt-1.5 text-[13px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

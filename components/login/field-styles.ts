export const EASE = [0.22, 1, 0.36, 1] as const;

export const inputClass =
  "peer h-14 w-full rounded-xl border border-border bg-mint-50 px-4 pt-5 pb-1.5 text-[15px] text-foreground " +
  "outline-none transition-[border-color,box-shadow,background-color] duration-200 ease-out-expo " +
  "placeholder:text-transparent focus:border-mint-500 focus:bg-raised focus:ring-4 focus:ring-mint-400/40 " +
  "aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-4 aria-[invalid=true]:ring-destructive/15";

export const labelClass =
  "pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-muted-foreground " +
  "transition-all duration-200 ease-out-expo " +
  "peer-focus:top-2.5 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-mint-600 " +
  "peer-not-placeholder-shown:top-2.5 peer-not-placeholder-shown:translate-y-0 peer-not-placeholder-shown:text-xs";

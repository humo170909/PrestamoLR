-- Notificaciones de cobranza por Telegram: intervalos de atraso, avisos de pago y estado de ejecución.
-- Aditiva: solo ADD COLUMN con valores por defecto y ampliación del CHECK de tipos. NO toca el token cifrado ni los chat ids guardados.

alter table public.telegram_settings
  add column send_payments       boolean not null default true,                 -- avisar al registrar / revertir un pago
  add column overdue_intervals   int[]   not null default '{1,3,5,7}'
    check (cardinality(overdue_intervals) > 0 and 0 < all (overdue_intervals)),  -- días de atraso que disparan alerta
  add column overdue_repeat_days int     not null default 7 check (overdue_repeat_days >= 1), -- después, cada N días
  add column last_run_at         timestamptz,                                   -- panel de estado
  add column last_run_job        text,
  add column last_run_summary    jsonb;

alter table public.notification_log drop constraint notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('tomorrow', 'today', 'overdue', 'test', 'payment', 'reversal'));
-- Obligaciones incluidas en cada aviso (diagnóstico y trazabilidad: préstamo:cuota:días).
alter table public.notification_log add column item_keys text[] not null default '{}';

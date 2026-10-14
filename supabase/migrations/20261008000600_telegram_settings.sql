-- Configuración de Telegram editable desde el panel. Aditiva.
-- El token se guarda CIFRADO (AES-256-GCM, clave TELEGRAM_ENCRYPTION_KEY solo en el servidor).
-- Sin políticas RLS y sin privilegios para anon/authenticated: únicamente el servidor (service_role) la lee o escribe,
-- por lo que el token cifrado jamás llega al navegador.
create table public.telegram_settings (
  id             int primary key default 1 check (id = 1),     -- una sola fila
  bot_token_enc  text,
  chat_ids       text[] not null default '{}',
  enabled        boolean not null default true,
  send_today     boolean not null default true,
  send_overdue   boolean not null default true,
  send_tomorrow  boolean not null default true,
  updated_by     uuid references public.profiles (id),
  updated_at     timestamptz not null default now()
);
alter table public.telegram_settings enable row level security;
revoke all on public.telegram_settings from anon, authenticated;

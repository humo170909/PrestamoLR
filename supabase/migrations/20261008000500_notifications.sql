-- Registro de notificaciones (Telegram). Aditiva.
-- Solo las escribe el servidor con la clave service_role (cron / panel de admin). Los usuarios solo leen (admin).
-- Un error de Telegram nunca toca pagos ni cronogramas: esta tabla es independiente.

create table public.notification_log (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('tomorrow', 'today', 'overdue', 'test')),
  for_date    date not null,
  chat_id     text not null,
  dedupe_key  text not null unique,                 -- kind:fecha:chat → evita duplicados
  status      text not null check (status in ('sent', 'failed')),
  attempts    int  not null default 1 check (attempts >= 1),
  items       int  not null default 0,              -- clientes/préstamos incluidos
  last_error  text,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);
create index on public.notification_log (created_at desc);

alter table public.notification_log enable row level security;
create policy notification_log_admin_select on public.notification_log for select to authenticated using (app.current_role() = 'admin');
revoke all on public.notification_log from anon, authenticated;
grant select on public.notification_log to authenticated;

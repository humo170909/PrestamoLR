-- Registro persistente de cada ejecución de las notificaciones (cron o manual). Aditiva: tabla nueva.
-- Las fechas se guardan en UTC (timestamptz) y se muestran en America/Lima. Solo las escribe el servidor (service_role);
-- el administrador las lee por RLS. Nunca contiene el token ni Chat IDs.

create table public.notification_runs (
  id                  uuid primary key default gen_random_uuid(),
  job                 text not null check (job in ('morning', 'evening', 'all')),
  trigger             text not null default 'cron' check (trigger in ('cron', 'manual')),
  started_at          timestamptz not null,
  finished_at         timestamptz not null,
  timezone            text not null default 'America/Lima',
  status              text not null check (status in ('ok', 'partial', 'error', 'skipped')),
  obligations_checked int not null default 0,
  sent                int not null default 0,
  skipped             int not null default 0,
  failed              int not null default 0,
  errors              text[] not null default '{}'
);
create index on public.notification_runs (started_at desc);

alter table public.notification_runs enable row level security;
create policy notification_runs_admin_select on public.notification_runs for select to authenticated using (app.current_role() = 'admin');
revoke all on public.notification_runs from anon, authenticated;
grant select on public.notification_runs to authenticated;

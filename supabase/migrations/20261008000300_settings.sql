-- Configuración del negocio. Todos los usuarios activos la leen; solo el administrador la modifica. Aditiva.
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_by uuid default auth.uid() references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.settings enable row level security;
create policy settings_select on public.settings for select to authenticated using (app.current_role() is not null);
create policy settings_admin_ins on public.settings for insert to authenticated with check (app.current_role() = 'admin');
create policy settings_admin_upd on public.settings for update to authenticated using (app.current_role() = 'admin') with check (app.current_role() = 'admin');
revoke all on public.settings from anon;

create function app.settings_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger settings_touch before update on public.settings for each row execute function app.settings_touch();

-- La auditoría genérica usa la columna id; settings usa key.
create function app.audit_key() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (action, entity, entity_id, before, after)
  values (tg_op, tg_table_name, new.key, case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
create trigger audit_settings after insert or update on public.settings for each row execute function app.audit_key();

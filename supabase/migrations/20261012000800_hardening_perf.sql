-- Endurecimiento, rendimiento y una sola definición de saldos (resultado de la auditoría integral).
-- No borra ni modifica datos: REPARACIÓN idempotente de objetos que podían faltar, REVOKE, índices y CREATE OR REPLACE.
-- Es seguro ejecutarla aunque ya se haya aplicado en parte o aunque no existan algunos objetos antiguos.

-- ───────────── 0) Reparación idempotente (objetos de 20261008000700 que pueden faltar en una base ya migrada) ─────────────
-- Cierre automático de préstamos: sin estos triggers un préstamo totalmente pagado NO pasaba a 'paid_off'.
-- app.sync_loan_status(uuid) ya la define 20261012000000 (con cierre del préstamo abierto) y no se toca aquí.
create or replace function app.sync_loan_status_from_loan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform app.sync_loan_status(new.id); return null; end $$;

create or replace function app.sync_loan_status_from_installment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform app.sync_loan_status(new.loan_id); return null; end $$;

drop trigger if exists loan_status_sync_loan on public.loans;
create trigger loan_status_sync_loan after update of principal_outstanding on public.loans
  for each row execute function app.sync_loan_status_from_loan();
drop trigger if exists loan_status_sync_installment on public.installments;
create trigger loan_status_sync_installment after update of interest_paid, capital_paid on public.installments
  for each row execute function app.sync_loan_status_from_installment();

-- Personal con clientes asignados y total cobrado (pantalla Trabajadores) y cobradores asignables (formulario de clientes).
create or replace function public.worker_stats() returns table (id uuid, full_name text, role public.user_role, active boolean, clients bigint, collected numeric)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.full_name, p.role, p.active,
    (select count(*) from public.clients c where c.assigned_collector = p.id and c.active),
    coalesce((select sum(y.amount) from public.payments y where y.received_by = p.id and y.status = 'confirmed'), 0)
  from public.profiles p order by p.full_name
$$;
create or replace function public.list_collectors() returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name from public.profiles p
  where p.role = 'collector' and p.active and app.current_role() in ('admin', 'advisor')
  order by p.full_name
$$;
revoke execute on function public.worker_stats(), public.list_collectors() from public, anon;
grant  execute on function public.worker_stats(), public.list_collectors() to authenticated;

-- Reevalúa el estado de los préstamos ya existentes (los totalmente pagados pasan a 'paid_off'; no cambia nada más).
do $$ declare r record; begin
  for r in select id from public.loans where status in ('active', 'paid_off') loop perform app.sync_loan_status(r.id); end loop;
end $$;

-- ───────────── 1) Permisos sobrantes (defensa en profundidad; RLS ya los bloqueaba) ─────────────
-- Las vistas son de solo lectura y solo para usuarios autenticados (con security_invoker, anon ya fallaba por la tabla base).
revoke all on public.v_loan_portfolio, public.v_loan_summary from anon;
revoke insert, update, delete on public.v_loan_portfolio, public.v_loan_summary from authenticated;
-- loan_events solo se escribe desde funciones (create_loan, cancel_loan) y el trigger de auditoría.
revoke insert, update, delete on public.loan_events from authenticated;

-- Funciones internas del esquema app: ya no son ejecutables directamente por ningún rol de la API.
-- (Las usan funciones SECURITY DEFINER y triggers, que se ejecutan con el propietario. Se dejan app.current_role,
--  app.can_see_client y app.can_see_loan porque las políticas RLS las evalúan con el rol del usuario.)
do $$ declare f text; o regprocedure; begin
  foreach f in array array[
    'app.accrue_open_loan(uuid)', 'app.recompute_open_future(uuid)', 'app.open_period_interest(uuid, date)',
    'app.sync_loan_status(uuid)', 'app.sync_loan_status_from_loan()', 'app.sync_loan_status_from_installment()',
    'app.audit()', 'app.audit_key()', 'app.client_guard()', 'app.profile_guard()', 'app.loan_guard()', 'app.forbid_mutation()', 'app.settings_touch()'
  ] loop
    o := to_regprocedure(f);                                   -- si una función no existe en esta base, se omite sin error
    if o is not null then execute format('revoke execute on function %s from public, anon, authenticated', o); end if;
  end loop;
end $$;

-- ───────────── 2) Rendimiento: el devengo ya no bloquea filas en cada lectura ─────────────
-- Antes recorría y BLOQUEABA todos los préstamos abiertos cada vez que se abría la lista, el detalle o los reportes.
-- Ahora solo toca los que realmente necesitan un período nuevo (el último período materializado ya venció).
-- (El recálculo de períodos futuros ocurre al registrar o revertir pagos, donde cambia el capital.)
create or replace function public.refresh_open_loans() returns int
language plpgsql security definer set search_path = '' as $$
declare
  r record; v int := 0;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if auth.uid() is not null and app.current_role() is null then raise exception 'No autorizado'; end if;
  for r in select l.id from public.loans l
           where l.loan_type = 'open' and l.status = 'active' and l.principal_outstanding > 0
             and coalesce((select max(i.due_date) from public.installments i where i.loan_id = l.id), '-infinity'::date) <= v_today
           order by l.id loop
    if auth.uid() is null or app.can_see_loan(r.id) then
      perform 1 from public.loans where id = r.id for update;
      perform app.accrue_open_loan(r.id);
      v := v + 1;
    end if;
  end loop;
  return v;
end $$;

create index if not exists payments_paid_on_idx on public.payments (paid_on);
create index if not exists cash_movements_loan_idx on public.cash_movements (loan_id);
create index if not exists loans_open_active_idx on public.loans (id) where loan_type = 'open' and status = 'active';

-- ───────────── 3) Una sola fórmula de saldos: v_loan_portfolio pasa a leer v_loan_summary ─────────────
-- Antes tenía su propia fórmula y "interés pendiente" incluía intereses FUTUROS (y el período siguiente del préstamo abierto),
-- distinto de v_loan_summary / reportes. Ahora ambos coinciden: pendiente = generado (vencido o de hoy) y aún sin cobrar.
-- interest_total sigue siendo el total del cronograma. Las columnas son las mismas que usaba la aplicación.
do $$ begin
  begin
    create or replace view public.v_loan_portfolio with (security_invoker = true) as
    select
      s.id, s.code, s.db_status as status, s.principal, s.principal_outstanding,
      s.client_id, s.full_name, s.document_id, s.phone, s.assigned_collector,
      s.interest_scheduled::numeric as interest_total, s.interest_paid::numeric as interest_paid,
      s.interest_pending::numeric as interest_pending, s.interest_overdue::numeric as interest_overdue,
      s.capital_overdue::numeric(14,2) as capital_overdue, s.oldest_overdue_date, s.days_overdue::int as days_overdue
    from public.v_loan_summary s
    where s.db_status in ('active', 'defaulted');
  exception when invalid_table_definition then
    -- La vista no guarda datos: si un tipo de columna difiere, se recrea.
    drop view public.v_loan_portfolio;
    create view public.v_loan_portfolio with (security_invoker = true) as
    select
      s.id, s.code, s.db_status as status, s.principal, s.principal_outstanding,
      s.client_id, s.full_name, s.document_id, s.phone, s.assigned_collector,
      s.interest_scheduled as interest_total, s.interest_paid, s.interest_pending, s.interest_overdue,
      s.capital_overdue, s.oldest_overdue_date, s.days_overdue
    from public.v_loan_summary s
    where s.db_status in ('active', 'defaulted');
  end;
end $$;

grant select on public.v_loan_portfolio to authenticated;

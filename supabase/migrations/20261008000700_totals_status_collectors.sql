-- Totales en la base de datos, cierre automático de préstamos y lista de cobradores para asesores. Aditiva:
-- solo CREATE; no modifica register_payment ni reverse_payment (la lógica de imputación queda intacta).

-- ───────────── 1) Cierre automático: un préstamo totalmente pagado pasa a 'paid_off' ─────────────
-- Se reevalúa tras cada cambio de cobros. Si un pago se revierte y el préstamo vuelve a deber algo, regresa a 'active'.
create function app.sync_loan_status(p_loan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loan public.loans%rowtype;
  v_done boolean;
begin
  select * into v_loan from public.loans where id = p_loan;
  if not found or v_loan.status not in ('active', 'paid_off') then return; end if;

  v_done := v_loan.principal_outstanding = 0 and not exists (
    select 1 from public.installments where loan_id = p_loan and (interest_paid < interest_due or capital_paid < capital_due)
  );
  if v_done and v_loan.status = 'active' then
    update public.loans set status = 'paid_off' where id = p_loan;
  elsif not v_done and v_loan.status = 'paid_off' then
    update public.loans set status = 'active' where id = p_loan;
  end if;
end $$;

create function app.sync_loan_status_from_loan() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform app.sync_loan_status(new.id); return null; end $$;

create function app.sync_loan_status_from_installment() returns trigger
language plpgsql security definer set search_path = '' as $$
begin perform app.sync_loan_status(new.loan_id); return null; end $$;

-- Solo al tocar el capital pendiente (el cambio de estado no vuelve a disparar el trigger).
create trigger loan_status_sync_loan after update of principal_outstanding on public.loans
  for each row execute function app.sync_loan_status_from_loan();
create trigger loan_status_sync_installment after update of interest_paid, capital_paid on public.installments
  for each row execute function app.sync_loan_status_from_installment();

-- ───────────── 2) Totales calculados en SQL (el navegador truncaba a 1000 filas) ─────────────
-- security invoker: se evalúan con el RLS de quien consulta.
create function public.report_totals() returns table (interest numeric, capital numeric, disbursed numeric)
language sql stable security invoker set search_path = '' as $$
  select
    coalesce((select sum(interest_amount) from public.payments where status = 'confirmed'), 0),
    coalesce((select sum(capital_amount)  from public.payments where status = 'confirmed'), 0),
    coalesce((select sum(amount) from public.disbursements), 0)
$$;

-- Últimos 6 meses (mes calendario de Lima) de desembolsos, intereses cobrados y capital recuperado.
create function public.monthly_cash() returns table (month date, disbursed numeric, interest numeric, capital numeric)
language sql stable security invoker set search_path = '' as $$
  with months as (
    select (date_trunc('month', (now() at time zone 'America/Lima')) - make_interval(months => g))::date as m
    from generate_series(5, 0, -1) g
  )
  select m.m,
    coalesce(sum(c.amount) filter (where c.kind = 'disbursement'), 0),
    coalesce(sum(c.amount) filter (where c.kind = 'interest_income'), 0),
    coalesce(sum(c.amount) filter (where c.kind = 'capital_recovery'), 0)
  from months m
  left join public.cash_movements c on date_trunc('month', c.created_at at time zone 'America/Lima')::date = m.m
  group by m.m order by m.m
$$;

-- Personal con clientes asignados y total cobrado. Solo el administrador ve a todos (RLS de profiles).
create function public.worker_stats() returns table (id uuid, full_name text, role public.user_role, active boolean, clients bigint, collected numeric)
language sql stable security invoker set search_path = '' as $$
  select p.id, p.full_name, p.role, p.active,
    (select count(*) from public.clients c where c.assigned_collector = p.id and c.active),
    coalesce((select sum(y.amount) from public.payments y where y.received_by = p.id and y.status = 'confirmed'), 0)
  from public.profiles p order by p.full_name
$$;

-- ───────────── 3) Cobradores asignables (el RLS de profiles ocultaba la lista a los asesores) ─────────────
create function public.list_collectors() returns table (id uuid, full_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name from public.profiles p
  where p.role = 'collector' and p.active and app.current_role() in ('admin', 'advisor')
  order by p.full_name
$$;

revoke execute on function public.report_totals(), public.monthly_cash(), public.worker_stats(), public.list_collectors() from public, anon;
grant  execute on function public.report_totals(), public.monthly_cash(), public.worker_stats(), public.list_collectors() to authenticated;

-- Reportes y cierre: fecha de cancelación, caja sin duplicados y más datos en v_loan_summary. Aditiva
-- (ADD COLUMN, índice único, CREATE OR REPLACE de app.sync_loan_status y de la vista; no borra información).

-- ───────────── 1) Fecha de cancelación ─────────────
alter table public.loans add column closed_on date;

create or replace function app.sync_loan_status(p_loan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loan public.loans%rowtype;
  v_today date := (now() at time zone 'America/Lima')::date;
  v_done boolean;
begin
  select * into v_loan from public.loans where id = p_loan;
  if not found or v_loan.status not in ('active', 'paid_off') then return; end if;

  v_done := v_loan.principal_outstanding = 0 and not exists (
    select 1 from public.installments
    where loan_id = p_loan and (interest_paid < interest_due or capital_paid < capital_due)
      and (v_loan.loan_type <> 'open' or due_date <= v_today)
  );
  if v_done and v_loan.status = 'active' then
    update public.loans set status = 'paid_off', closed_on = v_today where id = p_loan;
  elsif not v_done and v_loan.status = 'paid_off' then
    update public.loans set status = 'active', closed_on = null where id = p_loan;
  end if;
end $$;

-- Préstamos ya cancelados antes de esta migración: se toma la fecha de su último pago confirmado.
update public.loans l set closed_on = coalesce(
  (select max(p.paid_on) from public.payments p where p.loan_id = l.id and p.status = 'confirmed'), l.start_date)
where l.status = 'paid_off' and l.closed_on is null;

-- ───────────── 2) Caja: un movimiento por pago y tipo (no se duplica al reprocesar) ─────────────
create unique index if not exists cash_movements_payment_kind_uq
  on public.cash_movements (payment_id, kind) where payment_id is not null;

-- ───────────── 3) Resumen ampliado (columnas nuevas al final, las anteriores no cambian) ─────────────
create or replace view public.v_loan_summary with (security_invoker = true) as
with t as (select (now() at time zone 'America/Lima')::date as today),
inst as (
  select i.loan_id,
    count(*)                                                                                   as periods_materialized,
    count(*) filter (where i.interest_paid >= i.interest_due and i.capital_paid >= i.capital_due) as periods_paid,
    count(*) filter (where i.due_date <= t.today)                                              as periods_elapsed,
    count(*) filter (where i.due_date < t.today and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)) as periods_overdue,
    coalesce(sum(i.interest_due), 0)                                                           as interest_scheduled,
    coalesce(sum(i.interest_due)  filter (where i.due_date <= t.today), 0)                     as interest_generated,
    coalesce(sum(i.interest_paid), 0)                                                          as interest_paid,
    coalesce(sum(i.interest_due - i.interest_paid) filter (where i.due_date <= t.today), 0)    as interest_pending,
    coalesce(sum(i.interest_due - i.interest_paid) filter (where i.due_date < t.today), 0)     as interest_overdue,
    coalesce(sum(i.capital_due - i.capital_paid)   filter (where i.due_date < t.today), 0)     as capital_overdue,
    min(i.due_date) filter (where i.due_date < t.today and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)) as oldest_overdue_date,
    min(i.due_date) filter (where i.interest_paid < i.interest_due or i.capital_paid < i.capital_due) as next_due_date,
    count(*) filter (where i.due_date <= t.today and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)) as periods_unpaid_exigible,
    coalesce(sum((i.interest_due - i.interest_paid) + (i.capital_due - i.capital_paid)) filter (where i.due_date = t.today), 0) as due_today_pending
  from public.installments i cross join t group by i.loan_id
)
select
  l.id, l.code, l.loan_type, l.status as db_status, l.client_id, c.full_name, c.document_id, c.phone, c.assigned_collector,
  l.principal, l.principal_outstanding, l.principal - l.principal_outstanding as capital_paid,
  l.rate_pct, l.frequency, l.periods, l.start_date, l.created_at,
  coalesce(x.interest_generated, 0) as interest_generated,
  coalesce(x.interest_paid, 0)      as interest_paid,
  coalesce(x.interest_pending, 0)   as interest_pending,
  coalesce(x.interest_overdue, 0)   as interest_overdue,
  coalesce(x.capital_overdue, 0)    as capital_overdue,
  case when l.loan_type = 'open' then null else x.interest_scheduled end as interest_projected,
  x.next_due_date, x.oldest_overdue_date,
  case when x.oldest_overdue_date is null then 0 else t.today - x.oldest_overdue_date end as days_overdue,
  coalesce(x.periods_elapsed, 0) as periods_elapsed, coalesce(x.periods_paid, 0) as periods_paid,
  coalesce(x.periods_overdue, 0) as periods_overdue,
  (select coalesce(sum(p.amount), 0) from public.payments p where p.loan_id = l.id and p.status = 'confirmed') as total_paid,
  (select max(p.paid_on) from public.payments p where p.loan_id = l.id and p.status = 'confirmed')               as last_payment_on,
  case
    when l.status = 'paid_off' then 'paid'
    when l.status in ('active', 'defaulted') and (coalesce(x.interest_overdue, 0) + coalesce(x.capital_overdue, 0)) > 0 then 'overdue'
    when l.status in ('active', 'defaulted') then 'active'
    else l.status::text end as derived_status,
  l.closed_on,
  coalesce(x.interest_scheduled, 0)        as interest_scheduled,
  coalesce(x.periods_unpaid_exigible, 0)   as periods_unpaid_exigible,
  coalesce(x.due_today_pending, 0)         as due_today_pending,
  (select coalesce(sum((j.interest_due - j.interest_paid) + (j.capital_due - j.capital_paid)), 0)
     from public.installments j where j.loan_id = l.id and j.due_date = x.next_due_date
      and (j.interest_paid < j.interest_due or j.capital_paid < j.capital_due))   as next_due_amount,
  t.today as business_today
from public.loans l
join public.clients c on c.id = l.client_id
cross join t
left join inst x on x.loan_id = l.id
where l.status <> 'draft';

grant select on public.v_loan_summary to authenticated;

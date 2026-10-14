-- La mora se calcula con la fecha de Lima (America/Lima), no la UTC del servidor:
-- entre las 19:00 y las 24:00 hora local, current_date ya sería "mañana" y marcaría mora un día antes. Aditiva.
create or replace view public.v_loan_portfolio with (security_invoker = true) as
select
  l.id, l.code, l.status, l.principal, l.principal_outstanding,
  c.id as client_id, c.full_name, c.document_id, c.phone, c.assigned_collector,
  coalesce(sum(i.interest_due), 0)                                                      as interest_total,
  coalesce(sum(i.interest_paid), 0)                                                     as interest_paid,
  coalesce(sum(i.interest_due - i.interest_paid), 0)                                    as interest_pending,
  coalesce(sum(i.interest_due - i.interest_paid) filter (where i.due_date < (now() at time zone 'America/Lima')::date), 0) as interest_overdue,
  case when max(i.due_date) < (now() at time zone 'America/Lima')::date then l.principal_outstanding else 0 end as capital_overdue,
  min(i.due_date) filter (
    where i.due_date < (now() at time zone 'America/Lima')::date and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)
  )                                                                                     as oldest_overdue_date,
  case when min(i.due_date) filter (
    where i.due_date < (now() at time zone 'America/Lima')::date and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)
  ) is null then 0
  else (now() at time zone 'America/Lima')::date - min(i.due_date) filter (
    where i.due_date < (now() at time zone 'America/Lima')::date and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)
  ) end                                                                                 as days_overdue
from public.loans l
join public.clients c on c.id = l.client_id
left join public.installments i on i.loan_id = l.id
where l.status in ('active', 'defaulted')
group by l.id, c.id;

grant select on public.v_loan_portfolio to authenticated;

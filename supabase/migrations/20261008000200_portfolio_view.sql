-- Vista de cartera por préstamo (dashboard, morosidad, reportes). Aditiva.
-- security_invoker: se evalúa con los permisos (RLS) de quien consulta, así un cobrador solo ve sus préstamos.

create view public.v_loan_portfolio with (security_invoker = true) as
select
  l.id, l.code, l.status, l.principal, l.principal_outstanding,
  c.id as client_id, c.full_name, c.document_id, c.phone, c.assigned_collector,
  coalesce(sum(i.interest_due), 0)                                                      as interest_total,
  coalesce(sum(i.interest_paid), 0)                                                     as interest_paid,
  coalesce(sum(i.interest_due - i.interest_paid), 0)                                    as interest_pending,
  coalesce(sum(i.interest_due - i.interest_paid) filter (where i.due_date < current_date), 0) as interest_overdue,
  -- el capital vence con el último vencimiento
  case when max(i.due_date) < current_date then l.principal_outstanding else 0 end      as capital_overdue,
  min(i.due_date) filter (
    where i.due_date < current_date and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)
  )                                                                                     as oldest_overdue_date,
  case when min(i.due_date) filter (
    where i.due_date < current_date and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)
  ) is null then 0
  else current_date - min(i.due_date) filter (
    where i.due_date < current_date and (i.interest_paid < i.interest_due or i.capital_paid < i.capital_due)
  ) end                                                                                 as days_overdue
from public.loans l
join public.clients c on c.id = l.client_id
left join public.installments i on i.loan_id = l.id
where l.status in ('active', 'defaulted')
group by l.id, c.id;

grant select on public.v_loan_portfolio to authenticated;

-- Anulación (eliminación lógica) de préstamos. Los préstamos, pagos y movimientos de caja NO se pueden borrar (triggers
-- no_delete_*): la "eliminación" conserva todo el historial y registra un contra-asiento del desembolso.
-- Reglas: solo administrador; no se anula un préstamo con pagos confirmados (primero se revierten con motivo) ni uno ya cancelado
-- por pago; la operación es transaccional y auditable. Aditiva: solo CREATE / CREATE OR REPLACE.

create function public.cancel_loan(p_loan_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loan  public.loans%rowtype;
  v_today date := (now() at time zone 'America/Lima')::date;
begin
  if app.current_role() is distinct from 'admin' then raise exception 'Solo un administrador puede eliminar (anular) préstamos'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'Indica el motivo (mínimo 5 caracteres)'; end if;

  select * into v_loan from public.loans where id = p_loan_id for update;       -- serializa con pagos y reversiones
  if not found then raise exception 'Préstamo no encontrado'; end if;
  if v_loan.status = 'cancelled' then raise exception 'El préstamo ya está anulado'; end if;
  if v_loan.status = 'paid_off' then raise exception 'Un préstamo cancelado por pago no se puede anular'; end if;
  if exists (select 1 from public.payments where loan_id = p_loan_id and status = 'confirmed') then
    raise exception 'El préstamo tiene pagos confirmados. Revierte primero esos pagos (con su motivo) para poder anularlo; el historial se conserva.';
  end if;

  update public.loans set status = 'cancelled', closed_on = v_today where id = p_loan_id;
  -- Contra-asiento: el dinero del desembolso vuelve a caja sin borrar el asiento original.
  insert into public.cash_movements (kind, direction, amount, loan_id, concept)
  values ('reversal', 'in', v_loan.principal, p_loan_id, 'Anulación de desembolso: ' || trim(p_reason));
  insert into public.loan_events (loan_id, kind, detail, authorized_by)
  values (p_loan_id, 'cancelled', jsonb_build_object('reason', trim(p_reason), 'principal', v_loan.principal), auth.uid());
  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('CANCEL_LOAN', 'loans', p_loan_id::text, to_jsonb(v_loan), jsonb_build_object('reason', trim(p_reason)));
end $$;

revoke execute on function public.cancel_loan(uuid, text) from public, anon;
grant  execute on function public.cancel_loan(uuid, text) to authenticated;

-- Los préstamos anulados no cuentan como capital desembolsado en reportes ni en el gráfico mensual.
create or replace function public.report_totals() returns table (interest numeric, capital numeric, disbursed numeric)
language sql stable security invoker set search_path = '' as $$
  select
    coalesce((select sum(interest_amount) from public.payments where status = 'confirmed'), 0),
    coalesce((select sum(capital_amount)  from public.payments where status = 'confirmed'), 0),
    coalesce((select sum(d.amount) from public.disbursements d join public.loans l on l.id = d.loan_id where l.status <> 'cancelled'), 0)
$$;

create or replace function public.monthly_cash() returns table (month date, disbursed numeric, interest numeric, capital numeric)
language sql stable security invoker set search_path = '' as $$
  with months as (
    select (date_trunc('month', (now() at time zone 'America/Lima')) - make_interval(months => g))::date as m
    from generate_series(5, 0, -1) g
  )
  select m.m,
    coalesce(sum(c.amount) filter (where c.kind = 'disbursement'
      and not exists (select 1 from public.loans l where l.id = c.loan_id and l.status = 'cancelled')), 0),
    coalesce(sum(c.amount) filter (where c.kind = 'interest_income'), 0),
    coalesce(sum(c.amount) filter (where c.kind = 'capital_recovery'), 0)
  from months m
  left join public.cash_movements c on date_trunc('month', c.created_at at time zone 'America/Lima')::date = m.m
  group by m.m order by m.m
$$;

-- Correcciones del lote 1 de la auditoría. Aditiva e idempotente: solo REVOKE/GRANT y CREATE OR REPLACE de funciones de lectura.
-- No toca tablas con datos ni reglas financieras.

-- ───────────── B-01: v_loan_portfolio quedó con privilegios por defecto tras el DROP VIEW de 20261012000800 ─────────────
-- Solo lectura y solo para usuarios autenticados (con security_invoker, el RLS de las tablas base sigue aplicando).
revoke all on public.v_loan_portfolio from anon;
revoke insert, update, delete, truncate, references, trigger on public.v_loan_portfolio from authenticated;
grant select on public.v_loan_portfolio to authenticated;

-- ───────────── I-07: anon no debe ejecutar las funciones auxiliares de RLS ─────────────
-- Las políticas las evalúan con el rol del usuario autenticado, que las conserva.
revoke execute on function app.current_role() from public, anon;
revoke execute on function app.can_see_client(uuid) from public, anon;
revoke execute on function app.can_see_loan(uuid) from public, anon;
revoke execute on function app.due_date_of(date, public.pay_frequency, int) from public, anon;
grant  execute on function app.current_role() to authenticated;
grant  execute on function app.can_see_client(uuid) to authenticated;
grant  execute on function app.can_see_loan(uuid) to authenticated;
grant  execute on function app.due_date_of(date, public.pay_frequency, int) to authenticated;

-- ───────────── M-01: monthly_cash() no debe sumar cobros de pagos revertidos ─────────────
-- Coherente con report_totals(): solo cuentan los pagos confirmados. Un cobro de caja (interest_income / capital_recovery)
-- se omite cuando su pago está revertido; el contra-asiento 'reversal' sigue existiendo en la caja, pero su importe
-- (interés + capital juntos) no se puede repartir por tipo, por eso se filtra el asiento original en lugar de restar.
-- security invoker, misma firma y mismas columnas: el RLS de quien consulta sigue aplicando.
create or replace function public.monthly_cash() returns table (month date, disbursed numeric, interest numeric, capital numeric)
language sql stable security invoker set search_path = '' as $$
  with months as (
    select (date_trunc('month', (now() at time zone 'America/Lima')) - make_interval(months => g))::date as m
    from generate_series(5, 0, -1) g
  )
  select m.m,
    coalesce(sum(c.amount) filter (where c.kind = 'disbursement'
      and not exists (select 1 from public.loans l where l.id = c.loan_id and l.status = 'cancelled')), 0),
    coalesce(sum(c.amount) filter (where c.kind = 'interest_income'
      and not exists (select 1 from public.payments p where p.id = c.payment_id and p.status = 'reversed')), 0),
    coalesce(sum(c.amount) filter (where c.kind = 'capital_recovery'
      and not exists (select 1 from public.payments p where p.id = c.payment_id and p.status = 'reversed')), 0)
  from months m
  left join public.cash_movements c on date_trunc('month', c.created_at at time zone 'America/Lima')::date = m.m
  group by m.m order by m.m
$$;
revoke execute on function public.monthly_cash() from public, anon;
grant  execute on function public.monthly_cash() to authenticated;

-- ───────────── M-10: sin escrituras directas sobre loans ─────────────
-- La aplicación solo LEE loans por la API (lib/data/*: select); todas las escrituras (create_loan, register_payment, reverse_payment,
-- cancel_loan y los triggers de cierre automático) son funciones SECURITY DEFINER que se ejecutan con el propietario y no necesitan
-- privilegios de `authenticated`. Antes un admin podía poner principal_outstanding = 0 o cambiar el estado por la API, y asesor/admin
-- podían crear un préstamo 'draft' y activarlo sin cronograma ni asiento de caja. service_role no se ve afectado.
revoke insert, update, delete, truncate, references, trigger on public.loans from anon, authenticated;
grant select on public.loans to authenticated;
-- Defensa en profundidad: sin política de escritura, aunque alguien vuelva a conceder el privilegio el RLS sigue denegando.
drop policy if exists loans_insert on public.loans;
drop policy if exists loans_update on public.loans;

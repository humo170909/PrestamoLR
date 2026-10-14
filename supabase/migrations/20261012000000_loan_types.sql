-- Tres modalidades de préstamo (cuotas fijas, solo intereses con plazo, abierto), fecha real de pago y vista de resumen.
-- Regla financiera SIN cambios: interés = capital ORIGINAL × tasa por período (un abono nunca altera intereses ya generados).
-- Aditiva: solo ADD COLUMN / CREATE / CREATE OR REPLACE. Reemplaza únicamente las funciones create_loan, register_payment
-- y app.sync_loan_status (no toca tablas con datos). Los préstamos existentes quedan como 'interest_only'.

-- ───────────── 1) Modalidad y plazo opcional ─────────────
alter table public.loans add column loan_type text not null default 'interest_only'
  check (loan_type in ('fixed', 'interest_only', 'open'));
alter table public.loans alter column periods drop not null;
alter table public.loans add constraint loans_periods_by_type check ((loan_type = 'open') = (periods is null));

-- Los abonos de capital de un préstamo abierto no pertenecen a ningún vencimiento (no hay capital programado).
alter table public.payment_allocations alter column installment_id drop not null;

-- ───────────── 2) Fecha real del pago ─────────────
alter table public.payments add column paid_on date;
update public.payments set paid_on = (received_at at time zone 'America/Lima')::date where paid_on is null;
alter table public.payments alter column paid_on set default ((now() at time zone 'America/Lima')::date);
alter table public.payments alter column paid_on set not null;

-- ───────────── 3) Fecha de vencimiento del período n (misma regla que lib/finance/loan-rules.ts) ─────────────
create function app.due_date_of(p_start date, p_freq public.pay_frequency, p_n int) returns date
language sql immutable set search_path = '' as $$
  select case p_freq
    when 'monthly'  then (p_start + make_interval(months => p_n))::date
    when 'biweekly' then p_start + 15 * p_n
    else                 p_start + 7 * p_n end
$$;

-- ───────────── 4) Devengo de períodos del préstamo abierto ─────────────
-- Materializa períodos hasta el primero que aún no vence (el "siguiente cobro"). Idempotente: unique (loan_id, n).
-- Nunca crea períodos futuros adicionales ni cuotas ficticias. Quien llama debe haber bloqueado el préstamo.
create function app.accrue_open_loan(p_loan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loan public.loans%rowtype;
  v_today date := (now() at time zone 'America/Lima')::date;
  v_n int;
  v_last date;
  v_interest numeric(14,2);
begin
  select * into v_loan from public.loans where id = p_loan;
  if not found or v_loan.loan_type <> 'open' or v_loan.status <> 'active' then return; end if;
  v_interest := round(v_loan.principal * v_loan.rate_pct / 100, 2);

  select coalesce(max(n), 0) into v_n from public.installments where loan_id = p_loan;
  v_last := case when v_n > 0 then app.due_date_of(v_loan.start_date, v_loan.frequency, v_n) end;
  loop
    exit when v_last is not null and v_last > v_today;
    v_n := v_n + 1;
    v_last := app.due_date_of(v_loan.start_date, v_loan.frequency, v_n);
    insert into public.installments (loan_id, n, due_date, interest_due, capital_due)
    values (p_loan, v_n, v_last, v_interest, 0) on conflict (loan_id, n) do nothing;
  end loop;
end $$;

-- Devengo para todos los préstamos abiertos (cron) o para los visibles del usuario (al abrir la lista). Seguro de repetir.
create function public.refresh_open_loans() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v int := 0;
begin
  if auth.uid() is not null and app.current_role() is null then raise exception 'No autorizado'; end if;
  for r in select id from public.loans where loan_type = 'open' and status = 'active' order by id loop
    if auth.uid() is null or app.can_see_loan(r.id) then
      perform 1 from public.loans where id = r.id for update;
      perform app.accrue_open_loan(r.id);
      v := v + 1;
    end if;
  end loop;
  return v;
end $$;
revoke execute on function public.refresh_open_loans() from public, anon;
grant  execute on function public.refresh_open_loans() to authenticated;   -- service_role la conserva por los privilegios por defecto de Supabase

-- ───────────── 5) Cierre automático: el préstamo abierto solo se paga con capital 0 y sin períodos exigibles pendientes ─────────────
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
    update public.loans set status = 'paid_off' where id = p_loan;
  elsif not v_done and v_loan.status = 'paid_off' then
    update public.loans set status = 'active' where id = p_loan;
  end if;
end $$;

-- ───────────── 6) Alta de préstamos (reemplaza la firma anterior por una con p_loan_type) ─────────────
drop function public.create_loan(uuid, numeric, numeric, public.pay_frequency, int, date, text);

create function public.create_loan(
  p_client_id uuid, p_principal numeric, p_rate_pct numeric, p_frequency public.pay_frequency,
  p_periods int, p_start_date date, p_idempotency_key text, p_loan_type text default 'interest_only'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_loan     uuid;
  v_interest numeric(14,2) := round(p_principal * p_rate_pct / 100, 2);
  v_cap      numeric(14,2);
  v_periods  int := case when p_loan_type = 'open' then null else p_periods end;
  i int;
begin
  if app.current_role() not in ('admin', 'advisor') then raise exception 'No autorizado'; end if;
  if p_loan_type is null or p_loan_type not in ('fixed', 'interest_only', 'open') then raise exception 'Modalidad inválida'; end if;
  if p_principal is null or p_principal <= 0 or p_rate_pct is null or p_rate_pct < 0 or p_rate_pct > 999.99
     or (p_loan_type <> 'open' and (p_periods is null or p_periods not between 1 and 120))
     or p_start_date is null or coalesce(p_idempotency_key, '') = '' then
    raise exception 'Condiciones inválidas';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and active) then
    raise exception 'Cliente no encontrado o inactivo';
  end if;

  select id into v_loan from public.loans where idempotency_key = p_idempotency_key;
  if found then return v_loan; end if;                           -- reintento: no se desembolsa dos veces

  insert into public.loans (code, client_id, principal, principal_outstanding, rate_pct, frequency, periods, start_date, status, idempotency_key, loan_type)
  values ('PR-' || lpad(nextval('public.loan_code_seq')::text, 4, '0'), p_client_id, p_principal, p_principal,
          p_rate_pct, p_frequency, v_periods, p_start_date, 'active', p_idempotency_key, p_loan_type)
  returning id into v_loan;

  if p_loan_type = 'fixed' then
    v_cap := trunc(p_principal / p_periods, 2);                  -- capital igual por cuota; el último absorbe el redondeo
    for i in 1..p_periods loop
      insert into public.installments (loan_id, n, due_date, interest_due, capital_due)
      values (v_loan, i, app.due_date_of(p_start_date, p_frequency, i), v_interest,
              case when i = p_periods then p_principal - v_cap * (p_periods - 1) else v_cap end);
    end loop;
  elsif p_loan_type = 'interest_only' then
    for i in 1..p_periods loop
      insert into public.installments (loan_id, n, due_date, interest_due, capital_due)
      values (v_loan, i, app.due_date_of(p_start_date, p_frequency, i), v_interest,
              case when i = p_periods then p_principal else 0 end);
    end loop;
  else
    perform app.accrue_open_loan(v_loan);                        -- solo el período en curso: sin cuotas ficticias
  end if;

  insert into public.disbursements (loan_id, amount) values (v_loan, p_principal);
  insert into public.cash_movements (kind, direction, amount, loan_id, concept)
  values ('disbursement', 'out', p_principal, v_loan, 'Desembolso de préstamo');
  insert into public.loan_events (loan_id, kind, detail)
  values (v_loan, 'created_and_disbursed',
          jsonb_build_object('principal', p_principal, 'rate_pct', p_rate_pct, 'periods', v_periods, 'loan_type', p_loan_type));
  return v_loan;
end $$;

revoke execute on function public.create_loan(uuid, numeric, numeric, public.pay_frequency, int, date, text, text) from public, anon;
grant  execute on function public.create_loan(uuid, numeric, numeric, public.pay_frequency, int, date, text, text) to authenticated;

-- ───────────── 7) Registro de pagos (atómico, idempotente, con fecha real) ─────────────
drop function public.register_payment(uuid, numeric, numeric, text, text, text);

create function public.register_payment(
  p_loan_id uuid, p_interest numeric, p_capital numeric, p_method text, p_idempotency_key text,
  p_note text default null, p_paid_on date default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.user_role := app.current_role();
  v_today  date := (now() at time zone 'America/Lima')::date;
  v_paid   date := coalesce(p_paid_on, (now() at time zone 'America/Lima')::date);
  v_loan   public.loans%rowtype;
  v_pay    uuid;
  v_left   numeric;
  v_apply  numeric;
  r        record;
begin
  if v_role is null then raise exception 'No autorizado'; end if;
  if coalesce(p_interest, 0) < 0 or coalesce(p_capital, 0) < 0 or coalesce(p_interest, 0) + coalesce(p_capital, 0) <= 0 then
    raise exception 'Importes inválidos';
  end if;
  if coalesce(p_method, 'cash') not in ('cash', 'transfer', 'yape') then raise exception 'Método de pago inválido'; end if;
  if coalesce(p_interest, 0) <> round(coalesce(p_interest, 0), 2) or coalesce(p_capital, 0) <> round(coalesce(p_capital, 0), 2) then
    raise exception 'Los importes admiten como máximo 2 decimales';
  end if;
  if v_paid > v_today then raise exception 'La fecha de pago no puede ser futura'; end if;

  -- Idempotencia: la misma clave devuelve el pago ya registrado.
  select id into v_pay from public.payments where idempotency_key = p_idempotency_key;
  if found then return v_pay; end if;

  select * into v_loan from public.loans where id = p_loan_id for update;       -- serializa pagos del mismo préstamo
  if not found or not app.can_see_loan(p_loan_id) then raise exception 'Préstamo no encontrado'; end if;
  if v_loan.status <> 'active' then raise exception 'El préstamo no está activo'; end if;
  if v_paid < v_loan.start_date then raise exception 'La fecha de pago es anterior al desembolso'; end if;
  if coalesce(p_capital, 0) > v_loan.principal_outstanding then raise exception 'El capital excede el pendiente (%).', v_loan.principal_outstanding; end if;

  perform app.accrue_open_loan(p_loan_id);

  insert into public.payments (loan_id, amount, interest_amount, capital_amount, method, note, idempotency_key, paid_on)
  values (p_loan_id, p_interest + p_capital, p_interest, p_capital, coalesce(p_method, 'cash'), p_note, p_idempotency_key, v_paid)
  returning id into v_pay;

  -- Intereses: vencimientos más antiguos primero. Nunca más de lo generado/programado.
  v_left := p_interest;
  for r in select id, interest_due - interest_paid as pending from public.installments
           where loan_id = p_loan_id and interest_paid < interest_due order by n for update loop
    exit when v_left <= 0;
    v_apply := least(v_left, r.pending);
    update public.installments set interest_paid = interest_paid + v_apply where id = r.id;
    insert into public.payment_allocations (payment_id, installment_id, kind, amount) values (v_pay, r.id, 'interest', v_apply);
    v_left := v_left - v_apply;
  end loop;
  if v_left > 0 then raise exception 'El pago de intereses excede lo adeudado en % (excedentes: decisión pendiente)', v_left; end if;

  -- Capital: al capital programado más antiguo (cuotas fijas / solo intereses); el resto (préstamo abierto) solo reduce el saldo.
  -- NO recalcula intereses ya generados ni futuros (regla: interés sobre el capital original).
  v_left := coalesce(p_capital, 0);
  if v_left > 0 then
    for r in select id, capital_due - capital_paid as pending from public.installments
             where loan_id = p_loan_id and capital_paid < capital_due order by n for update loop
      exit when v_left <= 0;
      v_apply := least(v_left, r.pending);
      update public.installments set capital_paid = capital_paid + v_apply where id = r.id;
      insert into public.payment_allocations (payment_id, installment_id, kind, amount) values (v_pay, r.id, 'capital', v_apply);
      v_left := v_left - v_apply;
    end loop;
    if v_left > 0 then
      if v_loan.loan_type <> 'open' then raise exception 'El capital excede el programado (%).', v_left; end if;
      insert into public.payment_allocations (payment_id, installment_id, kind, amount) values (v_pay, null, 'capital', v_left);
    end if;
    update public.loans set principal_outstanding = principal_outstanding - p_capital where id = p_loan_id;
  end if;

  if p_interest > 0 then
    insert into public.cash_movements (kind, direction, amount, loan_id, payment_id, concept)
    values ('interest_income', 'in', p_interest, p_loan_id, v_pay, 'Cobro de intereses');
  end if;
  if p_capital > 0 then
    insert into public.cash_movements (kind, direction, amount, loan_id, payment_id, concept)
    values ('capital_recovery', 'in', p_capital, p_loan_id, v_pay, 'Devolución de capital');
  end if;

  insert into public.audit_log (action, entity, entity_id, after)
  values ('REGISTER_PAYMENT', 'payments', v_pay::text,
          jsonb_build_object('loan', p_loan_id, 'interest', p_interest, 'capital', p_capital, 'paid_on', v_paid));
  return v_pay;
end $$;

revoke execute on function public.register_payment(uuid, numeric, numeric, text, text, text, date) from public, anon;
grant  execute on function public.register_payment(uuid, numeric, numeric, text, text, text, date) to authenticated;

-- ───────────── 8) Resumen por préstamo (todos los estados) para lista, detalle, cobros y exportación ─────────────
-- security_invoker: respeta el RLS de quien consulta. "Vencido" se deriva (obligación exigible impaga), nunca se guarda.
create view public.v_loan_summary with (security_invoker = true) as
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
    min(i.due_date) filter (where i.interest_paid < i.interest_due or i.capital_paid < i.capital_due) as next_due_date
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
    else l.status::text end as derived_status
from public.loans l
join public.clients c on c.id = l.client_id
cross join t
left join inst x on x.loan_id = l.id
where l.status <> 'draft';

grant select on public.v_loan_summary to authenticated;

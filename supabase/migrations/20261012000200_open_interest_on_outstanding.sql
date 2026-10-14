-- Préstamo ABIERTO: el interés de cada período se calcula sobre el capital pendiente (no sobre el original).
-- Solo cambia la modalidad 'open'; 'fixed' y 'interest_only' siguen con interés sobre el capital original.
--
-- Regla única (app.open_period_interest):
--   interés del período k = (capital original − capital CONFIRMADO abonado con paid_on < vencimiento k) × tasa / 100
--   · Un abono el mismo día del vencimiento k (p. ej. junto con el cobro de ese interés) NO cambia el período k: baja el k+1.
--   · Un pago revertido (status 'reversed') deja de contar, de modo que la base se restaura sola.
--   · Los períodos ya vencidos (due_date <= hoy en Lima) o con interés cobrado quedan congelados: no se altera lo ya generado.
-- Aditiva: CREATE / CREATE OR REPLACE de funciones; no borra información.

create function app.open_period_interest(p_loan uuid, p_due date) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(greatest(l.principal - coalesce((
           select sum(p.capital_amount) from public.payments p
           where p.loan_id = l.id and p.status = 'confirmed' and p.paid_on < p_due), 0), 0) * l.rate_pct / 100, 2)
  from public.loans l where l.id = p_loan
$$;

-- Devengo: cada período nuevo usa la base de capital vigente en su fecha. Sin capital pendiente no se generan períodos.
create or replace function app.accrue_open_loan(p_loan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_loan public.loans%rowtype;
  v_today date := (now() at time zone 'America/Lima')::date;
  v_n int;
  v_last date;
begin
  select * into v_loan from public.loans where id = p_loan;
  if not found or v_loan.loan_type <> 'open' or v_loan.status <> 'active' or v_loan.principal_outstanding = 0 then return; end if;

  select coalesce(max(n), 0) into v_n from public.installments where loan_id = p_loan;
  v_last := case when v_n > 0 then app.due_date_of(v_loan.start_date, v_loan.frequency, v_n) end;
  loop
    exit when v_last is not null and v_last > v_today;
    v_n := v_n + 1;
    v_last := app.due_date_of(v_loan.start_date, v_loan.frequency, v_n);
    insert into public.installments (loan_id, n, due_date, interest_due, capital_due)
    values (p_loan, v_n, v_last, app.open_period_interest(p_loan, v_last), 0) on conflict (loan_id, n) do nothing;
  end loop;
end $$;

-- Recalcula SOLO los períodos futuros sin cobrar (los vencidos o con pagos quedan intactos). Idempotente.
create function app.recompute_open_future(p_loan uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_today date := (now() at time zone 'America/Lima')::date;
begin
  if not exists (select 1 from public.loans where id = p_loan and loan_type = 'open') then return; end if;
  update public.installments i
     set interest_due = app.open_period_interest(p_loan, i.due_date)
   where i.loan_id = p_loan and i.interest_paid = 0 and i.capital_due = 0 and i.due_date > v_today
     and i.interest_due is distinct from app.open_period_interest(p_loan, i.due_date);
end $$;

-- Al abrir la lista / cron: además de devengar, corrige períodos futuros creados con la regla anterior.
create or replace function public.refresh_open_loans() returns int
language plpgsql security definer set search_path = '' as $$
declare r record; v int := 0;
begin
  if auth.uid() is not null and app.current_role() is null then raise exception 'No autorizado'; end if;
  for r in select id from public.loans where loan_type = 'open' and status = 'active' order by id loop
    if auth.uid() is null or app.can_see_loan(r.id) then
      perform 1 from public.loans where id = r.id for update;
      perform app.recompute_open_future(r.id);
      perform app.accrue_open_loan(r.id);
      v := v + 1;
    end if;
  end loop;
  return v;
end $$;

-- Corrige los períodos futuros ya existentes (sin pagos de capital el valor no cambia).
do $$ declare r record; begin
  for r in select id from public.loans where loan_type = 'open' and status = 'active' loop
    perform app.recompute_open_future(r.id);
  end loop;
end $$;

-- ───────────── register_payment: tras aplicar el pago, el siguiente período usa el capital actualizado ─────────────
create or replace function public.register_payment(
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

  select id into v_pay from public.payments where idempotency_key = p_idempotency_key;
  if found then return v_pay; end if;

  select * into v_loan from public.loans where id = p_loan_id for update;       -- serializa pagos del mismo préstamo
  if not found or not app.can_see_loan(p_loan_id) then raise exception 'Préstamo no encontrado'; end if;
  if v_loan.status <> 'active' then raise exception 'El préstamo no está activo'; end if;
  if v_paid < v_loan.start_date then raise exception 'La fecha de pago es anterior al desembolso'; end if;
  if coalesce(p_capital, 0) > v_loan.principal_outstanding then raise exception 'El capital excede el pendiente (%).', v_loan.principal_outstanding; end if;

  perform app.accrue_open_loan(p_loan_id);   -- primero los períodos ya vencidos con la base de capital anterior al pago

  insert into public.payments (loan_id, amount, interest_amount, capital_amount, method, note, idempotency_key, paid_on)
  values (p_loan_id, p_interest + p_capital, p_interest, p_capital, coalesce(p_method, 'cash'), p_note, p_idempotency_key, v_paid)
  returning id into v_pay;

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

  -- Préstamo abierto: el siguiente período se recalcula con el capital ya actualizado (y se genera si hace falta).
  perform app.recompute_open_future(p_loan_id);
  perform app.accrue_open_loan(p_loan_id);

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

-- ───────────── reverse_payment: restaura la base de capital y recalcula los períodos futuros ─────────────
create or replace function public.reverse_payment(p_payment_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_pay public.payments%rowtype;
  r record;
begin
  if app.current_role() is distinct from 'admin' then raise exception 'Solo un administrador puede revertir pagos'; end if;
  if p_reason is null or length(trim(p_reason)) < 5 then raise exception 'Indica el motivo de la reversión'; end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found or v_pay.status = 'reversed' then raise exception 'Pago no encontrado o ya revertido'; end if;
  perform 1 from public.loans where id = v_pay.loan_id for update;

  for r in select installment_id, kind, amount from public.payment_allocations where payment_id = p_payment_id loop
    if r.kind = 'interest' then
      update public.installments set interest_paid = interest_paid - r.amount where id = r.installment_id;
    else
      update public.installments set capital_paid = capital_paid - r.amount where id = r.installment_id;
    end if;
  end loop;
  update public.loans set principal_outstanding = principal_outstanding + v_pay.capital_amount where id = v_pay.loan_id;
  update public.payments set status = 'reversed', reversed_by = auth.uid(), reversed_at = now(), reversal_reason = p_reason where id = p_payment_id;

  perform app.recompute_open_future(v_pay.loan_id);   -- el pago ya figura como revertido: no cuenta en la base
  perform app.accrue_open_loan(v_pay.loan_id);

  insert into public.cash_movements (kind, direction, amount, loan_id, payment_id, concept)
  values ('reversal', 'out', v_pay.amount, v_pay.loan_id, p_payment_id, 'Reversión: ' || p_reason);
  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('REVERSE_PAYMENT', 'payments', p_payment_id::text, to_jsonb(v_pay), jsonb_build_object('reason', p_reason));
end $$;

-- ───────────── Cronograma con capital de referencia y capital abonado por período ─────────────
-- security invoker: respeta el RLS de quien consulta.
create function public.loan_schedule(p_loan uuid)
returns table (n int, due_date date, interest_due numeric, interest_paid numeric, capital_due numeric, capital_paid numeric,
               reference_capital numeric, capital_applied numeric)
language sql stable security invoker set search_path = '' as $$
  select i.n, i.due_date, i.interest_due, i.interest_paid, i.capital_due, i.capital_paid,
    case when l.loan_type = 'open'
      then greatest(l.principal - coalesce((select sum(p.capital_amount) from public.payments p
             where p.loan_id = l.id and p.status = 'confirmed' and p.paid_on < i.due_date), 0), 0)
      else l.principal end,
    case when l.loan_type = 'open' then coalesce((
      -- el abono pertenece al período cuyo interés se cobró con ese pago; si fue solo capital, al período en curso
      select sum(p.capital_amount) from public.payments p
      where p.loan_id = l.id and p.status = 'confirmed' and p.capital_amount > 0 and i.n = coalesce(
        (select max(i2.n) from public.payment_allocations a join public.installments i2 on i2.id = a.installment_id
          where a.payment_id = p.id and a.kind = 'interest'),
        (select min(i3.n) from public.installments i3 where i3.loan_id = l.id and i3.due_date >= p.paid_on),
        (select max(i4.n) from public.installments i4 where i4.loan_id = l.id))), 0)
    else i.capital_paid end
  from public.installments i join public.loans l on l.id = i.loan_id
  where i.loan_id = p_loan order by i.n
$$;

revoke execute on function public.loan_schedule(uuid) from public, anon;
grant  execute on function public.loan_schedule(uuid) to authenticated;

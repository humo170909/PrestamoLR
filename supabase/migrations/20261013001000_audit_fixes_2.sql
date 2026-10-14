-- Correcciones del lote 2 de la auditoría. Aditiva e idempotente (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, CREATE OR REPLACE).
-- No cambia reglas financieras: no toca el cálculo de intereses, cronogramas, imputación de pagos ni estados.

-- ───────────── M-07: filtro de cuotas impagas en SQL para el cron de avisos ─────────────
-- PostgREST no puede comparar dos columnas (interest_paid < interest_due), por lo que el cron descargaba TODAS las cuotas vencidas
-- de préstamos activos (también las pagadas) y las filtraba en Node. Esta columna generada deja que la consulta pida solo las impagas
-- (`is_unpaid = true`); se mantiene sola cuando cambian interest_paid/capital_paid (pagos y reversiones).
alter table public.installments
  add column if not exists is_unpaid boolean generated always as (interest_paid < interest_due or capital_paid < capital_due) stored;

create index if not exists installments_unpaid_due_idx on public.installments (due_date) where is_unpaid;

-- ───────────── B-02 / I-04: register_payment — idempotencia atada a préstamo e importes y NULL con mensaje claro ─────────────
-- Definición vigente (20261012000200) con SOLO validaciones añadidas; el reparto entre intereses y capital, los bloqueos y los asientos no cambian.
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
  v_prev   public.payments%rowtype;
  v_left   numeric;
  v_apply  numeric;
  r        record;
begin
  if v_role is null then raise exception 'No autorizado'; end if;
  -- I-04: NULL con mensaje claro (antes: error técnico "null value in column amount").
  if p_interest is null or p_capital is null then raise exception 'Indica el importe de intereses y el de capital (usa 0 si no aplica)'; end if;
  if coalesce(p_idempotency_key, '') = '' then raise exception 'La clave de idempotencia es obligatoria'; end if;
  if coalesce(p_interest, 0) < 0 or coalesce(p_capital, 0) < 0 or coalesce(p_interest, 0) + coalesce(p_capital, 0) <= 0 then
    raise exception 'Importes inválidos';
  end if;
  if coalesce(p_method, 'cash') not in ('cash', 'transfer', 'yape') then raise exception 'Método de pago inválido'; end if;
  if coalesce(p_interest, 0) <> round(coalesce(p_interest, 0), 2) or coalesce(p_capital, 0) <> round(coalesce(p_capital, 0), 2) then
    raise exception 'Los importes admiten como máximo 2 decimales';
  end if;
  if v_paid > v_today then raise exception 'La fecha de pago no puede ser futura'; end if;

  -- B-02: una clave ya usada solo devuelve el pago original si es el MISMO cobro (mismo préstamo e importes); si no, error.
  -- Antes devolvía el pago de otro préstamo como si el nuevo se hubiera registrado (y revelaba su UUID a quien no ve ese préstamo).
  select * into v_prev from public.payments where idempotency_key = p_idempotency_key;
  if found then
    if not app.can_see_loan(v_prev.loan_id) then raise exception 'Préstamo no encontrado'; end if;
    if v_prev.loan_id is distinct from p_loan_id or v_prev.interest_amount <> p_interest or v_prev.capital_amount <> p_capital then
      raise exception 'La clave de idempotencia ya se usó en otro cobro (otro préstamo o importes distintos)';
    end if;
    return v_prev.id;
  end if;

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

-- ───────────── B-03 / I-04: create_loan — escala ≤ 2 decimales, rango de fecha y mensajes claros ─────────────
-- Definición vigente (20261012000000) con SOLO validaciones añadidas; cronograma, desembolso y caja no cambian. Misma firma: los permisos se conservan.
create or replace function public.create_loan(
  p_client_id uuid, p_principal numeric, p_rate_pct numeric, p_frequency public.pay_frequency,
  p_periods int, p_start_date date, p_idempotency_key text, p_loan_type text default 'interest_only'
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_loan     uuid;
  v_interest numeric(14,2) := round(p_principal * p_rate_pct / 100, 2);
  v_cap      numeric(14,2);
  v_periods  int := case when p_loan_type = 'open' then null else p_periods end;
  v_today    date := (now() at time zone 'America/Lima')::date;
  i int;
begin
  if app.current_role() not in ('admin', 'advisor') then raise exception 'No autorizado'; end if;
  if p_loan_type is null or p_loan_type not in ('fixed', 'interest_only', 'open') then raise exception 'Modalidad inválida'; end if;
  -- B-03 / I-04: mensajes claros, escala y rango de fecha razonables (sin cambiar el cálculo).
  if p_principal is null then raise exception 'El capital es obligatorio'; end if;
  if p_rate_pct is null then raise exception 'La tasa es obligatoria'; end if;
  if p_start_date is null then raise exception 'La fecha de desembolso es obligatoria'; end if;
  if p_principal <> round(p_principal, 2) then raise exception 'El capital admite como máximo 2 decimales'; end if;
  if p_rate_pct <> round(p_rate_pct, 4) then raise exception 'La tasa admite como máximo 4 decimales'; end if;
  if p_start_date < date '2000-01-01' or p_start_date > v_today + 366 then
    raise exception 'La fecha de desembolso está fuera del rango permitido (desde 2000-01-01 hasta un año desde hoy)';
  end if;
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

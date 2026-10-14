-- Alta y desembolso atómico de préstamos. El cronograma se calcula en la base de datos
-- (misma regla que lib/finance/interest-only.ts): interés = capital original × tasa por período; capital en el último vencimiento.
-- Aditiva: no contiene DROP ni DELETE.

alter table public.loans add column idempotency_key text unique;
create sequence public.loan_code_seq start 1;

create function public.create_loan(
  p_client_id uuid, p_principal numeric, p_rate_pct numeric, p_frequency public.pay_frequency,
  p_periods int, p_start_date date, p_idempotency_key text
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_loan     uuid;
  v_interest numeric(14,2) := round(p_principal * p_rate_pct / 100, 2);
  i int;
begin
  if app.current_role() not in ('admin', 'advisor') then raise exception 'No autorizado'; end if;
  if p_principal is null or p_principal <= 0 or p_rate_pct is null or p_rate_pct < 0
     or p_periods not between 1 and 120 or p_start_date is null or coalesce(p_idempotency_key, '') = '' then
    raise exception 'Condiciones inválidas';
  end if;
  if not exists (select 1 from public.clients where id = p_client_id and active) then
    raise exception 'Cliente no encontrado o inactivo';
  end if;

  select id into v_loan from public.loans where idempotency_key = p_idempotency_key;
  if found then return v_loan; end if;                           -- reintento: no se desembolsa dos veces

  insert into public.loans (code, client_id, principal, principal_outstanding, rate_pct, frequency, periods, start_date, status, idempotency_key)
  values ('PR-' || lpad(nextval('public.loan_code_seq')::text, 4, '0'), p_client_id, p_principal, p_principal,
          p_rate_pct, p_frequency, p_periods, p_start_date, 'active', p_idempotency_key)
  returning id into v_loan;

  for i in 1..p_periods loop
    insert into public.installments (loan_id, n, due_date, interest_due, capital_due)
    values (v_loan, i,
            case p_frequency
              when 'monthly'  then (p_start_date + make_interval(months => i))::date
              when 'biweekly' then p_start_date + 15 * i
              else                 p_start_date + 7 * i end,
            v_interest,
            case when i = p_periods then p_principal else 0 end);
  end loop;

  insert into public.disbursements (loan_id, amount) values (v_loan, p_principal);
  insert into public.cash_movements (kind, direction, amount, loan_id, concept)
  values ('disbursement', 'out', p_principal, v_loan, 'Desembolso de préstamo');
  insert into public.loan_events (loan_id, kind, detail)
  values (v_loan, 'created_and_disbursed', jsonb_build_object('principal', p_principal, 'rate_pct', p_rate_pct, 'periods', p_periods));
  return v_loan;
end $$;

revoke execute on function public.create_loan(uuid, numeric, numeric, public.pay_frequency, int, date, text) from public, anon;
grant  execute on function public.create_loan(uuid, numeric, numeric, public.pay_frequency, int, date, text) to authenticated;

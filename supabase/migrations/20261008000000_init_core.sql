-- LRomero Préstamos — esquema base (fase 1: BORRADOR para revisión, aún no aplicado a ningún proyecto).
-- Modelo: interés periódico sobre el capital ORIGINAL + capital al vencimiento.
-- Reglas: dinero en numeric(14,2); sin DELETE de registros financieros; pagos/caja/auditoría solo vía funciones.
-- Es una migración ADITIVA (solo CREATE). No contiene DROP ni DELETE.

create schema if not exists app;

-- ───────────────────────── Tipos ─────────────────────────
create type public.user_role      as enum ('admin', 'advisor', 'collector');
create type public.pay_frequency  as enum ('monthly', 'biweekly', 'weekly');
create type public.loan_status    as enum ('draft', 'active', 'paid_off', 'defaulted', 'refinanced', 'cancelled');
create type public.payment_status as enum ('confirmed', 'reversed');
create type public.alloc_kind     as enum ('interest', 'capital');
create type public.cash_kind      as enum ('disbursement', 'interest_income', 'capital_recovery', 'reversal', 'other_in', 'other_out');

-- ───────────────────────── Perfiles ─────────────────────────
create table public.profiles (
  id         uuid primary key references auth.users (id) on delete restrict,
  full_name  text not null check (length(trim(full_name)) > 0),
  role       public.user_role not null default 'collector',
  active     boolean not null default true,
  route      text,
  created_at timestamptz not null default now()
);

-- Rol del usuario autenticado (SECURITY DEFINER para evitar recursión de RLS). NULL si no existe o está inactivo.
create function app.current_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = auth.uid() and active
$$;

-- ───────────────────────── Clientes ─────────────────────────
create table public.clients (
  id                 uuid primary key default gen_random_uuid(),
  full_name          text not null check (length(trim(full_name)) > 0),
  document_id        text not null unique,            -- DNI
  phone              text,
  address            text,
  assigned_collector uuid references public.profiles (id),
  active             boolean not null default true,
  created_by         uuid not null default auth.uid() references public.profiles (id),
  created_at         timestamptz not null default now()
);
create index on public.clients (assigned_collector);

-- ───────────────────────── Préstamos ─────────────────────────
create table public.loans (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,         -- PR-0001 (lo asigna la función de desembolso)
  client_id             uuid not null references public.clients (id),
  principal             numeric(14,2) not null check (principal > 0),            -- capital ORIGINAL (histórico, inmutable)
  principal_outstanding numeric(14,2) not null check (principal_outstanding >= 0 and principal_outstanding <= principal),
  rate_pct              numeric(7,4)  not null check (rate_pct >= 0),            -- % por período de pago
  frequency             public.pay_frequency not null,
  periods               int not null check (periods between 1 and 120),
  start_date            date not null,
  status                public.loan_status not null default 'draft',
  refinanced_from       uuid references public.loans (id),                       -- refinanciación: el préstamo anterior se conserva
  created_by            uuid not null default auth.uid() references public.profiles (id),
  created_at            timestamptz not null default now()
);
create index on public.loans (client_id);
create index on public.loans (status);

-- Cronograma de obligaciones: intereses en cada vencimiento, capital solo en el último.
create table public.installments (
  id            uuid primary key default gen_random_uuid(),
  loan_id       uuid not null references public.loans (id),
  n             int not null check (n >= 1),
  due_date      date not null,
  interest_due  numeric(14,2) not null check (interest_due >= 0),
  interest_paid numeric(14,2) not null default 0,
  capital_due   numeric(14,2) not null default 0 check (capital_due >= 0),
  capital_paid  numeric(14,2) not null default 0,
  unique (loan_id, n),
  check (interest_paid between 0 and interest_due),
  check (capital_paid  between 0 and capital_due)
);
create index on public.installments (loan_id, due_date);

create table public.disbursements (
  id           uuid primary key default gen_random_uuid(),
  loan_id      uuid not null unique references public.loans (id),
  amount       numeric(14,2) not null check (amount > 0),
  disbursed_at timestamptz not null default now(),
  disbursed_by uuid not null default auth.uid() references public.profiles (id)
);

-- Cambios contractuales y hechos del préstamo (prórroga, refinanciación, castigo…). Requieren autorización.
create table public.loan_events (
  id          uuid primary key default gen_random_uuid(),
  loan_id     uuid not null references public.loans (id),
  kind        text not null,
  detail      jsonb not null default '{}',
  authorized_by uuid references public.profiles (id),
  created_by  uuid not null default auth.uid() references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index on public.loan_events (loan_id);

-- ───────────────────────── Pagos ─────────────────────────
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  loan_id         uuid not null references public.loans (id),
  receipt_no      bigint generated always as identity unique,
  amount          numeric(14,2) not null check (amount > 0),   -- total recibido = intereses + capital
  interest_amount numeric(14,2) not null check (interest_amount >= 0),
  capital_amount  numeric(14,2) not null check (capital_amount >= 0),
  method          text not null default 'cash',
  note            text,
  status          public.payment_status not null default 'confirmed',
  idempotency_key text not null unique,                        -- evita cobros duplicados por reintento/doble clic
  received_by     uuid not null default auth.uid() references public.profiles (id),
  received_at     timestamptz not null default now(),
  reversed_by     uuid references public.profiles (id),
  reversed_at     timestamptz,
  reversal_reason text,
  check (amount = interest_amount + capital_amount),
  check ((status = 'reversed') = (reversed_at is not null))
);
create index on public.payments (loan_id, received_at);

-- Distribución de cada pago entre intereses y capital (por vencimiento).
create table public.payment_allocations (
  id             uuid primary key default gen_random_uuid(),
  payment_id     uuid not null references public.payments (id),
  installment_id uuid not null references public.installments (id),
  kind           public.alloc_kind not null,
  amount         numeric(14,2) not null check (amount > 0)
);
create index on public.payment_allocations (payment_id);

-- ───────────────────────── Caja ─────────────────────────
create table public.cash_movements (
  id         uuid primary key default gen_random_uuid(),
  kind       public.cash_kind not null,
  direction  text not null check (direction in ('in', 'out')),
  amount     numeric(14,2) not null check (amount > 0),
  loan_id    uuid references public.loans (id),
  payment_id uuid references public.payments (id),
  concept    text,
  created_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);
create index on public.cash_movements (created_at);

-- ───────────────────────── Auditoría ─────────────────────────
create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid default auth.uid(),
  action     text not null,
  entity     text not null,
  entity_id  text,
  before     jsonb,
  after      jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (entity, entity_id);

create function app.audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_log (action, entity, entity_id, before, after)
  values (tg_op, tg_table_name, coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id')),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

create trigger audit_profiles after insert or update on public.profiles for each row execute function app.audit();
create trigger audit_clients  after insert or update on public.clients  for each row execute function app.audit();
create trigger audit_loans    after insert or update on public.loans    for each row execute function app.audit();
create trigger audit_events   after insert on public.loan_events        for each row execute function app.audit();

-- Los registros financieros no se borran ni se editan a mano.
create function app.forbid_mutation() returns trigger language plpgsql as $$
begin raise exception 'La tabla % es solo de inserción por funciones autorizadas', tg_table_name; end $$;
create trigger no_delete_loans    before delete on public.loans    for each row execute function app.forbid_mutation();
create trigger no_delete_payments before delete on public.payments for each row execute function app.forbid_mutation();
create trigger no_delete_alloc    before delete on public.payment_allocations for each row execute function app.forbid_mutation();
create trigger no_delete_cash     before delete on public.cash_movements      for each row execute function app.forbid_mutation();
create trigger no_delete_audit    before delete on public.audit_log           for each row execute function app.forbid_mutation();

-- El capital original y las condiciones contractuales no se modifican por UPDATE directo
-- (cambios contractuales = loan_events autorizado + función dedicada, fase 2).
create function app.loan_guard() returns trigger language plpgsql as $$
begin
  if new.principal is distinct from old.principal
     or new.rate_pct is distinct from old.rate_pct
     or new.frequency is distinct from old.frequency
     or new.periods is distinct from old.periods
     or new.start_date is distinct from old.start_date
     or new.client_id is distinct from old.client_id then
    if old.status <> 'draft' then raise exception 'Condiciones contractuales inmutables; use un evento de préstamo autorizado'; end if;
  end if;
  return new;
end $$;
create trigger loan_guard before update on public.loans for each row execute function app.loan_guard();

-- Nadie (ni un admin por la API) puede cambiar su propio rol o reactivarse a sí mismo.
create function app.profile_guard() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and new.id = auth.uid() and (new.role is distinct from old.role or new.active is distinct from old.active) then
    raise exception 'No puedes cambiar tu propio rol ni estado';
  end if;
  return new;
end $$;
create trigger profile_guard before update on public.profiles for each row execute function app.profile_guard();

-- ───────────────────────── Visibilidad por rol ─────────────────────────
create function app.can_see_client(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select case app.current_role()
    when 'admin' then true
    when 'advisor' then true
    when 'collector' then exists (select 1 from public.clients where id = c and assigned_collector = auth.uid())
    else false end
$$;
create function app.can_see_loan(l uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.loans where id = l and app.can_see_client(client_id))
$$;

-- ───────────────────────── RLS ─────────────────────────
alter table public.profiles            enable row level security;
alter table public.clients             enable row level security;
alter table public.loans               enable row level security;
alter table public.installments        enable row level security;
alter table public.disbursements       enable row level security;
alter table public.loan_events         enable row level security;
alter table public.payments            enable row level security;
alter table public.payment_allocations enable row level security;
alter table public.cash_movements      enable row level security;
alter table public.audit_log           enable row level security;

-- profiles: cada quien ve el suyo; admin ve y edita todos (el trigger impide auto-promoción).
create policy profiles_select on public.profiles for select to authenticated using (id = auth.uid() or app.current_role() = 'admin');
create policy profiles_admin_ins on public.profiles for insert to authenticated with check (app.current_role() = 'admin');
create policy profiles_admin_upd on public.profiles for update to authenticated using (app.current_role() = 'admin') with check (app.current_role() = 'admin');

-- clients
create policy clients_select on public.clients for select to authenticated using (app.can_see_client(id));
create policy clients_insert on public.clients for insert to authenticated with check (app.current_role() in ('admin', 'advisor'));
create policy clients_update on public.clients for update to authenticated using (app.current_role() in ('admin', 'advisor')) with check (app.current_role() in ('admin', 'advisor'));

-- loans (alta como borrador por admin/asesor; activación y cambios por funciones)
create policy loans_select on public.loans for select to authenticated using (app.can_see_client(client_id));
create policy loans_insert on public.loans for insert to authenticated with check (app.current_role() in ('admin', 'advisor') and status = 'draft');
create policy loans_update on public.loans for update to authenticated using (app.current_role() = 'admin') with check (app.current_role() = 'admin');

-- Tablas de solo lectura vía API (se escriben únicamente con funciones SECURITY DEFINER)
create policy installments_select  on public.installments        for select to authenticated using (app.can_see_loan(loan_id));
create policy disbursements_select on public.disbursements       for select to authenticated using (app.can_see_loan(loan_id));
create policy loan_events_select   on public.loan_events         for select to authenticated using (app.can_see_loan(loan_id));
create policy payments_select      on public.payments            for select to authenticated using (app.can_see_loan(loan_id));
create policy alloc_select         on public.payment_allocations for select to authenticated using (exists (select 1 from public.payments p where p.id = payment_id and app.can_see_loan(p.loan_id)));
create policy cash_select          on public.cash_movements      for select to authenticated using (app.current_role() in ('admin', 'advisor') or created_by = auth.uid());
create policy audit_select         on public.audit_log           for select to authenticated using (app.current_role() = 'admin');

-- Privilegios mínimos: anon no accede a nada; authenticated solo lo que RLS permita.
revoke all on all tables in schema public from anon;
revoke insert, update, delete on public.installments, public.disbursements, public.payments,
  public.payment_allocations, public.cash_movements, public.audit_log from authenticated;
grant usage on schema app to authenticated;

-- ───────────────────────── Registro de pagos (atómico e idempotente) ─────────────────────────
-- Regla central: p_interest se imputa SOLO a intereses; p_capital SOLO a capital.
-- Un pago de intereses nunca reduce principal_outstanding. Excedentes se rechazan (decisión pendiente: saldo a favor).
create function public.register_payment(
  p_loan_id uuid, p_interest numeric, p_capital numeric, p_method text, p_idempotency_key text, p_note text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_role   public.user_role := app.current_role();
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

  -- Idempotencia: la misma clave devuelve el pago ya registrado.
  select id into v_pay from public.payments where idempotency_key = p_idempotency_key;
  if found then return v_pay; end if;

  select * into v_loan from public.loans where id = p_loan_id for update;       -- serializa pagos del mismo préstamo
  if not found or not app.can_see_loan(p_loan_id) then raise exception 'Préstamo no encontrado'; end if;
  if v_loan.status <> 'active' then raise exception 'El préstamo no está activo'; end if;
  if p_capital > v_loan.principal_outstanding then raise exception 'El capital excede el pendiente (%).', v_loan.principal_outstanding; end if;

  insert into public.payments (loan_id, amount, interest_amount, capital_amount, method, note, idempotency_key)
  values (p_loan_id, p_interest + p_capital, p_interest, p_capital, coalesce(p_method, 'cash'), p_note, p_idempotency_key)
  returning id into v_pay;

  -- Intereses: vencimientos más antiguos primero (los futuros solo si ya están cubiertos los anteriores).
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

  -- Capital: se imputa al vencimiento final y reduce el capital pendiente; NO recalcula intereses futuros.
  if p_capital > 0 then
    select id into r from public.installments where loan_id = p_loan_id and capital_due > 0 order by n desc limit 1 for update;
    update public.installments set capital_paid = capital_paid + p_capital where id = r.id;   -- el CHECK impide pasarse
    insert into public.payment_allocations (payment_id, installment_id, kind, amount) values (v_pay, r.id, 'capital', p_capital);
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
  values ('REGISTER_PAYMENT', 'payments', v_pay::text, jsonb_build_object('loan', p_loan_id, 'interest', p_interest, 'capital', p_capital));
  return v_pay;
end $$;

-- Reversión auditable (solo admin). No borra: marca el pago, deshace la imputación y contra-asienta la caja.
create function public.reverse_payment(p_payment_id uuid, p_reason text) returns void
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

  insert into public.cash_movements (kind, direction, amount, loan_id, payment_id, concept)
  values ('reversal', 'out', v_pay.amount, v_pay.loan_id, p_payment_id, 'Reversión: ' || p_reason);
  insert into public.audit_log (action, entity, entity_id, before, after)
  values ('REVERSE_PAYMENT', 'payments', p_payment_id::text, to_jsonb(v_pay), jsonb_build_object('reason', p_reason));
end $$;

revoke execute on function public.register_payment(uuid, numeric, numeric, text, text, text) from public, anon;
revoke execute on function public.reverse_payment(uuid, text) from public, anon;
grant execute on function public.register_payment(uuid, numeric, numeric, text, text, text) to authenticated;
grant execute on function public.reverse_payment(uuid, text) to authenticated;

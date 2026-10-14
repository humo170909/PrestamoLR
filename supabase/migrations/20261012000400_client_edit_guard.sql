-- Edición segura de clientes. Aditiva (CREATE de función/trigger y un CHECK NOT VALID: no toca filas existentes).
-- La política RLS clients_update (solo admin y asesor) ya existe y NO cambia; esto añade integridad a nivel de base de datos:
--  · el id, el creador y la fecha de alta no se pueden modificar (los préstamos siguen ligados al mismo cliente);
--  · el cobrador asignado debe existir, tener rol 'collector' y estar activo (solo se valida si cambia);
--  · formato de teléfono para filas nuevas o editadas.

create function app.client_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'El identificador y el origen del cliente no se pueden modificar';
  end if;
  if new.assigned_collector is not null and new.assigned_collector is distinct from old.assigned_collector
     and not exists (select 1 from public.profiles where id = new.assigned_collector and role = 'collector' and active) then
    raise exception 'El cobrador asignado no existe o no está activo';
  end if;
  return new;
end $$;

create trigger client_guard before update on public.clients for each row execute function app.client_guard();

alter table public.clients add constraint clients_phone_format
  check (phone is null or phone ~ '^[0-9+() -]{6,20}$') not valid;

-- La revisión horaria registra sus ejecuciones como job 'hourly'. Aditiva: solo amplía el CHECK de notification_runs.
alter table public.notification_runs drop constraint if exists notification_runs_job_check;
alter table public.notification_runs add constraint notification_runs_job_check check (job in ('morning', 'evening', 'hourly', 'all'));

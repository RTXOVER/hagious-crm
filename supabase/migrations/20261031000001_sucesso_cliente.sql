-- =====================================================================
-- Etapa 5 (parte 1): Sucesso do cliente
-- Ações proativas programadas (contato trimestral, reunião de saúde financeira, alerta tributário,
-- ação consultiva): cliente, objetivo, data prevista, responsável, histórico e resultado.
-- Recorrentes geram a próxima ao serem realizadas. Lembretes no dia e quando atrasam (sem duplicar).
-- =====================================================================

create type public.success_type as enum ('contato_trimestral', 'reuniao_saude_financeira', 'alerta_tributario', 'acao_consultiva', 'outro');
create type public.success_status as enum ('planejada', 'realizada', 'cancelada');
create type public.success_recurrence as enum ('nenhuma', 'trimestral', 'semestral', 'anual');

-- Configuração (linha única)
create table public.success_settings (
  id smallint primary key default 1 check (id = 1),
  -- Cliente "sem acompanhamento recente": nenhuma ação realizada há mais de N dias
  stale_days integer not null default 90 check (stale_days between 15 and 365),
  -- true = valor inicial ainda não confirmado pela gestão
  needs_review boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.success_settings (id) values (1);
create trigger success_settings_updated_at before update on public.success_settings
  for each row execute function public.set_updated_at();

create table public.success_actions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  type public.success_type not null,
  objective text not null check (char_length(trim(objective)) between 3 and 300),
  planned_date date not null,
  responsible_id uuid references public.profiles(id) on delete set null,
  status public.success_status not null default 'planejada',
  recurrence public.success_recurrence not null default 'nenhuma',
  result text check (result is null or char_length(result) <= 4000),
  done_at timestamptz,
  done_by uuid references public.profiles(id) on delete set null,
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  -- Série de recorrência: aponta para a ação que originou esta
  previous_id uuid references public.success_actions(id) on delete set null,
  notified_due_at timestamptz,
  notified_overdue_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint resultado_registrado check (status <> 'realizada' or char_length(trim(coalesce(result, ''))) >= 3),
  constraint cancelamento_motivado check (status <> 'cancelada' or char_length(trim(coalesce(cancel_reason, ''))) >= 3)
);
create trigger success_actions_updated_at before update on public.success_actions
  for each row execute function public.set_updated_at();
create index success_actions_status_idx on public.success_actions (status, planned_date);
create index success_actions_client_idx on public.success_actions (client_id, planned_date desc);
create index success_actions_responsible_idx on public.success_actions (responsible_id, status);
-- Uma única próxima ação por série (evita duplicar a recorrência)
create unique index success_actions_next_uq on public.success_actions (previous_id) where previous_id is not null;

-- Histórico de cada ação
create table public.success_events (
  id bigint generated always as identity primary key,
  action_id uuid not null references public.success_actions(id) on delete cascade,
  kind text not null check (kind in ('criada', 'reagendada', 'realizada', 'cancelada', 'reaberta', 'responsavel', 'comentario')),
  actor_id uuid references public.profiles(id) on delete set null,
  body text check (body is null or char_length(body) <= 4000),
  data jsonb,
  created_at timestamptz not null default now()
);
create index success_events_action_idx on public.success_events (action_id, created_at);

-- Avisos internos podem apontar para uma ação de sucesso do cliente
alter table public.notifications add column success_action_id uuid references public.success_actions(id) on delete cascade;
create index notifications_success_idx on public.notifications (success_action_id);

-- =====================================================================
-- Gatilhos
-- =====================================================================

create or replace function public.success_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and not public.is_internal_op() then
    new.created_by := auth.uid();
    new.created_at := now();
    new.previous_id := null;
  end if;
  -- Toda ação tem um responsável: se não informado, quem criou
  new.responsible_id := coalesce(new.responsible_id, new.created_by);
  if new.responsible_id is not null and not exists (select 1 from public.profiles where id = new.responsible_id and active) then
    raise exception 'Responsável inválido ou inativo';
  end if;
  new.status := 'planejada';
  new.result := null; new.done_at := null; new.done_by := null; new.cancel_reason := null;
  new.notified_due_at := null; new.notified_overdue_at := null;
  return new;
end $$;
create trigger success_before_insert before insert on public.success_actions
  for each row execute function public.success_before_insert();

create or replace function public.success_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Referências a pessoas/ações excluídas podem ser zeradas pelas chaves (SET NULL)
  if old.created_by is not null and not exists (select 1 from public.profiles where id = old.created_by) then new.created_by := null; else new.created_by := old.created_by; end if;
  if old.done_by is not null and not exists (select 1 from public.profiles where id = old.done_by) then new.done_by := null;
  elsif new.status is not distinct from old.status then new.done_by := old.done_by; end if;
  if public.is_internal_op() then return new; end if;

  new.client_id := old.client_id; new.created_at := old.created_at;
  new.notified_due_at := old.notified_due_at; new.notified_overdue_at := old.notified_overdue_at;
  if not (old.previous_id is not null and not exists (select 1 from public.success_actions where id = old.previous_id)) then
    new.previous_id := old.previous_id;
  end if;

  if new.responsible_id is distinct from old.responsible_id and new.responsible_id is not null
     and not exists (select 1 from public.profiles where id = new.responsible_id and active) then
    raise exception 'Responsável inválido ou inativo';
  end if;

  if new.status is distinct from old.status then
    if old.status = 'planejada' and new.status in ('realizada', 'cancelada') then
      null;
    elsif old.status in ('realizada', 'cancelada') and new.status = 'planejada' then
      if not public.is_manager() then raise exception 'Somente a gestão pode reabrir uma ação encerrada'; end if;
    else
      raise exception 'Mudança de situação não permitida';
    end if;
    if new.status = 'realizada' then
      new.done_at := now(); new.done_by := auth.uid(); new.cancel_reason := null;
    elsif new.status = 'cancelada' then
      new.done_at := null; new.done_by := null; new.result := null;
    else
      new.done_at := null; new.done_by := null; new.result := null; new.cancel_reason := null;
    end if;
  else
    -- Fora da mudança de situação, o resultado de uma ação encerrada não é reescrito (só a gestão)
    if old.status <> 'planejada' and not public.is_manager()
       and (new.result, new.cancel_reason, new.objective, new.type, new.planned_date) is distinct from (old.result, old.cancel_reason, old.objective, old.type, old.planned_date) then
      raise exception 'Ação encerrada: somente a gestão pode alterar';
    end if;
    new.done_at := old.done_at;
  end if;

  -- Reagendou: os lembretes valem para a nova data
  if new.planned_date is distinct from old.planned_date then
    if new.status <> 'planejada' then raise exception 'Só é possível reagendar ações planejadas'; end if;
    new.notified_due_at := null; new.notified_overdue_at := null;
  end if;
  return new;
end $$;
create trigger success_before_update before update on public.success_actions
  for each row execute function public.success_before_update();

/** Histórico + próxima ação da recorrência. */
create or replace function public.success_after_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  reason text := nullif(current_setting('hagious.reason', true), '');
  step interval;
  base date;
  prev text;
begin
  if tg_op = 'INSERT' then
    insert into public.success_events (action_id, kind, actor_id, body, data)
    values (new.id, 'criada', coalesce(actor, new.created_by), new.objective,
            jsonb_build_object('planned_date', new.planned_date, 'type', new.type, 'previous_id', new.previous_id));
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.success_events (action_id, kind, actor_id, body, data)
    values (new.id,
            case new.status when 'realizada' then 'realizada' when 'cancelada' then 'cancelada' else 'reaberta' end,
            actor,
            case new.status when 'realizada' then new.result when 'cancelada' then new.cancel_reason else reason end,
            jsonb_build_object('from', old.status, 'to', new.status));

    -- Recorrente realizada: programa a próxima (uma só por série)
    if new.status = 'realizada' and new.recurrence <> 'nenhuma' then
      step := case new.recurrence when 'trimestral' then interval '3 months' when 'semestral' then interval '6 months' else interval '1 year' end;
      -- Mantém o ritmo pela data prevista; se a realização atrasou muito, conta a partir de hoje
      base := greatest(new.planned_date, ((now() at time zone 'America/Sao_Paulo')::date - (step / 2))::date);
      prev := current_setting('hagious.internal', true);
      perform set_config('hagious.internal', '1', true);
      insert into public.success_actions (client_id, type, objective, planned_date, responsible_id, recurrence, previous_id, created_by)
      values (new.client_id, new.type, new.objective, (base + step)::date,
              case when exists (select 1 from public.profiles where id = new.responsible_id and active) then new.responsible_id end,
              new.recurrence, new.id, coalesce(actor, new.created_by))
      on conflict (previous_id) where previous_id is not null do nothing;
      perform set_config('hagious.internal', coalesce(prev, ''), true);
    end if;
  end if;

  if new.planned_date is distinct from old.planned_date then
    insert into public.success_events (action_id, kind, actor_id, body, data)
    values (new.id, 'reagendada', actor, reason, jsonb_build_object('from', old.planned_date, 'to', new.planned_date));
  end if;
  if new.responsible_id is distinct from old.responsible_id then
    insert into public.success_events (action_id, kind, actor_id, body, data)
    values (new.id, 'responsavel', actor, reason, jsonb_build_object('from', old.responsible_id, 'to', new.responsible_id));
    if new.responsible_id is not null and new.responsible_id is distinct from actor then
      insert into public.notifications (user_id, success_action_id, kind, title, body, link, dedupe_key)
      values (new.responsible_id, new.id, 'sucesso_atribuido', 'Ação de sucesso do cliente atribuída a você', new.objective,
              '/sucesso/' || new.id, 'sca:' || new.id || ':' || new.updated_at)
      on conflict (user_id, dedupe_key) do nothing;
    end if;
  end if;
  return null;
end $$;
create trigger success_after_insert after insert on public.success_actions
  for each row execute function public.success_after_change();
create trigger success_after_update after update on public.success_actions
  for each row execute function public.success_after_change();

create or replace function public.success_events_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.kind = 'comentario' and auth.uid() is not null then
    new.created_at := now();
    new.data := null;
  end if;
  return new;
end $$;
create trigger success_events_before_insert before insert on public.success_events
  for each row execute function public.success_events_before_insert();

-- =====================================================================
-- Ações com motivo (as telas usam estas funções; as regras de acesso continuam valendo)
-- =====================================================================

create or replace function public.success_set_status(p_action uuid, p_status public.success_status, p_note text default null)
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('hagious.reason', coalesce(p_note, ''), true);
  update public.success_actions set
    status = p_status,
    result = case when p_status = 'realizada' then p_note else result end,
    cancel_reason = case when p_status = 'cancelada' then p_note else cancel_reason end
  where id = p_action;
  if not found then raise exception 'Ação não encontrada ou sem permissão'; end if;
end $$;

create or replace function public.success_reschedule(p_action uuid, p_date date, p_reason text)
returns void language plpgsql set search_path = '' as $$
begin
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Informe o motivo do reagendamento'; end if;
  perform set_config('hagious.reason', p_reason, true);
  update public.success_actions set planned_date = p_date where id = p_action;
  if not found then raise exception 'Ação não encontrada ou sem permissão'; end if;
end $$;

-- =====================================================================
-- Clientes sem acompanhamento recente (respeita as permissões de quem consulta)
-- =====================================================================
create or replace function public.success_client_overview()
returns table (client_id uuid, legal_name text, last_done_at timestamptz, next_planned date, next_action_id uuid, days_without integer, stale boolean)
language sql stable security invoker set search_path = '' as $$
  with s as (select stale_days from public.success_settings where id = 1),
  today as (select (now() at time zone 'America/Sao_Paulo')::date as d)
  select c.id, c.legal_name,
         last.done_at,
         nxt.planned_date,
         nxt.id,
         case when last.done_at is null then null else ((select d from today) - (last.done_at at time zone 'America/Sao_Paulo')::date) end,
         coalesce(last.done_at < now() - make_interval(days => (select stale_days from s)), true)
  from public.clients c
  left join lateral (select a.done_at from public.success_actions a
                     where a.client_id = c.id and a.status = 'realizada' order by a.done_at desc limit 1) last on true
  left join lateral (select a.id, a.planned_date from public.success_actions a
                     where a.client_id = c.id and a.status = 'planejada' order by a.planned_date limit 1) nxt on true
  where c.status = 'ativo'
$$;

-- =====================================================================
-- Lembretes (pg_cron, a cada hora, no expediente): no dia previsto e uma vez quando atrasa
-- =====================================================================
create or replace function public.success_sweep(p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  s public.sla_settings;
  local_ts timestamp;
  today date;
  a record;
  n_due integer := 0;
  n_late integer := 0;
  prev text := current_setting('hagious.internal', true);
begin
  select * into s from public.sla_settings where id = 1;
  local_ts := v_now at time zone s.timezone;
  today := local_ts::date;
  if local_ts::time < s.work_start or local_ts::time >= s.work_end then
    return jsonb_build_object('no_dia', 0, 'atrasadas', 0, 'fora_do_expediente', true);
  end if;
  perform set_config('hagious.internal', '1', true);

  for a in
    select x.*, c.legal_name from public.success_actions x join public.clients c on c.id = x.client_id and c.status = 'ativo'
    where x.status = 'planejada' and x.planned_date = today and x.notified_due_at is null and x.responsible_id is not null
    for update of x skip locked
  loop
    insert into public.notifications (user_id, success_action_id, kind, title, body, link, dedupe_key)
    values (a.responsible_id, a.id, 'sucesso_hoje', 'Hoje: ' || a.objective, a.legal_name, '/sucesso/' || a.id, 'scd:' || a.id || ':' || a.planned_date)
    on conflict (user_id, dedupe_key) do nothing;
    update public.success_actions set notified_due_at = v_now where id = a.id;
    n_due := n_due + 1;
  end loop;

  for a in
    select x.*, c.legal_name from public.success_actions x join public.clients c on c.id = x.client_id and c.status = 'ativo'
    where x.status = 'planejada' and x.planned_date < today and x.notified_overdue_at is null
    for update of x skip locked
  loop
    insert into public.notifications (user_id, success_action_id, kind, title, body, link, dedupe_key)
    select p.id, a.id, 'sucesso_atrasado', 'Ação de sucesso atrasada: ' || a.objective,
           a.legal_name || ' · prevista para ' || to_char(a.planned_date, 'DD/MM/YYYY'), '/sucesso/' || a.id, 'sco:' || a.id || ':' || a.planned_date
      from public.profiles p
     where p.active and (p.id = a.responsible_id or (a.responsible_id is null and p.role in ('admin', 'gestor')))
    on conflict (user_id, dedupe_key) do nothing;
    update public.success_actions set notified_overdue_at = v_now where id = a.id;
    n_late := n_late + 1;
  end loop;

  perform set_config('hagious.internal', coalesce(prev, ''), true);
  return jsonb_build_object('no_dia', n_due, 'atrasadas', n_late);
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('hagious-success-sweep', '10 * * * *', 'select public.success_sweep()');
exception when others then
  raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;

-- =====================================================================
-- Permissões (RLS)
-- =====================================================================
alter table public.success_settings enable row level security;
alter table public.success_actions enable row level security;
alter table public.success_events enable row level security;

create policy success_settings_select on public.success_settings for select to authenticated using (public.is_active_user());
create policy success_settings_update on public.success_settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Quem vê o cliente vê e programa ações; altera quem é responsável, quem criou, a gestão e o atendimento
create policy success_select on public.success_actions for select to authenticated using (public.can_view_client(client_id));
create policy success_insert on public.success_actions for insert to authenticated
  with check (public.is_active_user() and public.can_view_client(client_id));
create policy success_update on public.success_actions for update to authenticated
  using (public.is_active_user() and public.can_view_client(client_id)
         and (public.is_manager() or responsible_id = auth.uid() or created_by = auth.uid() or public.current_department() = 'atendimento'))
  with check (public.can_view_client(client_id));
create policy success_delete on public.success_actions for delete to authenticated using (public.is_admin());

create policy success_events_select on public.success_events for select to authenticated
  using (exists (select 1 from public.success_actions a where a.id = action_id and public.can_view_client(a.client_id)));
create policy success_events_insert on public.success_events for insert to authenticated
  with check (kind = 'comentario' and actor_id = auth.uid()
              and exists (select 1 from public.success_actions a where a.id = action_id and public.can_view_client(a.client_id)));

grant select, update on public.success_settings to authenticated;
grant select, insert, update, delete on public.success_actions to authenticated;
grant select, insert on public.success_events to authenticated;
grant all on public.success_settings, public.success_actions, public.success_events to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.success_sweep(timestamptz) from anon, authenticated, public;
grant execute on function public.success_sweep(timestamptz) to service_role;
revoke execute on function public.success_set_status(uuid, public.success_status, text), public.success_reschedule(uuid, date, text),
  public.success_client_overview() from anon, public;
grant execute on function public.success_set_status(uuid, public.success_status, text), public.success_reschedule(uuid, date, text),
  public.success_client_overview() to authenticated, service_role;

create trigger audit_success_actions after insert or update or delete on public.success_actions
  for each row execute function public.audit_trigger();

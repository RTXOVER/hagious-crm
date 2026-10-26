-- =====================================================================
-- CRM Hagious — Etapa 3: tickets, SLA, encaminhamento, menções e alertas
-- =====================================================================
-- Regras principais (todas aplicadas no banco):
-- * Prazos de 1ª resposta e de resolução são calculados na criação, pela categoria,
--   em tempo ÚTIL (calendário da migração anterior). Ninguém consegue editá-los à mão.
-- * "Aguardando cliente" PAUSA o SLA; ao sair, o prazo é estendido pelo tempo útil pausado.
-- * 1ª resposta = primeira "resposta ao cliente" registrada OU saída do status "aberto".
-- * Concluir exige registro da conclusão; cancelar exige motivo.
-- * Toda mudança gera evento no histórico do ticket, com autor.
-- * Alertas: varredura a cada 5 min avisa responsável e escala para a gestão, sem duplicar.
-- =====================================================================

create type public.ticket_status as enum ('aberto', 'em_andamento', 'aguardando_cliente', 'concluido', 'cancelado');
create type public.ticket_priority as enum ('baixa', 'normal', 'alta', 'urgente');
create type public.ticket_origin as enum ('whatsapp', 'telefone', 'email', 'presencial', 'interno');
create type public.sla_unit as enum ('horas_uteis', 'dias_uteis');
create type public.ticket_event_kind as enum (
  'criado', 'comentario', 'resposta', 'status', 'atribuicao', 'encaminhamento', 'prioridade', 'categoria'
);

-- ---------- Categorias (tipos de solicitação) e seus prazos ----------
create table public.ticket_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  department public.department not null check (department <> 'atendimento'),
  first_response_minutes integer check (first_response_minutes is null or first_response_minutes > 0),
  resolution_value integer not null check (resolution_value > 0),
  resolution_unit public.sla_unit not null,
  active boolean not null default true,
  -- true = valor inicial ainda não confirmado pela gestão
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, department)
);
create trigger ticket_categories_updated_at before update on public.ticket_categories
  for each row execute function public.set_updated_at();

insert into public.ticket_categories (name, department, resolution_value, resolution_unit, needs_review) values
  -- Referências do documento de requisitos
  ('Alteração contratual', 'contabil', 3, 'dias_uteis', false),
  ('Emissão de certidão simples', 'fiscal', 4, 'horas_uteis', false),
  -- Valores iniciais A CONFIRMAR pela gestão
  ('Solicitação geral', 'contabil', 2, 'dias_uteis', true),
  ('Solicitação geral', 'fiscal', 2, 'dias_uteis', true),
  ('Solicitação geral', 'dp', 2, 'dias_uteis', true);

-- ---------- Tickets ----------
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  number bigint generated always as identity unique,
  client_id uuid not null references public.clients(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 3 and 200),
  description text check (description is null or char_length(description) <= 8000),
  origin public.ticket_origin not null default 'interno',
  category_id uuid not null references public.ticket_categories(id) on delete restrict,
  department public.department not null check (department <> 'atendimento'),
  assignee_id uuid references public.profiles(id) on delete set null,
  priority public.ticket_priority not null default 'normal',
  status public.ticket_status not null default 'aberto',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- SLA (calculado pelo banco)
  first_response_due_at timestamptz,
  first_responded_at timestamptz,
  resolution_due_at timestamptz,
  risk_at timestamptz,
  sla_paused_at timestamptz,
  sla_paused_minutes integer not null default 0,
  -- Conclusão / cancelamento
  resolved_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references public.profiles(id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 4000),
  cancel_reason text check (cancel_reason is null or char_length(cancel_reason) <= 1000),
  -- Controle dos alertas (evita duplicidade)
  fr_overdue_notified_at timestamptz,
  risk_notified_at timestamptz,
  overdue_notified_at timestamptz,
  constraint conclusao_registrada check (status <> 'concluido' or char_length(trim(coalesce(resolution_note, ''))) >= 3),
  constraint cancelamento_motivado check (status <> 'cancelado' or char_length(trim(coalesce(cancel_reason, ''))) >= 3)
);
create index tickets_client_idx on public.tickets (client_id, created_at desc);
create index tickets_open_idx on public.tickets (status, resolution_due_at) where status in ('aberto', 'em_andamento', 'aguardando_cliente');
create index tickets_assignee_idx on public.tickets (assignee_id) where status in ('aberto', 'em_andamento', 'aguardando_cliente');
create index tickets_department_idx on public.tickets (department, status);
create trigger tickets_updated_at before update on public.tickets
  for each row execute function public.set_updated_at();

-- ---------- Histórico do ticket ----------
create table public.ticket_events (
  id bigint generated always as identity primary key,
  ticket_id uuid not null references public.tickets(id) on delete cascade,
  kind public.ticket_event_kind not null,
  actor_id uuid references public.profiles(id) on delete set null,
  body text check (body is null or char_length(body) <= 8000),
  data jsonb,
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now()
);
create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);
create index ticket_events_mentions_idx on public.ticket_events using gin (mentions);

-- ---------- Notificações internas ----------
create table public.notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  ticket_id uuid references public.tickets(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  link text,
  dedupe_key text not null,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, read_at, created_at desc);

-- =====================================================================
-- Funções auxiliares
-- =====================================================================

/** Indica operação interna (gatilhos/varredura), que pode alterar campos protegidos. */
create or replace function public.is_internal_op()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(current_setting('hagious.internal', true), '') = '1'
$$;

/** Participou do ticket: foi mencionado ou fez alguma ação (comentou, encaminhou...). Continua podendo acompanhar. */
create or replace function public.is_participant(p_ticket uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.ticket_events e
    where e.ticket_id = p_ticket and (e.actor_id = auth.uid() or auth.uid() = any (e.mentions))
  )
$$;

/** Pode alterar o ticket (estado ATUAL): gestão, atendimento, departamento do ticket ou responsável. */
create or replace function public.can_edit_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket and public.is_active_user() and (
      public.is_manager()
      or public.current_department() = 'atendimento'
      or t.department = public.current_department()
      or t.assignee_id = auth.uid()
    )
  )
$$;

create or replace function public.can_view_ticket(p_ticket uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket and public.is_active_user() and (
      public.is_manager()
      or public.current_department() = 'atendimento'
      or t.department = public.current_department()
      or t.assignee_id = auth.uid()
      or t.created_by = auth.uid()
      or public.is_participant(t.id)
    )
  )
$$;

/** Cria notificação sem duplicar (mesmo usuário + mesma chave = ignorada). */
create or replace function public.notify(p_user uuid, p_ticket uuid, p_kind text, p_title text, p_body text, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  if not exists (select 1 from public.profiles where id = p_user and active) then return; end if;
  insert into public.notifications (user_id, ticket_id, kind, title, body, link, dedupe_key)
  values (p_user, p_ticket, p_kind, p_title, p_body,
          case when p_ticket is not null then '/tickets/' || p_ticket end, p_dedupe)
  on conflict (user_id, dedupe_key) do nothing;
end $$;

/** Notifica o responsável ou, se não houver, as pessoas do departamento. */
create or replace function public.notify_owner(t public.tickets, p_kind text, p_title text, p_body text, p_dedupe text, p_skip uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if t.assignee_id is not null then
    if t.assignee_id is distinct from p_skip then
      perform public.notify(t.assignee_id, t.id, p_kind, p_title, p_body, p_dedupe);
    end if;
  else
    for r in select id from public.profiles where active and department = t.department and id is distinct from p_skip loop
      perform public.notify(r.id, t.id, p_kind, p_title, p_body, p_dedupe);
    end loop;
  end if;
end $$;

create or replace function public.notify_managers(t public.tickets, p_kind text, p_title text, p_body text, p_dedupe text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select id from public.profiles where active and role in ('admin', 'gestor') loop
    perform public.notify(r.id, t.id, p_kind, p_title, p_body, p_dedupe);
  end loop;
end $$;

/** Calcula os prazos de um ticket a partir da categoria e do instante de abertura. */
create or replace function public.ticket_sla_dates(p_category uuid, p_start timestamptz,
  out first_response_due timestamptz, out resolution_due timestamptz, out risk timestamptz)
language plpgsql stable set search_path = '' as $$
declare
  c public.ticket_categories;
  s public.sla_settings;
  total integer;
begin
  select * into c from public.ticket_categories where id = p_category;
  if not found then raise exception 'Categoria inexistente'; end if;
  select * into s from public.sla_settings where id = 1;
  first_response_due := public.business_add_minutes(p_start, coalesce(c.first_response_minutes, s.default_first_response_minutes));
  resolution_due := case c.resolution_unit
    when 'horas_uteis' then public.business_add_minutes(p_start, c.resolution_value * 60)
    else public.business_add_days(p_start, c.resolution_value) end;
  total := public.business_minutes_between(public.business_normalize(p_start), resolution_due);
  risk := public.business_add_minutes(p_start, floor(total * (100 - s.risk_percent) / 100.0)::int);
end $$;

/** Prévia dos prazos para a tela de abertura de ticket. */
create or replace function public.sla_preview(p_category uuid)
returns table (first_response_due timestamptz, resolution_due timestamptz)
language sql stable set search_path = '' as $$
  select d.first_response_due, d.resolution_due from public.ticket_sla_dates(p_category, now()) d
$$;

-- =====================================================================
-- Gatilhos dos tickets
-- =====================================================================

create or replace function public.tickets_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  c public.ticket_categories;
  d record;
begin
  select * into c from public.ticket_categories where id = new.category_id;
  if not found or not c.active then raise exception 'Categoria inválida ou inativa'; end if;
  if new.department is null then new.department := c.department; end if;
  -- Usuários comuns não escolhem data de abertura nem autor (importações pela chave de serviço podem)
  if auth.uid() is not null then
    new.created_at := now();
    new.created_by := auth.uid();
  end if;
  new.status := 'aberto';
  select * into d from public.ticket_sla_dates(new.category_id, new.created_at);
  new.first_response_due_at := d.first_response_due;
  new.resolution_due_at := d.resolution_due;
  new.risk_at := d.risk;
  new.first_responded_at := null; new.resolved_at := null; new.closed_at := null; new.closed_by := null;
  new.sla_paused_at := null; new.sla_paused_minutes := 0;
  new.fr_overdue_notified_at := null; new.risk_notified_at := null; new.overdue_notified_at := null;
  new.resolution_note := null; new.cancel_reason := null;
  return new;
end $$;

create or replace function public.tickets_before_update()
returns trigger language plpgsql set search_path = '' as $$
declare
  paused integer;
  d record;
  allowed boolean;
begin
  if public.is_internal_op() then return new; end if;

  -- Campos imutáveis e campos calculados: sempre partem do valor anterior
  new.number := old.number; new.created_at := old.created_at; new.created_by := old.created_by;
  new.client_id := old.client_id;
  new.first_response_due_at := old.first_response_due_at; new.first_responded_at := old.first_responded_at;
  new.resolution_due_at := old.resolution_due_at; new.risk_at := old.risk_at;
  new.sla_paused_at := old.sla_paused_at; new.sla_paused_minutes := old.sla_paused_minutes;
  new.resolved_at := old.resolved_at; new.closed_at := old.closed_at; new.closed_by := old.closed_by;
  new.fr_overdue_notified_at := old.fr_overdue_notified_at;
  new.risk_notified_at := old.risk_notified_at; new.overdue_notified_at := old.overdue_notified_at;

  -- Troca de categoria: só em ticket aberto; prazos recalculados desde a abertura (+ pausas)
  if new.category_id is distinct from old.category_id then
    if old.status in ('concluido', 'cancelado') then raise exception 'Ticket encerrado não pode mudar de categoria'; end if;
    if not exists (select 1 from public.ticket_categories where id = new.category_id and active) then
      raise exception 'Categoria inválida ou inativa';
    end if;
    select * into d from public.ticket_sla_dates(new.category_id, old.created_at);
    new.first_response_due_at := d.first_response_due;
    new.resolution_due_at := public.business_add_minutes(d.resolution_due, old.sla_paused_minutes);
    new.risk_at := public.business_add_minutes(d.risk, old.sla_paused_minutes);
    new.fr_overdue_notified_at := null; new.risk_notified_at := null; new.overdue_notified_at := null;
  end if;

  if new.status is distinct from old.status then
    allowed := case old.status
      when 'aberto' then new.status in ('em_andamento', 'aguardando_cliente', 'concluido', 'cancelado')
      when 'em_andamento' then new.status in ('aguardando_cliente', 'concluido', 'cancelado')
      when 'aguardando_cliente' then new.status in ('em_andamento', 'concluido', 'cancelado')
      when 'concluido' then new.status = 'em_andamento'
      when 'cancelado' then new.status = 'em_andamento'
    end;
    if not allowed then
      raise exception 'Mudança de situação não permitida: % → %', old.status, new.status;
    end if;
    -- Reabrir ticket encerrado: somente gestão
    if old.status in ('concluido', 'cancelado') and not public.is_manager() then
      raise exception 'Somente a gestão pode reabrir tickets';
    end if;

    -- 1ª resposta: sair de "aberto" conta como primeiro atendimento
    if old.status = 'aberto' and new.status <> 'cancelado' and old.first_responded_at is null then
      new.first_responded_at := now();
    end if;

    -- Pausa do SLA
    if new.status = 'aguardando_cliente' then
      new.sla_paused_at := now();
    end if;
    if old.status = 'aguardando_cliente' then
      paused := public.business_minutes_between(old.sla_paused_at, now());
      new.resolution_due_at := public.business_add_minutes(old.resolution_due_at, paused);
      new.risk_at := public.business_add_minutes(old.risk_at, paused);
      new.sla_paused_minutes := old.sla_paused_minutes + paused;
      new.sla_paused_at := null;
      if new.risk_at > now() then new.risk_notified_at := null; end if;
      if new.resolution_due_at > now() then new.overdue_notified_at := null; end if;
    end if;

    -- Encerramento
    if new.status in ('concluido', 'cancelado') then
      new.closed_at := now();
      new.closed_by := auth.uid();
      if new.status = 'concluido' then new.resolved_at := now(); end if;
    end if;
    -- Reabertura
    if old.status in ('concluido', 'cancelado') then
      new.resolved_at := null; new.closed_at := null; new.closed_by := null;
      new.resolution_note := null; new.cancel_reason := null;
    end if;
  end if;
  return new;
end $$;

create trigger tickets_before_insert before insert on public.tickets
  for each row execute function public.tickets_before_insert();
create trigger tickets_before_update before update on public.tickets
  for each row execute function public.tickets_before_update();

/** Registra no histórico e notifica as pessoas certas. */
create or replace function public.tickets_after_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  reason text := nullif(current_setting('hagious.reason', true), '');
  label text := '#' || new.number || ' ' || new.title;
begin
  if public.is_internal_op() then return null; end if;

  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, kind, actor_id, body, data)
    values (new.id, 'criado', coalesce(actor, new.created_by), new.description,
            jsonb_build_object('department', new.department, 'priority', new.priority, 'origin', new.origin));
    perform public.notify_owner(new, 'novo_ticket', 'Novo ticket ' || label,
      case when new.assignee_id is null then 'Na fila do seu departamento.' else 'Atribuído a você.' end,
      'novo:' || new.id, actor);
    return null;
  end if;

  if new.status is distinct from old.status then
    insert into public.ticket_events (ticket_id, kind, actor_id, body, data)
    values (new.id, 'status', actor,
            coalesce(case when new.status = 'concluido' then new.resolution_note
                          when new.status = 'cancelado' then new.cancel_reason end, reason),
            jsonb_build_object('from', old.status, 'to', new.status));
    if actor is distinct from new.assignee_id and new.assignee_id is not null then
      perform public.notify(new.assignee_id, new.id, 'status', 'Situação alterada ' || label,
        replace(new.status::text, '_', ' '), 'status:' || new.id || ':' || new.updated_at);
    end if;
  end if;

  if new.department is distinct from old.department then
    insert into public.ticket_events (ticket_id, kind, actor_id, body, data)
    values (new.id, 'encaminhamento', actor, reason,
            jsonb_build_object('from', old.department, 'to', new.department, 'assignee', new.assignee_id));
    perform public.notify_owner(new, 'encaminhado', 'Ticket encaminhado ' || label,
      coalesce(reason, 'Encaminhado ao seu departamento.'), 'enc:' || new.id || ':' || new.updated_at, actor);
  elsif new.assignee_id is distinct from old.assignee_id then
    insert into public.ticket_events (ticket_id, kind, actor_id, body, data)
    values (new.id, 'atribuicao', actor, reason, jsonb_build_object('from', old.assignee_id, 'to', new.assignee_id));
    if new.assignee_id is not null and new.assignee_id is distinct from actor then
      perform public.notify(new.assignee_id, new.id, 'atribuido', 'Ticket atribuído a você ' || label,
        coalesce(reason, ''), 'atr:' || new.id || ':' || new.updated_at);
    end if;
  end if;

  if new.priority is distinct from old.priority then
    insert into public.ticket_events (ticket_id, kind, actor_id, data)
    values (new.id, 'prioridade', actor, jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;
  if new.category_id is distinct from old.category_id then
    insert into public.ticket_events (ticket_id, kind, actor_id, data)
    values (new.id, 'categoria', actor, jsonb_build_object('from', old.category_id, 'to', new.category_id));
  end if;
  return null;
end $$;

create trigger tickets_after_insert after insert on public.tickets
  for each row execute function public.tickets_after_change();
create trigger tickets_after_update after update on public.tickets
  for each row execute function public.tickets_after_change();

/** Comentários: notifica menções e o responsável; "resposta ao cliente" marca a 1ª resposta. */
create or replace function public.ticket_events_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.tickets;
  m uuid;
  label text;
begin
  if new.kind not in ('comentario', 'resposta') then return null; end if;
  select * into t from public.tickets where id = new.ticket_id;
  label := '#' || t.number || ' ' || t.title;

  foreach m in array new.mentions loop
    if m is distinct from new.actor_id then
      perform public.notify(m, t.id, 'mencao', 'Você foi mencionado em ' || label, left(new.body, 300), 'men:' || new.id || ':' || m);
    end if;
  end loop;
  if t.assignee_id is not null and t.assignee_id is distinct from new.actor_id and not (t.assignee_id = any (new.mentions)) then
    perform public.notify(t.assignee_id, t.id, 'comentario', 'Novo comentário em ' || label, left(new.body, 300), 'com:' || new.id);
  end if;

  if new.kind = 'resposta' and t.first_responded_at is null then
    perform set_config('hagious.internal', '1', true);
    update public.tickets set first_responded_at = now() where id = t.id;
    perform set_config('hagious.internal', '', true);
  end if;
  return null;
end $$;

create trigger ticket_events_after_insert after insert on public.ticket_events
  for each row execute function public.ticket_events_after_insert();

-- =====================================================================
-- Ações com motivo (a tela usa estas funções; as regras de acesso continuam valendo)
-- =====================================================================

create or replace function public.ticket_set_status(p_ticket uuid, p_status public.ticket_status, p_note text default null)
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('hagious.reason', coalesce(p_note, ''), true);
  update public.tickets set
    status = p_status,
    resolution_note = case when p_status = 'concluido' then p_note else resolution_note end,
    cancel_reason = case when p_status = 'cancelado' then p_note else cancel_reason end
  where id = p_ticket;
  if not found then raise exception 'Ticket não encontrado ou sem permissão'; end if;
end $$;

-- SECURITY DEFINER: quem encaminha pode perder a visão do ticket pelo departamento (e o banco recusaria
-- a alteração). A permissão é conferida explicitamente ANTES, sobre o estado atual do ticket.
create or replace function public.ticket_forward(p_ticket uuid, p_department public.department, p_assignee uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.can_edit_ticket(p_ticket) then raise exception 'Ticket não encontrado ou sem permissão'; end if;
  if p_department = 'atendimento' then raise exception 'Encaminhe para Contábil, Fiscal ou DP'; end if;
  if char_length(trim(coalesce(p_reason, ''))) < 3 then raise exception 'Informe o motivo do encaminhamento'; end if;
  if p_assignee is not null and not exists (select 1 from public.profiles where id = p_assignee and active) then
    raise exception 'Responsável inválido ou inativo';
  end if;
  perform set_config('hagious.reason', p_reason, true);
  update public.tickets set department = p_department, assignee_id = p_assignee where id = p_ticket;
end $$;

create or replace function public.ticket_assign(p_ticket uuid, p_assignee uuid)
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('hagious.reason', '', true);
  update public.tickets set assignee_id = p_assignee where id = p_ticket;
  if not found then raise exception 'Ticket não encontrado ou sem permissão'; end if;
end $$;

-- =====================================================================
-- Varredura de prazos (alertas preventivos e escalonamento)
-- =====================================================================

create or replace function public.sla_sweep()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  t public.tickets;
  n integer := 0;
  label text;
begin
  perform set_config('hagious.internal', '1', true);
  for t in
    select * from public.tickets
    where status in ('aberto', 'em_andamento')   -- "aguardando cliente" está pausado
      and (
        (first_responded_at is null and now() > first_response_due_at and fr_overdue_notified_at is null)
        or (now() >= risk_at and risk_notified_at is null)
        or (now() > resolution_due_at and overdue_notified_at is null)
      )
    for update skip locked
  loop
    label := '#' || t.number || ' ' || t.title;
    if t.first_responded_at is null and now() > t.first_response_due_at and t.fr_overdue_notified_at is null then
      perform public.notify_owner(t, 'primeira_resposta_atrasada', 'Primeira resposta atrasada ' || label,
        'O prazo de primeira resposta venceu.', 'fr:' || t.id || ':' || t.first_response_due_at);
      perform public.notify_managers(t, 'escalonamento', 'Escalonado: 1ª resposta atrasada ' || label,
        'O cliente ainda não recebeu a primeira resposta.', 'frm:' || t.id || ':' || t.first_response_due_at);
      update public.tickets set fr_overdue_notified_at = now() where id = t.id;
      n := n + 1;
    end if;
    if now() > t.resolution_due_at and t.overdue_notified_at is null then
      perform public.notify_owner(t, 'prazo_vencido', 'Prazo vencido ' || label,
        'O prazo de resolução venceu.', 'ov:' || t.id || ':' || t.resolution_due_at);
      perform public.notify_managers(t, 'escalonamento', 'Escalonado: prazo vencido ' || label,
        'Ticket com prazo de resolução vencido.', 'ovm:' || t.id || ':' || t.resolution_due_at);
      update public.tickets set overdue_notified_at = now(), risk_notified_at = coalesce(risk_notified_at, now()) where id = t.id;
      n := n + 1;
    elsif now() >= t.risk_at and t.risk_notified_at is null then
      perform public.notify_owner(t, 'prazo_em_risco', 'Prazo em risco ' || label,
        'Falta pouco para o prazo de resolução vencer.', 'rk:' || t.id || ':' || t.resolution_due_at);
      perform public.notify_managers(t, 'escalonamento', 'Escalonado: prazo em risco ' || label,
        'Ticket perto do vencimento.', 'rkm:' || t.id || ':' || t.resolution_due_at);
      update public.tickets set risk_notified_at = now() where id = t.id;
      n := n + 1;
    end if;
  end loop;
  perform set_config('hagious.internal', '', true);
  return n;
end $$;

-- Agenda a varredura a cada 5 minutos (pg_cron). Se a extensão não estiver disponível,
-- o restante funciona e o painel continua mostrando os prazos; apenas os avisos automáticos ficam pendentes.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('hagious-sla-sweep', '*/5 * * * *', 'select public.sla_sweep()');
exception when others then
  raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;

-- =====================================================================
-- Permissões (RLS)
-- =====================================================================
alter table public.ticket_categories enable row level security;
alter table public.tickets enable row level security;
alter table public.ticket_events enable row level security;
alter table public.notifications enable row level security;

create policy categories_select on public.ticket_categories for select to authenticated using (public.is_active_user());
create policy categories_write on public.ticket_categories for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy tickets_select on public.tickets for select to authenticated
  using (public.is_active_user() and (
    public.is_manager()
    or public.current_department() = 'atendimento'
    or department = public.current_department()
    or assignee_id = auth.uid()
    or created_by = auth.uid()
    or public.is_participant(id)
  ));
create policy tickets_insert on public.tickets for insert to authenticated
  with check (public.is_active_user() and public.can_view_client(client_id));
-- Quem pode mexer: gestão, atendimento (triagem), o departamento do ticket e o responsável.
-- Encaminhar a outro departamento é feito pela função ticket_forward.
create policy tickets_update on public.tickets for update to authenticated
  using (public.is_active_user() and (
    public.is_manager()
    or public.current_department() = 'atendimento'
    or department = public.current_department()
    or assignee_id = auth.uid()
  ))
  with check (public.is_active_user());
create policy tickets_delete on public.tickets for delete to authenticated using (public.is_admin());

create policy events_select on public.ticket_events for select to authenticated using (public.can_view_ticket(ticket_id));
create policy events_insert on public.ticket_events for insert to authenticated
  with check (kind in ('comentario', 'resposta') and actor_id = auth.uid() and public.can_view_ticket(ticket_id));

create policy notifications_select on public.notifications for select to authenticated using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------- Privilégios explícitos ----------
grant select, insert, update, delete on public.ticket_categories to authenticated;
grant select, insert, update, delete on public.tickets to authenticated;
grant select, insert on public.ticket_events to authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.ticket_categories, public.tickets, public.ticket_events, public.notifications to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.notify(uuid, uuid, text, text, text, text), public.notify_owner(public.tickets, text, text, text, text, uuid),
  public.notify_managers(public.tickets, text, text, text, text), public.sla_sweep()
  from anon, authenticated, public;
grant execute on function public.sla_sweep() to service_role;
-- is_internal_op é lida pelo gatilho de atualização, que roda com o usuário logado
revoke execute on function public.is_internal_op() from anon, public;
grant execute on function public.is_internal_op() to authenticated, service_role;
grant execute on function public.is_participant(uuid), public.can_edit_ticket(uuid), public.can_view_ticket(uuid), public.ticket_sla_dates(uuid, timestamptz),
  public.sla_preview(uuid), public.ticket_set_status(uuid, public.ticket_status, text),
  public.ticket_forward(uuid, public.department, uuid, text), public.ticket_assign(uuid, uuid)
  to authenticated, service_role;
revoke execute on function public.is_participant(uuid), public.can_edit_ticket(uuid), public.can_view_ticket(uuid), public.ticket_sla_dates(uuid, timestamptz),
  public.sla_preview(uuid), public.ticket_set_status(uuid, public.ticket_status, text),
  public.ticket_forward(uuid, public.department, uuid, text), public.ticket_assign(uuid, uuid)
  from anon, public;

create trigger audit_ticket_categories after insert or update or delete on public.ticket_categories
  for each row execute function public.audit_trigger();
create trigger audit_tickets after insert or update or delete on public.tickets
  for each row execute function public.audit_trigger();

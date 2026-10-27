-- =====================================================================
-- Etapa 3 (parte 2): central de cobrança preventiva de documentos
--
-- Exigência (o que o cliente entrega e com que frequência)
--   -> Pendência (uma por vencimento, gerada automaticamente)
--   -> Lembretes (padrão: 5 dias antes, 2 dias antes e no dia), registrados um a um
--   -> Pendência vencida: entra no relatório crítico e a gestão é avisada uma vez.
-- Os lembretes param quando o documento é recebido, dispensado ou deixa de ser exigível.
-- =====================================================================

create type public.doc_periodicity as enum ('mensal', 'trimestral', 'semestral', 'anual');
create type public.doc_status as enum ('pendente', 'recebido', 'dispensado', 'nao_exigivel');
create type public.reminder_channel as enum ('interno', 'whatsapp');
create type public.reminder_status as enum ('na_fila', 'enviado', 'falhou', 'cancelado', 'sem_canal');

-- ---------- Configuração (linha única) ----------
create table public.document_settings (
  id smallint primary key default 1 check (id = 1),
  -- Dias antes do vencimento em que o lembrete é disparado (0 = no dia)
  reminder_days integer[] not null default '{5,2,0}'
    check (cardinality(reminder_days) between 1 and 6 and 0 <= all (reminder_days) and 60 >= all (reminder_days)),
  -- Com quantos dias de antecedência as pendências do período são criadas
  generate_ahead_days integer not null default 40 check (generate_ahead_days between 7 and 120),
  updated_at timestamptz not null default now()
);
insert into public.document_settings (id) values (1);
create trigger document_settings_updated_at before update on public.document_settings
  for each row execute function public.set_updated_at();

/** Data de hoje no fuso da empresa. */
create or replace function public.doc_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone coalesce((select timezone from public.sla_settings where id = 1), 'America/Sao_Paulo'))::date
$$;

-- ---------- Catálogo de documentos ----------
create table public.document_types (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 120),
  department public.department not null check (department <> 'atendimento'),
  description text check (description is null or char_length(description) <= 500),
  default_periodicity public.doc_periodicity not null default 'mensal',
  default_due_day smallint not null default 10 check (default_due_day between 1 and 31),
  active boolean not null default true,
  -- true = sugestão inicial ainda não confirmada pela gestão
  needs_review boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name, department)
);
create trigger document_types_updated_at before update on public.document_types
  for each row execute function public.set_updated_at();

-- Sugestões iniciais A CONFIRMAR (não vieram do documento de requisitos)
insert into public.document_types (name, department, description, default_periodicity, default_due_day, needs_review) values
  ('Extratos bancários', 'contabil', 'Extratos de todas as contas do mês anterior', 'mensal', 10, true),
  ('Notas fiscais de entrada e saída', 'fiscal', 'XML ou relatório das notas do mês anterior', 'mensal', 5, true),
  ('Informações para a folha', 'dp', 'Ponto, faltas, horas extras, admissões e desligamentos do mês', 'mensal', 20, true);

-- ---------- Exigências por cliente ----------
create table public.document_requirements (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  document_type_id uuid not null references public.document_types(id) on delete restrict,
  department public.department not null,              -- copiado do tipo
  periodicity public.doc_periodicity not null,
  due_day smallint not null check (due_day between 1 and 31),  -- 31 = último dia do mês
  first_month smallint check (first_month between 1 and 12),   -- trimestral/semestral/anual: mês de referência
  responsible_id uuid references public.profiles(id) on delete set null,
  starts_on date not null default public.doc_today(),
  ends_on date,
  active boolean not null default true,
  notes text check (notes is null or char_length(notes) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mes_de_referencia check (periodicity = 'mensal' or first_month is not null),
  constraint periodo_exigencia check (ends_on is null or ends_on >= starts_on),
  unique (client_id, document_type_id)
);
create trigger document_requirements_updated_at before update on public.document_requirements
  for each row execute function public.set_updated_at();
create index document_requirements_client_idx on public.document_requirements (client_id);

/** Vencimentos de uma regra dentro de um intervalo (dia 31 vira o último dia de meses mais curtos). */
create or replace function public.doc_due_dates(p_periodicity public.doc_periodicity, p_due_day integer, p_first_month integer, p_from date, p_to date)
returns setof date language sql immutable set search_path = '' as $$
  select x.d from (
    select (m + make_interval(days => least(p_due_day, extract(day from (m + interval '1 month' - interval '1 day'))::int) - 1))::date as d,
           extract(month from m)::int as mon
    from generate_series(date_trunc('month', p_from::timestamp), date_trunc('month', p_to::timestamp), interval '1 month') as m
  ) x
  where p_from <= p_to and x.d between p_from and p_to
    and (p_periodicity = 'mensal'
         or (x.mon - p_first_month + 12) % (case p_periodicity when 'trimestral' then 3 when 'semestral' then 6 else 12 end) = 0)
$$;

-- ---------- Pendências (uma por vencimento) ----------
create table public.client_documents (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  requirement_id uuid references public.document_requirements(id) on delete set null,  -- nulo = avulso
  document_type_id uuid not null references public.document_types(id) on delete restrict,
  title text not null check (char_length(trim(title)) between 2 and 160),
  department public.department not null check (department <> 'atendimento'),
  due_date date not null,
  status public.doc_status not null default 'pendente',
  responsible_id uuid references public.profiles(id) on delete set null,
  received_at timestamptz,
  received_by uuid references public.profiles(id) on delete set null,
  -- Observação do recebimento ou motivo da dispensa / da não exigibilidade
  status_note text check (status_note is null or char_length(status_note) <= 1000),
  -- true = deixou de ser exigível por mudança na exigência (volta a valer se a regra voltar a incluir a data)
  auto_voided boolean not null default false,
  overdue_notified_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recebimento_registrado check (status <> 'recebido' or received_at is not null),
  constraint dispensa_motivada check (status not in ('dispensado', 'nao_exigivel') or char_length(trim(coalesce(status_note, ''))) >= 3)
);
create trigger client_documents_updated_at before update on public.client_documents
  for each row execute function public.set_updated_at();
-- Impede pendência duplicada para o mesmo vencimento da mesma exigência
create unique index client_documents_period_uq on public.client_documents (requirement_id, due_date) where requirement_id is not null;
create index client_documents_open_idx on public.client_documents (status, due_date);
create index client_documents_client_idx on public.client_documents (client_id, due_date desc);

-- ---------- Registro de lembretes (envios, falhas e tentativas) ----------
create table public.document_reminders (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.client_documents(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  days_before integer not null,
  due_date date not null,
  channel public.reminder_channel not null,
  status public.reminder_status not null,
  recipient text,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Um lembrete por etapa, vencimento e canal: rodar a varredura de novo nunca duplica
  unique (document_id, due_date, days_before, channel)
);
create trigger document_reminders_updated_at before update on public.document_reminders
  for each row execute function public.set_updated_at();
create index document_reminders_queue_idx on public.document_reminders (channel, status) where status = 'na_fila';

-- Avisos internos também podem apontar para um documento
alter table public.notifications add column document_id uuid references public.client_documents(id) on delete cascade;

-- =====================================================================
-- Funções auxiliares
-- =====================================================================

/** Quem deve cobrar: o responsável da pendência; senão o responsável do cliente no departamento; senão o departamento. */
create or replace function public.doc_owner_ids(p_client uuid, p_department public.department, p_responsible uuid)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if p_responsible is not null and exists (select 1 from public.profiles where id = p_responsible and active) then
    return next p_responsible;
    return;
  end if;
  return query
    select r.user_id from public.client_responsibles r join public.profiles p on p.id = r.user_id
    where r.client_id = p_client and r.department = p_department and p.active;
  if found then return; end if;
  return query select p.id from public.profiles p where p.active and p.department = p_department;
end $$;

/** Cria as pendências dos próximos dias (todas as exigências ativas ou só uma). Nunca duplica. */
create or replace function public.doc_generate(p_requirement uuid default null, p_today date default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  today date := coalesce(p_today, public.doc_today());
  horizon date;
  n integer;
  prev text := current_setting('hagious.internal', true);
begin
  select today + generate_ahead_days into horizon from public.document_settings where id = 1;
  perform set_config('hagious.internal', '1', true);
  insert into public.client_documents (client_id, requirement_id, document_type_id, title, department, due_date, responsible_id)
  select r.client_id, r.id, r.document_type_id, t.name, r.department, d.due, r.responsible_id
  from public.document_requirements r
  join public.document_types t on t.id = r.document_type_id
  join public.clients c on c.id = r.client_id and c.status = 'ativo'
  cross join lateral public.doc_due_dates(r.periodicity, r.due_day, r.first_month,
                                          greatest(today, r.starts_on), least(horizon, coalesce(r.ends_on, horizon))) as d(due)
  where r.active and (p_requirement is null or r.id = p_requirement)
  on conflict (requirement_id, due_date) where requirement_id is not null
  -- Se a regra voltou a incluir uma data que tinha sido anulada automaticamente, a pendência volta a valer
  do update set status = 'pendente', status_note = null, auto_voided = false, responsible_id = excluded.responsible_id
    where public.client_documents.auto_voided and public.client_documents.status = 'nao_exigivel';
  get diagnostics n = row_count;
  perform set_config('hagious.internal', coalesce(prev, ''), true);
  return n;
end $$;

-- =====================================================================
-- Gatilhos
-- =====================================================================

create or replace function public.document_requirements_before()
returns trigger language plpgsql set search_path = '' as $$
declare
  t public.document_types;
begin
  select * into t from public.document_types where id = new.document_type_id;
  if not found then raise exception 'Tipo de documento inexistente'; end if;
  if tg_op = 'INSERT' then
    if not t.active then raise exception 'Tipo de documento inativo'; end if;
    if auth.uid() is not null then new.created_by := auth.uid(); new.created_at := now(); end if;
  else
    -- Cliente e tipo não mudam (para outro tipo, crie outra exigência)
    new.client_id := old.client_id; new.document_type_id := old.document_type_id;
    new.created_by := old.created_by; new.created_at := old.created_at;
  end if;
  new.department := t.department;
  if new.periodicity = 'mensal' then new.first_month := null; end if;
  return new;
end $$;
create trigger document_requirements_before before insert or update on public.document_requirements
  for each row execute function public.document_requirements_before();

/** Após criar/alterar uma exigência: anula pendências futuras que não batem mais e gera as novas. */
create or replace function public.document_requirements_after()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  today date := public.doc_today();
  prev text := current_setting('hagious.internal', true);
begin
  if tg_op = 'DELETE' then
    perform set_config('hagious.internal', '1', true);
    update public.client_documents set status = 'nao_exigivel', status_note = 'Exigência removida', auto_voided = true
     where requirement_id = old.id and status = 'pendente' and due_date >= today;
    perform set_config('hagious.internal', coalesce(prev, ''), true);
    return old;  -- gatilho BEFORE DELETE: devolver a linha para a exclusão prosseguir
  end if;
  if tg_op = 'UPDATE' then
    perform set_config('hagious.internal', '1', true);
    update public.client_documents d
       set status = 'nao_exigivel', status_note = 'Exigência alterada ou encerrada', auto_voided = true
     where d.requirement_id = new.id and d.status = 'pendente' and d.due_date >= today
       and (not new.active
            or d.due_date < new.starts_on
            or (new.ends_on is not null and d.due_date > new.ends_on)
            or not exists (select 1 from public.doc_due_dates(new.periodicity, new.due_day, new.first_month, d.due_date, d.due_date)));
    -- Responsável acompanha a exigência nas pendências em aberto
    update public.client_documents d set responsible_id = new.responsible_id
     where d.requirement_id = new.id and d.status = 'pendente' and d.responsible_id is distinct from new.responsible_id;
    perform set_config('hagious.internal', coalesce(prev, ''), true);
  end if;
  perform public.doc_generate(new.id);
  return null;
end $$;
create trigger document_requirements_after_ins after insert on public.document_requirements
  for each row execute function public.document_requirements_after();
create trigger document_requirements_after_upd after update on public.document_requirements
  for each row execute function public.document_requirements_after();
create trigger document_requirements_before_del before delete on public.document_requirements
  for each row execute function public.document_requirements_after();

create or replace function public.client_documents_before_insert()
returns trigger language plpgsql set search_path = '' as $$
declare
  r public.document_requirements;
  t public.document_types;
begin
  if new.requirement_id is not null then
    -- Pendência de uma exigência: cliente, tipo e departamento vêm da exigência
    select * into r from public.document_requirements where id = new.requirement_id;
    if not found then raise exception 'Exigência inexistente'; end if;
    new.client_id := r.client_id; new.document_type_id := r.document_type_id; new.department := r.department;
  end if;
  select * into t from public.document_types where id = new.document_type_id;
  if not found then raise exception 'Tipo de documento inexistente'; end if;
  if new.department is null then new.department := t.department; end if;
  if new.title is null or char_length(trim(new.title)) < 2 then new.title := t.name; end if;
  if auth.uid() is not null and not public.is_internal_op() then
    new.created_by := auth.uid(); new.created_at := now();
  end if;
  new.status := 'pendente'; new.received_at := null; new.received_by := null;
  new.status_note := null; new.auto_voided := false; new.overdue_notified_at := null;
  return new;
end $$;
create trigger client_documents_before_insert before insert on public.client_documents
  for each row execute function public.client_documents_before_insert();

create or replace function public.client_documents_before_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if public.is_internal_op() then return new; end if;
  -- Campos fixos e de controle
  new.client_id := old.client_id; new.requirement_id := old.requirement_id; new.document_type_id := old.document_type_id;
  new.created_by := old.created_by; new.created_at := old.created_at;
  new.overdue_notified_at := old.overdue_notified_at; new.auto_voided := old.auto_voided;
  new.received_at := old.received_at; new.received_by := old.received_by;
  new.department := old.department;

  if new.status is distinct from old.status then
    if new.status = 'recebido' then
      new.received_at := now(); new.received_by := auth.uid();
    else
      new.received_at := null; new.received_by := null;
    end if;
    new.auto_voided := false;
    if new.status = 'pendente' then new.status_note := null; end if;
  end if;

  if new.due_date is distinct from old.due_date then
    if new.status <> 'pendente' then raise exception 'Só é possível alterar o vencimento de documentos pendentes'; end if;
    new.overdue_notified_at := null;
  end if;
  return new;
end $$;
create trigger client_documents_before_update before update on public.client_documents
  for each row execute function public.client_documents_before_update();

/** Ao receber/dispensar ou mudar o vencimento: cancela os lembretes que ainda estavam na fila. */
create or replace function public.client_documents_after_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'pendente' and old.status = 'pendente' then
    update public.document_reminders
       set status = 'cancelado',
           last_error = case new.status when 'recebido' then 'Documento recebido' when 'dispensado' then 'Documento dispensado' else 'Deixou de ser exigível' end
     where document_id = new.id and status = 'na_fila';
  elsif new.due_date is distinct from old.due_date then
    update public.document_reminders set status = 'cancelado', last_error = 'Vencimento alterado'
     where document_id = new.id and status = 'na_fila' and due_date = old.due_date;
  end if;
  return null;
end $$;
create trigger client_documents_after_update after update on public.client_documents
  for each row execute function public.client_documents_after_update();

/** Cliente encerrado: pendências em aberto deixam de ser exigíveis (voltam se o cliente for reativado). */
create or replace function public.clients_documents_on_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  prev text := current_setting('hagious.internal', true);
begin
  if new.status = 'encerrado' and old.status <> 'encerrado' then
    perform set_config('hagious.internal', '1', true);
    update public.client_documents set status = 'nao_exigivel', status_note = 'Cliente encerrado', auto_voided = true
     where client_id = new.id and status = 'pendente';
    update public.document_reminders set status = 'cancelado', last_error = 'Cliente encerrado'
     where client_id = new.id and status = 'na_fila';
    perform set_config('hagious.internal', coalesce(prev, ''), true);
  end if;
  return null;
end $$;
create trigger clients_documents_on_status after update of status on public.clients
  for each row execute function public.clients_documents_on_status();

-- =====================================================================
-- Varredura automática (pg_cron, a cada hora)
-- =====================================================================
/**
 * 1. Gera as pendências dos próximos dias.
 * 2. Dentro do expediente: dispara o lembrete da etapa atual de cada pendência.
 *    Etapa atual = menor dia configurado que ainda cobre os dias restantes. Se a varredura falhar num dia,
 *    o lembrete daquela etapa sai na próxima execução (sem repetir e sem disparar etapas já superadas).
 * 3. Pendências vencidas: avisa responsável e gestão uma única vez (relatório crítico).
 * Clientes suspensos ou encerrados não recebem cobrança.
 */
create or replace function public.documents_sweep(p_now timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  s public.sla_settings;
  ds public.document_settings;
  local_ts timestamp;
  today date;
  d record;
  stage integer;
  owners uuid[];
  managers uuid[];
  rid bigint;
  contact_name text;
  when_text text;
  n_gen integer := 0;
  n_rem integer := 0;
  n_over integer := 0;
  prev text := current_setting('hagious.internal', true);
begin
  select * into s from public.sla_settings where id = 1;
  select * into ds from public.document_settings where id = 1;
  local_ts := v_now at time zone s.timezone;
  today := local_ts::date;

  n_gen := public.doc_generate(null, today);

  if local_ts::time < s.work_start or local_ts::time >= s.work_end then
    return jsonb_build_object('gerados', n_gen, 'lembretes', 0, 'vencidos', 0, 'fora_do_expediente', true);
  end if;

  perform set_config('hagious.internal', '1', true);
  select coalesce(array_agg(id), '{}') into managers from public.profiles where active and role in ('admin', 'gestor');

  -- Lembretes preventivos
  for d in
    select doc.*, c.legal_name as client_name
    from public.client_documents doc
    join public.clients c on c.id = doc.client_id and c.status = 'ativo'
    where doc.status = 'pendente' and doc.due_date >= today
      and doc.due_date - today <= (select max(x) from unnest(ds.reminder_days) x)
    for update of doc skip locked
  loop
    select min(x) into stage from unnest(ds.reminder_days) x where x >= d.due_date - today;
    continue when stage is null;
    when_text := case d.due_date - today when 0 then 'vence hoje' when 1 then 'vence amanhã' else 'vence em ' || (d.due_date - today) || ' dias' end
                 || ' (' || to_char(d.due_date, 'DD/MM/YYYY') || ')';

    -- Canal interno: aviso para quem deve cobrar o cliente
    rid := null;
    insert into public.document_reminders (document_id, client_id, days_before, due_date, channel, status)
    values (d.id, d.client_id, stage, d.due_date, 'interno', 'na_fila')
    on conflict do nothing returning id into rid;
    if rid is not null then
      select coalesce(array_agg(o), '{}') into owners from public.doc_owner_ids(d.client_id, d.department, d.responsible_id) as o;
      insert into public.notifications (user_id, document_id, kind, title, body, link, dedupe_key)
      select o, d.id, 'documento_lembrete', 'Cobrar documento: ' || d.title, d.client_name || ' · ' || when_text,
             '/documentos/' || d.id, 'docrem:' || d.id || ':' || d.due_date || ':' || stage
      from unnest(owners) as o
      on conflict (user_id, dedupe_key) do nothing;
      update public.document_reminders
         set status = case when cardinality(owners) > 0 then 'enviado'::public.reminder_status else 'sem_canal'::public.reminder_status end,
             attempts = 1,
             sent_at = case when cardinality(owners) > 0 then v_now end,
             recipient = (select string_agg(full_name, ', ' order by full_name) from public.profiles where id = any (owners)),
             last_error = case when cardinality(owners) = 0 then 'Nenhuma pessoa ativa no departamento' end
       where id = rid;
      n_rem := n_rem + 1;
    end if;

    -- Canal WhatsApp: entra na fila para o envio oficial (Etapa 4). Sem contato autorizado, fica registrado.
    contact_name := (select ct.name from public.client_contacts ct
                      where ct.client_id = d.client_id and ct.whatsapp is not null and ct.whatsapp_opt_in
                      order by ct.is_primary desc, ct.created_at limit 1);
    rid := null;
    insert into public.document_reminders (document_id, client_id, days_before, due_date, channel, status, recipient, last_error)
    values (d.id, d.client_id, stage, d.due_date, 'whatsapp',
            case when contact_name is not null then 'na_fila'::public.reminder_status else 'sem_canal'::public.reminder_status end,
            contact_name,
            case when contact_name is null then 'Cliente sem contato com WhatsApp autorizado' end)
    on conflict do nothing returning id into rid;
    if rid is not null then
      -- Só o lembrete mais recente vale: os anteriores que não saíram são substituídos
      update public.document_reminders set status = 'cancelado', last_error = 'Substituído por lembrete mais recente'
       where document_id = d.id and channel = 'whatsapp' and status = 'na_fila' and id <> rid;
    end if;
  end loop;

  -- Vencidos: relatório crítico + aviso único ao responsável e à gestão
  for d in
    select doc.*, c.legal_name as client_name
    from public.client_documents doc
    join public.clients c on c.id = doc.client_id and c.status = 'ativo'
    where doc.status = 'pendente' and doc.due_date < today and doc.overdue_notified_at is null
    for update of doc skip locked
  loop
    select coalesce(array_agg(o), '{}') into owners from public.doc_owner_ids(d.client_id, d.department, d.responsible_id) as o;
    insert into public.notifications (user_id, document_id, kind, title, body, link, dedupe_key)
    select o, d.id, 'documento_atrasado', 'Documento atrasado: ' || d.title,
           d.client_name || ' · venceu em ' || to_char(d.due_date, 'DD/MM/YYYY'), '/documentos/' || d.id,
           'docover:' || d.id || ':' || d.due_date
    from unnest(owners) as o
    on conflict (user_id, dedupe_key) do nothing;
    insert into public.notifications (user_id, document_id, kind, title, body, link, dedupe_key)
    select m, d.id, 'escalonamento', 'Pendência crítica: ' || d.title,
           d.client_name || ' · venceu em ' || to_char(d.due_date, 'DD/MM/YYYY') || ' e segue sem entrega', '/documentos/' || d.id,
           'docoverm:' || d.id || ':' || d.due_date
    from unnest(managers) as m
    where not (m = any (owners))
    on conflict (user_id, dedupe_key) do nothing;
    update public.client_documents set overdue_notified_at = v_now where id = d.id;
    n_over := n_over + 1;
  end loop;

  perform set_config('hagious.internal', coalesce(prev, ''), true);
  return jsonb_build_object('gerados', n_gen, 'lembretes', n_rem, 'vencidos', n_over);
end $$;

do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('hagious-documents-sweep', '5 * * * *', 'select public.documents_sweep()');
exception when others then
  raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;

-- =====================================================================
-- Permissões (RLS)
-- =====================================================================
alter table public.document_settings enable row level security;
alter table public.document_types enable row level security;
alter table public.document_requirements enable row level security;
alter table public.client_documents enable row level security;
alter table public.document_reminders enable row level security;

create policy doc_settings_select on public.document_settings for select to authenticated using (public.is_active_user());
create policy doc_settings_update on public.document_settings for update to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy doc_types_select on public.document_types for select to authenticated using (public.is_active_user());
create policy doc_types_write on public.document_types for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Exigências: quem vê o cliente consulta; gestão e o próprio departamento mantêm
create policy doc_req_select on public.document_requirements for select to authenticated
  using (public.can_view_client(client_id));
create policy doc_req_insert on public.document_requirements for insert to authenticated
  with check (public.can_view_client(client_id) and (public.is_manager() or department = public.current_department()));
create policy doc_req_update on public.document_requirements for update to authenticated
  using (public.can_view_client(client_id) and (public.is_manager() or department = public.current_department()))
  with check (public.can_view_client(client_id) and (public.is_manager() or department = public.current_department()));
create policy doc_req_delete on public.document_requirements for delete to authenticated
  using (public.can_view_client(client_id) and (public.is_manager() or department = public.current_department()));

-- Pendências: o atendimento também registra recebimento (documentos chegam pelo WhatsApp)
create policy docs_select on public.client_documents for select to authenticated
  using (public.can_view_client(client_id));
create policy docs_insert on public.client_documents for insert to authenticated
  with check (public.can_view_client(client_id)
              and (public.is_manager() or department = public.current_department() or public.current_department() = 'atendimento'));
create policy docs_update on public.client_documents for update to authenticated
  using (public.can_view_client(client_id)
         and (public.is_manager() or department = public.current_department()
              or public.current_department() = 'atendimento' or responsible_id = auth.uid()))
  with check (public.can_view_client(client_id));
create policy docs_delete on public.client_documents for delete to authenticated using (public.is_admin());

-- Registro de lembretes: somente leitura (escrito pela varredura)
create policy doc_rem_select on public.document_reminders for select to authenticated
  using (public.can_view_client(client_id));

-- ---------- Privilégios explícitos ----------
grant select, update on public.document_settings to authenticated;
grant select, insert, update, delete on public.document_types, public.document_requirements, public.client_documents to authenticated;
grant select on public.document_reminders to authenticated;
grant all on public.document_settings, public.document_types, public.document_requirements,
  public.client_documents, public.document_reminders to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke execute on function public.doc_owner_ids(uuid, public.department, uuid), public.doc_generate(uuid, date),
  public.documents_sweep(timestamptz) from anon, authenticated, public;
grant execute on function public.doc_generate(uuid, date), public.documents_sweep(timestamptz) to service_role;
revoke execute on function public.doc_today(), public.doc_due_dates(public.doc_periodicity, integer, integer, date, date) from anon, public;
grant execute on function public.doc_today(), public.doc_due_dates(public.doc_periodicity, integer, integer, date, date)
  to authenticated, service_role;

create trigger audit_document_types after insert or update or delete on public.document_types
  for each row execute function public.audit_trigger();
create trigger audit_document_requirements after insert or update or delete on public.document_requirements
  for each row execute function public.audit_trigger();
create trigger audit_client_documents after insert or update or delete on public.client_documents
  for each row execute function public.audit_trigger();

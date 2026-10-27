-- =====================================================================
-- Revisão geral (correções apontadas na revisão completa do sistema)
-- + base da classificação de e-mails (Cliente / Empresa / Pessoa / Separados)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Histórico de alterações: tabelas sem "id" (ex.: feriados) quebravam qualquer gravação
-- ---------------------------------------------------------------------
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  j jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.audit_log (table_name, record_id, action, actor_id, old_data, new_data)
  values (
    tg_table_name,
    coalesce(j->>'id', j->>'client_id', j->>'day', j->>'user_id', j->>'account_id', '?'),
    tg_op, auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 2. Pessoa desativada perde o acesso também aos clientes de que é responsável
-- ---------------------------------------------------------------------
create or replace function public.can_view_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and (
    public.is_manager()
    or public.current_department() = 'atendimento'
    or exists (select 1 from public.client_responsibles r where r.client_id = p_client_id and r.user_id = auth.uid())
    or exists (select 1 from public.client_services s where s.client_id = p_client_id and s.active and s.department = public.current_department())
  )
$$;

drop policy if exists docs_update on public.client_documents;
create policy docs_update on public.client_documents for update to authenticated
  using (public.is_active_user() and public.can_view_client(client_id)
         and (public.is_manager() or department = public.current_department()
              or public.current_department() = 'atendimento' or responsible_id = auth.uid()))
  with check (public.can_view_client(client_id));

-- ---------------------------------------------------------------------
-- 3. Exclusão de pessoas/exigências: os gatilhos de proteção desfaziam o "SET NULL" das chaves.
--    Gatilhos "zz_" rodam DEPOIS dos de proteção (ordem alfabética) e só zeram a referência
--    quando o registro apontado realmente deixou de existir.
-- ---------------------------------------------------------------------
create or replace function public.tickets_zz_rules()
returns trigger language plpgsql set search_path = '' as $$
declare
  d record;
begin
  if tg_op = 'UPDATE' then
    if old.created_by is not null and not exists (select 1 from public.profiles where id = old.created_by) then new.created_by := null; end if;
    if old.closed_by is not null and not exists (select 1 from public.profiles where id = old.closed_by) then new.closed_by := null; end if;
  end if;
  if public.is_internal_op() then return new; end if;

  -- Responsável precisa estar ativo (senão os alertas não chegam a ninguém)
  -- (OLD não existe no INSERT: o teste é feito em etapas)
  if new.assignee_id is not null and not exists (select 1 from public.profiles where id = new.assignee_id and active) then
    if tg_op = 'INSERT' then
      raise exception 'Responsável inválido ou inativo';
    elsif new.assignee_id is distinct from old.assignee_id then
      raise exception 'Responsável inválido ou inativo';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    -- Ticket encerrado: só a gestão altera (fora a própria reabertura)
    if old.status in ('concluido', 'cancelado') and new.status = old.status and not public.is_manager()
       and (new.title, new.description, new.priority, new.resolution_note, new.cancel_reason, new.category_id, new.assignee_id)
           is distinct from (old.title, old.description, old.priority, old.resolution_note, old.cancel_reason, old.category_id, old.assignee_id) then
      raise exception 'Ticket encerrado: somente a gestão pode alterar';
    end if;
    -- Reaberto: novo prazo a partir de agora e alertas liberados de novo
    if old.status in ('concluido', 'cancelado') and new.status not in ('concluido', 'cancelado') then
      select * into d from public.ticket_sla_dates(new.category_id, now());
      new.resolution_due_at := d.resolution_due;
      new.risk_at := d.risk;
      new.risk_notified_at := null;
      new.overdue_notified_at := null;
    end if;
  end if;
  return new;
end $$;
create trigger tickets_zz_rules before insert or update on public.tickets
  for each row execute function public.tickets_zz_rules();

create or replace function public.client_documents_zz_fk()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.created_by is not null and not exists (select 1 from public.profiles where id = old.created_by) then new.created_by := null; end if;
  if old.received_by is not null and not exists (select 1 from public.profiles where id = old.received_by) then new.received_by := null; end if;
  if old.requirement_id is not null and not exists (select 1 from public.document_requirements where id = old.requirement_id) then new.requirement_id := null; end if;
  return new;
end $$;
create trigger client_documents_zz_fk before update on public.client_documents
  for each row execute function public.client_documents_zz_fk();

create or replace function public.document_requirements_zz_fk()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.created_by is not null and not exists (select 1 from public.profiles where id = old.created_by) then new.created_by := null; end if;
  return new;
end $$;
create trigger document_requirements_zz_fk before update on public.document_requirements
  for each row execute function public.document_requirements_zz_fk();

-- Alertas: responsável inativo -> avisa o departamento
create or replace function public.notify_owner(t public.tickets, p_kind text, p_title text, p_body text, p_dedupe text, p_skip uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  if t.assignee_id is not null and exists (select 1 from public.profiles where id = t.assignee_id and active) then
    if t.assignee_id is distinct from p_skip then
      perform public.notify(t.assignee_id, t.id, p_kind, p_title, p_body, p_dedupe);
    end if;
  else
    for r in select id from public.profiles where active and department = t.department and id is distinct from p_skip loop
      perform public.notify(r.id, t.id, p_kind, p_title, p_body, p_dedupe);
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. Histórico de tickets não pode ser forjado; "resposta ao cliente" só por quem atende o ticket
-- ---------------------------------------------------------------------
create or replace function public.ticket_events_before_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Só o que a pessoa escreve (comentário/resposta); eventos do sistema mantêm seus detalhes
  if new.kind in ('comentario', 'resposta') and auth.uid() is not null and not public.is_internal_op() then
    new.created_at := now();
    new.data := null;
  end if;
  return new;
end $$;
create trigger ticket_events_before_insert before insert on public.ticket_events
  for each row execute function public.ticket_events_before_insert();

drop policy if exists events_insert on public.ticket_events;
create policy events_insert on public.ticket_events for insert to authenticated
  with check (kind in ('comentario', 'resposta') and actor_id = auth.uid() and public.can_view_ticket(ticket_id)
              and (kind = 'comentario' or public.can_edit_ticket(ticket_id)));

-- Restaura o modo interno anterior (antes zerava sempre)
create or replace function public.ticket_events_after_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t public.tickets;
  m uuid;
  label text;
  prev text := current_setting('hagious.internal', true);
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
    perform set_config('hagious.internal', coalesce(prev, ''), true);
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 5. "Mensagem salva no cliente": o conteúdo vem SEMPRE da mensagem real (não pode ser inventado)
-- ---------------------------------------------------------------------
create or replace function public.message_saves_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  m record;
begin
  if auth.uid() is null then return new; end if; -- chave de serviço (rotinas internas)
  if new.message_id is null then raise exception 'Informe a mensagem a salvar'; end if;
  select msg.direction, msg.subject, msg.body, msg.kind, msg.sent_at, c.kind as channel,
         case when msg.direction = 'entrada' then coalesce(c.contact_name, c.contact_address) else a.label end as sender
    into m
    from public.messages msg
    join public.conversations c on c.id = msg.conversation_id
    join public.channel_accounts a on a.id = msg.account_id
   where msg.id = new.message_id;
  if not found then raise exception 'Mensagem não encontrada'; end if;
  new.channel := m.channel;
  new.direction := m.direction;
  new.sender := left(m.sender, 200);
  new.subject := m.subject;
  new.body := coalesce(m.body, '[' || m.kind || ']');
  new.sent_at := m.sent_at;
  new.saved_by := auth.uid();
  new.created_at := now();
  return new;
end $$;
create trigger message_saves_before_insert before insert on public.message_saves
  for each row execute function public.message_saves_before_insert();

-- ---------------------------------------------------------------------
-- 6. Consentimento do WhatsApp: data registrada pelo banco (não pode ser retroativa)
-- ---------------------------------------------------------------------
create or replace function public.client_contacts_opt_in()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not new.whatsapp_opt_in or new.whatsapp is null then
    new.whatsapp_opt_in := false;
    new.whatsapp_opt_in_at := null;
  elsif tg_op = 'INSERT' or not old.whatsapp_opt_in or new.whatsapp is distinct from old.whatsapp then
    -- autorização nova (ou número novo): vale a partir de agora
    new.whatsapp_opt_in_at := now();
  else
    new.whatsapp_opt_in_at := old.whatsapp_opt_in_at;
  end if;
  return new;
end $$;
create trigger client_contacts_opt_in before insert or update on public.client_contacts
  for each row execute function public.client_contacts_opt_in();

-- Lembretes de WhatsApp na fila param se o cliente for suspenso ou o contato retirar a autorização
create or replace function public.clients_cancel_whatsapp_queue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'ativo' and old.status = 'ativo' then
    update public.document_reminders set status = 'cancelado', last_error = 'Cliente ' || new.status
     where client_id = new.id and channel = 'whatsapp' and status = 'na_fila';
  end if;
  return null;
end $$;
create or replace function public.contacts_cancel_whatsapp_queue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.whatsapp_opt_in and not new.whatsapp_opt_in then
    update public.document_reminders set status = 'cancelado', last_error = 'Contato retirou a autorização'
     where client_id = new.client_id and channel = 'whatsapp' and status = 'na_fila'
       and not exists (select 1 from public.client_contacts cc where cc.client_id = new.client_id and cc.id <> new.id and cc.whatsapp_opt_in);
  end if;
  return null;
end $$;
create trigger clients_cancel_whatsapp_queue after update of status on public.clients
  for each row execute function public.clients_cancel_whatsapp_queue();
create trigger contacts_cancel_whatsapp_queue after update of whatsapp_opt_in on public.client_contacts
  for each row execute function public.contacts_cancel_whatsapp_queue();

-- ---------------------------------------------------------------------
-- 7. Conversas: contato precisa ser do cliente ligado; troca de cliente vai para o histórico
-- ---------------------------------------------------------------------
create or replace function public.conversations_check_contact()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.contact_id is not null and (new.client_id is null
     or not exists (select 1 from public.client_contacts where id = new.contact_id and client_id = new.client_id)) then
    new.contact_id := null;
  end if;
  return new;
end $$;
create trigger conversations_check_contact before insert or update of client_id, contact_id on public.conversations
  for each row execute function public.conversations_check_contact();
create trigger audit_conversations_client after update of client_id on public.conversations
  for each row when (old.client_id is distinct from new.client_id) execute function public.audit_trigger();

-- Situação "falhou" atrasada não apaga "entregue/lida"
create or replace function public.channel_message_status(p_account uuid, p_external_id text, p_status public.message_status, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  rank_new int := case p_status when 'enviando' then 0 when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 9 end;
begin
  update public.messages m set status = p_status, error = coalesce(left(p_error, 1000), m.error)
   where m.account_id = p_account and m.external_id = p_external_id and m.direction = 'saida'
     and (case when p_status = 'falhou' then m.status in ('enviando', 'enviada')
               else rank_new > case m.status when 'enviando' then 0 when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 9 end end);
  return found;
end $$;

-- ---------------------------------------------------------------------
-- 8. Telefones: números estrangeiros não colidem com brasileiros
-- ---------------------------------------------------------------------
create or replace function public.phone_key(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d is null then null
    when length(d) >= 12 and left(d, 2) = '55' then substr(d, 3, 2) || right(d, 8)   -- +55 DDD ...
    when length(d) in (10, 11) then left(d, 2) || right(d, 8)                        -- DDD ... (sem país)
    else d                                                                            -- outro país: número inteiro
  end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) x
$$;

/** Mesma chave, para o número que o WhatsApp envia (sempre com código do país): só +55 é tratado como brasileiro. */
create or replace function public.wa_key(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d is null then null
    when length(d) >= 12 and left(d, 2) = '55' then substr(d, 3, 2) || right(d, 8)
    else d
  end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) x
$$;
grant execute on function public.wa_key(text) to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 9. Classificação de e-mails: Cliente / Empresa / Pessoa / Separados (promoções e avisos)
-- ---------------------------------------------------------------------
alter table public.conversations add column category text check (category is null or category in ('cliente', 'empresa', 'pessoa', 'separado'));
create index conversations_category_idx on public.conversations (kind, category);

-- Correções feitas pela equipe ("Não é promoção", "Mover para Separados"): valem para os próximos e-mails
create table public.email_sender_rules (
  pattern text primary key check (pattern ~ '^(@[a-z0-9.-]+\.[a-z]{2,}|[^@\s]+@[a-z0-9.-]+\.[a-z]{2,})$'),
  category text not null check (category in ('cliente', 'empresa', 'pessoa', 'separado')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.email_sender_rules enable row level security;
create policy sender_rules_select on public.email_sender_rules for select to authenticated using (public.is_active_user());
create policy sender_rules_write on public.email_sender_rules for all to authenticated
  using (public.is_manager() or public.current_department() = 'atendimento')
  with check ((public.is_manager() or public.current_department() = 'atendimento') and created_by = auth.uid());
grant select, insert, update, delete on public.email_sender_rules to authenticated;
grant all on public.email_sender_rules to service_role;
grant update (category) on public.conversations to authenticated;

/** Provedores de e-mail pessoal (o domínio não identifica uma empresa). */
create or replace function public.is_personal_email_domain(p_domain text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(coalesce(p_domain, '')) = any (array[
    'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.com.br', 'outlook.com', 'outlook.com.br', 'live.com', 'msn.com',
    'yahoo.com', 'yahoo.com.br', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'uol.com.br', 'bol.com.br', 'terra.com.br',
    'ig.com.br', 'globo.com', 'globomail.com', 'r7.com', 'zipmail.com.br', 'protonmail.com', 'proton.me', 'aol.com', 'gmx.com', 'zoho.com'])
$$;

/** Categoria de um remetente de e-mail: regra da equipe > cliente > sinais de envio em massa > pessoa/empresa. */
create or replace function public.email_category(p_address text, p_client uuid, p_bulk boolean)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select category from public.email_sender_rules where pattern = lower(p_address)),
    (select category from public.email_sender_rules where pattern = '@' || split_part(lower(p_address), '@', 2)),
    case when p_client is not null then 'cliente' end,
    case when coalesce(p_bulk, false) then 'separado' end,
    case when public.is_personal_email_domain(split_part(p_address, '@', 2)) then 'pessoa' else 'empresa' end
  )
$$;

-- ---------------------------------------------------------------------
-- 10. Registro de mensagens: janela de 24h com data nula, vínculo só com cliente ÚNICO,
--     vínculo de e-mail pelo domínio da empresa cliente e classificação do e-mail.
-- ---------------------------------------------------------------------
create or replace function public.channel_ingest(
  p_account uuid,
  p_direction public.message_direction,
  p_external_id text,
  p_contact_address text,
  p_contact_name text,
  p_kind text,
  p_subject text,
  p_body text,
  p_media jsonb,
  p_status public.message_status,
  p_via text,
  p_sent_at timestamptz,
  p_sent_by uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.channel_accounts;
  conv public.conversations;
  mid uuid;
  addr text;
  dom text;
  at_ timestamptz := coalesce(p_sent_at, now());
  preview text;
  found_client uuid;
  found_contact uuid;
  n_clients int;
  bulk boolean := coalesce((p_media->'signals'->>'bulk')::boolean, false);
begin
  select * into a from public.channel_accounts where id = p_account;
  if not found then raise exception 'Canal inexistente'; end if;
  addr := case when a.kind = 'whatsapp' then regexp_replace(coalesce(p_contact_address, ''), '\D', '', 'g')
               else lower(trim(coalesce(p_contact_address, ''))) end;
  if char_length(addr) < 3 or char_length(addr) > 200 then raise exception 'Contato inválido'; end if;

  insert into public.conversations (account_id, kind, contact_address, contact_name, is_demo)
  values (a.id, a.kind, addr, left(nullif(trim(coalesce(p_contact_name, '')), ''), 200), a.is_demo)
  on conflict (account_id, contact_address)
    do update set contact_name = coalesce(public.conversations.contact_name, excluded.contact_name)
  returning * into conv;

  insert into public.messages (conversation_id, account_id, direction, external_id, kind, subject, body, media, status, via, sent_at, sent_by)
  values (conv.id, a.id, p_direction, left(nullif(p_external_id, ''), 500), coalesce(p_kind, 'text'), left(p_subject, 500), left(p_body, 100000),
          p_media, p_status, p_via, at_, p_sent_by)
  on conflict (account_id, external_id) do nothing
  returning id into mid;
  if mid is null then return null; end if;

  preview := left(regexp_replace(coalesce(
    case when p_kind = 'email' then nullif(concat_ws(' — ', nullif(p_subject, ''), nullif(left(p_body, 200), '')), '') else nullif(p_body, '') end,
    '[' || coalesce(p_kind, 'mensagem') || ']'), '\s+', ' ', 'g'), 300);

  update public.conversations set
    last_preview = case when last_message_at is null or at_ >= last_message_at then preview else last_preview end,
    last_message_at = greatest(coalesce(last_message_at, at_), at_),
    last_inbound_at = case when p_direction = 'entrada' then greatest(coalesce(last_inbound_at, at_), at_) else last_inbound_at end,
    unread_count = unread_count + case when p_direction = 'entrada' and coalesce(p_via, '') <> 'historico' then 1 else 0 end,
    archived = case when p_direction = 'entrada' and coalesce(p_via, '') <> 'historico' then false else archived end
  where id = conv.id
  returning * into conv;

  -- Vínculo automático com o cliente: só quando há UM cliente possível (sócio de várias empresas fica para triagem)
  if conv.client_id is null then
    if a.kind = 'whatsapp' then
      select count(distinct cc.client_id), min(cc.client_id::text)::uuid into n_clients, found_client
        from public.client_contacts cc
       where cc.whatsapp is not null and public.phone_key(cc.whatsapp) = public.wa_key(addr);
    else
      select count(distinct x.client_id), min(x.client_id::text)::uuid into n_clients, found_client from (
        select cc.client_id from public.client_contacts cc where lower(cc.email) = addr
        union select c.id from public.clients c where lower(c.email) = addr
      ) x;
      -- Mesmo domínio da empresa cliente (ex.: @padariasilva.com.br), exceto provedores pessoais
      dom := split_part(addr, '@', 2);
      if coalesce(n_clients, 0) = 0 and dom <> '' and not public.is_personal_email_domain(dom) then
        select count(distinct x.client_id), min(x.client_id::text)::uuid into n_clients, found_client from (
          select cc.client_id from public.client_contacts cc where split_part(lower(cc.email), '@', 2) = dom
          union select c.id from public.clients c where split_part(lower(c.email), '@', 2) = dom
        ) x;
      end if;
    end if;
    if n_clients = 1 then
      if a.kind = 'whatsapp' then
        select cc.id into found_contact from public.client_contacts cc
         where cc.client_id = found_client and public.phone_key(cc.whatsapp) = public.wa_key(addr)
         order by cc.is_primary desc, cc.created_at limit 1;
      else
        select cc.id into found_contact from public.client_contacts cc where cc.client_id = found_client and lower(cc.email) = addr limit 1;
      end if;
      update public.conversations set client_id = found_client, contact_id = found_contact where id = conv.id returning * into conv;
    end if;
  end if;

  -- Classificação do e-mail (recebidos; respostas nossas não mudam a categoria)
  if a.kind = 'email' and (p_direction = 'entrada' or conv.category is null) then
    update public.conversations
       set category = case
             when p_direction = 'saida' then public.email_category(addr, conv.client_id, false)
             -- um remetente que já foi "importante" não vira promoção por um e-mail automático
             when conv.category in ('cliente', 'empresa', 'pessoa') and bulk
                  and not exists (select 1 from public.email_sender_rules r where r.pattern in (addr, '@' || split_part(addr, '@', 2)))
               then conv.category
             else public.email_category(addr, conv.client_id, bulk)
           end
     where id = conv.id;
  end if;
  return mid;
end $$;

-- ---------------------------------------------------------------------
-- 11. Expediente: fuso horário inválido quebraria todos os prazos
-- ---------------------------------------------------------------------
create or replace function public.sla_settings_check_tz()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Fuso horário inválido: %', new.timezone;
  end if;
  return new;
end $$;
create trigger sla_settings_check_tz before insert or update of timezone on public.sla_settings
  for each row execute function public.sla_settings_check_tz();

-- Feriados nacionais de 2028 (Páscoa em 16/04/2028)
insert into public.holidays (day, name) values
  ('2028-01-01', 'Confraternização Universal'), ('2028-04-14', 'Sexta-feira Santa'),
  ('2028-04-21', 'Tiradentes'), ('2028-05-01', 'Dia do Trabalho'),
  ('2028-09-07', 'Independência do Brasil'), ('2028-10-12', 'Nossa Senhora Aparecida'),
  ('2028-11-02', 'Finados'), ('2028-11-15', 'Proclamação da República'),
  ('2028-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'), ('2028-12-25', 'Natal')
on conflict (day) do nothing;

-- ---------------------------------------------------------------------
-- 12. CNPJ alfanumérico (Receita Federal, a partir de julho/2026): letras nas 12 primeiras posições
-- ---------------------------------------------------------------------
create or replace function public.is_valid_cnpj(cnpj text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  v int[];
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; i int;
begin
  if cnpj is null or cnpj !~ '^[0-9A-Z]{12}[0-9]{2}$' then return false; end if;
  if cnpj ~ '^(.)\1{13}$' then return false; end if;
  -- valor de cada caractere = código ASCII - 48 (dígitos 0-9; letras A=17, B=18, ...)
  v := array(select ascii(substr(cnpj, g, 1)) - 48 from generate_series(1, 14) g);
  s := 0; for i in 1..12 loop s := s + v[i] * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> v[13] then return false; end if;
  s := 0; for i in 1..13 loop s := s + v[i] * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = v[14];
end $$;

-- ---------------------------------------------------------------------
-- 13. Índices para quando houver milhares de registros
-- ---------------------------------------------------------------------
create index if not exists notifications_ticket_idx on public.notifications (ticket_id);
create index if not exists notifications_document_idx on public.notifications (document_id);
create index if not exists client_contacts_phone_key_idx on public.client_contacts (public.phone_key(whatsapp));
create index if not exists client_contacts_email_idx on public.client_contacts (lower(email));
create index if not exists clients_email_idx on public.clients (lower(email));
create index if not exists conversations_contact_idx on public.conversations (contact_id);
create index if not exists document_reminders_client_idx on public.document_reminders (client_id);
create index if not exists ticket_events_actor_idx on public.ticket_events (actor_id);

-- Funções novas: só para quem precisa
revoke execute on function public.email_category(text, uuid, boolean), public.message_saves_before_insert(),
  public.clients_cancel_whatsapp_queue(), public.contacts_cancel_whatsapp_queue() from anon, authenticated, public;
grant execute on function public.email_category(text, uuid, boolean) to service_role;
grant execute on function public.is_personal_email_domain(text) to authenticated, service_role;
revoke execute on function public.is_personal_email_domain(text) from anon, public;

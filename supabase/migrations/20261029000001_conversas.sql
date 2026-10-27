-- =====================================================================
-- Etapa 4: central de Conversas (WhatsApp oficial e e-mail)
--
-- Canais conectados -> conversas (uma por contato externo) -> mensagens.
-- Mensagens podem ser salvas no cliente (cópia permanente), virar ticket ou confirmar documento.
-- Segredos (token da Meta, senha do e-mail) ficam criptografados numa tabela sem acesso para usuários.
-- =====================================================================

create type public.channel_kind as enum ('whatsapp', 'email');
create type public.channel_status as enum ('pendente', 'conectado', 'erro', 'desconectado');
create type public.message_direction as enum ('entrada', 'saida');
create type public.message_status as enum ('recebida', 'enviando', 'enviada', 'entregue', 'lida', 'falhou');

-- ---------- Canais conectados ----------
create table public.channel_accounts (
  id uuid primary key default gen_random_uuid(),
  kind public.channel_kind not null,
  label text not null check (char_length(trim(label)) between 2 and 120),
  -- Número exibido (só dígitos) ou endereço de e-mail
  address text check (address is null or char_length(address) <= 200),
  status public.channel_status not null default 'pendente',
  -- Dados NÃO secretos (ids da Meta, servidores IMAP/SMTP, andamento da sincronização)
  config jsonb not null default '{}',
  last_sync_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 1000),
  is_demo boolean not null default false,
  connected_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index channel_accounts_address_uq on public.channel_accounts (kind, lower(address)) where address is not null;
create trigger channel_accounts_updated_at before update on public.channel_accounts
  for each row execute function public.set_updated_at();

-- Segredos criptografados (AES-256-GCM no servidor). Nenhuma política: só a chave de serviço acessa.
create table public.channel_secrets (
  account_id uuid primary key references public.channel_accounts(id) on delete cascade,
  ciphertext text not null,
  updated_at timestamptz not null default now()
);

-- ---------- Conversas ----------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.channel_accounts(id) on delete cascade,
  kind public.channel_kind not null,
  -- WhatsApp: número só com dígitos (wa_id). E-mail: endereço em minúsculas.
  contact_address text not null check (char_length(contact_address) between 3 and 200),
  contact_name text check (contact_name is null or char_length(contact_name) <= 200),
  client_id uuid references public.clients(id) on delete set null,
  contact_id uuid references public.client_contacts(id) on delete set null,
  last_message_at timestamptz,
  last_preview text check (last_preview is null or char_length(last_preview) <= 300),
  -- Última mensagem RECEBIDA do contato (janela de 24h do WhatsApp)
  last_inbound_at timestamptz,
  unread_count integer not null default 0 check (unread_count >= 0),
  archived boolean not null default false,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, contact_address)
);
create index conversations_list_idx on public.conversations (archived, last_message_at desc);
create index conversations_client_idx on public.conversations (client_id);
create trigger conversations_updated_at before update on public.conversations
  for each row execute function public.set_updated_at();

-- ---------- Mensagens ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  account_id uuid not null references public.channel_accounts(id) on delete cascade,
  direction public.message_direction not null,
  -- Id no canal (wamid do WhatsApp / Message-ID do e-mail): impede duplicar quando o aviso chega de novo
  external_id text check (external_id is null or char_length(external_id) <= 500),
  kind text not null default 'text' check (kind in ('text', 'image', 'document', 'audio', 'video', 'sticker', 'location', 'contacts', 'email', 'other')),
  subject text check (subject is null or char_length(subject) <= 500),
  body text check (body is null or char_length(body) <= 100000),
  media jsonb,
  status public.message_status not null,
  error text check (error is null or char_length(error) <= 1000),
  sent_by uuid references public.profiles(id) on delete set null,
  -- Por onde saiu: 'crm' (pelo sistema), 'app' (pelo celular, WhatsApp Business), 'historico' (importada)
  via text check (via is null or via in ('crm', 'app', 'historico', 'email')),
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- (nulos não colidem entre si)
  constraint messages_external_uq unique (account_id, external_id)
);
create index messages_thread_idx on public.messages (conversation_id, sent_at);

-- ---------- Mensagens salvas no cliente (cópia permanente) ----------
create table public.message_saves (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.messages(id) on delete set null,
  client_id uuid not null references public.clients(id) on delete cascade,
  channel public.channel_kind not null,
  direction public.message_direction not null,
  sender text check (sender is null or char_length(sender) <= 200),
  subject text check (subject is null or char_length(subject) <= 500),
  body text check (body is null or char_length(body) <= 100000),
  sent_at timestamptz not null,
  note text check (note is null or char_length(note) <= 1000),
  saved_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (message_id, client_id)
);
create index message_saves_client_idx on public.message_saves (client_id, sent_at desc);

-- ---------- Avisos recebidos dos canais (guardados antes de processar; permite reprocessar) ----------
create table public.webhook_events (
  id bigint generated always as identity primary key,
  source text not null check (source in ('whatsapp', 'email')),
  payload jsonb not null,
  signature_ok boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts integer not null default 0,
  error text check (error is null or char_length(error) <= 2000)
);
create index webhook_events_pending_idx on public.webhook_events (received_at) where processed_at is null;

-- =====================================================================
-- Registro de mensagens (usado pelo webhook, pela sincronização de e-mail e pelo envio)
-- =====================================================================

/** Chave para comparar celulares brasileiros: DDD + 8 últimos dígitos (o WhatsApp às vezes omite o 9º dígito). */
create or replace function public.phone_key(p text)
returns text language sql immutable set search_path = '' as $$
  select case
    when d is null or length(d) < 10 then d
    else substr(case when length(d) >= 12 and left(d, 2) = '55' then substr(d, 3) else d end, 1, 2) || right(d, 8)
  end
  from (select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '') as d) x
$$;

/**
 * Registra uma mensagem de forma idempotente: cria/atualiza a conversa, ignora duplicatas (mesmo id no canal),
 * atualiza não lidas e prévia, e liga a conversa ao cliente quando o número/e-mail é de um contato cadastrado.
 * Retorna o id da mensagem, ou nulo se ela já existia.
 */
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
  preview text;
  found_client uuid;
  found_contact uuid;
begin
  select * into a from public.channel_accounts where id = p_account;
  if not found then raise exception 'Canal inexistente'; end if;
  addr := case when a.kind = 'whatsapp' then regexp_replace(coalesce(p_contact_address, ''), '\D', '', 'g')
               else lower(trim(coalesce(p_contact_address, ''))) end;
  if char_length(addr) < 3 then raise exception 'Contato inválido'; end if;

  insert into public.conversations (account_id, kind, contact_address, contact_name, is_demo)
  values (a.id, a.kind, addr, nullif(trim(coalesce(p_contact_name, '')), ''), a.is_demo)
  on conflict (account_id, contact_address)
    do update set contact_name = coalesce(public.conversations.contact_name, excluded.contact_name)
  returning * into conv;

  insert into public.messages (conversation_id, account_id, direction, external_id, kind, subject, body, media, status, via, sent_at, sent_by)
  values (conv.id, a.id, p_direction, nullif(p_external_id, ''), coalesce(p_kind, 'text'), p_subject, p_body, p_media, p_status, p_via,
          coalesce(p_sent_at, now()), p_sent_by)
  on conflict (account_id, external_id) do nothing
  returning id into mid;
  if mid is null then return null; end if;

  preview := left(regexp_replace(coalesce(
    case when p_kind = 'email' then nullif(concat_ws(' — ', nullif(p_subject, ''), nullif(left(p_body, 200), '')), '') else nullif(p_body, '') end,
    '[' || coalesce(p_kind, 'mensagem') || ']'), '\s+', ' ', 'g'), 300);

  update public.conversations set
    last_preview = case when last_message_at is null or coalesce(p_sent_at, now()) >= last_message_at then preview else last_preview end,
    last_message_at = greatest(coalesce(last_message_at, coalesce(p_sent_at, now())), coalesce(p_sent_at, now())),
    last_inbound_at = case when p_direction = 'entrada' then greatest(coalesce(last_inbound_at, p_sent_at), p_sent_at) else last_inbound_at end,
    unread_count = unread_count + case when p_direction = 'entrada' and coalesce(p_via, '') <> 'historico' then 1 else 0 end,
    archived = case when p_direction = 'entrada' and coalesce(p_via, '') <> 'historico' then false else archived end
  where id = conv.id;

  -- Vínculo automático com o cliente (só quando ainda não há vínculo)
  if conv.client_id is null then
    if a.kind = 'whatsapp' then
      select cc.client_id, cc.id into found_client, found_contact from public.client_contacts cc
       where cc.whatsapp is not null and public.phone_key(cc.whatsapp) = public.phone_key(addr)
       order by cc.is_primary desc, cc.created_at limit 1;
    else
      select cc.client_id, cc.id into found_client, found_contact from public.client_contacts cc
       where lower(cc.email) = addr order by cc.is_primary desc, cc.created_at limit 1;
      if found_client is null then
        select c.id into found_client from public.clients c where lower(c.email) = addr limit 1;
      end if;
    end if;
    if found_client is not null then
      update public.conversations set client_id = found_client, contact_id = found_contact where id = conv.id;
    end if;
  end if;
  return mid;
end $$;

/** Atualiza a situação de uma mensagem enviada (enviada -> entregue -> lida); nunca volta atrás. */
create or replace function public.channel_message_status(p_account uuid, p_external_id text, p_status public.message_status, p_error text default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  rank_new int := case p_status when 'enviando' then 0 when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else 9 end;
begin
  update public.messages m set status = p_status, error = coalesce(left(p_error, 1000), m.error)
   where m.account_id = p_account and m.external_id = p_external_id and m.direction = 'saida'
     and (p_status = 'falhou' or rank_new > case m.status when 'enviando' then 0 when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 else -1 end);
  return found;
end $$;

-- =====================================================================
-- Permissões (RLS)
-- =====================================================================

/** Quem vê uma conversa: gestão, atendimento e quem atende o cliente ligado a ela. */
create or replace function public.can_view_conversation(p_client uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_user() and (
    public.is_manager()
    or public.current_department() = 'atendimento'
    or (p_client is not null and public.can_view_client(p_client))
  )
$$;

alter table public.channel_accounts enable row level security;
alter table public.channel_secrets enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_saves enable row level security;
alter table public.webhook_events enable row level security;

create policy channels_select on public.channel_accounts for select to authenticated using (public.is_active_user());

create policy conv_select on public.conversations for select to authenticated
  using (public.can_view_conversation(client_id));
create policy conv_update on public.conversations for update to authenticated
  using (public.can_view_conversation(client_id))
  with check (public.can_view_conversation(client_id) or public.can_view_conversation(null));

create policy msg_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversations c where c.id = conversation_id and public.can_view_conversation(c.client_id)));

create policy saves_select on public.message_saves for select to authenticated using (public.can_view_client(client_id));
create policy saves_insert on public.message_saves for insert to authenticated
  with check (public.can_view_client(client_id) and saved_by = auth.uid()
              and (message_id is null or exists (
                select 1 from public.messages m join public.conversations c on c.id = m.conversation_id
                where m.id = message_id and public.can_view_conversation(c.client_id))));
create policy saves_delete on public.message_saves for delete to authenticated
  using (saved_by = auth.uid() or public.is_manager());

create policy webhooks_select on public.webhook_events for select to authenticated using (public.is_admin());

-- ---------- Privilégios explícitos ----------
grant select on public.channel_accounts to authenticated;
grant select on public.conversations to authenticated;
-- Usuários só mudam o vínculo com o cliente, o "não lido" e o arquivamento
grant update (client_id, contact_id, unread_count, archived) on public.conversations to authenticated;
grant select on public.messages to authenticated;
grant select, insert, delete on public.message_saves to authenticated;
grant select on public.webhook_events to authenticated;
grant all on public.channel_accounts, public.channel_secrets, public.conversations, public.messages,
  public.message_saves, public.webhook_events to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on public.channel_secrets from anon, authenticated;

revoke execute on function public.channel_ingest(uuid, public.message_direction, text, text, text, text, text, text, jsonb, public.message_status, text, timestamptz, uuid),
  public.channel_message_status(uuid, text, public.message_status, text) from anon, authenticated, public;
grant execute on function public.channel_ingest(uuid, public.message_direction, text, text, text, text, text, text, jsonb, public.message_status, text, timestamptz, uuid),
  public.channel_message_status(uuid, text, public.message_status, text) to service_role;
grant execute on function public.phone_key(text) to authenticated, service_role;
revoke execute on function public.can_view_conversation(uuid) from anon, public;
grant execute on function public.can_view_conversation(uuid) to authenticated, service_role;

create trigger audit_channel_accounts after insert or update or delete on public.channel_accounts
  for each row execute function public.audit_trigger();
create trigger audit_message_saves after insert or update or delete on public.message_saves
  for each row execute function public.audit_trigger();

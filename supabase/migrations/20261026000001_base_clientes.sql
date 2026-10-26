-- =====================================================================
-- CRM Hagious — Etapa 1/2: base de usuários, permissões, clientes e auditoria
-- =====================================================================
-- Modelo de acesso (menor privilégio):
--   admin       -> tudo, inclusive equipe e configurações
--   gestor      -> todos os dados operacionais e relatórios
--   colaborador -> apenas clientes do seu departamento ou sob sua responsabilidade
--                  (departamento "atendimento" enxerga todos os clientes para atender o WhatsApp)
-- Toda regra é aplicada no banco (RLS), não só na interface.
-- =====================================================================

create extension if not exists pg_trgm with schema extensions;

-- ---------- Tipos ----------
create type public.user_role as enum ('admin', 'gestor', 'colaborador');
create type public.department as enum ('contabil', 'fiscal', 'dp', 'atendimento');
create type public.client_status as enum ('ativo', 'suspenso', 'encerrado');
create type public.tax_regime as enum ('mei', 'simples_nacional', 'lucro_presumido', 'lucro_real', 'outro');

-- ---------- Funções utilitárias ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Validação oficial de dígitos verificadores do CNPJ (somente números, 14 dígitos)
create or replace function public.is_valid_cnpj(cnpj text)
returns boolean language plpgsql immutable as $$
declare
  d int[];
  w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
  s int; r int; i int;
begin
  if cnpj is null or cnpj !~ '^[0-9]{14}$' then return false; end if;
  if cnpj ~ '^(.)\1{13}$' then return false; end if;
  d := array(select substr(cnpj, g, 1)::int from generate_series(1, 14) g);
  s := 0; for i in 1..12 loop s := s + d[i] * w1[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> d[13] then return false; end if;
  s := 0; for i in 1..13 loop s := s + d[i] * w2[i]; end loop;
  r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = d[14];
end $$;

-- ---------- Perfis da equipe ----------
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  email text not null,
  role public.user_role not null default 'colaborador',
  department public.department,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- colaboradores precisam de departamento para que as regras de acesso funcionem
  constraint colaborador_tem_departamento check (role <> 'colaborador' or department is not null)
);
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- Funções de apoio às políticas. SECURITY DEFINER evita recursão de RLS em profiles.
create or replace function public.current_role_name()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.current_department()
returns public.department language sql stable security definer set search_path = '' as $$
  select p.department from public.profiles p where p.id = auth.uid() and p.active
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_name() = 'admin', false)
$$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(public.current_role_name() in ('admin', 'gestor'), false)
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.current_role_name() is not null
$$;

-- ---------- Clientes ----------
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null check (char_length(trim(legal_name)) between 2 and 200),
  trade_name text check (trade_name is null or char_length(trade_name) <= 200),
  cnpj text not null unique check (public.is_valid_cnpj(cnpj)),
  tax_regime public.tax_regime not null default 'simples_nacional',
  status public.client_status not null default 'ativo',
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone text check (phone is null or phone ~ '^\+?[0-9]{10,15}$'),
  address text check (address is null or char_length(address) <= 400),
  notes text check (notes is null or char_length(notes) <= 4000),
  client_since date,
  -- marca registros fictícios criados para teste/demonstração
  is_demo boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger clients_updated_at before update on public.clients
  for each row execute function public.set_updated_at();
create index clients_legal_name_trgm on public.clients using gin (legal_name extensions.gin_trgm_ops);
create index clients_trade_name_trgm on public.clients using gin (trade_name extensions.gin_trgm_ops);
create index clients_status_idx on public.clients (status);

-- Contatos do cliente (pessoas físicas -> dados pessoais sob a LGPD)
create table public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 120),
  job_title text check (job_title is null or char_length(job_title) <= 120),
  email text check (email is null or email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  -- WhatsApp em formato internacional, só dígitos (ex.: 5511999998888)
  whatsapp text check (whatsapp is null or whatsapp ~ '^[1-9][0-9]{9,14}$'),
  is_primary boolean not null default false,
  -- Consentimento para receber mensagens pelo WhatsApp (exigido pela política da Meta)
  whatsapp_opt_in boolean not null default false,
  whatsapp_opt_in_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint opt_in_requer_data check (not whatsapp_opt_in or whatsapp_opt_in_at is not null)
);
create trigger client_contacts_updated_at before update on public.client_contacts
  for each row execute function public.set_updated_at();
create index client_contacts_client_idx on public.client_contacts (client_id);
create index client_contacts_whatsapp_idx on public.client_contacts (whatsapp);
create unique index client_contacts_one_primary on public.client_contacts (client_id) where is_primary;

-- Serviços contratados (definem quais departamentos atuam no cliente)
create table public.client_services (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  department public.department not null check (department <> 'atendimento'),
  description text not null check (char_length(trim(description)) between 2 and 200),
  started_on date,
  ended_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint periodo_valido check (ended_on is null or started_on is null or ended_on >= started_on)
);
create trigger client_services_updated_at before update on public.client_services
  for each row execute function public.set_updated_at();
create index client_services_client_idx on public.client_services (client_id);

-- Responsável interno por departamento (um por departamento)
create table public.client_responsibles (
  client_id uuid not null references public.clients(id) on delete cascade,
  department public.department not null,
  user_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (client_id, department)
);
create index client_responsibles_user_idx on public.client_responsibles (user_id);

-- Quem pode ver um cliente
create or replace function public.can_view_client(p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_manager()
    or (public.is_active_user() and public.current_department() = 'atendimento')
    or exists (select 1 from public.client_responsibles r
               where r.client_id = p_client_id and r.user_id = auth.uid())
    or exists (select 1 from public.client_services s
               where s.client_id = p_client_id and s.active
                 and s.department = public.current_department())
$$;

-- ---------- Auditoria ----------
create table public.audit_log (
  id bigint generated always as identity primary key,
  table_name text not null,
  record_id text not null,
  action text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  actor_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_record_idx on public.audit_log (table_name, record_id, created_at desc);

create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  rid text;
begin
  if tg_op = 'DELETE' then
    rid := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'client_id');
  else
    rid := coalesce(to_jsonb(new)->>'id', to_jsonb(new)->>'client_id');
  end if;
  insert into public.audit_log (table_name, record_id, action, actor_id, old_data, new_data)
  values (
    tg_table_name, rid, tg_op, auth.uid(),
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );
  return null;
end $$;

create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_trigger();
create trigger audit_clients after insert or update or delete on public.clients
  for each row execute function public.audit_trigger();
create trigger audit_client_contacts after insert or update or delete on public.client_contacts
  for each row execute function public.audit_trigger();
create trigger audit_client_services after insert or update or delete on public.client_services
  for each row execute function public.audit_trigger();
create trigger audit_client_responsibles after insert or update or delete on public.client_responsibles
  for each row execute function public.audit_trigger();

-- ---------- Row Level Security ----------
alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.client_contacts enable row level security;
alter table public.client_services enable row level security;
alter table public.client_responsibles enable row level security;
alter table public.audit_log enable row level security;

-- Perfis: qualquer usuário ativo vê a equipe (necessário para atribuir responsáveis);
-- apenas admin altera. Criação de contas acontece no servidor com a chave de serviço.
create policy profiles_select on public.profiles for select to authenticated
  using (public.is_active_user() or id = auth.uid());
create policy profiles_update_admin on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Clientes
create policy clients_select on public.clients for select to authenticated
  using (public.can_view_client(id));
create policy clients_insert on public.clients for insert to authenticated
  with check (public.is_manager());
create policy clients_update on public.clients for update to authenticated
  using (public.is_manager()) with check (public.is_manager());
create policy clients_delete on public.clients for delete to authenticated
  using (public.is_admin());

-- Contatos: quem vê o cliente pode manter os contatos (atualizar telefone etc.)
create policy contacts_select on public.client_contacts for select to authenticated
  using (public.can_view_client(client_id));
create policy contacts_insert on public.client_contacts for insert to authenticated
  with check (public.can_view_client(client_id));
create policy contacts_update on public.client_contacts for update to authenticated
  using (public.can_view_client(client_id)) with check (public.can_view_client(client_id));
create policy contacts_delete on public.client_contacts for delete to authenticated
  using (public.is_manager());

-- Serviços e responsáveis: leitura para quem vê o cliente; escrita só gestão
create policy services_select on public.client_services for select to authenticated
  using (public.can_view_client(client_id));
create policy services_write on public.client_services for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

create policy responsibles_select on public.client_responsibles for select to authenticated
  using (public.can_view_client(client_id));
create policy responsibles_write on public.client_responsibles for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

-- Auditoria: somente leitura para gestão; escrita só pelo gatilho
create policy audit_select on public.audit_log for select to authenticated
  using (public.is_manager());

-- ---------- Privilégios explícitos ----------
-- O projeto não expõe tabelas automaticamente: cada acesso é liberado aqui,
-- e as políticas RLS acima continuam filtrando linha a linha.

-- Nenhum acesso para usuários não autenticados
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon, public;

-- Usuários logados: somente as operações que alguma política permite
grant usage on schema public to authenticated, service_role;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.clients to authenticated;
grant select, insert, update, delete on public.client_contacts to authenticated;
grant select, insert, update, delete on public.client_services to authenticated;
grant select, insert, update, delete on public.client_responsibles to authenticated;
grant select on public.audit_log to authenticated;

-- Funções usadas pelas políticas e pela validação
grant execute on function public.current_role_name(), public.current_department(),
  public.is_admin(), public.is_manager(), public.is_active_user(),
  public.can_view_client(uuid), public.is_valid_cnpj(text)
  to authenticated, service_role;

-- Chave de serviço (somente servidor): criação de contas e automações
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

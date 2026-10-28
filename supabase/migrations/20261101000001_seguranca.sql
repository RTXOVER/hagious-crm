-- =====================================================================
-- Endurecimento de segurança
-- 1) Visitantes sem login (anon) e usuários não recebem privilégios que não usam
--    (TRUNCATE ignora as regras de acesso; REFERENCES/TRIGGER não são usados pelo app).
-- 2) Funções: ninguém executa por padrão (PUBLIC/anon); quem precisa recebe permissão explícita.
--    ATENÇÃO para novas migrações: funções chamadas pelo app ou pelas regras de acesso
--    precisam de "grant execute ... to authenticated, service_role".
-- 3) Registro de tentativas de login (bloqueio de força bruta), acessível só pelo servidor.
-- =====================================================================

-- ---------- 1) Tabelas ----------
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', t.relname);
  end loop;
end $$;
-- Visitante sem login não lê nem grava nada diretamente
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v')
  loop
    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

-- ---------- 2) Funções ----------
do $$
declare f record;
begin
  for f in select p.oid, p.oid::regprocedure::text as sig, has_function_privilege('authenticated', p.oid, 'execute') as auth_ok
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f'
  loop
    -- Mantém o acesso de quem já usava (usuários logados e o servidor), agora de forma explícita
    if f.auth_ok then execute format('grant execute on function %s to authenticated', f.sig); end if;
    execute format('grant execute on function %s to service_role', f.sig);
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

-- Função antiga sem caminho de busca fixo
alter function public.set_updated_at() set search_path = '';

-- ---------- 3) Tentativas de login ----------
create table public.login_attempts (
  id bigint generated always as identity primary key,
  -- Identificadores com hash (HMAC no servidor): não guardamos e-mail nem IP em texto (LGPD)
  account_key text not null,
  ip_key text not null,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index login_attempts_account_idx on public.login_attempts (account_key, created_at desc);
create index login_attempts_ip_idx on public.login_attempts (ip_key, created_at desc);
alter table public.login_attempts enable row level security;
-- Sem políticas: só o servidor (service_role) lê e grava
revoke all on public.login_attempts from anon, authenticated;
grant select, insert, delete on public.login_attempts to service_role;
grant usage, select on sequence public.login_attempts_id_seq to service_role;

-- Limpeza diária (guarda 30 dias para investigação)
do $$
begin
  perform cron.schedule('hagious-login-attempts-cleanup', '17 3 * * *',
    $c$delete from public.login_attempts where created_at < now() - interval '30 days'$c$);
exception when others then
  raise notice 'pg_cron indisponível: %', sqlerrm;
end $$;

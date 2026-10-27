-- Trava de sincronização: evita duas buscas de e-mail ao mesmo tempo na mesma caixa
-- (várias abas/pessoas com Conversas aberta). Vale por alguns minutos e é liberada ao terminar.
alter table public.channel_accounts add column sync_lock_until timestamptz;

/** Reserva a vez de sincronizar (atômico). Falso se outra busca está rodando ou se a última foi há pouco. */
create or replace function public.channel_claim_sync(p_account uuid, p_min_interval_seconds integer)
returns boolean language sql security definer set search_path = '' as $$
  with c as (
    update public.channel_accounts
       set sync_lock_until = now() + interval '5 minutes'
     where id = p_account
       and status <> 'desconectado'
       and (sync_lock_until is null or sync_lock_until < now())
       and (p_min_interval_seconds <= 0 or last_sync_at is null or last_sync_at < now() - make_interval(secs => p_min_interval_seconds))
    returning id
  )
  select exists (select 1 from c)
$$;
revoke execute on function public.channel_claim_sync(uuid, integer) from anon, authenticated, public;
grant execute on function public.channel_claim_sync(uuid, integer) to service_role;

-- =====================================================================
-- Etapa 5 (parte 2): Indicadores gerenciais
-- Tickets do período com os tempos já calculados em HORAS ÚTEIS (mesmo calendário dos prazos).
-- SECURITY INVOKER: cada pessoa só recebe os tickets que já pode ver (RLS).
-- =====================================================================

create or replace function public.ticket_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  id uuid,
  number bigint,
  department public.department,
  category_id uuid,
  category_name text,
  assignee_id uuid,
  status public.ticket_status,
  created_at timestamptz,
  first_responded_at timestamptz,
  first_response_due_at timestamptz,
  resolved_at timestamptz,
  resolution_due_at timestamptz,
  -- Minutos úteis entre a abertura e a 1ª resposta
  first_response_minutes integer,
  -- Minutos úteis entre a abertura e a conclusão, descontado o tempo "aguardando cliente"
  resolution_minutes integer
)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Período inválido'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'Período máximo: 400 dias'; end if;
  return query
    select t.id, t.number, t.department, t.category_id, c.name, t.assignee_id, t.status, t.created_at,
           t.first_responded_at, t.first_response_due_at, t.resolved_at, t.resolution_due_at,
           case when t.first_responded_at is not null then public.business_minutes_between(t.created_at, t.first_responded_at) end,
           case when t.status = 'concluido' and t.resolved_at is not null
                then greatest(0, public.business_minutes_between(t.created_at, t.resolved_at) - coalesce(t.sla_paused_minutes, 0)) end
      from public.tickets t
      join public.ticket_categories c on c.id = t.category_id
     where (t.created_at >= p_from and t.created_at < p_to)
        or (t.resolved_at >= p_from and t.resolved_at < p_to)
        or (t.first_responded_at >= p_from and t.first_responded_at < p_to)
     order by t.created_at
     limit 20000;
end $$;

revoke execute on function public.ticket_metrics(timestamptz, timestamptz) from anon, public;
grant execute on function public.ticket_metrics(timestamptz, timestamptz) to authenticated, service_role;

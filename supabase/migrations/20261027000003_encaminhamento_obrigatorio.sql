-- Mudar o departamento de um ticket só pela função ticket_forward (que exige motivo e registra no histórico).
-- Antes, um update direto na tabela trocava o departamento sem motivo.

create or replace function public.tickets_guard_department()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.department is distinct from old.department
     and not public.is_internal_op()
     and coalesce(current_setting('hagious.forward', true), '') <> '1' then
    raise exception 'Para mudar o departamento, use "Encaminhar" e informe o motivo';
  end if;
  return new;
end $$;

create trigger tickets_guard_department before update of department on public.tickets
  for each row execute function public.tickets_guard_department();

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
  perform set_config('hagious.forward', '1', true);
  update public.tickets set department = p_department, assignee_id = p_assignee where id = p_ticket;
  perform set_config('hagious.forward', '', true);
end $$;

revoke execute on function public.tickets_guard_department() from anon, authenticated, public;

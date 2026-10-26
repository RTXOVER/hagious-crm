-- =====================================================================
-- CRM Hagious — Etapa 3: calendário de dias úteis e cálculo de prazos (SLA)
-- =====================================================================
-- Todo prazo é calculado AQUI, no banco, para que a tela, os alertas e o
-- painel usem exatamente a mesma regra e ninguém consiga alterar prazos por fora.
-- Fuso: America/Sao_Paulo (o Brasil não tem horário de verão desde 2019).
-- =====================================================================

-- Configuração geral (uma única linha)
create table public.sla_settings (
  id smallint primary key default 1 check (id = 1),
  timezone text not null default 'America/Sao_Paulo',
  work_start time not null default '08:00',
  work_end time not null default '18:00',
  -- dias da semana com expediente (ISO: 1 = segunda ... 7 = domingo)
  workdays smallint[] not null default '{1,2,3,4,5}',
  -- alerta preventivo quando resta este percentual do prazo de resolução
  risk_percent smallint not null default 25 check (risk_percent between 5 and 90),
  -- prazo padrão de primeira resposta, em minutos úteis (categorias podem ter o seu)
  default_first_response_minutes integer not null default 120 check (default_first_response_minutes > 0),
  -- valores iniciais ainda não confirmados pela gestão
  needs_review boolean not null default true,
  updated_at timestamptz not null default now(),
  constraint expediente_valido check (work_end > work_start),
  constraint dias_validos check (workdays <@ '{1,2,3,4,5,6,7}' and cardinality(workdays) > 0)
);
insert into public.sla_settings (id) values (1);

-- Feriados (nacionais pré-cadastrados; municipais/estaduais a cadastrar pela gestão)
create table public.holidays (
  day date primary key,
  name text not null check (char_length(trim(name)) between 2 and 120),
  scope text not null default 'nacional' check (scope in ('nacional', 'estadual', 'municipal', 'empresa')),
  created_at timestamptz not null default now()
);

-- Feriados nacionais (Lei 662/1949, Lei 6.802/1980 e Lei 14.759/2023). Carnaval e Corpus Christi
-- são pontos facultativos: cadastre-os se a Hagious não tiver expediente nesses dias.
insert into public.holidays (day, name) values
  ('2026-01-01', 'Confraternização Universal'), ('2026-04-03', 'Sexta-feira Santa'),
  ('2026-04-21', 'Tiradentes'), ('2026-05-01', 'Dia do Trabalho'),
  ('2026-09-07', 'Independência do Brasil'), ('2026-10-12', 'Nossa Senhora Aparecida'),
  ('2026-11-02', 'Finados'), ('2026-11-15', 'Proclamação da República'),
  ('2026-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'), ('2026-12-25', 'Natal'),
  ('2027-01-01', 'Confraternização Universal'), ('2027-03-26', 'Sexta-feira Santa'),
  ('2027-04-21', 'Tiradentes'), ('2027-05-01', 'Dia do Trabalho'),
  ('2027-09-07', 'Independência do Brasil'), ('2027-10-12', 'Nossa Senhora Aparecida'),
  ('2027-11-02', 'Finados'), ('2027-11-15', 'Proclamação da República'),
  ('2027-11-20', 'Dia Nacional de Zumbi e da Consciência Negra'), ('2027-12-25', 'Natal');

-- ---------- Funções de calendário ----------

create or replace function public.is_business_day(d date)
returns boolean language sql stable set search_path = '' as $$
  select extract(isodow from d)::smallint = any (s.workdays)
     and not exists (select 1 from public.holidays h where h.day = d)
  from public.sla_settings s where s.id = 1
$$;

/** Primeiro instante útil a partir de ts (o próprio ts, se já estiver no expediente). */
create or replace function public.business_normalize(ts timestamptz)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  s public.sla_settings;
  loc timestamp;
  i int := 0;
begin
  select * into s from public.sla_settings where id = 1;
  loc := ts at time zone s.timezone;
  loop
    i := i + 1;
    if i > 400 then raise exception 'calendário sem dias úteis'; end if;
    if not public.is_business_day(loc::date) or loc::time >= s.work_end then
      loc := (loc::date + 1) + s.work_start;
    elsif loc::time < s.work_start then
      loc := loc::date + s.work_start;
    else
      return loc at time zone s.timezone;
    end if;
  end loop;
end $$;

/** Soma minutos ÚTEIS a ts (só conta tempo dentro do expediente, em dias úteis). */
create or replace function public.business_add_minutes(ts timestamptz, minutes integer)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  s public.sla_settings;
  loc timestamp;
  remaining integer := greatest(minutes, 0);
  available integer;
  i int := 0;
begin
  select * into s from public.sla_settings where id = 1;
  loc := public.business_normalize(ts) at time zone s.timezone;
  loop
    i := i + 1;
    if i > 2000 then raise exception 'prazo longo demais'; end if;
    available := floor(extract(epoch from (s.work_end - loc::time)) / 60)::int;
    if remaining <= available then
      return (loc + make_interval(mins => remaining)) at time zone s.timezone;
    end if;
    remaining := remaining - available;
    loc := public.business_normalize(((loc::date + 1) + s.work_start) at time zone s.timezone) at time zone s.timezone;
  end loop;
end $$;

/** Soma N dias ÚTEIS mantendo o horário (ex.: sexta 17h + 3 dias úteis = quarta 17h). */
create or replace function public.business_add_days(ts timestamptz, days integer)
returns timestamptz language plpgsql stable set search_path = '' as $$
declare
  s public.sla_settings;
  loc timestamp;
  d date;
  n integer := greatest(days, 0);
  i int := 0;
begin
  select * into s from public.sla_settings where id = 1;
  loc := public.business_normalize(ts) at time zone s.timezone;
  d := loc::date;
  while n > 0 loop
    i := i + 1;
    if i > 2000 then raise exception 'prazo longo demais'; end if;
    d := d + 1;
    if public.is_business_day(d) then n := n - 1; end if;
  end loop;
  return (d + loc::time) at time zone s.timezone;
end $$;

/** Minutos úteis entre dois instantes (0 se b <= a). */
create or replace function public.business_minutes_between(a timestamptz, b timestamptz)
returns integer language plpgsql stable set search_path = '' as $$
declare
  s public.sla_settings;
  la timestamp;
  lb timestamp;
  d date;
  day_start timestamp;
  day_end timestamp;
  total bigint := 0;
  i int := 0;
begin
  if b is null or a is null or b <= a then return 0; end if;
  select * into s from public.sla_settings where id = 1;
  la := a at time zone s.timezone;
  lb := b at time zone s.timezone;
  d := la::date;
  while d <= lb::date loop
    i := i + 1;
    if i > 4000 then raise exception 'intervalo longo demais'; end if;
    if public.is_business_day(d) then
      day_start := greatest(d + s.work_start, la);
      day_end := least(d + s.work_end, lb);
      if day_end > day_start then
        total := total + floor(extract(epoch from (day_end - day_start)) / 60);
      end if;
    end if;
    d := d + 1;
  end loop;
  return total;
end $$;

-- ---------- Permissões ----------
alter table public.sla_settings enable row level security;
alter table public.holidays enable row level security;

create policy sla_settings_select on public.sla_settings for select to authenticated using (public.is_active_user());
create policy sla_settings_update on public.sla_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy holidays_select on public.holidays for select to authenticated using (public.is_active_user());
create policy holidays_write on public.holidays for all to authenticated
  using (public.is_manager()) with check (public.is_manager());

grant select, update on public.sla_settings to authenticated;
grant select, insert, update, delete on public.holidays to authenticated;
grant all on public.sla_settings, public.holidays to service_role;
grant execute on function public.is_business_day(date), public.business_normalize(timestamptz),
  public.business_add_minutes(timestamptz, integer), public.business_add_days(timestamptz, integer),
  public.business_minutes_between(timestamptz, timestamptz)
  to authenticated, service_role;
revoke execute on function public.is_business_day(date), public.business_normalize(timestamptz),
  public.business_add_minutes(timestamptz, integer), public.business_add_days(timestamptz, integer),
  public.business_minutes_between(timestamptz, timestamptz)
  from anon, public;

create trigger sla_settings_updated_at before update on public.sla_settings
  for each row execute function public.set_updated_at();
create trigger audit_sla_settings after insert or update or delete on public.sla_settings
  for each row execute function public.audit_trigger();
create trigger audit_holidays after insert or update or delete on public.holidays
  for each row execute function public.audit_trigger();

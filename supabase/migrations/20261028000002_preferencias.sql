-- Preferências pessoais: visual (tema e tamanho da letra) e região (idioma, formatos, fuso e moeda).
-- Cada pessoa vê e altera apenas as próprias preferências. Os prazos (SLA) continuam no fuso da empresa.

create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  font_scale text not null default 'md' check (font_scale in ('sm', 'md', 'lg', 'xl')),
  language text not null default 'pt-BR' check (language in ('pt-BR', 'en-US', 'es-ES')),
  date_format text not null default 'dmy' check (date_format in ('dmy', 'ymd', 'mdy')),
  time_format text not null default '24h' check (time_format in ('24h', '12h')),
  timezone text not null default 'America/Sao_Paulo' check (timezone ~ '^[A-Za-z_]+(/[A-Za-z_\-]+){0,2}$'),
  currency text not null default 'BRL' check (currency in ('BRL', 'USD', 'EUR')),
  updated_at timestamptz not null default now()
);
create trigger user_preferences_updated_at before update on public.user_preferences
  for each row execute function public.set_updated_at();

alter table public.user_preferences enable row level security;
create policy prefs_select on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy prefs_insert on public.user_preferences for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user());
create policy prefs_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.user_preferences to authenticated;
grant all on public.user_preferences to service_role;

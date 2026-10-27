-- Idiomas do sistema: apenas português e inglês.
update public.user_preferences set language = 'pt-BR' where language not in ('pt-BR', 'en-US');
alter table public.user_preferences drop constraint if exists user_preferences_language_check;
alter table public.user_preferences add constraint user_preferences_language_check check (language in ('pt-BR', 'en-US'));

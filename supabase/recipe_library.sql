-- Layer 1: shared recipe library (reuse of AI-generated meals). Written only by the chef-ai edge function (service role).
create table if not exists public.recipe_library(
 id uuid primary key default gen_random_uuid(),
 req_key text not null,                 -- style|diet|slot|kids|notes (exact match)
 style_key text not null default '',
 diet_key text not null default '',
 meal_slot text not null default '',
 has_kids boolean not null default false,
 notes_key text not null default '',
 adults int not null default 0, children int not null default 0,
 request jsonb not null default '{}',
 dishes jsonb not null, ready jsonb not null default '[]',
 model text, fresh boolean not null default false,
 created_by uuid references auth.users on delete set null,
 created_at timestamptz not null default now(),
 use_count int not null default 0, last_used_at timestamptz,
 rating_avg numeric(4,2), rating_count int not null default 0);
create index if not exists recipe_library_key on public.recipe_library(req_key);
alter table public.recipe_library enable row level security;
revoke all on public.recipe_library from public, anon, authenticated;
grant all on public.recipe_library to service_role;

create or replace function public.recipe_library_hit(lid uuid) returns void language sql security definer set search_path=public as $$
 update recipe_library set use_count=use_count+1, last_used_at=now() where id=lid $$;
revoke all on function public.recipe_library_hit(uuid) from public, anon, authenticated;
grant execute on function public.recipe_library_hit(uuid) to service_role;

-- Ratings: meals.settings->>'library_id' links a saved meal to its library entry.
-- One vote per user (their average), recomputed on every rating change.
create index if not exists meals_library_id on public.meals((settings->>'library_id'));
create or replace function public.recipe_library_rerate() returns trigger language plpgsql security definer set search_path=public as $$
declare ids text[]; lid text; begin
 ids := array_remove(array[case when tg_op<>'INSERT' then old.settings->>'library_id' end, case when tg_op<>'DELETE' then new.settings->>'library_id' end], null);
 foreach lid in array ids loop
  if lid ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
   update recipe_library l set rating_avg=s.a, rating_count=s.n from (
     select round(avg(ua)::numeric,2) a, count(*)::int n from (select avg(rating) ua from meals where settings->>'library_id'=lid and rating is not null group by user_id) u) s
    where l.id=lid::uuid;
  end if; end loop;
 return null; end $$;
revoke all on function public.recipe_library_rerate() from public, anon, authenticated;
drop trigger if exists meals_library_rating on public.meals;
create trigger meals_library_rating after insert or delete or update of rating, settings on public.meals for each row execute function public.recipe_library_rerate();

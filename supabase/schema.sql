create table if not exists public.profiles(id uuid primary key references auth.users on delete cascade, email text, display_name text, created_at timestamptz default now());
alter table public.profiles enable row level security;
drop policy if exists "profiles own" on public.profiles;
create policy "profiles own" on public.profiles for all to authenticated using (id=auth.uid()) with check (id=auth.uid());
create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.profiles(id,email,display_name) values(new.id,new.email,split_part(new.email,'@',1)) on conflict do nothing; return new; end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create table if not exists public.meals(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null default auth.uid() references auth.users on delete cascade,
 author_label text,
 settings jsonb not null default '{}', dishes jsonb not null default '[]', ready jsonb not null default '[]', plan jsonb,
 rating smallint check (rating between 1 and 10), comment text default '',
 is_public boolean generated always as (rating is null or rating > 8) stored,
 created_at timestamptz default now());
create index if not exists meals_user on public.meals(user_id);
alter table public.meals enable row level security;
drop policy if exists "meals read own or public" on public.meals;
drop policy if exists "meals insert own" on public.meals;
drop policy if exists "meals update own" on public.meals;
drop policy if exists "meals delete own" on public.meals;
create policy "meals read own or public" on public.meals for select to authenticated using (user_id=auth.uid() or is_public);
create policy "meals insert own" on public.meals for insert to authenticated with check (user_id=auth.uid());
create policy "meals update own" on public.meals for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy "meals delete own" on public.meals for delete to authenticated using (user_id=auth.uid());
revoke all on public.meals from anon; revoke all on public.profiles from anon;

-- community feed: ratings/comments of ALL meals (limited columns), authenticated only
create or replace view public.community_feed with (security_invoker=false) as
 select id, author_label, settings->>'cuisine' as cuisine, rating, comment, created_at from public.meals
 where rating is not null or coalesce(comment,'')<>'';
revoke all on public.community_feed from anon, public; grant select on public.community_feed to authenticated;

create table if not exists public.ai_usage(user_id uuid references auth.users on delete cascade, day date default current_date, calls int default 0, primary key(user_id,day));
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon, authenticated;
create or replace function public.bump_ai_usage(uid uuid, lim int) returns int language plpgsql security definer set search_path=public as $$
declare c int; begin insert into ai_usage(user_id,day,calls) values(uid,current_date,1) on conflict(user_id,day) do update set calls=ai_usage.calls+1 returning calls into c;
 if c>lim then raise exception 'rate_limit'; end if; return c; end $$;
revoke all on function public.bump_ai_usage(uuid,int) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(uuid,int) to service_role;

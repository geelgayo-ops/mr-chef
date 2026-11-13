-- Layer 3: weekly automatic library refresh (edge function library-refresh, driven by pg_cron + pg_net)
alter table public.recipe_library add column if not exists source text not null default 'ai';
alter table public.recipe_library add column if not exists sources jsonb not null default '[]';
alter table public.recipe_library add column if not exists trend text;

create table if not exists public.library_refresh_runs(
 id bigserial primary key, started_at timestamptz not null default now(), finished_at timestamptz,
 status text not null default 'running', trigger text, model text, grounded boolean, grounding_error text,
 trends jsonb not null default '[]', sources jsonb not null default '[]', planned int not null default 0);
create table if not exists public.library_refresh_items(
 id bigserial primary key, run_id bigint not null references public.library_refresh_runs on delete cascade,
 req jsonb not null, trend text, status text not null default 'pending', attempts int not null default 0,
 library_id uuid references public.recipe_library on delete set null, error text,
 tokens_in int not null default 0, tokens_out int not null default 0, updated_at timestamptz not null default now());
create index if not exists library_refresh_items_run on public.library_refresh_items(run_id,status);
alter table public.library_refresh_runs enable row level security;
alter table public.library_refresh_items enable row level security;
revoke all on public.library_refresh_runs, public.library_refresh_items from public, anon, authenticated;
grant all on public.library_refresh_runs, public.library_refresh_items to service_role;
grant usage on sequence public.library_refresh_runs_id_seq, public.library_refresh_items_id_seq to service_role;

-- claim up to n items atomically (stale 'running' items older than 5 min are retried; max 2 attempts)
create or replace function public.library_refresh_claim(rid bigint, n int) returns setof public.library_refresh_items
language sql security definer set search_path=public as $$
 update library_refresh_items i set status='running', attempts=attempts+1, updated_at=now()
 where i.id in (select id from library_refresh_items where run_id=rid and attempts<2 and
   (status='pending' or (status='failed' and attempts<2) or (status='running' and updated_at<now()-interval '5 minutes'))
   order by id limit n for update skip locked)
 returning i.* $$;
revoke all on function public.library_refresh_claim(bigint,int) from public, anon, authenticated;
grant execute on function public.library_refresh_claim(bigint,int) to service_role;

create or replace view public.library_refresh_summary with (security_invoker=true) as
 select r.id, r.started_at, r.finished_at, r.status, r.trigger, r.model, r.grounded, r.planned,
  count(i.*) filter (where i.status='done') added, count(i.*) filter (where i.status='skipped') skipped_duplicates,
  count(i.*) filter (where i.status='failed') failed, count(i.*) filter (where i.status in ('pending','running')) open,
  coalesce(sum(i.tokens_in),0) tokens_in, coalesce(sum(i.tokens_out),0) tokens_out, jsonb_array_length(r.sources) n_sources
 from library_refresh_runs r left join library_refresh_items i on i.run_id=r.id group by r.id order by r.id desc;
revoke all on public.library_refresh_summary from public, anon, authenticated;
grant select on public.library_refresh_summary to service_role;

create extension if not exists pg_cron;
create extension if not exists pg_net;

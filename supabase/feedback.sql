create table if not exists public.feedback(
 id uuid primary key default gen_random_uuid(),
 user_id uuid references auth.users on delete set null,
 email text, stars smallint check (stars between 1 and 5),
 helped text check (length(helped)<=2000), missing text check (length(missing)<=2000), free_text text check (length(free_text)<=4000),
 screen text check (length(screen)<=100), app_version text check (length(app_version)<=50), user_agent text check (length(user_agent)<=500),
 created_at timestamptz default now());
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;
grant insert on public.feedback to anon, authenticated;
drop policy if exists "feedback insert auth" on public.feedback;
drop policy if exists "feedback insert anon" on public.feedback;
create policy "feedback insert auth" on public.feedback for insert to authenticated with check (user_id=auth.uid() and email is not distinct from (auth.jwt()->>'email'));
create policy "feedback insert anon" on public.feedback for insert to anon with check (user_id is null and email is null);

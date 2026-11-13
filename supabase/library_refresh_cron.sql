-- Weekly library refresh: Sunday 06:00 Asia/Jerusalem.
-- Start job fires at 03:00 and 04:00 UTC; the function only starts when the local Jerusalem hour is 06 (handles DST: UTC+3 summer / UTC+2 winter).
-- Step job processes 4 meals per call every 3 minutes for the following 3 hours (no-op when nothing is open).
do $$ begin perform cron.unschedule(jobname) from cron.job where jobname in ('library-refresh-start','library-refresh-step'); end $$;
select cron.schedule('library-refresh-start','0 3,4 * * 0',$$
 select net.http_post(url:='https://hsfopkplkgszmcugfary.supabase.co/functions/v1/library-refresh',
  headers:=jsonb_build_object('Content-Type','application/json','x-refresh-secret',(select decrypted_secret from vault.decrypted_secrets where name='library_refresh_secret')),
  body:='{"start":true}'::jsonb, timeout_milliseconds:=150000) $$);
select cron.schedule('library-refresh-step','*/3 3-7 * * 0',$$
 select net.http_post(url:='https://hsfopkplkgszmcugfary.supabase.co/functions/v1/library-refresh',
  headers:=jsonb_build_object('Content-Type','application/json','x-refresh-secret',(select decrypted_secret from vault.decrypted_secrets where name='library_refresh_secret')),
  body:='{}'::jsonb, timeout_milliseconds:=150000) $$);

-- Holidays & seasons: library key gains a season bucket (Nov–Mar 'קר', Apr–Oct 'חם'). Existing entries (all created Nov 2026) migrated to 'קר'.
alter table public.recipe_library add column if not exists season text not null default '';
update public.recipe_library set req_key=req_key||'|קר', season='קר' where season='';

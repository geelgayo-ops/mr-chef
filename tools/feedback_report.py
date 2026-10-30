#!/usr/bin/env python3
"""סיכום משובי מר שף. הרצה: SUPABASE_ACCESS_TOKEN=... python3 tools/feedback_report.py [--days 30] [--json]
משתמש ב-Supabase Management API (אין סודות בקובץ). לא נטען באתר."""
import json,os,sys,urllib.request,collections
REF='hsfopkplkgszmcugfary'
days=int(sys.argv[sys.argv.index('--days')+1]) if '--days' in sys.argv else 3650
tok=os.environ.get('SUPABASE_ACCESS_TOKEN') or sys.exit('missing SUPABASE_ACCESS_TOKEN')
q=f"select created_at,email,stars,helped,missing,free_text,screen,app_version,user_agent from public.feedback where created_at>now()-interval '{days} days' order by created_at desc"
r=urllib.request.Request(f'https://api.supabase.com/v1/projects/{REF}/database/query',data=json.dumps({'query':q}).encode(),headers={'Authorization':'Bearer '+tok,'Content-Type':'application/json','User-Agent':'mr-chef-report'})
rows=json.load(urllib.request.urlopen(r))
if '--json' in sys.argv: print(json.dumps(rows,ensure_ascii=False,indent=1));sys.exit()
print(f'סה״כ משובים: {len(rows)} (ב-{days} הימים האחרונים)')
st=[x['stars'] for x in rows if x['stars']]
if st: print(f'דירוג ממוצע: {sum(st)/len(st):.2f}/5 ({len(st)} דירוגים) · התפלגות:',dict(sorted(collections.Counter(st).items())))
print('לפי מסך:',dict(collections.Counter(x['screen'] for x in rows)))
print('משתמשים מחוברים:',sum(1 for x in rows if x['email']),'· אנונימיים (הדגמה):',sum(1 for x in rows if not x['email']))
for k,t in (('helped','מה עזר'),('missing','מה חסר/מבלבל'),('free_text','הערות חופשיות')):
    L=[x for x in rows if x[k]]
    print(f'\n== {t} ({len(L)}) ==')
    for x in L: print(f"- [{x['created_at'][:16]} UTC · {x['stars'] or '-'}★ · {x['email'] or 'אנונימי'} · {x['screen']}] {x[k]}")

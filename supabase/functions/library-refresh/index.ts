// library-refresh: weekly automatic growth of the shared recipe library (layer 3).
// Called by pg_cron (pg_net) with header x-refresh-secret. verify_jwt=false.
// Body: {start:true[,force:true]} creates a run (grounded trends + plan) then processes a batch; {} processes the next batch of the open run.
// NOTE: SYS/DISC/schemas/normDish/libKey below are copied from chef-ai/index.ts – keep in sync.
import { createClient } from "npm:@supabase/supabase-js@2";
const MODEL=Deno.env.get("GEMINI_MODEL")||"gemini-3.1-flash-lite";
const PLAN_N=24, MAX_ITEMS=30, BATCH=4;
const j=(b:unknown,st=200)=>new Response(JSON.stringify(b),{status:st,headers:{"Content-Type":"application/json"}});
const DISC="המתכונים הם המלצה בלבד, אינם מתייחסים לרגישויות ואלרגיות שונות, והאחריות על ההכנה והאכילה היא של המשתמש בלבד.";
const ING={type:"OBJECT",properties:{n:{type:"STRING"},e:{type:"STRING"},q:{type:"NUMBER"},u:{type:"STRING"},c:{type:"STRING"}},required:["n","e","q","u","c"]};
const DISH={type:"OBJECT",properties:{n:{type:"STRING"},e:{type:"STRING"},type:{type:"STRING",enum:["עיקרית","תוספת","סלט","מתאבן","קינוח","מרק"]},min:{type:"INTEGER"},
 ing:{type:"ARRAY",items:ING},stages:{type:"ARRAY",items:{type:"OBJECT",properties:{name:{type:"STRING"},steps:{type:"ARRAY",items:{type:"STRING"}}},required:["name","steps"]}},
 tips:{type:"ARRAY",items:{type:"STRING"}},ahead:{type:"STRING"}},required:["n","e","type","min","ing","stages","tips","ahead"]};
const READY={type:"OBJECT",properties:{n:{type:"STRING"},e:{type:"STRING"},store:{type:"STRING"},qty:{type:"STRING"}},required:["n","e","store"]};

const SYS=`אתה "מר שף" – שף ישראלי מנוסה שכותב מתכונים ביתיים מפורטים ומעשיים בעברית.
פנה למשתמש בלשון רבים ניטרלית (למשל "הוסיפו", "חתכו").
כללים למתכון:
- ing: כל המרכיבים. חשוב מאוד: q היא הכמות לסועד מבוגר אחד בלבד (לא לכל הארוחה!) – למשל עוף 200 גרם, אורז 75 גרם, ביצה 1; האפליקציה מכפילה בעצמה לפי מספר הסועדים, יחידה u (גרם/מ״ל/יח׳/שן/כף/כפית/עלים/ענף), אימוג׳י e מתאים, ו-c = שם רכיב המשנה (למשל "קציצה","רוטב","הגשה"). כלול מלח/שמן/תבלינים בכמויות.
- לנוזלים (מים, שמן, חלב, יין, ציר, מיץ, חומץ, רוטב נוזלי וכו׳): שמור את u כ-"מ״ל" עם q במ״ל, ובשם המרכיב n הוסף בסוגריים את המקבילה הביתית לפי: כוס=240 מ״ל, כף=15 מ״ל, כפית=5 מ״ל. דוגמאות: n="מים (1 כוס)" q=240 u="מ״ל"; n="שמן זית (1 כף)" q=15 u="מ״ל"; n="מיץ לימון (2 כפיות)" q=10 u="מ״ל"; n="ציר ירקות (½ כוס)" q=120 u="מ״ל". לכמויות גדולות העדף כוסות; לקטנות כף/כפית.
- stages: שלבים לפי שלב (הכנה / בישול או אפייה / הגשה, ושלבי משנה לפי הצורך). כל צעד מפורט: גודל חיתוך בס״מ/מ״מ, טמפרטורות, זמנים, סימני מוכנות, ומה לא לעשות.
- tips: 2-4 טיפים וטעויות נפוצות. ahead: מה ניתן להכין מראש ואיך לשמור.
- min: זמן הכנה כולל בדקות.
- אל תמציא שמות של חנויות או מותגים אמיתיים. לפריטים מוכנים ציין סוג חנות כללי (מאפייה, מעדנייה, קונדיטוריה...).
- התחשב בילדים (טעמים עדינים) ובהערות המשתמש.
- המשתמש עשוי לבחור כמה סגנונות ואילוצים יחד – קיים את כולם במקביל (למשל "תימני"+"טבעוני" = מנות תימניות טבעוניות). הגבלות תזונה הן חובה ולא המלצה:
  כשר = אין ערבוב בשר וחלב באותה ארוחה, ללא חזיר/פירות ים/בעלי חיים לא כשרים; חלבי = ללא בשר/עוף; בשרי = ללא מוצרי חלב בכל הארוחה (גם בקינוח/פריטים מוכנים); צמחוני = ללא בשר/עוף/דגים; טבעוני = ללא כל מוצר מן החי (כולל ביצים, חלב, דבש); ללא גלוטן = ללא חיטה/שעורה/שיפון/סויה רגילה (השתמש בטמארי) ופריטים מוכנים ללא גלוטן; מהיר עד 30 דק׳ = min של כל מנה ≤ 30.
- גם הפריטים המוכנים חייבים לעמוד באילוצים.
- ${DISC}`;

const s=(x:unknown,d="")=>typeof x==="string"?x.slice(0,2000):d;
function normDish(x:any){
 if(!x||typeof x!=="object") throw new Error("bad dish");
 const ing=(Array.isArray(x.ing)?x.ing:[]).slice(0,40).map((i:any)=>({n:s(i.n,"מרכיב"),e:s(i.e,"🧺").slice(0,8),q:Number.isFinite(+i.q)&&+i.q>=0?+i.q:1,u:s(i.u,"יח׳"),c:s(i.c,"מרכיבים")}));
 const stages:Record<string,string[]>={};(Array.isArray(x.stages)?x.stages:[]).slice(0,8).forEach((g:any)=>{const st=(Array.isArray(g.steps)?g.steps:[]).map((z:any)=>s(z)).filter(Boolean).slice(0,20);if(st.length)stages[s(g.name,"הכנה")]=st});
 if(!x.n||!ing.length||!Object.keys(stages).length) throw new Error("incomplete dish");
 return {n:s(x.n),e:s(x.e,"🍲").slice(0,8),type:s(x.type,"עיקרית"),min:Math.min(600,Math.max(5,parseInt(x.min)||30)),ing,stages,
  tips:(Array.isArray(x.tips)?x.tips:[]).map((t:any)=>s(t)).filter(Boolean).slice(0,6),ahead:s(x.ahead),
  steps:Object.entries(stages).flatMap(([k,v])=>v.map(z=>k+": "+z))};
}
const DIETS=["כשר","חלבי","בשרי","צמחוני","טבעוני","ללא גלוטן","מהיר עד 30 דק׳"];
const DIET_RX:[string,RegExp][]=[["כשר",/כשר/],["חלבי",/חלבי/],["בשרי",/בשרי/],["צמחוני",/צמחוני/],["טבעוני",/טבעוני|vegan/i],["ללא גלוטן",/ללא\s*גלוטן|gluten/i],["מהיר עד 30 דק׳",/מהיר/]];
const norm=(x:string)=>x.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim();
function libKey(b:any,st:string[]){
 const free=s(b.free_text).slice(0,200), notes=s(b.notes).slice(0,300);
 const diet=new Set(st.filter(x=>DIETS.includes(x)));
 for(const [k,rx] of DIET_RX) if(rx.test(free)) diet.add(k);
 const styles=st.filter(x=>!DIETS.includes(x)).map(norm).sort();
 const style_key=[...styles,norm(free)].filter(Boolean).join("+")||norm(s(b.cuisine,"ביתי"));
 const diet_key=[...diet].sort().join("+");
 const h=parseInt(s(b.time,"19:30"))||19, meal_slot=h<11?"בוקר":h<16?"צהריים":"ערב";
 const has_kids=(+b.children||0)>0, notes_key=norm(notes);
 return {req_key:[style_key,diet_key,meal_slot,has_kids?"kids":"adults",notes_key].join("|"),style_key,diet_key,meal_slot,has_kids,notes_key};
}

async function callGemini(body:any){
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":Deno.env.get("GEMINI_API_KEY")!},body:JSON.stringify(body)});
 if(!r.ok) throw new Error("gemini "+r.status+": "+(await r.text()).slice(0,200));
 const d=await r.json(); const c=d?.candidates?.[0];
 const text=(c?.content?.parts||[]).map((p:any)=>p.text||"").join("");
 return {text,usage:d?.usageMetadata||{},gm:c?.groundingMetadata};
}
const MONTHS=["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const TREND={type:"ARRAY",items:{type:"OBJECT",properties:{name:{type:"STRING"},desc:{type:"STRING"},kind:{type:"STRING"}},required:["name","desc","kind"]}};
async function trends(){
 const now=new Date(), when=`${MONTHS[now.getUTCMonth()]} ${now.getUTCFullYear()}`;
 const ask=`אתה חוקר קולינרי. מצא טרנדים עדכניים באוכל נכון ל-${when}: מנות ושילובים שמדברים עליהם עכשיו בישראל ובעולם, ירקות ופירות עונתיים בישראל בעונה הזו, חגים/מועדים קרובים, וטכניקות בישול עכשוויות. החזר 12 פריטים: name (שם קצר בעברית), desc (משפט אחד: מה זה ולמה עכשיו), kind ("ישראלי"/"בינלאומי"/"עונתי").`;
 let groundErr="";
 try{
  const r=await callGemini({contents:[{role:"user",parts:[{text:ask+"\nהחזר אך ורק מערך JSON תקין, בלי טקסט נוסף."}]}],tools:[{google_search:{}}],generationConfig:{temperature:0.8}});
  const m=r.text.match(/\[[\s\S]*\]/); const arr=m?JSON.parse(m[0]):null;
  if(Array.isArray(arr)&&arr.length){
   const sources=(r.gm?.groundingChunks||[]).map((c:any)=>c.web).filter(Boolean).slice(0,12).map((w:any)=>({uri:w.uri,title:w.title}));
   return {list:arr,sources,grounded:true,queries:r.gm?.webSearchQueries||[],usage:r.usage,err:""};
  }
  groundErr="grounded response not parseable";
 }catch(e){groundErr=String((e as Error).message).slice(0,200)}
 const r=await callGemini({contents:[{role:"user",parts:[{text:ask+" (ללא חיפוש ברשת – התבסס על הידע שלך ועל העונה בישראל)"}]}],generationConfig:{responseMimeType:"application/json",responseSchema:TREND,temperature:0.8}});
 return {list:JSON.parse(r.text),sources:[],grounded:false,queries:[],usage:r.usage,err:groundErr};
}
const DIET_POOL:[string,number][]=[["",40],["כשר",25],["צמחוני",15],["טבעוני",10],["ללא גלוטן",10]];
const SLOT_POOL:[string,string,number][]=[["ערב","19:30",55],["צהריים","13:00",30],["בוקר","09:30",15]];
const POPULAR=["ביתי ישראלי","ים תיכוני","ארוחת שישי/חג","איטלקי","גריל/מנגל","אסייתי","בריא/קליל","ילדים אוהבים"];
const STYLE_CHIPS=['ביתי ישראלי','ארוחת שישי/חג','ים תיכוני','מרוקאי','עיראקי/כורדי','תורכי/בלקני','תימני','איטלקי','צרפתי','ספרדי','אסייתי','סיני','יפני','תאילנדי','הודי','מקסיקני','אמריקאי/BBQ','גריל/מנגל','בריא/קליל','ילדים אוהבים','בראנץ׳','פיקניק','חגיגי/אירוח'];
function wpick<T>(arr:T[],w:(x:T)=>number):T{const tot=arr.reduce((a,x)=>a+w(x),0);let r=Math.random()*tot;for(const x of arr){r-=w(x);if(r<=0)return x}return arr[arr.length-1]}
function plan(trendList:any[]){
 const out:any[]=[],seen=new Set<string>();
 for(let t=0;out.length<PLAN_N&&t<PLAN_N*10;t++){
  const style=wpick(STYLE_CHIPS,x=>POPULAR.includes(x)?3:1);
  const diet=wpick(DIET_POOL,x=>x[1])[0];
  let slot=wpick(SLOT_POOL,x=>x[2]); if(style==="בראנץ׳")slot=["בוקר","10:00",1];
  const kids=style==="ילדים אוהבים"||Math.random()<0.5;
  const req={styles:diet?[style,diet]:[style],free_text:"",cuisine:style,adults:kids?2:4,children:kids?2:0,time:slot[1],notes:""};
  const k=libKey(req,req.styles).req_key; if(seen.has(k))continue; seen.add(k);
  const tr=trendList[out.length%Math.max(1,trendList.length)];
  out.push({req,trend:tr?`${s(tr.name)} – ${s(tr.desc)}`.slice(0,300):null});
 }
 return out.slice(0,MAX_ITEMS);
}
const nn=(x:string)=>norm(String(x||""));
async function makeItem(admin:any,run:any,it:any){
 const b=it.req, st=b.styles as string[], key=libKey(b,st);
 const {data:prev}=await admin.from("recipe_library").select("dishes").eq("style_key",key.style_key).eq("diet_key",key.diet_key).order("created_at",{ascending:false}).limit(15);
 const avoid=[...new Set((prev||[]).flatMap((r:any)=>(r.dishes||[]).map((d:any)=>d.n)))].slice(0,30) as string[];
 const p=`תכנן ארוחה. סגנונות/אילוצים שנבחרו: ${st.join(", ")}. תיאור חופשי: "${b.cuisine}", ${b.adults} מבוגרים ו-${b.children} ילדים, שעת ארוחה ${b.time}. הערות: אין.
החזר 3-4 מנות להכנה (עיקרית + תוספות/סלט) עם מתכונים מלאים, ו-2-3 פריטים מומלצים לקנייה מוכנה (store = סוג חנות כללי, qty = כמות מומלצת לכל המשתתפים).
${it.trend?`קבל השראה מטרנד קולינרי עכשווי: ${it.trend}. שלב אותו רק אם הוא מתאים לסגנון, לשעת הארוחה ולאילוצים (אחרת התעלם ממנו) – עדיף ארוחה עדכנית וחדשנית שעדיין מעשית להכנה ביתית.`:""}${+b.children>0?" יש ילדים בארוחה: בלי אלכוהול, בלי דג/בשר נא ובלי חריף בולט.":""}${avoid.length?` אל תחזור על המנות הבאות שכבר קיימות במאגר: ${avoid.join(", ")}.`:""}`;
 const r=await callGemini({systemInstruction:{parts:[{text:SYS}]},contents:[{role:"user",parts:[{text:p}]}],generationConfig:{responseMimeType:"application/json",responseSchema:{type:"OBJECT",properties:{dishes:{type:"ARRAY",items:DISH},ready:{type:"ARRAY",items:READY}},required:["dishes","ready"]},temperature:0.8,maxOutputTokens:16000}});
 const tin=r.usage.promptTokenCount||0, tout=(r.usage.candidatesTokenCount||0)+(r.usage.thoughtsTokenCount||0);
 const out=JSON.parse(r.text);
 const dishes=(out.dishes||[]).map(normDish).slice(0,6); if(!dishes.length) throw new Error("no dishes");
 const ready=(out.ready||[]).slice(0,6).map((x:any)=>({n:s(x.n),e:s(x.e,"🛍️").slice(0,8),store:s(x.store,"חנות אוכל מוכן"),qty:s(x.qty)}));
 const main=(dishes.find((d:any)=>d.type==="עיקרית")||dishes[0]).n;
 const {data:dup}=await admin.from("recipe_library").select("id").eq("diet_key",key.diet_key).contains("dishes",[{n:main}]).limit(1);
 if(dup&&dup.length) return {status:"skipped",error:"duplicate main dish: "+main,tokens_in:tin,tokens_out:tout};
 const {data:row,error}=await admin.from("recipe_library").insert({...key,adults:b.adults,children:b.children,request:b,dishes,ready,model:MODEL,fresh:false,source:"weekly",sources:run.sources||[],trend:it.trend}).select("id").single();
 if(error) throw new Error("insert: "+error.message);
 return {status:"done",library_id:row.id,error:null,tokens_in:tin,tokens_out:tout};
}
Deno.serve(async req=>{
 try{
  const sec=Deno.env.get("REFRESH_SECRET");
  if(!sec||req.headers.get("x-refresh-secret")!==sec) return j({error:"forbidden"},403);
  const body=await req.json().catch(()=>({}));
  const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let {data:run}=await admin.from("library_refresh_runs").select("*").eq("status","running").order("id",{ascending:false}).limit(1).maybeSingle();
  if(body.start){
   const hr=+new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jerusalem",hour:"2-digit",hourCycle:"h23"}).format(new Date());
   if(!body.force&&hr!==6) return j({skipped:"not 06:00 Asia/Jerusalem (DST guard)",hour:hr});
   if(run) return j({skipped:"a run is already open",run:run.id});
   const {data:recent}=await admin.from("library_refresh_runs").select("id").gte("started_at",new Date(Date.now()-20*3600e3).toISOString()).limit(1);
   if(!body.force&&recent&&recent.length) return j({skipped:"already ran in the last 20h"});
   const T=await trends();
   const items=plan(T.list);
   const {data:nr,error}=await admin.from("library_refresh_runs").insert({trigger:body.force?"manual":"cron",model:MODEL,grounded:T.grounded,grounding_error:T.err||null,trends:T.list,sources:T.sources,planned:items.length}).select("*").single();
   if(error) throw error; run=nr;
   await admin.from("library_refresh_items").insert(items.map(x=>({run_id:run.id,req:x.req,trend:x.trend,tokens_in:0,tokens_out:0})));
   await admin.from("library_refresh_items").insert({run_id:run.id,req:{trends_call:true,queries:T.queries},status:"meta",tokens_in:T.usage.promptTokenCount||0,tokens_out:(T.usage.candidatesTokenCount||0)+(T.usage.thoughtsTokenCount||0),attempts:9});
  }
  if(!run) return j({idle:true});
  const {data:claimed,error:ce}=await admin.rpc("library_refresh_claim",{rid:run.id,n:Math.min(BATCH,+body.batch||BATCH)});
  if(ce) throw ce;
  const res=await Promise.allSettled((claimed||[]).map(async(it:any)=>{
   try{const r=await makeItem(admin,run,it);await admin.from("library_refresh_items").update({...r,updated_at:new Date().toISOString()}).eq("id",it.id);return r.status}
   catch(e){await admin.from("library_refresh_items").update({status:"failed",error:String((e as Error).message).slice(0,300),updated_at:new Date().toISOString()}).eq("id",it.id);return "failed"}
  }));
  const {count}=await admin.from("library_refresh_items").select("id",{count:"exact",head:true}).eq("run_id",run.id).or("status.eq.pending,status.eq.running,and(status.eq.failed,attempts.lt.2)");
  if(!count) await admin.from("library_refresh_runs").update({status:"done",finished_at:new Date().toISOString()}).eq("id",run.id);
  return j({run:run.id,grounded:run.grounded,processed:res.map(x=>x.status==="fulfilled"?x.value:"error"),remaining:count});
 }catch(e){return j({error:String((e as Error).message||e)},500)}
});

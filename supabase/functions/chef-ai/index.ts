import { createClient } from "npm:@supabase/supabase-js@2";
const CORS={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
const DAILY_LIMIT=50, MODEL=Deno.env.get("GEMINI_MODEL")||"gemini-3.1-flash-lite";
const DISC="המתכונים הם המלצה בלבד, אינם מתייחסים לרגישויות ואלרגיות שונות, והאחריות על ההכנה והאכילה היא של המשתמש בלבד.";
const j=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});

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

async function gemini(prompt:string, schema:unknown){
 const key=Deno.env.get("GEMINI_API_KEY");
 const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${key}`,{method:"POST",headers:{"Content-Type":"application/json"},
  body:JSON.stringify({systemInstruction:{parts:[{text:SYS}]},contents:[{role:"user",parts:[{text:prompt}]}],generationConfig:{responseMimeType:"application/json",responseSchema:schema,temperature:0.7,maxOutputTokens:16000}})});
 if(!r.ok) throw new Error("gemini "+r.status+": "+(await r.text()).slice(0,300));
 const d=await r.json(); const t=d?.candidates?.[0]?.content?.parts?.map((p:any)=>p.text||"").join("");
 if(!t) throw new Error("empty AI response");
 return JSON.parse(t);
}
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
const toAI=(d:any)=>({n:d.n,e:d.e,type:d.type,min:d.min,ing:d.ing,stages:d.stages?Object.entries(d.stages).map(([name,steps])=>({name,steps})):[{name:"הכנה",steps:d.steps||[]}],tips:d.tips||[],ahead:d.ahead||""});

// ===== Shared recipe library (layer 1) =====
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
async function libFind(admin:any,key:any,b:any){
 const ex=new Set((Array.isArray(b.exclude)?b.exclude:[]).map((x:unknown)=>String(x)).slice(0,100));
 const {data,error}=await admin.from("recipe_library").select("id,adults,children,dishes,ready,rating_avg,rating_count,use_count").eq("req_key",key.req_key).order("created_at",{ascending:false}).limit(200);
 if(error||!data) return null;
 const ok=data.filter((r:any)=>!ex.has(r.id)&&!(r.rating_count>=3&&+r.rating_avg<5));
 if(!ok.length) return null;
 const A=+b.adults||0,C=+b.children||0, same=ok.filter((r:any)=>r.adults===A&&r.children===C);
 const pool=(same.length?same:ok).map((r:any)=>({r,sc:(r.rating_count?+r.rating_avg:7)+Math.random()*0.01}));
 pool.sort((x:any,y:any)=>y.sc-x.sc);
 const top=pool.slice(0,5), pick=top[Math.floor(Math.random()*top.length)].r;
 const sameServ=pick.adults===A&&pick.children===C;
 return {...pick,ready:(pick.ready||[]).map((x:any)=>sameServ?x:{...x,qty:""})};
}
async function libNames(admin:any,key:any){
 const {data}=await admin.from("recipe_library").select("dishes").eq("style_key",key.style_key).eq("diet_key",key.diet_key).order("created_at",{ascending:false}).limit(15);
 return [...new Set((data||[]).flatMap((r:any)=>(r.dishes||[]).map((d:any)=>d.n)))].slice(0,30) as string[];
}

Deno.serve(async req=>{
 if(req.method==="OPTIONS") return new Response("ok",{headers:CORS});
 try{
  const auth=req.headers.get("Authorization")||"";
  const url=Deno.env.get("SUPABASE_URL")!;
  const userClient=createClient(url,Deno.env.get("SUPABASE_ANON_KEY")!,{global:{headers:{Authorization:auth}}});
  const {data:{user}}=await userClient.auth.getUser(auth.replace(/^Bearer\s+/i,""));
  if(!user) return j({error:"unauthorized"},401);
  const admin=createClient(url,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const b=await req.json(); const a=b.action;
  const st=Array.isArray(b.styles)?b.styles.slice(0,15).map((x:unknown)=>s(x).slice(0,40)).filter(Boolean):[];
  const key=a==="suggest_meal"?libKey(b,st):null, fresh=b.fresh===true;
  if(key&&!fresh){
   const hit=await libFind(admin,key,b);
   if(hit){ await admin.rpc("recipe_library_hit",{lid:hit.id}); return j({dishes:hit.dishes,ready:hit.ready,source:"library",library_id:hit.id,rating:hit.rating_count?+hit.rating_avg:null,rating_count:hit.rating_count,disclaimer:DISC}); }
  }
  const {data:calls,error:rl}=await admin.rpc("bump_ai_usage",{uid:user.id,lim:DAILY_LIMIT});
  if(rl) return j({error:rl.message.includes("rate_limit")?"rate_limit":"usage_error",limit:DAILY_LIMIT},429);
  if(a==="suggest_meal"&&key){
   const avoid=fresh?await libNames(admin,key):[];
   const p=`תכנן ארוחה. סגנונות/אילוצים שנבחרו: ${st.length?st.join(", "):"לא נבחרו"}. תיאור חופשי: "${s(b.free_text)||s(b.cuisine,"ביתי")}", ${+b.adults||0} מבוגרים ו-${+b.children||0} ילדים, שעת ארוחה ${s(b.time,"19:30")}. הערות: ${s(b.notes,"אין")}.
החזר 3-4 מנות להכנה (עיקרית + תוספות/סלט) עם מתכונים מלאים, ו-2-3 פריטים מומלצים לקנייה מוכנה (store = סוג חנות כללי, qty = כמות מומלצת לכל המשתתפים).${fresh?`
המשתמש ביקש "הפתע אותי במנה חדשה": הצע ארוחה חדשנית ועדכנית – שילובי טעמים מקוריים, טכניקות ומגמות קולינריות עכשוויות וחומרי גלם עונתיים – שעדיין מעשית להכנה ביתית ועומדת בכל האילוצים.${avoid.length?` אל תחזור על המנות הבאות שכבר הוצעו: ${avoid.join(", ")}.`:""}`:""}`;
   const out=await gemini(p,{type:"OBJECT",properties:{dishes:{type:"ARRAY",items:DISH},ready:{type:"ARRAY",items:READY}},required:["dishes","ready"]});
   const dishes=(out.dishes||[]).map(normDish).slice(0,6);
   if(!dishes.length) throw new Error("no dishes");
   const ready=(out.ready||[]).slice(0,6).map((r:any)=>({n:s(r.n),e:s(r.e,"🛍️").slice(0,8),store:s(r.store,"חנות אוכל מוכן"),qty:s(r.qty)}));
   const {data:row,error:se}=await admin.from("recipe_library").insert({...key,adults:+b.adults||0,children:+b.children||0,
    request:{styles:st,free_text:s(b.free_text).slice(0,200),cuisine:s(b.cuisine).slice(0,200),time:s(b.time),notes:s(b.notes).slice(0,300)},
    dishes,ready,model:MODEL,fresh,created_by:user.id}).select("id").single();
   if(se) console.error("library save",se.message);
   return j({dishes,ready,calls,source:"ai",library_id:row?.id||null,disclaimer:DISC});
  }
  if(a==="refine_dish"){
   const p=`עדכן את המתכון הבא לפי בקשת המשתמש: "${s(b.note)}"${b.extra?` (המשתמש יוסיף ${+b.extra} מנות – אין צורך לשנות כמויות למנה)`:""}. שמור על אותו מבנה; שנה מרכיבים/כמויות/שלבים לפי הצורך ובשדה changes כתוב 1-5 משפטים קצרים בעברית שמתארים בדיוק מה שונה (למשל "הוספתי 1 כף דבש למנה", "הגדלתי את הפפריקה ל-½ כפית למנה"). אל תוסיף טיפ שמתאר את השינוי.\nמתכון:\n${JSON.stringify(toAI(b.dish)).slice(0,12000)}`;
   const out=await gemini(p,{type:"OBJECT",properties:{dish:DISH,changes:{type:"ARRAY",items:{type:"STRING"}}},required:["dish","changes"]});
   const changes=(Array.isArray(out.changes)?out.changes:[]).map((x:unknown)=>s(x).slice(0,200)).filter(Boolean).slice(0,6);
   return j({dish:normDish(out.dish),changes,calls});
  }
  if(a==="add_custom_dish"){
   const p=`כתוב מתכון מלא למנה "${s(b.name)}".${b.text?` פרטים מהמשתמש (מרכיבים/שלבים/העדפות – התבסס עליהם): ${s(b.text)}`:""}${b.cuisine?` סגנון הארוחה: ${s(b.cuisine)}.`:""}`;
   return j({dish:normDish(await gemini(p,DISH)),calls});
  }
  if(a==="ask_dish"){
   const p=`שאלת משתמש על המנה "${s(b.dish?.n)}": ${s(b.question)}\nענה בעברית, בקצרה ובמעשיות (עד 120 מילים), על סמך המתכון. אם השאלה נוגעת לאלרגיות/בריאות, המלץ להתייעץ עם איש מקצוע.\nמתכון:\n${JSON.stringify(toAI(b.dish)).slice(0,12000)}`;
   const out=await gemini(p,{type:"OBJECT",properties:{answer:{type:"STRING"}},required:["answer"]});
   return j({answer:s(out.answer)+"\n\n⚠️ "+DISC,calls});
  }
  return j({error:"unknown action"},400);
 }catch(e){ return j({error:String((e as Error).message||e)},500); }
});

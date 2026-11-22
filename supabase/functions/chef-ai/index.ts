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
- כבד מנהגים אזוריים ועדתיים ומסורות של קהילות שונות (יהודיות, מוסלמיות, נוצריות, דרוזיות); בחגים ומועדים העדף מאכלים מסורתיים ועמוד בכללי החג.
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
// ===== Holidays & seasons (keep identical in chef-ai and library-refresh) =====
const KOSHER="כשר: אין ערבוב בשר וחלב, ללא חזיר ופירות ים.";
const HALAL="חלאל: בשר ועוף חלאל בלבד, ללא חזיר ומוצריו, ללא אלכוהול (גם לא בבישול, יין, ליקר או תמצית וניל על בסיס אלכוהול), ללא ג׳לטין שאינו חלאל.";
const HOLIDAY_RULES:Record<string,string>={
 "ראש השנה":`ארוחת ראש השנה. ${KOSHER} שלב סימנים: תפוח בדבש, רימון, תמרים, סלק/תרד, כרתי (לוף), דלעת, גזר, ראש דג (אופציונלי); אוכל מתוק ולא חמוץ/מר; כבד את מנהגי העדות (ספרדי, אשכנזי, תימני וכו׳).`,
 "ערב יום כיפור (סעודה מפסקת)":`סעודה מפסקת לפני צום יום כיפור. ${KOSHER} ארוחה משביעה וקלה לעיכול: עוף/מרק עוף, קרפלך או אורז, פחמימות מורכבות; בלי מלוח, חריף או מתובל מדי ובלי קפאין, כדי לא לצמא בצום; להגיש כשעה-שעתיים לפני כניסת הצום.`,
 "מוצאי יום כיפור (שבירת צום)":`ארוחת שבירת צום יום כיפור. ${KOSHER} פותחים במשקה ובמשהו קל ומתוק (עוגה, תמרים, מים/תה), ואז ארוחה לא כבדה – נהוג חלבי קל (מאפים, ביצים, דגים, קוגל) לפי מנהג העדה.`,
 "סוכות":`ארוחת סוכות. ${KOSHER} מנות נוחות להגשה ולנשיאה לסוכה, ממולאים (ירקות או כרוב ממולא) כסמל לשפע, פירות וירקות של עונת האסיף, תבשילים חמימים.`,
 "חנוכה":`ארוחת חנוכה. ${KOSHER} חובה לפחות מנה מטוגנת בשמן (לביבות/לאטקס, סופגניות, כרובית מטוגנת, צ׳יפס ביתי וכד׳); מסורת מאכלי גבינה אפשרית רק אם הארוחה כולה חלבית.`,
 "ט״ו בשבט":`ארוחת ט״ו בשבט. ${KOSHER} שלב את שבעת המינים (חיטה, שעורה, גפן, תאנה, רימון, זית, תמר), פירות יבשים ואגוזים; מומלץ צמחוני/חלבי.`,
 "פורים":`סעודת פורים. ${KOSHER} אוכל חגיגי ושמח, אוזני המן כפריט מוכן או קינוח, קרפלך, מאכלי זרעים וקטניות (מנהג אסתר); אין אלכוהול כשיש ילדים.`,
 "פסח":`ארוחת פסח – כשר לפסח. ${KOSHER} אסור חמץ: אין חיטה, שעורה, שיפון, שיבולת שועל או כוסמין ומוצריהם (מלבד מצה וקמח מצה), אין שמרים, פירורי לחם, פסטה, קוסקוס, בורגול, רוטב סויה רגיל. ללא קטניות (אורז, תירס, שעועית, עדשים, חומוס, אפונה, סויה, שומשום, חרדל, קמח תירס) – אלא אם נבחר "פסח – כולל קטניות". פריטים מוכנים: רק בהכשר לפסח. שלב מאכלים מסורתיים (מרק עוף וקניידלך, דג/גפילטע, צלי, חרוסת, מצה בריי, עוגות ללא קמח).`,
 "פסח – כולל קטניות":`מותר להשתמש בקטניות בפסח (מנהג ספרדי/מזרחי) – אורז, קטניות וכו׳, אך עדיין ללא חמץ.`,
 "שבועות":`ארוחת שבועות – חלבית. ${KOSHER} ללא בשר ועוף; מאכלי חלב וגבינות (בלינצ׳ס, עוגת גבינה, פשטידות, לזניה, בורקס גבינה) ודגים.`,
 "חג המולד":`ארוחת חג המולד. שלב מסורת נוצרית-ערבית מקומית (גליל, נצרת, ירושלים, בית לחם: ממולאים, קובה, עוף/כבש בתנור עם אורז, מעמול, כעכ) ומסורת מערבית (עוף/הודו ממולא, ירקות צלויים, עוגיות ג׳ינג׳ר); ללא חזיר כברירת מחדל.`,
 "פסחא":`ארוחת פסחא. שלב מסורת נוצרית-ערבית מקומית (מעמול בתמרים ובאגוזים, טלה/כבש, ממולאים, ביצים צבועות) ומסורת מערבית (טלה צלוי, לחם פסחא מתוק); ללא חזיר כברירת מחדל.`,
 "רמדאן – אפטאר":`ארוחת אפטאר לשבירת צום הרמדאן בשקיעה. ${HALAL} פותחים בתמרים ומים/חלב או משקה (תמר הינדי, קמר א-דין), אחר כך מרק (שורבת עדשים), סלט (פטוש), סמבוסק, מנה עיקרית ביתית (מקלובה, מנסף, ממולאים) וקינוח (קטאייף).`,
 "רמדאן – סחור":`ארוחת סחור לפני עלות השחר ברמדאן. ${HALAL} משביעה ומשחררת אנרגיה לאט, לא מלוחה ולא חריפה (כדי לא לצמא), עשירה בנוזלים: לבנה, ביצים, פול, חומוס, זעתר ושמן זית, זיתים, שיבולת שועל, תמרים, מלפפון ועגבנייה. הכנה קצרה.`,
 "עיד אל-פיטר":`ארוחת עיד אל-פיטר. ${HALAL} ארוחה משפחתית חגיגית: מעמול וכעכ, קטאייף, מקלובה, מנסף, ממולאים, כבש או עוף.`,
 "עיד אל-אדחא":`ארוחת עיד אל-אדחא. ${HALAL} מרכזה בשר כבש או בקר (קורבן): כבש בתנור, מנסף, פתה, קבב; לצד אורז, סלטים ומעמול.`,
 "עיד אל-אדחא (דרוזי)":`ארוחת עיד אל-אדחא לפי מסורת העדה הדרוזית (גליל וכרמל). ללא חזיר וללא אלכוהול. כבש או עוף, מנסף או מקלובה, קובה, ממולאים, פיתה דרוזית עם לבנה וזעתר, מעמול וכנאפה.`,
 "הקפדה דתית מחמירה":`הקפד על דיוק דתי מחמיר לפי החג/הקהילה: לכשרות – כשרות מהדרין, בדיקת ירקות עליים מחרקים, הפרדה מלאה בין בשר לחלב, פריטים מוכנים בהשגחה מתאימה; לחלאל – הכשר חלאל לכל מוצר; אם יש ספק – בחר במנהג המחמיר והזכר זאת בטיפים.`,
};
const OPT_FLAGS=["פסח – כולל קטניות","הקפדה דתית מחמירה"];
function holidayRules(st:string[]){const r=st.filter(x=>HOLIDAY_RULES[x]).map(x=>"• "+x+": "+HOLIDAY_RULES[x]);return r.length?"\nכללי חג/מועד מחייבים (גוברים על המלצות אחרות):\n"+r.join("\n"):""}
const MONTH_IL=["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];
const SEASON_PRODUCE=["הדרים (קלמנטינות, תפוזים, פומלה), אבוקדו, תותים, כרובית, ברוקולי, כרוב, קולרבי, סלק, גזר, תרד, מנגולד, שומר, ארטישוק ירושלמי","הדרים, תותים, אבוקדו, כרובית, ברוקולי, כרוב, סלק, שומר, פול ואפונה ירוקים, עשבי תיבול","תותים, ארטישוק, פול ואפונה ירוקים, שעועית ירוקה, שסק, עשבי תיבול, תפוזים אחרונים","ארטישוק, שסק, שעועית ירוקה, קישואים, עשבי תיבול, נענע, שקדים ירוקים","שסק, משמש, דובדבנים, קישואים, עגבניות, מלפפונים, תירס","אבטיח, מלון, אפרסקים, נקטרינות, שזיפים, משמש, עגבניות, מלפפונים, חצילים, פלפלים, תירס","אבטיח, מלון, ענבים, תאנים, מנגו, שזיפים, עגבניות, חצילים, פלפלים, תירס, במיה","ענבים, תאנים, מנגו, אבטיח, צבר, חצילים, במיה, דלעת ראשונה","רימונים, תמרים, תאנים, ענבים, תפוחים, חבושים, דלעת, בטטה, חצילים","רימונים, תמרים, תפוחים, אגסים, חבושים, אפרסמון, דלעת, בטטה, זיתים","רימונים, אפרסמון, הדרים ראשונים, אבוקדו, תפוחים, דלעת, בטטה, כרובית, ברוקולי, פטריות","הדרים, אבוקדו, תותים ראשונים, כרובית, ברוקולי, כרוב, סלק, קולרבי, תרד, פטריות"];
function season(d=new Date()){
 const m=+new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jerusalem",month:"numeric"}).format(d)-1;
 const name=m<=1||m===11?"חורף":m<=4?"אביב":m<=7?"קיץ":"סתיו", cold=m>=10||m<=2; // key bucket: Nov–Mar cold, Apr–Oct warm
 const weather=cold?"מזג אוויר קריר-חורפי: העדף מרקים, תבשילים, קדירות, צלי ומנות חמות ומנחמות":(m>=5&&m<=8)?"קיץ ישראלי חם: העדף מנות קלות, קרות ורעננות, סלטים, גריל ומרקים קרים; הימנע ממנות כבדות ומבישול ארוך בתנור":"מזג אוויר נעים: שלב מנות קלות וחמות במידה";
 return {bucket:cold?"קר":"חם",name,line:`\nעונה בישראל: ${name} (${MONTH_IL[m]}). ${weather}. העדף ירקות ופירות בעונתם: ${SEASON_PRODUCE[m]}.`};
}
const DIETS=["כשר","חלבי","בשרי","צמחוני","טבעוני","ללא גלוטן","מהיר עד 30 דק׳",...OPT_FLAGS];
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
 const se=season(b&&b.season_date?new Date(b.season_date+"T12:00:00Z"):undefined).bucket;
 return {req_key:[style_key,diet_key,meal_slot,has_kids?"kids":"adults",notes_key,se].join("|"),style_key,diet_key,meal_slot,has_kids,notes_key,season:se};
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
החזר 3-4 מנות להכנה (עיקרית + תוספות/סלט) עם מתכונים מלאים, ו-2-3 פריטים מומלצים לקנייה מוכנה (store = סוג חנות כללי, qty = כמות מומלצת לכל המשתתפים).${holidayRules(st)}${season().line}${fresh?`
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

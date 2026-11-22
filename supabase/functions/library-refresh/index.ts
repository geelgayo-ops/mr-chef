// library-refresh: weekly automatic growth of the shared recipe library (layer 3).
// Called by pg_cron (pg_net) with header x-refresh-secret. verify_jwt=false.
// Body: {start:true[,force:true]} creates a run (grounded trends + plan) then processes a batch; {} processes the next batch of the open run.
// NOTE: SYS/DISC/schemas/normDish/libKey below are copied from chef-ai/index.ts – keep in sync.
import { createClient } from "npm:@supabase/supabase-js@2";
const MODEL=Deno.env.get("GEMINI_MODEL")||"gemini-3.1-flash-lite";
const PLAN_N=40, MAX_ITEMS=56, BATCH=4; // 30 coverage items (one per chip) + 10 weighted extras; ~10 steps of 4
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
- כבד מנהגים אזוריים ועדתיים ומסורות של קהילות שונות (יהודיות, מוסלמיות, נוצריות, דרוזיות); בחגים ומועדים העדף מאכלים מסורתיים ועמוד בכללי החג.
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
const DIET_CHIPS=["כשר","צמחוני","טבעוני","ללא גלוטן","חלבי","בשרי","מהיר עד 30 דק׳"];
const ALL_CHIPS=[...STYLE_CHIPS,...DIET_CHIPS]; // all 30 chips in the app
const MORNING_OK=['ביתי ישראלי','בריא/קליל','חלבי','צמחוני','טבעוני','כשר','ללא גלוטן','מהיר עד 30 דק׳','ים תיכוני'];
function slotFor(style:string):[string,string,number]{
 if(style==="בראנץ׳")return["בוקר","10:00",1];
 if(style==="ארוחת שישי/חג"||style==="חגיגי/אירוח")return["ערב","19:30",1];
 if(style==="פיקניק")return["צהריים","13:00",1];
 const pool=MORNING_OK.includes(style)?SLOT_POOL:SLOT_POOL.filter(x=>x[0]!=="בוקר"); // no "Chinese stir-fry for breakfast"
 return wpick(pool,x=>x[2]);
}
// Build the request exactly like the client does for these chips: cuisine = chips joined by " · " (single chip => chip name).
function mkReq(style:string,diet:string,kids:boolean,slot:[string,string,number]){
 const styles=[style,diet].filter(Boolean);
 return {styles,free_text:"",cuisine:styles.join(" · "),adults:kids?2:4,children:kids?2:0,time:slot[1],notes:""};
}
// Holiday dates 2026–2028 (first day, civil date). Hebrew: ICU Hebrew calendar, verified vs hebcal.com; Islamic: islamic-umalqura (±1 day, moon sighting); Easter: Western + Orthodox computus; Christmas: Dec 25 + Orthodox Jan 7.
const HOLIDAYS:[string,string,number][]=[["2026-01-07","xmas_e",1],["2026-02-02","tubishvat",1],["2026-02-18","ramadan",30],["2026-03-03","purim",1],["2026-03-20","fitr",3],["2026-04-02","pesach",7],["2026-04-05","easter",1],["2026-04-12","easter_e",1],["2026-05-22","shavuot",1],["2026-05-27","adha",4],["2026-09-12","rosh",2],["2026-09-21","kippur",1],["2026-09-26","sukkot",7],["2026-12-05","hanukkah",8],["2026-12-25","xmas",1],["2027-01-07","xmas_e",1],["2027-01-23","tubishvat",1],["2027-02-08","ramadan",30],["2027-03-09","fitr",3],["2027-03-23","purim",1],["2027-03-28","easter",1],["2027-04-22","pesach",7],["2027-05-02","easter_e",1],["2027-05-16","adha",4],["2027-06-11","shavuot",1],["2027-10-02","rosh",2],["2027-10-11","kippur",1],["2027-10-16","sukkot",7],["2027-12-25","hanukkah",8],["2027-12-25","xmas",1],["2028-01-07","xmas_e",1],["2028-01-28","ramadan",30],["2028-02-12","tubishvat",1],["2028-02-26","fitr",3],["2028-03-12","purim",1],["2028-04-11","pesach",7],["2028-04-16","easter",1],["2028-04-16","easter_e",1],["2028-05-05","adha",4],["2028-05-31","shavuot",1],["2028-09-21","rosh",2],["2028-09-30","kippur",1],["2028-10-05","sukkot",7],["2028-12-13","hanukkah",8],["2028-12-25","xmas",1]];
const HOLIDAY_CHIPS:Record<string,string[]>={"rosh": ["ראש השנה"], "kippur": ["ערב יום כיפור (סעודה מפסקת)", "מוצאי יום כיפור (שבירת צום)"], "sukkot": ["סוכות"], "hanukkah": ["חנוכה"], "tubishvat": ["ט״ו בשבט"], "purim": ["פורים"], "pesach": ["פסח"], "shavuot": ["שבועות"], "xmas": ["חג המולד"], "xmas_e": ["חג המולד"], "easter": ["פסחא"], "easter_e": ["פסחא"], "ramadan": ["רמדאן – אפטאר", "רמדאן – סחור"], "fitr": ["עיד אל-פיטר"], "adha": ["עיד אל-אדחא", "עיד אל-אדחא (דרוזי)"]};
function upcomingHolidays(now=new Date(),ahead=21){
 const today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(now), t0=Date.parse(today+"T00:00:00Z");
 const res:{date:string,chip:string}[]=[],seen=new Set<string>();
 for(const [d,id,days] of HOLIDAYS){const t=Date.parse(d+"T00:00:00Z"),diff=(t-t0)/864e5;
  if(diff<=ahead&&diff+days>0) for(const chip of HOLIDAY_CHIPS[id]||[]) if(!seen.has(chip)){seen.add(chip);res.push({date:diff<0?today:d,chip})}}
 return res;
}
function holidayVariants(chip:string):[string,boolean][]{
 if(chip==="רמדאן – סחור")return[["04:30",false],["04:30",true]];
 if(chip==="רמדאן – אפטאר")return[["17:30",true],["17:30",false]];
 if(chip.startsWith("ערב יום כיפור"))return[["15:30",true],["16:30",false]];
 if(chip.startsWith("מוצאי יום כיפור"))return[["18:30",true],["18:30",false]];
 if(chip.startsWith("עיד אל-אדחא")&&chip.includes("דרוזי"))return[["13:00",true],["19:30",false]];
 return[["19:30",true],["19:30",false],["13:00",true]];
}
async function plan(admin:any,trendList:any[]){
 const {data:lib}=await admin.from("recipe_library").select("style_key,diet_key").limit(5000);
 const have=new Map<string,number>(); for(const r of lib||[]){const k=r.style_key+"|"+r.diet_key;have.set(k,(have.get(k)||0)+1)}
 const cnt=(req:any)=>{const k=libKey(req,req.styles);return have.get(k.style_key+"|"+k.diet_key)||0};
 const out:any[]=[],seen=new Set<string>();
 const add=(req:any,coverage:string|null)=>{const k=libKey(req,req.styles).req_key;if(seen.has(k))return false;seen.add(k);
  const tr=trendList[out.length%Math.max(1,trendList.length)];
  out.push({req,coverage,trend:tr?`${s(tr.name)} – ${s(tr.desc)}`.slice(0,300):null});return true};
 // 1) coverage: one meal per chip (chip alone = its own key, the most common single-chip request); missing chips first
 const cov=ALL_CHIPS.map(ch=>{const isDiet=DIET_CHIPS.includes(ch);const kids=ch==="ילדים אוהבים"||Math.random()<0.4;
  return mkReq(isDiet?"":ch,isDiet?ch:"",kids,slotFor(ch))}).map(r=>({r,c:cnt(r)})).sort((a,b)=>a.c-b.c);
 for(const {r} of cov) for(let t=0;t<6&&!add(r,r.styles[0]);t++){r.time=slotFor(r.styles[0])[1]}
 // 1b) upcoming holidays (next ~3 weeks): a few traditional meals per holiday chip, no trend hint
 let hol=0;
 for(const h of upcomingHolidays()) for(const [time,kids] of holidayVariants(h.chip)){
  const req={styles:[h.chip],free_text:"",cuisine:h.chip,adults:kids?2:4,children:kids?2:0,time,notes:"",season_date:h.date};
  const k=libKey(req,req.styles).req_key; if(seen.has(k))continue; seen.add(k); hol++;
  out.push({req,coverage:"holiday:"+h.chip,trend:null});
 }
 // 2) fill: weighted variety (style + optional diet), preferring style/diet combos absent from the library
 for(let t=0;out.length<PLAN_N+hol&&t<PLAN_N*20;t++){
  const style=wpick(STYLE_CHIPS,x=>POPULAR.includes(x)?3:1);
  const diet=wpick(DIET_POOL,x=>x[1])[0];
  const kids=style==="ילדים אוהבים"||Math.random()<0.5;
  const req=mkReq(style,diet,kids,slotFor(style));
  if(cnt(req)>0&&Math.random()<0.6)continue; // prefer combos the library lacks
  add(req,null);
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
זו ארוחת ${key.meal_slot==="בוקר"?"בוקר":key.meal_slot==="צהריים"?"צהריים":"ערב"} – התאם את המנות לסוג הארוחה ולסגנון שנבחר (מנות אותנטיות לסגנון).${holidayRules(st)}${season(b.season_date?new Date(b.season_date+"T12:00:00Z"):undefined).line}
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
  if(body.dry_run){
   const items=await plan(admin,[]);
   const covered=new Set(items.map((x:any)=>x.coverage).filter(Boolean));
   return j({dry_run:true,planned:items.length,steps:Math.ceil(items.length/BATCH),missing_chips:ALL_CHIPS.filter(c=>!covered.has(c)),
    items:items.map((x:any)=>({coverage:x.coverage,key:libKey(x.req,x.req.styles).req_key,adults:x.req.adults,children:x.req.children,time:x.req.time}))});
  }
  if(body.start){
   const hr=+new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jerusalem",hour:"2-digit",hourCycle:"h23"}).format(new Date());
   if(!body.force&&hr!==6) return j({skipped:"not 06:00 Asia/Jerusalem (DST guard)",hour:hr});
   if(run) return j({skipped:"a run is already open",run:run.id});
   const {data:recent}=await admin.from("library_refresh_runs").select("id").gte("started_at",new Date(Date.now()-20*3600e3).toISOString()).limit(1);
   if(!body.force&&recent&&recent.length) return j({skipped:"already ran in the last 20h"});
   const T=await trends();
   const items=await plan(admin,T.list);
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

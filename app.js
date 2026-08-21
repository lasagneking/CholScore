
const STORAGE_KEY = "cholscore_v02";
const LEGACY_KEY = "cholscore_v01";
const APP_VERSION = "175"; // bump alongside every other ?v= reference on each deploy — used to cache-bust dynamically-loaded assets like the share templates below, which don't go through index.html's own ?v= query strings
/* Always use this instead of date.toISOString().slice(0,10) for turning a
   Date into a "YYYY-MM-DD" key. toISOString() converts to UTC first, which
   silently shifts the date by a day for anyone in a positive UTC offset
   (e.g. the UK during BST) — most dangerously in mondayKeyFor(), which forces
   the calculation to local midnight before converting, making it wrong at
   EVERY hour of the day, not just near a real midnight boundary. This reads
   the year/month/day directly from local time, so it's never wrong. */
function localDateKey(dateLike=new Date()){
  const d=new Date(dateLike);
  const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,"0"),dd=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${dd}`;
}
const todayKey = () => localDateKey();

const defaultState = {
  profile: null,
  days: {},
  routines: [],
  activeWorkout: null,
  achievements: { firstFood:false, firstMove:false, onTarget:false, score80:false },
  rewardBank: { spentPoints: 0, goal: null, history: [] },
  vacationMode: { active: false, since: null },
  vacationHistory: [],
  // Defaults to unlocked — there's no real purchase path yet (that needs
  // Capacitor + StoreKit), so locking this by default would cut off ongoing
  // daily use for no reason. Once real purchases exist, new installs should
  // default to false instead; existing users who already paid stay unlocked
  // via their own stored receipt/entitlement at that point, not this flag.
  premium: { unlocked: true }
};

let state = loadState();
let selectedTarget = 30;
let onboardingPhoto = null;
let selectedDistanceUnit = "mi";
let selectedFeeling = 3;
let finishFeeling = 3;
let calendarDate = new Date();
let workoutTimer = null;
let timedSetTimer = null;
let timedCountdownTimer = null;
let barcodeScanner = null;
let currentProduct = null;
let scannerPurpose = "add";
let checkedProduct = null;
let editingRoutineId = null;
let activeRewardCategory = "all";
let currentFoodDetailId = null;
let currentFoodDetailRef = null;

function cloneDefault(){ return JSON.parse(JSON.stringify(defaultState)); }
function loadState(){
  try {
    const fresh = localStorage.getItem(STORAGE_KEY);
    if(fresh) return normaliseState(JSON.parse(fresh));
    const legacy = localStorage.getItem(LEGACY_KEY);
    if(legacy){
      const migrated = normaliseState(JSON.parse(legacy));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  } catch(e){}
  return cloneDefault();
}
function normaliseState(s){
  const d=cloneDefault();

  // Upgrade legacy food records created before food IDs were introduced.
  if(s?.days){
    for(const day of Object.values(s.days)){
      if(Array.isArray(day?.foods)){
        day.foods=day.foods.map(food=>({
          ...food,
          id: food.id || id()
        }));
      }
    }
  }
  const profile=s?.profile ? {...s.profile, distanceUnit:(s.profile.distanceUnit==="km"?"km":"mi")} : null;
  return {
    ...d,...s,
    profile,
    routines:Array.isArray(s?.routines)?s.routines:[],
    activeWorkout:s?.activeWorkout||null,
    achievements:{...d.achievements,...(s?.achievements||{})},
    rewardBank:{...d.rewardBank,...(s?.rewardBank||{}),goal:(s?.rewardBank?.goal||null),history:Array.isArray(s?.rewardBank?.history)?s.rewardBank.history:[]}
  };
}
function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function ensureDay(key=todayKey()){
  if(!state.days[key]) state.days[key] = { foods:[], activities:[], checkedOut:false, finalScore:null };
  return state.days[key];
}
function getDay(key=todayKey()){
  return state.days[key] || {foods:[],activities:[],checkedOut:false,finalScore:null};
}
const $ = id=>document.getElementById(id);
const qsa = (sel,root=document)=>[...root.querySelectorAll(sel)];

/* v1.7.2 — lock background scroll while any dialog is open. Native <dialog>
   does NOT reliably prevent the page underneath from scrolling on mobile
   Safari (a well-known platform quirk), so without this, touch-scrolling
   inside or near an open dialog can scroll the page behind it instead.
   Patches showModal() once here so every dialog in the app is covered
   automatically — including ones added in future — rather than needing a
   scroll-lock call at every individual showModal() site. Cleanup listens
   for the dialog's native 'close' event (captured, since 'close' doesn't
   bubble) so it correctly unlocks however the dialog closed: a JS .close()
   call, Esc key, or a <form method="dialog"> submit — not just the cases
   this code explicitly triggers. An open counter handles stacked dialogs
   (a dialog opened from within another dialog) so the lock only lifts once
   the last one is actually closed. */
(function lockBodyScrollForDialogs(){
  let openCount=0,savedScrollY=0;
  const nativeShowModal=HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal=function(...args){
    if(openCount===0){
      savedScrollY=window.scrollY||window.pageYOffset||0;
      document.body.classList.add("dialog-scroll-lock");
      document.body.style.top=`-${savedScrollY}px`;
    }
    openCount++;
    return nativeShowModal.apply(this,args);
  };
  document.addEventListener("close",e=>{
    if(!(e.target instanceof HTMLDialogElement))return;
    openCount=Math.max(0,openCount-1);
    if(openCount===0){
      document.body.classList.remove("dialog-scroll-lock");
      document.body.style.top="";
      window.scrollTo(0,savedScrollY);
    }
  },true);
})();

function esc(s=""){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}

function distanceUnit(){
  return state.profile?.distanceUnit==="km" ? "km" : "mi";
}
function unitLong(){
  return distanceUnit()==="km" ? "kilometres" : "miles";
}
function kmToDisplay(km){
  const n=Number(km||0);
  return distanceUnit()==="km" ? n : n*0.621371;
}
function displayToKm(value){
  const n=Number(value||0);
  return distanceUnit()==="km" ? n : n/0.621371;
}
function distanceText(km){
  return `${fmt(kmToDisplay(km))} ${distanceUnit()}`;
}
function achievementDistanceValue(km){
  return kmToDisplay(km);
}

function fmt(n){return Number(n||0).toLocaleString(undefined,{minimumFractionDigits:1,maximumFractionDigits:1});}
function fmtInt(n){return Math.round(Number(n||0)).toLocaleString();}
function feelEmoji(n){return ["","😣","😕","😐","🙂","😄"][Number(n)||3];}
function id(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}
function greeting(){const h=new Date().getHours();return h<12?"Good morning":h<18?"Good afternoon":"Good evening";}
function minutesBetween(start,finish){
  const [sh,sm]=start.split(":").map(Number),[fh,fm]=finish.split(":").map(Number);
  let mins=(fh*60+fm)-(sh*60+sm); if(mins<0) mins+=1440; return mins;
}
function elapsedMinutes(startedAt,endedAt=Date.now()){
  return Math.max(0,Math.round((endedAt-new Date(startedAt).getTime())/60000));
}
function formatExerciseSeconds(total){
  const sec=Math.max(0,Math.round(Number(total||0)));
  const m=Math.floor(sec/60),s=sec%60;
  return m?`${m}:${String(s).padStart(2,"0")}`:`${s}s`;
}
function clearTimedSetTimers(){
  clearInterval(timedSetTimer);timedSetTimer=null;
  clearInterval(timedCountdownTimer);timedCountdownTimer=null;
}
function elapsedClock(startedAt){
  const sec=Math.max(0,Math.floor((Date.now()-new Date(startedAt).getTime())/1000));
  const h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  return h?`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`:`${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function totals(day=getDay()){
  const sat=day.foods.reduce((a,b)=>a+Number(b.sat||0),0);
  const mins=day.activities.reduce((a,b)=>a+Number(b.minutes||0),0);
  return {sat,mins,activities:day.activities.length};
}
function scoreDay(day=getDay()){
  if(!state.profile) return 0;
  const {sat,mins,activities}=totals(day), target=Number(state.profile.target||30), ratio=sat/target;
  let foodScore=0;
  if(day.foods.length===0) foodScore=0;
  else if(ratio<=.75) foodScore=50;
  else if(ratio<=1) foodScore=50-((ratio-.75)/.25)*10;
  else if(ratio<=1.25) foodScore=40-((ratio-1)/.25)*20;
  else foodScore=Math.max(0,20-((ratio-1.25)/.75)*20);
  const moveBase=Math.min(25,mins/45*25);
  const participation=activities?10:0;
  const consistency=(day.foods.length?5:0)+(activities?5:0);
  return Math.max(0,Math.min(100,Math.round(foodScore+moveBase+participation+consistency)));
}
const SCORE_BANDS=[
  {min:90,label:"Outstanding"},
  {min:80,label:"Flying"},
  {min:70,label:"Great day"},
  {min:55,label:"Building momentum"},
  {min:35,label:"Good start"},
  {min:0,label:"Getting started"},
];
function scoreLabel(s){return SCORE_BANDS.find(b=>s>=b.min).label;}

function init(){
  if(!state.profile){
    $("onboarding").classList.remove("hidden");$("mainApp").classList.add("hidden");
  }else{
    $("onboarding").classList.add("hidden");$("mainApp").classList.remove("hidden");
    ensureDay(); renderAll(); renderHeaderAvatar();
    if(state.activeWorkout) showActiveWorkoutBanner();
    syncLocalNotifications();
  }
  /* Splash dismissal is now handled entirely natively via launchShowDuration
     in capacitor.config.ts (currently 2200ms + 350ms fade). Previously this
     also fired a manual SplashScreen.hide() call from here — but with
     launchAutoHide:true, that created a race between two independent
     dismiss triggers (native timer vs this JS timer), and whichever fired
     first won, which is what made the splash disappear inconsistently.
     hideNativeSplashScreen() is left defined below in case a future need
     for an explicit manual hide comes up, but it's deliberately not called
     from init() anymore. */
}
/* Only relevant when running as the native app — launchAutoHide is
   deliberately off in capacitor.config.ts, so the branded splash stays
   visible through cold launch until this fires, rather than handing off to
   a blank moment while the WebView is still starting up. Safe no-op on the
   plain web/PWA build, same pattern as syncLocalNotifications(). */
function hideNativeSplashScreen(){
  try{
    const SplashScreen=window.Capacitor?.Plugins?.SplashScreen;
    if(SplashScreen)SplashScreen.hide();
  }catch(e){/* never let this block the app from showing */}
}
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible"&&state.profile)syncLocalNotifications();
});

/* v1.30.0 local notifications. Deliberately local, not push — everything
   in this app has always been client-side with no server and no accounts,
   and push would mean standing up a backend purely to decide "should Lee
   get a reminder tonight," which fights the app's whole architecture for
   no real benefit local notifications don't already cover. Scheduled fresh
   every time the app opens (cold launch or returning from background)
   rather than once — a local notification set an hour ago can't know
   whether you've since checked out, so recomputing the full set each time
   is what keeps it honest rather than nagging about something already done.
   Fixed IDs per notification "slot" (1001/1002) mean each type only
   ever has one pending instance — cancelling everything before rescheduling
   is what guarantees a stale one (e.g. yesterday's check-out reminder)
   can never fire late. */
async function syncLocalNotifications(){
  try{
    if(!window.Capacitor?.isNativePlatform())return; // plain web/PWA context — no-op, nothing to schedule
    const LocalNotifications=window.Capacitor.Plugins?.LocalNotifications;
    if(!LocalNotifications)return;

    const perm=await LocalNotifications.checkPermissions();
    if(perm.display!=="granted"){
      const req=await LocalNotifications.requestPermissions();
      if(req.display!=="granted")return; // declined — respect it, don't ask again this session
    }

    const pending=await LocalNotifications.getPending();
    if(pending.notifications.length){
      await LocalNotifications.cancel({notifications:pending.notifications.map(n=>({id:n.id}))});
    }

    const notifications=[];
    const today=getDay();
    const now=new Date();

    // 1. Evening check-out reminder — 8pm, only if today isn't checked out yet
    if(!today.checkedOut){
      const at=new Date();at.setHours(20,0,0,0);
      if(at>now){
        notifications.push({id:1001,title:"Check out for today?",
          body:"A couple of minutes now locks in today's CholScore.",schedule:{at}});
      }
    }

    // 2. Streak-at-risk warning — 9:30pm, only with an active streak and nothing logged today
    const metrics=achievementMetrics();
    if(metrics.bestStreak>0&&!(today.foods?.length)&&!(today.activities?.length)){
      const at=new Date();at.setHours(21,30,0,0);
      if(at>now){
        notifications.push({id:1002,title:"Your streak needs you",
          body:"Log anything today to keep it going.",schedule:{at}});
      }
    }

    if(notifications.length)await LocalNotifications.schedule({notifications});
  }catch(e){
    // Never let a notification-scheduling hiccup affect the actual app —
    // this is a nice-to-have, not something core functionality depends on.
    console.warn("syncLocalNotifications failed:",e);
  }
}
function mondayKeyFor(dateLike=new Date()){
  const d=new Date(dateLike);
  d.setHours(0,0,0,0);
  const day=(d.getDay()+6)%7;
  d.setDate(d.getDate()-day);
  return localDateKey(d);
}

/* v1.13.0 Reward Bank — points are banked purely from saturated fat headroom
   on checked-out days: target minus consumed, direct, uncapped (1g under a
   day's limit = 1 point). Nothing to do with exercise minutes or the overall
   CholScore. Points are permanent once earned — the "earned" ledger below
   never shrinks; only cashing out a reward (which adds to
   state.rewardBank.spentPoints) reduces the available balance. This is a
   deliberately different, simpler rule than the old capped/scaled weekly
   formula it replaces. */
function dailyBankPoints(day){
  if(!day || !day.checkedOut || !day.foods?.length) return 0;
  const t=totals(day);
  const target=Number(state.profile?.target||30);
  return Math.max(0, Math.round(target - t.sat));
}
function lifetimeBankPoints(){
  let total=0;
  for(const day of Object.values(state.days)) total += dailyBankPoints(day);
  return total;
}
function availableBankPoints(){
  return Math.max(0, lifetimeBankPoints() - Number(state.rewardBank?.spentPoints||0));
}
function setRewardGoal(icon,name,target){
  state.rewardBank.goal = {icon, name:String(name).trim(), target:Math.max(1,Math.round(Number(target)||0)), createdAt:Date.now()};
  saveState();
}
function clearRewardGoal(){
  state.rewardBank.goal = null;
  saveState();
}
function cashOutReward(){
  const goal=state.rewardBank.goal;
  if(!goal || availableBankPoints() < goal.target) return false;
  state.rewardBank.spentPoints = Number(state.rewardBank.spentPoints||0) + goal.target;
  state.rewardBank.history = state.rewardBank.history || [];
  state.rewardBank.history.unshift({icon:goal.icon,name:goal.name,target:goal.target,claimedAt:Date.now(),dayKey:todayKey()});
  state.rewardBank.goal = null;
  saveState();
  return true;
}

function renderAll(){renderToday();renderFood();renderExercise();renderRewards();renderCalendar();if(!$("historyTrendsView").classList.contains("hidden"))renderTrends();if(!$("historyReportsView").classList.contains("hidden"))renderReports();}

function renderToday(){
  const day=getDay(),t=totals(day),score=scoreDay(day),target=Number(state.profile.target);
  $("greeting").textContent=`${greeting()}, ${state.profile.name}`;
  $("heroMessage").textContent=score>=80?"You're absolutely flying today.":score>=55?"Nice work, keep the momentum going.":"Every positive choice moves you forward.";
  $("satUsed").textContent=`${fmt(t.sat)}g`;$("satRemaining").textContent=`${fmt(Math.max(0,target-t.sat))}g`;
  $("moveMinutes").textContent=fmtInt(t.mins);$("activityCount").textContent=t.activities;
  $("dailyScore").textContent=score;$("scoreLabel").textContent=scoreLabel(score);
  $("satRing").style.setProperty("--pct",Math.min(100,t.sat/target*100));
  $("moveRing").style.setProperty("--pct",Math.min(100,t.mins/45*100));
  $("scoreRing").style.setProperty("--pct",score);

  const items=[...day.foods.map(x=>({...x,kind:"food"})),...day.activities.map(x=>({...x,kind:"activity"}))]
    .sort((a,b)=>(b.created||0)-(a.created||0));
  $("timelineCount").textContent=`${items.length} ${items.length===1?"item":"items"}`;
  $("timeline").classList.toggle("empty-state",!items.length);
  $("timeline").innerHTML=items.length?items.map(x=>x.kind==="food"
    ?`<div class="log-item food-log-item" data-food-id="${x.id||""}">
        <div class="food-log-main">
          ${x.image?`<img class="food-thumb" src="${esc(x.image)}" alt="${esc(x.name)}" loading="lazy">`:`<div class="food-thumb food-thumb-fallback">🍎</div>`}
          <div><strong>${esc(x.name)}</strong><small>${esc(x.meal)}${x.brand?` · ${esc(x.brand)}`:""}</small></div>
        </div>
        <div class="log-value">${fmt(x.sat)}g<br><small>sat fat</small></div>
      </div>`
    :`<div class="log-item"><div><strong>${x.type==="workout"?"🏋️":cardioIcon(x.type)} ${esc(x.name)}</strong><small>${x.minutes} min${x.distance?` · ${distanceText(x.distance)}`:""}${x.type==="workout"&&x.exerciseCount?` · ${x.exerciseCount} exercises`:""}</small></div><div class="log-value">${feelEmoji(x.feel)}</div></div>`
  ).join(""):"Nothing logged yet. Your first win starts here.";
  wireFoodCards();
  renderRewardBankCard();
}

function renderRewardBankCard(){
  const balance=availableBankPoints(),goal=state.rewardBank?.goal;
  if($("bankPoints")) $("bankPoints").textContent=fmtInt(balance);
  const goalText=$("bankGoalText"),goalBar=$("bankGoalBar"),goalBarFill=$("bankGoalBarFill");
  if(!goalText) return;
  if(goal){
    const remaining=Math.max(0,goal.target-balance);
    const pct=Math.min(100,Math.round(balance/goal.target*100));
    goalText.textContent=remaining>0?`${fmtInt(remaining)} points to go, ${goal.name} ${goal.icon}`:`Ready to cash out, ${goal.name} ${goal.icon}`;
    goalBar.classList.remove("hidden");
    goalBarFill.style.width=`${pct}%`;
  }else{
    goalText.textContent="Tap to set a goal";
    goalBar.classList.add("hidden");
  }
}

function wireFoodCards(){
  qsa("[data-food-id]").forEach(card=>{
    card.addEventListener("click",()=>{
      const fid=card.dataset.foodId;
      const day=getDay();
      const food=day.foods.find(x=>String(x.id||"")===String(fid));
      if(food) showFoodDetail(food);
    });
  });
}

function showFoodDetail(food){
  if(!food.id) food.id=id();
  currentFoodDetailId=food.id;
  currentFoodDetailRef=food;
  saveState();
  $("detailFoodName").textContent=food.name||"Food";
  $("detailFoodBrand").textContent=food.brand||"";
  $("detailFoodBarcode").textContent=food.barcode?`Barcode ${food.barcode}`:"";

  const img=$("detailFoodImage"),fallback=$("detailFoodFallback");
  if(food.image){
    img.src=food.image;img.alt=food.name||"Food";img.classList.remove("hidden");fallback.classList.add("hidden");
  }else{
    img.removeAttribute("src");img.classList.add("hidden");fallback.classList.remove("hidden");
  }

  $("detailFoodMeal").textContent=food.meal||"Not recorded";
  $("detailFoodSat").textContent=`${fmt(food.sat)}g`;
  $("detailFoodProtein").textContent=food.protein!=null?`${fmt(food.protein)}g`:"Not recorded";

  let amountText="Not recorded";
  if(food.amount!=null){
    if(food.amountUnit==="serving") amountText=`${food.amount} serving${Number(food.amount)===1?"":"s"}`;
    else amountText=`${food.amount}g`;
  }
  $("detailFoodAmount").textContent=amountText;
  $("detailFoodSource").textContent=food.source||"Manual";
  $("foodDetailDialog").showModal();
}

/* v1.7.0 Staples — quick one-tap re-add for foods the person logs
   repeatedly. Computed fresh from state.days every time (same principle as
   Personal Records / the Day Report), so it can never drift out of sync
   with actual history and needs no separate storage. Only foods logged at
   least twice qualify — a single one-off entry isn't really a "staple". */
function computeStapleFoods(minCount=2,limit=8){
  const groups={};
  for(const day of Object.values(state.days||{})){
    for(const f of day.foods||[]){
      const name=String(f.name||"").trim();if(!name)continue;
      const key=`${name.toLowerCase()}|${String(f.brand||"").trim().toLowerCase()}`;
      if(!groups[key])groups[key]={count:0,mealCounts:{},latest:f,latestCreated:f.created||0};
      const g=groups[key];
      g.count++;
      const meal=f.meal||"Snack";
      g.mealCounts[meal]=(g.mealCounts[meal]||0)+1;
      if((f.created||0)>=g.latestCreated){g.latest=f;g.latestCreated=f.created||0;}
    }
  }
  return Object.values(groups)
    .filter(g=>g.count>=minCount)
    .sort((a,b)=>b.count-a.count)
    .slice(0,limit)
    .map(g=>({...g.latest,_defaultMeal:Object.entries(g.mealCounts).sort((a,b)=>b[1]-a[1])[0]?.[0]||"Snack"}));
}
function quickAddStaple(f){
  if(!f)return;
  const entry={id:id(),name:f.name,meal:f._defaultMeal||"Snack",sat:Number(f.sat||0),created:Date.now(),source:f.source||"Manual"};
  if(f.brand)entry.brand=f.brand;
  if(f.barcode)entry.barcode=f.barcode;
  if(f.image)entry.image=f.image;
  if(f.protein!=null)entry.protein=Number(f.protein);
  if(f.amount!=null)entry.amount=f.amount;
  if(f.amountUnit)entry.amountUnit=f.amountUnit;
  ensureDay().foods.push(entry);
  state.achievements.firstFood=true;
  saveState();
  renderAll();
}
function renderStaples(){
  const section=$("staplesSection");if(!section)return;
  const staples=computeStapleFoods();
  if(!staples.length){section.classList.add("hidden");return;}
  section.classList.remove("hidden");
  $("staplesRow").innerHTML=staples.map((f,i)=>`
    <button type="button" class="staple-card" data-idx="${i}">
      ${f.image?`<img class="staple-thumb" src="${esc(f.image)}" alt="" loading="lazy">`:`<div class="staple-thumb staple-thumb-fallback">🍽️</div>`}
      <strong>${esc(f.name)}</strong>
      <small>${fmt(f.sat)}g sat fat</small>
    </button>`).join("");
  qsa(".staple-card",$("staplesRow")).forEach(btn=>btn.addEventListener("click",()=>quickAddStaple(staples[Number(btn.dataset.idx)])));
}

function renderFood(){
  renderStaples();
  const day=getDay(),t=totals(day),target=Number(state.profile.target);
  $("foodTotal").textContent=fmt(t.sat);$("foodTarget").textContent=fmt(target);$("foodBar").style.width=`${Math.min(100,t.sat/target*100)}%`;
  $("foodList").innerHTML=day.foods.length?day.foods.slice().reverse().map(x=>`
    <div class="log-item food-log-item" data-food-id="${x.id||""}">
      <div class="food-log-main">
        ${x.image?`<img class="food-thumb food-thumb-large" src="${esc(x.image)}" alt="${esc(x.name)}" loading="lazy">`:`<div class="food-thumb food-thumb-large food-thumb-fallback">🍎</div>`}
        <div>
          <strong>${esc(x.name)}</strong>
          <small>${esc(x.meal)}${x.brand?` · ${esc(x.brand)}`:""}</small>
        </div>
      </div>
      <div class="log-value">${fmt(x.sat)}g</div>
    </div>`).join(""):`<div class="empty-state">No food logged today.</div>`;
  wireFoodCards();
}

function renderProteinToday(day=getDay()){
  const foods=day.foods.filter(f=>Number(f.protein||0)>0);
  const total=foods.reduce((sum,f)=>sum+Number(f.protein||0),0);

  if($("proteinTodayTotal")) $("proteinTodayTotal").textContent=fmt(total);
  if($("proteinFoodCount")) $("proteinFoodCount").textContent=`From ${foods.length} logged ${foods.length===1?"food":"foods"}`;

  if(!$("proteinBreakdown")) return;
  if(!foods.length){
    $("proteinBreakdown").innerHTML=`<div class="empty-state">Protein from scanned foods will appear here.</div>`;
    return;
  }

  $("proteinBreakdown").innerHTML=foods.slice().reverse().map(f=>`
    <div class="protein-row">
      <div class="protein-row-main">
        ${f.image?`<img class="protein-thumb" src="${esc(f.image)}" alt="${esc(f.name)}" loading="lazy">`:`<div class="protein-thumb protein-thumb-fallback">🥚</div>`}
        <div>
          <strong>${esc(f.name)}</strong>
          <small>${esc(f.meal||"Food")}${f.brand?` · ${esc(f.brand)}`:""}</small>
        </div>
      </div>
      <b>${fmt(f.protein)}g</b>
    </div>
  `).join("");
}

function bestEverScore(){
  const days=Object.entries(state.days).filter(([_,d])=>d.checkedOut);
  return days.length?Math.max(...days.map(([_,d])=>Number(d.finalScore??scoreDay(d)))):scoreDay();
}
function renderExercise(){
  const day=getDay(),t=totals(day);
  $("exerciseMinutes").textContent=fmtInt(t.mins);$("exerciseBar").style.width=`${Math.min(100,t.mins/45*100)}%`;
  if($("distanceUnitLabel")) $("distanceUnitLabel").textContent=distanceUnit();
  renderProteinToday(day);
  renderRoutines();
  showActiveWorkoutBanner();
  $("exerciseList").innerHTML=day.activities.length?day.activities.slice().reverse().map(x=>`<div class="log-item activity-log-item"><div><strong>${x.type==="workout"?"🏋️":cardioIcon(x.type)} ${esc(x.name)}</strong><small>${x.type==="workout"?`${x.exerciseCount||0} exercises · `:""}${x.minutes} min${x.distance?` · ${distanceText(x.distance)}`:""}</small></div><div class="activity-log-right"><div class="log-value">${feelEmoji(x.feel)}</div><button type="button" class="activity-delete-btn" data-activity-id="${esc(x.id||"")}" aria-label="Delete this activity">🗑</button></div></div>`).join(""):`<div class="empty-state">No completed activity today.</div>`;
  wireActivityCards();
  renderPersonalRecords();
}
function wireActivityCards(){
  qsa(".activity-delete-btn").forEach(btn=>btn.addEventListener("click",()=>{
    const aid=btn.dataset.activityId,day=getDay();
    const idx=day.activities.findIndex(a=>String(a.id||"")===String(aid));
    if(idx===-1)return;
    const activity=day.activities[idx];
    if(!confirm(`Delete "${activity.name||"this activity"}" from today? This can't be undone.`))return;
    day.activities.splice(idx,1);
    saveState();
    renderAll();
  }));
}
function renderRoutines(){
  $("routineCount").textContent=`${state.routines.length} ${state.routines.length===1?"routine":"routines"}`;
  if(!state.routines.length){
    $("routineList").innerHTML=`<div class="empty-state">Create your regular workout once, then simply start it whenever you're ready.</div>`;
    return;
  }
  $("routineList").innerHTML=state.routines.map(r=>{
    const preview=r.exercises.slice(0,4).map(e=>`<span class="routine-chip">${esc(e.name)} · ${e.sets} ${e.timed?"timed sets":`×${e.reps}`}${Number(e.weight)>0?` · ${fmt(e.weight)}kg`:""}</span>`).join("");
    return `<div class="routine-card" data-edit-routine="${r.id}">
      <div class="routine-card-top"><div><h4>${esc(r.name)}</h4><p>${r.exercises.length} ${r.exercises.length===1?"exercise":"exercises"}</p></div></div>
      <div class="routine-preview">${preview}${r.exercises.length>4?`<span class="routine-chip">+${r.exercises.length-4} more</span>`:""}</div>
      <div class="routine-card-actions">
        <button class="start-routine-btn" data-start-routine="${r.id}">Start workout</button>
        <button class="delete-routine-btn" data-delete-routine="${r.id}" aria-label="Delete routine">•••</button>
      </div>
      <div class="routine-card-edit-hint">✎ Tap the card to edit routine</div>
    </div>`;
  }).join("");

  qsa("[data-edit-routine]").forEach(card=>card.addEventListener("click",e=>{
    if(e.target.closest("[data-start-routine]")||e.target.closest("[data-delete-routine]")) return;
    openRoutineEditor(card.dataset.editRoutine);
  }));
  qsa("[data-start-routine]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();startRoutine(b.dataset.startRoutine);}));
  qsa("[data-delete-routine]").forEach(b=>b.addEventListener("click",e=>{e.stopPropagation();deleteRoutine(b.dataset.deleteRoutine);}));
}
function showActiveWorkoutBanner(){
  const b=$("activeWorkoutBanner");
  if(!b) return;
  if(!state.activeWorkout){b.classList.add("hidden");return;}
  b.classList.remove("hidden");
  $("activeWorkoutName").textContent=state.activeWorkout.name;
  $("activeWorkoutElapsed").textContent=`${elapsedMinutes(state.activeWorkout.startedAt)} min elapsed`;
}

/* Single source of truth for every cardio activity type — icon, label, verb,
   and accent colour. Everywhere that needs to know about an activity type
   (the quick-log dialog, personal records, achievements, Trends, the Day
   Report, share images) reads from this registry rather than repeating its
   own hardcoded walk/run-only list, which is what made adding new types
   safe to do in one pass rather than a dozen easy-to-miss edits. */
const CARDIO_TYPES={
  walk:{label:"Walk",verb:"walked",icon:"🚶",color:"#1CCFA9"},
  run:{label:"Run",verb:"ran",icon:"🏃",color:"#FF6452"},
  swim:{label:"Swim",verb:"swam",icon:"🏊",color:"#6C5FFF"},
  cycle:{label:"Cycle",verb:"cycled",icon:"🚴",color:"#FFB454"},
  hike:{label:"Hike",verb:"hiked",icon:"🥾",color:"#1CCFA9"},
  row:{label:"Row",verb:"rowed",icon:"🚣",color:"#FF6452"},
};
function cardioIcon(type){return CARDIO_TYPES[type]?.icon||"⚡";}
function cardioLabel(type){return CARDIO_TYPES[type]?.label||"Activity";}
const achievementDefs = [
  // Food
  {id:"food_first",cat:"food",icon:"🍎",title:"First Bite",desc:"Log your first food.",rarity:"COMMON",goal:1,metric:"foodEntries"},
  {id:"food_10",cat:"food",icon:"🥗",title:"Food Explorer",desc:"Log 10 food entries.",rarity:"COMMON",goal:10,metric:"foodEntries"},
  {id:"food_50",cat:"food",icon:"🛒",title:"Label Legend",desc:"Log 50 food entries.",rarity:"RARE",goal:50,metric:"foodEntries"},
  {id:"food_scan_3",cat:"food",icon:"📸",title:"Scan Squad",desc:"Add 3 foods by barcode.",rarity:"COMMON",goal:3,metric:"scannedFoods"},
  {id:"food_scan_10",cat:"food",icon:"📷",title:"Scanner Pro",desc:"Add 10 foods by barcode.",rarity:"RARE",goal:10,metric:"scannedFoods"},
  {id:"food_ontarget_5",cat:"food",icon:"🎯",title:"On Target",desc:"Check out within target on 5 days.",rarity:"RARE",goal:5,metric:"onTargetDays"},

  // Workout
  {id:"workout_first",cat:"workout",icon:"💪",title:"First Rep",desc:"Complete your first workout.",rarity:"COMMON",goal:1,metric:"workouts"},
  {id:"workout_5",cat:"workout",icon:"🏋️",title:"Getting Strong",desc:"Complete 5 workouts.",rarity:"COMMON",goal:5,metric:"workouts"},
  {id:"workout_25",cat:"workout",icon:"⚙️",title:"Routine Machine",desc:"Complete 25 workouts.",rarity:"RARE",goal:25,metric:"workouts"},
  {id:"workout_100",cat:"workout",icon:"🦾",title:"Iron Habit",desc:"Complete 100 workouts.",rarity:"EPIC",goal:100,metric:"workouts"},
  {id:"sets_100",cat:"workout",icon:"🔢",title:"Century Sets",desc:"Log 100 completed workout sets.",rarity:"RARE",goal:100,metric:"completedSets"},
  {id:"sets_500",cat:"workout",icon:"🏆",title:"Set Collector",desc:"Log 500 completed workout sets.",rarity:"EPIC",goal:500,metric:"completedSets"},
  {id:"routine_first",cat:"workout",icon:"📝",title:"Set It Once",desc:"Create your first custom routine.",rarity:"COMMON",goal:1,metric:"routines"},
  {id:"pr_first",cat:"workout",icon:"🥇",title:"Personal Best",desc:"Set your first personal record.",rarity:"COMMON",goal:1,metric:"prCount"},
  {id:"pr_3",cat:"workout",icon:"📈",title:"On A Roll",desc:"Set 3 personal records.",rarity:"RARE",goal:3,metric:"prCount"},
  {id:"weight_10000",cat:"workout",icon:"🏋️‍♂️",title:"Ten Ton Club",desc:"Lift 10,000kg total, lifetime.",rarity:"RARE",goal:10000,metric:"totalWeightLifted"},
  {id:"weight_100000",cat:"workout",icon:"🌌",title:"Hundred Ton Club",desc:"Lift 100,000kg total, lifetime, roughly a loaded shipping container.",rarity:"MYTHIC",goal:100000,metric:"totalWeightLifted"},

  // Walking
  {id:"walk_first",cat:"walking",icon:"🚶",title:"First Steps",desc:"Log your first walk.",rarity:"COMMON",goal:1,metric:"walks"},
  {id:"walk_1mi",cat:"walking",icon:"👟",title:"Mile One",desc:"Walk 1 mile in total.",rarity:"COMMON",goal:1,metric:"walkMiles"},
  {id:"walk_5mi",cat:"walking",icon:"🌳",title:"Five Mile Wanderer",desc:"Walk 5 miles in total.",rarity:"COMMON",goal:5,metric:"walkMiles"},
  {id:"walk_25mi",cat:"walking",icon:"🧭",title:"Trail Finder",desc:"Walk 25 miles in total.",rarity:"RARE",goal:25,metric:"walkMiles"},
  {id:"walk_100mi",cat:"walking",icon:"🥾",title:"Hundred Mile Club",desc:"Walk 100 miles in total.",rarity:"EPIC",goal:100,metric:"walkMiles"},
  {id:"walk_250mi",cat:"walking",icon:"⛰️",title:"Long Haul Walker",desc:"Walk 250 miles in total.",rarity:"LEGEND",goal:250,metric:"walkMiles"},

  // Running
  {id:"run_first",cat:"running",icon:"🏃",title:"Off The Mark",desc:"Log your first run.",rarity:"COMMON",goal:1,metric:"runs"},
  {id:"run_1mi",cat:"running",icon:"⚡",title:"First Mile",desc:"Run 1 mile in total.",rarity:"COMMON",goal:1,metric:"runMiles"},
  {id:"run_5mi",cat:"running",icon:"🏁",title:"Five Mile Flyer",desc:"Run 5 miles in total.",rarity:"COMMON",goal:5,metric:"runMiles"},
  {id:"run_25mi",cat:"running",icon:"🔥",title:"Road Burner",desc:"Run 25 miles in total.",rarity:"RARE",goal:25,metric:"runMiles"},
  {id:"run_100mi",cat:"running",icon:"🚀",title:"Hundred Mile Runner",desc:"Run 100 miles in total.",rarity:"EPIC",goal:100,metric:"runMiles"},
  {id:"run_250mi",cat:"running",icon:"🌠",title:"Distance Demon",desc:"Run 250 miles in total.",rarity:"LEGEND",goal:250,metric:"runMiles"},

  // Weekly Monday-reset challenges
  {id:"week_walk_5",cat:"weekly",icon:"📅",title:"Five This Week",desc:"Walk 5 miles between Monday and Sunday.",rarity:"COMMON",goal:5,metric:"weekWalkMiles"},
  {id:"week_walk_10",cat:"weekly",icon:"🌤️",title:"Double Digits",desc:"Walk 10 miles this week.",rarity:"RARE",goal:10,metric:"weekWalkMiles"},
  {id:"week_walk_20",cat:"weekly",icon:"🗺️",title:"Twenty Mile Week",desc:"Walk 20 miles this week.",rarity:"EPIC",goal:20,metric:"weekWalkMiles"},
  {id:"week_run_5",cat:"weekly",icon:"📅",title:"Running Week",desc:"Run 5 miles between Monday and Sunday.",rarity:"COMMON",goal:5,metric:"weekRunMiles"},
  {id:"week_run_10",cat:"weekly",icon:"💨",title:"Ten Mile Week",desc:"Run 10 miles this week.",rarity:"RARE",goal:10,metric:"weekRunMiles"},
  {id:"week_run_20",cat:"weekly",icon:"🏅",title:"Twenty Mile Runner",desc:"Run 20 miles this week.",rarity:"EPIC",goal:20,metric:"weekRunMiles"},
  {id:"week_combo_15",cat:"weekly",icon:"🌍",title:"Move 15",desc:"Walk and/or run 15 miles this week.",rarity:"RARE",goal:15,metric:"weekMoveMiles"},
  {id:"week_combo_30",cat:"weekly",icon:"🛰️",title:"Thirty Mile Week",desc:"Walk and/or run 30 miles this week.",rarity:"LEGEND",goal:30,metric:"weekMoveMiles"},

  // Consistency
  {id:"streak_2",cat:"consistency",icon:"🔁",title:"Back Again",desc:"Check out 2 days in a row.",rarity:"COMMON",goal:2,metric:"bestStreak"},
  {id:"streak_3",cat:"consistency",icon:"🔥",title:"Three In A Row",desc:"Check out 3 days in a row.",rarity:"COMMON",goal:3,metric:"bestStreak"},
  {id:"streak_7",cat:"consistency",icon:"🔥",title:"Full Week",desc:"Reach a 7-day checkout streak.",rarity:"RARE",goal:7,metric:"bestStreak"},
  {id:"streak_14",cat:"consistency",icon:"🌟",title:"Fortnight Flow",desc:"Reach a 14-day checkout streak.",rarity:"EPIC",goal:14,metric:"bestStreak"},
  {id:"streak_30",cat:"consistency",icon:"👑",title:"Thirty Days",desc:"Reach a 30-day checkout streak.",rarity:"LEGEND",goal:30,metric:"bestStreak"},
  {id:"streak_60",cat:"consistency",icon:"🏔️",title:"Two Months Strong",desc:"Reach a 60-day checkout streak.",rarity:"EPIC",goal:60,metric:"bestStreak"},
  {id:"streak_100",cat:"consistency",icon:"🗿",title:"Century Streak",desc:"Reach a 100-day checkout streak.",rarity:"LEGEND",goal:100,metric:"bestStreak"},
  {id:"streak_365",cat:"consistency",icon:"🌅",title:"365 Days",desc:"Reach a full year checkout streak.",rarity:"MYTHIC",goal:365,metric:"bestStreak"},
  {id:"tenure_90",cat:"consistency",icon:"📆",title:"A Quarter Year",desc:"90 days since your very first log, streak doesn't need to be unbroken.",rarity:"RARE",goal:90,metric:"daysSinceFirstLog"},
  {id:"tenure_180",cat:"consistency",icon:"🌗",title:"Half A Year",desc:"180 days since your very first log.",rarity:"EPIC",goal:180,metric:"daysSinceFirstLog"},
  {id:"tenure_365",cat:"consistency",icon:"🌌",title:"One Year On",desc:"365 days since your very first log, a full year of showing up, streak or no streak.",rarity:"MYTHIC",goal:365,metric:"daysSinceFirstLog"},
  {id:"checkout_25",cat:"consistency",icon:"🌙",title:"Day Closer",desc:"Check out 25 days.",rarity:"RARE",goal:25,metric:"checkouts"},
  {id:"checkout_100",cat:"consistency",icon:"📘",title:"Hundred Days Logged",desc:"Check out 100 days.",rarity:"LEGEND",goal:100,metric:"checkouts"},

  // Scores
  {id:"score_70",cat:"score",icon:"⭐",title:"Seventy Club",desc:"Finish a day with CholScore 70+.",rarity:"COMMON",goal:1,metric:"score70Days"},
  {id:"score_80",cat:"score",icon:"🚀",title:"Flying",desc:"Finish a day with CholScore 80+.",rarity:"RARE",goal:1,metric:"score80Days"},
  {id:"score_90",cat:"score",icon:"💎",title:"Elite Day",desc:"Finish a day with CholScore 90+.",rarity:"EPIC",goal:1,metric:"score90Days"},
  {id:"score_90x5",cat:"score",icon:"🏆",title:"High Five",desc:"Finish 5 days with CholScore 90+.",rarity:"LEGEND",goal:5,metric:"score90Days"},
  {id:"points_500",cat:"score",icon:"✨",title:"500 Club",desc:"Bank 500 total CholPoints.",rarity:"RARE",goal:500,metric:"totalPoints"},
  {id:"points_2500",cat:"score",icon:"🌌",title:"Point Collector",desc:"Bank 2,500 total CholPoints.",rarity:"LEGEND",goal:2500,metric:"totalPoints"},
  {id:"points_100",cat:"score",icon:"🌟",title:"Point Pocket",desc:"Bank 100 total CholPoints.",rarity:"COMMON",goal:100,metric:"totalPoints"},
  {id:"food_ontarget_3",cat:"food",icon:"🎯",title:"Target Trio",desc:"Check out within target on 3 days.",rarity:"COMMON",goal:3,metric:"onTargetDays"},
  {id:"workout_sets_25",cat:"workout",icon:"🧱",title:"Set Starter",desc:"Log 25 completed workout sets.",rarity:"COMMON",goal:25,metric:"completedSets"},
  {id:"weekly_workouts_3",cat:"weekly",icon:"📅",title:"Workout Week",desc:"Complete 3 workouts between Monday and Sunday.",rarity:"COMMON",goal:3,metric:"weekWorkouts"},
  {id:"food_25",cat:"food",icon:"🍽️",title:"Food Regular",desc:"Log 25 food entries.",rarity:"COMMON",goal:25,metric:"foodEntries"},
  {id:"food_scan_5",cat:"food",icon:"📷",title:"Scanner Starter",desc:"Add 5 foods by barcode.",rarity:"COMMON",goal:5,metric:"scannedFoods"},
  {id:"consistency_checkouts_10",cat:"consistency",icon:"📘",title:"Ten Days Logged",desc:"Check out 10 days.",rarity:"COMMON",goal:10,metric:"checkouts"},
  {id:"points_1000",cat:"score",icon:"⭐",title:"Thousand Club",desc:"Bank 1,000 total CholPoints.",rarity:"RARE",goal:1000,metric:"totalPoints"},
  {id:"food_ontarget_10",cat:"food",icon:"🎯",title:"Target Ten",desc:"Check out within target on 10 days.",rarity:"RARE",goal:10,metric:"onTargetDays"},
  {id:"workout_pr_10",cat:"workout",icon:"🏹",title:"PR Hunter",desc:"Set 10 personal records.",rarity:"RARE",goal:10,metric:"prCount"},
  {id:"walking_50",cat:"walking",icon:"🚶",title:"Half Century Walker",desc:"Walk 50 miles in total.",rarity:"RARE",goal:50,metric:"walkMiles"},
  {id:"running_50",cat:"running",icon:"🏃",title:"Half Century Runner",desc:"Run 50 miles in total.",rarity:"RARE",goal:50,metric:"runMiles"},
  {id:"workout_50",cat:"workout",icon:"🏋️",title:"Workout Fifty",desc:"Complete 50 workouts.",rarity:"RARE",goal:50,metric:"workouts"},
  {id:"workout_sets_250",cat:"workout",icon:"🧱",title:"Set Builder",desc:"Log 250 completed workout sets.",rarity:"RARE",goal:250,metric:"completedSets"},
  {id:"food_scan_50",cat:"food",icon:"📸",title:"Scanner Fifty",desc:"Add 50 foods by barcode.",rarity:"RARE",goal:50,metric:"scannedFoods"},
  {id:"food_100",cat:"food",icon:"🍱",title:"Food Century",desc:"Log 100 food entries.",rarity:"EPIC",goal:100,metric:"foodEntries"},
  {id:"food_ontarget_30",cat:"food",icon:"🎯",title:"Target Month",desc:"Check out within target on 30 days.",rarity:"EPIC",goal:30,metric:"onTargetDays"},
  {id:"workout_pr_25",cat:"workout",icon:"🏆",title:"PR Collector",desc:"Set 25 personal records.",rarity:"EPIC",goal:25,metric:"prCount"},
  {id:"workout_weight_50000",cat:"workout",icon:"🏗️",title:"Fifty Ton Club",desc:"Lift 50,000kg total, lifetime.",rarity:"EPIC",goal:50000,metric:"totalWeightLifted"},
  {id:"workout_150",cat:"workout",icon:"🔥",title:"Workout 150",desc:"Complete 150 workouts.",rarity:"EPIC",goal:150,metric:"workouts"},
  {id:"workout_sets_1000",cat:"workout",icon:"🧱",title:"Set Thousand",desc:"Log 1,000 completed workout sets.",rarity:"EPIC",goal:1000,metric:"completedSets"},
  {id:"food_scan_100",cat:"food",icon:"📸",title:"Scanner Century",desc:"Add 100 foods by barcode.",rarity:"EPIC",goal:100,metric:"scannedFoods"},
  {id:"food_500",cat:"food",icon:"🍱",title:"Food Five Hundred",desc:"Log 500 food entries.",rarity:"EPIC",goal:500,metric:"foodEntries"},
  {id:"weekly_move_40",cat:"weekly",icon:"🚀",title:"Forty Mile Week",desc:"Walk and/or run 40 miles this week.",rarity:"EPIC",goal:40,metric:"weekMoveMiles"},
  {id:"workout_weight_250000",cat:"workout",icon:"🏗️",title:"Quarter Million Club",desc:"Lift 250,000kg total, lifetime.",rarity:"EPIC",goal:250000,metric:"totalWeightLifted"},
  {id:"walking_500",cat:"walking",icon:"🥾",title:"Walk 500",desc:"Walk 500 miles in total.",rarity:"LEGEND",goal:500,metric:"walkMiles"},
  {id:"running_500",cat:"running",icon:"🏅",title:"Run 500",desc:"Run 500 miles in total.",rarity:"LEGEND",goal:500,metric:"runMiles"},
  {id:"workout_250",cat:"workout",icon:"🔥",title:"Workout 250",desc:"Complete 250 workouts.",rarity:"LEGEND",goal:250,metric:"workouts"},
  {id:"workout_sets_2500",cat:"workout",icon:"🧱",title:"Set 2,500",desc:"Log 2,500 completed workout sets.",rarity:"LEGEND",goal:2500,metric:"completedSets"},
  {id:"workout_pr_75",cat:"workout",icon:"🏆",title:"PR Master",desc:"Set 75 personal records.",rarity:"LEGEND",goal:75,metric:"prCount"},
  {id:"food_ontarget_100",cat:"food",icon:"🎯",title:"Target Century",desc:"Check out within target on 100 days.",rarity:"LEGEND",goal:100,metric:"onTargetDays"},
  {id:"points_10000",cat:"score",icon:"💎",title:"Ten Thousand Club",desc:"Bank 10,000 total CholPoints.",rarity:"LEGEND",goal:10000,metric:"totalPoints"},
  {id:"score_90_25",cat:"score",icon:"🌟",title:"Ninety Club",desc:"Finish 25 days with CholScore 90+.",rarity:"LEGEND",goal:25,metric:"score90Days"},
  {id:"workout_weight_500000",cat:"workout",icon:"🏗️",title:"Half Million Club",desc:"Lift 500,000kg total, lifetime.",rarity:"LEGEND",goal:500000,metric:"totalWeightLifted"},
  {id:"weekly_move_50",cat:"weekly",icon:"🚀",title:"Ultra Week",desc:"Walk and/or run 50 miles between Monday and Sunday.",rarity:"LEGEND",goal:50,metric:"weekMoveMiles"},
  {id:"walking_1000",cat:"walking",icon:"🌌",title:"Walk 1,000",desc:"Walk 1,000 miles in total, enough miles to make every pair of trainers nervous.",rarity:"MYTHIC",goal:1000,metric:"walkMiles"},
  {id:"running_1000",cat:"running",icon:"🌌",title:"Run 1,000",desc:"Run 1,000 miles in total, four figures earned one mile at a time.",rarity:"MYTHIC",goal:1000,metric:"runMiles"},
  {id:"swim_half",cat:"swimming",icon:"🌊",title:"First Splash",desc:"Swim 0.5 miles in total.",rarity:"COMMON",goal:0.5,metric:"swimMiles"},
  {id:"swim_1mi",cat:"swimming",icon:"🏊",title:"Mile Swimmer",desc:"Swim 1 mile in total.",rarity:"COMMON",goal:1,metric:"swimMiles"},
  {id:"swim_5mi",cat:"swimming",icon:"🐬",title:"Fin Finder",desc:"Swim 5 miles in total.",rarity:"RARE",goal:5,metric:"swimMiles"},
  {id:"swim_10mi",cat:"swimming",icon:"🐋",title:"Deep End",desc:"Swim 10 miles in total.",rarity:"RARE",goal:10,metric:"swimMiles"},
  {id:"swim_20mi",cat:"swimming",icon:"🌀",title:"Current Rider",desc:"Swim 20 miles in total.",rarity:"EPIC",goal:20,metric:"swimMiles"},
  {id:"swim_50mi",cat:"swimming",icon:"🏝️",title:"Channel Chaser",desc:"Swim 50 miles in total.",rarity:"LEGEND",goal:50,metric:"swimMiles"},
  {id:"swim_100mi",cat:"swimming",icon:"🧊",title:"Ice Breaker",desc:"Swim 100 miles in total.",rarity:"LEGEND",goal:100,metric:"swimMiles"},
  {id:"swim_200mi",cat:"swimming",icon:"🌌",title:"Two Hundred Lengths of the Sun",desc:"Swim 200 miles in total.",rarity:"MYTHIC",goal:200,metric:"swimMiles"},
  {id:"week_swim_1",cat:"weekly",icon:"📅",title:"Swim Week",desc:"Swim 1 mile between Monday and Sunday.",rarity:"COMMON",goal:1,metric:"weekSwimMiles"},
  {id:"week_swim_3",cat:"weekly",icon:"🌊",title:"Triple Dip",desc:"Swim 3 miles between Monday and Sunday.",rarity:"RARE",goal:3,metric:"weekSwimMiles"},
  {id:"week_swim_6",cat:"weekly",icon:"🏆",title:"Six Mile Splash",desc:"Swim 6 miles between Monday and Sunday.",rarity:"EPIC",goal:6,metric:"weekSwimMiles"},
  {id:"cycle_5mi",cat:"cycling",icon:"🚲",title:"First Spin",desc:"Cycle 5 miles in total.",rarity:"COMMON",goal:5,metric:"cycleMiles"},
  {id:"cycle_15mi",cat:"cycling",icon:"🛞",title:"Rolling Start",desc:"Cycle 15 miles in total.",rarity:"COMMON",goal:15,metric:"cycleMiles"},
  {id:"cycle_50mi",cat:"cycling",icon:"🌄",title:"Half Century Ride",desc:"Cycle 50 miles in total.",rarity:"RARE",goal:50,metric:"cycleMiles"},
  {id:"cycle_100mi",cat:"cycling",icon:"💯",title:"Century Rider",desc:"Cycle 100 miles in total.",rarity:"RARE",goal:100,metric:"cycleMiles"},
  {id:"cycle_250mi",cat:"cycling",icon:"🏔️",title:"Hill Hunter",desc:"Cycle 250 miles in total.",rarity:"EPIC",goal:250,metric:"cycleMiles"},
  {id:"cycle_500mi",cat:"cycling",icon:"🚀",title:"Long Haul Cyclist",desc:"Cycle 500 miles in total.",rarity:"LEGEND",goal:500,metric:"cycleMiles"},
  {id:"cycle_1000mi",cat:"cycling",icon:"⚡",title:"Thousand Mile Club",desc:"Cycle 1,000 miles in total.",rarity:"LEGEND",goal:1000,metric:"cycleMiles"},
  {id:"cycle_2500mi",cat:"cycling",icon:"🌌",title:"Cross Country",desc:"Cycle 2,500 miles in total.",rarity:"MYTHIC",goal:2500,metric:"cycleMiles"},
  {id:"week_cycle_15",cat:"weekly",icon:"📅",title:"Cycle Week",desc:"Cycle 15 miles between Monday and Sunday.",rarity:"COMMON",goal:15,metric:"weekCycleMiles"},
  {id:"week_cycle_30",cat:"weekly",icon:"🌤️",title:"Thirty Mile Ride Week",desc:"Cycle 30 miles between Monday and Sunday.",rarity:"RARE",goal:30,metric:"weekCycleMiles"},
  {id:"week_cycle_60",cat:"weekly",icon:"🏅",title:"Sixty Mile Week",desc:"Cycle 60 miles between Monday and Sunday.",rarity:"EPIC",goal:60,metric:"weekCycleMiles"},
  {id:"hike_1mi",cat:"hiking",icon:"🌲",title:"First Trail",desc:"Hike 1 mile in total.",rarity:"COMMON",goal:1,metric:"hikeMiles"},
  {id:"hike_5mi",cat:"hiking",icon:"🥾",title:"Trailblazer",desc:"Hike 5 miles in total.",rarity:"COMMON",goal:5,metric:"hikeMiles"},
  {id:"hike_20mi",cat:"hiking",icon:"🧭",title:"Ridge Walker",desc:"Hike 20 miles in total.",rarity:"RARE",goal:20,metric:"hikeMiles"},
  {id:"hike_50mi",cat:"hiking",icon:"⛰️",title:"Summit Seeker",desc:"Hike 50 miles in total.",rarity:"RARE",goal:50,metric:"hikeMiles"},
  {id:"hike_100mi",cat:"hiking",icon:"🏔️",title:"Peak Bagger",desc:"Hike 100 miles in total.",rarity:"EPIC",goal:100,metric:"hikeMiles"},
  {id:"hike_200mi",cat:"hiking",icon:"🗻",title:"Mountain Wanderer",desc:"Hike 200 miles in total.",rarity:"LEGEND",goal:200,metric:"hikeMiles"},
  {id:"hike_400mi",cat:"hiking",icon:"🌄",title:"Highland Legend",desc:"Hike 400 miles in total.",rarity:"LEGEND",goal:400,metric:"hikeMiles"},
  {id:"hike_750mi",cat:"hiking",icon:"🌌",title:"Long Trail Master",desc:"Hike 750 miles in total.",rarity:"MYTHIC",goal:750,metric:"hikeMiles"},
  {id:"week_hike_5",cat:"weekly",icon:"📅",title:"Hike Week",desc:"Hike 5 miles between Monday and Sunday.",rarity:"COMMON",goal:5,metric:"weekHikeMiles"},
  {id:"week_hike_10",cat:"weekly",icon:"🌤️",title:"Ten Mile Trail Week",desc:"Hike 10 miles between Monday and Sunday.",rarity:"RARE",goal:10,metric:"weekHikeMiles"},
  {id:"week_hike_15",cat:"weekly",icon:"🏅",title:"Fifteen Mile Ridge Week",desc:"Hike 15 miles between Monday and Sunday.",rarity:"EPIC",goal:15,metric:"weekHikeMiles"},
  {id:"row_1mi",cat:"rowing",icon:"🚣",title:"First Stroke",desc:"Row 1 mile in total.",rarity:"COMMON",goal:1,metric:"rowMiles"},
  {id:"row_5mi",cat:"rowing",icon:"💧",title:"Five Mile Pull",desc:"Row 5 miles in total.",rarity:"COMMON",goal:5,metric:"rowMiles"},
  {id:"row_25mi",cat:"rowing",icon:"🌊",title:"Steady Stroke",desc:"Row 25 miles in total.",rarity:"RARE",goal:25,metric:"rowMiles"},
  {id:"row_50mi",cat:"rowing",icon:"🏁",title:"Half Century Row",desc:"Row 50 miles in total.",rarity:"RARE",goal:50,metric:"rowMiles"},
  {id:"row_100mi",cat:"rowing",icon:"💯",title:"Hundred Mile Rower",desc:"Row 100 miles in total.",rarity:"EPIC",goal:100,metric:"rowMiles"},
  {id:"row_250mi",cat:"rowing",icon:"🔥",title:"Engine Room",desc:"Row 250 miles in total.",rarity:"LEGEND",goal:250,metric:"rowMiles"},
  {id:"row_500mi",cat:"rowing",icon:"🚀",title:"Distance Rower",desc:"Row 500 miles in total.",rarity:"LEGEND",goal:500,metric:"rowMiles"},
  {id:"row_1000mi",cat:"rowing",icon:"🌌",title:"Thousand Mile Rower",desc:"Row 1,000 miles in total.",rarity:"MYTHIC",goal:1000,metric:"rowMiles"},
  {id:"week_row_5",cat:"weekly",icon:"📅",title:"Row Week",desc:"Row 5 miles between Monday and Sunday.",rarity:"COMMON",goal:5,metric:"weekRowMiles"},
  {id:"week_row_10",cat:"weekly",icon:"🌤️",title:"Ten Mile Row Week",desc:"Row 10 miles between Monday and Sunday.",rarity:"RARE",goal:10,metric:"weekRowMiles"},
  {id:"week_row_20",cat:"weekly",icon:"🏅",title:"Twenty Mile Row Week",desc:"Row 20 miles between Monday and Sunday.",rarity:"EPIC",goal:20,metric:"weekRowMiles"},
  {id:"workout_500",cat:"workout",icon:"🌌",title:"Workout 500",desc:"Complete 500 workouts, showing up has officially become a superpower.",rarity:"MYTHIC",goal:500,metric:"workouts"},
  {id:"workout_sets_5000",cat:"workout",icon:"🌌",title:"Set 5,000",desc:"Log 5,000 completed workout sets.",rarity:"MYTHIC",goal:5000,metric:"completedSets"},
  {id:"food_ontarget_250",cat:"food",icon:"🌌",title:"Target 250",desc:"Check out within target on 250 days.",rarity:"MYTHIC",goal:250,metric:"onTargetDays"},
  {id:"workout_weight_1000000",cat:"workout",icon:"🌌",title:"Million Kilo Club",desc:"Lift 1,000,000kg total, lifetime, one thousand tonnes of work.",rarity:"MYTHIC",goal:1000000,metric:"totalWeightLifted"},
  {id:"points_25000",cat:"score",icon:"🌌",title:"Twenty Five Thousand Club",desc:"Bank 25,000 total CholPoints.",rarity:"MYTHIC",goal:25000,metric:"totalPoints"},
  {id:"consistency_52weeks",cat:"consistency",icon:"🌌",title:"52 Week Warrior",desc:"Complete at least one workout in 52 different calendar weeks.",rarity:"MYTHIC",goal:52,metric:"distinctWorkoutWeeks"},
  {id:"consistency_move_2500",cat:"consistency",icon:"🌌",title:"Round The World Starter",desc:"Walk and/or run 2,500 miles in total, a serious chunk of planet Earth under your feet.",rarity:"MYTHIC",goal:2500,metric:"totalMoveMiles"},
];

const rewardCategories = [
  ["all","All"],["food","Food"],["workout","Workout"],["walking","Walking"],
  ["running","Running"],["swimming","Swimming"],["cycling","Cycling"],["hiking","Hiking"],
  ["rowing","Rowing"],["weekly","This Week"],["consistency","Consistency"],["score","CholScore"]
];

function achievementMetrics(){
  let foodEntries=0,scannedFoods=0,onTargetDays=0,workouts=0,completedSets=0;
  let checkouts=0,score70Days=0,score80Days=0,score90Days=0,totalPoints=0;
  let totalWeightLifted=0;
  const checkedDates=[];
  let firstDayKey=null;

  const monday=mondayKeyFor(new Date());
  let weekWorkouts=0;
  const workoutWeeksSeen=new Set();
  const cardioMiles={},weekCardioMiles={},cardioSessions={};
  for(const t in CARDIO_TYPES){cardioMiles[t]=0;weekCardioMiles[t]=0;cardioSessions[t]=0;}

  for(const [key,day] of Object.entries(state.days)){
    if(firstDayKey===null||key<firstDayKey) firstDayKey=key;
    foodEntries += (day.foods||[]).length;
    scannedFoods += (day.foods||[]).filter(f=>f.source==="Open Food Facts").length;

    for(const a of (day.activities||[])){
      if(a.type==="workout"){
        workouts++;
        completedSets += Number(a.completedSets||0);
        totalWeightLifted += Number(a.totalWeight||0); // already computed once via workoutVolume() at save time
        if(key>=monday) weekWorkouts++;
        workoutWeeksSeen.add(mondayKeyFor(new Date(key+"T12:00:00")));
      }else if(cardioMiles[a.type]!==undefined){
        cardioSessions[a.type]++;
        const dist=achievementDistanceValue(Number(a.distance||0));
        cardioMiles[a.type] += dist;
        if(key>=monday) weekCardioMiles[a.type] += dist;
      }
    }

    if(day.checkedOut){
      checkouts++;
      checkedDates.push(key);
      const score=Number(day.finalScore??scoreDay(day));
      totalPoints += score;
      if(score>=70) score70Days++;
      if(score>=80) score80Days++;
      if(score>=90) score90Days++;
      const t=totals(day), target=Number(state.profile?.target||30);
      if(day.foods?.length && t.sat<=target) onTargetDays++;
    }
  }

  checkedDates.sort();
  let bestStreak=0,current=0,prev=null;
  for(const key of checkedDates){
    const d=new Date(key+"T12:00:00");
    if(prev){
      const diff=Math.round((d-prev)/86400000);
      current=(diff===1||(diff>1&&allDaysAreVacationBetween(prev,d)))?current+1:1;
    }else current=1;
    bestStreak=Math.max(bestStreak,current);
    prev=d;
  }

  const routines=(state.routines||[]).length;
  // Deliberately NOT computePersonalRecords() here — that just tracks each
  // exercise's current best, so it can't distinguish a genuine improvement
  // from a first-ever attempt (which is automatically "your best" purely
  // because nothing existed yet to compare it against). countGenuinePRs()
  // only counts an attempt that beat a prior one, so a brand new user's
  // first workout can't instantly unlock the PR achievements just by trying
  // several exercises for the first time.
  const prCount=countGenuinePRs();

  // Tenure — days since your very first-ever log, regardless of streaks.
  // Deliberately more forgiving than bestStreak: a single missed day doesn't
  // erase months of progress the way breaking a streak would.
  const daysSinceFirstLog=firstDayKey?Math.floor((new Date(todayKey()+"T12:00:00")-new Date(firstDayKey+"T12:00:00"))/86400000):0;

  return {
    foodEntries,scannedFoods,onTargetDays,workouts,completedSets,
    walks:cardioSessions.walk,runs:cardioSessions.run,swims:cardioSessions.swim,
    cycles:cardioSessions.cycle,hikes:cardioSessions.hike,rows:cardioSessions.row,
    walkMiles:cardioMiles.walk,runMiles:cardioMiles.run,swimMiles:cardioMiles.swim,
    cycleMiles:cardioMiles.cycle,hikeMiles:cardioMiles.hike,rowMiles:cardioMiles.row,
    weekWalkMiles:weekCardioMiles.walk,weekRunMiles:weekCardioMiles.run,weekSwimMiles:weekCardioMiles.swim,
    weekCycleMiles:weekCardioMiles.cycle,weekHikeMiles:weekCardioMiles.hike,weekRowMiles:weekCardioMiles.row,
    weekMoveMiles:weekCardioMiles.walk+weekCardioMiles.run, // deliberately walk+run only — matches the achievements' own "walk and/or run" wording
    totalMoveMiles:cardioMiles.walk+cardioMiles.run,
    checkouts,bestStreak,score70Days,score80Days,score90Days,totalPoints,
    totalWeightLifted,routines,prCount,daysSinceFirstLog,
    weekWorkouts,distinctWorkoutWeeks:workoutWeeksSeen.size
  };
}


function achievementDisplay(def){
  const unit=distanceUnit();
  const long=unitLong();
  let title=def.title;
  let desc=def.desc;

  // All distance achievement definitions use numeric thresholds that are interpreted
  // in the user's chosen display unit.
  if(def.metric && def.metric.toLowerCase().includes("miles")){
    desc=desc.replace(/\bmiles\b/gi,long).replace(/\bmile\b/gi, unit==="km"?"kilometre":"mile");
    title=title.replace(/\bMile\b/g, unit==="km"?"Kilometre":"Mile")
               .replace(/\bMiles\b/g, unit==="km"?"Kilometres":"Miles");
  }
  return {title,desc};
}

function renderPersonalRecords(){
  const recs=computePersonalRecords();
  const unit=distanceUnit();
  const fmtDate=k=>new Date(k+"T12:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
  const rows=[];

  Object.entries(recs.strength).sort((a,b)=>b[1].weight-a[1].weight).forEach(([name,r])=>{
    rows.push(`<div class="pr-row"><span class="pr-row-icon">🏋️</span><div class="pr-row-main"><strong>${esc(name)}</strong><small>Heaviest lift</small></div><div class="pr-row-value"><b>${fmt(r.weight)} kg</b><small>${fmtDate(r.date)}</small></div></div>`);
  });
  Object.entries(recs.timed).sort((a,b)=>b[1].seconds-a[1].seconds).forEach(([name,r])=>{
    rows.push(`<div class="pr-row"><span class="pr-row-icon">⏱️</span><div class="pr-row-main"><strong>${esc(name)}</strong><small>Longest hold</small></div><div class="pr-row-value"><b>${formatExerciseSeconds(r.seconds)}</b><small>${fmtDate(r.date)}</small></div></div>`);
  });
  for(const type in CARDIO_TYPES){
    const icon=CARDIO_TYPES[type].icon,label=CARDIO_TYPES[type].label;
    const bucket=recs.cardio[type];
    if(bucket.longestKm>0){
      rows.push(`<div class="pr-row"><span class="pr-row-icon">${icon}</span><div class="pr-row-main"><strong>${label}</strong><small>Longest distance</small></div><div class="pr-row-value"><b>${kmToDisplay(bucket.longestKm).toFixed(1)} ${unit}</b><small>${fmtDate(bucket.dateForDistance)}</small></div></div>`);
    }
    if(bucket.bestPaceMinPerKm!=null){
      const reconstructedMinutes=bucket.bestPaceMinPerKm*bucket.paceDistanceKm;
      const paceDisplay=formatPace(reconstructedMinutes,kmToDisplay(bucket.paceDistanceKm));
      if(paceDisplay)rows.push(`<div class="pr-row"><span class="pr-row-icon">${icon}</span><div class="pr-row-main"><strong>${label}</strong><small>Fastest pace</small></div><div class="pr-row-value"><b>${paceDisplay}/${unit}</b><small>${fmtDate(bucket.dateForPace)}</small></div></div>`);
    }
  }

  $("prList").innerHTML=rows.length?rows.join(""):`<p class="pr-empty">Complete a weighted or timed exercise, or log a walk/run, to start setting personal records.</p>`;
}
function renderRewards(){
  const metrics=achievementMetrics();
  const unlocked=achievementDefs.filter(a=>Number(metrics[a.metric]||0)>=a.goal);
  const pct=achievementDefs.length?unlocked.length/achievementDefs.length*100:0;

  $("achievementUnlockedCount").textContent=unlocked.length;
  $("achievementTotalCount").textContent=achievementDefs.length;
  $("collectionProgressBar").style.width=`${pct}%`;
  $("rewardMessage").textContent=unlocked.length===achievementDefs.length
    ?`You collected everything, ${state.profile.name}!`
    :`${achievementDefs.length-unlocked.length} still waiting to be unlocked.`;

  const totalPoints=metrics.totalPoints;
  $("pointsStat").textContent=fmtInt(totalPoints);
  $("bestStat").textContent=Math.round(bestEverScore());
  $("streakStat").textContent=calculateStreak();

  $("rewardCategoryTabs").innerHTML=rewardCategories.map(([id,label])=>
    `<button class="reward-tab ${activeRewardCategory===id?"active":""}" data-reward-cat="${id}">${label}</button>`
  ).join("");
  qsa("[data-reward-cat]").forEach(btn=>btn.addEventListener("click",()=>{
    activeRewardCategory=btn.dataset.rewardCat;renderRewards();
  }));

  const defs=activeRewardCategory==="all"?achievementDefs:achievementDefs.filter(a=>a.cat===activeRewardCategory);
  const unlockedHere=defs.filter(a=>Number(metrics[a.metric]||0)>=a.goal).length;
  const catLabel=rewardCategories.find(x=>x[0]===activeRewardCategory)?.[1]||"All";
  $("achievementCategorySummary").innerHTML=`<strong>${catLabel}</strong><span>${unlockedHere} of ${defs.length} unlocked</span>`;

  $("achievementCollection").innerHTML=defs.map(a=>{
    const value=Number(metrics[a.metric]||0);
    const done=value>=a.goal;
    const progress=Math.max(0,Math.min(100,value/a.goal*100));
    const displayVal=a.metric.toLowerCase().includes("miles")?value.toFixed(1):Math.floor(value).toLocaleString();
    const goalVal=a.metric.toLowerCase().includes("miles")?a.goal:Number(a.goal).toLocaleString();
    const shown=achievementDisplay(a);
    return `<div class="achievement-card r-${a.rarity.toLowerCase()} ${done?"unlocked":"locked"}">
      <span class="achievement-rarity">${a.rarity}</span>
      <span class="achievement-icon">${a.icon}</span>
      <h4>${esc(shown.title)}</h4>
      <p>${esc(shown.desc)}</p>
      <div class="achievement-mini-progress"><i style="width:${progress}%"></i></div>
      <div class="achievement-state">
        <span>${done?"UNLOCKED":"LOCKED"}</span>
        <span>${displayVal}/${goalVal}${a.metric.toLowerCase().includes("miles")?` ${distanceUnit()}`:""}</span>
      </div>
    </div>`;
  }).join("");
}
/* Vacation Mode — pausing protects a streak from breaking while genuinely
   away or ill, without granting free progress toward it. A paused day is
   simply excluded from the streak calculation entirely: it can't break an
   existing run, but it also never counts as a completed day, so reaching a
   streak goal still requires that many real checked-out days — any paused
   time has to be made up afterward, not skipped. */
function vacationRanges(){
  const ranges=[...(state.vacationHistory||[])];
  if(state.vacationMode?.active&&state.vacationMode.since)ranges.push({start:state.vacationMode.since,end:todayKey()});
  return ranges;
}
function isVacationDay(key){
  return vacationRanges().some(r=>key>=r.start&&key<=r.end);
}
function allDaysAreVacationBetween(prevDate,currentDate){
  const d=new Date(prevDate);d.setDate(d.getDate()+1);
  while(d<currentDate){
    if(!isVacationDay(localDateKey(d)))return false;
    d.setDate(d.getDate()+1);
  }
  return true;
}
function calculateStreak(){
  let count=0,d=new Date(),loopGuard=0,realDaysExamined=0;
  while(loopGuard<400){
    loopGuard++;
    const key=localDateKey(d);
    if(isVacationDay(key)){d.setDate(d.getDate()-1);continue;} // paused day — skip entirely, doesn't consume the "today might not be checked out yet" leniency below
    const day=state.days[key];
    if(day?.checkedOut)count++;
    else if(realDaysExamined>0)break;
    realDaysExamined++;
    d.setDate(d.getDate()-1);
  }
  return count;
}
function renderCalendar(){
  const y=calendarDate.getFullYear(),m=calendarDate.getMonth();
  $("monthTitle").textContent=calendarDate.toLocaleDateString(undefined,{month:"long",year:"numeric"});
  const first=new Date(y,m,1),last=new Date(y,m+1,0),offset=(first.getDay()+6)%7,cells=[];
  for(let i=0;i<offset;i++)cells.push(`<button class="day-cell muted"></button>`);
  for(let d=1;d<=last.getDate();d++){
    const key=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`,dayObj=state.days[key],has=!!dayObj,hasExercise=!!(dayObj?.activities?.length);
    cells.push(`<button class="day-cell ${has?"has-data":""} ${hasExercise?"has-exercise":""}" data-date="${key}">${d}</button>`);
  }
  $("calendarGrid").innerHTML=cells.join("");
  qsa(".day-cell[data-date]").forEach(b=>b.addEventListener("click",()=>{showHistoryDay(b.dataset.date,b);showDayReport(b.dataset.date);}));
}
function showHistoryDay(key,btn){
  qsa(".day-cell").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");
  const day=getDay(key),t=totals(day),sc=day.finalScore??scoreDay(day),nice=new Date(key+"T12:00:00").toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long",year:"numeric"});
  $("historyDetail").classList.remove("empty-state");
  $("historyDetail").innerHTML=`<h3>${nice}</h3><div class="history-grid"><div><span>Sat fat</span><strong>${fmt(t.sat)}g</strong></div><div><span>Movement</span><strong>${fmtInt(t.mins)} min</strong></div><div><span>CholScore</span><strong>${sc}</strong></div></div><p style="color:#9299aa;font-size:12px;margin-bottom:0">${day.foods.length} food entries · ${day.activities.length} activities${day.checkedOut?" · checked out":""}</p>`;
}

/* v1.8.0 Trends — Calendar/Trends toggle on the History tab. Hand-rolled
   SVG line/area charts (no charting library) so it stays lightweight and
   fully offline-safe for the PWA, consistent with how the rings elsewhere
   are built. Every series is computed fresh from totals()/scoreDay()/the
   same exercise data used by Personal Records — never a separate cache
   that could drift out of sync. */
let trendsRange=30,trendsExercise=null,trendsCardioType=null;

function lastNDaysKeys(n){
  const out=[],today=new Date();
  for(let i=n-1;i>=0;i--){const d=new Date(today);d.setDate(d.getDate()-i);out.push(localDateKey(d));}
  return out;
}
function buildExerciseSeries(){
  const map={};
  for(const dayKey of Object.keys(state.days||{}).sort()){
    const day=state.days[dayKey];
    for(const act of day.activities||[]){
      if(act.type!=="workout")continue;
      for(const ex of act.exercises||[]){
        const name=String(ex.name||"").trim();if(!name)continue;
        if(ex.timed){
          const best=(ex.sets||[]).reduce((m,s)=>Math.max(m,Number(s.timedSeconds||s.actual||0)),0);
          if(best>0){(map[name]=map[name]||{type:"timed",points:[]}).points.push({date:dayKey,value:best});}
        }else{
          const weight=exerciseHeaviestWeight(ex);
          if(weight>0){(map[name]=map[name]||{type:"strength",points:[]}).points.push({date:dayKey,value:weight});}
        }
      }
    }
  }
  return map;
}
function svgAreaChart(svgId,labelsId,data,dateKeys,opts){
  const svg=$(svgId);if(!svg)return;
  const W=320,H=110,PAD=6,n=data.length;
  const max=opts.max!=null?opts.max:Math.max(1,...data)*1.15;
  const stepX=n>1?(W-PAD*2)/(n-1):0;
  const y=v=>H-PAD-(v/(max||1))*(H-PAD*2);
  const pts=data.map((v,i)=>[PAD+i*stepX,y(v)]);
  const linePath=pts.map((p,i)=>(i===0?"M":"L")+p[0].toFixed(1)+","+p[1].toFixed(1)).join(" ");
  let html=`<defs><linearGradient id="grad-${svgId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${opts.color}" stop-opacity="0.55"/><stop offset="100%" stop-color="${opts.color}" stop-opacity="0"/></linearGradient></defs>`;
  if(opts.target!=null){const ty=y(opts.target);html+=`<line class="chart-target-line" x1="${PAD}" y1="${ty}" x2="${W-PAD}" y2="${ty}"/>`;}
  if(n>1){
    const areaPath=linePath+` L${pts[n-1][0].toFixed(1)},${H-PAD} L${pts[0][0].toFixed(1)},${H-PAD} Z`;
    html+=`<path class="chart-area" fill="url(#grad-${svgId})" d="${areaPath}"/><path class="chart-line" stroke="${opts.color}" d="${linePath}"/>`;
  }
  const dotIdxs=n<=8?pts.map((_,i)=>i):[0,Math.floor((n-1)*0.33),Math.floor((n-1)*0.66),n-1];
  dotIdxs.forEach(i=>{if(pts[i])html+=`<circle class="chart-dot" stroke="${opts.color}" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="3.2"/>`;});
  svg.innerHTML=html;
  const labelsEl=$(labelsId);
  if(labelsEl){
    const step=Math.max(1,Math.round(n/5));
    labelsEl.innerHTML=dateKeys.filter((_,i)=>i%step===0||i===dateKeys.length-1)
      .map(k=>`<span>${new Date(k+"T12:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short"})}</span>`).join("");
  }
}
function renderTrendsSatScore(){
  const dayKeys=lastNDaysKeys(trendsRange);
  const satSeries=dayKeys.map(k=>totals(getDay(k)).sat);
  const scoreSeries=dayKeys.map(k=>{const day=getDay(k);return day.finalScore??scoreDay(day);});
  const target=Number(state.profile?.target||30);
  svgAreaChart("satChart","satChartLabels",satSeries,dayKeys,{color:"#55f0a7",target});
  svgAreaChart("scoreChart","scoreChartLabels",scoreSeries,dayKeys,{color:"#a879ff",max:100});
  $("satTrendStat").querySelector("strong").textContent=`${fmt(satSeries.reduce((a,b)=>a+b,0)/satSeries.length)}g`;
  $("scoreTrendStat").querySelector("strong").textContent=Math.round(scoreSeries.reduce((a,b)=>a+b,0)/scoreSeries.length);
}
function renderStrengthTrend(){
  const series=buildExerciseSeries();
  const names=Object.keys(series).filter(n=>series[n].points.length>=2).sort((a,b)=>series[b].points.length-series[a].points.length);
  const emptyEl=$("strengthEmptyState"),bodyEl=$("strengthTrendBody");
  if(!names.length){emptyEl.classList.remove("hidden");bodyEl.classList.add("hidden");return;}
  emptyEl.classList.add("hidden");bodyEl.classList.remove("hidden");
  if(!trendsExercise||!names.includes(trendsExercise))trendsExercise=names[0];
  $("exercisePicker").innerHTML=names.map(n=>`<button type="button" class="exercise-chip${n===trendsExercise?" active":""}" data-name="${esc(n)}">${esc(n)}</button>`).join("");
  qsa(".exercise-chip",$("exercisePicker")).forEach(chip=>chip.addEventListener("click",()=>{trendsExercise=chip.dataset.name;renderStrengthTrend();}));
  const ex=series[trendsExercise],values=ex.points.map(p=>p.value),dateKeys=ex.points.map(p=>p.date);
  svgAreaChart("strengthChart","strengthChartLabels",values,dateKeys,{color:"#54d9ff"});
  const first=values[0],last=values[values.length-1],diff=last-first,isTimed=ex.type==="timed";
  const fmtVal=v=>isTimed?formatExerciseSeconds(v):`${fmt(v)}kg`;
  const firstDateNice=new Date(dateKeys[0]+"T12:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short"});
  $("strengthCalloutText").innerHTML=diff>0
    ? `<b>+${isTimed?formatExerciseSeconds(diff):fmt(diff)+"kg"}</b> since ${firstDateNice}, up from ${fmtVal(first)} to ${fmtVal(last)}.`
    : `Holding steady at ${fmtVal(last)} since ${firstDateNice}.`;
}
function buildCardioSeries(){
  const map={};
  for(const t in CARDIO_TYPES)map[t]={points:[]};
  for(const dayKey of Object.keys(state.days||{}).sort()){
    const day=state.days[dayKey];
    for(const act of day.activities||[]){
      if(!map[act.type])continue;
      const distanceKm=Number(act.distance||0),minutes=Number(act.minutes||0);
      if(distanceKm>0&&minutes>0)map[act.type].points.push({date:dayKey,paceDisplay:minutes/kmToDisplay(distanceKm)});
    }
  }
  return map;
}
function renderCardioTrend(){
  const series=buildCardioSeries();
  const types=Object.keys(CARDIO_TYPES).filter(t=>series[t].points.length>=2);
  const emptyEl=$("cardioEmptyState"),bodyEl=$("cardioTrendBody");
  if(!types.length){emptyEl.classList.remove("hidden");bodyEl.classList.add("hidden");return;}
  emptyEl.classList.add("hidden");bodyEl.classList.remove("hidden");
  if(!trendsCardioType||!types.includes(trendsCardioType))trendsCardioType=types[0];
  $("cardioPicker").innerHTML=types.map(t=>`<button type="button" class="exercise-chip${t===trendsCardioType?" active":""}" data-type="${t}">${cardioIcon(t)} ${cardioLabel(t)}</button>`).join("");
  qsa(".exercise-chip",$("cardioPicker")).forEach(chip=>chip.addEventListener("click",()=>{trendsCardioType=chip.dataset.type;renderCardioTrend();}));

  const pts=series[trendsCardioType].points,unit=distanceUnit(),dateKeys=pts.map(p=>p.date);
  // Chart shows speed (units/hour), not raw pace — a rising line reads as
  // "getting faster", same up-is-better visual language as Strength
  // progress. The callout still talks in ordinary pace (min:sec/unit)
  // since that's the familiar way to describe running/walking pace.
  const speeds=pts.map(p=>p.paceDisplay>0?60/p.paceDisplay:0);
  svgAreaChart("cardioChart","cardioChartLabels",speeds,dateKeys,{color:"#ffd166"});

  const fmtPace=v=>{const m=Math.floor(v),s=Math.round((v-m)*60);return `${m}:${String(s).padStart(2,"0")}`;};
  const firstPace=pts[0].paceDisplay,lastPace=pts[pts.length-1].paceDisplay,paceDiff=firstPace-lastPace;
  const firstDateNice=new Date(dateKeys[0]+"T12:00:00").toLocaleDateString(undefined,{day:"numeric",month:"short"});
  $("cardioCalloutText").innerHTML=paceDiff>0.01
    ? `<b>${fmtPace(Math.abs(paceDiff))}/${unit} faster</b> since ${firstDateNice}, pace improved from ${fmtPace(firstPace)}/${unit} to ${fmtPace(lastPace)}/${unit}.`
    : paceDiff<-0.01
    ? `Pace eased from ${fmtPace(firstPace)}/${unit} to ${fmtPace(lastPace)}/${unit} since ${firstDateNice}.`
    : `Holding steady at ${fmtPace(lastPace)}/${unit} since ${firstDateNice}.`;
}
/* v1.20.0 Weekly/Monthly Report — reuses mondayKeyFor() (the exact same
   Monday-Sunday boundary already used by weekly achievements) and the same
   totals()/scoreDay() functions as the rest of the app, so this can never
   disagree with what's shown on Today, Trends, or the Day Report.
   Tense-aware: a week still in progress uses days-elapsed as its own
   denominator (not a fixed 7, which would silently count days that haven't
   happened yet as "not on target") and every message template has a
   present-tense in-progress version and a past-tense completed version. */
function firstLogDateKey(){
  let first=null;
  for(const key in state.days){
    if(first===null||key<first) first=key;
  }
  return first;
}
function weekSummary(mondayKey,records){
  const target=Number(state.profile?.target||30);
  const today=todayKey();
  const firstLog=firstLogDateKey();
  const start=new Date(mondayKey+"T12:00:00");
  const endDate=new Date(start);endDate.setDate(endDate.getDate()+6);
  const endKey=localDateKey(endDate);
  const isCurrent=today>=mondayKey&&today<=endKey;
  const dayKeys=[];
  for(let i=0;i<7;i++){const d=new Date(start);d.setDate(d.getDate()+i);dayKeys.push(localDateKey(d));}
  // Only count days that have actually happened AND fall on/after the user's
  // very first logged day — otherwise a week entirely before someone started
  // using CholScore gets counted as 7 "missed" days, which silently tanks
  // their on-target ratio for a period they were never even tracking.
  const eligibleKeys=dayKeys.filter(k=>k<=today&&(!firstLog||k>=firstLog));
  const daysElapsed=eligibleKeys.length;

  let minutes=0,weightLifted=0,workouts=0,daysUnder=0,rewardPoints=0,bestDay=null,distanceKm=0;
  for(const key of eligibleKeys){
    const day=getDay(key),t=totals(day);
    minutes+=t.mins;
    for(const a of day.activities||[]){
      if(a.type==="workout"){workouts++;weightLifted+=Number(a.totalWeight||0);}
      else if(CARDIO_TYPES[a.type]){distanceKm+=Number(a.distance||0);}
    }
    if(day.foods?.length&&t.sat<=target)daysUnder++;
    rewardPoints+=dailyBankPoints(day);
    if(day.checkedOut){
      const score=Number(day.finalScore??scoreDay(day));
      if(!bestDay||score>bestDay.score)bestDay={key,score};
    }
  }
  let prCount=0;
  if(records){
    const allDates=[
      ...Object.values(records.strength||{}).map(r=>r.date),
      ...Object.values(records.timed||{}).map(r=>r.date),
      records.cardio?.walk?.dateForDistance,records.cardio?.walk?.dateForPace,
      records.cardio?.run?.dateForDistance,records.cardio?.run?.dateForPace,
    ].filter(Boolean);
    prCount=allDates.filter(d=>dayKeys.includes(d)).length;
  }
  return {mondayKey,endKey,isCurrent,minutes,weightLifted,workouts,daysUnder,daysTotal:daysElapsed,rewardPoints,bestDay,prCount,distanceKm};
}
function weekLabel(mondayKey){
  const start=new Date(mondayKey+"T12:00:00");
  const end=new Date(start);end.setDate(end.getDate()+6);
  const sameMonth=start.getMonth()===end.getMonth();
  if(sameMonth){
    const monthStr=start.toLocaleDateString(undefined,{month:"short"});
    return `${monthStr} ${start.getDate()} – ${end.getDate()}`;
  }
  const startStr=start.toLocaleDateString(undefined,{day:"numeric",month:"short"});
  const endStr=end.toLocaleDateString(undefined,{day:"numeric",month:"short"});
  return `${startStr} – ${endStr}`;
}
function weeklyHighlightClause(summary){
  const clauses=[];
  if(summary.prCount>0)clauses.push(`hit <strong>${summary.prCount} personal record${summary.prCount===1?"":"s"}</strong>`);
  if(summary.rewardPoints>0)clauses.push(`banked <strong>${fmtInt(summary.rewardPoints)} reward point${summary.rewardPoints===1?"":"s"}</strong>`);
  if(summary.bestDay&&summary.bestDay.score>=80){
    const dayName=new Date(summary.bestDay.key+"T12:00:00").toLocaleDateString(undefined,{weekday:"long"});
    clauses.push(`your best day was <strong>${dayName}</strong> at a CholScore of <strong>${summary.bestDay.score}</strong>`);
  }
  if(!clauses.length)return "";
  return `, and you ${clauses.slice(0,2).join(", plus ")}`;
}
function weeklyReportMessage(summary,name){
  const ratio=summary.daysTotal?summary.daysUnder/summary.daysTotal:0;
  const mins=fmtInt(summary.minutes);
  const highlight=weeklyHighlightClause(summary);
  const n=esc(name);
  if(summary.isCurrent){
    const daysLeft=7-summary.daysTotal;
    const remainingClause=daysLeft>0?`, ${daysLeft} day${daysLeft===1?"":"s"} left to build on it`:"";
    if(ratio>=0.85)return `Great momentum, ${n}, you're <strong>${summary.daysUnder} for ${summary.daysTotal}</strong> on your saturated fat target this week, with <strong>${mins} minutes</strong> of movement already banked${highlight}${remainingClause}.`;
    if(ratio>=0.5)return `Solid progress so far, ${n}. <strong>${summary.daysUnder} of ${summary.daysTotal} days</strong> under target and <strong>${mins} minutes</strong> of movement this week${highlight}${remainingClause}.`;
    return `Every day this week is still an opportunity, ${n}, <strong>${mins} minutes</strong> of movement already in the bank${highlight}${remainingClause}.`;
  }
  if(ratio>=0.85)return `Strong week, ${n}, <strong>${summary.daysUnder} of ${summary.daysTotal} days</strong> under your saturated fat limit and <strong>${mins} minutes</strong> of movement${highlight}. Every choice like that shapes what comes next.`;
  if(ratio>=0.5)return `Solid week, ${n}. <strong>${summary.daysUnder} of ${summary.daysTotal} days</strong> under target and <strong>${mins} minutes</strong> on your feet${highlight}, the choices you're making are paying off.`;
  return `A quieter week, ${n}, <strong>${mins} minutes</strong> of movement still went in the bank${highlight}. A new week means a fresh ${summary.daysTotal} days to build on it.`;
}
function renderWeekReportCardHTML(summary,name){
  const unit=distanceUnit();
  const displayDistance=fmt(kmToDisplay(summary.distanceKm));
  return `
    <div class="report-card">
      <div class="report-badge">🗓️</div>
      <h2 class="report-title">${summary.isCurrent?"Your week so far":"Your week in review"}</h2>
      <p class="report-sub">${esc(weekLabel(summary.mondayKey))}</p>
      <p class="report-message">${weeklyReportMessage(summary,name)}</p>
      <div class="report-stat-grid">
        <div class="report-stat-card cyan"><span>Movement</span><strong>${fmtInt(summary.minutes)}</strong><small>minutes total</small></div>
        <div class="report-stat-card green"><span>Weight lifted</span><strong>${fmt(summary.weightLifted)}</strong><small>kg total volume</small></div>
        <div class="report-stat-card violet"><span>Workouts</span><strong>${summary.workouts}</strong><small>sessions completed</small></div>
        <div class="report-stat-card"><span>On target</span><strong>${summary.daysUnder}/${summary.daysTotal}</strong><small>days under sat fat limit</small></div>
        <div class="report-stat-card amber full-width"><span>Total distance</span><strong>${displayDistance} ${unit}</strong><small>across all activities</small></div>
      </div>
    </div>`;
}
function renderMonthReportCardHTML(name,records){
  const currentMonday=mondayKeyFor(new Date());
  const weeks=[];
  for(let i=3;i>=0;i--){
    const d=new Date(currentMonday+"T12:00:00");d.setDate(d.getDate()-7*i);
    weeks.push(weekSummary(mondayKeyFor(d),records));
  }
  const totalMinutes=weeks.reduce((a,w)=>a+w.minutes,0);
  const totalWeight=weeks.reduce((a,w)=>a+w.weightLifted,0);
  const totalDaysUnder=weeks.reduce((a,w)=>a+w.daysUnder,0);
  const totalDaysElapsed=weeks.reduce((a,w)=>a+w.daysTotal,0);
  const totalPRs=weeks.reduce((a,w)=>a+w.prCount,0);
  const totalPoints=weeks.reduce((a,w)=>a+w.rewardPoints,0);
  const totalDistanceKm=weeks.reduce((a,w)=>a+w.distanceKm,0);
  const unit=distanceUnit();
  const displayDistance=fmt(kmToDisplay(totalDistanceKm));
  const maxMinutes=Math.max(1,...weeks.map(w=>w.minutes));
  const bestWeek=weeks.reduce((best,w)=>w.minutes>best.minutes?w:best,weeks[0]);
  const weekRows=weeks.map(w=>`
    <div class="report-week-row">
      <div class="wk-label">${esc(weekLabel(w.mondayKey))}${w.isCurrent?" (so far)":""}</div>
      <div class="wk-bar-track"><div class="wk-bar-fill" style="width:${Math.round(w.minutes/maxMinutes*100)}%"></div></div>
      <div class="wk-value">${fmtInt(w.minutes)} min</div>
    </div>`).join("");
  const extras=[];
  if(totalPRs>0)extras.push(`hit <strong>${totalPRs} personal record${totalPRs===1?"":"s"}</strong>`);
  if(totalPoints>0)extras.push(`banked <strong>${fmtInt(totalPoints)} reward point${totalPoints===1?"":"s"}</strong>`);
  const extraClause=extras.length?`, and you ${extras.slice(0,2).join(", plus ")}`:"";
  const message=`Across the last 4 weeks you've moved for <strong>${fmtInt(totalMinutes)} minutes</strong> and stayed under target on <strong>${totalDaysUnder} of ${totalDaysElapsed} days</strong>${extraClause}. Consistency compounds, nice work showing up, ${esc(name)}.`;
  return `
    <div class="report-card">
      <div class="report-badge">📊</div>
      <h2 class="report-title">Your month in review</h2>
      <p class="report-sub">Last 4 weeks</p>
      <p class="report-message">${message}</p>
      <div class="report-stat-grid">
        <div class="report-stat-card cyan"><span>Movement</span><strong>${fmtInt(totalMinutes)}</strong><small>minutes total</small></div>
        <div class="report-stat-card green"><span>Weight lifted</span><strong>${fmt(totalWeight)}</strong><small>kg total volume</small></div>
        <div class="report-stat-card"><span>On target</span><strong>${totalDaysUnder}/${totalDaysElapsed}</strong><small>days under sat fat limit</small></div>
        <div class="report-stat-card violet"><span>Best week</span><strong>${fmtInt(bestWeek.minutes)}</strong><small>min, ${esc(weekLabel(bestWeek.mondayKey))}</small></div>
        <div class="report-stat-card amber full-width"><span>Total distance</span><strong>${displayDistance} ${unit}</strong><small>across all activities</small></div>
      </div>
      <div class="report-week-breakdown">${weekRows}</div>
    </div>`;
}
let reportsRange="lastweek";
function renderReports(){
  const name=state.profile?.name||"there";
  const records=computePersonalRecords();
  if(reportsRange==="lastweek"){
    const lastMonday=new Date(mondayKeyFor(new Date())+"T12:00:00");
    lastMonday.setDate(lastMonday.getDate()-7);
    $("reportContent").innerHTML=renderWeekReportCardHTML(weekSummary(mondayKeyFor(lastMonday),records),name);
  }else if(reportsRange==="week"){
    $("reportContent").innerHTML=renderWeekReportCardHTML(weekSummary(mondayKeyFor(new Date()),records),name);
  }else{
    $("reportContent").innerHTML=renderMonthReportCardHTML(name,records);
  }
}
qsa("[data-report-range]").forEach(btn=>btn.addEventListener("click",()=>{
  qsa("[data-report-range]").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");
  reportsRange=btn.dataset.reportRange;
  renderReports();
}));

function renderTrends(){
  const hasAnyData=Object.keys(state.days||{}).length>0;
  $("trendsEmptyState").classList.toggle("hidden",hasAnyData);
  $("trendsContent").classList.toggle("hidden",!hasAnyData);
  if(!hasAnyData)return;
  renderTrendsSatScore();
  renderStrengthTrend();
  renderCardioTrend();
}
qsa(".range-btn").forEach(btn=>btn.addEventListener("click",()=>{
  qsa(".range-btn").forEach(b=>b.classList.remove("active"));btn.classList.add("active");
  trendsRange=Number(btn.dataset.range);renderTrendsSatScore();
}));
const historyTabs=[["historyTabCalendar","historyCalendarView"],["historyTabTrends","historyTrendsView"],["historyTabReports","historyReportsView"]];
function switchHistoryTab(activeBtnId){
  historyTabs.forEach(([btnId,viewId])=>{
    const isActive=btnId===activeBtnId;
    $(btnId).classList.toggle("active",isActive);
    $(viewId).classList.toggle("hidden",!isActive);
  });
  if(activeBtnId==="historyTabTrends")renderTrends();
  if(activeBtnId==="historyTabReports")renderReports();
}
$("historyTabCalendar").addEventListener("click",()=>switchHistoryTab("historyTabCalendar"));
$("historyTabTrends").addEventListener("click",()=>{if(!isPremiumUnlocked()){showPaywall();return;}switchHistoryTab("historyTabTrends");});
$("historyTabReports").addEventListener("click",()=>{if(!isPremiumUnlocked()){showPaywall();return;}switchHistoryTab("historyTabReports");});

/* v1.4.0 full-screen Day Report — a "sports report" style recap of one
   whole day, built from the exact same data functions used everywhere
   else (totals/scoreDay/exerciseVolume/formatActivityDuration/formatPace),
   so it's guaranteed to agree with the rest of the app. */
function repTrainingSectionHTML(workouts,dayKey,records){
  if(!workouts.length)return `<div class="rep-section reveal"><div class="rep-section-head"><div class="rep-section-bar"></div><h2>Strength Session</h2></div><p class="rep-empty">No training logged this day.</p></div>`;
  return workouts.map(w=>{
    const rows=(w.exercises||[]).map((ex,i)=>{
      const name=String(ex.name||"").trim();
      let meta,value,unit,isPR=false;
      if(ex.timed){
        const totalSec=(ex.sets||[]).reduce((sum,s)=>sum+Number(s.timedSeconds||s.actual||0),0);
        const bestSetSeconds=(ex.sets||[]).reduce((m,s)=>Math.max(m,Number(s.timedSeconds||s.actual||0)),0);
        meta=`${ex.sets.length} timed ${ex.sets.length===1?"set":"sets"}`;
        value=formatExerciseSeconds(totalSec);unit="held";
        const rec=records?.timed?.[name];
        isPR=!!(rec&&rec.date===dayKey&&bestSetSeconds>0&&rec.seconds===bestSetSeconds);
      }else{
        const vol=exerciseVolume(ex);
        const weight=exerciseHeaviestWeight(ex);
        meta=`${(ex.sets||[]).length} sets${ex.targetReps?` × ${ex.targetReps} reps`:""}`;
        value=Number(vol)>0?fmt(vol):"—";unit="kg volume";
        const rec=records?.strength?.[name];
        isPR=!!(rec&&rec.date===dayKey&&weight>0&&rec.weight===weight);
      }
      return `<div class="rep-exercise-row${isPR?" is-pr":""}"><div class="rep-exercise-num">${i+1}</div><div><div class="rep-exercise-name">${esc(ex.name)}${isPR?'<span class="rep-pr-chip">🏆 PR</span>':""}</div><div class="rep-exercise-meta">${esc(meta)}</div></div><div class="rep-exercise-value">${value}<small>${unit}</small></div></div>`;
    }).join("");
    return `<div class="rep-section reveal"><div class="rep-section-head"><div class="rep-section-bar"></div><h2>Strength Session · ${esc(w.name||"Workout")}</h2></div>${rows}</div>`;
  }).join("");
}
function repCardioSectionHTML(cardio,dayKey,records){
  if(!cardio.length)return `<div class="rep-section reveal"><div class="rep-section-head"><div class="rep-section-bar"></div><h2>Cardio</h2></div><p class="rep-empty">No cardio logged this day.</p></div>`;
  const unit=distanceUnit();
  const rows=cardio.map(a=>{
    const icon=cardioIcon(a.type);
    const displayDist=a.distance>0?Number(kmToDisplay(a.distance).toFixed(1)):0;
    const pace=displayDist>0?formatPace(a.minutes,displayDist):null;
    const label=a.name||cardioLabel(a.type);
    const bucket=records?.cardio?.[a.type];
    const distanceKm=Number(a.distance||0);
    const isDistPR=!!(bucket&&bucket.dateForDistance===dayKey&&distanceKm>0&&bucket.longestKm===distanceKm);
    const paceMinPerKm=distanceKm>0&&a.minutes>0?a.minutes/distanceKm:null;
    const isPacePR=!!(bucket&&bucket.dateForPace===dayKey&&paceMinPerKm!=null&&bucket.bestPaceMinPerKm===paceMinPerKm);
    const isPR=isDistPR||isPacePR;
    return `<div class="rep-cardio-row${isPR?" is-pr":""}">
      <div class="rep-cardio-icon">${icon}</div>
      <div class="rep-cardio-name"><span class="rep-cardio-name-text">${esc(label)}</span>${isPR?'<span class="rep-pr-chip">🏆 PR</span>':""}</div>
      <div class="rep-cardio-col"><strong>${formatActivityDuration(a.minutes)}</strong></div>
      <div class="rep-cardio-col"><strong>${displayDist>0?`${displayDist} ${unit}`:"—"}</strong>${isDistPR?'<small class="rep-pr-trophy">🏆</small>':""}</div>
      <div class="rep-cardio-col"><strong>${pace||"—"}</strong>${isPacePR?'<small class="rep-pr-trophy">🏆</small>':""}</div>
    </div>`;
  }).join("");
  return `<div class="rep-section reveal"><div class="rep-section-head"><div class="rep-section-bar"></div><h2>Cardio</h2></div><div class="rep-cardio-head"><span></span><span>Activity</span><span>Time</span><span>Dist</span><span>Pace (min/${unit})</span></div>${rows}</div>`;
}
function repNutritionSectionHTML(day,target){
  const totalProtein=day.foods.reduce((a,b)=>a+Number(b.protein||0),0);
  const totalSat=day.foods.reduce((a,b)=>a+Number(b.sat||0),0);
  const satPct=target>0?Math.min(100,totalSat/target*100):0;
  const foodRows=day.foods.length
    ? day.foods.map(f=>`<div class="rep-food-row"><div><div class="rep-food-name">${esc(f.name||"Food")}</div><div class="rep-food-meal">${esc(f.meal||"")}</div></div><div class="rep-food-nums"><b>${fmt(f.sat)}g</b> sat fat · <b>${f.protein!=null?`${fmt(f.protein)}g`:"—"}</b> protein</div></div>`).join("")
    : `<p class="rep-empty">No food logged this day.</p>`;
  return `<div class="rep-section reveal">
    <div class="rep-section-head"><div class="rep-section-bar"></div><h2>Nutrition</h2></div>
    <div class="rep-protein-hero">
      <div><span>Protein</span><strong>${fmt(totalProtein)}g</strong></div>
      <div class="rep-satfat-bar-wrap">
        <div class="rep-satfat-bar-track"><div class="rep-satfat-bar-fill" id="repSatBar"></div></div>
        <div class="rep-satfat-bar-text">${fmt(totalSat)}g / ${fmt(target)}g sat fat</div>
      </div>
    </div>
    ${foodRows}
  </div>`;
}
function repRewardSectionHTML(key){
  const claims=(state.rewardBank?.history||[]).filter(h=>h.dayKey===key);
  if(!claims.length) return "";
  return claims.map(c=>`
    <div class="rep-section reveal">
      <div class="rep-section-head"><div class="rep-section-bar"></div><h2>Reward Claimed</h2></div>
      <div class="rep-reward-claim">
        <span class="rep-reward-icon">${c.icon}</span>
        <div><strong>${esc(c.name)}</strong><small>Cashed out for ${c.target} point${c.target===1?"":"s"}</small></div>
      </div>
    </div>`).join("");
}
function showDayReport(key){
  if(!isPremiumUnlocked()){showPaywall();return;}
  const day=getDay(key),t=totals(day),target=Number(state.profile?.target||30);
  const score=day.finalScore??scoreDay(day);
  const dateObj=new Date(key+"T12:00:00");
  const weekday=dateObj.toLocaleDateString(undefined,{weekday:"long"});
  const niceDate=dateObj.toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"});
  const workouts=(day.activities||[]).filter(a=>a.type==="workout");
  const cardio=(day.activities||[]).filter(a=>a.type!=="workout");
  const records=computePersonalRecords();

  $("dayReportInner").innerHTML=`
    <div class="rep-hero">
      <div class="rep-eyebrow">Daily Report</div>
      <div class="rep-date">${esc(weekday)}<small>${esc(niceDate)}</small></div>
      <div class="rep-score-row">
        <div class="rep-score-box">
          <span>CholScore</span>
          <div class="rep-score-num" id="repScoreNum">0</div>
          <div class="rep-score-label">${esc(scoreLabel(score))}</div>
        </div>
        <div class="rep-mini-stats">
          <div><span>Sat fat</span><strong>${fmt(t.sat)}g</strong></div>
          <div><span>Movement</span><strong>${fmtInt(t.mins)} min</strong></div>
          <div><span>Checked out</span><strong>${day.checkedOut?"Yes":"No"}</strong></div>
        </div>
      </div>
    </div>

    <div class="rep-section reveal">
      <div class="rep-section-head"><div class="rep-section-bar"></div><h2>Today's Rings</h2></div>
      <div class="rep-rings">
        <div class="rep-ring-card"><div class="rep-ring-wrap"><svg viewBox="0 0 78 78"><circle class="rep-ring-track" cx="39" cy="39" r="32"/><circle class="rep-ring-fill" id="repRingFat" cx="39" cy="39" r="32" stroke="var(--rep-accent)" stroke-dasharray="201.06" stroke-dashoffset="201.06"/></svg><div class="rep-ring-num">${fmt(t.sat)}g</div></div><div class="rep-ring-label">Sat fat</div></div>
        <div class="rep-ring-card"><div class="rep-ring-wrap"><svg viewBox="0 0 78 78"><circle class="rep-ring-track" cx="39" cy="39" r="32"/><circle class="rep-ring-fill" id="repRingMins" cx="39" cy="39" r="32" stroke="var(--cyan)" stroke-dasharray="201.06" stroke-dashoffset="201.06"/></svg><div class="rep-ring-num">${fmtInt(t.mins)}</div></div><div class="rep-ring-label">Minutes</div></div>
        <div class="rep-ring-card"><div class="rep-ring-wrap"><svg viewBox="0 0 78 78"><circle class="rep-ring-track" cx="39" cy="39" r="32"/><circle class="rep-ring-fill" id="repRingScore" cx="39" cy="39" r="32" stroke="var(--violet)" stroke-dasharray="201.06" stroke-dashoffset="201.06"/></svg><div class="rep-ring-num">${score}</div></div><div class="rep-ring-label">Score</div></div>
      </div>
    </div>

    ${repRewardSectionHTML(key)}
    ${repTrainingSectionHTML(workouts,key,records)}
    ${repCardioSectionHTML(cardio,key,records)}
    ${repNutritionSectionHTML(day,target)}

    <div class="rep-footer reveal"><div class="rep-footer-mark">End of report</div></div>
  `;

  const dlg=$("dayReportDialog");
  dlg.classList.remove("is-visible");
  dlg.showModal();
  requestAnimationFrame(()=>requestAnimationFrame(()=>dlg.classList.add("is-visible")));

  const scoreEl=$("repScoreNum"),duration=900,startT=performance.now();
  function frame(now){
    const tt=Math.min(1,(now-startT)/duration),eased=1-Math.pow(1-tt,3);
    scoreEl.textContent=Math.round(score*eased);
    if(tt<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  const CIRC_R=2*Math.PI*32;
  const satPctRing=target>0?Math.min(1,t.sat/target):0,minsPctRing=Math.min(1,t.mins/45),scorePctRing=Math.min(1,score/100);
  setTimeout(()=>{$("repRingFat").style.strokeDashoffset=CIRC_R*(1-satPctRing);},150);
  setTimeout(()=>{$("repRingMins").style.strokeDashoffset=CIRC_R*(1-minsPctRing);},300);
  setTimeout(()=>{$("repRingScore").style.strokeDashoffset=CIRC_R*(1-scorePctRing);},450);
  const satBar=$("repSatBar");
  if(satBar)setTimeout(()=>{satBar.style.width=`${target>0?Math.min(100,day.foods.reduce((a,b)=>a+Number(b.sat||0),0)/target*100):0}%`;},200);

  const io=new IntersectionObserver(entries=>{
    entries.forEach(en=>{if(en.isIntersecting)en.target.classList.add("in");});
  },{threshold:.15});
  qsa(".reveal",$("dayReportInner")).forEach(el=>io.observe(el));
}
$("dayReportClose").addEventListener("click",()=>$("dayReportDialog").close());
$("dayReportDialog").addEventListener("close",()=>$("dayReportDialog").classList.remove("is-visible"));

/* Onboarding */
qsa(".target-option").forEach(btn=>btn.addEventListener("click",()=>{
  qsa(".target-option").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");
  selectedTarget=btn.dataset.target;$("customTargetWrap").classList.toggle("hidden",selectedTarget!=="custom");
}));

qsa(".unit-option").forEach(btn=>btn.addEventListener("click",()=>{
  qsa(".unit-option").forEach(x=>x.classList.remove("selected"));
  btn.classList.add("selected");
  selectedDistanceUnit=btn.dataset.unit;
}));

$("nameInput").addEventListener("input",()=>{
  if(!onboardingPhoto)renderAvatarInto($("onboardingAvatarPreview"),null,$("nameInput").value);
});
$("onboardingAddPhotoBtn").addEventListener("click",()=>$("onboardingPhotoFile").click());
$("onboardingPhotoFile").addEventListener("change",(e)=>{
  const file=e.target.files[0];
  if(!file)return;
  processAndStorePhoto(file,(dataUrl)=>{
    onboardingPhoto=dataUrl;
    renderAvatarInto($("onboardingAvatarPreview"),onboardingPhoto,$("nameInput").value);
  });
  e.target.value="";
});
renderAvatarInto($("onboardingAvatarPreview"),null,"");

$("finishSetup").addEventListener("click",()=>{
  const name=$("nameInput").value.trim(),target=selectedTarget==="custom"?Number($("customTarget").value):Number(selectedTarget);
  if(!name||!target||target<=0)return alert("Please enter your name and choose a valid target.");
  state.profile={name,target,distanceUnit:selectedDistanceUnit,photo:onboardingPhoto};saveState();init();
});

/* Navigation */
qsa(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{
  if(btn.dataset.view==="rewardsView"&&!isPremiumUnlocked()){showPaywall();return;}
  qsa(".nav-btn").forEach(x=>x.classList.remove("active"));btn.classList.add("active");
  qsa(".view").forEach(x=>x.classList.remove("active"));$(btn.dataset.view).classList.add("active");renderAll();
}));


/* Friendly cancel behaviour — never validate when the user just wants to leave */
qsa("[data-close-dialog]").forEach(btn=>btn.addEventListener("click",()=>{
  const dlg=$(btn.dataset.closeDialog);
  if(dlg?.open) dlg.close();
}));

/* Clicking the shaded area outside a normal modal also closes it without validation */
qsa("dialog.modal").forEach(dlg=>{
  dlg.addEventListener("click",e=>{
    if(e.target===dlg) dlg.close();
  });
});

/* Food */
$("openFoodForm").addEventListener("click",()=>$("foodDialog").showModal());
$("foodForm").addEventListener("submit",e=>{
  e.preventDefault();const name=$("foodName").value.trim(),sat=Number($("satFat").value),meal=$("mealType").value;
  if(!name||Number.isNaN(sat))return;
  ensureDay().foods.push({id:id(),name,sat,meal,created:Date.now(),source:"Manual"});state.achievements.firstFood=true;saveState();$("foodDialog").close();e.target.reset();renderAll();
});

/* Barcode scanning + Open Food Facts */
async function openBarcodeScanner(purpose="add"){
  scannerPurpose=purpose;
  $("barcodeDialog").showModal();
  $("scannerStatus").textContent="Starting camera…";
  $("manualBarcodeInput").value="";
  await startBarcodeCamera();
}

async function startBarcodeCamera(){
  try{
    if(typeof Html5Qrcode === "undefined"){
      $("scannerStatus").textContent="Camera scanner couldn't load. You can enter the barcode manually below.";
      return;
    }
    await stopBarcodeCamera();

    barcodeScanner = new Html5Qrcode("scannerReader", false);
    const formats = [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128
    ];

    const config = {
      fps: 10,
      qrbox: { width: 280, height: 150 },
      aspectRatio: 1.6,
      formatsToSupport: formats,
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    };

    await barcodeScanner.start(
      { facingMode: "environment" },
      config,
      async(decodedText)=>{
        const barcode=String(decodedText||"").replace(/\D/g,"");
        if(!barcode) return;
        $("scannerStatus").textContent=`Barcode ${barcode} detected. Looking up product…`;
        if(navigator.vibrate) navigator.vibrate(80);
        await stopBarcodeCamera();
        $("barcodeDialog").close();
        await lookupBarcode(barcode, scannerPurpose);
      },
      ()=>{}
    );
    $("scannerStatus").textContent="Ready, point the camera at a food barcode.";
  }catch(err){
    console.error(err);
    $("scannerStatus").textContent="Camera couldn't start. Check camera permission, or enter the barcode manually below.";
  }
}

async function stopBarcodeCamera(){
  if(barcodeScanner){
    try{
      const stateNow=barcodeScanner.getState?.();
      if(stateNow===2 || stateNow===3) await barcodeScanner.stop();
      await barcodeScanner.clear();
    }catch(e){}
    barcodeScanner=null;
  }
}

async function closeBarcodeScanner(){
  await stopBarcodeCamera();
  if($("barcodeDialog").open) $("barcodeDialog").close();
}

async function lookupBarcode(barcode,purpose="add"){
  barcode=String(barcode||"").trim().replace(/\D/g,"");
  if(!barcode){
    alert("Enter a valid barcode number.");
    return;
  }

  try{
    const fields=[
      "code","product_name","product_name_en","brands","image_front_small_url",
      "serving_size","serving_quantity","nutrition_data_per","nutriments"
    ].join(",");
    const url=`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}?fields=${encodeURIComponent(fields)}`;
    const response=await fetch(url,{headers:{"Accept":"application/json"}});
    if(!response.ok) throw new Error(`Open Food Facts HTTP ${response.status}`);
    const data=await response.json();

    if(data.status!==1 || !data.product){
      $("productNotFoundDialog").showModal();
      return;
    }

    const p=data.product;
    const nutr=p.nutriments||{};
    const sat100=numberOrNull(nutr["saturated-fat_100g"]);
    const satServing=numberOrNull(nutr["saturated-fat_serving"]);
    const protein100=numberOrNull(nutr["proteins_100g"]);
    const proteinServing=numberOrNull(nutr["proteins_serving"]);
    const servingQty=numberOrNull(p.serving_quantity);

    currentProduct={
      barcode,
      name:p.product_name || p.product_name_en || `Product ${barcode}`,
      brand:p.brands || "",
      image:p.image_front_small_url || "",
      servingSize:p.serving_size || "",
      servingQty,
      sat100,
      satServing,
      protein100,
      proteinServing
    };
    if(purpose==="check"){
      checkedProduct={...currentProduct};
      showCheckFoodResult();
    }else{
      showProductDialog();
    }
  }catch(err){
    console.error(err);
    alert("CholScore couldn't reach Open Food Facts just now. Check your connection or add the food manually.");
  }
}

function numberOrNull(v){
  const n=Number(v);
  return Number.isFinite(n)?n:null;
}

function showProductDialog(){
  const p=currentProduct;if(!p)return;
  $("productName").textContent=p.name;
  $("productBrand").textContent=p.brand || "Open Food Facts product";
  $("productBarcode").textContent=`Barcode ${p.barcode}`;
  $("productSat100").textContent=p.sat100!=null?`${fmt(p.sat100)}g`:"Not supplied";

  const img=$("productImage");
  if(p.image){img.src=p.image;img.alt=p.name;img.classList.remove("hidden");}
  else{img.removeAttribute("src");img.classList.add("hidden");}

  const warn=$("productWarning");
  if(p.sat100==null && p.satServing==null){
    warn.textContent="Open Food Facts has this product, but saturated-fat information is missing. Please check the pack and add it manually.";
    warn.classList.remove("hidden");
  }else{
    warn.classList.add("hidden");
  }

  $("productAmount").value=p.servingQty || 100;
  $("productAmountUnit").value="g";

  const servingInfo=$("servingInfo");
  if(p.servingSize || p.servingQty || p.satServing!=null){
    let bits=[];
    if(p.servingSize) bits.push(`Listed serving: ${p.servingSize}`);
    else if(p.servingQty) bits.push(`Listed serving: ${p.servingQty}g`);
    if(p.satServing!=null) bits.push(`${fmt(p.satServing)}g saturated fat per serving`);
    servingInfo.textContent=bits.join(" · ");
    servingInfo.classList.remove("hidden");
    if(p.servingQty || p.satServing!=null){
      const unit=$("productAmountUnit");
      if(![...unit.options].some(o=>o.value==="serving")){
        unit.add(new Option("serving(s)","serving"));
      }
    }
  }else servingInfo.classList.add("hidden");

  recalcProductSat();
  $("productDialog").showModal();
}


function productProteinForAmount(product, amount, unit){
  if(!product) return 0;
  amount=Math.max(0,Number(amount||0));
  if(unit==="serving"){
    if(product.proteinServing!=null) return amount*product.proteinServing;
    if(product.servingQty && product.protein100!=null) return amount*product.servingQty/100*product.protein100;
    return 0;
  }
  return product.protein100!=null ? amount/100*product.protein100 : 0;
}

function recalcProductSat(){
  if(!currentProduct)return;
  const amount=Math.max(0,Number($("productAmount").value||0));
  const unit=$("productAmountUnit").value;
  let sat=0;

  if(unit==="serving"){
    if(currentProduct.satServing!=null){
      sat=amount*currentProduct.satServing;
    }else if(currentProduct.servingQty && currentProduct.sat100!=null){
      sat=amount*currentProduct.servingQty/100*currentProduct.sat100;
    }else{
      sat=0;
    }
  }else{
    sat=currentProduct.sat100!=null ? amount/100*currentProduct.sat100 : 0;
  }
  $("calculatedSat").textContent=fmt(sat);
}

$("scanBtn").addEventListener("click",()=>openBarcodeScanner("add"));
$("checkFoodBtn").addEventListener("click",()=>openBarcodeScanner("check"));
$("closeScannerBtn").addEventListener("click",closeBarcodeScanner);
$("barcodeDialog").addEventListener("cancel",e=>{e.preventDefault();closeBarcodeScanner();});

$("manualLookupBtn").addEventListener("click",async()=>{
  const code=$("manualBarcodeInput").value.trim();
  await stopBarcodeCamera();
  $("barcodeDialog").close();
  await lookupBarcode(code, scannerPurpose);
});
$("manualBarcodeInput").addEventListener("keydown",e=>{
  if(e.key==="Enter"){e.preventDefault();$("manualLookupBtn").click();}
});


function checkedSatForAmount(){
  if(!checkedProduct) return 0;
  const amount=Math.max(0,Number($("checkFoodAmount").value||0));
  const unit=$("checkFoodUnit").value;
  if(unit==="serving"){
    if(checkedProduct.satServing!=null) return amount*checkedProduct.satServing;
    if(checkedProduct.servingQty && checkedProduct.sat100!=null) return amount*checkedProduct.servingQty/100*checkedProduct.sat100;
    return 0;
  }
  return checkedProduct.sat100!=null ? amount/100*checkedProduct.sat100 : 0;
}

function showCheckFoodResult(){
  const p=checkedProduct;if(!p)return;
  $("checkFoodName").textContent=p.name;
  $("checkFoodBrand").textContent=p.brand || "Open Food Facts product";
  $("checkFoodBarcode").textContent=`Barcode ${p.barcode}`;

  const img=$("checkFoodImage"),fallback=$("checkFoodFallback");
  if(p.image){img.src=p.image;img.alt=p.name;img.classList.remove("hidden");fallback.classList.add("hidden");}
  else{img.removeAttribute("src");img.classList.add("hidden");fallback.classList.remove("hidden");}

  $("checkFoodAmount").value=p.servingQty || 100;
  $("checkFoodUnit").value="g";
  recalcCheckFoodImpact();
  $("checkFoodResultDialog").showModal();
}

function recalcCheckFoodImpact(){
  if(!checkedProduct || !state.profile)return;
  const day=getDay(), t=totals(day), target=Number(state.profile.target);
  const sat=checkedSatForAmount();
  const remainingNow=Math.max(0,target-t.sat);
  const afterRaw=target-(t.sat+sat);
  const remainingAfter=Math.max(0,afterRaw);

  $("impactSat").textContent=`${fmt(sat)}g`;
  $("impactRemainingNow").textContent=`${fmt(remainingNow)}g`;
  $("impactRemainingAfter").textContent=afterRaw>=0?`${fmt(remainingAfter)}g`:`${fmt(Math.abs(afterRaw))}g over`;

  // Project today's score if this food were added, without actually saving it.
  const projectedDay=JSON.parse(JSON.stringify(day));
  projectedDay.foods.push({name:checkedProduct.name,sat,meal:"Check"});
  const projected=scoreDay(projectedDay);
  $("impactProjectedScore").textContent=projected;

  const card=$("impactCard");
  card.classList.remove("good","close","over");

  if(checkedProduct.sat100==null && checkedProduct.satServing==null){
    $("impactHeadline").textContent="Nutrition data missing";
    $("impactDetail").textContent="Open Food Facts has the product, but not enough saturated-fat data to calculate the impact.";
    $("checkMessage").textContent="Check the nutrition label on the pack before deciding.";
    $("impactSat").textContent="—";
    return;
  }

  if(afterRaw >= target*.25){
    card.classList.add("good");
    $("impactHeadline").textContent="Fits comfortably today";
    $("impactDetail").textContent="You would still have a useful amount of your daily target left.";
    $("checkMessage").textContent=`This portion would use ${fmt(sat)}g of saturated fat and leave ${fmt(remainingAfter)}g today.`;
  }else if(afterRaw >= 0){
    card.classList.add("close");
    $("impactHeadline").textContent="Fits, but uses most of what's left";
    $("impactDetail").textContent="It stays within today's target, but doesn't leave much room afterwards.";
    $("checkMessage").textContent=`This portion would leave ${fmt(remainingAfter)}g remaining today.`;
  }else{
    card.classList.add("over");
    $("impactHeadline").textContent="Would take you over today's target";
    $("impactDetail").textContent=`By about ${fmt(Math.abs(afterRaw))}g at this portion size.`;
    $("checkMessage").textContent="That doesn't make it a 'bad' food, CholScore is just showing the impact so you can decide what works for you.";
  }
}

$("checkFoodAmount").addEventListener("input",recalcCheckFoodImpact);
$("checkFoodUnit").addEventListener("change",()=>{
  if($("checkFoodUnit").value==="serving") $("checkFoodAmount").value="1";
  else $("checkFoodAmount").value=checkedProduct?.servingQty||100;
  recalcCheckFoodImpact();
});

$("addCheckedFoodBtn").addEventListener("click",()=>{
  if(!checkedProduct)return;
  currentProduct={...checkedProduct};
  $("checkFoodResultDialog").close();
  showProductDialog();
});

$("productAmount").addEventListener("input",recalcProductSat);
$("productAmountUnit").addEventListener("change",()=>{
  if($("productAmountUnit").value==="serving") $("productAmount").value="1";
  else $("productAmount").value=currentProduct?.servingQty||100;
  recalcProductSat();
});

$("productAddForm").addEventListener("submit",e=>{
  e.preventDefault();
  if(!currentProduct)return;
  const sat=Number($("calculatedSat").textContent);
  const chosenMeal=$("productMeal").value;
  if(!chosenMeal) return;
  if((currentProduct.sat100==null && currentProduct.satServing==null) || !Number.isFinite(sat)){
    $("productDialog").close();
    $("foodName").value=currentProduct.name;
    $("mealType").value=$("productMeal").value;
    $("satFat").value="";
    $("foodDialog").showModal();
    return;
  }
  const amount=Number($("productAmount").value||0);
  const unit=$("productAmountUnit").value;
  const protein=productProteinForAmount(currentProduct,amount,unit);
  ensureDay().foods.push({
    id:id(),
    name:currentProduct.name,
    brand:currentProduct.brand,
    barcode:currentProduct.barcode,
    image:currentProduct.image || "",
    sat,
    protein,
    meal:chosenMeal,
    amount,
    amountUnit:unit,
    source:"Open Food Facts",
    created:Date.now()
  });
  state.achievements.firstFood=true;
  saveState();
  $("productDialog").close();
  currentProduct=null;
  renderAll();
});

$("manualFoodFromNotFound").addEventListener("click",()=>{
  $("productNotFoundDialog").close();
  $("foodDialog").showModal();
});


/* Routine builder */
function routineRowSummaryText(row){
  const timed=row.querySelector(".rb-timed").checked;
  const sets=Number(row.querySelector(".rb-sets").value)||0;
  if(timed) return `${sets} timed ${sets===1?"set":"sets"}`;
  const reps=Number(row.querySelector(".rb-reps").value)||0;
  const weight=Number(row.querySelector(".rb-weight").value||0);
  let text=`${sets} sets × ${reps||"?"} reps`;
  if(weight>0) text+=` · ${weight}kg`;
  return text;
}
function renumberRoutineRows(){
  qsa(".exercise-row-num",$("routineExerciseRows")).forEach((el,i)=>{el.textContent=i+1;});
}
function addRoutineExerciseRow(data={name:"",sets:3,reps:10,weight:"",notes:"",id:"",timed:false}){
  const row=document.createElement("div");
  const startOpen=!data.name; // a blank/new exercise opens automatically; an existing one starts collapsed
  row.className="exercise-row"+(startOpen?" is-open":"");
  if(data.id) row.dataset.exerciseId=data.id;
  const isTimed=Boolean(data.timed);
  row.innerHTML=`
    <div class="exercise-row-head">
      <div class="exercise-row-num"></div>
      <div class="exercise-row-head-main">
        <strong class="exercise-row-title">${esc(data.name)||"New exercise"}</strong>
        <div class="exercise-row-summary">
          <span class="exercise-row-summary-text"></span>
          <span class="notes-flag${data.notes?"":" hidden"}">📝</span>
        </div>
      </div>
      <button type="button" class="exercise-row-expand" aria-label="Expand exercise">⌄</button>
      <button type="button" class="row-remove" aria-label="Remove exercise">×</button>
    </div>
    <div class="exercise-row-body">
      <div class="rb-main-fields">
        <input class="rb-name" required placeholder="e.g. Bench press or Plank" aria-label="Exercise name" value="${esc(data.name)}">
        <label class="timed-exercise-toggle">
          <input class="rb-timed" type="checkbox" ${isTimed?"checked":""}>
          <span><b>⏱ Timed exercise</b><small>Use a stopwatch for each set instead of entering reps.</small></span>
        </label>
        <div class="rb-number-grid">
          <label>Sets<input class="rb-sets" type="number" min="1" max="20" value="${Number(data.sets)||3}" required></label>
          <label class="rb-reps-label">Reps<input class="rb-reps" type="number" min="1" max="200" value="${Number(data.reps)||10}" ${isTimed?"disabled":""}></label>
          <label>Weight (kg)<input class="rb-weight" type="number" min="0" step="0.5" placeholder="Optional" value="${Number(data.weight)>0?Number(data.weight):""}"></label>
        </div>
        <label>Exercise notes<textarea class="rb-notes" rows="2" placeholder="Optional cue or reminder">${esc(data.notes||"")}</textarea></label>
      </div>
    </div>`;

  const head=row.querySelector(".exercise-row-head");
  const nameInput=row.querySelector(".rb-name");
  const titleEl=row.querySelector(".exercise-row-title");
  const summaryEl=row.querySelector(".exercise-row-summary-text");
  const notesFlag=row.querySelector(".notes-flag");
  const notesInput=row.querySelector(".rb-notes");
  const timed=row.querySelector(".rb-timed"),reps=row.querySelector(".rb-reps"),repsLabel=row.querySelector(".rb-reps-label");
  const setsInput=row.querySelector(".rb-sets"),weightInput=row.querySelector(".rb-weight");

  const refreshSummary=()=>{summaryEl.textContent=routineRowSummaryText(row);};
  const syncTimed=()=>{reps.disabled=timed.checked;repsLabel.classList.toggle("timed-disabled",timed.checked);refreshSummary();};
  timed.addEventListener("change",syncTimed);
  setsInput.addEventListener("input",refreshSummary);
  reps.addEventListener("input",refreshSummary);
  weightInput.addEventListener("input",refreshSummary);
  nameInput.addEventListener("input",()=>{titleEl.textContent=nameInput.value||"New exercise";});
  notesInput.addEventListener("input",()=>{notesFlag.classList.toggle("hidden",!notesInput.value.trim());});
  syncTimed();

  head.addEventListener("click",e=>{
    if(e.target.closest(".row-remove"))return;
    row.classList.toggle("is-open");
  });
  row.querySelector(".row-remove").addEventListener("click",e=>{
    e.stopPropagation();row.remove();renumberRoutineRows();
  });

  $("routineExerciseRows").appendChild(row);
  renumberRoutineRows();
}
function openRoutineBuilder(){
  editingRoutineId=null;
  $("routineDialogTitle").textContent="Create routine";
  $("saveRoutineBtn").textContent="Save routine";
  $("routineName").value="";
  $("routineExerciseRows").innerHTML="";
  addRoutineExerciseRow();addRoutineExerciseRow();addRoutineExerciseRow();
  $("routineDialog").showModal();
}

function openRoutineEditor(rid){
  const routine=state.routines.find(r=>r.id===rid);
  if(!routine)return;
  editingRoutineId=rid;
  $("routineDialogTitle").textContent="Edit routine";
  $("saveRoutineBtn").textContent="Save changes";
  $("routineName").value=routine.name;
  $("routineExerciseRows").innerHTML="";
  routine.exercises.forEach(e=>addRoutineExerciseRow(e));
  $("routineDialog").showModal();
}

$("newRoutineBtn").addEventListener("click",openRoutineBuilder);
$("addRoutineExercise").addEventListener("click",()=>addRoutineExerciseRow());

$("routineForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("routineName").value.trim();
  const exercises=qsa(".exercise-row").map(row=>{
    const timed=row.querySelector(".rb-timed").checked;
    return {
      id:row.dataset.exerciseId||id(),
      name:row.querySelector(".rb-name").value.trim(),
      sets:Number(row.querySelector(".rb-sets").value),
      reps:timed?0:Number(row.querySelector(".rb-reps").value),
      weight:Number(row.querySelector(".rb-weight").value||0),
      notes:row.querySelector(".rb-notes").value.trim(),
      timed
    };
  }).filter(x=>x.name&&x.sets>0&&(x.timed||x.reps>0));

  if(!name)return alert("Give your routine a name.");
  if(!exercises.length)return alert("Add at least one exercise.");

  if(editingRoutineId){
    const routine=state.routines.find(r=>r.id===editingRoutineId);
    if(routine){
      routine.name=name;
      routine.exercises=exercises;
      routine.updated=Date.now();
    }
  }else{
    state.routines.push({id:id(),name,exercises,created:Date.now()});
  }

  saveState();
  editingRoutineId=null;
  $("routineDialog").close();
  renderExercise();
});
function deleteRoutine(rid){
  const r=state.routines.find(x=>x.id===rid);if(!r)return;
  if(confirm(`Delete "${r.name}"?`)){state.routines=state.routines.filter(x=>x.id!==rid);saveState();renderExercise();}
}

/* Live workouts */
const exerciseCheers=[
  "Brilliant work",
  "You nailed that one",
  "Strong work",
  "That is another one done",
  "Excellent effort",
  "Great job, keep it moving"
];
const workoutCheers=[
  "Amazing work",
  "Outstanding effort",
  "Brilliant session",
  "What a workout",
  "Superb work",
  "Fantastic effort"
];
const workoutSubCheers=[
  "You smashed that workout! 💪",
  "That was seriously strong work! ⭐",
  "Another brilliant workout in the bank! 🎉",
  "You brought the effort today! 💪",
  "That session absolutely counted! ✨",
  "Strong, focused and finished! ⭐"
];
function randomFrom(items){return items[Math.floor(Math.random()*items.length)];}
function routineExerciseForWorkoutExercise(w,e){
  const routine=state.routines.find(r=>r.id===w?.routineId);
  if(!routine)return null;
  return routine.exercises.find(x=>x.id===e?.sourceExerciseId)
    || routine.exercises.find(x=>String(x.name||"").trim().toLowerCase()===String(e?.name||"").trim().toLowerCase())
    || null;
}
function resolvedWorkoutWeight(w,e){
  // Once the live weight adjuster has been used for this exercise, its value
  // is authoritative even at exactly 0kg (deliberately dropped to bodyweight)
  // — without this flag, 0 would look identical to "never set" below and get
  // silently overwritten back to the routine's original weight on next render.
  if(e?.weightManuallySet) return Math.max(0,Number(e.weight||0));
  const direct=Number(e?.weight||0);
  if(Number.isFinite(direct)&&direct>0)return direct;
  const source=routineExerciseForWorkoutExercise(w,e);
  const fallback=Number(source?.weight||0);
  return Number.isFinite(fallback)&&fallback>0?fallback:0;
}
function ensureWorkoutShape(w){
  if(!w)return;
  if(!Number.isInteger(w.currentExerciseIndex)) w.currentExerciseIndex=0;
  w.exercises=(w.exercises||[]).map(e=>{
    const weight=resolvedWorkoutWeight(w,e);
    return {
      ...e,weight,notes:e.notes||"",timed:Boolean(e.timed),exerciseComplete:Boolean(e.exerciseComplete),
      sets:(e.sets||[]).map(set=>({
        ...set,actual:set.actual??"",timedSeconds:Number(set.timedSeconds||0),timerStartedAt:set.timerStartedAt||null,
        completed:typeof set.completed==="boolean"?set.completed:String(set.actual??"").trim()!==""
      }))
    };
  });
  w.currentExerciseIndex=Math.max(0,Math.min(w.currentExerciseIndex,Math.max(0,w.exercises.length-1)));
}
// A single exercise with a bad/legacy weight or rep value (e.g. something
// non-numeric left over from older saved data) used to poison the whole
// workout total via NaN, since NaN + anything = NaN and NaN > 0 is false —
// so the finished-workout screen would show "—" even though every other
// exercise was tracked correctly. Every value here is now explicitly
// guarded with Number.isFinite so one bad exercise can only ever
// contribute 0, never wipe out the rest of the total.
function exerciseVolume(e,w=null){
  const rawFallback=w?resolvedWorkoutWeight(w,e):Number(e?.weight||0);
  const fallbackWeight=Number.isFinite(rawFallback)?rawFallback:0;
  return (e?.sets||[]).reduce((sum,set)=>{
    const rawReps=Number(set?.actual||0);
    const reps=Number.isFinite(rawReps)?rawReps:0;
    const setDone=Boolean(set?.completed)||String(set?.actual??"").trim()!=="";
    // A set completed before a mid-exercise weight adjustment keeps its own
    // recorded weight; older data with no per-set weight falls back to the
    // exercise-level value exactly as before.
    const rawWeight=set?.weight!=null?Number(set.weight):fallbackWeight;
    const weight=Number.isFinite(rawWeight)?rawWeight:0;
    if(weight<=0)return sum;
    return sum+(setDone&&reps>0?reps*weight:0);
  },0);
}
// The exercise-level weight field reflects whatever the live adjuster was
// last set to — not necessarily the heaviest weight actually used, if the
// exercise was adjusted down (or up) partway through. PRs, the Trends
// strength chart, and the completion-card PR badge all need the true max
// across completed sets, not just wherever the exercise ended up.
function exerciseHeaviestWeight(ex){
  const fromSets=(ex?.sets||[]).reduce((m,s)=>{
    if(s?.weight==null)return m;
    const w=Number(s.weight);
    return Number.isFinite(w)&&w>m?w:m;
  },0);
  if(fromSets>0)return fromSets;
  return Number(ex?.weight||0); // older data with no per-set weight recorded
}
function workoutVolume(w){
  if(!w)return 0;
  ensureWorkoutShape(w);
  return (w.exercises||[]).reduce((sum,e)=>{
    const v=exerciseVolume(e,w);
    if(!Number.isFinite(v)){
      console.warn("[CholScore] non-finite volume for exercise, contributing 0:",e);
      return sum;
    }
    return sum+v;
  },0);
}
function allSetsComplete(e){return Boolean(e?.sets?.length)&&e.sets.every(s=>s.completed&&(e.timed?Number(s.timedSeconds||s.actual||0)>0:String(s.actual).trim()!==""));}
function startRoutine(rid){
  if(state.activeWorkout){alert("You already have a workout in progress. Finish or continue that workout first.");return;}
  const r=state.routines.find(x=>x.id===rid);if(!r)return;
  state.activeWorkout={
    id:id(),routineId:r.id,name:r.name,startedAt:new Date().toISOString(),currentExerciseIndex:0,
    exercises:r.exercises.map(e=>({
      id:id(),sourceExerciseId:e.id,name:e.name,targetReps:e.reps,weight:Number(e.weight||0),notes:e.notes||"",timed:Boolean(e.timed),random:false,exerciseComplete:false,
      sets:Array.from({length:e.sets},()=>({actual:"",timedSeconds:0,timerStartedAt:null,completed:false}))
    }))
  };
  saveState();openWorkout();
}
function openWorkout(){
  if(!state.activeWorkout)return;
  ensureWorkoutShape(state.activeWorkout);saveState();
  $("liveWorkoutTitle").textContent=state.activeWorkout.name;renderLiveExercises();
  $("workoutDialog").showModal();startWorkoutTimer();
}
function startWorkoutTimer(){
  clearInterval(workoutTimer);
  const tick=()=>{
    if(!state.activeWorkout){clearInterval(workoutTimer);return;}
    $("liveWorkoutClock").textContent=elapsedClock(state.activeWorkout.startedAt);
    showActiveWorkoutBanner();
  };
  tick();workoutTimer=setInterval(tick,1000);
}
/* v1.14.0 in-workout weight adjuster — lets a weight be changed mid-exercise
   if it turns out too heavy (or too light) once a few reps are already in,
   rather than the only option being to cancel the exercise entirely.
   Completed sets keep whatever weight they were actually done at (see the
   set.weight snapshot at completion time above); only sets not yet done
   pick up the adjusted value. This also means a genuine drop set — going
   lighter on purpose for the last set or two — falls out of the same
   control rather than needing its own separate feature. */
function adjustLiveWeight(delta){
  const w=state.activeWorkout;if(!w)return;
  const e=w.exercises[w.currentExerciseIndex||0];if(!e)return;
  e.weight=Math.max(0,Math.round((Number(e.weight||0)+delta)*10)/10);
  e.weightManuallySet=true;
  saveState();
  renderLiveExercises();
}
function promptLiveWeight(){
  const w=state.activeWorkout;if(!w)return;
  const e=w.exercises[w.currentExerciseIndex||0];if(!e)return;
  const val=prompt("Enter exact weight (kg):",fmt(Number(e.weight||0)));
  if(val===null)return;
  const num=Number(val);
  if(!Number.isFinite(num)||num<0)return;
  e.weight=Math.round(num*10)/10;
  e.weightManuallySet=true;
  saveState();
  renderLiveExercises();
}
function promptExerciseNote(){
  const w=state.activeWorkout;if(!w)return;
  const ei=w.currentExerciseIndex||0,e=w.exercises[ei];if(!e)return;
  const val=prompt("Exercise note (form cue, reminder, etc.):",e.notes||"");
  if(val===null)return; // cancelled
  const trimmed=val.trim();
  e.notes=trimmed;
  // Also save back to the routine's own exercise definition, not just this
  // session — so a note jotted mid-workout is there next time too, rather
  // than needing a separate trip into editing the routine afterward.
  const sourceEx=routineExerciseForWorkoutExercise(w,e);
  if(sourceEx)sourceEx.notes=trimmed;
  saveState();
  renderLiveExercises();
}
function renderLiveExercises(){
  const w=state.activeWorkout;if(!w)return;ensureWorkoutShape(w);
  const ei=w.currentExerciseIndex||0,e=w.exercises[ei];
  if(!e){showWorkoutCelebration();return;}
  clearTimedSetTimers();
  const done=e.sets.filter(s=>s.completed).length;
  $("workoutProgress").innerHTML=`<div><span>EXERCISE ${ei+1} OF ${w.exercises.length}</span><strong>${done}/${e.sets.length} sets complete</strong></div><div class="guided-progress-bar"><i style="width:${(done/e.sets.length)*100}%"></i></div>`;
  const descriptor=e.timed?`Timed exercise · ${e.sets.length} ${e.sets.length===1?"set":"sets"}`:`${e.targetReps} target reps per set`;
  const currentWeight=Number(e.weight||0);
  const weightAdjuster=`
    <div class="weight-adjuster">
      <span class="weight-adjuster-label">Weight</span>
      <div class="stepper">
        <button type="button" id="liveWeightDown" aria-label="Decrease weight">−</button>
        <span class="weight-value" id="liveWeightValue" role="button" tabindex="0">${fmt(currentWeight)} kg</span>
        <button type="button" id="liveWeightUp" aria-label="Increase weight">+</button>
      </div>
    </div>`;
  const setMarkup=e.timed
    ? e.sets.map((set,si)=>{
        const weightTag=set.completed&&set.weight!=null&&Number(set.weight)!==currentWeight?`<span class="set-weight-tag">${fmt(set.weight)}kg</span>`:"";
        return `
        <div class="guided-set-row timed-set-row ${set.completed?"is-complete":""}" data-timed-row="${si}">
          ${weightTag}
          <span>SET ${si+1}</span>
          <div class="timed-set-controls">
            <strong class="timed-set-display" data-timed-display="${si}">${set.completed?formatExerciseSeconds(set.timedSeconds||set.actual):"Ready"}</strong>
            <button type="button" class="timed-set-btn ${set.timerStartedAt?"is-running":""}" data-timed-set="${si}" ${set.completed?"disabled":""}>${set.timerStartedAt?"Stop":"⏱ Start"}</button>
            <b class="set-tick" aria-label="${set.completed?"Complete":"Not complete"}">${set.completed?"✓":""}</b>
          </div>
        </div>`;}).join("")
    : e.sets.map((set,si)=>{
        const weightTag=set.completed&&set.weight!=null&&Number(set.weight)!==currentWeight?`<span class="set-weight-tag">${fmt(set.weight)}kg</span>`:"";
        return `
        <label class="guided-set-row ${set.completed?"is-complete":""}">
          ${weightTag}
          <span>SET ${si+1}</span>
          <div class="guided-rep-entry">
            <input inputmode="numeric" type="number" min="0" max="999" placeholder="${e.targetReps}" value="${esc(set.actual)}" data-workout-set="${si}" aria-label="Set ${si+1} reps">
            <b class="set-tick" aria-label="${set.completed?"Complete":"Not complete"}">${set.completed?"✓":""}</b>
          </div>
        </label>`;}).join("");

  $("liveExerciseList").innerHTML=`
    <div class="guided-exercise-card">
      <div class="guided-exercise-heading">
        <span class="guided-count">${String(ei+1).padStart(2,"0")}</span>
        <div><p class="eyebrow">CURRENT EXERCISE</p><h3>${esc(e.name)}</h3><p>${descriptor}${e.random?` · <b class="random-tag">added today</b>`:""}</p></div>
      </div>
      ${e.notes?`<div class="exercise-note"><span>NOTE</span>${esc(e.notes)}</div>`:""}
      ${weightAdjuster}
      <div class="guided-set-list">${setMarkup}</div>
      <p class="enter-hint">${e.timed?"Tap Start for a 3–2–1 countdown. The stopwatch runs until you press Stop.":"Enter your reps, then press Enter / Done to tick off each set."}</p>
      <button id="completeCurrentExerciseBtn" class="complete-exercise-btn" ${allSetsComplete(e)?"":"disabled"}>Complete exercise</button>
      <button type="button" id="editExerciseNoteBtn" class="exercise-note-btn">✎ ${e.notes?"Edit":"Add"} exercise note</button>
    </div>`;

  $("editExerciseNoteBtn")?.addEventListener("click",promptExerciseNote);

  $("liveWeightDown")?.addEventListener("click",()=>adjustLiveWeight(-2.5));
  $("liveWeightUp")?.addEventListener("click",()=>adjustLiveWeight(2.5));
  $("liveWeightValue")?.addEventListener("click",promptLiveWeight);
  $("liveWeightValue")?.addEventListener("keydown",ev=>{if(ev.key==="Enter"||ev.key===" "){ev.preventDefault();promptLiveWeight();}});

  if(e.timed){
    // If the app was re-rendered while a timed set was running, resume its live display.
    const runningIndex=e.sets.findIndex(s=>s.timerStartedAt&&!s.completed);
    if(runningIndex>=0) resumeTimedSet(ei,runningIndex);
    qsa("[data-timed-set]").forEach(btn=>btn.addEventListener("click",()=>handleTimedSet(ei,Number(btn.dataset.timedSet))));
  }else{
    qsa("[data-workout-set]").forEach(inp=>{
      inp.addEventListener("input",()=>{
        const si=Number(inp.dataset.workoutSet),set=state.activeWorkout?.exercises?.[ei]?.sets?.[si];
        if(!set)return;set.actual=inp.value;set.completed=false;saveState();
        const row=inp.closest(".guided-set-row");row?.classList.remove("is-complete");const tick=row?.querySelector(".set-tick");if(tick)tick.textContent="";
        const btn=$("completeCurrentExerciseBtn");if(btn)btn.disabled=true;
      });
      const markComplete=()=>{
        if(String(inp.value).trim()==="")return;
        const si=Number(inp.dataset.workoutSet),set=state.activeWorkout?.exercises?.[ei]?.sets?.[si];if(!set)return;
        set.actual=inp.value;set.completed=true;set.weight=Number(e.weight||0);saveState();renderLiveExercises();
        const next=qsa("[data-workout-set]").find(x=>Number(x.dataset.workoutSet)>si&&!state.activeWorkout.exercises[ei].sets[Number(x.dataset.workoutSet)].completed);
        if(next) setTimeout(()=>next.focus(),0);
      };
      inp.addEventListener("keydown",ev=>{if(ev.key==="Enter"){ev.preventDefault();markComplete();}});
      inp.addEventListener("change",markComplete);
    });
  }
  $("completeCurrentExerciseBtn")?.addEventListener("click",completeCurrentExercise);
}
function handleTimedSet(ei,si){
  const w=state.activeWorkout,e=w?.exercises?.[ei],set=e?.sets?.[si];if(!set||set.completed)return;
  if(set.timerStartedAt){stopTimedSet(ei,si);return;}
  // Only one stopwatch can run at a time.
  const other=e.sets.findIndex((s,i)=>i!==si&&s.timerStartedAt&&!s.completed);
  if(other>=0)return;

  clearTimedSetTimers();
  const btn=document.querySelector(`[data-timed-set="${si}"]`);
  const display=document.querySelector(`[data-timed-display="${si}"]`);
  if(btn)btn.disabled=true;
  let count=3;
  if(display)display.textContent=count;
  timedCountdownTimer=setInterval(()=>{
    count-=1;
    if(count>0){if(display)display.textContent=count;return;}
    clearInterval(timedCountdownTimer);timedCountdownTimer=null;
    set.timerStartedAt=new Date().toISOString();set.timedSeconds=0;set.actual="";saveState();
    if(btn){btn.disabled=false;btn.textContent="Stop";btn.classList.add("is-running");}
    resumeTimedSet(ei,si);
  },1000);
}
function resumeTimedSet(ei,si){
  clearInterval(timedSetTimer);
  const set=state.activeWorkout?.exercises?.[ei]?.sets?.[si];if(!set?.timerStartedAt)return;
  const started=new Date(set.timerStartedAt).getTime();
  const display=document.querySelector(`[data-timed-display="${si}"]`);
  const btn=document.querySelector(`[data-timed-set="${si}"]`);
  if(btn){btn.textContent="Stop";btn.classList.add("is-running");}
  const tick=()=>{
    const seconds=Math.max(0,Math.floor((Date.now()-started)/1000));
    if(display)display.textContent=formatExerciseSeconds(seconds);
  };
  tick();timedSetTimer=setInterval(tick,250);
}
function stopTimedSet(ei,si){
  const set=state.activeWorkout?.exercises?.[ei]?.sets?.[si];if(!set?.timerStartedAt)return;
  const seconds=Math.max(1,Math.round((Date.now()-new Date(set.timerStartedAt).getTime())/1000));
  clearTimedSetTimers();
  const e=state.activeWorkout.exercises[ei];
  set.timedSeconds=seconds;set.actual=String(seconds);set.timerStartedAt=null;set.completed=true;set.weight=Number(e?.weight||0);saveState();
  renderLiveExercises();
}
/* v1.6.0 Personal Records — heaviest weight and longest hold per exercise
   name, plus fastest pace and longest distance per activity type (walk/run).
   Computed fresh from state.days every time rather than cached, so it can
   never drift out of sync with the actual history. Scanning state.days
   never includes the exercise/activity currently being completed (workout
   exercises only land in state.days once the whole workout is saved; a
   walk/run is checked before it's pushed), so "is this a new PR" is a
   simple direct comparison — no self-exclusion needed. */
function countGenuinePRs(){
  const strengthHistory={},timedHistory={};
  const cardioDist={},cardioPace={};
  for(const t in CARDIO_TYPES){cardioDist[t]=[];cardioPace[t]=[];}

  const dayKeys=Object.keys(state.days||{}).sort();
  for(const dayKey of dayKeys){
    const day=state.days[dayKey];
    for(const act of day.activities||[]){
      if(act.type==="workout"){
        for(const ex of act.exercises||[]){
          const name=String(ex.name||"").trim();if(!name)continue;
          if(ex.timed){
            const best=(ex.sets||[]).reduce((m,s)=>Math.max(m,Number(s.timedSeconds||s.actual||0)),0);
            if(best>0)(timedHistory[name]=timedHistory[name]||[]).push(best);
          }else{
            const weight=exerciseHeaviestWeight(ex);
            if(weight>0)(strengthHistory[name]=strengthHistory[name]||[]).push(weight);
          }
        }
      }else if(cardioDist[act.type]){
        const distanceKm=Number(act.distance||0),minutes=Number(act.minutes||0);
        if(distanceKm>0)cardioDist[act.type].push(distanceKm);
        if(distanceKm>0&&minutes>0)cardioPace[act.type].push(minutes/distanceKm);
      }
    }
  }

  function countImprovements(values,higherIsBetter){
    if(values.length<2)return 0; // need a baseline attempt before anything can improve on it
    let running=values[0],improvements=0;
    for(let i=1;i<values.length;i++){
      const better=higherIsBetter?values[i]>running:values[i]<running;
      if(better){improvements++;running=values[i];}
    }
    return improvements;
  }

  let count=0;
  for(const name in strengthHistory)count+=countImprovements(strengthHistory[name],true);
  for(const name in timedHistory)count+=countImprovements(timedHistory[name],true);
  for(const t in CARDIO_TYPES){
    count+=countImprovements(cardioDist[t],true);
    count+=countImprovements(cardioPace[t],false); // lower pace = faster = better
  }
  return count;
}
function computePersonalRecords(){
  const strength={},timed={};
  const cardio={};
  for(const t in CARDIO_TYPES)cardio[t]={bestPaceMinPerKm:null,paceDistanceKm:0,longestKm:0,dateForPace:null,dateForDistance:null};
  for(const [dayKey,day] of Object.entries(state.days||{})){
    for(const act of day.activities||[]){
      if(act.type==="workout"){
        for(const ex of act.exercises||[]){
          const name=String(ex.name||"").trim();if(!name)continue;
          if(ex.timed){
            const best=(ex.sets||[]).reduce((m,s)=>Math.max(m,Number(s.timedSeconds||s.actual||0)),0);
            if(best>0&&(!timed[name]||best>timed[name].seconds))timed[name]={seconds:best,date:dayKey};
          }else{
            const weight=exerciseHeaviestWeight(ex);
            if(weight>0&&(!strength[name]||weight>strength[name].weight))strength[name]={weight,date:dayKey};
          }
        }
      }else if(cardio[act.type]){
        const bucket=cardio[act.type];
        const distanceKm=Number(act.distance||0),minutes=Number(act.minutes||0);
        if(distanceKm>bucket.longestKm){bucket.longestKm=distanceKm;bucket.dateForDistance=dayKey;}
        if(distanceKm>0&&minutes>0){
          const pace=minutes/distanceKm; // minutes per km — unit-agnostic, always comparable regardless of the display unit setting
          if(bucket.bestPaceMinPerKm==null||pace<bucket.bestPaceMinPerKm){bucket.bestPaceMinPerKm=pace;bucket.paceDistanceKm=distanceKm;bucket.dateForPace=dayKey;}
        }
      }
    }
  }
  return {strength,timed,cardio};
}
function checkExercisePR(ex){
  const name=String(ex?.name||"").trim();if(!name)return[];
  const prior=computePersonalRecords();
  if(ex.timed){
    const best=(ex.sets||[]).reduce((m,s)=>Math.max(m,Number(s.timedSeconds||s.actual||0)),0);
    const prevBest=prior.timed[name]?.seconds||0;
    if(best>0&&best>prevBest)return[`New PR, longest ${esc(name)} hold: ${formatExerciseSeconds(best)}`];
  }else{
    const weight=exerciseHeaviestWeight(ex);
    const prevWeight=prior.strength[name]?.weight||0;
    if(weight>0&&weight>prevWeight)return[`New PR, heaviest ${esc(name)}: ${fmt(weight)} kg`];
  }
  return[];
}
function checkCardioPR(type,minutes,distanceKm){
  if(!CARDIO_TYPES[type])return[];
  const prior=computePersonalRecords().cardio[type];
  const unit=distanceUnit(),badges=[],label=CARDIO_TYPES[type].label.toLowerCase();
  const displayDist=distanceKm>0?Number(kmToDisplay(distanceKm).toFixed(1)):0;
  if(distanceKm>0&&distanceKm>(prior.longestKm||0))badges.push(`New PR, longest ${label}: ${displayDist} ${unit}`);
  if(distanceKm>0&&minutes>0){
    const paceMinPerKm=minutes/distanceKm;
    if(prior.bestPaceMinPerKm==null||paceMinPerKm<prior.bestPaceMinPerKm){
      const paceDisplay=formatPace(minutes,displayDist);
      if(paceDisplay)badges.push(`New PR, fastest ${label} pace: ${paceDisplay}/${unit}`);
    }
  }
  return badges;
}
function renderPrBadges(elId,badges){
  const el=$(elId);if(!el)return;
  el.innerHTML=badges.length?badges.map(b=>`<div class="pr-badge">🏆 ${b}</div>`).join(""):"";
}

const ecmIcons={standard:"💪",timed:"⏱️",final:"🏆"};
function animateExerciseCountUps(container){
  container.querySelectorAll("[data-count-target]").forEach(el=>{
    const target=Number(el.dataset.countTarget||0);
    const decimals=Number(el.dataset.countDecimals||0);
    const isTime=el.dataset.countTime==="1";
    const duration=650,start=performance.now();
    function frame(now){
      const t=Math.min(1,(now-start)/duration),eased=1-Math.pow(1-t,3),val=target*eased;
      el.textContent=isTime?formatExerciseSeconds(val):val.toFixed(decimals);
      if(t<1)requestAnimationFrame(frame);
      else el.textContent=isTime?formatExerciseSeconds(target):target.toFixed(decimals);
    }
    requestAnimationFrame(frame);
  });
}
function completeCurrentExercise(){
  const w=state.activeWorkout;if(!w)return;const ei=w.currentExerciseIndex||0,e=w.exercises[ei];if(!e||!allSetsComplete(e))return;
  clearTimedSetTimers();
  e.exerciseComplete=true;e.completedAt=new Date().toISOString();saveState();
  const volume=exerciseVolume(e,w);
  const timedTotal=e.timed?e.sets.reduce((sum,s)=>sum+Number(s.timedSeconds||s.actual||0),0):0;
  const bestTimed=e.timed?Math.max(...e.sets.map(s=>Number(s.timedSeconds||s.actual||0))):0;
  const isFinal=ei>=w.exercises.length-1;
  const variant=isFinal?"final":e.timed?"timed":"standard";

  const dialog=$("exerciseCompleteDialog");
  dialog.classList.remove("variant-standard","variant-timed","variant-final");
  dialog.classList.add(`variant-${variant}`);
  $("ecmIcon").textContent=ecmIcons[variant];
  renderPrBadges("ecmPrBadges",checkExercisePR(e));

  $("exerciseCompleteTitle").textContent=`${randomFrom(exerciseCheers)}, ${state.profile.name}!`;
  $("exerciseCompleteMessage").textContent=e.timed
    ? `${e.name} complete, ${formatExerciseSeconds(timedTotal)} held across ${e.sets.length} ${e.sets.length===1?"set":"sets"}. ${isFinal?"That was the final exercise, workout complete!":"Take that momentum into the next one."}`
    : `${e.name} complete. ${isFinal?"That was the final exercise, workout complete!":"Take that momentum into the next one."}`;
  $("exerciseCompleteStats").innerHTML=e.timed
    ? `<div><span>SETS</span><strong>${e.sets.length} ✓</strong></div><div><span>TOTAL TIME</span><strong><b data-count-target="${timedTotal}" data-count-time="1">0s</b></strong></div><div><span>BEST SET</span><strong><b data-count-target="${bestTimed}" data-count-time="1">0s</b></strong></div>`
    : `<div><span>SETS</span><strong>${e.sets.length} ✓</strong></div>${Number(e.weight)>0?`<div><span>WEIGHT</span><strong><b data-count-target="${e.weight}" data-count-decimals="1">0.0</b> kg</strong></div><div><span>VOLUME</span><strong><b data-count-target="${volume}" data-count-decimals="1">0.0</b> kg</strong></div>`:""}`;
  animateExerciseCountUps($("exerciseCompleteStats"));
  $("nextExerciseBtn").textContent=isFinal?"See workout result":"Next exercise";
  $("exerciseCompleteDialog").showModal();
}
$("nextExerciseBtn").addEventListener("click",()=>{
  clearTimedSetTimers();
  const w=state.activeWorkout;if(!w)return;$("exerciseCompleteDialog").close();
  if((w.currentExerciseIndex||0)<w.exercises.length-1){w.currentExerciseIndex+=1;saveState();renderLiveExercises();}
  else showWorkoutCelebration();
});
let confettiLoopTimer=null;
function spawnConfettiPiece(container){
  const colors=["#8d36ff","#f8bd36","#ea62c8","#fff0ba","#54d9ff"];
  const p=document.createElement("i");
  const isCircle=Math.random()<0.32;
  p.className="confetti-piece"+(isCircle?" circle":"");
  const size=6+Math.random()*7;
  p.style.width=(isCircle?size:size*0.68)+"px";
  p.style.height=(isCircle?size:size*1.75)+"px";
  p.style.left=(Math.random()*100)+"%";
  p.style.background=colors[Math.floor(Math.random()*colors.length)];
  p.style.setProperty("--sway",(Math.random()*70-35)+"px");
  p.style.setProperty("--rot",(360+Math.random()*540)+"deg");
  const duration=1.5+Math.random()*1.15;
  p.style.animationDuration=duration+"s";
  container.appendChild(p);
  setTimeout(()=>p.remove(),duration*1000+60);
}
function startConfettiLoop(container){
  stopConfettiLoop();
  if(!container)return;
  container.innerHTML="";
  const drop=()=>{for(let i=0;i<4;i++)spawnConfettiPiece(container);};
  drop();
  confettiLoopTimer=setInterval(drop,220);
}
function stopConfettiLoop(){
  if(confettiLoopTimer){clearInterval(confettiLoopTimer);confettiLoopTimer=null;}
  const c=$("confettiBurst");if(c)c.innerHTML="";
}
// Confetti should only run while the completion screen is actually on
// screen — stop it the instant the dialog closes, however it closes
// (Done button, cancel workout, Esc key, etc.), so it never keeps
// spawning in the background.
$("finishFeelingDialog").addEventListener("close",stopConfettiLoop);
function showWorkoutCelebration(){
  const w=state.activeWorkout;if(!w)return;clearInterval(workoutTimer);
  const mins=Math.max(1,elapsedMinutes(w.startedAt)),volume=workoutVolume(w);
  $("finishFeelingTitle").innerHTML=`<span>${esc(randomFrom(workoutCheers))},</span> <strong>${esc(state.profile.name)}!</strong>`;
  $("finishWorkoutSummary").textContent=randomFrom(workoutSubCheers);
  $("finishTotalWeight").textContent=volume>0?`${fmt(volume)} kg`:"—";
  $("finishWorkoutDuration").textContent=mins<60?`${mins} min`:elapsedClock(w.startedAt);
  finishFeeling=3;qsa("[data-finish-feel]").forEach(x=>x.classList.toggle("selected",x.dataset.finishFeel==="3"));
  startConfettiLoop($("confettiBurst"));

  // The completion screen is a fresh full-screen moment, not a continuation
  // of the scrolled live-workout sheet.
  const result=$("finishFeelingDialog");
  if($("workoutDialog").open) $("workoutDialog").close();
  result.scrollTop=0;
  if(!result.open) result.showModal();
  result.scrollTop=0;
  requestAnimationFrame(()=>{
    result.scrollTop=0;
    result.querySelector(".premium-star")?.scrollIntoView({block:"start",behavior:"instant"});
    result.scrollTop=0;
  });
}
$("continueWorkoutBtn").addEventListener("click",openWorkout);
$("minimiseWorkoutBtn").addEventListener("click",()=>{clearInterval(workoutTimer);clearTimedSetTimers();$("workoutDialog").close();renderExercise();});
$("cancelWorkoutBtn").addEventListener("click",()=>{
  const w=state.activeWorkout;if(!w)return;
  const ok=confirm(`Cancel "${w.name}"?\n\nThis unfinished workout will be discarded and won't be added to History. Your saved routine will stay unchanged.`);
  if(!ok)return;
  clearInterval(workoutTimer);clearTimedSetTimers();
  state.activeWorkout=null;
  saveState();
  if($("exerciseCompleteDialog").open) $("exerciseCompleteDialog").close();
  if($("finishFeelingDialog").open) $("finishFeelingDialog").close();
  if($("workoutDialog").open) $("workoutDialog").close();
  renderAll();
});
qsa("[data-finish-feel]").forEach(btn=>btn.addEventListener("click",()=>{
  finishFeeling=Number(btn.dataset.finishFeel);qsa("[data-finish-feel]").forEach(x=>x.classList.toggle("selected",x===btn));
}));
$("saveFinishedWorkout").addEventListener("click",()=>{
  const w=state.activeWorkout;if(!w)return;
  const endedAt=new Date().toISOString(),minutes=Math.max(1,elapsedMinutes(w.startedAt,new Date(endedAt).getTime()));
  const completedSets=w.exercises.reduce((n,e)=>n+e.sets.filter(s=>s.completed||String(s.actual).trim()!=="").length,0);
  const plannedSets=w.exercises.reduce((n,e)=>n+e.sets.length,0);
  const totalWeight=workoutVolume(w);
  ensureDay().activities.push({
    id:w.id,type:"workout",name:w.name,minutes,feel:finishFeeling,created:Date.now(),
    startedAt:w.startedAt,endedAt,exerciseCount:w.exercises.length,completedSets,plannedSets,totalWeight,
    exercises:w.exercises
  });
  state.activeWorkout=null;state.achievements.firstMove=true;saveState();
  $("finishFeelingDialog").close();$("workoutDialog").close();renderAll();
});

/* Quick activities */
qsa(".quick-activity").forEach(btn=>btn.addEventListener("click",()=>{
  $("activityType").value=btn.dataset.type;
  $("activityName").value=CARDIO_TYPES[btn.dataset.type]?.label||"";
  $("exerciseDialog").showModal();
}));
qsa("#quickFeelingRow button").forEach(btn=>btn.addEventListener("click",()=>{
  qsa("#quickFeelingRow button").forEach(x=>x.classList.remove("selected"));btn.classList.add("selected");selectedFeeling=Number(btn.dataset.feel);
}));

/* v1.3.0 walk/run completion card — gold medal + duration/distance/pace,
   distance highlighted as the "contrast" stat since it's the derived,
   most interesting number (pace) that duration alone can't tell you. */
function formatActivityDuration(mins){
  if(mins<60)return `${mins} min`;
  const h=Math.floor(mins/60),m=mins%60;
  return m?`${h}h ${m}m`:`${h}h`;
}
function formatPace(minutes,displayDistance){
  if(!displayDistance)return null;
  const paceMin=minutes/displayDistance,m=Math.floor(paceMin),s=Math.round((paceMin-m)*60);
  return `${m}:${String(s).padStart(2,"0")}`;
}
const activityFeelWord={1:"rough",2:"a bit tough",3:"steady",4:"good",5:"great"};
let lastActivityShareData=null;
function showActivityCompleteCard(type,minutes,distanceKm,feel,prBadges=[]){
  lastActivityShareData={type,minutes,distanceKm,feel,prBadges};
  const meta=CARDIO_TYPES[type]||{label:"Activity",verb:"trained",icon:"⚡"};
  const unit=distanceUnit();
  const displayDistance=distanceKm>0?Number(kmToDisplay(distanceKm).toFixed(1)):0;
  const pace=formatPace(minutes,displayDistance);
  $("acmTypeBadge").textContent=meta.icon;
  $("acmEyebrow").textContent=`${meta.label.toUpperCase()} COMPLETE`;
  $("acmTitle").textContent=`Great work, ${state.profile.name}!`;
  renderPrBadges("acmPrBadges",prBadges);
  const verb=meta.verb;
  $("acmMessage").innerHTML=displayDistance>0
    ? `You ${verb} <strong>${displayDistance} ${unit}</strong> in <strong>${formatActivityDuration(minutes)}</strong>${pace?`, averaging a <strong>${pace}/${unit}</strong> pace`:""}. Feeling ${activityFeelWord[feel]||"steady"} ${feelEmoji(feel)}`
    : `You ${verb} for <strong>${formatActivityDuration(minutes)}</strong> today. Nice work staying active. ${feelEmoji(feel)}`;
  const stats=[`<div><span>DURATION</span><strong>${formatActivityDuration(minutes)}</strong></div>`];
  if(displayDistance>0){
    stats.push(`<div class="is-distance"><span>DISTANCE</span><strong>${displayDistance} ${unit}</strong></div>`);
    if(pace)stats.push(`<div><span>PACE</span><strong>${pace}</strong><small>min/${unit}</small></div>`);
  }else{
    stats.push(`<div><span>FEELING</span><strong>${feelEmoji(feel)}</strong><small>${activityFeelWord[feel]||"steady"}</small></div>`);
  }
  $("acmStats").innerHTML=stats.join("");
  $("activityCompleteDialog").showModal();
}
$("closeActivityComplete").addEventListener("click",()=>$("activityCompleteDialog").close());
$("shareActivityBtn").addEventListener("click",async()=>{
  if(!lastActivityShareData)return;
  const{type,minutes,distanceKm,feel,prBadges}=lastActivityShareData;
  const unit=distanceUnit(),displayDistance=distanceKm>0?Number(kmToDisplay(distanceKm).toFixed(1)):0;
  const text=`Just finished a ${type} on CholScore, ${displayDistance>0?`${displayDistance}${unit}, `:""}${formatActivityDuration(minutes)}. 💪`;
  const btn=$("shareActivityBtn"),original=btn.textContent;
  btn.textContent="Preparing image…";
  try{
    const blob=await generateActivityShareImageBlob(type,minutes,distanceKm,feel,prBadges);
    const file=new File([blob],`cholscore-${type}.png`,{type:"image/png"});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      btn.textContent=original;
      await navigator.share({files:[file],title:"CholScore",text});
    }else if(navigator.share){
      btn.textContent=original;
      await navigator.share({text});
    }else{
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download=`cholscore-${type}.png`;a.click();
      URL.revokeObjectURL(url);
      btn.textContent="Image saved ✨";setTimeout(()=>{btn.textContent=original;},1600);
    }
  }catch(err){
    if(err?.name==="AbortError"){btn.textContent=original;return;}
    try{
      if(navigator.share){await navigator.share({text});}
      else if(navigator.clipboard){await navigator.clipboard.writeText(text);btn.textContent="Copied to clipboard ✨";setTimeout(()=>{btn.textContent=original;},1600);}
    }catch(err2){/* dismissed again — nothing more to do */}
    btn.textContent=original;
  }
});

$("exerciseForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("activityName").value.trim(),start=$("startTime").value,finish=$("finishTime").value,type=$("activityType").value;
  if(!name||!start||!finish)return;
  const minutes=minutesBetween(start,finish),distance=displayToKm(Number($("distance").value||0)),feel=selectedFeeling;
  const prBadges=checkCardioPR(type,minutes,distance); // must run before the push below, while state.days still only reflects prior history
  ensureDay().activities.push({id:id(),name,start,finish,type,minutes,distance,feel,created:Date.now()});
  state.achievements.firstMove=true;saveState();$("exerciseDialog").close();e.target.reset();selectedFeeling=3;
  qsa("#quickFeelingRow button").forEach(x=>x.classList.toggle("selected",x.dataset.feel==="3"));renderAll();
  setTimeout(()=>showActivityCompleteCard(type,minutes,distance,feel,prBadges),70);
});


/* Delete mistakenly logged food and recalculate the whole day immediately */
$("deleteFoodBtn").addEventListener("click",()=>{
  const day=ensureDay();

  let index=-1;

  if(currentFoodDetailId){
    index=day.foods.findIndex(f=>String(f.id||"")===String(currentFoodDetailId));
  }

  // Safety fallback for legacy records opened before they had an ID.
  if(index<0 && currentFoodDetailRef){
    index=day.foods.findIndex(f=>f===currentFoodDetailRef);
  }

  // Last-resort content match for very old localStorage entries.
  if(index<0 && currentFoodDetailRef){
    index=day.foods.findIndex(f=>
      f.name===currentFoodDetailRef.name &&
      Number(f.sat||0)===Number(currentFoodDetailRef.sat||0) &&
      f.meal===currentFoodDetailRef.meal &&
      Number(f.created||0)===Number(currentFoodDetailRef.created||0)
    );
  }

  if(index<0){
    alert("CholScore couldn't identify that old food record. Close it, reopen the food entry and try again.");
    return;
  }

  const food=day.foods[index];
  if(!confirm(`Delete "${food.name}" from today?`)) return;

  day.foods.splice(index,1);

  if(day.checkedOut){
    day.finalScore=scoreDay(day);
  }

  currentFoodDetailId=null;
  currentFoodDetailRef=null;
  saveState();
  $("foodDetailDialog").close();
  renderAll();
});

/* v1.1.0 daily checkout redesign — animated rings + share, reusing the
   same weight/star-field patterns established for the workout completion
   screen. */
const CHECKOUT_CIRC = 2 * Math.PI * 38; // 238.76

function seedStarField(elId,count=22){
  const layer=$(elId);
  if(!layer)return;
  for(let i=0;i<count;i++){
    const s=document.createElement("i");
    s.style.left=(Math.random()*100)+"%";
    s.style.top=(Math.random()*100)+"%";
    const size=1.5+Math.random()*2;
    s.style.width=size+"px";s.style.height=size+"px";
    s.style.animationDuration=(2.4+Math.random()*2.4)+"s";
    s.style.animationDelay=(Math.random()*3)+"s";
    layer.appendChild(s);
  }
}
seedStarField("checkoutStars");
seedStarField("ecmStars",16);
seedStarField("acmStars",16);

function resetCheckoutRings(){
  const rings=[$("checkoutRingSat"),$("checkoutRingMins"),$("checkoutRingScore")];
  const badges=[$("checkoutBadgeSat"),$("checkoutBadgeMins"),$("checkoutBadgeScore")];
  rings.forEach(r=>{r.style.transition="none";r.style.strokeDashoffset=CHECKOUT_CIRC;});
  badges.forEach(b=>b.classList.remove("pop"));
  void rings[0].getBoundingClientRect(); // force reflow before re-enabling the transition
  rings.forEach(r=>{r.style.transition="";});
}

/* Checkout */
$("checkoutBtn").addEventListener("click",()=>{
  const day=ensureDay(),score=scoreDay(day),{sat,mins}=totals(day),target=Number(state.profile.target);
  day.checkedOut=true;day.finalScore=score;if(sat<=target&&day.foods.length)state.achievements.onTarget=true;if(score>=80)state.achievements.score80=true;saveState();

  $("checkoutTitle").textContent=score>=90?`Outstanding, ${state.profile.name}!`:score>=75?`Brilliant day, ${state.profile.name}!`:score>=55?`Nice work, ${state.profile.name}!`:`Day complete, ${state.profile.name}.`;

  const satClause=sat<=target
    ?`You stayed within your <strong>${fmt(target)}g saturated fat limit</strong> (${fmt(sat)}g consumed)`
    :`You logged <strong>${fmt(sat)}g of saturated fat</strong> today`;
  const moveClause=mins>0?` and exercised for <strong>${fmtInt(mins)} minute${Math.round(mins)===1?"":"s"}</strong>`:"";
  $("checkoutText").innerHTML=`${satClause}${moveClause}, earning you a super score of <strong>${score}</strong>.`;

  const todayPoints=dailyBankPoints(day),bankBalance=availableBankPoints(),goal=state.rewardBank?.goal;
  const noteEl=$("checkoutRewardNote");
  if(goal){
    const remaining=Math.max(0,goal.target-bankBalance);
    noteEl.classList.remove("hidden");
    noteEl.classList.toggle("reached",remaining<=0);
    const earnedClause=todayPoints>0?`<strong>+${fmtInt(todayPoints)} point${todayPoints===1?"":"s"}</strong> banked today`:"No points banked today";
    noteEl.innerHTML=remaining<=0
      ?`🎉 <span>${earnedClause}, goal reached! <strong>${esc(goal.name)}</strong> is yours whenever you cash out.</span>`
      :`${goal.icon} <span>${earnedClause}. ${fmtInt(remaining)} point${remaining===1?"":"s"} away from <strong>${esc(goal.name)}</strong>, keep going.</span>`;
  }else{
    noteEl.classList.add("hidden");
  }
  renderRewardBankCard();

  const satPct=Math.min(1,sat/target),minsPct=Math.min(1,mins/45),scorePct=Math.min(1,score/100);
  $("checkoutRingSatNum").innerHTML=`${fmt(sat)}<small>g</small>`;
  $("checkoutRingMinsNum").innerHTML=`${fmtInt(mins)}<small>min</small>`;
  $("checkoutRingScoreNum").textContent=score;
  $("checkoutRingSat").style.stroke=sat>target?"var(--amber)":"url(#checkoutGradGreen)";

  resetCheckoutRings();
  $("checkoutDialog").showModal();

  requestAnimationFrame(()=>{
    setTimeout(()=>{$("checkoutRingSat").style.strokeDashoffset=CHECKOUT_CIRC*(1-satPct);},120);
    setTimeout(()=>{$("checkoutRingMins").style.strokeDashoffset=CHECKOUT_CIRC*(1-minsPct);},260);
    setTimeout(()=>{$("checkoutRingScore").style.strokeDashoffset=CHECKOUT_CIRC*(1-scorePct);},400);
    setTimeout(()=>{$("checkoutBadgeSat").classList.add("pop");},1180);
    setTimeout(()=>{$("checkoutBadgeMins").classList.add("pop");},1320);
    setTimeout(()=>{$("checkoutBadgeScore").classList.add("pop");},1460);
  });

  renderAll();
});
$("closeCheckout").addEventListener("click",()=>$("checkoutDialog").close());

/* v1.13.0 Reward Bank dialog */
const REWARD_ICONS=[
  {e:"📚",l:"Book"},{e:"🍫",l:"Chocolate"},{e:"🪴",l:"Plant"},{e:"👟",l:"Trainers"},
  {e:"🎮",l:"Game"},{e:"☕",l:"Coffee"},{e:"🎬",l:"Movie night"},{e:"👕",l:"Clothes"},
  {e:"✈️",l:"Trip"},{e:"🎧",l:"Headphones"},{e:"🍕",l:"Takeaway"},{e:"💆",l:"Massage"},
  {e:"🛋️",l:"Lazy day"},{e:"🎨",l:"Hobby kit"},{e:"🍷",l:"Drink"},{e:"🍦",l:"Treat"},
  {e:"🎳",l:"Day out"},{e:"🧴",l:"Skincare"},{e:"🎁",l:"Something nice"},{e:"⭐",l:"Other"},
];
let selectedRewardIcon=REWARD_ICONS[REWARD_ICONS.length-2]; // "Something nice" default

function renderRewardIconGrid(){
  $("rbIconGrid").innerHTML=REWARD_ICONS.map(i=>
    `<button type="button" class="icon-option${i.e===selectedRewardIcon.e?" selected":""}" data-emoji="${i.e}" data-label="${i.l}">
      <span class="emoji">${i.e}</span><span class="label">${esc(i.l)}</span>
    </button>`
  ).join("");
  qsa(".icon-option",$("rbIconGrid")).forEach(btn=>btn.addEventListener("click",()=>{
    selectedRewardIcon={e:btn.dataset.emoji,l:btn.dataset.label};
    $("rbCurrentIconEmoji").textContent=selectedRewardIcon.e;
    $("rbCurrentIconLabel").textContent=selectedRewardIcon.l;
    $("rbIconPicker").classList.remove("open");
    renderRewardIconGrid();
  }));
}
$("rbIconTrigger").addEventListener("click",()=>$("rbIconPicker").classList.toggle("open"));

function openRewardBankDialog(){
  if(!isPremiumUnlocked()){showPaywall();return;}
  const balance=availableBankPoints(),goal=state.rewardBank?.goal;
  $("rbBalance").textContent=fmtInt(balance);

  const todayPoints=dailyBankPoints(getDay());
  if(getDay().checkedOut){
    $("rbTodayRow").classList.remove("hidden");
    $("rbTodayLabel").textContent="Today so far";
    $("rbTodayValue").textContent=`+${fmtInt(todayPoints)} today`;
  }else{
    $("rbTodayRow").classList.add("hidden");
  }

  if(goal){
    $("rbGoalView").classList.remove("hidden");
    $("rbGoalForm").classList.add("hidden");
    const pct=Math.min(100,Math.round(balance/goal.target*100));
    const remaining=Math.max(0,goal.target-balance);
    $("rbGoalTitle").textContent=`${goal.icon} ${goal.name}`;
    $("rbGoalFraction").textContent=`${fmtInt(Math.min(balance,goal.target))} / ${fmtInt(goal.target)}`;
    $("rbGoalBarFill").style.width=`${pct}%`;
    $("rbGoalNote").textContent=remaining>0?`${fmtInt(remaining)} point${remaining===1?"":"s"} to go, keep it up.`:"Goal reached! Cash out whenever you're ready.";
    const cashoutBtn=$("rbCashoutBtn");
    cashoutBtn.disabled=remaining>0;
    cashoutBtn.textContent=remaining>0?`Cash out (need ${fmtInt(remaining)} more)`:`Cash out ${fmtInt(goal.target)} points`;
  }else{
    $("rbGoalView").classList.add("hidden");
    $("rbGoalForm").classList.remove("hidden");
    $("rbGoalForm").reset();
    selectedRewardIcon=REWARD_ICONS[REWARD_ICONS.length-2];
    $("rbCurrentIconEmoji").textContent=selectedRewardIcon.e;
    $("rbCurrentIconLabel").textContent=selectedRewardIcon.l;
  }
  $("rbIconPicker").classList.remove("open");
  renderRewardIconGrid();
  $("rewardBankDialog").showModal();
}
$("rewardBankCard").addEventListener("click",openRewardBankDialog);
$("rewardBankCard").addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();openRewardBankDialog();}});

$("rbGoalForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("rbGoalName").value.trim(),target=Number($("rbGoalTarget").value);
  if(!name)return alert("Give your goal a name.");
  if(!target||target<1)return alert("Enter how many points this goal needs.");
  setRewardGoal(selectedRewardIcon.e,name,target);
  $("rewardBankDialog").close();
  renderRewardBankCard();
});

$("rbCashoutBtn").addEventListener("click",()=>{
  const goal=state.rewardBank?.goal;
  if(!goal)return;
  if(!confirm(`Cash out ${goal.target} points for "${goal.name}"? This can't be undone.`))return;
  if(cashOutReward()){
    $("rewardBankDialog").close();
    renderRewardBankCard();
  }
});

$("rbClearGoalBtn").addEventListener("click",()=>{
  const goal=state.rewardBank?.goal;
  if(!goal)return;
  if(!confirm(`Clear "${goal.name}"? Your points stay banked, you can set a new goal any time.`))return;
  clearRewardGoal();
  openRewardBankDialog();
});

/* v1.16.0 — shareable checkout image. The app has no server, so this image
   is drawn entirely client-side on a <canvas> at share time — nothing to
   host, nothing to keep in sync with the real card design beyond copying
   its colours. Deliberately includes the CholScore name prominently, since
   that's the whole point of sharing an image instead of plain text. */
function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight){
  const words=text.split(" ");
  let line="",lines=0;
  for(let i=0;i<words.length;i++){
    const test=line+words[i]+" ";
    if(ctx.measureText(test).width>maxWidth&&line!==""){
      ctx.fillText(line.trim(),x,y+lines*lineHeight);
      line=words[i]+" ";
      lines++;
    }else{
      line=test;
    }
  }
  ctx.fillText(line.trim(),x,y+lines*lineHeight);
  return lines+1; // number of lines actually drawn, so callers can lay out what comes next
}
function drawShareRing(ctx,cx,cy,r,pct,color,value,label){
  ctx.lineWidth=14;ctx.lineCap="round";
  ctx.strokeStyle="rgba(255,255,255,.08)";
  ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.stroke();
  ctx.strokeStyle=color;
  ctx.beginPath();ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+Math.PI*2*Math.min(1,Math.max(0,pct)));ctx.stroke();
  ctx.fillStyle="#ffffff";ctx.textAlign="center";ctx.font="bold 46px sans-serif";
  ctx.fillText(value,cx,cy+16);
  ctx.fillStyle="#9299aa";ctx.font="28px sans-serif";
  ctx.fillText(label,cx,cy+r+50);

  // Checkmark badge, top-right of the ring — matching the live checkout
  // dialog's badge (same position, same colours). Was missing from the
  // shared image entirely; this replicates the exact checkmark path used
  // there (M4 12.5L9.5 18L20 6 in a 24x24 viewBox), translated to
  // coordinates relative to its own centre and scaled to the badge size,
  // rather than approximating the shape freehand.
  const bx=cx+r*0.75,by=cy-r*0.75,br=r*0.24;
  ctx.fillStyle="#55f0a7";
  ctx.beginPath();ctx.arc(bx,by,br,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle="#14121e";ctx.lineWidth=4;
  ctx.beginPath();ctx.arc(bx,by,br,0,Math.PI*2);ctx.stroke();
  const k=(br*0.72)/12; // scales the original 24x24 viewBox (half-width 12) to fit the badge
  ctx.strokeStyle="#06110c";ctx.lineWidth=Math.max(2,br*0.16);ctx.lineCap="round";ctx.lineJoin="round";
  ctx.beginPath();
  ctx.moveTo(bx+(4-12)*k,by+(12.5-12)*k);
  ctx.lineTo(bx+(9.5-12)*k,by+(18-12)*k);
  ctx.lineTo(bx+(20-12)*k,by+(6-12)*k);
  ctx.stroke();
}
async function generateShareImageBlob(){
  const day=getDay(),score=scoreDay(day),{sat,mins}=totals(day);
  const target=Number(state.profile?.target||30);
  const label=scoreLabel(score),name=state.profile?.name||"there";
  const goal=state.rewardBank?.goal,todayPoints=dailyBankPoints(day);
  const satOverTarget=sat>target;
  const satColor=satOverTarget?"#ff8a65":"#55f0a7"; // over target reads as a warning colour, not a misleadingly "complete" green ring
  const satClause=sat<=target?`stayed within their ${fmt(target)}g saturated fat limit (${fmt(sat)}g consumed)`:`logged ${fmt(sat)}g of saturated fat`;
  const moveClause=mins>0?` and exercised for ${fmtInt(mins)} minute${Math.round(mins)===1?"":"s"}`:"";
  const bodyText=`${name} ${satClause}${moveClause}, earning a super score of ${score}.`;

  const remaining=goal?Math.max(0,goal.target-availableBankPoints()):0;
  const goalText=goal?(remaining>0?`+${fmtInt(todayPoints)} points banked, ${fmtInt(remaining)} away from ${goal.name}`:`+${fmtInt(todayPoints)} points banked, ${goal.name} unlocked!`):"";

  const W=1080;
  // Dry-run layout pass on a scratch canvas, purely to measure how tall the
  // wrapped text actually is — reuses wrapCanvasText's line-count return
  // value, nothing here is ever shown. Without this, a fixed canvas height
  // either wastes a lot of space on short messages or risks clipping long
  // ones; this way the real canvas is created at exactly the right size.
  const scratch=document.createElement("canvas");scratch.width=W;scratch.height=2000;
  const sctx=scratch.getContext("2d");
  sctx.font="bold 62px sans-serif";
  const headlineLines=wrapCanvasText(sctx,`${label}, ${name}!`,70,310,940,70);
  sctx.font="34px sans-serif";
  const bodyY=310+headlineLines*70+50;
  const bodyLines=wrapCanvasText(sctx,bodyText,70,bodyY,940,48);
  let measuredY=bodyY+bodyLines*48+40;
  let goalBoxHeight=0;
  if(goal&&todayPoints>0){
    sctx.font="bold 32px sans-serif";
    const goalLines=wrapCanvasText(sctx,goalText,100,measuredY+52,880,40);
    goalBoxHeight=Math.max(110,goalLines*40+60); // grows to fit a wrapped second line instead of a fixed single-line height
    measuredY+=goalBoxHeight+40;
  }
  const ringY=measuredY+160;
  const H=ringY+320;

  const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext("2d");

  const bg=ctx.createLinearGradient(0,0,W,H);
  bg.addColorStop(0,"#121826");bg.addColorStop(1,"#090b10");
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  const glow=ctx.createRadialGradient(W*0.85,120,10,W*0.85,120,420);
  glow.addColorStop(0,"rgba(84,217,255,.16)");glow.addColorStop(1,"rgba(84,217,255,0)");
  ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);

  ctx.textAlign="left";
  ctx.fillStyle="#54d9ff";ctx.font="bold 40px sans-serif";
  ctx.fillText("CHOLSCORE",70,110);
  ctx.fillStyle="#8a93a8";ctx.font="26px sans-serif";
  ctx.fillText("Track your heart health, one day at a time",70,148);

  ctx.fillStyle="#7c8496";ctx.font="bold 26px sans-serif";
  ctx.fillText("TODAY'S CHECKOUT",70,230);
  ctx.fillStyle="#ffffff";ctx.font="bold 62px sans-serif";
  wrapCanvasText(ctx,`${label}, ${name}!`,70,310,940,70); // identical inputs to the dry run above, so this draws exactly where measuredY assumed it would

  ctx.fillStyle="#c7cedb";ctx.font="34px sans-serif";
  wrapCanvasText(ctx,bodyText,70,bodyY,940,48);

  let nextY=bodyY+bodyLines*48+40;
  if(goal&&todayPoints>0){
    ctx.fillStyle="rgba(255,209,102,.1)";
    roundRectPath(ctx,70,nextY,940,goalBoxHeight,20);ctx.fill();
    ctx.strokeStyle="rgba(255,209,102,.35)";ctx.lineWidth=2;
    roundRectPath(ctx,70,nextY,940,goalBoxHeight,20);ctx.stroke();
    ctx.fillStyle="#ffe6ac";ctx.font="bold 32px sans-serif";
    wrapCanvasText(ctx,goalText,100,nextY+52,880,40);
    nextY+=goalBoxHeight+40;
  }

  drawShareRing(ctx,220,ringY,110,satOverTarget?1:sat/Math.max(1,target),satColor,`${fmt(sat)}g`,"SAT FAT");
  drawShareRing(ctx,540,ringY,110,Math.min(1,mins/45),"#54d9ff",`${fmtInt(mins)}`,"MINUTES");
  drawShareRing(ctx,860,ringY,110,Math.min(1,score/100),"#a879ff",`${score}`,"SCORE");

  ctx.textAlign="center";ctx.fillStyle="#6b7284";ctx.font="26px sans-serif";
  ctx.fillText("CholScore, track yours free",W/2,H-60);

  return new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
}
function roundRectPath(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);
  ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}
function seededRandom(seed){let s=seed;return()=>{s=(s*9301+49297)%233280;return s/233280;};}
function loadImage(src){
  return new Promise((resolve,reject)=>{
    const img=new Image();
    img.onload=()=>resolve(img);
    img.onerror=reject;
    img.src=src;
  });
}
/* v1.17.0 — shareable workout-complete image. A distinct, more elaborate
   design than the checkout share image (deliberately, per reference design):
   reuses the same silhouette artwork, confetti palette, and gold/purple
   colours as the live celebration screen, in a circular-framed layout built
   for social sharing rather than reusing the in-app celebration verbatim. */
async function generateWorkoutShareImageBlob(){
  const w=state.activeWorkout;
  const name=state.profile?.name||"there";
  const cheer=$("finishFeelingTitle")?.querySelector("span")?.textContent?.replace(",","")||"Amazing work";
  const subMessage=$("finishWorkoutSummary")?.textContent||"You brought the effort today! 💪";
  const volume=w?workoutVolume(w):0;
  const mins=w?Math.max(1,elapsedMinutes(w.startedAt)):1;
  const durationText=mins<60?`${mins} min`:elapsedClock(w.startedAt);

  const W=1080;
  const confettiColors=["#8d36ff","#f8bd36","#ea62c8","#fff0ba","#54d9ff"];
  const silhouette=await loadImage("workout-victory-silhouette.png").catch(()=>null);

  // Dry-run measure of just the headline, since it's the one piece of
  // variable-length text (a long name could wrap to 2 lines) — everything
  // below it shifts down accordingly rather than risking overlap.
  const scratch=document.createElement("canvas");scratch.width=W;scratch.height=200;
  const sctx=scratch.getContext("2d");
  sctx.font="bold 52px sans-serif";
  const headlineLines=wrapCanvasText(sctx,`${cheer}, ${name}!`,W/2,0,900,60);

  const circleCx=W/2,circleCy=390,circleR=175; // circleCy needs enough clearance for the star badge (circleCy-circleR) to sit below the fixed header text at y=148, not just chase a tighter ratio
  const headStartY=circleCy+circleR+65;
  const subY=headStartY+42+headlineLines*52+13;
  const cardY=subY+45;
  const cardW=460,cardH=230,cardGap=30;
  const bannerY=cardY+cardH+20,bannerH=85;
  const H=bannerY+bannerH+60;

  const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext("2d");

  const bg=ctx.createLinearGradient(0,0,0,H);
  bg.addColorStop(0,"#0d0a1f");bg.addColorStop(0.5,"#0a0813");bg.addColorStop(1,"#05070d");
  ctx.fillStyle=bg;ctx.fillRect(0,0,W,H);
  const glow=ctx.createRadialGradient(W/2,420,10,W/2,420,540);
  glow.addColorStop(0,"rgba(165,35,255,.28)");glow.addColorStop(1,"rgba(165,35,255,0)");
  ctx.fillStyle=glow;ctx.fillRect(0,0,W,H);

  // Confetti scatter — same palette as the live celebration's burst, kept
  // out of the central content column so it never overlaps text or cards.
  const rnd=seededRandom(42);
  for(let i=0;i<18;i++){
    const leftSide=rnd()<0.5;
    const x=leftSide?20+rnd()*130:W-150+rnd()*130;
    const y=40+rnd()*(H-80);
    const color=confettiColors[Math.floor(rnd()*confettiColors.length)];
    const size=8+rnd()*14;
    ctx.save();ctx.translate(x,y);ctx.rotate(rnd()*Math.PI*2);ctx.fillStyle=color;
    if(rnd()<0.3){ctx.beginPath();ctx.arc(0,0,size*0.4,0,Math.PI*2);ctx.fill();}
    else{ctx.fillRect(-size*0.25,-size*0.6,size*0.5,size*1.2);}
    ctx.restore();
  }

  ctx.textAlign="left";
  ctx.fillStyle="#54d9ff";ctx.font="bold 40px sans-serif";
  ctx.fillText("CHOLSCORE",70,110);
  ctx.fillStyle="#8a93a8";ctx.font="26px sans-serif";
  ctx.fillText("Track your heart health, one day at a time",70,148);

  // Circular silhouette frame
  ctx.strokeStyle="rgba(255,196,53,.5)";ctx.lineWidth=3;
  ctx.beginPath();ctx.arc(circleCx,circleCy,circleR,0,Math.PI*2);ctx.stroke();
  ctx.save();
  ctx.beginPath();ctx.arc(circleCx,circleCy,circleR-4,0,Math.PI*2);ctx.clip();
  const innerGlow=ctx.createRadialGradient(circleCx,circleCy,10,circleCx,circleCy,circleR);
  innerGlow.addColorStop(0,"rgba(165,35,255,.35)");innerGlow.addColorStop(1,"rgba(20,10,35,.92)");
  ctx.fillStyle=innerGlow;ctx.fillRect(circleCx-circleR,circleCy-circleR,circleR*2,circleR*2);
  if(silhouette){
    const imgAspect=silhouette.width/silhouette.height;
    const boxSize=circleR*2*0.7; // source art has almost no transparent margin at its own bottom edge, so a larger scale here would make that edge visible as a hard cutoff
    const dw=imgAspect>1?boxSize:boxSize*imgAspect,dh=imgAspect>1?boxSize/imgAspect:boxSize;
    ctx.drawImage(silhouette,circleCx-dw/2,circleCy-dh/2-circleR*0.08,dw,dh); // shifted up slightly so that edge sits in the darker part of the gradient rather than dead centre
  }
  ctx.restore();

  // Star badge, overlapping the top of the circle
  const starCx=circleCx,starCy=circleCy-circleR;
  ctx.fillStyle="rgba(255,196,53,.14)";
  ctx.beginPath();ctx.arc(starCx,starCy,42,0,Math.PI*2);ctx.fill();
  ctx.strokeStyle="#f7c84a";ctx.lineWidth=3;
  ctx.beginPath();ctx.arc(starCx,starCy,42,0,Math.PI*2);ctx.stroke();
  ctx.fillStyle="#ffc834";ctx.font="bold 40px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.fillText("★",starCx,starCy+2);
  ctx.textBaseline="alphabetic";

  ctx.textAlign="center";
  ctx.fillStyle="#a794c7";ctx.font="bold 24px sans-serif";
  ctx.fillText("WORKOUT COMPLETE",W/2,headStartY);
  ctx.fillStyle="#ffffff";ctx.font="bold 52px sans-serif";
  wrapCanvasText(ctx,`${cheer}, ${name}!`,W/2,headStartY+50,900,60);
  ctx.fillStyle="#e3d6f5";ctx.font="30px sans-serif";
  wrapCanvasText(ctx,subMessage,W/2,subY,900,40);

  function drawStatCard(x,y,icon,label,value,caption){
    ctx.fillStyle="rgba(45,20,65,.75)";
    roundRectPath(ctx,x,y,cardW,cardH,20);ctx.fill();
    ctx.strokeStyle="rgba(204,119,255,.32)";ctx.lineWidth=2;
    roundRectPath(ctx,x,y,cardW,cardH,20);ctx.stroke();
    const cx=x+cardW/2,iconY=y+42;
    ctx.fillStyle="rgba(100,31,136,.6)";
    ctx.beginPath();ctx.arc(cx,iconY,27,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle="#ffd357";ctx.lineWidth=2.5;
    ctx.beginPath();ctx.arc(cx,iconY,27,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle="#ffffff";ctx.font="26px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
    ctx.fillText(icon,cx,iconY+2);
    ctx.textBaseline="alphabetic";
    ctx.fillStyle="#cc75ff";ctx.font="bold 16px sans-serif";
    ctx.fillText(label,cx,iconY+56);
    ctx.fillStyle="#ffd13f";ctx.font="bold 42px sans-serif";
    ctx.fillText(value,cx,iconY+104);
    ctx.strokeStyle="rgba(255,255,255,.12)";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x+20,y+cardH-42);ctx.lineTo(x+cardW-20,y+cardH-42);ctx.stroke();
    ctx.fillStyle="#f4f5f8";ctx.font="20px sans-serif";
    wrapCanvasText(ctx,caption,cx,y+cardH-25,cardW-40,26);
  }
  drawStatCard(W/2-cardW-cardGap/2,cardY,"🏋️","TOTAL WEIGHT LIFTED",volume>0?`${fmt(volume)} kg`:"—","That's serious strength! 💪");
  drawStatCard(W/2+cardGap/2,cardY,"◷","WORKOUT DURATION",durationText,"Great focus and dedication! ⭐");

  ctx.fillStyle="rgba(45,20,65,.55)";
  roundRectPath(ctx,70,bannerY,W-140,bannerH,18);ctx.fill();
  ctx.strokeStyle="rgba(190,76,255,.34)";ctx.lineWidth=2;
  roundRectPath(ctx,70,bannerY,W-140,bannerH,18);ctx.stroke();
  ctx.textAlign="left";
  ctx.fillStyle="#da68ff";ctx.font="60px sans-serif";
  ctx.fillText("♡",105,bannerY+bannerH/2+20);
  ctx.fillStyle="#f8f8fb";ctx.font="26px sans-serif";
  ctx.fillText("Every rep brings you closer to",190,bannerY+45);
  ctx.fillStyle="#ffd44d";ctx.font="bold 26px sans-serif";
  ctx.fillText("a stronger, healthier you. ✨",190,bannerY+80);

  return new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
}
/* v1.18.0 — shareable walk/run image. Unlike the checkout and workout share
   images (built entirely from canvas primitives), this one uses a pre-built
   template image as the full background — the card layout, icons, labels,
   circle, and silhouette are already baked into walk-share-template.jpg /
   run-share-template.jpeg (extensions genuinely differ — GitHub's upload
   flow normalized one but not the other). This function only overlays
   the dynamic text:
   headline, sub-message, and the three stat values + captions. Coordinates
   below were measured directly from the reference example (pixel analysis
   of where the text actually sits), not eyeballed. Card order follows what's
   actually printed on the template — Duration, Distance, Pace — which is a
   different order than the reference example image happened to show. */
async function generateActivityShareImageBlob(type,minutes,distanceKm,feel,prBadges){
  if(type==="walk"||type==="run")return generatePhotoTemplateShareImageBlob(type,minutes,distanceKm,prBadges);
  return generateCanvasCardShareImageBlob(type,minutes,distanceKm,feel,prBadges);
}
async function generatePhotoTemplateShareImageBlob(type,minutes,distanceKm,prBadges){
  const isWalk=type==="walk",unit=distanceUnit();
  const name=state.profile?.name||"there";
  const displayDistance=distanceKm>0?Number(kmToDisplay(distanceKm).toFixed(1)):0;
  const pace=displayDistance>0?formatPace(minutes,displayDistance):"";
  const hasPacePR=prBadges.some(b=>b.toLowerCase().includes("pace"));
  const hasDistancePR=prBadges.some(b=>b.toLowerCase().includes("longest"));

  const template=await loadImage(`${type}-share-template.${type==="run"?"jpeg":"jpg"}?v=${APP_VERSION}`).catch(()=>null);
  const W=template?.width||1008,H=template?.height||1046;
  const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext("2d");
  if(template)ctx.drawImage(template,0,0,W,H);

  ctx.textAlign="center";
  ctx.fillStyle="#ffffff";ctx.font="bold 34px sans-serif";
  ctx.fillText(`Great work, ${name}!`,W/2,530);
  ctx.font="bold 34px sans-serif";
  ctx.fillText(hasPacePR||hasDistancePR?"You hit a new PR today! 💪":`Great ${isWalk?"walk":"run"} today! 💪`,W/2,574);

  const cardX=[213,504,796]; // Duration, Distance, Pace — matches the template's actual printed label order
  ctx.fillStyle="#ffd13f";ctx.font="bold 40px sans-serif";
  ctx.fillText(formatActivityDuration(minutes),cardX[0],768);
  ctx.fillText(displayDistance>0?`${displayDistance} ${unit}`:"—",cardX[1],768);
  ctx.fillText(pace?`${pace}/${unit}`:"—",cardX[2],768);

  ctx.fillStyle="#f4f5f8";ctx.font="22px sans-serif";
  ctx.fillText("A major milestone! 🎉",cardX[0],826);
  ctx.fillText(displayDistance>0?(hasDistancePR?"A new personal best!":"That's a lot of ground!"):"Every session counts",cardX[1],826);
  ctx.fillText(pace?(hasPacePR?"A new personal best!":"Nice and steady."):"Log distance for pace",cardX[2],826);

  return new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
}
/* v1.28.0 — Swim/Cycle/Hike/Row/one-off share images. No pre-built photo
   template exists for these (unlike walk/run's genuine template images), so
   this draws the whole card on canvas instead, matching the app's own
   premium redesign — gradient background in the activity's own registry
   colour, a glowing icon badge, Space Grotesk for headlines, JetBrains Mono
   for the stat numbers. Explicitly waits on document.fonts.ready first,
   since canvas text doesn't wait for webfonts to finish loading on its own
   — skipping that would risk silently drawing in the system-font fallback
   on a first, fast share right after opening the app. */
async function generateCanvasCardShareImageBlob(type,minutes,distanceKm,feel,prBadges){
  try{await document.fonts.ready;}catch(e){/* proceed with whatever's loaded */}
  const meta=CARDIO_TYPES[type]||{label:"Activity",verb:"trained",icon:"⚡",color:"#1CCFA9"};
  const name=state.profile?.name||"there";
  const unit=distanceUnit();
  const displayDistance=distanceKm>0?Number(kmToDisplay(distanceKm).toFixed(1)):0;
  const pace=displayDistance>0?formatPace(minutes,displayDistance):"";
  const hasPacePR=prBadges.some(b=>b.toLowerCase().includes("pace"));
  const hasDistancePR=prBadges.some(b=>b.toLowerCase().includes("longest"));

  const W=1008,H=1046;
  const canvas=document.createElement("canvas");canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext("2d");

  // Base + ambient glow, matching the app's own background treatment
  ctx.fillStyle="#0A0A0F";ctx.fillRect(0,0,W,H);
  const glow1=ctx.createRadialGradient(W*0.85,H*0.08,0,W*0.85,H*0.08,W*0.55);
  glow1.addColorStop(0,meta.color+"55");glow1.addColorStop(1,meta.color+"00");
  ctx.fillStyle=glow1;ctx.fillRect(0,0,W,H);
  const glow2=ctx.createRadialGradient(W*0.1,H*0.95,0,W*0.1,H*0.95,W*0.6);
  glow2.addColorStop(0,"#6C5FFF40");glow2.addColorStop(1,"#6C5FFF00");
  ctx.fillStyle=glow2;ctx.fillRect(0,0,W,H);

  // Icon badge
  ctx.save();
  ctx.shadowColor=meta.color;ctx.shadowBlur=60;
  ctx.beginPath();ctx.arc(W/2,270,110,0,Math.PI*2);
  ctx.fillStyle=meta.color+"22";ctx.fill();
  ctx.lineWidth=3;ctx.strokeStyle=meta.color;ctx.stroke();
  ctx.restore();
  ctx.font="120px sans-serif";ctx.textAlign="center";ctx.textBaseline="middle";
  ctx.fillText(meta.icon,W/2,278);
  ctx.textBaseline="alphabetic";

  ctx.fillStyle="#8D93A6";ctx.font="700 26px 'Inter',sans-serif";
  ctx.fillText(`${meta.label.toUpperCase()} COMPLETE`,W/2,448);

  ctx.fillStyle="#F6F3EF";ctx.font="800 52px 'Space Grotesk',sans-serif";
  ctx.fillText(`Great work, ${name}!`,W/2,522);
  ctx.font="700 36px 'Space Grotesk',sans-serif";
  ctx.fillStyle=meta.color;
  ctx.fillText(hasPacePR||hasDistancePR?"You hit a new PR today! 💪":`Great ${meta.label.toLowerCase()} today! 💪`,W/2,574);

  const hasDist=displayDistance>0;
  const cards=hasDist?[
    {label:"DURATION",value:formatActivityDuration(minutes)},
    {label:"DISTANCE",value:`${displayDistance} ${unit}`},
    {label:"PACE",value:pace?`${pace}/${unit}`:"—"},
  ]:[
    {label:"DURATION",value:formatActivityDuration(minutes)},
    {label:"FEELING",value:feelEmoji(feel||3)},
  ];
  const cardY=700,cardH=220,cardW=(W-140-(cards.length-1)*24)/cards.length;
  cards.forEach((c,i)=>{
    const x=70+i*(cardW+24);
    ctx.fillStyle="rgba(255,255,255,.045)";
    roundRectPath(ctx,x,cardY,cardW,cardH,20);ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,.09)";ctx.lineWidth=1.5;
    roundRectPath(ctx,x,cardY,cardW,cardH,20);ctx.stroke();
    ctx.fillStyle="#8D93A6";ctx.font="700 20px 'Inter',sans-serif";ctx.textAlign="center";
    ctx.fillText(c.label,x+cardW/2,cardY+56);
    ctx.fillStyle="#F6F3EF";ctx.font="700 40px 'JetBrains Mono',monospace";
    ctx.fillText(c.value,x+cardW/2,cardY+118);
    let sub="Every session counts";
    if(i===1&&hasDist)sub=hasDistancePR?"New personal best! 🏆":"Nice distance.";
    if(i===2&&hasDist)sub=pace?(hasPacePR?"New personal best! 🏆":"Steady pace."):"Log distance for pace";
    if(!hasDist&&i===0)sub="Time well spent";
    if(!hasDist&&i===1)sub=(feel||3)>=4?"Feeling strong":(feel||3)<=2?"Showing up matters":"Steady effort";
    ctx.fillStyle="#8D93A6";ctx.font="500 18px 'Inter',sans-serif";
    ctx.fillText(sub,x+cardW/2,cardY+160);
  });

  ctx.fillStyle="#8D93A6";ctx.font="700 22px 'Space Grotesk',sans-serif";
  ctx.fillText("CHOLSCORE",W/2,H-50);

  return new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
}
$("shareWorkoutBtn").addEventListener("click",async()=>{
  const w=state.activeWorkout;
  const volume=w?workoutVolume(w):0,mins=w?Math.max(1,elapsedMinutes(w.startedAt)):1;
  const text=`Just finished a workout on CholScore, ${volume>0?`${fmt(volume)}kg lifted, `:""}${mins} minute${mins===1?"":"s"} of effort. 💪`;
  const btn=$("shareWorkoutBtn"),original=btn.textContent;
  btn.textContent="Preparing image…";
  try{
    const blob=await generateWorkoutShareImageBlob();
    const file=new File([blob],"cholscore-workout.png",{type:"image/png"});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      btn.textContent=original;
      await navigator.share({files:[file],title:"CholScore",text});
    }else if(navigator.share){
      btn.textContent=original;
      await navigator.share({text});
    }else{
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download="cholscore-workout.png";a.click();
      URL.revokeObjectURL(url);
      btn.textContent="Image saved ✨";setTimeout(()=>{btn.textContent=original;},1600);
    }
  }catch(err){
    if(err?.name==="AbortError"){btn.textContent=original;return;}
    try{
      if(navigator.share){await navigator.share({text});}
      else if(navigator.clipboard){await navigator.clipboard.writeText(text);btn.textContent="Copied to clipboard ✨";setTimeout(()=>{btn.textContent=original;},1600);}
    }catch(err2){/* dismissed again — nothing more to do */}
    btn.textContent=original;
  }
});
$("shareCheckout").addEventListener("click",async()=>{
  const day=getDay(),score=scoreDay(day),{sat,mins}=totals(day);
  const text=`My CholScore today: ${score}/100, ${fmt(sat)}g saturated fat, ${fmtInt(mins)} minutes of activity. 💪`;
  const btn=$("shareCheckout"),original=btn.textContent;
  btn.textContent="Preparing image…";
  try{
    const blob=await generateShareImageBlob();
    const file=new File([blob],"cholscore-checkout.png",{type:"image/png"});
    if(navigator.canShare&&navigator.canShare({files:[file]})){
      btn.textContent=original;
      await navigator.share({files:[file],title:"CholScore",text});
    }else if(navigator.share){
      btn.textContent=original;
      await navigator.share({text});
    }else{
      // No native share at all — offer the image as a direct download rather
      // than losing it entirely, same fallback pattern Backup & Restore uses.
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");a.href=url;a.download="cholscore-checkout.png";a.click();
      URL.revokeObjectURL(url);
      btn.textContent="Image saved ✨";setTimeout(()=>{btn.textContent=original;},1600);
    }
  }catch(err){
    if(err?.name==="AbortError"){btn.textContent=original;return;} // user dismissed the share sheet
    // Image generation or file-sharing failed for some reason — fall back to
    // the original text-only share rather than leaving the button stuck.
    try{
      if(navigator.share){await navigator.share({text});}
      else if(navigator.clipboard){await navigator.clipboard.writeText(text);btn.textContent="Copied to clipboard ✨";setTimeout(()=>{btn.textContent=original;},1600);}
    }catch(err2){/* dismissed again — nothing more to do */}
    btn.textContent=original;
  }
});

/* History/profile */
$("prevMonth").addEventListener("click",()=>{calendarDate.setMonth(calendarDate.getMonth()-1);renderCalendar();});
$("nextMonth").addEventListener("click",()=>{calendarDate.setMonth(calendarDate.getMonth()+1);renderCalendar();});
function renderScoreBandList(){
  const rows=SCORE_BANDS.map((band,i)=>{
    const max=i===0?100:SCORE_BANDS[i-1].min-1;
    const rangeText=i===0?`${band.min}+`:`${band.min}–${max}`;
    return `<div class="score-band-row"><span class="score-band-range">${rangeText}</span><span class="score-band-label">${esc(band.label)}</span></div>`;
  }).join("");
  $("scoreBandList").innerHTML=rows;
}
$("scoreInfoBtn").addEventListener("click",()=>{renderScoreBandList();$("scoreInfoDialog").showModal();});

$("profileBtn").addEventListener("click",()=>{$("settingsName").value=state.profile.name;$("settingsTarget").value=state.profile.target;$("settingsUnits").value=distanceUnit();renderBackupStatus();renderVacationModeUI();renderPremiumTestingUI();renderAvatarInto($("settingsAvatarPreview"),state.profile?.photo,state.profile?.name);$("settingsDialog").showModal();});
$("settingsChangePhotoBtn").addEventListener("click",()=>$("settingsPhotoFile").click());
$("settingsPhotoFile").addEventListener("change",(e)=>{
  const file=e.target.files[0];
  if(!file)return;
  processAndStorePhoto(file,(dataUrl)=>{
    state.profile.photo=dataUrl;saveState();
    renderHeaderAvatar();
    renderAvatarInto($("settingsAvatarPreview"),state.profile.photo,state.profile.name);
  });
  e.target.value="";
});
$("saveSettings").addEventListener("click",()=>{const n=$("settingsName").value.trim(),t=Number($("settingsTarget").value),u=$("settingsUnits").value==="km"?"km":"mi";if(n&&t>0){state.profile={...state.profile,name:n,target:t,distanceUnit:u};saveState();renderAll();}});
$("resetData").addEventListener("click",()=>{if(confirm("Reset all CholScore data on this device?")){localStorage.removeItem(STORAGE_KEY);localStorage.removeItem(LEGACY_KEY);state=cloneDefault();$("settingsDialog").close();location.reload();}});

/* v1.5.0 Backup & Restore — everything lives only in this device's
   localStorage, so losing the phone or clearing site data would otherwise
   mean losing it all. Export writes the whole state to a JSON file the
   person can save anywhere (Files, a cloud drive, email to themselves);
   Import reads one back and reuses normaliseState() so it's exactly as
   forgiving of odd/old data as loading the app normally is. */
const BACKUP_META_KEY="cholscore_backup_meta";
function backupStatusText(){
  try{
    const meta=JSON.parse(localStorage.getItem(BACKUP_META_KEY)||"null");
    if(!meta?.lastBackupAt)return "You haven't backed up yet, export one to keep your data safe.";
    const days=Math.floor((Date.now()-new Date(meta.lastBackupAt).getTime())/86400000);
    if(days<=0)return "Last backup: today. You're all set.";
    if(days===1)return "Last backup: yesterday.";
    if(days<14)return `Last backup: ${days} days ago.`;
    return `Last backup: ${days} days ago, probably worth doing another.`;
  }catch(err){return "You haven't backed up yet, export one to keep your data safe.";}
}
/* v1.23.0 profile photo. Resized and centre-cropped to a small square via
   canvas before being stored as a JPEG data URL — 240px is 2x the largest
   place it's displayed (72px in Settings) for retina sharpness, while
   keeping the stored string small (a few KB) rather than saving whatever
   multi-megabyte original the camera produced. */
function processAndStorePhoto(file,onDone){
  const reader=new FileReader();
  reader.onload=(e)=>{
    const img=new Image();
    img.onload=()=>{
      const size=240;
      const canvas=document.createElement("canvas");
      canvas.width=size;canvas.height=size;
      const ctx=canvas.getContext("2d");
      const side=Math.min(img.width,img.height);
      const sx=(img.width-side)/2,sy=(img.height-side)/2;
      ctx.drawImage(img,sx,sy,side,side,0,0,size,size);
      onDone(canvas.toDataURL("image/jpeg",0.85));
    };
    img.onerror=()=>{};
    img.src=e.target.result;
  };
  reader.onerror=()=>{};
  reader.readAsDataURL(file);
}
function renderAvatarInto(el,photo,name){
  if(!el)return;
  if(photo){
    el.innerHTML=`<img src="${photo}" alt="" />`;
  }else{
    const initial=(name||"?").trim().charAt(0).toUpperCase()||"?";
    el.innerHTML=`<div class="avatar-initials">${esc(initial)}</div>`;
  }
}
function renderHeaderAvatar(){
  renderAvatarInto($("profileBtn"),state.profile?.photo,state.profile?.name);
}
function renderBackupStatus(){const el=$("backupStatus");if(el)el.textContent=backupStatusText();}
function markBackedUpNow(){localStorage.setItem(BACKUP_META_KEY,JSON.stringify({lastBackupAt:new Date().toISOString()}));renderBackupStatus();}
function renderVacationModeUI(){
  const active=!!state.vacationMode?.active;
  $("vacationModeOffView").classList.toggle("hidden",active);
  $("vacationModeOnView").classList.toggle("hidden",!active);
  if(active){
    const d=new Date(state.vacationMode.since+"T12:00:00");
    $("vacationModeSinceText").textContent=d.toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
  }
}
$("vacationModeOnBtn").addEventListener("click",()=>{
  if(!isPremiumUnlocked()){showPaywall();return;}
  const daysBack=Number($("vacationBackdateSelect").value||0);
  const d=new Date();d.setDate(d.getDate()-daysBack);
  state.vacationMode={active:true,since:localDateKey(d)};
  saveState();renderVacationModeUI();renderAll();
});
$("vacationModeOffBtn").addEventListener("click",()=>{
  if(state.vacationMode?.since){
    state.vacationHistory=state.vacationHistory||[];
    state.vacationHistory.push({start:state.vacationMode.since,end:todayKey()});
  }
  state.vacationMode={active:false,since:null};
  saveState();renderVacationModeUI();renderAll();
});

/* v1.29.0 CholScore+ paywall. isPremiumUnlocked() is the one function every
   gate in the app checks — when real purchases exist (Capacitor + StoreKit),
   only this function's own internals need to change to check a real
   entitlement/receipt instead of the state flag; every call site that gates
   a feature stays exactly as it is. */
function isPremiumUnlocked(){return !!state.premium?.unlocked;}
function showPaywall(){$("paywallDialog").showModal();}
qsa(".paywall-plan").forEach(btn=>btn.addEventListener("click",()=>{
  qsa(".paywall-plan").forEach(b=>b.classList.remove("selected"));
  btn.classList.add("selected");
  $("paywallUnlockBtn").textContent=`Start with ${btn.dataset.plan==="annual"?"Annual":"Monthly"}`;
}));
$("paywallUnlockBtn").addEventListener("click",()=>{
  // Placeholder until real StoreKit purchasing exists — simulates a
  // successful purchase so the unlocked experience can be tested end to end.
  state.premium={unlocked:true};saveState();
  $("paywallDialog").close();
  renderPremiumTestingUI();renderAll();
});
$("paywallDismissBtn").addEventListener("click",()=>$("paywallDialog").close());

function renderPremiumTestingUI(){
  const unlocked=isPremiumUnlocked();
  $("premiumOffView").classList.toggle("hidden",unlocked);
  $("premiumOnView").classList.toggle("hidden",!unlocked);
}
$("premiumTestUnlockBtn").addEventListener("click",()=>{
  state.premium={unlocked:true};saveState();renderPremiumTestingUI();renderAll();
});
$("premiumTestLockBtn").addEventListener("click",()=>{
  state.premium={unlocked:false};saveState();renderPremiumTestingUI();renderAll();
});

$("exportBackupBtn").addEventListener("click",async()=>{
  const payload={app:"CholScore",exportedAt:new Date().toISOString(),version:STORAGE_KEY,data:state};
  const filename=`cholscore-backup-${localDateKey()}.json`;
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});

  // A file that only ever lands in this phone's Downloads/Files app isn't a real
  // backup — it's lost along with the phone in exactly the scenario that matters.
  // Where the OS supports it, hand the file to the native share sheet instead, so
  // the person can send it straight to iCloud Drive, Google Drive, email, Messages,
  // AirDrop, etc. — somewhere that actually survives losing this device.
  let file=null;
  try{file=new File([blob],filename,{type:"application/json"});}catch(err){/* File constructor unsupported — fall through to plain download */}

  if(file&&navigator.canShare&&navigator.canShare({files:[file]})){
    try{
      await navigator.share({files:[file],title:"CholScore backup",text:"CholScore data backup, save this somewhere off this device."});
      markBackedUpNow();
      return;
    }catch(err){
      if(err&&err.name==="AbortError")return; // person cancelled the share sheet — not a failure, don't also trigger a download
      // any other error: fall through to the plain-download fallback below
    }
  }

  const url=URL.createObjectURL(blob);
  const a=document.createElement("a");
  a.href=url;a.download=filename;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  markBackedUpNow();
  alert("Saved to this device's Downloads/Files. For a real backup, please also move or share this file somewhere off the phone, email it to yourself, or save it to a cloud drive.");
});

$("importBackupBtn").addEventListener("click",()=>$("importBackupFile").click());
$("importBackupFile").addEventListener("change",e=>{
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    let parsed;
    try{parsed=JSON.parse(reader.result);}
    catch(err){alert("That file doesn't look like a valid CholScore backup, it couldn't be read as JSON.");e.target.value="";return;}
    const incoming=(parsed&&parsed.app==="CholScore"&&parsed.data)?parsed.data:parsed;
    if(!incoming||typeof incoming!=="object"||!("days"in incoming||"profile"in incoming)){
      alert("That file doesn't look like a valid CholScore backup.");e.target.value="";return;
    }
    const when=parsed?.exportedAt?new Date(parsed.exportedAt).toLocaleString():"an unknown date";
    if(!confirm(`Restore this backup from ${when}?\n\nThis replaces everything currently on this device, routines, food and exercise history, achievements, all of it, and can't be undone.`)){
      e.target.value="";return;
    }
    state=normaliseState(incoming);
    saveState();
    markBackedUpNow();
    location.reload();
  };
  reader.onerror=()=>alert("Couldn't read that file, please try again.");
  reader.readAsText(file);
  e.target.value="";
});

init();

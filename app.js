
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
function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(err){
    // Most commonly QuotaExceededError from localStorage filling up (photos
    // are the usual culprit, since they're stored as base64). Previously
    // this threw uncaught here, which could abort whatever code called
    // saveState() partway through — losing the food/photo/workout write
    // that triggered it, with no error shown to the user. Surface it
    // instead so the person actually knows a save failed.
    console.error("saveState failed:",err);
    alert("Couldn't save — your device storage may be full. Try freeing up space or removing an old photo.");
  }
}
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
  // Bonus 5 points for any single exercise session over an hour — a genuinely
  // long session, not just several shorter ones adding up to the same total
  // minutes. This is what closes the gap to a true 100; without it the other
  // categories only ever summed to a 95 ceiling.
  const longSessionBonus=day.activities.some(a=>Number(a.minutes||0)>60)?5:0;
  return Math.max(0,Math.min(100,Math.round(foodScore+moveBase+participation+consistency+longSessionBonus)));
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
  initPurchases();
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
/* Graphical achievement badges — replaces the old plain-emoji icons with
   dimensional gem/medal-style badges matching the celebration screen's
   visual language (radial gradient background + inset bevel + gloss
   highlight + drop shadow). Rarity colors match .achievement-card.r-*
   in styles.css exactly, so badges agree with their surrounding card.
   All gradients/filters referenced here are defined once in the shared
   <svg><defs> block injected near the top of index.html — icons below
   are pure shape markup only, keeping each of the 144 achievement
   entries lightweight since nothing here is duplicated per-instance. */
const ACH_ICONS = {
  apple:()=>`<path d="M50 30c-13 0-21 10-21 24 0 13 10 26 21 26s21-13 21-26c0-14-8-24-21-24z" fill="url(#iconApple)"/><path d="M50 30c0-7 3-11 9-14" stroke="#8a5a2e" stroke-width="4.5" stroke-linecap="round" fill="none"/><path d="M50 16c5-3 10-2 13 2" stroke="#3f7a3f" stroke-width="4" stroke-linecap="round" fill="none"/><ellipse cx="39" cy="42" rx="7" ry="12" fill="#fff" opacity="0.4"/>`,
  salad:()=>`<path d="M24 46a26 20 0 0052 0z" fill="url(#iconGreen)"/><path d="M24 46h52" stroke="#2a5c2e" stroke-width="2.5"/><path d="M46 30c-2 6 0 12 4 16M56 28c2 6 1 13-3 18" stroke="#3f9143" stroke-width="4" stroke-linecap="round" fill="none"/><ellipse cx="36" cy="42" rx="6" ry="4" fill="#fff" opacity="0.35"/>`,
  cart:()=>`<path d="M28 32h6l7 28h27l6-19H39" stroke="url(#iconSteel)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="44" cy="70" r="4.5" fill="url(#iconSteel)"/><circle cx="63" cy="70" r="4.5" fill="url(#iconSteel)"/>`,
  camera:()=>`<rect x="22" y="38" width="56" height="34" rx="7" fill="url(#iconCamera)"/><path d="M38 38l5-8h14l5 8" fill="url(#iconCamera)"/><circle cx="50" cy="55" r="12" fill="#12181f" stroke="#54d9ff" stroke-width="2.5"/><circle cx="50" cy="55" r="6" fill="#54d9ff" opacity="0.7"/><ellipse cx="32" cy="46" rx="4" ry="3" fill="#fff" opacity="0.4"/>`,
  target:()=>`<circle cx="50" cy="50" r="24" fill="url(#iconTarget)"/><circle cx="50" cy="50" r="24" fill="none" stroke="#fff" stroke-width="3"/><circle cx="50" cy="50" r="14" fill="#fff"/><circle cx="50" cy="50" r="14" fill="none" stroke="#c23f2a" stroke-width="3"/><circle cx="50" cy="50" r="5" fill="#c23f2a"/>`,
  dumbbell:()=>`<rect x="20" y="42" width="15" height="24" rx="5" fill="url(#iconSteel)"/><rect x="65" y="42" width="15" height="24" rx="5" fill="url(#iconSteel)"/><rect x="14" y="47" width="8" height="14" rx="3" fill="url(#iconSteel)" opacity="0.85"/><rect x="78" y="47" width="8" height="14" rx="3" fill="url(#iconSteel)" opacity="0.85"/><rect x="33" y="50" width="34" height="8" rx="4" fill="url(#iconSteel)"/><ellipse cx="25" cy="46" rx="3" ry="6" fill="#fff" opacity="0.4"/>`,
  gear:()=>`<path d="M50 26l4 8 8-3 1 9 9 1-3 8 8 4-8 4 3 8-9 1-1 9-8-3-4 8-4-8-8 3-1-9-9-1 3-8-8-4 8-4-3-8 9-1 1-9 8 3z" fill="url(#iconGraphite)"/><circle cx="50" cy="50" r="12" fill="#12181f"/><circle cx="50" cy="50" r="12" fill="none" stroke="#9aa7b4" stroke-width="2"/>`,
  clipboard:()=>`<rect x="28" y="26" width="44" height="52" rx="6" fill="url(#iconCream)"/><rect x="40" y="20" width="20" height="10" rx="3" fill="url(#iconSteel)"/><path d="M36 44h28M36 54h28M36 64h18" stroke="#8b96a3" stroke-width="3" stroke-linecap="round"/>`,
  trophy:()=>`<path d="M30 22h40v16a20 20 0 01-40 0V22z" fill="url(#iconGold)"/><path d="M30 27h-11a8 8 0 008 14M70 27h11a8 8 0 01-8 14" stroke="#ffd97d" stroke-width="3.6" stroke-linecap="round" fill="none"/><rect x="45" y="53" width="10" height="13" fill="url(#iconGold)"/><path d="M32 76h36l-5-7H37l-5 7z" fill="url(#iconGold)"/><ellipse cx="40" cy="30" rx="5" ry="9" fill="#fff" opacity="0.5"/>`,
  medal:()=>`<path d="M40 18l10 20 10-20" stroke="#c23f2a" stroke-width="10" fill="none"/><circle cx="50" cy="58" r="22" fill="url(#iconGold)"/><circle cx="50" cy="58" r="22" fill="none" stroke="#fff" stroke-opacity="0.25" stroke-width="2"/><circle cx="50" cy="58" r="13" fill="none" stroke="#9a6710" stroke-width="2.5"/><ellipse cx="43" cy="49" rx="4" ry="7" fill="#fff" opacity="0.5"/>`,
  chart:()=>`<path d="M26 68V50M42 68V38M58 68V46M74 68V26" stroke="url(#iconBlueGreen)" stroke-width="9" stroke-linecap="round"/><path d="M26 40l16-12 16 8 16-18" stroke="#54d9ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  galaxy:()=>`<path filter="url(#achGlow)" d="M50 20l7 17 18.5 2.5-14 12.5L66 76 50 65 34 76l4.5-24L24 39.5l18.5-2.5z" fill="url(#iconGalaxy)"/><circle cx="74" cy="24" r="2" fill="#fff" opacity="0.8"/><circle cx="22" cy="55" r="1.5" fill="#fff" opacity="0.6"/><ellipse cx="42" cy="32" rx="3.5" ry="6" fill="#fff" opacity="0.5"/>`,
  footprint:()=>`<ellipse cx="46" cy="60" rx="16" ry="29" fill="url(#iconFoot)"/>
<circle cx="28" cy="30" r="9" fill="url(#iconFoot)"/>
<circle cx="42" cy="21" r="7" fill="url(#iconFoot)"/>
<circle cx="55" cy="19" r="6" fill="url(#iconFoot)"/>
<circle cx="66" cy="23" r="5" fill="url(#iconFoot)"/>
<circle cx="74" cy="31" r="4" fill="url(#iconFoot)"/>`,
  tree:()=>`<rect x="46" y="60" width="8" height="16" fill="url(#iconBrown)"/><path d="M50 18l16 26H34z" fill="url(#iconGreen)"/><path d="M50 32l15 24H35z" fill="url(#iconGreen)" opacity="0.9"/><path d="M50 46l17 22H33z" fill="url(#iconGreen)" opacity="0.95"/><ellipse cx="42" cy="30" rx="3" ry="5" fill="#fff" opacity="0.3"/>`,
  compass:()=>`<circle cx="50" cy="50" r="26" fill="url(#iconBrass)"/><circle cx="50" cy="50" r="26" fill="none" stroke="#6b4f1e" stroke-width="2"/><path d="M50 34l7 14-7 4-7-4z" fill="#c23f2a"/><path d="M50 66l7-14-7-4-7 4z" fill="#fff"/><circle cx="50" cy="50" r="3" fill="#2a2015"/>`,
  boot:()=>`<path d="M38 22h16v24l14 10c4 2 6 6 6 10v10H38V52l-6-4V22z" fill="url(#iconLeather)"/><path d="M38 62h36v10H32c0-5 2-8 6-10z" fill="#3a2410"/><path d="M42 26h10M42 32h10M42 38h10" stroke="#8a5a2e" stroke-width="2"/><ellipse cx="46" cy="30" rx="3" ry="5" fill="#fff" opacity="0.3"/>`,
  mountain:()=>`<path d="M14 72L38 32l10 14 8-10 30 36z" fill="url(#iconSlate)"/><path d="M38 32l6 8-6 8-8-6z" fill="#fff" opacity="0.9"/><path d="M56 36l5 6-5 6-6-5z" fill="#fff" opacity="0.85"/><ellipse cx="30" cy="50" rx="4" ry="7" fill="#fff" opacity="0.25"/>`,
  runner:()=>`<circle cx="58" cy="18" r="9" fill="url(#iconSwimmer)"/>
<path d="M54 26 L46 46" stroke="url(#iconSwimmer)" stroke-width="12" stroke-linecap="round" fill="none"/>
<path d="M46 46 L30 60 L22 80" stroke="url(#iconSwimmer)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
<path d="M46 46 L62 50 L58 68" stroke="url(#iconSwimmer)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  lightning:()=>`<path d="M56 18L30 54h16l-6 28 30-40H54z" fill="url(#iconYellow)"/><path d="M56 18L30 54h16l-6 28" fill="none" stroke="#fff" stroke-opacity="0.4" stroke-width="2"/>`,
  flag:()=>`<rect x="30" y="18" width="5" height="58" fill="url(#iconSteel)"/><path d="M35 22h34v10H51v10h18v10H35z" fill="#fff"/><path d="M35 22h17v10H35zM52 32h17v10H52z" fill="#20262f"/>`,
  flame:()=>`<path d="M50 14c-9 13-23 25-23 42a23 23 0 0046 0c0-10-4-18-10-24 1.5 9-3 15-8 15-5.5 0-9-4.5-9-10 0-9 6-15 4-23z" fill="url(#iconFlame)"/><path d="M50 42c-4.5 6-10 11-10 18a10 10 0 0020 0c0-4.5-2-8-5-10.5 1 4-1.5 6.5-4 6.5s-4-2-4-4.5c0-3.5 3.5-6 3-9.5z" fill="#fff9c4" opacity="0.9"/>`,
  rocket:()=>`<path d="M50 16c10 8 14 22 14 34l-14 10-14-10c0-12 4-26 14-34z" fill="url(#iconSilverRed)"/><circle cx="50" cy="42" r="7" fill="#54d9ff" opacity="0.8"/><path d="M36 50l-10 16 14-4M64 50l10 16-14-4" fill="url(#iconSilverRed)"/><path d="M44 68h12l-3 14a3 3 0 01-3 2 3 3 0 01-3-2z" fill="#ff8a5c"/>`,
  shootingstar:()=>`<path d="M64 24l4 9 10 1.5-7.5 7 2 10L64 46l-8.5 5.5 2-10-7.5-7 10-1.5z" fill="url(#iconYellowStar)"/><path d="M20 66l32-14" stroke="#a8e6ff" stroke-width="3" stroke-linecap="round" opacity="0.6"/><path d="M28 72l24-12" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity="0.4"/>`,
  calendar:()=>`<rect x="22" y="26" width="56" height="48" rx="6" fill="url(#iconCream)"/><rect x="22" y="26" width="56" height="14" rx="6" fill="#c23f2a"/><rect x="32" y="18" width="6" height="14" rx="3" fill="#8b96a3"/><rect x="62" y="18" width="6" height="14" rx="3" fill="#8b96a3"/><circle cx="36" cy="54" r="4" fill="#c23f2a"/><circle cx="50" cy="54" r="4" fill="#d8cba8"/><circle cx="64" cy="54" r="4" fill="#d8cba8"/><circle cx="36" cy="66" r="4" fill="#d8cba8"/>`,
  cloud:()=>`<path d="M30 62a14 14 0 010-28 18 18 0 0134-6 15 15 0 018 28z" fill="url(#iconSlate)"/><ellipse cx="38" cy="42" rx="5" ry="4" fill="#fff" opacity="0.4"/>`,
  globe:()=>`<circle cx="50" cy="50" r="28" fill="url(#iconBlueGreen)"/><ellipse cx="50" cy="50" rx="28" ry="12" fill="none" stroke="#0a4a52" stroke-width="2"/><ellipse cx="50" cy="50" rx="12" ry="28" fill="none" stroke="#0a4a52" stroke-width="2"/><path d="M22 50h56" stroke="#0a4a52" stroke-width="2"/>`,
  crown:()=>`<path d="M22 60l6-26 14 14 8-20 8 20 14-14 6 26z" fill="url(#iconGold)"/><rect x="22" y="60" width="56" height="10" rx="3" fill="url(#iconGold)"/><circle cx="50" cy="30" r="3" fill="#fff" opacity="0.7"/>`,
  monolith:()=>`<path d="M40 24h20l6 52H34z" fill="url(#iconGraphite)"/><path d="M40 24h20l3 26H37z" fill="#fff" opacity="0.08"/><path d="M44 40h12M42 52h16M40 64h20" stroke="#0a0d12" stroke-width="1.5" opacity="0.4"/>`,
  moon:()=>`<path d="M 50,18 A 32,32 0 1,1 50,82 A 32,32 0 1,1 50,18 Z M 58,24 A 26,26 0 1,0 58,76 A 26,26 0 1,0 58,24 Z" fill="url(#iconMoon)"/><circle cx="46" cy="38" r="3" fill="#c9d1db" opacity="0.5"/><circle cx="52" cy="55" r="4" fill="#c9d1db" opacity="0.4"/>`,
  book:()=>`<path d="M26 24h22a6 6 0 016 6v46a6 6 0 00-6-4H26z" fill="url(#iconBrown)"/><path d="M74 24H52a6 6 0 00-6 6v46a6 6 0 016-4h22z" fill="url(#iconCream)"/><path d="M32 34h10M32 42h10M58 34h10M58 42h10" stroke="#fff" stroke-opacity="0.35" stroke-width="2"/>`,
  gem:()=>`<path d="M32 32h36l12 16-30 30-30-30z" fill="url(#iconCyanGem)"/><path d="M32 32l18 16-8 30M68 32L50 48l8 30M32 32h36" stroke="#fff" stroke-opacity="0.4" stroke-width="1.5" fill="none"/><ellipse cx="42" cy="38" rx="4" ry="6" fill="#fff" opacity="0.5"/>`,
  sparkle:()=>`<path d="M50 18c2 12 6 16 18 18-12 2-16 6-18 18-2-12-6-16-18-18 12-2 16-6 18-18z" fill="url(#iconYellow)"/><circle cx="74" cy="30" r="3" fill="#fff" opacity="0.8"/><circle cx="26" cy="70" r="2.5" fill="#fff" opacity="0.6"/>`,
  brick:()=>`<rect x="20" y="56" width="26" height="16" rx="3" fill="url(#iconOrangeBrick)"/><rect x="54" y="56" width="26" height="16" rx="3" fill="url(#iconOrangeBrick)"/><rect x="36" y="38" width="26" height="16" rx="3" fill="url(#iconOrangeBrick)" opacity="0.9"/><rect x="20" y="20" width="26" height="16" rx="3" fill="url(#iconOrangeBrick)" opacity="0.8"/><rect x="54" y="20" width="26" height="16" rx="3" fill="url(#iconOrangeBrick)" opacity="0.8"/>`,
  plate:()=>`<circle cx="50" cy="50" r="28" fill="#fff"/><circle cx="50" cy="50" r="28" fill="none" stroke="#c9d1db" stroke-width="2"/><circle cx="50" cy="50" r="18" fill="none" stroke="#dfe4ea" stroke-width="2"/><rect x="20" y="24" width="4" height="26" rx="2" fill="url(#iconSteel)"/><path d="M76 24v14a4 4 0 01-8 0V24M72 38v22" stroke="url(#iconSteel)" stroke-width="4" stroke-linecap="round" fill="none"/>`,
  wave:()=>`<path d="M18 46c8-8 16-8 24 0s16 8 24 0 16-8 24 0" stroke="url(#iconWave)" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M18 62c8-8 16-8 24 0s16 8 24 0 16-8 24 0" stroke="url(#iconWave)" stroke-width="6" stroke-linecap="round" fill="none" opacity="0.6"/>`,
  swimmer:()=>`<circle cx="34" cy="30" r="7" fill="url(#iconSwimmer)"/><path d="M34 38c8 2 10 8 18 8s10-6 18-4 8 8 14 6" stroke="url(#iconSwimmer)" stroke-width="6" stroke-linecap="round" fill="none"/><path d="M20 62c8-6 16-6 24 0s16 6 24 0 16-6 24 0" stroke="url(#iconWave)" stroke-width="5" stroke-linecap="round" fill="none" opacity="0.7"/>`,
  bike:()=>`<circle cx="30" cy="60" r="14" fill="none" stroke="url(#iconGraphite)" stroke-width="4.5"/><circle cx="70" cy="60" r="14" fill="none" stroke="url(#iconGraphite)" stroke-width="4.5"/><path d="M30 60l16-30h14l10 30M46 30h14M30 60h40" stroke="url(#iconSilverRed)" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  oar:()=>`<line x1="25" y1="78" x2="72" y2="26" stroke="url(#iconBrown)" stroke-width="6" stroke-linecap="round"/><ellipse cx="72" cy="24" rx="7" ry="13" fill="url(#iconBrown)" transform="rotate(-42 72 24)"/><line x1="75" y1="78" x2="28" y2="26" stroke="url(#iconBrown)" stroke-width="6" stroke-linecap="round"/><ellipse cx="28" cy="24" rx="7" ry="13" fill="url(#iconBrown)" transform="rotate(42 28 24)"/><path d="M18 82c8-6 16-6 24 0s16 6 24 0 16-6 24 0" stroke="url(#iconWave)" stroke-width="5" stroke-linecap="round" fill="none"/>`,
  star:()=>`<path d="M50 22l8 20 22 2-17 14 6 22-19-12-19 12 6-22-17-14 22-2z" fill="url(#iconYellowStar)"/><ellipse cx="42" cy="36" rx="3.5" ry="6" fill="#fff" opacity="0.4"/>`,
};

const RARITY_BADGE = {
  COMMON:{bg:"achBgCommon",ring:"#9aa3b5"},
  RARE:{bg:"achBgRare",ring:"#54d9ff"},
  EPIC:{bg:"achBgEpic",ring:"#a879ff"},
  LEGEND:{bg:"achBgLegend",ring:"#ffd166"},
  MYTHIC:{bg:"achBgMythic",ring:"url(#achRingMythic)"},
};

const ACHIEVEMENT_ART = {
  "food_first":{icon:"apple",motif:"bite",label:"1"},
  "food_10":{icon:"salad",motif:"compass",label:"10"},
  "food_50":{icon:"clipboard",motif:"laurel",label:"50"},
  "food_scan_3":{icon:"camera",motif:"barcode",label:"3"},
  "food_scan_10":{icon:"camera",motif:"proscan",label:"10"},
  "food_ontarget_5":{icon:"target",motif:"arrow",label:"5"},
  "workout_first":{icon:"dumbbell",motif:"spark",label:"1"},
  "workout_5":{icon:"dumbbell",motif:"up",label:"5"},
  "workout_25":{icon:"gear",motif:"orbit",label:"25"},
  "workout_100":{icon:"dumbbell",motif:"iron",label:"100"},
  "sets_100":{icon:"clipboard",motif:"stack",label:"100"},
  "sets_500":{icon:"trophy",motif:"stack",label:"500"},
  "routine_first":{icon:"clipboard",motif:"check",label:"1"},
  "pr_first":{icon:"medal",motif:"crown",label:"PB"},
  "pr_3":{icon:"chart",motif:"roll",label:"3"},
  "weight_10000":{icon:"dumbbell",motif:"ton",label:"10T"},
  "weight_100000":{icon:"galaxy",motif:"ton",label:"100T"},
  "walk_first":{icon:"footprint",motif:"spark",label:"1"},
  "walk_1mi":{icon:"footprint",motif:"milepost",label:"1"},
  "walk_5mi":{icon:"tree",motif:"trail",label:"5"},
  "walk_25mi":{icon:"compass",motif:"route",label:"25"},
  "walk_100mi":{icon:"boot",motif:"laurel",label:"100"},
  "walk_250mi":{icon:"mountain",motif:"horizon",label:"250"},
  "run_first":{icon:"runner",motif:"startline",label:"GO"},
  "run_1mi":{icon:"lightning",motif:"milepost",label:"1"},
  "run_5mi":{icon:"flag",motif:"wings",label:"5"},
  "run_25mi":{icon:"flame",motif:"road",label:"25"},
  "run_100mi":{icon:"rocket",motif:"laurel",label:"100"},
  "run_250mi":{icon:"shootingstar",motif:"demon",label:"250"},
  "week_walk_5":{icon:"footprint",motif:"calendar",label:"5"},
  "week_walk_10":{icon:"footprint",motif:"double",label:"10"},
  "week_walk_20":{icon:"footprint",motif:"calendar",label:"20"},
  "week_run_5":{icon:"runner",motif:"calendar",label:"5"},
  "week_run_10":{icon:"runner",motif:"calendar",label:"10"},
  "week_run_20":{icon:"runner",motif:"calendar",label:"20"},
  "week_combo_15":{icon:"footprint",motif:"splitroute",label:"15"},
  "week_combo_30":{icon:"runner",motif:"splitroute",label:"30"},
  "streak_2":{icon:"flame",motif:"return",label:"2"},
  "streak_3":{icon:"flame",motif:"triple",label:"3"},
  "streak_7":{icon:"flame",motif:"calendar",label:"7"},
  "streak_14":{icon:"star",motif:"flow",label:"14"},
  "streak_30":{icon:"crown",motif:"calendar",label:"30"},
  "streak_60":{icon:"mountain",motif:"twinmoon",label:"60"},
  "streak_100":{icon:"monolith",motif:"flame",label:"100"},
  "streak_365":{icon:"mountain",motif:"sunorbit",label:"365"},
  "tenure_90":{icon:"calendar",motif:"quarter",label:"90"},
  "tenure_180":{icon:"moon",motif:"half",label:"180"},
  "tenure_365":{icon:"galaxy",motif:"orbit",label:"365"},
  "checkout_25":{icon:"moon",motif:"check",label:"25"},
  "checkout_100":{icon:"book",motif:"check",label:"100"},
  "score_70":{icon:"star",motif:"score",label:"70"},
  "score_80":{icon:"rocket",motif:"score",label:"80"},
  "score_90":{icon:"gem",motif:"score",label:"90"},
  "score_90x5":{icon:"trophy",motif:"highfive",label:"5"},
  "points_500":{icon:"sparkle",motif:"coins",label:"500"},
  "points_2500":{icon:"trophy",motif:"coins",label:"2.5K"},
  "points_100":{icon:"sparkle",motif:"pocket",label:"100"},
  "food_ontarget_3":{icon:"target",motif:"triple",label:"3"},
  "workout_sets_25":{icon:"clipboard",motif:"stack",label:"25"},
  "weekly_workouts_3":{icon:"dumbbell",motif:"calendar",label:"3"},
  "food_25":{icon:"plate",motif:"calendar",label:"25"},
  "food_scan_5":{icon:"camera",motif:"barcode",label:"5"},
  "consistency_checkouts_10":{icon:"calendar",motif:"check",label:"10"},
  "points_1000":{icon:"gem",motif:"coins",label:"1K"},
  "food_ontarget_10":{icon:"target",motif:"arrow",label:"10"},
  "workout_pr_10":{icon:"medal",motif:"crosshair",label:"10"},
  "walking_50":{icon:"boot",motif:"half",label:"50"},
  "running_50":{icon:"runner",motif:"half",label:"50"},
  "workout_50":{icon:"dumbbell",motif:"laurel",label:"50"},
  "workout_sets_250":{icon:"brick",motif:"stack",label:"250"},
  "food_scan_50":{icon:"camera",motif:"proscan",label:"50"},
  "food_100":{icon:"plate",motif:"laurel",label:"100"},
  "food_ontarget_30":{icon:"target",motif:"calendar",label:"30"},
  "workout_pr_25":{icon:"medal",motif:"collection",label:"25"},
  "workout_weight_50000":{icon:"dumbbell",motif:"ton",label:"50T"},
  "workout_150":{icon:"gear",motif:"laurel",label:"150"},
  "workout_sets_1000":{icon:"brick",motif:"tower",label:"1K"},
  "food_scan_100":{icon:"camera",motif:"laurel",label:"100"},
  "food_500":{icon:"plate",motif:"stack",label:"500"},
  "weekly_move_40":{icon:"runner",motif:"ultraroute",label:"40"},
  "workout_weight_250000":{icon:"dumbbell",motif:"vault",label:"250K"},
  "walking_500":{icon:"boot",motif:"horizon",label:"500"},
  "running_500":{icon:"runner",motif:"horizon",label:"500"},
  "workout_250":{icon:"dumbbell",motif:"crown",label:"250"},
  "workout_sets_2500":{icon:"brick",motif:"tower",label:"2.5K"},
  "workout_pr_75":{icon:"medal",motif:"crown",label:"75"},
  "food_ontarget_100":{icon:"target",motif:"laurel",label:"100"},
  "points_10000":{icon:"trophy",motif:"coins",label:"10K"},
  "score_90_25":{icon:"gem",motif:"laurel",label:"90"},
  "workout_weight_500000":{icon:"dumbbell",motif:"vault",label:"500K"},
  "weekly_move_50":{icon:"lightning",motif:"ultraroute",label:"50"},
  "walking_1000":{icon:"footprint",motif:"galaxyroute",label:"1K"},
  "running_1000":{icon:"runner",motif:"galaxyroute",label:"1K"},
  "swim_half":{icon:"wave",motif:"splash",label:"½"},
  "swim_1mi":{icon:"swimmer",motif:"milepost",label:"1"},
  "swim_5mi":{icon:"swimmer",motif:"fin",label:"5"},
  "swim_10mi":{icon:"swimmer",motif:"deep",label:"10"},
  "swim_20mi":{icon:"wave",motif:"current",label:"20"},
  "swim_50mi":{icon:"wave",motif:"channel",label:"50"},
  "swim_100mi":{icon:"gem",motif:"ice",label:"100"},
  "swim_200mi":{icon:"galaxy",motif:"sunwaves",label:"200"},
  "week_swim_1":{icon:"swimmer",motif:"calendar",label:"1"},
  "week_swim_3":{icon:"swimmer",motif:"triple",label:"3"},
  "week_swim_6":{icon:"wave",motif:"calendar",label:"6"},
  "cycle_5mi":{icon:"bike",motif:"spin",label:"5"},
  "cycle_15mi":{icon:"bike",motif:"roll",label:"15"},
  "cycle_50mi":{icon:"mountain",motif:"half",label:"50"},
  "cycle_100mi":{icon:"medal",motif:"wheel",label:"100"},
  "cycle_250mi":{icon:"mountain",motif:"climb",label:"250"},
  "cycle_500mi":{icon:"rocket",motif:"road",label:"500"},
  "cycle_1000mi":{icon:"lightning",motif:"wheel",label:"1K"},
  "cycle_2500mi":{icon:"galaxy",motif:"map",label:"2.5K"},
  "week_cycle_15":{icon:"bike",motif:"calendar",label:"15"},
  "week_cycle_30":{icon:"bike",motif:"calendar",label:"30"},
  "week_cycle_60":{icon:"bike",motif:"calendar",label:"60"},
  "hike_1mi":{icon:"tree",motif:"trail",label:"1"},
  "hike_5mi":{icon:"boot",motif:"trail",label:"5"},
  "hike_20mi":{icon:"compass",motif:"ridge",label:"20"},
  "hike_50mi":{icon:"mountain",motif:"summit",label:"50"},
  "hike_100mi":{icon:"mountain",motif:"flagsummit",label:"100"},
  "hike_200mi":{icon:"mountain",motif:"wander",label:"200"},
  "hike_400mi":{icon:"mountain",motif:"highland",label:"400"},
  "hike_750mi":{icon:"galaxy",motif:"longtrail",label:"750"},
  "week_hike_5":{icon:"boot",motif:"calendar",label:"5"},
  "week_hike_10":{icon:"boot",motif:"calendar",label:"10"},
  "week_hike_15":{icon:"mountain",motif:"calendar",label:"15"},
  "row_1mi":{icon:"oar",motif:"startline",label:"1"},
  "row_5mi":{icon:"wave",motif:"pull",label:"5"},
  "row_25mi":{icon:"wave",motif:"steady",label:"25"},
  "row_50mi":{icon:"flag",motif:"half",label:"50"},
  "row_100mi":{icon:"medal",motif:"oars",label:"100"},
  "row_250mi":{icon:"flame",motif:"engine",label:"250"},
  "row_500mi":{icon:"rocket",motif:"oars",label:"500"},
  "row_1000mi":{icon:"galaxy",motif:"oars",label:"1K"},
  "week_row_5":{icon:"oar",motif:"calendar",label:"5"},
  "week_row_10":{icon:"oar",motif:"calendar",label:"10"},
  "week_row_20":{icon:"oar",motif:"calendar",label:"20"},
  "workout_500":{icon:"galaxy",motif:"dumbbellorbit",label:"500"},
  "workout_sets_5000":{icon:"galaxy",motif:"tower",label:"5K"},
  "food_ontarget_250":{icon:"galaxy",motif:"targetorbit",label:"250"},
  "workout_weight_1000000":{icon:"galaxy",motif:"vault",label:"1M"},
  "points_25000":{icon:"galaxy",motif:"coins",label:"25K"},
  "consistency_52weeks":{icon:"galaxy",motif:"calendarorbit",label:"52"},
  "consistency_move_2500":{icon:"globe",motif:"worldroute",label:"2.5K"},
};

function achievementMotif(motif,ring){
  const c=ring;
  const motifs={
    bite:`<circle cx="72" cy="42" r="8" fill="#080d16"/><circle cx="77" cy="54" r="7" fill="#080d16"/>`,
    compass:`<circle cx="79" cy="31" r="13" fill="#090d14" stroke="${c}" stroke-width="2"/><path d="M79 21l4 9-4 3-4-3zM79 41l-4-9 4-3 4 3z" fill="${c}"/>`,
    laurel:`<path d="M25 75c-9-8-13-20-11-33M95 75c9-8 13-20 11-33" fill="none" stroke="${c}" stroke-width="2.4" opacity=".8"/><path d="M18 62l-7-5M20 52l-8-3M22 43l-7-1M102 62l7-5M100 52l8-3M98 43l7-1" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    barcode:`<g stroke="${c}" stroke-width="2"><path d="M30 78v12M35 75v15M41 80v10M46 73v17M52 77v13M58 74v16M64 79v11M70 73v17M76 78v12M82 75v15"/></g>`,
    proscan:`<path d="M22 30h12M22 30v12M98 30H86M98 30v12M22 82h12M22 82V70M98 82H86M98 82V70" stroke="${c}" stroke-width="3" stroke-linecap="round"/><path d="M28 91h64" stroke="${c}" stroke-width="2" stroke-dasharray="3 3"/>`,
    arrow:`<path d="M69 24l21 12-21 12v-8H52v-8h17z" fill="${c}" opacity=".9"/>`,
    spark:`<path d="M87 27l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM29 77l1.5 4.5L35 83l-4.5 1.5L29 89l-1.5-4.5L23 83l4.5-1.5z" fill="${c}"/>`,
    up:`<path d="M83 79V52M83 52l-9 9M83 52l9 9" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    orbit:`<ellipse cx="60" cy="58" rx="43" ry="19" fill="none" stroke="${c}" stroke-width="2" opacity=".65" transform="rotate(-18 60 58)"/><circle cx="99" cy="48" r="4" fill="${c}"/>`,
    iron:`<path d="M22 28h76M22 84h76" stroke="${c}" stroke-width="3" opacity=".55"/><circle cx="60" cy="56" r="38" fill="none" stroke="${c}" stroke-width="2" opacity=".35"/>`,
    stack:`<path d="M31 84h58M36 78h48M42 72h36" stroke="${c}" stroke-width="4" stroke-linecap="round" opacity=".8"/>`,
    check:`<path d="M75 76l8 8 16-19" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    crown:`<path d="M78 25l5 10 8-8 4 18H72l4-18 8 8z" fill="${c}" opacity=".9"/>`,
    roll:`<path d="M23 80c18-7 20-25 37-25s20 18 37 11" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    ton:`<path d="M22 86h76" stroke="${c}" stroke-width="5"/><path d="M33 86l5-10h44l5 10" fill="none" stroke="${c}" stroke-width="3"/>`,
    milepost:`<path d="M87 35v44M77 35h20l-3 12H77z" fill="none" stroke="${c}" stroke-width="3"/>`,
    trail:`<path d="M23 84c16-19 23-5 35-24 10-16 22-10 38-30" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="5 4"/>`,
    route:`<path d="M22 83c15-17 20-6 29-23 10-19 22-9 46-31" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 4"/><circle cx="22" cy="83" r="4" fill="${c}"/><circle cx="97" cy="29" r="4" fill="${c}"/>`,
    horizon:`<path d="M14 81h92" stroke="${c}" stroke-width="2" opacity=".6"/><path d="M20 81l15-13 12 7 18-18 17 13 12-10 12 21" fill="none" stroke="${c}" stroke-width="2" opacity=".55"/>`,
    startline:`<path d="M18 82h84" stroke="${c}" stroke-width="4"/><path d="M24 76v12M32 76v12M40 76v12M48 76v12" stroke="#fff" stroke-width="2"/>`,
    wings:`<path d="M29 50C14 42 12 30 15 21c11 7 18 15 21 25M91 50c15-8 17-20 14-29-11 7-18 15-21 25" fill="none" stroke="${c}" stroke-width="3"/>`,
    road:`<path d="M47 91l9-34h8l9 34" fill="none" stroke="${c}" stroke-width="3"/><path d="M60 84v-8M60 69v-7" stroke="#fff" stroke-width="2"/>`,
    demon:`<path d="M22 32l9 12M98 32l-9 12" stroke="${c}" stroke-width="4" stroke-linecap="round"/><path d="M23 30l10-4M97 30l-10-4" stroke="${c}" stroke-width="3"/>`,
    calendar:`<rect x="75" y="68" width="28" height="23" rx="4" fill="#090d14" stroke="${c}" stroke-width="2"/><path d="M75 76h28M81 65v7M97 65v7" stroke="${c}" stroke-width="2"/>`,
    double:`<circle cx="84" cy="33" r="10" fill="none" stroke="${c}" stroke-width="2"/><circle cx="90" cy="39" r="10" fill="none" stroke="${c}" stroke-width="2" opacity=".6"/>`,
    splitroute:`<path d="M60 88V69c0-14-18-11-18-27M60 69c0-14 18-11 18-27" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    return:`<path d="M89 45a28 28 0 10-5 31" fill="none" stroke="${c}" stroke-width="3"/><path d="M89 45l-12-2 7-10" fill="none" stroke="${c}" stroke-width="3"/>`,
    triple:`<circle cx="83" cy="27" r="4" fill="${c}"/><circle cx="91" cy="35" r="4" fill="${c}"/><circle cx="79" cy="39" r="4" fill="${c}"/>`,
    flow:`<path d="M18 78c12-16 20 10 32-6s19 9 31-7 18 2 23-8" fill="none" stroke="${c}" stroke-width="3"/>`,
    twinmoon:`<circle cx="83" cy="33" r="12" fill="none" stroke="${c}" stroke-width="2"/><path d="M88 24a10 10 0 100 18" fill="#090d14"/>`,
    sunorbit:`<circle cx="88" cy="30" r="8" fill="${c}"/><ellipse cx="60" cy="58" rx="45" ry="20" fill="none" stroke="${c}" stroke-width="2" opacity=".5" transform="rotate(-20 60 58)"/>`,
    quarter:`<path d="M82 27a14 14 0 0114 14H82z" fill="${c}"/><circle cx="82" cy="41" r="14" fill="none" stroke="${c}" stroke-width="2"/>`,
    half:`<path d="M84 26a14 14 0 010 28z" fill="${c}"/><circle cx="84" cy="40" r="14" fill="none" stroke="${c}" stroke-width="2"/>`,
    score:`<path d="M20 86h80" stroke="${c}" stroke-width="3"/><path d="M22 86l13-8 12 4 16-16 14 6 20-24" fill="none" stroke="${c}" stroke-width="3"/>`,
    highfive:`<path d="M82 28v16M76 30v15M88 31v14M71 35v14c0 10 6 17 15 17s14-7 14-15V39" fill="none" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    coins:`<ellipse cx="87" cy="74" rx="13" ry="5" fill="none" stroke="${c}" stroke-width="2"/><path d="M74 74v10c0 3 6 5 13 5s13-2 13-5V74M74 80c0 3 6 5 13 5s13-2 13-5" fill="none" stroke="${c}" stroke-width="2"/>`,
    pocket:`<path d="M74 69h28v22H74z" fill="none" stroke="${c}" stroke-width="2"/><path d="M74 72l14 9 14-9" fill="none" stroke="${c}" stroke-width="2"/>`,
    crosshair:`<circle cx="87" cy="33" r="12" fill="none" stroke="${c}" stroke-width="2"/><path d="M87 17v9M87 40v9M71 33h9M94 33h9" stroke="${c}" stroke-width="2"/>`,
    collection:`<circle cx="81" cy="31" r="6" fill="${c}"/><circle cx="93" cy="31" r="6" fill="${c}" opacity=".7"/><circle cx="87" cy="42" r="6" fill="${c}" opacity=".85"/>`,
    tower:`<path d="M75 87V44h24v43M79 44v-9h16v9M80 56h14M80 67h14M80 78h14" fill="none" stroke="${c}" stroke-width="2.5"/>`,
    ultraroute:`<path d="M14 85c14-25 24 2 38-22s24 8 53-30" fill="none" stroke="${c}" stroke-width="4" stroke-dasharray="7 4"/><path d="M93 28l12 5-8 10" fill="none" stroke="${c}" stroke-width="3"/>`,
    vault:`<rect x="73" y="66" width="29" height="25" rx="4" fill="none" stroke="${c}" stroke-width="2.5"/><circle cx="87" cy="78" r="6" fill="none" stroke="${c}" stroke-width="2"/><path d="M87 72v12M81 78h12" stroke="${c}" stroke-width="1.5"/>`,
    galaxyroute:`<path d="M17 83c20-22 34 5 47-21 11-22 23-8 40-31" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="4 4"/><circle cx="21" cy="29" r="2" fill="#fff"/><circle cx="99" cy="63" r="2" fill="#fff"/><circle cx="87" cy="20" r="1.5" fill="#fff"/>`,
    splash:`<path d="M23 79c8-8 16-8 24 0s16 8 24 0 16-8 24 0" fill="none" stroke="${c}" stroke-width="4"/><path d="M60 27l-5 10M74 30l-3 9M45 30l3 9" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    fin:`<path d="M79 28c10 9 15 19 12 31-9-6-15-13-20-22z" fill="${c}" opacity=".8"/>`,
    deep:`<path d="M19 83h82M25 75h70M31 67h58" stroke="${c}" stroke-width="2" opacity=".65"/>`,
    current:`<path d="M15 78c11-12 22-12 33 0s22 12 33 0 18-8 26-2" fill="none" stroke="${c}" stroke-width="4"/><path d="M91 69l12 7-11 8" fill="none" stroke="${c}" stroke-width="3"/>`,
    channel:`<path d="M18 82h84M25 74c10-9 18-9 28 0s18 9 28 0 12-6 19-1" fill="none" stroke="${c}" stroke-width="3"/><path d="M18 61h13M89 61h13" stroke="${c}" stroke-width="4"/>`,
    ice:`<path d="M83 24v28M70 31l26 14M70 45l26-14" stroke="${c}" stroke-width="3" stroke-linecap="round"/>`,
    sunwaves:`<circle cx="88" cy="28" r="9" fill="${c}"/><path d="M19 82c10-9 20-9 30 0s20 9 30 0 18-8 27-1" fill="none" stroke="${c}" stroke-width="3"/>`,
    spin:`<circle cx="86" cy="35" r="13" fill="none" stroke="${c}" stroke-width="3"/><path d="M86 22a13 13 0 018 23" fill="none" stroke="#fff" stroke-width="2"/>`,
    wheel:`<circle cx="87" cy="35" r="15" fill="none" stroke="${c}" stroke-width="3"/><path d="M87 20v30M72 35h30M76 24l22 22M98 24L76 46" stroke="${c}" stroke-width="1.5" opacity=".7"/>`,
    climb:`<path d="M16 84l24-30 12 14 18-26 34 42" fill="none" stroke="${c}" stroke-width="3"/><path d="M70 42l8 2-4 7" fill="none" stroke="${c}" stroke-width="2"/>`,
    map:`<path d="M72 65l10-5 10 5 10-5v27l-10 5-10-5-10 5z" fill="none" stroke="${c}" stroke-width="2"/><path d="M82 60v27M92 65v27" stroke="${c}" stroke-width="1.5"/>`,
    ridge:`<path d="M14 82l22-28 16 16 15-25 37 37" fill="none" stroke="${c}" stroke-width="3"/>`,
    summit:`<path d="M19 83l31-42 13 18 12-13 27 37" fill="none" stroke="${c}" stroke-width="3"/><path d="M50 41l6 8-6 7-7-6z" fill="${c}"/>`,
    flagsummit:`<path d="M19 83l31-42 13 18 12-13 27 37" fill="none" stroke="${c}" stroke-width="3"/><path d="M50 41V24h18l-5 6 5 6H50" fill="${c}"/>`,
    wander:`<path d="M14 84c18-20 29-5 40-21 13-19 22-3 50-29" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="3 5"/>`,
    highland:`<path d="M14 84l21-24 13 12 18-29 15 16 12-9 14 34" fill="none" stroke="${c}" stroke-width="3"/><path d="M18 84h84" stroke="${c}" stroke-width="2"/>`,
    longtrail:`<path d="M15 87c13-25 25 0 38-20 12-18 21-4 33-19 8-10 13-14 20-20" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="5 4"/><circle cx="104" cy="27" r="3" fill="${c}"/>`,
    pull:`<path d="M22 83h76" stroke="${c}" stroke-width="3"/><path d="M35 74l18-18M85 74L67 56" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
    steady:`<path d="M17 78c11-8 22-8 33 0s22 8 33 0 16-6 24-1" fill="none" stroke="${c}" stroke-width="3"/><path d="M30 87h60" stroke="${c}" stroke-width="2" opacity=".5"/>`,
    oars:`<path d="M76 23l22 42M98 23L76 65" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`,
    engine:`<circle cx="87" cy="38" r="14" fill="none" stroke="${c}" stroke-width="3"/><path d="M87 18v8M87 50v8M67 38h8M99 38h8M73 24l6 6M95 46l6 6M101 24l-6 6M79 46l-6 6" stroke="${c}" stroke-width="2"/>`,
    dumbbellorbit:`<ellipse cx="60" cy="58" rx="45" ry="19" fill="none" stroke="${c}" stroke-width="2" transform="rotate(-15 60 58)"/><path d="M31 81h58" stroke="${c}" stroke-width="5"/>`,
    targetorbit:`<ellipse cx="60" cy="58" rx="44" ry="20" fill="none" stroke="${c}" stroke-width="2" transform="rotate(20 60 58)"/><circle cx="98" cy="42" r="4" fill="${c}"/>`,
    calendarorbit:`<rect x="74" y="65" width="28" height="24" rx="4" fill="none" stroke="${c}" stroke-width="2"/><ellipse cx="60" cy="58" rx="44" ry="20" fill="none" stroke="${c}" stroke-width="2" opacity=".55" transform="rotate(-18 60 58)"/>`,
    worldroute:`<path d="M25 72c13-17 22 2 34-14 10-14 18-3 34-20" fill="none" stroke="${c}" stroke-width="3" stroke-dasharray="4 4"/><circle cx="25" cy="72" r="3" fill="${c}"/><circle cx="93" cy="38" r="3" fill="${c}"/>`,
  };
  return motifs[motif]||"";
}

function freshAchievementCore(iconKey,ring,def,art){
  const id=String(def.id||"ach").replace(/[^a-zA-Z0-9_-]/g,"");
  const metal=`url(#freshMetal-${id})`, dark=`url(#freshDark-${id})`, accent=`url(#freshAccent-${id})`;
  const stroke=`stroke="${ring}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"`;
  const fillAccent=`fill="${accent}"`;
  const symbols={
    apple:`<path d="M60 39c-15-10-31 1-30 20 1 19 14 33 30 33s29-14 30-33c1-19-15-30-30-20z" ${fillAccent}/><path d="M60 39c1-11 7-17 18-20" ${stroke} fill="none"/><path d="M64 28c7-7 15-7 22-2-4 8-11 12-22 10z" fill="${ring}" opacity=".78"/><circle cx="76" cy="56" r="7" fill="#fff" opacity=".18"/>`,
    salad:`<path d="M27 59h66c-3 22-15 33-33 33S30 81 27 59z" fill="${dark}" stroke="${ring}" stroke-width="3"/><path d="M36 58c1-15 10-25 20-16 4-16 17-17 20 0 9-8 20 2 16 16" fill="${accent}" opacity=".9"/><circle cx="48" cy="54" r="7" fill="#ff786b"/><circle cx="71" cy="49" r="6" fill="#ffd166"/>`,
    cart:`<path d="M28 38h10l8 37h36l9-25H43" fill="none" ${stroke}/><circle cx="53" cy="84" r="6" fill="${metal}"/><circle cx="79" cy="84" r="6" fill="${metal}"/><path d="M48 58h36" stroke="#fff" stroke-opacity=".22" stroke-width="3"/>`,
    camera:`<rect x="25" y="40" width="70" height="45" rx="10" fill="${dark}" stroke="${ring}" stroke-width="3"/><path d="M42 40l7-11h22l7 11" fill="${metal}"/><circle cx="60" cy="62" r="15" fill="#071018" stroke="${ring}" stroke-width="4"/><circle cx="60" cy="62" r="8" fill="${accent}"/><path d="M31 93h58" stroke="${ring}" stroke-width="4" stroke-dasharray="2 5" opacity=".85"/>`,
    target:`<circle cx="60" cy="60" r="31" fill="${dark}" stroke="${ring}" stroke-width="4"/><circle cx="60" cy="60" r="20" fill="none" stroke="${ring}" stroke-width="4" opacity=".8"/><circle cx="60" cy="60" r="8" fill="${accent}"/><path d="M88 31L66 55" ${stroke}/><path d="M89 30l-2 12-10-10z" fill="${ring}"/>`,
    dumbbell:`<g fill="${metal}" stroke="#fff" stroke-opacity=".18"><rect x="21" y="48" width="15" height="26" rx="5"/><rect x="84" y="48" width="15" height="26" rx="5"/><rect x="14" y="54" width="8" height="14" rx="3"/><rect x="98" y="54" width="8" height="14" rx="3"/><rect x="35" y="57" width="50" height="8" rx="4"/></g><path d="M39 61h42" stroke="${ring}" stroke-width="2" opacity=".9"/>`,
    gear:`<path d="M60 27l7 7 10-2 2 10 10 4-4 10 6 8-8 7 1 11-11 2-5 9-10-5-10 5-5-9-11-2 1-11-8-7 6-8-4-10 10-4 2-10 10 2z" fill="${dark}" stroke="${ring}" stroke-width="3"/><circle cx="60" cy="61" r="15" fill="${metal}"/><circle cx="60" cy="61" r="7" fill="#0a0f18"/>`,
    clipboard:`<rect x="34" y="28" width="52" height="68" rx="8" fill="${dark}" stroke="${ring}" stroke-width="3"/><rect x="47" y="21" width="26" height="13" rx="4" fill="${metal}"/><path d="M45 48h30M45 60h30M45 72h20" stroke="${ring}" stroke-width="3" stroke-linecap="round"/><path d="M44 83l6 6 12-14" fill="none" ${stroke}/>` ,
    trophy:`<path d="M39 29h42v19c0 17-9 27-21 27S39 65 39 48z" fill="${accent}" stroke="${ring}" stroke-width="3"/><path d="M39 35H25c0 15 5 22 17 24M81 35h14c0 15-5 22-17 24" fill="none" ${stroke}/><path d="M56 75h8v11h16v8H40v-8h16z" fill="${metal}"/>`,
    medal:`<path d="M45 25l15 24 15-24" fill="none" stroke="#ff6b5f" stroke-width="11"/><circle cx="60" cy="67" r="24" fill="${accent}" stroke="${ring}" stroke-width="3"/><path d="M60 51l5 10 11 2-8 8 2 11-10-5-10 5 2-11-8-8 11-2z" fill="#fff" opacity=".8"/>`,
    chart:`<path d="M28 86V61M46 86V49M64 86V57M82 86V34" stroke="${ring}" stroke-width="9" stroke-linecap="round"/><path d="M27 44l19-13 18 9 20-18" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3"/><circle cx="84" cy="22" r="5" fill="${accent}"/>`,
    galaxy:`<circle cx="60" cy="60" r="27" fill="${dark}" stroke="${ring}" stroke-width="3"/><ellipse cx="60" cy="60" rx="45" ry="17" fill="none" stroke="${ring}" stroke-width="3" transform="rotate(-18 60 60)"/><circle cx="93" cy="44" r="7" fill="${accent}"/><circle cx="42" cy="52" r="4" fill="#fff" opacity=".8"/><circle cx="67" cy="68" r="3" fill="#fff" opacity=".55"/>`,
    footprint:`<path d="M53 45c-10 9-15 21-12 32 3 10 13 17 23 13 12-5 13-18 8-29-5-12-11-21-19-16z" fill="${accent}"/><circle cx="45" cy="34" r="7" fill="${metal}"/><circle cx="57" cy="29" r="6" fill="${metal}"/><circle cx="69" cy="30" r="5" fill="${metal}"/><circle cx="79" cy="36" r="4" fill="${metal}"/>`,
    tree:`<path d="M57 66h8v25h-8z" fill="#8c5b37"/><path d="M61 25L39 56h14L35 76h52L69 56h14z" fill="${accent}" stroke="${ring}" stroke-width="2"/>`,
    compass:`<circle cx="60" cy="60" r="32" fill="${dark}" stroke="${ring}" stroke-width="4"/><path d="M60 35l10 20-10 7-10-7z" fill="#ff6b5f"/><path d="M60 85L50 65l10-7 10 7z" fill="#fff" opacity=".9"/><circle cx="60" cy="60" r="5" fill="${accent}"/>`,
    boot:`<path d="M42 28h22v34l19 10c7 4 10 9 10 17H36V61l-8-5V28z" fill="${dark}" stroke="${ring}" stroke-width="3"/><path d="M36 80h57v10H30c0-5 2-8 6-10z" fill="${metal}"/><path d="M47 38h13M47 47h13M47 56h13" stroke="${ring}" stroke-width="2"/>`,
    mountain:`<path d="M17 88l28-46 14 20 10-14 34 40z" fill="${dark}" stroke="${ring}" stroke-width="3"/><path d="M45 42l8 12-8 8-8-7zM69 48l7 9-7 8-7-7z" fill="#fff" opacity=".8"/><path d="M18 88h84" stroke="${ring}" stroke-width="3"/>`,
    runner:`<path d="M69 27a9 9 0 11-18 0 9 9 0 0118 0z" fill="${accent}"/><path d="M58 38l-10 22 17 10 14 20M49 57L31 70M64 48l18 6" fill="none" stroke="${ring}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/><path d="M28 92h63" stroke="${ring}" stroke-width="3" stroke-dasharray="7 6"/>`,
    lightning:`<path d="M68 20L35 61h20l-8 38 38-49H65z" fill="${accent}" stroke="${ring}" stroke-width="2"/>`,
    flag:`<path d="M40 24v68" ${stroke}/><path d="M43 27h39l-8 11 8 11H43z" fill="${accent}"/><path d="M43 27h19v11H43M62 38h20v11H62" fill="#fff" opacity=".65"/>`,
    flame:`<path d="M60 18c-8 14-28 27-28 48 0 18 12 31 28 31s28-13 28-31c0-13-6-23-15-31 2 13-5 20-12 20-8 0-12-7-11-14 1-9 8-15 10-23z" fill="${accent}" stroke="${ring}" stroke-width="2"/><path d="M60 54c-6 8-11 14-11 22 0 8 5 14 11 14s11-6 11-14c0-6-3-10-7-14 1 6-2 10-5 10s-5-3-4-6c0-4 3-7 5-12z" fill="#fff" opacity=".72"/>`,
    rocket:`<path d="M60 22c13 10 18 28 18 44L60 79 42 66c0-16 5-34 18-44z" fill="${metal}" stroke="${ring}" stroke-width="3"/><circle cx="60" cy="52" r="8" fill="${accent}"/><path d="M43 64L30 84l18-6M77 64l13 20-18-6M54 80h12l-6 16z" fill="#ff775f"/>`,
    shootingstar:`<path d="M76 27l6 13 14 2-10 10 3 14-13-7-13 7 3-14-10-10 14-2z" fill="${accent}"/><path d="M22 79l40-19M29 88l34-16" stroke="${ring}" stroke-width="4" stroke-linecap="round" opacity=".8"/>`,
    calendar:`<rect x="28" y="31" width="64" height="61" rx="10" fill="${dark}" stroke="${ring}" stroke-width="3"/><path d="M28 47h64" stroke="${ring}" stroke-width="5"/><path d="M42 24v14M78 24v14" ${stroke}/><path d="M43 61h10M67 61h10M43 75h10M67 75h10" stroke="${ring}" stroke-width="5" stroke-linecap="round"/>`,
    cloud:`<path d="M35 81c-14 0-20-9-20-19s8-18 19-19c5-14 16-21 28-18 10 2 17 10 19 20 15 0 24 8 24 18 0 11-8 18-22 18z" fill="${dark}" stroke="${ring}" stroke-width="3"/>`,
    globe:`<circle cx="60" cy="60" r="33" fill="${dark}" stroke="${ring}" stroke-width="3"/><ellipse cx="60" cy="60" rx="14" ry="33" fill="none" stroke="${ring}" stroke-width="2"/><ellipse cx="60" cy="60" rx="33" ry="13" fill="none" stroke="${ring}" stroke-width="2"/><path d="M27 60h66" stroke="${ring}" stroke-width="2"/>`,
    crown:`<path d="M27 75l6-34 18 17 9-27 9 27 18-17 6 34z" fill="${accent}" stroke="${ring}" stroke-width="3"/><rect x="27" y="75" width="66" height="12" rx="4" fill="${metal}"/>`,
    monolith:`<path d="M44 25h32l8 67H36z" fill="${dark}" stroke="${ring}" stroke-width="3"/><path d="M50 40h20M48 55h24M46 70h28" stroke="${ring}" stroke-width="2" opacity=".65"/>`,
    moon:`<path d="M76 25c-17 5-27 19-27 35s10 30 27 35c-25 7-48-11-48-35s23-42 48-35z" fill="${accent}" stroke="${ring}" stroke-width="2"/><circle cx="72" cy="49" r="3" fill="#0a0f18" opacity=".45"/><circle cx="64" cy="68" r="4" fill="#0a0f18" opacity=".35"/>`,
    book:`<path d="M28 30h29c7 0 11 4 11 10v52c-3-5-8-7-15-7H28z" fill="${dark}" stroke="${ring}" stroke-width="3"/><path d="M92 30H63c-7 0-11 4-11 10v52c3-5 8-7 15-7h25z" fill="${metal}" stroke="${ring}" stroke-width="3"/><path d="M36 47h14M36 58h14M70 47h14M70 58h14" stroke="${ring}" stroke-width="2"/>`,
    gem:`<path d="M35 32h50l14 19-39 43-39-43z" fill="${accent}" stroke="${ring}" stroke-width="3"/><path d="M35 32l25 19-11 43M85 32L60 51l11 43M35 32h50" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/>`,
    sparkle:`<path d="M60 20c3 16 9 22 25 25-16 3-22 9-25 25-3-16-9-22-25-25 16-3 22-9 25-25z" fill="${accent}"/><path d="M89 63c2 9 5 12 14 14-9 2-12 5-14 14-2-9-5-12-14-14 9-2 12-5 14-14z" fill="#fff" opacity=".72"/>`,
    brick:`<path d="M23 72h30v17H23zM67 72h30v17H67zM45 51h30v17H45zM23 30h30v17H23zM67 30h30v17H67z" fill="${metal}" stroke="${ring}" stroke-width="2"/>`,
    plate:`<circle cx="60" cy="60" r="34" fill="${dark}" stroke="${ring}" stroke-width="3"/><circle cx="60" cy="60" r="22" fill="none" stroke="${ring}" stroke-width="2" opacity=".55"/><path d="M23 31v28M18 31v14M28 31v14M97 31v28c0 6-8 6-8 0V31" ${stroke}/>` ,
    wave:`<path d="M18 54c12-11 23-11 35 0s23 11 35 0 16-8 21-4" fill="none" ${stroke}/><path d="M18 75c12-11 23-11 35 0s23 11 35 0 16-8 21-4" fill="none" stroke="${ring}" stroke-width="4" opacity=".55"/>`,
    swimmer:`<circle cx="42" cy="38" r="8" fill="${accent}"/><path d="M43 48c14 2 17 12 29 11 10 0 14-8 22-5" fill="none" ${stroke}/><path d="M20 76c11-8 22-8 33 0s22 8 33 0 16-5 23 0" fill="none" stroke="${ring}" stroke-width="5"/>`,
    bike:`<circle cx="36" cy="73" r="18" fill="none" ${stroke}/><circle cx="85" cy="73" r="18" fill="none" ${stroke}/><path d="M36 73l18-35h16l15 35M54 38l16 35H36M54 38h18" fill="none" stroke="${ring}" stroke-width="4"/><circle cx="63" cy="73" r="4" fill="${accent}"/>`,
    oar:`<path d="M30 90l51-59M90 90L39 31" stroke="${ring}" stroke-width="6" stroke-linecap="round"/><path d="M80 30c4-8 11-11 15-8 4 4 0 11-7 15zM40 30c-4-8-11-11-15-8-4 4 0 11 7 15z" fill="${accent}"/><path d="M18 96c12-7 24-7 36 0s24 7 36 0 13-4 18-1" fill="none" stroke="${ring}" stroke-width="3"/>`,
    star:`<path d="M60 23l9 22 24 2-18 16 6 24-21-13-21 13 6-24-18-16 24-2z" fill="${accent}" stroke="${ring}" stroke-width="2"/>`,
  };
  return symbols[iconKey]||symbols.star;
}

function renderWalkingSoleBadge(def){
  // Walking collection: the trainer outsole itself IS the achievement badge.
  // Deliberately no pictograms inside another badge — just a premium outsole,
  // integrated milestone and progressively richer rarity materials.
  const rarity=def.rarity||"COMMON";
  const safeId=String(def.id||"walk").replace(/[^a-zA-Z0-9_-]/g,"");
  const palettes={
    COMMON:{edge:"#d8dee9",tread:"#b8c1d1",hot:"#f3f6fb",glow:"#aab7cc"},
    RARE:{edge:"#59dcff",tread:"#22bce8",hot:"#b8f3ff",glow:"#31cfff"},
    EPIC:{edge:"#bd78ff",tread:"#8e4de8",hot:"#e3c3ff",glow:"#a95fff"},
    LEGEND:{edge:"#ffd35b",tread:"#d99a16",hot:"#fff0a3",glow:"#ffc52e"},
    MYTHIC:{edge:"#f27ce8",tread:"#55dfff",hot:"#fff1ff",glow:"#b56cff"}
  };
  const p=palettes[rarity]||palettes.COMMON;
  const labels={walk_first:"FIRST",walk_1mi:"1",walk_5mi:"5",walk_25mi:"25",walking_50:"50",walk_100mi:"100",walk_250mi:"250",walking_500:"500",walking_1000:"1000"};
  const label=labels[def.id]||String(def.goal||"");
  const unit=def.id==="walk_first"?"STEPS":"MI";
  const mythic=rarity==="MYTHIC";
  return `<svg class="premium-ach-svg walking-sole-svg" viewBox="0 0 120 150" aria-hidden="true">
    <defs>
      <linearGradient id="walkBody-${safeId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#313946"/><stop offset=".42" stop-color="#141a24"/><stop offset="1" stop-color="#06090f"/></linearGradient>
      <linearGradient id="walkTread-${safeId}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="${p.hot}"/><stop offset=".22" stop-color="${p.tread}"/><stop offset="1" stop-color="${p.edge}"/></linearGradient>
      ${mythic?`<linearGradient id="walkMythic-${safeId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff6ecf"/><stop offset=".48" stop-color="#a779ff"/><stop offset="1" stop-color="#43ddff"/></linearGradient>`:""}
      <filter id="walkGlow-${safeId}" x="-70%" y="-40%" width="240%" height="180%"><feGaussianBlur stdDeviation="3.4" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="walkShadow-${safeId}" x="-40%" y="-30%" width="180%" height="180%"><feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#000" flood-opacity=".75"/></filter>
    </defs>
    <g filter="url(#walkShadow-${safeId})">
      <path d="M58 5C40 5 29 16 27 35c-1 13 5 25 6 35 1 9-5 19-7 30-3 17 1 31 10 39 6 5 14 7 24 7s18-2 24-7c9-8 13-22 10-39-2-11-8-21-7-30 1-10 7-22 6-35C91 16 80 5 62 5z" fill="${mythic?`url(#walkMythic-${safeId})`:p.glow}" opacity=".24" filter="url(#walkGlow-${safeId})"/>
      <path d="M59 7C43 7 33 17 31 35c-1 13 6 25 6 36 0 10-6 19-8 30-2 14 1 26 8 33 5 5 12 7 23 7s18-2 23-7c7-7 10-19 8-33-2-11-8-20-8-30 0-11 7-23 6-36C87 17 77 7 61 7z" fill="url(#walkBody-${safeId})" stroke="${mythic?`url(#walkMythic-${safeId})`:p.edge}" stroke-width="2.6"/>
      <!-- Forefoot: realistic segmented rubber lugs -->
      <g fill="${mythic?`url(#walkMythic-${safeId})`:`url(#walkTread-${safeId})`}" stroke="#090c12" stroke-width="1.5">
        <path d="M39 18l11-5 5 10-12 6z"/><path d="M57 12h8l2 12H55z"/><path d="M70 14l11 5-4 11-12-6z"/>
        <path d="M35 33l14-5 4 10-15 6z"/><path d="M55 28h11l1 11H54z"/><path d="M70 29l15 5-3 11-15-6z"/>
        <path d="M36 48l15-5 3 10-15 6z"/><path d="M55 43h12v11H54z"/><path d="M69 44l14 5-3 11-14-6z"/>
        <path d="M40 63l13-5 3 9-13 7z"/><path d="M67 58l13 6-4 10-13-7z"/>
        <!-- Heel -->
        <path d="M35 105l14-5 5 11-15 6z"/><path d="M66 101l14 5-4 11-15-6z"/>
        <path d="M37 120l15-5 4 11-14 7z"/><path d="M64 115l17 5-3 12-16-6z"/>
        <path d="M47 132h26l-4 7H51z"/>
      </g>
      <!-- Flex channels and carbon-like waist -->
      <path d="M40 79c8-5 32-5 40 0M38 91c10-5 34-5 44 0" fill="none" stroke="#566171" stroke-width="2" opacity=".7"/>
      <path d="M48 69c6 4 18 4 24 0l5 30c-9-4-25-4-34 0z" fill="#0a0e15" stroke="${p.edge}" stroke-opacity=".45" stroke-width="1.2"/>
      <!-- Achievement moulded directly into outsole -->
      <text x="60" y="84" text-anchor="middle" font-size="${label.length>3?12:18}" font-weight="950" fill="#f7f9fc" stroke="#05070b" stroke-width="1.4" paint-order="stroke">${label}</text>
      <text x="60" y="96" text-anchor="middle" font-size="8" font-weight="900" letter-spacing="1.4" fill="${p.edge}">${unit}</text>
      <path d="M47 102h26" stroke="${p.edge}" stroke-width="1.4" opacity=".65"/>
      <!-- subtle moulding highlights -->
      <path d="M36 37c1-15 9-24 22-26M84 38c-1-14-8-23-20-27" fill="none" stroke="#fff" stroke-width="1.2" opacity=".18"/>
    </g>
  </svg>`;
}

const SWIMMING_ACHIEVEMENT_ASSETS = Object.freeze({
  swim_half:"assets/achievements/swimming/swim_half.webp",
  swim_1mi:"assets/achievements/swimming/swim_1mi.webp",
  swim_5mi:"assets/achievements/swimming/swim_5mi.webp",
  swim_10mi:"assets/achievements/swimming/swim_10mi.webp",
  swim_20mi:"assets/achievements/swimming/swim_20mi.webp",
  swim_50mi:"assets/achievements/swimming/swim_50mi.webp",
  swim_100mi:"assets/achievements/swimming/swim_100mi.webp",
  swim_200mi:"assets/achievements/swimming/swim_200mi.webp"
});
function renderSwimmingBadge(def){
  const src=SWIMMING_ACHIEVEMENT_ASSETS[def.id];
  if(src){
    const alt=String(def.title||"Swimming achievement").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\"/g,"&quot;");
    return `<img class="premium-ach-img swimming-achievement-asset" src="${src}" alt="${alt}" loading="lazy" decoding="async">`;
  }
  return renderSwimmingVectorBadge(def);
}

function renderSwimmingVectorBadge(def){
  const rarity=def.rarity||"COMMON";
  const safeId=String(def.id||"swim").replace(/[^a-zA-Z0-9_-]/g,"");
  const accent=rarity==="MYTHIC"?"#65e9ff":rarity==="LEGEND"?"#f3c95f":rarity==="EPIC"?"#b879ff":rarity==="RARE"?"#4fd8ff":"#aeb8ca";
  const labels={swim_half:"½ MI",swim_1mi:"1 MI",swim_5mi:"5 MI",swim_10mi:"10 MI",swim_20mi:"20 MI",swim_50mi:"50 MI",swim_100mi:"100 MI",swim_200mi:"200 MI",week_swim_1:"1 MI",week_swim_3:"3 MI",week_swim_6:"6 MI"};
  const label=labels[def.id]||`${def.goal||""} MI`;
  const mythic=rarity==="MYTHIC";
  const legend=rarity==="LEGEND";
  /* Purpose-built freestyle silhouette: long horizontal torso, obvious head,
     one lead arm reaching forward and one recovery arm arcing above the water. */
  return `<svg class="premium-ach-svg swimming-badge-svg" viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <linearGradient id="water-${safeId}" x1="0" y1="0" x2="1" y2="0"><stop stop-color="${mythic?'#ff63d8':accent}"/><stop offset=".52" stop-color="${accent}"/><stop offset="1" stop-color="${mythic?'#57f2ff':'#2c8fc4'}"/></linearGradient>
      <linearGradient id="body-${safeId}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f7fbff"/><stop offset=".18" stop-color="#cbd5e4"/><stop offset=".55" stop-color="#77849a"/><stop offset="1" stop-color="#303949"/></linearGradient>
      <filter id="sg-${safeId}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${mythic?'3.2':'1.25'}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    ${legend?`<circle cx="60" cy="57" r="46" fill="none" stroke="${accent}" stroke-width="1.5" opacity=".28"/>`:''}
    <g filter="url(#sg-${safeId})">
      <!-- head + neck -->
      <circle cx="78" cy="47" r="7.2" fill="url(#body-${safeId})"/>
      <path d="M72 52 Q69 55 66 58" fill="none" stroke="url(#body-${safeId})" stroke-width="7" stroke-linecap="round"/>
      <!-- torso, unmistakably horizontal in the water -->
      <path d="M67 58 C57 57 48 59 39 64 C33 67 28 69 22 68" fill="none" stroke="url(#body-${safeId})" stroke-width="12" stroke-linecap="round"/>
      <!-- forward arm: shoulder to hand, reaching right -->
      <path d="M66 59 C77 61 87 65 101 68" fill="none" stroke="url(#body-${safeId})" stroke-width="7.5" stroke-linecap="round"/>
      <ellipse cx="104" cy="69" rx="5" ry="2.5" fill="#cbd5e4" transform="rotate(12 104 69)"/>
      <!-- recovery arm: elbow clearly above head, then hand entering ahead -->
      <path d="M55 59 C59 49 63 38 69 29 C72 25 77 27 76 32 C74 39 72 45 75 51" fill="none" stroke="url(#body-${safeId})" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
      <!-- trailing arm/hand at waterline -->
      <path d="M40 64 C34 58 28 55 21 54" fill="none" stroke="url(#body-${safeId})" stroke-width="6" stroke-linecap="round"/>
      <!-- small wake behind body -->
      <path d="M18 70 C25 66 31 66 37 70" fill="none" stroke="${accent}" stroke-width="2.5" stroke-linecap="round" opacity=".75"/>
    </g>
    <!-- water is deliberately below the body, never through the swimmer -->
    <path d="M10 77 C19 71 28 71 37 77 S55 83 64 77 82 71 91 77 104 81 111 77" fill="none" stroke="url(#water-${safeId})" stroke-width="5" stroke-linecap="round"/>
    <path d="M16 85 C24 81 32 81 40 85 S56 89 64 85 80 81 88 85 101 88 108 84" fill="none" stroke="url(#water-${safeId})" stroke-width="2.8" stroke-linecap="round" opacity=".62"/>
    <rect x="37" y="94" width="46" height="18" rx="9" fill="#080c13" stroke="${accent}" stroke-width="2"/>
    <text x="60" y="107.5" text-anchor="middle" font-size="10.5" font-weight="950" fill="#f6f9ff">${label}</text>
    ${mythic?'<circle cx="18" cy="25" r="2" fill="#ff72dc"/><circle cx="102" cy="34" r="2" fill="#61eaff"/><path d="M96 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" opacity=".92"/>':''}
  </svg>`;
}

function renderAchBadge(def){
  if(def.cat==="walking") return renderWalkingSoleBadge(def);
  if(def.cat==="swimming" || def.metric==="weekSwimMiles") return renderSwimmingBadge(def);
  const rarity=def.rarity||"COMMON";
  const rs=RARITY_BADGE[rarity]||RARITY_BADGE.COMMON;
  const art=ACHIEVEMENT_ART[def.id]||{icon:def.icon,motif:"spark",label:String(def.goal||"")};
  const safeId=String(def.id||"ach").replace(/[^a-zA-Z0-9_-]/g,"");
  const motif=achievementMotif(art.motif,rs.ring);
  const label=String(art.label||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const core=freshAchievementCore(art.icon||def.icon,rs.ring,def,art);
  const sparkle=(rarity==="LEGEND"||rarity==="MYTHIC")
    ?'<path d="M101 17l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#fff" opacity=".9"/><circle cx="18" cy="79" r="2" fill="#fff" opacity=".65"/>'
    :"";
  return `<svg class="premium-ach-svg fresh-achievement-svg" viewBox="0 0 120 120" aria-hidden="true">
    <defs>
      <linearGradient id="freshMetal-${safeId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fbff"/><stop offset=".28" stop-color="#aeb9c8"/><stop offset=".55" stop-color="#566273"/><stop offset=".8" stop-color="#dce5ef"/><stop offset="1" stop-color="#687587"/></linearGradient>
      <linearGradient id="freshDark-${safeId}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#202b3b"/><stop offset="1" stop-color="#080d15"/></linearGradient>
      <linearGradient id="freshAccent-${safeId}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset=".18" stop-color="${rs.ring}"/><stop offset="1" stop-color="${rs.ring}" stop-opacity=".4"/></linearGradient>
      <filter id="freshGlow-${safeId}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="3.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <circle cx="60" cy="60" r="48" fill="${rs.ring}" opacity=".06" filter="url(#freshGlow-${safeId})"/>
    <path d="M60 6 104 31v58L60 114 16 89V31z" fill="#080d15" stroke="${rs.ring}" stroke-width="3.4"/>
    <path d="M60 12 98 34v50L60 106 22 84V34z" fill="url(#freshDark-${safeId})" stroke="#fff" stroke-opacity=".13" stroke-width="1.3"/>
    <path d="M29 37Q60 16 91 37" fill="none" stroke="#fff" stroke-width="2.5" opacity=".16"/>
    <g class="fresh-ach-core" filter="url(#achShadow)">${core}</g>
    <g class="achievement-motif" opacity=".9">${motif}</g>
    ${sparkle}
    <g class="ach-goal-seal"><rect x="75" y="91" width="32" height="17" rx="8.5" fill="#05080d" stroke="${rs.ring}" stroke-width="1.6"/><text x="91" y="102.5" text-anchor="middle" font-size="9.6" font-weight="900" fill="#fff">${label}</text></g>
  </svg>`;
}


const achievementDefs = [
  // Food
  {id:"food_first",cat:"food",icon:"apple",title:"First Bite",desc:"Log your first food.",rarity:"COMMON",goal:1,metric:"foodEntries"},
  {id:"food_10",cat:"food",icon:"salad",title:"Food Explorer",desc:"Log 10 food entries.",rarity:"COMMON",goal:10,metric:"foodEntries"},
  {id:"food_50",cat:"food",icon:"cart",title:"Label Legend",desc:"Log 50 food entries.",rarity:"RARE",goal:50,metric:"foodEntries"},
  {id:"food_scan_3",cat:"food",icon:"camera",title:"Scan Squad",desc:"Add 3 foods by barcode.",rarity:"COMMON",goal:3,metric:"scannedFoods"},
  {id:"food_scan_10",cat:"food",icon:"camera",title:"Scanner Pro",desc:"Add 10 foods by barcode.",rarity:"RARE",goal:10,metric:"scannedFoods"},
  {id:"food_ontarget_5",cat:"food",icon:"target",title:"On Target",desc:"Check out within target on 5 days.",rarity:"RARE",goal:5,metric:"onTargetDays"},

  // Workout
  {id:"workout_first",cat:"workout",icon:"dumbbell",title:"First Rep",desc:"Complete your first workout.",rarity:"COMMON",goal:1,metric:"workouts"},
  {id:"workout_5",cat:"workout",icon:"dumbbell",title:"Getting Strong",desc:"Complete 5 workouts.",rarity:"COMMON",goal:5,metric:"workouts"},
  {id:"workout_25",cat:"workout",icon:"gear",title:"Routine Machine",desc:"Complete 25 workouts.",rarity:"RARE",goal:25,metric:"workouts"},
  {id:"workout_100",cat:"workout",icon:"dumbbell",title:"Iron Habit",desc:"Complete 100 workouts.",rarity:"EPIC",goal:100,metric:"workouts"},
  {id:"sets_100",cat:"workout",icon:"clipboard",title:"Century Sets",desc:"Log 100 completed workout sets.",rarity:"RARE",goal:100,metric:"completedSets"},
  {id:"sets_500",cat:"workout",icon:"trophy",title:"Set Collector",desc:"Log 500 completed workout sets.",rarity:"EPIC",goal:500,metric:"completedSets"},
  {id:"routine_first",cat:"workout",icon:"clipboard",title:"Set It Once",desc:"Create your first custom routine.",rarity:"COMMON",goal:1,metric:"routines"},
  {id:"pr_first",cat:"workout",icon:"medal",title:"Personal Best",desc:"Set your first personal record.",rarity:"COMMON",goal:1,metric:"prCount"},
  {id:"pr_3",cat:"workout",icon:"chart",title:"On A Roll",desc:"Set 3 personal records.",rarity:"RARE",goal:3,metric:"prCount"},
  {id:"weight_10000",cat:"workout",icon:"dumbbell",title:"Ten Ton Club",desc:"Lift 10,000kg total, lifetime.",rarity:"RARE",goal:10000,metric:"totalWeightLifted"},
  {id:"weight_100000",cat:"workout",icon:"galaxy",title:"Hundred Ton Club",desc:"Lift 100,000kg total, lifetime, roughly a loaded shipping container.",rarity:"MYTHIC",goal:100000,metric:"totalWeightLifted"},

  // Walking
  {id:"walk_first",cat:"walking",icon:"footprint",title:"First Steps",desc:"Log your first walk.",rarity:"COMMON",goal:1,metric:"walks"},
  {id:"walk_1mi",cat:"walking",icon:"footprint",title:"Mile One",desc:"Walk 1 mile in total.",rarity:"COMMON",goal:1,metric:"walkMiles"},
  {id:"walk_5mi",cat:"walking",icon:"tree",title:"Five Mile Wanderer",desc:"Walk 5 miles in total.",rarity:"COMMON",goal:5,metric:"walkMiles"},
  {id:"walk_25mi",cat:"walking",icon:"compass",title:"Trail Finder",desc:"Walk 25 miles in total.",rarity:"RARE",goal:25,metric:"walkMiles"},
  {id:"walk_100mi",cat:"walking",icon:"boot",title:"Hundred Mile Club",desc:"Walk 100 miles in total.",rarity:"EPIC",goal:100,metric:"walkMiles"},
  {id:"walk_250mi",cat:"walking",icon:"mountain",title:"Long Haul Walker",desc:"Walk 250 miles in total.",rarity:"LEGEND",goal:250,metric:"walkMiles"},

  // Running
  {id:"run_first",cat:"running",icon:"runner",title:"Off The Mark",desc:"Log your first run.",rarity:"COMMON",goal:1,metric:"runs"},
  {id:"run_1mi",cat:"running",icon:"lightning",title:"First Mile",desc:"Run 1 mile in total.",rarity:"COMMON",goal:1,metric:"runMiles"},
  {id:"run_5mi",cat:"running",icon:"flag",title:"Five Mile Flyer",desc:"Run 5 miles in total.",rarity:"COMMON",goal:5,metric:"runMiles"},
  {id:"run_25mi",cat:"running",icon:"flame",title:"Road Burner",desc:"Run 25 miles in total.",rarity:"RARE",goal:25,metric:"runMiles"},
  {id:"run_100mi",cat:"running",icon:"rocket",title:"Hundred Mile Runner",desc:"Run 100 miles in total.",rarity:"EPIC",goal:100,metric:"runMiles"},
  {id:"run_250mi",cat:"running",icon:"shootingstar",title:"Distance Demon",desc:"Run 250 miles in total.",rarity:"LEGEND",goal:250,metric:"runMiles"},

  // Weekly Monday-reset challenges
  {id:"week_walk_5",cat:"weekly",icon:"footprint",title:"Five This Week",desc:"Walk 5 miles between Monday and Sunday.",rarity:"COMMON",goal:5,metric:"weekWalkMiles"},
  {id:"week_walk_10",cat:"weekly",icon:"footprint",title:"Double Digits",desc:"Walk 10 miles this week.",rarity:"RARE",goal:10,metric:"weekWalkMiles"},
  {id:"week_walk_20",cat:"weekly",icon:"footprint",title:"Twenty Mile Week",desc:"Walk 20 miles this week.",rarity:"EPIC",goal:20,metric:"weekWalkMiles"},
  {id:"week_run_5",cat:"weekly",icon:"runner",title:"Running Week",desc:"Run 5 miles between Monday and Sunday.",rarity:"COMMON",goal:5,metric:"weekRunMiles"},
  {id:"week_run_10",cat:"weekly",icon:"runner",title:"Ten Mile Week",desc:"Run 10 miles this week.",rarity:"RARE",goal:10,metric:"weekRunMiles"},
  {id:"week_run_20",cat:"weekly",icon:"runner",title:"Twenty Mile Runner",desc:"Run 20 miles this week.",rarity:"EPIC",goal:20,metric:"weekRunMiles"},
  {id:"week_combo_15",cat:"weekly",icon:"footprint",title:"Move 15",desc:"Walk and/or run 15 miles this week.",rarity:"RARE",goal:15,metric:"weekMoveMiles"},
  {id:"week_combo_30",cat:"weekly",icon:"runner",title:"Thirty Mile Week",desc:"Walk and/or run 30 miles this week.",rarity:"LEGEND",goal:30,metric:"weekMoveMiles"},

  // Consistency
  {id:"streak_2",cat:"consistency",icon:"flame",title:"Back Again",desc:"Check out 2 days in a row.",rarity:"COMMON",goal:2,metric:"bestStreak"},
  {id:"streak_3",cat:"consistency",icon:"flame",title:"Three In A Row",desc:"Check out 3 days in a row.",rarity:"COMMON",goal:3,metric:"bestStreak"},
  {id:"streak_7",cat:"consistency",icon:"flame",title:"Full Week",desc:"Reach a 7-day checkout streak.",rarity:"RARE",goal:7,metric:"bestStreak"},
  {id:"streak_14",cat:"consistency",icon:"star",title:"Fortnight Flow",desc:"Reach a 14-day checkout streak.",rarity:"EPIC",goal:14,metric:"bestStreak"},
  {id:"streak_30",cat:"consistency",icon:"crown",title:"Thirty Days",desc:"Reach a 30-day checkout streak.",rarity:"LEGEND",goal:30,metric:"bestStreak"},
  {id:"streak_60",cat:"consistency",icon:"mountain",title:"Two Months Strong",desc:"Reach a 60-day checkout streak.",rarity:"EPIC",goal:60,metric:"bestStreak"},
  {id:"streak_100",cat:"consistency",icon:"monolith",title:"Century Streak",desc:"Reach a 100-day checkout streak.",rarity:"LEGEND",goal:100,metric:"bestStreak"},
  {id:"streak_365",cat:"consistency",icon:"mountain",title:"365 Days",desc:"Reach a full year checkout streak.",rarity:"MYTHIC",goal:365,metric:"bestStreak"},
  {id:"tenure_90",cat:"consistency",icon:"calendar",title:"A Quarter Year",desc:"90 days since your very first log, streak doesn't need to be unbroken.",rarity:"RARE",goal:90,metric:"daysSinceFirstLog"},
  {id:"tenure_180",cat:"consistency",icon:"moon",title:"Half A Year",desc:"180 days since your very first log.",rarity:"EPIC",goal:180,metric:"daysSinceFirstLog"},
  {id:"tenure_365",cat:"consistency",icon:"galaxy",title:"One Year On",desc:"365 days since your very first log, a full year of showing up, streak or no streak.",rarity:"MYTHIC",goal:365,metric:"daysSinceFirstLog"},
  {id:"checkout_25",cat:"consistency",icon:"moon",title:"Day Closer",desc:"Check out 25 days.",rarity:"RARE",goal:25,metric:"checkouts"},
  {id:"checkout_100",cat:"consistency",icon:"book",title:"Hundred Days Logged",desc:"Check out 100 days.",rarity:"LEGEND",goal:100,metric:"checkouts"},

  // Scores
  {id:"score_70",cat:"score",icon:"star",title:"Seventy Club",desc:"Finish a day with CholScore 70+.",rarity:"COMMON",goal:1,metric:"score70Days"},
  {id:"score_80",cat:"score",icon:"rocket",title:"Flying",desc:"Finish a day with CholScore 80+.",rarity:"RARE",goal:1,metric:"score80Days"},
  {id:"score_90",cat:"score",icon:"gem",title:"Elite Day",desc:"Finish a day with CholScore 90+.",rarity:"EPIC",goal:1,metric:"score90Days"},
  {id:"score_90x5",cat:"score",icon:"trophy",title:"High Five",desc:"Finish 5 days with CholScore 90+.",rarity:"LEGEND",goal:5,metric:"score90Days"},
  {id:"points_500",cat:"score",icon:"sparkle",title:"500 Club",desc:"Bank 500 total CholPoints.",rarity:"RARE",goal:500,metric:"totalPoints"},
  {id:"points_2500",cat:"score",icon:"galaxy",title:"Point Collector",desc:"Bank 2,500 total CholPoints.",rarity:"LEGEND",goal:2500,metric:"totalPoints"},
  {id:"points_100",cat:"score",icon:"star",title:"Point Pocket",desc:"Bank 100 total CholPoints.",rarity:"COMMON",goal:100,metric:"totalPoints"},
  {id:"food_ontarget_3",cat:"food",icon:"target",title:"Target Trio",desc:"Check out within target on 3 days.",rarity:"COMMON",goal:3,metric:"onTargetDays"},
  {id:"workout_sets_25",cat:"workout",icon:"brick",title:"Set Starter",desc:"Log 25 completed workout sets.",rarity:"COMMON",goal:25,metric:"completedSets"},
  {id:"weekly_workouts_3",cat:"weekly",icon:"dumbbell",title:"Workout Week",desc:"Complete 3 workouts between Monday and Sunday.",rarity:"COMMON",goal:3,metric:"weekWorkouts"},
  {id:"food_25",cat:"food",icon:"plate",title:"Food Regular",desc:"Log 25 food entries.",rarity:"COMMON",goal:25,metric:"foodEntries"},
  {id:"food_scan_5",cat:"food",icon:"camera",title:"Scanner Starter",desc:"Add 5 foods by barcode.",rarity:"COMMON",goal:5,metric:"scannedFoods"},
  {id:"consistency_checkouts_10",cat:"consistency",icon:"book",title:"Ten Days Logged",desc:"Check out 10 days.",rarity:"COMMON",goal:10,metric:"checkouts"},
  {id:"points_1000",cat:"score",icon:"star",title:"Thousand Club",desc:"Bank 1,000 total CholPoints.",rarity:"RARE",goal:1000,metric:"totalPoints"},
  {id:"food_ontarget_10",cat:"food",icon:"target",title:"Target Ten",desc:"Check out within target on 10 days.",rarity:"RARE",goal:10,metric:"onTargetDays"},
  {id:"workout_pr_10",cat:"workout",icon:"target",title:"PR Hunter",desc:"Set 10 personal records.",rarity:"RARE",goal:10,metric:"prCount"},
  {id:"walking_50",cat:"walking",icon:"footprint",title:"Half Century Walker",desc:"Walk 50 miles in total.",rarity:"RARE",goal:50,metric:"walkMiles"},
  {id:"running_50",cat:"running",icon:"runner",title:"Half Century Runner",desc:"Run 50 miles in total.",rarity:"RARE",goal:50,metric:"runMiles"},
  {id:"workout_50",cat:"workout",icon:"dumbbell",title:"Workout Fifty",desc:"Complete 50 workouts.",rarity:"RARE",goal:50,metric:"workouts"},
  {id:"workout_sets_250",cat:"workout",icon:"brick",title:"Set Builder",desc:"Log 250 completed workout sets.",rarity:"RARE",goal:250,metric:"completedSets"},
  {id:"food_scan_50",cat:"food",icon:"camera",title:"Scanner Fifty",desc:"Add 50 foods by barcode.",rarity:"RARE",goal:50,metric:"scannedFoods"},
  {id:"food_100",cat:"food",icon:"plate",title:"Food Century",desc:"Log 100 food entries.",rarity:"EPIC",goal:100,metric:"foodEntries"},
  {id:"food_ontarget_30",cat:"food",icon:"target",title:"Target Month",desc:"Check out within target on 30 days.",rarity:"EPIC",goal:30,metric:"onTargetDays"},
  {id:"workout_pr_25",cat:"workout",icon:"trophy",title:"PR Collector",desc:"Set 25 personal records.",rarity:"EPIC",goal:25,metric:"prCount"},
  {id:"workout_weight_50000",cat:"workout",icon:"dumbbell",title:"Fifty Ton Club",desc:"Lift 50,000kg total, lifetime.",rarity:"EPIC",goal:50000,metric:"totalWeightLifted"},
  {id:"workout_150",cat:"workout",icon:"flame",title:"Workout 150",desc:"Complete 150 workouts.",rarity:"EPIC",goal:150,metric:"workouts"},
  {id:"workout_sets_1000",cat:"workout",icon:"brick",title:"Set Thousand",desc:"Log 1,000 completed workout sets.",rarity:"EPIC",goal:1000,metric:"completedSets"},
  {id:"food_scan_100",cat:"food",icon:"camera",title:"Scanner Century",desc:"Add 100 foods by barcode.",rarity:"EPIC",goal:100,metric:"scannedFoods"},
  {id:"food_500",cat:"food",icon:"plate",title:"Food Five Hundred",desc:"Log 500 food entries.",rarity:"EPIC",goal:500,metric:"foodEntries"},
  {id:"weekly_move_40",cat:"weekly",icon:"footprint",title:"Forty Mile Week",desc:"Walk and/or run 40 miles this week.",rarity:"EPIC",goal:40,metric:"weekMoveMiles"},
  {id:"workout_weight_250000",cat:"workout",icon:"dumbbell",title:"Quarter Million Club",desc:"Lift 250,000kg total, lifetime.",rarity:"EPIC",goal:250000,metric:"totalWeightLifted"},
  {id:"walking_500",cat:"walking",icon:"boot",title:"Walk 500",desc:"Walk 500 miles in total.",rarity:"LEGEND",goal:500,metric:"walkMiles"},
  {id:"running_500",cat:"running",icon:"medal",title:"Run 500",desc:"Run 500 miles in total.",rarity:"LEGEND",goal:500,metric:"runMiles"},
  {id:"workout_250",cat:"workout",icon:"flame",title:"Workout 250",desc:"Complete 250 workouts.",rarity:"LEGEND",goal:250,metric:"workouts"},
  {id:"workout_sets_2500",cat:"workout",icon:"brick",title:"Set 2,500",desc:"Log 2,500 completed workout sets.",rarity:"LEGEND",goal:2500,metric:"completedSets"},
  {id:"workout_pr_75",cat:"workout",icon:"trophy",title:"PR Master",desc:"Set 75 personal records.",rarity:"LEGEND",goal:75,metric:"prCount"},
  {id:"food_ontarget_100",cat:"food",icon:"target",title:"Target Century",desc:"Check out within target on 100 days.",rarity:"LEGEND",goal:100,metric:"onTargetDays"},
  {id:"points_10000",cat:"score",icon:"gem",title:"Ten Thousand Club",desc:"Bank 10,000 total CholPoints.",rarity:"LEGEND",goal:10000,metric:"totalPoints"},
  {id:"score_90_25",cat:"score",icon:"star",title:"Ninety Club",desc:"Finish 25 days with CholScore 90+.",rarity:"LEGEND",goal:25,metric:"score90Days"},
  {id:"workout_weight_500000",cat:"workout",icon:"dumbbell",title:"Half Million Club",desc:"Lift 500,000kg total, lifetime.",rarity:"LEGEND",goal:500000,metric:"totalWeightLifted"},
  {id:"weekly_move_50",cat:"weekly",icon:"runner",title:"Ultra Week",desc:"Walk and/or run 50 miles between Monday and Sunday.",rarity:"LEGEND",goal:50,metric:"weekMoveMiles"},
  {id:"walking_1000",cat:"walking",icon:"galaxy",title:"Walk 1,000",desc:"Walk 1,000 miles in total, enough miles to make every pair of trainers nervous.",rarity:"MYTHIC",goal:1000,metric:"walkMiles"},
  {id:"running_1000",cat:"running",icon:"galaxy",title:"Run 1,000",desc:"Run 1,000 miles in total, four figures earned one mile at a time.",rarity:"MYTHIC",goal:1000,metric:"runMiles"},
  {id:"swim_half",cat:"swimming",icon:"wave",title:"First Splash",desc:"Swim 0.5 miles in total.",rarity:"COMMON",goal:0.5,metric:"swimMiles"},
  {id:"swim_1mi",cat:"swimming",icon:"swimmer",title:"Mile Swimmer",desc:"Swim 1 mile in total.",rarity:"COMMON",goal:1,metric:"swimMiles"},
  {id:"swim_5mi",cat:"swimming",icon:"swimmer",title:"Fin Finder",desc:"Swim 5 miles in total.",rarity:"RARE",goal:5,metric:"swimMiles"},
  {id:"swim_10mi",cat:"swimming",icon:"swimmer",title:"Deep End",desc:"Swim 10 miles in total.",rarity:"RARE",goal:10,metric:"swimMiles"},
  {id:"swim_20mi",cat:"swimming",icon:"wave",title:"Current Rider",desc:"Swim 20 miles in total.",rarity:"EPIC",goal:20,metric:"swimMiles"},
  {id:"swim_50mi",cat:"swimming",icon:"wave",title:"Channel Chaser",desc:"Swim 50 miles in total.",rarity:"LEGEND",goal:50,metric:"swimMiles"},
  {id:"swim_100mi",cat:"swimming",icon:"gem",title:"Ice Breaker",desc:"Swim 100 miles in total.",rarity:"LEGEND",goal:100,metric:"swimMiles"},
  {id:"swim_200mi",cat:"swimming",icon:"galaxy",title:"Two Hundred Lengths of the Sun",desc:"Swim 200 miles in total.",rarity:"MYTHIC",goal:200,metric:"swimMiles"},
  {id:"week_swim_1",cat:"weekly",icon:"swimmer",title:"Swim Week",desc:"Swim 1 mile between Monday and Sunday.",rarity:"COMMON",goal:1,metric:"weekSwimMiles"},
  {id:"week_swim_3",cat:"weekly",icon:"swimmer",title:"Triple Dip",desc:"Swim 3 miles between Monday and Sunday.",rarity:"RARE",goal:3,metric:"weekSwimMiles"},
  {id:"week_swim_6",cat:"weekly",icon:"swimmer",title:"Six Mile Splash",desc:"Swim 6 miles between Monday and Sunday.",rarity:"EPIC",goal:6,metric:"weekSwimMiles"},
  {id:"cycle_5mi",cat:"cycling",icon:"bike",title:"First Spin",desc:"Cycle 5 miles in total.",rarity:"COMMON",goal:5,metric:"cycleMiles"},
  {id:"cycle_15mi",cat:"cycling",icon:"bike",title:"Rolling Start",desc:"Cycle 15 miles in total.",rarity:"COMMON",goal:15,metric:"cycleMiles"},
  {id:"cycle_50mi",cat:"cycling",icon:"mountain",title:"Half Century Ride",desc:"Cycle 50 miles in total.",rarity:"RARE",goal:50,metric:"cycleMiles"},
  {id:"cycle_100mi",cat:"cycling",icon:"medal",title:"Century Rider",desc:"Cycle 100 miles in total.",rarity:"RARE",goal:100,metric:"cycleMiles"},
  {id:"cycle_250mi",cat:"cycling",icon:"mountain",title:"Hill Hunter",desc:"Cycle 250 miles in total.",rarity:"EPIC",goal:250,metric:"cycleMiles"},
  {id:"cycle_500mi",cat:"cycling",icon:"rocket",title:"Long Haul Cyclist",desc:"Cycle 500 miles in total.",rarity:"LEGEND",goal:500,metric:"cycleMiles"},
  {id:"cycle_1000mi",cat:"cycling",icon:"lightning",title:"Thousand Mile Club",desc:"Cycle 1,000 miles in total.",rarity:"LEGEND",goal:1000,metric:"cycleMiles"},
  {id:"cycle_2500mi",cat:"cycling",icon:"galaxy",title:"Cross Country",desc:"Cycle 2,500 miles in total.",rarity:"MYTHIC",goal:2500,metric:"cycleMiles"},
  {id:"week_cycle_15",cat:"weekly",icon:"bike",title:"Cycle Week",desc:"Cycle 15 miles between Monday and Sunday.",rarity:"COMMON",goal:15,metric:"weekCycleMiles"},
  {id:"week_cycle_30",cat:"weekly",icon:"bike",title:"Thirty Mile Ride Week",desc:"Cycle 30 miles between Monday and Sunday.",rarity:"RARE",goal:30,metric:"weekCycleMiles"},
  {id:"week_cycle_60",cat:"weekly",icon:"bike",title:"Sixty Mile Week",desc:"Cycle 60 miles between Monday and Sunday.",rarity:"EPIC",goal:60,metric:"weekCycleMiles"},
  {id:"hike_1mi",cat:"hiking",icon:"tree",title:"First Trail",desc:"Hike 1 mile in total.",rarity:"COMMON",goal:1,metric:"hikeMiles"},
  {id:"hike_5mi",cat:"hiking",icon:"boot",title:"Trailblazer",desc:"Hike 5 miles in total.",rarity:"COMMON",goal:5,metric:"hikeMiles"},
  {id:"hike_20mi",cat:"hiking",icon:"compass",title:"Ridge Walker",desc:"Hike 20 miles in total.",rarity:"RARE",goal:20,metric:"hikeMiles"},
  {id:"hike_50mi",cat:"hiking",icon:"mountain",title:"Summit Seeker",desc:"Hike 50 miles in total.",rarity:"RARE",goal:50,metric:"hikeMiles"},
  {id:"hike_100mi",cat:"hiking",icon:"mountain",title:"Peak Bagger",desc:"Hike 100 miles in total.",rarity:"EPIC",goal:100,metric:"hikeMiles"},
  {id:"hike_200mi",cat:"hiking",icon:"mountain",title:"Mountain Wanderer",desc:"Hike 200 miles in total.",rarity:"LEGEND",goal:200,metric:"hikeMiles"},
  {id:"hike_400mi",cat:"hiking",icon:"mountain",title:"Highland Legend",desc:"Hike 400 miles in total.",rarity:"LEGEND",goal:400,metric:"hikeMiles"},
  {id:"hike_750mi",cat:"hiking",icon:"galaxy",title:"Long Trail Master",desc:"Hike 750 miles in total.",rarity:"MYTHIC",goal:750,metric:"hikeMiles"},
  {id:"week_hike_5",cat:"weekly",icon:"boot",title:"Hike Week",desc:"Hike 5 miles between Monday and Sunday.",rarity:"COMMON",goal:5,metric:"weekHikeMiles"},
  {id:"week_hike_10",cat:"weekly",icon:"boot",title:"Ten Mile Trail Week",desc:"Hike 10 miles between Monday and Sunday.",rarity:"RARE",goal:10,metric:"weekHikeMiles"},
  {id:"week_hike_15",cat:"weekly",icon:"boot",title:"Fifteen Mile Ridge Week",desc:"Hike 15 miles between Monday and Sunday.",rarity:"EPIC",goal:15,metric:"weekHikeMiles"},
  {id:"row_1mi",cat:"rowing",icon:"oar",title:"First Stroke",desc:"Row 1 mile in total.",rarity:"COMMON",goal:1,metric:"rowMiles"},
  {id:"row_5mi",cat:"rowing",icon:"wave",title:"Five Mile Pull",desc:"Row 5 miles in total.",rarity:"COMMON",goal:5,metric:"rowMiles"},
  {id:"row_25mi",cat:"rowing",icon:"wave",title:"Steady Stroke",desc:"Row 25 miles in total.",rarity:"RARE",goal:25,metric:"rowMiles"},
  {id:"row_50mi",cat:"rowing",icon:"flag",title:"Half Century Row",desc:"Row 50 miles in total.",rarity:"RARE",goal:50,metric:"rowMiles"},
  {id:"row_100mi",cat:"rowing",icon:"medal",title:"Hundred Mile Rower",desc:"Row 100 miles in total.",rarity:"EPIC",goal:100,metric:"rowMiles"},
  {id:"row_250mi",cat:"rowing",icon:"flame",title:"Engine Room",desc:"Row 250 miles in total.",rarity:"LEGEND",goal:250,metric:"rowMiles"},
  {id:"row_500mi",cat:"rowing",icon:"rocket",title:"Distance Rower",desc:"Row 500 miles in total.",rarity:"LEGEND",goal:500,metric:"rowMiles"},
  {id:"row_1000mi",cat:"rowing",icon:"galaxy",title:"Thousand Mile Rower",desc:"Row 1,000 miles in total.",rarity:"MYTHIC",goal:1000,metric:"rowMiles"},
  {id:"week_row_5",cat:"weekly",icon:"oar",title:"Row Week",desc:"Row 5 miles between Monday and Sunday.",rarity:"COMMON",goal:5,metric:"weekRowMiles"},
  {id:"week_row_10",cat:"weekly",icon:"oar",title:"Ten Mile Row Week",desc:"Row 10 miles between Monday and Sunday.",rarity:"RARE",goal:10,metric:"weekRowMiles"},
  {id:"week_row_20",cat:"weekly",icon:"oar",title:"Twenty Mile Row Week",desc:"Row 20 miles between Monday and Sunday.",rarity:"EPIC",goal:20,metric:"weekRowMiles"},
  {id:"workout_500",cat:"workout",icon:"galaxy",title:"Workout 500",desc:"Complete 500 workouts, showing up has officially become a superpower.",rarity:"MYTHIC",goal:500,metric:"workouts"},
  {id:"workout_sets_5000",cat:"workout",icon:"galaxy",title:"Set 5,000",desc:"Log 5,000 completed workout sets.",rarity:"MYTHIC",goal:5000,metric:"completedSets"},
  {id:"food_ontarget_250",cat:"food",icon:"galaxy",title:"Target 250",desc:"Check out within target on 250 days.",rarity:"MYTHIC",goal:250,metric:"onTargetDays"},
  {id:"workout_weight_1000000",cat:"workout",icon:"galaxy",title:"Million Kilo Club",desc:"Lift 1,000,000kg total, lifetime, one thousand tonnes of work.",rarity:"MYTHIC",goal:1000000,metric:"totalWeightLifted"},
  {id:"points_25000",cat:"score",icon:"galaxy",title:"Twenty Five Thousand Club",desc:"Bank 25,000 total CholPoints.",rarity:"MYTHIC",goal:25000,metric:"totalPoints"},
  {id:"consistency_52weeks",cat:"consistency",icon:"galaxy",title:"52 Week Warrior",desc:"Complete at least one workout in 52 different calendar weeks.",rarity:"MYTHIC",goal:52,metric:"distinctWorkoutWeeks"},
  {id:"consistency_move_2500",cat:"consistency",icon:"galaxy",title:"Round The World Starter",desc:"Walk and/or run 2,500 miles in total, a serious chunk of planet Earth under your feet.",rarity:"MYTHIC",goal:2500,metric:"totalMoveMiles"},
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
      <span class="achievement-icon">${renderAchBadge(a)}</span>
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
  const dayKeysRemaining=dayKeys.filter(k=>k>today).length;
  return {mondayKey,endKey,isCurrent,minutes,weightLifted,workouts,daysUnder,daysTotal:daysElapsed,dayKeysRemaining,rewardPoints,bestDay,prCount,distanceKm};
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
    // Calendar days remaining in the week — deliberately independent of
    // summary.daysTotal, since that's capped to start from the user's first
    // log (see weekSummary). For someone's very first, in-progress week,
    // those two numbers differ: daysTotal might be "days since I started"
    // rather than "days since Monday", which would throw this off.
    const daysLeft=summary.dayKeysRemaining;
    const remainingClause=daysLeft>0?`, ${daysLeft} day${daysLeft===1?"":"s"} left to build on it`:"";
    if(ratio>=0.85)return `Great momentum, ${n}, you're <strong>${summary.daysUnder} for ${summary.daysTotal}</strong> on your saturated fat target this week, with <strong>${mins} minutes</strong> of movement already banked${highlight}${remainingClause}.`;
    if(ratio>=0.5)return `Solid progress so far, ${n}. <strong>${summary.daysUnder} of ${summary.daysTotal} days</strong> under target and <strong>${mins} minutes</strong> of movement this week${highlight}${remainingClause}.`;
    return `Every day this week is still an opportunity, ${n}, <strong>${mins} minutes</strong> of movement already in the bank${highlight}${remainingClause}.`;
  }
  if(ratio>=0.85)return `Strong week, ${n}, <strong>${summary.daysUnder} of ${summary.daysTotal} days</strong> under your saturated fat limit and <strong>${mins} minutes</strong> of movement${highlight}. Every choice like that shapes what comes next.`;
  if(ratio>=0.5)return `Solid week, ${n}. <strong>${summary.daysUnder} of ${summary.daysTotal} days</strong> under target and <strong>${mins} minutes</strong> on your feet${highlight}, the choices you're making are paying off.`;
  return `A quieter week, ${n}, <strong>${mins} minutes</strong> of movement still went in the bank${highlight}. Plenty of room to build from here.`;
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
        <span class="rep-reward-icon">${esc(c.icon)}</span>
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
  // Prevent the weight stepper from stealing focus off an in-progress reps
  // input. Without this, tapping +/- while a rep box is focused blurs it,
  // firing its change-driven markComplete() mid-typing, which then races
  // against this button's own click + re-render. Android's WebView blurs
  // inputs far more eagerly than iOS's, which is why this only surfaced there.
  ["liveWeightDown","liveWeightUp","liveWeightValue"].forEach(id=>{
    $(id)?.addEventListener("pointerdown",ev=>ev.preventDefault());
  });

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

/* v1.36.0 Exercise Victory screen — replaces the old emoji-led completion
   modal with a compact premium performance summary. Kept self-contained in
   app.js so it works with the existing HTML shell: the dialog is upgraded
   on first use, its styles are injected once, and all existing workout/PR
   logic remains the source of truth. */
function exerciseVictoryMedallionSVG(){
  return `<svg viewBox="0 0 160 160" aria-hidden="true">
    <defs>
      <radialGradient id="ecmCore" cx="42%" cy="32%" r="72%"><stop offset="0" stop-color="#22313a"/><stop offset=".58" stop-color="#101820"/><stop offset="1" stop-color="#070b10"/></radialGradient>
      <linearGradient id="ecmSteel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#f4f7f8"/><stop offset=".22" stop-color="#7d8b94"/><stop offset=".48" stop-color="#e2e8ea"/><stop offset=".72" stop-color="#53616b"/><stop offset="1" stop-color="#c7d0d5"/></linearGradient>
      <linearGradient id="ecmTeal" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#57f6e0"/><stop offset=".55" stop-color="#21d7c5"/><stop offset="1" stop-color="#56a8ff"/></linearGradient>
      <filter id="ecmGlow"><feGaussianBlur stdDeviation="3.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <circle cx="80" cy="80" r="69" fill="url(#ecmCore)" stroke="url(#ecmSteel)" stroke-width="5"/>
    <circle cx="80" cy="80" r="61" fill="none" stroke="#29ddca" stroke-opacity=".78" stroke-width="2.5" filter="url(#ecmGlow)"/>
    <path d="M57 42c7-10 20-8 23 3 4-11 17-13 24-3 7 11-1 22-24 38-23-16-30-27-23-38Z" fill="none" stroke="url(#ecmTeal)" stroke-width="4" stroke-linejoin="round"/>
    <path d="M65 58h8l4-9 7 19 5-10h8" fill="none" stroke="#39ebd8" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <rect x="48" y="88" width="64" height="9" rx="4.5" fill="url(#ecmSteel)"/>
    <rect x="35" y="79" width="13" height="27" rx="4" fill="url(#ecmSteel)"/>
    <rect x="27" y="84" width="8" height="17" rx="3" fill="url(#ecmSteel)"/>
    <rect x="112" y="79" width="13" height="27" rx="4" fill="url(#ecmSteel)"/>
    <rect x="125" y="84" width="8" height="17" rx="3" fill="url(#ecmSteel)"/>
    <path d="M53 121c9 7 18 10 27 10s18-3 27-10" fill="none" stroke="#9aa8b0" stroke-width="3" stroke-linecap="round"/>
    <path d="M50 116l-10-3m13 9-11 2m68-8 10-3m-13 9 11 2" stroke="#87959e" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
}
function exerciseVictoryTrophySVG(){
  return `<svg viewBox="0 0 120 120" aria-hidden="true">
    <defs><linearGradient id="ecmGold" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff1a8"/><stop offset=".3" stop-color="#ffc74a"/><stop offset=".7" stop-color="#c98312"/><stop offset="1" stop-color="#ffe18a"/></linearGradient></defs>
    <circle cx="60" cy="60" r="52" fill="#16120b" stroke="#f0ba42" stroke-width="3"/>
    <circle cx="60" cy="60" r="44" fill="none" stroke="#f0ba42" stroke-opacity=".35"/>
    <path d="M42 34h36v17c0 12-8 21-18 21s-18-9-18-21V34Z" fill="url(#ecmGold)"/>
    <path d="M42 39H31c0 11 5 18 14 18M78 39h11c0 11-5 18-14 18" fill="none" stroke="#f3c451" stroke-width="5" stroke-linecap="round"/>
    <path d="M60 72v12m-14 7h28" stroke="#f3c451" stroke-width="6" stroke-linecap="round"/>
    <path d="M54 49h4l3-7 4 15 3-8h5" fill="none" stroke="#7f5108" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
function exerciseVictoryBenchSVG(){
  return `<svg viewBox="0 0 120 90" aria-hidden="true">
    <defs><linearGradient id="ecmBenchSteel" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#d9e1e5"/><stop offset=".45" stop-color="#52616b"/><stop offset="1" stop-color="#bcc6cb"/></linearGradient></defs>
    <path d="M27 23h66" stroke="url(#ecmBenchSteel)" stroke-width="6" stroke-linecap="round"/>
    <rect x="17" y="15" width="8" height="16" rx="2" fill="#26d9c8"/><rect x="25" y="12" width="7" height="22" rx="2" fill="#798992"/>
    <rect x="95" y="15" width="8" height="16" rx="2" fill="#26d9c8"/><rect x="88" y="12" width="7" height="22" rx="2" fill="#798992"/>
    <path d="M39 30v43m42-43v43" stroke="#61717a" stroke-width="5" stroke-linecap="round"/>
    <rect x="34" y="54" width="52" height="10" rx="5" fill="#162229" stroke="#31dccc" stroke-width="2"/>
    <path d="M47 64l-7 13m33-13 7 13" stroke="#708089" stroke-width="5" stroke-linecap="round"/>
  </svg>`;
}
function injectExerciseVictoryStyles(){
  if(document.getElementById("exerciseVictoryV2Styles"))return;
  const style=document.createElement("style");
  style.id="exerciseVictoryV2Styles";
  style.textContent=`
    #exerciseCompleteDialog.exercise-victory-v2{width:min(760px,calc(100vw - 18px))!important;max-width:760px!important;height:min(940px,calc(100dvh - 18px))!important;max-height:calc(100dvh - 18px)!important;margin:auto!important;padding:0!important;border:1px solid rgba(93,111,124,.5)!important;border-radius:34px!important;overflow:hidden!important;background:radial-gradient(circle at 50% 0%,rgba(26,177,166,.15),transparent 34%),radial-gradient(circle at 96% 88%,rgba(255,99,77,.08),transparent 28%),linear-gradient(180deg,#071017 0%,#071018 48%,#080d14 100%)!important;color:#f7f8fb!important;box-shadow:0 34px 90px rgba(0,0,0,.68),0 0 42px rgba(34,217,198,.08)!important;}
    #exerciseCompleteDialog.exercise-victory-v2::backdrop{background:rgba(1,4,8,.84)!important;backdrop-filter:blur(12px);}
    #exerciseCompleteDialog .ecm-scene{position:absolute!important;inset:0!important;overflow:hidden!important;pointer-events:none!important;z-index:0!important;}
    #exerciseCompleteDialog .ecm-stars{position:absolute;inset:0;}
    #exerciseCompleteDialog .ecm-stars i{position:absolute;border-radius:50%;background:#e9f7ff;opacity:.45;box-shadow:0 0 9px rgba(255,255,255,.8);animation:ecmTwinkle 3.2s ease-in-out infinite;}
    #exerciseCompleteDialog .ecm-confetti{position:absolute;inset:0 0 auto 0;height:260px;overflow:hidden;}
    #exerciseCompleteDialog .ecm-confetti i{position:absolute;top:-22px;width:6px;height:14px;border-radius:2px;opacity:0;animation:ecmVictoryFall 1.9s cubic-bezier(.2,.65,.3,1) forwards;}
    @keyframes ecmTwinkle{0%,100%{opacity:.18;transform:scale(.75)}50%{opacity:.75;transform:scale(1.15)}}
    @keyframes ecmVictoryFall{0%{opacity:0;transform:translate3d(0,-20px,0) rotate(0)}12%{opacity:1}100%{opacity:0;transform:translate3d(var(--drift),240px,0) rotate(var(--spin))}}
    @keyframes ecmVictoryIn{0%{opacity:0;transform:translateY(24px) scale(.975)}100%{opacity:1;transform:none}}
    @keyframes ecmMedalPulse{0%{transform:scale(.94);filter:drop-shadow(0 0 0 rgba(49,226,205,0))}70%{transform:scale(1.025);filter:drop-shadow(0 0 26px rgba(49,226,205,.42))}100%{transform:scale(1);filter:drop-shadow(0 0 16px rgba(49,226,205,.22))}}
    #exerciseCompleteDialog .ecm-victory-shell{position:relative;z-index:1;height:100%;overflow-y:auto;overscroll-behavior:contain;padding:clamp(22px,4vh,42px) clamp(18px,4vw,36px) calc(24px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:stretch;gap:16px;scrollbar-width:none;animation:ecmVictoryIn .42s ease both;}
    #exerciseCompleteDialog .ecm-victory-shell::-webkit-scrollbar{display:none}
    #exerciseCompleteDialog .ecm-medallion{width:clamp(132px,24vh,190px);aspect-ratio:1;margin:0 auto -2px;animation:ecmMedalPulse .7s cubic-bezier(.2,.8,.2,1) both;}
    #exerciseCompleteDialog .ecm-medallion svg{width:100%;height:100%;display:block;filter:drop-shadow(0 14px 24px rgba(0,0,0,.45));}
    #exerciseCompleteDialog .ecm-kicker{text-align:center;margin:0;color:#37e3d0;font-size:12px;font-weight:800;letter-spacing:.28em;}
    #exerciseCompleteDialog #exerciseCompleteTitle{text-align:center;margin:0!important;font-size:clamp(31px,7vw,48px)!important;line-height:1.04!important;letter-spacing:-.035em!important;color:#f7f7f8!important;font-weight:800!important;}
    #exerciseCompleteDialog #exerciseCompleteTitle .ecm-name-accent{color:#36e2d0;}
    #exerciseCompleteDialog #exerciseCompleteMessage{text-align:center;margin:0 auto 3px!important;max-width:590px;color:#b9c0cb!important;font-size:clamp(16px,3.8vw,21px)!important;line-height:1.48!important;}
    #exerciseCompleteDialog .ecm-performance-panel,#exerciseCompleteDialog .ecm-next-panel{background:linear-gradient(180deg,rgba(15,31,40,.92),rgba(7,18,25,.94));border:1px solid rgba(92,125,139,.48);border-radius:24px;box-shadow:inset 0 1px 0 rgba(255,255,255,.035),0 12px 24px rgba(0,0,0,.19);}
    #exerciseCompleteDialog .ecm-performance-panel{padding:17px 12px 14px;}
    #exerciseCompleteDialog .ecm-panel-label{text-align:center;color:#3ce4d1;font-size:11px;font-weight:800;letter-spacing:.2em;margin-bottom:13px;display:flex;align-items:center;gap:12px;justify-content:center;}
    #exerciseCompleteDialog .ecm-panel-label:before,#exerciseCompleteDialog .ecm-panel-label:after{content:"";width:38px;height:1px;background:linear-gradient(90deg,transparent,#35dcca);}
    #exerciseCompleteDialog .ecm-panel-label:after{background:linear-gradient(90deg,#35dcca,transparent);}
    #exerciseCompleteDialog #exerciseCompleteStats{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:0!important;background:none!important;border:0!important;padding:0!important;margin:0!important;}
    #exerciseCompleteDialog #exerciseCompleteStats>div{min-width:0;padding:4px 10px!important;text-align:center!important;background:none!important;border:0!important;border-right:1px solid rgba(124,145,157,.28)!important;border-radius:0!important;display:flex!important;flex-direction:column!important;justify-content:center;gap:5px;}
    #exerciseCompleteDialog #exerciseCompleteStats>div:last-child{border-right:0!important;}
    #exerciseCompleteDialog #exerciseCompleteStats span{order:2;color:#8f99aa!important;font-size:10px!important;font-weight:800!important;letter-spacing:.16em!important;}
    #exerciseCompleteDialog #exerciseCompleteStats strong{order:1;color:#f5f7f8!important;font-size:clamp(25px,6.2vw,39px)!important;line-height:1!important;font-weight:800!important;white-space:nowrap;}
    #exerciseCompleteDialog #exerciseCompleteStats>div:first-child strong{color:#37e3d0!important;}
    #exerciseCompleteDialog #exerciseCompleteStats>div:last-child strong{color:#ff7355!important;}
    #exerciseCompleteDialog #exerciseCompleteStats b{font:inherit;color:inherit;}
    #exerciseCompleteDialog .ecm-pr-zone:empty{display:none;}
    #exerciseCompleteDialog .ecm-pr-card{position:relative;overflow:hidden;display:grid;grid-template-columns:112px minmax(0,1fr);gap:17px;align-items:center;padding:17px 20px;border-radius:24px;background:radial-gradient(circle at 15% 50%,rgba(244,182,58,.13),transparent 35%),linear-gradient(180deg,rgba(21,22,20,.97),rgba(10,15,18,.98));border:1px solid rgba(245,190,70,.82);box-shadow:0 0 24px rgba(236,171,45,.17),inset 0 0 26px rgba(241,179,55,.04);}
    #exerciseCompleteDialog .ecm-pr-card:after{content:"";position:absolute;left:44%;right:8%;bottom:40px;height:1px;background:linear-gradient(90deg,rgba(239,179,58,.16),#f2bd4a,rgba(239,179,58,.12));}
    #exerciseCompleteDialog .ecm-pr-ribbon{position:absolute;left:-39px;top:13px;width:130px;transform:rotate(-45deg);text-align:center;padding:5px 0;background:linear-gradient(90deg,#ffd872,#e6a92c);color:#17100a;font-size:10px;font-weight:900;letter-spacing:.08em;z-index:2;box-shadow:0 3px 8px rgba(0,0,0,.28);}
    #exerciseCompleteDialog .ecm-pr-medal{width:105px;height:105px;}
    #exerciseCompleteDialog .ecm-pr-medal svg{width:100%;height:100%;filter:drop-shadow(0 0 14px rgba(240,180,54,.24));}
    #exerciseCompleteDialog .ecm-pr-label{color:#f2c45f;font-size:11px;font-weight:800;letter-spacing:.17em;margin-bottom:3px;}
    #exerciseCompleteDialog .ecm-pr-value{font-size:clamp(31px,7vw,46px);line-height:1;color:#f0b84c;font-weight:800;letter-spacing:-.025em;}
    #exerciseCompleteDialog .ecm-pr-detail{font-size:16px;font-weight:750;color:#f7f7f7;margin-top:5px;}
    #exerciseCompleteDialog .ecm-pr-copy{font-size:13px;color:#d9aa49;margin-top:17px;}
    #exerciseCompleteDialog .ecm-next-panel{display:grid;grid-template-columns:88px minmax(0,1fr) 44px;gap:15px;align-items:center;padding:15px 17px;}
    #exerciseCompleteDialog .ecm-next-icon{width:84px;height:70px;border-radius:16px;background:rgba(10,23,30,.78);display:grid;place-items:center;border:1px solid rgba(69,105,117,.3);}
    #exerciseCompleteDialog .ecm-next-icon svg{width:78px;height:60px;}
    #exerciseCompleteDialog .ecm-next-kicker{color:#3ce4d1;font-size:10px;font-weight:800;letter-spacing:.18em;margin-bottom:4px;}
    #exerciseCompleteDialog .ecm-next-name{font-size:20px;font-weight:800;color:#f5f7f8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
    #exerciseCompleteDialog .ecm-next-meta{font-size:14px;color:#b6bec8;margin-top:3px;}
    #exerciseCompleteDialog .ecm-next-copy{font-size:12px;color:#7f8a97;margin-top:4px;}
    #exerciseCompleteDialog .ecm-next-chevron{width:40px;height:40px;border:2px solid #2ce0cf;border-radius:50%;display:grid;place-items:center;color:#2ce0cf;font-size:28px;line-height:1;}
    #exerciseCompleteDialog #nextExerciseBtn{margin:1px 0 0!important;min-height:68px!important;border:0!important;border-radius:24px!important;background:linear-gradient(110deg,#25d7bd 0%,#7ecbb0 38%,#f6a16e 72%,#ff664d 100%)!important;color:#081014!important;font-size:19px!important;font-weight:900!important;letter-spacing:.02em!important;box-shadow:0 10px 28px rgba(26,210,187,.17),0 9px 30px rgba(255,100,75,.15)!important;display:flex!important;align-items:center!important;justify-content:center!important;gap:13px!important;width:100%!important;}
    #exerciseCompleteDialog #nextExerciseBtn .ecm-btn-mark{width:28px;height:28px;display:inline-grid;place-items:center;color:#071014;font-size:24px;}
    #exerciseCompleteDialog #nextExerciseBtn .ecm-btn-arrow{font-size:31px;font-weight:500;margin-left:4px;}
    #exerciseCompleteDialog .ecm-motto{text-align:center;color:#7f8997;font-size:12px;margin-top:1px;letter-spacing:.03em;}
    #exerciseCompleteDialog .ecm-motto b{color:#33d8c6;font-size:17px;margin-right:6px;vertical-align:-1px;}
    @media(max-width:430px){
      #exerciseCompleteDialog.exercise-victory-v2{width:calc(100vw - 10px)!important;height:calc(100dvh - 10px)!important;border-radius:28px!important;}
      #exerciseCompleteDialog .ecm-victory-shell{padding:24px 16px calc(18px + env(safe-area-inset-bottom));gap:13px;}
      #exerciseCompleteDialog .ecm-medallion{width:132px;}
      #exerciseCompleteDialog .ecm-pr-card{grid-template-columns:86px minmax(0,1fr);padding:14px 15px;gap:12px;}
      #exerciseCompleteDialog .ecm-pr-medal{width:82px;height:82px;}
      #exerciseCompleteDialog .ecm-pr-card:after{left:40%;bottom:34px;}
      #exerciseCompleteDialog .ecm-next-panel{grid-template-columns:66px minmax(0,1fr) 36px;padding:13px;gap:11px;}
      #exerciseCompleteDialog .ecm-next-icon{width:64px;height:58px;}.ecm-next-icon svg{max-width:60px;}
      #exerciseCompleteDialog .ecm-next-chevron{width:34px;height:34px;font-size:24px;}
      #exerciseCompleteDialog #nextExerciseBtn{min-height:60px!important;border-radius:20px!important;font-size:17px!important;}
    }
    @media(max-height:760px){
      #exerciseCompleteDialog .ecm-victory-shell{padding-top:18px;gap:10px;}
      #exerciseCompleteDialog .ecm-medallion{width:108px;}
      #exerciseCompleteDialog #exerciseCompleteTitle{font-size:30px!important;}
      #exerciseCompleteDialog .ecm-performance-panel{padding:12px 10px 10px;}
      #exerciseCompleteDialog .ecm-pr-card{padding-top:12px;padding-bottom:12px;}
    }
    @media(prefers-reduced-motion:reduce){#exerciseCompleteDialog .ecm-victory-shell,#exerciseCompleteDialog .ecm-medallion,#exerciseCompleteDialog .ecm-stars i,#exerciseCompleteDialog .ecm-confetti i{animation:none!important;}}
  `;
  document.head.appendChild(style);
}
function ensureExerciseVictoryUI(){
  injectExerciseVictoryStyles();
  const dialog=$("exerciseCompleteDialog");
  if(!dialog||dialog.dataset.victoryUi==="2")return dialog;
  dialog.dataset.victoryUi="2";
  dialog.classList.add("exercise-victory-v2");
  dialog.innerHTML=`
    <div class="ecm-scene" aria-hidden="true"><div class="ecm-stars" id="ecmStars"></div><div class="ecm-confetti" id="ecmVictoryConfetti"></div></div>
    <div class="ecm-victory-shell">
      <div class="ecm-medallion">${exerciseVictoryMedallionSVG()}</div>
      <p class="ecm-kicker">EXERCISE COMPLETE</p>
      <h2 id="exerciseCompleteTitle">Excellent effort!</h2>
      <p id="exerciseCompleteMessage"></p>
      <div class="ecm-performance-panel"><div class="ecm-panel-label">YOUR PERFORMANCE</div><div id="exerciseCompleteStats"></div></div>
      <div id="ecmPrBadges" class="ecm-pr-zone"></div>
      <div id="ecmNextPreview"></div>
      <button id="nextExerciseBtn" type="button"><span class="ecm-btn-mark">▰</span><span id="ecmNextButtonLabel">NEXT EXERCISE</span><span class="ecm-btn-arrow">›</span></button>
      <div class="ecm-motto"><b>♡</b>Every rep. Every set. Every day.</div>
    </div>`;
  seedStarField("ecmStars",18);
  $("nextExerciseBtn")?.addEventListener("click",handleExerciseVictoryNext);
  return dialog;
}
function exerciseVictoryConfetti(){
  const c=$("ecmVictoryConfetti");if(!c)return;
  c.innerHTML="";
  const colors=["#29dfcd","#ff714f","#f2c45f","#58a8ff","#e9f7ff"];
  for(let i=0;i<24;i++){
    const p=document.createElement("i");
    p.style.left=(4+Math.random()*92)+"%";
    p.style.background=colors[i%colors.length];
    p.style.animationDelay=(Math.random()*.38)+"s";
    p.style.setProperty("--drift",(Math.random()*90-45)+"px");
    p.style.setProperty("--spin",(360+Math.random()*540)+"deg");
    c.appendChild(p);
  }
  setTimeout(()=>{if(c)c.innerHTML="";},2500);
}
function exercisePrDetail(ex){
  const name=String(ex?.name||"").trim();if(!name)return null;
  const prior=computePersonalRecords();
  if(ex.timed){
    const best=(ex.sets||[]).reduce((m,s)=>Math.max(m,Number(s.timedSeconds||s.actual||0)),0);
    const prevBest=prior.timed[name]?.seconds||0;
    if(best>0&&best>prevBest)return{value:formatExerciseSeconds(best),detail:`Longest ${name} hold`,copy:`That's your longest ${name} hold yet.`};
  }else{
    const weight=exerciseHeaviestWeight(ex);
    const prevWeight=prior.strength[name]?.weight||0;
    if(weight>0&&weight>prevWeight)return{value:`${fmt(weight)} kg`,detail:`Heaviest ${name}`,copy:`That's your strongest ${name} yet.`};
  }
  return null;
}
function renderExerciseVictoryPr(pr){
  const el=$("ecmPrBadges");if(!el)return;
  el.innerHTML=pr?`<div class="ecm-pr-card"><div class="ecm-pr-ribbon">NEW PR</div><div class="ecm-pr-medal">${exerciseVictoryTrophySVG()}</div><div><div class="ecm-pr-label">NEW PERSONAL RECORD</div><div class="ecm-pr-value">${esc(pr.value)}</div><div class="ecm-pr-detail">${esc(pr.detail)}</div><div class="ecm-pr-copy">${esc(pr.copy)}</div></div></div>`:"";
}
function exerciseVictoryNextMeta(next){
  if(!next)return"";
  const sets=(next.sets||[]).length;
  const weight=resolvedWorkoutWeight(state.activeWorkout,next);
  if(next.timed)return `${sets} timed ${sets===1?"set":"sets"}${weight>0?` · ${fmt(weight)} kg`:""}`;
  return `${sets} ${sets===1?"set":"sets"} × ${Number(next.targetReps||0)} reps${weight>0?` · ${fmt(weight)} kg`:""}`;
}
function renderExerciseVictoryNext(next,isFinal){
  const host=$("ecmNextPreview");if(!host)return;
  if(isFinal||!next){host.innerHTML="";host.className="";return;}
  host.className="ecm-next-panel";
  host.innerHTML=`<div class="ecm-next-icon">${exerciseVictoryBenchSVG()}</div><div><div class="ecm-next-kicker">UP NEXT</div><div class="ecm-next-name">${esc(next.name||"Next exercise")}</div><div class="ecm-next-meta">${esc(exerciseVictoryNextMeta(next))}</div><div class="ecm-next-copy">Let's keep the momentum going.</div></div><div class="ecm-next-chevron">›</div>`;
}
function exerciseVictoryMessage(e,{volume,timedTotal,pr,isFinal}){
  if(isFinal)return `${e.name} complete. That's the final exercise — brilliant work finishing the session.`;
  if(pr)return `${e.name} complete. New territory — that's your strongest performance yet.`;
  if(e.timed)return timedTotal>=60?`${e.name} complete. ${formatExerciseSeconds(timedTotal)} under tension — excellent control and consistency.`:`${e.name} complete. Strong control — keep that quality into the next one.`;
  if(volume>=1000)return `${e.name} complete. ${fmtInt(volume)} kg moved — serious work.`;
  if(volume>=500)return `${e.name} complete. Strong volume, strong effort — keep it moving.`;
  return `${e.name} complete. Another one done — keep building.`;
}
function handleExerciseVictoryNext(){
  clearTimedSetTimers();
  const w=state.activeWorkout;if(!w)return;
  $("exerciseCompleteDialog")?.close();
  if((w.currentExerciseIndex||0)<w.exercises.length-1){w.currentExerciseIndex+=1;saveState();renderLiveExercises();}
  else showWorkoutCelebration();
}
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
  const pr=exercisePrDetail(e); // capture before the completed exercise is persisted into workout history
  e.exerciseComplete=true;e.completedAt=new Date().toISOString();saveState();
  const volume=exerciseVolume(e,w);
  const timedTotal=e.timed?e.sets.reduce((sum,s)=>sum+Number(s.timedSeconds||s.actual||0),0):0;
  const bestTimed=e.timed?Math.max(...e.sets.map(s=>Number(s.timedSeconds||s.actual||0))):0;
  const isFinal=ei>=w.exercises.length-1;
  const next=!isFinal?w.exercises[ei+1]:null;
  const dialog=ensureExerciseVictoryUI();if(!dialog)return;

  const cheer=randomFrom(exerciseCheers);
  $("exerciseCompleteTitle").innerHTML=`${esc(cheer)}, <span class="ecm-name-accent">${esc(state.profile.name)}!</span>`;
  $("exerciseCompleteMessage").textContent=exerciseVictoryMessage(e,{volume,timedTotal,pr,isFinal});

  const actualWeight=exerciseHeaviestWeight(e);
  $("exerciseCompleteStats").innerHTML=e.timed
    ? `<div><span>SETS</span><strong>${e.sets.length} ✓</strong></div><div><span>TOTAL TIME</span><strong><b data-count-target="${timedTotal}" data-count-time="1">0s</b></strong></div><div><span>BEST SET</span><strong><b data-count-target="${bestTimed}" data-count-time="1">0s</b></strong></div>`
    : `<div><span>SETS</span><strong>${e.sets.length} ✓</strong></div><div><span>WEIGHT</span><strong>${actualWeight>0?`<b data-count-target="${actualWeight}" data-count-decimals="1">0.0</b> kg`:`—`}</strong></div><div><span>VOLUME</span><strong>${volume>0?`<b data-count-target="${volume}" data-count-decimals="1">0.0</b> kg`:`—`}</strong></div>`;
  renderExerciseVictoryPr(pr);
  renderExerciseVictoryNext(next,isFinal);
  $("ecmNextButtonLabel").textContent=isFinal?"SEE WORKOUT RESULT":"NEXT EXERCISE";
  animateExerciseCountUps($("exerciseCompleteStats"));

  dialog.classList.remove("variant-standard","variant-timed","variant-final");
  dialog.classList.add(`variant-${isFinal?"final":e.timed?"timed":"standard"}`);
  dialog.showModal();
  requestAnimationFrame(()=>{exerciseVictoryConfetti();});
}
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
  const accents=["pf-amber","pf-green","pf-violet","pf-cyan"];
  $("rbIconGrid").innerHTML=REWARD_ICONS.map((i,idx)=>
    `<button type="button" class="icon-option${i.e===selectedRewardIcon.e?" selected":""}" data-emoji="${i.e}" data-label="${i.l}">
      <span class="emoji-tile ${accents[idx%accents.length]}"><span class="emoji">${i.e}</span></span><span class="label">${esc(i.l)}</span>
    </button>`
  ).join("");
  qsa(".icon-option",$("rbIconGrid")).forEach(btn=>btn.addEventListener("click",()=>{
    selectedRewardIcon={e:btn.dataset.emoji,l:btn.dataset.label};
    $("rbCurrentIconEmoji").innerHTML=`<span>${selectedRewardIcon.e}</span>`;
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
    $("rbCurrentIconEmoji").innerHTML=`<span>${selectedRewardIcon.e}</span>`;
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

/* v1.31.0 CholScore+ real purchases via RevenueCat (wraps StoreKit so we
   don't need our own server-side receipt validation). isPremiumUnlocked()
   remains the one function every feature gate checks — its own internals
   now reflect whichever the last confirmed entitlement check said, kept in
   sync by syncEntitlementFromRevenueCat() below. Every call site that gates
   a feature elsewhere in the app is untouched. */

// Flip to true only for local TestFlight/dev builds where you want the
// manual override buttons back (e.g. to preview the unlocked UI without
// completing a real sandbox purchase each time). Must be false for any
// build heading to App Store review or real users.
const DEBUG_PREMIUM_TOGGLE=true;

const REVENUECAT_API_KEY="appl_IBVqrKBPqMlHAwtIqIIcSsWeTHL";
const REVENUECAT_ENTITLEMENT_ID="cholscore_pro";

function isPremiumUnlocked(){return !!state.premium?.unlocked;}
function showPaywall(){$("paywallDialog").showModal();}

function getPurchasesPlugin(){return window.Capacitor?.Plugins?.Purchases||null;}

let purchasesConfigured=false;
async function initPurchases(){
  if(DEBUG_PREMIUM_TOGGLE){
    $("premiumDebugSection").classList.remove("hidden");
  }
  if(!window.Capacitor?.isNativePlatform())return; // web/PWA preview — no StoreKit here, nothing to configure
  const Purchases=getPurchasesPlugin();
  if(!Purchases)return; // plugin not linked in this build yet
  if(purchasesConfigured){
    // init() legitimately runs twice in real usage — once at normal
    // startup, and again right after onboarding completes to refresh the
    // whole app. Purchases.configure() must only ever run once per session;
    // calling it twice was silently breaking purchasePackage() with no
    // useful error, since the SDK doesn't expect a second configure call
    // mid-session. Just re-sync entitlement state instead on the repeat call.
    await syncEntitlementFromRevenueCat();
    return;
  }
  try{
    await Purchases.configure({apiKey:REVENUECAT_API_KEY});
    purchasesConfigured=true;
    await syncEntitlementFromRevenueCat();
  }catch(err){
    console.error("RevenueCat configure failed:",err);
  }
}

function applyEntitlementFromCustomerInfo(customerInfo){
  const unlocked=!!customerInfo?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_ID];
  state.premium={unlocked};
  saveState();
  renderPremiumTestingUI();
  renderAll();
  return unlocked;
}

async function syncEntitlementFromRevenueCat(){
  const Purchases=getPurchasesPlugin();
  if(!Purchases)return;
  try{
    const result=await Purchases.getCustomerInfo();
    applyEntitlementFromCustomerInfo(result?.customerInfo);
  }catch(err){
    console.error("Failed to fetch RevenueCat customer info:",err);
  }
}

qsa(".paywall-plan").forEach(btn=>btn.addEventListener("click",()=>{
  qsa(".paywall-plan").forEach(b=>b.classList.remove("selected"));
  btn.classList.add("selected");
  $("paywallUnlockBtn").textContent=`Start with ${btn.dataset.plan==="annual"?"Annual":"Monthly"}`;
}));

$("paywallUnlockBtn").addEventListener("click",async()=>{
  const selectedPlanBtn=$("paywallDialog").querySelector(".paywall-plan.selected")||$("paywallDialog").querySelector('.paywall-plan[data-plan="annual"]');
  const wantsMonthly=selectedPlanBtn?.dataset.plan==="monthly";
  const Purchases=getPurchasesPlugin();

  if(!Purchases||!window.Capacitor?.isNativePlatform()){
    // Not running on a device with the purchase plugin available (e.g.
    // previewing the web build). Nothing to actually buy here — let the
    // person know rather than silently unlocking or doing nothing.
    alert("Purchases aren't available in this preview. Try this on a TestFlight or App Store build.");
    return;
  }

  const btn=$("paywallUnlockBtn");
  const originalLabel=btn.textContent;
  btn.disabled=true;
  btn.textContent="Processing…";

  try{
    const offerings=await Purchases.getOfferings();
    const offering=offerings?.current||offerings?.all?.["Default"];
    const pkg=offering?.availablePackages?.find(p=>
      wantsMonthly?p.packageType==="MONTHLY":p.packageType==="ANNUAL"
    );
    if(!pkg)throw new Error("Selected plan isn't available right now.");

    const result=await Purchases.purchasePackage({aPackage:pkg});
    const unlocked=applyEntitlementFromCustomerInfo(result?.customerInfo);
    if(unlocked)$("paywallDialog").close();
  }catch(err){
    // RevenueCat flags the standard "tapped X on Apple's own sheet" case
    // with userCancelled — that's not a failure, just skip the alert.
    if(!err?.userCancelled){
      console.error("Purchase failed RAW:", err);
      console.error("Purchase failed JSON:", JSON.stringify(err, Object.getOwnPropertyNames(err)));
      alert("Something went wrong completing that purchase. Please try again.");
    }
  }finally{
    btn.disabled=false;
    btn.textContent=originalLabel;
  }
});

$("paywallDismissBtn").addEventListener("click",()=>$("paywallDialog").close());

$("restorePurchasesBtn").addEventListener("click",async()=>{
  const Purchases=getPurchasesPlugin();
  if(!Purchases||!window.Capacitor?.isNativePlatform()){
    alert("Restore isn't available in this preview. Try this on a TestFlight or App Store build.");
    return;
  }
  const btn=$("restorePurchasesBtn");
  const originalLabel=btn.textContent;
  btn.disabled=true;
  btn.textContent="Restoring…";
  try{
    const result=await Purchases.restorePurchases();
    const unlocked=applyEntitlementFromCustomerInfo(result?.customerInfo);
    alert(unlocked?"CholScore+ restored successfully.":"No active CholScore+ purchase was found for this Apple ID.");
  }catch(err){
    console.error("Restore failed:",err);
    alert("Couldn't restore purchases right now. Please try again.");
  }finally{
    btn.disabled=false;
    btn.textContent=originalLabel;
  }
});

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

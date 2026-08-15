
const STORAGE_KEY = "cholscore_v02";
const LEGACY_KEY = "cholscore_v01";
const todayKey = () => new Date().toISOString().slice(0,10);

const defaultState = {
  profile: null,
  days: {},
  routines: [],
  activeWorkout: null,
  achievements: { firstFood:false, firstMove:false, onTarget:false, score80:false }
};

let state = loadState();
let selectedTarget = 30;
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
    achievements:{...d.achievements,...(s?.achievements||{})}
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

function fmt(n){return Number(n||0).toFixed(1);}
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
function scoreLabel(s){return s>=90?"Outstanding":s>=80?"Flying":s>=70?"Great day":s>=55?"Building momentum":s>=35?"Good start":"Getting started";}

function init(){
  if(!state.profile){
    $("onboarding").classList.remove("hidden");$("mainApp").classList.add("hidden");
  }else{
    $("onboarding").classList.add("hidden");$("mainApp").classList.remove("hidden");
    ensureDay(); renderAll();
    if(state.activeWorkout) showActiveWorkoutBanner();
  }
}

function mondayKeyFor(dateLike=new Date()){
  const d=new Date(dateLike);
  d.setHours(0,0,0,0);
  const day=(d.getDay()+6)%7;
  d.setDate(d.getDate()-day);
  return d.toISOString().slice(0,10);
}

function weeklyBankPoints(){
  const monday=mondayKeyFor(new Date());
  let total=0;
  for(const [key,day] of Object.entries(state.days)){
    if(key < monday) continue;
    if(!day.checkedOut) continue;
    const t=totals(day);
    const target=Number(state.profile?.target||30);
    if(!day.foods.length || t.sat>=target) continue;

    // Reward consistency, but cap each day so "eating as little as possible"
    // never becomes the game.
    const remaining=Math.max(0,target-t.sat);
    const daily=Math.min(5,Math.round((remaining/target)*10));
    total += daily;
  }
  return total;
}

function bankResetLabel(){
  const now=new Date();
  const next=new Date(now);
  const days=(8-now.getDay())%7 || 7;
  next.setDate(now.getDate()+days);
  next.setHours(0,0,0,0);
  const diff=Math.max(1,Math.ceil((next-now)/86400000));
  return diff===1?"Resets tomorrow morning":`Resets Monday · ${diff} days`;
}

function renderAll(){renderToday();renderFood();renderExercise();renderRewards();renderCalendar();}

function renderToday(){
  const day=getDay(),t=totals(day),score=scoreDay(day),target=Number(state.profile.target);
  $("greeting").textContent=`${greeting()}, ${state.profile.name}`;
  $("heroMessage").textContent=score>=80?"You're absolutely flying today.":score>=55?"Nice work — keep the momentum going.":"Every positive choice moves you forward.";
  $("satUsed").textContent=`${fmt(t.sat)}g`;$("satRemaining").textContent=`${fmt(Math.max(0,target-t.sat))}g`;
  $("moveMinutes").textContent=Math.round(t.mins);$("activityCount").textContent=t.activities;
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
    :`<div class="log-item"><div><strong>${x.type==="run"?"🏃":x.type==="walk"?"🚶":x.type==="workout"?"🏋️":"⚡"} ${esc(x.name)}</strong><small>${x.minutes} min${x.distance?` · ${distanceText(x.distance)}`:""}${x.type==="workout"&&x.exerciseCount?` · ${x.exerciseCount} exercises`:""}</small></div><div class="log-value">${feelEmoji(x.feel)}</div></div>`
  ).join(""):"Nothing logged yet. Your first win starts here.";
  wireFoodCards();
  if($("bankPoints")) $("bankPoints").textContent=weeklyBankPoints();
  if($("bankResetText")) $("bankResetText").textContent=bankResetLabel();
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

function renderFood(){
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

function renderExercise(){
  const day=getDay(),t=totals(day);
  $("exerciseMinutes").textContent=Math.round(t.mins);$("exerciseBar").style.width=`${Math.min(100,t.mins/45*100)}%`;
  if($("distanceUnitLabel")) $("distanceUnitLabel").textContent=distanceUnit();
  renderProteinToday(day);
  renderRoutines();
  showActiveWorkoutBanner();
  $("exerciseList").innerHTML=day.activities.length?day.activities.slice().reverse().map(x=>`<div class="log-item"><div><strong>${x.type==="run"?"🏃":x.type==="walk"?"🚶":x.type==="workout"?"🏋️":"⚡"} ${esc(x.name)}</strong><small>${x.type==="workout"?`${x.exerciseCount||0} exercises · `:""}${x.minutes} min${x.distance?` · ${distanceText(x.distance)}`:""}</small></div><div class="log-value">${feelEmoji(x.feel)}</div></div>`).join(""):`<div class="empty-state">No completed activity today.</div>`;
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

const achievementDefs = [
  // Food
  {id:"food_first",cat:"food",icon:"🍎",title:"First Bite",desc:"Log your first food.",rarity:"COMMON",goal:1,metric:"foodEntries"},
  {id:"food_10",cat:"food",icon:"🥗",title:"Food Explorer",desc:"Log 10 food entries.",rarity:"COMMON",goal:10,metric:"foodEntries"},
  {id:"food_50",cat:"food",icon:"🛒",title:"Label Legend",desc:"Log 50 food entries.",rarity:"RARE",goal:50,metric:"foodEntries"},
  {id:"food_scan_10",cat:"food",icon:"📷",title:"Scanner Pro",desc:"Add 10 foods by barcode.",rarity:"RARE",goal:10,metric:"scannedFoods"},
  {id:"food_ontarget_5",cat:"food",icon:"🎯",title:"On Target",desc:"Check out within target on 5 days.",rarity:"RARE",goal:5,metric:"onTargetDays"},

  // Workout
  {id:"workout_first",cat:"workout",icon:"💪",title:"First Rep",desc:"Complete your first workout.",rarity:"COMMON",goal:1,metric:"workouts"},
  {id:"workout_5",cat:"workout",icon:"🏋️",title:"Getting Strong",desc:"Complete 5 workouts.",rarity:"COMMON",goal:5,metric:"workouts"},
  {id:"workout_25",cat:"workout",icon:"⚙️",title:"Routine Machine",desc:"Complete 25 workouts.",rarity:"RARE",goal:25,metric:"workouts"},
  {id:"workout_100",cat:"workout",icon:"🦾",title:"Iron Habit",desc:"Complete 100 workouts.",rarity:"EPIC",goal:100,metric:"workouts"},
  {id:"sets_100",cat:"workout",icon:"🔢",title:"Century Sets",desc:"Log 100 completed workout sets.",rarity:"RARE",goal:100,metric:"completedSets"},
  {id:"sets_500",cat:"workout",icon:"🏆",title:"Set Collector",desc:"Log 500 completed workout sets.",rarity:"EPIC",goal:500,metric:"completedSets"},

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
  {id:"streak_3",cat:"consistency",icon:"🔥",title:"Three In A Row",desc:"Check out 3 days in a row.",rarity:"COMMON",goal:3,metric:"bestStreak"},
  {id:"streak_7",cat:"consistency",icon:"🔥",title:"Full Week",desc:"Reach a 7-day checkout streak.",rarity:"RARE",goal:7,metric:"bestStreak"},
  {id:"streak_14",cat:"consistency",icon:"🌟",title:"Fortnight Flow",desc:"Reach a 14-day checkout streak.",rarity:"EPIC",goal:14,metric:"bestStreak"},
  {id:"streak_30",cat:"consistency",icon:"👑",title:"Thirty Days",desc:"Reach a 30-day checkout streak.",rarity:"LEGEND",goal:30,metric:"bestStreak"},
  {id:"checkout_25",cat:"consistency",icon:"🌙",title:"Day Closer",desc:"Check out 25 days.",rarity:"RARE",goal:25,metric:"checkouts"},
  {id:"checkout_100",cat:"consistency",icon:"📘",title:"Hundred Days Logged",desc:"Check out 100 days.",rarity:"LEGEND",goal:100,metric:"checkouts"},

  // Scores
  {id:"score_70",cat:"score",icon:"⭐",title:"Seventy Club",desc:"Finish a day with CholScore 70+.",rarity:"COMMON",goal:1,metric:"score70Days"},
  {id:"score_80",cat:"score",icon:"🚀",title:"Flying",desc:"Finish a day with CholScore 80+.",rarity:"RARE",goal:1,metric:"score80Days"},
  {id:"score_90",cat:"score",icon:"💎",title:"Elite Day",desc:"Finish a day with CholScore 90+.",rarity:"EPIC",goal:1,metric:"score90Days"},
  {id:"score_90x5",cat:"score",icon:"🏆",title:"High Five",desc:"Finish 5 days with CholScore 90+.",rarity:"LEGEND",goal:5,metric:"score90Days"},
  {id:"points_500",cat:"score",icon:"✨",title:"500 Club",desc:"Bank 500 total CholPoints.",rarity:"RARE",goal:500,metric:"totalPoints"},
  {id:"points_2500",cat:"score",icon:"🌌",title:"Point Collector",desc:"Bank 2,500 total CholPoints.",rarity:"LEGEND",goal:2500,metric:"totalPoints"},
];

const rewardCategories = [
  ["all","All"],["food","Food"],["workout","Workout"],["walking","Walking"],
  ["running","Running"],["weekly","This Week"],["consistency","Consistency"],["score","CholScore"]
];

function achievementMetrics(){
  let foodEntries=0,scannedFoods=0,onTargetDays=0,workouts=0,completedSets=0,walks=0,runs=0;
  let walkMiles=0,runMiles=0,checkouts=0,score70Days=0,score80Days=0,score90Days=0,totalPoints=0;
  const checkedDates=[];

  const monday=mondayKeyFor(new Date());
  let weekWalkMiles=0,weekRunMiles=0;

  for(const [key,day] of Object.entries(state.days)){
    foodEntries += (day.foods||[]).length;
    scannedFoods += (day.foods||[]).filter(f=>f.source==="Open Food Facts").length;

    for(const a of (day.activities||[])){
      if(a.type==="workout"){
        workouts++;
        completedSets += Number(a.completedSets||0);
      }else if(a.type==="walk"){
        walks++;
        const dist=achievementDistanceValue(Number(a.distance||0));
        walkMiles += dist;
        if(key>=monday) weekWalkMiles += dist;
      }else if(a.type==="run"){
        runs++;
        const dist=achievementDistanceValue(Number(a.distance||0));
        runMiles += dist;
        if(key>=monday) weekRunMiles += dist;
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
      current=diff===1?current+1:1;
    }else current=1;
    bestStreak=Math.max(bestStreak,current);
    prev=d;
  }

  return {
    foodEntries,scannedFoods,onTargetDays,workouts,completedSets,walks,runs,
    walkMiles,runMiles,weekWalkMiles,weekRunMiles,weekMoveMiles:weekWalkMiles+weekRunMiles,
    checkouts,bestStreak,score70Days,score80Days,score90Days,totalPoints
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

  const days=Object.entries(state.days).filter(([_,d])=>d.checkedOut);
  const totalPoints=metrics.totalPoints;
  const best=days.length?Math.max(...days.map(([_,d])=>Number(d.finalScore??scoreDay(d)))):scoreDay();
  $("pointsStat").textContent=Math.round(totalPoints);
  $("bestStat").textContent=Math.round(best);
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
    const displayVal=a.metric.toLowerCase().includes("miles")?value.toFixed(1):Math.floor(value);
    const goalVal=a.goal;
    const shown=achievementDisplay(a);
    return `<div class="achievement-card ${done?"unlocked":"locked"}">
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
function calculateStreak(){
  let count=0,d=new Date();
  for(let i=0;i<365;i++){const key=d.toISOString().slice(0,10),day=state.days[key];if(day?.checkedOut)count++;else if(i>0)break;d.setDate(d.getDate()-1);}
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
  $("historyDetail").innerHTML=`<h3>${nice}</h3><div class="history-grid"><div><span>Sat fat</span><strong>${fmt(t.sat)}g</strong></div><div><span>Movement</span><strong>${Math.round(t.mins)} min</strong></div><div><span>CholScore</span><strong>${sc}</strong></div></div><p style="color:#9299aa;font-size:12px;margin-bottom:0">${day.foods.length} food entries · ${day.activities.length} activities${day.checkedOut?" · checked out":""}</p>`;
}

/* v1.4.0 full-screen Day Report — a "sports report" style recap of one
   whole day, built from the exact same data functions used everywhere
   else (totals/scoreDay/exerciseVolume/formatActivityDuration/formatPace),
   so it's guaranteed to agree with the rest of the app. */
function repTrainingSectionHTML(workouts){
  if(!workouts.length)return `<div class="rep-section reveal"><div class="rep-section-head"><div class="rep-section-bar"></div><h2>Strength Session</h2></div><p class="rep-empty">No training logged this day.</p></div>`;
  return workouts.map(w=>{
    const rows=(w.exercises||[]).map((ex,i)=>{
      let meta,value,unit;
      if(ex.timed){
        const totalSec=(ex.sets||[]).reduce((sum,s)=>sum+Number(s.timedSeconds||s.actual||0),0);
        meta=`${ex.sets.length} timed ${ex.sets.length===1?"set":"sets"}`;
        value=formatExerciseSeconds(totalSec);unit="held";
      }else{
        const vol=exerciseVolume(ex);
        meta=`${(ex.sets||[]).length} sets${ex.targetReps?` × ${ex.targetReps} reps`:""}`;
        value=Number(vol)>0?fmt(vol):"—";unit="kg volume";
      }
      return `<div class="rep-exercise-row"><div class="rep-exercise-num">${i+1}</div><div><div class="rep-exercise-name">${esc(ex.name)}</div><div class="rep-exercise-meta">${esc(meta)}</div></div><div class="rep-exercise-value">${value}<small>${unit}</small></div></div>`;
    }).join("");
    return `<div class="rep-section reveal"><div class="rep-section-head"><div class="rep-section-bar"></div><h2>Strength Session · ${esc(w.name||"Workout")}</h2></div>${rows}</div>`;
  }).join("");
}
function repCardioSectionHTML(cardio){
  if(!cardio.length)return `<div class="rep-section reveal"><div class="rep-section-head"><div class="rep-section-bar"></div><h2>Cardio</h2></div><p class="rep-empty">No cardio logged this day.</p></div>`;
  const unit=distanceUnit();
  const rows=cardio.map(a=>{
    const icon=a.type==="run"?"🏃":a.type==="walk"?"🚶":"⚡";
    const displayDist=a.distance>0?Number(kmToDisplay(a.distance).toFixed(1)):0;
    const pace=displayDist>0?formatPace(a.minutes,displayDist):null;
    const label=a.name||(a.type==="run"?"Run":a.type==="walk"?"Walk":"Activity");
    return `<div class="rep-cardio-row">
      <div class="rep-cardio-icon">${icon}</div>
      <div class="rep-cardio-name">${esc(label)}</div>
      <div class="rep-cardio-col"><strong>${formatActivityDuration(a.minutes)}</strong><small>duration</small></div>
      <div class="rep-cardio-col"><strong>${displayDist>0?`${displayDist} ${unit}`:"—"}</strong><small>distance</small></div>
      <div class="rep-cardio-col"><strong>${pace||"—"}</strong><small>min/${unit}</small></div>
    </div>`;
  }).join("");
  return `<div class="rep-section reveal"><div class="rep-section-head"><div class="rep-section-bar"></div><h2>Cardio</h2></div><div class="rep-cardio-head"><span></span><span>Activity</span><span>Time</span><span>Dist</span><span>Pace</span></div>${rows}</div>`;
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
function showDayReport(key){
  const day=getDay(key),t=totals(day),target=Number(state.profile?.target||30);
  const score=day.finalScore??scoreDay(day);
  const dateObj=new Date(key+"T12:00:00");
  const weekday=dateObj.toLocaleDateString(undefined,{weekday:"long"});
  const niceDate=dateObj.toLocaleDateString(undefined,{day:"numeric",month:"long",year:"numeric"});
  const workouts=(day.activities||[]).filter(a=>a.type==="workout");
  const cardio=(day.activities||[]).filter(a=>a.type!=="workout");

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
          <div><span>Movement</span><strong>${Math.round(t.mins)} min</strong></div>
          <div><span>Checked out</span><strong>${day.checkedOut?"Yes":"No"}</strong></div>
        </div>
      </div>
    </div>

    <div class="rep-section reveal">
      <div class="rep-section-head"><div class="rep-section-bar"></div><h2>Today's Rings</h2></div>
      <div class="rep-rings">
        <div class="rep-ring-card"><div class="rep-ring-wrap"><svg viewBox="0 0 78 78"><circle class="rep-ring-track" cx="39" cy="39" r="32"/><circle class="rep-ring-fill" id="repRingFat" cx="39" cy="39" r="32" stroke="var(--rep-accent)" stroke-dasharray="201.06" stroke-dashoffset="201.06"/></svg><div class="rep-ring-num">${fmt(t.sat)}g</div></div><div class="rep-ring-label">Sat fat</div></div>
        <div class="rep-ring-card"><div class="rep-ring-wrap"><svg viewBox="0 0 78 78"><circle class="rep-ring-track" cx="39" cy="39" r="32"/><circle class="rep-ring-fill" id="repRingMins" cx="39" cy="39" r="32" stroke="var(--cyan)" stroke-dasharray="201.06" stroke-dashoffset="201.06"/></svg><div class="rep-ring-num">${Math.round(t.mins)}</div></div><div class="rep-ring-label">Minutes</div></div>
        <div class="rep-ring-card"><div class="rep-ring-wrap"><svg viewBox="0 0 78 78"><circle class="rep-ring-track" cx="39" cy="39" r="32"/><circle class="rep-ring-fill" id="repRingScore" cx="39" cy="39" r="32" stroke="var(--violet)" stroke-dasharray="201.06" stroke-dashoffset="201.06"/></svg><div class="rep-ring-num">${score}</div></div><div class="rep-ring-label">Score</div></div>
      </div>
    </div>

    ${repTrainingSectionHTML(workouts)}
    ${repCardioSectionHTML(cardio)}
    ${repNutritionSectionHTML(day,target)}

    <div class="rep-footer reveal"><div class="rep-footer-mark">— End of report —</div></div>
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

$("finishSetup").addEventListener("click",()=>{
  const name=$("nameInput").value.trim(),target=selectedTarget==="custom"?Number($("customTarget").value):Number(selectedTarget);
  if(!name||!target||target<=0)return alert("Please enter your name and choose a valid target.");
  state.profile={name,target,distanceUnit:selectedDistanceUnit};saveState();init();
});

/* Navigation */
qsa(".nav-btn").forEach(btn=>btn.addEventListener("click",()=>{
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
    $("scannerStatus").textContent="Ready — point the camera at a food barcode.";
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
    $("checkMessage").textContent="That doesn't make it a 'bad' food — CholScore is just showing the impact so you can decide what works for you.";
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
function addRoutineExerciseRow(data={name:"",sets:3,reps:10,weight:"",notes:"",id:"",timed:false}){
  const row=document.createElement("div");row.className="routine-exercise-row";
  if(data.id) row.dataset.exerciseId=data.id;
  const isTimed=Boolean(data.timed);
  row.innerHTML=`
    <div class="rb-main-fields">
      <label>Exercise<input class="rb-name" required placeholder="e.g. Bench press or Plank" value="${esc(data.name)}"></label>
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
    <button type="button" class="row-remove" aria-label="Remove exercise">×</button>`;
  const timed=row.querySelector(".rb-timed"),reps=row.querySelector(".rb-reps"),repsLabel=row.querySelector(".rb-reps-label");
  const syncTimed=()=>{
    reps.disabled=timed.checked;
    repsLabel.classList.toggle("timed-disabled",timed.checked);
  };
  timed.addEventListener("change",syncTimed);syncTimed();
  row.querySelector(".row-remove").addEventListener("click",()=>row.remove());
  $("routineExerciseRows").appendChild(row);
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
  const exercises=qsa(".routine-exercise-row").map(row=>{
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
  "Great job — keep it moving"
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
  const rawWeight=w?resolvedWorkoutWeight(w,e):Number(e?.weight||0);
  const weight=Number.isFinite(rawWeight)?rawWeight:0;
  if(weight<=0)return 0;
  return (e?.sets||[]).reduce((sum,set)=>{
    const rawReps=Number(set?.actual||0);
    const reps=Number.isFinite(rawReps)?rawReps:0;
    const setDone=Boolean(set?.completed)||String(set?.actual??"").trim()!=="";
    return sum+(setDone&&reps>0?reps*weight:0);
  },0);
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
function renderLiveExercises(){
  const w=state.activeWorkout;if(!w)return;ensureWorkoutShape(w);
  const ei=w.currentExerciseIndex||0,e=w.exercises[ei];
  if(!e){showWorkoutCelebration();return;}
  clearTimedSetTimers();
  const done=e.sets.filter(s=>s.completed).length;
  $("workoutProgress").innerHTML=`<div><span>EXERCISE ${ei+1} OF ${w.exercises.length}</span><strong>${done}/${e.sets.length} sets complete</strong></div><div class="guided-progress-bar"><i style="width:${(done/e.sets.length)*100}%"></i></div>`;
  const descriptor=e.timed?`Timed exercise · ${e.sets.length} ${e.sets.length===1?"set":"sets"}`:`${e.targetReps} target reps per set${Number(e.weight)>0?` · <b>${fmt(e.weight)} kg</b>`:""}`;
  const setMarkup=e.timed
    ? e.sets.map((set,si)=>`
        <div class="guided-set-row timed-set-row ${set.completed?"is-complete":""}" data-timed-row="${si}">
          <span>SET ${si+1}</span>
          <div class="timed-set-controls">
            <strong class="timed-set-display" data-timed-display="${si}">${set.completed?formatExerciseSeconds(set.timedSeconds||set.actual):"Ready"}</strong>
            <button type="button" class="timed-set-btn ${set.timerStartedAt?"is-running":""}" data-timed-set="${si}" ${set.completed?"disabled":""}>${set.timerStartedAt?"Stop":"⏱ Start"}</button>
            <b class="set-tick" aria-label="${set.completed?"Complete":"Not complete"}">${set.completed?"✓":""}</b>
          </div>
        </div>`).join("")
    : e.sets.map((set,si)=>`
        <label class="guided-set-row ${set.completed?"is-complete":""}">
          <span>SET ${si+1}</span>
          <div class="guided-rep-entry">
            <input inputmode="numeric" type="number" min="0" max="999" placeholder="${e.targetReps}" value="${esc(set.actual)}" data-workout-set="${si}" aria-label="Set ${si+1} reps">
            <b class="set-tick" aria-label="${set.completed?"Complete":"Not complete"}">${set.completed?"✓":""}</b>
          </div>
        </label>`).join("");

  $("liveExerciseList").innerHTML=`
    <div class="guided-exercise-card">
      <div class="guided-exercise-heading">
        <span class="guided-count">${String(ei+1).padStart(2,"0")}</span>
        <div><p class="eyebrow">CURRENT EXERCISE</p><h3>${esc(e.name)}</h3><p>${descriptor}${e.random?` · <b class="random-tag">added today</b>`:""}</p></div>
      </div>
      ${e.notes?`<div class="exercise-note"><span>NOTE</span>${esc(e.notes)}</div>`:""}
      <div class="guided-set-list">${setMarkup}</div>
      <p class="enter-hint">${e.timed?"Tap Start for a 3–2–1 countdown. The stopwatch runs until you press Stop.":"Enter your reps, then press Enter / Done to tick off each set."}</p>
      <button id="completeCurrentExerciseBtn" class="complete-exercise-btn" ${allSetsComplete(e)?"":"disabled"}>Complete exercise</button>
    </div>`;

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
        set.actual=inp.value;set.completed=true;saveState();renderLiveExercises();
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
  set.timedSeconds=seconds;set.actual=String(seconds);set.timerStartedAt=null;set.completed=true;saveState();
  renderLiveExercises();
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

  $("exerciseCompleteTitle").textContent=`${randomFrom(exerciseCheers)}, ${state.profile.name}!`;
  $("exerciseCompleteMessage").textContent=e.timed
    ? `${e.name} complete — ${formatExerciseSeconds(timedTotal)} held across ${e.sets.length} ${e.sets.length===1?"set":"sets"}. ${isFinal?"That was the final exercise — workout complete!":"Take that momentum into the next one."}`
    : `${e.name} complete. ${isFinal?"That was the final exercise — workout complete!":"Take that momentum into the next one."}`;
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
$("addRandomExerciseBtn").addEventListener("click",()=>{$("randomExerciseName").value="";$("randomExerciseSets").value=3;$("randomExerciseReps").value=10;$("randomExerciseWeight").value="";$("randomExerciseNotes").value="";$("randomExerciseDialog").showModal();});
$("randomExerciseForm").addEventListener("submit",e=>{
  e.preventDefault();if(!state.activeWorkout)return;
  const name=$("randomExerciseName").value.trim(),sets=Number($("randomExerciseSets").value),reps=Number($("randomExerciseReps").value),weight=Number($("randomExerciseWeight").value||0),notes=$("randomExerciseNotes").value.trim();
  if(!name||sets<1||reps<1)return;
  state.activeWorkout.exercises.push({id:id(),name,targetReps:reps,weight,notes,timed:false,random:true,exerciseComplete:false,sets:Array.from({length:sets},()=>({actual:"",timedSeconds:0,timerStartedAt:null,completed:false}))});
  saveState();$("randomExerciseDialog").close();renderLiveExercises();
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
  $("activityName").value=btn.dataset.type==="walk"?"Walk":btn.dataset.type==="run"?"Run":"";
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
function showActivityCompleteCard(type,minutes,distanceKm,feel){
  const isWalk=type==="walk",unit=distanceUnit();
  const displayDistance=distanceKm>0?Number(kmToDisplay(distanceKm).toFixed(1)):0;
  const pace=formatPace(minutes,displayDistance);
  $("acmTypeBadge").textContent=isWalk?"🚶":"🏃";
  $("acmEyebrow").textContent=isWalk?"WALK COMPLETE":"RUN COMPLETE";
  $("acmTitle").textContent=`Great work, ${state.profile.name}!`;
  const verb=isWalk?"walked":"ran";
  $("acmMessage").innerHTML=displayDistance>0
    ? `You ${verb} <strong>${displayDistance} ${unit}</strong> in <strong>${formatActivityDuration(minutes)}</strong>${pace?` — averaging a <strong>${pace}/${unit}</strong> pace`:""}. Feeling ${activityFeelWord[feel]||"steady"} ${feelEmoji(feel)}`
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

$("exerciseForm").addEventListener("submit",e=>{
  e.preventDefault();
  const name=$("activityName").value.trim(),start=$("startTime").value,finish=$("finishTime").value,type=$("activityType").value;
  if(!name||!start||!finish)return;
  const minutes=minutesBetween(start,finish),distance=displayToKm(Number($("distance").value||0)),feel=selectedFeeling;
  ensureDay().activities.push({id:id(),name,start,finish,type,minutes,distance,feel,created:Date.now()});
  state.achievements.firstMove=true;saveState();$("exerciseDialog").close();e.target.reset();selectedFeeling=3;
  qsa("#quickFeelingRow button").forEach(x=>x.classList.toggle("selected",x.dataset.feel==="3"));renderAll();
  if(type==="walk"||type==="run") setTimeout(()=>showActivityCompleteCard(type,minutes,distance,feel),70);
  else setTimeout(()=>alert(`Great work, ${state.profile.name}! ${minutes} minutes completed. ${feelEmoji(feel)}`),70);
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
  const moveClause=mins>0?` and exercised for <strong>${Math.round(mins)} minute${Math.round(mins)===1?"":"s"}</strong>`:"";
  $("checkoutText").innerHTML=`${satClause}${moveClause}, earning you a super score of <strong>${score}</strong>.`;

  const satPct=Math.min(1,sat/target),minsPct=Math.min(1,mins/45),scorePct=Math.min(1,score/100);
  $("checkoutRingSatNum").innerHTML=`${fmt(sat)}<small>g</small>`;
  $("checkoutRingMinsNum").innerHTML=`${Math.round(mins)}<small>min</small>`;
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
$("shareCheckout").addEventListener("click",async()=>{
  const day=getDay(),score=scoreDay(day),{sat,mins}=totals(day);
  const text=`My CholScore today: ${score}/100 — ${fmt(sat)}g saturated fat, ${Math.round(mins)} minutes of activity. 💪`;
  const btn=$("shareCheckout"),original=btn.textContent;
  try{
    if(navigator.share){await navigator.share({text});}
    else if(navigator.clipboard){await navigator.clipboard.writeText(text);btn.textContent="Copied to clipboard ✨";setTimeout(()=>{btn.textContent=original;},1600);}
  }catch(err){/* user dismissed the native share sheet — nothing to do */}
});

/* History/profile */
$("prevMonth").addEventListener("click",()=>{calendarDate.setMonth(calendarDate.getMonth()-1);renderCalendar();});
$("nextMonth").addEventListener("click",()=>{calendarDate.setMonth(calendarDate.getMonth()+1);renderCalendar();});
$("profileBtn").addEventListener("click",()=>{$("settingsName").value=state.profile.name;$("settingsTarget").value=state.profile.target;$("settingsUnits").value=distanceUnit();renderBackupStatus();$("settingsDialog").showModal();});
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
    if(!meta?.lastBackupAt)return "You haven't backed up yet — export one to keep your data safe.";
    const days=Math.floor((Date.now()-new Date(meta.lastBackupAt).getTime())/86400000);
    if(days<=0)return "Last backup: today. You're all set.";
    if(days===1)return "Last backup: yesterday.";
    if(days<14)return `Last backup: ${days} days ago.`;
    return `Last backup: ${days} days ago — probably worth doing another.`;
  }catch(err){return "You haven't backed up yet — export one to keep your data safe.";}
}
function renderBackupStatus(){const el=$("backupStatus");if(el)el.textContent=backupStatusText();}
function markBackedUpNow(){localStorage.setItem(BACKUP_META_KEY,JSON.stringify({lastBackupAt:new Date().toISOString()}));renderBackupStatus();}

$("exportBackupBtn").addEventListener("click",async()=>{
  const payload={app:"CholScore",exportedAt:new Date().toISOString(),version:STORAGE_KEY,data:state};
  const filename=`cholscore-backup-${new Date().toISOString().slice(0,10)}.json`;
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
      await navigator.share({files:[file],title:"CholScore backup",text:"CholScore data backup — save this somewhere off this device."});
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
  alert("Saved to this device's Downloads/Files. For a real backup, please also move or share this file somewhere off the phone — email it to yourself, or save it to a cloud drive.");
});

$("importBackupBtn").addEventListener("click",()=>$("importBackupFile").click());
$("importBackupFile").addEventListener("change",e=>{
  const file=e.target.files[0];
  if(!file)return;
  const reader=new FileReader();
  reader.onload=()=>{
    let parsed;
    try{parsed=JSON.parse(reader.result);}
    catch(err){alert("That file doesn't look like a valid CholScore backup — it couldn't be read as JSON.");e.target.value="";return;}
    const incoming=(parsed&&parsed.app==="CholScore"&&parsed.data)?parsed.data:parsed;
    if(!incoming||typeof incoming!=="object"||!("days"in incoming||"profile"in incoming)){
      alert("That file doesn't look like a valid CholScore backup.");e.target.value="";return;
    }
    const when=parsed?.exportedAt?new Date(parsed.exportedAt).toLocaleString():"an unknown date";
    if(!confirm(`Restore this backup from ${when}?\n\nThis replaces everything currently on this device — routines, food and exercise history, achievements, all of it — and can't be undone.`)){
      e.target.value="";return;
    }
    state=normaliseState(incoming);
    saveState();
    markBackedUpNow();
    location.reload();
  };
  reader.onerror=()=>alert("Couldn't read that file — please try again.");
  reader.readAsText(file);
  e.target.value="";
});

init();

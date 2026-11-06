/* Protein Planner — DRAFT. Offline, no login, no ads. Local storage only. */
const DRAFT = true; // set false after Dr D signs off CONTENT_REVIEW.md
const STORE_KEY = "protein-planner-v3";

const CHEERS = ["Nice add.", "Protein climbing.", "Solid pick.", "Keep going."];
const MEAL_DONE = ["Meal done — nice.", "That meal's covered.", "Meal complete."];
const DAY_DONE = ["You finished today's plan!", "Day's protein — done.", "Plan complete. Nice work."];

const SVG_NS = "http://www.w3.org/2000/svg";
const el = (tag, attrs = {}, ...kids) => {
  const svgTags = new Set(["svg", "circle", "path", "g", "rect", "text"]);
  const n = svgTags.has(tag) ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k === "class") n.setAttribute("class", v);
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "dataset") Object.assign(n.dataset, v);
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
};

const state = {
  screen: "profile", // profile | setup | play
  tab: "add", // add | plate | more
  profileId: null,
  weightKg: null,
  weightUnit: "lb",
  weightInput: "",
  targetMode: "suggested",
  customTarget: null,
  gPerKg: null,
  foodSet: "us",
  mealSlots: 3, // total eating times 2–6 (meals + snacks)
  activeMeal: 0,
  plan: [], // {id, servings, meal}
  filter: "for-you",
  query: "",
  flash: "",
  showCustom: false,
  showSrc: null,
  sheet: null, // null | "share" | "shop"
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    Object.assign(state, {
      profileId: s.profileId || null,
      weightKg: s.weightKg ?? null,
      weightUnit: s.weightUnit || "lb",
      weightInput: s.weightInput || "",
      targetMode: s.targetMode || "suggested",
      customTarget: s.customTarget ?? null,
      gPerKg: s.gPerKg ?? null,
      foodSet: ["us","veg","desi"].includes(s.foodSet) ? s.foodSet : "us",
      mealSlots: Math.min(6, Math.max(2, s.mealSlots || 3)),
      activeMeal: s.activeMeal || 0,
      plan: Array.isArray(s.plan) ? s.plan.map(x => ({id: x.id, servings: x.servings, meal: x.meal ?? 0})) : [],
      screen: s.profileId ? ((s.weightKg || s.customTarget) ? "play" : "setup") : "profile",
      tab: "add",
    });
  } catch (_) { /* ignore */ }
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({
      profileId: state.profileId,
      weightKg: state.weightKg,
      weightUnit: state.weightUnit,
      weightInput: state.weightInput,
      targetMode: state.targetMode,
      customTarget: state.customTarget,
      gPerKg: state.gPerKg,
      foodSet: state.foodSet,
      mealSlots: state.mealSlots,
      activeMeal: state.activeMeal,
      plan: state.plan,
    }));
  } catch (_) { /* ignore */ }
}

function profile() { return CONTENT.profiles[state.profileId] || null; }

function suggestedTarget() {
  const p = profile();
  if (!p || !state.weightKg || !state.gPerKg) return null;
  return Math.round(state.weightKg * state.gPerKg);
}

function dailyTarget() {
  if (state.targetMode === "custom" && state.customTarget > 0) return Math.round(state.customTarget);
  return suggestedTarget();
}

function foodById(id) { return CONTENT.foods.find((f) => f.id === id); }

function defaultMealSlots() {
  const d = (CONTENT.mealDefaults || {})[state.profileId];
  if (!d) return 3;
  return Math.min(6, Math.max(2, (d.meals || 3) + (d.snacks || 0)));
}

function mealLabel(i) {
  const d = (CONTENT.mealDefaults || {})[state.profileId] || { meals: 3, snacks: 0 };
  if (i < (d.meals || 3) || state.mealSlots <= (d.meals || 3)) {
    const names = ["Breakfast", "Lunch", "Dinner", "Meal 4", "Meal 5", "Meal 6"];
    return names[i] || `Meal ${i + 1}`;
  }
  return `Snack ${i - (d.meals || 3) + 1}`;
}

function perMealTarget() {
  const t = dailyTarget();
  if (!t || !state.mealSlots) return null;
  return Math.round((t / state.mealSlots) * 10) / 10;
}

function mealProtein(i) {
  let p = 0;
  for (const item of state.plan) {
    if ((item.meal ?? 0) !== i) continue;
    const f = foodById(item.id);
    if (f) p += f.protein * item.servings;
  }
  return Math.round(p * 10) / 10;
}

function mealTarget() { return perMealTarget(); }

function mealComplete(i) {
  const per = mealTarget();
  if (!per) return false;
  return mealProtein(i) >= per * 0.9;
}

function dayComplete() {
  const t = dailyTarget();
  if (!t) return false;
  if (totals().protein >= t * 0.95) return true;
  for (let i = 0; i < state.mealSlots; i++) if (!mealComplete(i)) return false;
  return state.mealSlots > 0;
}

function mealLeft(i) {
  const per = mealTarget();
  if (!per) return null;
  return Math.max(0, Math.round((per - mealProtein(i)) * 10) / 10);
}

function suggestForMeal(n) {
  const left = mealLeft(state.activeMeal);
  if (left == null || left <= 0) return [];
  const role = activeMealRole();
  const q = state.query.trim().toLowerCase();
  const searchingFish = q.includes("fish") || q.includes("salmon") || q.includes("tilapia") || q.includes("tuna") || q.includes("cod") || q.includes("shrimp");
  const pool = CONTENT.foods.filter((f) => (f.sets || ["us"]).includes(state.foodSet));
  // Prefer meal-tagged foods; if too few, allow careful lunch↔dinner fallback (already in mealFitScore)
  const scored = pool.map((f) => {
    const over = Math.max(0, f.protein - left);
    const fit = mealFitScore(f, role);
    return {
      f,
      score: relevanceScore(f, role) - over * 0.5 + (f.protein <= left * 1.15 ? 5 : 0) + (fit >= 50 ? 8 : 0),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  // Drop hard rejects (fish/meats at breakfast/snack) unless searching
  const filtered = searchingFish ? scored : scored.filter(({ f, score }) => mealFitScore(f, role) > -90);
  return pickDiverse(filtered, n, searchingFish);
}

function nextOpenMeal() {
  for (let i = 0; i < state.mealSlots; i++) if (!mealComplete(i)) return i;
  return null;
}



function totals() {
  let protein = 0, phosphorus = 0, potassium = 0, sodium = 0;
  for (const item of state.plan) {
    const f = foodById(item.id);
    if (!f) continue;
    const q = item.servings;
    protein += f.protein * q;
    phosphorus += f.phosphorus * q;
    potassium += f.potassium * q;
    sodium += f.sodium * q;
  }
  return {
    protein: Math.round(protein * 10) / 10,
    phosphorus: Math.round(phosphorus),
    potassium: Math.round(potassium),
    sodium: Math.round(sodium),
  };
}

function lbToKg(lb) { return lb / 2.2046226218; }
function kgToLb(kg) { return kg * 2.2046226218; }

function parseWeightInput() {
  const n = parseFloat(String(state.weightInput).replace(",", "."));
  if (!isFinite(n) || n <= 0) return null;
  return state.weightUnit === "lb" ? lbToKg(n) : n;
}

function setWeightFromInput() {
  state.weightKg = parseWeightInput();
  if (state.weightKg && profile() && state.gPerKg == null) state.gPerKg = profile().g_per_kg_default;
}

function flash(msg) {
  state.flash = msg;
  clearTimeout(flash._t);
  flash._t = setTimeout(() => { state.flash = ""; render(); }, 1600);
}

function addFood(id) {
  if (dayComplete()) {
    flash(DAY_DONE[Math.floor(Math.random() * DAY_DONE.length)]);
    render();
    return;
  }
  const mealBefore = mealComplete(state.activeMeal);
  const existing = state.plan.find((x) => x.id === id && (x.meal ?? 0) === state.activeMeal);
  if (existing) existing.servings += 1;
  else state.plan.push({ id, servings: 1, meal: state.activeMeal });
  save();
  if (dayComplete()) flash(DAY_DONE[Math.floor(Math.random() * DAY_DONE.length)]);
  else if (!mealBefore && mealComplete(state.activeMeal)) flash(MEAL_DONE[Math.floor(Math.random() * MEAL_DONE.length)]);
  else flash(CHEERS[Math.floor(Math.random() * CHEERS.length)]);
  render();
}

function changeServings(id, delta) {
  const item = state.plan.find((x) => x.id === id && (x.meal ?? 0) === state.activeMeal)
    || state.plan.find((x) => x.id === id);
  if (!item) return;
  item.servings = Math.round((item.servings + delta) * 10) / 10;
  if (item.servings <= 0) state.plan = state.plan.filter((x) => x !== item);
  save();
  render();
}

function changeServingsAt(idx, delta) {
  const item = state.plan[idx];
  if (!item) return;
  item.servings = Math.round((item.servings + delta) * 10) / 10;
  if (item.servings <= 0) state.plan.splice(idx, 1);
  save();
  render();
}

function clearPlan() { state.plan = []; save(); render(); }

function clearAll() {
  localStorage.removeItem(STORE_KEY);
  Object.assign(state, {
    screen: "profile", tab: "add", profileId: null, weightKg: null, weightUnit: "lb",
    weightInput: "", targetMode: "suggested", customTarget: null, gPerKg: null,
    foodSet: "us", mealSlots: 3, activeMeal: 0, plan: [],
    filter: "for-you", query: "", flash: "", showCustom: false, showSrc: null,
  });
  render();
}

/** Current meal slot → breakfast | lunch | dinner | snack */
function activeMealRole() {
  const label = mealLabel(state.activeMeal).toLowerCase();
  if (label.startsWith("breakfast")) return "breakfast";
  if (label.startsWith("lunch")) return "lunch";
  if (label.startsWith("dinner")) return "dinner";
  if (label.startsWith("snack")) return "snack";
  return "dinner"; // Meal 4+ without snack naming → dinner-like
}

function mealsOf(f) {
  return Array.isArray(f.meals) && f.meals.length ? f.meals : null;
}

function isDinnerMeatOrFish(f) {
  if (f.cat === "fish") return true;
  if (f.cat === "meat" && f.id !== "ham-deli") return true;
  return false;
}

/** How well a food fits the current meal. Editorial tags only — no nutrient inventing. */
function mealFitScore(f, role) {
  const m = mealsOf(f);
  if (m && m.includes(role)) return 50;
  // Never promote fish fillets / dinner meats into breakfast or snack top picks
  if ((role === "breakfast" || role === "snack") && isDinnerMeatOrFish(f)) return -100;
  if (!m) return 0;
  // Careful fallbacks when the active set is thin for this slot
  if (role === "lunch" && m.includes("dinner")) return 14;
  if (role === "dinner" && m.includes("lunch")) return 14;
  if (role === "breakfast" && m.includes("snack")) return 10;
  if (role === "snack" && m.includes("breakfast")) return 10;
  return -25;
}

/** Profile ranking using existing USDA numbers only (no new nutrient inventing). */
function profileScore(f) {
  const pid = state.profileId;
  const pro = Math.max(0.1, f.protein);
  if (pid === "ckd" || pid === "dialysis") {
    const burden = 1 + f.phosphorus / 200 + f.potassium / 400 + f.sodium / 400;
    let score = pro / burden;
    if (f.id === "egg-white" || f.id === "chicken-breast" || f.id === "cod" || f.id === "turkey-breast" || f.id === "greek-yogurt") score += 8;
    if (f.restaurant || f.cat === "restaurant") score -= 6;
    if (f.sodium >= 400) score -= 5;
    if (f.potassium >= 400) score -= 3;
    if (f.phosphorus >= 250 && f.protein < 15) score -= 2;
    if (pid === "dialysis" && pro >= 15) score += 2;
    return score;
  }
  if (state.foodSet === "desi") {
    let score = pro;
    if (["moong", "lentils", "chickpeas", "kidney-beans", "toor", "lobia", "urad", "paneer", "palak-paneer", "dal", "sambar", "split-peas", "greek-yogurt", "tofu-firm", "tofu-extra-firm", "peanuts", "idli", "dosa-plain", "paratha", "buttermilk", "yogurt-skim"].includes(f.id)) score += 10;
    if (f.cat === "plant" || f.cat === "dairy") score += 4;
    if (f.id.startsWith("shake-")) score += 3;
    return score;
  }
  // Everyday US / veg: lean proteins, dairy, eggs, shakes — not a fish-first list
  let score = pro;
  if (["meat", "egg", "dairy", "plant", "supplement", "bar"].includes(f.cat)) score += 5;
  if (f.cat === "fish") score += 2; // fine for dinner, not a global boost
  if (f.id.startsWith("shake-") || f.cat === "bar") score += 4;
  if (f.restaurant) score += 1;
  if (f.cat === "fruit" || f.cat === "veg") score -= 2;
  return score;
}

/** Editorial boosts so eggs / yogurt / quinoa / whole-food proteins lead over shakes & bars.
 *  No new nutrient inventing. Desi never boosts eggs. */
function healthyProteinBoost(f, role) {
  const set = state.foodSet;
  const id = f.id;
  const isYogurt = id === "greek-yogurt" || id === "greek-yogurt-lowfat" || id === "greek-yogurt-whole"
    || id === "yogurt-lf" || id === "yogurt-whole" || id === "yogurt-skim" || id === "buttermilk";
  const isCottage = id === "cottage" || id === "cottage-1pct" || id === "cottage-nonfat"
    || id === "cottage-creamed" || id === "ricotta-skim" || id === "ricotta-whole";
  const isWholeProtein = [
    "chicken-breast", "turkey-breast", "chicken-drumstick", "chicken-dark", "ground-turkey",
    "chicken-rotisserie-breast", "tofu-firm", "tofu-extra-firm", "tempeh", "paneer", "palak-paneer",
    "lentils", "chickpeas", "moong", "black-beans", "kidney-beans", "toor", "lobia", "urad",
    "edamame", "dal", "split-peas", "white-beans", "navy-beans", "pinto-beans", "natto", "veggie-burger"
  ].includes(id);
  const isQuinoa = id === "quinoa";

  if (role === "breakfast") {
    if (set !== "desi") {
      if (id === "egg" || id === "egg-scrambled" || id === "egg-fried" || id === "egg-omelet") return 90;
      if (id === "egg-white" || id === "egg-substitute") return 80;
      if (isYogurt) return 55;              // then yogurt
      if (isCottage) return 48;             // then other whole-food dairy
      return 0;
    }
    // Desi lacto-only: yogurt/dahi, moong, idli/dosa/paratha, paneer/tofu/dal — no eggs
    if (isYogurt) return 40;
    if (id === "moong" || id === "moong-sprouts") return 28;
    if (id === "idli" || id === "dosa-plain" || id === "paratha") return 26;
    if (id === "paneer" || id === "tofu-firm" || id === "tofu-extra-firm" || id === "dal") return 22;
    return 0;
  }

  if (role === "lunch" || role === "dinner") {
    if (isYogurt) return 42;
    if (isQuinoa) return 40; // quinoa already tagged lunch/dinner; boost existing record
    if (isCottage) return 36;
    if (isWholeProtein) return 34;
    if (set !== "desi" && (id === "egg" || id === "egg-white")) return 28;
    // Mild demote of shakes/bars so they don't steal top-pick slots from whole foods
    if (id.startsWith("shake-") || f.cat === "supplement" || f.cat === "bar") return -12;
    return 0;
  }

  // Snack: keep shakes/bars usable but prefer yogurt/cottage slightly
  if (role === "snack") {
    if (isYogurt) return 20;
    if (isCottage) return 16;
    return 0;
  }
  return 0;
}

/** Combined meal-first + profile ranking. */
function relevanceScore(f, role) {
  const r = role || activeMealRole();
  return mealFitScore(f, r) + profileScore(f) + healthyProteinBoost(f, r);
}

/** Cap fish at 1 in top picks; prefer mixed categories. */
function pickDiverse(scored, n, searchingFish) {
  const out = [];
  const usedCats = new Set();
  let fishCount = 0;
  const tryAdd = (preferNewCat) => {
    for (const { f } of scored) {
      if (out.length >= n) break;
      if (out.find((x) => x.id === f.id)) continue;
      const isFish = f.cat === "fish";
      if (isFish && fishCount >= 1 && !searchingFish) continue;
      if (preferNewCat && usedCats.has(f.cat) && usedCats.size < n) continue;
      out.push(f);
      usedCats.add(f.cat);
      if (isFish) fishCount += 1;
    }
  };
  tryAdd(true);
  tryAdd(false);
  return out;
}

function filteredFoods() {
  const q = state.query.trim().toLowerCase();
  const role = activeMealRole();
  let list = CONTENT.foods.filter((f) => (f.sets || ["us"]).includes(state.foodSet));
  if (state.filter === "for-you") {
    list.sort((a, b) => relevanceScore(b, role) - relevanceScore(a, role));
  } else if (state.filter !== "all") {
    list = list.filter((f) => f.cat === state.filter);
    list.sort((a, b) => relevanceScore(b, role) - relevanceScore(a, role));
  } else {
    list.sort((a, b) => relevanceScore(b, role) - relevanceScore(a, role));
  }
  if (q) list = list.filter((f) => (f.name + " " + f.serving + " " + f.cat).toLowerCase().includes(q));
  return list;
}


function shortDisclaimer() {
  return "Education only — not medical advice. Follow your clinician or dietitian.";
}

/** Grocery-facing short name for shopping links. Does not change nutrient values. */
function shopName(f) {
  if (!f) return "";
  const byId = {
    "chicken-breast": "chicken breast",
    "chicken-dark": "chicken thighs",
    "turkey-breast": "turkey breast",
    "ground-turkey": "ground turkey",
    "ground-beef": "lean ground beef",
    "beef-steak": "beef steak",
    "pork-loin": "pork loin",
    "lamb": "lamb",
    "salmon": "salmon fillet",
    "tilapia": "tilapia",
    "cod": "cod fillet",
    "shrimp": "shrimp",
    "catfish": "catfish",
    "trout": "trout",
    "tuna-canned": "canned tuna",
    "tuna-fresh": "tuna steak",
    "sardines": "sardines",
    "egg": "eggs",
    "egg-white": "egg whites",
    "egg-substitute": "egg substitute",
    "greek-yogurt": "Greek yogurt",
    "yogurt-plain": "plain yogurt",
    "cottage-cheese": "cottage cheese",
    "ricotta": "ricotta cheese",
    "mozzarella": "mozzarella cheese",
    "cheddar": "cheddar cheese",
    "paneer": "paneer",
    "palak-paneer": "palak paneer",
    "tofu": "tofu",
    "tempeh": "tempeh",
    "edamame": "edamame",
    "quinoa": "quinoa",
    "brown-rice": "brown rice",
    "hummus": "hummus",
    "falafel": "falafel",
    "veggie-burger": "veggie burger patties",
    "dal": "dal lentils",
    "sambar": "sambar mix",
    "chana": "chickpeas",
    "black-beans": "black beans",
    "lentils": "lentils",
    "urad": "urad dal",
    "moong": "moong dal",
    "naan": "naan bread",
    "paratha": "paratha",
    "idli": "idli mix",
    "dosa-plain": "dosa mix",
    "apple": "apples",
    "mushrooms-white": "white mushrooms",
    "mushrooms-portabella": "portabella mushrooms",
    "mushrooms-shiitake": "shiitake mushrooms",
    "mushrooms-oyster": "oyster mushrooms",
    "mushrooms-crimini": "crimini mushrooms",
  };
  if (byId[f.id]) return byId[f.id];
  if (f.id.startsWith("shake-")) {
    return f.name.replace(/\s*shake.*$/i, " protein shake").replace(/,/g, "").trim();
  }
  if (f.id.startsWith("bar-")) {
    return f.name.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim() + (/\bbar\b/i.test(f.name) ? "" : " bar");
  }
  let n = f.name;
  n = n.replace(/\s*\([^)]*USDA[^)]*\)/gi, "");
  n = n.replace(/\s*\([^)]*FNDDS[^)]*\)/gi, "");
  n = n.replace(/,?\s*(roasted|cooked|boiled|grilled|baked|dry heat|meat only|skinless|no salt|part-skim|low fat|nonfat|fat free)(,|\s|$)/gi, " ");
  n = n.replace(/\s*,\s*/g, " ");
  n = n.replace(/\s+/g, " ").trim();
  return n || f.name;
}

/** Skip restaurant / fast-food plate items that are not grocery buys. */
function isGroceryItem(f) {
  if (!f) return false;
  if (f.cat === "restaurant") return false;
  const blob = `${f.id} ${f.name}`.toLowerCase();
  if (/(mcdonald|wendy|burger king|chick-fil|subway|chipotle|fast food|restaurant,|pad thai|sushi roll|hard taco)/.test(blob)) return false;
  if (/^(cheeseburger|burrito|taco|pizza)\b/.test(blob)) return false;
  return true;
}

function shoppingListItems() {
  const map = new Map();
  for (const item of state.plan) {
    const f = foodById(item.id);
    if (!isGroceryItem(f)) continue;
    const name = shopName(f);
    const key = name.toLowerCase();
    const prev = map.get(key);
    const servings = item.servings;
    if (prev) {
      prev.servings = Math.round((prev.servings + servings) * 10) / 10;
    } else {
      map.set(key, {
        name,
        servings,
        servingLabel: f.serving,
        emoji: f.emoji,
        id: f.id,
      });
    }
  }
  return [...map.values()];
}

function amazonSearchUrl(q) {
  return "https://www.amazon.com/s?k=" + encodeURIComponent(q);
}

function costcoSearchUrl(q) {
  return "https://www.costco.com/s?keyword=" + encodeURIComponent(q);
}

function buildShoppingListText() {
  const items = shoppingListItems();
  if (!items.length) return "Shopping list: (no grocery items on today's plan yet)";
  const lines = ["Shopping list (from today's plan):"];
  for (const it of items) {
    const qty = it.servings === 1 ? "1 serving" : `${it.servings} servings`;
    lines.push(`• ${it.name} — ${qty} (${it.servingLabel})`);
  }
  lines.push("");
  lines.push("Open Amazon or Costco and paste/search these names. No cart is created for you.");
  return lines.join("\n");
}

function buildPlanText({ includeShop = true } = {}) {
  const p = profile();
  const t = totals();
  const target = dailyTarget();
  const showM = !!(p && p.show_minerals);
  const lines = [];
  lines.push("Protein Planner" + (DRAFT ? " (DRAFT)" : ""));
  lines.push("Education only — not medical advice. Follow your clinician or dietitian. Values may still be under review.");
  lines.push("");
  lines.push(`Profile: ${p ? p.label : "—"}`);
  if (state.weightKg) {
    const lb = Math.round(kgToLb(state.weightKg));
    lines.push(`Weight: ${lb} lb (${Math.round(state.weightKg * 10) / 10} kg)`);
  }
  lines.push(`Daily protein target: ${target != null ? target + "g" : "—"}`);
  lines.push("");
  for (let i = 0; i < state.mealSlots; i++) {
    const items = state.plan.filter((x) => (x.meal ?? 0) === i);
    lines.push(`${mealLabel(i)}:`);
    if (!items.length) {
      lines.push("  (nothing added)");
      continue;
    }
    for (const item of items) {
      const f = foodById(item.id);
      if (!f) continue;
      const prot = Math.round(f.protein * item.servings * 10) / 10;
      let row = `  • ${f.name} — ${item.servings}× ${f.serving} · ${prot}g protein`;
      if (showM) {
        row += ` · P ${Math.round(f.phosphorus * item.servings)} / K ${Math.round(f.potassium * item.servings)} / Na ${Math.round(f.sodium * item.servings)} mg`;
      }
      lines.push(row);
    }
  }
  lines.push("");
  lines.push(`Day total: ${t.protein}g protein` + (target != null ? ` of ${target}g target` : ""));
  if (showM) {
    lines.push(`Minerals: P ${t.phosphorus} mg · K ${t.potassium} mg · Na ${t.sodium} mg`);
  }
  if (includeShop) {
    lines.push("");
    lines.push(buildShoppingListText());
  }
  return lines.join("\n");
}

function canNativeShare() {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

async function copyText(text, okMsg) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      flash(okMsg || "Copied.");
      return true;
    }
  } catch (_) { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) { flash(okMsg || "Copied."); return true; }
  } catch (_) {}
  flash("Copy failed — long-press to select text.");
  return false;
}

async function nativeSharePlan() {
  const text = buildPlanText();
  try {
    await navigator.share({ title: "Protein Planner — today's plan", text });
    flash("Shared.");
    return true;
  } catch (err) {
    if (err && err.name === "AbortError") return false;
    flash("Share unavailable — try Email, Text, or Copy.");
    return false;
  }
}

function emailPlan() {
  const text = buildPlanText();
  const subject = encodeURIComponent("My Protein Planner day");
  const body = encodeURIComponent(text);
  window.location.href = `mailto:?subject=${subject}&body=${body}`;
}

function textPlan() {
  const text = buildPlanText();
  // sms: body support varies; still useful on many phones
  window.location.href = `sms:?&body=${encodeURIComponent(text)}`;
}

function openExternal(url) {
  try {
    window.open(url, "_blank", "noopener,noreferrer");
  } catch (_) {
    window.location.href = url;
  }
}

function closeSheet() { state.sheet = null; render(); }

function shareActionsRow() {
  const hasPlan = state.plan.length > 0;
  return el("div", { class: "shareActions", id: "shareActions" },
    el("button", {
      class: "btn btnPrimary btnBlock", type: "button", id: "sharePlanBtn",
      disabled: !hasPlan,
      onclick: () => { state.sheet = "share"; render(); },
      text: "Share plan"
    }),
    el("button", {
      class: "btn btnGhost btnBlock", type: "button", id: "shopListBtn",
      disabled: !hasPlan,
      onclick: () => { state.sheet = "shop"; render(); },
      text: "Shopping list · Amazon / Costco"
    })
  );
}

function renderShareSheet() {
  const text = buildPlanText();
  return el("div", { class: "sheetScrim", id: "shareSheet", role: "dialog", "aria-label": "Share plan",
      onclick: (e) => { if (e.target === e.currentTarget) closeSheet(); } },
    el("div", { class: "sheet" },
      el("div", { class: "sheetHandle", "aria-hidden": "true" }),
      el("div", { class: "row between" },
        el("h2", { text: "Share plan" }),
        el("button", { class: "linkish", type: "button", id: "closeShareBtn", onclick: closeSheet, text: "Close" })
      ),
      el("p", { class: "muted tiny", text: "Sends from your phone only. Nothing is uploaded — no account, no tracking." }),
      canNativeShare()
        ? el("button", {
            class: "btn btnPrimary btnBlock", type: "button", id: "nativeShareBtn",
            onclick: () => nativeSharePlan(),
            text: "Share… (Messages, Mail, and more)"
          })
        : null,
      el("button", {
        class: "btn btnGhost btnBlock", type: "button", id: "emailPlanBtn",
        onclick: emailPlan, text: "Email"
      }),
      el("button", {
        class: "btn btnGhost btnBlock", type: "button", id: "textPlanBtn",
        onclick: textPlan, text: "Text / SMS"
      }),
      el("button", {
        class: "btn btnGhost btnBlock", type: "button", id: "copyPlanBtn",
        onclick: () => copyText(text, "Plan copied."),
        text: "Copy plan"
      }),
      el("button", {
        class: "btn btnGhost btnBlock", type: "button", id: "fromShareToShopBtn",
        onclick: () => { state.sheet = "shop"; render(); },
        text: "Shopping list · Amazon / Costco"
      }),
      el("pre", { class: "sharePreview", id: "sharePreview", text })
    )
  );
}

function renderShopSheet() {
  const items = shoppingListItems();
  const listText = buildShoppingListText();
  const list = el("div", { class: "shopList", id: "shopList" });
  if (!items.length) {
    list.append(el("p", { class: "muted", text: "Add grocery foods to today's plan first. Restaurant / fast-food picks are left off this list." }));
  } else {
    items.forEach((it, i) => {
      list.append(
        el("div", { class: "shopItem", id: `shop-item-${i}` },
          el("div", { class: "emoji", text: it.emoji }),
          el("div", { class: "shopBody" },
            el("div", { class: "name", text: it.name }),
            el("div", { class: "meta", text: `${it.servings === 1 ? "1 serving" : it.servings + " servings"} · ${it.servingLabel}` })
          ),
          el("div", { class: "shopLinks" },
            el("a", {
              class: "shopLink", href: amazonSearchUrl(it.name), target: "_blank", rel: "noopener noreferrer",
              id: `amazon-${i}`, text: "Amazon"
            }),
            el("a", {
              class: "shopLink costco", href: costcoSearchUrl(it.name), target: "_blank", rel: "noopener noreferrer",
              id: `costco-${i}`, text: "Costco"
            })
          )
        )
      );
    });
  }
  return el("div", { class: "sheetScrim", id: "shopSheet", role: "dialog", "aria-label": "Shopping list",
      onclick: (e) => { if (e.target === e.currentTarget) closeSheet(); } },
    el("div", { class: "sheet" },
      el("div", { class: "sheetHandle", "aria-hidden": "true" }),
      el("div", { class: "row between" },
        el("h2", { text: "Shopping list" }),
        el("button", { class: "linkish", type: "button", id: "closeShopBtn", onclick: closeSheet, text: "Close" })
      ),
      el("p", { class: "muted tiny", text: "Opens Amazon or Costco search in a new tab. We do not add to a cart, sign you in, or send your list anywhere." }),
      items.length ? el("div", { class: "shareActions" },
        el("button", {
          class: "btn btnPrimary btnBlock", type: "button", id: "shopAmazonTopBtn",
          onclick: () => openExternal(amazonSearchUrl(items[0].name)),
          text: "Shop at Amazon"
        }),
        el("button", {
          class: "btn btnGhost btnBlock", type: "button", id: "shopCostcoTopBtn",
          onclick: () => openExternal(costcoSearchUrl(items[0].name)),
          text: "Shop at Costco"
        })
      ) : null,
      list,
      el("button", {
        class: "btn btnGhost btnBlock", type: "button", id: "copyShopBtn",
        disabled: !items.length,
        onclick: () => copyText(listText, "List copied."),
        text: "Copy list"
      }),
      canNativeShare() ? el("button", {
        class: "btn btnGhost btnBlock", type: "button", id: "shareShopBtn",
        disabled: !items.length,
        onclick: async () => {
          try {
            await navigator.share({ title: "Protein Planner shopping list", text: listText });
            flash("Shared.");
          } catch (err) {
            if (!(err && err.name === "AbortError")) flash("Share unavailable — use Copy list.");
          }
        },
        text: "Share list"
      }) : null,
      el("button", {
        class: "btn btnGhost btnBlock", type: "button", id: "fromShopToShareBtn",
        onclick: () => { state.sheet = "share"; render(); },
        text: "Share full plan"
      })
    )
  );
}

function plateRing(pct, hit) {
  const r = 42, c = 2 * Math.PI * r;
  const filled = Math.min(100, Math.max(0, pct));
  const dash = (filled / 100) * c;
  return el("div", { class: "plateWrap" + (hit ? " hit" : ""), "aria-hidden": "true" },
    el("svg", { class: "plateSvg", viewBox: "0 0 100 100", width: "112", height: "112" },
      el("circle", { cx: "50", cy: "50", r: String(r), class: "plateTrack" }),
      el("circle", {
        cx: "50", cy: "50", r: String(r), class: "plateFill" + (pct > 105 ? " over" : ""),
        style: {
          strokeDasharray: `${dash} ${c}`,
          transform: "rotate(-90deg)",
          transformOrigin: "50% 50%",
        }
      })
    ),
    el("div", { class: "plateCenter" },
      el("div", { class: "plateEmoji", text: hit ? "✨" : "🍽️" }),
      el("div", { class: "platePct", text: `${Math.round(Math.min(filled, 999))}%` })
    )
  );
}

function mineralChips(p, k, na, compact) {
  return el("div", { class: "mChips" },
    el("span", { class: "mChip", text: `P ${p}` }),
    el("span", { class: "mChip", text: `K ${k}` }),
    el("span", { class: "mChip", text: `Na ${na}` }),
    compact ? null : el("span", { class: "mChipUnit", text: "mg" })
  );
}


function setSwitch() {
  const order = ["us", "veg", "desi"];
  const sets = CONTENT.foodSets || {};
  return el("div", { class: "setSwitch", id: "setSwitch", role: "tablist" },
    ...order.filter((id) => sets[id]).map((id) => {
      const s = sets[id];
      return el("button", {
        type: "button", role: "tab",
        class: "setBtn" + (state.foodSet === s.id ? " on" : ""),
        id: `set-${s.id}`,
        onclick: () => { state.foodSet = s.id; state.filter = "for-you"; state.query = ""; save(); render(); },
        text: s.label
      });
    })
  );
}

function mealChips(editable) {
  const per = mealTarget();
  const row = el("div", { class: "mealRow", id: "mealRow" });
  for (let i = 0; i < state.mealSlots; i++) {
    const got = mealProtein(i);
    const done = mealComplete(i);
    row.append(el("button", {
      type: "button",
      class: "mealChip role-" + mealLabel(i).toLowerCase().split(" ")[0] + (state.activeMeal === i ? " on" : "") + (done ? " filled" : ""),
      id: `meal-${i}`,
      onclick: () => { state.activeMeal = i; state.tab = "add"; render(); },
      html: `<b>${mealLabel(i)}</b><span>${done ? "✓" : (per ? `${got}/${per}g` : `${got}g`)}</span>`
    }));
  }
  if (editable) {
    row.append(el("div", { class: "mealAdjust" },
      el("button", { type: "button", id: "mealsMinus", disabled: state.mealSlots <= 2,
        onclick: () => { state.mealSlots = Math.max(2, state.mealSlots - 1); if (state.activeMeal >= state.mealSlots) state.activeMeal = state.mealSlots - 1; save(); render(); }, text: "−" }),
      el("button", { type: "button", id: "mealsPlus", disabled: state.mealSlots >= 6,
        onclick: () => { state.mealSlots = Math.min(6, state.mealSlots + 1); save(); render(); }, text: "+" })
    ));
  }
  return row;
}

function progressHero() {
  const p = profile();
  const t = dailyTarget();
  const tot = totals();
  const pct = t ? (tot.protein / t) * 100 : 0;
  const done = dayComplete();
  const hit = done;
  const over = t && tot.protein > t * 1.1;
  const leftMeal = mealLeft(state.activeMeal);
  const mealDone = mealComplete(state.activeMeal);
  let status;
  if (!t) status = "Set a target to start.";
  else if (done) status = DAY_DONE[0];
  else if (mealDone) status = `${mealLabel(state.activeMeal)} done. Next meal?`;
  else if (leftMeal != null) status = `${leftMeal}g left for ${mealLabel(state.activeMeal)}.`;
  else status = "Add foods to fill your plate.";

  return el("div", { class: "card hero" },
    el("div", { class: "heroRow" },
      plateRing(pct, hit),
      el("div", { class: "heroStats" },
        el("div", { class: "muted tiny", text: "Today" }),
        el("div", { class: "bigNum", id: "proteinTotal", text: `${tot.protein}g` }),
        el("div", { class: "targetLine", id: "proteinTarget", text: t ? `of ${t}g` : "no target" }),
        el("div", { class: "statusLine" + (hit ? " good" : "") + (over ? " warn" : ""), id: "proteinStatus", text: status })
      )
    ),
    mealChips(false),
    p && p.show_minerals ? el("div", { id: "mineralTotals", class: "mineralsCompact" },
      mineralChips(tot.phosphorus, tot.potassium, tot.sodium, true)
    ) : null,
    state.flash ? el("div", { class: "toast", id: "toast", text: state.flash }) : null
  );
}

function renderProfile() {
  const blurbs = {
    ckd: "A bit less protein. We'll suggest a number from your weight.",
    dialysis: "More protein on dialysis days. We'll suggest a number from your weight.",
    general: "Everyday protein goal from the adult RDA.",
  };
  return [el("div", { class: "card" },
    el("h2", { text: "Who's this for?" }),
    el("p", { class: "muted", text: "One tap. Then set your number." }),
    el("div", { class: "profileGrid", id: "profileGrid" },
      ...Object.values(CONTENT.profiles).map((p) =>
        el("button", {
          class: "profileBtn", type: "button", id: `pick-${p.id}`,
          onclick: () => {
            state.profileId = p.id;
            state.gPerKg = p.g_per_kg_default;
            state.mealSlots = defaultMealSlots();
            state.activeMeal = 0;
            state.screen = "setup";
            state.showCustom = false;
            save();
            render();
          }
        },
          el("strong", { text: `${p.emoji} ${p.short}` }),
          el("span", { text: blurbs[p.id] || p.about })
        )
      )
    ),
    el("p", { class: "disclaimer", text: shortDisclaimer() })
  )];
}

function renderSetup() {
  const p = profile();
  if (!p) { state.screen = "profile"; return renderProfile(); }
  const suggested = suggestedTarget();

  const weightInput = el("input", {
    type: "number", id: "weightInput", min: "1", step: "0.1", inputmode: "decimal",
    value: state.weightInput,
    placeholder: state.weightUnit === "lb" ? "Weight, lb" : "Weight, kg",
    oninput: (e) => {
      state.weightInput = e.target.value;
      setWeightFromInput();
      const box = document.getElementById("suggestBig");
      const go = document.getElementById("toPlanBtn");
      const s = suggestedTarget();
      if (box) box.textContent = s ? `${s}g` : "—";
      if (go) go.disabled = !(dailyTarget() > 0);
    }
  });

  return [el("div", { class: "card" },
    el("div", { class: "row between" },
      el("h2", { text: `${p.emoji} Your number` }),
      el("button", { class: "linkish", type: "button", id: "backProfileBtn",
        onclick: () => { state.screen = "profile"; render(); }, text: "Change" })
    ),
    el("div", { class: "row" },
      el("div", { class: "field grow" }, weightInput),
      el("div", { class: "unitToggle" },
        el("button", {
          type: "button", id: "unitLb", class: state.weightUnit === "lb" ? "on" : "",
          onclick: () => {
            if (state.weightUnit === "lb") return;
            const kg = parseWeightInput();
            state.weightUnit = "lb";
            if (kg) state.weightInput = String(Math.round(kgToLb(kg) * 10) / 10);
            render();
          }, text: "lb"
        }),
        el("button", {
          type: "button", id: "unitKg", class: state.weightUnit === "kg" ? "on" : "",
          onclick: () => {
            if (state.weightUnit === "kg") return;
            const kg = parseWeightInput();
            state.weightUnit = "kg";
            if (kg) state.weightInput = String(Math.round(kg * 10) / 10);
            render();
          }, text: "kg"
        })
      )
    ),
    el("div", { class: "suggestCard" },
      el("div", { class: "muted tiny", text: `Suggested · ${p.g_per_kg_default} g/kg` }),
      el("div", { class: "suggestBig", id: "suggestBig", text: suggested ? `${suggested}g` : "—" }),
      el("div", { class: "tiny muted", id: "suggestBox",
        text: suggested
          ? `${state.gPerKg} g/kg × ${Math.round(state.weightKg * 10) / 10} kg`
          : "Enter weight" })
    ),
    el("button", {
      class: "linkish", type: "button", id: "toggleCustom",
      onclick: () => { state.showCustom = !state.showCustom; render(); },
      text: state.showCustom ? "Hide custom target" : "I have a clinician number"
    }),
    state.showCustom ? el("input", {
      type: "number", id: "customTargetInput", min: "1", step: "1",
      value: state.customTarget != null ? state.customTarget : "",
      placeholder: "Daily protein, grams",
      oninput: (e) => {
        const v = parseFloat(e.target.value);
        state.customTarget = isFinite(v) && v > 0 ? v : null;
        state.targetMode = state.customTarget ? "custom" : "suggested";
        const go = document.getElementById("toPlanBtn");
        if (go) go.disabled = !(dailyTarget() > 0);
      }
    }) : null,
    el("div", { class: "suggestCard soft" },
      el("div", { class: "muted tiny", text: "Meals today" }),
      mealChips(true),
      el("div", { class: "tiny muted", text: "Draft split for finishing the day — not a prescription." })
    ),
    el("button", {
      class: "btn btnPrimary btnBlock", type: "button", id: "toPlanBtn",
      disabled: !(dailyTarget() > 0),
      onclick: () => {
        setWeightFromInput();
        if (!(dailyTarget() > 0)) return;
        state.targetMode = state.customTarget ? "custom" : "suggested";
        if (!state.mealSlots) state.mealSlots = defaultMealSlots();
        state.screen = "play";
        state.tab = "add";
        state.filter = "for-you";
        save();
        render();
      },
      text: "Pick foods →"
    }),
    el("p", { class: "tiny muted", text: "Rates pending physician review." }),
    el("p", { class: "disclaimer", text: shortDisclaimer() })
  )];
}

function shakeFoods() {
  return CONTENT.foods.filter((f) =>
    (f.sets || ["us"]).includes(state.foodSet)
    && (f.id.startsWith("shake-") || f.id === "protein-shake-rtd")
  ).sort((a, b) => b.protein - a.protein);
}

function renderAddTab() {
  const showM = profile()?.show_minerals;
  const done = dayComplete();
  const mealDone = mealComplete(state.activeMeal);
  const left = mealLeft(state.activeMeal);
  const suggestions = (!done && !mealDone) ? suggestForMeal(3) : [];

  if (done) {
    return el("div", {},
      progressHero(),
      el("div", { class: "card celebrate", id: "doneCard" },
        el("div", { class: "celebEmoji", text: "🎉" }),
        el("h2", { text: "You finished today's plan" }),
        el("p", { class: "muted", text: "Nice work. Share your plan, or send a grocery list to Amazon or Costco." }),
        shareActionsRow(),
        el("button", { class: "btn btnGhost btnBlock", type: "button", id: "viewPlateBtn",
          onclick: () => { state.tab = "plate"; render(); }, text: "See your plate" })
      )
    );
  }

  const role = activeMealRole();
  const roleEmoji = { breakfast: "🌅", lunch: "☀️", dinner: "🌙", snack: "🍎" }[role] || "🍽️";
  const guide = el("div", { class: "card guide" },
    el("div", { class: "row between" },
      el("div", { class: "mealHeading" },
        el("span", { class: "mealBadge", text: `${roleEmoji} ${mealLabel(state.activeMeal)}` }),
        left != null && !mealDone ? el("div", { class: "leftCue", html: `<b>${left}g</b> left for this meal` }) : null
      ),
      setSwitch()
    ),
    mealDone
      ? el("div", { class: "nextMealBlock" },
          el("p", { class: "statusLine good", text: "This meal's protein share is filled." }),
          el("button", {
            class: "btn btnPrimary btnBlock", type: "button", id: "nextMealBtn",
            onclick: () => {
              const n = nextOpenMeal();
              if (n == null) { render(); return; }
              state.activeMeal = n; save(); render();
            },
            text: nextOpenMeal() == null ? "All meals done" : `Next: ${mealLabel(nextOpenMeal())} →`
          })
        )
      : el("div", {},
          el("div", { class: "suggestLabel", text: "Top picks for this meal" }),
          el("div", { class: "suggestRow", id: "suggestRow" },
            ...suggestions.map((f) => el("button", {
              type: "button", class: "suggestCardBtn", id: `sug-${f.id}`,
              onclick: () => addFood(f.id),
              html: `<span class="emoji">${f.emoji}</span><span class="sugBody"><span class="name">${f.name}</span><span class="sugServing">${f.serving}</span></span><span class="sugProt"><b>${f.protein}g</b><span>Add</span></span>`
            }))
          ),
          suggestions.length ? el("button", {
            class: "btn btnGhost btnBlock", type: "button", id: "fillMealBtn",
            onclick: () => { if (suggestions[0]) addFood(suggestions[0].id); },
            text: `Quick-add ${suggestions[0].emoji} ${suggestions[0].name}`
          }) : null
        )
  );

  // Compact browse: search + short list, no category chip wall
  const list = el("div", { class: "foodList", id: "foodList" });
  const foods = filteredFoods().slice(0, state.query ? 40 : 8);
  foods.forEach((f) => {
    list.append(
      el("div", { class: "foodItem" },
        el("div", { class: "emoji", text: f.emoji }),
        el("div", { class: "foodBody" },
          el("div", { class: "name", text: f.name }),
          el("div", { class: "meta", text: `${f.serving} · ` }, el("b", { text: `${f.protein}g` })),
          showM ? mineralChips(f.phosphorus, f.potassium, f.sodium, true) : null
        ),
        el("button", { class: "addBtn", type: "button", id: `add-${f.id}`,
          onclick: () => addFood(f.id), text: "+", disabled: mealDone })
      )
    );
  });

  const shakes = shakeFoods();
  const shakeRow = (!mealDone && shakes.length && !state.query)
    ? el("div", { class: "card shakeCard", id: "shakeSection" },
        el("div", { class: "suggestLabel", text: "Protein shakes" }),
        el("p", { class: "muted tiny", text: "Ready-to-drink options for this food set — tap to add." }),
        el("div", { class: "shakeRow", id: "shakeRow" },
          ...shakes.map((f) => el("button", {
            type: "button", class: "shakeChip", id: `shake-${f.id}`,
            onclick: () => addFood(f.id),
            html: `<span class="emoji">${f.emoji}</span><span class="shakeName">${f.name.replace(/ shake.*$/i, "").replace(/,.*$/, "")}</span><span class="shakeProt">${f.protein}g</span>`
          }))
        )
      )
    : null;

  return el("div", {},
    progressHero(),
    guide,
    shakeRow,
    mealDone ? null : el("div", { class: "card" },
      el("input", {
        type: "search", id: "foodSearch", placeholder: "Search shakes, yogurt, bars…",
        value: state.query,
        oninput: (e) => { state.query = e.target.value; state.filter = "for-you"; render(); }
      }),
      list
    ),
    state.plan.length ? el("div", { class: "card", id: "shareCard" },
      el("div", { class: "suggestLabel", text: "Share & shop" }),
      el("p", { class: "muted tiny", text: "Email, text, or copy today's plan — or open Amazon / Costco search for groceries." }),
      shareActionsRow()
    ) : null
  );
}

function renderPlateTab() {
  const showM = profile()?.show_minerals;
  const list = el("div", { class: "foodList", id: "planList" });
  if (!state.plan.length) {
    list.append(el("p", { class: "muted", text: "Empty plate. Grab something from Add." }));
  } else {
    state.plan.forEach((item, idx) => {
      const f = foodById(item.id);
      if (!f) return;
      list.append(
        el("div", { class: "planItem", dataset: { id: f.id } },
          el("div", { class: "emoji", text: f.emoji }),
          el("div", {},
            el("div", { class: "name", text: f.name }),
            el("div", { class: "meta", text: `${mealLabel(item.meal ?? 0)} · ${item.servings}× · ${Math.round(f.protein * item.servings * 10) / 10}g` }),
            showM ? mineralChips(
              Math.round(f.phosphorus * item.servings),
              Math.round(f.potassium * item.servings),
              Math.round(f.sodium * item.servings), true
            ) : null
          ),
          el("div", {},
            el("div", { class: "qty" },
              el("button", { type: "button", "aria-label": "Less", onclick: () => changeServingsAt(idx, -0.5), text: "−" }),
              el("span", { text: String(item.servings) }),
              el("button", { type: "button", "aria-label": "More", onclick: () => changeServingsAt(idx, 0.5), text: "+" })
            ),
            el("button", { class: "remove", type: "button", onclick: () => changeServingsAt(idx, -item.servings), text: "Remove" })
          )
        )
      );
    });
  }
  return el("div", {},
    progressHero(),
    el("div", { class: "card" },
      el("div", { class: "row between" },
        el("h2", { text: "Your plate" }),
        state.plan.length ? el("button", { class: "linkish danger", type: "button", id: "clearPlanBtn", onclick: clearPlan, text: "Clear" }) : null
      ),
      list
    ),
    state.plan.length ? el("div", { class: "card", id: "shareCardPlate" },
      el("div", { class: "suggestLabel", text: "Share & shop" }),
      shareActionsRow()
    ) : null
  );
}

function renderMoreTab() {
  const p = profile();
  return el("div", { class: "card" },
    el("h2", { text: "More" }),
    el("p", { class: "muted", text: p ? `${p.label} · target ${dailyTarget() || "—"}g` : "" }),
    el("button", { class: "btn btnGhost btnBlock", type: "button", id: "editTargetBtn",
      onclick: () => { state.screen = "setup"; render(); }, text: "Edit weight / target" }),
    el("button", { class: "btn btnGhost btnBlock", type: "button", id: "changeProfileBtn",
      onclick: () => { state.screen = "profile"; render(); }, text: "Change profile" }),
    el("button", { class: "btn btnDanger btnBlock", type: "button", id: "clearAllBtn",
      onclick: () => { if (confirm("Clear this device's saved plan?")) clearAll(); },
      text: "Clear saved plan" }),
    el("p", { class: "disclaimer", text: shortDisclaimer() }),
    el("p", { class: "tiny muted", text: p ? "Guideline rates need Dr D sign-off." : "" }),
    el("div", { class: "footerLinks" },
      el("a", { href: "privacy.html", text: "Privacy" }),
      el("a", { href: "CONTENT_REVIEW.md", text: "Review file" })
    )
  );
}

function renderPlay() {
  const tabs = el("div", { class: "tabs", role: "tablist" },
    ...[["add", "Build"], ["plate", "Plate"], ["more", "More"]].map(([id, label]) =>
      el("button", {
        type: "button", role: "tab", id: `tab-${id}`,
        class: state.tab === id ? "on" : "",
        "aria-selected": state.tab === id,
        onclick: () => { state.tab = id; render(); },
        text: label
      })
    )
  );
  const body = state.tab === "add" ? renderAddTab()
    : state.tab === "plate" ? renderPlateTab()
    : renderMoreTab();
  return [tabs, body];
}

function render() {
  // Preserve search focus/caret across full re-renders (typing must not feel like a refresh)
  const prevSearch = document.getElementById("foodSearch");
  const keepSearch = prevSearch && document.activeElement === prevSearch;
  const selStart = keepSearch ? prevSearch.selectionStart : null;
  const selEnd = keepSearch ? prevSearch.selectionEnd : null;

  const app = document.getElementById("app");
  app.innerHTML = "";
  app.append(
    el("div", { class: "draftBanner", id: "draftBanner", hidden: !DRAFT,
      text: "DRAFT · education only · values pending review" }),
    el("header", {},
      el("div", { class: "brand" },
        el("div", { class: "logo", text: "🍽️" }),
        el("div", { class: "title" },
          el("h1", { text: "Protein Planner" }),
          el("p", { text: profile() ? profile().short : "Fill your protein plate" })
        )
      ),
      state.screen === "play" ? el("button", {
        class: "iconBtn", type: "button", id: "headerTargetBtn",
        onclick: () => { state.screen = "setup"; render(); },
        text: dailyTarget() ? `${dailyTarget()}g` : "Set"
      }) : null
    )
  );
  const parts = state.screen === "profile" ? renderProfile()
    : state.screen === "setup" ? renderSetup()
    : renderPlay();
  for (const part of parts) app.append(part);
  if (state.sheet === "share") app.append(renderShareSheet());
  else if (state.sheet === "shop") app.append(renderShopSheet());

  if (keepSearch) {
    const next = document.getElementById("foodSearch");
    if (next) {
      next.focus();
      try {
        const len = next.value.length;
        const a = selStart == null ? len : Math.min(selStart, len);
        const b = selEnd == null ? len : Math.min(selEnd, len);
        next.setSelectionRange(a, b);
      } catch (_) {}
    }
  }
}

load();
render();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

window.__PP = { state, dailyTarget, totals, suggestedTarget, profile, addFood, changeServings, changeServingsAt, save, render, relevanceScore, profileScore, mealFitScore, healthyProteinBoost, activeMealRole, perMealTarget, mealProtein, defaultMealSlots, mealComplete, dayComplete, suggestForMeal, nextOpenMeal, mealLabel, filteredFoods, shakeFoods, buildPlanText, buildShoppingListText, shoppingListItems, shopName, isGroceryItem, amazonSearchUrl, costcoSearchUrl, canNativeShare };

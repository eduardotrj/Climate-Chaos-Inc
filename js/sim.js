'use strict';
// ---------------------------------------------------------------------------
// Simulation: one tick = one month.
//
//  smog  – city-wide pollution stock (0-100). Rises with net emissions, decays slowly.
//  temp  – °C above pre-industrial. Global creep + smog + heat island − tree shade.
//  Fields.pol / Fields.heat – per-tile local values (what trees actually feel).
// ---------------------------------------------------------------------------

const Fields = { pol: new Float32Array(COLS * ROWS), heat: new Float32Array(COLS * ROWS) };

function newGame(seed) {
  seed = seed || (Date.now() & 0xffffffff);
  const s = {
    version: 1, seed,
    tiles: buildHeilbronn(seed),
    money: 3000, smog: 32, temp: 2.0, happy: 60, pop: 0,
    month: 2, year: START_YEAR, elapsed: 0, season: 'spring',
    wind: WINDS[0], carbonTax: 0,
    mods: freshMods(),
    nextOffer: 7, planted: 0, declined: 0,
    history: [], achievements: {}, news: [],
    budget: {}, stats: {},
    over: null,
  };
  updateFields(s);
  s.temp = targetTemp(s);
  updateFields(s);
  s.happy = targetHappiness(s);
  s.pop = targetPop(s);
  computeBudget(s);
  return s;
}

function freshMods() { return { tax: 1, coal: 1, happy: 0, heatwave: 0, power: 0 }; }

// ----- small helpers used everywhere (including data.js) -------------------
const growthOf = o => { const d = CATALOG[o.id]; return d.grow ? Math.min(1, o.age / d.grow) : 1; };
const forEachObj = (s, fn) => s.tiles.forEach((t, i) => { if (t.o) fn(t.o, i, t); });
function countId(s, id) { let n = 0; forEachObj(s, o => { if (o.id === id) n++; }); return n; }
function countMature(s, id) { let n = 0; forEachObj(s, o => { if (o.id === id && growthOf(o) >= 1) n++; }); return n; }
function countFilters(s) { let n = 0; forEachObj(s, o => { if (o.filter) n++; }); return n; }
function removeAllFilters(s) { let n = 0; forEachObj(s, o => { if (o.filter) { o.filter = false; n++; } }); return n; }

function forRadius(c, r, rad, fn) {
  const R = Math.ceil(rad);
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const x = c + dx, y = r + dy;
    if (!inBounds(x, y)) continue;
    const d = Math.hypot(dx, dy);
    if (d <= rad + 0.01) fn(x, y, d, idx(x, y));
  }
}
function spread(arr, c, r, rad, amount) {
  forRadius(c, r, rad, (x, y, d, j) => { arr[j] += amount / (1 + d); });
}

function countRiversideTrees(s) {
  let n = 0;
  forEachObj(s, (o, i) => {
    if (!isTree(o.id)) return;
    let wet = false;
    forRadius(i % COLS, (i / COLS) | 0, 1, (x, y, d, j) => { if (s.tiles[j].g === 'water') wet = true; });
    if (wet) n++;
  });
  return n;
}

function chopRandomTrees(s, n) {
  const list = [];
  forEachObj(s, (o, i, t) => { if (isTree(o.id) && growthOf(o) >= 1) list.push(t); });
  for (let k = 0; k < n && list.length; k++) {
    const t = list.splice(Math.floor(Math.random() * list.length), 1)[0];
    t.o = null;
  }
  updateFields(s);
}

function placeRandom(s, id, zone) {
  const spots = [];
  s.tiles.forEach((t, i) => {
    if (zone === 'north' && (i / COLS | 0) > 8) return;
    if (canPlace(s, id, i % COLS, (i / COLS) | 0, true).ok) spots.push(t);
  });
  if (!spots.length) return null;
  const t = spots[Math.floor(Math.random() * spots.length)];
  t.o = { id, age: 0, health: 100 };
  updateFields(s);
  return t;
}

// ----- placement -----------------------------------------------------------
function canPlace(s, id, c, r, free) {
  if (!inBounds(c, r)) return { ok: false };
  const t = s.tiles[idx(c, r)], d = CATALOG[id];
  if (id === 'bulldoze') {
    if (!t.o) return { ok: false, reason: 'Nothing here to demolish.' };
    if (CATALOG[t.o.id].cat === 'landmark') return { ok: false, reason: 'Bulldoze a landmark?! Even Profitmeier thinks that\'s too much.' };
    const cost = demolishCost(t.o);
    if (s.money < cost) return { ok: false, reason: 'You can\'t even afford the bulldozer fuel.' };
    return { ok: true, cost };
  }
  if (id === 'filter') {
    if (!t.o || !CATALOG[t.o.id].emission || CATALOG[t.o.id].cat !== 'industry') return { ok: false, reason: 'Filters go on smoky industry buildings.' };
    if (t.o.filter) return { ok: false, reason: 'This one already has a filter. Double filters are not a thing.' };
    const cost = filterCost(t.o);
    if (s.money < cost) return { ok: false, reason: 'Not enough money for a filter.' };
    return { ok: true, cost };
  }
  if (t.g === 'water' || t.g === 'bridge') return { ok: false, reason: 'That\'s the Neckar. The ducks would object.' };
  if (t.g === 'road') return { ok: false, reason: 'You can\'t build on the road. Traffic is bad enough already.' };
  if (t.o) return { ok: false, reason: 'This tile is taken. Bulldoze it first.' };
  if (d.needsWater && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dc, dr]) => inBounds(c + dc, r + dr) && s.tiles[idx(c + dc, r + dr)].g === 'water'))
    return { ok: false, reason: 'A hydro plant needs to sit right on the Neckar riverbank.' };
  if (t.g === 'hill' && (d.cat === 'industry' && id !== 'weinkeller' || d.cat === 'housing'))
    return { ok: false, reason: 'The Wartberg is protected landscape. Vines, trees and green stuff only.' };
  if (!free && s.money < d.cost) return { ok: false, reason: 'Not enough money. Even the Swabian piggy bank says no.' };
  return { ok: true, cost: free ? 0 : d.cost };
}

const demolishCost = o => { const d = CATALOG[o.id]; return d.cat === 'trees' || o.id === 'stump' ? 0 : Math.max(10, Math.round((d.cost || 100) * 0.1)); };
const filterCost = o => Math.round(CATALOG[o.id].cost * 0.4);

// Returns a headline string on success, or { error } on failure.
function applyTool(s, id, c, r) {
  const chk = canPlace(s, id, c, r);
  if (!chk.ok) return { error: chk.reason };
  const t = s.tiles[idx(c, r)];
  s.money -= chk.cost;
  if (id === 'bulldoze') {
    const name = CATALOG[t.o.id].name;
    t.o = null;
    updateFields(s);
    return { ok: true, msg: `${name} demolished.` };
  }
  if (id === 'filter') {
    t.o.filter = true;
    updateFields(s);
    return { ok: true, msg: `Smoke filter installed on the ${CATALOG[t.o.id].name}.` };
  }
  t.o = { id, age: 0, health: 100 };
  if (isTree(id)) s.planted++;
  updateFields(s);
  return { ok: true };
}

// ----- fields --------------------------------------------------------------
function emissionOf(o, i, tramCover) {
  const d = CATALOG[o.id];
  let e = d.emission || 0;
  if (o.filter) e *= 0.55;
  if (isHousing(o.id) && tramCover[i]) e *= 0.5;
  return e;
}

// MW this object makes (> 0) or uses (< 0) right now.
function powerOf(s, o) {
  let p = CATALOG[o.id].power || 0;
  if (o.id === 'solar') p *= POWER.solar[s.season];
  if (o.id === 'wind') p *= POWER.wind[s.season] * (s.wind.name === 'Calm' ? 0.3 : 1);
  if (o.filter) p -= 1;
  return p;
}

function seasonBump(s) {
  const b = { winter: -1, spring: 0, summer: 0.8, autumn: 0 }[s.season];
  return b + s.mods.heatwave;
}

function updateFields(s) {
  const N = COLS * ROWS;
  const pol = Fields.pol, heat = Fields.heat;
  pol.fill(0); heat.fill(0);
  const tramCover = new Uint8Array(N);
  forEachObj(s, (o, i) => { if (o.id === 'tram') forRadius(i % COLS, (i / COLS) | 0, 3, (x, y, d, j) => { tramCover[j] = 1; }); });

  const st = { E: 0, Eind: 0, A: 0, heat: 0, cool: 0, capacity: 0, trees: 0, matureTrees: 0, parks: 0,
    houses: 0, eco: 0, trams: 0, industry: 0, landmarks: 0, deadRecently: s.stats.deadRecently || 0, gen: 0, use: 0 };
  const wind = s.wind;
  forEachObj(s, (o, i) => {
    const d = CATALOG[o.id], c = i % COLS, r = (i / COLS) | 0;
    const e = emissionOf(o, i, tramCover);
    if (e > 0) {
      st.E += e;
      if (d.cat === 'industry') { st.Eind += e; st.industry++; }
      spread(pol, c + wind.dx, r + wind.dy, 3, e * 12);
    }
    if (d.heat) { st.heat += d.heat; spread(heat, c, r, 3, d.heat * 0.3); }
    if (d.absorb) {
      const g = growthOf(o) * (0.5 + 0.5 * o.health / 100);
      const a = d.absorb * g, cl = d.cool * g;
      st.A += a; st.cool += cl;
      spread(pol, c, r, 2, -a * 16);
      spread(heat, c, r, 2, -cl * 0.4);
    }
    if (d.capacity) st.capacity += d.capacity;
    const pw = powerOf(s, o);
    if (pw > 0) st.gen += pw; else st.use -= pw;
    if (isTree(o.id)) { st.trees++; if (growthOf(o) >= 1) st.matureTrees++; }
    if (o.id === 'park') st.parks++;
    if (o.id === 'oeko') st.eco++;
    if (isHousing(o.id)) st.houses++;
    if (o.id === 'tram') st.trams++;
    if (d.cat === 'landmark') st.landmarks++;
  });
  s.tiles.forEach((t, i) => { if (t.g === 'water') spread(heat, i % COLS, (i / COLS) | 0, 1, -0.25); });

  // power balance
  st.use -= s.mods.power;
  const short = Math.max(0, st.use - st.gen), imp = Math.min(short, POWER.importCap), unserved = short - imp;
  s.power = { gen: st.gen, use: st.use, imp, exp: Math.max(0, st.gen - st.use), unserved, ratio: st.use ? 1 - unserved / st.use : 1 };
  st.E += imp * POWER.importSmog;

  const bump = seasonBump(s);
  for (let i = 0; i < N; i++) {
    pol[i] = Math.max(0, pol[i] + s.smog * 0.8);
    heat[i] = heat[i] + s.temp + bump;
  }
  s.stats = st;
  s.rev = (s.rev || 0) + 1; // lets the renderer know the map changed
}

// ----- targets -------------------------------------------------------------
function targetTemp(s) {
  const creep = 1.2 + 0.05 * (s.elapsed / 12);
  // Shade can soften the urban heat island, but it can't undo global warming.
  const island = Math.max(-0.7, 0.02 * s.stats.heat - 0.022 * s.stats.cool);
  return creep + 0.022 * s.smog + island;
}

function targetHappiness(s) {
  const st = s.stats;
  let h = 58 - s.smog * 0.35 - Math.max(0, s.temp - 2) * 12;
  h += Math.min(10, st.parks * 1.5);
  h += Math.min(6, st.eco * 0.6);
  h += st.landmarks * 0.8;
  // homes with a grown tree nearby
  let green = 0;
  forEachObj(s, (o, i) => {
    if (!isHousing(o.id)) return;
    let has = false;
    forRadius(i % COLS, (i / COLS) | 0, 2, (x, y, d, j) => {
      const n = s.tiles[j].o;
      if (n && (isTree(n.id) || n.id === 'park') && growthOf(n) >= 0.5) has = true;
    });
    if (has) green++;
  });
  if (st.houses) h += (green / st.houses) * 14;
  if (s.season === 'spring') h -= Math.min(6, countId(s, 'birke') * 0.25);
  if (s.season === 'autumn') h += Math.min(4, countId(s, 'ahorn') * 0.2) - Math.min(8, countId(s, 'ginkgo') * 0.4);
  if (s.money < 0) h -= 8;
  h -= (1 - s.power.ratio) * 30; // blackouts make people grumpy
  h += s.mods.happy;
  return Math.max(0, Math.min(100, h));
}

const targetPop = s => s.stats.capacity * (0.55 + 0.45 * s.happy / 100);

function computeBudget(s) {
  let income = 0, upkeep = 110, wine = 0;
  forEachObj(s, (o, i, t) => {
    const d = CATALOG[o.id];
    if (o.id === 'rebe') {
      if (growthOf(o) >= 1) wine += d.income * (t.g === 'hill' ? 1.5 : 1);
    } else if (d.income) {
      let v = d.income * (o.filter ? 0.9 : 1) * (d.cat === 'industry' ? s.power.ratio : 1);
      if (o.id === 'kohle') v *= s.mods.coal;
      if (o.id === 'weinkeller') {
        forRadius(i % COLS, (i / COLS) | 0, 1.5, (x, y, dd, j) => {
          const n = s.tiles[j].o;
          if (n && n.id === 'rebe' && growthOf(n) >= 1) v += d.perVine;
        });
      }
      income += v;
    }
    if (d.upkeep) upkeep += d.upkeep;
    if (isTree(o.id)) upkeep += 0.6 + (s.season === 'summer' && s.temp > 2.3 ? 0.6 : 0);
  });
  const tax = s.pop / 1000 * 0.85 * s.mods.tax * (0.6 + 0.4 * s.power.ratio);
  const carbon = s.carbonTax * s.stats.Eind;
  const power = s.power.exp * POWER.exportPrice - s.power.imp * POWER.importPrice;
  s.budget = { income: income + wine, tax, upkeep, carbon, power, net: income + wine + tax - upkeep - carbon + power };
}

// ----- the monthly tick ----------------------------------------------------
function tick(s) {
  const headlines = [];
  s.mods = freshMods();
  s.month++; s.elapsed++;
  if (s.month > 11) { s.month = 0; s.year++; }
  s.season = SEASON_OF_MONTH[s.month];
  s.wind = pickWind();

  // Scheduled events
  if (s.year === 2030 && s.month === 0) { s.carbonTax = 6; headlines.push('🇪🇺 The EU CO₂ price has arrived: industry now pays €6 per smog unit each month, and it rises every year. Filters, anyone?'); }
  else if (s.carbonTax > 0 && s.month === 0) { s.carbonTax += 1.5; headlines.push(`💶 The CO₂ price rose to €${s.carbonTax.toFixed(1)} per smog unit.`); }
  if (s.month === 8) { s.money += 400; s.mods.happy += 6; headlines.push('🍷 It\'s Heilbronner Weindorf time! Tourists spend €400 and sing badly. Happiness up.'); }

  // Random event
  if (Math.random() < 0.22) {
    const pool = EVENTS.filter(e => e.when(s));
    if (pool.length) headlines.push(pool[Math.floor(Math.random() * pool.length)].run(s));
  } else if (Math.random() < 0.25) {
    headlines.push('🗞️ ' + FLAVOR_NEWS[Math.floor(Math.random() * FLAVOR_NEWS.length)]);
  }

  // Growth
  forEachObj(s, (o, i, t) => {
    o.age++;
    if (o.id === 'stump' && o.age > 10) t.o = null;
  });

  // Atmosphere (also settles the power balance)
  const wasDark = s.blackout;
  updateFields(s);
  s.blackout = s.power.unserved > 0;
  if (s.blackout && !wasDark) headlines.push(`⚡ BLACKOUT! Heilbronn needs ${s.power.unserved.toFixed(0)} MW more than the grid can deliver. The AI Campus forgot what it was thinking.`);
  if (!s.blackout && wasDark) headlines.push('💡 The lights are back on. The Rathaus clock is still five minutes late, though.');
  const st = s.stats;
  // Trees filter what's in the air: the cleaner it gets, the less there is to catch.
  const uptake = st.A * Math.min(1.3, s.smog / 45);
  s.smog = Math.max(0, Math.min(100, s.smog + (st.E - uptake) * 0.12 - s.smog * 0.01));
  s.temp += (targetTemp(s) - s.temp) * 0.3;
  updateFields(s);

  // Tree stress
  const deaths = {};
  let dead = 0;
  forEachObj(s, (o, i, t) => {
    if (!isTree(o.id)) return;
    const d = CATALOG[o.id];
    let dmg = 0;
    if (Fields.pol[i] > d.polTol) dmg += (Fields.pol[i] - d.polTol) * 0.6;
    if (Fields.heat[i] > d.heatTol) dmg += (Fields.heat[i] - d.heatTol) * 10;
    if (growthOf(o) < 0.3) dmg *= 1.3;
    if (dmg > 0) o.health -= dmg; else o.health = Math.min(100, o.health + 4);
    if (o.health <= 0) {
      deaths[d.name] = (deaths[d.name] || 0) + 1; dead++;
      t.o = { id: 'stump', age: 0, health: 0 };
    }
  });
  if (dead) {
    const list = Object.entries(deaths).map(([n, k]) => `${k} ${n}${k > 1 ? 's' : ''}`).join(', ');
    headlines.push(`🪦 RIP: ${list}. Cause of death: too much heat or smog. They tried their best.`);
    updateFields(s);
  }
  s.stats.deadRecently = dead;

  // People & money
  s.happy += (targetHappiness(s) - s.happy) * 0.35;
  s.pop += (targetPop(s) - s.pop) * 0.08;
  computeBudget(s);
  s.money += s.budget.net;

  s.history.push({ smog: s.smog, temp: s.temp, money: s.money, happy: s.happy });
  if (s.history.length > 400) s.history.shift();

  // Profitmeier
  let offer = null;
  if (--s.nextOffer <= 0) {
    const pool = OFFERS.filter(o => o.when(s));
    offer = pool[Math.floor(Math.random() * pool.length)];
    s.nextOffer = 10 + Math.floor(Math.random() * 7);
  }

  checkEnd(s);
  return { headlines, offer };
}

function pickWind() {
  const total = WINDS.reduce((a, w) => a + w.w, 0);
  let r = Math.random() * total;
  for (const w of WINDS) { if ((r -= w.w) < 0) return w; }
  return WINDS[0];
}

function checkEnd(s) {
  if (s.smog >= 100) s.over = 'smog';
  else if (s.temp >= 4.5) s.over = 'heat';
  else if (s.money < -2500) s.over = 'broke';
  else if (s.pop < 30000) s.over = 'exodus';
  else if (s.year > END_YEAR && !s.endless) s.over = 'end';
}

function finalScore(s) {
  const lost = s.over && s.over !== 'end';
  const score = Math.round((lost ? 0.6 : 1) * ((100 - s.smog) * 3 + (4.5 - s.temp) * 80 + s.happy * 2 +
    s.pop / 2000 + Math.max(0, s.money) / 200 + s.stats.trees * 0.5));
  const ranks = [
    [900, 'Ökologischer Oberbürgermeister des Jahrhunderts', 'Käthchen cried happy tears. They\'re renaming the Neckar after you. (They aren\'t, but they thought about it.)'],
    [700, 'Green Käthchen Champion', 'Clean air, happy people, wine flowing. Stuttgart is officially jealous.'],
    [500, 'Respectable Swabian Mayor', 'Not perfect, but nothing exploded. Grandma approves, quietly.'],
    [300, 'Mediocre Smog Manager', 'Heilbronn survived, more or less. The ducks are still filing complaints.'],
    [-Infinity, 'Baron of Smog', 'Profitmeier sent you a fruit basket. It\'s covered in soot.'],
  ];
  const [, title, blurb] = ranks.find(([min]) => score >= min);
  return { score, title, blurb };
}

const GAME_OVER_TEXT = {
  smog: ['☁️ Smogpocalypse', 'The smog got so thick that the Kilianskirche filed a missing-persons report on itself. Heilbronn is now officially a dumpling.'],
  heat: ['🔥 Neckar Hot Tub', 'It\'s +4.5 °C. The Trollinger turned into mulled wine on the vine and the ducks moved to Norway.'],
  broke: ['💸 Bankrupt', 'The treasury is empty. A Swabian grandmother has taken over the city budget, and honestly that\'s for the best.'],
  exodus: ['🧳 Exodus', 'Everyone moved away. To Stuttgart. Voluntarily. Let that sink in.'],
};

'use strict';
// ---------------------------------------------------------------------------
// Static game data: map size, catalog of things you can build, events, jokes.
// ---------------------------------------------------------------------------

const COLS = 30, ROWS = 20;
const START_YEAR = 2026, END_YEAR = 2050;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_OF_MONTH = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer',
  'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'];
const SEASON_LABEL = { winter: '❄️ Winter', spring: '🌸 Spring', summer: '☀️ Summer', autumn: '🍂 Autumn' };
// Rough monthly mean temperature in Heilbronn (°C) – used for the "today" readout.
const BASE_MONTH_TEMP = [1.5, 2.8, 6.6, 10.6, 14.8, 18.2, 20.1, 19.5, 15.6, 10.6, 5.6, 2.4];

const WINDS = [
  { dx: 1, dy: 0, name: 'from West', arrow: '→', w: 4 },
  { dx: -1, dy: 0, name: 'from East', arrow: '←', w: 1 },
  { dx: 0, dy: 1, name: 'from North', arrow: '↓', w: 1 },
  { dx: 0, dy: -1, name: 'from South', arrow: '↑', w: 1 },
  { dx: 0, dy: 0, name: 'Calm', arrow: '○', w: 1 },
];

// Electricity: shortfalls are imported from the regional grid (costly, a bit
// smoky) up to a connection limit; beyond that the city browns out.
const POWER = {
  importCap: 40, importPrice: 3, exportPrice: 1.2, importSmog: 0.03,
  solar: { winter: 0.45, spring: 1, summer: 1.35, autumn: 0.8 },
  wind: { winter: 1.3, spring: 1, summer: 0.7, autumn: 1.1 },
};

const CATEGORIES = [
  { id: 'trees', label: 'Trees', icon: '🌳' },
  { id: 'industry', label: 'Industry', icon: '🏭' },
  { id: 'green', label: 'Green', icon: '☀️' },
  { id: 'housing', label: 'Housing', icon: '🏠' },
  { id: 'tools', label: 'Tools', icon: '🛠️' },
];

// Fields used by the simulation:
//   cost      one-time price (€)
//   income    € per month          upkeep   € per month
//   emission  smog units per month heat     local heat-island strength
//   absorb    smog removed / month (trees & parks, scaled by growth)
//   cool      shade/cooling strength (scaled by growth)
//   grow      months until mature  polTol / heatTol  tree stress thresholds
//   capacity  residents
//   power     MW per month: > 0 generates, < 0 consumes
const CATALOG = {
  // ----- Trees ------------------------------------------------------------
  birke: {
    cat: 'trees', name: 'Birch', de: 'Birke', icon: '🌿', cost: 30,
    absorb: 0.15, cool: 0.35, grow: 6, polTol: 50, heatTol: 3.0,
    quip: 'Cheap and fast-growing. Fills the air with pollen every spring, so the whole city sneezes.',
  },
  ahorn: {
    cat: 'trees', name: 'Norway Maple', de: 'Spitzahorn', icon: '🍁', cost: 45,
    absorb: 0.22, cool: 0.5, grow: 8, polTol: 60, heatTol: 3.4,
    quip: 'Spectacular red in autumn. Half of Heilbronn\'s Instagram is just this tree.',
  },
  linde: {
    cat: 'trees', name: 'Linden', de: 'Linde', icon: '🌳', cost: 55,
    absorb: 0.26, cool: 0.65, grow: 12, polTol: 60, heatTol: 3.5,
    quip: 'Bees love it. Free honey, free shade, free vibes.',
  },
  platane: {
    cat: 'trees', name: 'Plane Tree', de: 'Platane', icon: '🌲', cost: 85,
    absorb: 0.3, cool: 1.0, grow: 14, polTol: 85, heatTol: 4.3,
    quip: 'Peels like a sunburnt tourist. Handles traffic like a taxi driver.',
  },
  eiche: {
    cat: 'trees', name: 'Oak', de: 'Stieleiche', icon: '🌰', cost: 120,
    absorb: 0.5, cool: 0.9, grow: 24, polTol: 55, heatTol: 3.9,
    quip: 'Grows slower than a building permit, but it is the best smog-eater around.',
  },
  ginkgo: {
    cat: 'trees', name: 'Ginkgo', de: 'Ginkgo', icon: '🪭', cost: 100,
    absorb: 0.24, cool: 0.5, grow: 16, polTol: 110, heatTol: 5.5,
    quip: 'It outlived the dinosaurs and will outlive your coal plant too. Smells like old cheese in autumn.',
  },
  rebe: {
    cat: 'trees', name: 'Trollinger Vine', de: 'Weinrebe', icon: '🍇', cost: 60,
    absorb: 0.08, cool: 0.2, grow: 10, polTol: 45, heatTol: 4.6, income: 4,
    quip: 'Heilbronn\'s liquid gold. Earns +50% on hills and even more next to a Winery.',
  },

  // ----- Industry ---------------------------------------------------------
  kohle: {
    cat: 'industry', name: 'Coal Plant', de: 'Kohlekraftwerk', icon: '🏭', cost: 2500,
    income: 95, emission: 3.0, heat: 5, smoke: true, power: 60,
    quip: 'A 250 m chimney of pure profit and regret. Also keeps the lights on.',
  },
  auto: {
    cat: 'industry', name: 'Car Factory', de: 'Autowerk', icon: '🚗', cost: 1600,
    income: 62, emission: 1.6, heat: 2.5, smoke: true, power: -14,
    quip: 'Builds SUVs. Every one comes with a free cough.',
  },
  schraube: {
    cat: 'industry', name: 'Screw Factory', de: 'Schraubenwerk', icon: '🔩', cost: 900,
    income: 36, emission: 0.9, heat: 1.5, smoke: true, power: -6,
    quip: 'This region makes enough screws to hold the moon together.',
  },
  salz: {
    cat: 'industry', name: 'Salt Mine', de: 'Salzbergwerk', icon: '🧂', cost: 700,
    income: 22, emission: 0.3, heat: 0.3, smoke: true, power: -5,
    quip: 'Salty profits from 200 m below. Very salty.',
  },
  ki: {
    cat: 'industry', name: 'AI Campus', de: 'KI-Campus', icon: '🤖', cost: 3000,
    income: 115, emission: 0.4, heat: 4, power: -30,
    quip: 'The servers think very hard. Thinking is hot, and it eats electricity like Swabians eat Maultaschen.',
  },
  weinkeller: {
    cat: 'industry', name: 'Winery', de: 'Weinkellerei', icon: '🍷', cost: 500,
    income: 8, emission: 0.1, heat: 0.2, perVine: 5, power: -2,
    quip: 'Turns grapes into Trollinger, then Trollinger into happiness. +€5 for each mature vine next to it.',
  },

  // ----- Green ------------------------------------------------------------
  park: {
    cat: 'green', name: 'BUGA Park', de: 'Gartenschau', icon: '🌷', cost: 250,
    absorb: 0.25, cool: 1.3, upkeep: 2,
    quip: 'Bundesgartenschau vibes: flowers, benches and some very suspicious ducks. Makes people happy.',
  },
  solar: {
    cat: 'green', name: 'Solar Field', de: 'Solarfeld', icon: '🔆', cost: 500,
    income: 22, power: 8,
    quip: 'Free money and power from the big lamp in the sky. Strong in summer, sleepy in winter.',
  },
  wind: {
    cat: 'green', name: 'Wind Turbine', de: 'Windrad', icon: '🌀', cost: 800,
    income: 40, power: 12,
    quip: 'Spins and earns. Strongest in winter, useless on calm days. Swabians complain that its shadow is free.',
  },
  wasserkraft: {
    cat: 'green', name: 'Hydro Plant', de: 'Wasserkraftwerk', icon: '💧', cost: 900,
    income: 10, power: 10, upkeep: 4, needsWater: true,
    quip: 'Steady clean power from the Neckar, all year long. Must be built right on the riverbank. The fish get free rides.',
  },
  tram: {
    cat: 'green', name: 'Tram Stop', de: 'Stadtbahn-Halt', icon: '🚋', cost: 350,
    upkeep: 6, power: -4,
    quip: 'Fewer cars, more ding-ding. Housing within 3 tiles pollutes 50% less.',
  },

  // ----- Housing ----------------------------------------------------------
  wohnblock: {
    cat: 'housing', name: 'Housing Block', de: 'Wohnblock', icon: '🏘️', cost: 300,
    capacity: 4000, emission: 0.12, heat: 0.3, smoke: true, power: -1.5,
    quip: '"Schaffe, schaffe, Häusle baue": work, work, build a little house.',
  },
  oeko: {
    cat: 'housing', name: 'Eco Housing', de: 'Öko-Siedlung', icon: '🏡', cost: 650,
    capacity: 3000, emission: 0.02, heat: 0.05, power: -0.5,
    quip: 'Passive houses. The residents compost passive-aggressively. Slightly happier citizens.',
  },

  // ----- Tools (not placeable objects) ------------------------------------
  filter: {
    cat: 'tools', name: 'Smoke Filter', de: 'Rauchfilter', icon: '🧽', costText: '40% of building',
    quip: 'Bolt onto any polluting building: −45% emission, −10% income, and it uses 1 MW. Profitmeier hates it.',
  },
  bulldoze: {
    cat: 'tools', name: 'Bulldozer', de: 'Abrissbirne', icon: '🚜', costText: '10% of building',
    quip: 'Demolish things. Trees and stumps are free. Landmarks are off limits, obviously.',
  },

  // ----- Not buildable ----------------------------------------------------
  stump: { cat: 'misc', name: 'Dead Stump', de: 'Baumstumpf', quip: 'Here lies a tree. It tried its best.' },
  kilian: { cat: 'landmark', name: 'Kilianskirche', quip: 'Heilbronn\'s pride. Its Renaissance tower has seen worse than your city planning.' },
  rathaus: { cat: 'landmark', name: 'Rathaus', quip: 'Town hall with its famous astronomical clock. It is always five minutes to climate midnight.' },
  kaethchen: { cat: 'landmark', name: 'Käthchenhaus', quip: 'Home of the legendary Käthchen von Heilbronn, now your eco advisor.' },
  experimenta: { cat: 'landmark', name: 'Experimenta', power: -2, quip: 'Science center. The kids in there are smarter than the city council.' },
  bahnhof: { cat: 'landmark', name: 'Hauptbahnhof', power: -2, quip: 'Main station. Trains arrive "roughly" on time.' },
  wartturm: { cat: 'landmark', name: 'Wartbergturm', quip: 'Lookout tower among the vineyards. On a clean day you can see Weinsberg.' },
};

const TREE_IDS = Object.keys(CATALOG).filter(k => CATALOG[k].cat === 'trees');
const isTree = id => CATALOG[id] && CATALOG[id].cat === 'trees';
const isHousing = id => CATALOG[id] && CATALOG[id].cat === 'housing';

// ---------------------------------------------------------------------------
// Random monthly events. `when(s)` gates them, `run(s)` applies and returns
// the headline.
// ---------------------------------------------------------------------------
const EVENTS = [
  {
    id: 'heatwave', when: s => s.season === 'summer',
    run: s => { s.mods.heatwave = 1.3; return '🔥 Heat wave! The Kilianskirche tower was seen sweating. Young trees are very thirsty.'; },
  },
  {
    id: 'bees', when: s => countMature(s, 'linde') >= 4 && s.season !== 'winter',
    run: s => { const n = countMature(s, 'linde'); const v = n * 8; s.money += v; return `🐝 Your linden trees hosted a bee rave. Honey sales: +€${v}.`; },
  },
  {
    id: 'robot', when: () => true,
    run: s => { s.smog = Math.max(0, s.smog - 3); return '🤖 Experimenta kids built a smog-eating robot. It also ate a bench. Smog −3.'; },
  },
  {
    id: 'tramfail', when: () => true,
    run: s => { s.smog += 2; return '🚋 The Stadtbahn broke down and everyone drove to work. Smog +2.'; },
  },
  {
    id: 'eugrant', when: s => s.stats.trees >= 40,
    run: s => { s.money += 800; return '🇪🇺 Brussels noticed your trees! Green grant: +€800.'; },
  },
  {
    id: 'thrift', when: () => true,
    run: s => { s.mods.tax = 0.5; return '🐷 Collective Swabian thriftiness: nobody is buying anything. Tax income halved this month.'; },
  },
  {
    id: 'storks', when: s => s.smog < 45,
    run: s => { s.mods.happy += 4; return '🪶 A stork couple moved into the Neckar wetlands. The whole city is cooing.'; },
  },
  {
    id: 'flood', when: s => s.season === 'spring',
    run: s => {
      const guards = countRiversideTrees(s);
      if (guards >= 8) { s.money -= 50; return `🌊 The Neckar flooded, but your ${guards} riverside trees held the banks. Cleanup: −€50.`; }
      s.money -= 350; return '🌊 The Neckar flooded the riverside. Trees along the banks would have helped. Cleanup: −€350.';
    },
  },
  {
    id: 'software', when: s => countId(s, 'auto') > 0,
    run: s => { s.smog += 3; s.money += 200; return '🚗 The car factory "accidentally" updated its emissions software. Profit +€200, smog +3.'; },
  },
  {
    id: 'roadsalt', when: s => s.season === 'winter' && countId(s, 'salz') > 0,
    run: s => { const v = 250 * countId(s, 'salz'); s.money += v; return `🧂 Icy winter, and road salt is sold out everywhere! Salt mine bonus: +€${v}.`; },
  },
  {
    id: 'coalcrash', when: s => countId(s, 'kohle') > 0,
    run: s => { s.mods.coal = 0.4; return '📉 Coal prices crashed. Your coal plants barely earn anything this month.'; },
  },
  {
    id: 'scooters', when: () => true,
    run: s => { s.smog = Math.max(0, s.smog - 1); s.mods.happy -= 1; return '🛴 E-scooters have invaded the Allee and nobody knows who rents them. Smog −1, dignity −5.'; },
  },
  {
    id: 'heatpumps', when: s => s.season === 'winter',
    run: s => { s.mods.power -= 8; return '🥶 Cold snap! Every heat pump in town is running flat out. Power demand +8 MW this month.'; },
  },
  {
    id: 'ac', when: s => s.season === 'summer' && s.temp > 2.4,
    run: s => { s.mods.power -= 10; return '🥵 Air conditioners everywhere! Power demand +10 MW. Trees are cheaper than AC, just saying.'; },
  },
  {
    id: 'theater', when: () => true,
    run: s => { s.mods.happy += 3; return '🎭 Sold-out run of "Das Käthchen von Heilbronn" at the theater. Happiness +3.'; },
  },
  {
    id: 'pollen', when: s => s.season === 'spring' && countId(s, 'birke') >= 5,
    run: () => '🤧 Birch pollen apocalypse! The pharmacy sold out of tissues by 9 a.m.',
  },
  {
    id: 'ginkgo', when: s => s.season === 'autumn' && countId(s, 'ginkgo') >= 3,
    run: () => '🧀 Ginkgo season: the whole city smells faintly of old cheese. Tourists are confused.',
  },
];

const FLAVOR_NEWS = [
  'Local man insists that Trollinger counts as a vegetable.',
  'A tourist on the Wartbergturm asked where the sea is. They were told to wait until 2080.',
  'The Neckar ducks have unionized and demand cleaner water.',
  'Experimenta announces a new exhibit: "Air — what was it like?"',
  'Survey: 87% of Heilbronners would hug a tree if nobody was watching.',
  'Witnesses say the Käthchen statue rolled its eyes at a new parking lot.',
  'Swabian grandmother saves €0.03 by drying tea bags. Again.',
  'Stuttgart denies being jealous of Heilbronn\'s tree count. Sources say it is very jealous.',
  'The Rathaus clock is still running five minutes late. "It\'s artistic," says the mayor\'s office.',
  'New study shows people in Heilbronn sneeze 40% more politely than people in Mannheim.',
  'Weinsberg asks Heilbronn to "please aim the smoke somewhere else".',
  'Kilianskirche bells now ring a little more urgently whenever the smog rises.',
];

// Herr Profitmeier's tempting offers. `when` gates, `accept` returns headline.
const OFFERS = [
  {
    id: 'freecoal', title: 'A Gift of Coal',
    text: '"Mayor! A brand-new coal plant, on the house! Plus a <b>€1,200 signing bonus</b>. What could possibly go wrong?"',
    effects: '+€1,200 · free Coal Plant (+€95/mo, lots of smog)',
    when: () => true,
    accept: s => { const t = placeRandom(s, 'kohle', 'north'); s.money += 1200; return t ? '🏭 Profitmeier\'s gift coal plant opened. The chimney waves at you.' : '🏭 There was no room for the coal plant, but Profitmeier paid anyway. Weird guy.'; },
  },
  {
    id: 'megafactory', title: 'SUV Megafactory',
    text: '"Picture this: <b>bigger</b> cars, built right <b>here</b>. I\'ll throw in <b>€600</b> for your trouble."',
    effects: '+€600 · free Car Factory',
    when: () => true,
    accept: s => { placeRandom(s, 'auto', 'any'); s.money += 600; return '🚗 A new SUV factory opened. Its first car is already stuck in traffic.'; },
  },
  {
    id: 'parking', title: 'Parking Paradise',
    text: '"Those trees are blocking some <i>premium</i> parking spots. Chop six and I\'ll pay <b>€700</b>. Trees grow back, right?"',
    effects: '+€700 · 6 random mature trees cut down',
    when: s => s.stats.matureTrees >= 6,
    accept: s => { chopRandomTrees(s, 6); s.money += 700; return '🅿️ Six trees became parking spots. The ducks are filing a complaint.'; },
  },
  {
    id: 'diesel', title: 'Diesel Weindorf Sponsorship',
    text: '"Let my company sponsor the Weindorf! Free diesel generators for every wine stand. <b>€500</b> cash right now!"',
    effects: '+€500 · smog +6',
    when: () => true,
    accept: s => { s.money += 500; s.smog += 6; return '⛽ The Weindorf is now powered by diesel. The Trollinger tastes a bit like exhaust this year.'; },
  },
  {
    id: 'filterholiday', title: 'Filter Holiday',
    text: '"Those smoke filters cost us so much efficiency. Pull them all out and I\'ll pay <b>€250 per filter</b>."',
    effects: '+€250 per filter · every smoke filter removed',
    when: s => countFilters(s) >= 1,
    accept: s => { const n = removeAllFilters(s); s.money += n * 250; return `🧽 ${n} smoke filter(s) went to the scrapyard. The sky darkens slightly.`; },
  },
];

const ACHIEVEMENTS = [
  { id: 'firstTree', title: 'First Sprout', desc: 'You planted your first tree.', check: s => s.planted >= 1 },
  { id: 'trees50', title: 'Treehugger', desc: '50 trees growing in Heilbronn.', check: s => s.stats.trees >= 50 },
  { id: 'trees150', title: 'Black Forest Junior', desc: '150 trees, and Stuttgart is nervous.', check: s => s.stats.trees >= 150 },
  { id: 'coalFree', title: 'Coal? Never Heard of Her', desc: 'Heilbronn has no coal plants left.', check: s => countId(s, 'kohle') === 0 },
  { id: 'rich', title: 'Swabian Savings Champion', desc: 'You have €20,000 in the treasury.', check: s => s.money >= 20000 },
  { id: 'clean', title: 'Crystal Neckar', desc: 'Smog below 10.', check: s => s.smog < 10 },
  { id: 'vines', title: 'Wine Baron', desc: '20 Trollinger vines planted.', check: s => countId(s, 'rebe') >= 20 },
  { id: 'energiewende', title: 'Energiewende', desc: 'No coal, and the city still makes all its own power.', check: s => countId(s, 'kohle') === 0 && s.power && s.power.gen >= s.power.use },
  { id: 'nofilter', title: 'Profitmeier\'s Nightmare', desc: 'You turned down 3 of Profitmeier\'s offers.', check: s => s.declined >= 3 },
];

// Käthchen's advice, picked by priority from the current state.
function kaethchenSays(s) {
  const lines = [];
  if (s.smog > 75) lines.push('I can\'t see the Kilianskirche anymore. Either it\'s the smog, or someone stole it. Plant trees next to the factories!');
  if (s.temp > 3.6) lines.push('The Neckar is basically a hot tub now. The ducks have opened a spa. We need shade: Plane Trees and Parks!');
  if (s.money < 0) lines.push('We\'re in debt. Even the Swabian grandmas are judging us. Maybe one clean industry? A Salt Mine or Solar?');
  if (s.stats.deadRecently > 0) lines.push('Trees are dying near the hot, smoky spots. Ginkgos and Plane Trees are tough enough for those.');
  if (s.carbonTax > 0 && countFilters(s) === 0 && s.stats.industry > 0) lines.push('The CO₂ price is eating our profits. Smoke filters pay for themselves!');
  if (s.power && s.power.unserved > 0) lines.push('Blackout! We need more power than the grid can import. Wind turbines, solar fields or a hydro plant on the Neckar, please!');
  else if (s.power && s.power.imp > 15) lines.push(`We're importing ${s.power.imp.toFixed(0)} MW of grey power. That costs money and makes smog somewhere. Our own renewables would pay off.`);
  if (s.happy < 35) lines.push('Citizens are grumpy. Parks, trees near homes and less smog make people happy.');
  if (s.stats.trees < 25) lines.push('Trees are nature\'s air conditioners, and they never need a software update.');
  if (s.stats.trams === 0) lines.push('A Tram Stop in a dense neighborhood cuts the housing smog in half. Ding-ding!');
  if (s.smog < 20 && s.temp < 2.5) lines.push('The air is so clean you can smell the Trollinger all the way from the Wartberg. Proud of you!');
  lines.push('Tip: the wind pushes smog around. Watch the Smog overlay and plant downwind of the chimneys.');
  lines.push('Oaks grow slowly but eat the most smog. Plant them early, and future-you will say thanks.');
  lines.push('Vines on the Wartberg next to a Winery are an eco-friendly money machine.');
  return lines;
}

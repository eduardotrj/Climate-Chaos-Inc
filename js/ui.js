'use strict';
// ---------------------------------------------------------------------------
// DOM UI: stats bar, build menu, info panels, advisor, news, modals, input.
// ---------------------------------------------------------------------------

const $ = sel => document.querySelector(sel);
const UI = { tool: null, tab: 'trees', overlay: 'none', hover: null, speed: 1, painting: false, lastPaint: -1 };

const fmtMoney = v => (v < 0 ? '−€' : '€') + Math.abs(Math.round(v)).toLocaleString('en-US');
const fmtSigned = v => (v >= 0 ? '+' : '−') + '€' + Math.abs(Math.round(v)).toLocaleString('en-US');

function statLine(d) {
  const p = [];
  if (d.income) p.push(`+€${d.income}/mo`);
  if (d.upkeep) p.push(`−€${d.upkeep}/mo`);
  if (d.emission) p.push(`☁️ ${d.emission}`);
  if (d.absorb) p.push(`🍃 −${d.absorb}`);
  if (d.cool) p.push(`❄️ ${d.cool}`);
  if (d.heat) p.push(`🔥 ${d.heat}`);
  if (d.capacity) p.push(`👥 ${d.capacity / 1000}k`);
  if (d.power) p.push(`⚡ ${d.power > 0 ? '+' : '−'}${Math.abs(d.power)}`);
  if (d.grow) p.push(`⏳ ${d.grow} mo`);
  return p.join(' · ');
}

// ----- build menu ----------------------------------------------------------
function buildTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  CATEGORIES.forEach(cat => {
    const b = document.createElement('button');
    b.className = 'tab' + (UI.tab === cat.id ? ' active' : '');
    b.innerHTML = `<span>${cat.icon}</span><small>${cat.label}</small>`;
    b.onclick = () => { UI.tab = cat.id; buildTabs(); buildList(); };
    tabs.appendChild(b);
  });
}

function buildList() {
  const list = $('#build-list');
  list.innerHTML = '';
  Object.entries(CATALOG).filter(([, d]) => d.cat === UI.tab).forEach(([id, d], n) => {
    const b = document.createElement('button');
    b.className = 'card' + (UI.tool === id ? ' selected' : '');
    b.dataset.id = id;
    b.innerHTML = `
      <span class="card-icon">${d.icon}</span>
      <span class="card-body">
        <span class="card-title">${d.name} <em>${d.de}</em></span>
        <span class="card-stats">${statLine(d) || d.costText}</span>
      </span>
      <span class="card-cost">${d.cost != null ? '€' + d.cost : ''}</span>
      ${n < 9 ? `<kbd>${n + 1}</kbd>` : ''}`;
    b.onclick = () => selectTool(UI.tool === id ? null : id);
    list.appendChild(b);
  });
  refreshAffordability();
}

function refreshAffordability() {
  document.querySelectorAll('#build-list .card').forEach(el => {
    const d = CATALOG[el.dataset.id];
    el.classList.toggle('poor', d.cost != null && Game.s.money < d.cost);
  });
}

function selectTool(id) {
  UI.tool = id;
  Render.canvas.classList.toggle('pan', !id);
  document.querySelectorAll('#build-list .card').forEach(el => el.classList.toggle('selected', el.dataset.id === id));
  renderToolInfo();
}

function renderToolInfo() {
  const el = $('#tool-info');
  if (!UI.tool) { el.innerHTML = '<p class="muted">Pick something to build, then click the map. Hold and drag to plant whole rows of trees.</p>'; return; }
  const d = CATALOG[UI.tool];
  let extra = '';
  if (d.cat === 'trees') extra = `<div class="tol"><span>☁️ Smog tolerance <b>${d.polTol}</b></span><span>🌡️ Heat tolerance <b>+${d.heatTol} °C</b></span></div>`;
  el.innerHTML = `<h3>${d.icon} ${d.name} <em>${d.de}</em></h3><p>${d.quip}</p>${extra}`;
}

// ----- tile info -----------------------------------------------------------
function renderTileInfo() {
  const el = $('#tile-info'), s = Game.s;
  if (!UI.hover || !UI.mouse || UI.panning) { el.hidden = true; return; }
  const { c, r } = UI.hover, i = idx(c, r), t = s.tiles[i];
  const groundName = { grass: 'Meadow', hill: 'Wartberg slope (vines +50%)', water: 'The Neckar', bridge: 'Neckar bridge', road: 'Road' }[t.g];
  let title = groundName, body = '';
  if (t.o) {
    const d = CATALOG[t.o.id];
    title = `${d.icon || '📍'} ${d.name}`;
    if (isTree(t.o.id)) {
      const g = Math.round(growthOf(t.o) * 100), hp = Math.max(0, Math.round(t.o.health));
      body += `<div class="meter"><span>Growth</span><i style="--v:${g}%;--c:var(--good)"></i><b>${g}%</b></div>`;
      body += `<div class="meter"><span>Health</span><i style="--v:${hp}%;--c:${hp > 60 ? 'var(--good)' : hp > 30 ? 'var(--warn)' : 'var(--bad)'}"></i><b>${hp}%</b></div>`;
    }
    const pw = powerOf(s, t.o);
    if (pw) body += `<p class="tag">⚡ ${pw > 0 ? 'Makes' : 'Uses'} ${Math.abs(pw).toFixed(1)} MW</p> `;
    if (t.o.filter) body += '<p class="tag">🧽 Smoke filter installed</p>';
    if (d.cat === 'landmark' || t.o.id === 'stump') body += `<p class="muted">${d.quip}</p>`;
  }
  const lp = Fields.pol[i], lh = Fields.heat[i];
  body += `<div class="local"><span>☁️ Local smog <b>${lp.toFixed(0)}</b></span><span>🌡️ Local heat <b>+${lh.toFixed(1)} °C</b></span></div>`;
  el.innerHTML = `<h3>${title}</h3>${body}`;
  el.hidden = false;
  // follow the cursor, flipping sides near the screen edges
  const pad = 18, w = el.offsetWidth, h = el.offsetHeight;
  let x = UI.mouse.x + pad, y = UI.mouse.y + pad;
  if (x + w > window.innerWidth - 8) x = UI.mouse.x - w - pad;
  if (y + h > window.innerHeight - 8) y = UI.mouse.y - h - pad;
  el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px';
}

// ----- stats ---------------------------------------------------------------
function renderStats() {
  const s = Game.s, b = s.budget;
  $('#st-money').textContent = fmtMoney(s.money);
  $('#st-money').classList.toggle('neg', s.money < 0);
  $('#st-money-sub').textContent = `${fmtSigned(b.net)}/mo`;
  $('#st-money-sub').title = `Income ${fmtMoney(b.income)} · Taxes ${fmtMoney(b.tax)} · Upkeep −${fmtMoney(b.upkeep)}` +
    (b.power ? ` · Electricity ${fmtSigned(b.power)}` : '') + (b.carbon ? ` · CO₂ price −${fmtMoney(b.carbon)}` : '');
  setBar('#st-smog', s.smog, s.smog.toFixed(0), s.smog > 70 ? 'bad' : s.smog > 40 ? 'warn' : 'good');
  setBar('#st-happy', s.happy, s.happy.toFixed(0), s.happy < 30 ? 'bad' : s.happy < 55 ? 'warn' : 'good');
  $('#st-temp').textContent = `+${s.temp.toFixed(2)} °C`;
  $('#st-temp').className = 'val ' + (s.temp > 3.7 ? 'bad' : s.temp > 2.8 ? 'warn' : '');
  const today = BASE_MONTH_TEMP[s.month] + (s.temp - 1.2) + s.mods.heatwave * 3;
  $('#st-temp-sub').textContent = `${MONTHS[s.month]} avg ${today.toFixed(1)} °C`;
  $('#st-pop').textContent = `${(s.pop / 1000).toFixed(1)}k`;
  $('#st-pop-sub').textContent = `of ${(s.stats.capacity / 1000).toFixed(0)}k homes`;
  $('#st-date').textContent = `${MONTHS[s.month]} ${s.year}`;
  $('#st-season').textContent = `${SEASON_LABEL[s.season]} · ${s.wind.arrow} ${s.wind.name}`;
  $('#st-net').textContent = `☁️ +${s.stats.E.toFixed(1)} / 🍃 −${s.stats.A.toFixed(1)} · 🌳 ${s.stats.trees}`;
  $('#st-net').title = `Smog emitted vs. absorbed per month, number of trees` + (s.carbonTax ? ` · CO₂ price €${s.carbonTax.toFixed(1)} per unit` : '');
  renderPower();
  refreshAffordability();
}

// Vertical gauge in the build menu. Stacked from the bottom: power made and used
// locally, surplus sold, imports, and demand nobody can serve (blackout).
function renderPower() {
  const p = Game.s.power, el = $('#power');
  const top = Math.max(p.gen, p.use, 20) * 1.15;
  const pct = v => (v / top * 100) + '%';
  const seg = (sel, from, size) => { const i = el.querySelector(sel); i.style.setProperty('--b', pct(from)); i.style.setProperty('--h', pct(size)); };
  const local = Math.min(p.gen, p.use);
  seg('.pw-local', 0, local);
  seg('.pw-surplus', local, p.exp);
  seg('.pw-import', local, p.imp);
  seg('.pw-dark', local + p.imp, p.unserved);
  el.querySelector('.pw-demand').style.setProperty('--b', pct(p.use));
  const state = p.unserved > 0 ? 'dark' : p.imp > 0 ? 'short' : '';
  el.className = 'power ' + state;
  $('#power-num').textContent = Math.round(p.gen - p.use) > 0 ? '+' + Math.round(p.gen - p.use) : Math.round(p.gen - p.use);
  const status = p.unserved > 0 ? `BLACKOUT: ${p.unserved.toFixed(1)} MW unserved (grid import maxed at ${POWER.importCap} MW)`
    : p.imp > 0 ? `Importing ${p.imp.toFixed(1)} MW (−€${(p.imp * POWER.importPrice).toFixed(0)}/mo, a little smog)`
    : `Selling ${p.exp.toFixed(1)} MW surplus (+€${(p.exp * POWER.exportPrice).toFixed(0)}/mo)`;
  el.title = `Electricity
Generated: ${p.gen.toFixed(1)} MW
Demand: ${p.use.toFixed(1)} MW (black line)
${status}`;
  const sum = $('#power-sum');
  sum.textContent = `⚡ ${p.gen.toFixed(0)} / ${p.use.toFixed(0)} MW`;
  sum.className = 'power-sum ' + state;
  sum.title = status;
}

function setBar(sel, v, text, cls) {
  const el = $(sel);
  el.querySelector('i').style.setProperty('--v', Math.max(0, Math.min(100, v)) + '%');
  el.querySelector('b').textContent = text;
  el.dataset.level = cls;
}

// ----- news & advisor ------------------------------------------------------
function pushNews(text) {
  const s = Game.s;
  s.news.unshift({ d: `${MONTHS[s.month]} ${s.year}`, text });
  if (s.news.length > 40) s.news.pop();
  renderNews(true);
}

function renderNews(fresh) {
  const s = Game.s;
  $('#news').innerHTML = s.news.slice(0, 12).map((n, k) => `<li${fresh && !k ? ' class="fresh"' : ''}><time>${n.d}</time>${n.text}</li>`).join('')
    || '<li>📰 <b>Neckar Gossip Gazette:</b> Welcome, Bürgermeister! Nothing has happened yet. Suspicious.</li>';
  $('#news').scrollTop = 0;
}

function updateAdvisor(force) {
  const s = Game.s;
  const lines = kaethchenSays(s);
  // rotate tips every few months, but react right away when the most urgent topic changes
  const changed = lines[0] !== UI.advisorTop;
  if (!force && !changed && s.elapsed % 3 !== 0) return;
  UI.advisorTop = lines[0];
  const top = lines.slice(0, Math.min(2, lines.length));
  $('#advisor-text').textContent = changed ? lines[0] : top[Math.floor(Math.random() * top.length)];
}

// ----- toasts & modals -----------------------------------------------------
function toast(text, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.innerHTML = text;
  $('#toasts').appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

function showModal({ html, buttons, cls }) {
  const m = $('#modal');
  $('#modal-card').className = 'modal-card ' + (cls || '');
  $('#modal-body').innerHTML = html;
  const bar = $('#modal-buttons');
  bar.innerHTML = '';
  buttons.forEach(btn => {
    const b = document.createElement('button');
    b.className = 'btn ' + (btn.cls || '');
    b.innerHTML = btn.label;
    b.onclick = () => { hideModal(); btn.onClick && btn.onClick(); };
    bar.appendChild(b);
  });
  m.hidden = false;
  Game.modalOpen = true;
  bar.querySelector('button')?.focus();
}
function hideModal() { $('#modal').hidden = true; Game.modalOpen = false; }

const PORTRAIT_KAETHCHEN = `<svg viewBox="0 0 64 64" class="portrait" aria-hidden="true">
  <circle cx="32" cy="32" r="31" fill="#cfe9c0"/>
  <path d="M14 30c0-12 8-20 18-20s18 8 18 20l-2 18H16z" fill="#c9893f"/>
  <circle cx="32" cy="32" r="13" fill="#f6d2b4"/>
  <path d="M19 29c2-9 7-13 13-13s11 4 13 13c-5-4-9-6-13-6s-8 2-13 6z" fill="#c9893f"/>
  <circle cx="27" cy="33" r="1.7" fill="#3a2a20"/><circle cx="37" cy="33" r="1.7" fill="#3a2a20"/>
  <path d="M27 39c3 3 7 3 10 0" stroke="#a0463a" stroke-width="1.8" fill="none" stroke-linecap="round"/>
  <circle cx="24" cy="37" r="2" fill="#f2a5a0" opacity=".7"/><circle cx="40" cy="37" r="2" fill="#f2a5a0" opacity=".7"/>
  <g fill="#ff7eb6"><circle cx="20" cy="20" r="3"/><circle cx="32" cy="15" r="3"/><circle cx="44" cy="20" r="3"/></g>
  <g fill="#6ab04c"><circle cx="26" cy="17" r="2"/><circle cx="38" cy="17" r="2"/></g>
  <path d="M18 52c4-6 9-8 14-8s10 2 14 8" fill="#5aa046"/>
</svg>`;

const PORTRAIT_PROFITMEIER = `<svg viewBox="0 0 64 64" class="portrait" aria-hidden="true">
  <circle cx="32" cy="32" r="31" fill="#e9dcc0"/>
  <rect x="20" y="6" width="24" height="16" rx="2" fill="#2b2b2b"/><rect x="14" y="20" width="36" height="4" rx="2" fill="#2b2b2b"/>
  <rect x="20" y="17" width="24" height="3" fill="#b8860b"/>
  <circle cx="32" cy="36" r="13" fill="#f1c9a5"/>
  <circle cx="27" cy="34" r="1.7" fill="#2b2b2b"/><circle cx="37" cy="34" r="4" fill="none" stroke="#b8860b" stroke-width="1.5"/><circle cx="37" cy="34" r="1.7" fill="#2b2b2b"/>
  <path d="M41 37l3 10" stroke="#b8860b" stroke-width="1"/>
  <path d="M23 41c3-2 6-2 9 0 3-2 6-2 9 0-2 3-6 3-9 1-3 2-7 2-9-1z" fill="#4a3426"/>
  <path d="M16 56c4-6 10-8 16-8s12 2 16 8" fill="#3b4a6b"/><path d="M30 48l2 6 2-6z" fill="#c0392b"/>
</svg>`;

function showOffer(offer) {
  const s = Game.s;
  showModal({
    cls: 'offer',
    html: `<div class="speaker">${PORTRAIT_PROFITMEIER}<div><h2>Herr Profitmeier has an offer</h2><small>Lobbyist, Profitmeier Holdings GmbH &amp; Co. KG &amp; Co.</small></div></div>
      <h3>${offer.title}</h3><p class="quote">${offer.text}</p><p class="effects">${offer.effects}</p>`,
    buttons: [
      { label: '💰 Deal!', cls: 'danger', onClick: () => { pushNews(offer.accept(s)); afterChange(); } },
      { label: '🌳 No thanks', cls: 'primary', onClick: () => {
        s.declined++; s.happy = Math.min(100, s.happy + 3);
        pushNews('🌳 You turned down Profitmeier. Käthchen nods approvingly. Profitmeier mutters "you\'ll regret this, Bürgermeister".');
        afterChange();
      } },
    ],
  });
}

// ----- input ---------------------------------------------------------------
// Pointer position in view units (CSS px relative to the canvas).
function canvasPoint(e) {
  const rect = Render.canvas.getBoundingClientRect();
  return [e.clientX - rect.left, e.clientY - rect.top];
}
const tileFromEvent = e => pickTile(...canvasPoint(e));

function tryApply(c, r, quiet) {
  const s = Game.s;
  if (!UI.tool || s.over) return;
  const res = applyTool(s, UI.tool, c, r);
  if (res.error) { if (!quiet) toast(res.error, 'err'); return; }
  if (res.msg) toast(res.msg);
  afterChange();
}

function bindInput() {
  const cv = Render.canvas;
  let pan = null; // { x, y, moved, button }
  cv.addEventListener('pointermove', e => {
    UI.mouse = { x: e.clientX, y: e.clientY };
    if (pan) {
      const [x, y] = canvasPoint(e);
      if (Math.hypot(x - pan.x, y - pan.y) > 4) pan.moved = UI.panning = true;
      if (pan.moved) { camPan(x - pan.x, y - pan.y); pan.x = x; pan.y = y; }
    }
    UI.hover = tileFromEvent(e);
    if (UI.painting && UI.hover) {
      const key = idx(UI.hover.c, UI.hover.r);
      if (key !== UI.lastPaint) { UI.lastPaint = key; tryApply(UI.hover.c, UI.hover.r, true); }
    }
    renderTileInfo();
  });
  cv.addEventListener('pointerleave', () => { UI.hover = null; UI.mouse = null; renderTileInfo(); });
  cv.addEventListener('pointerdown', e => {
    const t = tileFromEvent(e);
    UI.hover = t;
    // right/middle drag – or left drag with no tool – pans the camera
    if (e.button !== 0 || !UI.tool) {
      const [x, y] = canvasPoint(e);
      pan = { x, y, moved: false, button: e.button };
      cv.setPointerCapture(e.pointerId);
      return;
    }
    if (!t) return;
    const paintable = isTree(UI.tool) || UI.tool === 'bulldoze' || UI.tool === 'park' || UI.tool === 'solar';
    UI.painting = paintable; UI.lastPaint = idx(t.c, t.r);
    if (paintable) cv.setPointerCapture(e.pointerId);
    tryApply(t.c, t.r, false);
    renderTileInfo();
  });
  window.addEventListener('pointerup', () => {
    if (pan && !pan.moved && pan.button === 2) selectTool(null); // right-click deselects
    pan = null; UI.painting = UI.panning = false;
  });
  cv.addEventListener('contextmenu', e => e.preventDefault());
  cv.addEventListener('wheel', e => {
    e.preventDefault();
    camZoomAt(...canvasPoint(e), Math.exp(-e.deltaY * 0.0015));
    UI.hover = tileFromEvent(e);
  }, { passive: false });
  document.querySelectorAll('[data-zoom]').forEach(b => b.onclick = () => {
    if (b.dataset.zoom === 'fit') camFit();
    else camZoomAt(...safeCenter(), b.dataset.zoom === 'in' ? 1.25 : 0.8);
  });
  $('#btn-collapse').onclick = () => setBuildCollapsed(!$('#hud-right').classList.contains('collapsed'));
  new ResizeObserver(layoutHud).observe($('#hud-top'));
  window.addEventListener('resize', () => { renderResize(); layoutHud(); });

  document.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => setSpeed(+b.dataset.speed));
  document.querySelectorAll('[data-overlay]').forEach(b => b.onclick = () => setOverlay(b.dataset.overlay));
  $('#btn-new').onclick = () => confirmNewGame();

  window.addEventListener('keydown', e => {
    if (Game.modalOpen || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); setSpeed(UI.speed ? 0 : (UI.prevSpeed || 1)); }
    else if (e.key === 'Escape') selectTool(null);
    else if (e.key === 'b' || e.key === 'B') { UI.tab = 'tools'; buildTabs(); buildList(); selectTool('bulldoze'); }
    else if (e.key === 'o' || e.key === 'O') setOverlay({ none: 'smog', smog: 'heat', heat: 'none' }[UI.overlay]);
    else if (e.key === '+' || e.key === '=') camZoomAt(...safeCenter(), 1.2);
    else if (e.key === '-') camZoomAt(...safeCenter(), 1 / 1.2);
    else if (PAN_KEYS[e.key]) { e.preventDefault(); camPan(...PAN_KEYS[e.key]); }
    else if (/^[1-9]$/.test(e.key)) {
      const cards = document.querySelectorAll('#build-list .card');
      const el = cards[+e.key - 1];
      if (el) selectTool(el.dataset.id);
    }
  });
}

// Measure the floating panels so the map knows which part of the view is free.
function layoutHud() {
  const top = $('#hud-top').getBoundingClientRect(), side = $('#hud-right').getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight, gap = 10;
  document.documentElement.style.setProperty('--top-h', Math.round(top.bottom + gap) + 'px');
  const sheet = side.left < vw * 0.3; // phone layout: build menu is a bottom sheet
  Render.safe = {
    l: 12, t: top.bottom + 4,
    r: sheet ? 12 : vw - side.left + 4,
    b: sheet ? vh - side.top + 4 : 12,
  };
}

function setBuildCollapsed(on) {
  $('#hud-right').classList.toggle('collapsed', on);
  const b = $('#btn-collapse');
  b.textContent = on ? '⟨' : '⟩';
  b.title = on ? 'Show build menu' : 'Hide build menu';
  b.setAttribute('aria-expanded', String(!on));
  layoutHud();
}

const PAN_KEYS = {
  ArrowLeft: [60, 0], a: [60, 0], ArrowRight: [-60, 0], d: [-60, 0],
  ArrowUp: [0, 60], w: [0, 60], ArrowDown: [0, -60], s: [0, -60],
};

function setSpeed(v) {
  if (v === 0 && UI.speed) UI.prevSpeed = UI.speed;
  UI.speed = v;
  document.querySelectorAll('[data-speed]').forEach(b => b.classList.toggle('active', +b.dataset.speed === v));
}
function setOverlay(v) {
  UI.overlay = v;
  document.querySelectorAll('[data-overlay]').forEach(b => b.classList.toggle('active', b.dataset.overlay === v));
  $('#legend').hidden = v === 'none';
  $('#legend').className = 'legend ' + v;
  $('#legend-label').textContent = v === 'smog' ? 'Local smog: clean → filthy' : 'Local heat: cool → toasty';
}

// Called after anything changes the state outside the monthly tick.
function afterChange() {
  computeBudget(Game.s);
  checkAchievements();
  updateAdvisor(false);
  renderStats();
  renderTileInfo();
}

function checkAchievements() {
  const s = Game.s;
  ACHIEVEMENTS.forEach(a => {
    if (!s.achievements[a.id] && a.check(s)) {
      s.achievements[a.id] = true;
      toast(`🏆 <b>${a.title}</b><br>${a.desc}`, 'gold');
      pushNews(`🏆 Achievement unlocked: ${a.title}!`);
    }
  });
}

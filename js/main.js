'use strict';
// ---------------------------------------------------------------------------
// Boot, game loop, save/load.
// ---------------------------------------------------------------------------

const MONTH_MS = 2500; // one month at 1× speed
const SAVE_KEY = 'climate-chaos-heilbronn-v1';
const Game = { s: null, acc: 0, last: 0, modalOpen: false };

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(Game.s)); } catch (e) { /* storage unavailable */ }
}
function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (s.version !== 1 || s.over) return null;
    s.wind = WINDS.find(w => w.name === s.wind.name) || WINDS[0];
    return s;
  } catch (e) { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ } }

function startGame(s) {
  Game.s = s;
  Game.acc = 0;
  Render.groundKey = '';
  Render.Z = null;
  layoutHud();
  camFocus(16, 9, 1.6); // start zoomed in on the Altstadt
  Render.particles.length = 0;
  updateFields(s);
  computeBudget(s);
  buildTabs(); buildList(); renderToolInfo();
  renderStats(); renderNews(); renderTileInfo(); updateAdvisor(true);
  renderTrend($('#trend'), s);
  setSpeed(1);
}

function monthPassed() {
  const s = Game.s;
  const { headlines, offer } = tick(s);
  headlines.forEach(pushNews);
  checkAchievements();
  updateAdvisor(false);
  renderStats(); renderTileInfo();
  renderTrend($('#trend'), s);
  if (s.elapsed % 6 === 0) save();
  if (s.over) { gameOver(); return; }
  if (offer) showOffer(offer);
}

function loop(now) {
  const dt = Math.min(0.1, (now - (Game.last || now)) / 1000);
  Game.last = now;
  const s = Game.s;
  if (s && !Game.modalOpen && !s.over && UI.speed > 0) {
    Game.acc += dt * 1000 * UI.speed;
    if (Game.acc >= MONTH_MS) { Game.acc -= MONTH_MS; monthPassed(); }
  }
  if (s) {
    renderFrame(s, UI, dt);
    $('#month-progress').style.setProperty('--v', (Game.acc / MONTH_MS * 100) + '%');
  }
  requestAnimationFrame(loop);
}

function gameOver() {
  const s = Game.s;
  clearSave();
  const { score, title, blurb } = finalScore(s);
  const stats = `<ul class="final">
      <li>☁️ Smog <b>${s.smog.toFixed(0)}</b></li><li>🌡️ <b>+${s.temp.toFixed(2)} °C</b></li>
      <li>😊 Happiness <b>${s.happy.toFixed(0)}</b></li><li>👥 <b>${(s.pop / 1000).toFixed(1)}k</b></li>
      <li>💶 <b>${fmtMoney(s.money)}</b></li><li>🌳 <b>${s.stats.trees}</b> trees</li></ul>`;
  if (s.over === 'end') {
    showModal({
      cls: 'end',
      html: `<div class="speaker">${PORTRAIT_KAETHCHEN}<div><h2>It's ${END_YEAR + 1}. You made it!</h2><small>Your final report, Bürgermeister</small></div></div>
        ${stats}<div class="rank"><small>Score ${score}</small><h3>${title}</h3><p>${blurb}</p></div>`,
      buttons: [
        { label: '🔁 New game', cls: 'primary', onClick: () => startGame(newGame()) },
        { label: '♾️ Keep playing', onClick: () => { s.over = null; s.endless = true; } },
      ],
    });
  } else {
    const [head, text] = GAME_OVER_TEXT[s.over];
    showModal({
      cls: 'lose',
      html: `<h2>${head}</h2><p>${text}</p>${stats}<div class="rank"><small>Score ${score}</small><h3>${title}</h3></div>`,
      buttons: [{ label: '🔁 Try again', cls: 'primary', onClick: () => startGame(newGame()) }],
    });
  }
}

function confirmNewGame() {
  showModal({
    html: '<h2>Start over?</h2><p>Your current Heilbronn will be lost. The ducks will remember, though.</p>',
    buttons: [
      { label: 'Yes, new game', cls: 'danger', onClick: () => { clearSave(); startGame(newGame()); } },
      { label: 'Cancel' },
    ],
  });
}

function intro() {
  const saved = loadSave();
  const buttons = [{ label: '🌱 New game', cls: 'primary', onClick: () => startGame(newGame()) }];
  if (saved) buttons.unshift({ label: `▶️ Continue (${MONTHS[saved.month]} ${saved.year})`, cls: 'primary', onClick: () => startGame(saved) });
  showModal({
    cls: 'intro',
    html: `<div class="speaker">${PORTRAIT_KAETHCHEN}<div><h2>Grüß Gott, Bürgermeister!</h2><small>Käthchen von Heilbronn, eco advisor (unpaid)</small></div></div>
      <p>Congratulations on becoming mayor of <b>Heilbronn</b>! The bad news: the Neckar is warming up, the coal plant is still smoking, and Herr Profitmeier is already waiting outside your office with a "deal".</p>
      <ul class="howto">
        <li>🌳 <b>Plant trees</b> to eat smog and cool the city. Each species has its own strengths, and they grow over time.</li>
        <li>🏭 <b>Build industry</b> to make money. It also makes smog and heat.</li>
        <li>💨 <b>Wind</b> moves the smog around. Trees right next to a chimney can choke, so check the <b>Smog</b>/<b>Heat</b> overlays.</li>
        <li>☠️ You lose if smog reaches 100, the city hits +4.5 °C, the treasury goes below −€2,500 or everyone moves away.</li>
        <li>🏁 Survive until <b>${END_YEAR}</b> with clean air and happy citizens.</li>
      </ul>
      <p class="muted">Keys: <kbd>Space</kbd> pause · <kbd>1-9</kbd> pick item · <kbd>B</kbd> bulldoze · <kbd>O</kbd> overlays · <kbd>Esc</kbd>/right-click deselect · <kbd>Wheel</kbd> zoom · drag (no tool) / right-drag / <kbd>WASD</kbd> pan</p>`,
    buttons,
  });
}

window.addEventListener('DOMContentLoaded', () => {
  renderInit($('#map'));
  bindInput();
  setOverlay('none');
  Game.s = loadSave() || newGame(); // render something behind the intro
  startGame(Game.s);
  intro();
  requestAnimationFrame(loop);
  window.addEventListener('beforeunload', () => { if (Game.s && !Game.s.over) save(); });
});

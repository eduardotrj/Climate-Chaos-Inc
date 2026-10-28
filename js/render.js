'use strict';
// ---------------------------------------------------------------------------
// Isometric canvas renderer. Everything is drawn procedurally – no image assets.
// The map is a raised "diorama" island: land sits at z=0, the Neckar is sunk
// below it, the Wartberg rises in terraces and soil cliffs show at every drop.
// Light comes from the top-left.
// ---------------------------------------------------------------------------

const TW = 64, TH = 32;                       // tile diamond size on screen
const PAD_X = 24, OY = 84;                    // room for tall chimneys at the top
const OX = PAD_X + ROWS * TW / 2;
const WORLD_W = PAD_X * 2 + (COLS + ROWS) * TW / 2;
const WORLD_H = OY + (COLS + ROWS) * TH / 2 + 56;
const Z_WATER = -10, Z_BOTTOM = -36;

const Render = {
  canvas: null, ctx: null, dpr: 1,
  ground: null, groundKey: '', Z: null, order: null,
  particles: [], weather: [], t: 0,
  cam: { z: 1, x: 0, y: 0 },   // zoom + world point at the canvas' top-left
  vw: WORLD_W, vh: WORLD_H,     // view size in CSS px (the canvas fills the window)
  safe: { l: 0, t: 0, r: 0, b: 0 }, // view insets covered by floating HUD panels
};
const ZOOM_MAX = 3.2;

// ----- camera --------------------------------------------------------------
const zoomMin = () => 0.6 * Math.min(Render.vw / WORLD_W, Render.vh / WORLD_H);
// Keep the island on screen; it may slide partly under the HUD panels.
function camClamp() {
  const c = Render.cam;
  c.z = Math.max(zoomMin(), Math.min(ZOOM_MAX, c.z));
  const axis = (v, world, view) => {
    const slack = view * 0.3 / c.z, lo = -slack, hi = world - view / c.z + slack;
    return lo > hi ? (world - view / c.z) / 2 : Math.max(lo, Math.min(hi, v));
  };
  c.x = axis(c.x, WORLD_W, Render.vw);
  c.y = axis(c.y, WORLD_H, Render.vh);
}
function camZoomAt(sx, sy, factor) {
  const c = Render.cam, wx = sx / c.z + c.x, wy = sy / c.z + c.y;
  c.z = Math.max(zoomMin(), Math.min(ZOOM_MAX, c.z * factor));
  c.x = wx - sx / c.z; c.y = wy - sy / c.z;
  camClamp();
}
function camPan(dx, dy) { const c = Render.cam; c.x -= dx / c.z; c.y -= dy / c.z; camClamp(); }
// Center of the part of the view not covered by panels.
function safeCenter() {
  const { l, t, r, b } = Render.safe;
  return [l + (Render.vw - l - r) / 2, t + (Render.vh - t - b) / 2];
}
function camFocus(gx, gy, z) {
  const c = Render.cam, [wx, wy] = P(gx, gy, 0), [cx, cy] = safeCenter();
  c.z = z; c.x = wx - cx / z; c.y = wy - cy / z;
  camClamp();
}
function camFit() {
  const c = Render.cam, { l, t, r, b } = Render.safe, [cx, cy] = safeCenter();
  c.z = Math.min((Render.vw - l - r) / WORLD_W, (Render.vh - t - b) / WORLD_H);
  c.x = WORLD_W / 2 - cx / c.z; c.y = WORLD_H / 2 - cy / c.z;
  camClamp();
}
// Is the tile (plus a margin for tall things) inside the current view?
function tileVisible(c, r, z, above) {
  const cam = Render.cam, [x, y] = P(c + 0.5, r + 0.5, z);
  return x > cam.x - 60 && x < cam.x + Render.vw / cam.z + 60 && y > cam.y - 60 && y < cam.y + Render.vh / cam.z + (above || 0) + 50;
}
const screenToWorld = (sx, sy) => [sx / Render.cam.z + Render.cam.x, sy / Render.cam.z + Render.cam.y];
function worldTransform(ctx) {
  const d = Render.dpr, c = Render.cam;
  ctx.setTransform(d * c.z, 0, 0, d * c.z, -c.x * c.z * d, -c.y * c.z * d);
}
// smooth value noise in grid space, 0..1
function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => hash(a * 57 + b * 131 + seed * 7, seed);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

// grid coords (corner-based, may be fractional) + height → screen point
const P = (gx, gy, z) => [OX + (gx - gy) * TW / 2, OY + (gx + gy) * TH / 2 - (z || 0)];
const hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };

// ----- primitives (draw on the current context X) --------------------------
let X = null;
function fillPts(pts, col) {
  X.fillStyle = col; X.beginPath(); X.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) X.lineTo(pts[k][0], pts[k][1]);
  X.closePath(); X.fill();
}
function circ(x, y, r, c) { X.fillStyle = c; X.beginPath(); X.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); X.fill(); }
function ell(x, y, rx, ry, c) { X.fillStyle = c; X.beginPath(); X.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); X.fill(); }
function rect(x, y, w, h, c) { X.fillStyle = c; X.fillRect(x, y, w, h); }
function line(x1, y1, x2, y2, c, w) { X.strokeStyle = c; X.lineWidth = w || 1; X.beginPath(); X.moveTo(x1, y1); X.lineTo(x2, y2); X.stroke(); }
const diamond = (c, r, z, inset) => {
  const k = inset || 0;
  return [P(c + k, r + k, z), P(c + 1 - k, r + k, z), P(c + 1 - k, r + 1 - k, z), P(c + k, r + 1 - k, z)];
};

function parseColor(c) {
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  return c.match(/[\d.]+/g).slice(0, 3).map(Number);
}
function mix(a, b, k) {
  const A = parseColor(a), B = parseColor(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
}
// k > 0 lightens toward white, k < 0 darkens toward black
const shade = (c, k) => k >= 0 ? mix(c, '#ffffff', k) : mix(c, '#000000', -k);
function lerp3(stops, k) {
  k = Math.max(0, Math.min(1, k));
  const seg = k < 0.5 ? 0 : 1, kk = k < 0.5 ? k * 2 : (k - 0.5) * 2;
  const A = stops[seg], B = stops[seg + 1];
  return A.map((v, i) => Math.round(v + (B[i] - v) * kk));
}

// ----- iso solids ----------------------------------------------------------
// Box over a grid footprint. Visible faces: left-front (gy = gy1), right-front (gx = gx1), top.
function isoBox(gx0, gy0, gx1, gy1, z, h, col, top) {
  fillPts([P(gx0, gy1, z), P(gx1, gy1, z), P(gx1, gy1, z + h), P(gx0, gy1, z + h)], col);
  fillPts([P(gx1, gy0, z), P(gx1, gy1, z), P(gx1, gy1, z + h), P(gx1, gy0, z + h)], shade(col, -0.22));
  fillPts([P(gx0, gy0, z + h), P(gx1, gy0, z + h), P(gx1, gy1, z + h), P(gx0, gy1, z + h)], top || shade(col, 0.18));
}
const faceL = (gy, a, b, u, v, col) => fillPts([P(a, gy, u), P(b, gy, u), P(b, gy, v), P(a, gy, v)], col);
const faceR = (gx, a, b, u, v, col) => fillPts([P(gx, a, u), P(gx, b, u), P(gx, b, v), P(gx, a, v)], col);

// Pitched roof, ridge running along gx.
function roofX(gx0, gy0, gx1, gy1, z, h, col, wall) {
  const m = (gy0 + gy1) / 2;
  fillPts([P(gx0, gy0, z), P(gx1, gy0, z), P(gx1, m, z + h), P(gx0, m, z + h)], shade(col, 0.15));
  fillPts([P(gx0, m, z + h), P(gx1, m, z + h), P(gx1, gy1, z), P(gx0, gy1, z)], col);
  fillPts([P(gx1, gy0, z), P(gx1, gy1, z), P(gx1, m, z + h)], shade(wall, -0.22));
}
// Pitched roof, ridge running along gy.
function roofY(gx0, gy0, gx1, gy1, z, h, col, wall) {
  const m = (gx0 + gx1) / 2;
  fillPts([P(gx0, gy0, z), P(m, gy0, z + h), P(m, gy1, z + h), P(gx0, gy1, z)], shade(col, 0.15));
  fillPts([P(m, gy0, z + h), P(gx1, gy0, z), P(gx1, gy1, z), P(m, gy1, z + h)], shade(col, -0.12));
  fillPts([P(gx0, gy1, z), P(gx1, gy1, z), P(m, gy1, z + h)], wall);
}
// Upright cylinder standing on screen point (x, y).
function cyl(x, y, r, h, col, top) {
  const g = X.createLinearGradient(x - r, 0, x + r, 0);
  g.addColorStop(0, shade(col, 0.25)); g.addColorStop(0.45, col); g.addColorStop(1, shade(col, -0.3));
  X.fillStyle = g;
  X.fillRect(x - r, y - h, r * 2, h);
  X.beginPath(); X.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI); X.fill();
  ell(x, y - h, r, r * 0.5, top || shade(col, 0.3));
}
function footShadow(gx0, gy0, gx1, gy1, z, k) {
  const off = (pt) => [pt[0] + 9 * (k || 1), pt[1] + 3];
  fillPts([P(gx0, gy0, z), P(gx1, gy0, z), P(gx1, gy1, z), P(gx0, gy1, z)].map(off), 'rgba(20,40,10,.2)');
}

// Leafy canopy: shadowed base, body, highlight – drawn as three passes so blobs merge.
function canopy(blobs, col, seed) {
  const dark = shade(col, -0.3), light = shade(col, 0.25);
  blobs.forEach(([x, y, r]) => circ(x + r * 0.12, y + r * 0.18, r, dark));
  blobs.forEach(([x, y, r]) => circ(x, y, r * 0.88, col));
  blobs.forEach(([x, y, r]) => circ(x - r * 0.3, y - r * 0.32, r * 0.45, light));
  const spec = shade(col, -0.09);
  blobs.forEach(([x, y, r], k) => {
    for (let j = 0; j < 3; j++) circ(x + (hash(seed + k, j) - 0.5) * r, y + (hash(seed + k, j + 7) - 0.2) * r * 0.8, r * 0.09, spec);
  });
}

// ----- setup ---------------------------------------------------------------
function renderInit(canvas) {
  Render.canvas = canvas;
  Render.ctx = canvas.getContext('2d');
  Render.dpr = Math.min(2, window.devicePixelRatio || 1);
  Render.ground = document.createElement('canvas');
  renderResize();
  // back-to-front draw order
  Render.order = [...Array(COLS * ROWS).keys()].sort((a, b) => {
    const ca = a % COLS, ra = (a / COLS) | 0, cb = b % COLS, rb = (b / COLS) | 0;
    return (ca + ra) - (cb + rb) || ca - cb;
  });
}

// Match the canvas backing store to its on-screen size.
function renderResize() {
  const cv = Render.canvas, d = Render.dpr;
  Render.vw = Math.max(1, cv.clientWidth); Render.vh = Math.max(1, cv.clientHeight);
  cv.width = Render.ground.width = Math.round(Render.vw * d);
  cv.height = Render.ground.height = Math.round(Render.vh * d);
  Render.groundKey = '';
  camClamp();
}

function computeZ(s) {
  const Z = new Float32Array(COLS * ROWS);
  s.tiles.forEach((t, i) => {
    const c = i % COLS, r = (i / COLS) | 0;
    if (t.g === 'water' || t.g === 'bridge') Z[i] = Z_WATER;
    else if (t.g === 'hill') {
      const dx = (c - 26) / 4.6, dy = (r - 3) / 3.6;
      Z[i] = 6 + Math.round((1 - Math.min(1, Math.hypot(dx, dy))) * 3) * 6;
    } else Z[i] = 0;
  });
  return Z;
}
const zAt = (c, r) => inBounds(c, r) ? Render.Z[idx(c, r)] : Z_BOTTOM;

// Canvas point → tile, respecting terrain height (front-most tile wins).
function pickTile(px, py) {
  const [sx, sy] = screenToWorld(px, py);
  const O = Render.order, Z = Render.Z;
  for (let k = O.length - 1; k >= 0; k--) {
    const i = O[k], c = i % COLS, r = (i / COLS) | 0;
    const a = (sx - OX) / (TW / 2), b = (sy + Z[i] - OY) / (TH / 2);
    if (Math.floor((a + b) / 2) === c && Math.floor((b - a) / 2) === r) return { c, r };
  }
  return null;
}

// ----- ground --------------------------------------------------------------
const GRASS = {
  spring: ['#7ccb48', '#73c241', '#84d152'], summer: ['#6cbd3a', '#64b434', '#75c443'],
  autumn: ['#a8b24a', '#9eaa44', '#b2bb56'], winter: ['#e6f0f4', '#dde9ee', '#edf4f7'],
};
const HILL = {
  spring: ['#8ccf4e', '#82c748'], summer: ['#7fc243', '#77b93d'],
  autumn: ['#b6b450', '#acab49'], winter: ['#e9f1f4', '#e1ebef'],
};
const FLOWERS = ['#ff8fc2', '#ffffff', '#ffd84a', '#c792ff', '#ff6f61'];

const isWet = (s, c, r) => inBounds(c, r) && (s.tiles[idx(c, r)].g === 'water' || s.tiles[idx(c, r)].g === 'bridge');
const isRoadish = (s, c, r) => inBounds(c, r) && (s.tiles[idx(c, r)].g === 'road' || s.tiles[idx(c, r)].g === 'bridge');

function cliffFaces(s, c, r, z, top) {
  const winter = s.season === 'winter';
  const lip = winter ? '#cfdde3' : shade(top, -0.18);
  [[1, 0], [0, 1]].forEach(([dc, dr]) => {
    const nz = zAt(c + dc, r + dr);
    if (nz >= z) return;
    const right = dc === 1;
    const face = (u, v, col) => right ? faceR(c + 1, r, r + 1, u, v, col) : faceL(r + 1, c, c + 1, u, v, col);
    const soil = right ? '#8a5a38' : '#a26d45';
    face(nz, z, soil);
    face(Math.max(nz, z - 3.5), z, lip);
    if (z - nz > 12) face(z - 12, z - 10.5, right ? '#76492c' : '#8c5c39'); // strata
    if (z - nz > 22) face(z - 22, z - 20.5, right ? '#6a4128' : '#7e5233');
  });
}

function drawTileGround(s, i) {
  const t = s.tiles[i], c = i % COLS, r = (i / COLS) | 0, z = Render.Z[i];
  const season = s.season, winter = season === 'winter';

  if (t.g === 'water' || t.g === 'bridge') {
    fillPts(diamond(c, r, z), winter ? '#5a9ccf' : '#2b88dc');
    X.strokeStyle = winter ? '#5a9ccf' : '#2b88dc'; X.lineWidth = 1; X.stroke();
    // soft light streaks
    for (let k = 0; k < 2; k++) {
      const gx = c + 0.15 + hash(i, k) * 0.6, gy = r + 0.2 + hash(i, k + 3) * 0.6;
      const a = P(gx, gy, z), b = P(gx + 0.25, gy, z);
      line(a[0], a[1], b[0], b[1], 'rgba(140,210,255,.55)', 2);
    }
    // foam where the river meets a bank behind it
    [[-1, 0, [c, r], [c, r + 1]], [0, -1, [c, r], [c + 1, r]]].forEach(([dc, dr, A, B]) => {
      if (isWet(s, c + dc, r + dr)) return;
      const a = P(A[0], A[1], z), b = P(B[0], B[1], z);
      line(a[0], a[1] + 1, b[0], b[1] + 1, 'rgba(255,255,255,.75)', 2.5);
    });
    // turquoise shallows along the banks
    if (!winter) [[-1, 0, 'x0'], [1, 0, 'x1'], [0, -1, 'y0'], [0, 1, 'y1']].forEach(([dc, dr, e]) => {
      if (isWet(s, c + dc, r + dr) || !inBounds(c + dc, r + dr)) return;
      const q = e === 'x0' ? [P(c, r, z), P(c + 0.22, r, z), P(c + 0.22, r + 1, z), P(c, r + 1, z)]
        : e === 'x1' ? [P(c + 0.78, r, z), P(c + 1, r, z), P(c + 1, r + 1, z), P(c + 0.78, r + 1, z)]
        : e === 'y0' ? [P(c, r, z), P(c + 1, r, z), P(c + 1, r + 0.22, z), P(c, r + 0.22, z)]
        : [P(c, r + 0.78, z), P(c + 1, r + 0.78, z), P(c + 1, r + 1, z), P(c, r + 1, z)];
      fillPts(q, 'rgba(90,215,240,.45)');
    });
    if (t.g === 'bridge') drawBridge(s, c, r);
    cliffFaces(s, c, r, z, '#3a6f9c');
    return;
  }

  const pal = (t.g === 'hill' ? HILL : GRASS)[season];
  const n = noise2(c / 4, r / 4, 1);
  const top = mix(pal[0], pal[pal.length - 1], n);
  fillPts(diamond(c, r, z), top);
  X.strokeStyle = top; X.lineWidth = 1; X.stroke(); // hide seams
  // texture: specks and grass tufts
  for (let k = 0; k < 14; k++) {
    const p = P(c + 0.06 + hash(i, k) * 0.88, r + 0.06 + hash(i, k + 20) * 0.88, z);
    ell(p[0], p[1], 2.4, 1.2, k % 2 ? shade(top, -0.1) : shade(top, 0.1));
  }
  if (!winter) for (let k = 0; k < 5; k++) {
    const p = P(c + 0.1 + hash(i, k + 200) * 0.8, r + 0.1 + hash(i, k + 210) * 0.8, z);
    const tc = shade(top, -0.22);
    line(p[0] - 1.5, p[1], p[0] - 2.5, p[1] - 3.5, tc, 1); line(p[0], p[1], p[0], p[1] - 4.5, tc, 1); line(p[0] + 1.5, p[1], p[0] + 2.5, p[1] - 3.5, tc, 1);
  }

  if (t.g === 'road') { drawRoad(s, c, r, z); cliffFaces(s, c, r, z, top); return; }

  cliffFaces(s, c, r, z, top);
  if (t.o) { // packed earth under buildings
    if (!isTree(t.o.id) && t.o.id !== 'park' && t.o.id !== 'stump' && t.o.id !== 'solar')
      fillPts(diamond(c, r, z, 0.08), winter ? '#d5dde0' : 'rgba(150,120,80,.35)');
    return;
  }
  // decorations on empty land: flowers, bushes, riverside rocks
  const meadow = noise2(c / 3, r / 3, 9) + (t.g === 'hill' ? 0.25 : 0);
  if (!winter && meadow > 0.5) {
    const nf = Math.round((meadow - 0.5) * 50);
    for (let k = 0; k < nf; k++) {
      const p = P(c + 0.1 + hash(i, k + 60) * 0.8, r + 0.1 + hash(i, k + 80) * 0.8, z);
      circ(p[0], p[1], 1.4, FLOWERS[Math.floor(hash(i, k + 99) * FLOWERS.length)]);
    }
  }
  const wetNear = isWet(s, c - 1, r) || isWet(s, c + 1, r) || isWet(s, c, r - 1) || isWet(s, c, r + 1);
  if (wetNear && hash(i, 70) < 0.55) {
    for (let k = 0; k < 3; k++) {
      const p = P(c + 0.15 + hash(i, k + 120) * 0.7, r + 0.15 + hash(i, k + 130) * 0.7, z);
      const rr = 4 + hash(i, k + 140) * 4;
      ell(p[0] + 1, p[1] + 1, rr, rr * 0.7, '#4c5257');
      ell(p[0], p[1], rr * 0.92, rr * 0.62, winter ? '#e3e8ea' : '#7d858b');
      ell(p[0] - rr * 0.3, p[1] - rr * 0.25, rr * 0.4, rr * 0.25, '#a6adb2');
    }
  } else if (hash(i, 71) < 0.16) {
    const p = P(c + 0.3 + hash(i, 72) * 0.4, r + 0.3 + hash(i, 73) * 0.4, z);
    const col = winter ? '#c9d6da' : season === 'autumn' ? '#9a8a3a' : mix('#3f8f2e', '#5aa83a', hash(i, 74));
    const k = 0.75 + hash(i, 75) * 0.5;
    ell(p[0] + 5 * k, p[1] + 2, 8 * k, 3.5 * k, 'rgba(20,40,10,.2)');
    canopy([[p[0] - 4 * k, p[1] - 4 * k, 5 * k], [p[0] + 3 * k, p[1] - 5 * k, 5.5 * k], [p[0], p[1] - 8 * k, 4.5 * k]], col, i);
  }
}

function drawRoad(s, c, r, z) {
  const h = isRoadish(s, c - 1, r) || isRoadish(s, c + 1, r);
  const v = isRoadish(s, c, r - 1) || isRoadish(s, c, r + 1);
  const walk = s.season === 'winter' ? '#e4e6e6' : '#cfc8b6', asphalt = '#7f8389';
  const strip = (along, a, b, col) => along === 'x'
    ? fillPts([P(c, r + a, z), P(c + 1, r + a, z), P(c + 1, r + b, z), P(c, r + b, z)], col)
    : fillPts([P(c + a, r, z), P(c + b, r, z), P(c + b, r + 1, z), P(c + a, r + 1, z)], col);
  if (h) strip('x', 0.2, 0.8, walk);
  if (v) strip('y', 0.2, 0.8, walk);
  if (h) strip('x', 0.27, 0.73, asphalt);
  if (v) strip('y', 0.27, 0.73, asphalt);
  if (h && !v) for (let k = 0; k < 2; k++) fillPts([P(c + 0.15 + k * 0.5, r + 0.48, z), P(c + 0.4 + k * 0.5, r + 0.48, z), P(c + 0.4 + k * 0.5, r + 0.52, z), P(c + 0.15 + k * 0.5, r + 0.52, z)], '#f2eedc');
  if (v && !h) for (let k = 0; k < 2; k++) fillPts([P(c + 0.48, r + 0.15 + k * 0.5, z), P(c + 0.52, r + 0.15 + k * 0.5, z), P(c + 0.52, r + 0.4 + k * 0.5, z), P(c + 0.48, r + 0.4 + k * 0.5, z)], '#f2eedc');
}

function drawBridge(s, c, r) {
  const z = 0;
  // stone pier
  const pc = P(c + 0.5, r + 0.5, Z_WATER);
  rect(pc[0] - 5, pc[1] - 10, 10, 10, '#8f8a80');
  // deck with thickness, running along gx
  fillPts([P(c, r + 0.85, z - 5), P(c + 1, r + 0.85, z - 5), P(c + 1, r + 0.85, z), P(c, r + 0.85, z)], '#8a7f70');
  fillPts([P(c, r + 0.15, z), P(c + 1, r + 0.15, z), P(c + 1, r + 0.85, z), P(c, r + 0.85, z)], '#b4aa98');
  fillPts([P(c, r + 0.25, z), P(c + 1, r + 0.25, z), P(c + 1, r + 0.75, z), P(c, r + 0.75, z)], '#7f8389');
  [0.17, 0.83].forEach(gy => {
    const a = P(c, r + gy, z + 4), b = P(c + 1, r + gy, z + 4);
    line(a[0], a[1], b[0], b[1], '#5b4b3a', 1.5);
    for (let k = 0; k <= 2; k++) { const p = P(c + k / 2, r + gy, z); line(p[0], p[1], p[0], p[1] - 4, '#5b4b3a', 1.2); }
  });
}

function drawGround(s) {
  if (!Render.Z) Render.Z = computeZ(s);
  X = Render.ground.getContext('2d');
  X.setTransform(Render.dpr, 0, 0, Render.dpr, 0, 0);
  const winter = s.season === 'winter';
  const bg = X.createLinearGradient(0, 0, 0, Render.vh);
  bg.addColorStop(0, winter ? '#9cc3d9' : '#4fc3ec'); bg.addColorStop(1, winter ? '#5d8fb0' : '#1f74b8');
  X.fillStyle = bg; X.fillRect(0, 0, Render.vw, Render.vh);
  worldTransform(X);
  for (let k = 0; k < 160; k++) { // gentle sea ripples
    const x = (hash(k, 1) * 1.6 - 0.3) * WORLD_W, y = (hash(k, 2) * 1.6 - 0.3) * WORLD_H;
    line(x, y, x + 14 + hash(k, 3) * 20, y, 'rgba(255,255,255,.12)', 1.5);
  }
  // island shadow in the sea
  fillPts([P(0, 0, Z_BOTTOM), P(COLS, 0, Z_BOTTOM), P(COLS, ROWS, Z_BOTTOM), P(0, ROWS, Z_BOTTOM)].map(p => [p[0] + 14, p[1] + 10]), 'rgba(10,40,80,.28)');
  for (const i of Render.order) if (tileVisible(i % COLS, (i / COLS) | 0, Render.Z[i], 40)) drawTileGround(s, i);
  Render.groundKey = groundKey(s);
}
const groundKey = s => `${s.season}:${s.rev}:${Render.cam.z.toFixed(3)}:${Render.cam.x.toFixed(1)}:${Render.cam.y.toFixed(1)}`;

// ----- trees ---------------------------------------------------------------
const LEAVES = {
  birke: ['#9ad65a', '#7cc444', '#f0c43a'], ahorn: ['#6cc24a', '#3f9a34', '#e0482c'],
  linde: ['#78c850', '#4aa23a', '#d4ad36'], platane: ['#74c04c', '#52a03a', '#c08a38'],
  eiche: ['#5fae42', '#3a8a30', '#9a6a2c'], ginkgo: ['#8fd05a', '#4f9f3a', '#f5d020'],
  rebe: ['#86c84e', '#5aa83a', '#c8902c'],
};

function leafColor(id, season, health) {
  const L = LEAVES[id];
  const base = season === 'spring' ? L[0] : season === 'summer' ? L[1] : L[2];
  return mix(base, '#9c8450', Math.max(0, 1 - health / 100) * 0.85);
}

function trunk(x, y, w, h, col) {
  const g = X.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  g.addColorStop(0, shade(col, 0.2)); g.addColorStop(1, shade(col, -0.25));
  X.fillStyle = g; X.fillRect(x - w / 2, y - h, w, h);
}
function bare(x, y, s, col) {
  X.strokeStyle = col; X.lineWidth = 1.4; X.beginPath();
  [[-8, -10], [7, -12], [0, -16], [-4, -6], [5, -5]].forEach(([dx, dy]) => { X.moveTo(x, y); X.lineTo(x + dx * s, y + dy * s); });
  X.stroke();
}

function bush(x, y, col, seed) {
  ell(x + 4, y + 1, 7, 3, 'rgba(20,40,10,.22)');
  canopy([[x - 3, y - 4, 4.5], [x + 3, y - 4, 4.5], [x, y - 7, 4]], col, seed);
}

function drawTree(o, c, r, z, s, i) {
  const id = o.id, gr = growthOf(o), sc = 0.5 + 0.5 * gr, season = s.season;
  const bareNow = season === 'winter' && id !== 'eiche';
  const col = leafColor(id, season, o.health);
  const bushCol = season === 'winter' ? '#b9c9c9' : season === 'autumn' ? '#9c8a3c' : '#3f922f';
  const [x, y] = P(c + 0.5, r + 0.55, z);

  if (id === 'rebe') { drawVines(o, c, r, z, s, col, bareNow); return; }
  if (gr > 0.6 && hash(i, 1) < 0.6) { const b = P(c + 0.22, r + 0.3, z); bush(b[0], b[1], bushCol, i); }

  ell(x + 10 * sc, y + 1, 15 * sc, 6 * sc, 'rgba(20,40,10,.25)');
  switch (id) {
    case 'birke':
      trunk(x, y, 3 * sc, 26 * sc, '#f2efe6');
      for (let k = 0; k < 4; k++) rect(x - 1.5 * sc, y - (5 + k * 5) * sc, 2 * sc, 1.2, '#333');
      if (bareNow) bare(x, y - 20 * sc, sc, '#d8d2c4');
      else canopy([[x, y - 30 * sc, 7 * sc], [x - 5 * sc, y - 23 * sc, 6 * sc], [x + 5 * sc, y - 22 * sc, 6 * sc], [x, y - 38 * sc, 5 * sc]], col, i);
      break;
    case 'ahorn':
      trunk(x, y, 4 * sc, 15 * sc, '#6b4a2b');
      if (bareNow) bare(x, y - 14 * sc, sc * 1.2, '#6b4a2b');
      else canopy([[x - 8 * sc, y - 20 * sc, 8 * sc], [x + 8 * sc, y - 20 * sc, 8 * sc], [x, y - 25 * sc, 11 * sc], [x, y - 35 * sc, 7 * sc]], col, i);
      break;
    case 'linde':
      trunk(x, y, 4 * sc, 14 * sc, '#5e4128');
      if (bareNow) bare(x, y - 13 * sc, sc * 1.2, '#5e4128');
      else {
        canopy([[x - 8 * sc, y - 20 * sc, 7 * sc], [x + 8 * sc, y - 20 * sc, 7 * sc], [x, y - 23 * sc, 10 * sc],
          [x - 6 * sc, y - 31 * sc, 8 * sc], [x + 6 * sc, y - 31 * sc, 8 * sc], [x, y - 39 * sc, 6 * sc]], col, i);
        if (s.month === 5 || s.month === 6) for (let k = 0; k < 7; k++) circ(x + (hash(i, k) - 0.5) * 20 * sc, y - (18 + hash(i, k + 9) * 22) * sc, 1.3, '#f6e27a');
      }
      break;
    case 'platane':
      trunk(x, y, 5 * sc, 17 * sc, '#cbbf9a');
      circ(x - 1, y - 8 * sc, 1.6 * sc, '#8f9b6a'); circ(x + 1, y - 4 * sc, 1.4 * sc, '#a6a07a');
      if (bareNow) bare(x, y - 16 * sc, sc * 1.3, '#b8ac88');
      else canopy([[x - 12 * sc, y - 22 * sc, 8 * sc], [x + 12 * sc, y - 22 * sc, 8 * sc], [x, y - 24 * sc, 10 * sc],
        [x - 6 * sc, y - 31 * sc, 8 * sc], [x + 6 * sc, y - 31 * sc, 8 * sc]], col, i);
      break;
    case 'eiche': {
      trunk(x, y, 7 * sc, 15 * sc, '#5a3d22');
      const c2 = season === 'winter' ? '#8a6a3a' : col;
      if (season === 'winter') X.globalAlpha *= 0.8;
      canopy([[x - 10 * sc, y - 22 * sc, 10 * sc], [x + 10 * sc, y - 22 * sc, 10 * sc], [x, y - 20 * sc, 10 * sc],
        [x - 5 * sc, y - 33 * sc, 10 * sc], [x + 6 * sc, y - 32 * sc, 9 * sc], [x, y - 42 * sc, 7 * sc]], c2, i);
      if (season === 'winter') X.globalAlpha /= 0.8;
      break;
    }
    case 'ginkgo':
      trunk(x, y, 3 * sc, 12 * sc, '#6e5a44');
      if (bareNow) bare(x, y - 12 * sc, sc * 1.1, '#6e5a44');
      else for (let k = 0; k < 4; k++) { // layered tiers, lit from the left
        const by = y - (8 + k * 8) * sc, hw = (13 - k * 2.8) * sc, ap = by - 15 * sc;
        fillPts([[x - hw, by], [x, ap], [x, by + 2 * sc]], shade(col, 0.1));
        fillPts([[x, ap], [x + hw, by], [x, by + 2 * sc]], shade(col, -0.22));
      }
      break;
  }
  if (gr > 0.6 && hash(i, 2) < 0.45) { const b = P(c + 0.8, r + 0.85, z); bush(b[0], b[1], bushCol, i + 5); }
}

function drawVines(o, c, r, z, s, col, bareNow) {
  const gr = growthOf(o);
  [0.25, 0.5, 0.75].forEach((gy, row) => {
    const a = P(c + 0.12, r + gy, z), b = P(c + 0.88, r + gy, z);
    line(a[0], a[1] - 7, b[0], b[1] - 7, '#8a6a44', 1);
    for (let k = 0; k <= 4; k++) {
      const p = P(c + 0.12 + k * 0.19, r + gy, z);
      line(p[0], p[1], p[0], p[1] - 9, '#7a5a3a', 1.3);
      if (!bareNow) {
        circ(p[0] + 1, p[1] - 5, 4 * (0.5 + gr * 0.5), shade(col, -0.25));
        circ(p[0], p[1] - 6, 3.6 * (0.5 + gr * 0.5), col);
        if (gr >= 1 && s.month >= 7 && s.month <= 9 && (k + row) % 2 === 0) {
          circ(p[0] - 1, p[1] - 3, 1.5, '#5b2a6e'); circ(p[0] + 1.5, p[1] - 2.5, 1.5, '#6d3485');
        }
      }
    }
  });
}

// ----- buildings -----------------------------------------------------------
const GLASS = '#8fd0f0';
const EMIT = { kohle: [0.8, 0.3, 80], auto: [0.8, 0.35, 34], schraube: [0.26, 0.42, 30], salz: [0.3, 0.75, 16], wohnblock: [0.66, 0.36, 36] };

function badge(c, r, z) {
  const [x, y] = P(c + 0.5, r + 0.5, z);
  circ(x - 20, y - 26, 6, '#2f9e5b'); circ(x - 20, y - 26, 6.5, 'rgba(255,255,255,0)');
  line(x - 23, y - 26, x - 17, y - 26, '#fff', 1.8); line(x - 20, y - 29, x - 20, y - 23, '#fff', 1.8);
}

function drawBuilding(o, c, r, z, s, i) {
  const t = Render.t, winter = s.season === 'winter';
  const snowRoof = col => winter ? '#eef4f6' : col;
  switch (o.id) {
    case 'wohnblock': {
      const roofs = ['#d4553a', '#e07b2c', '#b8423f'], roof = roofs[(c * 7 + r * 13) % 3], wall = '#f1e6cf';
      footShadow(c + 0.18, r + 0.2, c + 0.82, r + 0.8, z);
      isoBox(c + 0.18, r + 0.2, c + 0.82, r + 0.8, z, 18, wall);
      for (const u of [4, 11]) {
        faceL(r + 0.8, c + 0.26, c + 0.38, z + u, z + u + 5, GLASS);
        faceL(r + 0.8, c + 0.46, c + 0.58, z + u, z + u + 5, GLASS);
        faceR(c + 0.82, r + 0.3, r + 0.42, z + u, z + u + 5, shade(GLASS, -0.2));
        faceR(c + 0.82, r + 0.58, r + 0.7, z + u, z + u + 5, shade(GLASS, -0.2));
      }
      faceL(r + 0.8, c + 0.64, c + 0.74, z, z + 8, '#8a5a32');
      isoBox(c + 0.62, r + 0.32, c + 0.7, r + 0.4, z + 20, 12, '#9b5a46');
      roofX(c + 0.14, r + 0.16, c + 0.86, r + 0.84, z + 18, 11, snowRoof(roof), wall);
      break;
    }
    case 'oeko': {
      const wall = '#d9a878';
      footShadow(c + 0.18, r + 0.22, c + 0.82, r + 0.78, z);
      isoBox(c + 0.18, r + 0.22, c + 0.82, r + 0.78, z, 14, wall, winter ? '#eef4f6' : '#7ccf4c');
      faceL(r + 0.78, c + 0.24, c + 0.5, z + 3, z + 11, GLASS);
      faceR(c + 0.82, r + 0.3, r + 0.5, z + 4, z + 10, shade(GLASS, -0.2));
      faceL(r + 0.78, c + 0.6, c + 0.72, z, z + 8, '#6b4a2b');
      fillPts([P(c + 0.3, r + 0.3, z + 15), P(c + 0.62, r + 0.3, z + 15), P(c + 0.62, r + 0.5, z + 20), P(c + 0.3, r + 0.5, z + 20)], '#2b4a8a');
      const a = P(c + 0.46, r + 0.3, z + 15), b = P(c + 0.46, r + 0.5, z + 20);
      line(a[0], a[1], b[0], b[1], '#7d9be0', 1);
      const bp = P(c + 0.9, r + 0.62, z); bush(bp[0], bp[1], winter ? '#b9c9c9' : '#3f922f', i);
      break;
    }
    case 'kohle': {
      footShadow(c + 0.05, r + 0.05, c + 0.95, r + 0.95, z, 1.4);
      // cooling tower (hyperboloid)
      const [tx, ty] = P(c + 0.3, r + 0.32, z);
      const g = X.createLinearGradient(tx - 16, 0, tx + 16, 0);
      g.addColorStop(0, '#e9ecef'); g.addColorStop(0.5, '#c5cad0'); g.addColorStop(1, '#8e959d');
      X.fillStyle = g; X.beginPath();
      X.moveTo(tx - 16, ty); X.quadraticCurveTo(tx - 7, ty - 22, tx - 11, ty - 40);
      X.lineTo(tx + 11, ty - 40); X.quadraticCurveTo(tx + 7, ty - 22, tx + 16, ty);
      X.ellipse(tx, ty, 16, 8, 0, 0, Math.PI); X.fill();
      ell(tx, ty - 40, 11, 5.5, '#dfe3e7'); ell(tx, ty - 40, 8.5, 4, '#5d6268');
      // turbine hall
      isoBox(c + 0.45, r + 0.5, c + 0.95, r + 0.95, z, 16, '#9aa0a8');
      faceL(r + 0.95, c + 0.5, c + 0.9, z + 9, z + 12, '#f0c94a');
      faceR(c + 0.95, r + 0.55, r + 0.9, z + 9, z + 12, '#c9a53a');
      cyl(...P(c + 0.15, r + 0.82, z), 5, 10, '#e8743b');
      // the famous tall chimney
      const [cx, cy] = P(c + 0.8, r + 0.3, z);
      cyl(cx, cy, 4.5, 80, '#ededed');
      for (const k of [6, 14, 22]) rect(cx - 4.5, cy - 80 + k, 9, 4, '#d9534f');
      ell(cx, cy - 80, 4.5, 2.2, '#3a3a3a');
      break;
    }
    case 'auto':
      footShadow(c + 0.08, r + 0.22, c + 0.92, r + 0.85, z);
      isoBox(c + 0.08, r + 0.22, c + 0.92, r + 0.85, z, 15, '#8aa1b8');
      for (let k = 0; k < 4; k++) roofY(c + 0.08 + k * 0.21, r + 0.22, c + 0.29 + k * 0.21, r + 0.85, z + 15, 7, snowRoof('#6d8197'), shade(GLASS, -0.1));
      faceL(r + 0.85, c + 0.12, c + 0.88, z + 6, z + 10, GLASS);
      cyl(...P(c + 0.8, r + 0.35, z + 15), 3, 19, '#7a7f86');
      isoBox(c + 0.12, r + 0.88, c + 0.3, r + 0.98, z, 4, '#d9534f');
      isoBox(c + 0.42, r + 0.88, c + 0.6, r + 0.98, z, 4, '#3b6fd1');
      break;
    case 'schraube': {
      footShadow(c + 0.12, r + 0.3, c + 0.88, r + 0.88, z);
      isoBox(c + 0.12, r + 0.3, c + 0.88, r + 0.88, z, 13, '#b9ab8c', snowRoof('#cfc3a6'));
      faceL(r + 0.88, c + 0.2, c + 0.35, z, z + 8, '#5d564a');
      cyl(...P(c + 0.26, r + 0.42, z + 13), 2.6, 17, '#7a7f86');
      const [sx, sy] = P(c + 0.6, r + 0.6, z + 13);
      cyl(sx, sy, 3.8, 22, '#c8ccd2');
      for (let k = 0; k < 5; k++) line(sx - 3.8, sy - 4 - k * 4, sx + 3.8, sy - 6 - k * 4, '#8a8e93', 1);
      cyl(sx, sy - 22, 7.5, 3.5, '#aeb3b9');
      break;
    }
    case 'salz': {
      footShadow(c + 0.15, r + 0.15, c + 0.9, r + 0.9, z);
      isoBox(c + 0.12, r + 0.55, c + 0.5, r + 0.9, z, 10, '#cdbfa8');
      roofX(c + 0.1, r + 0.53, c + 0.52, r + 0.92, z + 10, 7, snowRoof('#8d6e58'), '#cdbfa8');
      const [hx, hy] = P(c + 0.38, r + 0.32, z);
      line(hx - 9, hy, hx, hy - 36, '#4d5560', 2.5); line(hx + 9, hy, hx, hy - 36, '#4d5560', 2.5);
      line(hx - 5, hy - 16, hx + 5, hy - 16, '#4d5560', 1.5);
      X.strokeStyle = '#4d5560'; X.lineWidth = 1.6; X.beginPath(); X.arc(hx, hy - 36, 5.5, 0, Math.PI * 2); X.stroke();
      line(hx, hy - 36, hx + Math.cos(t * 2) * 5.5, hy - 36 + Math.sin(t * 2) * 5.5, '#4d5560', 1.2);
      const [px, py] = P(c + 0.76, r + 0.62, z);
      ell(px, py, 14, 6, '#e6e6df');
      fillPts([[px - 14, py], [px, py - 19], [px, py + 6]], '#fbfbf7');
      fillPts([[px, py - 19], [px + 14, py], [px, py + 6]], '#d9d9d1');
      break;
    }
    case 'ki': {
      footShadow(c + 0.12, r + 0.15, c + 0.88, r + 0.85, z);
      isoBox(c + 0.12, r + 0.15, c + 0.88, r + 0.85, z, 24, '#3d9fd0', '#cfeef9');
      X.globalAlpha *= 0.5;
      for (let k = 1; k < 5; k++) {
        let a = P(c + 0.12 + k * 0.152, r + 0.85, z), b = P(c + 0.12 + k * 0.152, r + 0.85, z + 24); line(a[0], a[1], b[0], b[1], '#ffffff', 1);
        a = P(c + 0.88, r + 0.15 + k * 0.14, z); b = P(c + 0.88, r + 0.15 + k * 0.14, z + 24); line(a[0], a[1], b[0], b[1], '#d8f3ff', 1);
      }
      for (const u of [8, 16]) {
        let a = P(c + 0.12, r + 0.85, z + u), b = P(c + 0.88, r + 0.85, z + u); line(a[0], a[1], b[0], b[1], '#ffffff', 1);
        a = P(c + 0.88, r + 0.15, z + u); b = P(c + 0.88, r + 0.85, z + u); line(a[0], a[1], b[0], b[1], '#d8f3ff', 1);
      }
      X.globalAlpha /= 0.5;
      // rooftop server tanks
      for (const [gx, gy] of [[0.32, 0.32], [0.55, 0.3]]) {
        const [x, y] = P(c + gx, r + gy, z + 24);
        cyl(x, y, 5.5, 10, '#f4f4f2'); rect(x - 5.5, y - 6, 11, 2.5, '#e8743b');
      }
      for (let k = 0; k < 4; k++) {
        const p = P(c + 0.2 + k * 0.17, r + 0.85, z + 3);
        circ(p[0], p[1], 1.4, Math.sin(t * 6 + k + c) > 0 ? '#7CFC00' : '#1d4d1d');
      }
      const [ax, ay] = P(c + 0.75, r + 0.6, z + 24);
      line(ax, ay, ax, ay - 12, '#555', 1); circ(ax, ay - 12, 1.8, Math.sin(t * 4) > 0 ? '#ff4d4d' : '#7a2020');
      break;
    }
    case 'weinkeller': {
      const wall = '#e0cba5';
      footShadow(c + 0.15, r + 0.25, c + 0.8, r + 0.8, z);
      isoBox(c + 0.15, r + 0.25, c + 0.8, r + 0.8, z, 12, wall);
      faceL(r + 0.8, c + 0.3, c + 0.44, z, z + 8, '#4a2c1a');
      roofY(c + 0.11, r + 0.21, c + 0.84, r + 0.84, z + 12, 10, snowRoof('#9b3b35'), wall);
      for (const gy of [0.5, 0.68]) cyl(...P(c + 0.9, r + gy, z), 3.6, 7, '#8a5a32', '#b07a48');
      break;
    }
    case 'solar':
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const gx = c + 0.1 + a * 0.42, gy = r + 0.1 + b * 0.42;
        const leg = P(gx + 0.18, gy + 0.18, z); line(leg[0], leg[1], leg[0], leg[1] - 5, '#666', 1.5);
        fillPts([P(gx, gy, z + 8), P(gx + 0.36, gy, z + 8), P(gx + 0.36, gy + 0.36, z + 3), P(gx, gy + 0.36, z + 3)], '#22427e');
        let p = P(gx + 0.18, gy, z + 8), q = P(gx + 0.18, gy + 0.36, z + 3); line(p[0], p[1], q[0], q[1], '#6f8fd0', 0.8);
        p = P(gx, gy + 0.18, z + 5.5); q = P(gx + 0.36, gy + 0.18, z + 5.5); line(p[0], p[1], q[0], q[1], '#6f8fd0', 0.8);
        p = P(gx, gy, z + 8); q = P(gx + 0.36, gy, z + 8); line(p[0], p[1], q[0], q[1], '#b8cdf5', 1.2);
      }
      break;
    case 'wind': {
      const [x, y] = P(c + 0.5, r + 0.5, z);
      ell(x + 22, y + 4, 26, 4, 'rgba(20,40,10,.15)');
      ell(x, y, 6, 3, '#bdbdbd');
      const g = X.createLinearGradient(x - 3, 0, x + 3, 0);
      g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#c4c8cc');
      X.fillStyle = g; X.beginPath(); X.moveTo(x - 3.2, y); X.lineTo(x - 1.4, y - 74); X.lineTo(x + 1.4, y - 74); X.lineTo(x + 3.2, y); X.fill();
      rect(x - 3, y - 78, 9, 5, '#e6e6e6');
      const a0 = t * 2.2 + c;
      for (let k = 0; k < 3; k++) {
        const ang = a0 + k * Math.PI * 2 / 3, ca = Math.cos(ang), sa = Math.sin(ang);
        fillPts([[x - 1 - sa * 2, y - 76 + ca * 2], [x - 1 + ca * 30, y - 76 + sa * 30], [x - 1 + sa * 2, y - 76 - ca * 2]], '#ffffff');
      }
      circ(x - 1, y - 76, 2.4, '#d0d0d0');
      break;
    }
    case 'wasserkraft': {
      footShadow(c + 0.15, r + 0.2, c + 0.85, r + 0.85, z);
      isoBox(c + 0.15, r + 0.2, c + 0.85, r + 0.85, z, 13, '#b9bfc4', '#d5dade');
      faceL(r + 0.85, c + 0.22, c + 0.4, z + 4, z + 9, GLASS);
      faceR(c + 0.85, r + 0.3, r + 0.5, z + 4, z + 9, shade(GLASS, -0.2));
      // turbine hall roof + spinning water wheel
      roofX(c + 0.13, r + 0.18, c + 0.87, r + 0.55, z + 13, 6, snowRoof('#4f7fa8'), '#b9bfc4');
      const [wx, wy] = P(c + 0.55, r + 0.85, z + 7);
      X.strokeStyle = '#5b4b3a'; X.lineWidth = 2; X.beginPath(); X.ellipse(wx, wy, 7, 7, 0, 0, Math.PI * 2); X.stroke();
      for (let k = 0; k < 4; k++) {
        const a = t * 1.6 + k * Math.PI / 4;
        line(wx - Math.cos(a) * 7, wy - Math.sin(a) * 7, wx + Math.cos(a) * 7, wy + Math.sin(a) * 7, '#7a5a3a', 1.5);
      }
      // white water at the outlet
      for (let k = 0; k < 4; k++) circ(wx - 4 + k * 3, wy + 9 + Math.sin(t * 5 + k) * 1.2, 1.6, 'rgba(255,255,255,.85)');
      const [lx, ly] = P(c + 0.3, r + 0.4, z + 13);
      circ(lx, ly - 3, 3, '#f6d24a'); fillPts([[lx - 1, ly - 5], [lx + 1.5, ly - 3.5], [lx - 0.5, ly - 3], [lx + 1, ly - 0.5], [lx - 1.5, ly - 2.5], [lx, ly - 3]], '#2f3a2c');
      break;
    }
    case 'tram': {
      [0.46, 0.64].forEach(gy => { const a = P(c, r + gy, z), b = P(c + 1, r + gy, z); line(a[0], a[1], b[0], b[1], '#5a5a5a', 1.5); });
      footShadow(c + 0.08, r + 0.42, c + 0.92, r + 0.68, z);
      isoBox(c + 0.08, r + 0.42, c + 0.92, r + 0.68, z + 1, 11, '#f2c230', snowRoof('#f7e3a0'));
      faceL(r + 0.68, c + 0.08, c + 0.92, z + 3, z + 5, '#d33');
      for (let k = 0; k < 4; k++) faceL(r + 0.68, c + 0.13 + k * 0.2, c + 0.27 + k * 0.2, z + 6, z + 10, '#bfe3f5');
      const [px, py] = P(c + 0.85, r + 0.2, z);
      line(px, py, px, py - 24, '#555', 1.5);
      ell(px, py - 26, 5, 5, '#2f9e5b');
      X.fillStyle = '#f6d24a'; X.font = 'bold 7px sans-serif'; X.textAlign = 'center'; X.fillText('H', px, py - 23.5);
      break;
    }
    case 'park': {
      fillPts(diamond(c, r, z, 0.04), winter ? '#e9f1f3' : '#8fda5c');
      if (!winter) for (let k = 0; k < 16; k++) {
        const p = P(c + 0.08 + hash(i, k) * 0.84, r + 0.08 + hash(i, k + 30) * 0.84, z);
        circ(p[0], p[1], 1.5, FLOWERS[k % FLOWERS.length]);
      }
      const [x, y] = P(c + 0.5, r + 0.5, z);
      ell(x, y, 17, 8.5, '#bdb7aa'); ell(x, y - 1, 15, 7.5, '#d8d2c4');
      ell(x, y - 0.5, 12.5, 6, winter ? '#cfe6f2' : '#3fa9f5');
      ell(x - 3, y - 2, 5, 2, 'rgba(255,255,255,.45)');
      rect(x - 1.2, y - 10, 2.4, 9, '#cfc8b8');
      if (!winter) { const h = 6 + Math.abs(Math.sin(t * 3)) * 4; circ(x, y - 10 - h, 1.6, '#e8f6ff'); circ(x - 3, y - 8 - h / 2, 1.2, '#e8f6ff'); circ(x + 3, y - 8 - h / 2, 1.2, '#e8f6ff'); }
      const bc = winter ? '#b9c9c9' : '#3f922f';
      [[0.18, 0.2], [0.85, 0.25], [0.2, 0.82]].forEach(([gx, gy], k) => { const p = P(c + gx, r + gy, z); bush(p[0], p[1], bc, i + k); });
      break;
    }
    case 'stump': {
      const [x, y] = P(c + 0.5, r + 0.55, z);
      ell(x + 4, y + 1, 7, 3, 'rgba(20,40,10,.25)');
      cyl(x, y, 5, 6, '#7a5532', '#d2ad78');
      break;
    }
    case 'kilian': {
      const sand = '#c9805e';
      footShadow(c + 0.08, r + 0.2, c + 0.92, r + 0.92, z, 1.6);
      isoBox(c + 0.1, r + 0.3, c + 0.6, r + 0.9, z, 18, sand);
      for (let k = 0; k < 3; k++) faceL(r + 0.9, c + 0.16 + k * 0.14, c + 0.22 + k * 0.14, z + 5, z + 13, '#4a2a22');
      roofY(c + 0.08, r + 0.28, c + 0.62, r + 0.92, z + 18, 13, snowRoof('#6e3a30'), sand);
      isoBox(c + 0.6, r + 0.25, c + 0.9, r + 0.58, z, 52, '#d08a69');
      for (const u of [12, 28, 42]) { faceL(r + 0.58, c + 0.7, c + 0.8, z + u, z + u + 7, '#4a2a22'); faceR(c + 0.9, r + 0.35, r + 0.47, z + u, z + u + 7, '#3a2019'); }
      isoBox(c + 0.63, r + 0.28, c + 0.87, r + 0.55, z + 52, 10, '#d79878');
      isoBox(c + 0.67, r + 0.32, c + 0.83, r + 0.5, z + 62, 9, '#dca383');
      const [sx, sy] = P(c + 0.75, r + 0.41, z + 71);
      fillPts([[sx - 4, sy], [sx, sy - 8], [sx + 4, sy]], '#a85f45');
      circ(sx, sy - 10, 1.8, '#3a3a3a'); // the "Männle" on top
      break;
    }
    case 'rathaus': {
      const wall = '#ecd9a6', gy = r + 0.85;
      footShadow(c + 0.08, r + 0.2, c + 0.92, r + 0.85, z);
      isoBox(c + 0.08, r + 0.2, c + 0.92, r + 0.85, z, 20, wall, snowRoof('#c9b37a'));
      fillPts([[c + 0.3, 20], [c + 0.3, 25], [c + 0.37, 25], [c + 0.37, 30], [c + 0.44, 30], [c + 0.44, 36], [c + 0.56, 36],
        [c + 0.56, 30], [c + 0.63, 30], [c + 0.63, 25], [c + 0.7, 25], [c + 0.7, 20]].map(([gx, u]) => P(gx, gy, z + u)), shade(wall, -0.05));
      for (let k = 0; k < 4; k++) faceL(gy, c + 0.13 + k * 0.2, c + 0.21 + k * 0.2, z + 4, z + 10, GLASS);
      faceR(c + 0.92, r + 0.3, r + 0.4, z + 4, z + 10, shade(GLASS, -0.2)); faceR(c + 0.92, r + 0.6, r + 0.7, z + 4, z + 10, shade(GLASS, -0.2));
      const [kx, ky] = P(c + 0.5, gy, z + 25);
      ell(kx, ky, 5.5, 5.5, '#2f4a8a'); ell(kx, ky, 3.8, 3.8, '#e2b13c');
      line(kx, ky, kx + Math.cos(t * 0.5) * 3.4, ky + Math.sin(t * 0.5) * 3.4, '#222', 1);
      break;
    }
    case 'kaethchen': {
      const wall = '#f8f1e0', beam = '#6b4226';
      footShadow(c + 0.2, r + 0.25, c + 0.8, r + 0.8, z);
      isoBox(c + 0.2, r + 0.25, c + 0.8, r + 0.8, z, 16, wall);
      const L = (a, u, b, v) => { const p = P(a, r + 0.8, z + u), q = P(b, r + 0.8, z + v); line(p[0], p[1], q[0], q[1], beam, 1.4); };
      const R = (a, u, b, v) => { const p = P(c + 0.8, a, z + u), q = P(c + 0.8, b, z + v); line(p[0], p[1], q[0], q[1], shade(beam, -0.2), 1.4); };
      L(c + 0.2, 8, c + 0.8, 8); L(c + 0.5, 0, c + 0.5, 16); L(c + 0.2, 0, c + 0.5, 8); L(c + 0.8, 0, c + 0.5, 8); L(c + 0.2, 16, c + 0.5, 8); L(c + 0.8, 16, c + 0.5, 8);
      R(r + 0.25, 8, r + 0.8, 8); R(r + 0.52, 0, r + 0.52, 16); R(r + 0.25, 16, r + 0.52, 8); R(r + 0.8, 16, r + 0.52, 8);
      roofX(c + 0.16, r + 0.21, c + 0.84, r + 0.84, z + 16, 17, snowRoof('#a3402e'), wall);
      break;
    }
    case 'experimenta': {
      footShadow(c + 0.08, r + 0.12, c + 0.92, r + 0.88, z, 1.3);
      isoBox(c + 0.08, r + 0.12, c + 0.92, r + 0.88, z, 30, '#2c3e55', '#3e5878');
      for (let k = 0; k < 5; k++) {
        const al = 0.35 + 0.3 * Math.sin(t * 2 + k);
        let a = P(c + 0.08 + k * 0.17, r + 0.88, z), b = P(Math.min(c + 0.92, c + 0.25 + k * 0.17), r + 0.88, z + 30);
        line(a[0], a[1], b[0], b[1], `rgba(143,211,255,${al})`, 2);
        a = P(c + 0.92, r + 0.12 + k * 0.15, z); b = P(c + 0.92, Math.min(r + 0.88, r + 0.27 + k * 0.15), z + 30);
        line(a[0], a[1], b[0], b[1], `rgba(143,211,255,${al * 0.7})`, 2);
      }
      const e = [P(c + 0.08, r + 0.88, z + 30), P(c + 0.92, r + 0.88, z + 30), P(c + 0.92, r + 0.12, z + 30)];
      X.strokeStyle = '#8fd3ff'; X.lineWidth = 1.5; X.beginPath(); X.moveTo(...e[0]); X.lineTo(...e[1]); X.lineTo(...e[2]); X.stroke();
      break;
    }
    case 'bahnhof': {
      const wall = '#dccaa3';
      footShadow(c + 0.02, r + 0.3, c + 0.98, r + 0.9, z);
      isoBox(c + 0.02, r + 0.3, c + 0.98, r + 0.9, z, 14, wall, snowRoof('#a8957a'));
      const [ax, ay] = P(c + 0.5, r + 0.9, z);
      X.fillStyle = '#4a4036'; X.beginPath(); X.ellipse(ax, ay - 1, 8, 10, 0, Math.PI, 0); X.fill();
      for (const gx of [0.12, 0.25, 0.7, 0.83]) faceL(r + 0.9, c + gx, c + gx + 0.07, z + 4, z + 9, GLASS);
      isoBox(c + 0.4, r + 0.36, c + 0.6, r + 0.56, z + 14, 20, '#d2bf96', snowRoof('#b8a47c'));
      const [kx, ky] = P(c + 0.5, r + 0.56, z + 28);
      ell(kx, ky, 3.5, 3.5, '#ffffff'); line(kx, ky, kx, ky - 2.5, '#222', 0.9);
      break;
    }
    case 'wartturm': {
      const [x, y] = P(c + 0.5, r + 0.5, z);
      ell(x + 10, y + 2, 14, 5, 'rgba(20,40,10,.25)');
      cyl(x, y, 10, 42, '#c4b391', '#a89874');
      for (let k = 0; k < 5; k++) rect(x - 10 + k * 4.4, y - 46, 3, 4, shade('#c4b391', k < 2 ? 0.1 : -0.15));
      rect(x - 1.5, y - 30, 3, 7, '#4a4036'); rect(x - 2, y - 12, 4, 12, '#4a4036');
      line(x, y - 46, x, y - 60, '#555', 1);
      fillPts([[x, y - 60], [x + 10 + Math.sin(t * 3) * 2, y - 57], [x, y - 54]], '#d9534f');
      break;
    }
  }
  if (o.filter) badge(c, r, z);
}

function drawObject(o, c, r, z, s, i) {
  if (isTree(o.id)) drawTree(o, c, r, z, s, i);
  else drawBuilding(o, c, r, z, s, i);
}

// ----- particles -----------------------------------------------------------
function spawnSmoke(s, dt) {
  const Pt = Render.particles;
  const wx = (s.wind.dx - s.wind.dy) * 14, wy = (s.wind.dx + s.wind.dy) * 7;
  forEachObj(s, (o, i) => {
    const d = CATALOG[o.id], e = EMIT[o.id];
    if (!d.smoke || !e || Pt.length > 500) return;
    const rate = d.emission * 2.2 * (o.filter ? 0.4 : 1);
    if (Math.random() > rate * dt) return;
    const c = i % COLS, r = (i / COLS) | 0;
    const [x, y] = P(c + e[0], r + e[1], Render.Z[i] + e[2]);
    Pt.push({
      x, y, vx: wx + (Math.random() - 0.5) * 5, vy: -12 + wy + (Math.random() - 0.5) * 3,
      life: 0, max: 2.5 + Math.random() * 2.5, size: 1.5 + Math.random() * 1.5,
      tone: o.filter ? 240 : d.cat === 'industry' ? 95 : 185,
    });
  });
}

function updateWeather(s, dt) {
  const Wt = Render.weather;
  const want = s.season === 'winter' ? 140 : s.season === 'autumn' ? 40 : s.season === 'spring' ? 22 : 0;
  const kind = s.season;
  const W = Render.vw, H = Render.vh;
  while (Wt.length < want) Wt.push({ x: Math.random() * W, y: Math.random() * -H, kind, ph: Math.random() * 6 });
  for (let i = Wt.length - 1; i >= 0; i--) {
    const p = Wt[i];
    p.y += (p.kind === 'winter' ? 30 : 20) * dt; p.ph += dt * 2;
    p.x += (Math.sin(p.ph) * 12 + (s.wind.dx - s.wind.dy) * 10) * dt;
    if (p.y > H + 5 || p.x < -10 || p.x > W + 10 || p.kind !== kind) {
      if (Wt.length > want || p.kind !== kind) { Wt.splice(i, 1); continue; }
      p.y = -5; p.x = Math.random() * W;
    }
  }
}

// ----- main frame ----------------------------------------------------------
function tilePath(c, r, z, inset) {
  const d = diamond(c, r, z, inset);
  X.moveTo(d[0][0], d[0][1]); for (let k = 1; k < 4; k++) X.lineTo(d[k][0], d[k][1]); X.closePath();
}

function renderFrame(s, ui, dt) {
  X = Render.ctx;
  Render.t += dt;
  if (Render.groundKey !== groundKey(s)) drawGround(s);
  X = Render.ctx;
  X.setTransform(Render.dpr, 0, 0, Render.dpr, 0, 0);
  const W = Render.vw, H = Render.vh;
  X.drawImage(Render.ground, 0, 0, W, H);
  worldTransform(X);
  const Z = Render.Z, t = Render.t;

  // twinkling water highlights
  s.tiles.forEach((tile, i) => {
    if (tile.g !== 'water') return;
    const c = i % COLS, r = (i / COLS) | 0;
    for (let k = 0; k < 3; k++) {
      const a = Math.sin(t * 2.2 + hash(i, k) * 20);
      if (a < 0.4) continue;
      const p = P(c + 0.1 + hash(i, k + 40) * 0.8, r + 0.1 + hash(i, k + 41) * 0.8, Z_WATER);
      X.fillStyle = `rgba(255,255,255,${(a - 0.4) * 1.4})`;
      X.fillRect(p[0] - 2.5, p[1] - 0.6, 5, 1.2); X.fillRect(p[0] - 0.6, p[1] - 1.8, 1.2, 3.6);
    }
  });

  if (ui.tool) { // faint grid while building
    X.strokeStyle = 'rgba(255,255,255,.18)'; X.lineWidth = 1; X.beginPath();
    for (let i = 0; i < COLS * ROWS; i++) tilePath(i % COLS, (i / COLS) | 0, Z[i]);
    X.stroke();
  }

  if (ui.overlay !== 'none') {
    for (let i = 0; i < COLS * ROWS; i++) {
      const col = ui.overlay === 'smog'
        ? lerp3([[80, 190, 100], [235, 200, 60], [120, 45, 95]], Fields.pol[i] / 75)
        : lerp3([[60, 120, 225], [245, 220, 80], [225, 50, 40]], (Fields.heat[i] - 0.5) / 4.5);
      fillPts(diamond(i % COLS, (i / COLS) | 0, Z[i]), `rgba(${col.join(',')},.55)`);
    }
  }

  // objects, back to front
  for (const i of Render.order) {
    const o = s.tiles[i].o, c = i % COLS, r = (i / COLS) | 0;
    if (o && tileVisible(c, r, Z[i], 100)) drawObject(o, c, r, Z[i], s, i);
  }

  // smoke
  spawnSmoke(s, dt * Math.max(1, ui.speed));
  const Pt = Render.particles;
  for (let i = Pt.length - 1; i >= 0; i--) {
    const p = Pt[i];
    p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.size += dt * 3.5;
    if (p.life > p.max) { Pt.splice(i, 1); continue; }
    const k = p.life / p.max, a = Math.sin(Math.PI * Math.sqrt(k)) * (p.tone > 200 ? 0.3 : 0.5); // fade in, then out
    circ(p.x, p.y, p.size, `rgba(${p.tone},${p.tone - 4},${p.tone - 8},${a})`);
    circ(p.x - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.5, `rgba(255,255,255,${a * 0.3})`);
  }

  // hover: ghost preview, effect radius, outline
  drawHover(s, ui);

  // screen-space effects
  X.setTransform(Render.dpr, 0, 0, Render.dpr, 0, 0);
  if (s.power && s.power.unserved > 0) { // blackout: the city dims and flickers
    const k = (1 - s.power.ratio) * (0.35 + 0.05 * Math.sin(t * 9));
    X.fillStyle = `rgba(15,20,55,${Math.min(0.4, k)})`; X.fillRect(0, 0, W, H);
  }
  if (s.smog > 5) { X.fillStyle = `rgba(115,100,70,${Math.min(0.42, s.smog / 100 * 0.42)})`; X.fillRect(0, 0, W, H); }
  if (s.season === 'summer' && s.temp + s.mods.heatwave > 2.6) {
    const k = Math.min(0.28, (s.temp + s.mods.heatwave - 2.6) * 0.12);
    const g = X.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, 'rgba(255,170,60,0)'); g.addColorStop(1, `rgba(255,120,30,${k})`);
    X.fillStyle = g; X.fillRect(0, 0, W, H);
  }

  updateWeather(s, dt);
  for (const p of Render.weather) {
    if (p.kind === 'winter') circ(p.x, p.y, 1.8, 'rgba(255,255,255,.9)');
    else if (p.kind === 'autumn') ell(p.x, p.y, 3, 1.6, ['#d9472b', '#e8a33a', '#c9a83a'][Math.floor(p.ph) % 3]);
    else circ(p.x, p.y, 1.7, 'rgba(255,190,220,.9)');
  }
}

function drawHover(s, ui) {
  const hv = ui.hover, Z = Render.Z;
  if (hv) {
    const i = idx(hv.c, hv.r), z = Z[i];
    const d = ui.tool && CATALOG[ui.tool];
    const chk = ui.tool ? canPlace(s, ui.tool, hv.c, hv.r) : { ok: true };
    if (d && chk.ok && d.cat !== 'tools') {
      X.globalAlpha = 0.6;
      drawObject({ id: ui.tool, age: d.grow || 0, health: 100 }, hv.c, hv.r, z, s, i);
      X.globalAlpha = 1;
    }
    const radius = !d ? 0 : d.absorb ? 2 : d.emission ? 3 : ui.tool === 'tram' ? 3 : 0;
    if (radius) {
      const ox = d.emission ? s.wind.dx : 0, oy = d.emission ? s.wind.dy : 0;
      const [cx, cy] = P(hv.c + 0.5 + ox, hv.r + 0.5 + oy, z);
      X.setLineDash([5, 5]); X.lineWidth = 2;
      X.strokeStyle = d.emission ? 'rgba(120,60,40,.85)' : ui.tool === 'tram' ? 'rgba(242,194,48,.95)' : 'rgba(255,255,255,.9)';
      X.beginPath(); X.ellipse(cx, cy, (radius + 0.5) * TW / 2 * Math.SQRT2, (radius + 0.5) * TH / 2 * Math.SQRT2, 0, 0, Math.PI * 2); X.stroke();
      X.setLineDash([]);
    }
    X.lineWidth = 2;
    X.strokeStyle = !ui.tool ? 'rgba(255,255,255,.75)' : chk.ok ? 'rgba(255,255,255,.95)' : 'rgba(235,60,60,.95)';
    X.beginPath(); tilePath(hv.c, hv.r, z, 0.02); X.stroke();
  }
}

// Small line chart of smog & temperature history.
function renderTrend(canvas, s) {
  const ctx = canvas.getContext('2d');
  const dpr = Render.dpr, w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const css = getComputedStyle(document.documentElement);
  ctx.strokeStyle = css.getPropertyValue('--line').trim(); ctx.lineWidth = 1;
  for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(0, h * k / 4 + 0.5); ctx.lineTo(w, h * k / 4 + 0.5); ctx.stroke(); }
  const hist = s.history.slice(-120);
  if (hist.length < 2) return;
  const plot = (key, max, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
    hist.forEach((p, i) => {
      const x = i / (hist.length - 1) * w, y = h - 3 - Math.min(1, p[key] / max) * (h - 6);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  };
  plot('smog', 100, css.getPropertyValue('--smog').trim());
  plot('temp', 5, css.getPropertyValue('--heat').trim());
}

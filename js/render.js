'use strict';
// ---------------------------------------------------------------------------
// Isometric canvas renderer in a soft, hand-painted "Ghibli" style.
// Everything is drawn procedurally – no image assets.
//
// Heilbronn is a floating island in the sky: land sits at z=0, the Neckar is
// sunk below it and pours off the island edge as a waterfall, the Wartberg
// rises in terraces, and a rocky underside with hanging roots drifts above
// the clouds. Light comes from the top-left; shadows are cool blue-green.
//
// The painted terrain is cached once per season in a world-space canvas, so
// panning and zooming only cost a drawImage.
// ---------------------------------------------------------------------------

const TW = 64, TH = 32;                       // tile diamond size on screen
const PAD_X = 24, OY = 96;                    // room for tall chimneys at the top
const OX = PAD_X + ROWS * TW / 2;
const WORLD_W = PAD_X * 2 + (COLS + ROWS) * TW / 2;
const ISLAND_BOTTOM = OY + (COLS + ROWS) * TH / 2;      // lowest point of the land surface
const WORLD_H = ISLAND_BOTTOM + 400;                     // + room for the rocky underside
const Z_WATER = -10, Z_BOTTOM = -36;

const Render = {
  canvas: null, ctx: null, dpr: 1,
  ground: null, groundKey: '', groundScale: 2, Z: null, order: null,
  particles: [], weather: [], t: 0,
  clouds: [], cloudSprites: [], shadows: [],
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
// Fit the island (plus the top of its underside) into the free part of the view.
function camFit() {
  const c = Render.cam, { l, t, r, b } = Render.safe, [cx, cy] = safeCenter();
  const fitH = ISLAND_BOTTOM + 140;
  c.z = Math.min((Render.vw - l - r) / WORLD_W, (Render.vh - t - b) / fitH);
  c.x = WORLD_W / 2 - cx / c.z; c.y = fitH / 2 + 20 - cy / c.z;
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
// smooth value noise, 0..1
function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => hash(a * 57 + b * 131 + seed * 7, seed);
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}

// grid coords (corner-based, may be fractional) + height → world point
const P = (gx, gy, z) => [OX + (gx - gy) * TW / 2, OY + (gx + gy) * TH / 2 - (z || 0)];
const hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };

// ----- primitives (draw on the current context X) --------------------------
let X = null;
function pathPts(pts) { X.beginPath(); X.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) X.lineTo(pts[k][0], pts[k][1]); X.closePath(); }
function fillPts(pts, col) { X.fillStyle = col; pathPts(pts); X.fill(); }
function circ(x, y, r, c) { X.fillStyle = c; X.beginPath(); X.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2); X.fill(); }
function ell(x, y, rx, ry, c) { X.fillStyle = c; X.beginPath(); X.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2); X.fill(); }
function rect(x, y, w, h, c) { X.fillStyle = c; X.fillRect(x, y, w, h); }
function line(x1, y1, x2, y2, c, w) { X.strokeStyle = c; X.lineWidth = w || 1; X.beginPath(); X.moveTo(x1, y1); X.lineTo(x2, y2); X.stroke(); }
function curve(x1, y1, cx, cy, x2, y2, c, w) { X.strokeStyle = c; X.lineWidth = w || 1; X.beginPath(); X.moveTo(x1, y1); X.quadraticCurveTo(cx, cy, x2, y2); X.stroke(); }
const diamond = (c, r, z, inset) => {
  const k = inset || 0;
  return [P(c + k, r + k, z), P(c + 1 - k, r + k, z), P(c + 1 - k, r + 1 - k, z), P(c + k, r + 1 - k, z)];
};
// soft round shadow (blurred look via radial gradient)
function softShadow(x, y, rx, ry, a) {
  const g = X.createRadialGradient(x, y, 0, x, y, rx);
  g.addColorStop(0, `rgba(30,50,70,${a})`); g.addColorStop(1, 'rgba(30,50,70,0)');
  X.save(); X.translate(x, y); X.scale(1, ry / rx); X.translate(-x, -y);
  X.fillStyle = g; X.beginPath(); X.arc(x, y, rx, 0, Math.PI * 2); X.fill();
  X.restore();
}

function parseColor(c) {
  if (c[0] === '#') { const n = parseInt(c.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; }
  return c.match(/[\d.]+/g).slice(0, 3).map(Number);
}
function mix(a, b, k) {
  const A = parseColor(a), B = parseColor(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`;
}
// k > 0 lightens toward warm white, k < 0 darkens toward a cool blue shadow
const shade = (c, k) => k >= 0 ? mix(c, '#fffbea', k) : mix(c, '#1d2a3f', -k);
const alpha = (c, a) => `rgba(${parseColor(c).join(',')},${a})`;
function lerp3(stops, k) {
  k = Math.max(0, Math.min(1, k));
  const seg = k < 0.5 ? 0 : 1, kk = k < 0.5 ? k * 2 : (k - 0.5) * 2;
  const A = stops[seg], B = stops[seg + 1];
  return A.map((v, i) => Math.round(v + (B[i] - v) * kk));
}

// ----- iso solids ----------------------------------------------------------
// Face filled with a gentle vertical gradient: sunlit top, slightly darker base.
function faceFill(pts, col) {
  const ys = pts.map(p => p[1]), g = X.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
  g.addColorStop(0, shade(col, 0.1)); g.addColorStop(1, shade(col, -0.1));
  X.fillStyle = g; pathPts(pts); X.fill();
}
// Box over a grid footprint. Visible faces: left-front (gy = gy1), right-front (gx = gx1), top.
function isoBox(gx0, gy0, gx1, gy1, z, h, col, top) {
  faceFill([P(gx0, gy1, z), P(gx1, gy1, z), P(gx1, gy1, z + h), P(gx0, gy1, z + h)], col);
  faceFill([P(gx1, gy0, z), P(gx1, gy1, z), P(gx1, gy1, z + h), P(gx1, gy0, z + h)], shade(col, -0.24));
  fillPts([P(gx0, gy0, z + h), P(gx1, gy0, z + h), P(gx1, gy1, z + h), P(gx0, gy1, z + h)], top || shade(col, 0.2));
  // warm rim light along the top edges
  const a = P(gx0, gy1, z + h), b = P(gx1, gy1, z + h), c2 = P(gx1, gy0, z + h);
  X.strokeStyle = 'rgba(255,248,225,.55)'; X.lineWidth = 0.8;
  X.beginPath(); X.moveTo(a[0], a[1]); X.lineTo(b[0], b[1]); X.lineTo(c2[0], c2[1]); X.stroke();
}
const faceL = (gy, a, b, u, v, col) => fillPts([P(a, gy, u), P(b, gy, u), P(b, gy, v), P(a, gy, v)], col);
const faceR = (gx, a, b, u, v, col) => fillPts([P(gx, a, u), P(gx, b, u), P(gx, b, v), P(gx, a, v)], col);

// Window with cream frame, sky reflection and (optionally) a flower box / shutters.
function winL(gy, a, b, u, v, o) {
  o = o || {};
  if (o.shutter) { faceL(gy, a - 0.05, a - 0.01, u, v, o.shutter); faceL(gy, b + 0.01, b + 0.05, u, v, o.shutter); }
  faceL(gy, a, b, u, v, o.frame || '#fbf3dc');
  const ia = a + (b - a) * 0.16, ib = b - (b - a) * 0.16;
  faceL(gy, ia, ib, u + 0.9, v - 0.9, o.glass || '#7fb4d0');
  faceL(gy, ia, ia + (ib - ia) * 0.4, u + 0.9, v - 0.9, 'rgba(255,255,255,.35)');
  const m0 = P((a + b) / 2, gy, u + 0.9), m1 = P((a + b) / 2, gy, v - 0.9);
  line(m0[0], m0[1], m1[0], m1[1], o.frame || '#fbf3dc', 0.7);
  if (o.box) flowerBoxL(gy, a, b, u);
}
function winR(gx, a, b, u, v, o) {
  o = o || {};
  faceR(gx, a, b, u, v, shade(o.frame || '#fbf3dc', -0.18));
  const ia = a + (b - a) * 0.16, ib = b - (b - a) * 0.16;
  faceR(gx, ia, ib, u + 0.9, v - 0.9, shade(o.glass || '#7fb4d0', -0.25));
  if (o.box) {
    faceR(gx, a - 0.01, b + 0.01, u - 2.2, u, '#7a5232');
    for (let k = 0; k < 4; k++) { const p = P(gx, a + (b - a) * (0.15 + k * 0.23), u); circ(p[0], p[1] - 0.5, 1.1, ['#e8556b', '#ffd34d', '#ff8fb8', '#fff'][k % 4]); }
  }
}
function flowerBoxL(gy, a, b, u) {
  faceL(gy, a - 0.01, b + 0.01, u - 2.2, u, '#8a5a32');
  for (let k = 0; k < 5; k++) {
    const p = P(a + (b - a) * (0.08 + k * 0.21), gy, u);
    circ(p[0], p[1] - 0.3, 1.3, '#4f8f3a');
    circ(p[0] + 0.4, p[1] - 1.1, 0.9, ['#e8556b', '#ffd34d', '#ff8fb8', '#ffffff', '#c792ff'][k]);
  }
}
function doorL(gy, a, b, z, h, col) {
  const p0 = P(a, gy, z), p1 = P(b, gy, z), m = P((a + b) / 2, gy, z + h);
  X.fillStyle = col; X.beginPath();
  X.moveTo(p0[0], p0[1]); X.lineTo(p0[0], p0[1] - h * 0.75);
  X.quadraticCurveTo(m[0] - (p1[0] - p0[0]) * 0.1, m[1] - 2, p1[0], p1[1] - h * 0.75);
  X.lineTo(p1[0], p1[1]); X.closePath(); X.fill();
  const k = P(a + (b - a) * 0.75, gy, z + h * 0.4); circ(k[0], k[1], 0.6, '#f2d27a');
}

// Pitched roof with tile rows, ridge running along gx.
function roofX(gx0, gy0, gx1, gy1, z, h, col, wall) {
  const m = (gy0 + gy1) / 2;
  fillPts([P(gx0, gy0, z), P(gx1, gy0, z), P(gx1, m, z + h), P(gx0, m, z + h)], shade(col, 0.16));
  faceFill([P(gx0, m, z + h), P(gx1, m, z + h), P(gx1, gy1, z), P(gx0, gy1, z)], col);
  for (let k = 1; k < 4; k++) { // tile courses on the front slope
    const f = k / 4, gy = gy1 - (gy1 - m) * f, zz = z + h * f;
    const a = P(gx0, gy, zz), b = P(gx1, gy, zz);
    line(a[0], a[1], b[0], b[1], alpha(shade(col, -0.35), 0.45), 0.7);
  }
  fillPts([P(gx1, gy0, z), P(gx1, gy1, z), P(gx1, m, z + h)], shade(wall, -0.24));
  const r0 = P(gx0, m, z + h), r1 = P(gx1, m, z + h);
  line(r0[0], r0[1], r1[0], r1[1], shade(col, -0.3), 1.4);
  const e0 = P(gx0, gy1, z), e1 = P(gx1, gy1, z), e2 = P(gx1, gy0, z);
  X.strokeStyle = shade(col, -0.35); X.lineWidth = 1; X.beginPath(); X.moveTo(e0[0], e0[1]); X.lineTo(e1[0], e1[1]); X.lineTo(e2[0], e2[1]); X.stroke();
}
// Pitched roof with tile rows, ridge running along gy.
function roofY(gx0, gy0, gx1, gy1, z, h, col, wall) {
  const m = (gx0 + gx1) / 2;
  fillPts([P(gx0, gy0, z), P(m, gy0, z + h), P(m, gy1, z + h), P(gx0, gy1, z)], shade(col, 0.16));
  faceFill([P(m, gy0, z + h), P(gx1, gy0, z), P(gx1, gy1, z), P(m, gy1, z + h)], shade(col, -0.14));
  for (let k = 1; k < 4; k++) {
    const f = k / 4, gx = gx1 - (gx1 - m) * f, zz = z + h * f;
    const a = P(gx, gy0, zz), b = P(gx, gy1, zz);
    line(a[0], a[1], b[0], b[1], alpha(shade(col, -0.45), 0.45), 0.7);
  }
  fillPts([P(gx0, gy1, z), P(gx1, gy1, z), P(m, gy1, z + h)], wall);
  const r0 = P(m, gy0, z + h), r1 = P(m, gy1, z + h);
  line(r0[0], r0[1], r1[0], r1[1], shade(col, -0.3), 1.4);
}
// Upright cylinder standing on point (x, y).
function cyl(x, y, r, h, col, top) {
  const g = X.createLinearGradient(x - r, 0, x + r, 0);
  g.addColorStop(0, shade(col, 0.28)); g.addColorStop(0.4, col); g.addColorStop(1, shade(col, -0.32));
  X.fillStyle = g;
  X.fillRect(x - r, y - h, r * 2, h);
  X.beginPath(); X.ellipse(x, y, r, r * 0.5, 0, 0, Math.PI); X.fill();
  ell(x, y - h, r, r * 0.5, top || shade(col, 0.3));
}
// Tapered brick chimney with white bands.
function brickChimney(x, y, w0, w1, h, col) {
  const g = X.createLinearGradient(x - w0, 0, x + w0, 0);
  g.addColorStop(0, shade(col, 0.22)); g.addColorStop(0.45, col); g.addColorStop(1, shade(col, -0.3));
  X.fillStyle = g; X.beginPath();
  X.moveTo(x - w0, y); X.lineTo(x - w1, y - h); X.lineTo(x + w1, y - h); X.lineTo(x + w0, y); X.closePath(); X.fill();
  for (let k = 1; k < h / 6; k++) { const yy = y - k * 6, ww = w0 + (w1 - w0) * (k * 6 / h); line(x - ww, yy, x + ww, yy, 'rgba(60,20,10,.18)', 0.6); }
  for (const f of [0.82, 0.9]) { const yy = y - h * f, ww = w0 + (w1 - w0) * f; rect(x - ww, yy - 1.5, ww * 2, 3, '#efe6d6'); }
  ell(x, y - h, w1 + 1, (w1 + 1) * 0.45, shade(col, -0.2)); ell(x, y - h, w1 - 0.5, (w1 - 0.5) * 0.4, '#2b2522');
}
function contact(gx0, gy0, gx1, gy1, z) { // soft contact shadow under a footprint
  const [x, y] = P((gx0 + gx1) / 2 + 0.12, (gy0 + gy1) / 2 + 0.05, z);
  softShadow(x + 4, y + 3, (gx1 - gx0 + gy1 - gy0) * 26, (gx1 - gx0 + gy1 - gy0) * 12, 0.32);
}

// ----- foliage ---------------------------------------------------------------
// Layered leaf clumps: a cool shadow mass, then each clump from back to front
// with a scalloped edge, sunlit leaf bunches on its upper-left and a warm rim.
function treePalette(base) {
  return { base, dark: mix(base, '#1c3a48', 0.5), deep: mix(base, '#2a4f45', 0.28), light: mix(base, '#fff2a8', 0.38), rim: mix(base, '#fffbe2', 0.62) };
}
function crown(clumps, pal, seed) {
  clumps.forEach(([x, y, r]) => circ(x + r * 0.18, y + r * 0.25, r * 1.04, pal.dark));
  [...clumps].sort((a, b) => a[1] - b[1]).forEach(([x, y, r], k) => {
    circ(x, y, r * 0.9, pal.deep);
    for (let j = 0; j < 7; j++) {
      const a = -Math.PI * 1.05 + j * 0.52 + hash(seed + k, j) * 0.25;
      circ(x + Math.cos(a) * r * 0.74, y + Math.sin(a) * r * 0.6, r * 0.34, pal.base);
    }
    circ(x - r * 0.08, y - r * 0.1, r * 0.66, pal.base);
    for (let j = 0; j < 4; j++) {
      const a = -2.5 + j * 0.42 + hash(seed + k, j + 9) * 0.25;
      circ(x + Math.cos(a) * r * 0.44, y + Math.sin(a) * r * 0.42, r * 0.27, pal.light);
    }
    circ(x - r * 0.38, y - r * 0.44, r * 0.16, pal.rim);
    for (let j = 0; j < 3; j++) circ(x + (hash(seed + k, j + 20) - 0.3) * r, y + (hash(seed + k, j + 30) - 0.1) * r * 0.7, r * 0.09, pal.dark);
  });
}
function bushAt(x, y, base, seed, k) {
  k = k || 1;
  softShadow(x + 5 * k, y + 1.5, 9 * k, 3.5 * k, 0.3);
  crown([[x - 3.5 * k, y - 3.5 * k, 4.6 * k], [x + 3.5 * k, y - 3.5 * k, 4.6 * k], [x, y - 7 * k, 4.4 * k]], treePalette(base), seed);
}

// ----- setup ---------------------------------------------------------------
function renderInit(canvas) {
  Render.canvas = canvas;
  Render.ctx = canvas.getContext('2d');
  Render.dpr = Math.min(2, window.devicePixelRatio || 1);
  Render.ground = document.createElement('canvas');
  // world-space terrain cache; capped to stay under mobile canvas-size limits
  Render.groundScale = Math.min(Math.max(2, Render.dpr * 1.5), Math.sqrt(15.5e6 / (WORLD_W * WORLD_H)));
  Render.ground.width = Math.round(WORLD_W * Render.groundScale);
  Render.ground.height = Math.round(WORLD_H * Render.groundScale);
  renderResize();
  // back-to-front draw order
  Render.order = [...Array(COLS * ROWS).keys()].sort((a, b) => {
    const ca = a % COLS, ra = (a / COLS) | 0, cb = b % COLS, rb = (b / COLS) | 0;
    return (ca + ra) - (cb + rb) || ca - cb;
  });
  initSky();
}

// Match the canvas backing store to its on-screen size.
function renderResize() {
  const cv = Render.canvas, d = Render.dpr;
  Render.vw = Math.max(1, cv.clientWidth); Render.vh = Math.max(1, cv.clientHeight);
  cv.width = Math.round(Render.vw * d);
  cv.height = Math.round(Render.vh * d);
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

// ----- sky & clouds ------------------------------------------------------------
// Puffy cumulus sprite: two rows of irregular puffs, lavender shading underneath,
// a warm sunlit rim on top, and a base that dissolves softly instead of a hard edge.
function makeCloud(seed, w, h) {
  const k = 2, cv = document.createElement('canvas');
  cv.width = w * k; cv.height = h * k;
  const g = cv.getContext('2d'); g.scale(k, k);
  const puffs = [];
  const n = 9 + Math.floor(hash(seed, 1) * 5);
  for (let j = 0; j < n; j++) {
    const u = hash(seed, j + 2), back = j % 3 === 0;
    const r = h * (0.1 + Math.sin(Math.PI * u) * 0.2 + hash(seed, j + 20) * 0.08) * (back ? 1.15 : 1);
    puffs.push([w * (0.1 + u * 0.8), h * 0.66 - r * 0.6 - Math.sin(Math.PI * u) * h * (back ? 0.2 : 0.08), r]);
  }
  puffs.sort((a, b) => a[1] - b[1]);
  const dot = (x, y, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  puffs.forEach(([x, y, r]) => dot(x + r * 0.1, y + r * 0.3, r, '#aab6dc'));
  puffs.forEach(([x, y, r]) => {
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.1, x, y, r);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.55, '#f3f5fc'); gr.addColorStop(1, '#c9d1ec');
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 0.94, 0, Math.PI * 2); g.fill();
  });
  puffs.forEach(([x, y, r]) => dot(x - r * 0.4, y - r * 0.55, r * 0.28, 'rgba(255,246,220,.9)'));
  // dissolve the base
  g.globalCompositeOperation = 'destination-out';
  const fade = g.createLinearGradient(0, h * 0.55, 0, h * 0.85);
  fade.addColorStop(0, 'rgba(0,0,0,0)'); fade.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fade; g.fillRect(0, h * 0.55, w, h * 0.45);
  g.globalCompositeOperation = 'source-over';
  return cv;
}

function initSky() {
  Render.cloudSprites = [0, 1, 2, 3, 4].map(k => makeCloud(k * 7 + 3, 320, 150));
  const C = Render.clouds = [];
  // far clouds around and behind the island, near clouds drifting under its belly
  for (let k = 0; k < 9; k++) C.push({ layer: 'far', x: hash(k, 3) * (WORLD_W + 600) - 300, y: hash(k, 4) * (WORLD_H * 0.8) + 40, s: 0.55 + hash(k, 5) * 0.6, sp: 3 + hash(k, 6) * 4, img: k % 5 });
  for (let k = 0; k < 12; k++) C.push({ layer: 'near', x: hash(k, 7) * (WORLD_W + 600) - 300, y: WORLD_H - 210 + hash(k, 8) * 120, s: 1 + hash(k, 9) * 0.8, sp: 5 + hash(k, 10) * 6, img: (k + 2) % 5 });
  Render.shadows = [0, 1, 2].map(k => ({ x: hash(k, 11) * WORLD_W, y: OY + hash(k, 12) * 700, r: 120 + hash(k, 13) * 90 }));
}

const SKY = {
  spring: ['#6fb6ec', '#a9d8f3', '#f7ecd6'], summer: ['#4fa6e8', '#9bd2f3', '#fbeac8'],
  autumn: ['#7aa8d8', '#b9d2e8', '#f6d9b0'], winter: ['#8fb1cf', '#c9dbe8', '#eef1f1'],
};
function drawSky(s) {
  const W = Render.vw, H = Render.vh, [a, b, c] = SKY[s.season];
  const g = X.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, a); g.addColorStop(0.55, b); g.addColorStop(1, c);
  X.fillStyle = g; X.fillRect(0, 0, W, H);
  const sun = X.createRadialGradient(W * 0.12, H * 0.05, 0, W * 0.12, H * 0.05, Math.max(W, H) * 0.6);
  sun.addColorStop(0, 'rgba(255,248,220,.75)'); sun.addColorStop(0.25, 'rgba(255,240,200,.25)'); sun.addColorStop(1, 'rgba(255,240,200,0)');
  X.fillStyle = sun; X.fillRect(0, 0, W, H);
}
function drawClouds(layer, dt) {
  for (const cl of Render.clouds) {
    if (cl.layer !== layer) continue;
    cl.x += cl.sp * dt;
    if (cl.x > WORLD_W + 320) cl.x = -320 - 320 * cl.s;
    const img = Render.cloudSprites[cl.img];
    X.globalAlpha = layer === 'far' ? 0.85 : 0.95;
    X.drawImage(img, cl.x, cl.y, 320 * cl.s, 150 * cl.s);
  }
  X.globalAlpha = 1;
}

// ----- painted terrain --------------------------------------------------------
const GRASS = {
  spring: ['#b3dc72', '#82c65c', '#5aa85e'], summer: ['#a6d064', '#72b64e', '#4c9551'],
  autumn: ['#d4be6c', '#adaa58', '#859652'], winter: ['#fbfcf8', '#e9f0f2', '#d3e0ea'],
};
const HILL = {
  spring: ['#c2e07a', '#93cb5e', '#69ad58'], summer: ['#b8d86c', '#86bf52', '#5d9e4e'],
  autumn: ['#ddc06a', '#bca656', '#94904c'], winter: ['#fdfdf9', '#edf3f4', '#d8e3ec'],
};
const FLOWERS = ['#ff8fb8', '#ffffff', '#ffd84a', '#c9a0ff', '#ff6f61', '#9fd8ff'];
const STONES = ['#b3a58f', '#c4b69d', '#a39784', '#cdbfa6', '#b9ad99'];

const isWet = (s, c, r) => inBounds(c, r) && (s.tiles[idx(c, r)].g === 'water' || s.tiles[idx(c, r)].g === 'bridge');
const isRoadish = (s, c, r) => inBounds(c, r) && (s.tiles[idx(c, r)].g === 'road' || s.tiles[idx(c, r)].g === 'bridge');

// painterly ground color: two octaves of noise across three greens
function groundColor(pal, gx, gy) {
  const n = noise2(gx / 3.2, gy / 3.2, 1) * 0.65 + noise2(gx / 1.2, gy / 1.2, 5) * 0.35;
  return n < 0.5 ? mix(pal[2], pal[1], n * 2) : mix(pal[1], pal[0], (n - 0.5) * 2);
}

function clipTile(c, r, z) {
  const d = diamond(c, r, z, -0.012);
  X.save(); pathPts(d); X.clip();
}

function paintGrass(s, i, c, r, z, pal) {
  const winter = s.season === 'winter';
  clipTile(c, r, z);
  fillPts(diamond(c, r, z, -0.02), groundColor(pal, c + 0.5, r + 0.5));
  for (let k = 0; k < 11; k++) { // watercolor dabs that blend across tile edges
    const gx = c - 0.15 + hash(i, k) * 1.3, gy = r - 0.15 + hash(i, k + 40) * 1.3;
    const p = P(gx, gy, z), rr = 7 + hash(i, k + 80) * 9;
    ell(p[0], p[1], rr, rr * 0.5, alpha(shade(groundColor(pal, gx, gy), (hash(i, k + 90) - 0.5) * 0.12), 0.45));
  }
  if (!winter) for (let k = 0; k < 22; k++) { // grass blades with sunlit tips
    const p = P(c + hash(i, k + 120), r + hash(i, k + 160), z);
    const base = groundColor(pal, c + 0.5, r + 0.5), lean = (hash(i, k + 200) - 0.5) * 3;
    curve(p[0], p[1], p[0] + lean * 0.3, p[1] - 2.5, p[0] + lean, p[1] - 4.5, alpha(shade(base, -0.3), 0.7), 0.9);
    if (k % 3 === 0) circ(p[0] + lean, p[1] - 4.5, 0.6, alpha(shade(base, 0.45), 0.9));
  } else for (let k = 0; k < 6; k++) { // a few dry stalks poking through the snow
    const p = P(c + hash(i, k + 120), r + hash(i, k + 160), z);
    line(p[0], p[1], p[0] + 0.6, p[1] - 3, 'rgba(120,110,80,.5)', 0.8);
  }
  X.restore();
}

function cliffFaces(s, c, r, z, topCol) {
  const winter = s.season === 'winter';
  [[1, 0], [0, 1]].forEach(([dc, dr]) => {
    const nz = zAt(c + dc, r + dr);
    if (nz >= z) return;
    const right = dc === 1, i = idx(c, r) + (right ? 7 : 0);
    const pts = right ? [P(c + 1, r, z), P(c + 1, r + 1, z), P(c + 1, r + 1, nz), P(c + 1, r, nz)]
      : [P(c, r + 1, z), P(c + 1, r + 1, z), P(c + 1, r + 1, nz), P(c, r + 1, nz)];
    const ys = pts.map(p => p[1]), g = X.createLinearGradient(0, Math.min(...ys), 0, Math.max(...ys));
    const soil = right ? '#9c7150' : '#b98a5c';
    g.addColorStop(0, shade(soil, 0.06)); g.addColorStop(1, mix(soil, '#4a4f6e', 0.35));
    X.fillStyle = g; pathPts(pts); X.fill();
    X.strokeStyle = g; X.lineWidth = 0.9; X.stroke(); // hide anti-aliasing seams between tiles
    const at = (f, zz) => right ? P(c + 1, r + f, zz) : P(c + f, r + 1, zz);
    X.save(); pathPts(pts); X.clip();
    for (let k = 1; k * 9 < z - nz; k++) { // wavy strata
      const zz = z - k * 9 + (hash(i, k) - 0.5) * 3;
      const a = at(0, zz), m = at(0.5, zz + (hash(i, k + 5) - 0.5) * 3), b = at(1, zz);
      curve(a[0], a[1], m[0], m[1], b[0], b[1], 'rgba(70,40,25,.22)', 1);
    }
    for (let k = 0; k < (z - nz) / 6; k++) { // embedded pebbles
      const p = at(hash(i, k + 30), z - 4 - hash(i, k + 40) * (z - nz - 6));
      ell(p[0], p[1], 1.8, 1.2, 'rgba(225,210,190,.55)');
    }
    X.restore();
    // mossy lip with grass hanging over the edge
    const lipCol = winter ? '#eef4f6' : shade(topCol, -0.12);
    const l0 = at(0, z), l1 = at(1, z);
    X.strokeStyle = lipCol; X.lineWidth = 3; X.beginPath(); X.moveTo(l0[0], l0[1] + 1); X.lineTo(l1[0], l1[1] + 1); X.stroke();
    if (!winter) for (let k = 0; k < 7; k++) {
      const p = at(0.05 + hash(i, k + 50) * 0.9, z), len = 2 + hash(i, k + 60) * (z - nz > 20 ? 9 : 4);
      curve(p[0], p[1], p[0] + 1.5, p[1] + len * 0.5, p[0] + 0.5, p[1] + len, alpha(shade(topCol, -0.25), 0.85), 1);
    }
    if (!winter && z - nz > 20 && hash(i, 70) < 0.35) { // dangling root
      const p = at(0.2 + hash(i, 71) * 0.6, z - 2), len = 10 + hash(i, 72) * 14;
      curve(p[0], p[1], p[0] - 3, p[1] + len * 0.6, p[0] + 1, p[1] + len, 'rgba(110,75,45,.8)', 1.1);
    }
  });
}

function drawRoad(s, c, r, z) {
  const h = isRoadish(s, c - 1, r) || isRoadish(s, c + 1, r);
  const v = isRoadish(s, c, r - 1) || isRoadish(s, c, r + 1);
  const winter = s.season === 'winter', i = idx(c, r);
  const strip = (along, a, b) => along === 'x'
    ? [P(c, r + a, z), P(c + 1, r + a, z), P(c + 1, r + b, z), P(c, r + b, z)]
    : [P(c + a, r, z), P(c + b, r, z), P(c + b, r + 1, z), P(c + a, r + 1, z)];
  const strips = [];
  if (h) strips.push(strip('x', 0.24, 0.76));
  if (v) strips.push(strip('y', 0.24, 0.76));
  if (!h && !v) strips.push(diamond(c, r, z, 0.24));
  X.save();
  X.beginPath(); strips.forEach(st => { X.moveTo(st[0][0], st[0][1]); st.slice(1).forEach(p => X.lineTo(p[0], p[1])); X.closePath(); });
  X.fillStyle = winter ? '#e7eaec' : '#a99b85'; X.fill(); X.clip();
  for (let k = 0; k < 70; k++) { // cobblestones
    const p = P(c + hash(i, k + 300), r + hash(i, k + 400), z);
    const col = winter ? (k % 3 ? '#f4f6f6' : '#d8dde0') : STONES[k % STONES.length];
    ell(p[0], p[1], 2.7, 1.5, col);
    ell(p[0] - 0.7, p[1] - 0.5, 1.2, 0.6, 'rgba(255,250,235,.45)');
  }
  X.restore();
  // grass nibbling at the edges
  if (!winter) strips.forEach(st => {
    [[st[0], st[1]], [st[3], st[2]]].forEach(([a, b]) => {
      for (let k = 0; k < 5; k++) {
        const f = hash(i + k, a[0]), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
        line(x, y, x + 0.8, y - 3, 'rgba(70,130,60,.75)', 0.9);
      }
    });
  });
}

function drawBridge(s, c, r) {
  const z = 0, stone = '#c9b79a', winter = s.season === 'winter';
  // arched stone side (visible face) down to the water
  const front = [P(c, r + 0.84, z), P(c + 1, r + 0.84, z), P(c + 1, r + 0.84, Z_WATER), P(c, r + 0.84, Z_WATER)];
  faceFill(front, stone);
  const [ax, ay] = P(c + 0.5, r + 0.84, Z_WATER);
  X.fillStyle = '#3b4a5a'; X.beginPath(); X.ellipse(ax, ay, 13, 7, 0, Math.PI, 0); X.fill();
  X.fillStyle = 'rgba(120,190,220,.35)'; X.beginPath(); X.ellipse(ax, ay, 13, 3, 0, 0, Math.PI); X.fill();
  for (let k = -2; k <= 2; k++) { const p = P(c + 0.5 + k * 0.09, r + 0.84, Z_WATER + 7.5 - Math.abs(k) * 1.2); rect(p[0] - 0.4, p[1] - 1.5, 0.8, 3, 'rgba(90,70,55,.4)'); }
  // cobbled deck
  fillPts([P(c, r + 0.16, z), P(c + 1, r + 0.16, z), P(c + 1, r + 0.84, z), P(c, r + 0.84, z)], winter ? '#eef1f2' : '#b4a68f');
  for (let k = 0; k < 24; k++) { const p = P(c + hash(c * 7 + r, k), r + 0.22 + hash(c * 7 + r, k + 50) * 0.56, z); ell(p[0], p[1], 2.4, 1.3, winter ? '#f7f8f8' : STONES[k % 5]); }
  // parapets
  for (const gy of [0.16, 0.84]) isoBox(c, r + gy - 0.04, c + 1, r + gy + 0.03, z, 4, stone, winter ? '#f5f7f7' : shade(stone, 0.2));
}

function drawWaterTile(s, i, c, r, z) {
  const winter = s.season === 'winter';
  clipTile(c, r, z);
  const deep = winter ? '#6c9ec4' : '#2f88b8', mid = winter ? '#86b4d4' : '#3ea6c8';
  fillPts(diamond(c, r, z, -0.02), mix(deep, mid, noise2(c / 2, r / 2, 3)));
  for (let k = 0; k < 6; k++) {
    const gx = c - 0.1 + hash(i, k) * 1.2, gy = r - 0.1 + hash(i, k + 40) * 1.2, p = P(gx, gy, z);
    ell(p[0], p[1], 9 + hash(i, k + 7) * 7, 4, alpha(k % 2 ? mid : deep, 0.4));
  }
  // shallows + foam along the banks
  [[-1, 0], [1, 0], [0, -1], [0, 1]].forEach(([dc, dr]) => {
    if (isWet(s, c + dc, r + dr) || !inBounds(c + dc, r + dr)) return;
    const q = dc === -1 ? [P(c, r, z), P(c + 0.3, r, z), P(c + 0.3, r + 1, z), P(c, r + 1, z)]
      : dc === 1 ? [P(c + 0.7, r, z), P(c + 1, r, z), P(c + 1, r + 1, z), P(c + 0.7, r + 1, z)]
      : dr === -1 ? [P(c, r, z), P(c + 1, r, z), P(c + 1, r + 0.3, z), P(c, r + 0.3, z)]
      : [P(c, r + 0.7, z), P(c + 1, r + 0.7, z), P(c + 1, r + 1, z), P(c, r + 1, z)];
    fillPts(q, winter ? 'rgba(220,235,245,.5)' : 'rgba(120,220,215,.45)');
    if (dc === -1 || dr === -1) {
      const A = dc === -1 ? [P(c, r, z), P(c, r + 1, z)] : [P(c, r, z), P(c + 1, r, z)];
      line(A[0][0], A[0][1] + 1, A[1][0], A[1][1] + 1, 'rgba(255,255,255,.8)', 2);
    }
  });
  // painted reflections
  for (let k = 0; k < 3; k++) {
    const p = P(c + 0.15 + hash(i, k + 60) * 0.7, r + 0.15 + hash(i, k + 70) * 0.7, z);
    line(p[0] - 6, p[1], p[0] + 6, p[1], 'rgba(255,255,255,.28)', 1.4);
  }
  X.restore();
  // lily pads near the banks
  const nearBank = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dc, dr]) => inBounds(c + dc, r + dr) && !isWet(s, c + dc, r + dr));
  if (!winter && nearBank && s.tiles[i].g === 'water' && hash(i, 90) < 0.5) {
    for (let k = 0; k < 3; k++) {
      const p = P(c + 0.2 + hash(i, k + 91) * 0.6, r + 0.2 + hash(i, k + 95) * 0.6, z);
      ell(p[0], p[1], 3.6, 1.9, '#5c9e4a');
      fillPts([[p[0], p[1]], [p[0] + 3.6, p[1] - 0.6], [p[0] + 3.6, p[1] + 0.6]], mid);
      ell(p[0] - 1, p[1] - 0.5, 1.4, 0.6, '#86c46a');
      if (k === 0 && hash(i, 99) < 0.6) { circ(p[0] - 0.5, p[1] - 1.5, 1.3, '#ffc2d6'); circ(p[0] - 0.5, p[1] - 1.8, 0.6, '#fff4a8'); }
    }
  }
}

function drawTileGround(s, i) {
  const t = s.tiles[i], c = i % COLS, r = (i / COLS) | 0, z = Render.Z[i];
  const season = s.season, winter = season === 'winter';

  if (t.g === 'water' || t.g === 'bridge') {
    drawWaterTile(s, i, c, r, z);
    if (t.g === 'bridge') drawBridge(s, c, r);
    cliffFaces(s, c, r, z, '#6aa0a8');
    return;
  }

  const pal = (t.g === 'hill' ? HILL : GRASS)[season];
  paintGrass(s, i, c, r, z, pal);
  const top = groundColor(pal, c + 0.5, r + 0.5);
  if (t.g === 'road') { drawRoad(s, c, r, z); cliffFaces(s, c, r, z, top); return; }
  cliffFaces(s, c, r, z, top);

  // decorations (objects simply paint over them)
  const meadow = noise2(c / 3, r / 3, 9) + (t.g === 'hill' ? 0.25 : 0);
  if (!winter && meadow > 0.48) {
    const nf = Math.round((meadow - 0.48) * 70);
    for (let k = 0; k < nf; k++) {
      const p = P(c + 0.06 + hash(i, k + 60) * 0.88, r + 0.06 + hash(i, k + 80) * 0.88, z);
      const col = FLOWERS[Math.floor(hash(i, k + 99) * FLOWERS.length)];
      line(p[0], p[1] + 1.5, p[0], p[1], 'rgba(60,110,50,.6)', 0.6);
      circ(p[0], p[1], 1.3, col); circ(p[0] - 0.4, p[1] - 0.4, 0.5, 'rgba(255,255,255,.7)');
    }
  }
  const wetNear = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([dc, dr]) => isWet(s, c + dc, r + dr));
  if (wetNear) {
    for (let k = 0; k < 3; k++) { // mossy river stones
      if (hash(i, k + 110) > 0.55) continue;
      const p = P(c + 0.15 + hash(i, k + 120) * 0.7, r + 0.15 + hash(i, k + 130) * 0.7, z);
      const rr = 3.5 + hash(i, k + 140) * 3.5;
      softShadow(p[0] + 2, p[1] + 1.5, rr * 1.3, rr * 0.6, 0.35);
      ell(p[0], p[1], rr, rr * 0.66, winter ? '#e6ecef' : '#8e9a9c');
      ell(p[0] - rr * 0.25, p[1] - rr * 0.25, rr * 0.55, rr * 0.3, winter ? '#ffffff' : '#b6c0bf');
      if (!winter) ell(p[0] - rr * 0.1, p[1] - rr * 0.5, rr * 0.5, rr * 0.18, 'rgba(110,160,80,.7)');
    }
    if (!winter && hash(i, 150) < 0.6) for (let k = 0; k < 6; k++) { // reeds & cattails
      const p = P(c + 0.1 + hash(i, k + 160) * 0.8, r + 0.1 + hash(i, k + 170) * 0.8, z), hgt = 7 + hash(i, k + 180) * 6;
      curve(p[0], p[1], p[0] + 1, p[1] - hgt * 0.6, p[0] + 1.6, p[1] - hgt, '#5f8f3a', 0.9);
      if (k % 2 === 0) ell(p[0] + 1.6, p[1] - hgt + 1.5, 0.9, 2.2, '#7a4f2e');
    }
  } else if (hash(i, 71) < 0.15) {
    const p = P(c + 0.3 + hash(i, 72) * 0.4, r + 0.3 + hash(i, 73) * 0.4, z);
    const base = winter ? '#dde6ea' : season === 'autumn' ? '#b29a48' : mix('#4f9a3c', '#77b84a', hash(i, 74));
    bushAt(p[0], p[1], base, i, 0.75 + hash(i, 75) * 0.5);
  }
}

// Rocky underside of the floating island: a jagged inverted mountain with
// facets, strata, stalactite-like spurs, hanging roots and vines, fading into mist.
function drawUnderside(s) {
  const L = P(0, ROWS, Z_BOTTOM), F = P(COLS, ROWS, Z_BOTTOM), R = P(COLS, 0, Z_BOTTOM);
  const tip = [F[0] - 60, WORLD_H - 90];
  const side = (a, b, n, seed, out) => {
    const pts = [];
    for (let k = 1; k < n; k++) {
      const f = k / n, bulge = Math.sin(Math.PI * f) * out, spur = k % 3 === 1 ? 18 + hash(seed, k + 30) * 26 : 0;
      pts.push([a[0] + (b[0] - a[0]) * f + (hash(seed, k) - 0.5) * 18, a[1] + (b[1] - a[1]) * f + bulge + spur + (hash(seed, k + 9) - 0.5) * 16]);
    }
    return pts;
  };
  const leftEdge = side(L, tip, 14, 3, 40), rightEdge = side(tip, R, 14, 7, 30);
  // outline: L → F → R → down the right side → tip → up the left side
  const outline = [L, F, R, ...[...rightEdge].reverse(), tip, ...[...leftEdge].reverse()];
  const g = X.createLinearGradient(0, L[1], 0, tip[1]);
  g.addColorStop(0, '#a07a58'); g.addColorStop(0.3, '#8a7466'); g.addColorStop(0.7, '#6d7290'); g.addColorStop(1, 'rgba(150,170,210,0)');
  X.fillStyle = g; pathPts(outline); X.fill();
  X.save(); pathPts(outline); X.clip();
  // the right-hand face turns away from the sun
  fillPts([F, R, ...[...rightEdge].reverse(), tip], 'rgba(35,45,95,.26)');
  // chunky rock facets: lit upper-left planes, shadowed lower-right planes
  for (let k = 0; k < 120; k++) {
    const u = hash(k, 1), v = hash(k, 2);
    const x = L[0] + (R[0] - L[0]) * u, y = Math.min(L[1], R[1]) + 10 + v * (tip[1] - L[1]) * 0.9;
    const w = 14 + hash(k, 3) * 34, h = 10 + hash(k, 4) * 30;
    fillPts([[x, y], [x + w * 0.55, y - h * 0.15], [x + w * 0.35, y + h * 0.55], [x - w * 0.1, y + h * 0.35]], `rgba(255,236,205,${0.05 + hash(k, 5) * 0.08})`);
    fillPts([[x + w * 0.55, y - h * 0.15], [x + w, y + h * 0.3], [x + w * 0.6, y + h], [x + w * 0.35, y + h * 0.55]], `rgba(25,30,70,${0.06 + hash(k, 6) * 0.1})`);
  }
  for (let k = 1; k < 10; k++) { // strata following the island edges
    const dy = k * 24;
    curve(L[0] + k * 12, L[1] + dy, (L[0] + F[0]) / 2, (L[1] + F[1]) / 2 + dy + 14, F[0] - k * 5, F[1] + dy, 'rgba(70,45,30,.2)', 1.3);
    curve(F[0] + k * 5, F[1] + dy, (F[0] + R[0]) / 2, (F[1] + R[1]) / 2 + dy + 12, R[0] - k * 14, R[1] + dy, 'rgba(25,25,60,.18)', 1.3);
  }
  // misty glow where it dissolves into the clouds
  const mist = X.createLinearGradient(0, tip[1] - 260, 0, tip[1]);
  mist.addColorStop(0, 'rgba(220,230,250,0)'); mist.addColorStop(1, 'rgba(220,230,250,.55)');
  X.fillStyle = mist; X.fillRect(0, tip[1] - 260, WORLD_W, 260);
  X.restore();
  // hanging roots and vines along the top edges
  const hang = (a, b, n, seed) => {
    for (let k = 0; k < n; k++) {
      const f = hash(seed, k), x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      const len = 20 + hash(seed, k + 50) * 80, vine = k % 3 !== 0;
      const sway = (hash(seed, k + 90) - 0.5) * 16;
      curve(x, y, x + sway, y + len * 0.6, x + sway * 0.4, y + len, vine ? '#4f7f3f' : '#6e4d32', vine ? 1.3 : 1.7);
      if (vine && s.season !== 'winter') for (let j = 1; j < 6; j++) {
        const ly = y + len * j / 6, lx = x + sway * (j / 6) * 0.8;
        ell(lx + (j % 2 ? 2 : -2), ly, 2.2, 1.2, j % 2 ? '#74b453' : '#5a9a45');
        if (j === 5 && k % 4 === 1) circ(lx, ly + 2, 1.4, '#ffd1e0');
      }
    }
  };
  hang(L, F, 30, 11); hang(F, R, 26, 13);
}

function drawGround(s) {
  if (!Render.Z) Render.Z = computeZ(s);
  X = Render.ground.getContext('2d');
  X.setTransform(1, 0, 0, 1, 0, 0);
  X.clearRect(0, 0, Render.ground.width, Render.ground.height);
  X.setTransform(Render.groundScale, 0, 0, Render.groundScale, 0, 0);
  drawUnderside(s);
  for (const i of Render.order) drawTileGround(s, i);
  Render.groundKey = s.season;
}

// ----- animated water: waterfall off the island edge + sparkles ----------------
function drawWaterfalls(s, t) {
  const winter = s.season === 'winter';
  for (let c = 0; c < COLS; c++) {
    if (!isWet(s, c, ROWS - 1)) continue;
    const A = P(c, ROWS, Z_WATER), B = P(c + 1, ROWS, Z_WATER), drop = 330;
    const g = X.createLinearGradient(0, A[1], 0, A[1] + drop);
    g.addColorStop(0, winter ? 'rgba(200,225,240,.95)' : 'rgba(110,200,230,.95)');
    g.addColorStop(0.5, 'rgba(210,240,250,.75)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    X.fillStyle = g; X.beginPath();
    X.moveTo(A[0], A[1]); X.lineTo(B[0], B[1]);
    X.lineTo(B[0] + 6, B[1] + drop); X.lineTo(A[0] - 6, A[1] + drop); X.closePath(); X.fill();
    X.save(); X.setLineDash([10, 14]); X.lineDashOffset = -t * 90;
    for (let k = 0; k < 7; k++) {
      const f = (k + 0.5) / 7, x = A[0] + (B[0] - A[0]) * f, y = A[1] + (B[1] - A[1]) * f;
      line(x, y, x + (f - 0.5) * 10, y + drop * (0.6 + hash(c, k) * 0.3), 'rgba(255,255,255,.65)', 1.2);
    }
    X.restore();
    line(A[0], A[1], B[0], B[1], 'rgba(255,255,255,.9)', 2.5);
    for (let k = 0; k < 5; k++) { // mist billowing at the bottom
      const f = (k + 0.5) / 5, x = A[0] + (B[0] - A[0]) * f, y = A[1] + drop * 0.62 + Math.sin(t * 1.5 + k) * 4;
      circ(x, y, 9 + Math.sin(t * 2 + k * 1.7) * 2, 'rgba(255,255,255,.28)');
    }
  }
}

// ----- trees ---------------------------------------------------------------
const LEAVES = {
  birke: ['#a6d65e', '#86c450', '#f2c94a'], ahorn: ['#7cc456', '#4f9a3e', '#e2532f'],
  linde: ['#86c95a', '#5aa244', '#d9b03c'], platane: ['#7fc155', '#5c9e43', '#c78f3e'],
  eiche: ['#6fae4b', '#4a8a3a', '#a4712f'], ginkgo: ['#9ed062', '#5ea445', '#f6cf2a'],
  rebe: ['#8cc756', '#62a640', '#cc8f2e'],
};

function leafColor(id, season, health) {
  const L = LEAVES[id];
  const base = season === 'spring' ? L[0] : season === 'summer' ? L[1] : L[2];
  return mix(base, '#a88a52', Math.max(0, 1 - health / 100) * 0.8);
}

function trunk(h, w, col) {
  const g = X.createLinearGradient(-w, 0, w, 0);
  g.addColorStop(0, shade(col, 0.25)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.35));
  X.fillStyle = g; X.beginPath();
  X.moveTo(-w * 1.6, 0); X.quadraticCurveTo(-w * 0.6, -h * 0.15, -w * 0.55, -h);
  X.lineTo(w * 0.55, -h); X.quadraticCurveTo(w * 0.6, -h * 0.15, w * 1.6, 0); X.closePath(); X.fill();
}
function branches(h, s, col, n) {
  X.strokeStyle = col; X.lineCap = 'round';
  for (let k = 0; k < n; k++) {
    const side = k % 2 ? 1 : -1, y0 = -h * (0.55 + k * 0.1);
    X.lineWidth = 1.6 - k * 0.15;
    X.beginPath(); X.moveTo(0, y0); X.quadraticCurveTo(side * 4 * s, y0 - 5 * s, side * (7 + k) * s, y0 - (9 + k * 2) * s); X.stroke();
  }
  X.lineCap = 'butt';
}
function bareTree(h, s, col, snow) {
  X.strokeStyle = col; X.lineCap = 'round';
  const rec = (x, y, ang, len, w, d) => {
    const x2 = x + Math.cos(ang) * len, y2 = y + Math.sin(ang) * len;
    X.lineWidth = w; X.beginPath(); X.moveTo(x, y); X.lineTo(x2, y2); X.stroke();
    if (snow && d < 2) line(x, y - 0.6, x2, y2 - 0.6, 'rgba(255,255,255,.8)', w * 0.5);
    if (d > 0) { rec(x2, y2, ang - 0.45, len * 0.7, w * 0.65, d - 1); rec(x2, y2, ang + 0.4, len * 0.68, w * 0.65, d - 1); }
  };
  rec(0, -h * 0.6, -Math.PI / 2 - 0.5, 9 * s, 1.6, 2);
  rec(0, -h * 0.75, -Math.PI / 2 + 0.45, 9 * s, 1.5, 2);
  rec(0, -h, -Math.PI / 2, 8 * s, 1.4, 2);
  X.lineCap = 'butt';
}

const TREE_SHAPES = {
  birke: { h: 26, w: 1.6, bark: '#f1ece0', clumps: [[-5, -28, 5.5], [5, -30, 5.5], [0, -37, 6], [-6, -21, 4.5], [6, -22, 4.5], [0, -44, 4]] },
  ahorn: { h: 15, w: 2.2, bark: '#6b4a2b', clumps: [[-9, -21, 8.5], [9, -21, 8.5], [0, -18, 9], [0, -28, 10.5], [-6, -36, 8], [6, -37, 8]] },
  linde: { h: 15, w: 2.2, bark: '#5e4128', clumps: [[-8, -19, 8], [8, -19, 8], [0, -23, 10], [-7, -31, 8], [7, -31, 8], [0, -39, 8], [0, -46, 5]] },
  platane: { h: 17, w: 2.6, bark: '#cfc3a0', clumps: [[-14, -22, 8], [14, -22, 8], [-6, -25, 10], [6, -25, 10], [0, -33, 9], [-11, -31, 7], [11, -31, 7]] },
  eiche: { h: 16, w: 3.6, bark: '#5a3d22', clumps: [[-12, -22, 10], [12, -22, 10], [0, -21, 11], [-7, -33, 10], [8, -33, 10], [0, -43, 8], [-16, -30, 7], [16, -30, 7]] },
  ginkgo: { h: 14, w: 1.8, bark: '#6e5a44', clumps: [[0, -18, 7], [-5, -25, 7], [5, -26, 7], [0, -33, 8], [-3, -41, 6.5], [3, -42, 6], [0, -49, 5]] },
};

function drawTree(o, c, r, z, s, i) {
  const id = o.id, gr = growthOf(o), sc = 0.5 + 0.5 * gr, season = s.season, t = Render.t;
  if (id === 'rebe') { drawVines(o, c, r, z, s, i); return; }
  const sh = TREE_SHAPES[id];
  const col = leafColor(id, season, o.health);
  const bushBase = season === 'winter' ? '#dde6ea' : season === 'autumn' ? '#b29a48' : '#4f9a3c';
  const [x, y] = P(c + 0.5, r + 0.55, z);
  if (gr > 0.6 && hash(i, 1) < 0.6) { const b = P(c + 0.22, r + 0.3, z); bushAt(b[0], b[1], bushBase, i, 0.85); }
  softShadow(x + 11 * sc, y + 1, 20 * sc, 7 * sc, 0.38);

  // gentle sway, stronger when the wind blows
  const wind = s.wind.name === 'Calm' ? 0.3 : 1;
  const sk = Math.sin(t * 1.4 + i * 0.7) * 0.035 * wind * sc;
  X.save(); X.translate(x, y); X.transform(1, 0, -sk, 1, 0, 0); X.scale(sc, sc);
  trunk(sh.h, sh.w, sh.bark);
  if (id === 'birke') for (let k = 0; k < 5; k++) rect(-1.2, -4 - k * 4.5, 1.8 + (k % 2), 0.9, '#3a3a3a');
  if (id === 'platane') { circ(-0.8, -6, 1.2, '#8f9b6a'); circ(0.9, -11, 1.1, '#a6a07a'); }
  const bare = season === 'winter' && id !== 'eiche';
  if (bare) bareTree(sh.h, 1, sh.bark === '#f1ece0' ? '#d8d0c0' : sh.bark, true);
  else {
    branches(sh.h, 1, sh.bark, id === 'eiche' ? 4 : 2);
    const a0 = X.globalAlpha;
    if (season === 'winter') X.globalAlpha *= 0.85; // oaks keep their dry leaves
    crown(sh.clumps, treePalette(season === 'winter' ? '#9a7442' : col), i);
    X.globalAlpha = a0;
    if (id === 'linde' && (s.month === 5 || s.month === 6))
      for (let k = 0; k < 8; k++) circ((hash(i, k) - 0.5) * 22, -18 - hash(i, k + 9) * 24, 1.1, '#f9e98a');
    if (season === 'winter') for (let k = 0; k < 4; k++) ell(sh.clumps[k][0], sh.clumps[k][1] - sh.clumps[k][2] * 0.7, sh.clumps[k][2] * 0.6, 1.6, 'rgba(255,255,255,.85)');
  }
  X.restore();
  if (gr > 0.6 && hash(i, 2) < 0.45) { const b = P(c + 0.8, r + 0.85, z); bushAt(b[0], b[1], bushBase, i + 5, 0.75); }
}

function drawVines(o, c, r, z, s, i) {
  const gr = growthOf(o), bareNow = s.season === 'winter';
  const pal = treePalette(leafColor('rebe', s.season, o.health));
  [0.25, 0.5, 0.75].forEach((gy, row) => {
    const a = P(c + 0.1, r + gy, z), b = P(c + 0.9, r + gy, z);
    softShadow((a[0] + b[0]) / 2 + 4, (a[1] + b[1]) / 2 + 1, 22, 4, 0.25);
    line(a[0], a[1] - 8, b[0], b[1] - 8, '#8a6a44', 0.8);
    for (let k = 0; k <= 4; k++) {
      const p = P(c + 0.1 + k * 0.2, r + gy, z);
      line(p[0], p[1], p[0], p[1] - 9, '#7a5a3a', 1.3);
      if (!bareNow) {
        const sz = 0.55 + gr * 0.45;
        crown([[p[0] - 1.5, p[1] - 6, 3.2 * sz], [p[0] + 1.8, p[1] - 5, 3 * sz]], pal, i + row * 7 + k);
        if (gr >= 1 && s.month >= 7 && s.month <= 9 && (k + row) % 2 === 0) {
          for (const [dx, dy] of [[-1, -2.5], [1, -2.5], [0, -1]]) { circ(p[0] + dx, p[1] + dy, 1.3, '#5b2a6e'); circ(p[0] + dx - 0.4, p[1] + dy - 0.4, 0.4, '#b48ad0'); }
        }
      }
    }
  });
}

// ----- buildings -----------------------------------------------------------
const WALLS = ['#f6ecd2', '#f3dcc0', '#ece4c6', '#f2d4c8', '#dfe8d0'];
const ROOFS = ['#c65a3e', '#b04f3c', '#d9803f', '#8a5a4e', '#5f7f92'];
const EMIT = { kohle: [0.3, 0.3, 90], auto: [0.8, 0.35, 34], schraube: [0.26, 0.42, 30], salz: [0.3, 0.76, 17], wohnblock: [0.66, 0.38, 38] };

function badge(c, r, z) {
  const [x, y] = P(c + 0.5, r + 0.5, z);
  circ(x - 20, y - 26, 6.5, '#2f9e5b'); circ(x - 21.5, y - 27.5, 2, 'rgba(255,255,255,.35)');
  line(x - 23, y - 26, x - 17, y - 26, '#fff', 1.8); line(x - 20, y - 29, x - 20, y - 23, '#fff', 1.8);
}
function earthPatch(c, r, z, winter) {
  fillPts(diamond(c, r, z, 0.07), winter ? 'rgba(225,232,236,.9)' : 'rgba(170,140,100,.4)');
}

function drawHouse(c, r, z, i, winter) {
  const v = (c * 7 + r * 13) % 5, wall = WALLS[v], roof = winter ? '#eef3f6' : ROOFS[(c * 3 + r * 5) % 5];
  const timber = v === 1 || v === 3, beam = '#6b4630';
  const shutters = ['#4f7f6a', '#5f7fa8', '#a8584a'][(c + r) % 3];
  contact(c + 0.18, r + 0.2, c + 0.82, r + 0.8, z);
  isoBox(c + 0.18, r + 0.2, c + 0.82, r + 0.8, z, 20, wall);
  if (timber) {
    const L = (a, u, b, w) => { const p = P(a, r + 0.8, z + u), q = P(b, r + 0.8, z + w); line(p[0], p[1], q[0], q[1], beam, 1.1); };
    L(c + 0.18, 10, c + 0.82, 10); L(c + 0.18, 20, c + 0.82, 20);
    for (const gx of [0.18, 0.42, 0.58, 0.82]) L(c + gx, 0, c + gx, 20);
    L(c + 0.42, 10, c + 0.58, 20); L(c + 0.58, 10, c + 0.42, 20);
  }
  winL(r + 0.8, c + 0.24, c + 0.36, z + 12, z + 17.5, { box: true, shutter: shutters });
  winL(r + 0.8, c + 0.62, c + 0.74, z + 12, z + 17.5, { box: true, shutter: shutters });
  winL(r + 0.8, c + 0.24, c + 0.36, z + 3, z + 8.5, { shutter: shutters });
  doorL(r + 0.8, c + 0.6, c + 0.72, z, 9, '#7a4a2a');
  winR(c + 0.82, r + 0.3, r + 0.42, z + 12, z + 17.5, { box: true });
  winR(c + 0.82, r + 0.58, r + 0.7, z + 12, z + 17.5);
  winR(c + 0.82, r + 0.44, r + 0.56, z + 3, z + 8.5);
  isoBox(c + 0.62, r + 0.34, c + 0.7, r + 0.42, z + 22, 13, '#a25a44', '#6a3a2c');
  roofX(c + 0.12, r + 0.14, c + 0.88, r + 0.86, z + 20, 13, roof, wall);
  // little skylight on the front slope
  const sl = (gx, gy, f) => P(gx, gy, z + 20 + 13 * f);
  fillPts([sl(c + 0.42, r + 0.72, 0.38), sl(c + 0.54, r + 0.72, 0.38), sl(c + 0.54, r + 0.64, 0.62), sl(c + 0.42, r + 0.64, 0.62)], '#7fb4d0');
  if (!winter && hash(i, 3) < 0.4) { const p = P(c + 0.12, r + 0.9, z); bushAt(p[0], p[1], '#4f9a3c', i, 0.7); }
}

function drawBuilding(o, c, r, z, s, i) {
  const t = Render.t, winter = s.season === 'winter';
  const snowRoof = col => winter ? '#eef3f6' : col;
  if (!['park', 'stump', 'solar', 'wind'].includes(o.id)) earthPatch(c, r, z, winter);
  switch (o.id) {
    case 'wohnblock': drawHouse(c, r, z, i, winter); break;
    case 'oeko': {
      const wall = '#e2bf92';
      contact(c + 0.18, r + 0.22, c + 0.82, r + 0.78, z);
      isoBox(c + 0.18, r + 0.22, c + 0.82, r + 0.78, z, 14, wall);
      for (let k = 1; k < 5; k++) { const a = P(c + 0.18, r + 0.78, z + k * 2.8), b = P(c + 0.82, r + 0.78, z + k * 2.8); line(a[0], a[1], b[0], b[1], 'rgba(120,80,40,.25)', 0.6); }
      winL(r + 0.78, c + 0.24, c + 0.44, z + 4, z + 11, { box: true });
      doorL(r + 0.78, c + 0.58, c + 0.7, z, 9, '#5f7f6a');
      const [rx, ry] = P(c + 0.82, r + 0.5, z + 8); ell(rx, ry, 2.8, 3.2, '#fbf3dc'); ell(rx, ry, 2, 2.4, '#7fb4d0');
      roofX(c + 0.14, r + 0.18, c + 0.86, r + 0.82, z + 14, 10, winter ? '#eef3f6' : '#6aaa4a', wall); // sod roof
      if (!winter) for (let k = 0; k < 9; k++) { const p = P(c + 0.16 + k * 0.08, r + 0.5, z + 24); circ(p[0], p[1] - 0.5, 1.6, k % 3 ? '#7cbf55' : '#5a9a45'); if (k % 3 === 1) circ(p[0], p[1] - 1.8, 0.8, FLOWERS[k % 6]); }
      cyl(...P(c + 0.88, r + 0.32, z), 2.6, 6, '#7a5a3a', '#4f7fa8'); // rain barrel
      break;
    }
    case 'kohle': {
      contact(c + 0.05, r + 0.05, c + 0.95, r + 0.95, z);
      // coal heap
      const [hx, hy] = P(c + 0.75, r + 0.3, z);
      fillPts([[hx - 14, hy], [hx - 4, hy - 11], [hx + 3, hy - 9], [hx + 13, hy]], '#3a3532');
      fillPts([[hx - 4, hy - 11], [hx + 3, hy - 9], [hx - 2, hy - 4]], '#5a5450');
      // brick hall with arched, warmly lit windows and a sawtooth roof
      isoBox(c + 0.38, r + 0.48, c + 0.95, r + 0.95, z, 18, '#a8583f', shade('#a8583f', 0.1));
      for (let k = 0; k < 3; k++) winL(r + 0.95, c + 0.44 + k * 0.17, c + 0.54 + k * 0.17, z + 5, z + 13, { glass: '#f6c26b', frame: '#e8d2b0' });
      winR(c + 0.95, r + 0.56, r + 0.7, z + 5, z + 13, { glass: '#f6c26b', frame: '#e8d2b0' });
      for (let k = 0; k < 3; k++) roofY(c + 0.38 + k * 0.19, r + 0.48, c + 0.57 + k * 0.19, r + 0.95, z + 18, 7, snowRoof('#5e4a44'), shade('#f6c26b', -0.1));
      // the tall brick chimney
      const [cx, cy] = P(c + 0.3, r + 0.3, z);
      softShadow(cx + 12, cy + 2, 14, 4, 0.3);
      brickChimney(cx, cy, 6, 4.2, 90, '#9e4b37');
      break;
    }
    case 'auto':
      contact(c + 0.08, r + 0.22, c + 0.92, r + 0.85, z);
      isoBox(c + 0.08, r + 0.22, c + 0.92, r + 0.85, z, 15, '#c9925f');
      for (let k = 0; k < 4; k++) roofY(c + 0.08 + k * 0.21, r + 0.22, c + 0.29 + k * 0.21, r + 0.85, z + 15, 7, snowRoof('#5f9e8f'), '#bfe0e6');
      for (let k = 0; k < 4; k++) winL(r + 0.85, c + 0.12 + k * 0.2, c + 0.24 + k * 0.2, z + 8, z + 12.5);
      faceL(r + 0.85, c + 0.62, c + 0.82, z, z + 7, '#6b4a3a'); // big doors
      cyl(...P(c + 0.8, r + 0.35, z + 15), 3, 19, '#9e4b37', '#2b2522');
      isoBox(c + 0.12, r + 0.88, c + 0.3, r + 0.98, z, 4, '#d9534f', '#f08070');
      isoBox(c + 0.36, r + 0.88, c + 0.54, r + 0.98, z, 4, '#3b6fd1', '#7aa2ec');
      break;
    case 'schraube': {
      contact(c + 0.12, r + 0.3, c + 0.88, r + 0.88, z);
      isoBox(c + 0.12, r + 0.3, c + 0.88, r + 0.88, z, 13, '#d9b984');
      winL(r + 0.88, c + 0.18, c + 0.32, z + 4, z + 10, { box: true });
      winL(r + 0.88, c + 0.62, c + 0.76, z + 4, z + 10);
      doorL(r + 0.88, c + 0.4, c + 0.54, z, 9, '#5d564a');
      roofX(c + 0.1, r + 0.28, c + 0.9, r + 0.9, z + 13, 7, snowRoof('#6fa58f'), '#d9b984');
      cyl(...P(c + 0.26, r + 0.42, z + 16), 2.6, 14, '#9e4b37', '#2b2522');
      const [sx, sy] = P(c + 0.6, r + 0.58, z + 20);
      cyl(sx, sy, 3.6, 20, '#c8ccd2');
      for (let k = 0; k < 5; k++) line(sx - 3.6, sy - 3 - k * 3.6, sx + 3.6, sy - 5 - k * 3.6, '#8a8e93', 0.9);
      cyl(sx, sy - 20, 7, 3.5, '#b3b8be');
      break;
    }
    case 'salz': {
      contact(c + 0.15, r + 0.15, c + 0.9, r + 0.9, z);
      isoBox(c + 0.12, r + 0.58, c + 0.5, r + 0.92, z, 10, '#d8c7a8');
      winL(r + 0.92, c + 0.18, c + 0.3, z + 3, z + 7.5);
      roofX(c + 0.1, r + 0.56, c + 0.52, r + 0.94, z + 10, 7, snowRoof('#8d6e58'), '#d8c7a8');
      cyl(...P(c + 0.3, r + 0.76, z + 12), 1.8, 5, '#9e4b37', '#2b2522');
      // wooden headframe with spinning wheel
      const [hx, hy] = P(c + 0.4, r + 0.32, z), wood = '#7a5634';
      line(hx - 9, hy, hx, hy - 36, wood, 2.6); line(hx + 9, hy, hx, hy - 36, wood, 2.6);
      line(hx - 6, hy - 12, hx + 6, hy - 12, wood, 1.4); line(hx - 3.5, hy - 24, hx + 3.5, hy - 24, wood, 1.2);
      line(hx - 6, hy - 12, hx + 3.5, hy - 24, wood, 0.9); line(hx + 6, hy - 12, hx - 3.5, hy - 24, wood, 0.9);
      X.strokeStyle = '#4d4038'; X.lineWidth = 1.6; X.beginPath(); X.arc(hx, hy - 36, 5.5, 0, Math.PI * 2); X.stroke();
      for (let k = 0; k < 3; k++) { const a = t * 2 + k * Math.PI / 3; line(hx - Math.cos(a) * 5.5, hy - 36 - Math.sin(a) * 5.5, hx + Math.cos(a) * 5.5, hy - 36 + Math.sin(a) * 5.5, '#4d4038', 0.8); }
      const [px, py] = P(c + 0.76, r + 0.62, z);
      softShadow(px + 5, py + 1, 16, 5, 0.3);
      fillPts([[px - 14, py], [px, py - 19], [px, py + 5]], '#fdfdf8');
      fillPts([[px, py - 19], [px + 14, py], [px, py + 5]], '#d6dbe6');
      for (let k = 0; k < 3; k++) circ(px - 6 + k * 5, py - 6 - k * 3, 0.9, `rgba(255,255,255,${0.5 + 0.5 * Math.sin(t * 3 + k)})`);
      break;
    }
    case 'ki': {
      // glass conservatory campus with a dome and greenery inside
      contact(c + 0.12, r + 0.15, c + 0.88, r + 0.85, z);
      isoBox(c + 0.12, r + 0.15, c + 0.88, r + 0.85, z, 20, '#8fcfe0', '#d9f1f6');
      X.globalAlpha *= 0.55;
      for (let k = 1; k < 6; k++) {
        let a = P(c + 0.12 + k * 0.127, r + 0.85, z), b = P(c + 0.12 + k * 0.127, r + 0.85, z + 20); line(a[0], a[1], b[0], b[1], '#ffffff', 1);
        a = P(c + 0.88, r + 0.15 + k * 0.117, z); b = P(c + 0.88, r + 0.15 + k * 0.117, z + 20); line(a[0], a[1], b[0], b[1], '#ffffff', 1);
      }
      X.globalAlpha /= 0.55;
      for (let k = 0; k < 4; k++) { const p = P(c + 0.2 + k * 0.18, r + 0.85, z + 2); crown([[p[0], p[1] - 4, 3.5]], treePalette('#5aa244'), i + k); }
      for (let k = 0; k < 4; k++) { const p = P(c + 0.25 + k * 0.17, r + 0.85, z + 14); circ(p[0], p[1], 1.2, Math.sin(t * 5 + k + c) > 0 ? '#9dff6a' : '#3a6a3a'); }
      const [dx, dy] = P(c + 0.5, r + 0.5, z + 20);
      const g = X.createRadialGradient(dx - 5, dy - 12, 2, dx, dy - 6, 20);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(1, 'rgba(120,200,225,.75)');
      X.fillStyle = g; X.beginPath(); X.ellipse(dx, dy, 16, 16, 0, Math.PI, 0); X.ellipse(dx, dy, 16, 8, 0, 0, Math.PI); X.fill();
      for (let k = -2; k <= 2; k++) { X.strokeStyle = 'rgba(255,255,255,.8)'; X.lineWidth = 0.8; X.beginPath(); X.ellipse(dx, dy, Math.abs(k) * 4 + 0.1, 16, 0, Math.PI, 0); X.stroke(); }
      circ(dx, dy - 17, 1.8, Math.sin(t * 4) > 0 ? '#ff6b6b' : '#7a2020');
      break;
    }
    case 'weinkeller': {
      const wall = '#e6d3ae';
      contact(c + 0.15, r + 0.25, c + 0.8, r + 0.8, z);
      isoBox(c + 0.15, r + 0.25, c + 0.8, r + 0.8, z, 13, wall);
      for (let k = 0; k < 12; k++) { const p = P(c + 0.17 + hash(i, k) * 0.6, r + 0.8, z + hash(i, k + 5) * 12); ell(p[0], p[1], 2, 1.2, 'rgba(150,130,100,.25)'); }
      doorL(r + 0.8, c + 0.3, c + 0.44, z, 10, '#5a3420');
      winL(r + 0.8, c + 0.56, c + 0.68, z + 5, z + 10, { box: true });
      if (!winter) for (let k = 0; k < 10; k++) { const p = P(c + 0.16 + hash(i, k + 20) * 0.12, r + 0.8, z + 2 + k * 1.2); circ(p[0] + hash(i, k + 30) * 3, p[1], 2, k % 2 ? '#4f8f3a' : '#6aaa4a'); } // ivy
      roofY(c + 0.11, r + 0.21, c + 0.84, r + 0.84, z + 13, 10, snowRoof('#a8443a'), wall);
      for (const gy of [0.5, 0.68]) { const [bx, by] = P(c + 0.9, r + gy, z); cyl(bx, by, 3.6, 7, '#8a5a32', '#b07a48'); line(bx - 3.6, by - 2, bx + 3.6, by - 2, '#4a3a2a', 0.8); line(bx - 3.6, by - 5, bx + 3.6, by - 5, '#4a3a2a', 0.8); }
      const [lx, ly] = P(c + 0.52, r + 0.8, z + 11); circ(lx, ly, 1.6, '#ffd77a'); circ(lx, ly, 4, 'rgba(255,215,120,.25)');
      break;
    }
    case 'solar':
      for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) {
        const gx = c + 0.1 + a * 0.42, gy = r + 0.1 + b * 0.42;
        const leg = P(gx + 0.18, gy + 0.18, z); line(leg[0], leg[1], leg[0], leg[1] - 5, '#7a5a3a', 1.6);
        softShadow(leg[0] + 4, leg[1] + 1, 10, 3, 0.25);
        fillPts([P(gx, gy, z + 8), P(gx + 0.36, gy, z + 8), P(gx + 0.36, gy + 0.36, z + 3), P(gx, gy + 0.36, z + 3)], '#8a6a44');
        fillPts([P(gx + 0.02, gy + 0.02, z + 8), P(gx + 0.34, gy + 0.02, z + 8), P(gx + 0.34, gy + 0.34, z + 3.2), P(gx + 0.02, gy + 0.34, z + 3.2)], '#2d4f8a');
        let p = P(gx + 0.18, gy, z + 8), q = P(gx + 0.18, gy + 0.36, z + 3); line(p[0], p[1], q[0], q[1], '#7fa2e0', 0.7);
        p = P(gx, gy + 0.18, z + 5.5); q = P(gx + 0.36, gy + 0.18, z + 5.5); line(p[0], p[1], q[0], q[1], '#7fa2e0', 0.7);
        p = P(gx + 0.04, gy + 0.04, z + 7.6); q = P(gx + 0.18, gy + 0.04, z + 7.6); line(p[0], p[1], q[0], q[1], 'rgba(255,255,255,.7)', 1.2);
      }
      break;
    case 'wind': { // storybook windmill
      const [x, y] = P(c + 0.5, r + 0.55, z);
      softShadow(x + 18, y + 3, 26, 6, 0.3);
      const g = X.createLinearGradient(x - 10, 0, x + 10, 0);
      g.addColorStop(0, '#fbf3e0'); g.addColorStop(0.5, '#efe2c6'); g.addColorStop(1, '#bfae92');
      X.fillStyle = g; X.beginPath(); X.moveTo(x - 10, y); X.lineTo(x - 6.5, y - 40); X.lineTo(x + 6.5, y - 40); X.lineTo(x + 10, y); X.closePath(); X.fill();
      X.fillStyle = '#efe2c6'; X.beginPath(); X.ellipse(x, y, 10, 4.5, 0, 0, Math.PI); X.fill();
      rect(x - 2.4, y - 9, 4.8, 9, '#7a4a2a'); circ(x, y - 9, 2.4, '#7a4a2a');
      rect(x - 1.6, y - 26, 3.2, 4.5, '#7fb4d0'); rect(x - 0.3, y - 26, 0.6, 4.5, '#fbf3dc');
      X.fillStyle = snowRoof('#a8443a'); X.beginPath(); X.moveTo(x - 8.5, y - 39); X.quadraticCurveTo(x, y - 58, x + 8.5, y - 39); X.closePath(); X.fill();
      ell(x, y - 39, 8.5, 2.5, shade(snowRoof('#a8443a'), -0.2));
      const hubX = x - 3, hubY = y - 44, a0 = t * 1.6 + c;
      for (let k = 0; k < 4; k++) {
        const a = a0 + k * Math.PI / 2, ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
        const pt = (d, w) => [hubX + ca * d + px * w, hubY + sa * d + py * w];
        line(hubX, hubY, hubX + ca * 26, hubY + sa * 26, '#6b4a2b', 1.4);
        fillPts([pt(6, 0), pt(26, 0), pt(26, 5), pt(6, 5)], 'rgba(250,244,230,.92)');
        for (let j = 1; j < 5; j++) { const q0 = pt(6 + j * 4, 0), q1 = pt(6 + j * 4, 5); line(q0[0], q0[1], q1[0], q1[1], '#a08060', 0.5); }
      }
      circ(hubX, hubY, 2.2, '#5a3a22');
      break;
    }
    case 'wasserkraft': { // stone water mill with a big wooden wheel
      const wall = '#d3c8b4';
      contact(c + 0.15, r + 0.2, c + 0.85, r + 0.85, z);
      isoBox(c + 0.15, r + 0.2, c + 0.85, r + 0.85, z, 14, wall);
      for (let k = 0; k < 14; k++) { const p = P(c + 0.17 + hash(i, k) * 0.66, r + 0.85, z + hash(i, k + 5) * 13); ell(p[0], p[1], 2.2, 1.2, 'rgba(120,110,95,.22)'); }
      winL(r + 0.85, c + 0.22, c + 0.36, z + 6, z + 11, { box: true });
      doorL(r + 0.85, c + 0.42, c + 0.54, z, 9, '#6b4a2b');
      winR(c + 0.85, r + 0.3, r + 0.44, z + 6, z + 11);
      roofX(c + 0.11, r + 0.16, c + 0.89, r + 0.89, z + 14, 10, snowRoof('#5f7f92'), wall);
      const [wx, wy] = P(c + 0.72, r + 0.88, z + 7);
      X.strokeStyle = '#6b4a2b'; X.lineWidth = 2.4; X.beginPath(); X.ellipse(wx, wy, 9, 9, 0, 0, Math.PI * 2); X.stroke();
      for (let k = 0; k < 8; k++) {
        const a = t * 1.4 + k * Math.PI / 4, ex = wx + Math.cos(a) * 9, ey = wy + Math.sin(a) * 9;
        line(wx, wy, ex, ey, '#8a6a44', 1.1);
        fillPts([[ex, ey], [ex + Math.cos(a + 1.3) * 3, ey + Math.sin(a + 1.3) * 3], [ex + Math.cos(a) * 2.5, ey + Math.sin(a) * 2.5]], '#7a5634');
      }
      circ(wx, wy, 1.8, '#5a3a22');
      for (let k = 0; k < 6; k++) circ(wx - 6 + k * 2.6, wy + 10 + Math.sin(t * 6 + k) * 1.4, 1.6, 'rgba(255,255,255,.85)');
      break;
    }
    case 'tram': {
      [0.46, 0.64].forEach(gy => { const a = P(c, r + gy, z), b = P(c + 1, r + gy, z); line(a[0], a[1], b[0], b[1], '#6a5a4a', 1.4); });
      contact(c + 0.08, r + 0.42, c + 0.92, r + 0.68, z);
      isoBox(c + 0.08, r + 0.42, c + 0.92, r + 0.68, z + 1, 11, '#f3e3c3', snowRoof('#a8443a'));
      faceL(r + 0.68, c + 0.08, c + 0.92, z + 1, z + 4.5, '#a8443a');
      for (let k = 0; k < 4; k++) winL(r + 0.68, c + 0.13 + k * 0.2, c + 0.27 + k * 0.2, z + 5.5, z + 10, { frame: '#a8443a' });
      const [px, py] = P(c + 0.5, r + 0.55, z + 12); line(px - 3, py, px, py - 8, '#3a3a3a', 0.8); line(px + 3, py, px, py - 8, '#3a3a3a', 0.8);
      const [sx, sy] = P(c + 0.88, r + 0.18, z);
      line(sx, sy, sx, sy - 24, '#4a4a4a', 1.4);
      ell(sx, sy - 26, 5, 5, '#2f9e5b'); ell(sx - 1.5, sy - 27.5, 1.6, 1.6, 'rgba(255,255,255,.3)');
      X.fillStyle = '#f6d24a'; X.font = 'bold 7px sans-serif'; X.textAlign = 'center'; X.fillText('H', sx, sy - 23.5);
      break;
    }
    case 'park': {
      fillPts(diamond(c, r, z, 0.04), winter ? '#eef4f6' : '#93d36a');
      // hedge border on the back edges
      const hedge = winter ? '#d5e0e4' : '#3f8a3a';
      for (let k = 0; k < 6; k++) { const p = P(c + 0.08 + k * 0.17, r + 0.08, z); crown([[p[0], p[1] - 3, 3.4]], treePalette(hedge), i + k); }
      // flower beds
      if (!winter) for (let k = 0; k < 26; k++) {
        const p = P(c + 0.12 + hash(i, k) * 0.76, r + 0.2 + hash(i, k + 30) * 0.7, z);
        if (Math.hypot(hash(i, k) - 0.38, hash(i, k + 30) * 0.9 - 0.3) < 0.22) continue;
        circ(p[0], p[1], 1.6, FLOWERS[k % FLOWERS.length]); circ(p[0] - 0.5, p[1] - 0.5, 0.6, 'rgba(255,255,255,.7)');
      }
      // stone fountain with a dancing jet
      const [x, y] = P(c + 0.5, r + 0.5, z);
      softShadow(x + 4, y + 3, 20, 8, 0.25);
      ell(x, y, 15, 7.5, '#bfb6a6'); ell(x, y - 1.5, 15, 7.5, '#e2dacb'); ell(x, y - 1.5, 12.5, 6, winter ? '#d6e6f0' : '#4fb3d9');
      ell(x - 3, y - 3, 5, 1.8, 'rgba(255,255,255,.5)');
      cyl(x, y - 1.5, 2.2, 8, '#d8cfbf');
      if (!winter) {
        const hh = 8 + Math.sin(t * 3) * 2;
        X.strokeStyle = 'rgba(230,248,255,.85)'; X.lineWidth = 1.2;
        for (const d of [-1, 1]) { X.beginPath(); X.moveTo(x, y - 10); X.quadraticCurveTo(x + d * 4, y - 10 - hh, x + d * 8, y - 3); X.stroke(); }
        for (let k = 0; k < 4; k++) circ(x + (k - 1.5) * 4, y - 3 + Math.sin(t * 6 + k) * 0.8, 0.8, 'rgba(255,255,255,.9)');
      }
      // lamp post + bench
      const [lx, ly] = P(c + 0.85, r + 0.75, z);
      line(lx, ly, lx, ly - 15, '#3d4a3a', 1.3); circ(lx, ly - 16, 2.2, '#fff1b0'); circ(lx, ly - 16, 5, 'rgba(255,235,150,.25)');
      const [bx, by] = P(c + 0.25, r + 0.82, z);
      rect(bx - 5, by - 4, 10, 2, '#8a5a32'); rect(bx - 5, by - 7, 10, 1.5, '#8a5a32'); line(bx - 4, by - 2, bx - 4, by, '#4a3a2a', 0.8); line(bx + 4, by - 2, bx + 4, by, '#4a3a2a', 0.8);
      break;
    }
    case 'stump': {
      const [x, y] = P(c + 0.5, r + 0.55, z);
      softShadow(x + 4, y + 1, 9, 3.5, 0.35);
      cyl(x, y, 5, 6, '#7a5532', '#d6b07c');
      ell(x, y - 6, 3, 1.4, 'rgba(160,110,60,.6)');
      if (!winter) { ell(x - 3, y - 2, 2.5, 1.5, '#6aa84a'); circ(x + 3, y - 1, 1.3, '#e8d9c0'); circ(x + 3, y - 2, 1.6, '#c0523f'); } // moss + a tiny mushroom
      break;
    }
    case 'kilian': {
      const sand = '#d08a68';
      contact(c + 0.08, r + 0.2, c + 0.92, r + 0.92, z);
      isoBox(c + 0.1, r + 0.3, c + 0.6, r + 0.9, z, 18, sand);
      for (let k = 0; k < 3; k++) doorL(r + 0.9, c + 0.15 + k * 0.14, c + 0.23 + k * 0.14, z + 5, 10, '#4a3a5a');
      roofY(c + 0.08, r + 0.28, c + 0.62, r + 0.92, z + 18, 14, snowRoof('#4f5f6e'), sand);
      isoBox(c + 0.6, r + 0.25, c + 0.9, r + 0.58, z, 52, '#d9956f');
      for (const u of [12, 28, 42]) { doorL(r + 0.58, c + 0.7, c + 0.8, z + u, 8, '#4a3a5a'); winR(c + 0.9, r + 0.36, r + 0.47, z + u, z + u + 7, { glass: '#3a3048' }); }
      const [kx, ky] = P(c + 0.75, r + 0.58, z + 37); ell(kx, ky, 3.5, 3.5, '#f3e7c4'); line(kx, ky, kx + 1.5, ky - 1.8, '#333', 0.7);
      isoBox(c + 0.63, r + 0.28, c + 0.87, r + 0.55, z + 52, 10, '#e0a17c');
      isoBox(c + 0.67, r + 0.32, c + 0.83, r + 0.5, z + 62, 9, '#e6ad89');
      const [sx, sy] = P(c + 0.75, r + 0.41, z + 71);
      fillPts([[sx - 4, sy], [sx, sy - 9], [sx + 4, sy]], snowRoof('#4f5f6e'));
      circ(sx, sy - 11, 1.8, '#3a3a3a'); // the "Männle" on top
      break;
    }
    case 'rathaus': {
      const wall = '#efdcaa', gy = r + 0.85;
      contact(c + 0.08, r + 0.2, c + 0.92, r + 0.85, z);
      isoBox(c + 0.08, r + 0.2, c + 0.92, r + 0.85, z, 20, wall, snowRoof('#c66a4a'));
      fillPts([[c + 0.3, 20], [c + 0.3, 25], [c + 0.37, 25], [c + 0.37, 30], [c + 0.44, 30], [c + 0.44, 36], [c + 0.56, 36],
        [c + 0.56, 30], [c + 0.63, 30], [c + 0.63, 25], [c + 0.7, 25], [c + 0.7, 20]].map(([gx, u]) => P(gx, gy, z + u)), shade(wall, -0.04));
      for (let k = 0; k < 4; k++) winL(gy, c + 0.13 + k * 0.2, c + 0.21 + k * 0.2, z + 4, z + 10, { box: k % 3 === 0 });
      winR(c + 0.92, r + 0.3, r + 0.4, z + 4, z + 10); winR(c + 0.92, r + 0.6, r + 0.7, z + 4, z + 10);
      const [kx, ky] = P(c + 0.5, gy, z + 25);
      ell(kx, ky, 5.5, 5.5, '#2f4a8a'); ell(kx, ky, 3.8, 3.8, '#e9c25a');
      line(kx, ky, kx + Math.cos(t * 0.5) * 3.4, ky + Math.sin(t * 0.5) * 3.4, '#222', 1);
      break;
    }
    case 'kaethchen': {
      const wall = '#fbf3e2', beam = '#6b4226';
      contact(c + 0.2, r + 0.25, c + 0.8, r + 0.8, z);
      isoBox(c + 0.2, r + 0.25, c + 0.8, r + 0.8, z, 16, wall);
      const L = (a, u, b, v) => { const p = P(a, r + 0.8, z + u), q = P(b, r + 0.8, z + v); line(p[0], p[1], q[0], q[1], beam, 1.4); };
      const R = (a, u, b, v) => { const p = P(c + 0.8, a, z + u), q = P(c + 0.8, b, z + v); line(p[0], p[1], q[0], q[1], shade(beam, -0.2), 1.4); };
      L(c + 0.2, 8, c + 0.8, 8); L(c + 0.5, 0, c + 0.5, 16); L(c + 0.2, 0, c + 0.5, 8); L(c + 0.8, 0, c + 0.5, 8); L(c + 0.2, 16, c + 0.5, 8); L(c + 0.8, 16, c + 0.5, 8);
      R(r + 0.25, 8, r + 0.8, 8); R(r + 0.52, 0, r + 0.52, 16); R(r + 0.25, 16, r + 0.52, 8); R(r + 0.8, 16, r + 0.52, 8);
      winL(r + 0.8, c + 0.28, c + 0.4, z + 10, z + 14.5, { box: true });
      roofX(c + 0.16, r + 0.21, c + 0.84, r + 0.84, z + 16, 17, snowRoof('#a3402e'), wall);
      break;
    }
    case 'experimenta': {
      contact(c + 0.08, r + 0.12, c + 0.92, r + 0.88, z);
      isoBox(c + 0.08, r + 0.12, c + 0.92, r + 0.88, z, 30, '#355070', '#4a6a90');
      for (let k = 0; k < 5; k++) {
        const al = 0.35 + 0.3 * Math.sin(t * 2 + k);
        let a = P(c + 0.08 + k * 0.17, r + 0.88, z), b = P(Math.min(c + 0.92, c + 0.25 + k * 0.17), r + 0.88, z + 30);
        line(a[0], a[1], b[0], b[1], `rgba(170,225,255,${al})`, 2);
        a = P(c + 0.92, r + 0.12 + k * 0.15, z); b = P(c + 0.92, Math.min(r + 0.88, r + 0.27 + k * 0.15), z + 30);
        line(a[0], a[1], b[0], b[1], `rgba(170,225,255,${al * 0.7})`, 2);
      }
      break;
    }
    case 'bahnhof': {
      const wall = '#e2d0a6';
      contact(c + 0.02, r + 0.3, c + 0.98, r + 0.9, z);
      isoBox(c + 0.02, r + 0.3, c + 0.98, r + 0.9, z, 14, wall, snowRoof('#8a7a62'));
      doorL(r + 0.9, c + 0.4, c + 0.6, z, 12, '#4a4036');
      for (const gx of [0.08, 0.22, 0.7, 0.84]) winL(r + 0.9, c + gx, c + gx + 0.08, z + 4, z + 9.5, { box: gx === 0.08 || gx === 0.84 });
      isoBox(c + 0.4, r + 0.36, c + 0.6, r + 0.56, z + 14, 20, '#d9c596');
      roofX(c + 0.38, r + 0.34, c + 0.62, r + 0.58, z + 34, 8, snowRoof('#4f5f6e'), '#d9c596');
      const [kx, ky] = P(c + 0.5, r + 0.56, z + 27);
      ell(kx, ky, 3.5, 3.5, '#ffffff'); line(kx, ky, kx, ky - 2.5, '#222', 0.9); line(kx, ky, kx + 1.8, ky, '#222', 0.9);
      break;
    }
    case 'wartturm': {
      const [x, y] = P(c + 0.5, r + 0.5, z);
      softShadow(x + 12, y + 2, 16, 5, 0.35);
      cyl(x, y, 10, 42, '#cdbb96', '#b0a07c');
      for (let k = 0; k < 12; k++) ell(x - 8 + hash(i, k) * 16, y - 4 - hash(i, k + 3) * 34, 2, 1.1, 'rgba(120,100,80,.25)');
      for (let k = 0; k < 5; k++) rect(x - 10 + k * 4.4, y - 46, 3, 4, shade('#cdbb96', k < 2 ? 0.12 : -0.15));
      rect(x - 1.5, y - 30, 3, 7, '#3a3048');
      rect(x - 2.2, y - 12, 4.4, 12, '#5a3a22'); circ(x, y - 12, 2.2, '#5a3a22');
      line(x, y - 46, x, y - 62, '#555', 1);
      fillPts([[x, y - 62], [x + 11 + Math.sin(t * 3) * 2, y - 59 + Math.cos(t * 3)], [x, y - 55]], '#d9534f');
      if (!winter) for (let k = 0; k < 8; k++) circ(x - 9 + hash(i, k + 9) * 6, y - 2 - k * 2.5, 2, k % 2 ? '#4f8f3a' : '#6aaa4a'); // ivy
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
      life: 0, max: 3 + Math.random() * 3, size: 2 + Math.random() * 1.5,
      tone: o.filter ? 245 : d.cat === 'industry' ? 120 : 200,
    });
  });
}

// Ambient seasonal particles in screen space: snow, falling leaves, petals, summer motes.
function updateWeather(s, dt) {
  const Wt = Render.weather, W = Render.vw, H = Render.vh;
  const want = { winter: 150, autumn: 45, spring: 40, summer: 34 }[s.season];
  const kind = s.season;
  while (Wt.length < want) Wt.push({ x: Math.random() * W, y: kind === 'summer' ? Math.random() * H : Math.random() * -H, kind, ph: Math.random() * 6 });
  for (let i = Wt.length - 1; i >= 0; i--) {
    const p = Wt[i];
    const fall = { winter: 30, autumn: 22, spring: 16, summer: -6 }[p.kind];
    p.y += fall * dt; p.ph += dt * 2;
    p.x += (Math.sin(p.ph) * 12 + (s.wind.dx - s.wind.dy) * 10) * dt;
    if (p.y > H + 5 || p.y < -10 || p.x < -10 || p.x > W + 10 || p.kind !== kind) {
      if (Wt.length > want || p.kind !== kind) { Wt.splice(i, 1); continue; }
      p.y = p.kind === 'summer' ? H + 4 : -5; p.x = Math.random() * W;
    }
  }
}
function drawWeather() {
  for (const p of Render.weather) {
    if (p.kind === 'winter') { circ(p.x, p.y, 1.9, 'rgba(255,255,255,.92)'); }
    else if (p.kind === 'autumn') {
      X.save(); X.translate(p.x, p.y); X.rotate(p.ph);
      ell(0, 0, 3.4, 1.6, ['#d9532f', '#e8a33a', '#c9a83a'][Math.floor(p.ph * 0.3) % 3]); X.restore();
    } else if (p.kind === 'spring') {
      X.save(); X.translate(p.x, p.y); X.rotate(p.ph * 0.7);
      ell(0, 0, 2.6, 1.5, 'rgba(255,196,214,.95)'); X.restore();
    } else { // drifting dandelion fluff / golden motes
      const a = 0.45 + 0.35 * Math.sin(p.ph * 1.5);
      circ(p.x, p.y, 4, `rgba(255,245,200,${a * 0.25})`); circ(p.x, p.y, 1.4, `rgba(255,252,230,${a})`);
    }
  }
}

// ----- main frame ----------------------------------------------------------
function tilePath(c, r, z, inset) {
  const d = diamond(c, r, z, inset);
  X.moveTo(d[0][0], d[0][1]); for (let k = 1; k < 4; k++) X.lineTo(d[k][0], d[k][1]); X.closePath();
}
const islandTop = () => [P(0, 0, 0), P(COLS, 0, 0), P(COLS, ROWS, 0), P(0, ROWS, 0)];

function renderFrame(s, ui, dt) {
  X = Render.ctx;
  Render.t += dt;
  const W = Render.vw, H = Render.vh, t = Render.t;
  if (Render.groundKey !== s.season) drawGround(s);
  X = Render.ctx;
  X.setTransform(Render.dpr, 0, 0, Render.dpr, 0, 0);
  drawSky(s);

  worldTransform(X);
  drawClouds('far', dt);
  X.drawImage(Render.ground, 0, 0, WORLD_W, WORLD_H);
  const Z = Render.Z;
  drawWaterfalls(s, t);

  // twinkling water highlights
  s.tiles.forEach((tile, i) => {
    if (tile.g !== 'water') return;
    const c = i % COLS, r = (i / COLS) | 0;
    for (let k = 0; k < 3; k++) {
      const a = Math.sin(t * 2.2 + hash(i, k) * 20);
      if (a < 0.45) continue;
      const p = P(c + 0.1 + hash(i, k + 40) * 0.8, r + 0.1 + hash(i, k + 41) * 0.8, Z_WATER);
      X.fillStyle = `rgba(255,255,255,${(a - 0.45) * 1.5})`;
      X.fillRect(p[0] - 2.5, p[1] - 0.5, 5, 1); X.fillRect(p[0] - 0.5, p[1] - 1.6, 1, 3.2);
    }
  });

  // drifting cloud shadows on the land
  X.save(); pathPts(islandTop()); X.clip();
  const sv = [(s.wind.dx - s.wind.dy) * 6 + 4, (s.wind.dx + s.wind.dy) * 3 + 1];
  for (const sh of Render.shadows) {
    sh.x += sv[0] * dt; sh.y += sv[1] * dt;
    if (sh.x > WORLD_W + sh.r) sh.x = -sh.r; if (sh.x < -sh.r) sh.x = WORLD_W + sh.r;
    if (sh.y > ISLAND_BOTTOM + sh.r) sh.y = OY - sh.r; if (sh.y < OY - sh.r) sh.y = ISLAND_BOTTOM + sh.r;
    softShadow(sh.x, sh.y, sh.r, sh.r * 0.5, 0.14);
  }
  X.restore();

  if (ui.tool) { // faint grid while building
    X.strokeStyle = 'rgba(255,255,255,.22)'; X.lineWidth = 1; X.beginPath();
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
    if (o && tileVisible(c, r, Z[i], 110)) drawObject(o, c, r, Z[i], s, i);
  }

  // smoke: soft lavender-grey puffs
  spawnSmoke(s, dt * Math.max(1, ui.speed));
  const Pt = Render.particles;
  for (let i = Pt.length - 1; i >= 0; i--) {
    const p = Pt[i];
    p.life += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.size += dt * 4;
    if (p.life > p.max) { Pt.splice(i, 1); continue; }
    const k = p.life / p.max, a = Math.sin(Math.PI * Math.sqrt(k)) * (p.tone >= 245 ? 0.3 : p.tone >= 200 ? 0.18 : 0.5);
    circ(p.x + p.size * 0.15, p.y + p.size * 0.2, p.size, `rgba(${p.tone - 30},${p.tone - 25},${p.tone},${a})`);
    circ(p.x - p.size * 0.15, p.y - p.size * 0.2, p.size * 0.8, `rgba(${p.tone + 20},${p.tone + 18},${p.tone + 15},${a})`);
  }

  drawClouds('near', dt);
  drawHover(s, ui);

  // screen-space light & atmosphere
  X.setTransform(Render.dpr, 0, 0, Render.dpr, 0, 0);
  const warm = X.createLinearGradient(0, 0, W, H);
  warm.addColorStop(0, 'rgba(255,236,180,.16)'); warm.addColorStop(0.5, 'rgba(255,236,180,0)'); warm.addColorStop(1, 'rgba(60,80,140,.10)');
  X.fillStyle = warm; X.fillRect(0, 0, W, H);
  const vig = X.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.8);
  vig.addColorStop(0, 'rgba(30,50,70,0)'); vig.addColorStop(1, 'rgba(30,50,70,.22)');
  X.fillStyle = vig; X.fillRect(0, 0, W, H);
  if (s.power && s.power.unserved > 0) { // blackout: the city dims and flickers
    const k = (1 - s.power.ratio) * (0.35 + 0.05 * Math.sin(t * 9));
    X.fillStyle = `rgba(15,20,55,${Math.min(0.4, k)})`; X.fillRect(0, 0, W, H);
  }
  if (s.smog > 5) { X.fillStyle = `rgba(125,110,85,${Math.min(0.42, s.smog / 100 * 0.42)})`; X.fillRect(0, 0, W, H); }
  if (s.season === 'summer' && s.temp + s.mods.heatwave > 2.6) {
    const k = Math.min(0.28, (s.temp + s.mods.heatwave - 2.6) * 0.12);
    const g = X.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7);
    g.addColorStop(0, 'rgba(255,170,60,0)'); g.addColorStop(1, `rgba(255,120,30,${k})`);
    X.fillStyle = g; X.fillRect(0, 0, W, H);
  }
  updateWeather(s, dt);
  drawWeather();
}

function drawHover(s, ui) {
  const hv = ui.hover, Z = Render.Z;
  if (!hv) return;
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

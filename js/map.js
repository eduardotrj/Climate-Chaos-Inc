'use strict';
// ---------------------------------------------------------------------------
// A (very) stylized Heilbronn: the Neckar flows north through the middle,
// the harbor and power plant sit in the north, the Altstadt on the east bank,
// the Hauptbahnhof on the west bank and the Wartberg vineyards in the north-east.
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const riverCol = r => 12 + Math.round(1.6 * Math.sin(r * 0.33 + 0.5));
const idx = (c, r) => r * COLS + c;
const inBounds = (c, r) => c >= 0 && r >= 0 && c < COLS && r < ROWS;

function buildHeilbronn(seed) {
  const rng = mulberry32(seed);
  const tiles = [];
  for (let i = 0; i < COLS * ROWS; i++) tiles.push({ g: 'grass', o: null, v: rng() });
  const T = (c, r) => tiles[idx(c, r)];

  // Wartberg hill
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const dx = (c - 26) / 4.6, dy = (r - 3) / 3.6;
    if (dx * dx + dy * dy <= 1) T(c, r).g = 'hill';
  }
  // Neckar + harbor basin
  for (let r = 0; r < ROWS; r++) {
    const rc = riverCol(r);
    T(rc, r).g = 'water'; T(rc + 1, r).g = 'water';
    if (r >= 1 && r <= 3) T(rc + 2, r).g = 'water';
  }
  // Roads (bridges where they cross the river)
  const road = (c, r) => { const t = T(c, r); t.g = t.g === 'water' ? 'bridge' : 'road'; };
  for (let c = 0; c < COLS; c++) { road(c, 9); road(c, 15); }
  for (let r = 0; r < ROWS; r++) { road(5, r); road(21, r); }

  const put = (id, c, r, extra) => {
    if (!inBounds(c, r)) return false;
    const t = T(c, r);
    if ((t.g !== 'grass' && t.g !== 'hill') || t.o) return false;
    t.o = Object.assign({ id, age: 0, health: 100 }, extra || {});
    if (isTree(id)) t.o.age = CATALOG[id].grow; // starting trees are mature
    return true;
  };

  // Landmarks
  put('kilian', 17, 10); put('rathaus', 18, 10); put('kaethchen', 17, 11);
  put('experimenta', riverCol(7) - 2, 7); put('bahnhof', 8, 10); put('wartturm', 26, 2);

  // The old industrial north
  put('kohle', 17, 1); put('auto', 19, 2); put('schraube', 18, 4); put('schraube', 20, 4);
  put('salz', 17, 18);
  // Wartberg vineyards + winery
  put('weinkeller', 23, 6);
  [[23, 5], [24, 5], [24, 4], [25, 4], [25, 5], [27, 4], [28, 3], [27, 5]].forEach(([c, r]) => put('rebe', c, r));
  // BUGA Neckarbogen park
  put('park', 10, 4); put('park', 11, 4);

  // Neighborhoods
  let houses = 0;
  const zones = [[1, 9, 6, 18], [16, 24, 8, 18]];
  for (const [c0, c1, r0, r1] of zones) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    if (houses < 28 && rng() < 0.3 && put('wohnblock', c, r)) houses++;
  }
  // Street trees along the Allee and the eastern ring road
  const streetTrees = ['linde', 'ahorn', 'platane'];
  for (let c = 1; c < COLS; c += 3) put(streetTrees[c % 3], c, 8);
  for (let r = 11; r < ROWS; r += 3) put(streetTrees[r % 3], 22, r);

  return tiles;
}

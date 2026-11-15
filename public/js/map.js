// Gotham is drawn from a pixel-art picture (public/assets/town.webp).
// The walkable grid, doors and places are traced from that picture in mapdata.js.
import { IMAGE, RECTS, HOMES, DOORS, PLACE_AREAS, RIVER, WATERFALL, FOUNTAIN_PX, CHIMNEYS } from "./mapdata.js";

export const T = 32;
export const W = 48;
export const H = 64;
export const TILE = {
  BLOCKED: 0, PATH: 1, WATER: 2, BUILDING: 3, GRASS: 4, PLAZA: 5, FIELD: 6, FENCE: 7,
  FOUNTAIN: 8, YARD: 9, DIRT: 10, BRIDGE: 11, BLOCK: 12, JAIL: 13, DOCK: 14, PLOT: 15,
};
const WALKABLE = new Set([TILE.PATH, TILE.GRASS, TILE.FIELD, TILE.DIRT, TILE.BRIDGE, TILE.DOCK, TILE.PLOT]);

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// River center (in tiles) for a row, interpolated from the traced samples.
export function riverX(y) {
  for (let i = 0; i < RIVER.length - 1; i++) {
    const [y0, x0] = RIVER[i], [y1, x1] = RIVER[i + 1];
    if (y >= y0 && y <= y1) return x0 + ((y - y0) / (y1 - y0)) * (x1 - x0);
  }
  return y < RIVER[0][0] ? RIVER[0][1] : RIVER.at(-1)[1];
}

export function buildTown() {
  const grid = new Uint8Array(W * H); // everything starts blocked (trees, roofs, water…)
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const get = (x, y) => (inb(x, y) ? grid[y * W + x] : TILE.BLOCKED);
  const set = (x, y, t) => { if (inb(x, y)) grid[y * W + x] = t; };
  for (const [name, rects] of Object.entries(RECTS)) {
    for (const [x, y, w, h] of rects) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, TILE[name]);
  }
  const places = {};
  for (const [name, areas] of Object.entries(PLACE_AREAS)) {
    places[name] = [];
    const ok = name === "jailyard" ? (t) => t === TILE.YARD : name === "garden" ? (t) => t === TILE.FIELD : (t) => WALKABLE.has(t);
    for (const [x, y, w, h] of areas) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (ok(get(i, j))) places[name].push({ x: i, y: j });
  }
  const town = {
    grid, get, places,
    houses: HOMES.map((h) => ({ door: { x: h.x, y: h.y }, name: h.name })),
    special: { jail: { door: DOORS.jail } },
    fountain: FOUNTAIN_PX,
    waterfall: WATERFALL,
    chimneys: CHIMNEYS.map(([x, y]) => ({ x, y })),
    windows: [], lamps: [],
    plaza: { x: 18, y: 12, w: 12, h: 8 },
  };
  town.walkable = (x, y) => WALKABLE.has(get(x, y));
  return town;
}

// ---------- A* pathfinding ----------
export function findPath(town, sx, sy, tx, ty) {
  sx = Math.round(sx); sy = Math.round(sy);
  if (!town.walkable(tx, ty)) return null;
  const key = (x, y) => y * W + x;
  const open = [{ x: sx, y: sy, f: 0 }];
  const came = new Map();
  const g = new Map([[key(sx, sy), 0]]);
  const closed = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    const ck = key(cur.x, cur.y);
    if (cur.x === tx && cur.y === ty) {
      const path = [];
      let k = ck;
      while (k !== key(sx, sy)) { path.unshift({ x: k % W, y: Math.floor(k / W) }); k = came.get(k); }
      return path;
    }
    if (closed.has(ck)) continue;
    closed.add(ck);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!town.walkable(nx, ny)) continue;
      const t = town.get(nx, ny);
      const cost = t === TILE.PATH || t === TILE.BRIDGE ? 1 : t === TILE.DIRT ? 1.1 : 1.5;
      const nk = key(nx, ny), ng = g.get(ck) + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng); came.set(nk, ck);
        open.push({ x: nx, y: ny, f: ng + Math.abs(nx - tx) + Math.abs(ny - ty) });
      }
    }
  }
  return null;
}

// ---------- rendering ----------
const loadImage = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error(`could not load ${src}`));
  img.src = src;
});

export async function renderStatic(town) {
  const img = await loadImage(IMAGE);
  const ground = document.createElement("canvas");
  ground.width = W * T; ground.height = H * T;
  const g = ground.getContext("2d");
  g.drawImage(img, 0, 0, W * T, H * T);
  findLights(g, town);
  buildOcclusion(g, town);
  const canopy = document.createElement("canvas"); canopy.width = 1; canopy.height = 1;
  return { ground, canopy };
}

// Depth: find what in the picture stands up from the ground (trees, roofs, walls, posts) and
// where each of those things touches the ground. A resident whose feet are above (north of)
// that base line is behind it, so those pixels get drawn over them.
function buildOcclusion(g, town) {
  const w = W * T, h = H * T;
  const img = g.getImageData(0, 0, w, h), d = img.data;
  const occ = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    const r = d[i], gg = d[i + 1], b = d[i + 2];
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b), lum = (r * 3 + gg * 6 + b) / 10;
    const grass = gg > r + 5 && gg > b + 40 && lum > 105;
    const cobble = mx - mn < 40 && lum > 120 && lum < 225;
    const dirt = r > gg && gg > b && r - b > 45 && r - gg < 60 && lum > 120 && lum < 215;
    const water = b > r + 30 && b > gg - 10 && b > 140 && gg > 90;
    occ[p] = grass || cobble || dirt || water ? 0 : 1;
    // dark mortar between cobblestones isn't an object
    if (occ[p] && mx - mn < 30 && lum < 125 && lum > 60) {
      const x = p % w, y = (p / w) | 0;
      if (town.walkable(Math.floor(x / T), Math.floor(y / T))) occ[p] = 0;
    }
  }
  // close small vertical gaps (light leaves, window glints) so a tree or roof stays one piece
  for (let x = 0; x < w; x++) {
    let last = -99;
    for (let y = 0; y < h; y++) {
      if (occ[y * w + x]) { if (y - last > 1 && y - last <= 5 && last >= 0) for (let k = last + 1; k < y; k++) occ[k * w + x] = 1; last = y; }
    }
  }
  // base line: bottom of each vertical run; only keep runs that stand on unwalkable ground
  const base = new Uint16Array(w * h);
  for (let x = 0; x < w; x++) {
    let y = h - 1;
    while (y >= 0) {
      if (!occ[y * w + x]) { y--; continue; }
      const bottom = y;
      while (y >= 0 && occ[y * w + x]) y--;
      const tile = town.get(Math.floor(x / T), Math.floor(bottom / T));
      const solid = !(tile === TILE.PATH || tile === TILE.GRASS || tile === TILE.DIRT || tile === TILE.BRIDGE || tile === TILE.DOCK || tile === TILE.PLOT || tile === TILE.FIELD);
      if (solid && bottom - y > 3) for (let k = y + 1; k <= bottom; k++) base[k * w + x] = bottom;
    }
  }
  town.occlusion = { w, h, base, rgba: d };
}

// Windows and lamps in the picture are warm yellow; find them so they glow at night.
function findLights(g, town) {
  const { data, width, height } = g.getImageData(0, 0, W * T, H * T);
  const cell = 8, cols = Math.ceil(width / cell), rows = Math.ceil(height / cell);
  const hot = new Uint16Array(cols * rows);
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const i = (y * width + x) * 4, r = data[i], gg = data[i + 1], b = data[i + 2];
    if (r > 235 && gg > 175 && b < 150 && r - b > 110) hot[Math.floor(y / cell) * cols + Math.floor(x / cell)]++;
  }
  const seen = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const k = cy * cols + cx;
    if (hot[k] < 3 || seen[k]) continue;
    let sx = 0, sy = 0, n = 0, weight = 0;
    const stack = [k]; seen[k] = 1;
    while (stack.length) {
      const c = stack.pop(), x = c % cols, y = Math.floor(c / cols);
      sx += x * hot[c]; sy += y * hot[c]; weight += hot[c]; n++;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, nk = ny * cols + nx;
        if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[nk] && hot[nk] >= 3) { seen[nk] = 1; stack.push(nk); }
      }
    }
    if (n > 40 || weight < 6) continue; // skip big yellow areas (hay, crops)
    const px = (sx / weight) * cell + cell / 2, py = (sy / weight) * cell + cell / 2;
    town.windows.push({ x: px, y: py, w: 12, h: 12, size: Math.min(1.6, 0.6 + n / 8) });
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

// Gotham is drawn from a pixel-art picture (public/assets/town.webp).
// The walkable grid, doors and places are traced from that picture in mapdata.js.
import { IMAGE, RECTS, HOMES, DOORS, PLACE_AREAS, RIVER, WATERFALL, FOUNTAIN_PX, CHIMNEYS } from "./mapdata.js";

export const T = 32;
export const W = 48;
export const H = 32;
export const TILE = {
  BLOCKED: 0, PATH: 1, WATER: 2, BUILDING: 3, GRASS: 4, PLAZA: 5, FIELD: 6, FENCE: 7,
  FOUNTAIN: 8, YARD: 9, DIRT: 10, BRIDGE: 11, BLOCK: 12, JAIL: 13,
};
const WALKABLE = new Set([TILE.PATH, TILE.GRASS, TILE.FIELD, TILE.DIRT, TILE.BRIDGE]);

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
    forge: { x: 628, y: 806 },
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
  drawJail(g, town);
  const canopy = document.createElement("canvas"); canopy.width = 1; canopy.height = 1;
  return { ground, canopy };
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

// The picture has no jail, so Gotham built one in a clearing by the south-east woods.
function drawJail(g, town) {
  const x = 43 * T - 8, y = 25 * T + 8, w = 4 * T + 16, h = 3 * T + 4;
  const cx0 = 42 * T + 4, cy0 = 26 * T - 6, cw = 6 * T - 8, ch = 6 * T + 6;
  g.fillStyle = "#4f8f2c"; roundRect(g, cx0 - 4, cy0 - 4, cw + 8, ch + 8, 16); g.fill();
  g.fillStyle = "#62a83a"; roundRect(g, cx0, cy0, cw, ch, 14); g.fill();
  const rnd = mulberry32(5);
  for (let i = 0; i < 220; i++) { g.fillStyle = rnd() < 0.5 ? "rgba(40,100,30,0.45)" : "rgba(150,210,90,0.45)"; g.fillRect(cx0 + 6 + rnd() * (cw - 12), cy0 + 6 + rnd() * (ch - 12), 1, 3); }
  g.fillStyle = "#c79c62";
  g.fillRect(42 * T, 28 * T, T, 2 * T); g.fillRect(42 * T, 29 * T, 4 * T, T);
  g.fillStyle = "rgba(120,85,45,0.35)"; for (let i = 0; i < 40; i++) g.fillRect(42 * T + rnd() * 4 * T, 29 * T + rnd() * T, 2, 2);
  const yx = 46 * T, yy = 29 * T, yw = 2 * T, yh = 3 * T;
  g.fillStyle = "#b3ab9e"; g.fillRect(yx, yy, yw, yh);
  g.fillStyle = "rgba(80,70,60,0.25)"; for (let i = 0; i < 50; i++) g.fillRect(yx + rnd() * yw, yy + rnd() * yh, 2, 2);
  g.fillStyle = "rgba(0,0,0,0.3)"; g.fillRect(x + 8, y + 10, w, h);
  const roofH = Math.round(h * 0.45), wy = y + roofH;
  g.fillStyle = "#a9a39a"; g.fillRect(x, wy, w, h - roofH);
  g.fillStyle = "rgba(0,0,0,0.12)";
  for (let r = wy + 4; r < y + h - 6; r += 8) for (let k = x + (((r - wy) / 8) % 2) * 8; k < x + w; k += 16) g.fillRect(k, r, 15, 1);
  g.fillStyle = "#7e7a73"; g.fillRect(x - 2, y + h - 6, w + 4, 6);
  for (const wx of [x + 20, x + w - 36]) {
    g.fillStyle = "#3b2414"; g.fillRect(wx - 2, wy + 8, 20, 20);
    g.fillStyle = "#ffd36e"; g.fillRect(wx, wy + 10, 16, 16);
    g.fillStyle = "#2b2b30"; for (let k = 1; k < 16; k += 4) g.fillRect(wx + k, wy + 10, 2, 16);
    town.windows.push({ x: wx + 8, y: wy + 18, w: 12, h: 12, size: 1 });
  }
  const dx = 44 * T + T / 2;
  g.fillStyle = "#3b2414"; roundRect(g, dx - 12, y + h - 32, 24, 28, 10); g.fill();
  g.fillStyle = "#4a4d55"; roundRect(g, dx - 9, y + h - 29, 18, 25, 8); g.fill();
  g.fillStyle = "#2b2b30"; for (let k = -6; k <= 6; k += 4) g.fillRect(dx + k, y + h - 26, 2, 20);
  g.fillStyle = "#2f3340"; g.fillRect(x - 6, y - 4, w + 12, roofH + 10);
  g.fillStyle = "#454b5e"; g.fillRect(x - 6, y - 4, w + 12, roofH + 4);
  g.fillStyle = "#3a3f50"; for (let r = y; r < y + roofH; r += 7) g.fillRect(x - 6, r + 5, w + 12, 2);
  g.fillStyle = "#5d6479"; g.fillRect(x + 8, y - 6, w - 16, 4);
  g.font = "bold 13px Georgia, 'Times New Roman', serif";
  const tw = g.measureText("Jail").width + 18, sx = x + w / 2 - tw / 2, sy = wy - 12;
  g.fillStyle = "#3b2414"; roundRect(g, sx - 2, sy - 2, tw + 4, 22, 4); g.fill();
  g.fillStyle = "#7a4f2a"; roundRect(g, sx, sy, tw, 18, 3); g.fill();
  g.fillStyle = "#f6e7c8"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("Jail", x + w / 2, sy + 10);
  g.fillStyle = "#5e3a1f";
  for (let k = yx; k <= yx + yw; k += 12) g.fillRect(k, yy - 4, 4, yh + 2);
  g.fillRect(yx, yy + 2, yw + 4, 3); g.fillRect(yx, yy + yh - 10, yw + 4, 3);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}

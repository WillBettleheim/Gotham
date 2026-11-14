// Town layout (tile grid) + pre-rendered static layers.
export const T = 32;
export const W = 66;
export const H = 38;
export const TILE = { GRASS: 0, PATH: 1, WATER: 2, BUILDING: 3, TREE: 4, PLAZA: 5, FIELD: 6, FENCE: 7, FOUNTAIN: 8, YARD: 9 };
const { GRASS, PATH, WATER, BUILDING, TREE, PLAZA, FIELD, FENCE, FOUNTAIN, YARD } = TILE;
const WALKABLE = new Set([GRASS, PATH, PLAZA, FIELD]);

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildTown() {
  const rnd = mulberry32(20261114);
  const grid = new Uint8Array(W * H);
  const inb = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const get = (x, y) => (inb(x, y) ? grid[y * W + x] : TREE);
  const set = (x, y, t) => { if (inb(x, y)) grid[y * W + x] = t; };
  const rect = (x, y, w, h, t) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) set(i, j, t); };

  // Roads
  rect(1, 19, W - 2, 2, PATH); // main street
  rect(27, 8, 2, 28, PATH);   // north-south avenue
  rect(3, 9, W - 4, 1, PATH);  // north lane
  rect(3, 29, W - 4, 1, PATH); // south road
  rect(3, 35, 25, 1, PATH);   // south cottage lane
  rect(21, 14, 14, 12, PLAZA);
  rect(26, 18, 4, 4, FOUNTAIN);
  rect(39, 17, 9, 2, PLAZA);  // café patio

  // Park: pond + ring path
  const pond = { cx: 10.5, cy: 24.5, rx: 5, ry: 2 };
  for (let y = 21; y <= 28; y++) for (let x = 1; x <= 20; x++) {
    const dx = (x + 0.5 - pond.cx) / pond.rx, dy = (y + 0.5 - pond.cy) / pond.ry;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1) set(x, y, WATER);
    else if (d >= 1.3 && d < 1.75) set(x, y, PATH);
  }
  for (let y = 21; get(10, y) !== PATH && y < 26; y++) set(10, y, PATH);
  for (let y = 28; get(10, y) !== PATH && y > 23; y--) set(10, y, PATH);

  // Garden: fenced fields with a gate
  rect(32, 30, 20, 7, FENCE);
  rect(33, 31, 18, 5, FIELD);
  set(42, 30, PATH); set(43, 30, PATH);

  // Jail yard (fenced, no gate: prisoners are escorted in)
  rect(55, 31, 9, 6, FENCE);
  rect(56, 32, 7, 4, YARD);

  // Buildings (door is the walkable tile just below the building)
  const buildings = [];
  const roofs = ["#c0504d", "#4f7cac", "#d08a3a", "#6b8e4e", "#8e5ea2", "#b5654a", "#4a8f8a", "#a0525c", "#5f6fa8"];
  const walls = ["#f3e3c3", "#e9d8b8", "#f0dcc8", "#e4d6c0", "#efe2cf"];
  const add = (b) => {
    buildings.push(b);
    rect(b.x, b.y, b.w, b.h, BUILDING);
    if (get(b.door.x, b.door.y) === PATH) return; // door already opens onto a road
    for (let y = b.door.y; y < b.door.y + 6; y++) {
      if (y > b.door.y && (get(b.door.x, y) === PATH || get(b.door.x, y) === PLAZA)) break;
      set(b.door.x, y, PATH);
    }
  };
  const houses = [];
  [4, 11, 18, 33, 40, 47].forEach((x, i) => houses.push({ x, y: 4, w: 5, h: 4, door: { x: x + 2, y: 8 }, kind: "house", roof: roofs[i], wall: walls[i % 5] }));
  [4, 11, 18].forEach((x, i) => houses.push({ x, y: 31, w: 5, h: 4, door: { x: x + 2, y: 35 }, kind: "house", roof: roofs[6 + i], wall: walls[(i + 2) % 5] }));
  // newer neighborhood for the residents who moved in later
  [[16, 12, 5], [49, 12, 5], [48, 22, 5], [23, 31, 4]].forEach(([x, y, w], i) =>
    houses.push({ x, y, w, h: 4, door: { x: x + 2, y: y + 4 }, kind: "house", roof: ["#3f7fbf", "#2f9e6a", "#c24f8e", "#d4a017"][i], wall: walls[(i + 1) % 5] }));
  houses.forEach(add);
  const special = {
    townhall: { x: 23, y: 2, w: 10, h: 6, door: { x: 27, y: 8 }, kind: "townhall", roof: "#7a8ca0", wall: "#efe9dc", label: "Town Hall" },
    library: { x: 5, y: 12, w: 10, h: 5, door: { x: 9, y: 17 }, kind: "library", roof: "#5a4a8a", wall: "#eadcc4", label: "Library" },
    cafe: { x: 39, y: 12, w: 9, h: 5, door: { x: 43, y: 17 }, kind: "cafe", roof: "#c4683c", wall: "#f6e6cc", label: "The Warm Byte Café" },
    workshop: { x: 39, y: 22, w: 8, h: 5, door: { x: 42, y: 27 }, kind: "workshop", roof: "#5c6670", wall: "#d9cbb4", label: "Orion's Workshop" },
    courthouse: { x: 56, y: 11, w: 7, h: 5, door: { x: 59, y: 16 }, kind: "courthouse", roof: "#8a7f72", wall: "#f2efe8", label: "Courthouse" },
    jail: { x: 56, y: 22, w: 7, h: 5, door: { x: 59, y: 27 }, kind: "jail", roof: "#4b4f58", wall: "#a9a39a", label: "Jail" },
  };
  Object.values(special).forEach(add);

  // Decorations
  const decor = [];
  const nearNonGrass = (x, y, r) => {
    for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (get(x + i, y + j) !== GRASS) return true;
    return false;
  };
  // edge forest
  for (let x = 0; x < W; x++) { set(x, 0, TREE); set(x, H - 1, TREE); if (rnd() < 0.6 && get(x, 1) === GRASS) set(x, 1, TREE); if (rnd() < 0.6 && get(x, H - 2) === GRASS) set(x, H - 2, TREE); }
  for (let y = 0; y < H; y++) { set(0, y, TREE); set(W - 1, y, TREE); if (rnd() < 0.5 && get(W - 2, y) === GRASS) set(W - 2, y, TREE); }
  // lamps along roads
  const lamps = [];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== GRASS) continue;
    const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([i, j]) => get(x + i, y + j) === PATH);
    if (!adj || (x * 7 + y * 3) % 11 !== 0) continue;
    if (lamps.some((l) => Math.abs(l.x - x) + Math.abs(l.y - y) < 7)) continue;
    lamps.push({ x, y });
  }
  [[21, 14], [34, 14], [21, 25], [34, 25]].forEach(([x, y]) => lamps.push({ x, y }));
  // random trees
  const lampAt = (x, y) => lamps.some((l) => l.x === x && l.y === y);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== GRASS || nearNonGrass(x, y, 1) || lampAt(x, y)) continue;
    const inPark = x <= 20 && y >= 21 && y <= 28;
    if (rnd() < (inPark ? 0.3 : 0.12)) set(x, y, TREE);
  }
  // flowers & bushes
  const flowerColors = ["#ff6b8b", "#ffd166", "#ffffff", "#c77dff", "#ff9f1c"];
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    if (get(x, y) !== GRASS || lampAt(x, y)) continue;
    if (rnd() < 0.07) decor.push({ type: "flowers", x, y, color: flowerColors[Math.floor(rnd() * flowerColors.length)], seed: rnd() });
  }
  // benches & café tables
  [[22, 15], [33, 15], [22, 24], [33, 24], [5, 21], [16, 28]].forEach(([x, y]) => decor.push({ type: "bench", x, y }));
  [[40, 17], [46, 17], [40, 18], [46, 18]].forEach(([x, y]) => decor.push({ type: "table", x, y }));
  decor.push({ type: "board", x: 25, y: 8 });

  // Places → standing tiles
  const tilesWhere = (x0, y0, x1, y1, ok = (t) => WALKABLE.has(t)) => {
    const out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (ok(get(x, y))) out.push({ x, y });
    return out;
  };
  const places = {
    library: tilesWhere(5, 17, 14, 18),
    cafe: tilesWhere(39, 17, 47, 18, (t) => t === PLAZA),
    plaza: tilesWhere(21, 14, 34, 25, (t) => t === PLAZA),
    park: tilesWhere(1, 21, 20, 28, (t) => t === PATH),
    workshop: tilesWhere(38, 27, 47, 28),
    garden: tilesWhere(33, 31, 50, 35, (t) => t === FIELD),
    townhall: tilesWhere(22, 8, 33, 8),
    courthouse: tilesWhere(54, 17, 64, 18),
    jailyard: tilesWhere(56, 32, 62, 35, (t) => t === YARD),
  };

  const town = { grid, get, buildings, houses, special, decor, lamps, pond, places, windows: [], chimneys: [] };
  town.walkable = (x, y) => WALKABLE.has(get(x, y));
  return town;
}

// ---------- A* pathfinding ----------
export function findPath(town, sx, sy, tx, ty) {
  sx = Math.round(sx); sy = Math.round(sy);
  if (!town.walkable(tx, ty)) return null;
  const key = (x, y) => y * W + x;
  const open = [{ x: sx, y: sy, g: 0, f: 0 }];
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
      const cost = t === PATH || t === PLAZA ? 1 : t === FIELD ? 1.6 : 1.4; // prefer roads
      const nk = key(nx, ny), ng = g.get(ck) + cost;
      if (ng < (g.get(nk) ?? Infinity)) {
        g.set(nk, ng); came.set(nk, ck);
        open.push({ x: nx, y: ny, g: ng, f: ng + Math.abs(nx - tx) + Math.abs(ny - ty) });
      }
    }
  }
  return null;
}

// ---------- Static rendering ----------
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

export function renderStatic(town) {
  const rnd = mulberry32(7);
  const ground = document.createElement("canvas");
  ground.width = W * T; ground.height = H * T;
  const g = ground.getContext("2d");
  const canopy = document.createElement("canvas");
  canopy.width = W * T; canopy.height = H * T;
  const c = canopy.getContext("2d");
  const get = town.get;

  const grassCols = ["#79c45f", "#74bf5a", "#7fc964", "#71ba57"];
  const drawGrass = (x, y) => {
    const px = x * T, py = y * T;
    g.fillStyle = grassCols[(x * 13 + y * 7 + ((x * y) % 3)) % 4];
    g.fillRect(px, py, T, T);
    g.fillStyle = "rgba(40,110,40,0.35)";
    for (let i = 0; i < 4; i++) {
      const bx = px + rnd() * (T - 3), by = py + rnd() * (T - 4);
      g.fillRect(bx, by, 1, 3); g.fillRect(bx + 2, by + 1, 1, 2);
    }
    if (rnd() < 0.15) { g.fillStyle = "rgba(255,255,255,0.12)"; g.fillRect(px + rnd() * T, py + rnd() * T, 2, 2); }
  };

  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const t = get(x, y), px = x * T, py = y * T;
    drawGrass(x, y);
    if (t === PATH) {
      g.fillStyle = "#e2cc9c"; g.fillRect(px, py, T, T);
      g.fillStyle = "rgba(150,115,70,0.25)";
      for (let i = 0; i < 5; i++) g.fillRect(px + rnd() * (T - 3), py + rnd() * (T - 3), 3, 2);
      g.fillStyle = "rgba(90,140,60,0.55)";
      if (get(x, y - 1) === GRASS || get(x, y - 1) === TREE) g.fillRect(px, py, T, 3);
      if (get(x, y + 1) === GRASS || get(x, y + 1) === TREE) g.fillRect(px, py + T - 3, T, 3);
      if (get(x - 1, y) === GRASS || get(x - 1, y) === TREE) g.fillRect(px, py, 3, T);
      if (get(x + 1, y) === GRASS || get(x + 1, y) === TREE) g.fillRect(px + T - 3, py, 3, T);
    } else if (t === PLAZA || t === FOUNTAIN) {
      g.fillStyle = (x + y) % 2 ? "#d8d0c2" : "#cfc6b6"; g.fillRect(px, py, T, T);
      g.strokeStyle = "rgba(120,105,85,0.35)"; g.lineWidth = 1;
      for (let r = 0; r < 4; r++) {
        g.beginPath(); g.moveTo(px, py + r * 8 + 0.5); g.lineTo(px + T, py + r * 8 + 0.5); g.stroke();
        const off = r % 2 ? 8 : 0;
        for (let k = off; k < T; k += 16) { g.beginPath(); g.moveTo(px + k + 0.5, py + r * 8); g.lineTo(px + k + 0.5, py + r * 8 + 8); g.stroke(); }
      }
    } else if (t === WATER) {
      g.fillStyle = "#4fa6dc"; g.fillRect(px, py, T, T);
      g.fillStyle = "#62b6e8"; g.fillRect(px + 4, py + 6, T - 8, T - 12);
      const edge = (dx, dy) => get(x + dx, y + dy) !== WATER;
      g.fillStyle = "#e9dcae";
      if (edge(0, -1)) g.fillRect(px, py, T, 5);
      if (edge(0, 1)) g.fillRect(px, py + T - 5, T, 5);
      if (edge(-1, 0)) g.fillRect(px, py, 5, T);
      if (edge(1, 0)) g.fillRect(px + T - 5, py, 5, T);
    } else if (t === YARD) {
      g.fillStyle = (x + y) % 2 ? "#b9b2a6" : "#b3ab9e"; g.fillRect(px, py, T, T);
      g.fillStyle = "rgba(80,70,60,0.25)";
      for (let i = 0; i < 6; i++) g.fillRect(px + rnd() * (T - 2), py + rnd() * (T - 2), 2, 2);
    } else if (t === FIELD) {
      g.fillStyle = "#8a5a36"; g.fillRect(px, py, T, T);
      g.fillStyle = "#74492a";
      for (let r = 0; r < 4; r++) g.fillRect(px, py + r * 8 + 6, T, 2);
      const crop = (x + y * 3) % 5;
      for (let r = 0; r < 2; r++) for (let k = 0; k < 2; k++) {
        const cx = px + 8 + k * 16, cy = py + 9 + r * 16;
        if (crop === 0) { g.fillStyle = "#f08a24"; g.beginPath(); g.ellipse(cx, cy, 6, 5, 0, 0, Math.PI * 2); g.fill(); g.fillStyle = "#4c8a2e"; g.fillRect(cx - 1, cy - 7, 2, 3); }
        else if (crop === 1) { g.fillStyle = "#8fd16a"; g.beginPath(); g.arc(cx, cy, 5, 0, Math.PI * 2); g.fill(); g.fillStyle = "#6cb24a"; g.beginPath(); g.arc(cx, cy, 2.5, 0, Math.PI * 2); g.fill(); }
        else { g.fillStyle = "#5fae3f"; g.fillRect(cx - 1, cy - 5, 2, 7); g.fillRect(cx - 4, cy - 3, 3, 2); g.fillRect(cx + 1, cy - 4, 3, 2); if (crop === 2) { g.fillStyle = "#e23b3b"; g.fillRect(cx + 2, cy - 1, 3, 3); } }
      }
    } else if (t === FENCE) {
      g.fillStyle = "#9b6b3f";
      const horiz = get(x - 1, y) === FENCE || get(x + 1, y) === FENCE || get(x - 1, y) === PATH || get(x + 1, y) === PATH;
      const vert = get(x, y - 1) === FENCE || get(x, y + 1) === FENCE;
      if (horiz) { g.fillRect(px, py + 12, T, 3); g.fillRect(px, py + 20, T, 3); }
      if (vert) { g.fillRect(px + 12, py, 3, T); g.fillRect(px + 18, py, 3, T); }
      g.fillStyle = "#7a5230"; g.fillRect(px + 13, py + 8, 6, 18);
      g.fillStyle = "#b9875a"; g.fillRect(px + 13, py + 8, 6, 3);
    } else if (t === TREE) {
      // trunk + shadow on ground, canopy on the overlay layer
      g.fillStyle = "rgba(0,0,0,0.2)"; g.beginPath(); g.ellipse(px + 16, py + 27, 13, 5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#7a4f2c"; g.fillRect(px + 13, py + 14, 6, 13);
      g.fillStyle = "#5f3c20"; g.fillRect(px + 17, py + 14, 2, 13);
      const s = 0.85 + rnd() * 0.35, kind = rnd();
      const base = kind < 0.2 ? ["#2f7d4f", "#3d9a60", "#56b874"] : kind < 0.3 ? ["#b4572e", "#d97a3a", "#f0a050"] : ["#2e7a3a", "#3f9a48", "#5cbc5e"];
      const cx = px + 16, cy = py + 6;
      c.fillStyle = base[0]; c.beginPath(); c.arc(cx, cy + 2, 17 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = base[1]; c.beginPath(); c.arc(cx - 3, cy - 1, 13 * s, 0, Math.PI * 2); c.fill();
      c.fillStyle = base[2]; c.beginPath(); c.arc(cx - 6, cy - 5, 6 * s, 0, Math.PI * 2); c.fill();
      if (kind > 0.85) { c.fillStyle = "#ff8fab"; for (let i = 0; i < 4; i++) c.fillRect(cx - 10 + rnd() * 20, cy - 8 + rnd() * 16, 3, 3); }
    }
  }

  // decor on ground
  for (const d of town.decor) {
    const px = d.x * T, py = d.y * T;
    if (d.type === "flowers") {
      for (let i = 0; i < 4; i++) {
        const fx = px + 5 + ((d.seed * 97 + i * 37) % 22), fy = py + 6 + ((d.seed * 53 + i * 19) % 20);
        g.fillStyle = "#3f8f3a"; g.fillRect(fx, fy + 2, 1, 4);
        g.fillStyle = d.color; g.fillRect(fx - 2, fy, 2, 2); g.fillRect(fx + 1, fy, 2, 2); g.fillRect(fx - 1, fy - 2, 2, 2); g.fillRect(fx - 1, fy + 2, 2, 1);
        g.fillStyle = "#fff4a3"; g.fillRect(fx - 0.5, fy, 1.5, 1.5);
      }
    } else if (d.type === "bench") {
      g.fillStyle = "rgba(0,0,0,0.18)"; g.fillRect(px + 4, py + 20, 26, 5);
      g.fillStyle = "#8b5a2b"; g.fillRect(px + 3, py + 10, 26, 4); g.fillRect(px + 3, py + 16, 26, 4);
      g.fillStyle = "#5e3b1c"; g.fillRect(px + 5, py + 20, 3, 5); g.fillRect(px + 24, py + 20, 3, 5);
    } else if (d.type === "table") {
      g.fillStyle = "rgba(0,0,0,0.18)"; g.beginPath(); g.ellipse(px + 17, py + 24, 11, 4, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#fff"; g.beginPath(); g.arc(px + 16, py + 14, 10, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#e05a47"; g.lineWidth = 2; g.stroke();
      g.fillStyle = "#6b4a2b"; g.fillRect(px + 15, py + 16, 2, 9);
      g.fillStyle = "#e05a47"; g.fillRect(px + 13, py + 10, 3, 3);
    } else if (d.type === "board") {
      g.fillStyle = "#6b4a2b"; g.fillRect(px + 6, py + 10, 3, 18); g.fillRect(px + 23, py + 10, 3, 18);
      g.fillStyle = "#a8794a"; g.fillRect(px + 2, py + 2, 28, 16);
      g.fillStyle = "#fffbe8"; g.fillRect(px + 5, py + 5, 8, 6); g.fillRect(px + 16, py + 4, 10, 8); g.fillStyle = "#ffd6e0"; g.fillRect(px + 8, py + 12, 9, 4);
    }
  }
  for (const l of town.lamps) {
    const px = l.x * T, py = l.y * T;
    g.fillStyle = "rgba(0,0,0,0.2)"; g.beginPath(); g.ellipse(px + 17, py + 28, 6, 2.5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#3b3f4a"; g.fillRect(px + 15, py + 6, 3, 22); g.fillRect(px + 12, py + 26, 9, 3);
    g.fillStyle = "#2c2f38"; g.fillRect(px + 11, py + 1, 11, 3);
    g.fillStyle = "#ffe9a8"; g.fillRect(px + 12, py + 4, 9, 6);
  }

  // Buildings
  for (const b of town.buildings) drawBuilding(g, b, town);
  return { ground, canopy };
}

function drawBuilding(g, b, town) {
  const x = b.x * T, y = b.y * T, w = b.w * T, h = b.h * T;
  const wallH = Math.min(T * 2, Math.round(h * 0.5));
  const roofH = h - wallH;
  const wy = y + roofH;
  g.fillStyle = "rgba(0,0,0,0.2)"; g.fillRect(x + 6, y + 6, w, h);
  // walls
  g.fillStyle = b.wall; g.fillRect(x, wy, w, wallH);
  g.fillStyle = "rgba(0,0,0,0.06)";
  for (let k = 6; k < wallH; k += 8) g.fillRect(x, wy + k, w, 1);
  g.fillStyle = shade(b.wall, -60); g.fillRect(x, y + h - 5, w, 5);
  if (b.kind === "townhall") { g.fillStyle = "#dcd4c4"; for (let k = x + 10; k < x + w - 6; k += 32) g.fillRect(k, wy + 2, 6, wallH - 7); }
  // door
  const dx = b.door.x * T;
  g.fillStyle = "#5a3820"; g.fillRect(dx + 7, y + h - 26, 18, 26);
  g.fillStyle = b.kind === "cafe" ? "#c4683c" : "#7b4a28"; g.fillRect(dx + 9, y + h - 24, 14, 24);
  g.fillStyle = "#f7d26b"; g.fillRect(dx + 19, y + h - 13, 2, 2);
  // windows
  for (let col = b.x; col < b.x + b.w; col++) {
    if (col === b.door.x) continue;
    const wantWindow = b.kind === "house" ? col === b.x + 1 || col === b.x + 3 : (col - b.x) % 2 === 1 && Math.abs(col - b.door.x) > 1;
    if (!wantWindow) continue;
    const wx = col * T + 8, wyy = wy + Math.round(wallH * 0.22), ww = 16, wh = Math.round(wallH * 0.42);
    g.fillStyle = "#4a3a2c"; g.fillRect(wx - 2, wyy - 2, ww + 4, wh + 4);
    g.fillStyle = "#a7d8f2"; g.fillRect(wx, wyy, ww, wh);
    g.fillStyle = "rgba(255,255,255,0.55)"; g.fillRect(wx + 2, wyy + 2, 4, wh - 4);
    g.fillStyle = "#4a3a2c"; g.fillRect(wx + ww / 2 - 1, wyy, 2, wh); g.fillRect(wx, wyy + wh / 2 - 1, ww, 2);
    if (b.kind !== "workshop" && b.kind !== "jail") { g.fillStyle = "#e86a8a"; g.fillRect(wx - 1, wyy + wh + 2, ww + 2, 3); g.fillStyle = "#5fae3f"; g.fillRect(wx, wyy + wh + 1, ww, 1); }
    town.windows.push({ x: wx + ww / 2, y: wyy + wh / 2, w: ww, h: wh });
  }
  // roof
  g.fillStyle = shade(b.roof, -40); g.fillRect(x - 4, y - 4, w + 8, roofH + 8);
  g.fillStyle = b.roof; g.fillRect(x - 4, y - 4, w + 8, roofH + 3);
  g.fillStyle = shade(b.roof, -22);
  for (let r = y + 2; r < y + roofH; r += 7) {
    g.fillRect(x - 4, r, w + 8, 1);
    for (let k = x + ((r - y) % 14 ? 0 : 7); k < x + w + 4; k += 14) g.fillRect(k, r, 1, 7);
  }
  g.fillStyle = shade(b.roof, 30); g.fillRect(x - 4, y - 4, w + 8, 4);
  g.fillStyle = "rgba(0,0,0,0.22)"; g.fillRect(x, wy + 4, w, 4);
  if (b.kind === "house" || b.kind === "workshop") {
    const cx = x + w - 20, cy = y - 10;
    g.fillStyle = "#8a5040"; g.fillRect(cx, cy, 10, 16);
    g.fillStyle = "#6a3a30"; g.fillRect(cx - 1, cy, 12, 3);
    town.chimneys.push({ x: cx + 5, y: cy - 2 });
  }
  if (b.kind === "townhall") {
    const cx = x + w / 2;
    g.fillStyle = "#efe9dc"; g.fillRect(cx - 14, y - 22, 28, 22);
    g.fillStyle = "#5d6e82"; g.beginPath(); g.moveTo(cx - 18, y - 20); g.lineTo(cx, y - 38); g.lineTo(cx + 18, y - 20); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(cx, y - 10, 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#333"; g.lineWidth = 1.5; g.beginPath(); g.arc(cx, y - 10, 8, 0, Math.PI * 2); g.moveTo(cx, y - 10); g.lineTo(cx, y - 16); g.moveTo(cx, y - 10); g.lineTo(cx + 4, y - 9); g.stroke();
  }
  if (b.kind === "courthouse") {
    g.fillStyle = "#e4dfd4"; for (let k = x + 8; k < x + w - 4; k += 26) { g.fillRect(k, wy + 2, 8, wallH - 7); g.fillStyle = "#cfc8ba"; g.fillRect(k, wy + 2, 8, 3); g.fillStyle = "#e4dfd4"; }
    g.fillStyle = "#8a7f72"; g.beginPath(); g.moveTo(x - 6, y + 4); g.lineTo(x + w / 2, y - 22); g.lineTo(x + w + 6, y + 4); g.fill();
    g.fillStyle = "#f6d365"; g.font = "16px serif"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("⚖", x + w / 2, y - 6);
  }
  if (b.kind === "jail") {
    for (const win of town.windows.filter((wi) => wi.x > x && wi.x < x + w && wi.y > wy && wi.y < y + h)) {
      g.fillStyle = "#2b2b30"; for (let k = -6; k <= 6; k += 4) g.fillRect(win.x + k, win.y - win.h / 2, 2, win.h);
    }
    g.fillStyle = "rgba(0,0,0,0.12)"; for (let k = x; k < x + w; k += 12) for (let r = wy; r < y + h - 5; r += 8) g.fillRect(k + ((r / 8) % 2) * 6, r, 11, 1);
  }
  if (b.kind === "cafe") {
    // striped awning
    for (let k = 0; k < w + 8; k += 12) { g.fillStyle = (k / 12) % 2 ? "#ffffff" : "#e05a47"; g.fillRect(x - 4 + k, wy - 2, 12, 12); }
    g.fillStyle = "rgba(0,0,0,0.15)"; g.fillRect(x - 4, wy + 10, w + 8, 3);
  }
  if (b.label) {
    g.font = "bold 11px Nunito, system-ui, sans-serif";
    const tw = g.measureText(b.label).width + 14;
    const sx = x + w / 2 - tw / 2, sy = y + roofH / 2 - 9;
    g.fillStyle = "#4a3222"; g.fillRect(sx - 2, sy - 2, tw + 4, 22);
    g.fillStyle = "#f6e7c8"; g.fillRect(sx, sy, tw, 18);
    g.fillStyle = "#4a3222"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(b.label, x + w / 2, sy + 9.5);
  }
}

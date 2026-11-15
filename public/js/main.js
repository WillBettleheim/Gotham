import { T, W, H, buildTown, renderStatic, riverX } from "./map.js";
import { drawCharacter, roundRect } from "./sprites.js";
import { MODELS, COMMUNITIES } from "./residents.js";
import { Sim, fmtTime, periodOf } from "./sim.js";
import { createUI } from "./ui.js";

const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");
const light = document.createElement("canvas");
const lctx = light.getContext("2d");

const town = buildTown();
const layers = await renderStatic(town);
const $ = (id) => document.getElementById(id);

const ui = createUI();
const sim = new Sim(town, ui);
window.gotham = sim; // handy for poking at the town from the console
ui.attach(sim);
ui.renderLegend();

fetch("/api/status").then((r) => r.json()).then((s) => {
  sim.live = s.live;
  sim.liveModels = s.liveModels ?? {};
  const n = Object.values(sim.liveModels).filter(Boolean).length, total = Object.keys(MODELS).length;
  $("mode").textContent = s.live ? `Live · ${n}/${total} models` : "Offline chatter";
  $("mode").className = `badge ${s.live ? "live" : "off"}`;
  $("mode").title = s.live ? "Residents with a bright dot think and talk through their real model" : "No API keys on the server; residents use built-in lines";
  ui.renderLegend();
}).catch(() => { $("mode").textContent = "Offline chatter"; $("mode").className = "badge off"; })
  .finally(() => sim.start());

$("resetBtn").onclick = () => { if (confirm("Start Gotham over? All memories, money, laws and elections will be wiped.")) sim.reset(); };

// fireworks when a mayor is elected
const sparks = [];
sim.society.on((type) => {
  if (type !== "elected") return;
  for (let k = 0; k < 6; k++) setTimeout(() => burst(town.fountain.x + (Math.random() - 0.5) * 300, town.fountain.y - 90 - Math.random() * 120), k * 450);
});
function burst(x, y) {
  const hue = Math.floor(Math.random() * 360);
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 90;
    sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, hue: hue + Math.random() * 40 });
  }
}

// ---------- controls ----------
$("pause").onclick = () => { sim.paused = !sim.paused; $("pause").textContent = sim.paused ? "▶" : "⏸"; };
document.querySelectorAll("[data-speed]").forEach((b) => b.onclick = () => {
  sim.speed = Number(b.dataset.speed);
  document.querySelectorAll("[data-speed]").forEach((x) => x.classList.toggle("on", x === b));
});
addEventListener("keydown", (e) => { if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); $("pause").click(); } });

// ---------- camera ----------
const cam = { x: 0, y: 0, zoom: 1.4 };
let vw = 0, vh = 0, dpr = 1;
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1);
  vw = canvas.clientWidth; vh = canvas.clientHeight;
  canvas.width = light.width = Math.round(vw * dpr);
  canvas.height = light.height = Math.round(vh * dpr);
  clampCam();
}
function clampCam() {
  const minZoom = Math.max(vw / (W * T), vh / (H * T));
  cam.zoom = Math.max(minZoom, Math.min(3, cam.zoom));
  cam.x = Math.max(0, Math.min(W * T - vw / cam.zoom, cam.x));
  cam.y = Math.max(0, Math.min(H * T - vh / cam.zoom, cam.y));
}
addEventListener("resize", resize);
resize();
cam.x = town.fountain.x - vw / cam.zoom / 2; cam.y = town.fountain.y - vh / cam.zoom / 2; clampCam();

let drag = null;
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.moved > 4) { if (ui.follow) { ui.follow = false; ui.refreshCard(); } canvas.classList.add("dragging"); cam.x = drag.cx - dx / cam.zoom; cam.y = drag.cy - dy / cam.zoom; clampCam(); }
});
canvas.addEventListener("pointerup", (e) => {
  canvas.classList.remove("dragging");
  if (drag && drag.moved <= 4) {
    const r = canvas.getBoundingClientRect();
    const wx = cam.x + (e.clientX - r.left) / cam.zoom, wy = cam.y + (e.clientY - r.top) / cam.zoom;
    let best = null, bd = 22;
    for (const a of sim.agents) {
      if (!a.visible) continue;
      const d = Math.hypot((a.x + 0.5) * T - wx, (a.y + 0.5) * T - wy);
      if (d < bd) { bd = d; best = a; }
    }
    ui.select(best);
  }
  drag = null;
});
// ---------- minimap ----------
const mini = $("mini"), mctx = mini.getContext("2d");
mini.width = 264; mini.height = 352;
const miniScale = mini.width / (W * T);
const miniBase = document.createElement("canvas");
miniBase.width = mini.width; miniBase.height = mini.height;
miniBase.getContext("2d").drawImage(layers.ground, 0, 0, mini.width, mini.height);
let miniLast = 0;
function drawMinimap(now) {
  if (now - miniLast < 200) return;
  miniLast = now;
  mctx.drawImage(miniBase, 0, 0);
  mctx.fillStyle = `rgba(14,18,52,${darkness(sim.time) * 0.8})`; mctx.fillRect(0, 0, mini.width, mini.height);
  for (const a of sim.agents) {
    if (!a.visible) continue;
    const x = (a.x + 0.5) * T * miniScale, y = (a.y + 0.5) * T * miniScale;
    mctx.fillStyle = "#0b0918"; mctx.beginPath(); mctx.arc(x, y, 5, 0, Math.PI * 2); mctx.fill();
    mctx.fillStyle = MODELS[a.res.model].color; mctx.beginPath(); mctx.arc(x, y, 3.6, 0, Math.PI * 2); mctx.fill();
    if (a === ui.selected) { mctx.strokeStyle = "#f2b843"; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(x, y, 7.5, 0, Math.PI * 2); mctx.stroke(); }
  }
  mctx.strokeStyle = "rgba(255,240,200,0.95)"; mctx.lineWidth = 2;
  mctx.strokeRect(cam.x * miniScale, cam.y * miniScale, (vw / cam.zoom) * miniScale, (vh / cam.zoom) * miniScale);
}
mini.addEventListener("click", (e) => {
  const r = mini.getBoundingClientRect();
  const wx = ((e.clientX - r.left) / r.width) * W * T, wy = ((e.clientY - r.top) / r.height) * H * T;
  ui.follow = false;
  cam.x = wx - vw / cam.zoom / 2; cam.y = wy - vh / cam.zoom / 2; clampCam();
});

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  const wx = cam.x + mx / cam.zoom, wy = cam.y + my / cam.zoom;
  cam.zoom *= Math.exp(-e.deltaY * 0.0015);
  clampCam();
  cam.x = wx - mx / cam.zoom; cam.y = wy - my / cam.zoom;
  clampCam();
}, { passive: false });
setTimeout(() => ($("hint").style.opacity = 0), 9000);

// ---------- ambient life ----------
const ducks = [0, 1, 2].map((i) => ({ t: i * 2.1, speed: 0.08 + i * 0.03, r: 0.6 + i * 0.12 }));
const smoke = [];
const fireflies = Array.from({ length: 34 }, (_, i) => i % 2 ? { x: (19 + Math.random() * 10) * T, y: (13 + Math.random() * 6) * T, p: Math.random() * 10 } : { x: (1 + Math.random() * 7) * T, y: (5 + Math.random() * 24) * T, p: Math.random() * 10 });

function darkness(min) {
  const h = (min % 1440) / 60;
  if (h >= 7 && h < 17.5) return 0;
  if (h >= 17.5 && h < 20.5) return ((h - 17.5) / 3) * 0.62;
  if (h >= 20.5 || h < 4.5) return 0.62;
  return 0.62 * (1 - (h - 4.5) / 2.5);
}
function sunset(min) {
  const h = (min % 1440) / 60;
  return Math.max(0, 1 - Math.abs(h - 18.3) / 1.6) * 0.18 + Math.max(0, 1 - Math.abs(h - 6) / 1.2) * 0.1;
}

// ---------- render ----------
let last = performance.now();
// The simulation runs on its own timer so the clock stays correct even when drawing is throttled.
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  sim.update(Math.min(1, (now - lastTick) / 1000));
  lastTick = now;
}, 50);

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const t = now / 1000;

  const selected = ui.selected;
  if (ui.follow && selected) {
    const tx = (selected.x + 0.5) * T - vw / cam.zoom / 2, ty = (selected.y + 0.5) * T - vh / cam.zoom / 2;
    cam.x += (tx - cam.x) * Math.min(1, dt * 4); cam.y += (ty - cam.y) * Math.min(1, dt * 4); clampCam();
  }

  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layers.ground, 0, 0);
  drawWaterLife(t);
  drawWaterfall(t);
  drawFountain(t);
  if (sim.society.election.phase !== "idle") drawBunting(t);
  if (sim.society.life.event?.active && !sim.society.life.event.place) drawEventLights(t, sim.society.life.event);

  const visible = sim.agents.filter((a) => a.visible).sort((a, b) => a.y - b.y);
  for (const a of sim.agents) a.isMayor = sim.society.mayor === a.id;
  for (const a of visible) {
    if (a === selected) {
      ctx.strokeStyle = "rgba(255,207,110,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse((a.x + 0.5) * T, (a.y + 0.5) * T + 10, 13, 5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawCharacter(ctx, a, t);
    drawOccluders(a);
  }
  drawSmoke(dt, t);
  drawClouds(t);

  const dark = darkness(sim.time);
  drawLighting(dark, sunset(sim.time), t);
  if (dark > 0.3) drawFireflies(t, dark);
  drawSparks(dt);

  // screen-space UI
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const a of visible) drawTag(a);
  drawBubbles(visible.filter((a) => a.bubble && (!a.bubble.until || a.bubble.until > sim.realTime - 0.4)), t);

  const ft = fmtTime(sim.time);
  $("clock").textContent = ft.text;
  $("day").textContent = `Day ${ft.day} · ${periodOf(ft.hh)}`;
  const dayFrac = (sim.time % 1440) / 1440;
  $("dayBar").style.width = `${dayFrac * 100}%`;
  const sky = $("skyIcon"), hh = ft.hh;
  const skyState = hh >= 21 || hh < 5 ? "night" : (hh >= 18 || hh < 7) ? "dusk" : "day";
  if (sky.dataset.s !== skyState) { sky.dataset.s = skyState; sky.className = `sky ${skyState === "day" ? "" : skyState}`; sky.textContent = skyState === "night" ? "🌙" : skyState === "dusk" ? "🌇" : "☀️"; }
  drawMinimap(now);
  requestAnimationFrame(frame);
}

function drawBunting(t) {
  const cols = Object.values(COMMUNITIES).map((c) => c.color);
  const P = town.plaza;
  for (const [y0, x0, x1] of [[P.y, P.x, P.x + P.w], [P.y + P.h, P.x, P.x + P.w]]) {
    const y = y0 * T - 4, sag = 14;
    ctx.strokeStyle = "rgba(60,40,30,0.7)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0 * T; x <= x1 * T; x += 8) { const k = (x - x0 * T) / ((x1 - x0) * T); const yy = y + Math.sin(k * Math.PI) * sag; x === x0 * T ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
    ctx.stroke();
    let i = 0;
    for (let x = x0 * T + 10; x < x1 * T; x += 18, i++) {
      const k = (x - x0 * T) / ((x1 - x0) * T), yy = y + Math.sin(k * Math.PI) * sag, sway = Math.sin(t * 3 + i) * 1.5;
      ctx.fillStyle = cols[i % cols.length];
      ctx.beginPath(); ctx.moveTo(x - 5, yy); ctx.lineTo(x + 5, yy); ctx.lineTo(x + sway, yy + 11); ctx.fill();
    }
  }
}

const clouds = Array.from({ length: 5 }, (_, i) => ({ x: Math.random() * W * T, y: (4 + i * 7) * T, s: 0.7 + Math.random() * 0.8, v: 6 + Math.random() * 6 }));
function drawClouds(t) {
  for (const c of clouds) {
    const x = ((c.x + t * c.v) % (W * T + 400)) - 200;
    ctx.fillStyle = "rgba(20,30,40,0.07)";
    for (const [dx, dy, r] of [[0, 0, 60], [55, 10, 45], [-50, 12, 40], [20, -20, 42]]) {
      ctx.beginPath(); ctx.ellipse(x + dx * c.s, c.y + dy * c.s, r * c.s * 1.4, r * c.s * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
}

function drawSparks(dt) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const p = sparks[i];
    p.life -= dt * 0.6; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 40 * dt; p.vx *= 0.99;
    if (p.life <= 0) { sparks.splice(i, 1); continue; }
    ctx.fillStyle = `hsla(${p.hue}, 95%, 65%, ${p.life})`;
    ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
  }
}

// string lights over the Community Garden lawn during events (and music notes on Music Night)
const EVENT_BULBS = [];
for (let row = 0; row < 3; row++) for (let i = 0; i <= 10; i++) {
  const x = 738 + i * 15, y = 1660 + row * 70 + Math.sin((i / 10) * Math.PI) * 12;
  EVENT_BULBS.push([x, y]);
}
function drawEventLights(t, ev) {
  ctx.strokeStyle = "rgba(40,30,20,0.6)"; ctx.lineWidth = 1;
  for (let row = 0; row < 3; row++) {
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) { const [x, y] = EVENT_BULBS[row * 11 + i]; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.stroke();
  }
  const cols = ["#ffd36e", "#ff8fab", "#8fd3ff", "#b4f08a"];
  EVENT_BULBS.forEach(([x, y], i) => {
    const on = 0.65 + Math.sin(t * 3 + i) * 0.35;
    ctx.fillStyle = cols[i % 4]; ctx.globalAlpha = on; ctx.beginPath(); ctx.arc(x, y + 2, 2.4, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
  });
  if (ev.id === "music") {
    for (let i = 0; i < 6; i++) {
      const p = (t * 0.35 + i / 6) % 1;
      ctx.fillStyle = `rgba(40,30,60,${1 - p})`; ctx.font = "14px serif";
      ctx.fillText(i % 2 ? "♪" : "♫", 790 + Math.sin(t + i * 2) * 40 + i * 8, 1620 - p * 50);
    }
  }
}

// Redraw the parts of the picture that stand in front of a resident (trees, roofs, walls, posts),
// so people walking behind them are hidden like they would be in real life.
const OW = 72, OH = 64;
const occBuf = document.createElement("canvas"); occBuf.width = OW; occBuf.height = OH;
const occCtx = occBuf.getContext("2d");
const occImg = occCtx.createImageData(OW, OH);
function drawOccluders(a) {
  const o = town.occlusion;
  if (!o) return;
  const feet = Math.round((a.y + 0.5) * T + 12);
  const x0 = Math.round((a.x + 0.5) * T) - OW / 2, y0 = feet - OH + 4;
  const d = occImg.data;
  let any = false;
  for (let y = 0; y < OH; y++) {
    const wy = y0 + y;
    for (let x = 0; x < OW; x++) {
      const wx = x0 + x, i = (y * OW + x) * 4;
      if (wx < 0 || wy < 0 || wx >= o.w || wy >= o.h) { d[i + 3] = 0; continue; }
      const p = wy * o.w + wx, b = o.base[p];
      if (b && b > feet + 2) { const j = p * 4; d[i] = o.rgba[j]; d[i + 1] = o.rgba[j + 1]; d[i + 2] = o.rgba[j + 2]; d[i + 3] = 255; any = true; }
      else d[i + 3] = 0;
    }
  }
  a.hiddenBehind = false;
  if (!any) return;
  let covered = 0;
  for (let y = OH - 44; y < OH - 4; y++) for (let x = OW / 2 - 7; x < OW / 2 + 7; x++) if (d[(y * OW + x) * 4 + 3]) covered++;
  a.hiddenBehind = covered > 220;
  occCtx.putImageData(occImg, 0, 0);
  ctx.drawImage(occBuf, x0, y0);
}

function drawFountain(t) {
  // the picture has the fountain; add moving water on top of it
  const { x: cx, y: cy } = town.fountain;
  for (let i = 0; i < 3; i++) {
    const r = ((t * 0.6 + i / 3) % 1);
    ctx.strokeStyle = `rgba(255,255,255,${0.45 * (1 - r)})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy + 6, 12 + r * 28, 5 + r * 11, 0, 0, Math.PI * 2); ctx.stroke();
  }
  for (let i = 0; i < 16; i++) {
    const p = ((t * 0.9 + i / 16) % 1), ang = (i / 16) * Math.PI * 2;
    const x = cx + Math.cos(ang) * p * 14, y = cy - 30 - Math.sin(p * Math.PI) * 9 + p * 18 + Math.sin(ang) * p * 5;
    ctx.fillStyle = `rgba(220,245,255,${0.85 - p * 0.6})`; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
}

// ducks paddle up and down the river
const riverDucks = [0, 1, 2, 3].map((i) => ({ y: 8 + i * 7, v: (i % 2 ? 1 : -1) * (0.25 + i * 0.05), wob: i * 1.7 }));
function drawWaterLife(t) {
  for (const d of riverDucks) {
    let y = d.y + d.v * t;
    const span = 32 - 7;
    y = 7 + (((y - 7) % span) + span) % span;
    const x = riverX(y) * T + Math.sin(t * 0.8 + d.wob) * 6, py = y * T;
    if (y > 12.6 && y < 16.2) continue; // under the bridge
    const dir = d.v > 0 ? 1 : -1;
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.ellipse(x, py + 4, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fafafa"; ctx.beginPath(); ctx.ellipse(x, py, 5, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x, py + dir * 6, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f2a33a"; ctx.fillRect(x - 1, py + dir * 9 - (dir < 0 ? 2 : 0), 2, 3);
  }
  for (let i = 0; i < 26; i++) {
    const s = (t * 0.5 + i * 0.37) % 1;
    const y = 5 + ((i * 7.3) % 33);
    const x = (riverX(y) + Math.sin(i * 2.3) * 0.8) * T;
    ctx.fillStyle = `rgba(255,255,255,${Math.sin(s * Math.PI) * 0.6})`; ctx.fillRect(x, y * T + s * 20, 5, 1.5);
  }
}

function drawWaterfall(t) {
  const w = town.waterfall;
  for (let i = 0; i < 8; i++) {
    const x = w.x + 4 + i * ((w.w - 8) / 7);
    const off = ((t * 110 + i * 37) % 46);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let y = w.y - 46 + off; y < w.y + w.h - 12; y += 46) ctx.fillRect(x, Math.max(w.y, y), 2, 16);
  }
  for (let i = 0; i < 9; i++) { // foam at the bottom
    const a = t * 2 + i;
    ctx.fillStyle = `rgba(255,255,255,${0.4 + Math.sin(a) * 0.2})`;
    ctx.beginPath(); ctx.arc(w.x + 2 + (i * 7.3) % w.w, w.y + w.h - 4 + Math.sin(a * 1.3) * 3, 4 + Math.sin(a) * 2, 0, Math.PI * 2); ctx.fill();
  }
}

function drawSmoke(dt, t) {
  const h = (sim.time % 1440) / 60;
  if ((h > 6 && h < 10) || (h > 17 && h < 23)) {
    for (const c of town.chimneys) if (Math.random() < dt * 1.2) smoke.push({ x: c.x, y: c.y, life: 0 });
  }
  for (let i = smoke.length - 1; i >= 0; i--) {
    const s = smoke[i];
    s.life += dt * 0.35; s.y -= dt * 14; s.x += Math.sin(t + s.life * 4) * dt * 6;
    if (s.life >= 1) { smoke.splice(i, 1); continue; }
    ctx.fillStyle = `rgba(235,235,240,${0.5 * (1 - s.life)})`;
    ctx.beginPath(); ctx.arc(s.x, s.y, 3 + s.life * 7, 0, Math.PI * 2); ctx.fill();
  }
}

function drawLighting(dark, warm, t) {
  if (warm > 0.01) {
    ctx.fillStyle = `rgba(255,140,60,${warm})`;
    ctx.fillRect(cam.x, cam.y, vw / cam.zoom, vh / cam.zoom);
  }
  if (dark < 0.01) return;
  lctx.setTransform(1, 0, 0, 1, 0, 0);
  lctx.globalCompositeOperation = "source-over";
  lctx.clearRect(0, 0, light.width, light.height);
  lctx.fillStyle = `rgba(14,18,52,${dark})`;
  lctx.fillRect(0, 0, light.width, light.height);
  lctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
  lctx.globalCompositeOperation = "destination-out";
  const hole = (x, y, r, s) => {
    const g = lctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(0,0,0,${s})`); g.addColorStop(1, "rgba(0,0,0,0)");
    lctx.fillStyle = g; lctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const w of town.windows) hole(w.x, w.y + 6, 34 + 26 * (w.size ?? 1), 0.85);
  if (sim.society.life.event?.active && !sim.society.life.event.place) for (const [x, y] of EVENT_BULBS) hole(x, y, 30, 0.7);
  if (town.forge) hole(town.forge.x, town.forge.y + 10, 60, 0.9);
  for (const a of sim.agents) if (a.visible) hole((a.x + 0.5) * T, (a.y + 0.5) * T, 34, 0.35);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(light, 0, 0);
  ctx.restore();
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const glow = (x, y, r, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,190,110,${a})`); g.addColorStop(1, "rgba(255,190,110,0)");
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  for (const w of town.windows) glow(w.x, w.y, 14 + 10 * (w.size ?? 1), dark * 0.6 * (0.94 + Math.sin(t * 3 + w.x) * 0.06));
  ctx.restore();
}

function drawFireflies(t, dark) {
  for (const f of fireflies) {
    const x = f.x + Math.sin(t * 0.7 + f.p) * 20, y = f.y + Math.cos(t * 0.5 + f.p * 2) * 14;
    const a = Math.max(0, Math.sin(t * 2 + f.p * 3)) * dark;
    ctx.fillStyle = `rgba(230,255,140,${a})`; ctx.fillRect(x, y, 2.5, 2.5);
  }
}

const toScreen = (a) => ({ x: ((a.x + 0.5) * T - cam.x) * cam.zoom, y: ((a.y + 0.5) * T - cam.y) * cam.zoom });

function drawTag(a) {
  const s = toScreen(a);
  if (s.x < -60 || s.y < -60 || s.x > vw + 60 || s.y > vh + 60) return;
  const m = MODELS[a.res.model];
  const y = s.y - 30 * cam.zoom - 14;
  ctx.font = "800 11px Nunito, system-ui, sans-serif";
  const soc = sim.society;
  const icons = (soc.mayor === a.id ? "👑" : "") + (a.candidate ? "📣" : "") + (a.escort ? "🚔" : "") + (a.state === "jailed" ? "⛓️" : "") + (a.working ? "🔨" : "") + (a.hunger > 75 ? "🍞" : "");
  const label = a.res.name + (icons ? " " + icons : ""), w = ctx.measureText(label).width + 20;
  ctx.save();
  if (a.hiddenBehind) ctx.globalAlpha = 0.55;
  ctx.fillStyle = "rgba(25,22,32,0.78)";
  roundRect(ctx, s.x - w / 2, y - 8, w, 16, 8); ctx.fill();
  ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(s.x - w / 2 + 8, y, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(label, s.x - w / 2 + 14, y + 0.5);
  ctx.restore();
}

// Speech bubbles: a card with the speaker's name and model, fade-in, typing dots, and no overlaps.
function drawBubbles(list, t) {
  const now = sim.realTime;
  const boxes = list.map((a) => {
    const s = toScreen(a), b = a.bubble, m = MODELS[a.res.model];
    ctx.font = "600 13px Nunito, system-ui, sans-serif";
    if (b.thought) ctx.font = "italic 600 12.5px Nunito, system-ui, sans-serif";
    const lines = b.typing ? [] : wrap(b.text, 230);
    const textW = b.typing ? 34 : Math.max(...lines.map((l) => ctx.measureText(l).width));
    ctx.font = "800 11px Nunito, system-ui, sans-serif";
    const head = b.thought ? `💭 ${a.res.name} thinks` : `${a.res.name} · ${m.short}${b.speech ? " · 📣 speech" : ""}`;
    const headW = ctx.measureText(head).width + 14;
    const w = Math.max(textW + 22, headW + 12, 70), h = (b.typing ? 20 : lines.length * 17 + 6) + 26;
    const anchorY = s.y - 30 * cam.zoom - 20;
    return { a, s, b, m, lines, head, w, h, x: Math.max(6, Math.min(vw - w - 6, s.x - w / 2)), y: anchorY - h, anchorY };
  }).sort((p, q) => q.anchorY - p.anchorY);
  // push bubbles up until they stop overlapping the ones already placed
  const placed = [];
  for (const bx of boxes) {
    for (let guard = 0; guard < 20; guard++) {
      const hit = placed.find((o) => bx.x < o.x + o.w + 4 && bx.x + bx.w + 4 > o.x && bx.y < o.y + o.h + 6 && bx.y + bx.h + 6 > o.y);
      if (!hit) break;
      bx.y = hit.y - bx.h - 8;
    }
    placed.push(bx);
  }
  for (const bx of placed) {
    const { s, b, m, lines, head, w, h, x, y } = bx;
    const age = now - (b.born ?? now);
    const fadeOut = b.until ? Math.min(1, Math.max(0, (b.until - now + 0.4) / 0.4)) : 1;
    const alpha = Math.min(1, age / 0.18) * fadeOut;
    const pop = 0.9 + 0.1 * Math.min(1, age / 0.18);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(s.x, y + h); ctx.scale(pop, pop); ctx.translate(-s.x, -(y + h));
    // tail (a line to the speaker when the bubble was pushed up)
    ctx.strokeStyle = "rgba(255,253,247,0.9)"; ctx.lineWidth = 2;
    if (bx.anchorY - (y + h) > 4) { ctx.beginPath(); ctx.moveTo(s.x, y + h); ctx.lineTo(s.x, bx.anchorY + 6); ctx.stroke(); }
    ctx.fillStyle = "rgba(20,14,30,0.28)"; roundRect(ctx, x + 2, y + 4, w, h, 12); ctx.fill();
    const paper = b.thought ? "#f1ecff" : "#fffdf7";
    ctx.fillStyle = paper; roundRect(ctx, x, y, w, h, 12); ctx.fill();
    ctx.strokeStyle = m.color; ctx.lineWidth = 2; roundRect(ctx, x + 1, y + 1, w - 2, h - 2, 11); ctx.stroke();
    ctx.fillStyle = paper;
    ctx.beginPath(); ctx.moveTo(s.x - 7, y + h - 2); ctx.lineTo(s.x, y + h + 8); ctx.lineTo(s.x + 7, y + h - 2); ctx.fill();
    ctx.strokeStyle = m.color; ctx.beginPath(); ctx.moveTo(s.x - 7, y + h - 1); ctx.lineTo(s.x, y + h + 8); ctx.lineTo(s.x + 7, y + h - 1); ctx.stroke();
    // name tag
    ctx.font = "800 11px Nunito, system-ui, sans-serif";
    const tw = ctx.measureText(head).width + 14;
    ctx.fillStyle = m.color; roundRect(ctx, x + 8, y + 6, tw, 16, 8); ctx.fill();
    ctx.fillStyle = "#1d1a26"; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(head, x + 15, y + 14.5);
    if (b.typing) {
      for (let i = 0; i < 3; i++) {
        const bounce = Math.max(0, Math.sin(t * 7 - i * 0.8)) * 4;
        ctx.fillStyle = "#8a7f99"; ctx.beginPath(); ctx.arc(x + 20 + i * 11, y + 36 - bounce, 3.2, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      ctx.font = b.thought ? "italic 600 12.5px Nunito, system-ui, sans-serif" : "600 13px Nunito, system-ui, sans-serif";
      ctx.fillStyle = b.thought ? "#4b3f74" : "#2a2230"; ctx.textBaseline = "top";
      lines.forEach((l, i) => ctx.fillText(l, x + 11, y + 28 + i * 17));
    }
    ctx.restore();
  }
}

function wrap(text, max) {
  const words = text.split(/\s+/), out = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > max && line) { out.push(line); line = w; } else line = test;
  }
  if (line) out.push(line);
  return out.slice(0, 6);
}

requestAnimationFrame(frame);

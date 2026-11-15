import { T, W, H, buildTown, renderStatic, riverX, refreshDerived } from "./map.js";
import { drawCharacter, roundRect } from "./sprites.js";
import { MODELS, COMMUNITIES } from "./residents.js";
import { Sim, fmtTime, periodOf } from "./sim.js";
import { createUI } from "./ui.js";
import { Sound } from "./sound.js";
import { FLOOD_ZONE, BUILDINGS, LOTS } from "./mapdata.js";
import { PROJECTS } from "./construction.js";

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

$("fullBtn").onclick = () => { document.body.classList.toggle("mapfull"); setTimeout(resize, 30); };
$("resetBtn").onclick = () => { if (confirm("Start Gotham over? All memories, money, laws and elections will be wiped.")) sim.reset(); };

// fireworks when a mayor is elected
const sparks = [];
// ---------- sound ----------
const sound = new Sound();
const muteBtn = $("muteBtn");
const syncMute = () => { muteBtn.textContent = sound.muted ? "🔇" : "🔊"; muteBtn.title = sound.muted ? "Sound off (click to turn on)" : "Sound on"; };
muteBtn.onclick = () => { sound.start(); sound.setMuted(!sound.muted); syncMute(); };
syncMute();
sim.society.on((type, data) => {
  if (type === "gazette" && data.important) sound.play(data.entry.kind === "election" ? "bell" : data.entry.icon === "🏆" || data.entry.icon === "🏅" ? "cheer" : "chime");
  if (type === "gazette" && /caught a/.test(data.entry.text)) sound.play("pop");
});
sim.society.disasters.on((type, d) => {
  if (type === "start") sound.play(d.type === "earthquake" ? "rumble" : "alarm");
  if (type === "end") sound.play("cheer");
});
let soundTick = 0, lastFlash = 0;

// ---------- skip the night ----------
let skipping = null;
$("skipNight").onclick = () => {
  if (skipping) return;
  skipping = { speed: sim.speed };
  sim.speed = 60;
  $("skipNight").textContent = "⏩"; $("skipNight").title = "Skipping to morning…";
};
setInterval(() => {
  const h = sim.hour, night = h >= 21 || h < 6;
  $("skipNight").hidden = !night && !skipping;
  if (skipping && !night) {
    sim.speed = skipping.speed; skipping = null;
    $("skipNight").textContent = "⏭"; $("skipNight").title = "Skip to morning";
    sim.society.log("🌅", "Good morning, Gotham!", "town");
  }
}, 250);

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

// ---------- touch & mouse: drag to pan, pinch or scroll to zoom, double-tap to zoom in/out ----------
const pointers = new Map();
let drag = null, pinch = null, lastTap = null, zoomAnim = null;
const minZoomNow = () => Math.max(vw / (W * T), vh / (H * T));
function zoomTo(target, mx, my, ms = 320) {
  ui.follow = false;
  zoomAnim = { from: cam.zoom, to: Math.max(minZoomNow(), Math.min(3, target)), wx: cam.x + mx / cam.zoom, wy: cam.y + my / cam.zoom, mx, my, t0: performance.now(), ms };
}
function stepZoomAnim(now) {
  if (!zoomAnim) return;
  const z = zoomAnim, p = Math.min(1, (now - z.t0) / z.ms), e = 1 - Math.pow(1 - p, 3);
  cam.zoom = z.from + (z.to - z.from) * e;
  cam.x = z.wx - z.mx / cam.zoom; cam.y = z.wy - z.my / cam.zoom;
  clampCam();
  if (p >= 1) zoomAnim = null;
}
const local = (e) => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
canvas.addEventListener("pointerdown", (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, local(e));
  if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: 0 };
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, zoom: cam.zoom, wx: cam.x + mid.x / cam.zoom, wy: cam.y + mid.y / cam.zoom };
    drag = null; zoomAnim = null; ui.follow = false;
  }
});
canvas.addEventListener("pointermove", (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, local(e));
  if (pinch && pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    cam.zoom = pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
    clampCam();
    cam.x = pinch.wx - mid.x / cam.zoom; cam.y = pinch.wy - mid.y / cam.zoom;
    clampCam();
    return;
  }
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.moved > 4) { if (ui.follow) { ui.follow = false; ui.refreshCard(); } zoomAnim = null; canvas.classList.add("dragging"); cam.x = drag.cx - dx / cam.zoom; cam.y = drag.cy - dy / cam.zoom; clampCam(); }
});
function endPointer(e) {
  const p = pointers.get(e.pointerId);
  pointers.delete(e.pointerId);
  canvas.classList.remove("dragging");
  if (pinch) { if (pointers.size < 2) { pinch = null; drag = null; } return; }
  if (e.type === "pointerup" && drag && drag.moved <= 4 && p) {
    const now = performance.now();
    if (lastTap && now - lastTap.t < 330 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 36) {
      // double tap: zoom in on that spot, or back out if already zoomed in
      const zoomedIn = cam.zoom > minZoomNow() * 1.9 || cam.zoom >= 2.6;
      zoomTo(zoomedIn ? minZoomNow() : cam.zoom * 2.2, p.x, p.y);
      lastTap = null;
    } else {
      lastTap = { t: now, x: p.x, y: p.y };
      const wx = cam.x + p.x / cam.zoom, wy = cam.y + p.y / cam.zoom;
      let best = null, bd = 22;
      for (const a of sim.agents) {
        if (!a.visible) continue;
        const d = Math.hypot((a.x + 0.5) * T - wx, (a.y + 0.5) * T - wy);
        if (d < bd) { bd = d; best = a; }
      }
      ui.select(best);
      if (!best) {
        const bld = [...BUILDINGS].reverse().find((b) => b.rect && wx >= b.rect[0] && wx <= b.rect[0] + b.rect[2] && wy >= b.rect[1] && wy <= b.rect[1] + b.rect[3]);
        ui.peek(bld ?? null, p.x + 12, p.y + 12);
      } else ui.peek(null);
    }
  }
  drag = null;
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("dblclick", (e) => e.preventDefault());
$("zoomIn").onclick = () => zoomTo(cam.zoom * 1.6, vw / 2, vh / 2);
$("zoomOut").onclick = () => zoomTo(cam.zoom / 1.6, vw / 2, vh / 2);
addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.key === "+" || e.key === "=") zoomTo(cam.zoom * 1.6, vw / 2, vh / 2);
  if (e.key === "-" || e.key === "_") zoomTo(cam.zoom / 1.6, vw / 2, vh / 2);
});

// ---------- minimap ----------
const mini = $("mini"), mctx = mini.getContext("2d");
mini.width = 264; mini.height = 352;
const miniScale = mini.width / (W * T);
const miniBase = document.createElement("canvas");
miniBase.width = mini.width; miniBase.height = mini.height;
miniBase.getContext("2d").drawImage(layers.ground, 0, 0, mini.width, mini.height);
sim.society.construction.attach(layers.ground, () => {
  refreshDerived(layers.ground, town);
  miniBase.getContext("2d").drawImage(layers.ground, 0, 0, mini.width, mini.height);
});
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

  stepZoomAnim(now);
  const selected = ui.selected;
  if (ui.follow && selected && !zoomAnim) {
    const tx = (selected.x + 0.5) * T - vw / cam.zoom / 2, ty = (selected.y + 0.5) * T - vh / cam.zoom / 2;
    cam.x += (tx - cam.x) * Math.min(1, dt * 4); cam.y += (ty - cam.y) * Math.min(1, dt * 4); clampCam();
  }

  const quake = sim.society.disasters.shake;
  const sx = quake > 0 ? (Math.random() - 0.5) * 10 * Math.min(1, quake) : 0, sy = quake > 0 ? (Math.random() - 0.5) * 8 * Math.min(1, quake) : 0;
  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, (-cam.x * cam.zoom + sx) * dpr, (-cam.y * cam.zoom + sy) * dpr);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layers.ground, 0, 0);
  drawWaterLife(t);
  drawWaterfall(t);
  drawFountain(t);
  if (sim.society.election.phase !== "idle") drawBunting(t);
  if (sim.society.life.event?.active && !sim.society.life.event.place) drawEventLights(t, sim.society.life.event);

  const vx0 = cam.x / T - 2, vy0 = cam.y / T - 2, vx1 = (cam.x + vw / cam.zoom) / T + 2, vy1 = (cam.y + vh / cam.zoom) / T + 3;
  const onScreen = (a) => a.x >= vx0 && a.x <= vx1 && a.y >= vy0 && a.y <= vy1;
  const merchant = sim.society.riverton.merchant;
  const visible = [...sim.agents.filter((a) => a.visible && onScreen(a)), ...(merchant && onScreen(merchant) ? [merchant] : [])].sort((a, b) => a.y - b.y);
  for (const a of sim.agents) a.isMayor = sim.society.mayor === a.id;
  for (const a of visible) {
    if (a === selected) {
      ctx.strokeStyle = "rgba(255,207,110,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse((a.x + 0.5) * T, (a.y + 0.5) * T + 10, 13, 5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawCharacter(ctx, a, t);
    drawOccluders(a);
  }
  drawSites(t);
  drawDisasters(dt, t);
  drawSmoke(dt, t);
  drawClouds(t);

  const world = sim.society.world, weather = world.current;
  const dark = Math.max(darkness(sim.time), { storm: 0.4, rain: 0.16, fog: 0.08, snow: 0.06, cloudy: 0.04 }[weather] ?? 0);
  drawLighting(dark, sunset(sim.time), t);
  if (dark > 0.3 && weather !== "storm" && weather !== "rain") drawFireflies(t, dark);
  drawSparks(dt);
  drawWeather(dt, t, weather, world.season.id);
  drawAmbient(dt, t, world.season.id, weather, darkness(sim.time));
  // lightning
  const flash = sim.society.disasters.flash;
  if (flash > 0.95 && lastFlash < 0.5) sound.play("thunder");
  lastFlash = flash;
  if (flash > 0.02) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = `rgba(235,240,255,${flash * 0.55})`; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); }
  if (now - soundTick > 250) {
    soundTick = now;
    const ev = sim.society.life.event;
    sound.update({ dark: darkness(sim.time) > 0.3, weather, fire: !!sim.society.disasters.current("fire"), musicNight: ev?.active && ev.id === "music" });
  }

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

// ---------- construction sites ----------
function drawSites(t) {
  const c = sim.society.construction;
  for (const [lotId, site] of Object.entries(c.sites)) {
    const lot = LOTS.find((l) => l.id === lotId), p = PROJECTS[site.project];
    const [x, y, w, h] = c.rectFor(lot, p);
    const built = Math.max(0.05, site.progress);
    // foundation and the rising frame
    ctx.fillStyle = "#8a7a62"; ctx.fillRect(x, y + h - 10, w, 10);
    const top = y + h - h * built;
    ctx.fillStyle = "rgba(196,150,96,0.85)"; ctx.fillRect(x + 6, top, w - 12, y + h - 10 - top);
    ctx.strokeStyle = "#5e3a1f"; ctx.lineWidth = 3;
    for (let k = x + 6; k <= x + w - 6; k += 28) { ctx.beginPath(); ctx.moveTo(k, y + h - 10); ctx.lineTo(k, top); ctx.stroke(); }
    for (let r = y + h - 10; r > top; r -= 26) { ctx.beginPath(); ctx.moveTo(x + 6, r); ctx.lineTo(x + w - 6, r); ctx.stroke(); }
    ctx.strokeStyle = "rgba(94,58,31,0.6)"; ctx.lineWidth = 1.5;
    for (let k = x + 6; k < x + w - 30; k += 28) for (let r = y + h - 10; r > top + 26; r -= 26) { ctx.beginPath(); ctx.moveTo(k, r); ctx.lineTo(k + 28, r - 26); ctx.stroke(); }
    // a little crane
    const cx = x + w - 30, cy = top - 30;
    ctx.strokeStyle = "#e0a42a"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, y + h - 10); ctx.lineTo(cx, cy); ctx.lineTo(cx - 70, cy); ctx.stroke();
    const swing = Math.sin(t) * 8;
    ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(cx - 50, cy); ctx.lineTo(cx - 50 + swing, cy + 34); ctx.stroke();
    ctx.fillStyle = "#7a4f2a"; ctx.fillRect(cx - 58 + swing, cy + 34, 16, 8);
    // sign with progress
    ctx.fillStyle = "rgba(20,14,10,0.75)"; ctx.fillRect(x + w / 2 - 70, y + h - 46, 140, 30);
    ctx.fillStyle = "#f6e7c8"; ctx.font = "bold 12px Nunito, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(`🏗️ ${p.name}`, x + w / 2, y + h - 38);
    ctx.fillStyle = "#333"; ctx.fillRect(x + w / 2 - 60, y + h - 27, 120, 6);
    ctx.fillStyle = "#f2b843"; ctx.fillRect(x + w / 2 - 60, y + h - 27, 120 * site.progress, 6);
  }
}

// ---------- ambient life: butterflies, birds, falling leaves ----------
const butterflies = Array.from({ length: 14 }, (_, i) => ({ zone: i % 3, p: Math.random() * 10, hue: [50, 330, 200, 30, 280][i % 5] }));
const ZONES = [[640, 410, 260, 200], [520, 1610, 380, 250], [60, 160, 200, 140]];
const birds = [];
const leaves = [];
function drawAmbient(dt, t, season, weather, dark) {
  const calm = weather === "sunny" || weather === "cloudy";
  if (dark < 0.3 && calm && (season === "spring" || season === "summer")) {
    for (const b of butterflies) {
      const [zx, zy, zw, zh] = ZONES[b.zone];
      const x = zx + zw / 2 + Math.sin(t * 0.4 + b.p) * zw * 0.45 + Math.sin(t * 1.7 + b.p * 3) * 12;
      const y = zy + zh / 2 + Math.cos(t * 0.33 + b.p * 2) * zh * 0.4 + Math.sin(t * 2.3 + b.p) * 8;
      const flap = Math.abs(Math.sin(t * 14 + b.p * 5));
      ctx.fillStyle = `hsl(${b.hue}, 85%, 65%)`;
      ctx.beginPath(); ctx.ellipse(x - 2, y, 3 * flap + 0.5, 2.5, -0.4, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(x + 2, y, 3 * flap + 0.5, 2.5, 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2a1d14"; ctx.fillRect(x - 0.5, y - 2, 1, 4);
    }
  }
  // a flock now and then
  if (dark < 0.3 && weather !== "storm" && Math.random() < dt * 0.02 && birds.length === 0) {
    const y0 = cam.y + Math.random() * (vh / cam.zoom);
    for (let i = 0; i < 5 + Math.floor(Math.random() * 4); i++) birds.push({ x: cam.x - 40 - i * 18, y: y0 + Math.abs(i - 3) * 10, v: 60 + Math.random() * 10, p: Math.random() * 6 });
  }
  ctx.strokeStyle = "rgba(30,30,40,0.75)"; ctx.lineWidth = 1.5;
  for (let i = birds.length - 1; i >= 0; i--) {
    const b = birds[i];
    b.x += b.v * dt * 2; b.y -= dt * 4;
    const wing = Math.sin(t * 10 + b.p) * 3;
    ctx.beginPath(); ctx.moveTo(b.x - 5, b.y - wing); ctx.lineTo(b.x, b.y); ctx.lineTo(b.x + 5, b.y - wing); ctx.stroke();
    if (b.x > cam.x + vw / cam.zoom + 60) birds.splice(i, 1);
  }
  // autumn leaves drift across the screen
  if (season === "autumn") {
    ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    while (leaves.length < 26) leaves.push({ x: Math.random() * vw, y: Math.random() * vh, r: Math.random() * 6, c: ["#d97a2b", "#c2410c", "#e8a33d", "#a3501c"][leaves.length % 4] });
    for (const l of leaves) {
      l.y += 0.6 + Math.sin(t + l.r) * 0.3; l.x += Math.sin(t * 0.8 + l.r) * 0.8 + 0.3; l.r += 0.03;
      if (l.y > vh) { l.y = -10; l.x = Math.random() * vw; }
      ctx.save(); ctx.translate(l.x, l.y); ctx.rotate(l.r); ctx.fillStyle = l.c;
      ctx.beginPath(); ctx.ellipse(0, 0, 4, 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    ctx.restore();
  } else leaves.length = 0;
}

// ---------- disasters on the map ----------
const flames = [];
function drawDisasters(dt, t) {
  const dis = sim.society.disasters;
  // damaged buildings
  for (const r of Object.values(dis.damaged)) {
    const rect = r.building.rect;
    if (!rect) continue;
    const [x, y, w, h] = rect;
    ctx.fillStyle = "rgba(25,18,16,0.42)"; ctx.fillRect(x, y, w, h);
    ctx.font = "26px serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🚧", x + w / 2, y + h / 2);
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x + w / 2 - 40, y + h / 2 + 20, 80, 7);
    ctx.fillStyle = "#f2b843"; ctx.fillRect(x + w / 2 - 39, y + h / 2 + 21, 78 * r.progress, 5);
  }
  // fire: flames, glow and smoke
  const fire = dis.current("fire");
  if (fire) {
    const [x, y, w, h] = fire.building.rect;
    const n = Math.round(4 + 6 * Math.min(2, fire.intensity));
    for (let i = 0; i < n; i++) if (Math.random() < 0.45) flames.push({ x: x + 20 + Math.random() * (w - 40), y: y + h * (0.2 + Math.random() * 0.65), life: 1, s: 6 + Math.random() * 11 * Math.min(1.6, fire.intensity), sway: Math.random() * 6 });
    const g = ctx.createRadialGradient(x + w / 2, y + h / 2, 10, x + w / 2, y + h / 2, w * 0.8);
    g.addColorStop(0, `rgba(255,120,30,${0.32 * Math.min(1.5, fire.intensity)})`); g.addColorStop(1, "rgba(255,60,10,0)");
    ctx.fillStyle = g; ctx.fillRect(x - w * 0.3, y - h * 0.3, w * 1.6, h * 1.6);
    if (Math.random() < 0.5) smoke.push({ x: x + 20 + Math.random() * (w - 40), y: y + 10, life: 0, big: true });
  }
  ctx.save();
  for (let i = flames.length - 1; i >= 0; i--) {
    const f = flames[i];
    f.life -= 0.045; f.y -= 0.7 + (1 - f.life) * 0.8;
    if (f.life <= 0) { flames.splice(i, 1); continue; }
    const s2 = f.s * (0.4 + f.life * 0.6), fx = f.x + Math.sin(t * 9 + f.sway) * 1.5;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = `rgba(230,${Math.round(50 + 90 * f.life)},20,${0.8 * f.life})`;
    ctx.beginPath(); ctx.moveTo(fx - s2 / 2, f.y); ctx.quadraticCurveTo(fx - s2 / 3, f.y - s2 * 1.1, fx, f.y - s2 * 1.9); ctx.quadraticCurveTo(fx + s2 / 3, f.y - s2 * 1.1, fx + s2 / 2, f.y); ctx.fill();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = `rgba(255,${Math.round(170 + 70 * f.life)},90,${0.55 * f.life})`;
    ctx.beginPath(); ctx.moveTo(fx - s2 / 4, f.y); ctx.quadraticCurveTo(fx, f.y - s2 * 1.1, fx + s2 / 4, f.y); ctx.fill();
  }
  ctx.restore();
  if (flames.length > 400) flames.splice(0, flames.length - 400);
  // flood water over the riverside
  const flood = dis.current("flood");
  if (flood) {
    const a = Math.min(0.55, 0.25 + flood.intensity * 0.2);
    for (const [x, y, w, h] of FLOOD_ZONE) {
      ctx.fillStyle = `rgba(47,127,196,${a})`; ctx.fillRect(x * T, y * T, w * T, h * T);
      ctx.strokeStyle = `rgba(200,235,255,${a})`; ctx.lineWidth = 1.5;
      for (let k = 0; k < h * 2; k++) {
        const yy = y * T + k * 16 + 8 + Math.sin(t * 2 + k) * 3;
        ctx.beginPath(); ctx.moveTo(x * T, yy); for (let xx = 0; xx <= w * T; xx += 12) ctx.lineTo(x * T + xx, yy + Math.sin(xx / 10 + t * 3) * 2); ctx.stroke();
      }
    }
  }
}

// ---------- weather in screen space ----------
const drops = [];
function drawWeather(dt, t, weather, season) {
  ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (season === "winter" && weather !== "storm") { ctx.fillStyle = "rgba(210,225,255,0.08)"; ctx.fillRect(0, 0, vw, vh); }
  if (season === "autumn") { ctx.fillStyle = "rgba(255,150,60,0.05)"; ctx.fillRect(0, 0, vw, vh); }
  if (weather === "fog") { const g = ctx.createLinearGradient(0, 0, 0, vh); g.addColorStop(0, "rgba(225,230,235,0.35)"); g.addColorStop(1, "rgba(225,230,235,0.15)"); ctx.fillStyle = g; ctx.fillRect(0, 0, vw, vh); }
  const want = weather === "rain" ? 160 : weather === "storm" ? 320 : weather === "snow" ? 140 : 0;
  while (drops.length < want) drops.push({ x: Math.random() * vw, y: Math.random() * vh, v: 0.6 + Math.random() * 0.6, p: Math.random() * 6 });
  if (drops.length > want) drops.length = want;
  const snow = weather === "snow";
  ctx.strokeStyle = weather === "storm" ? "rgba(200,215,240,0.55)" : "rgba(190,210,240,0.45)"; ctx.lineWidth = 1.2; ctx.fillStyle = "rgba(255,255,255,0.85)";
  for (const d of drops) {
    if (snow) { d.y += 40 * dt * d.v * 0.5 + 0.6; d.x += Math.sin(t + d.p) * 0.4; ctx.beginPath(); ctx.arc(d.x, d.y, 1.6 * d.v, 0, Math.PI * 2); ctx.fill(); }
    else { const wind = weather === "storm" ? 6 : 2; d.y += 14 * d.v; d.x += wind * d.v; ctx.beginPath(); ctx.moveTo(d.x, d.y); ctx.lineTo(d.x - wind * 1.5, d.y - 12 * d.v); ctx.stroke(); }
    if (d.y > vh) { d.y = -10; d.x = Math.random() * vw; }
    if (d.x > vw) d.x = 0;
  }
  ctx.restore();
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
  const fire = sim.society.disasters.current("fire");
  if (fire) { const [rx, ry, rw, rh] = fire.building.rect; hole(rx + rw / 2, ry + rh / 2, 220, 1); }
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
  const icons = (soc.mayor === a.id ? "👑" : "") + (a.candidate ? "📣" : "") + (a.escort ? "🚔" : "") + (a.state === "jailed" ? "⛓️" : "") + (a.working ? "🔨" : "") + (a.hunger > 75 ? "🍞" : "") + (a.sick ? "🤒" : "") + (a.disaster?.action === "help" || a.doing === "fight" ? "🧯" : "");
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

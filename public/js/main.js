import { T, W, H, buildTown, renderStatic } from "./map.js";
import { drawCharacter, drawPortrait, roundRect } from "./sprites.js";
import { MODELS, PLACES } from "./residents.js";
import { Sim, fmtTime, periodOf } from "./sim.js";

const canvas = document.getElementById("world");
const ctx = canvas.getContext("2d");
const light = document.createElement("canvas");
const lctx = light.getContext("2d");

const town = buildTown();
const layers = renderStatic(town);
const $ = (id) => document.getElementById(id);

// ---------- UI hooks used by the simulation ----------
const feed = $("feed");
let calls = 0;
const ui = {
  beginConversation(convo, time) {
    feed.querySelector(".empty")?.remove();
    const el = document.createElement("div");
    el.className = "convo live";
    el.innerHTML = `<div class="h"><span>${convo.a.res.name} & ${convo.b.res.name} · ${convo.place}</span><span>${time}</span></div>`;
    feed.prepend(el);
    while (feed.children.length > 40) feed.lastChild.remove();
    updateLiveCount();
    return el;
  },
  addLine(el, speaker, text) {
    const p = document.createElement("p");
    const m = MODELS[speaker.res.model];
    p.innerHTML = `<b style="color:${m.color}">${speaker.res.name}</b><span class="m" style="color:${m.color}">${m.short}</span> `;
    p.append(document.createTextNode(text));
    el.append(p);
  },
  endConversation(el) { el.classList.remove("live"); updateLiveCount(); },
  noteCall() { calls++; $("calls").textContent = `${calls} AI replies`; },
  noteError(e) { console.warn("AI call failed, using offline line:", e); },
  refreshCard() { if (selected) renderCard(); },
};
const updateLiveCount = () => { const n = sim.convos.size; $("liveCount").textContent = n ? `· ${n} live` : ""; };

const sim = new Sim(town, ui);
window.gotham = sim; // handy for poking at the town from the console

const renderLegend = () => {
  $("legend").innerHTML = Object.entries(MODELS)
    .map(([k, m]) => `<span style="--c:${m.color}" class="${sim.liveModels[k] ? "on" : ""}" title="${m.label}: ${sim.liveModels[k] ? "live" : "offline chatter (no API key)"}">${m.short}</span>`)
    .join("");
};
fetch("/api/status").then((r) => r.json()).then((s) => {
  sim.live = s.live;
  sim.liveModels = s.liveModels ?? {};
  const n = Object.values(sim.liveModels).filter(Boolean).length, total = Object.keys(MODELS).length;
  $("mode").textContent = s.live ? `Live · ${n}/${total} models` : "Offline chatter";
  $("mode").className = `badge ${s.live ? "live" : "off"}`;
  $("mode").title = s.live ? "Residents with a bright dot talk through their real model" : "No API keys on the server; residents use built-in lines";
  renderLegend();
}).catch(() => { $("mode").textContent = "Offline chatter"; $("mode").className = "badge off"; });
renderLegend();

// ---------- residents list ----------
const resEls = {};
for (const a of sim.agents) {
  const b = document.createElement("button");
  b.className = "res";
  const cv = document.createElement("canvas"); cv.width = 60; cv.height = 60;
  drawPortrait(cv, a.res);
  const info = document.createElement("div");
  info.innerHTML = `<div class="n"><i style="background:${MODELS[a.res.model].color}"></i>${a.res.name}</div><div class="a"></div>`;
  b.append(cv, info);
  b.onclick = () => select(a, true);
  $("residents").append(b);
  resEls[a.id] = b;
}
setInterval(() => {
  for (const a of sim.agents) resEls[a.id].querySelector(".a").textContent = a.activity;
  if (selected) $("card").querySelector(".now").textContent = `Now: ${selected.activity}`;
}, 400);

// ---------- news ----------
const renderNews = () => { $("newsList").innerHTML = sim.news.slice().reverse().map((n) => `<div>📣 ${escapeHtml(n)}</div>`).join(""); };
$("newsForm").onsubmit = (e) => {
  e.preventDefault();
  const v = $("newsInput").value.trim();
  if (!v) return;
  sim.postNews(v);
  $("newsInput").value = "";
  renderNews();
};
renderNews();

// ---------- selection card ----------
let selected = null, follow = false;
function select(a, andFollow = false) {
  selected = a;
  follow = andFollow;
  for (const [id, el] of Object.entries(resEls)) el.classList.toggle("sel", id === a?.id);
  renderCard();
}
function renderCard() {
  const card = $("card");
  if (!selected) { card.hidden = true; return; }
  const a = selected, m = MODELS[a.res.model];
  const friends = Object.entries(a.rel).sort((x, y) => y[1] - x[1]).slice(0, 6)
    .map(([id, n]) => `<span class="friend">${sim.agents.find((o) => o.id === id)?.res.name} · ${n} chat${n > 1 ? "s" : ""}</span>`).join("");
  const mems = a.memories.slice(-6).reverse().map((x) => `<li>${escapeHtml(x.text)}</li>`).join("");
  card.innerHTML = `
    <button class="close" title="Close">✕</button>
    <div class="top"><canvas width="128" height="128"></canvas>
      <div><h3>${a.res.name}</h3><span class="badge" style="background:${m.color}22;color:${m.color}">${m.label}</span>
      <span class="role" style="font-size:11px">${sim.liveModels[a.res.model] ? "● live" : "○ offline chatter"}</span>
      <p class="role">${a.res.role}</p></div></div>
    <p class="now">Now: ${escapeHtml(a.activity)}</p>
    <h4>Personality</h4><p class="role">${a.res.personality}</p>
    <h4>Friends</h4><div class="friends">${friends || '<span class="role">No chats yet</span>'}</div>
    <h4>Memories</h4>${mems ? `<ul>${mems}</ul>` : '<p class="role">Nothing yet.</p>'}
    <div class="row"><button class="follow ${follow ? "on" : ""}">${follow ? "Following" : "Follow"}</button></div>`;
  drawPortrait(card.querySelector("canvas"), a.res);
  card.querySelector(".close").onclick = () => select(null);
  card.querySelector(".follow").onclick = () => { follow = !follow; renderCard(); };
  card.hidden = false;
}
const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

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
cam.x = 28 * T - vw / cam.zoom / 2; cam.y = 18 * T - vh / cam.zoom / 2; clampCam();

let drag = null;
canvas.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: 0 }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
  if (drag.moved > 4) { follow = false; canvas.classList.add("dragging"); cam.x = drag.cx - dx / cam.zoom; cam.y = drag.cy - dy / cam.zoom; clampCam(); }
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
    select(best);
  } else if (selected) renderCard();
  drag = null;
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
const fireflies = Array.from({ length: 24 }, () => ({ x: (2 + Math.random() * 18) * T, y: (21 + Math.random() * 8) * T, p: Math.random() * 10 }));

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
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  sim.update(dt);
  const t = now / 1000;

  if (follow && selected) {
    const tx = (selected.x + 0.5) * T - vw / cam.zoom / 2, ty = (selected.y + 0.5) * T - vh / cam.zoom / 2;
    cam.x += (tx - cam.x) * Math.min(1, dt * 4); cam.y += (ty - cam.y) * Math.min(1, dt * 4); clampCam();
  }

  ctx.setTransform(dpr * cam.zoom, 0, 0, dpr * cam.zoom, -cam.x * cam.zoom * dpr, -cam.y * cam.zoom * dpr);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layers.ground, 0, 0);
  drawWaterLife(t);
  drawFountain(t);

  const visible = sim.agents.filter((a) => a.visible).sort((a, b) => a.y - b.y);
  for (const a of visible) {
    if (a === selected) {
      ctx.strokeStyle = "rgba(255,207,110,0.9)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse((a.x + 0.5) * T, (a.y + 0.5) * T + 10, 13, 5, 0, 0, Math.PI * 2); ctx.stroke();
    }
    drawCharacter(ctx, a, t);
  }
  ctx.drawImage(layers.canopy, 0, 0);
  drawSmoke(dt, t);

  const dark = darkness(sim.time);
  drawLighting(dark, sunset(sim.time), t);
  if (dark > 0.3) drawFireflies(t, dark);

  // screen-space UI
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const a of visible) drawTag(a);
  for (const a of visible) if (a.bubble) drawBubble(a, t);

  const ft = fmtTime(sim.time);
  $("clock").textContent = ft.text;
  $("day").textContent = `Day ${ft.day} · ${periodOf(ft.hh)}`;
  requestAnimationFrame(frame);
}

function drawFountain(t) {
  const cx = 28 * T, cy = 20 * T;
  ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.beginPath(); ctx.ellipse(cx + 4, cy + 8, 60, 34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#a39a8c"; ctx.beginPath(); ctx.ellipse(cx, cy, 60, 34, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c9c0b1"; ctx.beginPath(); ctx.ellipse(cx, cy - 3, 57, 31, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#4fa6dc"; ctx.beginPath(); ctx.ellipse(cx, cy - 2, 49, 25, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 3; i++) {
    const r = ((t * 0.6 + i / 3) % 1);
    ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - r)})`; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(cx, cy - 2, 10 + r * 36, 5 + r * 18, 0, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "#b8af9f"; ctx.fillRect(cx - 6, cy - 30, 12, 28);
  ctx.fillStyle = "#d8d0c2"; ctx.beginPath(); ctx.ellipse(cx, cy - 30, 16, 6, 0, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 14; i++) {
    const p = ((t * 0.9 + i / 14) % 1), ang = (i / 14) * Math.PI * 2;
    const x = cx + Math.cos(ang) * p * 26, y = cy - 34 - Math.sin(p * Math.PI) * 18 + p * 22 + Math.sin(ang) * p * 10;
    ctx.fillStyle = `rgba(200,235,255,${0.9 - p * 0.6})`; ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
  }
}

function drawWaterLife(t) {
  const { cx, cy, rx, ry } = town.pond;
  for (const d of ducks) {
    const a = t * d.speed + d.t;
    const x = cx * T + Math.cos(a) * rx * T * d.r, y = cy * T + Math.sin(a) * ry * T * d.r;
    const dir = -Math.sin(a) > 0 ? 1 : -1;
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.beginPath(); ctx.ellipse(x, y + 4, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fafafa"; ctx.beginPath(); ctx.ellipse(x, y, 7, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(x + dir * 5, y - 5, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f2a33a"; ctx.fillRect(x + dir * 8 - (dir < 0 ? 3 : 0), y - 5, 3, 2);
    ctx.fillStyle = "#222"; ctx.fillRect(x + dir * 6, y - 6, 1.5, 1.5);
  }
  for (let i = 0; i < 8; i++) {
    const s = (t * 0.5 + i * 0.37) % 1;
    const x = (cx + Math.cos(i * 2.3) * rx * 0.7) * T, y = (cy + Math.sin(i * 1.7) * ry * 0.6) * T;
    ctx.fillStyle = `rgba(255,255,255,${Math.sin(s * Math.PI) * 0.7})`; ctx.fillRect(x, y, 4, 1.5);
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
  for (const l of town.lamps) hole(l.x * T + 16, l.y * T + 8, 95, 0.95);
  for (const w of town.windows) hole(w.x, w.y + 10, 42, 0.8);
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
  for (const l of town.lamps) glow(l.x * T + 16, l.y * T + 7, 40, dark * 0.5 * (0.92 + Math.sin(t * 3 + l.x) * 0.08));
  for (const w of town.windows) glow(w.x, w.y, 20, dark * 0.55);
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
  const label = a.res.name, w = ctx.measureText(label).width + 20;
  ctx.fillStyle = "rgba(25,22,32,0.78)";
  roundRect(ctx, s.x - w / 2, y - 8, w, 16, 8); ctx.fill();
  ctx.fillStyle = m.color; ctx.beginPath(); ctx.arc(s.x - w / 2 + 8, y, 3.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
  ctx.fillText(label, s.x - w / 2 + 14, y + 0.5);
}

function drawBubble(a, t) {
  const s = toScreen(a);
  const baseY = s.y - 30 * cam.zoom - 26;
  ctx.font = "600 13px Nunito, system-ui, sans-serif";
  let lines;
  if (a.bubble.typing) lines = ["•••".slice(0, 1 + (Math.floor(t * 3) % 3))];
  else lines = wrap(a.bubble.text, 210);
  const lh = 17, pad = 9;
  const w = a.bubble.typing ? 44 : Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2;
  const h = lines.length * lh + pad * 2 - 4;
  let x = Math.max(6, Math.min(vw - w - 6, s.x - w / 2)), y = baseY - h;
  ctx.fillStyle = "rgba(0,0,0,0.18)"; roundRect(ctx, x + 2, y + 3, w, h, 10); ctx.fill();
  ctx.fillStyle = "#fffdf7"; roundRect(ctx, x, y, w, h, 10); ctx.fill();
  ctx.beginPath(); ctx.moveTo(s.x - 6, y + h - 1); ctx.lineTo(s.x, y + h + 7); ctx.lineTo(s.x + 6, y + h - 1); ctx.fill();
  ctx.fillStyle = MODELS[a.res.model].color; ctx.fillRect(x + 8, y, w - 16, 2.5);
  ctx.fillStyle = "#2a2230"; ctx.textAlign = a.bubble.typing ? "center" : "left"; ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, a.bubble.typing ? x + w / 2 : x + pad, y + pad + i * lh - 1));
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

// Residents' daily lives, movement and conversations.
import { findPath } from "./map.js";
import { RESIDENTS, PLACES } from "./residents.js";
import { offlineLine, offlineMemory } from "./offline.js";

const WALK_SPEED = 2.6;        // tiles per game minute
const PAIR_COOLDOWN = 150;     // game minutes before the same two chat again
const SOLO_COOLDOWN = 25;      // game minutes of rest after any chat
const rand = (a, b) => a + Math.random() * (b - a);
const inRange = (h, a, b) => (a < b ? h >= a && h < b : h >= a || h < b);

export const fmtTime = (min) => {
  const day = Math.floor(min / 1440) + 1, m = Math.floor(min % 1440);
  return { day, hh: Math.floor(m / 60), mm: m % 60, text: `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}` };
};
export const periodOf = (h) => (h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 21 ? "evening" : "night");

export class Agent {
  constructor(res, town) {
    this.res = res;
    this.id = res.id;
    this.home = town.houses[res.home].door;
    this.x = this.home.x; this.y = this.home.y;
    this.path = [];
    this.state = "idle";
    this.place = "home";
    this.activity = "waking up";
    this.facing = "down";
    this.dwellUntil = 0;
    this.lastChat = -999;
    this.seed = Math.random() * 100;
    this.memories = [];   // {about, text, time}
    this.rel = {};        // otherId -> number of chats
    this.bubble = null;   // {text, until, typing}
    this.speaking = false;
    this.target = null;
  }
  get visible() { return this.state !== "sleeping"; }
}

export class Sim {
  constructor(town, ui) {
    this.town = town;
    this.ui = ui;
    this.time = 7 * 60 + 30;  // Day 1, 07:30
    this.speed = 1;
    this.paused = false;
    this.live = false;
    this.news = [];
    this.convos = new Set();
    this.pairCooldown = {};
    this.agents = RESIDENTS.map((r) => new Agent(r, town));
    this.realTime = 0;
    this.load();
  }

  get hour() { return Math.floor((this.time % 1440) / 60); }

  // ---------- persistence (per-browser convenience) ----------
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem("ai-town-v1") || "null");
      if (!saved) return;
      for (const a of this.agents) {
        const s = saved.agents?.[a.id];
        if (s) { a.memories = s.memories ?? []; a.rel = s.rel ?? {}; }
      }
      this.news = saved.news ?? [];
    } catch {}
  }
  save() {
    try {
      const agents = {};
      for (const a of this.agents) agents[a.id] = { memories: a.memories.slice(-30), rel: a.rel };
      localStorage.setItem("ai-town-v1", JSON.stringify({ agents, news: this.news.slice(-5) }));
    } catch {}
  }

  // ---------- main tick ----------
  update(dtReal) {
    this.realTime += dtReal;
    if (this.paused) return;
    const dt = dtReal * this.speed; // 1 real second = 1 game minute at 1x
    this.time += dt;
    for (const a of this.agents) this.updateAgent(a, dt);
    this.maybeStartConversations(dt);
  }

  updateAgent(a, dt) {
    if (a.state === "talking") return;
    const h = this.hour;
    const shouldSleep = inRange(h, a.res.sleep[0], a.res.sleep[1]);

    if (a.state === "sleeping") {
      if (!shouldSleep) { a.state = "idle"; a.activity = "just woke up"; a.dwellUntil = this.time + rand(5, 20); }
      return;
    }
    if (a.state === "walking") {
      let step = WALK_SPEED * dt;
      while (step > 0 && a.path.length) {
        const n = a.path[0];
        const dx = n.x - a.x, dy = n.y - a.y, d = Math.hypot(dx, dy);
        if (d > 0.001) a.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
        if (d <= step) { a.x = n.x; a.y = n.y; a.path.shift(); step -= d; }
        else { a.x += (dx / d) * step; a.y += (dy / d) * step; step = 0; }
      }
      if (!a.path.length) this.arrive(a);
      return;
    }
    if (shouldSleep && a.place !== "home") return this.goTo(a, "home");
    if (shouldSleep && a.place === "home") { a.state = "sleeping"; a.activity = "sleeping 💤"; return; }
    if (this.time >= a.dwellUntil) this.chooseNext(a);
  }

  chooseNext(a) {
    const h = this.hour, r = a.res;
    if (r.work && inRange(h, r.work.from, r.work.to) && Math.random() < 0.75) return this.goTo(a, r.work.place);
    const entries = Object.entries(r.weights).filter(([p]) => p !== a.place || Math.random() < 0.3);
    if (h >= 20 && Math.random() < 0.4) entries.push(["home", 4]);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let x = Math.random() * total;
    for (const [p, w] of entries) { if ((x -= w) <= 0) return this.goTo(a, p); }
    this.goTo(a, entries[0]?.[0] ?? "plaza");
  }

  goTo(a, place) {
    let tile;
    if (place === "home") tile = a.home;
    else {
      const tiles = this.town.places[place];
      const taken = new Set(this.agents.filter((o) => o !== a && o.target).map((o) => `${o.target.x},${o.target.y}`));
      const free = tiles.filter((t) => !taken.has(`${t.x},${t.y}`));
      tile = (free.length ? free : tiles)[Math.floor(Math.random() * (free.length || tiles.length))];
    }
    const path = findPath(this.town, a.x, a.y, tile.x, tile.y);
    if (!path) { a.dwellUntil = this.time + 10; return; }
    a.path = path; a.target = tile; a.destPlace = place;
    a.state = "walking";
    a.activity = place === "home" ? "heading home" : `heading to ${PLACES[place].name}`;
    if (!path.length) this.arrive(a);
  }

  arrive(a) {
    a.place = a.destPlace ?? a.place;
    a.state = "idle";
    a.activity = pickAct(a.place, a);
    a.dwellUntil = this.time + (a.place === "home" ? rand(30, 70) : rand(45, 130));
    a.facing = "down";
  }

  // ---------- conversations ----------
  maybeStartConversations(dt) {
    const max = this.live ? 2 : 3;
    if (this.convos.size >= max) return;
    const free = this.agents.filter((a) => (a.state === "idle" || a.state === "walking") && this.time - a.lastChat > SOLO_COOLDOWN);
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      if (a.state === "talking" || b.state === "talking") continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 2.6) continue;
      const key = [a.id, b.id].sort().join("|");
      if ((this.pairCooldown[key] ?? -1e9) > this.time) continue;
      const chance = (a.state === "idle" && b.state === "idle" ? 0.35 : 0.12) * dt;
      if (Math.random() > chance) continue;
      this.pairCooldown[key] = this.time + PAIR_COOLDOWN;
      this.startConversation(a, b);
      if (this.convos.size >= max) return;
    }
  }

  async startConversation(a, b) {
    const convo = { a, b, history: [], place: placeName(a), started: this.time };
    this.convos.add(convo);
    for (const [p, q] of [[a, b], [b, a]]) {
      p.prevState = p.state; p.state = "talking"; p.chatWith = q;
      p.activity = `chatting with ${q.res.name}`;
      if (Math.round(p.x) !== p.x || Math.round(p.y) !== p.y) { p.x = Math.round(p.x); p.y = Math.round(p.y); }
    }
    if (a.x === b.x && a.y === b.y) {
      // step aside so they're not standing inside each other
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (this.town.walkable(b.x + dx, b.y + dy)) { b.x += dx; b.y += dy; break; }
      }
    }
    const face = (p, q) => { const dx = q.x - p.x, dy = q.y - p.y; p.facing = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy > 0 ? "down" : "up"; };
    face(a, b); face(b, a);
    const entry = this.ui.beginConversation(convo, fmtTime(this.time).text);

    const maxTurns = Math.floor(rand(4, 8));
    let speaker = a, listener = b;
    for (let turn = 0; turn < maxTurns; turn++) {
      speaker.bubble = { typing: true };
      const { text, end } = await this.getLine(speaker, listener, convo, turn, maxTurns);
      speaker.bubble = null;
      if (!text) break;
      convo.history.push({ id: speaker.id, text });
      this.ui.addLine(entry, speaker, text);
      const ms = Math.min(7500, Math.max(2600, text.length * 55));
      speaker.bubble = { text, until: this.realTime + ms / 1000 };
      listener.bubble = null;
      speaker.speaking = true;
      await this.waitReal(ms * 0.75);
      speaker.speaking = false;
      await this.waitReal(ms * 0.25);
      if (end && turn >= 1) break;
      [speaker, listener] = [listener, speaker];
    }
    await this.finishConversation(convo, entry);
  }

  async getLine(speaker, listener, convo, turn, maxTurns) {
    const t = fmtTime(this.time);
    const ctx = {
      history: convo.history, turn, maxTurns, news: this.news,
      period: periodOf(t.hh),
    };
    if (this.live) {
      try {
        const res = await fetch("/api/talk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speakerId: speaker.id, listenerId: listener.id,
            time: `Day ${t.day}, ${t.text} (${ctx.period})`, place: convo.place,
            activity: speaker.prevState === "walking" ? "walking through town" : speaker.activityBefore ?? "hanging out",
            history: convo.history, turn, maxTurns, news: this.news,
            memories: speaker.memories.filter((m) => m.about === listener.id).map((m) => m.text),
          }),
        });
        if (res.ok) {
          const data = await res.json();
          if (data.text) { this.ui.noteCall(speaker.res.model); return { text: data.text, end: data.end }; }
        } else this.ui.noteError(res.status);
      } catch (e) { this.ui.noteError(e.message); }
    } else {
      await this.waitReal(rand(500, 1300)); // pretend to think
    }
    return offlineLine(speaker.res, listener.res, ctx);
  }

  async finishConversation(convo, entry) {
    const { a, b, history, place } = convo;
    const reflect = async (p, q) => {
      let text = null;
      if (this.live && history.length) {
        try {
          const res = await fetch("/api/reflect", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ agentId: p.id, otherId: q.id, history, place }),
          });
          if (res.ok) text = (await res.json()).memory;
        } catch {}
      }
      text ??= offlineMemory(p.res, q.res, history, place);
      p.memories.push({ about: q.id, text, time: fmtTime(this.time).text });
      p.rel[q.id] = (p.rel[q.id] ?? 0) + 1;
    };
    // release the pair immediately; memories land in the background
    for (const p of [a, b]) {
      p.state = "idle"; p.chatWith = null; p.lastChat = this.time; p.bubble = null;
      if (p.prevState === "walking" && p.target) this.goTo(p, p.destPlace ?? "plaza");
      else { p.activity = pickAct(p.place, p); p.dwellUntil = Math.max(p.dwellUntil, this.time + rand(10, 40)); }
    }
    this.convos.delete(convo);
    this.ui.endConversation(entry);
    await Promise.all([reflect(a, b), reflect(b, a)]);
    this.save();
    this.ui.refreshCard();
  }

  waitReal(ms) {
    return new Promise((resolve) => {
      const start = performance.now();
      let pausedFor = 0, pauseStart = null;
      const tick = () => {
        const now = performance.now();
        if (this.paused) { pauseStart ??= now; }
        else if (pauseStart !== null) { pausedFor += now - pauseStart; pauseStart = null; }
        if (!this.paused && now - start - pausedFor >= ms / Math.sqrt(this.speed)) return resolve();
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  postNews(text) {
    this.news.push(text);
    if (this.news.length > 5) this.news.shift();
    this.save();
  }
}

function pickAct(place, a) {
  const acts = PLACES[place]?.acts ?? ["hanging out"];
  if (a.res.work?.place === place) {
    const work = { cafe: "serving coffee", library: "shelving books", garden: "tending the garden", workshop: "building a contraption", townhall: "working at Town Hall" }[place];
    if (work && Math.random() < 0.6) return (a.activityBefore = work);
  }
  return (a.activityBefore = acts[Math.floor(Math.random() * acts.length)]);
}

function placeName(a) {
  if (a.state === "walking") return "a street in town";
  return a.place === "home" ? `outside ${a.res.name}'s house` : PLACES[a.place]?.name ?? "town";
}

// Residents' daily lives, movement, choices and conversations.
import { findPath } from "./map.js";
import { RESIDENTS, PLACES, COMMUNITIES } from "./residents.js";
import { offlineLine, offlineMemory } from "./offline.js";
import { Society, inRange } from "./society.js";

const WALK_SPEED = 4;          // tiles per game minute
const GAME_MIN_PER_SEC = 0.5;  // at 1x: one game minute every 2 real seconds
const PAIR_COOLDOWN = 150;     // game minutes before the same two chat again
const SOLO_COOLDOWN = 25;      // game minutes of rest after any chat
const SAVE_KEY = "gotham-v2";
const rand = (a, b) => a + Math.random() * (b - a);

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
    this.liveModels = {};     // model -> reachable on the server
    this.news = [];
    this.convos = new Set();
    this.pairCooldown = {};
    this.agents = RESIDENTS.map((r) => new Agent(r, town));
    this.realTime = 0;
    this.society = new Society(this);
    for (const a of this.agents) this.society.initAgent(a);
    this.load();
    this.started = false;
  }

  get hour() { return Math.floor((this.time % 1440) / 60); }

  // Called once the server told us which models are live.
  start() {
    if (this.started) return;
    this.started = true;
    // late sleepers plan their day when they wake up
    for (const a of this.agents) if (!inRange(this.hour, ...this.bedtime(a))) this.society.planDay(a);
  }

  // ---------- persistence (per-browser convenience) ----------
  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SAVE_KEY) || "null");
      if (!saved) return;
      for (const a of this.agents) {
        const s = saved.agents?.[a.id];
        if (s) { a.memories = s.memories ?? []; a.rel = s.rel ?? {}; }
      }
      this.news = saved.news ?? [];
      if (saved.time) this.time = Math.floor(saved.time / 1440) * 1440 + 7 * 60 + 30; // resume next morning
      this.society.restore(saved.society);
    } catch (e) { console.warn("could not load save", e); }
  }
  save() {
    try {
      const agents = {};
      for (const a of this.agents) agents[a.id] = { memories: a.memories.slice(-30), rel: a.rel };
      localStorage.setItem(SAVE_KEY, JSON.stringify({ agents, news: this.news.slice(-5), time: this.time, society: this.society.serialize() }));
    } catch {}
  }
  reset() {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    location.reload();
  }

  // ---------- main tick ----------
  update(dtReal) {
    this.realTime += dtReal;
    if (this.paused || !this.started) return;
    const dt = dtReal * this.speed * GAME_MIN_PER_SEC;
    this.time += dt;
    for (const a of this.agents) this.updateAgent(a, dt);
    this.society.update(dt);
    this.maybeStartConversations(dt);
  }

  bedtime(a) {
    const [bed, wake] = a.res.sleep;
    return a.plan?.lateNight ? [(bed + 2) % 24, wake] : [bed, wake];
  }

  updateAgent(a, dt) {
    if (a.state === "talking" || a.state === "jailed") return;
    const h = this.hour;
    const [bed, wake] = this.bedtime(a);
    const shouldSleep = inRange(h, bed, wake);

    if (a.state === "sleeping") {
      if (!shouldSleep) {
        a.state = "idle"; a.activity = "just woke up"; a.dwellUntil = this.time + rand(5, 20);
        this.society.planDay(a);
      }
      return;
    }
    if (a.state === "walking") {
      let step = WALK_SPEED * dt * (a.escort ? 1.3 : 1);
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
    // law-abiding residents head home when curfew starts
    if (this.society.curfewActive(h) && !this.society.defies(a, "curfew") && a.place !== "home") return this.goTo(a, "home", "hurrying home before curfew");
    if (shouldSleep && a.place !== "home") return this.goTo(a, "home");
    if (shouldSleep && a.place === "home") { a.state = "sleeping"; a.activity = "sleeping 💤"; return; }
    if (this.time >= a.dwellUntil) this.chooseNext(a);
  }

  // Free will: residents pick what to do from their needs, plans, laws and personality.
  chooseNext(a) {
    const h = this.hour, r = a.res, s = this.society;
    if (s.curfewActive(h) && !s.defies(a, "curfew")) { a.dwellUntil = this.time + 30; a.activity = "staying in because of curfew"; return; }
    const hangout = COMMUNITIES[a.community]?.hangout;
    if (a.gatherUntil > this.time && hangout && a.place !== hangout) return this.goTo(a, hangout, `meeting the ${COMMUNITIES[a.community].name}`);
    if (a.candidate && s.election.phase === "rally" && a.place !== "plaza") return this.goTo(a, "plaza", "heading to the campaign rally");
    if (a.hunger > 55 && a.place !== "cafe") return this.goTo(a, "cafe", a.coins >= 8 ? "going to get food" : "hungry, heading to the Inn");
    const onShift = r.work && inRange(h, r.work.from, r.work.to);
    if (onShift && a.plan?.work !== false && (a.place !== r.work.place || Math.random() < 0.85)) return this.goTo(a, r.work.place, `going to work (${r.job})`);
    const entries = Object.entries(r.weights)
      .filter(([p]) => p !== a.place || Math.random() < 0.3)
      .filter(([p]) => p !== "garden" || r.work?.place === "garden" || !s.law("garden") || s.defies(a, "garden"));
    if (s.election.phase === "rally") entries.push(["plaza", 6]);
    if (h >= 20 && !a.plan?.lateNight && Math.random() < 0.4) entries.push(["home", 4]);
    if (!entries.length) entries.push(["plaza", 1]);
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    let x = Math.random() * total;
    for (const [p, w] of entries) { if ((x -= w) <= 0) return this.goTo(a, p); }
    this.goTo(a, entries[0][0]);
  }

  goTo(a, place, label) {
    let tile;
    if (place === "home") tile = a.home;
    else if (place === "jail") tile = this.town.special.jail.door;
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
    a.activity = label ?? (place === "home" ? "heading home" : `heading to ${PLACES[place].name}`);
    if (!path.length) this.arrive(a);
  }

  sendToJail(a) {
    a.escort = true;
    a.plan = { ...(a.plan ?? {}), work: false };
    if (a.state === "sleeping") { a.state = "idle"; }
    this.goTo(a, "jail", "being escorted to jail 🚔");
    if (a.state !== "walking" && a.destPlace === "jail") return;
  }

  arrive(a) {
    if (a.destPlace === "jail") { this.society.imprison(a); return; }
    a.place = a.destPlace ?? a.place;
    a.state = "idle";
    const onShift = a.res.work && a.place === a.res.work.place && inRange(this.hour, a.res.work.from, a.res.work.to) && a.plan?.work !== false;
    a.activity = onShift ? `working as ${a.res.job.toLowerCase()}` : pickAct(a.place, a);
    a.dwellUntil = this.time + (onShift ? rand(60, 120) : a.place === "home" ? rand(30, 70) : rand(45, 130));
    a.facing = "down";
    this.society.onArrive(a);
  }

  // ---------- conversations ----------
  maybeStartConversations(dt) {
    const max = this.live ? 2 : 3;
    if (this.convos.size >= max) return;
    const s = this.society, quiet = s.quietActive(this.hour);
    const free = this.agents.filter((a) => (a.state === "idle" || a.state === "walking") && !a.escort && this.time - a.lastChat > SOLO_COOLDOWN);
    for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
      const a = free[i], b = free[j];
      if (a.state === "talking" || b.state === "talking") continue;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 2.6) continue;
      // during quiet hours only two rule-breakers will chat
      if (quiet && !(s.defies(a, "quiet") && s.defies(b, "quiet"))) continue;
      const key = [a.id, b.id].sort().join("|");
      if ((this.pairCooldown[key] ?? -1e9) > this.time) continue;
      const chance = (a.state === "idle" && b.state === "idle" ? 0.35 : 0.12) * dt;
      if (Math.random() > chance) continue;
      this.pairCooldown[key] = this.time + PAIR_COOLDOWN;
      this.startConversation(a, b, quiet);
      if (this.convos.size >= max) return;
    }
  }

  async startConversation(a, b, quietViolation = false) {
    const convo = { a, b, history: [], place: placeName(a), started: this.time, quietViolation };
    this.convos.add(convo);
    for (const [p, q] of [[a, b], [b, a]]) {
      p.prevState = p.state; p.state = "talking"; p.chatWith = q;
      p.activity = `chatting with ${q.res.name}`;
      if (Math.round(p.x) !== p.x || Math.round(p.y) !== p.y) { p.x = Math.round(p.x); p.y = Math.round(p.y); }
    }
    if (a.x === b.x && a.y === b.y) {
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
    const ctx = { history: convo.history, turn, maxTurns, news: this.news, period: periodOf(t.hh), society: this.society, self: speaker, other: listener };
    if (this.liveModels[speaker.res.model]) {
      try {
        const res = await fetch("/api/talk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speakerId: speaker.id, listenerId: listener.id,
            time: `Day ${t.day}, ${t.text} (${ctx.period})`, place: convo.place,
            activity: speaker.prevState === "walking" ? "walking through town" : speaker.activityBefore ?? "hanging out",
            history: convo.history, turn, maxTurns, news: this.news,
            memories: speaker.memories.filter((m) => m.about === listener.id).map((m) => m.text),
            situation: this.society.situation(speaker),
            plan: speaker.plan?.intention ?? "",
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
      if (this.liveModels[p.res.model] && history.length) {
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
      p.mood = Math.min(100, p.mood + 3);
    };
    for (const p of [a, b]) {
      p.state = "idle"; p.chatWith = null; p.lastChat = this.time; p.bubble = null;
      if (p.prevState === "walking" && p.target) this.goTo(p, p.destPlace ?? "plaza");
      else { p.activity = pickAct(p.place, p); p.dwellUntil = Math.max(p.dwellUntil, this.time + rand(10, 40)); }
    }
    this.convos.delete(convo);
    this.ui.endConversation(entry);
    await Promise.all([reflect(a, b), reflect(b, a), this.society.afterConversation(convo)]);
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
  return (a.activityBefore = acts[Math.floor(Math.random() * acts.length)]);
}

function placeName(a) {
  if (a.state === "walking") return "a street in town";
  return a.place === "home" ? `outside ${a.res.name}'s house` : PLACES[a.place]?.name ?? "town";
}

// Residents' daily lives, movement, choices and conversations.
import { findPath } from "./map.js";
import { RESIDENTS, PLACES, COMMUNITIES, registerResident, unregisterResident } from "./residents.js";
import { offlineLine, offlineMemory } from "./offline.js";
import { Society, inRange } from "./society.js";

const WALK_SPEED = 4;          // tiles per game minute
const GAME_MIN_PER_SEC = 0.5;  // at 1x: one game minute every 2 real seconds
const PAIR_COOLDOWN = 150;     // game minutes before the same two chat again
const SOLO_COOLDOWN = 25;      // game minutes of rest after any chat
const SAVE_KEY = "gotham-v2";
const GROUP_PLACES = new Set(["events", "plaza", "cafe", "cmarket", "market", "park", "theater"]);
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
  get visible() { return this.state !== "sleeping" && this.state !== "away"; }
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

  // ---------- population changes ----------
  addResident(res, fresh) {
    registerResident(res);
    const a = new Agent(res, this.town);
    this.society.initAgent(a);
    if (fresh) { a.coins = 60; a.mood = 75; a.rep = 50; }
    this.agents.push(a);
    if (this.started) this.society.planDay(a);
    this.ui.addResident?.(a);
    return a;
  }
  removeResident(a, silent = false) {
    if (a.state === "talking") { a.leaving = true; return; } // finish the chat first
    this.agents = this.agents.filter((x) => x !== a);
    unregisterResident(a.id);
    if (this.society.mayor === a.id) this.society.mayor = null;
    this.ui.removeResident?.(a);
    if (!silent) this.save();
  }

  personaOf(a) {
    const r = a.res;
    return r.newcomer ? { id: r.id, name: r.name, model: r.model, role: r.role, personality: r.personality, style: r.style } : undefined;
  }

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
      this.society.restore(saved.society); // brings back newcomers and departures first
      for (const a of this.agents) {
        const s = saved.agents?.[a.id];
        if (s) { a.memories = s.memories ?? []; a.rel = s.rel ?? {}; }
      }
      this.news = saved.news ?? [];
      if (saved.time) this.time = Math.floor(saved.time / 1440) * 1440 + 7 * 60 + 30; // resume next morning
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
    if (a.state === "talking" || a.state === "jailed" || a.state === "away") return;
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
      let step = WALK_SPEED * dt * (a.escort ? 1.3 : 1) * (this.society.world.w.walk ?? 1) * (a.sick ? 0.75 : 1);
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
    if (shouldSleep && a.place === "home") { a.state = "sleeping"; a.activity = "sleeping 💤"; this.society.social.writeDiary(a); return; }
    if (this.time >= a.dwellUntil) this.chooseNext(a);
  }

  // Free will: residents pick what to do from their needs, plans, laws and personality.
  chooseNext(a) {
    const h = this.hour, r = a.res, s = this.society;
    if (s.curfewActive(h) && !s.defies(a, "curfew")) { a.dwellUntil = this.time + 30; a.activity = "staying in because of curfew"; return; }
    const hangout = COMMUNITIES[a.community]?.hangout;
    if (a.gatherUntil > this.time && hangout && a.place !== hangout) return this.goTo(a, hangout, `meeting the ${COMMUNITIES[a.community].name}`);
    if (a.candidate && s.election.phase === "rally" && a.place !== "plaza") return this.goTo(a, "plaza", "heading to the campaign rally");
    const go = (o) => {
      a.doing = o.kind; a.doingPlace = o.place; a.applyJob = o.job ?? null;
      if (o.kind === "rebuild") a.disaster = { id: "rebuild", action: "rebuild" };
      return o.tile ? this.goToTile(a, o.tile[0], o.tile[1], o.label) : this.goTo(a, o.place, o.label ?? undefined);
    };
    // in the middle of a disaster response, stick with it
    if (a.disaster && s.disasters.active.some((d) => d.id === a.disaster.id)) { a.dwellUntil = this.time + 20; return; }
    // very sick residents stay in bed
    if (a.health < 25 && a.place !== "home" && !a.sick) return go({ kind: "nap", place: "home", label: "going home to rest" });
    if (a.sick) { const c = s.world.clinicOption(a); if (c && a.place !== "clinic" && !s.disasters.closed("clinic") && a.coins >= 5) return go(c); if (a.place !== "home") return go({ kind: "nap", place: "home", label: "going home sick" }); }
    // very hungry residents eat before anything else
    if (a.hunger > 70) { const e = s.life.options(a).find((o) => o.kind === "eat"); if (e && a.place !== e.place) return go(e); }
    const onShift = r.work && inRange(h, r.work.from, r.work.to) && !s.disasters.closed(r.work.place);
    if (onShift && a.plan?.work !== false && (a.place !== r.work.place || Math.random() < 0.85)) return go({ kind: "work", place: r.work.place, label: `going to work (${r.job})` });
    if (h >= 21 && !a.plan?.lateNight && Math.random() < 0.4) return go({ kind: "home", place: "home", label: "heading home for the evening" });
    // free time: residents choose for themselves, from their needs, goals, tastes and wishes for the day
    const ok = (o) => o && !(o.place === "garden" && r.work?.place !== "garden" && s.law("garden") && !s.defies(a, "garden")) && !(o.kind === "hangout" && o.place === a.place && Math.random() < 0.7);
    // live AI models think it over and pick their own next move
    if (s.autonomy.canDecide(a)) {
      const menu = s.life.options(a).filter(ok).sort((x, y) => y.score - x.score).slice(0, 7);
      if (menu.length > 1) {
        a.deciding = true; a.dwellUntil = this.time + 25; a.activity = "thinking about what to do next 💭";
        s.autonomy.decide(a, menu).then((o) => {
          a.deciding = false;
          if (a.state !== "idle") return;
          go(o ?? s.life.choose(a) ?? { kind: "stroll", place: "plaza" });
        });
        return;
      }
    }
    let o = s.life.choose(a);
    if (!ok(o)) o = null;
    if (s.election.phase === "rally" && Math.random() < 0.35) o = { kind: "hangout", place: "plaza", label: "going to watch the campaign rally" };
    o ??= { kind: "stroll", place: "plaza" };
    const thought = s.autonomy.instinctThought(a, o);
    if (thought) s.autonomy.think(a, thought, Math.random() < 0.25);
    return go(o);
  }

  goToTile(a, x, y, label) {
    const path = findPath(this.town, a.x, a.y, x, y);
    if (!path) { a.dwellUntil = this.time + 10; return; }
    a.path = path; a.target = { x, y }; a.destPlace = "disaster";
    a.state = "walking"; a.activity = label ?? "on the way";
    if (!path.length) this.arrive(a);
  }

  goTo(a, place, label) {
    let tile;
    if (place === "home") tile = a.home;
    else if (place === "jail") tile = this.town.special.jail.door;
    else if (!this.town.places[place]?.length) {
      // not a named place (a building site, a disaster scene...): walk back to where they were heading
      if (a.target) return this.goToTile(a, a.target.x, a.target.y, label);
      return this.goTo(a, "plaza", label);
    } else {
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
    const pursuing = !onShift && a.doing && a.place === a.doingPlace;
    a.activity = onShift ? `working as ${a.res.job.toLowerCase()}` : (pursuing && this.society.life.activityLabel(a)) || pickAct(a.place, a);
    const ev = this.society.life.event;
    a.dwellUntil = this.time + (onShift ? rand(60, 120)
      : pursuing && a.doing === "event" && ev?.active ? Math.max(30, ev.end - this.time)
      : pursuing && ["fish", "garden"].includes(a.doing) ? rand(60, 150)
      : pursuing && a.doing === "nap" ? rand(60, 120)
      : a.place === "home" ? rand(30, 70) : rand(45, 130));
    a.facing = "down";
    if (a.place === "fishing") { // face the water
      const t = this.town.get(Math.round(a.x), Math.round(a.y));
      a.facing = t === 14 ? "left" : Math.round(a.y) <= 13 ? "up" : "down";
    }
    this.society.onArrive(a);
  }

  // ---------- conversations ----------
  maybeStartConversations(dt) {
    const max = this.live ? 2 : 3;
    if (this.convos.size >= max) return;
    const s = this.society, quiet = s.quietActive(this.hour);
    const free = this.agents.filter((a) => (a.state === "idle" || a.state === "walking") && !a.escort && this.time - a.lastChat > SOLO_COOLDOWN);
    // groups gather at lively places: three or four neighbors talk together
    if (!quiet && Math.random() < dt * 0.06) {
      const idle = free.filter((a) => a.state === "idle" && GROUP_PLACES.has(a.place));
      for (const a of idle) {
        const group = [a, ...idle.filter((o) => o !== a && o.place === a.place && Math.hypot(o.x - a.x, o.y - a.y) < 3.5)].slice(0, 4);
        if (group.length >= 3) { this.startGroupConversation(group); return; }
      }
    }
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
    const convo = { a, b, history: [], place: placeName(a), started: this.time, quietViolation, tense: this.society.social.isRival(a, b), feelings: {} };
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
      speaker.bubble = { typing: true, born: this.realTime };
      const { text, end } = await this.getLine(speaker, listener, convo, turn, maxTurns);
      speaker.bubble = null;
      if (!text) break;
      convo.history.push({ id: speaker.id, name: speaker.res.name, text });
      this.ui.addLine(entry, speaker, text);
      const ms = Math.min(7500, Math.max(2600, text.length * 55));
      speaker.bubble = { text, until: this.realTime + ms / 1000, born: this.realTime };
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

  async startGroupConversation(members) {
    const names = members.map((m) => m.res.name);
    const convo = { a: members[0], b: members[1], members, group: true, history: [], place: placeName(members[0]), started: this.time, feelings: {} };
    this.convos.add(convo);
    const cx = members.reduce((s, m) => s + m.x, 0) / members.length, cy = members.reduce((s, m) => s + m.y, 0) / members.length;
    for (const p of members) {
      p.prevState = p.state; p.state = "talking"; p.chatWith = members.find((m) => m !== p);
      p.activity = `chatting with ${names.filter((n) => n !== p.res.name).join(", ")}`;
      p.x = Math.round(p.x); p.y = Math.round(p.y);
      const dx = cx - p.x, dy = cy - p.y;
      p.facing = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    }
    const entry = this.ui.beginConversation(convo, fmtTime(this.time).text);
    const maxTurns = Math.floor(rand(6, 11));
    let last = null, speaker = members[0];
    for (let turn = 0; turn < maxTurns; turn++) {
      const listener = last ?? members[1];
      speaker.bubble = { typing: true, born: this.realTime };
      const { text } = await this.getLine(speaker, listener, convo, turn, maxTurns);
      speaker.bubble = null;
      if (!text) break;
      convo.history.push({ id: speaker.id, name: speaker.res.name, text });
      this.ui.addLine(entry, speaker, text);
      const ms = Math.min(7000, Math.max(2400, text.length * 50));
      for (const m of members) if (m !== speaker && m.bubble && !m.bubble.typing) m.bubble = null;
      speaker.bubble = { text, until: this.realTime + ms / 1000, born: this.realTime };
      speaker.speaking = true; await this.waitReal(ms * 0.75); speaker.speaking = false; await this.waitReal(ms * 0.25);
      last = speaker;
      const others = members.filter((m) => m !== speaker);
      speaker = others[Math.floor(Math.random() * others.length)];
    }
    for (const p of members) {
      p.state = "idle"; p.chatWith = null; p.lastChat = this.time; p.bubble = null;
      p.activity = pickAct(p.place, p); p.dwellUntil = Math.max(p.dwellUntil, this.time + rand(10, 40));
      p.memories.push({ about: p.id, text: `Hung out with ${names.filter((n) => n !== p.res.name).join(", ")} at ${convo.place}.`, time: fmtTime(this.time).text });
      p.social = Math.min(100, (p.social ?? 50) + 15); p.mood = Math.min(100, p.mood + 3);
      for (const q of members) if (q !== p) p.rel[q.id] = (p.rel[q.id] ?? 0) + 1;
    }
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      this.society.social.afterConversation({ a: members[i], b: members[j], place: convo.place, tense: false }, {});
    }
    this.convos.delete(convo);
    this.ui.endConversation(entry);
    for (const p of members) if (p.leaving) { p.leaving = false; this.removeResident(p); }
    this.save();
  }

  async getLine(speaker, listener, convo, turn, maxTurns) {
    const t = fmtTime(this.time);
    const ctx = { history: convo.history, turn, maxTurns, news: this.news, period: periodOf(t.hh), society: this.society, self: speaker, other: listener, tense: convo.tense };
    if (this.liveModels[speaker.res.model]) {
      try {
        const res = await fetch("/api/talk", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            speakerId: speaker.id, listenerId: listener.id,
            persona: this.personaOf(speaker), listenerPersona: this.personaOf(listener),
            group: convo.group ? convo.members.filter((m) => m !== speaker).map((m) => m.res.name) : undefined,
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
            body: JSON.stringify({ agentId: p.id, otherId: q.id, history, place, persona: this.personaOf(p), otherPersona: this.personaOf(q) }),
          });
          if (res.ok) { const r = await res.json(); text = r.memory; if (typeof r.feeling === "number") convo.feelings[p.id] = r.feeling; }
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
    for (const p of [a, b]) if (p.leaving) { p.leaving = false; this.removeResident(p); }
    await Promise.all([reflect(a, b), reflect(b, a), this.society.afterConversation(convo)]);
    this.society.social.afterConversation(convo, convo.feelings);
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

// Disasters the player can trigger, and how every resident reacts to them.
import { BUILDINGS, FLOOD_ZONE } from "./mapdata.js";

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const T = 32;
const cap = (str) => str.charAt(0).toUpperCase() + str.slice(1);

export const DISASTERS = {
  fire: { name: "Fire", icon: "🔥", desc: "A building catches fire", duration: 180 },
  storm: { name: "Great Storm", icon: "⛈️", desc: "Violent winds and rain batter the town", duration: 240 },
  flood: { name: "River Flood", icon: "🌊", desc: "The river bursts its banks", duration: 300 },
  earthquake: { name: "Earthquake", icon: "🌍", desc: "The ground shakes; buildings crack and people get hurt", duration: 120 },
  epidemic: { name: "Epidemic", icon: "🦠", desc: "A contagious fever spreads through town", duration: 1440 },
  crash: { name: "Market Crash", icon: "📉", desc: "Savings shrink and markets pay half price", duration: 720 },
};

export class Disasters {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.active = [];
    this.damaged = {};     // place -> { building, cost, progress }
    this.shake = 0;        // real seconds of screen shake left
    this.flash = 0;        // lightning flash brightness
    this.listeners = [];
  }
  log(...args) { this.society.log(...args); }
  on(fn) { this.listeners.push(fn); }
  emit(type, d) { for (const fn of this.listeners) fn(type, d); }

  closed(place) {
    if (this.damaged[place]) return true;
    if (place === "fishing" && (this.active.some((d) => d.type === "flood" || d.type === "storm") || this.damaged.fishing)) return true;
    return false;
  }
  current(type) { return this.active.find((d) => d.type === type); }

  // ----- trigger -----
  trigger(type, targetName) {
    const def = DISASTERS[type];
    if (!def || this.current(type)) return null;
    const t = this.sim.time;
    const d = { id: `${type}${Math.floor(t)}`, type, ...def, start: t, end: t + def.duration, helpers: new Set(), actions: {}, intensity: 1 };
    if (type === "fire") {
      const options = BUILDINGS.filter((b) => !this.damaged[b.place] && b.place !== "garden");
      d.building = options.find((b) => b.name === targetName) ?? pick(options);
      d.title = `${def.icon} Fire at ${d.building.name}!`;
    } else d.title = `${def.icon} ${def.name}!`;
    this.active.push(d);
    this.log(def.icon, type === "fire" ? `FIRE! ${cap(d.building.name)} is burning!` : `${def.name}! ${def.desc}.`, "disaster", true);
    this.immediate(d);
    this.society.riverton?.onDisaster(d);
    // the mayor responds
    const mayor = this.society.mayorAgent();
    if (mayor) setTimeout(() => this.log("📢", `Mayor ${mayor.res.name}: "${pick(["Everyone stay calm and help each other!", "Gotham will get through this together!", "Stay safe, and help your neighbors if you can."])}"`, "disaster"), 1500);
    // everyone awake reacts, a few at a time
    const people = this.sim.agents.filter((a) => a.state !== "sleeping" && a.state !== "jailed");
    people.forEach((a, i) => setTimeout(() => this.react(a, d), 300 + i * 450));
    this.emit("start", d);
    return d;
  }

  immediate(d) {
    const agents = this.sim.agents;
    if (d.type === "storm") this.society.world.forced = "storm";
    if (d.type === "earthquake") {
      this.shake = 4;
      const hit = BUILDINGS.filter((b) => !this.damaged[b.place]).sort(() => Math.random() - 0.5).slice(0, 2);
      for (const b of hit) this.damage(b, 120 + Math.floor(Math.random() * 120));
      for (const a of agents.filter((x) => x.state !== "jailed").sort(() => Math.random() - 0.5).slice(0, 3)) {
        a.health = clamp(a.health - 35); a.injured = true; a.mood = clamp(a.mood - 15);
        this.log("🤕", `${a.res.name} was hurt in the earthquake.`, "disaster", false, a.id);
      }
    }
    if (d.type === "epidemic") {
      for (const a of agents.sort(() => Math.random() - 0.5).slice(0, 2)) this.infect(a);
    }
    if (d.type === "crash") {
      let lost = 0;
      for (const a of agents) { const l = Math.floor(a.coins * 0.25); a.coins -= l; lost += l; a.mood = clamp(a.mood - 12); }
      this.log("📉", `Savings across Gotham fell by ${lost} coins in total.`, "disaster", true);
    }
  }

  infect(a) {
    if (a.sick) return;
    a.sick = true; a.health = Math.min(a.health, 40);
    this.log("🦠", `${a.res.name} caught the fever.`, "disaster", false, a.id);
  }

  damage(b, cost) {
    if (this.damaged[b.place]) { this.damaged[b.place].cost += cost; return; }
    this.damaged[b.place] = { building: b, cost, progress: 0 };
    this.log("🚧", `${cap(b.name)} ${/s$/.test(b.name) && !/s's$/.test(b.name) && b.name.startsWith("the f") ? "are" : "is"} damaged and closed until repaired (${cost} coins of work).`, "disaster", true);
  }

  // ----- reactions -----
  options(a, d) {
    const t = a.res.traits;
    const helpful = t.generosity * 0.5 + t.diligence * 0.2 + (a.rep - 50) / 300;
    const selfish = t.rebel * 0.8 + (a.coins < 30 ? 0.3 : 0) - a.rep / 300;
    const fearful = (1 - t.ambition) * 0.6 + (1 - t.rebel) * 0.2 + (a.health < 60 ? 0.3 : 0);
    const curious = 0.2 + Math.random() * 0.5;
    const friend = Object.entries(a.bond ?? {}).sort((x, y) => y[1] - x[1])[0];
    const friendAgent = friend && this.sim.agents.find((o) => o.id === (a.partner ?? friend[0]));
    const o = [];
    const add = (id, label, score, go) => o.push({ id, label, score: score * (0.75 + Math.random() * 0.5), go });
    if (d.type === "fire") {
      add("help", `rush to ${d.building.name} and help put out the fire`, helpful * 75, { tile: d.building.door });
      add("flee", "run home where it's safe", fearful * 75, { place: "home" });
      add("watch", "watch from a safe distance", curious * 70, { place: "plaza" });
      if (t.rebel > 0.4) add("loot", `sneak into ${d.building.name} and grab what you can in the chaos`, selfish * 65, { tile: d.building.door });
      if (a.coins > 40) add("donate", "donate coins to rebuild the damage", t.generosity * 60, null);
    } else if (d.type === "storm") {
      add("shelter", "take shelter at home", 50 + fearful * 60, { place: "home" });
      add("secure", "help secure the Community Garden before the storm wrecks it", helpful * 80, { place: "cgarden" });
      add("inn", "wait it out with neighbors at the Inn", 30 + (a.likes?.socialize ?? 0.5) * 30, { place: "cafe" });
      if (t.rebel > 0.5) add("fish", "go fishing anyway, storms make the fish bite", t.rebel * 40, { place: "park" });
    } else if (d.type === "flood") {
      add("sandbag", "pile sandbags along the river road", helpful * 90, { tile: [7, 15] });
      add("evacuate", "evacuate home to higher ground", fearful * 80, { place: "home" });
      if (t.rebel > 0.45) add("loot", "loot the abandoned General Store", selfish * 45, { place: "store" });
      add("watch", "watch the river from the plaza", 25, { place: "plaza" });
    } else if (d.type === "earthquake") {
      add("rescue", "help carry the injured to the Clinic", helpful * 90, { place: "clinic" });
      if (friendAgent) add("friend", `check on ${friendAgent.res.name}`, 40 + (a.bond[friendAgent.id] ?? 0) * 0.5, { agent: friendAgent });
      add("hide", "hide at home until the aftershocks stop", fearful * 80, { place: "home" });
      if (a.coins > 40) add("donate", "donate coins to rebuild the town", t.generosity * 60, null);
    } else if (d.type === "epidemic") {
      add("isolate", "stay home to avoid catching it", 30 + fearful * 60 + t.diligence * 20, { place: "home" });
      add("checkup", "get checked at the Clinic", a.sick ? 90 : 30, { place: "clinic" });
      if (a.res.work?.place === "clinic" || helpful > 0.6) add("nurse", "help nurse the sick at the Clinic", helpful * 80, { place: "clinic" });
      add("ignore", "carry on as normal, it's just a fever", t.rebel * 50, null);
    } else if (d.type === "crash") {
      add("protest", "protest at Town Hall", t.rebel * 70 + (a.coins < 40 ? 30 : 0), { place: "townhall" });
      add("hoard", "stay home and count what's left", fearful * 60, { place: "home" });
      if (a.coins > 60) add("help", "give coins to neighbors who lost everything", t.generosity * 70, null);
      add("work", "work extra hard to earn it back", t.diligence * 60, a.res.work ? { place: a.res.work.place } : null);
    }
    return o.sort((x, y) => y.score - x.score);
  }

  async react(a, d) {
    if (!this.active.includes(d) || a.state === "sleeping" || a.state === "jailed") return;
    const opts = this.options(a, d);
    if (!opts.length) return;
    let choice = null, thought = null, say = null;
    if (this.sim.liveModels[a.res.model]) {
      try {
        const menu = opts.slice(0, 6).map((o, i) => ({ id: `o${i}`, label: o.label }));
        const res = await fetch("/api/think", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "react", agentId: a.id, persona: this.sim.personaOf(a), situation: this.society.situation(a), disaster: `${d.title} ${d.desc}.`, options: menu }),
        });
        if (res.ok) {
          const r = await res.json();
          const i = menu.findIndex((m) => m.id === r.choice);
          if (i >= 0) { choice = opts[i]; thought = r.thought; say = r.say; }
        }
      } catch {}
    }
    if (!choice) { // instinct: one of their top few impulses, the stronger the likelier
      const top = opts.slice(0, 3), total = top.reduce((sum, o) => sum + o.score * o.score, 0);
      let r = Math.random() * total;
      choice = top.find((o) => (r -= o.score * o.score) <= 0) ?? top[0];
    }
    say ??= { help: "Everyone grab water!", flee: "I'm getting out of here!", watch: "Oh no, look at that...", loot: "Nobody's watching...", donate: "Here, take my coins for repairs.", shelter: "Inside, everyone!", secure: "Save the garden!", inn: "To the Inn!", fish: "Best fishing weather there is!", sandbag: "Sandbags! Hurry!", evacuate: "Get to higher ground!", rescue: "Hold on, I've got you!", friend: "I have to find them!", hide: "Stay inside!", isolate: "I'm staying home.", checkup: "I'd better see the doctor.", nurse: "Let me help.", ignore: "It's just a fever.", protest: "We want answers!", hoard: "I can't lose any more.", work: "Back to work." }[choice.id];
    a.disaster = { id: d.id, action: choice.id, label: choice.label };
    d.actions[a.id] = choice.id;
    if (thought) this.society.autonomy.think(a, String(thought).slice(0, 140));
    if (say && a.state !== "talking") a.bubble = { text: String(say).slice(0, 90), born: this.sim.realTime, until: this.sim.realTime + 5 };
    a.activity = choice.label;
    // immediate actions
    if (choice.id === "donate" || (choice.id === "help" && d.type === "crash")) {
      const gift = Math.floor(a.coins * 0.25);
      a.coins -= gift; a.rep = clamp(a.rep + 6);
      if (d.type === "crash") {
        const poorest = this.sim.agents.filter((o) => o !== a).sort((x, y) => x.coins - y.coins)[0];
        if (poorest) { poorest.coins += gift; this.log("🤝", `${a.res.name} gave ${gift} coins to ${poorest.res.name} after the crash.`, "disaster", false, a.id); }
      } else { this.society.treasury += gift; this.repairFund = (this.repairFund ?? 0) + gift; this.log("💝", `${a.res.name} donated ${gift} coins to the repair fund.`, "disaster", false, a.id); }
    }
    if (choice.go && a.state !== "talking") {
      a.doing = "disaster"; a.doingPlace = choice.go.place ?? "disaster";
      if (choice.go.agent) { const f = choice.go.agent; this.sim.goToTile(a, Math.round(f.x), Math.round(f.y), choice.label); }
      else if (choice.go.tile) this.sim.goToTile(a, choice.go.tile[0], choice.go.tile[1], choice.label);
      else this.sim.goTo(a, choice.go.place, choice.label);
      a.dwellUntil = this.sim.time + 90;
    }
    this.emit("react", { a, d, choice });
  }

  // ----- every frame (dt in game minutes) -----
  update(dt) {
    this.shake = Math.max(0, this.shake - dt / Math.max(1, this.sim.speed * 0.5) * 0.5);
    this.flash = Math.max(0, this.flash - dt * 0.6);
    const sim = this.sim;
    for (const d of [...this.active]) {
      const on = (id) => sim.agents.filter((a) => a.disaster?.id === d.id && a.disaster.action === id && a.state === "idle");
      if (d.type === "fire") {
        const [bx, by] = d.building.door;
        const fighters = on("help").filter((a) => Math.hypot(a.x - bx, a.y - by) < 3);
        d.intensity = clamp(d.intensity + dt * (0.005 - fighters.length * 0.0035), 0, 2);
        for (const f of fighters) { d.helpers.add(f.id); f.health = clamp(f.health - dt * 0.03); f.activity = "fighting the fire 🔥"; f.doing = "fight"; }
        for (const l of on("loot").filter((a) => Math.hypot(a.x - bx, a.y - by) < 3 && !a.disaster.looted)) {
          l.disaster.looted = true; const take = 20 + Math.floor(Math.random() * 25); l.coins += take;
          const law = this.society.law("theft");
          if (law) this.society.violate(l, law, `looted ${d.building.name} during the fire`, 1);
          else this.log("💰", `${l.res.name} grabbed ${take} coins of goods from ${d.building.name} during the fire.`, "disaster", false, l.id);
        }
        if (d.intensity <= 0) this.end(d, "out");
        else if (sim.time >= d.end || d.intensity >= 2) this.end(d, "burned");
      } else if (d.type === "storm") {
        if (Math.random() < dt * 0.05) this.flash = 1;
        for (const a of sim.agents) if (a.place === "cgarden" && a.disaster?.action === "secure" && a.state === "idle") d.helpers.add(a.id);
        if (sim.time >= d.end) this.end(d);
      } else if (d.type === "flood") {
        for (const a of on("sandbag")) { d.helpers.add(a.id); a.activity = "piling sandbags"; }
        d.intensity = clamp(d.intensity + dt * (0.002 - d.helpers.size * 0.0015), 0.3, 1.6);
        if (sim.time >= d.end) this.end(d);
      } else if (d.type === "earthquake") {
        for (const a of on("rescue")) {
          d.helpers.add(a.id);
          const hurt = sim.agents.find((o) => o.injured && o.health < 70);
          if (hurt) { hurt.health = clamp(hurt.health + dt * 0.3); if (hurt.health >= 70) hurt.injured = false; }
        }
        if (sim.time >= d.end) this.end(d);
      } else if (d.type === "epidemic") {
        for (const s of sim.agents.filter((x) => x.sick && x.place !== "home")) {
          for (const o of sim.agents) if (o !== s && !o.sick && o.place !== "home" && Math.hypot(o.x - s.x, o.y - s.y) < 2.5 && Math.random() < dt * 0.01) this.infect(o);
        }
        for (const n of on("nurse")) { d.helpers.add(n.id); for (const s of sim.agents.filter((x) => x.sick && x.place === "clinic")) s.health = clamp(s.health + dt * 0.25); }
        if (sim.time >= d.end) this.end(d);
      } else if (d.type === "crash") {
        if (sim.time >= d.end) this.end(d);
      }
    }
    // repairs: volunteers and the treasury rebuild damaged places
    for (const [place, r] of Object.entries(this.damaged)) {
      const [bx, by] = r.building.door;
      const volunteers = sim.agents.filter((a) => a.disaster?.action === "rebuild" && a.state === "idle" && Math.hypot(a.x - bx, a.y - by) < 3);
      for (const v of volunteers) { v.activity = "helping rebuild 🔨"; v.rep = clamp(v.rep + dt * 0.01); }
      r.progress += dt * (volunteers.length * 0.0006 + (this.repairFund > 0 ? 0.0004 : 0));
      if (this.repairFund > 0) this.repairFund = Math.max(0, this.repairFund - dt * 0.1);
      if (r.progress >= 1) {
        delete this.damaged[place];
        this.log("🏗️", `${cap(r.building.name)} has been rebuilt and is open again${volunteers.length ? `, thanks to ${volunteers.map((v) => v.res.name).join(", ")}` : ""}!`, "disaster", true);
        for (const v of volunteers) v.disaster = null;
      }
    }
  }

  // free-time option: help rebuild something
  rebuildOption(a) {
    const first = Object.values(this.damaged)[0];
    if (!first) return null;
    const t = a.res.traits;
    return { kind: "rebuild", score: 20 + (t.generosity + t.diligence) * 30, place: "disaster", label: `going to help rebuild ${first.building.name}`, tile: first.building.door };
  }

  end(d, how) {
    this.active = this.active.filter((x) => x !== d);
    const helpers = [...d.helpers].map((id) => this.sim.agents.find((a) => a.id === id)).filter(Boolean);
    const names = helpers.map((a) => a.res.name).join(", ");
    if (d.type === "fire") {
      if (how === "out") this.log("🧯", `The fire at ${d.building.name} is out${names ? `, thanks to ${names}` : ""}!`, "disaster", true);
      else this.log("🔥", `${cap(d.building.name)} burned badly before the fire died down.`, "disaster", true);
      const cost = Math.round(60 + (how === "out" ? 40 : 200) * Math.max(0.3, d.intensity));
      this.damage(d.building, cost);
    } else if (d.type === "storm") {
      this.society.world.forced = null;
      if (!helpers.length) { for (const a of this.sim.agents) a.inv && (a.inv.veg = Math.floor(a.inv.veg / 2)); this.log("🥀", "The storm flattened the Community Garden; vegetables were lost.", "disaster"); }
      else this.log("🌱", `${names} saved the Community Garden from the storm.`, "disaster", true);
      if (Math.random() < 0.5) this.damage({ name: "the fishing docks", place: "fishing", door: [7, 15] }, 80);
      this.log("🌤️", "The Great Storm has passed.", "disaster", true);
    } else if (d.type === "flood") {
      const cost = Math.round(60 + 160 * Math.max(0, d.intensity - 0.3));
      this.damage({ name: "the riverside and docks", place: "fishing", door: [7, 15] }, cost);
      this.log("🌊", `The flood waters receded${names ? `. Sandbaggers: ${names}` : ""}.`, "disaster", true);
    } else if (d.type === "earthquake") {
      this.log("🌍", `The aftershocks have stopped${names ? `. ${names} carried the injured to safety` : ""}.`, "disaster", true);
    } else if (d.type === "epidemic") {
      this.log("🩹", "The epidemic is over.", "disaster", true);
    } else if (d.type === "crash") {
      this.log("📈", "The markets have recovered.", "disaster", true);
    }
    for (const h of helpers) {
      h.rep = clamp(h.rep + 8); h.mood = clamp(h.mood + 6);
      h.memories.push({ about: h.id, text: `I helped during the ${d.name.toLowerCase()}. I'm proud of that.`, time: "" });
    }
    if (helpers.length) this.log("🦸", `Heroes of the ${d.name.toLowerCase()}: ${names}. The town won't forget.`, "disaster", false, helpers[0].id);
    for (const a of this.sim.agents) if (a.disaster?.id === d.id) { a.disaster = null; if (a.doing === "disaster" || a.doing === "fight") a.dwellUntil = 0; }
    this.emit("end", d);
  }

  marketFactor() { return this.current("crash") ? 0.5 : 1; }

  situation() {
    const lines = this.active.map((d) => `EMERGENCY happening now: ${d.title} ${d.desc}.`);
    const dmg = Object.values(this.damaged).map((r) => `${r.building.name} is damaged and closed (${Math.round(r.progress * 100)}% rebuilt).`);
    return [...lines, ...dmg].join("\n");
  }

  serialize() { return { damaged: Object.fromEntries(Object.entries(this.damaged).map(([k, v]) => [k, { name: v.building.name, place: v.building.place, door: v.building.door, rect: v.building.rect, cost: v.cost, progress: v.progress }])) }; }
  restore(s) {
    for (const [k, v] of Object.entries(s?.damaged ?? {})) this.damaged[k] = { building: { name: v.name, place: v.place, door: v.door, rect: v.rect }, cost: v.cost, progress: v.progress };
  }
}

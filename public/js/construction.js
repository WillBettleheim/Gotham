// Construction: the council funds new buildings on the empty lots. They're built from the
// picture's own art (so the style matches), take time, and residents can volunteer to help.
import { LOTS, BUILDINGS } from "./mapdata.js";
import { WORKPLACES } from "./population.js";
import { PLACES } from "./residents.js";
import { TILE } from "./map.js";

const T = 32;
export const PROJECTS = {
  theater: {
    name: "Gotham Theater", icon: "🎭", cost: 500, hours: 20, place: "theater",
    desc: "Shows every evening; residents pay 5 coins for a night of fun. Hires 2 stagehands.",
    art: [985, 120, 250, 216], label: "Theater", emblem: "🎭",
    job: { title: "Stagehand", wage: 11, from: 14, to: 22, slots: 2 },
    acts: ["watching a show at the Theater", "applauding a play", "laughing at a comedy"],
  },
  flats: {
    name: "Riverside Flats", icon: "🏢", cost: 600, hours: 28, place: "flats", lots: ["B"],
    desc: "A second apartment block: 12 more homes for newcomers.",
    art: [1126, 1590, 250, 298], label: "Riverside Flats", homes: 12,
  },
  gym: {
    name: "Fitness Club", icon: "🏋️", cost: 350, hours: 16, place: "gym",
    desc: "Workouts improve health and energy. Hires 2 trainers.",
    art: [285, 390, 230, 220], label: "Fitness Club", emblem: "🏋️",
    job: { title: "Trainer", wage: 12, from: 7, to: 15, slots: 2 },
    acts: ["working out at the Fitness Club", "lifting weights", "doing yoga"],
  },
  hospital: {
    name: "Gotham Hospital", icon: "🏥", cost: 450, hours: 22, place: "hospital",
    desc: "Treats the sick twice as well as the Clinic. Hires 2 nurses.",
    art: [1040, 650, 190, 186], label: "Hospital", emblem: "🏥",
    job: { title: "Hospital nurse", wage: 15, from: 8, to: 18, slots: 2 },
    acts: ["visiting the Hospital", "getting a checkup at the Hospital"],
  },
};

export class Construction {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.sites = {};   // lotId -> { project, progress, started }
    this.built = {};   // lotId -> project id
    this.canvas = null;
    this.listeners = [];
  }
  on(fn) { this.listeners.push(fn); }
  emit(type, d) { for (const fn of this.listeners) fn(type, d); }

  // main.js hands over the map canvas once the picture is loaded
  attach(ground, rebuild) {
    this.canvas = ground; this.rebuild = rebuild;
    for (const [lot, pid] of Object.entries(this.built)) this.draw(lot, pid);
    if (Object.keys(this.built).length) rebuild();
  }

  lot(id) { return LOTS.find((l) => l.id === id); }
  freeLots(pid) { return LOTS.filter((l) => !this.sites[l.id] && !this.built[l.id] && (!PROJECTS[pid]?.lots || PROJECTS[pid].lots.includes(l.id))); }
  isBuilt(pid) { return Object.values(this.built).includes(pid); }

  start(pid, lotId) {
    const p = PROJECTS[pid], lot = this.lot(lotId);
    if (!p || !lot) return "Unknown project or lot.";
    if (this.isBuilt(pid) || Object.values(this.sites).some((x) => x.project === pid)) return `${p.name} is already built or under construction.`;
    if (!this.freeLots(pid).includes(lot)) return `${lot.name} can't take ${p.name}.`;
    if (this.society.treasury < p.cost) return `The treasury needs ${p.cost} coins (it has ${Math.floor(this.society.treasury)}).`;
    this.society.treasury -= p.cost;
    this.sites[lotId] = { project: pid, progress: 0, started: this.sim.time };
    this.society.log("🏗️", `Construction started: ${p.name} on ${lot.name} (${p.cost} coins from the treasury).`, "economy", true);
    this.society.social.spread(`They're building ${p.name} on ${lot.name}`, []);
    this.emit("start", { lot, p });
    return null;
  }

  update(dt) {
    for (const [lotId, site] of Object.entries(this.sites)) {
      const lot = this.lot(lotId), p = PROJECTS[site.project];
      const helpers = this.sim.agents.filter((a) => a.doing === "build" && a.state === "idle" && Math.hypot(a.x - lot.door[0], a.y - lot.door[1]) < 4);
      for (const h of helpers) { h.activity = `helping build ${p.name} 🔨`; h.rep = Math.min(100, h.rep + dt * 0.008); }
      site.progress += dt / (p.hours * 60) * (1 + helpers.length * 0.5);
      if (site.progress >= 1) this.finish(lotId);
    }
  }

  finish(lotId) {
    const site = this.sites[lotId], p = PROJECTS[site.project], lot = this.lot(lotId);
    delete this.sites[lotId];
    this.built[lotId] = site.project;
    this.register(lotId, site.project);
    if (this.canvas) { this.draw(lotId, site.project); this.rebuild?.(); }
    this.society.log(p.icon, `${p.name} is finished and open on ${lot.name}!`, "economy", true);
    for (const a of this.sim.agents) if (a.doing === "build") a.dwellUntil = 0;
    this.emit("finish", { lot, p });
  }

  // make the new building part of the town: place, homes, jobs, buildings list
  register(lotId, pid) {
    const p = PROJECTS[pid], lot = this.lot(lotId), town = this.sim.town;
    const [dx, dy] = lot.door;
    town.places[p.place] = [];
    for (let x = dx - 2; x <= dx + 2; x++) if (town.walkable(x, dy)) town.places[p.place].push({ x, y: dy });
    PLACES[p.place] ??= { name: p.name, acts: p.acts ?? [`visiting ${p.name}`] };
    if (p.job && !WORKPLACES[p.place]) WORKPLACES[p.place] = { ...p.job };
    if (p.homes && !town.houses.some((h) => h.name === p.name)) town.houses.push({ door: { x: dx, y: dy }, name: p.name, capacity: p.homes });
    if (!BUILDINGS.some((b) => b.place === p.place)) BUILDINGS.push({ name: p.name, place: p.place, rect: this.rectFor(lot, p), door: [dx, dy] });
  }

  rectFor(lot, p) {
    const [lx, ly, lw, lh] = lot.rect, [, , aw, ah] = p.art;
    const scale = Math.min(1, (lw - 6) / aw, (lh - 6) / ah);
    const w = Math.round(aw * scale), h = Math.round(ah * scale);
    return [lx + Math.round((lw - w) / 2), ly + lh - h, w, h];
  }

  // copy the art onto the lot and paint the new sign in the picture's style
  draw(lotId, pid) {
    const g = this.canvas.getContext("2d"), p = PROJECTS[pid], lot = this.lot(lotId);
    const [ax, ay, aw, ah] = p.art, [x, y, w, h] = this.rectFor(lot, p);
    const src = document.createElement("canvas"); src.width = aw; src.height = ah;
    src.getContext("2d").drawImage(this.canvas, ax, ay, aw, ah, 0, 0, aw, ah);
    g.save();
    g.fillStyle = "rgba(20,40,10,0.35)"; g.fillRect(x + 6, y + 10, w, h - 6);
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 0, 0, aw, ah, x, y, w, h);
    // cover the old sign with a new one
    const signW = Math.max(70, g.measureText(p.label).width + 30), cx = x + w / 2, sy = y + h * 0.56;
    g.font = "bold 13px Georgia, 'Times New Roman', serif";
    const tw = g.measureText(p.label).width + 18;
    g.fillStyle = "#3b2414"; g.fillRect(cx - tw / 2 - 2, sy - 2, tw + 4, 22);
    g.fillStyle = "#8c5826"; g.fillRect(cx - tw / 2, sy, tw, 18);
    g.fillStyle = "#aa7034"; g.fillRect(cx - tw / 2 + 2, sy + 1, tw - 4, 2);
    g.fillStyle = "#f6e7c8"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(p.label, cx, sy + 10);
    if (p.emblem) {
      g.fillStyle = "#6e4826"; g.beginPath(); g.arc(cx, sy - 22, 13, 0, Math.PI * 2); g.fill();
      g.font = "15px serif"; g.fillText(p.emblem, cx, sy - 21);
    }
    g.restore();
    void signW;
  }

  // free-time options: help build, or use the new places
  options(a) {
    const out = [];
    const site = Object.entries(this.sites)[0];
    if (site) {
      const [lotId, s] = site, lot = this.lot(lotId), t = a.res.traits;
      out.push({ kind: "build", score: 15 + (t.diligence + t.generosity) * 25, place: "build", tile: lot.door, label: `going to help build ${PROJECTS[s.project].name}` });
    }
    if (this.isBuilt("theater") && this.sim.hour >= 17 && this.sim.hour < 23 && a.coins >= 5) out.push({ kind: "show", score: 20 + (100 - a.fun) * 0.5, place: "theater", label: "going to see a show at the Theater" });
    if (this.isBuilt("gym") && a.energy > 40) out.push({ kind: "workout", score: 10 + (100 - (a.health ?? 90)) * 0.6 + a.res.traits.diligence * 15, place: "gym", label: "going to work out" });
    return out;
  }
  onArrive(a) {
    if (a.doing === "show" && a.place === "theater") { a.coins -= 5; this.society.treasury += 2; a.fun = Math.min(100, a.fun + 30); a.mood = Math.min(100, a.mood + 5); a.activity = "watching a show at the Theater 🎭"; }
    if (a.doing === "workout" && a.place === "gym") { a.health = Math.min(100, (a.health ?? 90) + 15); a.energy = Math.max(0, a.energy - 15); a.fun = Math.min(100, a.fun + 8); a.activity = "working out 🏋️"; }
    if (a.place === "hospital" && a.doing === "clinic") { a.health = Math.min(100, (a.health ?? 90) + 60); a.sick = false; a.activity = "treated at the Hospital"; }
  }
  // the sick prefer the hospital when it exists
  clinicPlace() { return this.isBuilt("hospital") ? "hospital" : "clinic"; }

  serialize() { return { sites: this.sites, built: this.built }; }
  restore(s) {
    if (!s) return;
    this.sites = s.sites ?? {}; this.built = s.built ?? {};
    for (const [lot, pid] of Object.entries(this.built)) this.register(lot, pid);
  }
}
export { TILE };

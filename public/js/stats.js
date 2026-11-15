// Town statistics over time and milestones Gotham can reach.
const MILESTONES = [
  { id: "mayor", icon: "👑", name: "First mayor", desc: "Gotham elected its first mayor", check: (s) => !!s.mayor },
  { id: "couple", icon: "💞", name: "Love in the air", desc: "Two residents became a couple", check: (s) => s.sim.agents.some((a) => a.partner) },
  { id: "pop15", icon: "🏘️", name: "Growing town", desc: "15 residents live in Gotham", check: (s) => s.sim.agents.length >= 15 },
  { id: "pop20", icon: "🏙️", name: "Busy town", desc: "20 residents live in Gotham", check: (s) => s.sim.agents.length >= 20 },
  { id: "pop30", icon: "🌆", name: "Little city", desc: "30 residents live in Gotham", check: (s) => s.sim.agents.length >= 30 },
  { id: "treasury1000", icon: "🏦", name: "Full coffers", desc: "The treasury holds 1,000 coins", check: (s) => s.treasury >= 1000 },
  { id: "employed", icon: "💼", name: "Full employment", desc: "Every resident has a job", check: (s) => s.sim.agents.length >= 10 && s.sim.agents.every((a) => a.res.work) },
  { id: "happy", icon: "😊", name: "Happy town", desc: "Average mood reaches 75", check: (s) => avg(s.sim.agents, (a) => a.mood) >= 75 },
  { id: "hero", icon: "🦸", name: "Heroes of Gotham", desc: "Residents came together to face a disaster", check: (s) => s.gazette.some((e) => e.text.startsWith("Heroes of")) },
  { id: "carp", icon: "🐟", name: "The legend", desc: "Someone caught the golden carp", check: (s) => s.gazette.some((e) => /golden carp/.test(e.text)) },
  { id: "goal", icon: "🏅", name: "Dreams come true", desc: "A resident achieved a personal goal", check: (s) => s.sim.agents.some((a) => a.goalsDone > 0) },
  { id: "week", icon: "📅", name: "One week old", desc: "Gotham has been running for a week", check: (s) => s.sim.time >= 7 * 1440 },
  { id: "rebuilt", icon: "🏗️", name: "Built back better", desc: "A damaged building was rebuilt", check: (s) => s.gazette.some((e) => /has been rebuilt/.test(e.text)) },
];
const avg = (list, f) => (list.length ? list.reduce((sum, x) => sum + f(x), 0) / list.length : 0);

export const SERIES = [
  { key: "pop", label: "Population", color: "#60a5fa" },
  { key: "mood", label: "Average mood", color: "#f472b6", max: 100 },
  { key: "wealth", label: "Average coins", color: "#facc15" },
  { key: "treasury", label: "Treasury", color: "#4ade80" },
  { key: "employed", label: "Employment %", color: "#fb923c", max: 100 },
  { key: "health", label: "Average health", color: "#f87171", max: 100 },
];

export class Stats {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.history = [];
    this.reached = {}; // id -> day
  }
  get milestones() { return MILESTONES; }

  sample() {
    const agents = this.sim.agents;
    this.history.push({
      t: Math.floor(this.sim.time),
      pop: agents.length,
      mood: Math.round(avg(agents, (a) => a.mood)),
      wealth: Math.round(avg(agents, (a) => a.coins)),
      treasury: Math.round(this.society.treasury),
      employed: Math.round((agents.filter((a) => a.res.work).length / Math.max(1, agents.length)) * 100),
      health: Math.round(avg(agents, (a) => a.health ?? 90)),
    });
    if (this.history.length > 24 * 14) this.history.shift();
  }

  onHour() {
    this.sample();
    for (const m of MILESTONES) {
      if (this.reached[m.id]) continue;
      let ok = false;
      try { ok = m.check(this.society); } catch {}
      if (ok) {
        this.reached[m.id] = Math.floor(this.sim.time / 1440) + 1;
        this.society.log("🏆", `Milestone reached: ${m.name}! ${m.desc}.`, "community", true);
      }
    }
  }

  serialize() { return { history: this.history.slice(-24 * 7), reached: this.reached }; }
  restore(s) { if (!s) return; this.history = s.history ?? []; this.reached = s.reached ?? {}; }
}

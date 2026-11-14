// Jobs, housing and population: newcomers move in, workers get hired and fired, unhappy residents move away.
import { MODELS, COMMUNITIES, registerResident, unregisterResident } from "./residents.js";

// Every workplace in town, its job, pay, hours and how many people it employs.
export const WORKPLACES = {
  townhall: { title: "Town clerk", wage: 13, from: 9, to: 17, slots: 2 },
  library: { title: "Librarian", wage: 12, from: 9, to: 16, slots: 2 },
  store: { title: "Shopkeeper", wage: 12, from: 7, to: 15, slots: 2 },
  cafe: { title: "Inn worker", wage: 12, from: 8, to: 16, slots: 3 },
  police: { title: "Police officer", wage: 14, from: 8, to: 16, slots: 3 },
  clinic: { title: "Nurse", wage: 14, from: 9, to: 17, slots: 2 },
  market: { title: "Market vendor", wage: 10, from: 9, to: 16, slots: 3 },
  garden: { title: "Farmhand", wage: 10, from: 6, to: 13, slots: 2 },
  bakery: { title: "Baker", wage: 12, from: 5, to: 12, slots: 2 },
  school: { title: "Teacher", wage: 14, from: 8, to: 15, slots: 2 },
  bank: { title: "Banker", wage: 16, from: 9, to: 17, slots: 2 },
  post: { title: "Postal clerk", wage: 11, from: 7, to: 14, slots: 2 },
};

const NAMES = ["Ada", "Basil", "Cleo", "Dario", "Esme", "Felix", "Greta", "Hiro", "Ines", "Jules", "Kai", "Luna", "Milo", "Nadia", "Otto", "Pia", "Quinn", "Rosa", "Silas", "Tess", "Uma", "Vince", "Wren", "Xavi", "Yara", "Zane", "Iris", "Leo", "Maya", "Noor"];
const PERSONALITIES = [
  ["cheerful, chatty and a little nosy", "warm and talkative, loves gossip"],
  ["serious, hardworking and dependable", "short, practical sentences"],
  ["dreamy, artistic and easily distracted", "poetic, wanders off topic"],
  ["ambitious and competitive, wants to make a name in town", "confident, a bit boastful"],
  ["shy and kind, slowly opening up to neighbors", "soft-spoken, asks gentle questions"],
  ["sarcastic but secretly caring", "dry wit and teasing"],
  ["adventurous, always planning the next big thing", "excited, full of ideas"],
  ["thrifty and careful with money", "frank, talks about prices and savings"],
];
const SKIN = ["#f1c7a5", "#d9a07c", "#c68a62", "#8d5b3e", "#f5d0b5", "#e9b98f", "#fbd7bc", "#a86f4c"];
const HAIR = ["#2b1d14", "#5a3a1e", "#d8a24a", "#151515", "#c0533c", "#e8e1d4", "#3b2a4d", "#7f1d1d", "#1e3a8a"];
const SHIRT = ["#e07b39", "#4f9d8a", "#d04b6a", "#3d7cc9", "#6aa84f", "#e6c84a", "#7c4dbe", "#22a3a3", "#c2410c"];
const PANTS = ["#3a3550", "#2e2a24", "#4a3b2c", "#25344f", "#3c4a5e", "#292524"];
const STYLES = ["short", "long", "bun", "spiky", "cap"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

export class Population {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.arrivals = 0;
    this.departures = 0;
    this.departed = [];   // ids of residents who moved away
  }

  // ----- jobs -----
  staff(place) { return this.sim.agents.filter((a) => a.res.work?.place === place); }
  openJobs() {
    return Object.entries(WORKPLACES).filter(([k, w]) => this.staff(k).length < w.slots).map(([k, w]) => ({ place: k, ...w }));
  }
  hire(a, job) {
    a.res.work = { place: job.place, from: job.from, to: job.to, wage: job.wage };
    a.res.job = job.title;
    a.res.weights[job.place] = Math.max(a.res.weights[job.place] ?? 0, 3);
    a.skips = 0;
  }
  fire(a, why) {
    const was = a.res.job;
    a.res.work = null;
    a.res.job = "Unemployed";
    a.mood = Math.max(0, a.mood - 15);
    a.rep = Math.max(0, a.rep - 5);
    this.society.log("📉", `${a.res.name} was fired as ${was} (${why}).`, "work", true, a.id);
  }

  // ----- housing -----
  homes() { return this.sim.town.houses; }
  occupants(i) { return this.sim.agents.filter((a) => a.res.home === i).length; }
  freeHome() {
    const hs = this.homes();
    for (let i = 0; i < hs.length; i++) if (this.occupants(i) < (hs[i].capacity ?? 1)) return i;
    return -1;
  }
  capacity() { return this.homes().reduce((s, h) => s + (h.capacity ?? 1), 0); }

  // ----- hourly / daily rhythm (called by Society) -----
  onHour(h) {
    if (h === 9 || h === 15) this.maybeArrive();
    if (h === 8) this.jobHunt();
  }
  onShiftEnd(a, skipped) {
    if (!skipped) { a.skips = 0; return; }
    a.skips = (a.skips ?? 0) + 1;
    if (a.skips >= 3 && a.res.work) this.fire(a, "skipped too many shifts");
  }
  onNewDay() {
    for (const a of [...this.sim.agents]) {
      if (a.state === "jailed" || this.society.mayor === a.id) continue;
      const miserable = a.mood < 22 && (a.debt > 40 || !a.res.work || a.coins < 5);
      a.miserableDays = miserable ? (a.miserableDays ?? 0) + 1 : 0;
      if (a.miserableDays >= 2 && Math.random() < 0.6) this.leave(a);
    }
  }

  jobHunt() {
    for (const a of this.sim.agents) {
      if (a.res.work || a.state === "jailed") continue;
      const job = this.openJobs().sort((x, y) => y.wage - x.wage)[0];
      if (!job) continue;
      if (Math.random() < 0.3 + a.res.traits.diligence * 0.5 && a.rep >= 20) {
        this.hire(a, job);
        a.mood = Math.min(100, a.mood + 15);
        this.society.log("💼", `${a.res.name} got hired as ${job.title} at ${placeLabel(job.place)}.`, "work", true, a.id);
      }
    }
  }

  maybeArrive() {
    const home = this.freeHome();
    if (home < 0) return;
    const agents = this.sim.agents;
    const avgMood = agents.reduce((s, a) => s + a.mood, 0) / Math.max(1, agents.length);
    const jobs = this.openJobs();
    const appeal = (jobs.length ? 0.45 : 0.1) + (avgMood - 50) / 120 + (this.society.law("curfew") ? -0.05 : 0) + (this.society.taxRate() > 0.2 ? -0.1 : 0);
    if (Math.random() > appeal) return;
    this.arrive(home, jobs.sort(() => Math.random() - 0.5)[0]);
  }

  arrive(home, job) {
    const used = new Set(this.sim.agents.map((a) => a.res.name));
    const name = NAMES.find((n) => !used.has(n) && !this.departed.includes(n.toLowerCase())) ?? `${pick(NAMES)} ${Math.floor(Math.random() * 90 + 10)}`;
    const model = pick(Object.keys(MODELS));
    const [personality, style] = pick(PERSONALITIES);
    const community = pick(Object.keys(COMMUNITIES));
    const res = {
      id: `n_${name.toLowerCase().replace(/\W+/g, "")}_${Date.now().toString(36).slice(-4)}`,
      name, model, home, newcomer: true,
      role: job ? `a newcomer who moved to Gotham to work as a ${job.title.toLowerCase()} at ${placeLabel(job.place)}` : "a newcomer looking for work in Gotham",
      personality, style,
      weights: { plaza: 2, market: 2, cafe: 2, park: 1, store: 1, library: 1 },
      sleep: [22 + Math.floor(Math.random() * 2), 6 + Math.floor(Math.random() * 2)],
      look: { skin: pick(SKIN), hair: pick(HAIR), hairStyle: pick(STYLES), shirt: pick(SHIRT), pants: pick(PANTS) },
      traits: { diligence: 0.4 + Math.random() * 0.5, rebel: Math.random() * 0.8, ambition: Math.random(), generosity: Math.random() },
      community, job: "Unemployed", work: null,
      topics: [
        "I just moved here. Still learning where everything is!",
        "Gotham's a lot busier than my old town.",
        job ? `Starting my new job at ${placeLabel(job.place)}. Wish me luck!` : "I'm still hunting for a job. Know anyone hiring?",
        "The waterfall up north is the prettiest thing I've seen in ages.",
      ],
      questions: ["How long have you lived here?", "Any tips for a newcomer?", "Who should I vote for in the election?"],
    };
    if (job) { res.work = { place: job.place, from: job.from, to: job.to, wage: job.wage }; res.job = job.title; res.weights[job.place] = 3; }
    const a = this.sim.addResident(res, true);
    a.x = 23; a.y = 46; // arrives through South Gotham
    this.arrivals++;
    this.society.log("🧳", `${name} (${MODELS[model].label}) moved into ${this.homes()[home].name}${job ? ` to work as ${job.title} at ${placeLabel(job.place)}` : " and is looking for work"}.`, "community", true, a.id);
    return a;
  }

  leave(a) {
    this.departures++;
    this.departed.push(a.id);
    const why = !a.res.work ? "couldn't find work" : a.debt > 40 ? "was drowning in debt" : "was unhappy";
    this.society.log("🚚", `${a.res.name} moved away from Gotham because they ${why}.`, "community", true);
    this.sim.removeResident(a);
  }

  stats() {
    const agents = this.sim.agents;
    const employed = agents.filter((a) => a.res.work).length;
    const slots = Object.values(WORKPLACES).reduce((s, w) => s + w.slots, 0);
    return { population: agents.length, employed, unemployed: agents.length - employed, capacity: this.capacity(), openJobs: this.openJobs().reduce((s, j) => s + (j.slots - this.staff(j.place).length), 0), slots, arrivals: this.arrivals, departures: this.departures };
  }

  serialize() {
    return {
      arrivals: this.arrivals, departures: this.departures, departed: this.departed,
      newcomers: this.sim.agents.filter((a) => a.res.newcomer).map((a) => a.res),
      jobs: Object.fromEntries(this.sim.agents.map((a) => [a.id, { work: a.res.work, job: a.res.job, skips: a.skips ?? 0 }])),
    };
  }
  restore(s) {
    if (!s) return;
    this.arrivals = s.arrivals ?? 0; this.departures = s.departures ?? 0; this.departed = s.departed ?? [];
    for (const id of this.departed) { const a = this.sim.agents.find((x) => x.id === id); if (a) this.sim.removeResident(a, true); }
    for (const res of s.newcomers ?? []) if (!this.sim.agents.some((a) => a.id === res.id)) this.sim.addResident(res, false);
    for (const a of this.sim.agents) { const j = s.jobs?.[a.id]; if (j) { a.res.work = j.work; a.res.job = j.job; a.skips = j.skips; } }
  }
}

export const placeLabel = (k) => ({ cafe: "the Inn", store: "the General Store", townhall: "Town Hall", library: "the Library", police: "the Police station", clinic: "the Clinic", market: "the Market", garden: "the farm", bakery: "the Bakery", school: "the School", bank: "the Bank", post: "the Post Office" })[k] ?? k;
export { registerResident, unregisterResident };

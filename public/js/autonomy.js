// Autonomy: every resident has personal goals and dreams, thinks about what to do next,
// and tries things that can fail. Live AI models decide for themselves; others follow their instincts.
import { ACTIVITIES } from "./life.js";
import { WORKPLACES, placeLabel } from "./population.js";

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const between = (a, b) => Math.round(a + Math.random() * (b - a));

// Goals residents can set for themselves. progress(a, society) returns the current count.
export const GOALS = {
  save: { label: (t) => `save up ${t} coins`, target: () => between(15, 40) * 10, progress: (a) => Math.floor(a.coins), absolute: true, bias: { work: 15, fish: 6, garden: 6, sell: 12 } },
  fisher: { label: (t) => `catch ${t} fish`, target: () => between(5, 12), progress: (a) => a.catches ?? 0, bias: { fish: 35 } },
  bigfish: { label: () => "land a salmon or something bigger", target: () => 1, progress: (a) => a.bigCatches ?? 0, bias: { fish: 30 } },
  grower: { label: (t) => `grow ${t} vegetables`, target: () => between(6, 14), progress: (a) => a.vegGrown ?? 0, bias: { garden: 35 } },
  friends: { label: (t) => `make ${t} close friends`, target: () => between(2, 4), progress: (a) => Object.values(a.rel ?? {}).filter((n) => n >= 3).length, absolute: true, bias: { socialize: 30, event: 15 } },
  mayor: { label: () => "become mayor of Gotham", target: () => 1, progress: (a, s) => (s.mayor === a.id ? 1 : 0), absolute: true, bias: { socialize: 18, event: 12 } },
  job: { label: () => "land a better-paying job", target: () => 1, progress: (a) => (a.res.work && a.res.work.wage >= (a.goal?.startWage ?? 0) + 2 ? 1 : 0), absolute: true, bias: { apply: 45 } },
  events: { label: (t) => `go to ${t} community events`, target: () => between(2, 4), progress: (a) => a.eventsAttended ?? 0, bias: { event: 35 } },
  reader: { label: (t) => `read at the Library ${t} times`, target: () => between(3, 6), progress: (a) => a.readCount ?? 0, bias: { read: 30 } },
};

const DREAMS = {
  save: ["Buy a cottage of my own one day.", "Never worry about rent again."],
  fisher: ["Become the best angler in Gotham.", "Catch the legendary golden carp."],
  bigfish: ["Catch the legendary golden carp.", "Have my photo on the Inn wall holding a giant pike."],
  grower: ["Win the Harvest Festival with the biggest pumpkin.", "Feed the whole town from the Community Garden."],
  friends: ["Know every neighbor by name.", "Have friends to share every meal with."],
  mayor: ["Lead Gotham into a golden age.", "See my name carved on the Town Hall wall."],
  job: ["Find work I'm genuinely proud of.", "Earn enough to stop counting coins."],
  events: ["Never miss a party in Gotham.", "Help organize the biggest festival this town has seen."],
  reader: ["Read every book in the Library.", "Write a book about Gotham someday."],
};

export class Autonomy {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.inflight = 0;
    this.thoughts = []; // recent thoughts for the Live tab
  }

  initAgent(a) {
    a.goal = null; a.goalsDone = 0; a.dream = null; a.thought = null;
    a.vegGrown = 0; a.bigCatches = 0; a.eventsAttended = 0; a.readCount = 0;
    a.lastDecide = -999; a.lastApply = -9999;
  }

  // ----- goals -----
  instinctGoal(a) {
    const t = a.res.traits, L = a.likes ?? {};
    const scored = [
      ["save", 20 + (a.coins < 60 ? 30 : 0) + t.diligence * 20],
      ["fisher", (L.fish ?? 0.5) * 50],
      ["bigfish", (L.fish ?? 0.5) * 30],
      ["grower", (L.garden ?? 0.5) * 45],
      ["friends", (L.socialize ?? 0.5) * 40 + t.generosity * 15],
      ["mayor", t.ambition * 60 - 15],
      ["job", !a.res.work ? 80 : (a.res.work.wage < 12 ? 25 : 0) + t.ambition * 10],
      ["events", (L.socialize ?? 0.5) * 30],
      ["reader", (L.read ?? 0.5) * 40],
    ].map(([k, s]) => [k, s + Math.random() * 20]).sort((x, y) => y[1] - x[1]);
    return scored[0][0];
  }

  setGoal(a, id, why, dream) {
    const g = GOALS[id] ?? GOALS[this.instinctGoal(a)];
    const key = GOALS[id] ? id : Object.keys(GOALS).find((k) => GOALS[k] === g);
    const target = g.target();
    a.goal = { id: key, target, base: g.absolute ? 0 : g.progress(a, this.society), startWage: a.res.work?.wage ?? 0, why: why ?? "", label: g.label(target) };
    a.dream = dream || a.dream || pick(DREAMS[key] ?? ["Make something of myself in Gotham."]);
  }

  goalProgress(a) {
    if (!a.goal) return 0;
    const g = GOALS[a.goal.id];
    return Math.max(0, g.progress(a, this.society) - a.goal.base);
  }

  checkGoals() {
    for (const a of this.sim.agents) {
      if (!a.goal) continue;
      if (this.goalProgress(a) >= a.goal.target) {
        a.goalsDone++;
        a.mood = clamp(a.mood + 15); a.rep = clamp(a.rep + 3); a.fun = clamp((a.fun ?? 50) + 10);
        this.society.log("🏅", `${a.res.name} achieved a personal goal: ${a.goal.label}!`, "community", true, a.id);
        a.memories.push({ about: a.id, text: `I finally managed to ${a.goal.label}.`, time: "" });
        this.think(a, pick(["I did it! Time for a new challenge.", "That feels amazing. What's next?", `Can't believe I managed to ${a.goal.label}.`]), true);
        a.goal = null;
      }
    }
  }

  // bias added to an activity's score by the resident's goal
  bias(a, kind) { return a.goal ? GOALS[a.goal.id]?.bias?.[kind] ?? 0 : 0; }

  // ----- trying things: job applications -----
  applyOption(a) {
    const s = this.society;
    if (this.sim.time - a.lastApply < 1200) return null;
    const want = !a.res.work || a.goal?.id === "job";
    if (!want) return null;
    const open = s.population.openJobs().filter((j) => !a.res.work || j.wage > a.res.work.wage).sort((x, y) => y.wage - x.wage)[0];
    if (!open) return null;
    return { kind: "apply", score: (a.res.work ? 25 : 60) + this.bias(a, "apply"), place: open.place, label: `going to apply for a job at ${placeLabel(open.place)}`, job: open };
  }

  onArrive(a) {
    const s = this.society;
    if (a.doing === "read" && a.place === "library") a.readCount = (a.readCount ?? 0) + 1;
    if (a.doing === "event" && a.place === "events" && s.life.event?.active && !s.life.event.attendees.has(a.id)) a.eventsAttended = (a.eventsAttended ?? 0) + 1;
    if (a.doing === "apply" && a.applyJob) {
      const job = a.applyJob; a.applyJob = null; a.lastApply = this.sim.time;
      const stillOpen = s.population.openJobs().some((j) => j.place === job.place);
      const chance = 0.35 + a.rep / 160 + a.res.traits.diligence * 0.2 - a.record.jailed * 0.1;
      if (stillOpen && Math.random() < chance) {
        const old = a.res.job;
        s.population.hire(a, job);
        a.mood = clamp(a.mood + 18);
        s.log("💼", `${a.res.name} applied at ${placeLabel(job.place)} and got the job as ${job.title}${old && old !== "Unemployed" ? ` (leaving their job as ${old})` : ""}!`, "work", true, a.id);
        this.think(a, "They said yes! I start tomorrow.", true);
      } else {
        a.mood = clamp(a.mood - 6);
        s.log("📝", `${a.res.name} applied at ${placeLabel(job.place)} but was turned down${stillOpen ? "" : " (the position was filled)"}.`, "work", false, a.id);
        this.think(a, pick(["Rejected. I'll try somewhere else.", "Not this time. I won't give up.", "Ouch. Maybe I need a better reputation."]), true);
      }
    }
  }

  // ----- thoughts -----
  think(a, text, show = false) {
    a.thought = text;
    this.thoughts.unshift({ id: a.id, name: a.res.name, text, t: this.sim.time });
    if (this.thoughts.length > 40) this.thoughts.pop();
    if (show && a.state !== "talking" && !a.bubble) a.bubble = { text, thought: true, born: this.sim.realTime, until: this.sim.realTime + 6 };
  }

  instinctThought(a, o) {
    const g = a.goal;
    const lines = {
      fish: [g?.id === "fisher" || g?.id === "bigfish" ? `I need to ${g.label}. To the water!` : "A quiet afternoon by the water sounds perfect.", "Maybe today's the day I catch something big."],
      garden: [g?.id === "grower" ? `Every vegetable counts if I want to ${g.label}.` : "My tomatoes need me.", "Nothing beats getting my hands in the soil."],
      sell: ["My bag's full. Time to turn it into coins.", "Let's see what the market pays today."],
      socialize: ["I could use some company.", "Feeling a bit lonely. Who's around?"],
      event: ["I'm not missing this event!", "Everyone will be there tonight."],
      nap: ["I can barely keep my eyes open.", "A short nap and I'll be good as new."],
      eat: ["My stomach's growling.", "Food first, everything else later."],
      read: ["A good book would hit the spot.", "Back to that novel I left at the Library."],
      shop: ["Just a little look around the stalls.", "Let's see what's new at the market."],
      stroll: ["A walk will clear my head.", "Some fresh air, I think."],
      work: [a.goal?.id === "save" ? `Every shift gets me closer: ${a.goal.label}.` : "Back to work.", "Bills don't pay themselves."],
      apply: ["Time to go after that job.", "Fingers crossed, I'm applying today."],
    }[o.kind];
    return lines ? pick(lines) : null;
  }

  canDecide(a) { return !!this.sim.liveModels[a.res.model] && this.inflight < 2 && this.sim.time - a.lastDecide >= 90; }

  // Live AI models decide their own next move from the options their life gives them.
  async decide(a, options) {
    if (!this.canDecide(a)) return null;
    a.lastDecide = this.sim.time;
    this.inflight++;
    try {
      const menu = options.slice(0, 7).map((o, i) => ({ id: `o${i}`, kind: o.kind, label: o.label ?? `spend time at ${placeLabel(o.place) ?? o.place}` }));
      const res = await fetch("/api/think", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "decide", agentId: a.id, persona: this.sim.personaOf(a), situation: this.society.situation(a), options: menu }),
      });
      if (!res.ok) return null;
      const r = await res.json();
      const i = menu.findIndex((m) => m.id === r.choice);
      if (i < 0) return null;
      if (r.thought) this.think(a, String(r.thought).slice(0, 160), Math.random() < 0.6);
      return options[i];
    } catch { return null; } finally { this.inflight--; }
  }

  situation(a) {
    if (!a.goal && !a.dream) return "";
    return [
      a.goal ? `Your personal goal: ${a.goal.label} (progress ${Math.min(this.goalProgress(a), a.goal.target)}/${a.goal.target}).` : "",
      a.dream ? `Your dream: ${a.dream}` : "",
      a.goalsDone ? `Goals you've achieved so far: ${a.goalsDone}.` : "",
    ].filter(Boolean).join("\n");
  }

  serialize() {
    return Object.fromEntries(this.sim.agents.map((a) => [a.id, { goal: a.goal, goalsDone: a.goalsDone, dream: a.dream, vegGrown: a.vegGrown, bigCatches: a.bigCatches, eventsAttended: a.eventsAttended, readCount: a.readCount }]));
  }
  restore(s) { for (const a of this.sim.agents) if (s?.[a.id]) Object.assign(a, s[a.id]); }
}

export { GOALS as GOAL_TYPES, ACTIVITIES, WORKPLACES };

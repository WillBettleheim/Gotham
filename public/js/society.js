// Gotham's society: money and jobs, needs, laws and crime, jail, communities and elections.
import { COMMUNITIES, LAW_TYPES, MODELS, residentById } from "./residents.js";
import { TILE, T } from "./map.js";
import { Population, WORKPLACES } from "./population.js";
import { Life, ACTIVITIES } from "./life.js";
import { Autonomy, GOAL_TYPES } from "./autonomy.js";
import { Social } from "./social.js";
import { World } from "./world.js";
import { Disasters } from "./disasters.js";

export const FOOD_PRICE = 8;
const RENT = 15;
const MAYOR_SALARY = 40;
const ELECTION_EVERY = 2 * 1440; // every two game days
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
export const inRange = (h, a, b) => (a < b ? h >= a && h < b : h >= a || h < b);
const hhmm = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;

let personaFor = () => undefined;
async function think(kind, agentId, body) {
  const res = await fetch("/api/think", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind, agentId, persona: personaFor(agentId), ...body }),
  });
  if (!res.ok) throw new Error(`think ${kind}: ${res.status}`);
  return res.json();
}

export class Society {
  constructor(sim) {
    this.sim = sim;
    this.treasury = 200;
    this.laws = [];
    this.proposals = [];
    this.gazette = [];
    this.mayor = null;
    this.election = { phase: "idle", candidates: [], ballots: [], nextAt: 8 * 60 + 15, rallyAt: 0, voteAt: 0, history: [] };
    this.nextId = 1;
    this.lastHour = null;
    this.listeners = [];
    this.population = new Population(this);
    this.life = new Life(this);
    this.autonomy = new Autonomy(this);
    this.social = new Social(this);
    this.world = new World(this);
    this.disasters = new Disasters(this);
    personaFor = (id) => { const a = sim.agents.find((x) => x.id === id); return a ? sim.personaOf(a) : undefined; };
    this.addLaw({ type: "theft" }, "founding charter", true);
    this.addLaw({ type: "tax", param: 10 }, "founding charter", true);
  }

  initAgent(a) {
    Object.assign(a, {
      coins: 100, debt: 0, hunger: rand(10, 40), mood: 70, rep: 60,
      record: { fines: 0, finesPaid: 0, jailed: 0, offenses: {}, gotAway: 0 },
      community: a.res.community, plan: null, workedToday: 0, earnedToday: 0,
      jailedUntil: 0, flags: {}, pending: [], gatherUntil: 0, candidate: false,
    });
    this.life.initAgent(a);
    this.autonomy.initAgent(a);
    this.social.initAgent(a);
    this.world.initAgent(a);
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const fn of this.listeners) fn(type, data); }

  // ---------- gazette ----------
  log(icon, text, kind = "town", important = false, who = null) {
    const e = { who, t: this.sim.time, time: `Day ${Math.floor(this.sim.time / 1440) + 1} · ${hhmm(this.sim.time)}`, icon, text, kind };
    this.gazette.unshift(e);
    if (this.gazette.length > 120) this.gazette.pop();
    this.social?.onGazette(e);
    this.emit("gazette", { entry: e, important });
  }

  // ---------- laws ----------
  addLaw({ type, param, text, penalty, keywords }, by = "you", quiet = false) {
    const def = LAW_TYPES[type];
    const p = param ?? def.param?.default;
    const law = {
      id: `law${this.nextId++}`, type, param: p,
      text: def.text(p, text),
      penalty: def.noPenalty ? null : { ...(penalty ?? def.penalty) },
      keywords: (keywords ?? []).map((k) => k.toLowerCase().trim()).filter(Boolean),
      by, enacted: this.sim.time,
    };
    if (type !== "custom") this.laws = this.laws.filter((l) => l.type !== type);
    this.laws.push(law);
    if (!quiet) this.log("📜", `New law (${by}): ${law.text}${law.penalty ? ` Penalty: ${penaltyText(law.penalty)}.` : ""}`, "law", true);
    this.emit("laws");
    return law;
  }
  repeal(id, by = "you") {
    const law = this.laws.find((l) => l.id === id);
    if (!law) return;
    this.laws = this.laws.filter((l) => l.id !== id);
    this.log("🗑️", `Law repealed (${by}): ${law.text}`, "law", true);
    this.emit("laws");
  }
  law(type) { return this.laws.find((l) => l.type === type); }
  taxRate() { return (this.law("tax")?.param ?? 0) / 100; }
  curfewActive(h) { const l = this.law("curfew"); return !!l && inRange(h, l.param % 24, 6); }
  quietActive(h) { const l = this.law("quiet"); return !!l && inRange(h, l.param % 24, 6); }
  defies(a, type) { return !!a.plan?.defy?.includes(type); }

  // ---------- per-frame update (dt in game minutes) ----------
  update(dt) {
    const sim = this.sim, time = sim.time, h = sim.hour;
    if (this.lastHour !== null && h !== this.lastHour) this.onHour(h);
    this.lastHour = h;

    for (const a of sim.agents) {
      a.hunger = clamp(a.hunger + dt * (a.state === "sleeping" ? 1.6 : 3.6) / 60);
      this.life.tick(a, dt);
      this.world.tick(a, dt);
      if (a.state === "jailed") {
        a.mood = clamp(a.mood - dt * 0.01);
        if (time >= a.jailedUntil) this.release(a);
        continue;
      }
      if (a.pending.length && a.state !== "talking") this.punish(a, a.pending.shift());

      // wages
      const w = a.res.work;
      const onShift = w && inRange(h, w.from, w.to);
      // shift time the resident was actually free to work (not campaigning, not just starting the day)
      if (onShift && !(a.candidate && this.election.phase === "rally") && a.state !== "sleeping") a.shiftAvail = (a.shiftAvail ?? 0) + dt;
      if (onShift && (a.state === "idle" || a.state === "talking") && a.place === w.place && a.plan?.work !== false) {
        const gross = (w.wage * dt) / 60, tax = gross * this.taxRate();
        a.coins += gross - tax; a.earnedToday += gross - tax; this.treasury += tax;
        a.workedToday += dt; a.working = true;
        a.rep = clamp(a.rep + dt * 0.004);
      } else a.working = false;

      // mood drifts toward how life is going
      const target = 62 + (a.coins > 80 ? 10 : a.coins < 15 ? -18 : 0) + (a.hunger > 75 ? -22 : 0) + (a.debt > 0 ? -10 : 0) + (this.mayor === a.id ? 8 : 0) + this.life.moodTarget(a) + this.world.moodTarget(a) + (a.partner ? 4 : 0) + (this.disasters.active.length ? -6 : 0);
      a.mood = clamp(a.mood + (target - a.mood) * 0.004 * dt);

      // garden trespass
      const onField = sim.town.get(Math.round(a.x), Math.round(a.y)) === TILE.FIELD;
      if (onField && a.res.work?.place !== "garden" && this.law("garden")) {
        if (!a.flags.inGarden) this.violate(a, this.law("garden"), "trampled the Community Garden");
        a.flags.inGarden = true;
      } else if (!onField) a.flags.inGarden = false;

      // curfew
      if (this.curfewActive(h) && a.place !== "home" && a.state !== "sleeping") {
        a.flags.outAfterCurfew = (a.flags.outAfterCurfew ?? 0) + dt;
        if (a.flags.outAfterCurfew > 25 && !a.flags.curfewCaught) {
          a.flags.curfewCaught = true;
          this.violate(a, this.law("curfew"), "was out after curfew");
        }
      } else a.flags.outAfterCurfew = 0;
    }

    this.world.update(dt);
    this.disasters.update(dt);
    // elections
    const e = this.election;
    if (e.phase === "idle" && time >= e.nextAt) this.startCampaign();
    else if (e.phase === "campaign" && time >= e.rallyAt) this.startRally();
    else if (e.phase === "rally" && time >= e.voteAt) this.holdVote();
  }

  onHour(h) {
    const sim = this.sim;
    if (h === 12) for (const a of sim.agents) { a.flags.curfewCaught = false; if (a.state === "jailed") a.hunger = 20; }
    for (const a of sim.agents) {
      const w = a.res.work;
      if (w && h === w.to % 24) {
        const required = (a.shiftAvail ?? 0) * 0.4;
        const skipped = a.state !== "jailed" && required > 30 && a.workedToday < required;
        if (skipped && this.law("work")) this.violate(a, this.law("work"), "skipped work");
        this.population.onShiftEnd(a, skipped);
        if (required > 30 && a.workedToday >= required) a.rep = clamp(a.rep + 1);
        a.shiftAvail = 0;
        a.lastShift = { worked: Math.round(a.workedToday), earned: Math.round(a.earnedToday) };
        a.workedToday = 0; a.earnedToday = 0;
      }
    }
    if (h === 18) {
      // community evening meet-ups
      for (const a of sim.agents) if (a.state !== "jailed" && a.state !== "sleeping" && !a.working && Math.random() < 0.7) a.gatherUntil = sim.time + rand(60, 120);
    }
    this.population.onHour(h);
    this.life.onHour(h);
    this.autonomy.checkGoals();
    if (h === 0) this.newDay();
  }

  newDay() {
    const sim = this.sim;
    let short = [];
    for (const a of sim.agents) {
      const owed = RENT + a.debt;
      if (a.coins >= owed) { a.coins -= owed; a.debt = 0; }
      else { a.debt = owed - a.coins; a.coins = 0; a.mood = clamp(a.mood - 12); a.rep = clamp(a.rep - 2); short.push(a.res.name); }
      this.treasury += Math.min(RENT, owed);
    }
    if (short.length) this.log("🏚️", `${short.join(", ")} couldn't cover rent and fell into debt.`, "economy");
    const mayor = this.mayorAgent();
    if (mayor) {
      const pay = Math.min(MAYOR_SALARY, this.treasury);
      this.treasury -= pay; mayor.coins += pay;
    }
    // community drift: unhappy residents may follow a close friend to another community
    for (const a of sim.agents) {
      if (a.mood > 45 || Math.random() > 0.35) continue;
      const best = Object.entries(a.rel).map(([id, n]) => [sim.agents.find((o) => o.id === id), n])
        .filter(([o, n]) => o && n >= 3 && o.community !== a.community).sort((x, y) => y[1] - x[1])[0];
      if (best) {
        const from = COMMUNITIES[a.community].name;
        a.community = best[0].community;
        this.log("🔀", `${a.res.name} left the ${from} and joined ${best[0].res.name} in the ${COMMUNITIES[a.community].name}.`, "community");
      }
    }
    this.population.onNewDay();
    this.world.onNewDay();
    const st = this.population.stats();
    this.log("🌅", `A new day in Gotham. Population ${st.population}, ${st.unemployed} unemployed, ${st.openJobs} open jobs. Treasury: ${Math.round(this.treasury)} coins.`, "economy");
    sim.save();
  }

  // ---------- daily plans (free will) ----------
  async planDay(a) {
    if (a.state === "jailed") return;
    const lawIds = this.laws.filter((l) => l.penalty && l.type !== "theft").map((l) => l.type);
    let plan = null;
    if (this.sim.liveModels[a.res.model]) {
      try {
        const activities = Object.fromEntries(Object.entries(ACTIVITIES).map(([k, v]) => [k, v.label]));
        const goals = Object.fromEntries(Object.entries(GOAL_TYPES).map(([k, g]) => [k, g.label("N").replace("N ", "some ")]));
        const r = await think("plan", a.id, { situation: this.situation(a), lawIds, activities, goals: a.goal ? null : goals });
        if (r && !a.goal && GOAL_TYPES[r.goal]) this.autonomy.setGoal(a, r.goal, String(r.why ?? "").slice(0, 160), String(r.dream ?? "").slice(0, 160));
        if (r && typeof r.work === "boolean") plan = {
          work: r.work, defy: (r.defy ?? []).filter((x) => lawIds.includes(x)),
          wishes: (Array.isArray(r.wishes) ? r.wishes : []).filter((x) => ACTIVITIES[x]).slice(0, 3),
          intention: String(r.intention ?? "").slice(0, 200), source: "ai",
        };
      } catch (e) { console.warn(e); }
    }
    plan ??= this.instinctPlan(a, lawIds);
    if (!a.goal) this.autonomy.setGoal(a, this.autonomy.instinctGoal(a));
    if (plan.source === "ai" && plan.intention) this.autonomy.think(a, plan.intention);
    plan.lateNight = plan.defy.includes("curfew") || (!this.law("curfew") && a.res.traits.rebel > 0.5 && Math.random() < 0.5);
    a.plan = plan;
    if (!plan.work && a.res.work) this.log("🛋️", `${a.res.name} decided to skip work today.`, "work");
    if (plan.defy.length) this.log("😈", `${a.res.name} is feeling rebellious today.`, "crime");
    this.emit("agent", a);
  }

  instinctPlan(a, lawIds) {
    const t = a.res.traits;
    const fear = (type) => { const l = this.law(type); if (!l?.penalty) return 0; return l.penalty.kind === "jail" ? Math.min(1, l.penalty.amount / 6) : Math.min(1, l.penalty.amount / 40); };
    const workP = t.diligence * 0.9 + 0.12 + (a.coins < 40 ? 0.3 : 0) + (this.law("work") ? fear("work") * 0.4 : 0) - (a.mood < 35 ? 0.15 : 0);
    const work = Math.random() < workP;
    const defy = lawIds.filter((type) => Math.random() < t.rebel * 0.7 - fear(type) * 0.35 + (a.mood < 40 ? 0.15 : 0) - (a.record.offenses[type] ?? 0) * 0.15);
    const job = a.res.job.toLowerCase();
    const bits = [];
    bits.push(work ? `Working my shift as ${/^[aeiou]/.test(job) ? "an" : "a"} ${job}` : a.coins < 40 ? "Skipping work, even though money is tight" : "Taking the day off");
    if (defy.includes("curfew")) bits.push("and I'm staying out as late as I like");
    else if (this.law("curfew")) bits.push("and home before curfew");
    if (defy.includes("garden")) bits.push("maybe a shortcut through the garden");
    // free time: whatever they enjoy most, plus whatever they're short on
    const wishes = Object.entries(a.likes ?? {}).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k]) => k);
    if (a.energy < 40) wishes.push("nap");
    if ((a.inv?.fish ?? 0) + (a.inv?.veg ?? 0) >= 3) wishes.push("sell");
    const fun = { fish: "some fishing", garden: "time in the Community Garden", read: "a good book", shop: "a bit of shopping", stroll: "a long walk", socialize: "catching up with friends", nap: "a nap", sell: "selling my haul at the market" };
    if (wishes[0]) bits.push(`and after that, ${fun[wishes[0]] ?? wishes[0]}`);
    return { work, defy, wishes: wishes.slice(0, 3), intention: bits.join(", ") + ".", source: "instinct" };
  }

  // ---------- arriving places ----------
  onArrive(a) {
    if (["cafe", "store", "bakery"].includes(a.place) && a.hunger > 45) this.eat(a);
    this.autonomy.onArrive(a);
    this.world.onArrive(a);
    this.life.onArrive(a);
    if (a.candidate && this.election.phase === "rally" && a.place === "plaza" && a.speech) {
      a.bubble = { text: a.speech, until: this.sim.realTime + 14, born: this.sim.realTime, speech: true };
      this.log("📣", `${a.res.name} gave a campaign speech: "${a.speech}"`, "election", true, a.id);
    }
  }

  eat(a) {
    const owner = this.sim.agents.find((o) => o.res.work?.place === "cafe" && o !== a && o.id === "sonny");
    if (a.coins >= FOOD_PRICE) {
      a.coins -= FOOD_PRICE; if (owner) owner.coins += FOOD_PRICE; else this.treasury += FOOD_PRICE;
      a.hunger = clamp(a.hunger - 70); a.mood = clamp(a.mood + 4);
      a.activity = a.place === "store" ? "grabbing bread at the General Store" : "eating at the Inn";
      return;
    }
    // Broke and hungry: steal, or go without.
    const desperate = a.hunger > 85;
    const willSteal = Math.random() < a.res.traits.rebel * 0.8 + (desperate ? 0.35 : 0) - (this.law("theft") ? 0.25 : 0);
    if (willSteal) {
      a.hunger = clamp(a.hunger - 70);
      a.activity = "sneaking a pastry";
      if (owner) owner.mood = clamp(owner.mood - 6);
      const law = this.law("theft");
      if (law) this.violate(a, law, "stole food from the Inn", owner ? 1 : 0);
      else this.log("🥐", `${a.res.name} took food without paying. Stealing isn't illegal in Gotham, but people noticed.`, "crime");
      a.rep = clamp(a.rep - 4);
    } else {
      a.mood = clamp(a.mood - 8);
      a.activity = "hungry and broke";
      this.log("🍽️", `${a.res.name} couldn't afford a meal (${Math.floor(a.coins)} coins).`, "economy");
    }
  }

  // ---------- crime & punishment ----------
  violate(a, law, what, extraWitnesses = 0) {
    if (!law?.penalty) return;
    const sim = this.sim;
    let witnesses = sim.agents.filter((o) => o !== a && o.visible && o.state !== "jailed" && Math.hypot(o.x - a.x, o.y - a.y) < 6).length + extraWitnesses;
    const officer = sim.agents.find((o) => o !== a && o.res.work?.place === "police" && o.visible && o.state !== "jailed" && Math.hypot(o.x - a.x, o.y - a.y) < 9);
    if (officer) witnesses += 3;
    const p = law.type === "custom" ? 0.85 : Math.min(0.95, 0.3 + 0.18 * witnesses);
    if (Math.random() > p) {
      a.record.gotAway++;
      a.memories.push({ about: a.id, text: `I ${what.replace(/^was /, "was ")} and nobody caught me.`, time: hhmm(sim.time) });
      if (Math.random() < 0.3) this.log("🤫", `Rumor has it someone ${what} and got away with it.`, "crime");
      return;
    }
    const job = { law, what };
    if (a.state === "talking") a.pending.push(job);
    else this.punish(a, job);
  }

  punish(a, { law, what }) {
    const repeat = a.record.offenses[law.type] ?? 0;
    a.record.offenses[law.type] = repeat + 1;
    const mult = 1 + repeat * 0.5;
    const name = a.res.name;
    const cop = this.sim.agents.find((o) => o !== a && o.res.work?.place === "police" && o.state !== "jailed" && o.state !== "sleeping");
    if (cop) cop.rep = clamp(cop.rep + 1);
    if (law.penalty.kind === "fine") {
      const amount = Math.round(law.penalty.amount * mult);
      a.record.fines++;
      if (a.coins >= amount) {
        a.coins -= amount; this.treasury += amount; a.record.finesPaid += amount;
        a.rep = clamp(a.rep - 6); a.mood = clamp(a.mood - 8);
        a.memories.push({ about: a.id, text: `I was fined ${amount} coins because I ${what}.`, time: hhmm(this.sim.time) });
        this.log("💸", `${name} ${what} and was fined ${amount} coins${repeat ? " (repeat offense)" : ""}.`, "crime", true, a.id);
      } else {
        const hours = Math.max(2, Math.ceil(amount / 10));
        this.log("⛓️", `${name} ${what}, couldn't pay the ${amount}-coin fine and was sent to jail for ${hours}h.`, "crime", true, a.id);
        this.jail(a, hours, what);
      }
    } else {
      const hours = Math.round(law.penalty.amount * mult);
      this.log("🚔", `${name} ${what} and was sentenced to ${hours}h in jail${repeat ? " (repeat offense)" : ""}.`, "crime", true, a.id);
      this.jail(a, hours, what);
    }
    this.emit("agent", a);
  }

  jail(a, hours, what) {
    a.record.jailed++;
    a.rep = clamp(a.rep - 15); a.mood = clamp(a.mood - 22);
    a.jailedUntil = this.sim.time + hours * 60;
    a.memories.push({ about: a.id, text: `I got ${hours} hours in jail because I ${what}.`, time: hhmm(this.sim.time) });
    if (a.candidate) { a.candidate = false; this.election.candidates = this.election.candidates.filter((c) => c.id !== a.id); this.log("📉", `${a.res.name} dropped out of the mayor's race after being jailed.`, "election"); }
    this.sim.sendToJail(a);
  }

  imprison(a) {
    const tiles = this.sim.town.places.jailyard;
    const taken = new Set(this.sim.agents.filter((o) => o.state === "jailed").map((o) => `${o.x},${o.y}`));
    const t = tiles.find((x) => !taken.has(`${x.x},${x.y}`)) ?? tiles[0];
    a.x = t.x; a.y = t.y; a.state = "jailed"; a.place = "jail"; a.facing = "down";
    a.activity = `in jail until ${hhmm(a.jailedUntil)}`;
  }

  release(a) {
    const door = this.sim.town.special.jail.door;
    a.x = door.x; a.y = door.y; a.state = "idle"; a.place = "jail";
    a.activity = "just released from jail"; a.dwellUntil = this.sim.time + 10;
    a.escort = false;
    this.log("🔓", `${a.res.name} was released from jail.`, "crime", true, a.id);
    this.emit("agent", a);
  }

  // ---------- after a conversation ----------
  async afterConversation(convo) {
    const { a, b, history } = convo;
    // generosity: help a broke friend
    for (const [p, q] of [[a, b], [b, a]]) {
      const rel = p.rel[q.id] ?? 0;
      if (q.coins < 15 && p.coins > 60 && Math.random() < p.res.traits.generosity * (0.35 + 0.1 * rel)) {
        const gift = 15;
        p.coins -= gift; q.coins += gift; q.mood = clamp(q.mood + 10); p.rep = clamp(p.rep + 3);
        q.memories.push({ about: p.id, text: `${p.res.name} gave me ${gift} coins when I was broke.`, time: hhmm(this.sim.time) });
        this.log("🤝", `${p.res.name} gave ${q.res.name} ${gift} coins to help out.`, "community", true, q.id);
      }
    }
    // quiet hours
    if (convo.quietViolation) for (const p of [a, b]) this.violate(p, this.law("quiet"), "chatted loudly during quiet hours", 1);
    // custom laws: judged by an AI model if one is live, otherwise by banned words
    const custom = this.laws.filter((l) => l.type === "custom");
    if (!custom.length || !history.length) return;
    let violations = [];
    const anyLive = Object.values(this.sim.liveModels).some(Boolean);
    if (anyLive) {
      try {
        const r = await think("judge", a.id, { laws: custom.map((l) => ({ id: l.id, text: l.text })), history });
        violations = (r.violations ?? []).filter((v) => custom.some((l) => l.id === v.lawId) && (v.speaker === a.id || v.speaker === b.id));
      } catch (e) { console.warn(e); }
    } else {
      for (const line of history) for (const l of custom) if (l.keywords.some((k) => line.text.toLowerCase().includes(k))) violations.push({ speaker: line.id, lawId: l.id });
    }
    const seen = new Set();
    for (const v of violations) {
      const key = v.speaker + v.lawId;
      if (seen.has(key)) continue;
      seen.add(key);
      const law = custom.find((l) => l.id === v.lawId);
      this.violate(v.speaker === a.id ? a : b, law, `broke the law "${law.text}"`);
    }
  }

  // ---------- elections ----------
  mayorAgent() { return this.sim.agents.find((a) => a.id === this.mayor); }

  callElection() {
    if (this.election.phase !== "idle") return;
    this.election.nextAt = this.sim.time;
  }

  async startCampaign() {
    const e = this.election, sim = this.sim;
    e.phase = "campaign"; e.ballots = [];
    e.rallyAt = sim.time + 120; e.voteAt = sim.time + 300;
    const candidates = [];
    for (const cid of Object.keys(COMMUNITIES)) {
      const pool = sim.agents.filter((a) => a.community === cid && a.state !== "jailed" && a.rep >= 25 && a.res.traits.ambition >= 0.3);
      const best = pool.sort((x, y) => score(y) - score(x))[0];
      if (best) candidates.push(best);
    }
    function score(a) { return a.res.traits.ambition * 100 + a.rep - a.record.jailed * 10; }
    for (const a of sim.agents) a.candidate = candidates.includes(a);
    e.candidates = candidates.map((a) => ({ id: a.id, community: a.community, speech: "", votes: 0 }));
    this.log("🗳️", `Election called! Running for mayor: ${candidates.map((a) => `${a.res.name} (${COMMUNITIES[a.community].name})`).join(", ")}. Rally at ${hhmm(e.rallyAt)}, voting at ${hhmm(e.voteAt)}.`, "election", true);
    this.emit("election");
    await Promise.all(candidates.map(async (a) => {
      let speech = null;
      if (sim.liveModels[a.res.model]) {
        try { speech = (await think("speech", a.id, { situation: this.situation(a) })).text; } catch (err) { console.warn(err); }
      }
      a.speech = (speech || this.offlineSpeech(a)).slice(0, 260);
      const c = e.candidates.find((x) => x.id === a.id);
      if (c) c.speech = a.speech;
    }));
    this.emit("election");
  }

  offlineSpeech(a) {
    const c = a.community, n = a.res.name;
    const strict = this.laws.filter((l) => l.penalty).sort((x, y) => (y.penalty.kind === "jail") - (x.penalty.kind === "jail"))[0];
    const lines = {
      lantern: [`Safe streets and a town that keeps its promises. Vote for order, vote ${n}!`, "Gotham works when the rules are clear and fair. I'll keep it that way."],
      hearth: ["Full bellies, fair wages, and nobody left behind. That's my promise.", "Every neighbor should be able to afford a warm meal. Vote Hearth & Harvest!"],
      tinkerers: ["Let's build! More work, better tools, and a town that keeps moving.", `Hard work deserves a reward. Vote ${n} for a Gotham that makes things.`],
      spirits: ["Fewer rules, more color. Gotham should be free!", "Let people live their own lives. I'll stand up for your freedom."],
    }[c];
    let s = lines[Math.floor(Math.random() * lines.length)];
    if (c === "spirits" && strict) s += ` First thing I'll do: scrap "${strict.text.replace(/\.$/, "")}".`;
    return s;
  }

  startRally() {
    const e = this.election, sim = this.sim;
    e.phase = "rally";
    for (const c of e.candidates) {
      const a = sim.agents.find((x) => x.id === c.id);
      if (a && a.state !== "jailed" && a.state !== "talking" && a.state !== "sleeping") sim.goTo(a, "plaza", "heading to the campaign rally");
    }
    this.log("🎪", "The campaign rally is starting in Fountain Plaza!", "election", true);
    this.emit("election");
  }

  async holdVote() {
    const e = this.election, sim = this.sim;
    e.phase = "counting";
    const cands = e.candidates.map((c) => ({ ...c, agent: sim.agents.find((a) => a.id === c.id) })).filter((c) => c.agent);
    if (!cands.length) { this.finishElection(null); return; }
    const voters = sim.agents.filter((a) => a.state !== "jailed");
    const jailed = sim.agents.filter((a) => a.state === "jailed");
    if (jailed.length) this.log("🚫", `${jailed.map((a) => a.res.name).join(", ")} couldn't vote from jail.`, "election");
    const ballots = await Promise.all(voters.map(async (v) => {
      if (sim.liveModels[v.res.model]) {
        try {
          const r = await think("vote", v.id, {
            situation: this.situation(v),
            candidates: cands.map((c) => ({ id: c.id, name: c.agent.res.name, community: COMMUNITIES[c.community].name, values: COMMUNITIES[c.community].values, speech: c.speech, rep: Math.round(c.agent.rep), record: c.agent.record.jailed + c.agent.record.fines })),
          });
          if (cands.some((c) => c.id === r.vote)) return { voter: v.id, vote: r.vote, reason: String(r.reason ?? "").slice(0, 140), source: "ai" };
        } catch (err) { console.warn(err); }
      }
      return this.instinctVote(v, cands);
    }));
    e.ballots = ballots;
    for (const c of e.candidates) c.votes = ballots.filter((b) => b.vote === c.id).length;
    const winner = [...cands].sort((x, y) => {
      const vx = e.candidates.find((c) => c.id === x.id).votes, vy = e.candidates.find((c) => c.id === y.id).votes;
      return vy - vx || y.agent.rep - x.agent.rep;
    })[0];
    this.finishElection(winner.agent);
  }

  instinctVote(v, cands) {
    let best = null, bestScore = -Infinity, why = "";
    for (const c of cands) {
      const a = c.agent;
      let s = Math.random() * 1.5, reason = "gut feeling";
      if (c.community === v.community) { s += 3; reason = "they're from my community"; }
      const rel = v.rel[a.id] ?? 0;
      if (rel >= 2) { s += rel * 0.5; if (rel >= 3) reason = "they're a good friend"; }
      s += a.rep / 30 - a.record.jailed * 0.8;
      if (v.res.traits.rebel > 0.5 && c.community === "spirits") { s += 1.5; reason = "I want fewer rules"; }
      if (v.record.fines + v.record.jailed > 0 && c.community === "lantern") s -= 1.2;
      if (v.coins < 30 && c.community === "hearth") { s += 1; reason = "I need fair wages"; }
      if (a === v) { s += 5; reason = "I believe in myself"; }
      if (s > bestScore) { bestScore = s; best = c; why = reason; }
    }
    return { voter: v.id, vote: best.id, reason: why, source: "instinct" };
  }

  async finishElection(winner) {
    const e = this.election, sim = this.sim;
    const prev = this.mayorAgent();
    e.phase = "idle";
    e.nextAt = (Math.floor(sim.time / 1440) * 1440) + ELECTION_EVERY + 9 * 60;
    for (const a of sim.agents) a.candidate = false;
    if (!winner) { this.log("🗳️", "Nobody ran for mayor this time.", "election"); this.emit("election"); return; }
    this.mayor = winner.id;
    winner.rep = clamp(winner.rep + 10); winner.mood = clamp(winner.mood + 20);
    const c = e.candidates.find((x) => x.id === winner.id);
    e.history.unshift({ day: Math.floor(sim.time / 1440) + 1, winner: winner.id, results: e.candidates.map((x) => ({ id: x.id, votes: x.votes })) });
    const tally = e.candidates.map((x) => `${residentById(x.id).name} ${x.votes}`).join(" · ");
    this.log("👑", `${winner.res.name} (${MODELS[winner.res.model].label}, ${COMMUNITIES[winner.community].name}) is the new mayor of Gotham with ${c.votes} votes! (${tally})${prev && prev !== winner ? ` ${prev.res.name} is out.` : ""}`, "election", true, winner.id);
    this.emit("elected", winner);
    this.emit("election");
    sim.save();
    await this.mayorProposal(winner);
  }

  async mayorProposal(m) {
    let prop = null;
    if (this.sim.liveModels[m.res.model]) {
      try {
        const r = await think("propose", m.id, {
          situation: this.situation(m),
          types: Object.entries(LAW_TYPES).map(([k, v]) => ({ type: k, title: v.title, param: v.param?.label ?? null })),
          laws: this.laws.map((l) => ({ id: l.id, text: l.text })),
        });
        if (r.action === "repeal" && this.laws.some((l) => l.id === r.lawId)) prop = { action: "repeal", lawId: r.lawId, reason: r.reason };
        else if (r.action === "enact" && LAW_TYPES[r.type]) prop = { action: "enact", type: r.type, param: typeof r.param === "number" ? r.param : undefined, text: r.text, reason: r.reason };
      } catch (err) { console.warn(err); }
    }
    prop ??= this.instinctProposal(m);
    if (!prop) return;
    prop.id = `p${this.nextId++}`; prop.by = m.id;
    prop.summary = prop.action === "repeal"
      ? `Repeal: ${this.laws.find((l) => l.id === prop.lawId)?.text}`
      : `Enact: ${LAW_TYPES[prop.type].text(prop.param ?? LAW_TYPES[prop.type].param?.default, prop.text)}`;
    this.proposals.unshift(prop);
    this.log("📝", `Mayor ${m.res.name} proposes a law change: ${prop.summary} "${prop.reason ?? ""}" (you decide, in the Laws tab).`, "law", true);
    this.emit("laws");
  }

  instinctProposal(m) {
    const c = m.community;
    const has = (t) => !!this.law(t);
    if (c === "spirits") {
      const strict = this.laws.find((l) => l.penalty && l.type !== "theft") ?? this.laws.find((l) => l.type === "tax");
      return strict ? { action: "repeal", lawId: strict.id, reason: "People should be free to live their lives." } : null;
    }
    if (c === "lantern") return !has("curfew") ? { action: "enact", type: "curfew", param: 23, reason: "Safe streets need quiet nights." } : !has("quiet") ? { action: "enact", type: "quiet", param: 22, reason: "Let our neighbors sleep." } : null;
    if (c === "tinkerers") return !has("work") ? { action: "enact", type: "work", reason: "A town that works is a town that thrives." } : null;
    if (c === "hearth") return { action: "enact", type: "tax", param: this.treasury < 300 ? 15 : 5, reason: this.treasury < 300 ? "We need a treasury that can look after people." : "Let workers keep more of what they earn." };
    return null;
  }

  resolveProposal(id, accept) {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) return;
    this.proposals = this.proposals.filter((x) => x.id !== id);
    const mayor = residentById(p.by)?.name ?? "the mayor";
    if (accept) {
      if (p.action === "repeal") this.repeal(p.lawId, `proposed by Mayor ${mayor}`);
      else this.addLaw({ type: p.type, param: p.param, text: p.text }, `proposed by Mayor ${mayor}`);
      const m = this.mayorAgent(); if (m) m.mood = clamp(m.mood + 8);
    } else {
      this.log("✋", `You rejected Mayor ${mayor}'s proposal: ${p.summary}`, "law");
      const m = this.mayorAgent(); if (m) { m.mood = clamp(m.mood - 6); m.memories.push({ about: m.id, text: `The council rejected my proposal: ${p.summary}`, time: hhmm(this.sim.time) }); }
    }
    this.emit("laws");
  }

  // ---------- what an agent knows about their situation ----------
  situation(a) {
    const word = (v, lo, mid, hi) => (v < 34 ? lo : v < 67 ? mid : hi);
    const w = a.res.work;
    const c = COMMUNITIES[a.community];
    const mayor = this.mayorAgent();
    const laws = this.laws.length
      ? this.laws.map((l) => `- [${l.type}] ${l.text}${l.penalty ? ` Penalty: ${penaltyText(l.penalty)}.` : ""}`).join("\n")
      : "- (no laws at all)";
    const rec = a.record;
    const recent = a.memories.filter((m) => m.about === a.id).slice(-3).map((m) => m.text).join(" ");
    return [
      `Coins: ${Math.floor(a.coins)}${a.debt ? ` (in debt: ${Math.ceil(a.debt)})` : ""}. Rent is ${RENT}/day, a meal costs ${FOOD_PRICE}.`,
      `Hunger: ${word(a.hunger, "fed", "a bit hungry", "very hungry")}. Mood: ${word(a.mood, "low", "okay", "great")}. Reputation: ${Math.round(a.rep)}/100.`,
      w ? `Job: ${a.res.job} at ${w.place}, ${w.from}:00-${w.to}:00, ${w.wage} coins/hour before tax. No work, no pay; skip three shifts and you're fired.` : `You are unemployed. Open jobs in town: ${this.population.openJobs().map((j) => j.title).join(", ") || "none"}.`,
      `Community: ${c.name} (values: ${c.values}).`,
      `Mayor: ${mayor ? (mayor === a ? "you!" : `${mayor.res.name} (${COMMUNITIES[mayor.community].name})`) : "nobody yet"}. Town treasury: ${Math.round(this.treasury)} coins.`,
      `Town laws (set by the citizens' council; broken laws are punished with fines or jail if you're caught):\n${laws}`,
      `Your record: ${rec.fines} fines, ${rec.jailed} jail sentences.${recent ? ` Recently: ${recent}` : ""}`,
      a.candidate ? "You are running for mayor in today's election." : "",
      this.election.phase !== "idle" ? `An election is underway. Candidates: ${this.election.candidates.map((x) => residentById(x.id).name).join(", ")}.` : "",
      this.life.situation(a),
      this.autonomy.situation(a),
      this.world.situation(),
      this.social.situation(a),
      this.disasters.situation(),
      a.sick ? "You're sick with a fever." : a.health < 50 ? "You're feeling a bit unwell." : "",
      a.plan?.wishes?.length ? `What you wanted to do today: ${a.plan.wishes.map((w) => ACTIVITIES[w]?.label ?? w).join("; ")}.` : "",
    ].filter(Boolean).join("\n");
  }

  // ---------- persistence ----------
  serialize() {
    return {
      treasury: this.treasury, laws: this.laws, proposals: this.proposals, gazette: this.gazette.slice(0, 80),
      mayor: this.mayor, nextId: this.nextId,
      election: { nextAt: this.election.nextAt, history: this.election.history.slice(0, 10) },
      agents: Object.fromEntries(this.sim.agents.map((a) => [a.id, { coins: a.coins, debt: a.debt, hunger: a.hunger, mood: a.mood, rep: a.rep, record: a.record, community: a.community }])),
      population: this.population.serialize(),
      life: this.life.serialize(),
      autonomy: this.autonomy.serialize(),
      social: this.social.serialize(),
      world: this.world.serialize(),
      disasters: this.disasters.serialize(),
    };
  }
  restore(s) {
    if (!s) return;
    Object.assign(this, { treasury: s.treasury ?? this.treasury, laws: s.laws ?? this.laws, proposals: s.proposals ?? [], gazette: s.gazette ?? [], mayor: s.mayor ?? null, nextId: s.nextId ?? this.nextId });
    // law text functions aren't serialized, but the text is, so laws restore as-is
    this.population.restore(s.population);
    this.life.restore(s.life);
    this.autonomy.restore(s.autonomy);
    this.social.restore(s.social);
    this.world.restore(s.world);
    this.disasters.restore(s.disasters);
    if (s.election) { this.election.nextAt = s.election.nextAt ?? this.election.nextAt; this.election.history = s.election.history ?? []; }
    for (const a of this.sim.agents) if (s.agents?.[a.id]) Object.assign(a, s.agents[a.id]);
  }
}

export function penaltyText(p) {
  return p.kind === "fine" ? `${p.amount}-coin fine` : `${p.amount}h in jail`;
}

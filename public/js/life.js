// Everyday life: needs (energy, social, fun), free-time activities, fishing, gardening,
// trading at the markets, and the Community Garden's daily events.
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const hhmm = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;

// What residents can choose to do with their free time.
export const ACTIVITIES = {
  fish: { label: "go fishing at the docks or the bridge", place: "fishing" },
  garden: { label: "tend a plot in the Community Garden", place: "cgarden" },
  sell: { label: "sell fish or vegetables at the Citizens' Market", place: "cmarket" },
  shop: { label: "browse the markets and shops", place: "market" },
  read: { label: "read at the Library", place: "library" },
  stroll: { label: "take a walk by the river or the plaza", place: "park" },
  socialize: { label: "find friends and chat", place: "plaza" },
  event: { label: "go to today's event at the Community Garden", place: "events" },
  nap: { label: "take a nap at home", place: "home" },
};

const FISH = [
  { name: "minnow", value: 2, w: 40 }, { name: "perch", value: 4, w: 28 }, { name: "trout", value: 7, w: 18 },
  { name: "salmon", value: 12, w: 9 }, { name: "pike", value: 16, w: 4 }, { name: "golden carp", value: 45, w: 1 },
];
const EVENTS = [
  { id: "party", name: "Garden Party", icon: "🎉", desc: "food, games and gossip on the garden lawn" },
  { id: "music", name: "Music Night", icon: "🎶", desc: "live music on the garden stage" },
  { id: "contest", name: "Fishing Contest", icon: "🎣", desc: "whoever catches the most fish wins 30 coins", place: "fishing" },
  { id: "marketday", name: "Market Day", icon: "🧺", desc: "the Citizens' Market pays 50% more for fish and vegetables", place: "cmarket" },
  { id: "harvest", name: "Harvest Festival", icon: "🎃", desc: "a free community feast in the garden" },
];

export class Life {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.event = null;       // today's event
    this.lastEventDay = -1;
  }

  initAgent(a) {
    const r = a.res, t = r.traits;
    const seed = [...r.id].reduce((s, c) => s + c.charCodeAt(0), 0);
    const rnd = (k) => ((Math.sin(seed * 9.13 + k * 3.7) + 1) / 2);
    a.energy = 80; a.social = 60; a.fun = 60;
    a.inv = { fish: 0, fishValue: 0, veg: 0 };
    a.catches = 0;
    // personal tastes, partly from personality
    a.likes = {
      fish: 0.3 + rnd(1) * 0.9 - t.diligence * 0.2,
      garden: 0.3 + rnd(2) * 0.8 + (r.work?.place === "garden" ? 0.4 : 0),
      read: 0.2 + rnd(3) * 0.8 + (r.work?.place === "library" ? 0.3 : 0),
      shop: 0.2 + rnd(4) * 0.8,
      stroll: 0.3 + rnd(5) * 0.7,
      socialize: 0.3 + rnd(6) * 0.6 + t.generosity * 0.3,
    };
  }

  // ----- per-frame needs (dt in game minutes) -----
  tick(a, dt) {
    const s = a.state;
    if (s === "sleeping") a.energy += dt * 0.32;
    else if (a.doing === "nap" && s === "idle" && a.place === "home") a.energy += dt * 0.45;
    else a.energy -= dt * (a.working ? 0.085 : 0.06);
    if (s === "talking") a.social += dt * 0.7; else if (s !== "sleeping") a.social -= dt * 0.045;
    const funRate = { fish: 0.25, garden: 0.2, read: 0.2, stroll: 0.16, shop: 0.12, socialize: 0.1, event: 0.4, sell: 0.05 }[a.doing] ?? 0;
    if (s === "idle" && funRate && a.place === a.doingPlace) a.fun += dt * funRate;
    else if (s !== "sleeping") a.fun -= dt * (a.working ? 0.06 : 0.04);
    if (this.event?.active && a.doing === "event" && a.place === "events") { a.social += dt * 0.2; }
    a.energy = clamp(a.energy); a.social = clamp(a.social); a.fun = clamp(a.fun);

    // fishing: a bite now and then
    if (a.doing === "fish" && s === "idle" && a.place === "fishing") {
      a.bite = Math.random() < 0.02;
      if (Math.random() < dt * 0.02 * (0.7 + a.likes.fish * 0.4) * (this.society.world.w.fish ?? 1)) this.catchFish(a);
    }
    // gardening: plots grow vegetables
    if (a.doing === "garden" && s === "idle" && a.place === "cgarden") {
      a.gardenTime = (a.gardenTime ?? 0) + dt;
      a.gardenTime += dt * ((this.society.world.w.garden ?? 1) - 1);
      if (a.gardenTime >= 35) { a.gardenTime = 0; const n = 1 + (Math.random() < 0.3 ? 1 : 0); a.inv.veg += n; a.vegGrown = (a.vegGrown ?? 0) + n; }
    }
  }

  moodTarget(a) {
    return (a.energy < 25 ? -10 : 0) + (a.social < 25 ? -8 : 0) + (a.fun < 25 ? -8 : a.fun > 70 ? 5 : 0);
  }

  catchFish(a) {
    let r = Math.random() * FISH.reduce((s, f) => s + f.w, 0), fish = FISH[0];
    for (const f of FISH) { if ((r -= f.w) <= 0) { fish = f; break; } }
    a.inv.fish++; a.inv.fishValue += fish.value; a.catches++;
    if (fish.value >= 12) a.bigCatches = (a.bigCatches ?? 0) + 1;
    a.fun = clamp(a.fun + 6); a.mood = clamp(a.mood + 2);
    if (this.event?.active && this.event.id === "contest") this.event.scores[a.id] = (this.event.scores[a.id] ?? 0) + 1;
    a.lastCatch = fish.name;
    a.activity = `just caught a ${fish.name}!`;
    if (fish.value >= 12) this.society.log("🎣", `${a.res.name} caught a ${fish.name} worth ${fish.value} coins!`, "leisure", fish.value >= 16, a.id);
    else if (Math.random() < 0.15) this.society.log("🐟", `${a.res.name} caught a ${fish.name}.`, "leisure");
  }

  // ----- arriving somewhere -----
  onArrive(a) {
    const s = this.society;
    if ((a.place === "cmarket" || a.place === "market") && (a.inv.fish || a.inv.veg)) {
      const bonus = (this.event?.id === "marketday" ? 1.5 : 1) * this.society.disasters.marketFactor();
      const earned = Math.round((a.inv.fishValue + a.inv.veg * 3) * bonus);
      if (earned > 0) {
        a.coins += earned;
        const what = [a.inv.fish ? `${a.inv.fish} fish` : "", a.inv.veg ? `${a.inv.veg} vegetables` : ""].filter(Boolean).join(" and ");
        s.log("🧺", `${a.res.name} sold ${what} at the ${a.place === "cmarket" ? "Citizens' Market" : "Market"} for ${earned} coins.`, "economy", earned >= 30, a.id);
        a.inv = { fish: 0, fishValue: 0, veg: 0 };
        a.mood = clamp(a.mood + 4);
        a.activity = `selling at the ${a.place === "cmarket" ? "Citizens' Market" : "Market"}`;
      }
    }
    if ((a.place === "cmarket" || a.place === "market") && a.hunger > 45 && a.coins >= 6) {
      a.coins -= 6; s.treasury += 1; a.hunger = clamp(a.hunger - 45); a.activity = "snacking on market food";
    }
    if (a.place === "home" && a.hunger > 50 && (a.inv.fish || a.inv.veg)) {
      if (a.inv.fish) { a.inv.fish--; a.inv.fishValue = Math.max(0, a.inv.fishValue - 5); a.hunger = clamp(a.hunger - 55); a.activity = "cooking fish at home"; }
      else { a.inv.veg = Math.max(0, a.inv.veg - 2); a.hunger = clamp(a.hunger - 35); a.activity = "cooking vegetables at home"; }
      a.mood = clamp(a.mood + 3);
    }
    if (a.place === "events" && this.event?.active && this.event.id === "harvest" && !this.event.fed.has(a.id)) {
      this.event.fed.add(a.id); a.hunger = clamp(a.hunger - 70); a.activity = "feasting at the Harvest Festival";
    }
    if (a.place === "events" && this.event?.active) this.event.attendees.add(a.id);
  }

  // ----- free will: score what to do next -----
  options(a) {
    const s = this.society, opts = [];
    const auto = this.society.autonomy;
    const world = this.society.world, dis = this.society.disasters;
    const add = (kind, score, place, label) => {
      if (score <= 0 || dis.closed(place)) return;
      const weather = place === "home" ? 1 : world.outdoorFactor(place);
      opts.push({ kind, score: (score + (a.plan?.wishes?.includes(kind) ? 30 : 0) + auto.bias(a, kind)) * weather, place, label });
    };
    const clinic = world.clinicOption(a); if (clinic && !dis.closed("clinic")) opts.push(clinic);
    const rebuild = dis.rebuildOption(a); if (rebuild) opts.push(rebuild);
    // bad weather sends people indoors
    if (world.w.outdoor < 0.6) add("socialize", 25, "cafe", "heading indoors to the Inn");
    if (a.partner) { const p = this.sim.agents.find((o) => o.id === a.partner); if (p && p.state !== "sleeping" && p.place && p.place !== "home" && p.place !== "jail") add("socialize", 20 + (100 - a.social) * 0.4, p.place, `going to meet ${p.res.name}`); }
    const apply = auto.applyOption(a);
    if (apply) opts.push(apply);
    const ev = this.event;
    if (a.hunger > 55) {
      if ((a.inv.fish || a.inv.veg) && a.coins < 30) add("eat", 40 + a.hunger, "home", "heading home to cook");
      else add("eat", 40 + a.hunger, pick(a.coins >= 8 ? ["cafe", "bakery", "store", "cmarket"] : ["cmarket", "market", "cafe"]), "going to get food");
    }
    if (a.energy < 32) add("nap", 95 - a.energy * 1.5, "home", "heading home for a nap");
    if (ev?.active || (ev && this.sim.time >= ev.start - 30 && this.sim.time < ev.end)) {
      const place = ev.place ?? "events";
      add(ev.id === "contest" ? "fish" : ev.id === "marketday" ? "sell" : "event", 45 + (100 - a.social) * 0.3 + (100 - a.fun) * 0.3, place, `heading to the ${ev.name}`);
    }
    add("fish", (100 - a.fun) * 0.55 * a.likes.fish, "fishing", "going fishing");
    add("garden", (100 - a.fun) * 0.45 * a.likes.garden + (a.coins < 40 ? 8 : 0), "cgarden", "going to the Community Garden");
    if (a.inv.fish + a.inv.veg >= 3) add("sell", 28 + (a.coins < 40 ? 30 : 0) + a.inv.fish * 2, "cmarket", "taking goods to the Citizens' Market");
    add("socialize", (100 - a.social) * 0.6 * a.likes.socialize, this.busiestPlace(a), "looking for company");
    add("read", (100 - a.fun) * 0.3 * a.likes.read, "library", "going to read at the Library");
    add("stroll", 8 + (100 - a.fun) * 0.2 * a.likes.stroll, pick(["park", "plaza"]), "going for a walk");
    add("shop", 6 + a.likes.shop * 14 + (a.coins > 120 ? 14 : 0), pick(["market", "cmarket", "store", "bakery"]), "going shopping");
    for (const [p, w] of Object.entries(a.res.weights ?? {})) if (p !== "home") add("hangout", w * 5, p, null);
    return opts;
  }

  choose(a) {
    const opts = this.options(a).sort((x, y) => y.score - x.score).slice(0, 4);
    if (!opts.length) return null;
    const total = opts.reduce((s, o) => s + o.score * o.score, 0);
    let r = Math.random() * total;
    for (const o of opts) if ((r -= o.score * o.score) <= 0) return o;
    return opts[0];
  }

  busiestPlace(a) {
    const counts = {};
    for (const o of this.sim.agents) if (o !== a && o.state !== "sleeping" && o.state !== "jailed" && o.place && o.place !== "home") counts[o.place] = (counts[o.place] ?? 0) + 1;
    const best = Object.entries(counts).filter(([p]) => this.sim.town.places[p]?.length).sort((x, y) => y[1] - x[1])[0];
    return best?.[0] ?? "plaza";
  }

  activityLabel(a) {
    const where = a.place;
    switch (a.doing) {
      case "fish": return where === "fishing" ? pick(["fishing off the dock", "waiting for a bite", "casting a line"]) : null;
      case "garden": return "tending a plot in the Community Garden";
      case "read": return "reading a book at the Library";
      case "event": return this.event ? `at the ${this.event.name}` : null;
      case "nap": return "taking a nap 💤";
      case "socialize": return "looking for someone to chat with";
      case "shop": return pick(["browsing the stalls", "window shopping", "checking prices"]);
      default: return null;
    }
  }

  // ----- daily events in the Community Garden -----
  onHour(h) {
    const day = Math.floor(this.sim.time / 1440);
    if (h >= 6 && this.lastEventDay !== day) {
      this.lastEventDay = day;
      const def = EVENTS[day % EVENTS.length];
      const start = day * 1440 + (def.id === "contest" ? 16 : 17) * 60, end = start + 150;
      this.event = { ...def, start, end, active: false, attendees: new Set(), scores: {}, fed: new Set() };
      this.society.log(def.icon, `Today in Gotham: ${def.name} at ${hhmm(start)}: ${def.desc}.`, "community", true);
    }
    const ev = this.event;
    if (!ev) return;
    const t = this.sim.time;
    if (!ev.active && t >= ev.start && t < ev.end) {
      ev.active = true;
      this.society.log(ev.icon, `The ${ev.name} has started${ev.place === "fishing" ? " at the docks" : ev.place === "cmarket" ? " at the Citizens' Market" : " in the Community Garden"}!`, "community", true);
      this.society.emit("event", ev);
    }
    if (ev.active && t >= ev.end) this.endEvent();
  }

  endEvent() {
    const ev = this.event; ev.active = false;
    const n = ev.attendees.size;
    if (ev.id === "contest") {
      const best = Object.entries(ev.scores).sort((x, y) => y[1] - x[1])[0];
      const winner = best && this.sim.agents.find((a) => a.id === best[0]);
      if (winner) {
        const prize = Math.min(30, this.society.treasury);
        this.society.treasury -= prize; winner.coins += prize; winner.rep = clamp(winner.rep + 5); winner.mood = clamp(winner.mood + 15);
        this.society.log("🏆", `${winner.res.name} won the Fishing Contest with ${best[1]} fish and takes home ${prize} coins!`, "community", true, winner.id);
      } else this.society.log("🎣", "Nobody caught a thing at the Fishing Contest.", "community");
    } else {
      for (const id of ev.attendees) { const a = this.sim.agents.find((x) => x.id === id); if (a) { a.mood = clamp(a.mood + 8); a.rep = clamp(a.rep + 1); } }
      this.society.log(ev.icon, `The ${ev.name} wrapped up${n ? ` with ${n} neighbors attending` : ", but almost nobody came"}.`, "community");
    }
    this.society.emit("event", ev);
  }

  situation(a) {
    const word = (v) => (v < 30 ? "low" : v < 65 ? "okay" : "high");
    const inv = [a.inv.fish ? `${a.inv.fish} fish (worth ~${a.inv.fishValue} coins)` : "", a.inv.veg ? `${a.inv.veg} vegetables` : ""].filter(Boolean).join(", ");
    const ev = this.event;
    return [
      `Energy: ${word(a.energy)}. Social: ${word(a.social)}. Fun: ${word(a.fun)}.`,
      inv ? `You're carrying ${inv}.` : "",
      a.catches ? `You've caught ${a.catches} fish so far${a.lastCatch ? `, most recently a ${a.lastCatch}` : ""}.` : "",
      ev ? `Today's event: ${ev.name} at ${hhmm(ev.start)} (${ev.desc})${ev.active ? ", happening right now" : ""}.` : "",
      "Free-time options in town: fishing at the waterfall pond dock, the river dock or the bridge; growing vegetables in the Community Garden; selling fish and vegetables at the Citizens' Market; shopping; reading; walks; events.",
    ].filter(Boolean).join("\n");
  }

  serialize() {
    return { agents: Object.fromEntries(this.sim.agents.map((a) => [a.id, { energy: a.energy, social: a.social, fun: a.fun, inv: a.inv, catches: a.catches }])) };
  }
  restore(s) {
    for (const a of this.sim.agents) if (s?.agents?.[a.id]) Object.assign(a, s.agents[a.id]);
  }
}

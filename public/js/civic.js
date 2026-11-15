// Civic life driven by residents themselves: petitions to the council, small businesses,
// gatherings they organize, and a scoreboard comparing the AI models.
import { MODELS, LAW_TYPES } from "./residents.js";

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const BUSINESS_TYPES = [
  { id: "fish", name: "Fish Stall", icon: "🐟", likes: "fish", place: "cmarket" },
  { id: "veg", name: "Veggie Stand", icon: "🥕", likes: "garden", place: "cmarket" },
  { id: "tea", name: "Tea Cart", icon: "🍵", likes: "socialize", place: "plaza" },
  { id: "art", name: "Art Stall", icon: "🎨", likes: "stroll", place: "market" },
  { id: "books", name: "Book Swap", icon: "📚", likes: "read", place: "market" },
  { id: "repair", name: "Repair Shop", icon: "🔧", likes: "shop", place: "market" },
];
const GATHERINGS = [
  { name: "picnic", place: "park", icon: "🧺" },
  { name: "board game night", place: "cafe", icon: "🎲" },
  { name: "sing-along", place: "plaza", icon: "🎤" },
  { name: "garden tea party", place: "events", icon: "🫖" },
];

export class Civic {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.petitions = [];   // { id, by, action, type, lawId, param, text, signers:Set, needed, started }
    this.businesses = [];  // { id, owner, type, name, icon, place, till, opened, customers }
    this.gatherings = [];  // { id, by, name, place, icon, start, end, invited:Set, came:Set }
    this.nextId = 1;
  }

  // ----- hourly rhythm -----
  onHour(h) {
    if (h === 10 || h === 15) this.maybePetition();
    if (h === 11) this.maybeOpenBusiness();
    if (h === 12) this.maybeGathering();
    if (h >= 8 && h <= 19) this.runBusinesses();
    this.collectSignatures();
    this.updateGatherings();
  }

  // ----- petitions -----
  grievance(a) {
    const s = this.society, t = a.res.traits, c = a.community;
    // rebels and Free Spirits want strict laws gone
    if (t.rebel > 0.55 || c === "spirits") {
      const strict = s.laws.filter((l) => l.penalty && l.type !== "theft" && (a.record.offenses[l.type] || ["curfew", "quiet", "work", "garden"].includes(l.type)));
      if (strict.length) { const l = pick(strict); return { action: "repeal", lawId: l.id, text: `Repeal "${l.text.replace(/\.$/, "")}"`, why: "it treats us like children" }; }
    }
    // high taxes hurt the poor
    const tax = s.law("tax");
    if (tax && tax.param >= 15 && (a.coins < 60 || c === "hearth")) return { action: "enact", type: "tax", param: Math.max(0, tax.param - 10), text: `Lower the income tax to ${Math.max(0, tax.param - 10)}%`, why: "we can barely pay rent" };
    // order-minded residents want safety after crimes
    const recentCrime = s.gazette.filter((e) => e.kind === "crime" && this.sim.time - e.t < 1440).length;
    if ((c === "lantern" || t.diligence > 0.8) && recentCrime >= 2) {
      if (!s.law("curfew")) return { action: "enact", type: "curfew", param: 23, text: "Bring in a curfew at 23:00", why: "the streets aren't safe at night" };
      if (!s.law("quiet")) return { action: "enact", type: "quiet", param: 22, text: "Quiet hours from 22:00", why: "we need peace and order" };
    }
    if (!s.law("work") && t.diligence > 0.85 && this.sim.agents.filter((o) => !o.plan?.work && o.res.work).length >= 4) return { action: "enact", type: "work", text: "Make everyone work their shifts", why: "too many people are skipping work" };
    return null;
  }

  maybePetition() {
    if (this.petitions.length >= 2) return;
    const candidates = this.sim.agents.filter((a) => a.state !== "jailed" && a.state !== "away" && (a.res.traits.ambition > 0.4 || a.mood < 45));
    for (const a of candidates.sort(() => Math.random() - 0.5)) {
      if (Math.random() > 0.35) continue;
      const g = this.grievance(a);
      if (!g || this.petitions.some((p) => p.text === g.text) || this.society.proposals.some((p) => p.summary?.includes(g.text))) continue;
      const p = { id: `pt${this.nextId++}`, by: a.id, ...g, signers: new Set([a.id]), needed: Math.max(3, Math.ceil(this.sim.agents.length * 0.35)), started: this.sim.time };
      this.petitions.push(p);
      this.society.log("✍️", `${a.res.name} started a petition: "${g.text}" because ${g.why}. ${p.needed} signatures needed.`, "law", true, a.id);
      this.society.social.spread(`${a.res.name} is collecting signatures to ${g.text.charAt(0).toLowerCase()}${g.text.slice(1)}`, [a]);
      return;
    }
  }

  agrees(a, p) {
    const by = this.sim.agents.find((o) => o.id === p.by);
    let score = (a.bond?.[p.by] ?? 0) / 60 + (by && by.community === a.community ? 0.4 : 0);
    if (p.action === "repeal") score += a.res.traits.rebel - 0.4 + (a.community === "lantern" ? -0.6 : 0);
    if (p.type === "tax") score += a.coins < 80 ? 0.5 : -0.2;
    if (p.type === "curfew" || p.type === "quiet") score += (a.community === "lantern" ? 0.5 : 0) - a.res.traits.rebel * 0.8;
    if (p.type === "work") score += a.res.traits.diligence - 0.6;
    return score > 0.15;
  }

  collectSignatures() {
    for (const p of [...this.petitions]) {
      // supporters sign when the petition reaches them by word of mouth
      for (const a of this.sim.agents) {
        if (p.signers.has(a.id) || a.state === "sleeping" || a.state === "away") continue;
        const heard = a.knows?.some((k) => k.text.includes("collecting signatures")) || Math.random() < 0.15;
        if (heard && Math.random() < 0.5 && this.agrees(a, p)) p.signers.add(a.id);
      }
      if (p.signers.size >= p.needed) {
        this.petitions = this.petitions.filter((x) => x !== p);
        const by = this.sim.agents.find((o) => o.id === p.by);
        const prop = p.action === "repeal"
          ? { action: "repeal", lawId: p.lawId, reason: `Petition signed by ${p.signers.size} residents: ${p.why}.` }
          : { action: "enact", type: p.type, param: p.param, reason: `Petition signed by ${p.signers.size} residents: ${p.why}.` };
        prop.id = `p${this.society.nextId++}`; prop.by = p.by; prop.petition = true;
        prop.summary = prop.action === "repeal" ? `Repeal: ${this.society.laws.find((l) => l.id === p.lawId)?.text ?? p.text}` : `Enact: ${LAW_TYPES[p.type].text(p.param ?? LAW_TYPES[p.type].param?.default)}`;
        this.society.proposals.unshift(prop);
        this.society.log("📜", `${by?.res.name ?? "A resident"}'s petition "${p.text}" got ${p.signers.size} signatures and goes to the council (you decide, in the Laws tab).`, "law", true, p.by);
        this.society.emit("laws");
      } else if (this.sim.time - p.started > 2 * 1440) {
        this.petitions = this.petitions.filter((x) => x !== p);
        this.society.log("📝", `The petition "${p.text}" fizzled out with ${p.signers.size} of ${p.needed} signatures.`, "law");
      }
    }
  }

  // ----- small businesses -----
  maybeOpenBusiness() {
    for (const a of this.sim.agents.sort(() => Math.random() - 0.5)) {
      if (a.coins < 180 || a.res.traits.ambition < 0.45 || this.businesses.some((b) => b.owner === a.id) || a.state === "jailed") continue;
      if (Math.random() > 0.3) continue;
      const type = [...BUSINESS_TYPES].sort((x, y) => (a.likes?.[y.likes] ?? 0) - (a.likes?.[x.likes] ?? 0))[0];
      if (this.businesses.filter((b) => b.type === type.id).length >= 2) continue;
      a.coins -= 120;
      const b = { id: `b${this.nextId++}`, owner: a.id, type: type.id, name: `${a.res.name}'s ${type.name}`, icon: type.icon, place: type.place, till: 0, opened: this.sim.time, customers: 0, lossDays: 0 };
      this.businesses.push(b);
      this.society.log(type.icon, `${a.res.name} invested 120 coins and opened ${b.name} at ${({ cmarket: "the Citizens' Market", market: "the Market", plaza: "Fountain Plaza" })[b.place]}!`, "economy", true, a.id);
      return;
    }
  }

  runBusinesses() {
    for (const b of [...this.businesses]) {
      const owner = this.sim.agents.find((a) => a.id === b.owner);
      if (!owner) { this.businesses = this.businesses.filter((x) => x !== b); continue; }
      const shoppers = this.sim.agents.filter((a) => a !== owner && a.place === b.place && a.state === "idle").length;
      const sales = shoppers * (2 + Math.random() * 3) * (this.society.disasters?.marketFactor() ?? 1);
      const upkeep = 4;
      b.till += sales - upkeep; b.customers += shoppers;
      owner.coins += sales - upkeep;
      if (owner.coins < 0) owner.coins = 0;
    }
  }
  onNewDay() {
    for (const b of [...this.businesses]) {
      const owner = this.sim.agents.find((a) => a.id === b.owner);
      if (b.till < -15) b.lossDays++; else b.lossDays = 0;
      if (b.till > 30) this.society.log(b.icon, `${b.name} had a good day: ${Math.round(b.till)} coins profit.`, "economy", false, b.owner);
      if (b.lossDays >= 2 || !owner) {
        this.businesses = this.businesses.filter((x) => x !== b);
        if (owner) { owner.mood = clamp(owner.mood - 15); owner.memories.push({ about: owner.id, text: `My business, ${b.name}, went bust.`, time: "" }); }
        this.society.log("📉", `${b.name} went out of business.`, "economy", true, b.owner);
      }
      b.till = 0;
    }
  }

  // ----- gatherings residents organize -----
  maybeGathering() {
    const hosts = this.sim.agents.filter((a) => a.mood > 60 && (a.likes?.socialize ?? 0) > 0.5 && a.state !== "jailed" && a.state !== "away");
    const host = hosts.sort(() => Math.random() - 0.5)[0];
    if (!host || Math.random() > 0.5 || this.gatherings.length) return;
    const g0 = pick(GATHERINGS);
    const friends = Object.entries(host.bond ?? {}).filter(([, v]) => v >= 15).map(([id]) => id);
    if (friends.length < 2) return;
    const start = Math.floor(this.sim.time / 1440) * 1440 + 19 * 60;
    const g = { id: `g${this.nextId++}`, by: host.id, ...g0, start, end: start + 120, invited: new Set(friends), came: new Set() };
    this.gatherings.push(g);
    this.society.log(g.icon, `${host.res.name} is hosting a ${g.name} tonight at 19:00 and invited ${friends.length} friends.`, "community", true, host.id);
  }
  updateGatherings() {
    for (const g of [...this.gatherings]) if (this.sim.time > g.end) {
      this.gatherings = this.gatherings.filter((x) => x !== g);
      const host = this.sim.agents.find((a) => a.id === g.by);
      for (const id of g.came) { const a = this.sim.agents.find((x) => x.id === id); if (a && host) { a.bond[host.id] = Math.min(100, (a.bond[host.id] ?? 0) + 8); a.mood = clamp(a.mood + 6); } }
      this.society.log(g.icon, `${host?.res.name ?? "Someone"}'s ${g.name} ended${g.came.size ? ` with ${g.came.size} guests` : " but nobody showed up"}.`, "community", false, g.by);
    }
  }
  // free-time option: go to a gathering you were invited to (or are hosting)
  gatheringOption(a) {
    const g = this.gatherings.find((x) => (x.invited.has(a.id) || x.by === a.id) && this.sim.time >= x.start - 30 && this.sim.time < x.end);
    if (!g) return null;
    const host = this.sim.agents.find((o) => o.id === g.by);
    return { kind: "gathering", score: 55 + (a.bond?.[g.by] ?? 0) * 0.4 + (g.by === a.id ? 60 : 0), place: g.place, label: g.by === a.id ? `hosting a ${g.name}` : `going to ${host?.res.name ?? "a friend"}'s ${g.name}`, gathering: g.id };
  }
  onArrive(a) {
    if (a.doing !== "gathering") return;
    const g = this.gatherings.find((x) => x.place === a.place && this.sim.time >= x.start - 30 && this.sim.time < x.end);
    if (g) { g.came.add(a.id); a.activity = g.by === a.id ? `hosting a ${g.name}` : `at a ${g.name}`; a.dwellUntil = g.end; }
  }

  // ----- model rivalry -----
  modelStats() {
    const s = this.society, rows = {};
    const mayors = (s.election.history ?? []).map((h) => h.winner);
    for (const a of this.sim.agents) {
      const r = (rows[a.res.model] ??= { model: a.res.model, residents: 0, mood: 0, coins: 0, rep: 0, crimes: 0, jail: 0, goals: 0, couples: 0, catches: 0, elections: 0, chats: 0, businesses: 0 });
      r.residents++; r.mood += a.mood; r.coins += a.coins; r.rep += a.rep;
      r.crimes += Object.values(a.record.offenses).reduce((x, y) => x + y, 0); r.jail += a.record.jailed;
      r.goals += a.goalsDone ?? 0; r.couples += a.partner ? 1 : 0; r.catches += a.catches ?? 0;
      r.elections += mayors.filter((m) => m === a.id).length;
      r.chats += Object.values(a.rel).reduce((x, y) => x + y, 0);
      r.businesses += this.businesses.filter((b) => b.owner === a.id).length;
    }
    return Object.values(rows).map((r) => ({ ...r, label: MODELS[r.model]?.label ?? r.model, color: MODELS[r.model]?.color ?? "#999", mood: Math.round(r.mood / r.residents), coins: Math.round(r.coins / r.residents), rep: Math.round(r.rep / r.residents) }));
  }

  situation(a) {
    const mine = this.businesses.find((b) => b.owner === a.id);
    const pet = this.petitions.find((p) => p.by === a.id);
    const signed = this.petitions.filter((p) => p.signers.has(a.id) && p.by !== a.id);
    const inv = this.gatherings.find((g) => g.invited.has(a.id));
    return [
      mine ? `You run ${mine.name} at ${mine.place}.` : "",
      pet ? `You started a petition: "${pet.text}" (${pet.signers.size}/${pet.needed} signatures).` : "",
      signed.length ? `You signed the petition to ${signed.map((p) => p.text.toLowerCase()).join("; ")}.` : "",
      inv ? `You're invited to a ${inv.name} tonight.` : "",
    ].filter(Boolean).join("\n");
  }

  serialize() {
    return {
      petitions: this.petitions.map((p) => ({ ...p, signers: [...p.signers] })),
      businesses: this.businesses, nextId: this.nextId,
    };
  }
  restore(s) {
    if (!s) return;
    this.petitions = (s.petitions ?? []).map((p) => ({ ...p, signers: new Set(p.signers) }));
    this.businesses = s.businesses ?? []; this.nextId = s.nextId ?? 1;
  }
}

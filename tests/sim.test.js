import { test } from "node:test";
import assert from "node:assert/strict";
import { makeSim, run } from "./helpers.js";
import { DISASTERS } from "../public/js/disasters.js";
import { PROJECTS } from "../public/js/construction.js";

function checkInvariants(sim) {
  for (const a of sim.agents) {
    const where = `${a.res.name} (${a.state}) at ${a.x},${a.y}`;
    if (!["away", "jailed", "talking"].includes(a.state)) assert.ok(sim.town.walkable(Math.round(a.x), Math.round(a.y)), `${where} is on walkable ground`);
    for (const k of ["coins", "mood", "rep", "hunger", "energy", "social", "fun", "health"]) assert.ok(Number.isFinite(a[k]), `${where} ${k} is a number`);
    assert.ok(a.coins >= 0, `${where} has non-negative coins`);
    for (const k of ["mood", "rep", "hunger", "energy", "social", "fun", "health"]) assert.ok(a[k] >= 0 && a[k] <= 100, `${where} ${k}=${a[k]} within 0..100`);
    for (const v of Object.values(a.bond)) assert.ok(v >= -100 && v <= 100, `${where} bond within range`);
  }
}

test("the town runs for three days without breaking", async () => {
  const sim = makeSim();
  const errors = [];
  const onErr = (e) => errors.push(e);
  process.on("unhandledRejection", onErr);
  await run(sim, 3 * 1440);
  process.off("unhandledRejection", onErr);
  assert.deepEqual(errors, []);
  assert.ok(sim.time >= 3 * 1440, "time advanced");
  checkInvariants(sim);
  const kinds = new Set(sim.society.gazette.map((e) => e.kind));
  assert.ok(sim.society.gazette.length > 10, "the gazette has news");
  assert.ok(kinds.has("election"), "an election happened");
  assert.ok(sim.society.stats.history.length > 24, "stats were sampled");
  assert.ok(sim.agents.some((a) => a.diary.length), "residents wrote diaries");
});

test("every disaster runs its course and residents react", async () => {
  for (const type of Object.keys(DISASTERS)) {
    const sim = makeSim();
    await run(sim, 120);
    const d = sim.society.disasters.trigger(type);
    assert.ok(d, `${type} triggered`);
    await new Promise((r) => setTimeout(r, 400 + sim.agents.length * 460)); // reactions arrive a few at a time
    assert.ok(Object.keys(d.actions).length > 0, `${type}: residents reacted`);
    await run(sim, DISASTERS[type].duration + 60);
    assert.ok(!sim.society.disasters.active.includes(d), `${type} ended`);
    checkInvariants(sim);
  }
});

test("construction projects get built and open", async () => {
  const sim = makeSim();
  const c = sim.society.construction;
  sim.society.treasury = 5000;
  assert.equal(c.start("flats", "A"), "the Cottage Row lot can't take Riverside Flats.");
  assert.equal(c.start("flats", "B"), null);
  assert.equal(c.start("theater", "A"), null);
  assert.ok(c.start("gym", "A"), "a lot under construction can't take a second project");
  const capBefore = sim.society.population.capacity();
  await run(sim, 30 * 60);
  assert.ok(c.isBuilt("flats") && c.isBuilt("theater"), "both finished");
  assert.equal(sim.society.population.capacity(), capBefore + 12, "the flats added 12 homes");
  assert.ok(sim.town.places.theater.length > 0, "the theater is a place");
});

test("immigration policy and housing", async () => {
  const sim = makeSim();
  const pop = sim.society.population;
  pop.setPolicy("closed");
  const before = sim.agents.length;
  for (let i = 0; i < 20; i++) pop.maybeArrive();
  assert.equal(sim.agents.length, before, "closed borders: nobody arrives");
  sim.society.treasury = 100;
  assert.match(pop.buildUnits(), /needs 250/);
  sim.society.treasury = 1000;
  const cap = pop.capacity();
  assert.equal(pop.buildUnits(), null);
  assert.equal(pop.capacity(), cap + 4);
  pop.setPolicy("open");
  for (let i = 0; i < 40; i++) pop.maybeArrive();
  assert.ok(sim.agents.length > before, "open borders: newcomers arrive");
  assert.ok(sim.agents.length <= pop.capacity(), "never more residents than homes");
});

test("laws ignore bad input from models or the form", () => {
  const sim = makeSim();
  const s = sim.society;
  const n = s.laws.length;
  s.addLaw({ type: "constructor" });
  s.addLaw({ type: "custom", text: "   " });
  assert.equal(s.laws.length, n, "unknown types and empty custom laws are ignored");
  s.addLaw({ type: "tax", param: 500 });
  assert.equal(s.law("tax").param, 50, "tax is capped");
  s.addLaw({ type: "curfew", param: 99 });
  assert.equal(s.law("curfew").param, 23, "a nonsense hour falls back to the default");
  s.addLaw({ type: "curfew", param: 1 });
  assert.equal(s.law("curfew").param, 1, "after-midnight curfews are allowed");
  s.addLaw({ type: "custom", text: "x".repeat(5000) });
  assert.ok(s.laws.at(-1).text.length <= 200, "custom law text is clipped");
});

test("projects and lots are consistent", () => {
  for (const [id, p] of Object.entries(PROJECTS)) {
    assert.ok(p.cost > 0 && p.hours > 0, `${id} has a cost and build time`);
    assert.equal(p.art.length, 4, `${id} has art`);
  }
});

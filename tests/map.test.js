import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTown, findPath, W, H } from "../public/js/map.js";
import { BUILDINGS, LOTS, RIVERTON_EXIT, HOMES } from "../public/js/mapdata.js";

const town = buildTown();
const FROM = { x: 20, y: 19 }; // the south road by the plaza

const reachable = (x, y) => !!findPath(town, FROM.x, FROM.y, x, y);

test("map has the expected size", () => {
  assert.equal(W, 48);
  assert.equal(H, 64);
});

test("every home can be reached on foot", () => {
  for (const h of HOMES) assert.ok(reachable(h.x, h.y), `home ${h.name} at ${h.x},${h.y}`);
});

test("every place has standing spots and they can be reached", () => {
  for (const [name, tiles] of Object.entries(town.places)) {
    if (name === "jailyard") { assert.ok(tiles.length > 0, "jail yard has tiles"); continue; }
    assert.ok(tiles.length > 0, `${name} has standing spots`);
    for (const t of tiles) assert.ok(reachable(t.x, t.y), `${name} spot ${t.x},${t.y}`);
  }
});

test("building doors, lots and the road to Riverton can be reached", () => {
  for (const b of BUILDINGS) assert.ok(reachable(b.door[0], b.door[1]), `${b.name} door`);
  for (const l of LOTS) assert.ok(reachable(l.door[0], l.door[1]), `${l.name} door`);
  assert.ok(reachable(RIVERTON_EXIT.x, RIVERTON_EXIT.y), "Riverton exit");
  assert.ok(reachable(town.special.jail.door.x, town.special.jail.door.y), "jail door");
});

test("paths move one tile at a time over walkable ground", () => {
  const p = findPath(town, FROM.x, FROM.y, RIVERTON_EXIT.x, RIVERTON_EXIT.y);
  assert.ok(p && p.length > 20);
  let prev = FROM;
  for (const step of p) {
    assert.equal(Math.abs(step.x - prev.x) + Math.abs(step.y - prev.y), 1, "single step");
    assert.ok(town.walkable(step.x, step.y), `walkable ${step.x},${step.y}`);
    prev = step;
  }
  assert.deepEqual(p.at(-1), { x: RIVERTON_EXIT.x, y: RIVERTON_EXIT.y });
});

test("no path into a blocked tile", () => {
  // the fountain in the plaza is solid
  assert.equal(findPath(town, FROM.x, FROM.y, 23, 15), null);
});

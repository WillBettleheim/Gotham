// Run Gotham's simulation in Node with no browser: tiny stand-ins for the browser APIs it touches.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
// no AI in tests: every model call fails, so residents use their built-in behaviour
globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: "offline" }) });
globalThis.location ??= { reload() {} };

const { buildTown } = await import("../public/js/map.js");
const { Sim } = await import("../public/js/sim.js");

export function stubUI() {
  return {
    beginConversation: () => ({}), addLine() {}, endConversation() {}, noteCall() {}, noteError() {},
    refreshCard() {}, addResident() {}, removeResident() {},
  };
}

export function makeSim() {
  localStorage.clear();
  const town = buildTown();
  const sim = new Sim(town, stubUI());
  sim.start();
  return sim;
}

// advance the simulation by game minutes, letting async work (conversations) run in between
export async function run(sim, minutes, speed = 40) {
  sim.speed = speed;
  const perStep = speed * 0.5; // sim.update(1) advances speed * 0.5 game minutes
  const steps = Math.ceil(minutes / perStep);
  for (let i = 0; i < steps; i++) {
    sim.update(1);
    if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

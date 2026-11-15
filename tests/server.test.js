import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatCompletion } from "../providers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3917;
let server;

before(async () => {
  server = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT), AI_TOWN_OFFLINE: "1" }, stdio: "pipe" });
  await new Promise((resolve, reject) => {
    server.stdout.on("data", (d) => { if (String(d).includes("is open at")) resolve(); });
    server.on("exit", (c) => reject(new Error(`server exited ${c}`)));
  });
});
after(() => server?.kill());

const call = (method, p, body) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port: PORT, path: p, method, headers: { "Content-Type": "application/json" } }, (res) => {
    let data = ""; res.on("data", (c) => (data += c)); res.on("end", () => resolve({ status: res.statusCode, body: data }));
  });
  req.on("error", reject);
  if (body) req.write(JSON.stringify(body));
  req.end();
});

test("status reports offline mode and cost tracking", async () => {
  const r = await call("GET", "/api/status");
  assert.equal(r.status, 200);
  const s = JSON.parse(r.body);
  assert.equal(s.live, false);
  assert.equal(s.stats.cost, 0);
  assert.ok(s.prices["claude-opus-5-5"]);
});

test("model requests fail cleanly when offline", async () => {
  for (const [p, body] of [["/api/talk", { speakerId: "sonny", listenerId: "mira" }], ["/api/chat", { agentId: "sonny", message: "hi" }], ["/api/think", { kind: "plan", agentId: "sonny" }]]) {
    const r = await call("POST", p, body);
    assert.equal(r.status, 503, p);
  }
});

test("unknown residents and bad requests are rejected", async () => {
  assert.equal((await call("POST", "/api/think", { kind: "plan", agentId: "../etc" })).status, 400);
  assert.equal((await call("POST", "/api/think", { kind: "hack", agentId: "sonny" })).status, 400);
  assert.equal((await call("POST", "/api/talk", { speakerId: "nobody", listenerId: "sonny" })).status, 400);
});

test("the spending cap can be set and cleared", async () => {
  assert.equal(JSON.parse((await call("POST", "/api/budget", { usd: 5 })).body).budget, 5);
  assert.equal(JSON.parse((await call("POST", "/api/budget", { usd: 0 })).body).budget, null);
});

test("static files are served and paths can't escape the public folder", async () => {
  assert.equal((await call("GET", "/")).status, 200);
  assert.equal((await call("GET", "/js/map.js")).status, 200);
  const r = await call("GET", "/../server.js");
  assert.ok([403, 404].includes(r.status), `traversal blocked (${r.status})`);
  assert.equal((await call("GET", "/%2e%2e/server.js")).status !== 200, true);
});

test("the provider client talks to an OpenAI-style API", async () => {
  const fake = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      if (req.headers.authorization !== "Bearer good") { res.writeHead(401); return res.end("nope"); }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: "<think>hmm</think>Hello there <bye>" } }], usage: { prompt_tokens: 7, completion_tokens: 3 } }));
    });
  });
  await new Promise((r) => fake.listen(0, r));
  const base = `http://127.0.0.1:${fake.address().port}`;
  const ok = await chatCompletion({ baseUrl: base, apiKey: "good", model: "x", extra: {} }, "sys", "hi", 50);
  assert.equal(ok.text, "Hello there <bye>");
  assert.deepEqual(ok.usage, { input: 7, output: 3 });
  await assert.rejects(chatCompletion({ baseUrl: base, apiKey: "bad", model: "x", extra: {} }, "sys", "hi", 50), /401/);
  fake.close();
});

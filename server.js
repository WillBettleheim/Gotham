// AI Town server: serves the 2D town and lets each resident speak through its own Claude model.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { RESIDENTS, MODELS, TOWN_NAME, residentById } from "./public/js/residents.js";
import { resolveProvider, chatCompletion } from "./providers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, "public");

// Tiny .env loader so you can just drop ANTHROPIC_API_KEY=... into .env
try {
  for (const line of fs.readFileSync(path.join(here, ".env"), "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const PORT = Number(process.env.PORT) || 3000;
// Only this computer can reach the town by default. Set HOST=0.0.0.0 to share it on your network
// (anyone who can reach it can then spend your API credits, so keep AI_BUDGET_USD set).
const HOST = process.env.HOST || "127.0.0.1";
const OFFLINE = process.env.AI_TOWN_OFFLINE === "1";
const CLAUDE_LIVE = !OFFLINE && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = CLAUDE_LIVE ? new Anthropic({ timeout: 60_000, maxRetries: 1 }) : null;
const isClaude = (model) => model.startsWith("claude-");
const own = (obj, key) => typeof key === "string" && Object.hasOwn(obj, key);

// Which residents' models can actually be reached right now.
const LIVE_MODELS = Object.fromEntries(
  Object.keys(MODELS).map((m) => [m, !OFFLINE && (isClaude(m) ? CLAUDE_LIVE : Boolean(resolveProvider(m)))])
);
const LIVE = Object.values(LIVE_MODELS).some(Boolean);

// Opus 5.5 and Sonnet 5.5 support server-side refusal fallbacks.
const SERVER_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

// ---------- cost tracking ----------
// USD per million tokens [input, output]. Claude prices are Anthropic's list prices; the others are
// rough estimates (free tiers count as $0) and can be overridden with PRICE_<MODEL>=in,out in .env.
const DEFAULT_PRICES = {
  "claude-opus-5-5": [4, 20], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [0.1, 0.5],
  gemini: [0.3, 2.5], gpt: [0, 0], llama: [0, 0], mistral: [0.1, 0.3], deepseek: [0.27, 1.1],
};
if (process.env.OPENAI_API_KEY) DEFAULT_PRICES.gpt = [0.25, 2];
const PRICES = Object.fromEntries(Object.entries(DEFAULT_PRICES).map(([m, p]) => {
  const env = process.env[`PRICE_${m.replace(/[^a-z0-9]/gi, "_").toUpperCase()}`];
  const parsed = env?.split(",").map(Number);
  return [m, parsed?.length === 2 && parsed.every((n) => n >= 0) ? parsed : p];
}));
const stats = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, cost: 0, byModel: {}, startedAt: Date.now(), budget: Number(process.env.AI_BUDGET_USD) > 0 ? Number(process.env.AI_BUDGET_USD) : null, budgetHit: false };
function record(model, input, output) {
  const [pi, po] = own(PRICES, model) ? PRICES[model] : [0, 0];
  const cost = (input * pi + output * po) / 1e6;
  const m = (stats.byModel[model] ??= { calls: 0, input: 0, output: 0, cost: 0 });
  m.calls++; m.input += input; m.output += output; m.cost += cost;
  stats.calls++; stats.inputTokens += input; stats.outputTokens += output; stats.cost += cost;
  if (stats.budget && stats.cost >= stats.budget && !stats.budgetHit) { stats.budgetHit = true; console.log(`  AI budget of $${stats.budget} reached; residents switch to offline chatter.`); }
}
class BudgetError extends Error {}

// Keep a lid on parallel requests, on the queue behind them, and on calls per minute,
// so nothing (a bug, a runaway tab) can flood the model APIs and run up a bill.
let active = 0;
const waiting = [];
const MAX_PARALLEL = 3;
const MAX_WAITING = 40;
const MAX_PER_MINUTE = Number(process.env.AI_MAX_CALLS_PER_MINUTE) || 60;
const recentCalls = [];
class BusyError extends Error {}
async function withSlot(fn) {
  const now = Date.now();
  while (recentCalls.length && now - recentCalls[0] > 60_000) recentCalls.shift();
  if (recentCalls.length >= MAX_PER_MINUTE || waiting.length >= MAX_WAITING) throw new BusyError("too many requests");
  recentCalls.push(now);
  if (active >= MAX_PARALLEL) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

async function ask(model, system, user, maxTokens = 2000) {
  if (stats.budget && stats.cost >= stats.budget) throw new BudgetError("budget reached");
  if (!isClaude(model)) {
    const { text, usage } = await withSlot(() => chatCompletion(resolveProvider(model), system, user, 1024));
    record(model, usage.input, usage.output);
    return text;
  }
  const params = {
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
    output_config: { effort: "low" }, // casual chat: keep it quick and cheap
  };
  const res = await withSlot(() =>
    SERVER_FALLBACK.has(model)
      ? client.beta.messages.create({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })
      : client.messages.create(params)
  );
  const u = res.usage ?? {};
  record(model, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0), u.output_tokens ?? 0);
  if (res.stop_reason === "refusal") return null;
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return text || null;
}

function personaPrompt(r) {
  return `You are ${r.name}, a resident of ${TOWN_NAME}, a small, cozy 2D town where AI characters live together as neighbors.
The town is home to AIs from many different labs (Anthropic's Claude, Google's Gemini, OpenAI's GPT, DeepSeek, Meta's Llama, Mistral) and they all get along as neighbors.
You run on ${MODELS[r.model].label}. Everyone knows which model each neighbor runs on; it's a friendly part of identity, like a hometown, and you can joke about it lightly, but it's not what you talk about most.

Who you are: ${r.role}.
Personality: ${r.personality}.
How you talk: ${r.style}.

Town places: Town Hall (with its clock tower; court is held there), the Library, the General Store, the Inn (food and drink), Fountain Plaza, the Market, the river with its waterfall and wooden bridge, the Blacksmith forge, the Clinic, the farm with its fields, barn and windmill, the Jail in the south-east clearing, and the town gate to the south.
Life in Gotham works like real life: you have a job and earn coins, pay rent and buy food, belong to a community, vote for a mayor, and live under laws set by the citizens' council. You're free to do what you want, but choices have consequences (no work means no pay; broken laws mean fines or jail if you're caught). Talk about these things naturally when they matter to you.
Neighbors: ${RESIDENTS.filter((x) => x.id !== r.id).map((x) => `${x.name} (${x.role}, ${MODELS[x.model].short})`).join("; ")}.

You are chatting in person with a neighbor. Reply with ONLY the words you say out loud: no name prefix, no quotation marks, no narration. Keep it to one or two short sentences (under 35 words). Be specific and grounded in your life, the place, the time of day, things you remember and town news. React to what was just said, ask questions sometimes, invent small concrete details about your day, and never repeat yourself. When the chat has reached a natural end, say goodbye and add <bye> at the very end.`;
}

const clip = (s, n) => String(s ?? "").slice(0, n);

// Original residents are defined in residents.js; newcomers who moved in at runtime send their persona.
function who(id, persona) {
  const known = residentById(id);
  if (known) return known;
  if (!persona || typeof persona !== "object" || !own(MODELS, persona.model) || typeof id !== "string" || !/^n_[\w]{1,40}$/.test(id)) return null;
  return {
    id, model: persona.model,
    name: clip(persona.name, 30), role: clip(persona.role, 200),
    personality: clip(persona.personality, 200), style: clip(persona.style, 120),
  };
}
const nameOf = (h) => residentById(h.id)?.name ?? (clip(h.name, 30) || "Someone");
const list = (a, n) => (Array.isArray(a) ? a.slice(-n) : []);

function talkPrompt(sp, li, b) {
  const memories = list(b.memories, 6).map((m) => `- ${clip(m, 200)}`).join("\n") || "- (nothing yet, you barely know them)";
  const news = list(b.news, 3).map((n) => `- ${clip(n, 200)}`).join("\n") || "- (no news today)";
  const history = list(b.history, 12)
    .map((h) => `${nameOf(h)}: ${clip(h.text, 300)}`)
    .join("\n");
  const turnsLeft = Math.max(0, Number(b.maxTurns) - Number(b.turn));
  return `It's ${clip(b.time, 40)}. You're at ${clip(b.place, 60)}, ${clip(b.activity, 80)}.
${Array.isArray(b.group) && b.group.length > 1 ? `You're chatting in a group with ${list(b.group, 4).map((n) => clip(n, 30)).join(", ")}. Speak to the group, and reply to whoever spoke last.` : `You're talking with ${li.name}, ${li.role}.`}

Your life right now:
${clip(b.situation, 2500) || "(nothing special)"}
${b.plan ? `Your plan for today: ${clip(b.plan, 200)}` : ""}

What you remember about ${li.name}:
${memories}

Town news:
${news}

${history ? `Conversation so far:\n${history}\n\nNow it's your turn to reply to ${li.name}.` : `You just bumped into ${li.name}. Start the conversation.`}${turnsLeft <= 1 ? " You need to head off soon, so wrap up and say goodbye." : ""}`;
}

function reflectPrompt(r, other, b) {
  const history = list(b.history, 12)
    .map((h) => `${nameOf(h)}: ${clip(h.text, 300)}`)
    .join("\n");
  return `You just finished this conversation with ${other.name} at ${clip(b.place, 60)}:

${history}

Reply with JSON only: {"memory": "<one short first-person sentence, under 25 words, about what you'll remember about ${other.name}>", "feeling": <a number from -2 (this made me dislike them) to 2 (this made me like them much more)>}`;
}

function chatPrompt(r, b) {
  const lines = list(b.history, 10).map((h) => `${h.from === "you" ? r.name : "Council member"}: ${clip(h.text, 300)}`).join("\n");
  return `Your situation:
${clip(b.situation, 3000)}

A member of Gotham's citizens' council (the people who set the town's laws) has come to talk with you directly.
${lines ? `Conversation so far:\n${lines}\n` : ""}Council member: ${clip(b.message, 500)}

Reply in character, honestly, as ${r.name} would. Speak your mind about your life, the laws, the mayor and your neighbors. One to three sentences. Output only what you say.`;
}

// ---------- decisions: plans, speeches, votes, proposals, judging ----------
const JUDGE_ORDER = ["claude-haiku-5-5", "gemini", "llama", "mistral", "gpt", "deepseek", "claude-sonnet-5-5", "claude-opus-5-5"];

function parseJson(text) {
  if (!text) return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function thinkPrompt(kind, r, b) {
  const situation = `Your situation:\n${clip(b.situation, 3000)}`;
  if (kind === "plan") {
    const ids = list(b.lawIds, 10).map((x) => clip(x, 20));
    const acts = Object.entries(b.activities && typeof b.activities === "object" ? b.activities : {}).slice(0, 12)
      .map(([k, v]) => `- "${clip(k, 20)}": ${clip(v, 80)}`).join("\n");
    const goals = Object.entries(b.goals && typeof b.goals === "object" ? b.goals : {}).slice(0, 12)
      .map(([k, v]) => `- "${clip(k, 20)}": ${clip(v, 80)}`).join("\n");
    return `${situation}

It's morning. Decide how you'll spend today. You are completely free to choose, like a real person: work or skip work, follow the laws or break them, and spend your free time however you like. Choices have consequences: skipping work means no wages (and maybe a fine if work is mandatory), and breaking a law means a fine or jail if you're caught, which also hurts your reputation. Fishing and gardening can earn you something to sell or eat. Decide the way ${r.name} genuinely would.

Things you could do in your free time:
${acts || "- (anything)"}
${goals ? `\nYou don't have a personal goal right now. Pick one to work toward:\n${goals}\n` : ""}
Reply with JSON only, no other text:
{"work": true or false, "defy": [law types from ${JSON.stringify(ids)} you're willing to break today, or empty], "wishes": [up to 3 free-time activity ids from the list, most wanted first], ${goals ? `"goal": "<goal id>", "why": "<why this goal matters to you, max 15 words>", "dream": "<your big life dream, max 15 words>", ` : ""}"intention": "one short first-person sentence about your plan for today"}`;
  }
  if (kind === "decide") {
    const opts = list(b.options, 8).map((o) => `- "${clip(o.id, 4)}": ${clip(o.label, 90)}`).join("\n");
    return `${situation}

You have some free time right now. Nobody tells you what to do: you decide, like a real person, based on how you feel, your goal, your dream and your personality. These are the things you could do next:
${opts}

Reply with JSON only: {"choice": "<option id>", "thought": "<what you're thinking, first person, max 18 words>"}`;
  }
  if (kind === "react") {
    const opts = list(b.options, 8).map((o) => `- "${clip(o.id, 4)}": ${clip(o.label, 100)}`).join("\n");
    return `${situation}

EMERGENCY: ${clip(b.disaster, 300)}
What do you do right now? React the way ${r.name} truly would: brave, scared, selfish, generous, practical. Your options:
${opts}

Reply with JSON only: {"choice": "<option id>", "thought": "<what goes through your head, max 15 words>", "say": "<what you shout or say out loud, max 12 words>"}`;
  }
  if (kind === "story") {
    const events = list(b.events, 10).map((e) => `- ${clip(e, 200)}`).join("\n") || "- (nothing big yet)";
    return `${situation}

Your life story so far: ${clip(b.story, 800) || "(not written yet)"}
Big moments recently:
${events}
Tonight's diary: ${clip(b.diary, 600)}

Rewrite your life story in Gotham so far, in first person, in at most 80 words, keeping the most important moments and relationships. Output only the story.`;
  }
  if (kind === "diary") {
    return `${situation}

It's late at night. Write tonight's entry in your private diary about your day in Gotham: what happened, how you feel about it, and what's on your mind for tomorrow. Two to four sentences, first person, in your own voice. Output only the diary entry.`;
  }
  if (kind === "speech") {
    return `${situation}

You're running for mayor of Gotham, representing your community. Give a short campaign speech (max 35 words) in your own voice: what you'd do for the town, maybe which laws you'd change. Output only the speech.`;
  }
  if (kind === "vote") {
    const cands = list(b.candidates, 8).map((c) => `- id "${clip(c.id, 20)}": ${clip(c.name, 30)} (${clip(c.community, 40)}, values: ${clip(c.values, 100)}; reputation ${Number(c.rep) || 0}/100; ${Number(c.record) || 0} past offenses). Speech: "${clip(c.speech, 300)}"`).join("\n");
    return `${situation}

It's election day in Gotham. The candidates for mayor are:
${cands}

Who do you vote for? Vote the way ${r.name} genuinely would.
Reply with JSON only: {"vote": "<candidate id>", "reason": "<first-person reason, max 15 words>"}`;
  }
  if (kind === "propose") {
    const types = list(b.types, 10).map((t) => `- "${clip(t.type, 20)}": ${clip(t.title, 40)}${t.param ? ` (needs param: ${clip(t.param, 30)})` : ""}`).join("\n");
    const laws = list(b.laws, 15).map((l) => `- id "${clip(l.id, 20)}": ${clip(l.text, 200)}`).join("\n") || "- (none)";
    return `${situation}

You were just elected mayor of Gotham! You may propose ONE law change to the citizens' council, who will accept or reject it.
Current laws:
${laws}
Law types you can enact:
${types}
- "custom": any law you write yourself

Reply with JSON only:
{"action": "enact" or "repeal", "type": "<law type, if enacting>", "param": <number or null>, "lawId": "<id, if repealing>", "text": "<law text, only for custom>", "reason": "<short first-person reason>"}`;
  }
  return "";
}

function judgePrompt(b) {
  const laws = list(b.laws, 10).map((l) => `- id "${clip(l.id, 20)}": ${clip(l.text, 200)}`).join("\n");
  const history = list(b.history, 12).map((h) => `[${clip(h.id, 20)}] ${nameOf(h)}: ${clip(h.text, 300)}`).join("\n");
  return `Custom laws of Gotham:
${laws}

Conversation (speaker id in brackets):
${history}

Which speakers clearly broke one of these laws through what they said? Only count clear violations, not borderline ones.
Reply with JSON only: {"violations": [{"speaker": "<speaker id>", "lawId": "<law id>", "why": "<short>"}]}`;
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new HttpError(415, "send JSON");
  let body = "", size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2_000_000) throw new HttpError(413, "too large"); // way too big: drop the connection
    if (size <= 100_000) body += chunk; // a bit too big: read and discard the rest, then answer 413
  }
  if (size > 100_000) throw new HttpError(413, "too large");
  let data;
  try { data = JSON.parse(body || "{}"); } catch { throw new HttpError(400, "bad JSON"); }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new HttpError(400, "bad request");
  return data;
}

// Model replies end up on the page, so strip anything that could be read as HTML.
function clean(v, depth = 0) {
  if (typeof v === "string") return v.replace(/[<>]/g, "").slice(0, 2000);
  if (Array.isArray(v)) return depth > 4 ? [] : v.slice(0, 50).map((x) => clean(x, depth + 1));
  if (v && typeof v === "object") {
    if (depth > 4) return {};
    const out = {};
    for (const [k, x] of Object.entries(v).slice(0, 50)) if (k !== "__proto__") out[k] = clean(x, depth + 1);
    return out;
  }
  return v;
}

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": [
    "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com", "img-src 'self' data: blob:", "connect-src 'self'", "media-src 'self' blob:",
    "object-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join("; "),
};

function send(res, code, obj) {
  res.writeHead(code, { ...SECURITY_HEADERS, "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(clean(obj)));
}

// The API only answers the town's own page. This blocks other websites you visit (and DNS-rebinding
// tricks) from using your API keys through your browser.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
function allowedRequest(req) {
  const host = String(req.headers.host ?? "");
  const hostname = host.replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(hostname) && hostname !== HOST.toLowerCase() && !(process.env.ALLOWED_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).includes(hostname)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host.toLowerCase() !== host.toLowerCase()) return false; } catch { return false; }
  }
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") return false;
  return true;
}

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon",
  ".json": "application/json", ".woff2": "font/woff2",
};

const server = http.createServer(async (req, res) => {
  let url;
  try { url = new URL(req.url, "http://localhost"); } catch { return send(res, 400, { error: "bad url" }); }
  try {
    if (url.pathname.startsWith("/api/")) {
      if (!allowedRequest(req)) return send(res, 403, { error: "forbidden" });
    } else if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method not allowed" });
    if (url.pathname === "/api/status") {
      const hours = Math.max(1 / 60, (Date.now() - stats.startedAt) / 3600e3);
      return send(res, 200, { live: LIVE, liveModels: LIVE_MODELS, town: TOWN_NAME, stats, prices: PRICES, perHour: stats.cost / hours });
    }
    if (req.method === "POST" && url.pathname === "/api/budget") {
      const b = await readJson(req);
      const usd = Number(b.usd);
      stats.budget = usd > 0 ? Math.min(usd, 100000) : null;
      stats.budgetHit = !!stats.budget && stats.cost >= stats.budget;
      return send(res, 200, { budget: stats.budget });
    }
    if (req.method === "POST" && url.pathname === "/api/chat") {
      const b = await readJson(req);
      const r = who(b.agentId, b.persona);
      if (!r) return send(res, 400, { error: "unknown resident" });
      if (!LIVE_MODELS[r.model]) return send(res, 503, { error: "offline" });
      const raw = await ask(r.model, personaPrompt(r), chatPrompt(r, b), 2000);
      return send(res, 200, { text: raw?.replace(/^["“]|["”]$/g, "").trim() ?? null });
    }
    if (req.method === "POST" && url.pathname === "/api/think") {
      const b = await readJson(req);
      if (b.kind === "judge") {
        const judge = JUDGE_ORDER.find((m) => LIVE_MODELS[m]);
        if (!judge) return send(res, 503, { error: "offline" });
        const sys = `You are the impartial judge of ${TOWN_NAME}, a town of AI residents. You apply the town's laws strictly and fairly, and only to clear violations.`;
        const out = parseJson(await ask(judge, sys, judgePrompt(b), 2000));
        return out ? send(res, 200, out) : send(res, 502, { error: "unparseable" });
      }
      const r = who(b.agentId, b.persona);
      if (!r || !["plan", "decide", "speech", "vote", "propose", "react", "diary", "story"].includes(b.kind)) return send(res, 400, { error: "bad request" });
      if (!LIVE_MODELS[r.model]) return send(res, 503, { error: "offline" });
      const raw = await ask(r.model, personaPrompt(r), thinkPrompt(b.kind, r, b), 2000);
      if (b.kind === "speech" || b.kind === "diary" || b.kind === "story") return send(res, 200, { text: raw?.replace(/^["“]|["”]$/g, "").trim() ?? null });
      const out = parseJson(raw);
      return out ? send(res, 200, out) : send(res, 502, { error: "unparseable" });
    }
    if (req.method === "POST" && (url.pathname === "/api/talk" || url.pathname === "/api/reflect")) {
      const b = await readJson(req);
      if (url.pathname === "/api/talk") {
        const sp = who(b.speakerId, b.persona), li = who(b.listenerId, b.listenerPersona);
        if (!sp || !li) return send(res, 400, { error: "unknown resident" });
        if (!LIVE_MODELS[sp.model]) return send(res, 503, { error: "offline" });
        const raw = await ask(sp.model, personaPrompt(sp), talkPrompt(sp, li, b), 2000);
        if (!raw) return send(res, 200, { text: null });
        const end = /<bye>/i.test(raw);
        const text = raw
          .replace(/<bye>/gi, "")
          .replace(new RegExp(`^\\s*${sp.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:\\s*`, "i"), "")
          .replace(/^["“]|["”]$/g, "")
          .trim();
        return send(res, 200, { text, end, model: sp.model });
      } else {
        const r = who(b.agentId, b.persona), other = who(b.otherId, b.otherPersona);
        if (!r || !other) return send(res, 400, { error: "unknown resident" });
        if (!LIVE_MODELS[r.model]) return send(res, 503, { error: "offline" });
        const raw = await ask(r.model, personaPrompt(r), reflectPrompt(r, other, b), 1500);
        const out = parseJson(raw);
        const feeling = Math.max(-2, Math.min(2, Number(out?.feeling) || 0));
        return send(res, 200, { memory: out?.memory ? String(out.memory) : raw, feeling });
      }
    }

    if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "not found" });

    // Static files: only real files inside public/, no hidden files, no escaping the folder.
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: "bad path" }); }
    if (rel.includes("\0") || rel.split(/[\\/]/).some((part) => part.startsWith("."))) return send(res, 404, { error: "not found" });
    let file = path.resolve(publicDir, "." + path.posix.normalize("/" + rel));
    if (file !== publicDir && !file.startsWith(publicDir + path.sep)) return send(res, 403, { error: "forbidden" });
    let st = fs.statSync(file, { throwIfNoEntry: false });
    if (st?.isDirectory()) { file = path.join(file, "index.html"); st = fs.statSync(file, { throwIfNoEntry: false }); }
    if (!st?.isFile()) return send(res, 404, { error: "not found" });
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(publicDir) + path.sep)) return send(res, 403, { error: "forbidden" });
    res.writeHead(200, { ...SECURITY_HEADERS, "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream", "Content-Length": st.size, "Cache-Control": "no-cache" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(real).on("error", () => res.destroy()).pipe(res);
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (err instanceof BusyError) return send(res, 429, { error: "busy" });
    stats.errors++;
    if (err instanceof BudgetError) return send(res, 503, { error: "budget" });
    if (err instanceof Anthropic.APIError || err.status || err.name === "TimeoutError") {
      console.error(`[model] ${err.status ?? ""} ${err.message}`);
      return send(res, 502, { error: "model error", status: err.status });
    }
    console.error(err);
    send(res, 500, { error: "server error" });
  }
});

server.headersTimeout = 20_000;
server.requestTimeout = 120_000;
server.listen(PORT, HOST, () => {
  console.log(`\n  🏘️  ${TOWN_NAME} is open at http://localhost:${PORT}\n`);
  if (!LOCAL_HOSTS.has(HOST)) console.log(`  ⚠️  Shared on your network (HOST=${HOST}). Anyone who can reach it can use your API keys; set AI_BUDGET_USD.\n`);
  for (const [m, on] of Object.entries(LIVE_MODELS)) {
    const who = RESIDENTS.filter((r) => r.model === m).map((r) => r.name).join(", ");
    console.log(`  ${on ? "🟢 live   " : "⚪ offline"} ${MODELS[m].label.padEnd(18)} ${who}`);
  }
  if (!LIVE) console.log("\n  No API keys found, so everyone uses built-in chatter. See .env.example to bring them to life.");
  console.log("");
});

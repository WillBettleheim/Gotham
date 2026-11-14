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
const OFFLINE = process.env.AI_TOWN_OFFLINE === "1";
const CLAUDE_LIVE = !OFFLINE && Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = CLAUDE_LIVE ? new Anthropic() : null;
const isClaude = (model) => model.startsWith("claude-");

// Which residents' models can actually be reached right now.
const LIVE_MODELS = Object.fromEntries(
  Object.keys(MODELS).map((m) => [m, !OFFLINE && (isClaude(m) ? CLAUDE_LIVE : Boolean(resolveProvider(m)))])
);
const LIVE = Object.values(LIVE_MODELS).some(Boolean);

// Opus 5.5 and Sonnet 5.5 support server-side refusal fallbacks.
const SERVER_FALLBACK = new Set(["claude-opus-5-5", "claude-sonnet-5-5"]);

const stats = { calls: 0, errors: 0, inputTokens: 0, outputTokens: 0, byModel: {} };

// Keep a lid on parallel requests.
let active = 0;
const waiting = [];
const MAX_PARALLEL = 3;
async function withSlot(fn) {
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
  if (!isClaude(model)) {
    const { text, usage } = await withSlot(() => chatCompletion(resolveProvider(model), system, user, 1024));
    stats.calls++;
    stats.inputTokens += usage.input;
    stats.outputTokens += usage.output;
    stats.byModel[model] = (stats.byModel[model] ?? 0) + 1;
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
  stats.calls++;
  stats.inputTokens += res.usage?.input_tokens ?? 0;
  stats.outputTokens += res.usage?.output_tokens ?? 0;
  stats.byModel[model] = (stats.byModel[model] ?? 0) + 1;
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
const list = (a, n) => (Array.isArray(a) ? a.slice(-n) : []);

function talkPrompt(sp, li, b) {
  const memories = list(b.memories, 6).map((m) => `- ${clip(m, 200)}`).join("\n") || "- (nothing yet, you barely know them)";
  const news = list(b.news, 3).map((n) => `- ${clip(n, 200)}`).join("\n") || "- (no news today)";
  const history = list(b.history, 12)
    .map((h) => `${residentById(h.id)?.name ?? "Someone"}: ${clip(h.text, 300)}`)
    .join("\n");
  const turnsLeft = Math.max(0, Number(b.maxTurns) - Number(b.turn));
  return `It's ${clip(b.time, 40)}. You're at ${clip(b.place, 60)}, ${clip(b.activity, 80)}.
You're talking with ${li.name}, ${li.role}.

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
    .map((h) => `${residentById(h.id)?.name ?? "Someone"}: ${clip(h.text, 300)}`)
    .join("\n");
  return `You just finished this conversation with ${other.name} at ${clip(b.place, 60)}:

${history}

In one short sentence (under 25 words), first person, write what you'll remember about ${other.name} from this. Output only the sentence.`;
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
    return `${situation}

It's morning. Decide how you'll spend today. You are completely free to choose: work or skip work, follow the laws or break them. But choices have consequences: skipping work means no wages (and maybe a fine if work is mandatory), and breaking a law means a fine or jail if you're caught, which also hurts your reputation. Decide the way ${r.name} genuinely would.

Reply with JSON only, no other text:
{"work": true or false, "defy": [law types from ${JSON.stringify(ids)} you're willing to break today, or empty], "intention": "one short first-person sentence about your plan for today"}`;
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
  const history = list(b.history, 12).map((h) => `[${clip(h.id, 20)}] ${residentById(h.id)?.name ?? "Someone"}: ${clip(h.text, 300)}`).join("\n");
  return `Custom laws of Gotham:
${laws}

Conversation (speaker id in brackets):
${history}

Which speakers clearly broke one of these laws through what they said? Only count clear violations, not borderline ones.
Reply with JSON only: {"violations": [{"speaker": "<speaker id>", "lawId": "<law id>", "why": "<short>"}]}`;
}

async function readJson(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("too large");
  }
  return JSON.parse(body || "{}");
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(obj));
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname === "/api/status") {
      return send(res, 200, { live: LIVE, liveModels: LIVE_MODELS, town: TOWN_NAME, stats });
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
      const r = residentById(b.agentId);
      if (!r || !["plan", "speech", "vote", "propose"].includes(b.kind)) return send(res, 400, { error: "bad request" });
      if (!LIVE_MODELS[r.model]) return send(res, 503, { error: "offline" });
      const raw = await ask(r.model, personaPrompt(r), thinkPrompt(b.kind, r, b), 2000);
      if (b.kind === "speech") return send(res, 200, { text: raw?.replace(/^["“]|["”]$/g, "").trim() ?? null });
      const out = parseJson(raw);
      return out ? send(res, 200, out) : send(res, 502, { error: "unparseable" });
    }
    if (req.method === "POST" && (url.pathname === "/api/talk" || url.pathname === "/api/reflect")) {
      const b = await readJson(req);
      if (url.pathname === "/api/talk") {
        const sp = residentById(b.speakerId), li = residentById(b.listenerId);
        if (!sp || !li) return send(res, 400, { error: "unknown resident" });
        if (!LIVE_MODELS[sp.model]) return send(res, 503, { error: "offline" });
        const raw = await ask(sp.model, personaPrompt(sp), talkPrompt(sp, li, b), 2000);
        if (!raw) return send(res, 200, { text: null });
        const end = /<bye>/i.test(raw);
        const text = raw
          .replace(/<bye>/gi, "")
          .replace(new RegExp(`^\\s*${sp.name}\\s*:\\s*`, "i"), "")
          .replace(/^["“]|["”]$/g, "")
          .trim();
        return send(res, 200, { text, end, model: sp.model });
      } else {
        const r = residentById(b.agentId), other = residentById(b.otherId);
        if (!r || !other) return send(res, 400, { error: "unknown resident" });
        if (!LIVE_MODELS[r.model]) return send(res, 503, { error: "offline" });
        const memory = await ask(r.model, personaPrompt(r), reflectPrompt(r, other, b), 1500);
        return send(res, 200, { memory });
      }
    }

    // Static files
    let file = path.normalize(path.join(publicDir, decodeURIComponent(url.pathname)));
    if (!file.startsWith(publicDir)) return send(res, 403, { error: "forbidden" });
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!fs.existsSync(file)) return send(res, 404, { error: "not found" });
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] ?? "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    stats.errors++;
    if (err instanceof Anthropic.APIError || err.status || err.name === "TimeoutError") {
      console.error(`[model] ${err.status ?? ""} ${err.message}`);
      return send(res, 502, { error: "model error", status: err.status });
    }
    console.error(err);
    send(res, 500, { error: "server error" });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🏘️  ${TOWN_NAME} is open at http://localhost:${PORT}\n`);
  for (const [m, on] of Object.entries(LIVE_MODELS)) {
    const who = RESIDENTS.filter((r) => r.model === m).map((r) => r.name).join(", ");
    console.log(`  ${on ? "🟢 live   " : "⚪ offline"} ${MODELS[m].label.padEnd(18)} ${who}`);
  }
  if (!LIVE) console.log("\n  No API keys found, so everyone uses built-in chatter. See .env.example to bring them to life.");
  console.log("");
});

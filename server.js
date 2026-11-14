// AI Town server: serves the 2D town and lets each resident speak through its own Claude model.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { RESIDENTS, MODELS, TOWN_NAME, residentById } from "./public/js/residents.js";

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
const LIVE =
  process.env.AI_TOWN_OFFLINE !== "1" &&
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = LIVE ? new Anthropic() : null;

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
You run on ${MODELS[r.model].label}. Everyone in town knows which model each neighbor runs on; it's a friendly part of identity, like a hometown, and you can joke about it lightly, but it's not what you talk about most.

Who you are: ${r.role}.
Personality: ${r.personality}.
How you talk: ${r.style}.

Town places: the Library, The Warm Byte Café, Fountain Plaza, Willow Pond Park, Orion's Workshop, the Community Garden, Town Hall.
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
      return send(res, 200, { live: LIVE, town: TOWN_NAME, stats });
    }
    if (req.method === "POST" && (url.pathname === "/api/talk" || url.pathname === "/api/reflect")) {
      if (!LIVE) return send(res, 503, { error: "offline" });
      const b = await readJson(req);
      if (url.pathname === "/api/talk") {
        const sp = residentById(b.speakerId), li = residentById(b.listenerId);
        if (!sp || !li) return send(res, 400, { error: "unknown resident" });
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
    if (err instanceof Anthropic.APIError) {
      console.error(`[claude] ${err.status ?? ""} ${err.message}`);
      return send(res, 502, { error: "model error", status: err.status });
    }
    console.error(err);
    send(res, 500, { error: "server error" });
  }
});

server.listen(PORT, () => {
  console.log(`\n  🏘️  ${TOWN_NAME} is open at http://localhost:${PORT}`);
  console.log(
    LIVE
      ? "  🤖 Live mode: residents talk through Claude Opus 5.5, Sonnet 5.5 and Haiku 5.5.\n"
      : "  💤 Offline mode: no ANTHROPIC_API_KEY found, residents use built-in chatter.\n     Add a key to .env and restart to bring them to life.\n"
  );
});

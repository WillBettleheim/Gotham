// Social life: relationships that grow or sour, romance and rivalries, gossip that spreads
// by word of mouth, nightly diaries, and conversations between the player and residents.
const clamp = (v, a = -100, b = 100) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export class Social {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
  }

  initAgent(a) {
    a.bond = {};        // otherId -> -100..100
    a.partner = null;
    a.knows = [];       // gossip: [{text, t, from}]
    a.diary = [];       // [{day, text}]
    a.chatLog = [];     // conversation with the player
    a.wroteDiaryDay = -1;
  }

  // ----- relationships -----
  bondLabel(a, otherId) {
    const b = a.bond[otherId] ?? 0;
    if (a.partner === otherId) return { icon: "💞", label: "partner" };
    if (b >= 60) return { icon: "💛", label: "close friend" };
    if (b >= 25) return { icon: "🙂", label: "friend" };
    if (b <= -60) return { icon: "💢", label: "enemy" };
    if (b <= -25) return { icon: "😒", label: "rival" };
    return { icon: "🤝", label: "acquaintance" };
  }
  isRival(a, b) { return (a.bond[b.id] ?? 0) <= -25 || (b.bond[a.id] ?? 0) <= -25; }

  compatibility(a, b) {
    const ta = a.res.traits, tb = b.res.traits;
    let c = a.community === b.community ? 3 : 0;
    c += 2 - (Math.abs(ta.rebel - tb.rebel) + Math.abs(ta.diligence - tb.diligence)) * 2;
    if (this.society.mayor === b.id && a.community !== b.community && ta.rebel > 0.5) c -= 2;
    if (b.record.jailed && a.community === "lantern") c -= 2;
    return c;
  }

  afterConversation(convo, feelings = {}) {
    const { a, b } = convo;
    for (const [p, q] of [[a, b], [b, a]]) {
      const live = feelings[p.id];
      const delta = live !== undefined ? live * 9 + (Math.random() * 4 - 2) : 4 + this.compatibility(p, q) * 1.5 + (Math.random() * 12 - 6) + (convo.tense ? -10 : 0);
      p.bond[q.id] = clamp((p.bond[q.id] ?? 0) + delta);
    }
    const ab = a.bond[b.id], ba = b.bond[a.id];
    if (convo.tense) {
      this.society.log("😠", `${a.res.name} and ${b.res.name} had a heated argument${convo.place ? ` at ${convo.place}` : ""}.`, "community", false, a.id);
      a.mood = Math.max(0, a.mood - 5); b.mood = Math.max(0, b.mood - 5);
    }
    // romance
    if (!a.partner && !b.partner && ab >= 55 && ba >= 55 && Math.random() < 0.3) {
      a.partner = b.id; b.partner = a.id;
      a.mood = Math.min(100, a.mood + 15); b.mood = Math.min(100, b.mood + 15);
      this.society.log("💞", `${a.res.name} and ${b.res.name} are now a couple!`, "community", true, a.id);
      this.spread(`${a.res.name} and ${b.res.name} are a couple now`, [a, b]);
    }
    if (a.partner === b.id && (ab < 15 || ba < 15)) {
      a.partner = null; b.partner = null;
      a.mood = Math.max(0, a.mood - 15); b.mood = Math.max(0, b.mood - 15);
      this.society.log("💔", `${a.res.name} and ${b.res.name} broke up.`, "community", true, a.id);
      this.spread(`${a.res.name} and ${b.res.name} broke up`, [a, b]);
    }
    if (ab <= -25 && ba <= -25 && Math.random() < 0.3) this.spread(`${a.res.name} and ${b.res.name} can't stand each other`, [a, b]);
    // gossip: each shares something the other hasn't heard
    for (const [p, q] of [[a, b], [b, a]]) {
      const news = p.knows.filter((k) => !q.knows.some((x) => x.text === k.text)).slice(0, 2);
      for (const k of news) this.learn(q, k.text, p.res.name);
    }
  }

  // ----- gossip -----
  learn(a, text, from = null) {
    if (a.knows.some((k) => k.text === text)) return;
    a.knows.unshift({ text, t: this.sim.time, from });
    if (a.knows.length > 12) a.knows.pop();
  }
  // something happened: people nearby (and those involved) know first
  spread(text, involved = [], at = null) {
    const center = at ?? involved[0];
    for (const o of this.sim.agents) {
      const near = center && Math.hypot(o.x - center.x, o.y - center.y) < 8 && o.state !== "sleeping";
      if (involved.includes(o) || near) this.learn(o, text);
    }
  }
  onGazette(entry) {
    if (!["crime", "election", "community", "law", "disaster"].includes(entry.kind)) return;
    const who = entry.who && this.sim.agents.find((a) => a.id === entry.who);
    this.spread(entry.text.replace(/\s*\(you decide.*\)$/, ""), who ? [who] : [], who);
    if (["election", "law", "disaster"].includes(entry.kind)) for (const o of this.sim.agents) if (Math.random() < 0.5) this.learn(o, entry.text);
  }
  gossipLine(a) {
    const k = a.knows.find((x) => this.sim.time - x.t < 1440);
    return k ? pick([`Did you hear? ${k.text}.`, `${k.from ? `${k.from} told me` : "People are saying"} ${k.text.charAt(0).toLowerCase()}${k.text.slice(1)}.`, `Word around town: ${k.text}.`]) : null;
  }

  // ----- diaries -----
  async writeDiary(a) {
    const day = Math.floor(this.sim.time / 1440) + 1;
    if (a.wroteDiaryDay === day) return;
    a.wroteDiaryDay = day;
    let text = null;
    if (this.sim.liveModels[a.res.model]) {
      try {
        const res = await fetch("/api/think", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "diary", agentId: a.id, persona: this.sim.personaOf(a), situation: this.society.situation(a) }) });
        if (res.ok) text = (await res.json()).text;
      } catch {}
    }
    text ||= this.instinctDiary(a);
    a.diary.unshift({ day, text: String(text).slice(0, 600) });
    if (a.diary.length > 7) a.diary.pop();
  }
  instinctDiary(a) {
    const mood = a.mood > 70 ? "a really good day" : a.mood > 45 ? "an ordinary day" : "a rough day";
    const bits = [`Day ${Math.floor(this.sim.time / 1440) + 1}. Today was ${mood}.`];
    const mem = a.memories.slice(-2).map((m) => m.text).filter(Boolean);
    if (mem.length) bits.push(mem[mem.length - 1]);
    if (a.partner) bits.push(`I keep thinking about ${this.sim.agents.find((o) => o.id === a.partner)?.res.name ?? "them"}.`);
    const rival = Object.entries(a.bond).find(([, v]) => v <= -40);
    if (rival) bits.push(`${this.sim.agents.find((o) => o.id === rival[0])?.res.name ?? "Someone"} really gets on my nerves.`);
    if (a.goal) bits.push(`Tomorrow I'll keep working on my goal: ${a.goal.label}.`);
    if (a.coins < 20) bits.push("Money is tight. I'm worried.");
    if (a.health < 40) bits.push("I don't feel well at all.");
    return bits.join(" ");
  }

  // ----- the player talks to a resident -----
  async chat(a, message) {
    a.chatLog.push({ from: "council", text: message });
    let text = null;
    if (this.sim.liveModels[a.res.model]) {
      try {
        const res = await fetch("/api/chat", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agentId: a.id, persona: this.sim.personaOf(a), situation: this.society.situation(a), history: a.chatLog.slice(-10, -1), message }),
        });
        if (res.ok) text = (await res.json()).text;
      } catch {}
    }
    text ||= this.instinctReply(a, message);
    a.chatLog.push({ from: "you", text });
    if (a.chatLog.length > 30) a.chatLog.splice(0, a.chatLog.length - 30);
    a.memories.push({ about: a.id, text: `A council member came to talk to me. They said: "${message.slice(0, 80)}"`, time: "" });
    return text;
  }
  instinctReply(a, msg) {
    const m = msg.toLowerCase(), s = this.society;
    const mayor = s.mayorAgent();
    const rebel = a.res.traits.rebel > 0.5;
    if (/law|rule|curfew|tax|fine|jail/.test(m)) return s.laws.length > 2 ? (rebel ? "Too many rules! Let people breathe a little." : "The rules keep Gotham safe. I can live with them.") : rebel ? "I like that Gotham lets people be free." : "Maybe we need a few more rules around here.";
    if (/how are you|how.?s it going|how do you feel/.test(m)) return a.mood > 65 ? `Honestly? Pretty great. ${a.goal ? `I'm working on my goal to ${a.goal.label}.` : ""}` : a.mood > 40 ? "I'm getting by. Some days are better than others." : `Not great, if I'm honest. ${a.coins < 20 ? "Money's tight." : a.hunger > 70 ? "I'm starving." : "It's been a hard week."}`;
    if (/mayor|election|vote/.test(m)) return mayor ? (mayor === a ? "Being mayor is a lot of work, but I love this town." : mayor.community === a.community ? `${mayor.res.name} is doing a fine job.` : `${mayor.res.name}? Not who I voted for, I'll say that.`) : "We still need a mayor. I've got opinions about who.";
    if (/money|coin|job|work/.test(m)) return a.res.work ? `I work as ${a.res.job.toLowerCase()}. ${a.coins > 100 ? "Pays the bills." : "Wish it paid more."}` : "I'm looking for work. Know anyone hiring?";
    if (/dream|goal|want/.test(m)) return a.dream ? `My dream? ${a.dream}` : "I'm still figuring out what I want.";
    if (/friend|love|partner/.test(m)) { const p = a.partner && this.sim.agents.find((o) => o.id === a.partner); return p ? `${p.res.name} and I are together. Don't tell everyone!` : "I've got some good friends here. Still waiting on love."; }
    const g = this.gossipLine(a);
    return g ?? pick(["Thanks for stopping by. It's nice when the council listens.", "Interesting. I'll have to think about that.", "Gotham's a good place, mostly. You're doing alright."]);
  }

  situation(a) {
    const named = (id) => this.sim.agents.find((o) => o.id === id)?.res.name;
    const close = Object.entries(a.bond).filter(([, v]) => v >= 25).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([id]) => named(id)).filter(Boolean);
    const rivals = Object.entries(a.bond).filter(([, v]) => v <= -25).map(([id]) => named(id)).filter(Boolean);
    const recent = a.knows.slice(0, 3).map((k) => k.text);
    return [
      a.partner ? `You're in a relationship with ${named(a.partner)}.` : "",
      close.length ? `Your friends: ${close.join(", ")}.` : "",
      rivals.length ? `People you don't get along with: ${rivals.join(", ")}.` : "",
      recent.length ? `Gossip you've heard: ${recent.join("; ")}.` : "",
    ].filter(Boolean).join("\n");
  }

  serialize() { return Object.fromEntries(this.sim.agents.map((a) => [a.id, { bond: a.bond, partner: a.partner, knows: a.knows.slice(0, 6), diary: a.diary, chatLog: a.chatLog.slice(-10) }])); }
  restore(s) { for (const a of this.sim.agents) if (s?.[a.id]) Object.assign(a, s[a.id]); }
}

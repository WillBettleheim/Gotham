// Built-in chatter so the town feels alive even without an API key.
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const greetings = {
  morning: ["Morning, {L}!", "Good morning, {L}. Sleep well?", "Oh, hi {L}! Early start?"],
  afternoon: ["Hey {L}! Nice afternoon, isn't it?", "{L}! Fancy seeing you here.", "Afternoon, {L}."],
  evening: ["Evening, {L}. Long day?", "Hi {L}! The light's lovely right now.", "{L}! Heading home soon?"],
  night: ["{L}? Still up?", "Oh! Didn't expect anyone out this late, {L}.", "Late stroll, {L}?"],
};
const reactions = [
  "Ha, that sounds just like you.", "Oh, I love that.", "Really? Tell me more sometime.", "That's wonderful.",
  "Hm, I hadn't thought of it that way.", "No way!", "That made my day, honestly.", "I'll have to see that for myself.",
];
const answers = [
  "Honestly? Mostly just enjoying the quiet.", "Funny you ask, I was just thinking about that.",
  "A little bit of everything, as usual.", "Oh, nothing special, but that's the nice part.",
];
const goodbyes = ["Anyway, I should get going. See you around, {L}!", "Good talking, {L}. Catch you later!", "I'll let you get on with your day. Bye, {L}!", "See you at the Inn sometime, {L}."];
const newsTake = ["Did you hear? {N}", "Everyone's talking about it: {N}", "Have you heard the news? {N}"];

export function offlineLine(speaker, listener, ctx) {
  const L = listener.name;
  const fill = (s) => s.replaceAll("{L}", L).replaceAll("{N}", ctx.news?.[ctx.news.length - 1] ?? "");
  const turn = ctx.history.length;
  const last = ctx.history[ctx.history.length - 1]?.text ?? "";
  if (turn === 0) {
    const g = fill(pick(greetings[ctx.period] ?? greetings.afternoon));
    return { text: Math.random() < 0.5 ? `${g} ${pick(speaker.questions)}` : g, end: false };
  }
  if (turn >= ctx.maxTurns - 1) return { text: fill(pick(goodbyes)), end: true };
  let parts = [];
  if (last.endsWith("?")) parts.push(pick(Math.random() < 0.6 ? speaker.topics : answers));
  else parts.push(pick(reactions));
  if (ctx.tense && Math.random() < 0.6) return { text: fill(pick(["Oh. It's you, {L}.", "I haven't forgotten what you did, {L}.", "Don't start with me today.", "You always think you're right, don't you?", "Whatever, {L}. I've got better things to do."])), end: turn >= 2 && Math.random() < 0.5 };
  const gossip = ctx.society?.social?.gossipLine(ctx.self);
  if (gossip && Math.random() < 0.3) return { text: gossip, end: false };
  const civic = ctx.society && ctx.self ? civicLine(ctx.society, ctx.self, listener) : null;
  if (civic && Math.random() < 0.45) parts = [pick(reactions), civic];
  else if (ctx.news?.length && Math.random() < 0.25) parts = [fill(pick(newsTake))];
  else if (Math.random() < 0.5) parts.push(Math.random() < 0.5 ? pick(speaker.topics) : pick(speaker.questions));
  const text = [...new Set(parts)].join(" ");
  return { text, end: false };
}

// Small talk about life in Gotham: money, laws, jail, politics.
function civicLine(s, me, other) {
  const opts = [];
  const rebel = me.res.traits.rebel > 0.5;
  const mayor = s.mayorAgent();
  if (me.coins < 15) opts.push(`Money's tight. I'm down to ${Math.floor(me.coins)} coins.`, "If I don't get paid soon, I'm skipping meals.");
  if (me.coins > 150) opts.push("Work's been good to me lately. Business is booming.");
  if (me.debt > 0) opts.push("I still owe rent. It's keeping me up at night.");
  if (me.record.jailed > 0) opts.push(rebel ? "Jail wasn't so bad. The food's free, at least." : "I never want to see the inside of that jail again.");
  if (me.record.fines > 0) opts.push("I got fined the other day. Lesson learned. Maybe.");
  if (s.law("curfew")) opts.push(rebel ? "This curfew is ridiculous. The night is the best part!" : "Honestly, the curfew makes me feel safer.");
  if (s.law("work")) opts.push(rebel ? "Forced to work? That's not how freedom works." : "Mandatory shifts keep the town running, I think.");
  if (s.law("tax") && s.law("tax").param >= 15) opts.push(`A ${s.law("tax").param}% tax? My wallet is crying.`);
  if (s.law("garden")) opts.push("Can't even walk through the garden now. Rules, rules.");
  if (mayor && mayor !== me) opts.push(mayor.community === me.community ? `Mayor ${mayor.res.name} is doing a great job.` : `Mayor ${mayor.res.name}? Not my pick, but we'll see.`);
  if (mayor === me) opts.push("Being mayor is harder than it looks, you know.");
  if (s.election.phase !== "idle" && s.election.candidates.length) {
    const fav = s.election.candidates.find((c) => c.community === me.community) ?? s.election.candidates[0];
    opts.push(fav.id === me.id ? "Will you vote for me? I'd make a good mayor." : `I'm voting for ${residentName(s, fav.id)}. Who's your pick, ${other.name}?`);
  }
  if (me.plan && !me.plan.work && me.res.work) opts.push("I skipped work today. Felt like it.");
  return opts.length ? pick(opts) : null;
}
const residentName = (s, id) => s.sim.agents.find((a) => a.id === id)?.res.name ?? "someone";

export function offlineMemory(agent, other, history, place) {
  const theirs = history.filter((h) => h.id === other.id).map((h) => h.text);
  const bit = theirs.length ? pick(theirs) : "";
  return bit ? `At ${place}, ${other.name} told me: "${bit.length > 80 ? bit.slice(0, 77) + "…" : bit}"` : `Had a quick chat with ${other.name} at ${place}.`;
}

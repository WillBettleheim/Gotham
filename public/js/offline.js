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
const goodbyes = ["Anyway, I should get going. See you around, {L}!", "Good talking, {L}. Catch you later!", "I'll let you get on with your day. Bye, {L}!", "See you at the café sometime, {L}."];
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
  if (ctx.news?.length && Math.random() < 0.25) parts = [fill(pick(newsTake))];
  else if (Math.random() < 0.5) parts.push(Math.random() < 0.5 ? pick(speaker.topics) : pick(speaker.questions));
  const text = [...new Set(parts)].join(" ");
  return { text, end: false };
}

export function offlineMemory(agent, other, history, place) {
  const theirs = history.filter((h) => h.id === other.id).map((h) => h.text);
  const bit = theirs.length ? pick(theirs) : "";
  return bit ? `At ${place}, ${other.name} told me: "${bit.length > 80 ? bit.slice(0, 77) + "…" : bit}"` : `Had a quick chat with ${other.name} at ${place}.`;
}

// Sidebar tabs, resident card, laws council, politics and gazette.
import { MODELS, COMMUNITIES, LAW_TYPES, residentById } from "./residents.js";
import { drawPortrait } from "./sprites.js";
import { penaltyText } from "./society.js";

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const portrait = (res, size = 60) => { const c = document.createElement("canvas"); c.width = size; c.height = size; drawPortrait(c, res); return c; };
const bar = (v, color) => `<div class="bar" style="--c:${color}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
const hhmm = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;

export function createUI() {
  let sim = null, society = null;
  let selected = null, follow = false, tab = "town", gazetteFilter = "all";
  let calls = 0;
  const feed = $("feed");

  const ui = {
    get selected() { return selected; },
    get follow() { return follow; },
    set follow(v) { follow = v; },

    // ----- hooks used by the simulation -----
    beginConversation(convo, time) {
      feed.querySelector(".empty")?.remove();
      const el = document.createElement("div");
      el.className = "convo live";
      el.innerHTML = `<div class="h"><span>${esc(convo.a.res.name)} & ${esc(convo.b.res.name)} · ${esc(convo.place)}</span><span>${time}</span></div>`;
      feed.prepend(el);
      while (feed.children.length > 40) feed.lastChild.remove();
      updateLiveCount();
      if (tab !== "chats") markTab("chats");
      return el;
    },
    addLine(el, speaker, text) {
      const p = document.createElement("p");
      const m = MODELS[speaker.res.model];
      p.innerHTML = `<b style="color:${m.color}">${esc(speaker.res.name)}</b><span class="m" style="color:${m.color}">${m.short}</span> `;
      p.append(document.createTextNode(text));
      el.append(p);
    },
    endConversation(el) { el.classList.remove("live"); updateLiveCount(); },
    noteCall() { calls++; $("calls").textContent = `${calls} AI replies`; },
    noteError(e) { console.warn("AI call failed, using offline line:", e); },
    refreshCard() { if (selected) renderCard(); },

    attach(s) {
      sim = s; society = s.society;
      society.on((type, data) => {
        if (type === "gazette") { renderGazette(); renderCrimes(); if (data.important) toast(data.entry); if (tab !== "gazette") markTab("gazette"); }
        if (type === "laws") { renderLaws(); renderProposals(); if (society.proposals.length && tab !== "laws") markTab("laws"); }
        if (type === "election" || type === "elected") renderPolitics();
        if (type === "agent" && data === selected) renderCard();
      });
      buildResidents();
      buildLawForm();
      buildGazetteFilters();
      renderAll();
      setInterval(tick, 500);
    },
    select(a, andFollow = false) {
      selected = a; follow = andFollow;
      document.querySelectorAll(".res").forEach((el) => el.classList.toggle("sel", el.dataset.id === a?.id));
      renderCard();
    },
    renderLegend,
  };

  // ----- tabs -----
  document.querySelectorAll("#tabs button").forEach((b) => b.onclick = () => {
    tab = b.dataset.tab;
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b));
    b.classList.remove("dot");
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === tab));
    renderAll();
  });
  const markTab = (t) => document.querySelector(`#tabs [data-tab="${t}"]`)?.classList.add("dot");
  const updateLiveCount = () => { const n = sim?.convos.size ?? 0; $("liveCount").textContent = n ? `· ${n} live` : ""; };

  function renderAll() {
    if (!sim) return;
    renderResidents(); renderCommunities(); renderLaws(); renderProposals(); renderCrimes(); renderPolitics(); renderGazette(); renderNews(); renderTicker();
  }
  function tick() {
    renderTicker();
    if (tab === "town") { renderResidents(); renderCommunities(); }
    if (tab === "politics") renderElectionClock();
    if (selected) updateCardLive();
  }

  function renderLegend() {
    $("legend").innerHTML = Object.entries(MODELS)
      .map(([k, m]) => `<span style="--c:${m.color}" class="${sim?.liveModels[k] ? "on" : ""}" title="${m.label}: ${sim?.liveModels[k] ? "live" : "offline chatter (no API key)"}">${m.short}</span>`).join("");
  }

  function renderTicker() {
    const mayor = society.mayorAgent();
    $("tTreasury").textContent = Math.round(society.treasury);
    $("tMayor").textContent = mayor ? mayor.res.name : "no mayor";
    $("tJail").textContent = sim.agents.filter((a) => a.state === "jailed").length;
  }

  // ----- town tab -----
  const resEls = {};
  function buildResidents() {
    for (const a of sim.agents) {
      const b = document.createElement("button");
      b.className = "res"; b.dataset.id = a.id;
      b.append(portrait(a.res, 76));
      const info = document.createElement("div");
      info.innerHTML = `<div class="n"><i style="background:${MODELS[a.res.model].color}"></i>${esc(a.res.name)} <small>${esc(a.res.job)}</small></div><div class="a"></div><div class="mini"></div>`;
      const money = document.createElement("div");
      money.className = "money";
      b.append(info, money);
      b.onclick = () => ui.select(a, true);
      $("residents").append(b);
      resEls[a.id] = { b, act: info.querySelector(".a"), mini: info.querySelector(".mini"), money };
    }
  }
  function statusIcons(a) {
    let s = "";
    if (society.mayor === a.id) s += "👑";
    if (a.candidate) s += "📣";
    if (a.state === "jailed" || a.escort) s += "⛓️";
    if (a.working) s += "🔨";
    if (a.hunger > 75) s += "🍞";
    if (a.plan?.defy?.length) s += "😈";
    return s;
  }
  function renderResidents() {
    for (const a of sim.agents) {
      const e = resEls[a.id];
      e.act.textContent = a.activity;
      e.mini.innerHTML = bar(a.mood, "#facc15") + bar(a.rep, "#60a5fa") + bar(100 - a.hunger, "#4ade80");
      e.money.innerHTML = `<div class="icons">${statusIcons(a)}</div>🪙 ${Math.floor(a.coins)}`;
      e.mini.title = `mood ${Math.round(a.mood)} · reputation ${Math.round(a.rep)} · fullness ${Math.round(100 - a.hunger)}`;
    }
  }
  function renderCommunities() {
    const box = $("communities");
    const sig = sim.agents.map((a) => a.community).join() + Math.round(sim.time / 30);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = "";
    for (const [id, c] of Object.entries(COMMUNITIES)) {
      const members = sim.agents.filter((a) => a.community === id);
      const el = document.createElement("div");
      el.className = "comm"; el.style.setProperty("--c", c.color);
      const avgMood = members.length ? Math.round(members.reduce((s, a) => s + a.mood, 0) / members.length) : 0;
      const wealth = Math.round(members.reduce((s, a) => s + a.coins, 0));
      el.innerHTML = `<div class="t">${c.icon} ${esc(c.name)}</div><div class="v">${esc(c.values)}</div><div class="faces"></div><div class="meta">${members.length} members · mood ${avgMood} · 🪙 ${wealth}</div>`;
      const faces = el.querySelector(".faces");
      for (const m of members) { const p = portrait(m.res, 48); p.title = m.res.name; p.onclick = () => ui.select(m, true); faces.append(p); }
      box.append(el);
    }
  }

  // ----- chats tab -----
  function renderNews() { $("newsList").innerHTML = sim.news.slice().reverse().map((n) => `<div>📣 ${esc(n)}</div>`).join(""); }
  $("newsForm").onsubmit = (e) => {
    e.preventDefault();
    const v = $("newsInput").value.trim();
    if (!v) return;
    sim.postNews(v); $("newsInput").value = ""; renderNews();
    society.log("📣", `Town news: ${v}`, "town");
  };

  // ----- laws tab -----
  function buildLawForm() {
    const sel = $("lawType");
    sel.innerHTML = Object.entries(LAW_TYPES).map(([k, d]) => `<option value="${k}">${d.title}</option>`).join("");
    const sync = () => {
      const d = LAW_TYPES[sel.value];
      $("lawParamWrap").hidden = !d.param;
      if (d.param) { $("lawParamWrap").firstChild.textContent = d.param.label + " "; if (!$("lawParam").dataset.touched) $("lawParam").value = d.param.default; }
      $("lawTextWrap").hidden = $("lawWordsWrap").hidden = sel.value !== "custom";
      $("lawPenaltyWrap").hidden = $("lawAmountWrap").hidden = !!d.noPenalty;
      if (!d.noPenalty && !$("lawAmount").dataset.touched) { $("lawPenaltyKind").value = d.penalty.kind; $("lawAmount").value = d.penalty.amount; }
      const p = Number($("lawParam").value);
      const text = d.text(p, $("lawText").value || "(write your law)");
      const pen = d.noPenalty ? "" : ` Penalty: ${penaltyText({ kind: $("lawPenaltyKind").value, amount: Number($("lawAmount").value) })}.`;
      const replaces = sel.value !== "custom" && society.law(sel.value) ? " (replaces the current one)" : "";
      $("lawPreview").textContent = `${text}${pen}${replaces}`;
    };
    sel.onchange = () => { delete $("lawParam").dataset.touched; delete $("lawAmount").dataset.touched; sync(); };
    for (const id of ["lawParam", "lawAmount", "lawText", "lawPenaltyKind"]) $(id).oninput = () => { $(id).dataset.touched = 1; sync(); };
    $("lawForm").onsubmit = (e) => {
      e.preventDefault();
      const type = sel.value, d = LAW_TYPES[type];
      if (type === "custom" && !$("lawText").value.trim()) { $("lawText").focus(); return; }
      society.addLaw({
        type,
        param: d.param ? Number($("lawParam").value) : undefined,
        text: $("lawText").value.trim(),
        keywords: $("lawWords").value.split(","),
        penalty: d.noPenalty ? undefined : { kind: $("lawPenaltyKind").value, amount: Math.max(1, Number($("lawAmount").value) || 1) },
      }, "you");
      $("lawText").value = ""; $("lawWords").value = "";
      for (const a of sim.agents) a.memories.push({ about: a.id, text: `The council passed a new law: ${society.laws.at(-1).text}`, time: hhmm(sim.time) });
      sync();
    };
    sync();
  }
  function renderLaws() {
    const box = $("lawList");
    if (!society.laws.length) { box.innerHTML = `<p class="empty">No laws. Gotham is lawless!</p>`; return; }
    box.innerHTML = "";
    for (const l of society.laws) {
      const el = document.createElement("div");
      el.className = "law";
      const breakers = sim.agents.filter((a) => a.record.offenses[l.type]).length;
      el.innerHTML = `<div class="body"><div class="t">${esc(LAW_TYPES[l.type].title)}</div><div class="d">${esc(l.text)}</div>
        ${l.penalty ? `<div class="p">⚖️ ${penaltyText(l.penalty)} · repeat offenders pay 50% more each time</div>` : `<div class="by">Funds the treasury, which pays the mayor's salary.</div>`}
        <div class="by">Passed by ${esc(l.by)}${breakers ? ` · ${breakers} resident${breakers > 1 ? "s" : ""} convicted` : ""}</div></div><button title="Repeal this law">Repeal</button>`;
      el.querySelector("button").onclick = () => society.repeal(l.id);
      box.append(el);
    }
  }
  function renderProposals() {
    const box = $("proposals");
    box.innerHTML = "";
    for (const p of society.proposals) {
      const m = residentById(p.by);
      const el = document.createElement("div");
      el.className = "proposal";
      el.innerHTML = `<div class="t">👑 Mayor ${esc(m?.name)}'s proposal</div><div class="d">${esc(p.summary)}</div>${p.reason ? `<div class="r">“${esc(p.reason)}”</div>` : ""}
        <div class="btns"><button class="yes">Approve</button><button class="no">Reject</button></div>`;
      el.querySelector(".yes").onclick = () => society.resolveProposal(p.id, true);
      el.querySelector(".no").onclick = () => society.resolveProposal(p.id, false);
      box.append(el);
    }
  }
  function renderCrimes() {
    const items = society.gazette.filter((e) => e.kind === "crime").slice(0, 12);
    $("crimeList").innerHTML = items.length ? items.map(eventHtml).join("") : `<p class="empty">No crimes yet. Everyone is behaving… for now.</p>`;
  }

  // ----- politics tab -----
  function renderPolitics() {
    const m = society.mayorAgent();
    const mb = $("mayorBox");
    mb.innerHTML = "";
    const box = document.createElement("div");
    box.className = "mayor";
    if (m) {
      box.append(portrait(m.res, 112));
      const d = document.createElement("div");
      d.innerHTML = `<div class="k">Mayor of Gotham</div><div class="n">👑 ${esc(m.res.name)}</div><div class="s">${MODELS[m.res.model].label} · ${COMMUNITIES[m.community].icon} ${esc(COMMUNITIES[m.community].name)} · salary 40/day</div>`;
      box.append(d);
    } else box.innerHTML = `<div><div class="k">Mayor of Gotham</div><div class="n">Vacant</div><div class="s">The first election is coming soon.</div></div>`;
    mb.append(box);

    const e = society.election;
    const eb = $("electionBox");
    const steps = ["campaign", "rally", "counting"];
    const label = { idle: "No election running", campaign: "Campaign underway", rally: "Rally in the plaza", counting: "Counting votes" }[e.phase];
    eb.innerHTML = `<div class="election"><div class="phase"><b>🗳️ ${label}</b><small id="electionClock"></small></div>
      <div class="steps">${steps.map((s, i) => `<span class="${steps.indexOf(e.phase) >= i ? "on" : ""}">${["Campaign", "Rally", "Vote"][i]}</span>`).join("")}</div>
      <div id="cands"></div><div class="ballots" id="ballots"></div>
      <button class="callBtn" id="callBtn" ${e.phase !== "idle" ? "disabled" : ""}>Call an election now</button></div>`;
    $("callBtn").onclick = () => society.callElection();
    const total = Math.max(1, e.candidates.reduce((s, c) => s + c.votes, 0));
    const cands = $("cands");
    const showVotes = e.ballots.length > 0;
    const list = e.candidates.length ? e.candidates : (e.history[0]?.results ?? []).map((r) => ({ ...r, community: sim.agents.find((a) => a.id === r.id)?.community, speech: "" }));
    for (const c of list) {
      const a = sim.agents.find((x) => x.id === c.id);
      if (!a) continue;
      const comm = COMMUNITIES[c.community] ?? COMMUNITIES[a.community];
      const row = document.createElement("div");
      row.className = "cand";
      row.append(portrait(a.res, 72));
      const d = document.createElement("div");
      d.innerHTML = `<div class="n">${esc(a.res.name)} <span class="c" style="color:${MODELS[a.res.model].color}">${MODELS[a.res.model].short}</span></div>
        <div class="c" style="color:${comm.color}">${comm.icon} ${esc(comm.name)}</div>
        ${c.speech ? `<div class="sp">“${esc(c.speech)}”</div>` : e.phase === "campaign" ? `<div class="sp">Writing a speech…</div>` : ""}
        ${showVotes || !e.candidates.length ? `<div class="votes">${bar((c.votes / total) * 100, comm.color)} ${c.votes} vote${c.votes === 1 ? "" : "s"}</div>` : ""}`;
      row.append(d);
      cands.append(row);
    }
    if (!list.length) cands.innerHTML = `<p class="empty">Each community nominates its most ambitious, reputable member. Anyone in jail can't run or vote.</p>`;
    if (e.ballots.length) {
      $("ballots").innerHTML = "<b>Ballots</b><br>" + e.ballots.map((b) => `${esc(residentById(b.voter)?.name)} → <b>${esc(residentById(b.vote)?.name)}</b>${b.reason ? `: <i>${esc(b.reason)}</i>` : ""}${b.source === "ai" ? " 🤖" : ""}`).join("<br>");
    }
    renderElectionClock();
    $("history").innerHTML = e.history.length
      ? e.history.map((h) => `<div class="hist">Day ${h.day}: <b>👑 ${esc(residentById(h.winner)?.name)}</b> won · ${h.results.map((r) => `${esc(residentById(r.id)?.name)} ${r.votes}`).join(" · ")}</div>`).join("")
      : `<p class="empty">No elections yet.</p>`;
  }
  function renderElectionClock() {
    const el = $("electionClock");
    if (!el) return;
    const e = society.election, t = sim.time;
    const fmt = (m) => { m = Math.max(0, m); const h = Math.floor(m / 60); return h ? `${h}h ${Math.floor(m % 60)}m` : `${Math.floor(m)}m`; };
    el.textContent = e.phase === "idle" ? `next in ${fmt(e.nextAt - t)} (game time)` : e.phase === "campaign" ? `rally in ${fmt(e.rallyAt - t)}` : e.phase === "rally" ? `voting in ${fmt(e.voteAt - t)}` : "";
  }

  // ----- gazette -----
  const kinds = { all: "All", crime: "🚔 Crime", election: "🗳️ Politics", law: "📜 Laws", economy: "🪙 Money", work: "🔨 Work", community: "🤝 Community" };
  function buildGazetteFilters() {
    $("gazetteFilters").innerHTML = Object.entries(kinds).map(([k, v]) => `<button data-k="${k}" class="${k === gazetteFilter ? "on" : ""}">${v}</button>`).join("");
    $("gazetteFilters").querySelectorAll("button").forEach((b) => b.onclick = () => { gazetteFilter = b.dataset.k; buildGazetteFilters(); renderGazette(); });
  }
  const eventHtml = (e) => `<div class="event${e.who ? " click" : ""}" data-who="${e.who ?? ""}"><span class="i">${e.icon}</span><div>${esc(e.text)}<small>${e.time}${e.who ? " · show on map" : ""}</small></div></div>`;
  // clicking a gazette or crime entry jumps to the resident involved
  for (const id of ["gazette", "crimeList"]) $(id).addEventListener("click", (ev) => {
    const who = ev.target.closest(".event")?.dataset.who;
    const a = who && sim.agents.find((x) => x.id === who);
    if (a) ui.select(a, true);
  });
  function renderGazette() {
    const items = society.gazette.filter((e) => gazetteFilter === "all" || e.kind === gazetteFilter || (gazetteFilter === "crime" && e.kind === "crime")).slice(0, 80);
    $("gazette").innerHTML = items.length ? items.map(eventHtml).join("") : `<p class="empty">Nothing to report yet.</p>`;
  }

  // ----- toasts -----
  function toast(e) {
    const el = document.createElement("div");
    el.className = `toast ${e.kind}`;
    el.textContent = `${e.icon} ${e.text}`;
    const who = e.who && sim.agents.find((a) => a.id === e.who);
    if (who) { el.classList.add("click"); el.title = `Show ${who.res.name}`; el.onclick = () => ui.select(who, true); }
    $("toasts").prepend(el);
    while ($("toasts").children.length > 4) $("toasts").lastChild.remove();
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 450); }, 13000);
  }

  // ----- resident card -----
  function renderCard() {
    const card = $("card");
    if (!selected) { card.hidden = true; return; }
    const a = selected, m = MODELS[a.res.model], c = COMMUNITIES[a.community];
    const friends = Object.entries(a.rel).sort((x, y) => y[1] - x[1]).slice(0, 6)
      .map(([id, n]) => `<span class="friend">${esc(residentById(id)?.name)} · ${n} chat${n > 1 ? "s" : ""}</span>`).join("");
    const mems = a.memories.slice(-6).reverse().map((x) => `<li>${esc(x.text)}</li>`).join("");
    const rec = a.record;
    const tags = [
      society.mayor === a.id ? `<span class="tag good">👑 Mayor</span>` : "",
      a.candidate ? `<span class="tag good">📣 Running for mayor</span>` : "",
      rec.fines ? `<span class="tag bad">💸 ${rec.fines} fine${rec.fines > 1 ? "s" : ""} (${rec.finesPaid} paid)</span>` : "",
      rec.jailed ? `<span class="tag bad">⛓️ jailed ${rec.jailed}×</span>` : "",
      rec.gotAway ? `<span class="tag">🤫 got away ${rec.gotAway}×</span>` : "",
      a.debt ? `<span class="tag bad">🏚️ debt ${Math.ceil(a.debt)}</span>` : "",
    ].join("") || `<span class="tag good">✨ clean record</span>`;
    const w = a.res.work;
    card.innerHTML = `
      <button class="close" title="Close">✕</button>
      <div class="top"><canvas class="portrait" width="136" height="136"></canvas>
        <div><h3>${esc(a.res.name)}</h3><span class="badge" style="background:${m.color}22;color:${m.color}">${m.label}</span>
        <span class="role" style="font-size:11px">${sim.liveModels[a.res.model] ? "● live" : "○ offline chatter"}</span>
        <p class="role">${esc(a.res.job)}${w ? ` · ${w.from}:00–${w.to}:00 · ${w.wage}🪙/h` : ""}<br>${c.icon} ${esc(c.name)}</p></div></div>
      <p class="now">Now: <span class="nowText">${esc(a.activity)}</span></p>
      <div class="stats"></div>
      <h4>Today's plan ${a.plan?.source === "ai" ? "🤖" : ""}</h4>
      <div class="plan">${a.plan ? esc(a.plan.intention) : "Still asleep."}${a.plan ? `<small>${a.plan.work ? "✅ working today" : "🛋️ skipping work"}${a.plan.defy.length ? ` · 😈 willing to break: ${a.plan.defy.map((t) => LAW_TYPES[t]?.title ?? t).join(", ")}` : " · 😇 following the law"}</small>` : ""}</div>
      <h4>Record</h4><div class="tags">${tags}</div>
      <h4>Personality</h4><p class="role">${esc(a.res.personality)}</p>
      <h4>Friends</h4><div class="friends">${friends || '<span class="role">No chats yet</span>'}</div>
      <h4>Memories</h4>${mems ? `<ul>${mems}</ul>` : '<p class="role">Nothing yet.</p>'}
      <div class="row"><button class="follow ${follow ? "on" : ""}">${follow ? "Following" : "Follow"}</button></div>`;
    drawPortrait(card.querySelector("canvas"), a.res);
    card.querySelector(".close").onclick = () => ui.select(null);
    card.querySelector(".follow").onclick = () => { follow = !follow; renderCard(); };
    card.hidden = false;
    updateCardLive();
  }
  function updateCardLive() {
    const card = $("card"), a = selected;
    if (card.hidden || !a) return;
    card.querySelector(".nowText").textContent = a.activity;
    card.querySelector(".stats").innerHTML = [
      ["🪙 Coins", Math.floor(a.coins), Math.min(100, a.coins / 2), "#facc15"],
      ["😊 Mood", Math.round(a.mood), a.mood, "#f472b6"],
      ["⭐ Reputation", Math.round(a.rep), a.rep, "#60a5fa"],
      ["🍞 Fullness", Math.round(100 - a.hunger), 100 - a.hunger, "#4ade80"],
    ].map(([k, v, pct, col]) => `<div class="stat">${k}<span class="v">${v}</span>${bar(pct, col)}</div>`).join("");
  }

  return ui;
}

// Sidebar tabs, resident card, laws council, politics and gazette.
import { MODELS, COMMUNITIES, LAW_TYPES, residentById } from "./residents.js";
import { drawPortrait } from "./sprites.js";
import { penaltyText } from "./society.js";
import { WORKPLACES, placeLabel } from "./population.js";
import { DISASTERS } from "./disasters.js";
import { SERIES } from "./stats.js";
import { PROJECTS } from "./construction.js";
import { LOTS } from "./mapdata.js";
import { BUILDINGS } from "./mapdata.js";

const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const portrait = (res, size = 60) => { const c = document.createElement("canvas"); c.width = size; c.height = size; drawPortrait(c, res); return c; };
const bar = (v, color) => `<div class="bar" style="--c:${color}"><i style="width:${Math.max(0, Math.min(100, v))}%"></i></div>`;
const hhmm = (min) => `${String(Math.floor((min % 1440) / 60)).padStart(2, "0")}:${String(Math.floor(min % 60)).padStart(2, "0")}`;

export function createUI() {
  let sim = null, society = null;
  let selected = null, follow = false, tab = "live", gazetteFilter = "all";
  let cardCollapsed = matchMedia("(max-width: 860px)").matches; // small screens start with a compact card
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
      const who = convo.members ? convo.members.map((m) => m.res.name).join(", ") : `${convo.a.res.name} & ${convo.b.res.name}`;
      el.innerHTML = `<div class="h"><span>${convo.members ? "👥 " : ""}${esc(who)} · ${esc(convo.place)}</span><span>${time}</span></div>`;
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
      buildDisasterMenu();
      society.disasters.on(() => { renderLive(); buildDisasterMenu(); });
      pollCost(); setInterval(pollCost, 4000);
      renderAll();
      setInterval(tick, 500);
    },
    select(a, andFollow = false) {
      selected = a; follow = andFollow;
      document.querySelectorAll(".res").forEach((el) => el.classList.toggle("sel", el.dataset.id === a?.id));
      renderCard();
    },
    renderLegend,
    peek(b, sx, sy) {
      const box = $("peek");
      if (!b) { box.hidden = true; return; }
      const inside = sim.agents.filter((a) => a.place === b.place && a.visible);
      const dmg = society.disasters.damaged[b.place];
      const staff = sim.agents.filter((a) => a.res.work?.place === b.place);
      box.innerHTML = `<button class="x" title="Close">✕</button><h4>${esc(b.name)}</h4>
        ${dmg ? `<p class="budget-warn">🚧 Closed for repairs (${Math.round(dmg.progress * 100)}% rebuilt)</p>` : ""}
        ${staff.length ? `<small class="role">Staff: ${staff.map((a) => esc(a.res.name)).join(", ")}</small>` : ""}
        <div class="who">${inside.length ? inside.map((a) => `<span data-id="${a.id}">${MODELS[a.res.model] ? `<b style="color:${MODELS[a.res.model].color}">●</b>` : ""} ${esc(a.res.name)} · ${esc(a.activity)}</span>`).join("") : `<span class="role">Nobody's here right now.</span>`}</div>`;
      box.style.left = `${Math.max(8, Math.min(sx, box.parentElement.clientWidth - 270))}px`;
      box.style.top = `${Math.max(70, Math.min(sy, box.parentElement.clientHeight - 200))}px`;
      box.hidden = false;
      box.querySelector(".x").onclick = () => (box.hidden = true);
      box.querySelectorAll("[data-id]").forEach((el) => el.onclick = () => { const a = sim.agents.find((x) => x.id === el.dataset.id); if (a) { ui.select(a, true); box.hidden = true; } });
    },
    addResident(a) { if (!sim) return; addRow(a, true); renderCommunities(true); }, // before attach(), buildResidents adds everyone
    removeResident(a) {
      if (!sim) return;
      resEls[a.id]?.b.remove(); delete resEls[a.id];
      if (selected === a) ui.select(null);
      renderCommunities(true);
    },
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
    renderResidents(); renderCommunities(); renderPopulation(); renderLive(); renderLaws(); renderPetitions(); renderPoliticsExtras(); renderProposals(); renderCrimes(); renderPolitics(); renderGazette(); renderNews(); renderTicker();
  }
  function tick() {
    renderTicker();
    if (tab === "town") { renderResidents(); renderCommunities(); renderPopulation(); }
    if (tab === "live") renderLive();
    if (tab === "laws") renderPetitions();
    if (tab === "politics" && Math.floor(sim.time) % 5 === 0) renderRivalry();
    if (tab === "politics") renderElectionClock();
    if (selected) updateCardLive();
  }

  function renderLegend() {
    $("legend").innerHTML = Object.entries(MODELS)
      .map(([k, m]) => `<span style="--c:${m.color}" class="${sim?.liveModels[k] ? "on" : ""}" title="${m.label}: ${sim?.liveModels[k] ? "live" : "offline chatter (no API key)"}">${m.short}</span>`).join("");
  }

  function renderTicker() {
    const world = society.world, w = world.w;
    $("tWeather").innerHTML = `${w.icon} <b>${w.name}</b> · ${world.season.icon} ${world.season.name}`;
    const mayor = society.mayorAgent();
    $("tTreasury").textContent = Math.round(society.treasury);
    $("tMayor").textContent = mayor ? mayor.res.name : "no mayor";
    $("tJail").textContent = sim.agents.filter((a) => a.state === "jailed").length;
    $("tPop").textContent = sim.agents.length;
    const ev = society.life.event, chip = $("tEvent");
    if (ev && sim.time < ev.end) {
      const at = `${String(Math.floor((ev.start % 1440) / 60)).padStart(2, "0")}:${String(ev.start % 60).padStart(2, "0")}`;
      chip.hidden = false;
      chip.innerHTML = `${ev.icon} <b>${esc(ev.name)}</b> ${ev.active ? "· now" : `· ${at}`}`;
    } else chip.hidden = true;
  }

  // ----- town tab -----
  const resEls = {};
  function buildResidents() { for (const a of sim.agents) addRow(a); }
  function addRow(a, isNew = false) {
    {
      const b = document.createElement("button");
      b.className = "res" + (isNew ? " new" : ""); b.dataset.id = a.id;
      b.append(portrait(a.res, 76));
      const info = document.createElement("div");
      info.innerHTML = `<div class="n"><i style="background:${MODELS[a.res.model].color}"></i>${esc(a.res.name)} <small>${esc(a.res.job)}</small></div><div class="a"></div><div class="goalline"></div><div class="mini"></div>`;
      const money = document.createElement("div");
      money.className = "money";
      b.append(info, money);
      b.onclick = () => ui.select(a, true);
      $("residents").append(b);
      resEls[a.id] = { b, act: info.querySelector(".a"), mini: info.querySelector(".mini"), money, job: info.querySelector("small") };
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
  let resQuery = "", resSort = "name";
  $("resSearch").oninput = (e) => { resQuery = e.target.value.trim().toLowerCase(); renderResidents(); };
  $("resSort").onchange = (e) => { resSort = e.target.value; renderResidents(); };
  function renderResidents() {
    const goalPct = (a) => (a.goal ? Math.min(1, society.autonomy.goalProgress(a) / a.goal.target) : -1);
    const key = { name: (a) => a.res.name, coins: (a) => -a.coins, mood: (a) => -a.mood, rep: (a) => -a.rep, goal: (a) => -goalPct(a), model: (a) => a.res.model + a.res.name }[resSort];
    const ordered = [...sim.agents].sort((x, y) => { const kx = key(x), ky = key(y); return kx < ky ? -1 : kx > ky ? 1 : 0; });
    const box = $("residents");
    ordered.forEach((a, i) => {
      const e = resEls[a.id];
      if (!e) return;
      const text = `${a.res.name} ${a.res.job} ${MODELS[a.res.model].label}`.toLowerCase();
      e.b.hidden = !!resQuery && !text.includes(resQuery);
      if (box.children[i] !== e.b) box.insertBefore(e.b, box.children[i] ?? null);
    });
    for (const a of sim.agents) {
      const e = resEls[a.id];
      if (!e) continue;
      e.act.textContent = a.activity;
      e.job.textContent = a.res.job;
      const gl = e.b.querySelector(".goalline");
      const goalText = a.goal ? `🎯 ${a.goal.label} · ${Math.min(society.autonomy.goalProgress(a), a.goal.target)}/${a.goal.target}` : "";
      if (gl.textContent !== goalText) gl.textContent = goalText;
      e.mini.innerHTML = bar(a.mood, "#facc15") + bar(a.rep, "#60a5fa") + bar(100 - a.hunger, "#4ade80");
      e.money.innerHTML = `<div class="icons">${statusIcons(a)}</div>🪙 ${Math.floor(a.coins)}`;
      e.mini.title = `mood ${Math.round(a.mood)} · reputation ${Math.round(a.rep)} · fullness ${Math.round(100 - a.hunger)}`;
    }
  }
  function renderCommunities(force) {
    const box = $("communities");
    const sig = sim.agents.map((a) => a.community).join() + Math.round(sim.time / 30);
    if (box.dataset.sig === sig && !force) return;
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

  function bondsHtml(a) {
    return Object.entries(a.bond ?? {}).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, 6).map(([id, v]) => {
      const o = sim.agents.find((x) => x.id === id);
      if (!o) return "";
      const { icon, label } = society.social.bondLabel(a, id);
      return `<div class="bond" title="${label}"><span>${icon}</span><span>${esc(o.res.name)}</span>${bar((v + 100) / 2, v >= 0 ? "#4ade80" : "#f87171")}<span class="v">${v > 0 ? "+" : ""}${Math.round(v)}</span></div>`;
    }).join("");
  }

  function buildDisasterMenu() {
    const dis = society.disasters;
    $("disasterList").innerHTML = Object.entries(DISASTERS).map(([k, d]) => `<button data-k="${k}" ${dis.current(k) ? "disabled" : ""}>${d.icon} ${d.name}<small>${dis.current(k) ? "happening now" : esc(d.desc)}</small></button>`).join("");
    $("disasterList").querySelectorAll("button").forEach((b) => b.onclick = () => {
      dis.trigger(b.dataset.k, $("fireTarget").value);
      $("disasterMenu").hidden = true; $("disasterBtn").classList.remove("on");
      tab = "live"; document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.tab === "live"));
      document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("on", p.dataset.pane === "live"));
      renderLive();
    });
    const sel = $("fireTarget");
    if (!sel.options.length) sel.innerHTML = `<option value="">Random building</option>` + BUILDINGS.filter((b) => b.place !== "garden").map((b) => `<option>${esc(b.name)}</option>`).join("");
  }
  $("disasterBtn").onclick = () => { const m = $("disasterMenu"); m.hidden = !m.hidden; $("disasterBtn").classList.toggle("on", !m.hidden); };

  let costData = null;
  async function pollCost() {
    try { costData = await (await fetch("/api/status")).json(); } catch { return; }
    const st = costData.stats, money = (v) => v < 0.01 && v > 0 ? `$${v.toFixed(4)}` : `$${v.toFixed(2)}`;
    $("tCost").innerHTML = `💲 <b>${money(st.cost)}</b>${st.budget ? ` / $${st.budget}` : ""}`;
    $("tCost").classList.toggle("budget-warn", !!st.budgetHit);
    const rows = Object.entries(st.byModel).sort((x, y) => y[1].cost - x[1].cost)
      .map(([m, v]) => `<tr><td><span style="color:${MODELS[m]?.color ?? "#fff"}">●</span> ${esc(MODELS[m]?.label ?? m)}</td><td>${v.calls}</td><td>${Math.round((v.input + v.output) / 1000)}k</td><td>${money(v.cost)}</td></tr>`).join("");
    $("costPanel").innerHTML = `<div class="cost-grid"><div><b>${money(st.cost)}</b><span>spent</span></div><div><b>${money(costData.perHour ?? 0)}</b><span>per hour</span></div><div><b>${st.calls}</b><span>AI calls</span></div></div>
      ${st.budgetHit ? `<p class="budget-warn">Spending cap of $${st.budget} reached: residents are using built-in chatter.</p>` : ""}
      ${rows ? `<table class="cost-table"><tr><th>Model</th><th>Calls</th><th>Tokens</th><th>Cost</th></tr>${rows}</table>` : `<p class="empty">No AI calls yet${costData.live ? "" : " (no API keys, so it's all free offline chatter)"}.</p>`}`;
    if (st.budget && document.activeElement !== $("budgetInput")) $("budgetInput").value = st.budget;
  }
  $("tCost").onclick = () => { document.querySelector('[data-tab="town"]').click(); setTimeout(() => $("costPanel").scrollIntoView({ behavior: "smooth" }), 50); };
  $("budgetForm").onsubmit = async (e) => {
    e.preventDefault();
    const usd = Number($("budgetInput").value);
    await fetch("/api/budget", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usd: usd > 0 ? usd : null }) });
    pollCost();
  };

  // ----- population & jobs -----
  // population controls
  $("immPolicy").onchange = (e) => { society.population.setPolicy(e.target.value); renderPopulation(); };
  $("immGrant").onchange = (e) => { society.population.setGrant(e.target.value); renderPopulation(); };
  $("buildUnits").onclick = () => { const err = society.population.buildUnits(); $("popMsg").textContent = err ?? "Done: 4 more households can move in."; renderPopulation(); };
  let trend = "pop";
  function renderTrends() {
    if (!$("trendChips").children.length) {
      $("trendChips").innerHTML = SERIES.map((x) => `<button data-k="${x.key}">${x.label}</button>`).join("");
      $("trendChips").querySelectorAll("button").forEach((b) => b.onclick = () => { trend = b.dataset.k; renderTrends(); });
    }
    $("trendChips").querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.k === trend));
    const c = $("trendChart"), g = c.getContext("2d"), H = society.stats.history, ser = SERIES.find((x) => x.key === trend);
    g.clearRect(0, 0, c.width, c.height);
    const pad = 28, w = c.width - pad * 2, h = c.height - pad * 2;
    g.fillStyle = "#a39cc4"; g.font = "20px Nunito, sans-serif";
    if (H.length < 2) { g.fillText("Trends appear after a couple of game hours.", pad, c.height / 2); return; }
    const vals = H.map((p) => p[trend]);
    const max = ser.max ?? Math.max(10, ...vals) * 1.15, min = 0;
    g.strokeStyle = "rgba(255,255,255,0.08)"; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) { const y = pad + (h * k) / 4; g.beginPath(); g.moveTo(pad, y); g.lineTo(pad + w, y); g.stroke(); }
    const xy = (i) => [pad + (w * i) / (vals.length - 1), pad + h - ((vals[i] - min) / (max - min)) * h];
    const grad = g.createLinearGradient(0, pad, 0, pad + h); grad.addColorStop(0, ser.color + "66"); grad.addColorStop(1, ser.color + "00");
    g.beginPath(); vals.forEach((_, i) => { const [x, y] = xy(i); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.lineTo(pad + w, pad + h); g.lineTo(pad, pad + h); g.closePath(); g.fillStyle = grad; g.fill();
    g.beginPath(); vals.forEach((_, i) => { const [x, y] = xy(i); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = ser.color; g.lineWidth = 4; g.lineJoin = "round"; g.stroke();
    const [lx, ly] = xy(vals.length - 1); g.fillStyle = ser.color; g.beginPath(); g.arc(lx, ly, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#f6f1e7"; g.font = "bold 22px Nunito, sans-serif"; g.textAlign = "right"; g.fillText(`${vals.at(-1)}${ser.max === 100 && trend !== "mood" && trend !== "health" ? "%" : ""}`, pad + w, pad - 6);
    g.textAlign = "left"; g.fillStyle = "#a39cc4"; g.font = "18px Nunito, sans-serif";
    const day = (t) => `Day ${Math.floor(t / 1440) + 1}`; g.fillText(day(H[0].t), pad, c.height - 6); g.textAlign = "right"; g.fillText(day(H.at(-1).t), pad + w, c.height - 6); g.textAlign = "left";
  }
  function renderConstruction() {
    const box = $("construction"), c = society.construction;
    const sig = JSON.stringify([c.sites, c.built, Math.floor(society.treasury / 50)]);
    if (box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = `<p class="note" style="margin:0 0 6px">Spend the treasury (🏦 ${Math.floor(society.treasury)}) on new buildings. Residents can volunteer to speed construction up.</p>` + Object.entries(PROJECTS).map(([id, p]) => {
      const builtLot = Object.entries(c.built).find(([, pid]) => pid === id);
      const site = Object.entries(c.sites).find(([, s]) => s.project === id);
      if (builtLot) return `<div class="proj done"><span class="i">${p.icon}</span><div><b>${esc(p.name)}</b><small>Open on ${esc(LOTS.find((l) => l.id === builtLot[0]).name)}.</small></div><span>✅</span></div>`;
      if (site) return `<div class="proj building"><span class="i">${p.icon}</span><div><b>${esc(p.name)}</b><small>Under construction: ${Math.round(site[1].progress * 100)}%</small>${bar(site[1].progress * 100, "#f2b843")}</div><span>🏗️</span></div>`;
      const lots = c.freeLots(id);
      return `<div class="proj"><span class="i">${p.icon}</span><div><b>${esc(p.name)} · ${p.cost} coins</b><small>${esc(p.desc)}</small></div>
        <div class="act">${lots.length ? `<select data-p="${id}">${lots.map((l) => `<option value="${l.id}">${esc(l.name)}</option>`).join("")}</select><button class="primary" data-build="${id}">Build</button>` : `<small>No free lot</small>`}</div></div>`;
    }).join("") + `<p id="buildMsg" class="note"></p>`;
    box.querySelectorAll("[data-build]").forEach((b) => b.onclick = () => {
      const id = b.dataset.build, lot = box.querySelector(`select[data-p="${id}"]`).value;
      const err = c.start(id, lot);
      box.dataset.sig = ""; renderConstruction();
      $("buildMsg").textContent = err ?? `Construction of ${PROJECTS[id].name} has begun!`;
    });
  }
  function renderBusinesses() {
    const list = society.civic.businesses;
    $("businesses").innerHTML = list.length ? list.map((b) => `<div class="biz"><span>${b.icon} <b>${esc(b.name)}</b></span><small>${b.customers} customers so far</small></div>`).join("") : `<p class="empty">No resident has opened a business yet. Residents with savings and ambition open stalls on their own.</p>`;
  }
  function renderPetitions() {
    const list = society.civic.petitions;
    $("petitions").innerHTML = list.length ? list.map((p) => `<div class="petition">✍️ <b>${esc(p.text)}</b>${bar((p.signers.size / p.needed) * 100, "#c084fc")}<small>Started by ${esc(residentById(p.by)?.name)} because ${esc(p.why)} · ${p.signers.size}/${p.needed} signatures. Petitions with enough signatures come to you for a decision.</small></div>`).join("") : `<p class="empty">No petitions right now. Unhappy residents start them on their own.</p>`;
  }
  function renderRiverton() {
    const r = society.riverton;
    $("riverton").innerHTML = `<div class="rv"><p>🏞️ <b>Riverton</b>, the next town down the east road. Residents travel there to sell goods for ${Math.round((r.priceBonus - 1) * 100)}% more and bring back news.</p>
      <p>Relations ${bar(r.relations, r.relations >= 60 ? "#4ade80" : r.relations >= 40 ? "#facc15" : "#f87171")} ${Math.round(r.relations)}/100 ${r.deal ? "· 🤝 trade deal signed" : ""}</p>
      <p>${r.trips} trips so far · ${r.trade} coins earned there${r.relations >= 60 ? " · Riverton will send aid in a disaster" : ""}</p>
      <div class="row2"><button id="rvGift">🎁 Send gift (50)</button>${r.deal ? "" : `<button id="rvDeal" class="primary">🤝 Trade deal (100)</button>`}</div><p id="rvMsg" class="note"></p></div>`;
    $("rvGift").onclick = () => { const e = r.sendGift(); renderRiverton(); $("rvMsg").textContent = e ?? "Riverton appreciated the gift."; };
    const deal = $("rvDeal"); if (deal) deal.onclick = () => { const e = r.signDeal(); renderRiverton(); $("rvMsg").textContent = e ?? "Deal signed!"; };
  }
  function renderRivalry() {
    const rows = society.civic.modelStats();
    const cols = [["residents", "👥"], ["mood", "😊"], ["coins", "🪙"], ["rep", "⭐"], ["goals", "🏅"], ["catches", "🎣"], ["couples", "💞"], ["elections", "👑"], ["businesses", "🏪"], ["crimes", "🚨"], ["jail", "⛓️"]];
    const best = Object.fromEntries(cols.map(([k]) => [k, Math.max(...rows.map((r) => r[k]))]));
    $("rivalry").innerHTML = `<div class="rival-wrap"><table class="riv"><tr><th>Model</th>${cols.map(([k, i]) => `<th title="${k}">${i}</th>`).join("")}</tr>${rows.sort((x, y) => y.mood - x.mood).map((r) => `<tr><td><span style="color:${r.color}">●</span> ${esc(r.label.replace("Claude ", ""))}</td>${cols.map(([k]) => `<td class="${r[k] === best[k] && r[k] > 0 && k !== "crimes" && k !== "jail" ? "best" : ""}">${r[k]}</td>`).join("")}</tr>`).join("")}</table></div><p class="note">Averages for mood, coins and reputation; totals for the rest. Gold marks the leader.</p>`;
  }

  function renderMilestones() {
    const st = society.stats;
    $("milestones").innerHTML = st.milestones.map((m) => `<div class="ms ${st.reached[m.id] ? "on" : ""}"><span class="i">${m.icon}</span><div><b>${esc(m.name)}</b><small>${st.reached[m.id] ? `Day ${st.reached[m.id]} · ` : ""}${esc(m.desc)}</small></div></div>`).join("");
  }

  function renderPopulation() {
    const pop = society.population;
    if (document.activeElement !== $("immPolicy")) $("immPolicy").value = pop.policy;
    if (document.activeElement !== $("immGrant")) $("immGrant").value = String(pop.grant);
    $("departures").innerHTML = pop.departures_log.length ? `Recently moved away: ${pop.departures_log.slice(0, 4).map((d) => `${esc(d.name)} (day ${d.day}, ${esc(d.why)})`).join("; ")}` : "";
    renderTrends(); renderMilestones(); renderConstruction(); renderBusinesses();
    const st = society.population.stats();
    $("popStats").innerHTML = [["👥", st.population, "residents"], ["💼", st.employed, "employed"], ["🏠", `${st.population}/${st.capacity}`, "housing"], ["🧳", `${st.arrivals}↑ ${st.departures}↓`, "moved"]]
      .map(([i, v, k]) => `<div><b>${i} ${v}</b><span>${k}</span></div>`).join("");
    $("jobBoard").innerHTML = Object.entries(WORKPLACES).map(([k, w]) => {
      const staff = society.population.staff(k);
      const open = w.slots - staff.length;
      return `<div class="job"><b>${esc(w.title)} · ${esc(placeLabel(k))}</b>${open > 0 ? `<span class="open">${open} open</span>` : `<span class="full">full</span>`}<small>${w.wage}🪙/h · ${w.from}:00–${w.to}:00 · ${staff.map((a) => esc(a.res.name)).join(", ") || "nobody yet"}</small></div>`;
    }).join("") + (sim.agents.some((a) => !a.res.work) ? `<div class="job"><b>Unemployed</b><span class="full">${sim.agents.filter((a) => !a.res.work).length}</span><small>${sim.agents.filter((a) => !a.res.work).map((a) => esc(a.res.name)).join(", ")}</small></div>` : "");
  }

  // ----- live tab: everything happening right now -----
  const placeName = (a) => a.state === "jailed" ? "Jail" : a.place === "home" ? "home" : placeLabel(a.place);
  const WISH_LABEL = { fish: "go fishing", garden: "garden", sell: "sell at the market", shop: "go shopping", read: "read", stroll: "take a walk", socialize: "see friends", event: "go to the event", nap: "nap" };
  function category(a) {
    if (a.state === "jailed") return ["⛓️", "In jail"];
    if (a.escort) return ["🚔", "Being arrested"];
    if (a.state === "talking") return ["💬", "Talking"];
    if (a.state === "sleeping") return ["💤", "Sleeping"];
    if (a.state === "away") return ["🧳", "In Riverton"];
    if (a.working) return ["🔨", "Working"];
    if (a.state === "idle" && a.place === a.doingPlace) {
      if (a.doing === "fish") return ["🎣", "Fishing"];
      if (a.doing === "garden") return ["🌱", "Gardening"];
      if (a.doing === "event") return ["🎉", "At the event"];
      if (a.doing === "nap") return ["😴", "Napping"];
    }
    if (a.state === "walking") return ["🚶", "On the move"];
    return ["☕", "Hanging out"];
  }
  function renderLive() {
    const st = society.population.stats();
    const talking = [...sim.convos];
    $("liveStats").innerHTML = [["💬", talking.length, "chats"], ["🔨", sim.agents.filter((a) => a.working).length, "working"], ["💤", sim.agents.filter((a) => a.state === "sleeping").length, "asleep"], ["👥", st.population, "residents"]]
      .map(([i, v, k]) => `<div><b>${i} ${v}</b><span>${k}</span></div>`).join("");
    const cards = [];
    for (const c of talking) {
      const lines = c.history.slice(-3).map((h) => { const sp = sim.agents.find((x) => x.id === h.id); return `<p><b style="color:${MODELS[sp?.res.model]?.color ?? "#fff"}">${esc(h.name ?? sp?.res.name)}:</b> ${esc(h.text)}</p>`; }).join("");
      const typer = [c.a, c.b].find((x) => x.bubble?.typing);
      const title = c.members ? `👥 ${c.members.map((m) => esc(m.res.name)).join(", ")}` : `💬 ${esc(c.a.res.name)} & ${esc(c.b.res.name)}`;
      const typer2 = (c.members ?? [c.a, c.b]).find((x) => x.bubble?.typing);
      cards.push(`<div class="now-card" data-who="${c.a.id}" style="--c:${MODELS[c.a.res.model].color}"><div class="t">${title}<small>${esc(c.place)}</small></div>${lines}${typer2 ? `<p class="typing">${esc(typer2.res.name)} is thinking…</p>` : ""}</div>`);
    }
    for (const a of sim.agents.filter((x) => x.escort)) cards.push(`<div class="now-card" data-who="${a.id}" style="--c:#f87171"><div class="t">🚔 ${esc(a.res.name)} is being taken to jail</div></div>`);
    const rv = society.riverton.merchant;
    if (rv) cards.push(`<div class="now-card" style="--c:#c084fc"><div class="t">🛒 ${esc(rv.res.name)} from Riverton<small>Citizens' Market · ${rv.sales} coins sold</small></div><p>Selling exotic goods until ${String(Math.floor((rv.until % 1440) / 60)).padStart(2, "0")}:00.</p></div>`);
    for (const [lotId, site] of Object.entries(society.construction.sites)) {
      const p = PROJECTS[site.project];
      const helpers = sim.agents.filter((a) => a.doing === "build" && a.state === "idle").length;
      cards.push(`<div class="now-card" style="--c:#f2b843"><div class="t">🏗️ Building ${esc(p.name)}<small>${Math.round(site.progress * 100)}% · ${helpers} volunteer${helpers === 1 ? "" : "s"}</small></div>${bar(site.progress * 100, "#f2b843")}</div>`);
    }
    for (const g of society.civic.gatherings) if (sim.time >= g.start - 60 && sim.time < g.end) {
      const host = residentById(g.by);
      cards.push(`<div class="now-card" data-who="${g.by}" style="--c:#f472b6"><div class="t">${g.icon} ${esc(host?.name)}'s ${esc(g.name)}<small>${g.came.size} guest${g.came.size === 1 ? "" : "s"}</small></div></div>`);
    }
    const away = sim.agents.filter((a) => a.state === "away");
    if (away.length) cards.push(`<div class="now-card" style="--c:#60a5fa"><div class="t">🧳 Visiting Riverton<small>${away.length} traveler${away.length > 1 ? "s" : ""}</small></div><p>${away.map((a) => esc(a.res.name)).join(", ")}</p></div>`);
    const ev = society.life.event;
    if (ev) {
      const fmt = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(Math.floor(m % 60)).padStart(2, "0")}`;
      const leader = ev.id === "contest" && Object.entries(ev.scores).sort((x, y) => y[1] - x[1])[0];
      const status = ev.active ? `happening now · ${ev.attendees.size} attending${leader ? ` · ${esc(residentById(leader[0])?.name)} leads with ${leader[1]} fish` : ""}` : sim.time < ev.start ? `starts at ${fmt(ev.start)}` : "finished";
      cards.push(`<div class="now-card" style="--c:#4ade80"><div class="t">${ev.icon} ${esc(ev.name)}<small>${status}</small></div><p>${esc(ev.desc)}</p></div>`);
    }
    const e = society.election;
    if (e.phase !== "idle") cards.push(`<div class="now-card" style="--c:#c084fc"><div class="t">🗳️ Election: ${e.phase === "campaign" ? "campaign underway" : e.phase === "rally" ? "rally in the plaza" : "counting votes"}<small>${e.candidates.map((c) => esc(residentById(c.id)?.name)).join(" vs ")}</small></div></div>`);
    for (const a of sim.agents.filter((x) => x.state === "jailed")) cards.push(`<div class="now-card" data-who="${a.id}" style="--c:#9ca3af"><div class="t">⛓️ ${esc(a.res.name)} is serving time<small>${esc(a.activity)}</small></div></div>`);
    $("liveNow").innerHTML = cards.join("") || `<p class="empty">Quiet moment. Nobody is chatting right now.</p>`;
    const dis = society.disasters;
    const actLabel = { help: "🧯 fighting it", flee: "🏃 fled", watch: "👀 watching", loot: "💰 looting", donate: "💝 donated", shelter: "🏠 sheltering", secure: "🌱 securing garden", inn: "🍺 at the Inn", fish: "🎣 fishing anyway", sandbag: "🧱 sandbagging", evacuate: "🏃 evacuated", rescue: "🚑 rescuing", friend: "🫂 checking on friends", hide: "🏠 hiding", isolate: "🏠 isolating", checkup: "🩺 at the Clinic", nurse: "🧑‍⚕️ nursing", ignore: "🤷 ignoring it", protest: "📢 protesting", hoard: "🏠 hoarding", work: "🔨 working" };
    $("emergencies").innerHTML = dis.active.map((d) => {
      const counts = {};
      for (const act of Object.values(d.actions)) counts[act] = (counts[act] ?? 0) + 1;
      const left = Math.max(0, Math.round(d.end - sim.time));
      const extra = d.type === "fire" ? ` · flames ${Math.round(Math.min(2, d.intensity) * 50)}%` : d.type === "flood" ? ` · water level ${Math.round(d.intensity * 60)}%` : "";
      return `<div class="emergency"><div class="t">${esc(d.title)}<small>${Math.floor(left / 60)}h ${left % 60}m left${extra}</small></div><p>${esc(d.desc)}.</p><div class="acts">${Object.entries(counts).map(([k, n]) => `<span>${actLabel[k] ?? k}: ${n}</span>`).join("")}</div></div>`;
    }).join("") + Object.values(dis.damaged).map((r) => `<div class="repair">🚧 <b>${esc(r.building.name)}</b> is closed for repairs ${bar(r.progress * 100, "#f2b843")}<small>${Math.round(r.progress * 100)}% rebuilt · volunteers and donations speed it up</small></div>`).join("");
    const thoughts = society.autonomy.thoughts.slice(0, 8);
    $("liveThoughts").innerHTML = thoughts.length
      ? thoughts.map((t) => { const a = sim.agents.find((x) => x.id === t.id); const col = a ? MODELS[a.res.model].color : "#999"; return `<div class="thought" data-who="${t.id}"><span class="dot" style="background:${col}"></span><div><b>${esc(t.name)}</b> <i>“${esc(t.text)}”</i></div></div>`; }).join("")
      : `<p class="empty">Nobody has said what's on their mind yet.</p>`;
    const groups = {};
    for (const a of sim.agents) { const [icon, label] = category(a); (groups[label] ??= { icon, list: [] }).list.push(a); }
    const order = ["Being arrested", "Talking", "At the event", "Working", "Fishing", "Gardening", "On the move", "Hanging out", "Napping", "In Riverton", "In jail", "Sleeping"];
    $("liveList").innerHTML = order.filter((k) => groups[k]).map((k) => `<div class="group-h">${groups[k].icon} ${k} <i>${groups[k].list.length}</i></div>` +
      groups[k].list.map((a) => `<div class="lrow" data-who="${a.id}"><span class="dot" style="background:${MODELS[a.res.model].color}"></span><span class="nm">${esc(a.res.name)}</span><span class="ac">${esc(a.activity)} · ${esc(placeName(a))}</span></div>`).join("")).join("");
  }
  for (const id of ["liveNow", "liveList", "liveThoughts"]) $(id).addEventListener("click", (ev) => {
    const who = ev.target.closest("[data-who]")?.dataset.who;
    const a = who && sim.agents.find((x) => x.id === who);
    if (a) ui.select(a, true);
  });

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
      el.innerHTML = `<div class="t">${p.petition ? `✍️ Petition started by ${esc(m?.name)}` : `👑 Mayor ${esc(m?.name)}'s proposal`}</div><div class="d">${esc(p.summary)}</div>${p.reason ? `<div class="r">“${esc(p.reason)}”</div>` : ""}
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
  function renderPoliticsExtras() { renderRiverton(); renderRivalry(); }
  function renderElectionClock() {
    const el = $("electionClock");
    if (!el) return;
    const e = society.election, t = sim.time;
    const fmt = (m) => { m = Math.max(0, m); const h = Math.floor(m / 60); return h ? `${h}h ${Math.floor(m % 60)}m` : `${Math.floor(m)}m`; };
    el.textContent = e.phase === "idle" ? `next in ${fmt(e.nextAt - t)} (game time)` : e.phase === "campaign" ? `rally in ${fmt(e.rallyAt - t)}` : e.phase === "rally" ? `voting in ${fmt(e.voteAt - t)}` : "";
  }

  // ----- gazette -----
  const kinds = { all: "All", crime: "🚔 Crime", election: "🗳️ Politics", law: "📜 Laws", economy: "🪙 Money", work: "🔨 Work", community: "🤝 Community", leisure: "🎣 Leisure" };
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
    card.style.setProperty("--mc", m.color);
    card.classList.toggle("collapsed", cardCollapsed);
    card.innerHTML = `
      <button class="close" title="Close">✕</button>
      <button class="min" title="${cardCollapsed ? "Expand" : "Collapse"}">${cardCollapsed ? "▴" : "▾"}</button>
      <div class="top"><canvas class="portrait" width="136" height="136"></canvas>
        <div><h3>${esc(a.res.name)}</h3><span class="badge" style="background:${m.color}22;color:${m.color}">${m.label}</span>
        <span class="role" style="font-size:11px">${sim.liveModels[a.res.model] ? "● live" : "○ offline chatter"}</span>
        <p class="role">${esc(a.res.job)}${w ? ` · ${w.from}:00–${w.to}:00 · ${w.wage}🪙/h` : ""}<br>${c.icon} ${esc(c.name)}</p></div></div>
      <p class="now">Now: <span class="nowText">${esc(a.activity)}</span></p>
      <div class="stats"></div>
      ${a.goal ? `<h4>Personal goal</h4><div class="goal"><div class="g">🎯 ${esc(a.goal.label)}</div><div class="goalbar"></div>${a.goal.why ? `<small>Why: ${esc(a.goal.why)}</small>` : ""}${a.dream ? `<small>✨ Dream: ${esc(a.dream)}</small>` : ""}${a.goalsDone ? `<small>🏅 ${a.goalsDone} goal${a.goalsDone > 1 ? "s" : ""} achieved</small>` : ""}</div>` : ""}
      ${a.thought ? `<h4>On their mind ${sim.liveModels[a.res.model] ? "🤖" : ""}</h4><p class="role thoughtText">“${esc(a.thought)}”</p>` : ""}
      <h4>Today's plan ${a.plan?.source === "ai" ? "🤖" : ""}</h4>
      <div class="plan">${a.plan ? esc(a.plan.intention) : "Still asleep."}${a.plan ? `<small>${a.plan.work ? "✅ working today" : "🛋️ skipping work"}${a.plan.defy.length ? ` · 😈 willing to break: ${a.plan.defy.map((t) => LAW_TYPES[t]?.title ?? t).join(", ")}` : " · 😇 following the law"}${a.plan.wishes?.length ? `<br>💭 wants to: ${a.plan.wishes.map((w) => WISH_LABEL[w] ?? w).join(", ")}` : ""}</small>` : ""}</div>
      <h4>Record</h4><div class="tags">${tags}</div>
      <h4>Personality</h4><p class="role">${esc(a.res.personality)}</p>
      <h4>Relationships</h4><div class="bonds">${bondsHtml(a) || `<span class="role">Hasn&#39;t really met anyone yet</span>`}</div>
      ${a.story ? `<h4>Life story</h4><p class="role story">${esc(a.story)}</p>` : ""}
      ${a.diary?.length ? `<h4>Diary 📔</h4><div class="diary"><small>Day ${a.diary[0].day}</small>${esc(a.diary[0].text)}</div>` : ""}
      <h4>Talk to ${esc(a.res.name)} ${sim.liveModels[a.res.model] ? "🤖" : ""}</h4>
      <div class="chatlog">${(a.chatLog ?? []).map((m) => `<div class="m ${m.from}">${esc(m.text)}</div>`).join("") || '<p class="role">Ask them anything: how they feel, what they think of your laws, their dreams…</p>'}</div>
      <form class="chatform"><input maxlength="300" placeholder="Say something as the citizens' council…" /><button type="submit" class="primary">Send</button></form>
      <h4>Memories</h4>${mems ? `<ul>${mems}</ul>` : '<p class="role">Nothing yet.</p>'}
      <div class="row"><button class="follow ${follow ? "on" : ""}">${follow ? "Following" : "Follow"}</button></div>`;
    drawPortrait(card.querySelector("canvas"), a.res);
    card.querySelector(".close").onclick = () => ui.select(null);
    card.querySelector(".min").onclick = () => { cardCollapsed = !cardCollapsed; renderCard(); };
    const cl = card.querySelector(".chatlog"); if (cl) cl.scrollTop = cl.scrollHeight;
    card.querySelector(".chatform")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const input = ev.target.querySelector("input"), msg = input.value.trim();
      if (!msg) return;
      input.value = ""; input.disabled = true;
      const who = a;
      const log = card.querySelector(".chatlog");
      log.insertAdjacentHTML("beforeend", `<div class="m council">${esc(msg)}</div><div class="m you typing">${esc(who.res.name)} is thinking…</div>`);
      log.scrollTop = log.scrollHeight;
      await society.social.chat(who, msg);
      if (selected === who) { renderCard(); card.querySelector(".chatform input")?.focus(); }
    });
    card.querySelector(".follow").onclick = () => { follow = !follow; renderCard(); };
    card.hidden = false;
    updateCardLive();
  }
  function updateCardLive() {
    const card = $("card"), a = selected;
    if (card.hidden || !a) return;
    card.querySelector(".nowText").textContent = a.activity;
    const gb = card.querySelector(".goalbar");
    if (gb && a.goal) gb.innerHTML = bar((Math.min(society.autonomy.goalProgress(a), a.goal.target) / a.goal.target) * 100, "#f2b843") + `<small>${Math.min(society.autonomy.goalProgress(a), a.goal.target)} / ${a.goal.target}</small>`;
    const tt = card.querySelector(".thoughtText");
    if (tt && a.thought) tt.textContent = `“${a.thought}”`;
    card.querySelector(".stats").innerHTML = [
      ["🪙 Coins", Math.floor(a.coins), Math.min(100, a.coins / 2), "#facc15"],
      ["😊 Mood", Math.round(a.mood), a.mood, "#f472b6"],
      ["⭐ Reputation", Math.round(a.rep), a.rep, "#60a5fa"],
      ["🍞 Fullness", Math.round(100 - a.hunger), 100 - a.hunger, "#4ade80"],
      ["⚡ Energy", Math.round(a.energy), a.energy, "#fb923c"],
      ["🫂 Social", Math.round(a.social), a.social, "#c084fc"],
      ["🎈 Fun", Math.round(a.fun), a.fun, "#2dd4bf"],
      [a.sick ? "🤒 Health (sick)" : "❤️ Health", Math.round(a.health ?? 90), a.health ?? 90, a.sick ? "#f87171" : "#fb7185"],
    ].map(([k, v, pct, col]) => `<div class="stat">${k}<span class="v">${v}</span>${bar(pct, col)}</div>`).join("")
      + `<div class="stat bag">🎒 ${a.inv?.fish ? `${a.inv.fish} fish` : ""}${a.inv?.fish && a.inv?.veg ? " · " : ""}${a.inv?.veg ? `${a.inv.veg} veg` : ""}${!a.inv?.fish && !a.inv?.veg ? "empty bag" : ""}${a.catches ? ` · ${a.catches} caught` : ""}</div>`;
  }

  return ui;
}

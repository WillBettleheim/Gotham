// The world around the residents: seasons, weather and health.
const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));

export const SEASONS = [
  { id: "spring", name: "Spring", icon: "🌸", weather: { sunny: 45, cloudy: 25, rain: 25, storm: 5 } },
  { id: "summer", name: "Summer", icon: "☀️", weather: { sunny: 60, cloudy: 18, rain: 12, storm: 10 } },
  { id: "autumn", name: "Autumn", icon: "🍂", weather: { sunny: 30, cloudy: 30, rain: 25, fog: 10, storm: 5 } },
  { id: "winter", name: "Winter", icon: "❄️", weather: { sunny: 25, cloudy: 30, snow: 35, fog: 10 } },
];
export const WEATHER = {
  sunny: { name: "Sunny", icon: "☀️", outdoor: 1, mood: 2 },
  cloudy: { name: "Cloudy", icon: "☁️", outdoor: 0.9, mood: 0 },
  rain: { name: "Rain", icon: "🌧️", outdoor: 0.5, mood: -4, fish: 1.5, garden: 1.4 },
  storm: { name: "Storm", icon: "⛈️", outdoor: 0.15, mood: -8, health: -0.06 },
  fog: { name: "Fog", icon: "🌫️", outdoor: 0.8, mood: -2, fish: 1.2 },
  snow: { name: "Snow", icon: "🌨️", outdoor: 0.55, mood: -2, health: -0.025, walk: 0.8 },
};
export const OUTDOOR = new Set(["park", "plaza", "fishing", "cgarden", "events", "market", "cmarket", "garden"]);

export class World {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.weather = "sunny";
    this.weatherUntil = 0;
    this.forced = null; // a disaster can force the weather
  }

  get season() { return SEASONS[Math.floor(this.sim.time / 1440 / 4) % 4]; }
  get w() { return WEATHER[this.forced ?? this.weather]; }
  get current() { return this.forced ?? this.weather; }

  initAgent(a) { a.health = 90; a.sick = false; }

  rollWeather() {
    const table = this.season.weather, total = Object.values(table).reduce((s, v) => s + v, 0);
    let r = Math.random() * total;
    for (const [k, v] of Object.entries(table)) if ((r -= v) <= 0) { this.weather = k; break; }
    this.weatherUntil = this.sim.time + 240 + Math.random() * 360;
    if (this.weather !== "sunny" && this.weather !== "cloudy") this.society.log(WEATHER[this.weather].icon, `Weather: ${WEATHER[this.weather].name.toLowerCase()} rolling into Gotham.`, "town");
  }

  update(dt) {
    if (this.sim.time >= this.weatherUntil) this.rollWeather();
  }

  tick(a, dt) {
    const w = this.w;
    const outside = a.state !== "sleeping" && a.place !== "home" && a.state !== "jailed";
    let dh = 0;
    if (a.state === "sleeping" && a.hunger < 70) dh += 0.03;
    if (a.hunger > 85) dh -= 0.04;
    if (a.energy < 12) dh -= 0.03;
    if (outside && w.health) dh += w.health;
    if (a.sick) dh -= 0.03;
    a.health = clamp((a.health ?? 90) + dh * dt);
    if (!a.sick && a.health < 35) {
      a.sick = true;
      this.society.log("🤒", `${a.res.name} has fallen ill.`, "community", false, a.id);
    }
    if (a.sick && a.health > 70) { a.sick = false; this.society.log("💪", `${a.res.name} has recovered.`, "community", false, a.id); }
  }

  moodTarget(a) {
    const outside = a.place !== "home" && a.state !== "sleeping";
    return (outside ? this.w.mood : 0) + (a.sick ? -12 : 0) + (a.health < 25 ? -10 : 0);
  }

  // how appealing a place is in this weather
  outdoorFactor(place) { return OUTDOOR.has(place) ? this.w.outdoor : 1; }

  // see the doctor
  clinicOption(a) {
    if (!a.sick && a.health > 50) return null;
    const place = this.society.construction?.clinicPlace() ?? "clinic";
    return { kind: "clinic", score: 70 + (60 - a.health), place, label: place === "hospital" ? "going to the Hospital" : "going to see the doctor" };
  }
  onArrive(a) {
    if (a.doing === "clinic" && a.place === "clinic") {
      const fee = 15;
      const doctor = this.sim.agents.find((o) => o.res.work?.place === "clinic" && o !== a);
      if (a.coins >= fee) { a.coins -= fee; if (doctor) doctor.coins += fee; else this.society.treasury += fee; }
      a.health = clamp(a.health + 50); a.sick = a.health < 35;
      a.activity = "getting treated at the Clinic";
      this.society.log("🩺", `${a.res.name} was treated at the Clinic${doctor ? ` by Dr. ${doctor.res.name}` : ""}${a.coins < fee ? " (they couldn't pay)" : ""}.`, "community", false, a.id);
    }
  }

  onNewDay() {
    const s = this.season;
    if (s.id === "winter") {
      for (const a of this.sim.agents) a.coins = Math.max(0, a.coins - 5);
      this.society.log("🔥", "Winter heating costs everyone 5 coins today.", "economy");
    }
    if (Math.floor(this.sim.time / 1440) % 4 === 0) this.society.log(s.icon, `${s.name} has arrived in Gotham.`, "town", true);
  }

  situation() {
    return `Season: ${this.season.name}. Weather right now: ${this.w.name.toLowerCase()}.`;
  }

  serialize() { return { weather: this.weather, weatherUntil: this.weatherUntil, health: Object.fromEntries(this.sim.agents.map((a) => [a.id, [a.health, a.sick]])) }; }
  restore(s) {
    if (!s) return;
    this.weather = s.weather ?? "sunny"; this.weatherUntil = 0;
    for (const a of this.sim.agents) if (s.health?.[a.id]) [a.health, a.sick] = s.health[a.id];
  }
}

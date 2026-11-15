// Gotham's soundscape, generated live with the Web Audio API (no audio files).
// Ambient: birds by day, crickets at night, rain/wind by weather, fire crackle, Music Night.
// One-shots: chimes, alarm, thunder, earthquake rumble, catch pop.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = (() => { try { return localStorage.getItem("gotham-muted") === "1"; } catch { return false; } })();
    this.volume = 0.6;
    this.state = {};
    this.nextBird = 0; this.nextCricket = 0; this.nextCrackle = 0; this.nextNote = 0; this.noteIdx = 0;
    const start = () => { this.start(); removeEventListener("pointerdown", start); removeEventListener("keydown", start); };
    addEventListener("pointerdown", start); addEventListener("keydown", start);
  }

  start() {
    if (this.ctx) return;
    try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { return; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.volume; this.master.connect(c.destination);
    // a loop of noise feeds rain and wind
    const buf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    const loop = (filterType, freq, q) => {
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master); src.start();
      return { g, f };
    };
    this.rain = loop("highpass", 1200, 0.5);
    this.wind = loop("bandpass", 400, 0.8);
    this.water = loop("lowpass", 500, 0.4);
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem("gotham-muted", m ? "1" : "0"); } catch {}
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volume, this.ctx.currentTime, 0.1);
  }

  // called a few times a second with what's happening in town
  update(s) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const ramp = (node, v) => node.g.gain.setTargetAtTime(v, t, 0.8);
    const wet = { rain: 0.12, storm: 0.22, snow: 0 }[s.weather] ?? 0;
    ramp(this.rain, wet);
    ramp(this.wind, { storm: 0.18, snow: 0.08, fog: 0.03 }[s.weather] ?? 0.012);
    this.wind.f.frequency.setTargetAtTime(300 + Math.sin(t * 0.3) * 120, t, 0.5);
    ramp(this.water, 0.02);
    if (!s.dark && wet === 0 && t > this.nextBird) { this.bird(); this.nextBird = t + 0.6 + Math.random() * 3; }
    if (s.dark && s.weather !== "storm" && t > this.nextCricket) { this.cricket(); this.nextCricket = t + 0.25 + Math.random() * 0.6; }
    if (s.fire && t > this.nextCrackle) { this.crackle(); this.nextCrackle = t + 0.04 + Math.random() * 0.15; }
    if (s.musicNight && t > this.nextNote) { this.note(); this.nextNote = t + 0.32; }
  }

  env(node, peak, a, d) {
    const t = this.ctx.currentTime;
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }
  tone(freq, type, peak, a, d, glideTo) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, c.currentTime + a + d);
    o.connect(g).connect(this.master); this.env(g, peak, a, d);
    o.start(); o.stop(c.currentTime + a + d + 0.05);
  }
  burst(peak, dur, filterFreq, type = "lowpass") {
    const c = this.ctx, src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    src.buffer = this.noise; f.type = type; f.frequency.value = filterFreq;
    src.connect(f).connect(g).connect(this.master); this.env(g, peak, 0.005, dur);
    src.start(0, Math.random()); src.stop(c.currentTime + dur + 0.1);
  }

  bird() {
    const base = 2200 + Math.random() * 1800, n = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) setTimeout(() => this.ctx && this.tone(base * (0.9 + Math.random() * 0.2), "sine", 0.035, 0.01, 0.09, base * 1.3), i * 110);
  }
  cricket() { for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.tone(4300, "square", 0.006, 0.003, 0.03), i * 45); }
  crackle() { this.burst(0.08 + Math.random() * 0.1, 0.03 + Math.random() * 0.05, 2500 + Math.random() * 2000, "highpass"); }
  note() {
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3, 440, 392];
    const f = scale[this.noteIdx++ % scale.length] * (this.noteIdx % 16 < 8 ? 1 : 0.75);
    this.tone(f, "triangle", 0.05, 0.01, 0.3);
    if (this.noteIdx % 4 === 0) this.tone(f / 2, "sine", 0.04, 0.01, 0.6);
  }

  play(kind) {
    if (!this.ctx || this.muted) return;
    if (kind === "chime") { this.tone(880, "sine", 0.08, 0.01, 0.5); setTimeout(() => this.ctx && this.tone(1318, "sine", 0.06, 0.01, 0.7), 120); }
    if (kind === "alarm") for (let i = 0; i < 4; i++) setTimeout(() => this.ctx && this.tone(i % 2 ? 660 : 880, "sawtooth", 0.05, 0.01, 0.22), i * 260);
    if (kind === "thunder") { this.burst(0.5, 2.2, 180); setTimeout(() => this.ctx && this.burst(0.3, 1.5, 120), 250); }
    if (kind === "rumble") { this.burst(0.6, 3.5, 90); this.tone(42, "sine", 0.25, 0.1, 3); }
    if (kind === "pop") this.tone(520, "sine", 0.06, 0.005, 0.12, 900);
    if (kind === "bell") for (let i = 0; i < 3; i++) setTimeout(() => this.ctx && this.tone(660, "sine", 0.08, 0.01, 1.2), i * 500);
    if (kind === "cheer") for (let i = 0; i < 5; i++) setTimeout(() => this.ctx && this.tone(500 + Math.random() * 500, "triangle", 0.03, 0.01, 0.2), i * 70);
  }
}

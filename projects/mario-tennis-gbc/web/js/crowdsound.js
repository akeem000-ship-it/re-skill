// "CROWD SOUND: on / off": synthesized crowd noises for the 3D stadium, mixed next to the game's own audio (its own WebAudio nodes into the
// same context's output; the emulated APU and its worklet are never touched). Nothing is sampled or copyrighted: every sound is made here.
//   cheer   a crowd roar: pink-ish noise through a band-pass that sweeps up and then settles, shaped by a slow swell, with a crackle of
//           applause on top (random short noise grains, thinning out); length about 2.3 s
//   aww     "aaaw": a dozen detuned sawtooth voices (a crowd of voices around 150-300 Hz) gliding down a fifth, through three formant
//           filters moving from /a/ to /o/, with a little breath noise; about 1.5 s
//   ooh     a long rally (matchfx.js): voices rising through /u/ to /o/, louder the longer the rally (level 0..1); about 1.4 s
//   clap    one beat of the crowd clapping (matchfx.js: claps in rhythm before a serve): many short hand claps spread over 40 ms
//   hush    set / match point (matchfx.js): a soft "shhh" that dies away into quiet; about 1.6 s
//   rattle  a chain-link fence rattle: bursts of noise through four high, inharmonic resonators (2.1, 3.3, 5.0, 7.4 kHz) at a ragged
//           rate that slows down, plus a short low clang (two decaying sines) as the ball hits the wire; about 0.9 s
// Loudness of cheer / aww follows the crowd size (stadium3d.js fill: 0 empty .. 1 full).
const KEY = "mt-crowdsound";
export class CrowdSound {
  constructor(getCtx) {
    this.getCtx = getCtx; this.on = (() => { try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; } })();
    this.noise = null; this.last = { cheer: -9, aww: -9, rattle: -9, whistle: -9, ooh: -9, hush: -9, clap: -9 }; this.onChange = null; this.volume = 1;
  }
  setOn(on) { this.on = !!on; try { localStorage.setItem(KEY, this.on ? "on" : "off"); } catch (e) { /* private mode */ } if (this.onChange) this.onChange(this.on); }
  ctx() { const c = this.getCtx && this.getCtx(); return c && c.state === "running" ? c : null; }
  buffer(c) {                                          // two seconds of noise, shared (white; the filters colour it)
    if (this.noise && this.noise.sampleRate === c.sampleRate) return this.noise;
    const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0); let s = 1;
    for (let i = 0; i < d.length; i++) { s = (Math.imul(s, 1664525) + 1013904223) | 0; d[i] = (s >>> 8) / 8388608 - 1; }
    return this.noise = b;
  }
  src(c, loop = true, offset = Math.random() * 1.5) { const s = c.createBufferSource(); s.buffer = this.buffer(c); s.loop = loop; s.start(0, offset); return s; }
  gate(kind, gap) { const t = performance.now() / 1000; if (t - this.last[kind] < gap) return false; this.last[kind] = t; return true; }
  vol(fill, floor = 0.25) { return this.volume * (floor + (1 - floor) * Math.pow(Math.max(0, Math.min(1, fill)), 0.7)); }

  cheer(fill = 0.6) {
    const c = this.on && this.ctx(); if (!c || fill <= 0.01 || !this.gate("cheer", 0.6)) return;
    const t = c.currentTime, V = 0.5 * this.vol(fill), out = c.createGain(); out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(V, t + 0.18); out.gain.setValueAtTime(V, t + 0.55); out.gain.exponentialRampToValueAtTime(0.0008, t + 2.4); out.connect(c.destination);
    // the roar
    const n = this.src(c), bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.7; bp.frequency.setValueAtTime(650, t); bp.frequency.exponentialRampToValueAtTime(1500, t + 0.45); bp.frequency.exponentialRampToValueAtTime(900, t + 2.2);
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 220; const g = c.createGain(); g.gain.value = 1.6;
    n.connect(bp); bp.connect(hp); hp.connect(g); g.connect(out); n.stop(t + 2.5);
    // a swell of voices ("yeaaah"): a few formant-filtered saws
    for (let i = 0; i < 5; i++) {
      const o = c.createOscillator(); o.type = "sawtooth"; const f0 = 170 + Math.random() * 130; o.frequency.setValueAtTime(f0, t); o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.4); o.frequency.linearRampToValueAtTime(f0 * 1.05, t + 2);
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 900 + Math.random() * 300; f.Q.value = 3; const vg = c.createGain(); vg.gain.value = 0.05; o.connect(f); f.connect(vg); vg.connect(out); o.start(t); o.stop(t + 2.5);
    }
    // applause: grains of noise, dense at first
    const grains = 70;
    for (let i = 0; i < grains; i++) {
      const at = t + 0.15 + Math.pow(Math.random(), 1.5) * 2.0, s = c.createBufferSource(); s.buffer = this.buffer(c);
      const f = c.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1500 + Math.random() * 3500; f.Q.value = 1.2; const gg = c.createGain();
      gg.gain.setValueAtTime(0, at); gg.gain.linearRampToValueAtTime(0.5 * (1 - (at - t) / 2.6), at + 0.004); gg.gain.exponentialRampToValueAtTime(0.001, at + 0.045);
      s.connect(f); f.connect(gg); gg.connect(out); s.start(at, Math.random() * 1.8, 0.06);
    }
  }
  aww(fill = 0.6) {
    const c = this.on && this.ctx(); if (!c || fill <= 0.01 || !this.gate("aww", 0.8)) return;
    const t = c.currentTime, V = 0.55 * this.vol(fill), out = c.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(V, t + 0.12); out.gain.setValueAtTime(V, t + 0.45); out.gain.exponentialRampToValueAtTime(0.0008, t + 1.6); out.connect(c.destination);
    const form = [[800, 520, 6], [1200, 850, 7], [2700, 2500, 9]].map(([a, b, q]) => { const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = q; f.frequency.setValueAtTime(a, t); f.frequency.linearRampToValueAtTime(b, t + 1.3); return f; });
    const sum = c.createGain(); sum.gain.value = 0.34;
    for (let i = 0; i < 12; i++) {
      const o = c.createOscillator(), f0 = 150 + Math.random() * 150; o.type = "sawtooth"; o.frequency.setValueAtTime(f0, t + Math.random() * 0.08); o.frequency.exponentialRampToValueAtTime(f0 * 0.68, t + 1.4);
      const vib = c.createOscillator(); vib.frequency.value = 4 + Math.random() * 2; const vg = c.createGain(); vg.gain.value = f0 * 0.012; vib.connect(vg); vg.connect(o.frequency);
      o.connect(sum); o.start(t); vib.start(t); o.stop(t + 1.7); vib.stop(t + 1.7);
    }
    for (const f of form) { sum.connect(f); const g = c.createGain(); g.gain.value = 1; f.connect(g); g.connect(out); }
    const n = this.src(c), nb = c.createBiquadFilter(); nb.type = "bandpass"; nb.frequency.value = 1100; nb.Q.value = 0.8; const ng = c.createGain(); ng.gain.value = 0.35; n.connect(nb); nb.connect(ng); ng.connect(out); n.stop(t + 1.7);
  }
  ooh(fill = 0.6, level = 0) {
    const c = this.on && this.ctx(); if (!c || fill <= 0.01 || !this.gate("ooh", 0.9)) return;
    const t = c.currentTime, V = (0.3 + 0.35 * level) * this.vol(fill), out = c.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(V, t + 0.35);
    out.gain.setValueAtTime(V, t + 0.8); out.gain.exponentialRampToValueAtTime(0.0008, t + 1.5); out.connect(c.destination);
    const form = [[320, 480, 7], [800, 900, 8], [2300, 2500, 10]].map(([a, b, q]) => { const f = c.createBiquadFilter(); f.type = "bandpass"; f.Q.value = q; f.frequency.setValueAtTime(a, t); f.frequency.linearRampToValueAtTime(b, t + 1.2); return f; });
    const sum = c.createGain(); sum.gain.value = 0.36;
    for (let i = 0; i < 10; i++) {
      const o = c.createOscillator(), f0 = 130 + Math.random() * 120; o.type = "sawtooth"; o.frequency.setValueAtTime(f0, t + Math.random() * 0.1); o.frequency.exponentialRampToValueAtTime(f0 * (1.25 + 0.15 * level), t + 1.1);
      o.connect(sum); o.start(t); o.stop(t + 1.55);
    }
    for (const f of form) { sum.connect(f); f.connect(out); }
  }
  clap(fill = 0.6) {
    const c = this.on && this.ctx(); if (!c || fill <= 0.01 || !this.gate("clap", 0.2)) return;
    const t = c.currentTime, V = 0.5 * this.vol(fill), out = c.createGain(); out.gain.value = V; out.connect(c.destination);
    const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1500; bp.Q.value = 0.9; bp.connect(out);
    const n = 6 + Math.round(18 * Math.min(1, fill));
    for (let i = 0; i < n; i++) {
      const at = t + Math.random() * 0.045, s = c.createBufferSource(); s.buffer = this.buffer(c); const g = c.createGain(), a = 0.35 + Math.random() * 0.5;
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(a, at + 0.002); g.gain.exponentialRampToValueAtTime(0.001, at + 0.03 + Math.random() * 0.02);
      s.connect(g); g.connect(bp); s.start(at, Math.random() * 1.8, 0.07);
    }
  }
  hush(fill = 0.6) {
    const c = this.on && this.ctx(); if (!c || fill <= 0.01 || !this.gate("hush", 2)) return;
    const t = c.currentTime, V = 0.16 * this.vol(fill), out = c.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(V, t + 0.25);
    out.gain.exponentialRampToValueAtTime(0.0006, t + 1.6); out.connect(c.destination);
    const n = this.src(c), hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2600; const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 4200; bp.Q.value = 0.9;
    n.connect(hp); hp.connect(bp); bp.connect(out); n.stop(t + 1.7);
  }
  rattle(strength = 1) {
    const c = this.on && this.ctx(); if (!c || !this.gate("rattle", 0.25)) return;
    const t = c.currentTime, V = 0.38 * this.volume * strength, out = c.createGain(); out.gain.value = V; out.connect(c.destination);
    const res = [2100, 3300, 5000, 7400].map((f, k) => { const r = c.createBiquadFilter(); r.type = "bandpass"; r.frequency.value = f * (0.96 + Math.random() * 0.08); r.Q.value = 9 + k * 3; const g = c.createGain(); g.gain.value = 0.9 - k * 0.12; r.connect(g); g.connect(out); return r; });
    let at = t; for (let i = 0; i < 22; i++) {                                    // ragged bursts, slowing down
      at += 0.008 + Math.random() * 0.012 + i * 0.0012; const s = c.createBufferSource(); s.buffer = this.buffer(c); const g = c.createGain(), a = Math.pow(1 - i / 24, 1.6);
      g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(a, at + 0.002); g.gain.exponentialRampToValueAtTime(0.001, at + 0.035 + Math.random() * 0.03);
      s.connect(g); for (const r of res) g.connect(r); s.start(at, Math.random() * 1.8, 0.09);
    }
    for (const [f, d, a] of [[392, 0.45, 0.5], [588, 0.3, 0.3]]) {                // the clang of the frame
      const o = c.createOscillator(); o.type = "sine"; o.frequency.value = f * (0.98 + Math.random() * 0.04); const g = c.createGain(); g.gain.setValueAtTime(a * strength * this.volume * 0.5, t); g.gain.exponentialRampToValueAtTime(0.0005, t + d); o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + d + 0.05);
    }
  }
  // the umpire's whistle (intro.js: the match starts): a pea whistle, two close tones with the pea's fast trill and a little breath
  whistle() {
    const c = this.on && this.ctx(); if (!c || !this.gate("whistle", 1)) return;
    const t = c.currentTime, out = c.createGain(); out.gain.setValueAtTime(0, t); out.gain.linearRampToValueAtTime(0.22 * this.volume, t + 0.03);
    out.gain.setValueAtTime(0.22 * this.volume, t + 0.5); out.gain.exponentialRampToValueAtTime(0.001, t + 0.62); out.connect(c.destination);
    const trill = c.createOscillator(); trill.frequency.value = 27; const tg = c.createGain(); tg.gain.value = 0.45; trill.connect(tg);
    const am = c.createGain(); am.gain.value = 0.55; tg.connect(am.gain); am.connect(out);
    for (const f of [2850, 3020]) {
      const o = c.createOscillator(); o.type = "triangle"; o.frequency.setValueAtTime(f * 0.97, t); o.frequency.linearRampToValueAtTime(f, t + 0.06);
      const fm = c.createGain(); fm.gain.value = 60; tg.connect(fm); fm.connect(o.frequency); o.connect(am); o.start(t); o.stop(t + 0.65);
    }
    const n = this.src(c), bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3000; bp.Q.value = 4; const ng = c.createGain(); ng.gain.value = 0.25;
    n.connect(bp); bp.connect(ng); ng.connect(out); n.stop(t + 0.65); trill.start(t); trill.stop(t + 0.65);
  }
}

export function addCrowdSoundButton(hud, snd) {
  if (!hud || !snd) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "crowdsndbtn"; b.title = "3D stadium: the crowd cheers a point, groans at a fault or a hit, and the back fence rattles (synthesized sounds)";
  const show = () => { b.textContent = "CROWD SOUND: " + (snd.on ? "on" : "off"); b.classList.toggle("on", snd.on); };
  b.addEventListener("pointerdown", () => { snd.setOn(!snd.on); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); snd.onChange = show; return b;
}
export function attachCrowdSound(stadium, hud, getCtx) { const s = stadium.sound = new CrowdSound(getCtx); addCrowdSoundButton(hud, s); return s; }

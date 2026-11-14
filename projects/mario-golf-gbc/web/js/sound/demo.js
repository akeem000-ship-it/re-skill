// The sound page (web/sound.html): the user's ROM, the native driver (driver.js) and the standalone chip (apu.js)
// played through Web Audio. Driver frames run at the Game Boy's 59.73 Hz; each one's register writes go to the
// chip, which renders the samples for that frame. A few frames are kept queued ahead of the audio clock.
import { SoundDriver, soundIds } from "./driver.js";
import { SynthAPU, CLOCK, DOTS_PER_FRAME } from "./apu.js";

const $ = id => document.getElementById(id);
const h2 = v => v.toString(16).toUpperCase().padStart(2, "0");
const NOTES = { 0x00: "silence", 0x03: "credits", 0x17: "jingle", 0x18: "jingle", 0x19: "jingle", 0x1A: "jingle",
  0x1F: "pick up", 0x24: "title", 0x29: "intro", 0x2A: "decisive hole" };

let ctx = null, driver = null, apu = null, nextTime = 0, timer = 0, rom = null;
const pending = [];                          // commands to give the driver before its next frame
const FRAMES_PER_CHUNK = 4, AHEAD = 0.15;    // ~67 ms chunks, ~150 ms queued
const levels = [0, 0, 0, 0];

function status(t) { $("status").textContent = t; }

function ensureAudio() {
  if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  apu = new SynthAPU(ctx.sampleRate);
  for (const [r, v] of driver.init()) apu.write(r, v);
  for (const box of document.querySelectorAll("[data-ch]")) apu.muted[+box.dataset.ch] = !box.checked;
  nextTime = ctx.currentTime + 0.05;
  timer = setInterval(pump, 25);
  pump();
}

let lastWrites = [];
function pump() {
  while (nextTime < ctx.currentTime + AHEAD) {
    const n = Math.ceil(FRAMES_PER_CHUNK * DOTS_PER_FRAME / apu.samplesPer) + 2;
    const left = new Float32Array(n), right = new Float32Array(n);
    let at = 0;
    for (let f = 0; f < FRAMES_PER_CHUNK; f++) {
      while (pending.length) pending.shift()();
      const w = driver.frame();
      if (w.length) lastWrites = w;
      for (const [r, v] of w) apu.write(r, v);
      at = apu.renderFrame(left, right, at);
    }
    const buf = ctx.createBuffer(2, at, ctx.sampleRate);
    buf.copyToChannel(left.subarray(0, at), 0); buf.copyToChannel(right.subarray(0, at), 1);
    const src = ctx.createBufferSource(); src.buffer = buf; src.connect(ctx.destination);
    if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.02;
    src.start(nextTime); nextTime += at / ctx.sampleRate;
  }
}

function meters() {
  if (apu) {
    for (let i = 0; i < 4; i++) {
      const c = apu.ch[i];
      let v = 0;
      if (c.enabled && c.dac) v = i === 2 ? [0, 15, 8, 4][(apu.reg[0x1C] >> 5) & 3] : c.envVol;
      levels[i] = Math.max(v, levels[i] * 0.85);
      $("m" + i).style.width = (levels[i] / 15 * 100).toFixed(0) + "%";
    }
    $("regs").textContent = lastWrites.map(([r, v]) => `${h2(r)}=${h2(v)}`).join(" ");
    const r = driver.ram;
    $("now").textContent = `song request $${h2(r[0xC4C0])} (bank $${h2(r[0xC4C1])}) · effect channels ${(r[0xC4CC] & 15).toString(2).padStart(4, "0")}`;
  }
  requestAnimationFrame(meters);
}

function command(fn, label) {
  ensureAudio();
  pending.push(fn);
  for (const b of document.querySelectorAll("button.on")) if (b.dataset.kind === label.kind) b.classList.remove("on");
  if (label.el) label.el.classList.add("on");
}

function button(parent, text, sub, onClick, kind) {
  const b = document.createElement("button");
  b.className = "s"; b.dataset.kind = kind;
  b.innerHTML = text + (sub ? `<small>${sub}</small>` : "");
  b.addEventListener("click", () => onClick(b));
  parent.appendChild(b);
  return b;
}

function start(bytes) {
  rom = new Uint8Array(bytes);
  driver = new SoundDriver(rom);
  const { songs, effects } = soundIds(rom);
  const bankOf = n => rom[0x7E * 0x4000 + 0x52A5 - 0x4000 + n];
  $("songs").innerHTML = ""; $("jingles").innerHTML = ""; $("sfx").innerHTML = "";
  for (let s = 0; s < songs; s++)
    button($("songs"), "$" + h2(s), NOTES[s] || "bank " + h2(bankOf(s)), el => command(() => driver.playSound(s), { kind: "song", el }), "song");
  for (let j = 0x36; j <= 0x3A; j++)
    button($("jingles"), "$" + h2(j), "song $" + h2(rom[0x2BE8 + j - 0x36]), el => command(() => driver.playSound(j), { kind: "song", el }), "jingle");
  for (const e of effects)
    button($("sfx"), "$" + h2(0x40 + e), "effect " + h2(e), () => command(() => {
      driver.setBallHeight((Math.random() * 0x200) | 0);
      driver.playSound(0x40 + e);
    }, { kind: "sfx" }), "sfx");
  $("stop").onclick = () => command(() => driver.playSound(0), { kind: "song" });
  for (const box of document.querySelectorAll("[data-ch]"))
    box.onchange = () => { if (apu) apu.muted[+box.dataset.ch] = !box.checked; };
  $("loader").hidden = true;
  for (const id of ["player", "songsPanel", "sfxPanel"]) $(id).hidden = false;
  status(`${songs} songs, ${effects.length} effects · ${(CLOCK / DOTS_PER_FRAME).toFixed(2)} Hz driver`);
  requestAnimationFrame(meters);
}

$("file").addEventListener("change", e => { const f = e.target.files[0]; if (f) f.arrayBuffer().then(start); });
fetch("../rom/mario_golf.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject())
  .then(start, () => { $("loader").hidden = false; status("choose your ROM"); });

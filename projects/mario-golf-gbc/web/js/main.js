// The page: load the user's ROM (rom/mario_golf.gbc next to the project, or a file the user picks), run it on
// the Game Boy Color core in js/gb at the hardware's 59.73 frames per second, with keyboard / gamepad / touch
// input, sound through an AudioWorklet, and the battery save (SRAM) kept in localStorage.
// window.__mg exposes the running machine for tests (web/tests/page_smoke.mjs).
import { GBC } from "./gb/gbc.js";
import { pollGamepad } from "./gamepad.js";

const EXPECTED_SHA1 = "7f2062e51b4fc87378c1d5e6b9578c9277b94e0b";
const FRAME_MS = 1000 * 70224 / 4194304;          // 16.74 ms
const $ = id => document.getElementById(id);
const canvas = $("screen"), ctx = canvas.getContext("2d"), image = ctx.createImageData(160, 144);
let gb = null, sha = "", paused = false, fast = false, muted = false, last = 0, acc = 0, fps = 0, fpsFrames = 0, fpsT = 0;
const keys = {};

async function sha1Hex(bytes) {
  if (!crypto.subtle) return "";
  const h = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join("");
}

// ---- battery save ----
const saveKey = () => "mg-sram-" + sha.slice(0, 12);
function loadSave() {
  try {
    const s = localStorage.getItem(saveKey()); if (!s) return;
    gb.mem.sram.set(Uint8Array.from(atob(s), c => c.charCodeAt(0)).subarray(0, gb.mem.sram.length));
    $("save").textContent = "save loaded";
  } catch (e) { console.warn("save", e); }
}
let dirtyAt = 0;
function writeSave() {
  try {
    let bin = ""; const b = gb.mem.sram; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
    localStorage.setItem(saveKey(), btoa(bin));
    $("save").textContent = "saved " + new Date().toLocaleTimeString();
  } catch (e) { console.warn("save", e); }
}
function checkSave(now) {                          // write a second after the game stops writing SRAM
  if (gb.mem.sramDirty) { gb.mem.sramDirty = false; dirtyAt = now; }
  if (dirtyAt && now - dirtyAt > 1000) { dirtyAt = 0; writeSave(); }
}
addEventListener("pagehide", () => { if (gb && dirtyAt) writeSave(); });

// ---- sound ----
let actx = null, anode = null;
const abuf = new Float32Array(2 * 4096);
async function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
  const src = `class P extends AudioWorkletProcessor {
    constructor() { super(); this.q = []; this.cur = null; this.pos = 0; this.port.onmessage = e => { this.q.push(e.data); if (this.q.length > 12) this.q.shift(); }; }
    process(inputs, outputs) { const L = outputs[0][0], R = outputs[0][1] || L; for (let i = 0; i < L.length; i++) {
      if (!this.cur || this.pos >= this.cur.length) { this.cur = this.q.shift() || null; this.pos = 0; }
      if (this.cur) { L[i] = this.cur[this.pos]; R[i] = this.cur[this.pos + 1]; this.pos += 2; } else { L[i] = R[i] = 0; } }
      return true; } }
    registerProcessor("mg-pcm", P);`;
  await actx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: "application/javascript" })));
  anode = new AudioWorkletNode(actx, "mg-pcm", { outputChannelCount: [2] }); anode.connect(actx.destination);
}
function unlockAudio() { initAudio().then(() => actx.state !== "running" && actx.resume()).catch(e => console.warn("audio", e)); }
function pushAudio() {
  if (!anode || muted || fast) { gb.apu.outPos = 0; return; }
  const n = gb.apu.drain(abuf); if (n) anode.port.postMessage(abuf.slice(0, n));
}

// ---- input ----
const MAP = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", KeyZ: "a", KeyX: "b",
              Enter: "start", ShiftLeft: "select", ShiftRight: "select", KeyQ: "select" };
function input() {
  pollGamepad(keys);
  const st = {}; for (const [k, b] of Object.entries(MAP)) if (keys[k]) st[b] = true;
  return st;
}
addEventListener("keydown", e => {
  if (e.code in MAP || e.code === "Space") e.preventDefault();
  keys[e.code] = true; unlockAudio();
  if (e.code === "Space") fast = true;
  if (e.code === "KeyP" && !e.repeat) paused = !paused;
  if (e.code === "KeyM" && !e.repeat) muted = !muted;
});
addEventListener("keyup", e => { keys[e.code] = false; if (e.code === "Space") fast = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; fast = false; });
for (const el of document.querySelectorAll("#pad button")) {
  const code = el.dataset.key;
  const down = e => { e.preventDefault(); el.setPointerCapture(e.pointerId); keys[code] = true; el.classList.add("on"); unlockAudio(); };
  const up = () => { keys[code] = false; el.classList.remove("on"); };
  el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
}
canvas.addEventListener("pointerdown", unlockAudio);

// ---- main loop ----
function draw() {
  new Uint32Array(image.data.buffer).set(gb.ppu.frame);
  ctx.putImageData(image, 0, 0);
}
function loop(now) {
  requestAnimationFrame(loop);
  if (!gb) return;
  if (!last) last = now;
  acc += Math.min(now - last, 100); last = now;
  if (paused) { acc = 0; $("status").textContent = "paused (P)"; return; }
  let ran = 0;
  const budget = fast ? 8 : 4;                     // catch up after a slow frame, but never spiral
  while ((acc >= FRAME_MS || fast) && ran < budget) {
    gb.setInput(input()); gb.runFrame(); pushAudio(); ran++;
    acc = fast ? 0 : acc - FRAME_MS;
  }
  if (acc > FRAME_MS * 4) acc = 0;
  if (ran) draw();
  fpsFrames += ran;
  if (now - fpsT > 1000) { fps = fpsFrames * 1000 / (now - fpsT); fpsFrames = 0; fpsT = now;
    $("status").textContent = `${fps.toFixed(0)} fps${fast ? " (fast)" : ""}${muted ? " · muted" : ""}`; }
  checkSave(now);
}

async function start(buffer) {
  const bytes = new Uint8Array(buffer);
  sha = await sha1Hex(bytes);
  if (sha && sha !== EXPECTED_SHA1) $("status").textContent = "unexpected ROM (SHA-1 " + sha.slice(0, 8) + "…); running it anyway";
  gb = new GBC(bytes, { sampleRate: 44100, audio: true });
  window.__mg = { gb };
  loadSave();
  $("loader").hidden = true;
  canvas.focus();
}
$("file").addEventListener("change", e => { const f = e.target.files[0]; if (f) f.arrayBuffer().then(start); });
fetch("../rom/mario_golf.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject())
  .then(start).catch(() => { $("loader").hidden = false; $("status").textContent = "no ROM loaded"; });
requestAnimationFrame(loop);

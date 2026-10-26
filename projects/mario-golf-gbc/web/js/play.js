// The native page (web/play.html): the user's ROM, the golf engine rewritten in JS (js/golf, no Game Boy CPU) and
// its display model drawn by js/golf/render/raster.js, the native sound driver (js/sound) through Web Audio, with
// keyboard / gamepad / touch input. The round is a generator (js/golf/game.js playRoundFrames): each next() runs
// the game's code for one frame (up to its next AdvanceFrame 00:2E3B), at the hardware's 59.73 frames per second.
// The page starts at power-on: the title, the menus (one player, a preset golfer; Stroke), then the round
// (js/golf/boot.js, modesel.js). The mode selector can also start a round directly as a new game's Stroke round or
// match against the computer would (js/golf/start.js).
// window.__golf exposes the running state for tests (web/tests/play_page.mjs).
import { useRom } from "./golf/rom.js";
import { GolfMemory, playerField } from "./golf/memory.js";
import { playRoundFrames, playFromPowerOn } from "./golf/game.js";
import { strokeRoundSetup, matchRoundSetup } from "./golf/start.js";
import { initDisplay } from "./golf/render/display.js";
import { rasterize } from "./golf/render/raster.js";
import { SoundDriver } from "./sound/driver.js";
import { SynthAPU, CLOCK, DOTS_PER_FRAME } from "./sound/apu.js";
import { pollGamepad } from "./gamepad.js";

const EXPECTED_SHA1 = "7f2062e51b4fc87378c1d5e6b9578c9277b94e0b";
const FRAME_MS = 1000 * DOTS_PER_FRAME / CLOCK;   // 16.74 ms
const $ = id => document.getElementById(id);
const canvas = $("screen"), ctx = canvas.getContext("2d"), image = ctx.createImageData(160, 144);
const rgb5 = new Uint8Array(160 * 144 * 3), rgba = new Uint32Array(image.data.buffer);
const keys = {};
let rom = null, sha = "", game = null, paused = false, fast = false, muted = false, last = 0, acc = 0;
let fps = 0, fpsFrames = 0, fpsT = 0;

async function sha1Hex(bytes) {
  if (!crypto.subtle) return "";
  const h = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, "0")).join("");
}

// ---- the battery save: the 8 KB save RAM in localStorage under the emulated page's key and format (js/main.js:
// "mg-sram-" + the ROM's SHA-1 (12 digits), base64 of the bytes), so a save made on either page loads on the other ----
const saveKey = () => "mg-sram-" + (sha || EXPECTED_SHA1).slice(0, 12);
function loadSave(w) {
  try {
    const s = localStorage.getItem(saveKey());
    if (s) { w.sram.set(Uint8Array.from(atob(s), c => c.charCodeAt(0)).subarray(0, w.sram.length)); return true; }
  } catch (e) { console.warn("save", e); }
  return false;
}
let savedCopy = null, saveCheckAt = 0;
function writeSave(w) {
  try {
    let bin = ""; const b = w.sram; for (let i = 0; i < b.length; i += 0x2000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x2000));
    localStorage.setItem(saveKey(), btoa(bin));
    $("save").textContent = "saved " + new Date().toLocaleTimeString();
  } catch (e) { console.warn("save", e); }
}
function checkSave(w, force) {                     // the game wrote the save RAM: store it (at most twice a second)
  if (!savedCopy || (!force && game.frames < saveCheckAt)) return;
  saveCheckAt = game.frames + 30;
  for (let i = 0; i < w.sram.length; i++) if (w.sram[i] !== savedCopy[i]) { savedCopy.set(w.sram); writeSave(w); return; }
}
addEventListener("pagehide", () => { if (game) checkSave(game.w, true); });
window.__flushSave = () => { if (game) checkSave(game.w, true); };

// ---- sound: the driver's register writes for each frame go to the chip, which renders that frame's samples ----
let actx = null, apu = null, driver = null, nextTime = 0, chunkL = null, chunkR = null, chunkAt = 0, chunkFrames = 0;
const CHUNK = 4, RATE = 48000;                    // frames per scheduled buffer (~67 ms)
function initAudio() {                             // (browsers start audio only after a key press or a touch)
  if (actx) { if (actx.state === "suspended") actx.resume(); return; }
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RATE });
    nextTime = actx.currentTime + 0.05;
  } catch (e) { console.warn("audio", e); actx = null; }
}
function soundFrame(w) {                           // one VBlank's sound work (SoundUpdate 7E:40EB and 00:2C4A)
  driver.setBallHeight(w.wram[0][0xAAB] | w.wram[0][0xAAC] << 8);   // $CAAB: the flight whistle follows the ball
  apu.writeAll(driver.frame());
  if (!chunkL) {
    const n = Math.ceil(CHUNK * DOTS_PER_FRAME / apu.samplesPer) + 4;
    chunkL = new Float32Array(n); chunkR = new Float32Array(n); chunkAt = 0; chunkFrames = 0;
  }
  chunkAt = apu.renderFrame(chunkL, chunkR, chunkAt);
  if (++chunkFrames < CHUNK) return;
  if (actx && !muted && !fast && actx.state === "running") {
    const buf = actx.createBuffer(2, chunkAt, actx.sampleRate);
    buf.copyToChannel(chunkL.subarray(0, chunkAt), 0); buf.copyToChannel(chunkR.subarray(0, chunkAt), 1);
    const src = actx.createBufferSource(); src.buffer = buf; src.connect(actx.destination);
    if (nextTime < actx.currentTime + 0.01) nextTime = actx.currentTime + 0.03;
    if (nextTime < actx.currentTime + 0.3) { src.start(nextTime); nextTime += chunkAt / actx.sampleRate; }
  }
  chunkL = null;
}

// ---- input: hJoyHeld bits (A 1, B 2, Select 4, Start 8, Right $10, Left $20, Up $40, Down $80) ----
const MAP = { KeyZ: 1, KeyX: 2, ShiftLeft: 4, ShiftRight: 4, KeyQ: 4, Enter: 8, ArrowRight: 0x10, ArrowLeft: 0x20, ArrowUp: 0x40,
  ArrowDown: 0x80 };
let pauseWas = false;
function held() {
  pollGamepad(keys);
  let b = 0;
  for (const [k, bit] of Object.entries(MAP)) if (keys[k]) b |= bit;
  const p = !!keys.KeyP;                           // P: the page's own pause (Start is the game's: its pause menu)
  if (p && !pauseWas) paused = !paused;
  pauseWas = p;
  return b;
}
addEventListener("keydown", e => {
  if (e.code in MAP || e.code === "Space") e.preventDefault();
  keys[e.code] = true; initAudioSoon();
  if (e.code === "Space") fast = true;
  if (e.code === "KeyM" && !e.repeat) muted = !muted;
});
addEventListener("keyup", e => { keys[e.code] = false; if (e.code === "Space") fast = false; });
addEventListener("blur", () => { for (const k in keys) keys[k] = false; fast = false; });
for (const el of document.querySelectorAll("#pad button")) {
  const code = el.dataset.key;
  const down = e => { e.preventDefault(); el.setPointerCapture(e.pointerId); keys[code] = true; el.classList.add("on"); initAudioSoon(); };
  const up = () => { keys[code] = false; el.classList.remove("on"); };
  el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
}
canvas.addEventListener("pointerdown", () => initAudioSoon());
function initAudioSoon() { if (driver) initAudio(); }

// ---- the round ----
function newRound() {
  const w = new GolfMemory();
  const mode = $("mode").value;                    // "title" (power-on), "stroke", or "match:N" against preset golfer N
  let holes = 0;
  if (mode !== "title") {
    const seed = crypto.getRandomValues(new Uint16Array(1))[0];   // (the menus' frames would have moved the seed)
    holes = mode.startsWith("match:") ? matchRoundSetup(w, { golfer: 8, opponent: +mode.slice(6), course: 1, seed })
      : strokeRoundSetup(w, { golfer: 8, course: 1, seed });
  }
  savedCopy = null;
  if (mode === "title") {                          // power-on reads the save RAM (GameMain's SaveLoad 02:41F6)
    $("save").textContent = loadSave(w) ? "save loaded" : "";
    savedCopy = w.sram.slice();
    saveCheckAt = 0;
  }
  initDisplay(w);
  driver = new SoundDriver(rom);
  apu = new SynthAPU(RATE);
  apu.writeAll(driver.init());                     // SoundInit 7E:4072 at power-on
  w.onSound = id => apu.writeAll(driver.playSound(id));   // rst $08 PlaySoundCmd 00:2BBB
  if (mode !== "title") w.onSound(0x01);           // ModeSelectMain plays song 1 in the menus (32:508B); the round's own songs follow
  game = { w, g: null, frames: 0, done: null, error: null, mark: mode === "title" ? "menus" : "", marks: [], shots: [], holes: 0 };
  const ev = (kind, name) => { if (kind === "M") { game.mark = name; game.marks.push([game.frames, name]); } };
  const opts = { ev, maxHoles: Infinity, onShot: s => game.shots.push(s.outcome), onHoleEnd: r => { game.holes = r.holes.length; },
    onRoundStart: () => { game.mark = "round"; } };
  game.g = mode === "title" ? playFromPowerOn(w, held, opts) : playRoundFrames(w, holes, held, opts);
  window.__golf = game;
  $("message").textContent = "";
}
function step() {                                  // one frame of the game
  const r = game.g.next();
  game.frames++;
  soundFrame(game.w);
  checkSave(game.w);
  if (r.done) {
    game.done = r.value;
    const total = r.value.holes.reduce((s, h) => s + h.strokes, 0);
    const w0 = game.w.wram[0];
    if (w0[0x834] === 2) showMessage(`Match over: ${["", "you won", "you lost", "halved"][w0[0x96C]] || "decided"} after ${r.value.holes.length} holes.`);
    else showMessage(`Round over: ${total} strokes over ${r.value.holes.length} holes.`);
  }
}
function showMessage(text) {
  const m = $("message");
  m.textContent = text;
  const b = document.createElement("button");
  b.textContent = $("mode").value === "title" ? "Power on again" : "New round"; b.onclick = () => { newRound(); canvas.focus(); };
  m.appendChild(b);
}
$("mode").addEventListener("change", () => { if (rom) { newRound(); canvas.focus(); } });
function draw() {
  const w = game.w;
  rasterize({ vram: w.vram, oam: w.oam, bgPal: w.bgPal, objPal: w.objPal, ...w.lcd }, rgb5, rgba);
  ctx.putImageData(image, 0, 0);
  const w0 = w.wram[0];
  if (w0[0x837]) $("score").textContent = `hole ${w0[0x837]} · stroke ${w0[playerField(w, 0x20)]}`;
}
function loop(now) {
  requestAnimationFrame(loop);
  if (!game || game.done || game.error) { last = 0; return; }
  if (!last) last = now;
  acc += Math.min(now - last, 100); last = now;
  held();                                          // (P toggles the pause even while paused)
  if (paused) { acc = 0; $("status").textContent = "paused (P)"; return; }
  let ran = 0;
  const budget = fast ? 8 : 4;
  try {
    while ((acc >= FRAME_MS || fast) && ran < budget && !game.done) {
      step(); ran++;
      acc = fast ? 0 : acc - FRAME_MS;
    }
  } catch (e) {                                    // a path the rewrite does not have yet
    game.error = e.message;
    console.warn(e);
    showMessage(`Stopped: ${e.message}.`);
  }
  if (acc > FRAME_MS * 4) acc = 0;
  if (ran) draw();
  fpsFrames += ran;
  if (now - fpsT > 1000) {
    fps = fpsFrames * 1000 / (now - fpsT); fpsFrames = 0; fpsT = now;
    $("status").textContent = `${fps.toFixed(0)} fps${fast ? " (fast)" : ""}${muted ? " · muted" : ""}`;
  }
}

async function start(buffer) {
  const bytes = new Uint8Array(buffer);
  sha = await sha1Hex(bytes);
  if (sha && sha !== EXPECTED_SHA1) $("status").textContent = "unexpected ROM (SHA-1 " + sha.slice(0, 8) + "…); running it anyway";
  rom = bytes;
  useRom(rom);
  newRound();
  $("loader").hidden = true;
  canvas.focus();
}
$("file").addEventListener("change", e => { const f = e.target.files[0]; if (f) f.arrayBuffer().then(start); });
fetch("../rom/mario_golf.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject())
  .then(start).catch(() => { $("loader").hidden = false; $("status").textContent = "no ROM loaded"; });
requestAnimationFrame(loop);

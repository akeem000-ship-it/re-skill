// The native page (web/play.html): the user's ROM, the golf engine rewritten in JS (js/golf, no Game Boy CPU) and
// its display model drawn by js/golf/render/raster.js, the native sound driver (js/sound) through Web Audio, with
// keyboard / gamepad / touch input. The round is a generator (js/golf/game.js playRoundFrames): each next() runs
// the game's code for one frame (up to its next AdvanceFrame 00:2E3B), at the hardware's 59.73 frames per second.
// The page starts at power-on: the title, the menus (one player, a preset golfer; Stroke), then the round
// (js/golf/boot.js, modesel.js). The mode selector can also start a round directly as a new game's Stroke round or
// match against the computer would (js/golf/start.js).
// The "link" mode runs two machines from power-on in the page, side by side, joined by the link cable in JS
// (js/golf/serial.js NativeCable): the left one with this browser's save, the right one with an empty save RAM (its
// preset golfers); the keys go to the machine picked with Tab (the other's buttons are let go), the sound is the
// left one's. Each frame runs the left machine's frame, then the right one's (the transfer the clock side starts
// at its VBlank reaches the other machine at once).
// window.__golf exposes the running state for tests (web/tests/play_page.mjs).
import { useRom } from "./golf/rom.js";
import { NativeCable } from "./golf/serial.js";
import { GolfMemory, playerField } from "./golf/memory.js";
import { playRoundFrames, playFromPowerOn } from "./golf/game.js";
import { strokeRoundSetup, matchRoundSetup, setCourseHole, setPlayerControl } from "./golf/start.js";
import { initDisplay } from "./golf/render/display.js";
import { rasterize } from "./golf/render/raster.js";
import { SoundDriver } from "./sound/driver.js";
import { SynthAPU, CLOCK, DOTS_PER_FRAME } from "./sound/apu.js";
import { pollGamepad } from "./gamepad.js";
// ---- 3D LAYERS (web/js/g3d: the 3D hole view and its effects): render only, they read the game's state and never write it ----
import { attach3D } from "./g3d/layers.js";
import { Golf3D } from "./g3d/scene.js";
// ---- (end 3D LAYERS) ----
// ---- HD picture options (web/js/hd: HD text, HD menus, wide, portrait, handheld): render / UI only, never the game's state ----
import { attachHD } from "./hd/page.js";
import { attachAimPower } from "./hd/aimpower.js";
import { attachOptions } from "./hd/options.js";
// ---- (end HD) ----
import { GolfRecorder, pack, saveFile } from "./rec.js";   // REC: a session to send in (js/rec.js)

const EXPECTED_SHA1 = "7f2062e51b4fc87378c1d5e6b9578c9277b94e0b";
const FRAME_MS = 1000 * DOTS_PER_FRAME / CLOCK;   // 16.74 ms
const $ = id => document.getElementById(id);
const canvas = $("screen"), ctx = canvas.getContext("2d"), image = ctx.createImageData(160, 144);
const canvas2 = $("screen2"), ctx2 = canvas2.getContext("2d"), image2 = ctx2.createImageData(160, 144);
const rgba2 = new Uint32Array(image2.data.buffer);
const rgb5 = new Uint8Array(160 * 144 * 3), rgba = new Uint32Array(image.data.buffer);
const keys = {};
const g3d = attach3D({ screen: canvas, getGame: () => game });   // (3D LAYERS: the options panel and the 3D canvas over the screen)
const hdPage = attachHD({ canvas, keys, getRom: () => rom, getGame: () => game });   // (HD: the picture options and the touch layouts)
const aimPower = attachAimPower({ screen: canvas, keys, getGame: () => game });   // (HD: the aim and swing helpers: big meter, shot preview, markers, tap area)
let rom = null, sha = "", game = null, paused = false, fast = false, muted = false, last = 0, acc = 0;
// (HD: the OPTIONS screen, every setting above by category; the game runs on behind it, the keys go to it while it is open)
const sound = { muted: () => muted, set(m) { muted = !!m; }, onChange: null };
const options = attachOptions({ keys, hdPage, g3d, sound });
let fps = 0, fpsFrames = 0, fpsT = 0;
// ---- ATTRACT (?attract: MTenn3D's game picker shows this page behind its golf half): the game playing itself, silent, no buttons, no
// save written. A Stroke round from a random hole of a random course with a preset golfer whose record says computer (+$13 = 1,
// SetPlayerControl 02:4994: the turn's aim CpuPlanShotMain 3C:426A and SwingMeterCPU 10:5643, as a computer opponent's), seen in 3D;
// when the hole is over, another. (?attract=title: the title's fly-over alone instead, the title's own picture left out:
// g3d/titleshow.js.) It tells the page above it "ready" once the hole shows, "norom" when it has no ROM; {golfPreview: "pause", on}
// holds it ----
const ATTRACT = new URLSearchParams(location.search).has("attract"), ATTRACT_TITLE = new URLSearchParams(location.search).get("attract") === "title";
const tell = what => { try { if (window.parent !== window) window.parent.postMessage({ golfPreview: what }, "*"); } catch (e) { /* no parent */ } };
let attractShown = false;
if (ATTRACT) {
  muted = true; globalThis.__golfAttract = ATTRACT_TITLE; globalThis.__golfAttractPlay = !ATTRACT_TITLE; document.body.classList.add("attract");
  const st = document.createElement("style");
  st.textContent = "body.attract{background:#000;overflow:hidden} body.attract *{visibility:hidden} body.attract #view3d{visibility:visible}" +
    " body.attract #screen{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;max-width:none!important;" +
    "max-height:none!important;aspect-ratio:auto!important;transform:none!important;margin:0!important}";
  document.head.appendChild(st);
  addEventListener("message", e => { if (e.data && e.data.golfPreview === "pause") paused = !!e.data.on; });
}
const atTitle = () => !!(game && game.w && game.w.vram && Golf3D.taskOn(game.w, 0x40, 0x4D1D));
// ATTRACT music (MTenn3D's game picker sends {golfPreview: "music", on} as the golf half is chosen or left): the title's song (sound $24,
// TitleScreen 40:4069) on a sound driver of its own, beside the silent game; buffers queued on the audio clock, a quarter second ahead,
// so its tempo is the driver's own whatever the page's frame rate. Off: faded and the audio suspended (on again: it carries on)
const tm = { on: false, drv: null, apu: null, ctx: null, gain: null, next: 0 };
function titleMusic(on) {
  tm.on = on;
  if (!rom) return;
  if (on) {
    if (!tm.ctx) { try { tm.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RATE }); tm.gain = tm.ctx.createGain(); tm.gain.connect(tm.ctx.destination); } catch (e) { return; } }
    if (!tm.drv) { tm.drv = new SoundDriver(rom); tm.apu = new SynthAPU(RATE); tm.apu.writeAll(tm.drv.init()); tm.apu.writeAll(tm.drv.playSound(0x24)); }
    tm.ctx.resume(); tm.gain.gain.cancelScheduledValues(tm.ctx.currentTime); tm.gain.gain.setTargetAtTime(0.9, tm.ctx.currentTime, 0.05);
  } else if (tm.ctx) { tm.gain.gain.setTargetAtTime(0, tm.ctx.currentTime, 0.08); setTimeout(() => { if (!tm.on && tm.ctx) tm.ctx.suspend(); }, 400); }
}
function titleMusicFrames() {
  if (!tm.on || !tm.drv || !tm.ctx || tm.ctx.state !== "running") return;
  if (tm.next < tm.ctx.currentTime) tm.next = tm.ctx.currentTime + 0.03;
  while (tm.next < tm.ctx.currentTime + 0.25) {
    const n = Math.ceil(CHUNK * DOTS_PER_FRAME / tm.apu.samplesPer) + 4, L = new Float32Array(n), R = new Float32Array(n); let at = 0;
    for (let i = 0; i < CHUNK; i++) { tm.apu.writeAll(tm.drv.frame()); at = tm.apu.renderFrame(L, R, at); }
    const buf = tm.ctx.createBuffer(2, at, RATE); buf.copyToChannel(L.subarray(0, at), 0); buf.copyToChannel(R.subarray(0, at), 1);
    const src = tm.ctx.createBufferSource(); src.buffer = buf; src.connect(tm.gain); src.start(tm.next); tm.next += at / RATE;
  }
}
if (ATTRACT) addEventListener("message", e => { if (e.data && e.data.golfPreview === "music") titleMusic(!!e.data.on); });
window.__titleMusic = tm;                          // (tests)
// ---- (end ATTRACT) ----

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
let active = 0;                                    // (link mode: the machine the keys go to)
function held() {
  if (ATTRACT) return 0;                           // (ATTRACT: no buttons; the picker above has them)
  pollGamepad(keys);
  let b = 0;
  for (const [k, bit] of Object.entries(MAP)) if (keys[k]) b |= bit;
  const p = !!keys.KeyP;                           // P: the page's own pause (Start is the game's: its pause menu)
  if (p && !pauseWas) paused = !paused;
  pauseWas = p;
  if (options && options.isOpen) return 0;           // (HD: the OPTIONS screen has the keys while it is open)
  { const t = hdPage.input(game, b); if (t !== undefined) return t; }   // (HD: a test's scripted buttons; js/hd/page.js)
  return b;
}
addEventListener("keydown", e => {
  if (e.code in MAP || e.code === "Space") e.preventDefault();
  keys[e.code] = true; initAudioSoon();
  if (e.code === "Space") fast = true;
  if (e.code === "KeyM" && !e.repeat) { muted = !muted; if (sound.onChange) sound.onChange(muted); }
  if (e.code === "Tab" && game && game.link) { e.preventDefault(); if (!e.repeat) { active ^= 1; showActive(); } }
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

// ---- REC (as Mario Tennis's): pressed, it marks where the part you mean begins; pressed again, the session is saved (a .mgrec file:
// in the MTenn3D app to Downloads/MTenn3D and the share sheet, else a download). Hiding the page saves it too. ----
const rec = new GolfRecorder();
const recButtons = [];
const recLabel = () => { const on = rec.marking, t = on ? rec.seconds() : 0;
  for (const b of recButtons) { b.classList.toggle("recon", on); b.textContent = on ? `REC ${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "REC"; } };
async function saveRecording(quick = false) {
  if (!rec.marking || !game) return;
  const settings = {}; try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (/^mg/i.test(k) && !/sram|rom/i.test(k)) settings[k] = localStorage.getItem(k); } } catch (e) { /* private mode */ }
  const obj = rec.snapshot({ rom: sha, marks: game.marks, meta: { ua: navigator.userAgent, url: location.pathname + location.search, settings, screen: [innerWidth, innerHeight] } });
  rec.from = -1; recLabel();
  const { bytes, gz } = await pack(obj, quick);
  const d = new Date(), p2 = n => String(n).padStart(2, "0");
  const name = `mgolf-${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}.mgrec${gz ? "" : ".json"}`;
  saveFile(name, bytes);
  $("message").textContent = `Recording saved: ${name} (${Math.round((obj.frames - obj.from) / 59.73)} s)`;
}
function recPress() {
  if (!game || !rec.on) { $("message").textContent = game && game.link ? "REC: the link mode is not recorded" : "REC: start the game first"; return; }
  if (rec.marking) saveRecording(); else { rec.mark(); recLabel(); }
}
{
  const css = document.createElement("style"); css.textContent = ".recon { background: #c8202c !important; border-color: #ff6b74 !important; color: #fff !important; }"; document.head.appendChild(css);
  const add = (parent, before) => { if (!parent) return; const b = document.createElement("button"); b.className = "recbtn"; b.textContent = "REC"; b.title = "record what happens (press again to save the recording)";
    b.addEventListener("click", e => { e.stopPropagation(); recPress(); }); parent.insertBefore(b, before || null); recButtons.push(b); };
  const side = $("mgside"); add(side, side && side.children[1]);   // (the button bar: after OPTIONS)
  { const box = document.createElement("div"); add(box);             // (the settings: a row of the OPTIONS screen's PLAY, js/hd/options.js)
    options.addButton("PLAY", { id: "optrec", name: "Rec", help: "record what happens: pressed, it marks where the part you mean begins; pressed again, the recording is saved", button: box.firstChild }); }
  setInterval(() => { if (rec.marking) recLabel(); }, 1000);
}
addEventListener("visibilitychange", () => { if (document.hidden && rec.marking) saveRecording(true); });
window.__stopRec = () => { if (rec.marking) saveRecording(true); };   // (the Android wrapper calls it when the app is sent away)
window.__golfRec = rec;                            // (tests)

// ---- the round ----
function newRound() {
  const w = new GolfMemory();
  const mode = ATTRACT ? (ATTRACT_TITLE ? "title" : "stroke") : $("mode").value;   // "title" (power-on), "stroke", "match:N" against preset golfer N, "link"
  const fromPowerOn = mode === "title" || mode === "link";
  let holes = 0, seed = 0, qCourse = 0, qHole = 0;
  if (rec.marking) saveRecording(true);           // (REC: a new start ends the recording: saved first)
  if (!fromPowerOn) {
    seed = crypto.getRandomValues(new Uint16Array(1))[0];   // (the menus' frames would have moved the seed)
    holes = mode.startsWith("match:") ? matchRoundSetup(w, { golfer: 8, opponent: +mode.slice(6), course: 1, seed })
      : strokeRoundSetup(w, { golfer: ATTRACT ? [8, 9, 4][seed % 3] : 8, course: 1, seed });
    const q = new URLSearchParams(location.search), qc = +q.get("course"), qh = +q.get("hole");
    if (!ATTRACT && mode === "stroke" && (qc || qh)) {   // (?course=1-4&hole=1-18: the Stroke start on another course or hole, as CourseSelect would)
      const c = qc >= 1 && qc <= 4 ? qc : 1; qCourse = c; qHole = qh >= 1 && qh <= 18 ? qh : 1; setCourseHole(w, c, c, qHole);
    }
    if (ATTRACT) {                                 // (ATTRACT: a random course and hole, the golfer the computer's)
      const course = 1 + (seed >> 2) % 4; setCourseHole(w, course, course, 1 + (seed >> 4) % 18); setPlayerControl(w, 0, 1);
    }
  }
  savedCopy = null;
  if (fromPowerOn) {                               // power-on reads the save RAM (GameMain's SaveLoad 02:41F6)
    $("save").textContent = loadSave(w) ? "save loaded" : "";
    savedCopy = w.sram.slice();
    saveCheckAt = 0;
  }
  initDisplay(w);
  driver = new SoundDriver(rom);
  apu = new SynthAPU(RATE);
  apu.writeAll(driver.init());                     // SoundInit 7E:4072 at power-on
  w.onSound = id => apu.writeAll(driver.playSound(id));   // rst $08 PlaySoundCmd 00:2BBB
  w.onMusicOption = flags => apu.writeAll(driver.applyMusicOption(flags));   // 00:2B98 (the Settings menu's Music)
  w.jingleActive = () => driver.ram[0xFFCD];        // hActiveJingle, for WaitJingleEnd 00:2C1F
  w.onEndJingle = () => apu.writeAll(driver.endJingle());
  if (!fromPowerOn) w.onSound(0x01);           // ModeSelectMain plays song 1 in the menus (32:508B); the round's own songs follow
  game = { w, g: null, frames: 0, done: null, error: null, mark: fromPowerOn ? "menus" : "", marks: [], shots: [], holes: 0 };
  const ev = (kind, name) => { if (kind === "M") { game.mark = name; game.marks.push([game.frames, name]); } };
  const opts = { ev, maxHoles: Infinity, onShot: s => game.shots.push(s.outcome), onHoleEnd: r => { game.holes = r.holes.length; },
    onRoundStart: () => { game.mark = "round"; game.rounds = (game.rounds || 0) + 1; $("message").textContent = ""; },
    onRoundEnd: r => { game.mark = "menus"; game.lastRound = r; roundMessage(r, false); } };
  if (mode === "link") {                           // two machines from power-on joined by the JS cable
    const w2 = new GolfMemory();
    initDisplay(w2);
    const cable = new NativeCable(w, w2);
    const input = k => () => { const b = held(); return game.testInput ? game.testInput[k] : active === k ? b : 0; };
    game.link = { w2, cable, frames2: 0 }; rec.stop();   // (REC: not the link mode)
    game.g = playFromPowerOn(w, input(0), opts);
    game.link.g2 = playFromPowerOn(w2, input(1), {});
    canvas2.hidden = false;
    showActive();
  } else {
    canvas2.hidden = true;
    // REC: every start kept (the save RAM the power-on reads, the seed, the course and hole) and each button read (js/rec.js)
    if (ATTRACT) rec.stop(); else rec.begin({ mode, seed, course: qCourse, hole: qHole, sram: fromPowerOn ? w.sram.slice() : null });
    const input = () => rec.read(held());
    game.g = mode === "title" ? playFromPowerOn(w, input, opts) : playRoundFrames(w, holes, input, opts);
  }
  window.__golf = game;
  $("message").textContent = "";
}
function showActive() {
  canvas.classList.toggle("active", game && !!game.link && active === 0);
  canvas2.classList.toggle("active", game && !!game.link && active === 1);
  if (game && game.link) $("message").textContent = `Link: the keys play the ${active ? "right" : "left"} Game Boy (Tab switches)`;
}
// one frame of a machine: its generator to its next frame (a cable's "code" / "sync" yields are parts of a frame)
function nextFrame(g) {
  for (;;) { const r = g.next(); if (r.done || (r.value !== "code" && r.value !== "sync")) return r; }
}
function step() {                                  // one frame of the game
  if (game.onFrame) game.onFrame();               // (a test's buttons for the frame)
  const r = game.link ? nextFrame(game.g) : game.g.next();
  if (game.link && !game.link.done) {              // (the right machine's frame after the left one's)
    const r2 = nextFrame(game.link.g2);
    game.link.frames2++;
    if (r2.done) game.link.done = true;
  }
  game.frames++;
  rec.frame(game.w);                               // (REC)
  g3d.afterStep(game);                             // (3D LAYERS: follows the frame; reads only)
  soundFrame(game.w);
  if (!ATTRACT) checkSave(game.w);
  if (r.done) { game.done = r.value; roundMessage(r.value, true); }
}
function roundMessage(r, button) {               // (from power-on the game goes back to its menus after a round)
  const total = r.holes.reduce((s, h) => s + h.strokes, 0);
  const w0 = game.w.wram[0];
  const text = w0[0x834] === 2 ? `Match over: ${["", "you won", "you lost", "halved"][w0[0x96C]] || "decided"} after ${r.holes.length} holes.`
    : `Round over: ${total} strokes over ${r.holes.length} holes.`;
  if (button) showMessage(text); else $("message").textContent = text;
}
function showMessage(text) {
  const m = $("message");
  m.textContent = text;
  const b = document.createElement("button");
  b.textContent = $("mode").value === "title" || $("mode").value === "link" ? "Power on again" : "New round"; b.onclick = () => { newRound(); canvas.focus(); };
  m.appendChild(b);
}
$("mode").addEventListener("change", () => { if (rom) { newRound(); canvas.focus(); } });
function draw() {
  const w = game.w;
  rasterize({ vram: w.vram, oam: w.oam, bgPal: w.bgPal, objPal: w.objPal, ...w.lcd }, rgb5, rgba);
  if (!hdPage.present(w, game.frames, image)) ctx.putImageData(image, 0, 0);   // (HD: the picture options)
  g3d.present(game, rgba);                         // (3D LAYERS: the 3D picture over the screen, when on)
  aimPower.present(game, image);                   // (HD: the aim and swing helpers over it; they only read the game)
  if (game.link) {
    const v = game.link.w2;
    rasterize({ vram: v.vram, oam: v.oam, bgPal: v.bgPal, objPal: v.objPal, ...v.lcd }, rgb5, rgba2);
    ctx2.putImageData(image2, 0, 0);
  }
  const w0 = w.wram[0];
  if (w0[0x837]) $("score").textContent = `hole ${w0[0x837]} · stroke ${w0[playerField(w, 0x20)]}`;
}
function loop(now) {
  requestAnimationFrame(loop);
  if (ATTRACT) titleMusicFrames();                 // (ATTRACT music: the picker's golf half chosen)
  if (ATTRACT && !ATTRACT_TITLE && game && (game.done || game.error)) newRound();   // (ATTRACT play: never stopped)
  if (!game || game.done || game.error) { last = 0; return; }
  if (!last) last = now;
  acc += Math.min(now - last, 100); last = now;
  held();                                          // (P toggles the pause even while paused)
  if (paused) { acc = 0; $("status").textContent = "paused (P)"; return; }
  if (ATTRACT_TITLE && !atTitle()) {               // (ATTRACT title: on to the title unseen, a few hundred frames a picture; "away" meanwhile)
    if (attractShown) { attractShown = false; tell("away"); }
    try { for (let i = 0; i < 400 && !atTitle() && !game.done; i++) step(); } catch (e) { game.error = e.message; console.warn(e); }
    acc = 0; return;
  }
  if (ATTRACT && !ATTRACT_TITLE && game.holes >= 1) { newRound(); return; }   // (ATTRACT play: the hole is over, another)
  if (ATTRACT && !attractShown && (ATTRACT_TITLE || game.frames > 20)) { attractShown = true; tell("ready"); }
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
  if (tm.on) titleMusic(true);                   // (ATTRACT music asked for before the ROM was here)
  newRound();
  $("loader").hidden = true;
  canvas.focus();
}
// the Android apps (this project's android/, and MTenn3D's game picker): remember the picked ROM there, so the next launch starts at
// once (as js/main.js does)
const app = window.MGolfApp;
if (/MarioGolfWrapper/.test(navigator.userAgent)) document.body.classList.add("app");
function keepRom(buffer) {
  if (!app) return;
  const b = new Uint8Array(buffer); let bin = "";
  for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  try { app.saveRom(btoa(bin)); } catch (e) { console.warn("rom", e); }
}
$("file").addEventListener("change", e => { const f = e.target.files[0]; if (f) f.arrayBuffer().then(buf => { keepRom(buf); start(buf); }); });
fetch("../rom/mario_golf.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject())
  .then(start).catch(() => { if (ATTRACT) { tell("norom"); return; } $("loader").hidden = false; $("status").textContent = "no ROM loaded"; });
requestAnimationFrame(loop);

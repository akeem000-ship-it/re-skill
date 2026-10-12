// Full game: runs the ROM on the JS core (web/js/gb) at a fixed 60 Hz, draws the framebuffer, feeds
// the APU samples to an AudioWorklet, maps keyboard/touch to the joypad and keeps the cartridge
// save (SRAM) in localStorage.
import { GBC } from "./gb/gbc.js";
import { Rom, sha1Hex, EXPECTED_SHA1 } from "./rom.js";
import { pollGamepad } from "./gamepad.js";
import { Voxel3D, PRESETS, PRESET_ORDER } from "./voxel.js";
import { loadSnapshot } from "./gb/snapshot.js";
import { saveState, loadState } from "./gb/state.js";
import { composeWide, WIDE_W, WIDE_H } from "./wide.js";
import { mountStick } from "./stick.js";

const $ = id => document.getElementById(id);
const cv = $("screen"), g = cv.getContext("2d");
const img = g.createImageData(160, 144);
let voxel = null, view3d = false;
let gb = null, keys = {}, paused = false, turbo = false, romHash = "";
const SAVE_KEY = () => "mt-sram-" + romHash.slice(0, 12);
const q = new URLSearchParams(location.search);
const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };

// ---- audio: the worklet plays whatever sample chunks the main thread posts ----
let actx = null, anode = null, audioReady = false;
async function initAudio() {
  if (actx) return;
  actx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
  const src = `class P extends AudioWorkletProcessor {
    constructor() { super(); this.q = []; this.cur = null; this.pos = 0; this.port.onmessage = e => { this.q.push(e.data); if (this.q.length > 12) this.q.shift(); }; }
    process(inputs, outputs) { const L = outputs[0][0], R = outputs[0][1] || L; for (let i = 0; i < L.length; i++) {
      if (!this.cur || this.pos >= this.cur.length) { this.cur = this.q.shift() || null; this.pos = 0; }
      if (this.cur) { L[i] = this.cur[this.pos]; R[i] = this.cur[this.pos + 1]; this.pos += 2; } else { L[i] = R[i] = 0; } }
      return true; } }
    registerProcessor("mt-pcm", P);`;
  await actx.audioWorklet.addModule(URL.createObjectURL(new Blob([src], { type: "application/javascript" })));
  anode = new AudioWorkletNode(actx, "mt-pcm", { outputChannelCount: [2] }); anode.connect(actx.destination);
  audioReady = true;
}
function unlockAudio() { initAudio().then(() => actx.state !== "running" && actx.resume()).catch(e => console.warn("audio", e)); }
const abuf = new Float32Array(2 * 4096);

// ---- save persistence ----
function loadSave() {
  try { const s = localStorage.getItem(SAVE_KEY()); if (s) { const b = Uint8Array.from(atob(s), c => c.charCodeAt(0)); gb.mem.sram.set(b.subarray(0, gb.mem.sram.length)); gb.mem.ramEnable = false; $("savestatus").textContent = "save loaded"; } } catch (e) { console.warn("save", e); }
}
function bytesToBinary(b) { let s = ""; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; }   // no giant spread
let saveTimer = 0, savePending = false;
function writeSave() {
  savePending = false;
  try { localStorage.setItem(SAVE_KEY(), btoa(bytesToBinary(gb.mem.sram))); $("savestatus").textContent = "saved " + new Date().toLocaleTimeString(); } catch (e) { console.warn("save", e); }
}
function maybeSave() {                     // the game writes its save in bursts: store it 0.5 s after the last write
  if (!gb.mem.sramDirty) return;
  gb.mem.sramDirty = false; savePending = true;
  clearTimeout(saveTimer); saveTimer = setTimeout(writeSave, 500);
}
// the debounce timer does not run once the page is hidden (Android pauses the WebView's timers when the app goes to
// the background and may then kill it), so a pending save is written immediately when the page is hidden
function flushSave() {
  if (!gb) return;
  if (gb.mem.sramDirty) { gb.mem.sramDirty = false; savePending = true; }
  if (savePending) { clearTimeout(saveTimer); writeSave(); }
}
addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
addEventListener("pagehide", flushSave);
window.__flushSave = flushSave;            // also called by the Android wrapper from onPause

// ---- main loop ----
const STEP = 1000 / 60; let acc = 0, last = 0, fps = { n: 0, t: 0 };
function input() {
  const k = keys;
  return { a: k.KeyZ || k.KeyA, b: k.KeyX || k.KeyS, start: k.Enter, select: k.ShiftRight || k.Backspace || k.KeyQ,
           right: k.ArrowRight, left: k.ArrowLeft, up: k.ArrowUp, down: k.ArrowDown };
}
function frame() {
  pollGamepad(keys); gb.setInput(input()); gb.runFrame();
  if (audioReady && anode) { const n = gb.apu.drain(abuf); if (n) anode.port.postMessage(abuf.slice(0, n)); } else gb.apu.outPos = 0;
}
let drawnFrame = -1;
const wideImg = g.createImageData(WIDE_W, WIDE_H), wideBuf = new Uint32Array(wideImg.data.buffer), wideIdx = new Uint8Array(WIDE_W * WIDE_H);
const onCourt = () => gb.mem.wram[0][0x32E] <= 15;   // wCurMapID: courts (the map is wider than the screen)
let insetAt = 0;
function draw(alpha = 1) {                 // alpha: fraction of the next game frame already elapsed (3D interpolation)
  const f = gb.ppu.frame;
  if (view3d && voxel) {
    if (gb.frames >= insetAt) {               // the touch HUD bar covers the top of the view: overlays go below it
      insetAt = gb.frames + 30; const hud = $("hud"), top = $("gl").getBoundingClientRect().top;
      const touch = document.body.classList.contains("touch"), glr = $("gl").getBoundingClientRect();
      voxel.topInset = touch && !hud.hidden ? Math.max(0, hud.getBoundingClientRect().bottom - top) : 0;
      let ctl = 0;                            // height of the touch controls above the bottom of the view
      if (touch && !document.body.classList.contains("gamepad")) for (const sel of [".btns .k:not(.start)", "#stickzone .stick-base", ".dpad"]) { const e = document.querySelector(sel); if (e && e.offsetParent !== null) ctl = Math.max(ctl, glr.bottom - e.getBoundingClientRect().top); }
      voxel.bottomInset = Math.min(glr.height * 0.4, Math.max(0, ctl));
    }
    try { voxel.render(f, alpha); return; } catch (e) { console.warn("3d", e); setView3d(false); }
  }
  if (drawnFrame === gb.frames) return;      // 2D: nothing new to show between game frames
  drawnFrame = gb.frames;
  if (aspect === "4:3" && onCourt()) {       // 4:3 on a court: 192 px wide composite with the real map on both sides
    if (cv.width !== WIDE_W) { cv.width = WIDE_W; cv.height = WIDE_H; }
    composeWide(gb, wideBuf, wideIdx); g.putImageData(wideImg, 0, 0); return;
  }
  if (cv.width !== 160) { cv.width = 160; cv.height = 144; }
  new Uint32Array(img.data.buffer).set(f); g.putImageData(img, 0, 0);
}
// ---- screen shape: Fill (3D fills the screen, 2D keeps 10:9), 4:3 (3D letterboxed to 4:3; 2D courts widened
// to 192 px, elsewhere pillarboxed), 10:9 (both as the Game Boy) ----
const ASPECTS = ["fill", "4:3", "10:9"];
let aspect = q.get("aspect") || stored("mt-aspect") || "fill"; if (!ASPECTS.includes(aspect)) aspect = "fill";
function applyAspect() {
  $("aspect").textContent = "VIEW: " + (aspect === "fill" ? "Fill" : aspect);
  const touch = document.body.classList.contains("touch"), gl = $("gl");
  const box = r => {                          // CSS size of an r-aspect box fitted to the viewport (touch) or 480 px wide (desktop)
    if (!touch) return { w: 480, h: 480 / r };
    const vw = innerWidth, vh = innerHeight; return vw / vh > r ? { w: vh * r, h: vh } : { w: vw, h: vw / r };
  };
  const set = (el, b) => { if (!b) { el.style.cssText = ""; return; } el.style.width = b.w + "px"; el.style.height = b.h + "px"; if (touch) { el.style.left = (innerWidth - b.w) / 2 + "px"; el.style.top = (innerHeight - b.h) / 2 + "px"; el.style.transform = "none"; el.style.inset = "auto"; el.style.position = "fixed"; } };
  if (aspect === "fill") { set(gl, null); set(cv, null); }
  else { const r = aspect === "4:3" ? 4 / 3 : 160 / 144; set(gl, box(r)); set(cv, box(r)); }
  try { localStorage.setItem("mt-aspect", aspect); } catch (e) { /* private mode */ }
}
addEventListener("resize", () => applyAspect());
let preset = q.get("cam") || stored("mt-cam") || "low"; if (!PRESETS[preset]) preset = "low";
function setView3d(on, vox = false) {
  view3d = on; $("view3d").classList.toggle("on", on); $("view3d").textContent = on ? (vox ? "VOX" : "3D") : "3D";
  if (on && !voxel) { try { voxel = new Voxel3D($("gl"), gb, new Rom(gb.mem.rom)); voxel.freeCam = q.has("freecam"); setPreset(preset); } catch (e) { console.warn("3d", e); view3d = false; $("view3d").classList.remove("on"); return; } }
  if (voxel) voxel.voxelSprites = on && vox;
  $("gl").hidden = !view3d; cv.hidden = view3d; $("cam").hidden = !view3d;
  try { localStorage.setItem("mt-3d", on ? (vox ? "vox" : "3d") : "off"); } catch (e) { /* private mode */ }
}
function setPreset(name) {                  // court camera preset (CAM button cycles PRESET_ORDER)
  if (!PRESETS[name]) return; preset = name; if (voxel) voxel.setPreset(name); $("cam").textContent = "CAM: " + PRESETS[name].label;
  try { localStorage.setItem("mt-cam", name); } catch (e) { /* private mode */ }
}
function loop(now) {
  if (gb && !paused) {
    if (!last) last = now;
    acc = Math.min(acc + (now - last), STEP * 4); last = now;
    const per = turbo ? 4 : 1;
    while (acc >= STEP) { for (let i = 0; i < per; i++) frame(); acc -= STEP; fps.n++; }
    draw(acc / STEP); maybeSave();
    if (now - fps.t >= 1000) { $("fps").textContent = fps.n + " fps" + (turbo ? " (turbo)" : ""); fps.n = 0; fps.t = now; }
  } else last = now;
  requestAnimationFrame(loop);
}

async function loadRom(buf) {
  const bytes = new Uint8Array(buf);
  romHash = (await sha1Hex(bytes)) || "";
  $("romstatus").textContent = romHash === "" ? "ROM loaded" : romHash === EXPECTED_SHA1 ? "ROM verified (Mario Tennis USA)" : "Warning: unexpected ROM SHA-1 " + romHash;
  gb = new GBC(bytes, { sampleRate: 44100, audio: true }); drawnFrame = -1;
  if (voxel) voxel.attach(gb, new Rom(gb.mem.rom));      // a ROM loaded after the 3D view was created
  // the statically translated game (tools/recomp.py -> gen/game.js) runs the traced code as native
  // functions; without it everything is interpreted (same results, see web/tests/recomp_vs_interp.mjs)
  try { const mod = await import("../gen/game.js"); const T = {}; mod.install(T); gb.installRecomp(T); if (mod.HRAM_SIG) gb.exec.setHramSig(mod.HRAM_SIG); $("romstatus").textContent += " · recompiled code"; } catch (e) { $("romstatus").textContent += " · interpreter"; }
  loadSave();
  $("loader").hidden = true; $("hud").hidden = false; cv.focus();
  const m3 = q.has("vox") ? "vox" : q.has("3d") ? "3d" : stored("mt-3d");   // remembered view mode
  if (m3 === "3d" || m3 === "vox") setView3d(true, m3 === "vox");
}

// ---- input wiring ----
addEventListener("keydown", e => { keys[e.code] = true; if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault(); if (e.code === "Space") turbo = true; if (e.code === "KeyP") paused = !paused; unlockAudio(); });
addEventListener("keyup", e => { keys[e.code] = false; if (e.code === "Space") turbo = false; });
addEventListener("pointerdown", unlockAudio);
for (const el of document.querySelectorAll("#pad [data-key]")) {
  const code = el.dataset.key;
  const down = e => { e.preventDefault(); el.setPointerCapture(e.pointerId); keys[code] = true; el.classList.add("on"); unlockAudio(); };
  const up = e => { e.preventDefault(); keys[code] = false; el.classList.remove("on"); };
  el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  el.addEventListener("contextmenu", e => e.preventDefault());
}
if (navigator.userAgent.includes("MarioTennisWrapper") || location.search.includes("touch")) document.body.classList.add("touch");
$("file").addEventListener("change", async e => { const f = e.target.files[0]; if (f) loadRom(await f.arrayBuffer()); });
$("reset").addEventListener("click", () => { if (gb) { gb.reset(); } });
$("view3d").addEventListener("pointerdown", () => { if (!gb) return; const vox = voxel && voxel.voxelSprites; setView3d(!view3d || !vox, view3d && !vox); });   // off -> cards -> voxels -> off
$("cam").addEventListener("pointerdown", () => setPreset(PRESET_ORDER[(PRESET_ORDER.indexOf(preset) + 1) % PRESET_ORDER.length]));
$("aspect").addEventListener("pointerdown", () => { aspect = ASPECTS[(ASPECTS.indexOf(aspect) + 1) % ASPECTS.length]; drawnFrame = -1; applyAspect(); });
applyAspect();
// ---- touch movement: analog stick (default) or the d-pad ----
const stick = mountStick($("stickzone"), keys);
let padMode = q.get("pad") || stored("mt-pad") || "stick"; if (padMode !== "dpad") padMode = "stick";
function applyPadMode() {
  const on = padMode === "stick"; document.body.classList.toggle("stick", on); stick.setEnabled(on);
  $("padmode").textContent = on ? "STICK" : "D-PAD";
  try { localStorage.setItem("mt-pad", padMode); } catch (e) { /* private mode */ }
}
$("padmode").addEventListener("pointerdown", () => { padMode = padMode === "stick" ? "dpad" : "stick"; applyPadMode(); });
applyPadMode();
$("turbo").addEventListener("pointerdown", () => { turbo = !turbo; $("turbo").classList.toggle("on", turbo); });
fetch("../rom/mario_tennis.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(loadRom).catch(() => {});
window.__gb = { get gb() { return gb; }, keys, aspect(a) { aspect = a; drawnFrame = -1; applyAspect(); }, pause(p = true) { paused = p; }, step(n = 1) { for (let i = 0; i < n; i++) frame(); draw(1); }, frameHash() { return gb.frameHash(); }, view3d: setView3d, preset: setPreset, get voxel() { return voxel; }, loadSnapshot(s) { loadSnapshot(gb, s); }, saveState() { return saveState(gb); }, loadState(s) { loadState(gb, s); drawnFrame = -1; } };
requestAnimationFrame(loop);

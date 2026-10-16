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
import { Recorder, maskOf, packRecording, bytesToBase64 } from "./recorder.js";
import { HDText, FONTS, FONT_ORDER, HD } from "./hdtext.js";

const $ = id => document.getElementById(id);
const cv = $("screen"), g = cv.getContext("2d");
const img = g.createImageData(160, 144);
let voxel = null, view3d = false, hd = null;
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
const rec = new Recorder();
// with the JS port the game's state is partly JavaScript (its coroutines), which a machine state can't hold: a
// recording made mid-game could not be replayed. So the port keeps a log of every frame from power-on, and REC
// saves that log with the frame REC was pressed at (meta.from); a replay runs it from power-on (web/tests).
const session = new Recorder(); let portRecFrom = -1;
const recording = () => rec.on || portRecFrom >= 0;
function frame() {
  pollGamepad(keys); const inp = input(), mask = maskOf(inp); gb.setInput(inp);
  if (port) portFrame(); else gb.runFrame();
  if (view3d && voxel && voxel.mode === "3d") voxel.tick();
  rec.frame(gb, mask); session.frame(gb, mask);
  if (audioReady && anode) { const n = gb.apu.drain(abuf); if (n) anode.port.postMessage(abuf.slice(0, n)); } else gb.apu.outPos = 0;
}
let drawnFrame = -1;
const wideImg = g.createImageData(WIDE_W, WIDE_H), wideBuf = new Uint32Array(wideImg.data.buffer), wideIdx = new Uint8Array(WIDE_W * WIDE_H);
const onCourt = () => gb.mem.wram[0][0x32E] <= 15;   // wCurMapID: courts (the map is wider than the screen)
let insetAt = 0;
function draw(alpha = 1) {                 // alpha: fraction of the next game frame already elapsed (3D interpolation)
  const f = gb.ppu.frame;
  if (hd && hd.update()) drawnFrame = -1;    // the text on screen (HD font) changed
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
    composeWide(gb, wideBuf, wideIdx); present(wideImg, WIDE_W, WIDE_H, (WIDE_W - 160) / 2); return;
  }
  new Uint32Array(img.data.buffer).set(f); present(img, 160, 144, 0);
}
// the frame on the 2D canvas; with an HD font, at HD x the size (pixels kept sharp) with the text drawn over it
const small = document.createElement("canvas"), sg = small.getContext("2d");
function present(image, w, h, padX) {
  if (!hd || !hd.active) { if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } g.putImageData(image, 0, 0); return; }
  if (small.width !== w || small.height !== h) { small.width = w; small.height = h; }
  sg.putImageData(image, 0, 0);
  if (cv.width !== w * HD || cv.height !== h * HD) { cv.width = w * HD; cv.height = h * HD; }
  g.imageSmoothingEnabled = false; g.drawImage(small, 0, 0, w * HD, h * HD);
  g.imageSmoothingEnabled = true; g.drawImage(hd.canvas.bg, padX * HD, 0); g.drawImage(hd.canvas.win, padX * HD, 0);
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
  if (on && !voxel) { try { voxel = new Voxel3D($("gl"), gb, new Rom(gb.mem.rom)); voxel.hdText = hd; voxel.freeCam = q.has("freecam"); setPreset(preset); } catch (e) { console.warn("3d", e); view3d = false; $("view3d").classList.remove("on"); return; } }
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

// ?port: run the game through the readable JS port (web/js/port) instead of the core's CPU: ported routines run as
// JavaScript, the rest as the ROM's code (the hybrid). ?port uses the finished, verified modules; ?port=all adds
// every module in progress; ?port=a/b,c/d picks modules (paths under web/js/port).
let port = null, portError = null;
// the mode: the page's selector, or #port / #portall in the link, or ?port in the URL
const portMode = () => { const h = location.hash.slice(1), sel = $("engine") && $("engine").value; return h === "port" || h === "portall" ? h : q.has("port") ? "port" : sel || "rom"; };
if ($("engine")) {
  const saved = stored("mt-engine");
  if (location.hash === "#port" || location.hash === "#portall") $("engine").value = location.hash.slice(1);
  else if (saved === "rom" || saved === "port" || saved === "portall") $("engine").value = saved;
  $("engine").addEventListener("change", () => { try { localStorage.setItem("mt-engine", $("engine").value); } catch (e) { /* private mode */ } });
}
const PORT_VERIFIED = ["home/index", "audio/index", "save/index", "cutscenes/index", "story/index", "minigames/index",
  "text/index", "menus/common/cursorbox", "menus/common/cursors", "menus/common/menu_lib", "menus/common/prompts", "menus/common/tilemaps", "menus/common/widgets", "menus/main_menu/boot", "menus/main_menu/erase", "menus/main_menu/main_menu", "menus/main_menu/match_format", "menus/main_menu/n64", "menus/main_menu/n64data", "menus/main_menu/n64transfer", "menus/main_menu/saved",
  "menus/char_select/index", "menus/char_data/index",
  "menus/pause/index", "menus/briefing/index", "menus/court_select/index", "menus/scenes/index",
  "match/index", "menus/exp/index", "menus/results/index", "menus/ranking/index"];
async function makePort(bytes) {
  const { GamePort } = await import("./port/port.js"), { entry } = await import("./port/entry.js");
  const want = portMode() === "portall" ? "all" : q.get("port");
  let hooks;
  if (want === "all") hooks = (await import("./port/program.js")).program.hooks;
  else {
    hooks = [];
    for (const m of want ? want.split(",") : PORT_VERIFIED) hooks.push(...(await import(`./port/${m}.js`)).HOOKS);
  }
  return new GamePort(bytes, { ...entry, hooks }, { audio: true, sampleRate: 44100 });
}
function portFrame() {
  if (portError) return;
  try { port.frame(); }
  catch (e) { portError = e; $("romstatus").textContent = "JS port stopped: " + e.message; console.error(e); }
}
async function loadRom(buf) {
  const bytes = new Uint8Array(buf);
  romHash = (await sha1Hex(bytes)) || "";
  $("romstatus").textContent = romHash === "" ? "ROM loaded" : romHash === EXPECTED_SHA1 ? "ROM verified (Mario Tennis USA)" : "Warning: unexpected ROM SHA-1 " + romHash;
  if (portMode() !== "rom") { port = await makePort(bytes); gb = port.gb; portError = null; }
  else gb = new GBC(bytes, { sampleRate: 44100, audio: true });
  drawnFrame = -1;
  hd = new HDText(gb); hd.onload = () => { drawnFrame = -1; }; hd.setFont(font);
  if (voxel) { voxel.attach(gb, new Rom(gb.mem.rom)); voxel.hdText = hd; }      // a ROM loaded after the 3D view was created
  // the statically translated game (tools/recomp.py -> gen/game.js) runs the traced code as native
  // functions; without it everything is interpreted (same results, see web/tests/recomp_vs_interp.mjs)
  if (port) $("romstatus").textContent += ` · JS port (${port.hooks.size} routines ported, the rest ROM code)`;
  else try { const mod = await import("../gen/game.js"); const T = {}; mod.install(T); gb.installRecomp(T); if (mod.HRAM_SIG) gb.exec.setHramSig(mod.HRAM_SIG); $("romstatus").textContent += " · recompiled code"; } catch (e) { $("romstatus").textContent += " · interpreter"; }
  loadSave();
  if (port) session.start(gb, recMeta());
  $("loader").hidden = true; $("hud").hidden = false; cv.focus();
  const m3 = q.has("vox") ? "vox" : q.has("3d") ? "3d" : q.has("2d") ? "off" : (stored("mt-3d") || "vox");   // remembered view mode; VOX (voxel sprites) by default
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
// the ROM the player loaded, kept in this browser's IndexedDB so the next visit can start without picking it again
const romStore = (mode, fn) => new Promise((ok, fail) => {
  try {
    const open = indexedDB.open("mt-rom", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("rom");
    open.onerror = () => fail(open.error);
    open.onsuccess = () => { const tx = open.result.transaction("rom", mode), r = fn(tx.objectStore("rom")); tx.oncomplete = () => ok(r && r.result); tx.onerror = () => fail(tx.error); };
  } catch (e) { fail(e); }
});
$("file").addEventListener("change", async e => {
  const f = e.target.files[0]; if (!f) return;
  const buf = await f.arrayBuffer();
  romStore("readwrite", s => s.put(new Uint8Array(buf), "rom")).catch(() => {});
  loadRom(buf);
});
romStore("readonly", s => s.get("rom")).then(b => { if (b && !gb) $("remembered").hidden = false; }).catch(() => {});
$("startsaved").addEventListener("click", () => romStore("readonly", s => s.get("rom")).then(b => b && loadRom(b.buffer.slice(0))).catch(e => { $("romstatus").textContent = "could not read the saved ROM: " + e; }));
$("forgetrom").addEventListener("click", () => romStore("readwrite", s => s.delete("rom")).then(() => { $("remembered").hidden = true; }).catch(() => {}));
$("reset").addEventListener("click", () => { if (port) { location.reload(); return; } if (gb) { gb.reset(); rec.event("reset"); } });
// ---- session recording: REC starts (the machine state now + every frame's buttons), REC again stops and saves
// a .mtrec file (Android: Downloads/MTenn3D and the share sheet; browser: a download). Hiding the app stops and saves.
const recMeta = () => ({ view: view3d ? (voxel && voxel.voxelSprites ? "vox" : "3d") : "2d", engine: portMode(), font, ua: navigator.userAgent,
  port: port ? (portMode() === "portall" ? "all" : (q.get("port") || PORT_VERIFIED.join(","))) : undefined });
async function saveRecording(now = false) {     // now: the app is being hidden; skip compression so it finishes at once
  if (!recording()) return;
  let obj;
  if (portRecFrom >= 0) { obj = session.snapshot(gb, romHash); obj.meta = { ...recMeta(), from: portRecFrom }; portRecFrom = -1; }
  else obj = rec.stop(gb, romHash);
  const { bytes, gz } = now ? { bytes: new TextEncoder().encode(JSON.stringify(obj)), gz: false } : await packRecording(obj);
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  const name = `mtenn3d-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.mtrec${gz ? "" : ".json"}`;
  $("rec").classList.remove("on"); $("rec").textContent = "REC";
  if (window.MTennApp && window.MTennApp.saveFile) { window.MTennApp.saveFile(name, bytesToBase64(bytes)); }
  else { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  $("savestatus").textContent = `recording saved: ${name} (${Math.round(obj.frames / 60)} s)`;
}
$("rec").addEventListener("pointerdown", () => {
  if (!gb) return;
  if (recording()) { saveRecording(); return; }
  if (port) portRecFrom = session.n; else rec.start(gb, recMeta());
  $("rec").classList.add("on");
});
setInterval(() => { if (!recording()) return; const t = rec.on ? rec.seconds : (session.n - portRecFrom) / 60; $("rec").textContent = "REC " + Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0"); }, 1000);
addEventListener("visibilitychange", () => { if (document.hidden && recording()) saveRecording(true); });
window.__stopRec = () => { if (recording()) saveRecording(true); };   // called by the Android wrapper from onPause
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
// ---- text font: the game's own, or an HD font redrawn over the game's text (web/js/hdtext.js) ----
let font = q.get("font") || stored("mt-font") || "game"; if (!FONTS[font]) font = "game";
function applyFont() {
  $("fontbtn").textContent = "FONT: " + FONTS[font].label;
  if (hd) hd.setFont(font); drawnFrame = -1;
  try { localStorage.setItem("mt-font", font); } catch (e) { /* private mode */ }
}
$("fontbtn").addEventListener("pointerdown", () => { font = FONT_ORDER[(FONT_ORDER.indexOf(font) + 1) % FONT_ORDER.length]; applyFont(); });
applyFont();
$("turbo").addEventListener("pointerdown", () => { turbo = !turbo; $("turbo").classList.toggle("on", turbo); });
// what runs the game, switchable in play (the app loads the ROM before the loader's selector can be used):
// remembered, then the page reloads
const ENGINE_LABEL = { rom: "CODE: ROM", port: "CODE: PORT", portall: "CODE: PORT+" };
$("engbtn").textContent = ENGINE_LABEL[portMode()] || "CODE: ROM";
$("engbtn").addEventListener("pointerdown", () => {
  const order = ["rom", "port", "portall"], next = order[(order.indexOf(portMode()) + 1) % order.length];
  try { localStorage.setItem("mt-engine", next); } catch (e) { /* private mode */ }
  if ($("engine")) $("engine").value = next;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  location.reload();
});
fetch("../rom/mario_tennis.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(loadRom).catch(() => {});
window.__gb = { get gb() { return gb; }, keys, rec, aspect(a) { aspect = a; drawnFrame = -1; applyAspect(); }, pause(p = true) { paused = p; }, step(n = 1) { for (let i = 0; i < n; i++) frame(); draw(1); }, frameHash() { return gb.frameHash(); }, view3d: setView3d, preset: setPreset, get voxel() { return voxel; }, loadSnapshot(s) { loadSnapshot(gb, s); }, saveState() { return saveState(gb); }, loadState(s) { loadState(gb, s); drawnFrame = -1; } };
requestAnimationFrame(loop);

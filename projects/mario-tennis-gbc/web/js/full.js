// Full game: runs the ROM on the JS core (web/js/gb) at a fixed 60 Hz, draws the framebuffer, feeds
// the APU samples to an AudioWorklet, maps keyboard/touch to the joypad and keeps the cartridge
// save (SRAM) in localStorage.
import { GBC } from "./gb/gbc.js";
import { Rom, sha1Hex, EXPECTED_SHA1 } from "./rom.js";
import { pollGamepad } from "./gamepad.js";
import { Voxel3D, PRESETS, PRESET_ORDER } from "./voxel.js";
import { attachStadium } from "./stadium3d.js";   // STADIUM: Classic / 3D
import { attachCrowdSound } from "./crowdsound.js";   // CROWD SOUND: on / off (synthesized, next to the game audio)
import { attachLighting } from "./lighting.js";
import { attachLightPanel } from "./lightpanel.js";   // LIGHT settings panel   // LIGHT: Off / Day / Auto
import { attachVoxStyle } from "./voxround.js";   // VOX: Blocky / Rounded
import { attachBallFX } from "./ballfx.js";
import { Tour, addTourButtons } from "./tour.js";
import { Modes, addModeButtons } from "./modes.js";
import { VenueTour, addVenueTourButton } from "./venuetour.js";   // VENUE TOUR: fly round the stadiums from anywhere
import { attachIntro } from "./intro.js";
import { attachMenuWheel } from "./menuwheel.js";
import { addCourtButton } from "./courtconcepts.js";
import { addFarEndButton } from "./farwalls.js";
import { attachMatchFx } from "./matchfx.js";
import { attachFieldLife } from "./fieldlife.js";
import { attachWeather } from "./weather.js";   // WEATHER: rain or a sunset over a match (the look only)
import { attachCloseCall } from "./closecall.js";   // CALLS: the TV line-call review after a close bounce
import { attachGround } from "./ground.js";     // GROUND: grass, leafy trees, brick path edging and pebbles on the overworld
import { attachPhone } from "./phone.js";
import { InstantReplay } from "./replay.js";   // INSTANT REPLAY: the last long rally again under a TV camera   // GAME: vibrate, screenshot, quick save / load, battery saver, what's new   // FIELD LIFE: birds, cloud shadows, fountain glints in the overworld   // MATCH FX: set / match point hush, rally ooh, changeover sweep, the winner's celebration
import { organizeHud } from "./hudmenu.js";      // the button bar in categories (VIEW / STADIUM / LOOK / GAME)         // INTRO: walk-out before each match (3D stadium)       // BALL FX: on / off (3D / VOX court)
import { loadSnapshot } from "./gb/snapshot.js";
import { saveState, loadState, snapshot, restore } from "./gb/state.js";
import { composeWide, WIDE_W, WIDE_H } from "./wide.js";
import { mountStick, stickDir, stickFrame, addStickFeelButton } from "./stick.js";
import { portraitArea, attachPortrait } from "./portrait.js";   // touch screens held upright: the game on top, a control deck below
import { Recorder, maskOf, packRecording, bytesToBase64, stateOf } from "./recorder.js";
import { HDText, FONTS, FONT_ORDER, HD } from "./hdtext.js";
import { mountCreator } from "./look/creator.js";
import { lookEvent } from "./look/index.js";

const $ = id => document.getElementById(id);
const cv = $("screen"), g = cv.getContext("2d");
const img = g.createImageData(160, 144);
let voxel = null, view3d = false, hd = null;
let gb = null, keys = {}, paused = false, turbo = false, romHash = "", phone = null, replay = null, menuWheel = null;   // phone: phone.js (GAME menu conveniences)
const deck = attachPortrait(() => gb);
const SAVE_KEY = () => "mt-sram-" + romHash.slice(0, 12);
const q = new URLSearchParams(location.search);
const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
// once (0.35.18): characters back to the game's own sprites as blocky voxels (SPRITES: Game, 3D view VOX, VOX: Blocky); the buttons still
// change them afterwards
try { if (!localStorage.getItem("mt-reset-0.35.18")) { localStorage.setItem("mt-sprites", "game"); localStorage.setItem("mt-3d", "vox"); localStorage.setItem("mt-voxstyle2", "blocky"); localStorage.setItem("mt-reset-0.35.18", "1"); } } catch (e) { /* private mode */ }

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
function writeSave() {                     // (with run-ahead on: the real machine's save, not the look-ahead frame's)
  savePending = false;
  try { localStorage.setItem(SAVE_KEY(), btoa(bytesToBinary(raSnap ? raSnap.mem.sram : gb.mem.sram))); $("savestatus").textContent = "saved " + new Date().toLocaleTimeString(); } catch (e) { console.warn("save", e); }
}
function maybeSave() {                     // the game writes its save in bursts: store it 0.5 s after the last write
  if (!gb.mem.sramDirty) return;
  gb.mem.sramDirty = false; savePending = true;
  clearTimeout(saveTimer); saveTimer = setTimeout(writeSave, 500);
}
// the debounce timer does not run once the page is hidden (Android pauses the WebView's timers when the app goes to
// the background and may then kill it), so a pending save is written immediately when the page is hidden
function flushSave() {
  if (!gb) return; settle();
  if (gb.mem.sramDirty) { gb.mem.sramDirty = false; savePending = true; }
  if (savePending) { clearTimeout(saveTimer); writeSave(); }
}
addEventListener("visibilitychange", () => { if (document.hidden) flushSave(); });
addEventListener("pagehide", flushSave);
window.__flushSave = flushSave;            // also called by the Android wrapper from onPause

// ---- main loop ----
const STEP = 1000 / 60; let acc = 0, last = 0, fps = { n: 0, r: 0, t: 0 };
// 3D / VOX "Smooth": the game steps at its own ~60 Hz, the view is drawn at every display refresh (120 Hz phones) with the world
// interpolated between the last two game frames; off: drawn once per game frame, as it was
const smoothQ = new URLSearchParams(location.search).get("smooth");
let smooth = smoothQ ? !(smoothQ === "0" || smoothQ === "off") : (() => { try { return localStorage.getItem("mt-smooth") !== "off"; } catch (e) { return true; } })();
let renderedAt = -1;
// the page's input: the keys, the touch d-pad and buttons, a controller (pollGamepad); withStick: the analog stick's direction too (full
// presses: the menus and panels); the game's frames take the stick through stickFrame instead (STICK FEEL: its walking)
function input(withStick = true) {
  const k = keys, s = withStick ? stickDir() : {};
  return { a: k.KeyZ || k.KeyA, b: k.KeyX || k.KeyS, start: k.Enter, select: k.ShiftRight || k.Backspace || k.KeyQ,
           right: k.ArrowRight || !!s.right, left: k.ArrowLeft || !!s.left, up: k.ArrowUp || !!s.up, down: k.ArrowDown || !!s.down };
}
const frameInput = () => stickFrame(input(false), !!gb && onCourt());   // (a match on the court: a light tilt walks)
const rec = new Recorder();
// with the JS port the game's state is partly JavaScript (its coroutines), which a machine state can't hold: a
// recording made mid-game could not be replayed. So the port keeps a log of every frame from power-on, and REC
// saves that log with the frame REC was pressed at (meta.from); a replay runs it from power-on (web/tests).
const session = new Recorder(); let portRecFrom = -1, sessionLook = null;
// the player's look: the LOOK button / Create a Character offer; a change in play is a recording event
const creator = mountCreator({ hud: $("hud"), keys, pause: p => { const was = paused; paused = p; return was; },
  onChange: look => { rec.event(lookEvent(look)); session.event(lookEvent(look)); drawnFrame = -1; } });
// TOUR+ (tour.js): rankings, rivals, training, equipment, the day schedule and sponsors, kept per tour file; read only
const tour = new Tour({ getGb: () => gb, getPort: () => port, pause: p => { const was = paused; paused = p; return was; }, pad: () => { pollGamepad(keys); return input(); } });
addTourButtons($("hud"), tour);
// MODES (modes.js): exhibition rules, rematch, the machine's court, mini-games Hard, partner commands, fast text, the RECORDS panel
const modes = new Modes({ getGb: () => gb, getPort: () => port, pause: p => { const was = paused; paused = p; return was; }, pad: () => { pollGamepad(keys); return input(); } });
addModeButtons($("hud"), modes);
const venueTour = new VenueTour({ getVoxel: () => voxel, setView3d: on => setView3d(on), getView3d: () => view3d, pad: () => { pollGamepad(keys); return input(); } });
addVenueTourButton($("hud"), venueTour); window.__venueTour = venueTour;   // (tests)
const recording = () => rec.on || portRecFrom >= 0;
// RUN-AHEAD (on / off, remembered): after the game's frames, the machine is copied, one more frame is run with the same buttons and that
// frame is shown; the copy is put back before the next real frame (settle). What you press shows one frame (17 ms) sooner, and the game
// itself is untouched (web/tests/runahead.mjs). Saves, recordings, reset and save states always use the real machine (settle first).
// The original code only: the JS port keeps state of its own outside the machine.
let runAhead = stored("mt-runahead") === "on", raSnap = null, lastInp = null;
function settle() { if (raSnap) { restore(gb, raSnap); raSnap = null; } }
function lookAhead() {
  if (!runAhead || port || !gb) return;
  raSnap = snapshot(gb); gb.setInput(lastInp || frameInput()); gb.runFrame(); gb.apu.outPos = 0;   // its sound is dropped (the real frame plays it)
}
// the win / lose screen after a match (bank $16: its raster split, rows $48-$57, is on only while it shows) goes on with A only, and not
// for its first second: B and a tap left over from the last point no longer skip it (RIGHT still opens the statistics)
let resultsAt = -1;
function resultsGate(inp) {
  const w = gb.mem.wram[0], on = w[0xB02] === 0x48 && w[0xB03] === 0x57 && (gb.mem.ie & 0x02);
  if (!on) { resultsAt = -1; return inp; }
  if (resultsAt < 0) resultsAt = gb.frames;
  return { ...inp, b: false, a: inp.a && gb.frames - resultsAt >= 60 };
}
function frame() {
  pollGamepad(keys); const inp = modes.filterInput(resultsGate(frameInput())), mask = maskOf(inp); gb.setInput(inp); lastInp = inp;   // (MODES: the partner's commands kept from the game)
  if (port) portFrame(); else gb.runFrame();
  if (view3d && voxel && voxel.mode === "3d") voxel.tick();
  if (phone) phone.frame(gb);                // VIBRATE: hits and points
  if (replay) replay.afterFrame(gb, inp);   // INSTANT REPLAY: the buttons of the point (the port: the point's tape)
  rec.frame(gb, mask); session.frame(gb, mask);
  creator.frame(); deck.frame(); tour.frame(); modes.frame();
  if (port && port.plus) port.plus.fatigue = tour.fatigue();   // TOUR+: a tired player (PLAY+ stamina)
  if (audioReady && anode) { const n = gb.apu.drain(abuf); if (n) anode.port.postMessage(abuf.slice(0, n)); } else gb.apu.outPos = 0;
}
let drawnFrame = -1;
const wideImg = g.createImageData(WIDE_W, WIDE_H), wideBuf = new Uint32Array(wideImg.data.buffer), wideIdx = new Uint8Array(WIDE_W * WIDE_H);
const onCourt = () => gb.mem.wram[0][0x32E] <= 15;   // wCurMapID: courts (the map is wider than the screen)
let insetAt = 0;
function draw(alpha = 1) {                 // alpha: fraction of the next game frame already elapsed (3D interpolation)
  const f = gb.ppu.frame;
  if (hd) hd.setView3d(view3d);
  if (hd) hd.setSpriteHide(true);            // sprites replaced by HD art: every view leaves them out (2D, 3D court / field / menu layers)
  if (hd && hd.update()) drawnFrame = -1;    // the text on screen (HD font) changed
  if (menuWheel) menuWheel.update();         // MENU: Wheel
  tour.coachFrame();                         // TOUR+: the coach's pick on the stat screen
  modes.overlay();                           // MODES: the rematch question
  if (port && port.plus && voxel && voxel.weather) port.plus.wet = voxel.weather.cur === "rain" || voxel.weather.cur === "wet";   // PLAY+: a wet court
  if (voxel && voxel.ballfx) { voxel.ballfx.serveCue = !!(port && port.plus && port.plus.serve); voxel.ballfx.fire = port && port.plus && port.plus.momentum && port.E ? port.E.mom || null : null; }   // PLAY+: its cues
  if (view3d && voxel) {
    if (gb.frames >= insetAt) {               // the touch HUD bar covers the top of the view: overlays go below it
      insetAt = gb.frames + 30; const hud = $("hud"), top = $("gl").getBoundingClientRect().top;
      const touch = document.body.classList.contains("touch"), glr = $("gl").getBoundingClientRect();
      voxel.topInset = touch && !hud.hidden && !hud.classList.contains("hm-side") ? Math.max(0, hud.getBoundingClientRect().bottom - top) : 0;   // (the side menu covers no overlay row)
      let ctl = 0;                            // height of the touch controls above the bottom of the view
      if (touch && !document.body.classList.contains("gamepad")) for (const sel of [".btns .k:not(.start)", "#stickzone .stick-base", ".dpad"]) { const e = document.querySelector(sel); if (e && e.offsetParent !== null) ctl = Math.max(ctl, glr.bottom - e.getBoundingClientRect().top); }
      voxel.bottomInset = Math.min(glr.height * 0.4, Math.max(0, ctl));
    }
    if (!smooth) { alpha = 1; if (renderedAt === gb.frames) return; }     // no interpolation: one picture per game frame
    renderedAt = gb.frames; fps.r++;
    try { voxel.render(spriteFree(f), alpha); return; } catch (e) { console.warn("3d", e); setView3d(false); }
  }
  if (drawnFrame === gb.frames) return;      // 2D: nothing new to show between game frames
  drawnFrame = gb.frames; fps.r++;
  if (aspect === "4:3" && onCourt()) {       // 4:3 on a court: 192 px wide composite with the real map on both sides
    composeWide(gb, wideBuf, wideIdx); present(wideImg, WIDE_W, WIDE_H, (WIDE_W - 160) / 2); return;
  }
  new Uint32Array(img.data.buffer).set(f); present(img, 160, 144, 0);
}
// the 2D frame the 3D view cuts its overlays (window panel, menu boxes) from: the sprites the HD art replaced are taken
// out of it (their pixels show the BG-only picture, or the sprite below them), like the 2D view does
const hdFrame = new Uint32Array(160 * 144); let hdFrameSrc = null;
let hdFrameKey = "";
function spriteFree(f) {
  if (!hd || !hd.ui || !hd.hiddenOam.size) return f;
  const k = gb.frames + ":" + hd.sprVersion + ":" + hd.version; if (k === hdFrameKey && f === hdFrameSrc) return hdFrame;     // once per game frame (3D draws several times between game frames)
  hdFrameKey = k; hdFrameSrc = f;
  hdFrame.set(f); const bgp = gb.ppu.bgFrame, hp = hd.hiddenPx, th = hd.through;
  for (let i = 0; i < hp.length; i++) if (hp[i]) hdFrame[i] = bgp[i];
  for (let k = 0; k < th.length; k += 2) hdFrame[th[k]] = th[k + 1];
  return hdFrame;
}
// the frame on the 2D canvas; with an HD font, at HD x the size (pixels kept sharp) with the text drawn over it
const small = document.createElement("canvas"), sg = small.getContext("2d");
function present(image, w, h, padX) {
  if (!hd || !hd.active) { if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; } g.putImageData(image, 0, 0); return; }
  if (small.width !== w || small.height !== h) { small.width = w; small.height = h; }
  const hid = hd.ui && hd.hiddenOam.size && !padX && w === 160;      // sprites replaced by HD art: the base is the picture without sprites
  if (hid) { bg32.set(gb.ppu.bgFrame); sg.putImageData(bgImg, 0, 0); } else sg.putImageData(image, 0, 0);
  if (cv.width !== w * HD || cv.height !== h * HD) { cv.width = w * HD; cv.height = h * HD; }
  g.imageSmoothingEnabled = false; g.drawImage(small, 0, 0, w * HD, h * HD);
  g.imageSmoothingEnabled = true; if (hd.has.under) g.drawImage(hd.canvas.under, padX * HD, 0); if (hd.has.bg) g.drawImage(hd.canvas.bg, padX * HD, 0); if (hd.has.win) g.drawImage(hd.canvas.win, padX * HD, 0);
  if (hd.ui && hd.painted && !padX && w === 160) { drawSprites(image, w, h); if (hd.has.spr) { g.imageSmoothingEnabled = true; g.drawImage(hd.canvas.spr, 0, 0); } }
}
// the HD UI art covers the screen's tiles, sprites (cursors) included: the sprites' own pixels (where the frame differs
// from the BG-only picture) go back on top, sharp
const sprCv = document.createElement("canvas"), sprG = sprCv.getContext("2d"); sprCv.width = 160; sprCv.height = 144;
const sprImg = sprG.createImageData(160, 144), spr32 = new Uint32Array(sprImg.data.buffer);
const bgImg = sprG.createImageData(160, 144), bg32 = new Uint32Array(bgImg.data.buffer);
function drawSprites(image, w, h) {
  const a = new Uint32Array(image.data.buffer), b = gb.ppu.bgFrame; let any = false;
  for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { spr32[i] = a[i]; any = true; } else spr32[i] = 0; }
  if (hd.hiddenOam.size) {                  // sprites the HD art replaced (cursors): not drawn; what lay below them is
    const hp = hd.hiddenPx; for (let i = 0; i < hp.length; i++) if (hp[i]) spr32[i] = 0;
    const th = hd.through; for (let k = 0; k < th.length; k += 2) spr32[th[k]] = th[k + 1]; any = true;
  }
  if (!any) return;
  sprG.putImageData(sprImg, 0, 0); g.imageSmoothingEnabled = false; g.drawImage(sprCv, 0, 0, w * HD, h * HD);
}
// ---- screen shape: Fill (3D fills the screen, 2D keeps 10:9), 4:3 (3D letterboxed to 4:3; 2D courts widened
// to 192 px, elsewhere pillarboxed), 10:9 (both as the Game Boy) ----
const ASPECTS = ["fill", "4:3", "10:9"];
let aspect = q.get("aspect") || stored("mt-aspect") || "fill"; if (!ASPECTS.includes(aspect)) aspect = "fill";
function applyAspect() {
  $("aspect").textContent = "VIEW: " + (aspect === "fill" ? "Fill" : aspect);
  const touch = document.body.classList.contains("touch"), gl = $("gl"), area = portraitArea();   // area: the game's part of an upright screen
  const vw = area ? area.w : innerWidth, vh = area ? area.h : innerHeight;
  const box = r => {                          // CSS size of an r-aspect box fitted to the viewport / the portrait game area (touch) or 480 px wide (desktop)
    if (!touch) return { w: 480, h: 480 / r };
    return vw / vh > r ? { w: vh * r, h: vh } : { w: vw, h: vw / r };
  };
  const set = (el, b) => { if (!b) { el.style.cssText = ""; return; } el.style.width = b.w + "px"; el.style.height = b.h + "px"; if (touch) { el.style.left = (vw - b.w) / 2 + "px"; el.style.top = (vh - b.h) / 2 + "px"; el.style.transform = "none"; el.style.inset = "auto"; el.style.position = "fixed"; } };
  if (aspect === "fill") { set(gl, null); set(cv, null); }
  else { const r = aspect === "4:3" ? 4 / 3 : 160 / 144; set(gl, box(r)); set(cv, box(r)); }
  try { localStorage.setItem("mt-aspect", aspect); } catch (e) { /* private mode */ }
  deck.resize(); insetAt = 0;
}
addEventListener("resize", () => applyAspect());
let preset = q.get("cam") || stored("mt-cam") || "low"; if (!PRESETS[preset]) preset = "low";
function setView3d(on, vox = false) {
  view3d = on; $("view3d").classList.toggle("on", on); $("view3d").textContent = on ? (vox ? "VOX" : "3D") : "3D";
  if (on && !voxel) { try { voxel = new Voxel3D($("gl"), gb, new Rom(gb.mem.rom)); voxel.hdText = hd; voxel.freeCam = q.has("freecam"); attachLighting(voxel, $("hud")); attachLightPanel(voxel); if (phone) phone.applyBattery(); attachStadium(voxel, $("hud")); addCourtButton(voxel, $("hud")); addFarEndButton(voxel, $("hud")); attachCrowdSound(voxel.stadium, $("hud"), () => actx); attachBallFX(voxel, $("hud")); voxel.tour = tour; attachIntro(voxel, $("hud")); attachMatchFx(voxel, $("hud")); attachFieldLife(voxel, $("hud")); attachWeather(voxel, $("hud")); attachCloseCall(voxel, $("hud")); attachGround(voxel, $("hud")); attachVoxStyle(voxel, $("hud")); setPreset(preset); } catch (e) { console.warn("3d", e); view3d = false; $("view3d").classList.remove("on"); return; } }
  if (voxel) voxel.voxelSprites = on && vox;
  $("gl").hidden = !view3d; cv.hidden = view3d; $("cam").hidden = !view3d; $("smoothbtn").hidden = !view3d; if ($("ballfxbtn")) $("ballfxbtn").hidden = !view3d; if ($("voxstylebtn")) $("voxstylebtn").hidden = !(view3d && vox); if ($("lightbtn")) $("lightbtn").hidden = !view3d; if ($("stadiumbtn")) $("stadiumbtn").hidden = !view3d; if ($("crowdsndbtn")) $("crowdsndbtn").hidden = !view3d;
  try { localStorage.setItem("mt-3d", on ? (vox ? "vox" : "3d") : "off"); } catch (e) { /* private mode */ }
}
function setPreset(name) {                  // court camera preset (CAM button cycles PRESET_ORDER)
  if (!PRESETS[name]) return; preset = name; if (voxel) voxel.setPreset(name); $("cam").textContent = "CAM: " + PRESETS[name].label;
  try { localStorage.setItem("mt-cam", name); } catch (e) { /* private mode */ }
}
let hdLast = 0, hdDt = 16;
// INTRO: while the walk-out holds the game, a copy of the machine plays on with no buttons pressed, for its music only (the court music
// goes on instead of silence); it is dropped when the match starts and the game itself carries on from where it was held
let recomp = null, introGb = null, introAcc = 0, introLast = 0;
function introMusic(now) {
  if (!introGb) {
    try { introGb = new GBC(gb.mem.rom, { sampleRate: 44100, audio: true }); if (recomp) { introGb.installRecomp(recomp.T); if (recomp.sig) introGb.exec.setHramSig(recomp.sig); } loadState(introGb, saveState(gb)); }
    catch (e) { console.warn("intro music", e); introGb = false; return; }
    introAcc = 0; introLast = now;
  }
  if (!introGb) return;
  introAcc = Math.min(introAcc + now - introLast, STEP * 4); introLast = now;
  for (; introAcc >= STEP; introAcc -= STEP) {
    introGb.setInput(stateOf(0)); introGb.runFrame();
    if (audioReady && anode) { const n = introGb.apu.drain(abuf); if (n) anode.port.postMessage(abuf.slice(0, n)); } else introGb.apu.outPos = 0;
  }
}
function loop(now) {
  if (gb && !paused && voxel && view3d && ((voxel.intro && voxel.intro.holding) || (voxel.stadium && voxel.stadium.holding))) { last = now; acc = 0; renderedAt = -1; draw(1); if (voxel.intro && voxel.intro.holding) introMusic(now); }   // (BIG MOMENTS: the trophy ceremony holds too)   // INTRO: the game waits, the camera moves, the music plays on
  else if (gb && !paused) {
    introGb = null;
    if (!last) last = now;
    acc = Math.min(acc + (now - last), STEP * 4); last = now;
    const per = turbo || modes.fastText(lastInp) ? 4 : 1;   // (MODES: FAST TEXT)
    if (replay && replay.playing) { while (acc >= STEP) { replay.step(); acc -= STEP; fps.n++; } }   // INSTANT REPLAY: the point again (no saves, no run-ahead)
    else if (acc >= STEP) { settle(); while (acc >= STEP) { for (let i = 0; i < per; i++) frame(); acc -= STEP; fps.n++; } maybeSave(); lookAhead(); }
    if (!phone || phone.allowDraw(now)) draw(acc / STEP);   // (BATTERY saver: at most 60 pictures a second)
    if (hd) { const dt = now - (hdLast || now); hdLast = now; hdDt = hdDt * 0.9 + Math.min(dt, 100) * 0.1; hd.struggling = hdDt > 24; }   // below ~40 fps the HD art waits while the screen moves
    if (now - fps.t >= 1000) { $("fps").textContent = view3d ? `game ${fps.n} · view ${fps.r} fps` + (turbo ? " (turbo)" : "") : fps.n + " fps" + (turbo ? " (turbo)" : ""); fps.n = 0; fps.r = 0; fps.t = now; }
  } else last = now;
  requestAnimationFrame(loop);
}

// ?port: run the game through the readable JS port (web/js/port) instead of the core's CPU: ported routines run as
// JavaScript, the rest as the ROM's code (the hybrid). CODE: PORT (?port, ?port=all) runs every module (program.js); ?port=a/b,c/d picks
// modules (paths under web/js/port: the tests). (The older choice of only the finished modules is gone: "portall" links, settings and
// recordings are the port.)
let port = null, portError = null;
// the mode: the page's selector, or #port in the link, or ?port in the URL
// PHYSICS: Classic / Enhanced (web/js/engine/enhanced.js): ?physics=enhanced|classic, else the remembered choice; Enhanced runs only through the port
// (the ROM's own code cannot be changed), so it turns the default CODE: ROM into the port
const physicsMode = () => { const v = q.get("physics") || stored("mt-physics"); return v === "enhanced" ? "enhanced" : "classic"; };
// NET: Original / Even (engine/chars.js): ?net=even|original, else the remembered choice; Even runs only through the port: chosen, it
// switches the engine to the port; with no choice it is the default wherever the port already runs (both sides reach the net)
const netChoice = () => q.get("net") || stored("mt-net");
// TOUR MATCH: 3x3 / Game's (port/story/match.js): the tour's matches the best of 3 sets of 3 games (default), or the game's own lengths
// (3 sets of 6 games, 5 at the Island Open); ?tourlen=3x3|game, else the remembered choice. Only through the port (the ROM's own code
// knows no 3-game set)
// PLAY+ (engine/plus.js): momentum, stamina, serve timing, courts that play apart, net cords, the tour's difficulty curve; ?plus=on|off,
// else the remembered choice (on by default). Through the port only.
const plusOn = () => { const v = q.get("plus") || stored("mt-plus"); return v !== "off"; };
const plusRules = () => (plusOn() ? { momentum: 1, stamina: 1, serve: 1, courts: 1, netcord: 1, tour: 1, wet: false } : null);
const tourLen = () => { const v = q.get("tourlen") || stored("mt-tourlen"); return v === "game" ? "game" : "3x3"; };
const netMode = () => { const v = netChoice(); return v === "even" || v === "original" ? v : portMode() !== "rom" ? "even" : "original"; };
const portMode = () => { const h = location.hash.slice(1), sel = $("engine") && $("engine").value, m = h === "port" || h === "portall" || q.has("port") ? "port" : sel || "rom"; return m === "rom" && (physicsMode() === "enhanced" || netChoice() === "even") ? "port" : m; };
if ($("engine")) {
  const saved = stored("mt-engine");
  if (location.hash === "#port" || location.hash === "#portall") $("engine").value = "port";
  else if (saved === "rom" || saved === "port" || saved === "portall") $("engine").value = saved === "rom" ? "rom" : "port";
  $("engine").addEventListener("change", () => { try { localStorage.setItem("mt-engine", $("engine").value); } catch (e) { /* private mode */ } });
}
async function makePort(bytes) {
  const { GamePort } = await import("./port/port.js"), { entry } = await import("./port/entry.js");
  const want = q.get("port") || "all";
  let hooks;
  if (want === "all") hooks = (await import("./port/program.js")).program.hooks;
  else {
    hooks = [];
    for (const m of want.split(",")) hooks.push(...(await import(`./port/${m}.js`)).HOOKS);
  }
  const P = new GamePort(bytes, { ...entry, hooks }, { audio: true, sampleRate: 44100 });
  if (physicsMode() === "enhanced") { const { EnhancedPhysics } = await import("./engine/enhanced.js"); P.physics = new EnhancedPhysics(); }
  P.evenNet = netMode() === "even";
  P.tourLength = tourLen();
  P.plus = plusRules();
  return P;
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
  await creator.ready;                         // bundled opponent mods (web/mods) are fetched
  creator.prepare(bytes);                      // the player's look (web/js/look) patches the ROM copy before the machine is built
  raSnap = null;
  if (portMode() !== "rom") { port = await makePort(bytes); gb = port.gb; portError = null; modes.apply(); }
  else gb = new GBC(bytes, { sampleRate: 44100, audio: true });
  creator.attach(gb);
  drawnFrame = -1;
  hd = new HDText(gb); hd.onload = () => { drawnFrame = -1; }; hd.setFont(font); hd.setUI(uiMode === "hd");
  if (voxel) { voxel.attach(gb, new Rom(gb.mem.rom)); voxel.hdText = hd; }      // a ROM loaded after the 3D view was created
  // the statically translated game (tools/recomp.py -> gen/game.js) runs the traced code as native
  // functions; without it everything is interpreted (same results, see web/tests/recomp_vs_interp.mjs)
  if (port) $("romstatus").textContent += ` · JS port (${port.hooks.size} routines)`;
  else try { const mod = await import("../gen/game.js"); const T = {}; mod.install(T); gb.installRecomp(T); if (mod.HRAM_SIG) gb.exec.setHramSig(mod.HRAM_SIG); recomp = { T, sig: mod.HRAM_SIG }; $("romstatus").textContent += " · recompiled code"; } catch (e) { $("romstatus").textContent += " · interpreter"; }
  loadSave();
  if (port) { session.start(gb, recMeta()); sessionLook = creator.look; }
  $("loader").hidden = true; cv.focus();
  showHud(!document.body.classList.contains("touch"));            // phones: the bar stays hidden until Back
  if (document.body.classList.contains("touch")) hint("Swipe back (or press Back) for the menu");
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
// ---- the button bar: on phones it stays out of the way, and the Back gesture / button shows and hides it (the app
// calls window.__backPressed from onBackPressed) ----
function showHud(on) { $("hud").hidden = !on; insetAt = 0; applyAspect(); }
function toggleHud() { if (!gb) return false; showHud($("hud").hidden); return true; }
window.__backPressed = toggleHud;
function hint(text) {                         // a short notice over the game that fades out
  const d = document.createElement("div"); d.textContent = text;
  d.style.cssText = "position:fixed;left:50%;top:18%;transform:translateX(-50%);z-index:9;padding:8px 14px;border-radius:8px;background:rgba(20,22,30,.85);color:#fff;font:14px sans-serif;pointer-events:none;transition:opacity .6s";
  document.body.appendChild(d); setTimeout(() => { d.style.opacity = "0"; }, 2600); setTimeout(() => d.remove(), 3300);
}
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
$("reset").addEventListener("click", () => { if (port) { location.reload(); return; } if (gb) { settle(); gb.reset(); rec.event("reset"); } });
// ---- session recording: REC starts (the machine state now + every frame's buttons), REC again stops and saves
// a .mtrec file (Android: Downloads/MTenn3D and the share sheet; browser: a download). Hiding the app stops and saves.
const recMeta = () => ({ view: view3d ? (voxel && voxel.voxelSprites ? "vox" : "3d") : "2d", engine: portMode(), physics: port && port.physics ? "enhanced" : undefined, net: port ? (port.evenNet ? "even" : "original") : undefined, tourlen: port ? port.tourLength : undefined, menu: port && port.menuWheel && port.menuWheel.on ? "wheel" : "game", plus: port ? (port.plus ? "on" : "off") : undefined, rules: port && port.rules ? port.rules : undefined, font, ua: navigator.userAgent, look: creator.look || undefined,
  port: port ? q.get("port") || "all" : undefined });
async function saveRecording(now = false) {     // now: the app is being hidden; skip compression so it finishes at once
  if (!recording()) return; settle();
  let obj;
  if (portRecFrom >= 0) { obj = session.snapshot(gb, romHash); obj.meta = { ...recMeta(), look: sessionLook || undefined, from: portRecFrom }; portRecFrom = -1; }
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
  settle(); if (port) portRecFrom = session.n; else rec.start(gb, recMeta());
  $("rec").classList.add("on");
});
setInterval(() => { if (!recording()) return; const t = rec.on ? rec.seconds : (session.n - portRecFrom) / 60; $("rec").textContent = "REC " + Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0"); }, 1000);
addEventListener("visibilitychange", () => { if (document.hidden && recording()) saveRecording(true); });
window.__stopRec = () => { if (recording()) saveRecording(true); };   // called by the Android wrapper from onPause
replay = new InstantReplay({ gb: () => gb, voxel: () => voxel, canRun: () => view3d && !!voxel && voxel.mode === "3d", isPort: () => !!port, settle });
phone = attachPhone($("hud"), { gb: () => gb, voxel: () => voxel, view3d: () => view3d, redraw: () => { renderedAt = -1; drawnFrame = -1; if (gb) draw(1); },
  saveState: () => { settle(); return saveState(gb); }, loadState: st => { raSnap = null; loadState(gb, st); drawnFrame = -1; }, romHash: () => romHash, hint });
$("view3d").addEventListener("pointerdown", () => { if (!gb) return; const vox = voxel && voxel.voxelSprites; setView3d(!view3d || !vox, view3d && !vox); });   // off -> cards -> voxels -> off
function applySmooth() {
  $("smoothbtn").textContent = "SMOOTH: " + (smooth ? "on" : "off");
  try { localStorage.setItem("mt-smooth", smooth ? "on" : "off"); } catch (e) { /* private mode */ }
}
$("smoothbtn").addEventListener("pointerdown", () => { smooth = !smooth; renderedAt = -1; applySmooth(); });
const raBtn = document.createElement("span"); raBtn.className = "k"; raBtn.id = "runaheadbtn"; raBtn.title = "Run-ahead: what you press shows one frame (17 ms) sooner; the game is unchanged. Uses twice the emulation (the original code only, not the JS port)";
const showRA = () => { raBtn.textContent = "RUN-AHEAD: " + (runAhead ? "on" : "off"); raBtn.classList.toggle("on", runAhead); };
raBtn.addEventListener("pointerdown", () => { runAhead = !runAhead; if (!runAhead) settle(); try { localStorage.setItem("mt-runahead", runAhead ? "on" : "off"); } catch (e) { /* private mode */ } showRA(); });
$("smoothbtn").after(document.createTextNode(" "), raBtn); showRA();
applySmooth();
$("cam").addEventListener("pointerdown", () => setPreset(PRESET_ORDER[(PRESET_ORDER.indexOf(preset) + 1) % PRESET_ORDER.length]));
$("aspect").addEventListener("pointerdown", () => { aspect = ASPECTS[(ASPECTS.indexOf(aspect) + 1) % ASPECTS.length]; drawnFrame = -1; applyAspect(); });
applyAspect();
// ---- touch movement: analog stick (default) or the d-pad ----
const stick = mountStick($("stickzone"), keys); addStickFeelButton($("hud"));
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
// ---- menus: the game's own frames / cursors / icons, or HD art drawn over them (web/js/hdui.js); HD by default ----
let uiMode = q.get("ui") || stored("mt-ui") || "hd"; if (uiMode !== "game" && uiMode !== "hd") uiMode = "hd";
function applyUI() {
  $("uibtn").textContent = "UI: " + (uiMode === "hd" ? "HD" : "Game");
  if (hd) hd.setUI(uiMode === "hd"); drawnFrame = -1;
  try { localStorage.setItem("mt-ui", uiMode); } catch (e) { /* private mode */ }
}
$("uibtn").addEventListener("pointerdown", () => { uiMode = uiMode === "hd" ? "game" : "hd"; applyUI(); });
applyUI();
$("turbo").addEventListener("pointerdown", () => { turbo = !turbo; $("turbo").classList.toggle("on", turbo); });
// what runs the game, switchable in play (the app loads the ROM before the loader's selector can be used):
// remembered, then the page reloads
const ENGINE_LABEL = { rom: "CODE: ROM", port: "CODE: PORT" };
$("engbtn").textContent = ENGINE_LABEL[portMode()] || "CODE: ROM";
// PHYSICS: Classic / Enhanced: remembered, then the page reloads (Enhanced needs the port; a running game is lost, as with CODE)
{
  const b = document.createElement("span"); b.className = "k"; b.id = "physbtn"; b.title = "ball physics: the game's own, or Enhanced (Tennis-Elbow-style flight, spin and bounce on the same landing points); runs through the JS port";
  const show = () => { b.textContent = "PHYSICS: " + (physicsMode() === "enhanced" ? "Enhanced" : "Classic"); b.classList.toggle("on", physicsMode() === "enhanced"); }; show();
  b.addEventListener("pointerdown", () => {
    const next = physicsMode() === "enhanced" ? "classic" : "enhanced";
    try { localStorage.setItem("mt-physics", next); if (next === "enhanced" && portMode() === "rom") localStorage.setItem("mt-engine", "port"); } catch (e) { /* private mode */ }
    if ($("engine") && next === "enhanced" && $("engine").value === "rom") $("engine").value = "port";
    const u = new URL(location.href); u.searchParams.delete("physics"); history.replaceState(null, "", u.pathname + u.search + u.hash);
    location.reload();
  });
  $("hud").appendChild(document.createTextNode(" ")); $("hud").appendChild(b);
}
// NET: Original / Even: remembered, then the page reloads (Even needs the port, like Enhanced physics)
{
  const b = document.createElement("span"); b.className = "k"; b.id = "netbtn"; b.title = "how close to the net you can run: the game's own limits (the far side stops further back), or Even (both sides as close); Even runs through the JS port (no run-ahead)";
  const show = () => { b.textContent = "NET: " + (netMode() === "even" ? "Even" : "Original"); b.classList.toggle("on", netMode() === "even"); }; show();
  b.addEventListener("pointerdown", () => {
    const next = netMode() === "even" ? "original" : "even";
    try { localStorage.setItem("mt-net", next); if (next === "even" && portMode() === "rom") localStorage.setItem("mt-engine", "port"); } catch (e) { /* private mode */ }
    if ($("engine") && next === "even" && $("engine").value === "rom") $("engine").value = "port";
    const u = new URL(location.href); u.searchParams.delete("net"); history.replaceState(null, "", u.pathname + u.search + u.hash);
    location.reload();
  });
  $("hud").appendChild(document.createTextNode(" ")); $("hud").appendChild(b);
}
// PLAY+: on / off (remembered; takes effect at once)
{
  const b = document.createElement("span"); b.className = "k"; b.id = "plusbtn"; b.title = "match rules on top of the game's: momentum, stamina, serve timing, courts that play apart, net cords, a difficulty curve through the tour (needs the JS port)";
  const show = () => { b.textContent = "PLAY+: " + (plusOn() ? "on" : "off"); b.classList.toggle("on", plusOn()); }; show();
  b.addEventListener("pointerdown", () => {
    try { localStorage.setItem("mt-plus", plusOn() ? "off" : "on"); } catch (e) { /* private mode */ }
    const u = new URL(location.href); u.searchParams.delete("plus"); history.replaceState(null, "", u.pathname + u.search + u.hash);
    if (port) port.plus = plusRules(); show();
  });
  $("hud").appendChild(document.createTextNode(" ")); $("hud").appendChild(b);
}
// MENU: Wheel / Game (menuwheel.js): the main menu as a ball wheel over the game's own (through the port)
menuWheel = attachMenuWheel(() => gb, () => port, $("hud"), () => hd);
menuWheel.isCourt = () => !!(view3d && voxel && voxel.mode === "3d" && voxel.isCourt());   // (BACKDROP: a match is up, stop holding the menu)
// TOUR MATCH: 3x3 / Game's: remembered, read by the port when a tour match is set up (the next match, no reload)
{
  const b = document.createElement("span"); b.className = "k"; b.id = "tourlenbtn"; b.title = "tour match length: the best of 3 sets of 3 games, or the game's own (3 sets of 6 games, 5 sets at the Island Open); needs the JS port (CODE: PORT)";
  const show = () => { b.textContent = "TOUR: " + (tourLen() === "game" ? "Game's" : "3x3"); b.classList.toggle("on", tourLen() !== "game"); }; show();
  b.addEventListener("pointerdown", () => {
    try { localStorage.setItem("mt-tourlen", tourLen() === "game" ? "3x3" : "game"); } catch (e) { /* private mode */ }
    const u = new URL(location.href); u.searchParams.delete("tourlen"); history.replaceState(null, "", u.pathname + u.search + u.hash);
    if (port) port.tourLength = tourLen(); show();
  });
  $("hud").appendChild(document.createTextNode(" ")); $("hud").appendChild(b);
}
// +9000 EXP (testing): adds 9000 EXP to the Mario Tour player's record (wC900 + $2C, 24-bit, capped at 99999 like the game's AddExp
// 02:4D30) in the loaded tour file, on the campus only (maps 17-36). Two taps (the first arms it for three seconds). The game's own
// level-up screen hands out the levels after the next EXP award (a match or a mini-game), and its next save keeps them.
{
  const b = document.createElement("span"); b.className = "k"; b.id = "expbtn"; b.textContent = "+9000 EXP"; b.title = "testing: give your tour character 9000 EXP (tap twice)";
  let armed = 0;
  b.addEventListener("pointerdown", () => {
    if (!gb) return;
    const w = gb.mem.wram[0], map = w[0x32E]; let name = "";
    for (let i = 0; i < 8; i++) { const c = w[0x900 + i]; if (c < 0x20 || c > 0x7E) break; name += String.fromCharCode(c); }
    if (map < 17 || map > 36 || !name.trim()) { hint("Load your tour file and walk on the campus first"); return; }
    if (performance.now() - armed > 3000) { armed = performance.now(); b.textContent = "TAP AGAIN"; setTimeout(() => { b.textContent = "+9000 EXP"; }, 3000); return; }
    armed = 0; b.textContent = "+9000 EXP";
    const o = 0x92C, v = Math.min(99999, (w[o] | (w[o + 1] << 8) | (w[o + 2] << 16)) + 9000);
    w[o] = v & 0xFF; w[o + 1] = (v >> 8) & 0xFF; w[o + 2] = v >> 16;
    hint(`${name.trim()}: ${v} EXP. Play a match or a mini-game: the level-up screen comes after it`);
  });
  $("hud").appendChild(document.createTextNode(" ")); $("hud").appendChild(b);
}
$("engbtn").addEventListener("pointerdown", () => {
  const order = ["rom", "port"], next = order[(order.indexOf(portMode()) + 1) % order.length];
  try { localStorage.setItem("mt-engine", next); } catch (e) { /* private mode */ }
  if ($("engine")) $("engine").value = next;
  if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  location.reload();
});
// a private build bundles the ROM; a shared one doesn't, so the app starts with the ROM the player picked last time
fetch("../rom/mario_tennis.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(loadRom)
  .catch(() => { if (navigator.userAgent.includes("MarioTennisWrapper")) romStore("readonly", s => s.get("rom")).then(b => { if (b && !gb) loadRom(b.buffer.slice(0)); }).catch(() => {}); });
window.__gb = { get port() { return port; }, get deck() { return deck; }, get smooth() { return smooth; }, set smooth(v) { smooth = !!v; renderedAt = -1; applySmooth(); }, get fpsInfo() { return fps; }, get gb() { return gb; }, get hd() { return hd; }, keys, rec, aspect(a) { aspect = a; drawnFrame = -1; applyAspect(); }, pause(p = true) { paused = p; }, step(n = 1) { if (n) settle(); for (let i = 0; i < n; i++) frame(); draw(1); }, frameHash() { return gb.frameHash(); }, view3d: setView3d, preset: setPreset, get voxel() { return voxel; }, get creator() { return creator; }, get tour() { return tour; }, get modes() { return modes; }, get menuWheel() { return menuWheel; }, get replay() { return replay; }, loadSnapshot(s) { raSnap = null; loadSnapshot(gb, s); }, saveState() { settle(); return saveState(gb); }, loadState(s) { raSnap = null; loadState(gb, s); drawnFrame = -1; }, get runAhead() { return runAhead; }, settle };
organizeHud($("hud"));
requestAnimationFrame(loop);

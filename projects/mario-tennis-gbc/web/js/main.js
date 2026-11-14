// Web port entry: ROM loading, input, camera/projection, rendering, 60 fps loop.
import { Rom, sha1Hex, EXPECTED_SHA1 } from "./rom.js";
import { courtImage, screenImage, characterSprites, characterData, gameFont, ROSTER, PLAYABLE, COURTS } from "./assets.js";
import { EngineMatch, BANNER_TEXT, PAD } from "./engine/session.js";
import { Menus } from "./menus.js";
import { GameAudio } from "./audio.js";
import { pollGamepad } from "./gamepad.js";

// sound: the game's own driver and songs (sound.js / audio.js); started on the first key press
const audio = new GameAudio();
let music = 0, audioStarted = false;
function playMusic(id) { if (music !== id) { music = id; audio.play(id); } }
// the title screen alternates the theme ($02) and the attract-mode intro music ($01) as the game does
audio.onEnded = () => {
  if (front && FRONT[front.step].title) { const next = music === 0x02 ? 0x01 : 0x02; music = 0; playMusic(next); }
  else if (match && !front && !menus) { music = 0; playMusic(0x06); }   // the match-start fanfare ($44 -> $31) is followed by the match music $06
};
async function unlockAudio() {           // browsers allow audio only after a user gesture
  if (audioStarted || !rom) return;
  audioStarted = true;
  try { await audio.init(rom.b); audio.resume(); if (music) audio.play(music); } catch (e) { console.warn("audio", e); }
}

const W = 160, H = 144;
const cv = document.getElementById("screen"), g = cv.getContext("2d");
g.imageSmoothingEnabled = false;
const $ = id => document.getElementById(id);
let rom, font, menus, match, court, sprites = [], keys = {}, prevKeys = {};

// the match runs on the exact engine (engine/): its camera, projection, score and sprite frames are the game's
let banner = null, bannerT = 0;

async function loadRom(buf) {
  rom = await Rom.load(buf); font = gameFont(rom);
  const h = await sha1Hex(rom.b);
  $("romstatus").textContent = h === null ? "ROM loaded (hash not checked: insecure context)"
    : h === EXPECTED_SHA1 ? "ROM verified (Mario Tennis USA)" : `Warning: unexpected ROM SHA-1 ${h}`;
  for (const id of PLAYABLE) for (const sel of [$("p1"), $("p2")]) sel.add(new Option(ROSTER[id], id));
  $("p1").value = 23; $("p2").value = 25;
  for (const id of COURTS) $("court").add(new Option("Court " + id, id));
  $("court").value = 2;
  $("setup").hidden = false; $("loader").hidden = true;
  front = { step: 0, t: 0, cache: new Map() };     // boot into the intro (FRONT sequence)
}

function start(cfg) {
  if (cfg) { $("p1").value = cfg.p1; $("p2").value = cfg.p2; $("court").value = cfg.court; $("games").value = cfg.games; $("sets").value = cfg.sets || 1; $("diff").value = cfg.difficulty; }
  const p1 = +$("p1").value, p2 = +$("p2").value;
  court = courtImage(rom, +$("court").value);
  sprites = [characterSprites(rom, p1), characterSprites(rom, p2)];
  match = new EngineMatch(rom, { p1, p2, court: +$("court").value, games: +$("games").value, sets: +$("sets").value, difficulty: +$("diff").value });
  match.names = [characterData(rom, p1), characterData(rom, p2)];
  banner = null; menus = null;
  const [d1, d2] = match.names;
  $("info").textContent = `${d1.name} (${d1.type}) vs ${d2.name} (${d2.type})`;
  front = null;
  cv.focus();
}

// Front end built from decoded LoadScreen data (REVERSE.md "Screens", "Boot and main menu"): logos ($15),
// intro panels ($16-$1E), title ($1F, waits for Start = Enter), VS screen ($01) with the chosen names
// drawn in the game font, then the match. Enter during the intro skips to the title.
const FRONT = [
  { id: 0x15, hold: 150 },
  ...[0x16, 0x17, 0x18, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x1E].map(id => ({ id, hold: 75, intro: true })),
  { id: 0x1F, hold: Infinity, title: true },
  { id: 0x01, hold: 150, vs: true },
];
let front = null;
const FADE = 16;
function frontTick() {
  const st = FRONT[front.step], enter = keys.Enter && !prevKeys.Enter;
  if (st.intro && front.t === 0) playMusic(0x01);                                          // intro cutscene music
  if (st.title && front.t === 0) playMusic(0x02);                                          // title theme
  prevKeys = { ...keys };
  if (!front.cache.has(st.id)) front.cache.set(st.id, screenImage(rom, st.id));
  front.t++;
  if (enter && st.intro) { front.step = FRONT.findIndex(s => s.title); front.t = 0; return; }
  if (st.title && enter && !front.leaving) front.leaving = front.t;
  const end = st.title ? (front.leaving ? front.leaving + FADE : Infinity) : FADE + st.hold + FADE;
  if (front.t >= end) {
    front.leaving = 0; front.t = 0;
    if (st.title) { menus = new Menus(rom, font, audio); front = null; playMusic(0x03); return; }      // Start -> the exhibition menus
    if (++front.step >= FRONT.length) { start(front.cfg); return; }
  }
  // draw with fades to black
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.drawImage(front.cache.get(st.id), 0, 0);
  if (st.title && Math.floor(front.t / 32) % 2 === 0 && !front.leaving) {
    const msg = "PRESS START";
    g.fillStyle = "rgba(0,0,0,0.55)"; g.fillRect((W - font.width(msg)) / 2 - 3, 112, font.width(msg) + 6, 11);
    font.draw(g, msg, (W - font.width(msg)) >> 1, 114, [255, 240, 120], [120, 40, 0]);
  }
  if (st.vs) {
    const cfg = front.cfg || { p1: +$("p1").value, p2: +$("p2").value };
    const n1 = ROSTER[cfg.p1], n2 = ROSTER[cfg.p2];
    const box = (txt, cx, y) => { const w = font.width(txt); g.fillStyle = "rgba(0,0,40,0.8)"; g.fillRect(cx - w / 2 - 3, y - 2, w + 6, 12); font.draw(g, txt, Math.round(cx - w / 2), y); };
    const t1 = characterData(rom, cfg.p1).type, t2 = characterData(rom, cfg.p2).type;
    box(n1, 40, 40); box(n2, 120, 40);
    box(t1, 40, 124); box(t2, 120, 124);
  }
  let k = 0;
  if (front.t < FADE) k = 1 - front.t / FADE;
  else if (front.leaving) k = Math.min(1, (front.t - front.leaving) / FADE);
  else if (!st.title && front.t > FADE + st.hold) k = (front.t - FADE - st.hold) / FADE;
  if (k > 0) { g.fillStyle = `rgba(0,0,0,${k})`; g.fillRect(0, 0, W, H); }
}

const SCORE_PAL = [[0, 156, 0], [255, 57, 0], [255, 255, 74], [0, 0, 0]];   // OBJ palette 1 of the score strip
const POINT_TEXT = ["0", "15", "30", "40"];
function scoreText(sc) {
  const [a, b] = sc.points;
  if (sc.tiebreak) return `${a}-${b}`;
  if (a >= 3 && b >= 3) return a === b ? "DEUCE" : a > b ? "ADV P1" : "ADV P2";
  return `${POINT_TEXT[Math.min(a, 3)]}-${POINT_TEXT[Math.min(b, 3)]}`;
}
function render() {
  const m = match, sc = m.score, { x: camX, y: camY } = m.scroll;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.drawImage(court, -camX, -camY);
  const items = [];
  for (const p of m.players) {                 // sprite block anchored at its bottom centre on the projected feet
    const [sx, sy] = m.screen(p.x, p.depth, p.height), img = sprites[p.index & 1].frame(p.frame, p.flip);
    items.push([sy, () => g.drawImage(img, Math.floor(sx - img.width / 2), Math.floor(sy) - img.height)]);
  }
  const b = m.ball;
  if (b.visible || b.shadow) {
    const [gx, gy] = m.screen(b.x, b.depth, 0), [hx, hy] = m.screen(b.x, b.depth, b.height);
    items.push([gy, () => {
      if (b.shadow) { g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(Math.floor(gx - 2), Math.floor(gy - 1), 4, 2); }
      if (b.visible) { g.fillStyle = "#f8e030"; g.fillRect(Math.floor(hx - 1.5), Math.floor(hy - 3), 3, 3); g.fillStyle = "#806000"; g.fillRect(Math.floor(hx - 1.5), Math.floor(hy - 1), 3, 1); }
    }]);
  }
  items.sort((a, c) => a[0] - c[0]).forEach(([, f]) => f());
  // HUD
  g.fillStyle = "rgba(0,0,40,0.75)"; g.fillRect(0, 0, W, 11);
  const [p1, p2] = m.names.map(d => d.name.slice(0, 6));
  const gs = i => (m.cfg.sets || 1) > 1 ? `${sc.sets[i]}.${sc.games[i]}` : `${sc.games[i]}`;
  const hud = `${p1} ${gs(0)}  ${scoreText(sc)}  ${gs(1)} ${p2}`;
  font.draw(g, hud, Math.max(1, (W - font.width(hud)) >> 1), 2);
  const msg = m.paused ? "PAUSE" : m.message ? (m.message === 0x0174 ? "Return the serve after it bounces." : "Only the receiver may return.") :
    banner !== null ? BANNER_TEXT[banner] : m.over ? "GAME SET  (Enter: new match)" : null;
  if (msg) {
    const w = font.width(msg) + 8;
    g.fillStyle = "rgba(200,40,20,0.9)"; g.fillRect((W - w) >> 1, 100, w, 12);
    font.draw(g, msg, ((W - w) >> 1) + 4, 102, [255, 224, 96], [96, 16, 8]);
  }
}
// events of a frame: sounds, music, banners
function handleEvents(ev) {
  for (const [kind, v] of ev) {
    if (kind === "sfx") audio.sfx(v);
    else if (kind === "bgm") playMusic(v);
    else if (kind === "banner") banner = v < 0 ? null : v;
  }
}
const padMask = k => (k.KeyZ || k.KeyA ? PAD.A : 0) | (k.KeyX || k.KeyS ? PAD.B : 0) | (k.Enter ? PAD.START : 0) | (k.ShiftRight ? PAD.SELECT : 0) |
  (k.ArrowRight ? PAD.RIGHT : 0) | (k.ArrowLeft ? PAD.LEFT : 0) | (k.ArrowUp ? PAD.UP : 0) | (k.ArrowDown ? PAD.DOWN : 0);

let paused = false;  // set by tests that drive frames themselves (__mt.step)
function menuTick() {
  const k = keys, pr = prevKeys, edge = c => !!k[c] && !pr[c];
  const input = { left: edge("ArrowLeft"), right: edge("ArrowRight"), up: edge("ArrowUp"), down: edge("ArrowDown"),
    a: edge("KeyZ") || edge("KeyA") || edge("Enter"), b: edge("KeyX") || edge("KeyS") };
  prevKeys = { ...k };
  menus.update(input); menus.draw(g);
  if (menus.result) {        // VS screen, then the match
    front = { step: FRONT.findIndex(s => s.vs), t: 0, cache: new Map(), cfg: menus.result }; menus = null;
  }
}
function tick(input) {
  if (menus) return menuTick();
  if (front) return frontTick();
  handleEvents(match.update(typeof input === "number" ? input : 0)); render();
}
// Fixed 60 Hz timestep like the Game Boy (one logic update per 1/60 s), decoupled from the display refresh:
// a 120 Hz screen gets one update every other frame, a slow one catches up (at most 4 updates per paint).
const STEP = 1000 / 60;
let acc = 0, last = 0, fps = { n: 0, t: 0, shown: 0 };
function stepOnce() {
  pollGamepad(keys);
  if (menus) menuTick();
  else if (front) frontTick();
  else if (match) {
    const k = keys;
    if (k.Enter && !prevKeys.Enter && match.over) { prevKeys = { ...k }; start(); return; }
    prevKeys = { ...k };
    handleEvents(match.update(padMask(k)));
    render();
  }
}
function loop(now) {
  if (!paused && (menus || front || match)) {
    if (!last) last = now;
    acc = Math.min(acc + (now - last), STEP * 4); last = now;
    while (acc >= STEP) { stepOnce(); acc -= STEP; fps.n++; }
    if (now - fps.t >= 1000) { fps.shown = fps.n; fps.n = 0; fps.t = now; $("fps").textContent = fps.shown + " fps"; }
  } else last = now;
  requestAnimationFrame(loop);
}

addEventListener("keydown", e => { keys[e.code] = true; if (e.code.startsWith("Arrow")) e.preventDefault(); unlockAudio(); });
addEventListener("pointerdown", unlockAudio);
addEventListener("keyup", e => { keys[e.code] = false; });
// touch controls: each pad element holds a key code; pointer capture keeps a slide-off from sticking
for (const el of document.querySelectorAll("#pad [data-key]")) {
  const code = el.dataset.key;
  const down = e => { e.preventDefault(); el.setPointerCapture(e.pointerId); keys[code] = true; el.classList.add("on"); unlockAudio(); };
  const up = e => { e.preventDefault(); keys[code] = false; el.classList.remove("on"); };
  el.addEventListener("pointerdown", down); el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
  el.addEventListener("contextmenu", e => e.preventDefault());
}
if (navigator.userAgent.includes("MarioTennisWrapper") || location.search.includes("touch")) document.body.classList.add("touch");
$("file").addEventListener("change", async e => { const f = e.target.files[0]; if (f) loadRom(await f.arrayBuffer()); });
$("restart").addEventListener("click", start);
fetch("../rom/mario_tennis.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(loadRom).catch(() => {});
// expose for automated tests
window.__mt = { get match() { return match; }, start, keys, audio,
  get front() { return front; }, get menus() { return menus; },
  pause(p = true) { paused = p; }, step(input = {}) { tick(input); } };
requestAnimationFrame(loop);

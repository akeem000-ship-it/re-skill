// Web port entry: ROM loading, input, camera/projection, rendering, 60 fps loop.
import { Rom, sha1Hex, EXPECTED_SHA1 } from "./rom.js";
import { courtImage, screenImage, characterSprites, characterData, Animator, gameFont, ROSTER, PLAYABLE, COURTS, scoreGlyph } from "./assets.js";
import { FX } from "./physics.js";
import { Match } from "./match.js";
import { Menus } from "./menus.js";
import { Camera } from "./camera.js";
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
let rom, font, menus, match, court, sprites = [], anims = [], keys = {}, prevKeys = {};

// Projection and camera: exact port of ProjectPoint 00:2D8C / CameraFollow 08:61DC (camera.js)
const camera = new Camera();
let camPoint = -1;

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
  anims = sprites.map(sp => new Animator(sp));
  match = new Match(rom, characterData(rom, p1), characterData(rom, p2), { games: +$("games").value, sets: +$("sets").value, difficulty: +$("diff").value });
  match.audio = audio; playMusic(0x44);                                                     // match-start fanfare ($44 -> $31), then $06
  menus = null;
  const d1 = match.players[0].data, d2 = match.players[1].data;
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

// Animation ids per state (recorded in PyBoy, REVERSE.md "Animations"): 1 ready, 2 run,
// 16 serve stance, 15 serve toss, 7 serve hit, 13/14 wind-up, 9 forehand, 10 backhand, 11 high ball,
// 4 point won, 3 point lost. View 0 = back .. 4 = front, 2 = side (flipped when moving left).
function animFor(p, m) {
  if (m.state === "dead" && m.pointWinner !== undefined && m.deadT < 60) return p.side === m.pointWinner ? 4 : 3;
  if (p.swing > 0) return p.swingAnim || 9;
  if (m.server === p.side && (m.state === "serve" || m.state === "toss"))
    return m.state === "toss" ? 15 : 16;
  return Math.hypot(p.vx, p.vy) > 0.5 ? 2 : 1;
}

function frameFor(p, m, i) {
  const a = anims[i];
  a.set(animFor(p, m)); a.tick();
  const base = p.side === 0 ? 0 : 4;
  let view = base, flip = a.flip;
  if (a.id === 2) {
    const sx = Math.abs(p.vx) > Math.abs(p.vy) * 1.5, dg = !sx && Math.abs(p.vx) > Math.abs(p.vy) * 0.5;
    view = sx ? 2 : dg ? (p.vy > 0 ? 3 : 1) : (p.vy > 0 ? 4 : 0);   // +vy = toward the camera
    if (sx || dg) flip = p.vx < 0;
  }
  return { n: a.group * 5 + view, flip };
}

const SCORE_PAL = [[0, 156, 0], [255, 57, 0], [255, 255, 74], [0, 0, 0]];   // OBJ palette 1 of the score strip
function render() {
  const m = match, b = m.ball;
  // camera (08:61DC): snaps to the start view at each point, follows the ball's ground point while
  // the serve is in flight (hit count 1), then stays put; 2 px per frame, scroll aligned to 32 units
  if (m.pointNo !== camPoint) { camPoint = m.pointNo; camera.startPoint(false); }   // the port never swaps ends (wC4D4 bit 1)
  if (m.state === "rally" && m.hits === 1) camera.followGround(b.X / FX, b.Y / FX);
  camera.step();
  const { scx: camX, scy: camY } = camera.scroll();
  const proj = (X, Y, Z = 0) => camera.screen(X, Y, Z);
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.drawImage(court, -camX, -camY);
  const drawPlayer = (p, i) => {               // sprite block anchored at its bottom centre (OAM check, REVERSE.md)
    const [sx, sy] = proj(p.X, p.Y), fr = frameFor(p, m, i), img = sprites[i].frame(fr.n, fr.flip);
    g.drawImage(img, Math.floor(sx - img.width / 2), Math.floor(sy) - img.height);
  };
  const drawBall = () => {
    const [sx, sy] = proj(b.X / FX, b.Y / FX), [, hy] = proj(b.X / FX, b.Y / FX, b.Z / FX);
    g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(Math.floor(sx - 2), Math.floor(sy - 1), 4, 2);
    g.fillStyle = "#f8e030"; g.fillRect(Math.floor(sx - 1.5), Math.floor(hy - 3), 3, 3);
    g.fillStyle = "#806000"; g.fillRect(Math.floor(sx - 1.5), Math.floor(hy - 1), 3, 1);
  };
  // painter's order by depth: far player, ball, near player
  const order = [[m.players[1].Y, () => drawPlayer(m.players[1], 1)], [b.Y / FX, drawBall], [m.players[0].Y, () => drawPlayer(m.players[0], 0)]];
  order.sort((a, c) => a[0] - c[0]).forEach(([, f]) => f());
  // HUD
  g.fillStyle = "rgba(0,0,40,0.75)"; g.fillRect(0, 0, W, 11);
  const [p1, p2] = m.players.map(p => p.data.name.slice(0, 6));
  const sc = i => m.setsToWin > 1 ? `${m.sets[i]}.${m.games[i]}` : `${m.games[i]}`;      // sets.games in a multi-set match
  const hud = `${p1} ${sc(0)}  ${m.scoreText()}  ${sc(1)} ${p2}`;
  font.draw(g, hud, Math.max(1, (W - font.width(hud)) >> 1), 2);
  // the game's point-score sprite strip ("0 . 40", OBJ palette 1) after each point, at OAM (64,64)
  if (m.state === "dead" && m.pointGlyphs && m.deadT > 10) {
    const L = scoreGlyph(rom, m.pointGlyphs[0], "left", SCORE_PAL), R = scoreGlyph(rom, m.pointGlyphs[1], "right", SCORE_PAL);
    g.drawImage(L, 56, 48); g.drawImage(R, 56 + L.width, 48);
  }
  if (m.msgTimer > 0 && m.message) {
    const w = font.width(m.message) + 8;
    g.fillStyle = "rgba(200,40,20,0.9)"; g.fillRect((W - w) >> 1, 100, w, 12);
    font.draw(g, m.message, ((W - w) >> 1) + 4, 102, [255, 224, 96], [96, 16, 8]);
  }
}

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
  match.update(input); render();
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
    const k = keys, pr = prevKeys;
    const input = { left: k.ArrowLeft, right: k.ArrowRight, up: k.ArrowUp, down: k.ArrowDown,
      aPressed: (k.KeyZ || k.KeyA) && !(pr.KeyZ || pr.KeyA), bPressed: (k.KeyX || k.KeyS) && !(pr.KeyX || pr.KeyS) };
    prevKeys = { ...k };
    if (k.Enter && match.over) start();
    match.update(input);
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

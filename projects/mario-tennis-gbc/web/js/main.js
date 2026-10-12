// Web port entry: ROM loading, input, camera/projection, rendering, 60 fps loop.
import { Rom, sha1Hex, EXPECTED_SHA1 } from "./rom.js";
import { courtImage, screenImage, characterSprites, characterData, Animator, gameFont, ROSTER, PLAYABLE, COURTS } from "./assets.js";
import { FX } from "./physics.js";
import { Match } from "./match.js";
import { Menus } from "./menus.js";

const W = 160, H = 144;
const cv = document.getElementById("screen"), g = cv.getContext("2d");
g.imageSmoothingEnabled = false;
const $ = id => document.getElementById(id);
let rom, font, menus, match, court, sprites = [], anims = [], keys = {}, prevKeys = {};

// Court projection fitted to the court lines of the 32x32 court maps (REVERSE.md "Projection"):
// x = 128 + X*2020/(16224-Y), y = 127.5 + 804.6*Y/(16224-Y); heights use the same scale.
const D = 16224;
const proj = (X, Y, Z = 0) => {
  const k = 2020 / (D - Y);
  return [128 + X * k, 127.5 + 804.6 * Y / (D - Y) + Z * k * 0.85];
};

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
  if (cfg) { $("p1").value = cfg.p1; $("p2").value = cfg.p2; $("court").value = cfg.court; $("games").value = cfg.games; $("diff").value = cfg.difficulty; }
  const p1 = +$("p1").value, p2 = +$("p2").value;
  court = courtImage(rom, +$("court").value);
  sprites = [characterSprites(rom, p1), characterSprites(rom, p2)];
  anims = sprites.map(sp => new Animator(sp));
  match = new Match(rom, characterData(rom, p1), characterData(rom, p2), { games: +$("games").value, difficulty: +$("diff").value });
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
  prevKeys = { ...keys };
  if (!front.cache.has(st.id)) front.cache.set(st.id, screenImage(rom, st.id));
  front.t++;
  if (enter && st.intro) { front.step = FRONT.findIndex(s => s.title); front.t = 0; return; }
  if (st.title && enter && !front.leaving) front.leaving = front.t;
  const end = st.title ? (front.leaving ? front.leaving + FADE : Infinity) : FADE + st.hold + FADE;
  if (front.t >= end) {
    front.leaving = 0; front.t = 0;
    if (st.title) { menus = new Menus(rom, font); front = null; return; }      // Start -> the exhibition menus
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

function render() {
  const m = match, b = m.ball;
  const [bx, by] = proj(b.X / FX, b.Y / FX), near = m.players[0];
  const [, ny] = proj(near.X, near.Y);
  const camX = Math.max(0, Math.min(96, Math.round(bx - 80)));
  const camY = Math.max(0, Math.min(112, Math.round((by + ny) / 2 - 76)));
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H);
  g.drawImage(court, -camX, -camY);
  const drawPlayer = (p, i) => {
    const [sx, sy] = proj(p.X, p.Y), fr = frameFor(p, m, i), img = sprites[i].frame(fr.n, fr.flip);
    g.drawImage(img, Math.round(sx - img.width / 2 - camX), Math.round(sy - 30 - camY));
  };
  const drawBall = () => {
    const [sx, sy] = proj(b.X / FX, b.Y / FX), [, hy] = proj(b.X / FX, b.Y / FX, b.Z / FX);
    g.fillStyle = "rgba(0,0,0,0.45)"; g.fillRect(Math.round(sx - 2 - camX), Math.round(sy - 1 - camY), 4, 2);
    g.fillStyle = "#f8e030"; g.fillRect(Math.round(sx - 1.5 - camX), Math.round(hy - 3 - camY), 3, 3);
    g.fillStyle = "#806000"; g.fillRect(Math.round(sx - 1.5 - camX), Math.round(hy - 1 - camY), 3, 1);
  };
  // painter's order by depth: far player, ball, near player
  const order = [[m.players[1].Y, () => drawPlayer(m.players[1], 1)], [b.Y / FX, drawBall], [m.players[0].Y, () => drawPlayer(m.players[0], 0)]];
  order.sort((a, c) => a[0] - c[0]).forEach(([, f]) => f());
  // HUD
  g.fillStyle = "rgba(0,0,40,0.75)"; g.fillRect(0, 0, W, 11);
  const [p1, p2] = m.players.map(p => p.data.name.slice(0, 6));
  const hud = `${p1} ${m.games[0]}  ${m.scoreText()}  ${m.games[1]} ${p2}`;
  font.draw(g, hud, Math.max(1, (W - font.width(hud)) >> 1), 2);
  if (m.msgTimer > 0 && m.message) {
    const w = font.width(m.message) + 8;
    g.fillStyle = "rgba(200,40,20,0.9)"; g.fillRect((W - w) >> 1, 63, w, 12);
    font.draw(g, m.message, ((W - w) >> 1) + 4, 65, [255, 224, 96], [96, 16, 8]);
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
function loop() {
  if (menus && !paused) menuTick();
  else if (front && !paused) frontTick();
  else if (match && !paused) {
    const k = keys, pr = prevKeys;
    const input = { left: k.ArrowLeft, right: k.ArrowRight, up: k.ArrowUp, down: k.ArrowDown,
      aPressed: (k.KeyZ || k.KeyA) && !(pr.KeyZ || pr.KeyA), bPressed: (k.KeyX || k.KeyS) && !(pr.KeyX || pr.KeyS) };
    prevKeys = { ...k };
    if (k.Enter && match.over) start();
    match.update(input);
    render();
  }
  requestAnimationFrame(loop);
}

addEventListener("keydown", e => { keys[e.code] = true; if (e.code.startsWith("Arrow")) e.preventDefault(); });
addEventListener("keyup", e => { keys[e.code] = false; });
$("file").addEventListener("change", async e => { const f = e.target.files[0]; if (f) loadRom(await f.arrayBuffer()); });
$("restart").addEventListener("click", start);
fetch("../rom/mario_tennis.gbc").then(r => r.ok ? r.arrayBuffer() : Promise.reject()).then(loadRom).catch(() => {});
// expose for automated tests
window.__mt = { get match() { return match; }, start, keys,
  get front() { return front; }, get menus() { return menus; },
  pause(p = true) { paused = p; }, step(input = {}) { tick(input); } };
requestAnimationFrame(loop);

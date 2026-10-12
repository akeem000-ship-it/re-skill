// Web port entry: ROM loading, input, camera/projection, rendering, 60 fps loop.
import { Rom, sha1Hex, EXPECTED_SHA1 } from "./rom.js";
import { courtImage, characterSprites, characterData, Animator, gameFont, ROSTER, PLAYABLE, COURTS } from "./assets.js";
import { FX } from "./physics.js";
import { Match } from "./match.js";

const W = 160, H = 144;
const cv = document.getElementById("screen"), g = cv.getContext("2d");
g.imageSmoothingEnabled = false;
const $ = id => document.getElementById(id);
let rom, font, match, court, sprites = [], anims = [], keys = {}, prevKeys = {};

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
  start();
}

function start() {
  const p1 = +$("p1").value, p2 = +$("p2").value;
  court = courtImage(rom, +$("court").value);
  sprites = [characterSprites(rom, p1), characterSprites(rom, p2)];
  anims = sprites.map(sp => new Animator(sp));
  match = new Match(rom, characterData(rom, p1), characterData(rom, p2), { games: +$("games").value, difficulty: +$("diff").value });
  const d1 = match.players[0].data, d2 = match.players[1].data;
  $("info").textContent = `${d1.name} (${d1.type}) vs ${d2.name} (${d2.type})`;
  cv.focus();
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
function loop() {
  if (match && !paused) {
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
  pause(p = true) { paused = p; }, step(input = {}) { match.update(input); render(); } };
requestAnimationFrame(loop);

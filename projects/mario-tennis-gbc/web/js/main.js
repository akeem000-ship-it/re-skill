// Web port entry: ROM loading, input, camera/projection, rendering, 60 fps loop.
import { Rom, sha1Hex, EXPECTED_SHA1 } from "./rom.js";
import { courtImage, characterSprites, characterData, ROSTER, PLAYABLE, COURTS } from "./assets.js";
import { FX } from "./physics.js";
import { Match } from "./match.js";

const W = 160, H = 144;
const cv = document.getElementById("screen"), g = cv.getContext("2d");
g.imageSmoothingEnabled = false;
const $ = id => document.getElementById(id);
let rom, match, court, sprites = [], keys = {}, prevKeys = {};

// Court projection fitted to the court lines of the 32x32 court maps (REVERSE.md "Projection"):
// x = 128 + X*2020/(16224-Y), y = 127.5 + 804.6*Y/(16224-Y); heights use the same scale.
const D = 16224;
const proj = (X, Y, Z = 0) => {
  const k = 2020 / (D - Y);
  return [128 + X * k, 127.5 + 804.6 * Y / (D - Y) + Z * k * 0.85];
};

async function loadRom(buf) {
  rom = await Rom.load(buf);
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
  match = new Match(rom, characterData(rom, p1), characterData(rom, p2), { games: +$("games").value, difficulty: +$("diff").value });
  const d1 = match.players[0].data, d2 = match.players[1].data;
  $("info").textContent = `${d1.name} (${d1.type}) vs ${d2.name} (${d2.type})`;
  cv.focus();
}

// frame choice: groups of 5 facings (0 back .. 4 front); walk 0/5/10/15, ready 20,
// swings 40/50, serve toss 105, serve hit 60 (frame sheet in REVERSE.md "Sprites")
function frameFor(p, m) {
  const facing = p.side === 0 ? 0 : 4;
  if (m.state === "toss" && m.server === p.side) return { n: (m.tossT < 12 ? 105 : 60) + facing, flip: false };
  if (p.swing > 0) return { n: (p.swingType ? 50 : 40) + facing, flip: p.facing < 0 };
  const moving = Math.hypot(p.vx, p.vy) > 0.5;
  if (!moving) return { n: 20 + facing, flip: false };
  const sideways = Math.abs(p.vx) > Math.abs(p.vy) * 1.5;
  const f = sideways ? 2 : facing, step = [0, 5, 10, 15][Math.floor(p.anim) % 4];
  return { n: step + f, flip: sideways && p.vx < 0 };
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
    const [sx, sy] = proj(p.X, p.Y), fr = frameFor(p, m), img = sprites[i].frame(fr.n, fr.flip);
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
  g.font = "8px monospace"; g.fillStyle = "#fff"; g.textBaseline = "top";
  const [p1, p2] = m.players.map(p => p.data.name.slice(0, 6));
  g.fillText(`${p1} ${m.games[0]}  ${m.scoreText()}  ${m.games[1]} ${p2}`, 2, 2);
  if (m.msgTimer > 0 && m.message) {
    const w = g.measureText(m.message).width + 8;
    g.fillStyle = "rgba(200,40,20,0.9)"; g.fillRect((W - w) / 2, 64, w, 12);
    g.fillStyle = "#ffe060"; g.fillText(m.message, (W - w) / 2 + 4, 66);
  }
}

function loop() {
  if (match) {
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
window.__mt = { get match() { return match; }, start, keys };
requestAnimationFrame(loop);

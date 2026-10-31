// GAME PICKER (picker.html, the app's first screen): the two games side by side, split by a slanted gold line. The game chosen gets
// the wider half, lit; the other is dimmed. ◀ ▶ (or a tap on a half) choose, A / Start / Enter (or a tap on the chosen half) play.
//   tennis   a live 3D rally: a copy of the game (its own GBC core and 3D view, nothing of your save touched) started from the
//            beginning of a match (web/gen/demos.json.gz: web/tests/make_demos.mjs, made from the session recordings) with both
//            sides left to the game's own CPU (every on-court character's wInputSource set to 1 each frame), so it plays itself;
//            the camera cuts between TV shots every few seconds (DEMO_SHOTS: wide shots, each player close, the ball followed from the
//            stand, the court camera, the net from the umpire's side); after a game, or 50 s, the next match on another court.
//            Without the ROM (the shareable app before you load yours) or the demos, a drawn court instead.
//   golf     Mario Golf, drawn (its decompile is a project of its own, not in this app yet): COMING SOON.
// Choosing tennis opens the game (full.html, with this page's #hash); its button bar's GAMES button comes back here.
import { GBC } from "./gb/gbc.js";
import { loadState } from "./gb/state.js";
import { stateOf } from "./recorder.js";
import { Voxel3D } from "./voxel.js";
import { Rom } from "./rom.js";
import { attachLighting } from "./lighting.js";
import { attachStadium } from "./stadium3d.js";
import { attachBallFX } from "./ballfx.js";
import { drawCrest, crestFont } from "./crestlogo.js";
import { pollGamepad } from "./gamepad.js";

const $ = id => document.getElementById(id), gl = $("gl"), ov = $("ov"), g = ov.getContext("2d");
const FONT = "MT Luckiest Guy", BODY = "Itim", NAVY = "#13183a", GOLD = "#ffd65a";
const itim = typeof FontFace !== "undefined" ? new FontFace(BODY, `url(${new URL("../fonts/Itim-Regular.ttf", import.meta.url)})`).load().then(f => document.fonts.add(f)).catch(() => {}) : Promise.resolve();
const GAMES = [{ id: "tennis", ready: true }, { id: "golf", ready: false }];
let sel = 0, split = 0.6, W = 0, H = 0, dpr = 1, dirty = true, shake = 0, note = "";

// ---------------- the picture of both halves (2D, over the live view) ----------------
let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
function word(text, x, y, size, fill, align = "left") {
  g.save(); g.font = `${size}px "${FONT}"`; g.textAlign = align; g.textBaseline = "alphabetic"; g.lineJoin = "round";
  g.shadowColor = "rgba(0,0,0,.45)"; g.shadowBlur = size * 0.12; g.shadowOffsetY = size * 0.06;
  g.lineWidth = size * 0.24; g.strokeStyle = NAVY; g.strokeText(text, x, y); g.shadowColor = "transparent";
  g.lineWidth = size * 0.11; g.strokeStyle = "#fff"; g.strokeText(text, x, y);
  const gr = g.createLinearGradient(0, y - size * 0.8, 0, y); gr.addColorStop(0, fill[0]); gr.addColorStop(1, fill[1]); g.fillStyle = gr; g.fillText(text, x, y);
  g.restore();
}
function pill(x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function chip(text, x, y, size, bg = "rgba(10,12,30,.74)", fg = "#fff", align = "left") {
  g.save(); g.font = `${size}px "${BODY}"`; const w = g.measureText(text).width + size * 1.4, x0 = align === "right" ? x - w : x;
  g.fillStyle = bg; pill(x0, y - size, w, size * 2, size); g.fill(); g.fillStyle = fg; g.textBaseline = "middle"; g.fillText(text, x0 + size * 0.7, y + 1); g.restore();
}
function golfBall(x, y, r) {
  g.save(); g.translate(x, y);
  const gr = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r); gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.6, "#e9edf2"); gr.addColorStop(1, "#a9b3c2");
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, r, 0, 7); g.fill(); g.save(); g.clip();
  for (let row = -6; row <= 6; row++) for (let col = -6; col <= 6; col++) {                 // dimples, flatter towards the rim
    const px = (col + (row & 1) * 0.5) / 6.2, py = row / 6.6, d = Math.hypot(px, py); if (d > 0.97) continue;
    const k = Math.sqrt(1 - d * d), dr = r * 0.075 * (0.45 + 0.55 * k);
    g.fillStyle = `rgba(110,125,150,${0.18 + 0.2 * (1 - k)})`; g.beginPath(); g.ellipse(px * r, py * r, dr, dr * (0.5 + 0.5 * k), Math.atan2(py, px), 0, 7); g.fill();
  }
  g.restore(); g.lineWidth = Math.max(2, r * 0.05); g.strokeStyle = NAVY; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); g.restore();
}
// Mario Golf's badge: the tennis crest's shape (crestlogo.js) in green, a golf ball on a tee and a flag
function golfCrest(x, y, s) {
  const shield = () => { g.beginPath(); g.moveTo(-300 * s, -320 * s); g.quadraticCurveTo(0, -380 * s, 300 * s, -320 * s); g.lineTo(300 * s, 40 * s); g.quadraticCurveTo(280 * s, 260 * s, 0, 380 * s); g.quadraticCurveTo(-280 * s, 260 * s, -300 * s, 40 * s); g.closePath(); };
  g.save(); g.translate(x, y); g.shadowColor = "rgba(0,0,0,.5)"; g.shadowBlur = 40 * s; shield(); g.fillStyle = NAVY; g.fill(); g.shadowColor = "transparent";
  const gr = g.createLinearGradient(0, -360 * s, 0, 380 * s); gr.addColorStop(0, "#2fae4e"); gr.addColorStop(1, "#0d5a25"); shield(); g.fillStyle = gr; g.fill();
  g.lineWidth = 22 * s; g.strokeStyle = GOLD; g.stroke(); g.lineWidth = 6 * s; g.strokeStyle = NAVY; shield(); g.stroke();
  g.fillStyle = GOLD; for (const [sx, sy] of [[-200, -240], [200, -240], [0, -280]]) { g.beginPath(); for (let i = 0; i < 10; i++) { const rr = (i & 1 ? 14 : 34) * s, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(sx * s + Math.cos(a) * rr, sy * s + Math.sin(a) * rr); } g.fill(); }
  g.fillStyle = "#f4f6f8"; g.fillRect(-12 * s, 70 * s, 24 * s, 110 * s); g.beginPath(); g.moveTo(-50 * s, 70 * s); g.lineTo(50 * s, 70 * s); g.lineTo(12 * s, 100 * s); g.lineTo(-12 * s, 100 * s); g.fill();
  golfBall(0, -30 * s, 120 * s);
  g.strokeStyle = "#f4f6f8"; g.lineWidth = 10 * s; g.beginPath(); g.moveTo(170 * s, 170 * s); g.lineTo(170 * s, -160 * s); g.stroke();
  g.fillStyle = GOLD; g.beginPath(); g.moveTo(170 * s, -160 * s); g.lineTo(260 * s, -120 * s); g.lineTo(170 * s, -80 * s); g.fill();
  g.restore();
}
// the golf half's scene: sky, a tree line, the fairway and a green with its flag, a bunker and a pond (in perspective)
function golfScene(cx, y0, y1, s) {
  const sky = g.createLinearGradient(0, 0, 0, y0); sky.addColorStop(0, "#7ab8e8"); sky.addColorStop(1, "#e6f4ff"); g.fillStyle = sky; g.fillRect(0, 0, W, y0);
  for (const [x, y, k] of [[cx + 140 * s, 90 * s, 0.9], [cx - 200 * s, 60 * s, 0.7]]) { g.fillStyle = "rgba(255,255,255,.9)"; for (const [dx, dy, r] of [[0, 0, 30], [30, -12, 36], [64, 0, 28], [30, 10, 30]]) { g.beginPath(); g.arc(x + dx * k * s, y + dy * k * s, r * k * s, 0, 7); g.fill(); } }
  g.fillStyle = "#3e9a3a"; g.fillRect(0, y0, W, y1 - y0);
  g.fillStyle = "#5cc04a"; g.beginPath(); g.moveTo(cx - 60 * s, y0); g.bezierCurveTo(cx - 120 * s, y0 + (y1 - y0) * 0.4, cx - 380 * s, y1 - 40, cx - 300 * s, y1); g.lineTo(cx + 320 * s, y1); g.bezierCurveTo(cx + 260 * s, y1 - 60, cx + 120 * s, y0 + (y1 - y0) * 0.4, cx + 60 * s, y0); g.fill();
  const gy = y0 + (y1 - y0) * 0.18;
  g.fillStyle = "#7ad860"; g.beginPath(); g.ellipse(cx, gy, 120 * s, 34 * s, 0, 0, 7); g.fill();
  g.fillStyle = "#ead9a0"; g.beginPath(); g.ellipse(cx + 150 * s, y0 + (y1 - y0) * 0.3, 60 * s, 16 * s, 0.1, 0, 7); g.fill();
  g.fillStyle = "#3a8fd8"; g.beginPath(); g.ellipse(cx - 220 * s, y0 + (y1 - y0) * 0.45, 110 * s, 26 * s, -0.1, 0, 7); g.fill();
  g.strokeStyle = "#f4f4f4"; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(cx + 10 * s, gy); g.lineTo(cx + 10 * s, gy - 70 * s); g.stroke();
  g.fillStyle = "#e3242b"; g.beginPath(); g.moveTo(cx + 10 * s, gy - 70 * s); g.lineTo(cx + 44 * s, gy - 58 * s); g.lineTo(cx + 10 * s, gy - 46 * s); g.fill();
  for (let i = 0; i < 18; i++) { const x = (i + 0.5) * W / 18 + Math.sin(i * 7) * 20, y = y0; g.fillStyle = "#5a3a20"; g.fillRect(x - 3 * s, y - 6 * s, 6 * s, 14 * s); g.fillStyle = "#2f7a38"; g.beginPath(); g.arc(x, y - 18 * s, 18 * s, 0, 7); g.fill(); }
}
// the tennis half when there is no live rally: a drawn hard court and stands
function tennisScene(cx, s) {
  const sky = g.createLinearGradient(0, 0, 0, H * 0.42); sky.addColorStop(0, "#5aa8f0"); sky.addColorStop(1, "#cfe9ff"); g.fillStyle = sky; g.fillRect(0, 0, W, H);
  g.fillStyle = "#3d4a7a"; g.fillRect(0, H * 0.32, W, H * 0.13); seed = 3;
  for (let i = 0; i < 500; i++) { g.fillStyle = ["#e45", "#4ae", "#fd5", "#fff", "#8c6"][i % 5]; g.fillRect(rnd() * W, H * 0.33 + rnd() * H * 0.11, 5 * s, 5 * s); }
  g.fillStyle = "#2c9a8c"; g.fillRect(0, H * 0.45, W, H);
  const y0 = H * 0.46, y1 = H * 0.98, w0 = 210 * s, w1 = 360 * s, P = (u, v) => [cx + u * (w0 + (w1 - w0) * v), y0 + (y1 - y0) * v];
  g.fillStyle = "#2f6fd6"; g.beginPath(); for (const [u, v] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) g.lineTo(...P(u, v)); g.fill();
  g.strokeStyle = "#fff"; g.lineWidth = 3 * s; const L = (a, b) => { g.beginPath(); g.moveTo(...P(...a)); g.lineTo(...P(...b)); g.stroke(); };
  L([-1, 0], [1, 0]); L([1, 0], [1, 1]); L([1, 1], [-1, 1]); L([-1, 1], [-1, 0]); L([-0.78, 0], [-0.78, 1]); L([0.78, 0], [0.78, 1]); L([-0.78, 0.23], [0.78, 0.23]); L([-0.78, 0.77], [0.78, 0.77]); L([0, 0.23], [0, 0.77]);
  const [nx0, ny] = P(-1.12, 0.5), [nx1] = P(1.12, 0.5); g.fillStyle = "rgba(20,24,40,.55)"; g.fillRect(nx0, ny - 22 * s, nx1 - nx0, 22 * s); g.fillStyle = "#fff"; g.fillRect(nx0, ny - 24 * s, nx1 - nx0, 4 * s);
}
function drawOverlay() {
  const s = Math.min(W / 900, H / 560), k = sel === 0, at = W * split, slant = 90 * s;   // (900 x 560: a phone held sideways at 1)
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (!demo.live) { g.save(); g.beginPath(); g.moveTo(0, 0); g.lineTo(at + slant, 0); g.lineTo(at - slant, H); g.lineTo(0, H); g.clip(); tennisScene(at * 0.5, s); g.restore(); }
  if (!k) { g.save(); g.beginPath(); g.moveTo(0, 0); g.lineTo(at + slant, 0); g.lineTo(at - slant, H); g.lineTo(0, H); g.clip(); g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(0, 0, W, H); g.restore(); }
  g.save(); g.beginPath(); g.moveTo(at + slant, 0); g.lineTo(W, 0); g.lineTo(W, H); g.lineTo(at - slant, H); g.clip();
  golfScene(at + (W - at) / 2 + 30 * s, H * 0.42, H, s * 0.75);
  if (k) { g.fillStyle = "rgba(0,0,0,.45)"; g.fillRect(0, 0, W, H); }
  g.restore();
  g.save(); g.strokeStyle = GOLD; g.lineWidth = 10 * s; g.shadowColor = "rgba(255,214,90,.8)"; g.shadowBlur = 24 * s; g.beginPath(); g.moveTo(at + slant, 0); g.lineTo(at - slant, H); g.stroke(); g.restore();
  // the chosen game: its crest and wordmark large in its top corner; the other: a small badge in its corner, its name under it
  const TEN = ["#ffe27a", "#f0a818"], GOL = ["#9cf06a", "#2a9d3c"], RED = ["#ff5a48", "#c8102e"];
  if (k) {
    drawCrest(g, 150 * s, 180 * s, 0.24 * s); word("MARIO", 280 * s, 170 * s, 64 * s, RED); word("TENNIS", 280 * s, 230 * s, 64 * s, TEN);
    g.save(); g.globalAlpha = 0.75; golfCrest(W - 70 * s, 80 * s, 0.11 * s); word("MARIO GOLF", W - 70 * s, 160 * s, 22 * s, GOL, "center"); g.restore();
  } else {
    golfCrest(W - 150 * s, 180 * s, 0.24 * s); word("MARIO", W - 280 * s, 170 * s, 64 * s, RED, "right"); word("GOLF", W - 280 * s, 230 * s, 64 * s, GOL, "right");
    g.save(); g.globalAlpha = 0.75; drawCrest(g, 70 * s, 80 * s, 0.11 * s); word("MARIO TENNIS", 70 * s, 160 * s, 22 * s, TEN, "center"); g.restore();
  }
  if (k) { chip(save ? "CONTINUE" : "NEW GAME", 40 * s, 340 * s, 22 * s, GOLD, NAVY); if (demo.live && demo.names) chip(demo.names, 40 * s, 395 * s, 16 * s); }
  else chip("COMING SOON", W - 40 * s, 340 * s, 22 * s, "#9cf06a", NAVY, "right");
  const ox = shake ? Math.sin(performance.now() / 30) * 8 * s : 0;
  if (note) chip(note, W - 40 * s + ox, 395 * s, 16 * s, "rgba(10,12,30,.8)", "#fff", "right");
  g.save(); g.font = `${18 * s}px "${BODY}"`; const hint = "◀ ▶  choose a game     A  play", hw = g.measureText(hint).width + 50 * s;
  g.fillStyle = "rgba(10,12,30,.7)"; pill(W / 2 - hw / 2, H - 56 * s, hw, 40 * s, 20 * s); g.fill(); g.fillStyle = "#e9ecf4"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(hint, W / 2, H - 36 * s); g.restore();
}
const save = (() => { try { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i).startsWith("mt-sram-")) return true; } catch (e) { /* private mode */ } return false; })();

// ---------------- the live rally ----------------
const demo = { live: false, gb: null, v: null, list: [], i: -1, at: 0, games: -1, names: "" };
const romStore = (mode, fn) => new Promise((ok, fail) => {
  try { const open = indexedDB.open("mt-rom", 1); open.onupgradeneeded = () => open.result.createObjectStore("rom");
    open.onsuccess = () => { const tx = open.result.transaction("rom", mode), r = fn(tx.objectStore("rom")); tx.oncomplete = () => ok(r && r.result); tx.onerror = () => fail(tx.error); }; open.onerror = () => fail(open.error); }
  catch (e) { fail(e); }
});
async function romBytes() {
  try { const r = await fetch("../rom/mario_tennis.gbc"); if (r.ok) return new Uint8Array(await r.arrayBuffer()); } catch (e) { /* not served */ }
  try { const b = await romStore("readonly", s => s.get("rom")); if (b) return new Uint8Array(b.buffer ? b.buffer.slice(0) : b); } catch (e) { /* none kept */ }
  return null;
}
async function startDemo() {
  const rom = await romBytes(); if (!rom) return;
  let list = null;
  try { const r = await fetch("gen/demos.json.gz"); if (!r.ok) return; list = JSON.parse(await new Response(r.body.pipeThrough(new DecompressionStream("gzip"))).text()); } catch (e) { return; }
  if (!list || !list.length) return;
  const gb = new GBC(rom, { audio: false });
  try { const mod = await import("../gen/game.js"); const T = {}; mod.install(T); gb.installRecomp(T); if (mod.HRAM_SIG) gb.exec.setHramSig(mod.HRAM_SIG); } catch (e) { /* the interpreter */ }
  const v = new Voxel3D(gl, gb, new Rom(gb.mem.rom)), hud = document.createElement("div");   // (the attach* buttons go to a bar nobody sees)
  attachLighting(v, hud); attachStadium(v, hud); attachBallFX(v, hud); if (v.ballfx) v.ballfx.showSpeed = () => {};   // (no speed tags here)
  v.res = "auto"; v.replayCam = (aspect, m4, clip, st) => camera(aspect, m4, clip, st);
  Object.assign(demo, { gb, v, list: list.sort(() => Math.random() - 0.5), i: -1 });
  next();
}
// the next match, from its start
function next() {
  const d = demo, m = d.list[d.i = (d.i + 1) % d.list.length];
  loadState(d.gb, m.state); d.at = performance.now(); d.games = -1; d.v.lastFrame = -1; d.v.cur = d.v.prev = null; shot.t0 = clock(); shot.k = Math.floor(Math.random() * DEMO_SHOTS.length);
  const w = d.gb.mem.wram[0], name = a => { let o = ""; for (let i = 0; i < 16; i++) { const c = w[a + i]; if (c < 0x20 || c > 0x7E) break; o += String.fromCharCode(c); } return o.trim(); };
  const n = m.chars.length, names = Array.from({ length: n }, (_, k) => name(0xA00 + 0x80 * k)).filter(Boolean);
  d.names = names.length === 2 ? `${names[0]} vs ${names[1]}` : names.length === 4 ? `${names[0]} & ${names[2]} vs ${names[1]} & ${names[3]}` : "";
  d.live = true; dirty = true;
}
function step() {
  const d = demo, w = d.gb.mem.wram;
  for (let k = 4; k < 8; k++) if (w[k][0xF1E] !== 1 && w[k][0xF1E] !== 0xFF && (k < 6 || d.list[d.i].doubles)) w[k][0xF1E] = 1;   // every player the CPU
  d.gb.setInput(stateOf(0)); d.gb.runFrame(); d.v.tick();
  const games = w[0][0x8E2] + w[0][0x8E3] + 4 * (w[0][0x8E0] + w[0][0x8E1]);
  if (d.games < 0) d.games = games;
  if (w[0][0x32E] > 15 || games !== d.games || performance.now() - d.at > 50000) next();   // (the court left, a game won, or 50 s)
}
// ---------------- the TV shots ----------------
const SHOT = 4.5, lerp = (a, b, u) => a + (b - a) * u, ease = u => u * u * (3 - 2 * u);
const shot = { t0: 0, k: 0, track: null };
// each: (u through the shot, the players' and ball's positions, the tracked point) -> [eye, look at, lens]; null: the court camera
const DEMO_SHOTS = [
  (u, s, t) => [[lerp(-1800, 1800, u) + t[0] * 0.3, 1500, 3400], [t[0] * 0.5, 0, t[1] * 0.5 - 200], 0.7],                                 // wide, high behind the near end
  (u, s, t) => { const p = s.p1 || { X: 0, Y: 1200 }; return [[p.X + lerp(-500, 500, u), lerp(300, 240, u), p.Y + 1150], [p.X, 90, p.Y - 150], lerp(0.55, 0.48, u)]; },   // the near player, low behind
  (u, s, t) => [[1890, 900, t[1] + 650], [t[0], 60, t[1]], 0.62],                                                                           // the TV camera over the right-hand stand, with the ball
  (u, s, t) => { const p = s.p2 || { X: 0, Y: -1200 }; return [[p.X + lerp(380, -380, u), lerp(420, 330, u), p.Y + 1300], [p.X, 100, p.Y], lerp(0.42, 0.34, u)]; },   // the far player, from across the net
  () => null,                                                                                                                             // the game's own court camera
  (u, s, t) => [[lerp(1600, 1300, u), 1050, lerp(400, -400, u)], [t[0] * 0.3, 90, t[1] * 0.3], 0.7],                                       // the net from the umpire's side
];
const clock = () => (window.__picker && window.__picker.clock ? window.__picker.clock() : performance.now());   // (tests: a clock of their own)
function camera(aspect, m4, clip, st) {
  const now = clock(), t = (now - shot.t0) / 1000, k = Math.floor(t / SHOT), u = (t % SHOT) / SHOT;
  const players = (st && st.players) || [], p1 = players.find(q => q.slot === 4), p2 = players.find(q => q.slot === 5), b = (st && st.ball) || { X: 0, Y: 0 };
  const want = [b.X || 0, b.Y || 0]; shot.track = shot.track ? [lerp(shot.track[0], want[0], 0.06), lerp(shot.track[1], want[1], 0.06)] : want;   // (eased, no jitter)
  const sh = DEMO_SHOTS[(shot.k + k) % DEMO_SHOTS.length](u, { p1, p2 }, shot.track); if (!sh) return null;
  return { mvp: m4.mul(m4.perspective(sh[2], aspect, clip.near, clip.far), m4.lookAt(sh[0], sh[1], [0, 1, 0])), tilt: 0 };
}
// ---------------- choosing ----------------
function choose(i) { if (i === sel) return; sel = i; note = ""; dirty = true; }
function play() {
  if (!GAMES[sel].ready) { note = "Mario Golf is still being decompiled: soon"; shake = performance.now(); dirty = true; return; }
  location.href = "full.html" + location.search + location.hash;
}
const keys = {};
addEventListener("keydown", e => { keys[e.code] = true; if (e.code === "ArrowLeft") choose(0); if (e.code === "ArrowRight") choose(1); if (e.code === "Enter" || e.code === "KeyZ" || e.code === "Space") play(); });
addEventListener("keyup", e => { keys[e.code] = false; });
ov.addEventListener("pointerdown", e => { const half = e.clientX < W * split ? 0 : 1; if (half === sel) play(); else choose(half); });
let padWas = 0;
function pad() {
  const m = pollGamepad({}), edge = m & ~padWas; padWas = m;
  if (edge & 32) choose(0); if (edge & 16) choose(1); if (edge & (1 | 8)) play();
}
// ---------------- the loop ----------------
function resize() {
  dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  ov.width = Math.round(W * dpr); ov.height = Math.round(H * dpr); dirty = true;
}
addEventListener("resize", resize); resize();
let last = performance.now(), acc = 0;
function loop(now) {
  pad();
  const want = sel === 0 ? 0.6 : 0.4; if (Math.abs(split - want) > 0.001) { split += (want - split) * 0.15; dirty = true; }
  if (shake && now - shake > 450) { shake = 0; dirty = true; } else if (shake) dirty = true;
  if (demo.v) {
    acc = Math.min(acc + now - last, 100);
    while (acc >= 1000 / 59.73) { step(); acc -= 1000 / 59.73; }
    try { demo.v.render(demo.gb.ppu.frame, 1); } catch (e) { console.warn("demo", e); demo.v = null; demo.live = false; dirty = true; }
  }
  last = now;
  if (dirty) { drawOverlay(); dirty = false; }
  requestAnimationFrame(loop);
}
Promise.all([crestFont, itim]).then(() => { dirty = true; });
requestAnimationFrame(loop);
startDemo().catch(e => console.warn("demo", e));
// (tests)
window.__picker = { get demo() { return demo; }, choose, play, next, clock: null,
  advance(n) { for (let i = 0; i < n; i++) step(); demo.v.render(demo.gb.ppu.frame, 1); } };

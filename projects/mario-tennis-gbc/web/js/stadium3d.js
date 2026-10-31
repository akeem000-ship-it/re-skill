// 3D stadium for the court view ("STADIUM: Classic / 3D"). A render-time layer: it only changes how the 3D / VOX court's
// surroundings are drawn; it reads the game (the score bytes, to make the crowd cheer) and never writes it, so frame hashes and
// replays are untouched. Everything is generated here in code, at runtime, from the court's own picture:
//   * stepped stands (side and far) with seat rows and a crowd: seat colours from the stadium map's seats, crowd colours from them
//     and the court's accent colours; the crowd bobs, and jumps with its arms up for a few seconds after every point; now and then
//     between points the crowd does the wave (round the stands twice, arms up as it passes; the serve stops it),
//   * the back wall gets thickness and a coping in its own colours; where the court's backdrop shows hedges and flower beds
//     (found by colour in the picture) rounded-voxel hedges with flower boxes grow in front of it; the near fence gets posts,
//   * the umpire chair is built from boxes in the chair picture's colours, with its ladder and umpire,
//   * a scoreboard above the far stands (dot-matrix points from the game's score bytes) and floodlight towers standing exactly
//     where lighting.js hangs its floodlights (so night glare and the towers line up),
//   * all of it is solid depth geometry, so LIGHT's sun shadows fall from it.
// Static geometry (a few thousand boxes in one instanced buffer, the crowd in another) is built once per court and palette.
// voxel.js has four small hooks (marked "STADIUM"): paint() after the court picture is painted, draw() in place of the flat
// stands, cut() for the cut-outs it replaces (the umpire chair), and the constructor field.
import { palettes, tilePixel } from "./rom.js";
import { buildFanAtlas, CELL } from "./crowdfans.js";
import { FLOODS, FLOOD_HEIGHT } from "./lighting.js";
import { FAR_WALL_MAPS } from "./farwalls.js";   // FAR END: Walls
import { poseCanvas, POSE_FRAMES } from "./look/poses.js";
import { venueFor, seasonNow, seasonSetting, setSeasonSetting, SEASONS, homeLevel, homeUpgrades, EXTRAS } from "./venues.js";
import { toast } from "./hdpanel.js";
import { markSeen } from "./venuetour.js";   // VENUES: each court's stadium in its own style
import { Courtside } from "./courtside.js";
import { Ambience } from "./ambience.js";
import { CourtWear } from "./courtwear.js";   // COURT WEAR: scuffs and ball marks that build up
import { surfaceKind } from "./courtfloor.js";
import { BigMoments, VIP } from "./bigmoments.js";   // BIG MOMENTS: venue events, the trophy, the VIP box, the card display   // AMBIENCE: the venue's particles and background sound   // COURTSIDE: ball kids, line judges, benches, the TV crane, flags in the wind
const KEY = "mt-stadium", QKEY = "mt-stadium-q";
export const STADIUM_MODES = ["classic", "3d"];
const STADIUM_MAP = 32, SIZES_KEY = "mt-crowd2", JUDGE_TOP = 0.5;   // the part of the chair picture (from the top) that is the umpire

// the gardens behind the far fences (court map: bushes [x, row, radius] in picture px, the flower bed [x0, y0, x1, y1], the flower beds
// before the fence [x0, x1], the gate [x0, x1, top row, bottom row])
const GARDEN_A = { bushes: [[8, 4, 9], [7, 12, 7], [24, 8, 9], [48, 12, 7], [206, 12, 7], [232, 8, 9], [248, 4, 9], [249, 12, 7]], bed: [106, 1, 148, 12], corners: [[0, 36], [220, 256]], gate: [64, 96, 24, 39] };
const GARDENS = { 3: GARDEN_A, 4: GARDEN_A, 5: GARDEN_A,
  8: { bushes: [[8, 3, 6], [40, 3, 7], [104, 3, 6], [120, 3, 7], [136, 3, 6], [152, 3, 6], [184, 3, 7], [232, 3, 6], [248, 3, 7]], bed: null, corners: null, gate: [64, 96, 24, 40] } };
// ---- small helpers ----
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
// the tour's matches in order ($C8F7: 0 junior practice, 1-4 junior ranking, 5 senior practice, 6-9 senior ranking, $0A-$0D varsity, $10-$13
// the Island Open rounds, $16-$18 dream matches)
const TOUR = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0x0A, 0x0B, 0x0C, 0x0D, 0x10, 0x11, 0x12, 0x13, 0x16, 0x17, 0x18];
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const pack = c => ((clamp(Math.round(c[0]), 0, 255) << 16) | (clamp(Math.round(c[1]), 0, 255) << 8) | clamp(Math.round(c[2]), 0, 255));
const lum = c => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
const sat = c => { const m = Math.max(...c), n = Math.min(...c); return m ? (m - n) / m : 0; };
const hue = c => { const [r, g, b] = c, m = Math.max(r, g, b), n = Math.min(r, g, b), d = m - n; if (!d) return 0; let h = m === r ? ((g - b) / d) % 6 : m === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
const hueDist = (a, b) => { const d = Math.abs(hue(a) - hue(b)); return Math.min(d, 360 - d); };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const isGreen = c => c[1] > c[0] + 22 && c[1] > c[2] + 8;
// the colours of a picture rectangle, most common first (5 bits per channel buckets, averaged); pred filters
function colours(img, W, x0, y0, x1, y1, pred) {
  const m = new Map();
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const o = (y * W + x) * 4; if (img[o + 3] === 0) continue;
    const r = img[o], g = img[o + 1], b = img[o + 2]; if (pred && !pred([r, g, b])) continue;
    const k = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3); let e = m.get(k); if (!e) m.set(k, e = { r: 0, g: 0, b: 0, n: 0 }); e.r += r; e.g += g; e.b += b; e.n++;
  }
  return [...m.values()].map(e => ({ c: [e.r / e.n, e.g / e.n, e.b / e.n], n: e.n })).sort((a, b) => b.n - a.n);
}
const SKIN = [[255, 214, 176], [236, 184, 140], [205, 148, 104], [150, 100, 68], [104, 68, 46]];

// ---- shaders ----
// boxes: one unit cube drawn per instance (aA = x, y(bottom), z, packed colour; aB = size x, y, z, colour jitter amplitude)
// the floodlights' beams at night: soft additive cones from each tower's lamp head down onto the court (aT.x: 0 at the lamp .. 1 on the
// ground, aT.y: -1 .. 1 across), brightest near the lamp and in the middle, fading out towards the ground and the edges
const VS_BEAM = `#version 300 es
in vec3 aP; in vec2 aT; uniform mat4 uMVP; out vec2 vT;
void main() { vT = aT; gl_Position = uMVP * vec4(aP, 1.0); }`;
const FS_BEAM = `#version 300 es
precision mediump float; in vec2 vT; uniform float uK; out vec4 o;
void main() { float a = pow(1.0 - vT.x, 1.15) * (1.0 - vT.y * vT.y) * uK; o = vec4(1.0, 0.95, 0.80, a); }`;
const VS_BOX = `#version 300 es
in vec3 aCorner; in float aShade; in vec4 aA; in vec4 aB; uniform mat4 uMVP; out vec3 vCol;
void main() {
  vec3 p = aA.xyz + (aCorner - vec3(0.5, 0.0, 0.5)) * aB.xyz; float pk = aA.w;
  vec3 c = vec3(floor(pk / 65536.0), mod(floor(pk / 256.0), 256.0), mod(pk, 256.0)) / 255.0;
  float j = fract(sin(dot(aA.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453) - 0.5;
  vCol = clamp(c * (1.0 + j * aB.w), 0.0, 1.0) * aShade; gl_Position = uMVP * vec4(p, 1.0);
}`;
const FS_BOX = `#version 300 es
precision mediump float; in vec3 vCol; out vec4 o; void main() { o = vec4(vCol, 1.0); }`;
// the crowd: one camera-facing billboard per fan (a random fan of crowdfans.js: the game's own character frames, recoloured), the upper body only.
// aP = x, y, z (seat), phase; aQ = fan, size, threshold (a seat is occupied when threshold < uFill: the crowd size), hops (1: one of the third
// that hop and use the cheering frame while uCheer > 0). uRight: the camera's right on the ground. uWave: the wave's front (an angle round
// the court) and its strength: the fans it passes stand up with their arms up.
const VS_CROWD = `#version 300 es
in vec4 aP; in vec4 aQ; uniform mat4 uMVP; uniform vec3 uRight; uniform float uT, uCheer, uFill, uShow; uniform vec2 uCells, uWave; out vec2 vUV;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  if (aQ.z > uFill) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUV = vec2(0.0); return; }
  float ph = aP.w * 6.2831, hop = aQ.w, da = mod(atan(aP.z, aP.x) - uWave.x + 3.14159, 6.28318) - 3.14159, wv = uWave.y * exp(-da * da * 18.0);
  float cheering = ((uCheer > 0.0 && hop > 0.5) || wv > 0.45) ? 1.0 : 0.0, cell = aQ.x * 2.0 + cheering;
  vec2 cc = vec2(mod(cell, uCells.x), floor(cell / uCells.x));
  float sz = aQ.y * 3.6 * 32.0, lift = hop > 0.5 ? uCheer * max(0.0, sin(uT * 8.0 + ph)) * 46.0 : 0.0;
  lift += sin(uT * 1.6 + ph * 3.0) * 0.6 * (1.0 + uCheer * 2.0) + wv * 52.0;
  vec3 p = aP.xyz + vec3(0.0, lift, 0.0) + uRight * (c.x - 0.5) * sz + vec3(0.0, c.y * uShow * sz, 0.0);
  vUV = (cc + vec2(c.x, uShow * (1.0 - c.y))) / uCells;
  gl_Position = uMVP * vec4(p, 1.0);
}`;
const FS_CROWD = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uAtlas; uniform float uBright; out vec4 o;
void main() { vec4 c = texture(uAtlas, vUV); if (c.a < 0.5) discard; o = vec4(c.rgb * uBright, 1.0); }`;
// the unit cube without its bottom face (30 vertices: x, y, z in 0..1 and the face shade), faces wound outwards
function cubeVerts() {
  const out = [], faces = [[[1, 0, 0], [0, 1, 0], [0, 0, 1], 0.74], [[-1, 0, 0], [0, 0, 1], [0, 1, 0], 0.70], [[0, 1, 0], [0, 0, 1], [1, 0, 0], 1.0], [[0, 0, 1], [1, 0, 0], [0, 1, 0], 0.88], [[0, 0, -1], [0, 1, 0], [1, 0, 0], 0.62]];
  for (const [n, t1, t2, sh] of faces) {
    const c0 = [0.5 + n[0] * 0.5 - t1[0] * 0.5 - t2[0] * 0.5, 0.5 + n[1] * 0.5 - t1[1] * 0.5 - t2[1] * 0.5, 0.5 + n[2] * 0.5 - t1[2] * 0.5 - t2[2] * 0.5];
    const P = [c0, c0.map((v, i) => v + t1[i]), c0.map((v, i) => v + t1[i] + t2[i]), c0.map((v, i) => v + t2[i])];
    for (const k of [0, 1, 2, 0, 2, 3]) out.push(P[k][0], P[k][1], P[k][2], sh);
  }
  return new Float32Array(out);
}
// the stadium map (RPG map 32) as RGBA, decoded only where the stands are (the same decoding as assets.js courtImage): the colours of
// the seats and the concrete come from it
function stadiumPixels(rom) {
  const base = 0x59D9 + STADIUM_MAP * 16, ref = i => [rom.u8(0x0A, base + i * 2), rom.u8(0x0A, base + i * 2 + 1)];
  const [pi, pb] = ref(1), [mi, mb] = ref(2), [ai, ab] = ref(3), [ti, tb] = ref(7);
  const pal = palettes(rom.rawRef(pi, pb, 64)), tmap = rom.lzRef(mi, mb), attr = rom.lzRef(ai, ab), tiles = rom.lzRef(ti, tb), S = tmap.length >= 4096 ? 64 : 32, W = S * 8;
  const vram = new Uint8Array(0x1800); vram.set(tiles.subarray(0, 0x800), 0x1000); vram.set(tiles.subarray(0x800, 0x1000), 0x800);
  const d = new Uint8ClampedArray(W * W * 4);
  for (const [x0, y0, x1, y1] of [[18, 112, 120, 296], [290, 112, 370, 296], [18, 12, 370, 96]]) {
    for (let ty = y0 >> 3; ty < (y1 + 7) >> 3; ty++) for (let tx = x0 >> 3; tx < (x1 + 7) >> 3; tx++) {
      const i = ty * S + tx, t = tmap[i], at = attr[i], off = 0x1000 + (t < 128 ? t : t - 256) * 16, p = pal[at & 7];
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const col = p[tilePixel(vram, off, at & 0x20 ? 7 - x : x, at & 0x40 ? 7 - y : y)], o = ((ty * 8 + y) * W + tx * 8 + x) * 4; d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
      }
    }
  }
  return { d, w: W };
}
class Boxes {
  constructor() { this.a = new Float32Array(8 * 4096); this.n = 0; }
  add(x, y, z, sx, sy, sz, rgb, jit = 0) {
    if ((this.n + 1) * 8 > this.a.length) { const b = new Float32Array(this.a.length * 2); b.set(this.a); this.a = b; }
    this.a.set([x, y, z, pack(rgb), sx, sy, sz, jit], this.n * 8); this.n++;
  }
  data() { return this.a.subarray(0, this.n * 8); }
}

// the scoreboard's dot-matrix letters: 3 x 5 dots, rows top to bottom
const BOARD_FONT = { 0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001", 5: "111100111001111",
  6: "111100111101111", 7: "111001001001001", 8: "111101111101111", 9: "111101111001111", " ": "000000000000000",
  A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110", E: "111100110100111", F: "111100110100100",
  G: "011100101101011", H: "101101111101101", I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
  M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "111101111100100", Q: "010101101110011", R: "110101110101101",
  S: "011100010001110", T: "111010010010010", U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
  Y: "101101010010010", Z: "111001010100111" };

// ---- ADS: the boards along the stands carry Mushroom Kingdom adverts, painted here at run time (simple shapes and text; nothing is
// taken from the ROM or stored as a picture) ----
const AD_W = 384, AD_H = 104;
const ADS = [
  { bg: ["#e52521", "#a30f12"], fg: "#ffffff", text: "MARIO TENNIS", icon: "ball" },
  { bg: ["#ffffff", "#e8e8ee"], fg: "#e52521", text: "SUPER MUSHROOM", icon: "mushroom" },
  { bg: ["#1d2b7a", "#0b1240"], fg: "#ffd21f", text: "STAR POWER", icon: "star" },
  { bg: ["#ff8fc7", "#e0559c"], fg: "#ffffff", text: "PEACH'S CASTLE", icon: "crown" },
  { bg: ["#43b047", "#1f7a26"], fg: "#ffffff", text: "YOSHI'S ISLAND", icon: "egg" },
  { bg: ["#ffd21f", "#e0a800"], fg: "#6b3a12", text: "DK BANANAS", icon: "banana" },
  { bg: ["#2a2a2e", "#111114"], fg: "#ff7a1a", text: "BOWSER'S CASTLE", icon: "flame" },
  { bg: ["#ffffff", "#e8e8ee"], fg: "#2e9e3e", text: "1-UP", icon: "oneup" },
  { bg: ["#7a2ec8", "#4a1585"], fg: "#ffe14a", text: "WARIO GOLD", icon: "coin" },
  { bg: ["#f0f0f4", "#d0d0d8"], fg: "#e52521", text: "NINTENDO", icon: null },
  { bg: ["#ff7a1a", "#c94d00"], fg: "#ffffff", text: "FIRE FLOWER", icon: "flower" },
  { bg: ["#55d0ff", "#1f8fd0"], fg: "#ffffff", text: "GAME BOY COLOR", icon: null },
];
const AD_COUNT = ADS.length;
function adIcon(g, kind, x, y, s) {
  const circle = (cx, cy, r, c) => { g.fillStyle = c; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill(); };
  g.save(); g.translate(x, y); g.lineWidth = s * 0.06; g.strokeStyle = "rgba(0,0,0,.55)";
  if (kind === "ball") { circle(0, 0, s * 0.42, "#e4f44a"); g.strokeStyle = "#fff"; g.lineWidth = s * 0.05; g.beginPath(); g.arc(-s * 0.42, 0, s * 0.36, -0.9, 0.9); g.stroke(); g.beginPath(); g.arc(s * 0.42, 0, s * 0.36, Math.PI - 0.9, Math.PI + 0.9); g.stroke(); }
  else if (kind === "mushroom" || kind === "oneup") {
    const cap = kind === "oneup" ? "#2e9e3e" : "#e52521";
    g.fillStyle = "#f6e2b8"; g.fillRect(-s * 0.2, -s * 0.05, s * 0.4, s * 0.42); g.strokeRect(-s * 0.2, -s * 0.05, s * 0.4, s * 0.42);
    circle(-s * 0.08, s * 0.14, s * 0.04, "#222"); circle(s * 0.08, s * 0.14, s * 0.04, "#222");
    g.fillStyle = cap; g.beginPath(); g.arc(0, 0, s * 0.42, Math.PI, 0); g.closePath(); g.fill(); g.stroke();
    circle(0, -s * 0.24, s * 0.1, "#fff"); circle(-s * 0.28, -s * 0.08, s * 0.08, "#fff"); circle(s * 0.28, -s * 0.08, s * 0.08, "#fff");
  } else if (kind === "star") {
    g.fillStyle = "#ffd21f"; g.beginPath(); for (let i = 0; i < 10; i++) { const r = i & 1 ? s * 0.2 : s * 0.46, a = -Math.PI / 2 + i * Math.PI / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); g.fill(); g.stroke();
    circle(-s * 0.08, -s * 0.02, s * 0.035, "#222"); circle(s * 0.08, -s * 0.02, s * 0.035, "#222");
  } else if (kind === "crown") {
    g.fillStyle = "#ffd21f"; g.beginPath(); g.moveTo(-s * 0.4, s * 0.25); g.lineTo(-s * 0.4, -s * 0.2); g.lineTo(-s * 0.2, 0); g.lineTo(0, -s * 0.32); g.lineTo(s * 0.2, 0); g.lineTo(s * 0.4, -s * 0.2); g.lineTo(s * 0.4, s * 0.25); g.closePath(); g.fill(); g.stroke();
    circle(0, s * 0.1, s * 0.07, "#3a9cff"); circle(-s * 0.24, s * 0.12, s * 0.05, "#e52521"); circle(s * 0.24, s * 0.12, s * 0.05, "#e52521");
  } else if (kind === "egg") {
    g.fillStyle = "#fff"; g.beginPath(); g.ellipse(0, 0, s * 0.3, s * 0.4, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    circle(-s * 0.1, -s * 0.12, s * 0.08, "#43b047"); circle(s * 0.12, s * 0.06, s * 0.09, "#43b047"); circle(-s * 0.06, s * 0.22, s * 0.06, "#43b047");
  } else if (kind === "banana") {
    g.strokeStyle = "#ffe14a"; g.lineWidth = s * 0.2; g.lineCap = "round"; g.beginPath(); g.arc(s * 0.15, -s * 0.15, s * 0.36, 1.7, 3.3); g.stroke();
    g.strokeStyle = "#6b3a12"; g.lineWidth = s * 0.05; g.beginPath(); g.arc(s * 0.15, -s * 0.15, s * 0.46, 1.75, 3.25); g.stroke();
  } else if (kind === "flame") {
    g.fillStyle = "#ff7a1a"; g.beginPath(); g.moveTo(0, -s * 0.45); g.quadraticCurveTo(s * 0.4, 0, s * 0.2, s * 0.35); g.quadraticCurveTo(0, s * 0.45, -s * 0.2, s * 0.35); g.quadraticCurveTo(-s * 0.4, 0, 0, -s * 0.45); g.fill();
    g.fillStyle = "#ffd21f"; g.beginPath(); g.moveTo(0, -s * 0.15); g.quadraticCurveTo(s * 0.2, s * 0.1, s * 0.1, s * 0.3); g.quadraticCurveTo(0, s * 0.36, -s * 0.1, s * 0.3); g.quadraticCurveTo(-s * 0.2, s * 0.1, 0, -s * 0.15); g.fill();
  } else if (kind === "coin") {
    circle(0, 0, s * 0.4, "#ffd21f"); g.stroke(); g.fillStyle = "#e0a800"; g.fillRect(-s * 0.06, -s * 0.24, s * 0.12, s * 0.48);
  } else if (kind === "flower") {
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; circle(Math.cos(a) * s * 0.2, Math.sin(a) * s * 0.2 - s * 0.08, s * 0.16, i & 1 ? "#ffd21f" : "#ff7a1a"); }
    circle(0, -s * 0.08, s * 0.12, "#fff"); g.fillStyle = "#43b047"; g.fillRect(-s * 0.04, s * 0.1, s * 0.08, s * 0.32);
  }
  g.restore();
}
// the boards' artwork, all of it on one texture: each ad a row of AD_H, AD_PAD apart (the gaps keep the smaller mip levels from
// bleeding one ad into the next); { tex, rows, v(i) -> [v0, v1] of ad i }
const AD_PAD = 8;
function adAtlas(gl) {
  const n = ADS.length, rowH = AD_H + AD_PAD, c = document.createElement("canvas"); c.width = AD_W; c.height = n * rowH; const g = c.getContext("2d");
  ADS.forEach((a, i) => {
    g.save(); g.translate(0, i * rowH); g.beginPath(); g.rect(0, 0, AD_W, AD_H); g.clip();
    const gr = g.createLinearGradient(0, 0, 0, AD_H); gr.addColorStop(0, a.bg[0]); gr.addColorStop(1, a.bg[1]); g.fillStyle = gr; g.fillRect(0, 0, AD_W, AD_H);
    g.fillStyle = "rgba(255,255,255,.18)"; g.fillRect(0, 0, AD_W, AD_H * 0.42);                       // a gloss across the top
    const iconW = a.icon ? AD_H : 0; if (a.icon) adIcon(g, a.icon, AD_H * 0.55, AD_H / 2, AD_H * 0.9);
    let size = 54; g.font = `900 ${size}px "Arial Black", Impact, sans-serif`;
    const room = AD_W - iconW - 24; while (g.measureText(a.text).width > room && size > 20) { size -= 2; g.font = `900 ${size}px "Arial Black", Impact, sans-serif`; }
    g.textAlign = "center"; g.textBaseline = "middle"; const tx = iconW + (AD_W - iconW) / 2, ty = AD_H / 2 + 3;
    g.lineWidth = Math.max(3, size * 0.12); g.strokeStyle = "rgba(0,0,0,.35)"; g.strokeText(a.text, tx + 2, ty + 2); g.fillStyle = a.fg; g.fillText(a.text, tx, ty);
    g.restore();
    g.drawImage(c, 0, i * rowH + AD_H - 1, AD_W, 1, 0, i * rowH + AD_H, AD_W, AD_PAD / 2);                // (the gap half filled with each
    if (i) g.drawImage(c, 0, i * rowH, AD_W, 1, 0, i * rowH - AD_PAD / 2, AD_W, AD_PAD / 2);              // neighbour's edge row)
  });
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.generateMipmap(gl.TEXTURE_2D);
  for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
  const H = c.height; return { tex: t, v: i => [(i * rowH + 0.5) / H, (i * rowH + AD_H - 0.5) / H] };
}
// every board as two triangles in world space, for the 3D mesh program (voxel.js prog3: aPos3, aUV3): one draw for them all. A board's
// model m places voxel.js's quad (x -0.5..0.5, y 0..1 up; u 0..1, v 1 at the bottom)
function adMesh(gl, boards, atlas, adOf) {
  const pos = [], uv = [], P = (m, x, y) => [m[0] * x + m[4] * y + m[12], m[1] * x + m[5] * y + m[13], m[2] * x + m[6] * y + m[14]];
  boards.forEach((b, i) => {
    const m = b.m, [v0, v1] = atlas.v(adOf(b, i)), A = P(m, -0.5, 0), B = P(m, 0.5, 0), C = P(m, 0.5, 1), D = P(m, -0.5, 1);
    pos.push(...A, ...B, ...C, ...A, ...C, ...D); uv.push(0, v1, 1, v1, 1, v0, 0, v1, 1, v0, 0, v0);
  });
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
  return { vao, pb, ub, count: pos.length / 3 };
}
// the players' tunnels, through the bottom rows of the side stands beside the net, opening onto the court (x, z: the centre of the mouth at
// the stand's inner edge; dir: into the stand along x; w wide, d deep, h high): stadium3d.js builds them, intro.js walks the players out of them
// (yours in the left stand on the near side of the net, your opponent's in the right stand on the far side, clear of the umpire's chair)
// (the side stands stand SIDE_IN from the middle: 240 further out than the game's own picture of them, so the court has room round it)
export const SIDE_IN = 1420;
export const TUNNELS = [{ side: 0, x: -SIDE_IN, z: 260, dir: -1, w: 200, d: 240, h: 250, col: [200, 30, 40] }, { side: 1, x: SIDE_IN, z: -260, dir: 1, w: 200, d: 240, h: 250, col: [30, 80, 200] }];
export class Stadium3D {
  constructor(voxel) {
    this.v = voxel; this.gl = voxel.gl;
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("stadium"); if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.forceGiant = m === "giant" || q.get("giant") === "1"; if (m === "giant") m = "3d";   // GIANT: ?stadium=giant tries the finals' stadium anywhere
    this.mode = STADIUM_MODES.includes(m) ? m : "3d";
    this.pend = null; this.built = null; this.sig = ""; this.buildAt = -99; this.cheer = 0; this.cheerAt = -99; this.fill = 0.6; this.scoreSig = ""; this.stats = { boxes: 0, crowd: 0, ms: 0 };
    this.board = null; this.stadiumImg = null; this.onMode = null; this.side = new Courtside(this); this.amb = new Ambience(this); this.wear = new CourtWear(voxel); this.mom = new BigMoments(this);
    let qv = q.get("detail"); if (qv === null) { try { qv = localStorage.getItem(QKEY); } catch (e) { qv = null; } } this.quality = qv === "lite" ? "lite" : "full";   // DETAIL: Full / Lite
  }
  get active() { return this.mode === "3d" && !this.broken; }
  get holding() { return this.active && ((this.mom && this.mom.holding) || !!(this.v.venueTour && !this.v.venueTour.attract)); }   // (VENUE TOUR holds it too; the title show does not)   // (BIG MOMENTS: the trophy ceremony holds the game, as the intro does)
  // GIANT: the finals (the Island Open's rounds and the dream matches: crowdClass "major") get the giant stadium: an upper deck all round
  // over a concourse, closing the far corners, under a roof with floodlight banks along its edge, flags, and two video screens
  wantGiant() { return !this.v.isDrill() && (this.forceGiant || this.crowdClass() === "major"); }
  setMode(m) { this.mode = STADIUM_MODES.includes(m) ? m : "3d"; try { localStorage.setItem(KEY, this.mode); } catch (e) { /* private mode */ } if (this.onMode) this.onMode(this.mode); }
  setQuality(qv) { this.quality = qv === "lite" ? "lite" : "full"; try { localStorage.setItem(QKEY, this.quality); } catch (e) { /* private mode */ } if (this.painted) this.pend = this.painted; if (this.onQuality) this.onQuality(this.quality); }
  reset() { this.free(); this.pend = null; this.sig = ""; this.stadiumImg = null; }
  free() {
    const gl = this.gl, b = this.built; if (!b) return;
    for (const k of ["boxBuf", "crowdBuf"]) if (b[k]) gl.deleteBuffer(b[k]); if (b.boxVao) gl.deleteVertexArray(b.boxVao); if (b.crowdVao) gl.deleteVertexArray(b.crowdVao);
    this.built = null;
  }

  // ---- GL setup (once) ----
  gfx() {
    if (this.pBox) return;
    const gl = this.gl, v = this.v;
    this.pBox = v.link(VS_BOX, FS_BOX, ["aCorner", "aShade", "aA", "aB"]); this.uBox = { uMVP: gl.getUniformLocation(this.pBox, "uMVP") };
    this.pCrowd = v.link(VS_CROWD, FS_CROWD, ["aP", "aQ"]); this.uCrowd = Object.fromEntries(["uMVP", "uRight", "uT", "uCheer", "uFill", "uShow", "uCells", "uWave", "uAtlas", "uBright"].map(n => [n, gl.getUniformLocation(this.pCrowd, n)]));
    this.cube = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cube); gl.bufferData(gl.ARRAY_BUFFER, cubeVerts(), gl.STATIC_DRAW);
  }
  // the fans' atlas (random, from the ROM's match characters; once per ROM)
  // VENUES: each venue its own crowd (venues.js fans: the characters it draws its fans from); one atlas per venue, kept
  fanTexture(VEN) {
    const v = this.v, key = VEN && VEN.fans ? VEN.name : "", M = this.fanSets || (this.fanSets = new Map());
    if (!M.has(key)) { let f = null; try { f = v.rom ? buildFanAtlas(v.rom.b || v.rom, 20260101 + key.length * 131, 96, VEN && VEN.fans || {}) : null; } catch (e) { console.warn("fans", e); } M.set(key, { fans: f, tex: f ? v.texture(f.w, f.h, f.data, false) : null }); }
    const e = M.get(key); this.fans = e.fans; this.fanTex = e.tex; return this.fanTex;
  }

  // ---- hooks called by voxel.js ----
  // after the court picture is painted (bg: 256x256 RGBA of the court with the live palettes); the geometry follows at the next draw
  paint(bg, courtId) { this.pend = this.painted = { bg, courtId, at: this.v.gb.ppu.frames }; }

  // ---- reading the game ----
  tick() {
    const v = this.v, fr = v.gb.ppu.frames; if (this.lastFr === fr) return; this.lastFr = fr;
    const w = v.gb.mem.wram[0], sig = Array.from(w.subarray(0x8E0, 0x8EC)).join();
    if (sig !== this.scoreSig) { this.scoreSig = sig; this.boardDirty = true; }
  }
  // ---- crowd size by class of match ----
  // gameMode ($C8A6): 1 ranking match, 2 Island Open, 3 practice, 4 exhibition, 5-8 drills and mini-games, 10 dream match; for story matches the
  // list and index of the match ($C8F6 / $C8F7: 0 junior practice, 1-4 junior ranking, 5 senior practice, 6-9 senior ranking, $0A-$0D varsity,
  // $10-$13 the Island Open rounds, $16-$18 dream matches)
  crowdClass(w = this.v.gb.mem.wram[0]) {
    const mode = w[0x8A6], list = w[0x8F6], idx = w[0x8F7];
    if (mode === 2 || mode === 10) return "major";                                  // Island Open (rounds, semifinals, final), dream matches
    if (mode === 5 || mode === 6 || mode === 7 || mode === 8) return "junior";      // drills, machine, wall practice, mini-games
    if (mode === 1 || mode === 3) { if (list <= 1 && idx <= 4) return "junior"; if (list <= 1 && idx <= 0x0D) return "senior"; if (list <= 1 && idx >= 0x10) return "major"; }
    return "senior";                                                                // exhibition and everything else
  }
  // ---- crowd size: it grows with your progress through the tour, one step per match, from a nearly empty stadium at the first junior
  // practice match to full stands at the Island Open and the dream matches; exhibition matches are full; drills and mini-games have the
  // first match's crowd. The three points are the LIGHT panel's sliders (setCrowdSize("start" | "end" | "exhibition", 0..1)).
  progress(w = this.v.gb.mem.wram[0]) {
    const mode = w[0x8A6], idx = w[0x8F7];
    if (mode === 4) return null;                                                      // exhibition
    if (mode === 5 || mode === 6 || mode === 7 || mode === 8) return 0;               // drills, mini-games
    let k = 0; for (let i = 0; i < TOUR.length; i++) if (TOUR[i] <= idx) k = i;       // the match's place in the tour
    return k / (TOUR.length - 1);
  }
  get crowdSizes() { return this._sizes ||= this.loadSizes(); }
  loadSizes() { const d = { start: 0.04, end: 1, exhibition: 1 }; try { const o = JSON.parse(localStorage.getItem(SIZES_KEY) || "{}"); for (const k of Object.keys(d)) if (typeof o[k] === "number") d[k] = clamp(o[k]); } catch (e) { /* defaults */ } return d; }
  // for the LIGHT / settings panel: setCrowdSize("start" | "end" | "exhibition", 0..1); remembered in localStorage mt-crowd2
  setCrowdSize(cls, v) { const z = this.crowdSizes; if (!(cls in z)) return; z[cls] = clamp(+v); try { localStorage.setItem(SIZES_KEY, JSON.stringify(z)); } catch (e) { /* private mode */ } this.applyFill(); if (this.onSizes) this.onSizes(z); }
  // the crowd by the stakes: practice matches thin, the fans still arriving early in a match (full by the 6th game), more coming in
  // when a set is tight (games level or one apart from 4 games on); the base from the tour's progress as before
  applyFill() {
    if (this.v.venueTour) { this.cls = "senior"; this.fill = 0.95; return; }                   // (VENUE TOUR: a full house)
    const z = this.crowdSizes, p = this.progress(), w = this.v.gb.mem.wram[0]; this.cls = this.crowdClass();
    let f = p === null ? z.exhibition : z.start + (z.end - z.start) * p;
    if (w[0x8A6] === 3) f *= 0.4;                                                                      // a practice match
    const g = w[0x8E2] + w[0x8E3] + 6 * (w[0x8E0] + w[0x8E1]), tight = Math.abs(w[0x8E2] - w[0x8E3]) <= 1 && w[0x8E2] + w[0x8E3] >= 4;
    this.fill = clamp(f * (0.78 + 0.22 * Math.min(1, g / 5)) * (tight ? 1.12 : 1));
  }
  // once per game frame (voxel.js tick): the class of the match, the cheer after a point and the events the crowd sound plays on (read only)
  step(v) {
    if (v.replaying) { this.ev = null; if (v.matchfx) v.matchfx.prev = null; return; }   // INSTANT REPLAY: the replayed point raises no crowd events
    const w = v.gb.mem.wram[0], fr = v.gb.ppu.frames;
    if (v.mode === "3d" && v.courtId >= 0 && w[0x32E] <= 15 && v.isDrill()) { this.drillStep(w); this.ev = null; return; }   // (drills: the hall's watchers)
    if (v.mode !== "3d" || v.courtId < 0 || w[0x32E] > 15) { this.ev = null; return; }
    this.applyFill();
    if (v.matchfx) v.matchfx.step(this);                                // MATCH FX: the score's stakes, long rallies, changeovers, the end
    const E = { fr, sig: [w[0x8E4], w[0x8E5], w[0x8E6], w[0x8E7], w[0x8E8], w[0x8E9], w[0x8EA], w[0x8EB]].join(), res: w[0x4D8], fault: w[0x8EE], body: w[0x4AE], ball: w[0x4B3] }, p = this.ev;
    this.ev = E; if (!p || fr < p.fr || fr > p.fr + 8) return;          // first frame, a reload, or frames skipped: no events
    const when = performance.now() / 1000; if (this.side) this.side.step(w, E, p, when);
    if (this.built && this.built.side) { this.wear.step(w); this.mom.step(w, E, p, when); }            // COURT WEAR; BIG MOMENTS (the VIP box's reactions)
    if (E.ball === 1 && p.ball !== 1 && this.built && this.built.side) { const b = v.ballWorld(); this.amb.impact(b.X, b.Y, this.built.venue, this.surface); }   // the bounce's burst
    // CROWD: an "ooh" when the ball clips the net (wBallNetHit $C4BF); a murmur before a game point; a bigger roar when a game is won
    if (w[0x4BF] === 1 && this.netHitWas !== 1 && this.sound) this.sound.ooh(this.fill, 0.35); this.netHitWas = w[0x4BF];
    const gp = !w[0x8E7] && (w[0x8E6] ? w[0x8E4] !== w[0x8E5] : Math.max(w[0x8E4], w[0x8E5]) >= 3);   // one point from the game (deuce: advantage)
    if (gp && !this.gpWas && this.sound) setTimeout(() => this.sound.hush(this.fill * 0.6), 900); this.gpWas = gp;
    const ballY = (v.ballHist && v.ballHist.length ? v.ballHist[v.ballHist.length - 1].ball.Y : 0), sound = this.sound;
    if (E.sig !== p.sig) {
      const gameWon = this.gamesWas !== undefined && w[0x8E2] + w[0x8E3] !== this.gamesWas; this.gamesWas = w[0x8E2] + w[0x8E3];
      this.cheerAt = when; if (sound) { sound.cheer(this.fill); if (gameWon) setTimeout(() => sound.cheer(Math.min(1, this.fill * 1.2)), 700); }
      if (!this.wave && !w[0x8E8] && this.fill > 0.3 && Math.random() < 0.14) this.wave = { t0: when + 2.4, until: when + 2.4 + 9, a0: Math.random() * 6.28, dir: Math.random() < 0.5 ? -1 : 1 };   // THE WAVE, after the cheer
    }
    else if ((E.res !== p.res && (E.res === 1 || E.res === 2 || E.res === 9)) || (E.fault === 1 && p.fault === 0) || (E.body === 1 && p.body === 0)) { if (sound) sound.aww(this.fill); }
    if (this.wave && w[0x4B6] > 0 && this.wave.until > when + 1) this.wave.until = when + 1;   // the serve: the wave dies away
    if (E.ball === 2 && p.ball !== 2 && Math.abs(ballY) > 1400 && sound) sound.rattle(Math.min(1, Math.abs(ballY) > 1700 ? 1 : 0.7));
  }

  // the garden beyond the far fence (voxel.js cut "garden", courts 3, 4, 5 and 8): its bushes as rounded voxel domes, its kerbed flower bed
  // with flowers in the bed's own colour, the low flower beds before the fence's corners, and a frame round the gate in the chain-link;
  // positions in the court picture's pixels (the same on both courts), colours from the picture
  garden(B, P, bg, bd, gd, rnd, court) {
    const W = 256, upp = bd.width / bd.w, uv = bd.height / bd.h, deep = upp * gd.flat;
    const flower = (x0, y0, x1, y1, d) => { const c = colours(bg, W, x0, y0, x1, y1, c => sat(c) > 0.35 && lum(c) > 0.25 && !isGreen(c)); return c.length ? c[0].c : d; };
    const G = GARDENS[court] || GARDENS[5];
    const bedC = G.bed ? flower(...G.bed, [90, 160, 255]) : null, cornerC = G.corners ? flower(0, 49, 36, 54, [240, 80, 240]) : null, white = shade(P.wallLight, 1.02), soil = shade(P.hedgeA, 0.55);
    // a campus tree (the courtyard's, for continuity): an egg-shaped crown rising to a point, pale yellow-green with white glints up
    // the lit side, deep green below its waist and round the back, on an orange-soil base
    const LEAF = [143, 197, 0], LEAF_LO = [0, 136, 0], GLINT = [248, 248, 248], RIM = [48, 0, 32], SOIL = [233, 143, 0];
    const egg = (cx, cz, rx, rz, hy, cs, y0) => {
      const waist = 0.32;
      for (let y = 0; y < hy; y += cs) {
        const t = (y + cs * 0.5) / hy, u = t < waist ? (waist - t) / waist : (t - waist) / (1 - waist);
        const k = Math.sqrt(Math.max(0, 1 - u * u)) * (t < waist ? 1 : 1 - 0.25 * u), ax = rx * k, az = rz * k;
        for (let x = -ax; x <= ax; x += cs) for (let z = -az; z <= az; z += cs) {
          const e = (x * x) / (ax * ax + 1) + (z * z) / (az * az + 1); if (e > 1) continue;
          const lit = z > -az * 0.2 && x < ax * 0.5, rim = e > 0.8 && x > ax * 0.3;
          const c = rim ? (t < waist ? RIM : shade(LEAF_LO, 0.8)) : t < waist ? (lit ? mix(LEAF_LO, LEAF, 0.35) : LEAF_LO) : lit && t > 0.45 && rnd() < 0.18 ? GLINT : lit ? LEAF : mix(LEAF, LEAF_LO, 0.55);
          B.add(cx + x, y0 + y, cz + z, cs * 1.05, cs * 1.05, cs * 1.05, c, 0.1);
        }
      }
    };
    for (let copy = -1; copy <= 1; copy++) {
      const X = x => bd.X + copy * bd.width + (x - 128) * upp, Zg = row => bd.Y - (gd.h - row) * deep;
      // the bushes grow into campus trees whose crowns show over the fence (a trunk on an orange-soil base, then the egg-shaped crown)
      for (const [x, row, r] of G.bushes) {
        const h0 = bd.height * (0.55 + 0.2 * rnd()), rx = r * upp * 1.1;
        B.add(X(x), 0, Zg(row), rx * 0.9, 14, rx * 0.9, SOIL, 0.1);
        B.add(X(x), 0, Zg(row), 12, h0 + 20, 12, [96, 70, 44], 0.08);
        egg(X(x), Zg(row), rx, Math.max(rx * 0.8, r * deep * 0.5), rx * 2.6, 16, h0);
      }
      // the flower bed: a white kerb, soil, flowers
      const bx = G.bed ? X((G.bed[0] + G.bed[2]) / 2) : 0, bz = G.bed ? Zg((G.bed[1] + G.bed[3]) / 2) : 0, bw = G.bed ? (G.bed[2] - G.bed[0]) * upp : 0, bdp = G.bed ? (G.bed[3] - G.bed[1]) * deep : 0;
      if (G.bed) { B.add(bx, 0, bz, bw, 10, bdp, white); B.add(bx, 10, bz, bw - 12, 3, bdp - 12, soil); }
      for (let i = 0; G.bed && i < 70; i++) B.add(bx + (rnd() - 0.5) * (bw - 18), 12, bz + (rnd() - 0.5) * (bdp - 18), 8, 6 + rnd() * 6, 8, rnd() > 0.25 ? bedC : [250, 250, 240], 0.15);
      // the flower beds before the fence's corners
      for (const [x0, x1] of G.corners || []) {
        const cx = X((x0 + x1) / 2), w = (x1 - x0) * upp;
        B.add(cx, 0, bd.Y + 22, w, 8, 36, soil);
        for (let i = 0; i < 26; i++) B.add(cx + (rnd() - 0.5) * (w - 12), 8, bd.Y + 22 + (rnd() - 0.5) * 26, 9, 7 + rnd() * 5, 9, rnd() > 0.3 ? cornerC : P.hedgeB, 0.15);
      }
      // the gate in the chain-link: posts, a lintel and a sill standing out of the fence
      const gx0 = X(G.gate[0]), gx1 = X(G.gate[1]), gh = (bd.y1 - G.gate[2]) * uv, gl = (bd.y1 - G.gate[3]) * uv;
      B.add(gx0, 0, bd.Y + 5, 8, gh + 6, 10, white); B.add(gx1, 0, bd.Y + 5, 8, gh + 6, 10, white);
      B.add((gx0 + gx1) / 2, gh, bd.Y + 5, gx1 - gx0 + 8, 7, 10, white); B.add((gx0 + gx1) / 2, gl - 4, bd.Y + 5, gx1 - gx0, 5, 8, white);
    }
  }
  // ---- palette from the court picture and the stadium map ----
  palette(bg, rom) {
    const P = {}, W = 256;
    let st = this.stadiumImg;
    if (!st && rom) { try { st = this.stadiumImg = stadiumPixels(rom); } catch (e) { st = null; } }
    // seats and concrete from the stadium map's stands
    let seats = [[70, 140, 230], [240, 120, 40]], conc = [150, 140, 160], dark = [60, 56, 74];
    if (st) {
      const all = []; for (const r of [[18, 112, 100, 296], [290, 112, 370, 296], [18, 12, 370, 96]]) all.push(...colours(st.d, st.w, ...r, c => sat(c) > 0.45 && lum(c) > 0.25 && lum(c) < 0.85));
      const merged = new Map(); for (const e of all) { const k = Math.round(hue(e.c) / 20); merged.set(k, (merged.get(k) || 0) + e.n); }
      const top = [...all].sort((a, b) => b.n - a.n); if (top.length) { const A = top[0].c, B = (top.find(e => hueDist(e.c, A) > 60) || top[Math.min(1, top.length - 1)]).c; seats = [A, B]; }
      const cc = colours(st.d, st.w, 100, 112, 119, 296, c => sat(c) < 0.3 && lum(c) > 0.3); if (cc.length) conc = cc[0].c;
      const dd = colours(st.d, st.w, 18, 112, 100, 296, c => lum(c) < 0.3); if (dd.length) dark = dd[0].c;
    }
    P.seatA = seats[0]; P.seatB = seats[1]; P.conc = conc; P.dark = dark;
  // the court's backdrop picture (rows 0..49): wall colours, hedges, accents
    const all = colours(bg, W, 0, 0, 256, 50), top = colours(bg, W, 0, 0, 256, 3), greens = colours(bg, W, 0, 0, 256, 50, isGreen);
    P.wallTop = top.length ? top[0].c : conc;
    const dk = all.filter(e => e.n > 60).sort((a, b) => lum(a.c) - lum(b.c)); P.wallDark = dk.length ? dk[0].c : dark;
    const lt = all.filter(e => e.n > 120).sort((a, b) => lum(b.c) - lum(a.c)); P.wallLight = lt.length ? lt[0].c : conc;
    P.hedgeA = greens.length ? greens[0].c : [40, 130, 50]; const hl = greens.filter(e => e.n > greens[0].n * 0.15).sort((a, b) => lum(b.c) - lum(a.c)); P.hedgeB = hl.length ? hl[0].c : shade(P.hedgeA, 1.3);
    const acc = colours(bg, W, 0, 30, 256, 50, c => sat(c) > 0.4 && !isGreen(c) && lum(c) > 0.2); P.accent = acc.slice(0, 3).map(e => e.c); if (!P.accent.length) P.accent = [seats[1]];
    const body = colours(bg, W, 0, 60, 256, 200, c => lum(c) < 0.97); P.surface = body.length ? body[0].c : [80, 140, 90];
    // the hedge segments: groups of 8 columns whose lower rows are mostly green (court 4 / 5: the flower beds at the wall's ends)
    const seg = []; let cur = null;
    for (let g = 0; g < 32; g++) {
      let n = 0, gr = 0; const fl = new Map();
      for (let y = 38; y < 50; y++) for (let x = g * 8; x < g * 8 + 8; x++) { const o = (y * W + x) * 4, c = [bg[o], bg[o + 1], bg[o + 2]]; n++; if (isGreen(c)) gr++; else if (sat(c) > 0.35 && lum(c) > 0.25) { const k = pack(c); fl.set(k, (fl.get(k) || 0) + 1); } }
      const ok = gr / n >= 0.3, fc = [...fl].sort((a, b) => b[1] - a[1])[0];
      if (ok) { if (!cur) seg.push(cur = { g0: g, g1: g + 1, flowers: [] }); else cur.g1 = g + 1; if (fc && fc[1] >= 6) cur.flowers.push({ g, c: [fc[0] >> 16, (fc[0] >> 8) & 255, fc[0] & 255] }); } else cur = null;
    }
    P.hedges = seg;
    // shirts of the crowd: the seat colours, the court's accents, some neutrals
    P.shirts = [P.seatA, P.seatB, mix(P.seatA, [255, 255, 255], 0.4), mix(P.seatB, [255, 255, 255], 0.4), ...P.accent, [240, 240, 236], [220, 70, 60], [240, 200, 70], [70, 170, 100], [60, 70, 110]];
    return P;
  }
  // the colours of the umpire chair picture (BG rect 208..226 x 104..136): frame, shirt
  chairColours(bg) {
    const cols = colours(bg, 256, 208, 104, 226, 136, c => lum(c) > 0.08 && lum(c) < 0.97 || sat(c) > 0.3);
    const frame = cols.find(e => sat(e.c) < 0.3 && lum(e.c) > 0.45)?.c || [215, 215, 225], shirt = cols.find(e => sat(e.c) > 0.4)?.c || [230, 120, 150];
    return { frame, shirt };
  }

  // ---- geometry ----
  build() {
    const t0 = performance.now(), { bg, courtId } = this.pend, v = this.v, gl = this.gl; this.pend = null;
    const tg = performance.now(); this.gfx(); const tp = performance.now(); const P = this.palette(bg, v.rom), rnd = mulberry32(0x57AD1 + courtId * 977);
    const tb = performance.now(); const B = new Boxes(), crowd = [];
    const hall = this.v.isDrill(), VEN = hall ? null : venueFor(this), lite = this.quality === "lite";
    if (courtId !== (this.built && this.built.court)) this.flood = null;                            // (FLOODLIGHTS: a new court starts as the sky is)   // VENUES; DETAIL: Lite
    const up = VEN && VEN.home && EXTRAS.homeCourt ? homeLevel(v.gb.mem.wram[0]) : 0, season = hall ? null : seasonNow();   // HOME COURT upgrades; SEASONS
    const N = VEN ? VEN.rows + (up >= 1 ? 1 : 0) : 8, D = 80, RISE = 38, BASE = 130, SEAT = 44, giantWant = this.wantGiant(), giant = giantWant || !!(VEN && VEN.giant);
    if (VEN && VEN.seats) { P.seatA = VEN.seats[0]; P.seatB = VEN.seats[1]; }
    this.boardInk = VEN && VEN.boardInk || null; const standList = [], flags = EXTRAS.courtside ? [] : null, lights = []; this.fanTexture(VEN);   // (flags: waving with COURTSIDE, else still)
    if (this.sound && this.sound.setVenue) this.sound.setVenue(VEN ? VEN.name : "varsity");   // ACOUSTICS: the venue's echo
    const UN = 12, RISE2 = 56, G0 = N * D + 120, UB = 660, topU = UB + UN * RISE2, roofY = topU + 300, screens = [];   // GIANT: the upper deck
    const gdn = v.cuts.find(c => c.name === "garden"), GS = gdn && !hall ? gdn.depth + 40 : 0;   // (the garden behind the far fence: the far stand stands back beyond it)
    const STANDS = [{ id: "left", side: true, dir: -1, inner: -SIDE_IN, v0: -1640, v1: 1900 }, { id: "right", side: true, dir: 1, inner: SIDE_IN, v0: -1640, v1: 1900 },
                    { id: "far", side: false, dir: -1, inner: -1800 - GS, v0: -2030, v1: 2030, skip: [2, 6, 7, 14] }];
    const adBoards = [], banners = [], rb = mulberry32(0xBA77 + courtId);   // (banners: their own random numbers, the crowd's stay as they were)
    const conc = VEN && VEN.conc ? VEN.conc(courtId) : [shade(P.conc, 1.05), shade(P.conc, 0.92)], ads = [P.seatA, P.seatB, ...P.accent, [240, 240, 236]];
    const backC = VEN && VEN.conc ? shade(conc[1], 0.8) : shade(P.dark, 0.9);
    for (const S of hall ? [] : STANDS) {                // (the Training Center's drills are indoors: its hall instead, below)
      if (S.skip && S.skip.includes(courtId)) continue;
      if (S.id === "far" && this.v.farWalls && FAR_WALL_MAPS.includes(courtId)) continue;   // FAR END: Walls (farwalls.js): the wall goes up instead
      // box in stand coordinates: u = distance outward from the inner edge, vv = along the stand
      const box = (u0, u1, v0, v1, y0, y1, rgb, jit = 0) => {
        const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, a = Math.abs(u1 - u0), l = Math.abs(v1 - v0);
        if (S.side) B.add(S.inner + S.dir * uc, y0, vc, a, y1 - y0, l, rgb, jit); else B.add(vc, y0, S.inner + S.dir * uc, l, y1 - y0, a, rgb, jit);
      };
      const at = (u, vv) => S.side ? [S.inner + S.dir * u, vv] : [vv, S.inner + S.dir * u];
      // a tunnel through this stand's bottom rows: the rows, boards, railing and seats in front of it leave its opening (walls included) free
      const T = S.side ? TUNNELS.find(t => t.dir === S.dir) : null, TW = 24, K = T ? Math.ceil(T.d / D) : 0;
      const open = T ? [T.z - T.w / 2 - TW, T.z + T.w / 2 + TW] : null, inOpen = (a, b) => open && b > open[0] && a < open[1];
      const span = (a, b, fn) => { if (!inOpen(a, b)) return fn(a, b); if (open[0] > a) fn(a, open[0]); if (b > open[1]) fn(open[1], b); };
      for (let i = 0; i < N; i++) { const top = BASE + (i + 1) * RISE; if (i < K) span(S.v0, S.v1, (a, b) => box(i * D, (i + 1) * D, a, b, 0, top, conc[i & 1], 0.03)); else box(i * D, (i + 1) * D, S.v0, S.v1, 0, top, conc[i & 1], 0.03); }
      if (T) {
        const col = shade(P.conc, 0.85), [o0, o1] = open;
        box(0, K * D, o0, o0 + TW, 0, T.h, col, 0.03); box(0, K * D, o1 - TW, o1, 0, T.h, col, 0.03);              // the side walls
        box(-6, K * D, o0, o1, T.h, T.h + 28, shade(P.conc, 1.1), 0.03);                                          // the roof (the next row rises behind it)
        box(18, K * D, o0 + TW, o1 - TW, 0, T.h - 2, [14, 14, 20]);                                              // the dark passage (its front just inside the mouth)
        if (VEN && VEN.tunnel) VEN.tunnel({ box, B, P, court: courtId, lite }, T, o0, o1);                          // VENUES: the venue's own mouth
        else box(-14, -6, o0, o1, T.h - 44, T.h, T.col);                                                          // the banner over the mouth
      }
      // advertising boards on the base wall, a railing on its top
      const adLen = 230; let k = 0; for (let v0 = S.v0 + 20; v0 + adLen < S.v1; v0 += adLen + 14, k++) {
        if (inOpen(v0, v0 + adLen)) continue;
        box(-7, 0, v0, v0 + adLen, 22, 92, ads[k % ads.length], 0.04);
        // the ad on its front (ADS: drawn by draw()), a little inside the board's edge so the board frames it
        const vc = v0 + adLen / 2, [x, z] = at(-7.6, vc), r = S.side ? [0, 0, S.dir] : [1, 0, 0], n = S.side ? [-S.dir, 0, 0] : [0, 0, 1];
        adBoards.push({ m: new Float32Array([r[0] * (adLen - 8), 0, r[2] * (adLen - 8), 0, 0, 62, 0, 0, n[0], 0, n[2], 0, x, 26, z, 1]), ad: (k * 5 + (S.id === "far" ? 7 : S.id === "left" ? 0 : 3)) % AD_COUNT });
      }
      for (let v0 = S.v0 + 10; v0 < S.v1; v0 += 150) if (!inOpen(v0, v0 + 7)) box(2, 8, v0, v0 + 7, BASE + RISE, BASE + RISE + 46, shade(P.conc, 1.2));
      span(S.v0, S.v1, (a, b) => box(2, 8, a, b, BASE + RISE + 42, BASE + RISE + 50, shade(P.conc, 1.25)));
      // seats: sections of 5, aisles between; crowd on the seats
      const top = BASE + N * RISE + 110;
      box(N * D, N * D + 34, S.v0 - 30, S.v1 + 30, 0, top, backC, 0.03); standList.push({ S, box, at, top, outer: N * D + 34, rowTop: BASE + N * RISE }); box(N * D - 4, N * D + 38, S.v0 - 30, S.v1 + 30, top, top + 14, shade(P.conc, 1.1));
      for (let i = 0; i < N; i++) box(i * D, (i + 1) * D, S.v0 - 28, S.v0, 0, BASE + (i + 1) * RISE + 34, conc[(i + 1) & 1]), box(i * D, (i + 1) * D, S.v1, S.v1 + 28, 0, BASE + (i + 1) * RISE + 34, conc[(i + 1) & 1]);
      for (let i = 0; i < N; i++) {
        const y = BASE + (i + 1) * RISE, u = i * D;
        for (let sec = 0, v0 = S.v0 + 60; v0 + SEAT * 5 < S.v1 - 40; sec++, v0 += SEAT * 5 + 36) {
          if (i < K && inOpen(v0, v0 + SEAT * 5)) continue;                                                  // (the tunnel's roof)
          if (!hall && EXTRAS.vip && S.side && S.dir < 0 && i >= N - VIP.rows && v0 + SEAT * 5 > VIP.v0 && v0 < VIP.v1) continue;   // (BIG MOMENTS: the VIP box)
          const c = ((sec * 2 + (i >> 1)) % 5 < 3) ? P.seatA : P.seatB;
          box(u + 14, u + 44, v0, v0 + SEAT * 5 - 6, y, y + 14, c, 0.05); box(u + 44, u + 51, v0, v0 + SEAT * 5 - 6, y + 14, y + 42, shade(c, 0.88), 0.05);
          if (i >= 1 && i <= 6 && rb() < 0.13) {                                                           // CROWD BANNERS: a fan holds one up here
            const [x, z] = at(u + 14, v0 + SEAT * 2.5), r = S.side ? [0, 0, S.dir] : [1, 0, 0], n = S.side ? [-S.dir, 0, 0] : [0, 0, 1];
            banners.push({ x, y: y + 110, z, r, n, ph: rb() * 6.28, who: rb() < 0.6 ? 0 : 1, kind: Math.floor(rb() * 4), order: rb() });
          }
          for (let s = 0; s < 5; s++) {
            const [x, z] = at(u + 28, v0 + s * SEAT + SEAT / 2 - 3);
            const fan = Math.floor(rnd() * (this.fans ? this.fans.n : 1)), r1 = rnd(), r2 = rnd(), r3 = rnd();
            if (lite && ((s + i) & 1)) continue;                                                       // DETAIL: Lite: every other seat
            crowd.push(x, y + 14, z, r1, fan, 0.88 + r2 * 0.24, r3, this.fans && this.fans.hops[fan] ? 1 : 0);
          }
        }
      }
      if (giant) {
        // GIANT: behind the lower bowl a concourse (dark, with a band of lit windows), then the upper deck: UN rows rising steeply from
        // UB, its front a fascia in the seat colour; it runs on past the side stands' far ends and the far stand's corners, closing the bowl
        const V0 = S.side ? S.v0 - 920 : -3140, V1 = S.side ? S.v1 : 3140;
        box(N * D + 34, G0, V0, V1, 0, UB - 90, shade(P.dark, 0.7), 0.03);
        for (let v0 = V0 + 40; v0 + 160 < V1; v0 += 220) box(N * D + 30, N * D + 36, v0, v0 + 160, UB - 250, UB - 170, [255, 226, 150]);   // the concourse's windows
        box(G0 - 14, G0, V0, V1, UB - 90, UB + 36, P.seatB, 0.03); box(G0 - 18, G0 - 12, V0, V1, UB + 30, UB + 40, shade(P.conc, 1.25));
        for (let i = 0; i < UN; i++) {
          const y = UB + (i + 1) * RISE2, u = G0 + i * D;
          box(u, u + D, V0, V1, UB - 90, y, conc[i & 1], 0.03);
          for (let sec = 0, v0 = V0 + 60; v0 + SEAT * 5 < V1 - 40; sec++, v0 += SEAT * 5 + 36) {
            const c = ((sec * 2 + (i >> 1)) % 5 < 3) ? P.seatA : P.seatB;
            box(u + 14, u + 44, v0, v0 + SEAT * 5 - 6, y, y + 14, c, 0.05); box(u + 44, u + 51, v0, v0 + SEAT * 5 - 6, y + 14, y + 42, shade(c, 0.88), 0.05);
            for (let s = 0; s < 5; s++) {
              const [x, z] = at(u + 28, v0 + s * SEAT + SEAT / 2 - 3), fan = Math.floor(rnd() * (this.fans ? this.fans.n : 1)), r1 = rnd(), r2 = rnd(), r3 = rnd();
              if (!(lite && ((s + i) & 1))) crowd.push(x, y + 14, z, r1, fan, 0.88 + r2 * 0.24, r3, this.fans && this.fans.hops[fan] ? 1 : 0);
            }
          }
        }
        const back = G0 + UN * D;
        box(back, back + 40, V0 - 30, V1 + 30, 0, topU + 170, shade(P.dark, 0.9), 0.03);                                 // the back wall
        // the roof over the upper rows: a canopy on columns from the back wall, floodlight banks along its inner edge, flags on top
        const r0 = G0 + 3 * D;
        for (let v0 = V0 - 40, k = 0; v0 < V1 + 40; v0 += 280, k++) {                                          // panels, ribs between them
          const v1 = Math.min(V1 + 40, v0 + 280); box(r0, back + 60, v0, v1, roofY, roofY + 34, shade(P.conc, k & 1 ? 0.86 : 0.96), 0.02);
          box(r0, back + 60, v0, v0 + 12, roofY + 34, roofY + 50, shade(P.conc, 1.2));
          box(r0 + 60, back, v0 + 40, v1 - 40, roofY + 34, roofY + 38, [150, 190, 220]);                       // a skylight strip
        }
        box(r0 - 10, r0, V0 - 40, V1 + 40, roofY - 40, roofY + 40, shade(P.conc, 0.8));
        for (let v0 = V0; v0 < V1; v0 += 420) box(back + 8, back + 36, v0, v0 + 28, topU + 170, roofY, shade(P.conc, 0.95));
        for (let v0 = V0 + 30; v0 + 130 < V1; v0 += 200) box(r0 - 18, r0 - 8, v0, v0 + 130, roofY - 34, roofY - 4, [255, 246, 205]);
        for (let v0 = V0 + 100, k = 0; v0 < V1; v0 += 360, k++) { box(r0 + 20, r0 + 28, v0, v0 + 8, roofY + 34, roofY + 190, [200, 200, 210]); box(r0 + 20, r0 + 24, v0 + 8, v0 + 90, roofY + 120, roofY + 186, P.shirts[k % P.shirts.length]); }
        // the video screens: on the far stand's roof, either side of the middle
        if (!S.side) for (const sx of [-1, 1]) {
          const cx = sx * 1550, z = S.inner + S.dir * (r0 + 40), W = 760, Hs = 260, y = roofY + 40;
          B.add(cx, roofY + 34, z - 30, 40, 40, 40, [70, 72, 82]); B.add(cx, y, z - 10, W + 40, Hs + 40, 30, [30, 32, 40]);
          screens.push({ x: cx, y: y + 20, z: z + 8, w: W, h: Hs });
        }
      }
    }
    if (VEN && VEN.extras) VEN.extras({ B, P, rnd: mulberry32(0x7E40 + courtId), stands: standList, court: courtId, lite, giant, flags, lights });   // VENUES: the venue's buildings
    if (VEN && VEN.home && up) homeUpgrades({ B, stands: standList, flags, screens }, up);
    if (season) SEASONS[season].extras({ B, P, rnd: mulberry32(0x5EA5 + courtId), stands: standList, flags, lights });
    this.season = season; if (VEN && !v.venueTour) markSeen(VEN.name);                                 // (VENUE TOUR: played in, unlocked)
    if (VEN && VEN.home) { const slot = v.gb.mem.wram[0][0x36C], key = "mt-homecourt-" + slot; let was = 0; try { was = +(localStorage.getItem(key) || 0); } catch (e) { /* private mode */ }
      if (up > was) { try { localStorage.setItem(key, String(up)); } catch (e) { /* private mode */ } toast(["", "HOME COURT: a new row of seats and the academy's flags", "HOME COURT: a roof over the far stand", "HOME COURT: a big screen"][up]); } }
    this.mom.build(B, standList, { N, D, RISE, BASE, hall });                                          // BIG MOMENTS: the VIP box
    const farS = standList.find(s => !s.S.side);                          // COURTSIDE: flags along the far stand's top (the varsity has its own)
    if (farS && flags && VEN && VEN.name !== "varsity") for (let k = 0; k < 5; k++) { const vv = -1600 + k * 800, [x, z] = farS.at(farS.outer - 16, vv); B.add(x, farS.top + 14, z, 8, 250, 8, [220, 220, 226]); flags.push({ x: x + 3, y: farS.top + 200, z, w: 90, h: 56, col: P.shirts[k % P.shirts.length], along: "x" }); }
    // back wall: thickness behind the backdrop picture, a coping on top, rounded-voxel hedges in front
    const cut = n => v.cuts.find(c => c.name === n);
    const bd = cut("backdrop"), gd = cut("garden");
    if (bd) {
      const span = bd.width * 3 + 60, behind = gd ? gd.depth + 30 : 0;                  // (a garden behind the fence: the wall stands beyond it)
      if (gd) for (let x = -span / 2; x < span / 2; x += 26) B.add(bd.X + x + 13, 0, bd.Y - behind - 10, 27, 70 + ((x * 7) % 3) * 6, 40, ((x / 26) | 0) % 2 ? P.hedgeA : shade(P.hedgeA, 0.88), 0.1);   // (a garden: a low hedge closes it, not a wall)
      else { B.add(bd.X, 0, bd.Y - 62, span, bd.height, 118, shade(P.wallDark, 0.8)); B.add(bd.X, bd.height, bd.Y - 66, span + 30, 16, 150, shade(P.wallTop, 1.1), 0.03); }
      const upp = bd.width / 256;
      if (gd) this.garden(B, P, bg, bd, gd, rnd, courtId);
      else for (const seg of P.hedges) for (let copy = -1; copy <= 1; copy++) {
        const xa = bd.X + copy * bd.width + (seg.g0 * 8 - 128) * upp, xb = bd.X + copy * bd.width + (seg.g1 * 8 - 128) * upp, cs = 26, depth = 5, layers = [[5, 0], [5, 0], [4, 1], [2, 1]];
        for (let x = xa + cs / 2; x < xb; x += cs) {
          layers.forEach(([nz, off], li) => {
            const taper = li === 3 ? 0.8 : 1;
            for (let zi = 0; zi < nz; zi++) {
              if (li >= 2 && (x < xa + cs * 1.5 || x > xb - cs * 1.5) && zi === 0) continue;                       // rounded ends
              B.add(x, li * cs * 0.9, bd.Y + 8 + (zi + off * 0.5 + (depth - nz) * 0.5) * cs, cs * 1.02 * taper, cs * 0.95, cs * 1.02, rnd() > 0.5 ? P.hedgeA : P.hedgeB, 0.12);
            }
          });
          const gi = Math.floor((((x - bd.X - copy * bd.width) / upp) + 128) / 8), fl = seg.flowers.find(f => f.g === gi);
          if (fl) for (let z = 0; z < 3; z++) if (rnd() > 0.35) B.add(x + (rnd() - 0.5) * cs * 0.6, 3.4 * cs * 0.9 - 6, bd.Y + 8 + (1.2 + rnd() * 2.6) * cs, cs * 0.5, cs * 0.5, cs * 0.5, fl.c, 0.1);
        }
      }
    }
    const fe = cut("fence");
    if (fe) { const span = fe.width * 3; B.add(fe.X, fe.height - 8, fe.Y + 6, span, 12, 16, shade(P.wallLight, 1.0)); for (let x = fe.X - span / 2; x <= fe.X + span / 2; x += 200) B.add(x, 0, fe.Y + 6, 14, fe.height, 14, shade(P.wallLight, 0.9)); }
    // umpire chair: legs, platform, ladder, seat back and the umpire
    const jd = hall ? null : cut("judge"); let judge = null;
    if (jd) {
      const { frame, shirt } = this.chairColours(bg), cx = jd.X + 6, cz = jd.Y - 8, H = 150, f2 = shade(frame, 0.78);
      for (const [dx, dz] of [[-26, -22], [26, -22], [-26, 22], [26, 22]]) B.add(cx + dx, 0, cz + dz, 9, H, 9, f2);
      B.add(cx, 62, cz - 22, 62, 7, 7, f2); B.add(cx, 62, cz + 22, 62, 7, 7, f2); B.add(cx - 26, 100, cz, 7, 7, 52, f2);
      B.add(cx, H, cz, 72, 9, 62, frame); B.add(cx + 30, H + 9, cz, 9, 50, 56, frame); B.add(cx - 36, H + 9, cz - 26, 8, 22, 8, f2); B.add(cx - 36, H + 9, cz + 26, 8, 22, 8, f2);
      for (let s = 0; s < 5; s++) B.add(cx - 40 - s * 6, s * 30, cz + 48, 34, 7, 30, frame);                // ladder steps towards the viewer
      B.add(cx - 22, 0, cz + 66, 6, 150, 6, f2); B.add(cx - 56, 0, cz + 66, 6, 150, 6, f2);
      judge = { x: cx, y: H + 9, z: cz, w: jd.width, h: jd.height };   // the umpire: the game's own picture of them, seated here (draw)
    }
    // floodlight towers (lighting.js hangs its lights at the same x / z, FLOOD_HEIGHT up)
    if (hall) this.buildHall(B, P);
    for (const [x, z] of hall || giant ? [] : FLOODS) {                // (GIANT: the roof carries the lights)
      if (z > 0) continue;                                   // the near towers stand behind the camera: only their light (lighting.js) shows
      if (VEN && VEN.torches) { VEN.torch({ B }, x, z); continue; }      // VENUES: fire torches in place of the towers
      const fz = z < 0 ? 1 : -1, px = x < 0 ? 1 : -1;
      B.add(x, 0, z, 30, FLOOD_HEIGHT + 20, 30, [150, 152, 160], 0.02); B.add(x, 0, z, 56, 60, 56, [110, 112, 120]);
      B.add(x + px * 40, FLOOD_HEIGHT - 80, z + fz * 14, 250, 150, 26, [58, 60, 70]);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) B.add(x + px * 40 - 90 + a * 60, FLOOD_HEIGHT - 66 + b * 66, z + fz * 30, 46, 46, 8, [255, 246, 205]);
    }
    // scoreboard above the far stands
    const far = !(courtId === 2 || courtId === 6 || courtId === 7 || courtId === 14 || (v.farWalls && FAR_WALL_MAPS.includes(courtId))), bz = (far ? -2150 : -2000) - GS, by = 540;
    const tall = v.farWalls && FAR_WALL_MAPS.includes(courtId) && v.cuts.find(c => c.name === "backdrop");   // FAR END: Walls: the board hangs on the wall
    if (!hall && tall) {
      const wz = tall.Y + 150, wy = Math.max(300, tall.height * 0.5);
      B.add(0, wy - 16, wz - 6, 720, 250, 48, [38, 40, 48]); B.add(0, wy + 232, wz - 6, 740, 14, 56, [120, 122, 134]);
      for (const x of [-300, 300]) B.add(x, wy + 60, wz - 70, 24, 24, 140, [88, 90, 100]);   // (its brackets into the wall)
      this.boardPos = { x: 0, y: wy + 12, z: wz + 20, w: 640, h: 210 }; this.boardDirty = true; if (VEN && VEN.board) VEN.board({ B }, this.boardPos);
    } else if (!hall) {
      B.add(-230, 0, bz - 6, 30, by, 30, [88, 90, 100]); B.add(230, 0, bz - 6, 30, by, 30, [88, 90, 100]); B.add(0, by - 16, bz - 6, 720, 250, 48, [38, 40, 48]); B.add(0, by + 232, bz - 6, 740, 14, 56, [120, 122, 134]);
      this.boardPos = { x: 0, y: by + 12, z: bz + 20, w: 640, h: 210 }; this.boardDirty = true; if (VEN && VEN.board) VEN.board({ B }, this.boardPos);
    } else this.boardPos = null;
    if (!hall) { const k = surfaceKind(v.mapId()); this.wear.reset(k === "clay" || k === "grass" ? k : "hard"); this.surface = k; }
    if (!hall) this.side.build(B, VEN, { sponsors: v.tour && v.tour.sponsorAds ? v.tour.sponsorAds() : null, ads: ADS, flags, lights });   // COURTSIDE: the benches (the people move: draw)
    // upload
    const boxes = B.data(); this.free();
    const bufB = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufB); gl.bufferData(gl.ARRAY_BUFFER, boxes, gl.STATIC_DRAW);
    const vaoB = gl.createVertexArray(); gl.bindVertexArray(vaoB);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cube); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 16, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 16, 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufB); for (const [loc, off] of [[2, 0], [3, 16]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 32, off); gl.vertexAttribDivisor(loc, 1); }
    const cd = new Float32Array(crowd), bufC = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufC); gl.bufferData(gl.ARRAY_BUFFER, cd, gl.STATIC_DRAW);
    const vaoC = gl.createVertexArray(); gl.bindVertexArray(vaoC);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufC); for (const [loc, off] of [[0, 0], [1, 16]]) { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, 32, off); gl.vertexAttribDivisor(loc, 1); }
    gl.bindVertexArray(null);
    this.built = { boxBuf: bufB, boxVao: vaoB, boxN: B.n, crowdBuf: bufC, crowdVao: vaoC, crowdN: crowd.length / 8, court: courtId, judge, adBoards, banners: banners.sort((a, b) => a.order - b.order), hall, giant, giantWant, screens,
      venue: VEN ? VEN.name : "", side: !hall, skyY: BASE + N * RISE - 54 };   // (skybox.js: the horizon through the far stand's top)
    this.stats = { boxes: B.n, crowd: crowd.length / 8, ms: performance.now() - t0, gfx: tp - tg, palette: tb - tp, geom: performance.now() - tb };
  }

  // the Training Center's hall around a drill court (no stands, crowd, scoreboard or floodlight towers): on the right a cream wall on a
  // dark wooden skirting with a handrail, framed wall panels and wall lamps (the hall has no windows: lighting.js lights it as indoors); on the left, as beside the Training Center's own courts, a glass
  // wall in blue frames with benches behind it, where the Training Center's people sit and watch (drawn by draw); the far wall behind the
  // court's own backdrop. No ceiling: the camera looks in from above.
  buildHall(B, P) {
    const wall = [226, 212, 180], skirt = [132, 98, 66], rail = [176, 140, 96], panel = [210, 194, 160], frame = [238, 234, 222], lamp = [255, 248, 214], cap = [204, 188, 156];
    const blueDark = [34, 62, 150], bench = [150, 106, 62], floor = [118, 186, 112];
    const X = 1320, Z0 = -2500, Z1 = 1900, H = 600, T = 40, zc = (Z0 + Z1) / 2, L = Z1 - Z0;
    { const x = X + T / 2;                                                                        // the right: a solid wall
      B.add(x, 0, zc, T, H, L, wall, 0.02); B.add(x, H, zc, T + 16, 14, L, cap, 0.02);
      B.add(x - 6, 0, zc, T, 110, L, skirt, 0.04); B.add(x - 14, 104, zc, 14, 12, L, rail, 0.02);
      for (let z = Z0 + 260; z < Z1 - 200; z += 460) {
        B.add(x - 4, 300, z, T + 4, 200, 300, frame); B.add(x - 8, 312, z, T + 4, 176, 276, panel, 0.03);
        B.add(x - 14, 470, z + 230, 18, 30, 46, lamp);
      }
    }
    { const x = -X - 10, GH = 380;                                                               // the left: one pane of glass (drawHall) on a slim curb
      B.add(x, 0, zc, 22, 10, L, blueDark, 0.02);
      B.add(-X - 340, -2, zc, 640, 4, L, floor, 0.04);                                              // the room behind it: its floor,
      for (let z = Z0 + 200; z < Z1 - 100; z += 520) { B.add(-X - 190, 0, z, 70, 44, 400, bench, 0.05); B.add(-X - 222, 44, z, 10, 40, 400, shade(bench, 0.85)); }   // benches
      B.add(-X - 660, 0, zc, T, H, L, wall, 0.02); B.add(-X - 654, 0, zc, T, 110, L, skirt, 0.04);  // and its back wall
      this.glassWall = { x, y0: 10, y1: GH, z0: Z0, z1: Z1 };
      this.seats = []; for (let z = Z0 + 200, k = 0; z < Z1 - 100; z += 520) for (const dz of [-130, 0, 130]) this.seats.push({ x: -X - 190, y: 44, z: z + dz, k: k++ });
    }
    B.add(0, 0, Z0 - T / 2, 2 * X + 2 * T + 700, H, T, wall, 0.02); B.add(X / 2, H, Z0 - T / 2, X + 2 * T, 14, T + 16, cap, 0.02);   // the far wall
    B.add(0, 0, Z0 - T / 2 + 6, 2 * X + 700, 110, T, skirt, 0.04);
  }
  // a drill's result (wPointWinLoseFlag $C8EB: 0 while it runs, 1 cleared, $FF failed): the watchers cheer or groan, and the player's
  // win / lose face shows over them (drawResultFace) for a few seconds
  drillStep(w) {
    const f = w[0x8EB];
    if (f !== this.drillWL) {
      if (this.drillWL === 0 && (f === 1 || f === 0xFF)) {
        this.result = { win: f === 1, at: performance.now() / 1000 };
        const s = this.sound; if (s) { if (f === 1) { s.cheer(0.5); s.clap(0.5); } else s.aww(0.5); }
      }
      this.drillWL = f;
    }
  }
  resultAge() { return this.result ? performance.now() / 1000 - this.result.at : 99; }
  // the spectators on the benches behind the glass (hopping with their arms up after a clear, slumped after a miss) and the glass: one
  // pane with a slim frame, a faint tint and the shimmer sweep of the Training Center's other glass walls (shimmer.js FS_GLASS), drawn last
  drawHall(mvp) {
    const v = this.v, gl = this.gl, W = v.watchers, T = performance.now() / 1000, age = this.resultAge(), R = age < 4 ? this.result : null;
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
    if (W && W.size && this.seats) {
      if (!this.watchTex || this.watchTex.n !== W.size) { if (this.watchTex) for (const t of this.watchTex.list) gl.deleteTexture(t.tex); this.watchTex = { n: W.size, list: [...W.values()].map(p => ({ tex: v.texture(p.w, p.h, p.img), w: p.w, h: p.h })) }; }
      const S2 = 10, list = this.watchTex.list, rnd = mulberry32(0x5EA7);
      for (const st of this.seats) {
        if (rnd() < 0.3) continue;                                                       // a few empty seats
        const p = list[Math.floor(rnd() * list.length)];
        let dy = 0, tint = [1, 1, 1, 1];
        if (R && R.win) dy = 46 * Math.abs(Math.sin(T * 9 + st.k * 1.7)) * Math.min(1, (4 - age) * 1.5);   // on their feet, jumping
        else if (R) { dy = -10; tint = [0.82, 0.82, 0.9, 1]; }                                            // oh no: slumped
        // on the bench's front edge, turned 30 degrees from the camera towards the court, clear of the seat, the backrest and the glass
        const cw = p.w * S2 * 0.866, sw = p.w * S2 * 0.5, x = st.x + 35 + cw / 2 + 3 + (R && !R.win ? Math.sin(T * 3 + st.k) * 4 : 0);
        v.draw(p.tex, new Float32Array([cw, 0, -sw, 0, 0, p.h * S2, 0, 0, 0.5, 0, 0.866, 0, x, st.y - 30 + dy, st.z, 1]), mvp, [0, 0, 1, 1], tint, 0.5);
      }
    }
    const g = this.glassWall; if (!g || !v.progG) return;
    if (!this.glassVao) {
      const pos = new Float32Array([g.x, g.y0, g.z0, g.x, g.y0, g.z1, g.x, g.y1, g.z1, g.x, g.y0, g.z0, g.x, g.y1, g.z1, g.x, g.y1, g.z0]), uv = new Float32Array([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1]);
      this.glassVao = gl.createVertexArray(); gl.bindVertexArray(this.glassVao);
      for (const [loc, data, n] of [[0, pos, 3], [1, uv, 2]]) { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 0, 0); }
      gl.bindVertexArray(null);
    }
    gl.useProgram(v.progG); gl.uniformMatrix4fv(v.uG.uMVP, false, mvp); gl.uniform1f(v.uG.uTime, T); gl.uniform1f(v.uG.uShim, v.shimmer ? v.shimmer.level() : 0.8); gl.uniform1f(v.uG.uK, 2.2);   // the Training Center's glass: clearly there
    gl.depthMask(false); gl.bindVertexArray(this.glassVao); gl.drawArrays(gl.TRIANGLES, 0, 6); gl.depthMask(true);
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
  }
  // after a drill: the player's own match sprite on a card (look/poses.js), cheering with a fist pump when it was cleared, slumped and
  // in tears when not, popping up beside the game's result panel for a few seconds: in the margin left of the Game Boy picture on a
  // wide screen, else at its top. (ortho: the HUD's 160x144 space, l r top bot its visible edges)
  drawResultFace(ortho, l, r, top, bot) {
    const age = this.resultAge(), R = this.result; if (!R || age > 4) return;
    const v = this.v, gl = this.gl, ch = v.gb.mem.wram[4][0xF78], mood = R.win ? "win" : "lose", L = v.gb.look;
    const frames = POSE_FRAMES[mood], slot = frames[Math.floor(age * 5) % frames.length], gen = ch + ":" + (L ? L.gen : 0);
    if (!this.poseTex || this.poseTex.gen !== gen) { if (this.poseTex) for (const t of this.poseTex.map.values()) gl.deleteTexture(t); this.poseTex = { gen, map: new Map() }; }
    let tex = this.poseTex.map.get(mood + slot);
    if (!tex) {
      let c = null; try { c = poseCanvas(v.gb, ch, slot, mood, 128); } catch (e) { c = null; } if (!c) return;
      tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
      this.poseTex.map.set(mood + slot, tex);
    }
    const T = performance.now() / 1000, pop = Math.min(1, age * 6) * Math.min(1, (4 - age) * 3), margin = -l;
    const size = (margin >= 40 ? Math.min(margin - 6, 56) : 40) * pop, bob = R.win ? -Math.abs(Math.sin(T * 7)) * 4 : Math.min(age, 1) * 2;
    const cx = margin >= 40 ? l + margin / 2 : 80, yb = (margin >= 40 ? (top + bot) / 2 + size / 2 : top + 4 + size) + bob;
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
    v.draw(tex, new Float32Array([size, 0, 0, 0, 0, -size, 0, 0, 0, 0, 1, 0, cx, yb, 0, 1]), ortho, [0, 0, 1, 1], [1, 1, 1, 1], 0.05);
  }
  // the dot-matrix scoreboard: points of both players from the game's score bytes (0 15 30 40, AD)
  boardTexture() {
    const gl = this.gl;
    if (!this.board) {
      const c = document.createElement("canvas"); c.width = 168; c.height = 56; const tex = gl.createTexture();
      this.board = { c, tex, g: c.getContext("2d") };
    }
    // sets, games and points ($C8E0-$C8E5). In a game the points stop at 40-40: the game sets the deuce flag ($C8E6) and takes both back
    // to 30-30, so with the flag on, level is 40-40 and one ahead is AD. In a tiebreak ($C8E7) the points are plain numbers.
    const w = this.v.gb.mem.wram[0], deuce = w[0x8E6], tb = w[0x8E7];
    const lab = (a, b) => tb ? String(Math.min(a, 99)) : deuce ? (a > b ? "AD" : "40") : ["0", "15", "30", "40"][Math.min(a, 3)];
    // each side's name (the match records wCA00 / wCA80: up to 4 letters; P1 / P2 if there is none)
    const nm = (a, d) => { let o = ""; for (let i = 0; i < 16; i++) { const c = w[a + i]; if (c < 0x20 || c > 0x7E) break; o += String.fromCharCode(c); } o = o.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, ""); return (o || d).slice(0, 4); };
    const rows = [[nm(0xA00, "P1"), w[0x8E0], w[0x8E2], lab(w[0x8E4], w[0x8E5])], [nm(0xA80, "P2"), w[0x8E1], w[0x8E3], lab(w[0x8E5], w[0x8E4])]], g = this.board.g;
    g.fillStyle = "#14161c"; g.fillRect(0, 0, 168, 56);
    rows.forEach(([name, sets, games, pts], r) => {               // "ALEX 14 AD": name, sets and games, points
      const ink = this.boardInk || ["#ffc24a", "#7cf0a0", "#e8ecf4"];                              // VENUES: the board's colours
      const cells = [...name.padEnd(4, " ")].map(ch => [ch, ink[r], 17]);
      cells[3][2] = 27; cells.push([String(Math.min(sets, 9)), ink[2], 17], [String(Math.min(games, 9)), ink[2], 27]);
      for (const ch of pts.padStart(2, " ")) cells.push([ch, ink[r], 17]);
      let x = 4;
      for (const [ch, col, adv] of cells) {
        const bits = BOARD_FONT[ch] || BOARD_FONT[" "];
        for (let i = 0; i < 15; i++) if (bits[i] === "1") { g.fillStyle = col; g.fillRect(x + (i % 3) * 5, 5 + r * 26 + Math.floor(i / 3) * 4, 4, 3); }
        x += adv;
      }
    });
    gl.bindTexture(gl.TEXTURE_2D, this.board.tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.board.c);
    for (const [k, val] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, val);
    this.boardDirty = false;
  }

  // ---- drawing (in place of the flat stands) ----
  draw(mvp) {
    const gl = this.gl, v = this.v;
    try {
      if (this.built && this.built.hall !== v.isDrill() && this.painted && !this.pend) this.pend = this.painted;   // a drill starts or ends on the same court
      if (this.built && !this.built.hall && (this.built.giantWant !== this.wantGiant() || this.built.venue !== venueFor(this).name) && this.painted && !this.pend) this.pend = this.painted;   // GIANT: a final starts / ends; VENUES: the class changes
      if (this.pend && (!this.built || v.gb.ppu.frames - this.buildAt >= 6 || v.gb.ppu.frames < this.buildAt)) { this.buildAt = v.gb.ppu.frames; this.build(); }
      if (!this.built) return; this.tick(); this.applyFill();
      const T = performance.now() / 1000, cheer = clamp(1 - (T - this.cheerAt) / 3.4) ** 0.7;
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.useProgram(this.pBox); gl.uniformMatrix4fv(this.uBox.uMVP, false, mvp); gl.bindVertexArray(this.built.boxVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, this.built.boxN);
      if (this.built.side) this.wear.draw(mvp);                                                       // COURT WEAR (on the floor, under everything)
      if (this.built.side) this.side.draw(mvp, T, this.pBox, this.uBox, this.cube);                 // COURTSIDE: the moving people and flags
      if (this.built.side) this.amb.draw(mvp, T, this.built.venue + (this.season ? ":" + this.season : ""));                                   // AMBIENCE: particles, the venue's sound
      if (this.built.side) this.mom.sprites(mvp, T);                                                  // BIG MOMENTS: the VIP box's rivals, the cards
      const ft = this.fanTex && this.fans ? this.fanTex : null;
      if (ft && this.fill > 0) {                                                                                       // the fans: camera-facing billboards
        gl.disable(gl.CULL_FACE); const rx = Math.hypot(mvp[0], mvp[8]) || 1, U = this.uCrowd;
        gl.useProgram(this.pCrowd); gl.uniformMatrix4fv(U.uMVP, false, mvp); gl.uniform3f(U.uRight, mvp[0] / rx, 0, mvp[8] / rx); gl.uniform1f(U.uT, T); gl.uniform1f(U.uCheer, cheer);
        gl.uniform1f(U.uFill, this.fill); gl.uniform1f(U.uShow, 0.72); gl.uniform2f(U.uCells, this.fans.cols, this.fans.rows); gl.uniform1f(U.uBright, 0.97);
        const Wv = this.wave, wu = Wv ? T - Wv.t0 : -1, wk = Wv && wu > 0 ? clamp(Math.min(wu / 1.2, (Wv.until - T) / 1.0)) : 0;   // THE WAVE: 1.4 rad / s round the court
        gl.uniform2f(U.uWave, Wv ? Wv.a0 + Wv.dir * 1.4 * Math.max(0, wu) : 0, wk); if (Wv && T > Wv.until) this.wave = null;
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ft); gl.uniform1i(U.uAtlas, 0);
        gl.bindVertexArray(this.built.crowdVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.built.crowdN);
      }
      gl.disable(gl.CULL_FACE);
      // the umpire on the chair: the top of the game's chair picture (the umpire as the game draws them), standing up on the seat
      const J = this.built.judge, jc = J && v.cuts.find(c => c.name === "judge");
      if (jc) { gl.useProgram(v.prog); gl.bindVertexArray(v.vao); v.draw(jc.tex, new Float32Array([J.w * 1.15, 0, 0, 0, 0, J.h * JUDGE_TOP * 1.15, 0, 0, 0, 0, 1, 0, J.x, J.y - 6, J.z + 4, 1]), mvp, [0, 0, 1, JUDGE_TOP], [1, 1, 1, 1], 0.5); }
      // ADS: the advertising boards along the stands
      if (this.built.adBoards && this.built.adBoards.length) {
        if (!this.adAtlas) this.adAtlas = adAtlas(gl);
        const sp = v.tour && v.tour.sponsorAds(), key = sp && sp.length ? sp.join(",") : "";     // TOUR+: your sponsors on every other board in your tour matches
        let M = this.adMeshes;                                                                   // (one mesh per court and sponsor line-up: rebuilt only when they change)
        if (!M || M.built !== this.built || M.key !== key) {
          if (M) { gl.deleteBuffer(M.pb); gl.deleteBuffer(M.ub); gl.deleteVertexArray(M.vao); }
          M = this.adMeshes = { ...adMesh(gl, this.built.adBoards, this.adAtlas, (b, i) => (key && !(i & 1) ? sp[(i >> 1) % sp.length] : b.ad)), built: this.built, key };
        }
        gl.useProgram(v.prog3); gl.bindVertexArray(M.vao); gl.bindTexture(gl.TEXTURE_2D, this.adAtlas.tex);
        gl.uniformMatrix4fv(v.u3.uMVP, false, mvp); gl.uniform4fv(v.u3.uTint, [1, 1, 1, 1]); gl.uniform1f(v.u3.uAlphaTest, 0);
        gl.drawArrays(gl.TRIANGLES, 0, M.count);
        gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
      }
      if (this.built.banners && this.built.banners.length && this.fill > 0) this.drawBanners(mvp, T);
      if (this.built.hall) this.drawHall(mvp);                                                    // the drill hall's spectators and glass
      // the scoreboard's screen (a card in front of its frame)
      if (this.boardPos) {
        if (this.boardDirty || !this.board) this.boardTexture();
        const b = this.boardPos; gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
        v.draw(this.board.tex, new Float32Array([b.w, 0, 0, 0, 0, b.h, 0, 0, 0, 0, 1, 0, b.x, b.y, b.z, 1]), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);
        for (const s of this.built.screens || []) v.draw(this.board.tex, new Float32Array([s.w, 0, 0, 0, 0, s.h, 0, 0, 0, 0, 1, 0, s.x, s.y, s.z, 1]), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);   // GIANT: the video screens
      }
    } catch (e) { console.warn("stadium", e); this.broken = true; gl.disable(gl.CULL_FACE); }
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
  }
  // CROWD BANNERS: fans in the side and far stands hold up banners for the players, your name (wP1Name $CA00) on red, your opponent's
  // ($CA80) on blue; the fuller the stadium the more of them (up to all the spots build() picked), each bobbing and swaying a little
  bannerTex(text, who) {
    const key = who + ":" + text, M = this.bannerTexs || (this.bannerTexs = new Map()); if (M.has(key)) return M.get(key);
    const W = 256, H = 96, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    g.fillStyle = who ? "#1e50c8" : "#c81e28"; g.fillRect(0, 0, W, H); g.fillStyle = "#fff"; g.fillRect(0, 0, W, 7); g.fillRect(0, H - 7, W, 7);
    let size = 54; g.font = `bold ${size}px system-ui, sans-serif`; while (g.measureText(text).width > W - 22 && size > 20) g.font = `bold ${(size -= 2)}px system-ui, sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle"; g.lineWidth = 6; g.strokeStyle = "rgba(0,0,0,.45)"; g.strokeText(text, W / 2, H / 2 + 2);
    g.fillStyle = who ? "#ffe45a" : "#fff"; g.fillText(text, W / 2, H / 2 + 2);
    const d = new Uint8Array(g.getImageData(0, 0, W, H).data.buffer), tex = this.v.texture(W, H, d, true);
    M.set(key, tex); return tex;
  }
  drawBanners(mvp, T) {
    const v = this.v, w = v.gb.mem.wram[0], gl = this.gl;
    const name = a => { let o = ""; for (let i = 0; i < 16; i++) { const c = w[a + i]; if (c < 0x20 || c > 0x7E) break; o += String.fromCharCode(c); } return o.trim().toUpperCase(); };
    const names = [name(0xA00), name(0xA80)]; if (!names[0] && !names[1]) return;
    const say = [n => `GO ${n}!`, n => `${n}!!`, n => `WE \u2665 ${n}`, n => `${n} #1`];
    const B = this.built.banners, n = Math.min(B.length, Math.round(2 + (B.length - 2) * this.fill));
    // whoever is ahead (3 a set, 1 a game) gets more of the stands' banners, and after a point they are thrust up higher
    const ld = (w[0x8E0] - w[0x8E1]) * 3 + (w[0x8E2] - w[0x8E3]), lead = ld > 0 ? 0 : 1, share = Math.min(0.5, Math.max(0, Math.abs(ld) - 1) * 0.12);
    const jump = 26 * clamp(1 - (T - this.cheerAt) / 2.5);
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
    for (let i = 0; i < n; i++) {
      const b = B[i], pick = i < n * share ? lead : b.who, who = names[pick] ? pick : 1 - pick, tex = this.bannerTex(say[b.kind](names[who]), who);
      const up = 10 * Math.sin(T * 2.6 + b.ph) + jump * Math.abs(Math.sin(T * 7 + b.ph)), sw = 0.08 * Math.sin(T * 1.7 + b.ph * 1.3), W = 210, H = 78;
      const r = [b.r[0] * Math.cos(sw), Math.sin(sw), b.r[2] * Math.cos(sw)], u = [-b.r[0] * Math.sin(sw), Math.cos(sw), -b.r[2] * Math.sin(sw)];
      v.draw(tex, new Float32Array([r[0] * W, r[1] * W, r[2] * W, 0, u[0] * H, u[1] * H, u[2] * H, 0, b.n[0], 0, b.n[2], 0, b.x, b.y + up, b.z, 1]), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);
    }
  }
  // the floodlight beams (night only: as strong as the lighting's lamps are on, lighting.js sky.lamps). Light, not a surface: drawn after
  // the lighting pass (voxel.js renderCourt), so the night grade does not darken them, as a soft haze over the scene
  drawBeams(mvp) {
    const v = this.v, L = v.light; if (!L || L.broken || !L.cfg || !L.cfg.fx.night || !L.activeFor("court") || (this.built && this.built.hall)) return;   // (indoors: no floodlights)
    const k = (L.skyFor ? L.skyFor("court") : L.sky || {}).lamps || 0; if (k < 0.05) return;
    const gl = this.gl;
    if (!this.pBeam) { this.pBeam = v.link(VS_BEAM, FS_BEAM, ["aP", "aT"]); this.uBeam = { uMVP: gl.getUniformLocation(this.pBeam, "uMVP"), uK: gl.getUniformLocation(this.pBeam, "uK") }; this.beamBuf = gl.createBuffer(); this.beamVao = gl.createVertexArray(); }
    const F = [mvp[3], mvp[7], mvp[11]], out = [];                  // the view direction (the clip w row)
    const quad = (A, B, wA, wB) => {                       // two triangles across the beam as the camera sees it: side = beam x view direction
      const d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], c = [d[1] * F[2] - d[2] * F[1], d[2] * F[0] - d[0] * F[2], d[0] * F[1] - d[1] * F[0]], n = Math.hypot(...c) || 1, R = c.map(x => x / n);
      const p = (P, w, sgn) => [P[0] + R[0] * w * sgn, P[1] + R[1] * w * sgn, P[2] + R[2] * w * sgn];
      const a0 = p(A, wA, -1), a1 = p(A, wA, 1), b0 = p(B, wB, -1), b1 = p(B, wB, 1);
      for (const [P, t, u] of [[a0, 0, -1], [a1, 0, 1], [b1, 1, 1], [a0, 0, -1], [b1, 1, 1], [b0, 1, -1]]) out.push(P[0], P[1], P[2], t, u);
    };
    const fk = FLOODS.map((f, i) => this.floodK(i, k));
    FLOODS.forEach(([x, z], i) => {
      if (fk[i] < 0.05) return; const head = [x * 0.96, FLOOD_HEIGHT - 20, z + (z < 0 ? 30 : -30)];
      for (const dx of [-260, 260]) quad(head, [x * 0.28 + dx, 0, z * 0.3], 60 * fk[i], 520 * fk[i]);
    });
    const data = new Float32Array(out);
    gl.useProgram(this.pBeam); gl.uniformMatrix4fv(this.uBeam.uMVP, false, mvp); gl.uniform1f(this.uBeam.uK, 0.30 * k);
    gl.bindVertexArray(this.beamVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.depthMask(false); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 5);
    gl.depthMask(true); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.bindVertexArray(null);
  }
  // FLOODLIGHTS bank by bank: on when the match starts after dark; when the sun sets during a match (TIME MOVES ON) they switch on one
  // tower at a time, each with a clunk and a flicker, and the crowd cheers when the last is lit. floodK(i, night): tower i's strength 0..1
  floodK(i, night) {
    const T = performance.now() / 1000, F = this.flood || (this.flood = { on: night > 0.3, t0: -99, cheered: true });
    if (!F.on && night > 0.3) { F.on = true; F.t0 = T; F.cheered = false; for (let k = 0; k < 4; k++) setTimeout(() => this.sound && this.sound.clunk && this.sound.clunk(), k * 900); }
    if (F.on && night < 0.15) { F.on = false; F.t0 = -99; }
    if (!F.on) return 0;
    const u = (T - F.t0 - i * 0.9) / 0.6; if (u >= 1.2 && i === 3 && !F.cheered) { F.cheered = true; if (this.sound) this.sound.cheer(this.fill * 0.8); }
    if (u >= 1) return 1; if (u <= 0) return 0;
    return u * (0.6 + 0.4 * Math.sin(T * 60 + i));                                                  // warming up, flickering
  }
  // the lamps' glow at night (venues.js lamps, ambience.js night particles): soft halos added over the lit picture, so the night grade
  // does not dim them (drawn after the lighting pass, as the beams are)
  drawGlow(mvp) {
    if (!this.built || !this.built.side) return;
    const v = this.v, L = v.light, sky = L && !L.broken && L.active && L.skyFor ? L.skyFor("court") : null, nk = sky ? sky.lamps || 0 : 0; if (nk < 0.05) return;
    const gl = this.gl, T = performance.now() / 1000, tex = this.amb.softTex(), rx = Math.hypot(mvp[0], mvp[8]) || 1, R = [mvp[0] / rx, 0, mvp[8] / rx];
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
    const halo = (x, y, z, s, c, a) => v.draw(tex, new Float32Array([R[0] * s, 0, R[2] * s, 0, 0, s, 0, 0, -R[2], 0, R[0], 0, x, y - s / 2, z, 1]), mvp, [0, 0, 1, 1], [c[0] / 255, c[1] / 255, c[2] / 255, a], 0.01);
    for (const l of this.side.lights || []) {
      const flick = 0.85 + 0.15 * Math.sin(T * 9 + l.x * 0.05), long = Math.max(l.sx, l.sz), n = long > 200 ? Math.ceil(long / 160) : 1;
      for (let i = 0; i < n; i++) { const t = n > 1 ? (i + 0.5) / n - 0.5 : 0, x = l.x + (l.sx > 200 ? t * l.sx : 0), z = l.z + (l.sz > 200 ? t * l.sz : 0), s = n > 1 ? 220 : Math.max(l.sx, l.sy, l.sz) * 4.5;
        halo(x, l.y + l.sy / 2, z, s, l.col, 0.55 * nk * flick); }
    }
    this.amb.drawGlow(mvp, T, nk, halo);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true); gl.enable(gl.DEPTH_TEST);
  }
  // cut-outs this layer replaces: the umpire chair (built from boxes above)
  cut(c) { return c.name === "judge" && !!this.built && this.built.court === this.v.courtId && !this.built.hall; }
}

// the HUD button: "STADIUM: Classic / 3D" (remembered)
export function addStadiumButton(hud, st) {
  if (!hud || !st) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "stadiumbtn"; b.title = "3D / VOX court: the flat stands and fence, or a stadium built in 3D (stepped stands with a cheering crowd, thick back wall, hedges, scoreboard, floodlight towers, umpire chair)";
  const show = () => { b.textContent = "STADIUM: " + (st.mode === "3d" ? "3D" : "Classic"); b.classList.toggle("on", st.mode === "3d"); };
  b.addEventListener("pointerdown", () => { st.setMode(st.mode === "3d" ? "classic" : "3d"); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); st.onMode = show;
  const q = document.createElement("span"); q.className = "k"; q.id = "stadiumqbtn"; q.title = "how much the 3D stadiums carry: Full, or Lite for slower phones (every other seat filled, fewer trees, palms, pipes and vines)";
  const showQ = () => { q.textContent = "DETAIL: " + (st.quality === "lite" ? "Lite" : "Full"); q.classList.toggle("on", st.quality !== "lite"); };
  q.addEventListener("pointerdown", () => { st.setQuality(st.quality === "lite" ? "full" : "lite"); showQ(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(q); showQ(); st.onQuality = showQ;
  if (!EXTRAS.seasons) return b;                                       // (STADIUM EXTRAS: seasons off)
  const se = document.createElement("span"); se.className = "k"; se.id = "seasonbtn"; se.title = "the stadiums dressed for the time of year: Auto (Halloween, winter, spring by the date) or Off";
  const showS = () => { const on = seasonSetting() !== "off"; se.textContent = "SEASON: " + (on ? "Auto" : "Off"); se.classList.toggle("on", on); };
  se.addEventListener("pointerdown", () => { setSeasonSetting(seasonSetting() === "off" ? "auto" : "off"); showS(); if (st.painted) st.pend = st.painted; });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(se); showS(); return b;
}
export function attachStadium(voxel, hud) { const s = voxel.stadium = new Stadium3D(voxel); addStadiumButton(hud, s); return s; }

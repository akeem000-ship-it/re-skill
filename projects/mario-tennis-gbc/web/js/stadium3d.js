// 3D stadium for the court view ("STADIUM: Classic / 3D"). A render-time layer: it only changes how the 3D / VOX court's
// surroundings are drawn; it reads the game (the score bytes, to make the crowd cheer) and never writes it, so frame hashes and
// replays are untouched. Everything is generated here in code, at runtime, from the court's own picture:
//   * stepped stands (side and far) with seat rows and a crowd: seat colours from the stadium map's seats, crowd colours from them
//     and the court's accent colours; the crowd bobs, and jumps with its arms up for a few seconds after every point,
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
const KEY = "mt-stadium";
export const STADIUM_MODES = ["classic", "3d"];
const STADIUM_MAP = 32, SIZES_KEY = "mt-crowd2", JUDGE_TOP = 0.5;   // the part of the chair picture (from the top) that is the umpire

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
// that hop and use the cheering frame while uCheer > 0). uRight: the camera's right on the ground.
const VS_CROWD = `#version 300 es
in vec4 aP; in vec4 aQ; uniform mat4 uMVP; uniform vec3 uRight; uniform float uT, uCheer, uFill, uShow; uniform vec2 uCells; out vec2 vUV;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float(gl_VertexID >> 1));
  if (aQ.z > uFill) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vUV = vec2(0.0); return; }
  float ph = aP.w * 6.2831, hop = aQ.w, cheering = (uCheer > 0.0 && hop > 0.5) ? 1.0 : 0.0, cell = aQ.x * 2.0 + cheering;
  vec2 cc = vec2(mod(cell, uCells.x), floor(cell / uCells.x));
  float sz = aQ.y * 3.6 * 32.0, lift = hop > 0.5 ? uCheer * max(0.0, sin(uT * 8.0 + ph)) * 46.0 : 0.0;
  lift += sin(uT * 1.6 + ph * 3.0) * 0.6 * (1.0 + uCheer * 2.0);
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

export class Stadium3D {
  constructor(voxel) {
    this.v = voxel; this.gl = voxel.gl;
    const q = new URLSearchParams(typeof location !== "undefined" ? location.search : "");
    let m = q.get("stadium"); if (m === null) { try { m = localStorage.getItem(KEY); } catch (e) { m = null; } }
    this.mode = STADIUM_MODES.includes(m) ? m : "3d";
    this.pend = null; this.built = null; this.sig = ""; this.buildAt = -99; this.cheer = 0; this.cheerAt = -99; this.fill = 0.6; this.scoreSig = ""; this.stats = { boxes: 0, crowd: 0, ms: 0 };
    this.board = null; this.stadiumImg = null; this.onMode = null;
  }
  get active() { return this.mode === "3d" && !this.broken; }
  setMode(m) { this.mode = STADIUM_MODES.includes(m) ? m : "3d"; try { localStorage.setItem(KEY, this.mode); } catch (e) { /* private mode */ } if (this.onMode) this.onMode(this.mode); }
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
    this.pCrowd = v.link(VS_CROWD, FS_CROWD, ["aP", "aQ"]); this.uCrowd = Object.fromEntries(["uMVP", "uRight", "uT", "uCheer", "uFill", "uShow", "uCells", "uAtlas", "uBright"].map(n => [n, gl.getUniformLocation(this.pCrowd, n)]));
    this.cube = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.cube); gl.bufferData(gl.ARRAY_BUFFER, cubeVerts(), gl.STATIC_DRAW);
  }
  // the fans' atlas (random, from the ROM's match characters; once per ROM)
  fanTexture() {
    const gl = this.gl, v = this.v;
    if (this.fans === undefined) { try { this.fans = v.rom ? buildFanAtlas(v.rom.b || v.rom, 20260101, 96) : null; } catch (e) { console.warn("fans", e); this.fans = null; } }
    if (!this.fans) return null;
    if (!this.fanTex) { this.fanTex = v.texture(this.fans.w, this.fans.h, this.fans.data, false); }
    return this.fanTex;
  }

  // ---- hooks called by voxel.js ----
  // after the court picture is painted (bg: 256x256 RGBA of the court with the live palettes); the geometry follows at the next draw
  paint(bg, courtId) { this.pend = { bg, courtId, at: this.v.gb.ppu.frames }; }

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
  applyFill() { const z = this.crowdSizes, p = this.progress(); this.cls = this.crowdClass(); this.fill = p === null ? z.exhibition : z.start + (z.end - z.start) * p; }
  // once per game frame (voxel.js tick): the class of the match, the cheer after a point and the events the crowd sound plays on (read only)
  step(v) {
    const w = v.gb.mem.wram[0], fr = v.gb.ppu.frames; if (v.mode !== "3d" || v.courtId < 0 || w[0x32E] > 15) { this.ev = null; return; }
    this.applyFill();
    const E = { fr, sig: [w[0x8E4], w[0x8E5], w[0x8E6], w[0x8E7], w[0x8E8], w[0x8E9], w[0x8EA], w[0x8EB]].join(), res: w[0x4D8], fault: w[0x8EE], body: w[0x4AE], ball: w[0x4B3] }, p = this.ev;
    this.ev = E; if (!p || fr < p.fr || fr > p.fr + 8) return;          // first frame, a reload, or frames skipped: no events
    const when = performance.now() / 1000, ballY = (v.ballHist && v.ballHist.length ? v.ballHist[v.ballHist.length - 1].ball.Y : 0), sound = this.sound;
    if (E.sig !== p.sig) { this.cheerAt = when; if (sound) sound.cheer(this.fill); }
    else if ((E.res !== p.res && (E.res === 1 || E.res === 2 || E.res === 9)) || (E.fault === 1 && p.fault === 0) || (E.body === 1 && p.body === 0)) { if (sound) sound.aww(this.fill); }
    if (E.ball === 2 && p.ball !== 2 && Math.abs(ballY) > 1400 && sound) sound.rattle(Math.min(1, Math.abs(ballY) > 1700 ? 1 : 0.7));
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
    this.fanTexture(); const tb = performance.now(); const B = new Boxes(), crowd = [];
    const N = 8, D = 80, RISE = 38, BASE = 130, SEAT = 44;
    const STANDS = [{ id: "left", side: true, dir: -1, inner: -1180, v0: -1640, v1: 1900 }, { id: "right", side: true, dir: 1, inner: 1180, v0: -1640, v1: 1900 },
                    { id: "far", side: false, dir: -1, inner: -1800, v0: -2030, v1: 2030, skip: [2, 6, 7, 14] }];
    const conc = [shade(P.conc, 1.05), shade(P.conc, 0.92)], ads = [P.seatA, P.seatB, ...P.accent, [240, 240, 236]];
    for (const S of STANDS) {
      if (S.skip && S.skip.includes(courtId)) continue;
      // box in stand coordinates: u = distance outward from the inner edge, vv = along the stand
      const box = (u0, u1, v0, v1, y0, y1, rgb, jit = 0) => {
        const uc = (u0 + u1) / 2, vc = (v0 + v1) / 2, a = Math.abs(u1 - u0), l = Math.abs(v1 - v0);
        if (S.side) B.add(S.inner + S.dir * uc, y0, vc, a, y1 - y0, l, rgb, jit); else B.add(vc, y0, S.inner + S.dir * uc, l, y1 - y0, a, rgb, jit);
      };
      const at = (u, vv) => S.side ? [S.inner + S.dir * u, vv] : [vv, S.inner + S.dir * u];
      for (let i = 0; i < N; i++) box(i * D, (i + 1) * D, S.v0, S.v1, 0, BASE + (i + 1) * RISE, conc[i & 1], 0.03);
      // advertising boards on the base wall, a railing on its top
      const adLen = 230; let k = 0; for (let v0 = S.v0 + 20; v0 + adLen < S.v1; v0 += adLen + 14, k++) box(-7, 0, v0, v0 + adLen, 22, 92, ads[k % ads.length], 0.04);
      for (let v0 = S.v0 + 10; v0 < S.v1; v0 += 150) box(2, 8, v0, v0 + 7, BASE + RISE, BASE + RISE + 46, shade(P.conc, 1.2));
      box(2, 8, S.v0, S.v1, BASE + RISE + 42, BASE + RISE + 50, shade(P.conc, 1.25));
      // seats: sections of 5, aisles between; crowd on the seats
      const top = BASE + N * RISE + 110;
      box(N * D, N * D + 34, S.v0 - 30, S.v1 + 30, 0, top, shade(P.dark, 0.9), 0.03); box(N * D - 4, N * D + 38, S.v0 - 30, S.v1 + 30, top, top + 14, shade(P.conc, 1.1));
      for (let i = 0; i < N; i++) box(i * D, (i + 1) * D, S.v0 - 28, S.v0, 0, BASE + (i + 1) * RISE + 34, conc[(i + 1) & 1]), box(i * D, (i + 1) * D, S.v1, S.v1 + 28, 0, BASE + (i + 1) * RISE + 34, conc[(i + 1) & 1]);
      for (let i = 0; i < N; i++) {
        const y = BASE + (i + 1) * RISE, u = i * D;
        for (let sec = 0, v0 = S.v0 + 60; v0 + SEAT * 5 < S.v1 - 40; sec++, v0 += SEAT * 5 + 36) {
          const c = ((sec * 2 + (i >> 1)) % 5 < 3) ? P.seatA : P.seatB;
          box(u + 14, u + 44, v0, v0 + SEAT * 5 - 6, y, y + 14, c, 0.05); box(u + 44, u + 51, v0, v0 + SEAT * 5 - 6, y + 14, y + 42, shade(c, 0.88), 0.05);
          for (let s = 0; s < 5; s++) {
            const [x, z] = at(u + 28, v0 + s * SEAT + SEAT / 2 - 3);
            const fan = Math.floor(rnd() * (this.fans ? this.fans.n : 1));
            crowd.push(x, y + 14, z, rnd(), fan, 0.88 + rnd() * 0.24, rnd(), this.fans && this.fans.hops[fan] ? 1 : 0);
          }
        }
      }
    }
    // back wall: thickness behind the backdrop picture, a coping on top, rounded-voxel hedges in front
    const cut = n => v.cuts.find(c => c.name === n);
    const bd = cut("backdrop");
    if (bd) {
      const span = bd.width * 3 + 60;
      B.add(bd.X, 0, bd.Y - 62, span, bd.height, 118, shade(P.wallDark, 0.8)); B.add(bd.X, bd.height, bd.Y - 66, span + 30, 16, 150, shade(P.wallTop, 1.1), 0.03);
      const upp = bd.width / 256;
      for (const seg of P.hedges) for (let copy = -1; copy <= 1; copy++) {
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
    const jd = cut("judge"); let judge = null;
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
    for (const [x, z] of FLOODS) {
      if (z > 0) continue;                                   // the near towers stand behind the camera: only their light (lighting.js) shows
      const fz = z < 0 ? 1 : -1, px = x < 0 ? 1 : -1;
      B.add(x, 0, z, 30, FLOOD_HEIGHT + 20, 30, [150, 152, 160], 0.02); B.add(x, 0, z, 56, 60, 56, [110, 112, 120]);
      B.add(x + px * 40, FLOOD_HEIGHT - 80, z + fz * 14, 250, 150, 26, [58, 60, 70]);
      for (let a = 0; a < 4; a++) for (let b = 0; b < 2; b++) B.add(x + px * 40 - 90 + a * 60, FLOOD_HEIGHT - 66 + b * 66, z + fz * 30, 46, 46, 8, [255, 246, 205]);
    }
    // scoreboard above the far stands
    const far = !(courtId === 2 || courtId === 6 || courtId === 7 || courtId === 14), bz = far ? -2150 : -2000, by = 540;
    B.add(-230, 0, bz - 6, 30, by, 30, [88, 90, 100]); B.add(230, 0, bz - 6, 30, by, 30, [88, 90, 100]); B.add(0, by - 16, bz - 6, 720, 250, 48, [38, 40, 48]); B.add(0, by + 232, bz - 6, 740, 14, 56, [120, 122, 134]);
    this.boardPos = { x: 0, y: by + 12, z: bz + 20, w: 640, h: 210 }; this.boardDirty = true;
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
    this.built = { boxBuf: bufB, boxVao: vaoB, boxN: B.n, crowdBuf: bufC, crowdVao: vaoC, crowdN: crowd.length / 8, court: courtId, judge };
    this.stats = { boxes: B.n, crowd: crowd.length / 8, ms: performance.now() - t0, gfx: tp - tg, palette: tb - tp, geom: performance.now() - tb };
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
    const rows = [["P1", w[0x8E0], w[0x8E2], lab(w[0x8E4], w[0x8E5])], ["P2", w[0x8E1], w[0x8E3], lab(w[0x8E5], w[0x8E4])]], g = this.board.g;
    g.fillStyle = "#14161c"; g.fillRect(0, 0, 168, 56);
    const F = { 0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111", 4: "101101111001001", 5: "111100111001111", 6: "111100111101111", 7: "111001001001001", 8: "111101111101111", 9: "111101111001111", A: "010101111101101", D: "110101101101110", P: "111101111100100", " ": "000000000000000" };
    rows.forEach(([name, sets, games, pts], r) => {               // "P1 1 4 AD": name, sets, games, points
      const s = name + " " + Math.min(sets, 9) + Math.min(games, 9) + " " + pts.padStart(2, " "); let x = 6;
      for (let j = 0; j < s.length; j++) {
        const bits = F[s[j]] || F[" "], col = j === 3 || j === 4 ? "#e8ecf4" : r ? "#7cf0a0" : "#ffc24a";
        for (let i = 0; i < 15; i++) if (bits[i] === "1") { g.fillStyle = col; g.fillRect(x + (i % 3) * 5, 5 + r * 26 + Math.floor(i / 3) * 4, 4, 3); }
        x += j === 4 ? 24 : 19;
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
      if (this.pend && (!this.built || v.gb.ppu.frames - this.buildAt >= 6 || v.gb.ppu.frames < this.buildAt)) { this.buildAt = v.gb.ppu.frames; this.build(); }
      if (!this.built) return; this.tick(); this.applyFill();
      const T = performance.now() / 1000, cheer = clamp(1 - (T - this.cheerAt) / 3.4) ** 0.7;
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
      gl.useProgram(this.pBox); gl.uniformMatrix4fv(this.uBox.uMVP, false, mvp); gl.bindVertexArray(this.built.boxVao); gl.drawArraysInstanced(gl.TRIANGLES, 0, 30, this.built.boxN);
      const ft = this.fanTex && this.fans ? this.fanTex : null;
      if (ft && this.fill > 0) {                                                                                       // the fans: camera-facing billboards
        gl.disable(gl.CULL_FACE); const rx = Math.hypot(mvp[0], mvp[8]) || 1, U = this.uCrowd;
        gl.useProgram(this.pCrowd); gl.uniformMatrix4fv(U.uMVP, false, mvp); gl.uniform3f(U.uRight, mvp[0] / rx, 0, mvp[8] / rx); gl.uniform1f(U.uT, T); gl.uniform1f(U.uCheer, cheer);
        gl.uniform1f(U.uFill, this.fill); gl.uniform1f(U.uShow, 0.72); gl.uniform2f(U.uCells, this.fans.cols, this.fans.rows); gl.uniform1f(U.uBright, 0.97);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, ft); gl.uniform1i(U.uAtlas, 0);
        gl.bindVertexArray(this.built.crowdVao); gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.built.crowdN);
      }
      gl.disable(gl.CULL_FACE);
      // the umpire on the chair: the top of the game's chair picture (the umpire as the game draws them), standing up on the seat
      const J = this.built.judge, jc = J && v.cuts.find(c => c.name === "judge");
      if (jc) { gl.useProgram(v.prog); gl.bindVertexArray(v.vao); v.draw(jc.tex, new Float32Array([J.w * 1.15, 0, 0, 0, 0, J.h * JUDGE_TOP * 1.15, 0, 0, 0, 0, 1, 0, J.x, J.y - 6, J.z + 4, 1]), mvp, [0, 0, 1, JUDGE_TOP], [1, 1, 1, 1], 0.5); }
      // the scoreboard's screen (a card in front of its frame)
      if (this.boardPos) {
        if (this.boardDirty || !this.board) this.boardTexture();
        const b = this.boardPos; gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
        v.draw(this.board.tex, new Float32Array([b.w, 0, 0, 0, 0, b.h, 0, 0, 0, 0, 1, 0, b.x, b.y, b.z, 1]), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);
      }
    } catch (e) { console.warn("stadium", e); this.broken = true; gl.disable(gl.CULL_FACE); }
    gl.useProgram(v.prog); gl.bindVertexArray(v.vao);
  }
  // the floodlight beams (night only: as strong as the lighting's lamps are on, lighting.js sky.lamps). Light, not a surface: drawn after
  // the lighting pass (voxel.js renderCourt), so the night grade does not darken them, as a soft haze over the scene
  drawBeams(mvp) {
    const v = this.v, L = v.light; if (!L || L.broken || !L.cfg || !L.cfg.fx.night || !L.activeFor("court")) return;
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
    for (const [x, z] of FLOODS) {
      const head = [x * 0.96, FLOOD_HEIGHT - 20, z + (z < 0 ? 30 : -30)];
      for (const dx of [-260, 260]) quad(head, [x * 0.28 + dx, 0, z * 0.3], 60, 520);
    }
    const data = new Float32Array(out);
    gl.useProgram(this.pBeam); gl.uniformMatrix4fv(this.uBeam.uMVP, false, mvp); gl.uniform1f(this.uBeam.uK, 0.30 * k);
    gl.bindVertexArray(this.beamVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.beamBuf); gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 20, 0); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 20, 12);
    gl.depthMask(false); gl.blendFunc(gl.SRC_ALPHA, gl.ONE); gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, data.length / 5);
    gl.depthMask(true); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.bindVertexArray(null);
  }
  // cut-outs this layer replaces: the umpire chair (built from boxes above)
  cut(c) { return c.name === "judge" && !!this.built && this.built.court === this.v.courtId; }
}

// the HUD button: "STADIUM: Classic / 3D" (remembered)
export function addStadiumButton(hud, st) {
  if (!hud || !st) return null;
  const b = document.createElement("span"); b.className = "k"; b.id = "stadiumbtn"; b.title = "3D / VOX court: the flat stands and fence, or a stadium built in 3D (stepped stands with a cheering crowd, thick back wall, hedges, scoreboard, floodlight towers, umpire chair)";
  const show = () => { b.textContent = "STADIUM: " + (st.mode === "3d" ? "3D" : "Classic"); b.classList.toggle("on", st.mode === "3d"); };
  b.addEventListener("pointerdown", () => { st.setMode(st.mode === "3d" ? "classic" : "3d"); show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b); show(); st.onMode = show; return b;
}
export function attachStadium(voxel, hud) { const s = voxel.stadium = new Stadium3D(voxel); addStadiumButton(hud, s); return s; }

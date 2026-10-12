// 3D "diorama" renderer for the running game (VoxelMod-style view). Three scene kinds:
//  * court (a court tilemap is loaded): the court tilemap is un-projected through the game's own fixed
//    projection (ProjectPoint, camera.js) onto a flat ground plane; the players stand at their real world
//    positions (wPlayerX/Y/Z of each player bank), the ball at its true height (wBall*) with a shadow at
//    its ground point; the net, the umpire chair and the far fence/stands are cut out of the floor and
//    stood upright; a locked camera preset frames the court for the viewport (see PRESETS).
//  * field (an RPG map is on screen): the 64x64 map is a floor, solid metatiles are extruded boxes,
//    actors are billboards, the window layer stays a 2D overlay.
//  * everything else (title, menus, mini-games): the BG, window and sprite layers are stacked at
//    different depths and a gently swaying camera gives them parallax.
// Sprites are textured cards or, in voxel mode, one lit cube per opaque pixel.
import { project } from "./camera.js";
import { courtTilemaps, courtImage, courtIndexMap } from "./assets.js";
import { FIELD_OBJECTS } from "./field_objects.js";

const VS = `#version 300 es
in vec2 aPos; in vec2 aUV; uniform mat4 uMVP; uniform mat4 uModel; uniform vec4 uUVRect; out vec2 vUV;
void main() { vUV = uUVRect.xy + aUV * uUVRect.zw; gl_Position = uMVP * uModel * vec4(aPos, 0.0, 1.0); }`;
const FS = `#version 300 es
precision mediump float; in vec2 vUV; uniform sampler2D uTex; uniform vec4 uTint; uniform float uAlphaTest; out vec4 o;
void main() { vec4 c = texture(uTex, vUV) * uTint; if (c.a < uAlphaTest) discard; o = c; }`;
const VS3 = `#version 300 es
in vec3 aPos3; in vec2 aUV3; uniform mat4 uMVP; out vec2 vUV;
void main() { vUV = aUV3; gl_Position = uMVP * vec4(aPos3, 1.0); }`;
const VSV = `#version 300 es
in vec3 aPosV; in vec3 aColV; uniform mat4 uMVP; uniform mat4 uModel; out vec3 vCol;
void main() { vCol = aColV; gl_Position = uMVP * uModel * vec4(aPosV, 1.0); }`;
const FSV = `#version 300 es
precision mediump float; in vec3 vCol; out vec4 o; void main() { o = vec4(vCol, 1.0); }`;

// Court camera presets (locked; the distance is fitted so the court fills the viewport). pitch = angle
// above the ground, yaw = rotation around the court, lean = how far the sprite cards lean back towards the
// camera (1 = facing it), aim = where the camera looks along the court (negative = towards the far end).
// "original" is the game's own pinhole camera (23.76 deg tilt, 16384 units away, 1 px = 8 units at the
// centre) with the game's scroll applied as an image shift: the court looks exactly like the 2D game
// while players, ball, net and chair have real depth.
export const PRESETS = {
  tv:       { label: "TV",       yaw: 0,    pitch: 0.80,  lean: 0.8, aim: -150 },
  low:      { label: "Low",      yaw: 0,    pitch: 0.55,  lean: 0.8, aim: -250 },
  overhead: { label: "Overhead", yaw: 0,    pitch: 1.20,  lean: 0.8, aim: 0 },
  diorama:  { label: "Diorama",  yaw: 0.55, pitch: 0.85,  lean: 0.8, aim: -100 },
  original: { label: "Original", yaw: 0,    pitch: Math.PI / 2 - 0.4147, lean: 1.0, aim: 0, game: true },
};
export const PRESET_ORDER = ["low", "tv", "overhead", "diorama", "original"];   // "low" is the default
const FIELD_CAM = { dist: 300, pitch: 0.95, fov: 0.8, near: 4, far: 3000 };
const COURT_CLIP = { near: 40, far: 40000 };

// --- small matrix helpers (column-major Float32Array(16)) ---
const m4 = {
  identity: () => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]),
  mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; },
  perspective(fov, aspect, n, f) { const t = 1 / Math.tan(fov / 2); const o = new Float32Array(16); o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = 2 * f * n / (n - f); return o; },
  ortho(l, r, b, t, n, f) { const o = new Float32Array(16); o[0] = 2 / (r - l); o[5] = 2 / (t - b); o[10] = -2 / (f - n); o[12] = -(r + l) / (r - l); o[13] = -(t + b) / (t - b); o[14] = -(f + n) / (f - n); o[15] = 1; return o; },
  translate(x, y, z) { const o = m4.identity(); o[12] = x; o[13] = y; o[14] = z; return o; },
  lookAt(eye, at, up) {
    const z = norm(sub(eye, at)), x = norm(cross(up, z)), y = cross(z, x);
    return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]);
  },
  // translate + scale (x, y, z) + tilt about X, for 3D meshes
  trs3(tx, ty, tz, sx, sy, sz, tiltX) {
    const c = Math.cos(tiltX), s = Math.sin(tiltX);
    return new Float32Array([sx, 0, 0, 0,  0, sy * c, sy * s, 0,  0, -sz * s, sz * c, 0,  tx, ty, tz, 1]);
  },
  // translate + scale + optional rotation about X (tilt) and Y (yaw)
  trs(tx, ty, tz, sx, sy, tiltX = 0, yawY = 0) {
    const cx = Math.cos(tiltX), sxn = Math.sin(tiltX), cy = Math.cos(yawY), syn = Math.sin(yawY);
    return new Float32Array([sx * cy, 0, -sx * syn, 0,  sy * syn * sxn, sy * cx, sy * cy * sxn, 0,  0, 0, 1, 0,  tx, ty, tz, 1]);
  },
  plane(ax, ay, t) { return new Float32Array([ax[0], ax[1], ax[2], 0, ay[0], ay[1], ay[2], 0, 0, 1, 0, 0, t[0], t[1], t[2], 1]); },
  apply(m, v) { const o = [0, 0, 0, 0]; for (let i = 0; i < 4; i++) o[i] = m[i] * v[0] + m[4 + i] * v[1] + m[8 + i] * v[2] + m[12 + i] * v[3]; return o; },
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = a => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// ground texture coverage (world units): the court map covers about X +-1024 / Y +-2048; beyond it the outer
// 16 px band of the map (grass, surface) repeats so the plane reaches the edges of any viewport
const WORLD = { x0: -3072, x1: 3072, y0: -2600, y1: 2600, texel: 6 };
const BAND = 16;
const NET = { x0: -640, x1: 640, height: 96 };                           // posts at BG px 48/208, tape at Z = -96
// BG-pixel rectangles of the court map that stand upright instead of lying on the floor
const CUTS = [
  { name: "net",      x0: 40,  y0: 116, x1: 216, y1: 130, fill: "below" },              // the net band (top of the tape .. ground line)
  { name: "judge",    x0: 208, y0: 104, x1: 226, y1: 136, fill: "left", key: true },    // umpire chair / referee right of the net post
  { name: "backdrop", x0: 0,   y0: 0,   x1: 256, y1: 50,  fill: "below" },              // far fence, stands, castle
  { name: "fence",    x0: 0,   y0: 206, x1: 256, y1: 256, fill: "above", courts: [2, 3, 4, 5, 7, 8] },   // near chain-link fence (courts that have one)
];
const BG_CENTRE = 128.5;                       // BG px of the projection centre: (0x1010 + 0) / 32 + 0.5
// bleachers with spectators from the stadium map (RPG map 32, 512x512 px): rectangles in map px, and the
// sloped planes they stand on beside the court (inner edge at ground level, outer edge raised)
const STADIUM_MAP = 32;
// seats: the bleacher rows; wall: the grey walkway / railing band between the seats and the court, which
// becomes a vertical base of height `base` that the seating rises from (world units; ~8.5 per map px)
// the side stands stop short of the far backdrop (base at Y ~ -1720) so they do not cut through it; the
// far bleachers are only added behind courts whose own backdrop has no stands
const STANDS = [
  { name: "left",  inner: "right",  seats: { x0: 18,  y0: 112, x1: 100, y1: 296 }, wall: { x0: 100, y0: 112, x1: 119, y1: 296 }, base: 130, plane: { x0: -1180, x1: -1877, y0: -1640, y1: 1900, h: 300 } },
  { name: "right", inner: "left",   seats: { x0: 290, y0: 112, x1: 370, y1: 296 }, wall: { x0: 270, y0: 112, x1: 290, y1: 296 }, base: 130, plane: { x0: 1180,  x1: 1860,  y0: -1640, y1: 1900, h: 290 } },
  { name: "far",   inner: "bottom", seats: { x0: 18,  y0: 12,  x1: 370, y1: 96 },  wall: { x0: 18,  y0: 96,  x1: 370, y1: 112 }, base: 130, plane: { x0: -2030, x1: 2030,  y0: -1800, y1: -2514, h: 290 }, skipCourts: [2, 7, 14] },
];

// Overworld objects that stand up, per RPG map (map px; the game has no object data: buildings and trees are
// tiles painted into the map, and the collision grid only outlines where the player can walk).
//  blocks: a building part as a solid box: rows y0..fold are the roof (top face, stretched over the footprint),
//          rows fold..y1 the front wall (height (y1 - fold) * WALL_SCALE, standing on the ground line y1)
//  stamps: one example of a repeated plant / prop (tile aligned); every place in the map with the same tiles
//          stands up as a cut-out card (an inflated voxel body in voxel mode) on the ground line of its bottom
//  cards:  single cut-outs (fences, gate posts)
// The ground behind cut-outs is keyed out (colours of the surrounding ground reachable from the edge) and the
// floor under them is patched with the ground strip below.
const WALL_SCALE = 1.25, FIELD_TILT = 0.3, HUD_SCALE = 0.6;
const SIDE_VIEW_MAPS = new Set([19, 21]);   // drawn as side-view / aerial pictures, not top-down maps: shown as parallax layers

export class Voxel3D {
  constructor(canvas, gb, rom = null) {
    this.cv = canvas; this.gb = gb; this.rom = rom; this.courtMaps = rom ? courtTilemaps(rom) : null; this.courtId = -1; this.detectAt = 0; this.fieldAt = 0; this.fieldOn = false; this.stands = null;
    const gl = this.gl = canvas.getContext("webgl2", { alpha: false, antialias: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.prog = this.link(VS, FS);
    this.u = {}; for (const n of ["uMVP", "uModel", "uUVRect", "uTex", "uTint", "uAlphaTest"]) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.prog3 = this.link(VS3, FS, ["aPos3", "aUV3"]);
    this.u3 = {}; for (const n of ["uMVP", "uTex", "uTint", "uAlphaTest"]) this.u3[n] = gl.getUniformLocation(this.prog3, n);
    this.progV = this.link(VSV, FSV, ["aPosV", "aColV"]);
    this.uV = {}; for (const n of ["uMVP", "uModel"]) this.uV[n] = gl.getUniformLocation(this.progV, n);
    this.voxelMeshes = new Map(); this.objectMeshes = new Map(); this.voxelSprites = false;   // voxelSprites: cubes per opaque pixel instead of cards
    this.field = { mapId: -1, floorTex: null, walls: null, wallCount: 0, palHash: 0, cards: [], blocks: null, artTex: null };
    const quad = new Float32Array([-0.5, 0, 0, 1,  0.5, 0, 1, 1,  -0.5, 1, 0, 0,  0.5, 1, 1, 0]);   // x, y(0..1 up), u, v
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    this.spriteTex = new Map(); this.groundTex = null; this.groundHash = -1; this.ground = null; this.frameTex = null; this.cuts = [];
    this.layer = { bg: null, win: null, hash: -1, whash: -1 };
    this.shadowTex = this.solidTexture([0, 0, 0, 110]);
    this.preset = "low"; this.cam = { yaw: 0, pitch: 0.9, dist: 3100, fitKey: "" };
    this.freeCam = false; this.mode = "none"; this.t0 = performance.now(); this.cur = null; this.prev = null; this.lastFrame = -1; this.alpha = 1;
    this.parallax = { px: 0, py: 0, gx: 0, gy: 0, gbase: null };
    this.bindControls();
  }
  link(vs, fs, attrs = ["aPos", "aUV"]) {
    const gl = this.gl, mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, attrs[0]); gl.bindAttribLocation(p, 1, attrs[1]); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  texture(w, h, data, linear = false, wrap = false) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    const f = linear ? gl.LINEAR : gl.NEAREST, wr = wrap ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wr); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wr);
    return t;
  }
  solidTexture(rgba) { return this.texture(1, 1, new Uint8Array(rgba)); }
  setPreset(name) { if (PRESETS[name]) { this.preset = name; this.cam.fitKey = ""; } }
  // switch to another machine / ROM (the page loaded a new file): forget everything derived from the old one
  attach(gb, rom = null) {
    const gl = this.gl;
    this.gb = gb; this.rom = rom; this.courtMaps = rom ? courtTilemaps(rom) : null;
    this.courtId = -1; this.detectAt = 0; this.fieldAt = 0; this.fieldOn = false; this.cur = this.prev = null; this.lastFrame = -1;
    for (const t of this.spriteTex.values()) gl.deleteTexture(t); this.spriteTex.clear();
    for (const m of this.voxelMeshes.values()) this.freeMesh(m); this.voxelMeshes.clear();
    for (const m of this.objectMeshes.values()) this.freeMesh(m); this.objectMeshes.clear();
    for (const c of this.cuts) { gl.deleteTexture(c.tex); this.freeMesh(c.mesh); } this.cuts = [];
    if (this.stands) for (const st of this.stands) { gl.deleteTexture(st.seats); gl.deleteTexture(st.wall); } this.stands = null;
    if (this.groundTex) { gl.deleteTexture(this.groundTex); this.groundTex = null; } this.ground = null; this.groundHash = -1;
    const f = this.field; if (f.floorTex) { gl.deleteTexture(f.floorTex); f.floorTex = null; } f.mapId = -1; this.buildFieldObjects(null, null);
    const L = this.layer; if (L.bg) { gl.deleteTexture(L.bg); L.bg = null; } if (L.win) { gl.deleteTexture(L.win); L.win = null; } L.hash = L.whash = -1;
  }

  // ---- game state helpers ----
  col5(pal, p, i) { const o = p * 8 + i * 2, c = pal[o] | (pal[o + 1] << 8); return [(c & 31) * 8, ((c >> 5) & 31) * 8, ((c >> 10) & 31) * 8]; }
  mapId() { return this.gb.mem.wram[0][0x32E]; }                       // wCurMapID: 0-15 courts, 17-36 RPG areas
  fieldScroll() { const w = this.gb.mem.wram[0]; return { x: w[0x321] * 8 + (w[0x320] >> 5), y: w[0x323] * 8 + (w[0x322] >> 5) }; }
  // an RPG map is on screen when the VRAM tilemap shows the WRAM3 map at the field scroll (checked every 10 frames)
  isField() {
    const id = this.mapId(); if (id < 17 || id > 36 || SIDE_VIEW_MAPS.has(id)) return false;
    const fr = this.gb.ppu.frames; if (fr < this.fieldAt) return this.fieldOn; this.fieldAt = fr + 10;
    const m = this.gb.mem, p = this.gb.ppu, v0 = m.vram[0], tm = m.wram[3], base = p.lcdc & 0x08 ? 0x1C00 : 0x1800;
    const sc = this.fieldScroll(), mx = sc.x >> 3, my = sc.y >> 3, vx = p.scx >> 3, vy = p.scy >> 3;
    let same = 0, n = 0;
    for (let ty = 0; ty < 18; ty += 2) for (let tx = 0; tx < 20; tx += 2) {
      const X = mx + tx, Y = my + ty; if (X >= 64 || Y >= 64) continue; n++;
      if (v0[base + (((vy + ty) & 31) << 5) + ((vx + tx) & 31)] === tm[Y * 64 + X]) same++;
    }
    return this.fieldOn = n > 0 && same >= n * 0.4;   // dialogue boxes written over the map can cover half the screen
  }
  // a court is loaded when the BG tilemap in VRAM is one of the court maps (checked every 20 frames)
  isCourt() {
    if (!this.courtMaps || this.mapId() > 15) { this.courtId = -1; this.detectAt = 0; return false; }
    const fr = this.gb.ppu.frames; if (fr < this.detectAt) return this.courtId >= 0;
    this.detectAt = fr + 20;
    const v0 = this.gb.mem.vram[0], base = this.gb.ppu.lcdc & 0x08 ? 0x1C00 : 0x1800;
    this.courtId = -1;
    for (const [id, m] of Object.entries(this.courtMaps)) {
      let same = 0; for (let i = 0; i < 1024; i += 3) if (v0[base + i] === m[i]) same++;
      if (same > 300) { this.courtId = +id; break; }
    }
    return this.courtId >= 0;
  }
  // players: one bank per match slot (WRAM4 P1, WRAM5 P2, WRAM6/7 the partners in doubles); wPlayerX/Y/Z at $DF01/04/07
  players() {
    const m = this.gb.mem, n = m.wram[0][0x8F3] >= 4 ? 4 : 2, out = [];
    for (let k = 4; k < 4 + n; k++) {
      const b = m.wram[k], s16 = a => (b[a] | (b[a + 1] << 8)) << 16 >> 16, X = s16(0xF01), Y = s16(0xF04), Z = s16(0xF07);
      if (Math.abs(X) > 1400 || Math.abs(Y) > 2600 || Z > 0 || Z < -600) continue;
      out.push({ X, Y, Z });
    }
    return out;
  }
  sampleState() { const p = this.gb.ppu; return { players: this.players(), ball: this.ballWorld(), scx: p.scx, scy: p.scy }; }
  // interpolated world state for the current display frame (positions that jumped are not interpolated)
  interp() {
    const a = this.alpha, c = this.cur, q = this.prev; if (!c) return this.sampleState(); if (!q || a >= 1) return c;
    const mix = (u, v, lim) => Math.abs(u - v) > lim ? u : v + (u - v) * a;
    const players = c.players.map((pl, i) => { const o = q.players[i]; return o ? { X: mix(pl.X, o.X, 300), Y: mix(pl.Y, o.Y, 300), Z: mix(pl.Z, o.Z, 300) } : pl; });
    const ball = { X: mix(c.ball.X, q.ball.X, 600), Y: mix(c.ball.Y, q.ball.Y, 600), Z: mix(c.ball.Z, q.ball.Z, 600) };
    return { players, ball, scx: mix(c.scx, q.scx, 8), scy: mix(c.scy, q.scy, 8) };
  }
  landing() { const w = this.gb.mem.wram[0], s16 = a => (w[a] | (w[a + 1] << 8)) << 16 >> 16; return { X: s16(0x450), Y: s16(0x452) }; }   // wLandingX/Y
  ballWorld() {
    const w = this.gb.mem.wram[0], r32 = a => { const v = w[a] | (w[a + 1] << 8) | (w[a + 2] << 16) | (w[a + 3] << 24); return v / 65536; };
    return { X: r32(0x400), Y: r32(0x404), Z: r32(0x408) };
  }
  // screen position (px) of a world point with the current scroll
  screenOf(X, Y, Z) { const p = this.gb.ppu, q = project(X, Y, Z); return [(0x1010 - (p.scx << 5) + q.xp) / 32, (0x1010 - (p.scy << 5) + q.pp) / 32]; }
  // inverse projection of a BG map pixel on the ground (Z = 0): Y by bisection on the monotonic pp(Y), then X
  unprojectBG(bx, by) {
    const pp = (by - BG_CENTRE) * 32, xp = (bx - BG_CENTRE) * 32;
    let lo = -2600, hi = 2600;
    for (let k = 0; k < 24; k++) { const mid = (lo + hi) / 2; if (project(0, mid, 0).pp < pp) lo = mid; else hi = mid; }
    const Y = (lo + hi) / 2, s = project(0, Y, 0).s || 1;
    return { X: xp / 8 * 256 / s, Y, s, upp: 1024 / s };    // upp: world units per BG pixel at that depth
  }
  unproject(sx, sy) { const p = this.gb.ppu; return this.unprojectBG(sx + p.scx, sy + p.scy); }
  // cache key for an 8x8 tile: its 16 bytes and its 8 palette bytes hashed (tile slots are reloaded with other
  // graphics between scenes and digits, and palettes fade), plus the flips
  tileKey(addr, bank, palBytes, palIndex, flipX, flipY) {
    const v = this.gb.mem.vram[bank]; let h = 0x811c9dc5;
    for (let i = 0; i < 16; i++) { h ^= v[addr + i]; h = Math.imul(h, 0x01000193); }
    for (let i = 0; i < 8; i++) { h ^= palBytes[palIndex * 8 + i]; h = Math.imul(h, 0x01000193); }
    return (h >>> 0) * 4 + flipX * 2 + flipY;
  }
  // sprite tile (8 rows) as RGBA, colour 0 transparent
  spritePixels(tile, bank, pal, flipX, flipY) {
    const v = this.gb.mem.vram[bank], d = new Uint8Array(8 * 8 * 4), op = this.gb.ppu.objPal;
    for (let y = 0; y < 8; y++) {
      const row = flipY ? 7 - y : y, lo = v[tile * 16 + row * 2], hi = v[tile * 16 + row * 2 + 1];
      for (let x = 0; x < 8; x++) { const bit = flipX ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), o = (y * 8 + x) * 4; if (!ci) continue; const c = this.col5(op, pal, ci); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
    }
    return d;
  }
  spriteTexture(tile, bank, pal, flipX, flipY) {
    const key = this.tileKey(tile * 16, bank, this.gb.ppu.objPal, pal, flipX, flipY);
    let t = this.spriteTex.get(key); if (t) return t;
    t = this.texture(8, 8, this.spritePixels(tile, bank, pal, flipX, flipY)); this.spriteTex.set(key, t);
    if (this.spriteTex.size > 4000) { for (const tx of this.spriteTex.values()) this.gl.deleteTexture(tx); this.spriteTex.clear(); }
    return t;
  }
  // voxel mesh from an RGBA image: a column per opaque pixel (local units: 1 = one pixel, origin at the
  // bottom-centre), outer faces only, lit per face. With R > 0 the shape is "inflated": a pixel's half-depth
  // grows with its distance from the silhouette (a quarter circle of radius R px, up to T px), so a flat
  // sprite becomes a rounded body; neighbouring columns of different depth expose step faces.
  meshFromPixels(rgba, w, h, R = 0, T = 0.5) {
    const n = w * h, px = i => rgba[i * 4 + 3] >= 128, pos = [], col = [];
    const dist = new Float32Array(n).fill(1e9);                   // chamfer distance to the nearest transparent pixel / edge
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!px(i)) { dist[i] = 0; continue; } if (x === 0 || y === 0 || x === w - 1 || y === h - 1) dist[i] = 1; }
    const relax = (i, j, d) => { if (dist[j] + d < dist[i]) dist[i] = dist[j] + d; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (x > 0) relax(i, i - 1, 1); if (y > 0) { relax(i, i - w, 1); if (x > 0) relax(i, i - w - 1, 1.4); if (x < w - 1) relax(i, i - w + 1, 1.4); } }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (x < w - 1) relax(i, i + 1, 1); if (y < h - 1) { relax(i, i + w, 1); if (x < w - 1) relax(i, i + w + 1, 1.4); if (x > 0) relax(i, i + w - 1, 1.4); } }
    const depth = i => { if (!px(i)) return 0; if (!R) return T; const u = Math.min(dist[i], R) / R; return Math.max(0.3, T * Math.sqrt(1 - (1 - u) * (1 - u))); };
    const face = (a, b, c, d, rgb, k) => { for (const q of [a, b, c, a, c, d]) { pos.push(...q); col.push(rgb[0] * k, rgb[1] * k, rgb[2] * k); } };
    const dAt = (x, y) => (x >= 0 && x < w && y >= 0 && y < h) ? depth(y * w + x) : 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!px(i)) continue;
      const c = [rgba[i * 4] / 255, rgba[i * 4 + 1] / 255, rgba[i * 4 + 2] / 255], t = depth(i);
      const x0 = x - w / 2, x1 = x0 + 1, y0 = h - 1 - y, y1 = h - y, z0 = -t, z1 = t;
      face([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], c, 1.0);            // front
      face([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], c, 0.6);            // back
      // side faces: the part of this column's edge not covered by the neighbour (full height when it is transparent)
      const tu = dAt(x, y - 1), td = dAt(x, y + 1), tl = dAt(x - 1, y), tr = dAt(x + 1, y);
      if (tu < t) { face([x0, y1, z1], [x1, y1, z1], [x1, y1, tu], [x0, y1, tu], c, 0.9); face([x0, y1, -tu], [x1, y1, -tu], [x1, y1, z0], [x0, y1, z0], c, 0.9); }      // top
      if (td < t) { face([x0, y0, td], [x1, y0, td], [x1, y0, z1], [x0, y0, z1], c, 0.55); face([x0, y0, z0], [x1, y0, z0], [x1, y0, -td], [x0, y0, -td], c, 0.55); }  // bottom
      if (tl < t) { face([x0, y0, tl], [x0, y0, z1], [x0, y1, z1], [x0, y1, tl], c, 0.75); face([x0, y0, z0], [x0, y0, -tl], [x0, y1, -tl], [x0, y1, z0], c, 0.75); }  // left
      if (tr < t) { face([x1, y0, z1], [x1, y0, tr], [x1, y1, tr], [x1, y1, z1], c, 0.75); face([x1, y0, -tr], [x1, y0, z0], [x1, y1, z0], [x1, y1, -tr], c, 0.75); }  // right
    }
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(col), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(this.vao);
    return { vao, pb, cb, count: pos.length / 3 };
  }
  freeMesh(mesh) { if (!mesh) return; const gl = this.gl; gl.deleteBuffer(mesh.pb); gl.deleteBuffer(mesh.cb); gl.deleteVertexArray(mesh.vao); }
  voxelMesh(tile, bank, pal, flipX, flipY) {
    const key = this.tileKey(tile * 16, bank, this.gb.ppu.objPal, pal, flipX, flipY);
    let mesh = this.voxelMeshes.get(key); if (mesh) return mesh;
    mesh = this.meshFromPixels(this.spritePixels(tile, bank, pal, flipX, flipY), 8, 8); this.voxelMeshes.set(key, mesh);
    if (this.voxelMeshes.size > 3000) { for (const mm of this.voxelMeshes.values()) this.freeMesh(mm); this.voxelMeshes.clear(); }
    return mesh;
  }
  // one inflated voxel body for a whole OAM object (all its tiles composited), cached by tile bytes and layout
  objectMesh(list) {
    let x0 = 999, y0 = 999, x1 = -999, y1 = -999;
    for (const sp of list) { x0 = Math.min(x0, sp.sx); y0 = Math.min(y0, sp.sy); x1 = Math.max(x1, sp.sx + 8); y1 = Math.max(y1, sp.sy + sp.h); }
    const w = x1 - x0, h = y1 - y0, parts = [];
    for (const sp of list) for (let half = 0; half < sp.h / 8; half++) {
      const tile = sp.tile + (sp.attr & 0x40 ? (sp.h / 8 - 1 - half) : half), bank = (sp.attr >> 3) & 1, pal = sp.attr & 7, fx = (sp.attr >> 5) & 1, fy = (sp.attr >> 6) & 1;
      parts.push({ key: this.tileKey(tile * 16, bank, this.gb.ppu.objPal, pal, fx, fy), tile, bank, pal, fx, fy, dx: sp.sx - x0, dy: sp.sy + half * 8 - y0 });
    }
    parts.sort((a, b) => a.dy - b.dy || a.dx - b.dx);
    const key = parts.map(q => `${q.key}@${q.dx},${q.dy}`).join("|");
    let mesh = this.objectMeshes.get(key);
    if (!mesh) {
      const img = new Uint8Array(w * h * 4);
      for (const q of parts) { const d = this.spritePixels(q.tile, q.bank, q.pal, q.fx, q.fy); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const si = (y * 8 + x) * 4; if (!d[si + 3]) continue; const o = ((q.dy + y) * w + q.dx + x) * 4; img[o] = d[si]; img[o + 1] = d[si + 1]; img[o + 2] = d[si + 2]; img[o + 3] = 255; } }
      mesh = this.meshFromPixels(img, w, h, 5, 4.5); this.objectMeshes.set(key, mesh);
      if (this.objectMeshes.size > 800) { for (const mm of this.objectMeshes.values()) this.freeMesh(mm); this.objectMeshes.clear(); this.objectMeshes.set(key, mesh); }
    }
    return { mesh, x0, y0, w, h, y1 };
  }
  drawMesh(mesh, model, mvp) {
    const gl = this.gl; if (!mesh || !mesh.count) return;
    gl.useProgram(this.progV); gl.bindVertexArray(mesh.vao);
    gl.uniformMatrix4fv(this.uV.uMVP, false, mvp); gl.uniformMatrix4fv(this.uV.uModel, false, model);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
  }
  // one sprite tile either as a textured card (prog) or as voxels (progV); model places the tile's bottom-centre
  drawTile(tile, bank, pal, flipX, flipY, X, Y, Z, scale, tilt, mvp) {
    if (this.voxelSprites) this.drawMesh(this.voxelMesh(tile, bank, pal, flipX, flipY), m4.trs3(X, Y, Z, scale, scale, scale * 1.5, -tilt), mvp);
    else this.draw(this.spriteTexture(tile, bank, pal, flipX, flipY), m4.trs(X, Y, Z, 8 * scale, 8 * scale, -tilt, 0), mvp);
  }
  // a tilemap (32x32 entries at mapBase, CGB attributes in VRAM1) as 256x256 RGBA. With `pristine` (the court's
  // own tilemap from the ROM) the live tile indices are replaced by it, so captions and score digits the game
  // writes into the map do not reach the floor; a replaced tile takes the attribute of the nearest untouched
  // tile in its row. `idx` also returns one byte per pixel: (palette << 2 | colour) + 1
  composeMap(mapBase, pristine = null, idx = null) {
    const m = this.gb.mem, p = this.gb.ppu, v0 = m.vram[0], v1 = m.vram[1], lcdc = p.lcdc, img = new Uint8Array(256 * 256 * 4);
    for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) {
      const i = mapBase + ty * 32 + tx; let tile = v0[i], attr = v1[i];
      if (pristine && pristine[ty * 32 + tx] !== tile) {
        tile = pristine[ty * 32 + tx];
        for (let k = 1; k < 32; k++) { const l = tx - k, r = tx + k; if (l >= 0 && v0[mapBase + ty * 32 + l] === pristine[ty * 32 + l]) { attr = v1[mapBase + ty * 32 + l]; break; } if (r < 32 && v0[mapBase + ty * 32 + r] === pristine[ty * 32 + r]) { attr = v1[mapBase + ty * 32 + r]; break; } }
      }
      const bank = attr & 8 ? v1 : v0, addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      for (let y = 0; y < 8; y++) {
        const row = attr & 0x40 ? 7 - y : y, lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1];
        for (let x = 0; x < 8; x++) {
          const bit = attr & 0x20 ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), c = this.col5(p.bgPal, attr & 7, ci);
          const o = ((ty * 8 + y) * 256 + tx * 8 + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
          if (idx) idx[(ty * 8 + y) * 256 + tx * 8 + x] = ((attr & 7) << 2 | ci) + 1;
        }
      }
    }
    return img;
  }
  bgBase() { return this.gb.ppu.lcdc & 0x08 ? 0x1C00 : 0x1800; }
  composeBG() { return this.composeMap(this.bgBase()); }
  palHash() { let h = 0; for (let i = 0; i < 64; i++) h = (Math.imul(h, 31) + this.gb.ppu.bgPal[i]) | 0; return h; }
  // BG tile (colour 0 transparent) for the caption / score overlay
  bgTileTexture(tile, attr) {
    const m = this.gb.mem, v0 = m.vram[0], v1 = m.vram[1], bank = attr & 8 ? v1 : v0, addr = this.gb.ppu.lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4), d = new Uint8Array(256);
    const key = "bg" + this.tileKey(addr, (attr >> 3) & 1, this.gb.ppu.bgPal, attr & 7, (attr >> 5) & 1, (attr >> 6) & 1);
    let t = this.spriteTex.get(key); if (t) return t;
    for (let y = 0; y < 8; y++) {
      const row = attr & 0x40 ? 7 - y : y, lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1];
      for (let x = 0; x < 8; x++) { const bit = attr & 0x20 ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), o = (y * 8 + x) * 4; if (!ci) continue; const c = this.col5(this.gb.ppu.bgPal, attr & 7, ci); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255; }
    }
    t = this.texture(8, 8, d); this.spriteTex.set(key, t); return t;
  }
  mapHash(mapBase, full = false) {                     // tilemap + attributes (+ tile data and palettes when full)
    const m = this.gb.mem, v0 = m.vram[0], v1 = m.vram[1]; let h = 0;
    const step = full ? 1 : 3;
    for (let i = mapBase; i < mapBase + 0x400; i += step) h = (Math.imul(h, 31) + v0[i] + v1[i] * 7) | 0;
    for (let i = 0; i < 64; i += full ? 1 : 5) h = (Math.imul(h, 31) + this.gb.ppu.bgPal[i]) | 0;
    if (full) for (let i = 0; i < 0x1800; i += 7) h = (Math.imul(h, 31) + v0[i] + v1[i] * 3) | 0;
    return h;
  }
  bgHash() { return this.mapHash(this.gb.ppu.lcdc & 0x08 ? 0x1C00 : 0x1800); }

  // ---- court: ground texture and upright cut-outs ----
  // ground texel (X, Y) <- BG pixel ((0x1010 + xp) / 32, (0x1010 + pp) / 32) (the scroll cancels out); the
  // cut-out rectangles are filled from the floor next to them
  buildGround() {                                        // once per court: which BG pixel each ground texel shows
    const W = (WORLD.x1 - WORLD.x0) / WORLD.texel, H = (WORLD.y1 - WORLD.y0) / WORLD.texel, src = new Uint16Array(W * H);
    const cuts = CUTS.filter(c => !c.courts || c.courts.includes(this.courtId));
    const inCut = (bx, by) => { for (const c of cuts) if (bx >= c.x0 && bx < c.x1 && by >= c.y0 && by < c.y1) return c; return null; };
    for (let j = 0; j < H; j++) {
      const Y = WORLD.y0 + j * WORLD.texel;
      for (let i = 0; i < W; i++) {
        const X = WORLD.x0 + i * WORLD.texel, p = project(X, Y, 0);
        let bx = Math.floor((0x1010 + p.xp) / 32), by = Math.floor((0x1010 + p.pp) / 32);
        if (bx < 0) bx = bx & (BAND - 1); else if (bx > 255) bx = 256 - BAND + ((bx - 256) & (BAND - 1));
        if (by < 0) by = by & (BAND - 1); else if (by > 255) by = 256 - BAND + ((by - 256) & (BAND - 1));
        const c = inCut(bx, by);
        if (c) { if (c.fill === "below") by = c.y1; else if (c.fill === "above") by = c.y0 - 1; else bx = c.x0 - 1; }
        src[j * W + i] = by * 256 + bx;
      }
    }
    let idx = null; try { idx = courtIndexMap(this.rom, this.courtId); } catch (e) { console.warn("court", e); }
    this.ground = { W, H, src, cuts, rgba: new Uint8Array(W * H * 4), idx: idx || new Uint8Array(256 * 256), fromRom: !!idx, court: this.courtId };
  }
  paintGround() {                                        // per palette change: the ROM court picture coloured with the current palettes
    const g = this.ground, lut = new Uint8Array(33 * 4);
    if (!g.fromRom) this.composeMap(this.bgBase(), this.courtMaps[this.courtId], g.idx);
    for (let k = 0; k < 32; k++) { const c = this.col5(this.gb.ppu.bgPal, k >> 2, k & 3); lut[(k + 1) * 4] = c[0]; lut[(k + 1) * 4 + 1] = c[1]; lut[(k + 1) * 4 + 2] = c[2]; lut[(k + 1) * 4 + 3] = 255; }
    const bg = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < 65536; i++) { const k = g.idx[i] * 4; bg[i * 4] = lut[k]; bg[i * 4 + 1] = lut[k + 1]; bg[i * 4 + 2] = lut[k + 2]; bg[i * 4 + 3] = 255; }
    const d = g.rgba, src = g.src, idx = g.idx;
    for (let i = 0, n = src.length; i < n; i++) { const k = idx[src[i]] * 4, o = i * 4; d[o] = lut[k]; d[o + 1] = lut[k + 1]; d[o + 2] = lut[k + 2]; d[o + 3] = 255; }
    if (this.groundTex) this.gl.deleteTexture(this.groundTex);
    this.groundTex = this.texture(g.W, g.H, d, true);
    this.buildCuts(bg, g.cuts);
  }
  // each cut-out becomes an upright card (and a voxel mesh) standing on the ground line of its bottom edge;
  // with `key`, the colours of the floor around the rectangle are made transparent (the chair against the grass)
  buildCuts(bg, cuts) {
    for (const c of this.cuts) { this.gl.deleteTexture(c.tex); this.freeMesh(c.mesh); }
    this.cuts = [];
    for (const c of cuts) {
      const w = c.x1 - c.x0, h = c.y1 - c.y0, d = new Uint8Array(w * h * 4);
      let keys = null;
      if (c.key) {                                          // the dominant colours of the 3 px band around the rectangle (court surface, grass)
        const hist = new Map(); let n = 0;
        const add = (x, y) => { const s = ((y & 255) * 256 + (x & 255)) * 4, k = bg[s] << 16 | bg[s + 1] << 8 | bg[s + 2]; hist.set(k, (hist.get(k) || 0) + 1); n++; };
        for (let k = 1; k <= 3; k++) {
          for (let x = c.x0 - 3; x < c.x1 + 3; x++) { add(x, c.y0 - k); add(x, c.y1 - 1 + k); }
          for (let y = c.y0; y < c.y1; y++) { add(c.x0 - k, y); add(c.x1 - 1 + k, y); }
        }
        keys = new Set([...hist].filter(([, v]) => v >= n * 0.06).map(([k]) => k));
      }
      let opaque = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const s = ((c.y0 + y) * 256 + c.x0 + x) * 4, o = (y * w + x) * 4, rgb = bg[s] << 16 | bg[s + 1] << 8 | bg[s + 2];
        if (keys && keys.has(rgb)) continue;
        d[o] = bg[s]; d[o + 1] = bg[s + 1]; d[o + 2] = bg[s + 2]; d[o + 3] = 255; opaque++;
      }
      if (opaque < w * h * 0.05) continue;                 // nothing stands there on this court
      // world placement: the bottom edge un-projected (centre column), width and height from the units per px there
      const g = this.unprojectBG((c.x0 + c.x1) / 2, c.y1);
      let X = g.X, Yw = g.Y, width = w * g.upp, height = h * g.upp;
      if (c.name === "net") { X = (NET.x0 + NET.x1) / 2; Yw = 0; width = (NET.x1 - NET.x0) * w / 160; height = NET.height; }
      const wide = c.name === "backdrop" || c.name === "fence";   // the stands and the fence continue sideways
      this.cuts.push({ name: c.name, tex: this.texture(w, h, d, false, wide), mesh: this.meshFromPixels(d, w, h, c.key ? 3 : 0, c.key ? 2.5 : 0.5), w, h, X, Y: Yw, width, height, wide });
    }
  }
  // the stadium's bleachers as textures: u runs along the court (repeats), v across the stand with the
  // inner (court-side) edge at v = 1
  buildStands() {
    this.stands = [];
    if (!this.rom) return;
    let img; try { const c = courtImage(this.rom, STADIUM_MAP); img = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; } catch (e) { console.warn("stands", e); return; }
    const gl = this.gl;
    // a map rectangle as a texture with u along the court and v across it, v = 1 at the court-facing edge
    const strip = (r, inner) => {
      const w = r.x1 - r.x0, h = r.y1 - r.y0, along = inner === "bottom" ? w : h, across = inner === "bottom" ? h : w, d = new Uint8Array(along * across * 4);
      for (let v = 0; v < across; v++) for (let u = 0; u < along; u++) {
        let mx, my;
        if (inner === "right") { mx = r.x0 + v; my = r.y0 + u; }
        else if (inner === "left") { mx = r.x1 - 1 - v; my = r.y0 + u; }
        else { mx = r.x0 + u; my = r.y0 + v; }
        const sidx = (my * 512 + mx) * 4, o = (v * along + u) * 4;
        d[o] = img[sidx]; d[o + 1] = img[sidx + 1]; d[o + 2] = img[sidx + 2]; d[o + 3] = 255;
      }
      const tex = this.texture(along, across, d, false, true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);          // repeat along the court only
      return { tex, along };
    };
    for (const st of STANDS) {
      const seats = strip(st.seats, st.inner), wall = strip(st.wall, st.inner);
      const p = st.plane, len = Math.abs(st.inner === "bottom" ? p.x1 - p.x0 : p.y1 - p.y0), upp = 8.5;   // ~8.5 world units per map px
      this.stands.push({ seats: seats.tex, wall: wall.tex, st, repeat: Math.max(1, Math.round(len / (seats.along * upp))) });
    }
  }
  drawStands(mvp) {
    if (!this.stands) this.buildStands();
    for (const { seats, wall, st, repeat } of this.stands) {
      if (st.skipCourts && st.skipCourts.includes(this.courtId)) continue;
      const p = st.plane, side = st.inner !== "bottom";
      const ax = side ? [0, 0, p.y1 - p.y0] : [p.x1 - p.x0, 0, 0];                                    // along the court
      const t = side ? [p.x0, 0, (p.y0 + p.y1) / 2] : [(p.x0 + p.x1) / 2, 0, p.y0];                  // inner edge on the ground
      this.draw(wall, m4.plane(ax, [0, st.base, 0], t), mvp, [0, 0, repeat, 1], [0.9, 0.9, 0.9, 1], 0);   // vertical base wall with the railing
      const ay = side ? [p.x1 - p.x0, p.h, 0] : [0, p.h, p.y1 - p.y0];                               // seating rises outward from the wall top
      this.draw(seats, m4.plane(ax, ay, [t[0], st.base, t[2]]), mvp, [0, 0, repeat, 1], [0.92, 0.92, 0.92, 1], 0);
    }
  }
  collectSprites() {
    const m = this.gb.mem, p = this.gb.ppu, oam = m.oam, tall = p.lcdc & 4, sprs = [];
    for (let i = 0; i < 40; i++) {
      const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8; if (sy <= -16 || sy >= 144 || sx <= -8 || sx >= 160) continue;
      let tile = oam[i * 4 + 2]; const attr = oam[i * 4 + 3], hgt = tall ? 16 : 8; if (tall) tile &= 0xFE;
      sprs.push({ sx, sy, h: hgt, tile, attr, owner: null });
    }
    return sprs;
  }
  // draws an OAM object (list of sprites) relative to an anchor screen point: as one inflated voxel body in
  // voxel mode, else as per-tile cards
  blitObject(list, ax, ay, X, Yw, lift, scale, tilt, mvp) {
    if (!this.voxelSprites) { for (const sp of list) this.blitSprite(sp, ax, ay, X, Yw, lift, scale, tilt, mvp); return; }
    const o = this.objectMesh(list), dx = (o.x0 + o.w / 2 - ax) * scale, up = (ay - o.y1) * scale;
    this.drawMesh(o.mesh, m4.trs3(X + dx, lift + up * Math.cos(tilt), Yw - up * Math.sin(tilt), scale, scale, scale, -tilt), mvp);
  }
  // draws one OAM sprite's tiles relative to an anchor screen point (ax, ay) mapped to world (X, Yw) at height lift
  blitSprite(sp, ax, ay, X, Yw, lift, scale, tilt, mvp) {
    const cosT = Math.cos(tilt), sinT = Math.sin(tilt);
    for (let half = 0; half < sp.h / 8; half++) {
      const dx = (sp.sx + 4 - ax) * scale, up = (ay - (sp.sy + (half + 1) * 8)) * scale;
      this.drawTile(sp.tile + (sp.attr & 0x40 ? (sp.h / 8 - 1 - half) : half), (sp.attr >> 3) & 1, sp.attr & 7, (sp.attr >> 5) & 1, (sp.attr >> 6) & 1,
                    X + dx, lift + up * cosT, Yw - up * sinT, scale, tilt, mvp);
    }
  }

  // ---- drawing ----
  draw(tex, model, mvp, uv = [0, 0, 1, 1], tint = [1, 1, 1, 1], alphaTest = 0.5) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniformMatrix4fv(this.u.uModel, false, model); gl.uniformMatrix4fv(this.u.uMVP, false, mvp);
    gl.uniform4fv(this.u.uUVRect, uv); gl.uniform4fv(this.u.uTint, tint); gl.uniform1f(this.u.uAlphaTest, alphaTest);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  // alpha: how far the display is between the last two game frames (0..1); the 3D view renders at the
  // display's refresh rate and interpolates world positions, the game itself stays at 60 Hz
  render(frame2d, alpha = 1) {
    const gl = this.gl, cv = this.cv, fr = this.gb.ppu.frames;
    if (fr !== this.lastFrame) { const cur = this.sampleState(); this.prev = (this.cur && fr === this.lastFrame + 1) ? this.cur : cur; this.cur = cur; this.lastFrame = fr; }
    this.alpha = Math.max(0, Math.min(1, alpha));
    const dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1), W = Math.round((cv.clientWidth || 160) * dpr), H = Math.round((cv.clientHeight || 144) * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }   // render at device pixels (capped at 2x)
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.05, 0.08, 0.12, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.isField()) { this.renderField(frame2d); return; }
    if (this.isCourt()) { this.renderCourt(frame2d); return; }
    this.renderLayers();
  }
  // court camera: eye direction from the preset; distance fitted to the viewport (cached per aspect/preset)
  courtCamera(aspect) {
    const pr = PRESETS[this.preset], c = this.cam;
    const yaw = this.freeCam ? c.yaw : pr.yaw, pitch = this.freeCam ? c.pitch : pr.pitch;
    const dir = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const tilt = (Math.PI / 2 - pitch) * pr.lean;
    if (pr.game && !this.freeCam) {                         // the game's pinhole, the scroll as an image shift
      const p = this.interp(), dist = 16384, fovY = aspect >= 160 / 144 ? 2 * Math.atan(576 / dist) : 2 * Math.atan(640 / aspect / dist);
      const view = m4.lookAt([dir[0] * dist, dir[1] * dist, dir[2] * dist], [0, 0, 0], [0, 1, 0]);
      const proj = m4.perspective(fovY, aspect, COURT_CLIP.near, COURT_CLIP.far);
      const halfH = Math.tan(fovY / 2) * dist / 8;          // half the viewport height in BG px (1 px = 8 units at the centre)
      const shiftX = -(80 + p.scx - BG_CENTRE) / (halfH * aspect), shiftY = (72 + p.scy - BG_CENTRE) / halfH;
      return { mvp: m4.mul(m4.mul(m4.translate(shiftX, shiftY, 0), proj), view), tilt };
    }
    const key = `${this.preset}:${aspect.toFixed(3)}:${yaw.toFixed(3)}:${pitch.toFixed(3)}`, fov = 0.7;
    if (c.fitKey !== key) {                                 // fit the court corners, net and chair into 92% of the viewport
      const pts = [[-760, 0, -1500], [760, 0, -1500], [-760, 0, 1500], [760, 0, 1500], [NET.x0, NET.height, 0], [NET.x1, NET.height, 0], [900, 300, 0]];
      let lo = 400, hi = 30000;
      for (let k = 0; k < 20; k++) {
        const d = (lo + hi) / 2, mvp = m4.mul(m4.perspective(fov, aspect, COURT_CLIP.near, COURT_CLIP.far), m4.lookAt([dir[0] * d, dir[1] * d, dir[2] * d + pr.aim], [0, 0, pr.aim], [0, 1, 0]));
        let fits = true;
        for (const q of pts) { const v = m4.apply(mvp, [q[0], q[1], q[2], 1]); if (v[3] <= 0 || Math.abs(v[0] / v[3]) > 0.92 || Math.abs(v[1] / v[3]) > 0.92) { fits = false; break; } }
        if (fits) hi = d; else lo = d;
      }
      c.fitKey = key; c.dist = hi;
    }
    const d = c.dist;
    const view = m4.lookAt([dir[0] * d, dir[1] * d, dir[2] * d + pr.aim], [0, 0, pr.aim], [0, 1, 0]);
    return { mvp: m4.mul(m4.perspective(fov, aspect, COURT_CLIP.near, COURT_CLIP.far), view), tilt };
  }
  // world: x = X, y = height (-Z), z = Y (near side positive, towards the default camera)
  renderCourt(frame2d) {
    const gl = this.gl, cv = this.cv, p = this.gb.ppu; this.mode = "3d"; if (this.debug) this.debug.length = 0;
    if (!this.ground || this.ground.court !== this.courtId) { this.buildGround(); this.groundHash = -1; }
    const h = this.palHash(); if (h !== this.groundHash) { this.groundHash = h; this.paintGround(); }
    const { mvp, tilt } = this.courtCamera(cv.width / cv.height);
    // ground plane (lying flat: tilt -90deg around X so the quad's up axis becomes -Z, i.e. +Y world towards the camera)
    const gw = WORLD.x1 - WORLD.x0, gh = WORLD.y1 - WORLD.y0;
    this.draw(this.groundTex, m4.trs(0, -0.5, WORLD.y1, gw, gh, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.5);
    this.drawStands(mvp);                                 // bleachers with spectators beside and behind the court
    // upright cut-outs: net, chair, backdrop (cards, or voxels in voxel mode)
    for (const c of this.cuts) {
      if (this.voxelSprites) {
        for (const k of (c.wide ? [-1, 0, 1] : [0])) this.drawMesh(c.mesh, m4.trs3(c.X + k * c.width, 0, c.Y, c.width / c.w, c.height / c.h, c.width / c.w * 1.2, 0), mvp);
      } else if (c.wide) this.draw(c.tex, m4.trs(c.X, 0, c.Y, c.width * 3, c.height, 0, 0), mvp, [-1, 0, 3, 1], [1, 1, 1, 1], 0.5);
      else this.draw(c.tex, m4.trs(c.X, 0, c.Y, c.width, c.height, 0, 0), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.5);
    }
    const sprs = this.collectSprites(), players = this.players(), land = this.landing(), ball = this.ballWorld(), sm = this.interp();
    const [ballSx, ballSy] = this.screenOf(ball.X, ball.Y, ball.Z), [shSx, shSy] = this.screenOf(ball.X, ball.Y, 0), [laSx, laSy] = this.screenOf(land.X, land.Y, 0);
    const SCALE = 7.5;
    // classification (order matters):
    //  1. the ball, its trail and its shadow: tiles $40-$4F (ball sizes, trail, shadow, landing marker) near the
    //     ball's projection; claimed first, so a ball passing in front of a player is never taken for part of them
    //  2. players: seeded by the sprites standing on the projected feet (+2 px, measured), then grown only by
    //     sprites that touch the body (racket, swing effects); the point-won faces reuse the same tile numbers
    //     but float free, so they are never pulled onto the court
    //  3. the landing marker (flat decal), 4. other ball-range tiles in the picture (world), 5. the rest is HUD
    const isBallTile = sp => sp.tile >= 0x40 && sp.tile < 0x50;
    const near = (a, b, gap) => a.sx < b.sx + 8 + gap && b.sx < a.sx + 8 + gap && a.sy < b.sy + b.h + gap && b.sy < a.sy + a.h + gap;
    const ballGroup = [];
    for (const sp of sprs) if (isBallTile(sp) && Math.hypot(sp.sx + 4 - ballSx, sp.sy + sp.h / 2 - ballSy) < 12) { sp.owner = "ball"; ballGroup.push(sp); }
    for (let grew = true; grew && ballGroup.length;) {   // the trail: a chain of ball-range tiles behind the ball
      grew = false;
      for (const sp of sprs) if (!sp.owner && isBallTile(sp) && Math.hypot(sp.sx + 4 - ballSx, sp.sy + sp.h / 2 - ballSy) < 40 && ballGroup.some(b => near(sp, b, 3))) { sp.owner = "ball"; ballGroup.push(sp); grew = true; }
    }
    if (ball.Z < -4) { let best = null, d0 = 10; for (const sp of sprs) { if (sp.owner) continue; const d = Math.hypot(sp.sx + 4 - shSx, sp.sy + sp.h / 2 - shSy); if (d < d0) { d0 = d; best = sp; } } if (best) best.owner = "shadow"; }
    const feet = players.map(pl => { const [fx, fy] = this.screenOf(pl.X, pl.Y, pl.Z); return { pl, fx, fy: fy + 2, list: [] }; });
    for (const sp of sprs) {                              // seeds: the lowest body tiles, standing on the feet
      if (sp.owner || isBallTile(sp)) continue;
      let best = null, d0 = 1e9;
      for (const f of feet) {
        const dx = sp.sx + 4 - f.fx, dy = f.fy - (sp.sy + sp.h), low = f.fy < 8 ? -28 : -6;
        if (Math.abs(dx) > 16 || dy < low || dy > 10) continue;
        const d = Math.abs(dx) + Math.abs(dy); if (d < d0) { d0 = d; best = f; }
      }
      if (best) { best.list.push(sp); sp.owner = best; }
    }
    for (let grew = true; grew;) {                        // grow each body by touching sprites
      grew = false;
      for (const sp of sprs) {
        if (sp.owner || isBallTile(sp)) continue;
        for (const f of feet) if (f.list.some(b => near(sp, b, 2)) && Math.abs(sp.sx + 4 - f.fx) <= 28 && sp.sy + sp.h <= f.fy + 6) { f.list.push(sp); sp.owner = f; grew = true; break; }
      }
    }
    // the landing marker: sprites around the projected landing point, drawn flat on the court there
    const markers = [];
    if (Math.abs(land.X) < 1400 && Math.abs(land.Y) < 2600) for (const sp of sprs) { if (!sp.owner && Math.abs(sp.sx + 4 - laSx) <= 10 && Math.abs(sp.sy + sp.h / 2 - laSy) <= 10) { sp.owner = "marker"; markers.push(sp); } }
    for (const sp of markers) {                           // flat decal: tile rows lie along the court
      const upp = 1024 / (project(land.X, land.Y, 0).s || 128), sc = SCALE * upp / 8;
      for (let half = 0; half < sp.h / 8; half++) {
        const t = this.spriteTexture(sp.tile + (sp.attr & 0x40 ? (sp.h / 8 - 1 - half) : half), (sp.attr >> 3) & 1, sp.attr & 7, (sp.attr >> 5) & 1, (sp.attr >> 6) & 1);
        this.draw(t, m4.trs(land.X + (sp.sx + 4 - laSx) * sc, 0.8, land.Y + (sp.sy + (half + 1) * 8 - laSy) * sc * 2, 8 * sc, 8 * sc * 2, -Math.PI / 2), mvp);
      }
    }
    for (let k = 0; k < feet.length; k++) {
      const f = feet[k]; if (!f.list.length) continue;
      const pl = sm.players[k] || f.pl, upp = 1024 / (project(pl.X, pl.Y, 0).s || 128), scale = SCALE * upp / 8;   // world units per px at that depth
      this.draw(this.shadowTex, m4.trs(pl.X, 0.6, pl.Y + 4, 150, 70, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.75], 0);
      this.blitObject(f.list, f.fx, f.fy, pl.X, pl.Y, -pl.Z, scale, tilt, mvp);
      if (this.debug) this.debug.push({ X: pl.X, Y: pl.Y, Z: pl.Z, n: f.list.length, tiles: f.list.map(s => `${s.sx},${s.sy},${s.tile}`) });
    }
    if (ballGroup.length) {                               // the ball's projection point is the anchor: its tiles keep their 2D offsets
      const b = sm.ball;
      this.blitObject(ballGroup, ballSx, ballSy, b.X, b.Y, -b.Z, SCALE, tilt, mvp);
      this.draw(this.shadowTex, m4.trs(b.X, 0.5, b.Y, 50, 32, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);
    }
    // other ball-range sprites inside the picture (bounce marks, a second ball) stand at their un-projected feet;
    // everything else (score strip, point faces, "1ST P1" labels) is HUD in screen space
    const hud = [];
    for (const sp of sprs) {
      if (sp.owner) continue;
      if (!isBallTile(sp) || sp.sx >= 140 || sp.sx < 12 || sp.sy >= 126 || sp.sy < 2) { hud.push(sp); continue; }
      const w = this.unproject(sp.sx + 4, sp.sy + sp.h);
      if (Math.abs(w.X) > 1100 || Math.abs(w.Y) > 2200) { hud.push(sp); continue; }
      this.blitSprite(sp, sp.sx + 4, sp.sy + sp.h, w.X, w.Y, 0, SCALE * w.upp / 8, tilt, mvp); sp.owner = "world";
    }
    if (this.debug) this.debug.push({ land, markers: markers.map(s => `${s.sx},${s.sy},${s.tile}`), ball: ballGroup.map(s => `${s.sx},${s.sy},${s.tile}`), hud: hud.map(s => `${s.sx},${s.sy},${s.tile}`) });
    // HUD: screen space, each sprite anchored to the nearest screen edge so the strips stay at the edges of
    // a wide or tall viewport
    gl.disable(gl.DEPTH_TEST);
    const { ortho, l, r, t, b } = this.hudOrtho();
    // HUD sprites at HUD_SCALE of the full-screen Game Boy scale, anchored to the nearest edge with a margin; on
    // touch screens the top edge sits below the button bar and the bottom edge above the stick and A/B buttons
    const k = HUD_SCALE, ppu = (b - t) / (this.cv.clientHeight || 1), top = t + 2 + (this.topInset || 0) * ppu, bot = b - 2 - (this.bottomInset || 0) * ppu;
    // anchor per group of touching sprites (a score strip, a caption, a face): its box decides the edge, so groups
    // never split; groups around the middle stay centred
    const gid = hud.map((_, i) => i), root = i => { while (gid[i] !== i) i = gid[i] = gid[gid[i]]; return i; };
    for (let i = 0; i < hud.length; i++) for (let j = i + 1; j < hud.length; j++) if (near(hud[i], hud[j], 2)) gid[root(j)] = root(i);
    const box = new Map();
    hud.forEach((s, i) => { const g = root(i); const b = box.get(g) || { x0: 999, x1: -999, y0: 999, y1: -999 }; b.x0 = Math.min(b.x0, s.sx); b.x1 = Math.max(b.x1, s.sx + 8); b.y0 = Math.min(b.y0, s.sy); b.y1 = Math.max(b.y1, s.sy + s.h); box.set(g, b); });
    const midX = (l + r) / 2, midY = (top + bot) / 2;
    hud.forEach((s, i) => {
      const b = box.get(root(i)), bcx = (b.x0 + b.x1) / 2, bcy = (b.y0 + b.y1) / 2, cx = s.sx + 4;
      const x = bcx < 48 ? l + 3 + cx * k : bcx > 112 ? r - 3 - (160 - cx) * k : midX + (cx - 80) * k;
      const y0 = bcy < 40 ? top + s.sy * k : bcy > 104 ? bot - (144 - s.sy) * k : midY + (s.sy - 72) * k;
      for (let half = 0; half < s.h / 8; half++) {
        const tex = this.spriteTexture(s.tile + (s.attr & 0x40 ? (s.h / 8 - 1 - half) : half), (s.attr >> 3) & 1, s.attr & 7, (s.attr >> 5) & 1, (s.attr >> 6) & 1);
        this.draw(tex, m4.trs(x, y0 + (half + 1) * 8 * k, 0, 8 * k, -8 * k, 0), ortho);
      }
    });
    // captions and score digits the game writes into the BG map (tiles that differ from the court's own map)
    // are drawn where they are on screen, as an overlay
    const m = this.gb.mem, v0 = m.vram[0], v1 = m.vram[1], base = this.bgBase(), pristine = this.courtMaps[this.courtId];
    for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) {
      const i = ty * 32 + tx, tile = v0[base + i]; if (tile === pristine[i]) continue;
      const sx = ((tx * 8 - p.scx) & 255), sy = ((ty * 8 - p.scy) & 255); if (sx >= 160 || sy >= 144) continue;
      this.draw(this.bgTileTexture(tile, v1[base + i]), m4.trs(sx + 4, sy + 8, 0, 8, -8, 0), ortho);
    }
    // the window layer (score panel) as a screen-space overlay from the 2D frame
    if ((p.lcdc & 0x20) && p.wy < 144 && frame2d) {
      if (!this.frameTex) this.frameTex = this.texture(160, 144, null);
      gl.bindTexture(gl.TEXTURE_2D, this.frameTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(frame2d.buffer));
      const wy = p.wy, wx = Math.max(0, p.wx - 7);
      this.draw(this.frameTex, m4.trs(wx + (160 - wx) / 2, 144, 0, 160 - wx, -(144 - wy), 0), ortho, [wx / 160, wy / 144, (160 - wx) / 160, (144 - wy) / 144], [1, 1, 1, 1], 0);
    }
  }
  hudOrtho() {                                             // 160x144 screen space letterboxed into the canvas (+ its edges)
    const a = this.cv.width / this.cv.height, g = 160 / 144;
    if (a >= g) { const w = 144 * a, m = (w - 160) / 2; return { ortho: m4.ortho(-m, 160 + m, 144, 0, -1, 1), l: -m, r: 160 + m, t: 0, b: 144 }; }
    const h = 160 / a, m = (h - 144) / 2; return { ortho: m4.ortho(0, 160, 144 + m, -m, -1, 1), l: 0, r: 160, t: -m, b: 144 + m };
  }

  // ---- RPG areas: the whole 64x64 map as a floor, solid metatiles (collision grid) as extruded boxes ----
  composeField() {                                      // WRAM3 tilemap + WRAM2 attributes (stride 64) -> 512x512 RGBA
    const m = this.gb.mem, p = this.gb.ppu, tm = m.wram[3], at = m.wram[2], v0 = m.vram[0], v1 = m.vram[1], lcdc = p.lcdc;
    const img = new Uint8Array(512 * 512 * 4), w0 = m.wram[0], MW = w0[0x32B] || 64, MH = w0[0x32C] || 64;   // wMapWidth/Height (tiles)
    for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
      if (tx >= MW || ty >= MH) {             // beyond the map: leftovers in WRAM, shown as dark ground
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const o = ((ty * 8 + y) * 512 + tx * 8 + x) * 4; img[o] = 16; img[o + 1] = 20; img[o + 2] = 28; img[o + 3] = 255; }
        continue;
      }
      const i = ty * 64 + tx, tile = tm[i], attr = at[i], bank = attr & 8 ? v1 : v0;
      const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      for (let y = 0; y < 8; y++) {
        const row = attr & 0x40 ? 7 - y : y, lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1];
        for (let x = 0; x < 8; x++) {
          const bit = attr & 0x20 ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), c = this.col5(p.bgPal, attr & 7, ci);
          const o = ((ty * 8 + y) * 512 + tx * 8 + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
        }
      }
    }
    return img;
  }
  // keyed cut-out of a map rectangle: pixels of the surrounding ground colours connected to the rectangle's
  // edge become transparent (interior pixels of the same colour stay, so canopies keep their shading)
  keyedCut(art, x0, y0, w, h) {
    const hist = new Map(); let n = 0;
    const col = (x, y) => { if (x < 0 || y < 0 || x >= 512 || y >= 512) return -1; const o = (y * 512 + x) * 4; return art[o] << 16 | art[o + 1] << 8 | art[o + 2]; };
    for (let k = 1; k <= 3; k++) {
      for (let x = x0 - 3; x < x0 + w + 3; x++) for (const y of [y0 - k, y0 + h - 1 + k]) { const c = col(x, y); if (c >= 0) { hist.set(c, (hist.get(c) || 0) + 1); n++; } }
      for (let y = y0; y < y0 + h; y++) for (const x of [x0 - k, x0 + w - 1 + k]) { const c = col(x, y); if (c >= 0) { hist.set(c, (hist.get(c) || 0) + 1); n++; } }
    }
    const keys = new Set([...hist].filter(([, v]) => v >= n * 0.05).map(([c]) => c));
    const d = new Uint8Array(w * h * 4), out = new Uint8Array(w * h), st = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, s = ((y0 + y) * 512 + x0 + x) * 4; d[o] = art[s]; d[o + 1] = art[s + 1]; d[o + 2] = art[s + 2]; d[o + 3] = 255; }
    const push = (x, y) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (out[i] || !keys.has(col(x0 + x, y0 + y))) return; out[i] = 1; st.push(i); };
    for (let x = 0; x < w; x++) { push(x, 0); push(x, h - 1); } for (let y = 0; y < h; y++) { push(0, y); push(w - 1, y); }
    while (st.length) { const i = st.pop(), x = i % w, y = (i / w) | 0; d[i * 4 + 3] = 0; push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1); }
    return d;
  }
  // tile-aligned instances of a stamp: every tile position where >= 80% of the stamp's tiles (index + attributes
  // without the priority bit) are the same
  findStamps(st) {
    const m = this.gb.mem, tm = m.wram[3], at = m.wram[2], tw = st.w >> 3, th = st.h >> 3, sx = st.x >> 3, sy = st.y >> 3;
    const key = (x, y) => tm[y * 64 + x] | ((at[y * 64 + x] & 0x6F) << 8), tpl = [];
    for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) tpl.push(key(sx + x, sy + y));
    const need = Math.ceil(tpl.length * 0.8), hits = [], w0 = m.wram[0], MW = Math.min(64, w0[0x32B] || 64), MH = Math.min(64, w0[0x32C] || 64);
    for (let ty = 0; ty + th <= MH; ty++) for (let tx = 0; tx + tw <= MW; tx++) {   // inside the map only (leftover tiles beyond it repeat)
      let ok = 0; for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) if (key(tx + x, ty + y) === tpl[y * tw + x]) ok++;
      if (ok >= need) hits.push({ x: tx * 8, y: ty * 8 });
    }
    return hits;
  }
  buildFieldObjects(art, floor) {
    const gl = this.gl, f = this.field, def = FIELD_OBJECTS[f.mapId];
    for (const c of f.cards || []) { if (c.own) { gl.deleteTexture(c.tex); this.freeMesh(c.mesh); } }
    if (f.blocks) for (const b of [f.blocks.front, f.blocks.side]) { gl.deleteBuffer(b.pb); gl.deleteBuffer(b.ub); gl.deleteVertexArray(b.vao); }
    if (f.artTex) gl.deleteTexture(f.artTex);
    f.cards = []; f.blocks = null; f.artTex = null; f.covered = new Uint8Array(32 * 32);
    if (!def) return;
    const cover = (x0, y0, x1, y1) => {          // metatiles under annotated objects: no collision box there (it would show as a floor-textured block)
      for (let my = Math.max(0, y0 >> 4); my <= Math.min(31, (y1 - 1) >> 4); my++) for (let mx = Math.max(0, x0 >> 4); mx <= Math.min(31, (x1 - 1) >> 4); mx++) f.covered[my * 32 + mx] = 1;
    };
    const w0 = this.gb.mem.wram[0], MWp = (w0[0x32B] || 64) * 8, MHp = (w0[0x32C] || 64) * 8;
    const inMap = (x0, y0) => x0 < MWp && y0 < MHp;                       // annotations beyond the map size are never on screen
    // cut-outs: keyed images; the floor under their opaque pixels is replaced by the ground strip below them
    const patch = (d, x0, y0, w, h) => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!d[(y * w + x) * 4 + 3]) continue;
        const X = x0 + x, Y = Math.min(511, y0 + h + ((y0 + h - (y0 + y)) % 8)), s = (Y * 512 + X) * 4, o = ((y0 + y) * 512 + X) * 4;
        floor[o] = art[s]; floor[o + 1] = art[s + 1]; floor[o + 2] = art[s + 2];
      }
    };
    for (const st of def.stamps || []) {
      const d = this.keyedCut(art, st.x, st.y, st.w, st.h), shared = { tex: this.texture(st.w, st.h, d), mesh: null, d, own: true };
      let first = true;
      for (const hit of this.findStamps(st)) {
        patch(d, hit.x, hit.y, st.w, st.h); cover(hit.x, hit.y, hit.x + st.w, hit.y + st.h);
        f.cards.push({ ...shared, own: first, w: st.w, h: st.h, X: hit.x + st.w / 2, Z: hit.y + st.h, shared }); first = false;
      }
    }
    for (const c of def.cards || []) {
      if (!inMap(c.x0, c.y0)) continue;
      cover(c.x0, c.y0, c.x1, c.y1);
      const w = c.x1 - c.x0, h = c.y1 - c.y0, d = this.keyedCut(art, c.x0, c.y0, w, h);
      patch(d, c.x0, c.y0, w, h);
      f.cards.push({ tex: this.texture(w, h, d), mesh: null, d, own: true, w, h, X: c.x0 + w / 2, Z: c.y1 });
    }
    // buildings: one batched mesh for roofs + fronts, one for the side walls (drawn darker)
    const front = { pos: [], uv: [] }, side = { pos: [], uv: [] };
    const quad = (o, a, b, c, d, ua, ub, uc, ud) => { for (const [v, t] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) { o.pos.push(...v); o.uv.push(t[0] / 512, t[1] / 512); } };
    for (const b of def.blocks || []) {
      if (!inMap(b.x0, b.y0)) continue;
      cover(b.x0, b.y0, b.x1, b.y1);
      const H = (b.y1 - b.fold) * WALL_SCALE, { x0, x1, y0, y1, fold } = b;
      quad(front, [x0, H, y0], [x1, H, y0], [x1, H, y1], [x0, H, y1], [x0, y0], [x1, y0], [x1, fold], [x0, fold]);   // roof
      quad(front, [x0, 0, y1], [x1, 0, y1], [x1, H, y1], [x0, H, y1], [x0, y1], [x1, y1], [x1, fold], [x0, fold]);   // front wall
      quad(side, [x0, 0, y0], [x0, 0, y1], [x0, H, y1], [x0, H, y0], [x0, y1], [x0 + 6, y1], [x0 + 6, fold], [x0, fold]);   // left wall
      quad(side, [x1, 0, y1], [x1, 0, y0], [x1, H, y0], [x1, H, y1], [x1 - 6, y1], [x1, y1], [x1, fold], [x1 - 6, fold]);   // right wall
    }
    const upload = o => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(o.pos), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(o.uv), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(this.vao); return { vao, pb, ub, count: o.pos.length / 3 };
    };
    if (front.pos.length) { f.blocks = { front: upload(front), side: upload(side) }; f.artTex = this.texture(512, 512, art); }
  }
  buildField() {
    const gl = this.gl, f = this.field, coll = this.gb.mem.wram[6];
    if (f.floorTex) gl.deleteTexture(f.floorTex);
    const art = this.composeField(), floor = new Uint8Array(art);
    this.buildFieldObjects(art, floor);
    f.floorTex = this.texture(512, 512, floor);
    // walls: one box (top + 4 sides) per solid 16x16 metatile, uv = the metatile's own texels; sides share them
    const H = 14, pos = [], uv = [];
    const quad = (a, b, c, d, u) => { for (const [v, t] of [[a, u[0]], [b, u[1]], [c, u[2]], [a, u[0]], [c, u[2]], [d, u[3]]]) { pos.push(...v); uv.push(...t); } };
    let n = 0;
    for (let my = 0; my < 32; my++) for (let mx = 0; mx < 32; mx++) {
      if (coll[my * 32 + mx] !== 0x0F || (f.covered && f.covered[my * 32 + mx])) continue;
      const x0 = mx * 16, x1 = x0 + 16, z0 = my * 16, z1 = z0 + 16, u0 = x0 / 512, u1 = x1 / 512, v0 = z0 / 512, v1 = z1 / 512;
      const top = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], side = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      quad([x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1], top);
      const solid = (x, y) => x >= 0 && y >= 0 && x < 32 && y < 32 && coll[y * 32 + x] === 0x0F;
      if (!solid(mx, my + 1)) quad([x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1], side);
      if (!solid(mx, my - 1)) quad([x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0], side);
      if (!solid(mx - 1, my)) quad([x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0], side);
      if (!solid(mx + 1, my)) quad([x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1], side);
      n++;
    }
    if (f.walls) { gl.deleteBuffer(f.walls.pb); gl.deleteBuffer(f.walls.ub); gl.deleteVertexArray(f.walls.vao); }
    const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pos), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    f.walls = { vao, pb, ub, count: pos.length / 3 }; f.wallCount = n;
    gl.bindVertexArray(this.vao);
  }
  renderField(frame2d) {
    const gl = this.gl, cv = this.cv, m = this.gb.mem, p = this.gb.ppu, f = this.field, id = this.mapId(), c = this.cam;
    this.mode = "field";
    let ph = 0; for (let i = 0; i < 64; i += 3) ph = (ph * 31 + p.bgPal[i]) | 0;
    if (f.mapId !== id || f.palHash !== ph) { f.mapId = id; f.palHash = ph; this.buildField(); }
    const sc = this.fieldScroll(), cx = sc.x + 80, cz = sc.y + 72, aspect = cv.width / cv.height;
    const yaw = this.freeCam ? c.yaw : 0, pitch = this.freeCam ? c.pitch : FIELD_CAM.pitch, dist = this.freeCam ? c.dist : FIELD_CAM.dist * Math.max(1, (160 / 144) / aspect);
    const eye = [cx + dist * Math.sin(yaw) * Math.cos(pitch), dist * Math.sin(pitch), cz + dist * Math.cos(yaw) * Math.cos(pitch)];
    const mvp = m4.mul(m4.perspective(FIELD_CAM.fov, aspect, FIELD_CAM.near, FIELD_CAM.far), m4.lookAt(eye, [cx, 0, cz], [0, 1, 0]));
    // floor (512x512 map px; +z = down the map)
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    this.draw(f.floorTex, m4.trs(256, -0.2, 512, 512, 512, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);
    // walls
    if (f.walls && f.walls.count) {
      gl.useProgram(this.prog3); gl.bindVertexArray(f.walls.vao); gl.bindTexture(gl.TEXTURE_2D, f.floorTex);
      gl.uniformMatrix4fv(this.u3.uMVP, false, mvp); gl.uniform4fv(this.u3.uTint, [0.85, 0.85, 0.85, 1]); gl.uniform1f(this.u3.uAlphaTest, 0);
      gl.drawArrays(gl.TRIANGLES, 0, f.walls.count);
      gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    }
    // buildings (roof + front wall, then the darker side walls) and the stand-up cut-outs
    if (f.blocks) {
      gl.useProgram(this.prog3); gl.bindTexture(gl.TEXTURE_2D, f.artTex); gl.uniformMatrix4fv(this.u3.uMVP, false, mvp); gl.uniform1f(this.u3.uAlphaTest, 0);
      for (const [b, k] of [[f.blocks.front, 1], [f.blocks.side, 0.68]]) { gl.bindVertexArray(b.vao); gl.uniform4fv(this.u3.uTint, [k, k, k, 1]); gl.drawArrays(gl.TRIANGLES, 0, b.count); }
      gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    }
    for (const c of f.cards || []) {
      if (this.voxelSprites) {
        const owner = c.shared || c; if (!owner.mesh) owner.mesh = this.meshFromPixels(c.d, c.w, c.h, 4, 3.5);
        this.drawMesh(owner.mesh, m4.trs3(c.X, 0, c.Z, 1, 1, 1, -FIELD_TILT), mvp);
      } else this.draw(c.tex, m4.trs(c.X, 0, c.Z, c.w, c.h, -FIELD_TILT, 0), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.5);
    }
    // actors: OAM sprites grouped into objects (touching boxes) at map px (screen + scroll), 1 px = 1 unit, leaning back
    const sprs = this.collectSprites(); sprs.forEach((s, i) => s.g = i);
    const find = i => { while (sprs[i].g !== i) i = sprs[i].g = sprs[sprs[i].g].g; return i; };
    for (let i = 0; i < sprs.length; i++) for (let j = i + 1; j < sprs.length; j++) { const a = sprs[i], b = sprs[j]; if (a.sx < b.sx + 10 && b.sx < a.sx + 10 && a.sy < b.sy + b.h + 2 && b.sy < a.sy + a.h + 2) sprs[find(j)].g = find(i); }
    const groups = new Map();
    for (const sp of sprs) { const r = find(sp.g); let g = groups.get(r); if (!g) groups.set(r, g = { list: [], x0: 999, x1: -999, y1: -999 }); g.list.push(sp); g.x0 = Math.min(g.x0, sp.sx); g.x1 = Math.max(g.x1, sp.sx + 8); g.y1 = Math.max(g.y1, sp.sy + sp.h); }
    const TILT = 0.3;
    for (const g of groups.values()) {
      const cx2 = (g.x0 + g.x1) / 2, X = cx2 + sc.x, Z = g.y1 + sc.y;
      this.draw(this.shadowTex, m4.trs(X, 0.3, Z + 1, (g.x1 - g.x0) * 1.1, 7, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.7], 0);
      this.blitObject(g.list, cx2, g.y1, X, Z, 0, 1, TILT, mvp);
    }
    // dialogue boxes and menus: the game writes them into the BG tile map over the scenery (and some screens use
    // the window layer); both are cut out of the 2D frame and shown at the top middle of the view
    this.drawFieldOverlays(frame2d);
  }
  // screen rectangles (px) of BG tiles that differ from the WRAM3 map at the field scroll, and of window rows
  fieldOverlayRects() {
    const m = this.gb.mem, p = this.gb.ppu, v0 = m.vram[0], tm = m.wram[3], base = this.bgBase(), sc = this.fieldScroll();
    const fx = p.scx & 7, fy = p.scy & 7, vx = p.scx >> 3, vy = p.scy >> 3;
    const GW = 21, GH = 19, diff = new Uint8Array(GW * GH);
    // while walking, the scroll counters and the tile map can be a tile apart for a frame: use the map offset
    // (field scroll +-1 tile) that best matches what is on screen
    let mx = sc.x >> 3, my = sc.y >> 3, bestN = -1;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      const ax = (sc.x >> 3) + ox, ay = (sc.y >> 3) + oy; let n = 0;
      for (let ty = 0; ty < GH; ty += 2) for (let tx = 0; tx < GW; tx += 2) { const X = ax + tx, Y = ay + ty; if (X < 0 || Y < 0 || X >= 64 || Y >= 64) continue; if (v0[base + (((vy + ty) & 31) << 5) + ((vx + tx) & 31)] === tm[Y * 64 + X]) n++; }
      if (n > bestN) { bestN = n; mx = ax; my = ay; }
    }
    for (let ty = 0; ty < GH; ty++) for (let tx = 0; tx < GW; tx++) {
      const X = mx + tx, Y = my + ty; if (X < 0 || Y < 0 || X >= 64 || Y >= 64) continue;
      if (ty === 0 || tx === 0 || ty === GH - 1 || tx === GW - 1) {          // edge rows/columns are streamed in while scrolling
        if (ty !== 0 && ty !== GH - 1 && tx !== 0 && tx !== GW - 1) continue;
      }
      if (v0[base + (((vy + ty) & 31) << 5) + ((vx + tx) & 31)] !== tm[Y * 64 + X]) diff[ty * GW + tx] = 1;
    }
    const rects = [], seen = new Uint8Array(GW * GH);
    for (let i = 0; i < GW * GH; i++) {
      if (!diff[i] || seen[i]) continue;
      let x0 = 99, y0 = 99, x1 = -1, y1 = -1, n = 0; const st = [i]; seen[i] = 1;
      while (st.length) {
        const j = st.pop(), tx = j % GW, ty = (j / GW) | 0; n++;
        x0 = Math.min(x0, tx); x1 = Math.max(x1, tx); y0 = Math.min(y0, ty); y1 = Math.max(y1, ty);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = tx + dx, ny = ty + dy; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue; const k = ny * GW + nx; if (diff[k] && !seen[k]) { seen[k] = 1; st.push(k); } }
      }
      if (n < 6 || x1 - x0 < 2 || y1 - y0 < 1) continue;        // a box is at least 3x2 tiles; lone tiles and single rows are streaming seams
      if (n < (x1 - x0 + 1) * (y1 - y0 + 1) * 0.7) continue;     // text boxes are solid rectangles, scroll seams are ragged
      const r = { x0: Math.max(0, x0 * 8 - fx), y0: Math.max(0, y0 * 8 - fy), x1: Math.min(160, (x1 + 1) * 8 - fx), y1: Math.min(144, (y1 + 1) * 8 - fy) };
      if (r.x1 > r.x0 && r.y1 > r.y0) rects.push(r);
    }
    let wy0 = -1, wy1 = -1, wx = 160;                           // window rows (raster splits included)
    for (let y = 0; y < 144; y++) if (p.winX[y] !== 255) { if (wy0 < 0) wy0 = y; wy1 = y + 1; wx = Math.min(wx, p.winX[y]); }
    if (wy0 >= 0) rects.push({ x0: wx, y0: wy0, x1: 160, y1: wy1 });
    return rects;
  }
  drawFieldOverlays(frame2d) {
    const rects = this.fieldOverlayRects(); if (this.debug) this.debug.push({ overlays: rects });
    if (!rects.length || !frame2d) return;
    const gl = this.gl;
    if (!this.frameTex) this.frameTex = this.texture(160, 144, null);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(frame2d.buffer));
    gl.disable(gl.DEPTH_TEST);
    const { ortho, t, b } = this.hudOrtho();
    rects.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    let y = t + 3 + (this.topInset || 0) * (b - t) / (this.cv.clientHeight || 1);   // stacked from the top edge (below the HUD bar), centred
    for (const r of rects) {
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      this.draw(this.shadowTex, m4.trs(80 + 2, y + h + 2, 0, w, -h, 0), ortho, [0, 0, 1, 1], [1, 1, 1, 0.7], 0);
      this.draw(this.frameTex, m4.trs(80, y + h, 0, w, -h, 0), ortho, [r.x0 / 160, r.y0 / 144, w / 160, h / 144], [1, 1, 1, 1], 0);
      y += h + 2;
    }
  }

  // ---- menus, title, mini-games: a static view with depth. The PPU's background-only frame (raster scroll
  // effects included) is cut into layers: the backdrop, the panels standing on it (boxes, logos, icons, text),
  // the window layer, and the sprites, each a little closer to the camera with a soft shadow on the layer below.
  // Which background cells are panels: cells whose palette is rare along the screen border (the backdrop is the
  // picture or pattern that reaches the edges), plus any cell drawn with the BG-over-sprite priority bit.
  menuLayers() {
    const p = this.gb.ppu, m = this.gb.mem, v1 = m.vram[1], cell = p.pixCell, L = this.layer;
    const hist = new Uint32Array(8); let n = 0;
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x += (y === 0 || y === 143) ? 1 : 159) {
      const c = cell[y * 160 + x]; if (c & 0x8000) continue; hist[v1[c] & 7]++; n++;
    }
    const back = new Uint8Array(8); for (let k = 0; k < 8; k++) back[k] = n && hist[k] >= n * 0.15 ? 1 : 0;
    if (!back.some(Boolean)) back.fill(1);
    const N = 160 * 144, mask = L.mask || (L.mask = new Uint8Array(N));   // 0 backdrop, 1 panel, 2 window
    for (let i = 0; i < N; i++) { const c = cell[i]; mask[i] = c & 0x8000 ? 2 : (back[v1[c] & 7] && !(v1[c] & 0x80)) ? 0 : 1; }
    // a panel must be a solid region, not stray pixels of a rare palette inside the backdrop picture: drop
    // panel components smaller than 64 px
    const seen = L.seen || (L.seen = new Uint8Array(N)); seen.fill(0); const st = [];
    for (let i = 0; i < N; i++) {
      if (mask[i] !== 1 || seen[i]) continue;
      const comp = []; st.push(i); seen[i] = 1;
      while (st.length) { const j = st.pop(); comp.push(j); const x = j % 160; for (const k of [j - 160, j + 160, x ? j - 1 : -1, x < 159 ? j + 1 : -1]) if (k >= 0 && k < N && !seen[k] && mask[k] === 1) { seen[k] = 1; st.push(k); } }
      if (comp.length < 64) for (const j of comp) mask[j] = 0;
    }
    return mask;
  }
  layerTexture(key, rgba) {
    const gl = this.gl, L = this.layer;
    if (!L[key]) L[key] = this.texture(160, 144, null);
    gl.bindTexture(gl.TEXTURE_2D, L[key]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return L[key];
  }
  renderLayers() {
    const gl = this.gl, cv = this.cv, p = this.gb.ppu, L = this.layer; this.mode = "layers";
    const mask = this.menuLayers(), N = 160 * 144, src = new Uint8Array(p.bgFrame.buffer);
    const back = L.back || (L.back = new Uint8Array(N * 4)), pan = L.pan || (L.pan = new Uint8Array(N * 4)), win = L.winBuf || (L.winBuf = new Uint8Array(N * 4));
    back.set(src); pan.fill(0); win.fill(0);
    for (let i = 0; i < N; i++) {
      if (!mask[i]) continue;
      const o = i * 4, dst = mask[i] === 1 ? pan : win;
      dst[o] = src[o]; dst[o + 1] = src[o + 1]; dst[o + 2] = src[o + 2]; dst[o + 3] = 255;
      back[o] = back[o] * 0.55; back[o + 1] = back[o + 1] * 0.55; back[o + 2] = back[o + 2] * 0.55;   // under a panel: in its shadow
    }
    const tBack = this.layerTexture("tBack", back), tPan = this.layerTexture("tPan", pan), tWin = this.layerTexture("tWin", win);
    // static camera straight at the screen; each layer is scaled so its pixels stay where the game draws them
    // (the perspective then shows only in the shadows and the voxel sides)
    // fit below the touch button bar so the top row (title banners) is not hidden under it
    const insetPx = Math.round((this.topInset || 0) * cv.width / (cv.clientWidth || cv.width));
    if (insetPx > 0 && insetPx < cv.height / 3) gl.viewport(0, 0, cv.width, cv.height - insetPx);
    const D = 600, aspect = cv.width / (cv.height - (insetPx < cv.height / 3 ? insetPx : 0)), fovY = aspect >= 160 / 144 ? 2 * Math.atan(72 / D) : 2 * Math.atan(80 / aspect / D);
    const flip = new Float32Array([1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    const mvp = m4.mul(m4.mul(m4.perspective(fovY, aspect, 10, 4000), m4.lookAt([80, -72, D], [80, -72, 0], [0, 1, 0])), flip);
    const plane = (tex, z, tint = [1, 1, 1, 1], dx = 0, dy = 0, a = 0.5) => { const k = (D - z) / D; this.draw(tex, m4.trs(80 + (dx) + 0 * k, 72 + 72 * k + dy, z, 160 * k, -144 * k, 0), mvp, [0, 0, 1, 1], tint, a); };
    gl.enable(gl.DEPTH_TEST);
    // the backdrop is larger than the screen on wide/tall viewports: a dimmed copy far behind fills the margins
    this.draw(tBack, m4.trs(80, 72 + 144 * 1.3, -300, 160 * 2.6, -144 * 2.6, 0), mvp, [0, 0, 1, 1], [0.25, 0.25, 0.3, 1], 0);
    plane(tBack, 0, [1, 1, 1, 1], 0, 0, 0);
    const SH = [0, 0, 0, 0.4];
    plane(tPan, 1, [0, 0, 0, 0.22], 4, 4); plane(tPan, 1.5, SH, 2.5, 2.5); plane(tPan, 8);   // a soft two-step shadow
    plane(tWin, 9, [0, 0, 0, 0.22], 4, 4); plane(tWin, 9.5, SH, 2.5, 2.5); plane(tWin, 14);
    // sprites: cards (or voxels) in front, each with a drop shadow; OBJ-to-BG priority sprites sit between the layers
    const sprs = this.collectSprites();
    for (const s of sprs) {
      const z = s.attr & 0x80 ? 4 : 20, k = (D - z) / D, X = 80 + (s.sx + 4 - 80) * k;
      for (let half = 0; half < s.h / 8; half++) {
        const tile = s.tile + (s.attr & 0x40 ? (s.h / 8 - 1 - half) : half), bank = (s.attr >> 3) & 1, pal = s.attr & 7, fx = (s.attr >> 5) & 1, fy = (s.attr >> 6) & 1;
        const Y = 72 + (s.sy + (half + 1) * 8 - 72) * k, tex = this.spriteTexture(tile, bank, pal, fx, fy);
        this.draw(tex, m4.trs(X + 2, Y + 2, z - 3, 8 * k, -8 * k, 0), mvp, [0, 0, 1, 1], SH);
        if (this.voxelSprites) this.drawMesh(this.voxelMesh(tile, bank, pal, fx, fy), m4.trs3(X, Y, z, k, -k, 2, 0), mvp);
        else this.draw(tex, m4.trs(X, Y, z, 8 * k, -8 * k, 0), mvp);
      }
    }
  }
  drawFlatFrame(frame) {                            // the plain 2D frame as a textured quad filling the canvas
    const gl = this.gl;
    if (!this.frameTex) this.frameTex = this.texture(160, 144, null);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(frame.buffer));
    gl.disable(gl.DEPTH_TEST);
    this.draw(this.frameTex, m4.trs(0, -1, 0, 2, 2, 0), m4.identity(), [0, 0, 1, 1], [1, 1, 1, 1], 0);
  }
  // pointer position drives the menu parallax; the device's tilt (relative to how it is held) too.
  // With freeCam (?freecam): one finger / mouse orbits the court or field camera, two fingers pinch, wheel zooms.
  bindControls() {
    const cv = this.cv, c = this.cam, px = this.parallax, pts = new Map(); let drag = null, pinch = null;
    const dist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const rebase = () => {
      if (pts.size === 1) { const [p] = pts.values(); drag = { x: p.x, y: p.y, yaw: c.yaw, pitch: c.pitch }; pinch = null; }
      else if (pts.size === 2) { drag = null; pinch = { d: Math.max(10, dist()), dist: c.dist }; }
      else { drag = null; pinch = null; }
    };
    const setParallax = e => { const r = cv.getBoundingClientRect(); if (!r.width || !r.height) return; px.px = Math.max(-1, Math.min(1, (e.clientX - r.left) / r.width * 2 - 1)); px.py = Math.max(-1, Math.min(1, (e.clientY - r.top) / r.height * 2 - 1)); };
    cv.addEventListener("pointerdown", e => {
      setParallax(e); if (!this.freeCam) return;
      try { cv.setPointerCapture(e.pointerId); } catch (err) { return; }
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); rebase();
    });
    cv.addEventListener("pointermove", e => {
      if (e.pointerType === "mouse" || pts.has(e.pointerId)) setParallax(e);
      if (!this.freeCam || !pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pts.size === 2) { c.dist = Math.max(200, Math.min(30000, pinch.dist * pinch.d / Math.max(10, dist()))); return; }
      if (!drag) return; c.yaw = drag.yaw + (e.clientX - drag.x) * 0.006; c.pitch = Math.max(0.15, Math.min(1.5, drag.pitch + (e.clientY - drag.y) * 0.006));
    });
    const up = e => { pts.delete(e.pointerId); rebase(); };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up); cv.addEventListener("lostpointercapture", up);
    cv.addEventListener("wheel", e => { if (!this.freeCam) return; e.preventDefault(); c.dist = Math.max(200, Math.min(30000, c.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
    if (typeof window !== "undefined" && "DeviceOrientationEvent" in window) {
      window.addEventListener("deviceorientation", e => {
        if (e.gamma == null || e.beta == null) return;
        if (!px.gbase) px.gbase = { g: e.gamma, b: e.beta };
        px.gbase.g += (e.gamma - px.gbase.g) * 0.01; px.gbase.b += (e.beta - px.gbase.b) * 0.01;   // the resting pose drifts to neutral
        px.gx = Math.max(-1, Math.min(1, (e.gamma - px.gbase.g) / 25)); px.gy = Math.max(-1, Math.min(1, (e.beta - px.gbase.b) / 25));
      });
    }
  }
}

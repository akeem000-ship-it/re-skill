// 3D "diorama" renderer for the running game (VoxelMod-style view). Three scene kinds:
//  * court (a court tilemap is loaded): the court tilemap is un-projected through the game's own fixed
//    projection (ProjectPoint, camera.js) onto a flat ground plane; the players stand at their real world
//    positions (wPlayerX/Y/Z of each player bank), the ball at its true height (wBall*) with a shadow at
//    its ground point; the net, the umpire chair and the far fence/stands are cut out of the floor and
//    stood upright; a locked camera preset frames the court for the viewport (see PRESETS).
//  * field (an RPG map is on screen): the 64x64 map is a floor, solid metatiles are extruded boxes,
//    actors are billboards, the window layer stays a 2D overlay. Annotated objects (field_objects.js, cut out by
//    field3d.js) stand up: buildings, cut-outs, low solids, trees and bushes as voxel bodies; plants and flowers
//    rustle in a travelling wind and fountains spout (shader-animated), and
//    map tiles the game animates (fountain water) are redrawn into the textures. Fades only recolour.
//  * everything else (title, menus, mini-games): the BG, window and sprite layers are stacked at
//    different depths and a gently swaying camera gives them parallax.
// Sprites are textured cards or, in voxel mode, one lit cube per opaque pixel.
import { project } from "./camera.js";
import { courtTilemaps, courtImage, courtIndexMap, COURTS } from "./assets.js";
import { FIELD_OBJECTS } from "./field_objects.js";
import * as F3 from "./field3d.js";
import { FS_SHIM, VS_GLASS, FS_GLASS, WindowShimmer } from "./shimmer.js";   // SHIMMER: window shimmer + glass walls
import { roundedMeshData } from "./voxround.js";
import { surfaceKind, buildDetail, paintFloor } from "./courtfloor.js";   // HD court floors   // VOXSTYLE: "VOX: Blocky / Rounded"

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
// overworld animations, all moved on the GPU from a time uniform (no per-frame buffer or texture rebuilds):
// swaying voxels (flowers): each box slides with the wind by its sway weight (0 at the stem's foot, 1 at the top),
// in whole steps of a quarter pixel so the motion keeps the pixel look
// (plants: one mesh per shape drawn per instance, uModel placing it and uPhase its place in the travelling wind)
const VSW = `#version 300 es
in vec3 aPosW; in vec3 aColW; in vec2 aSwayW; uniform mat4 uMVP; uniform mat4 uModel; uniform float uTime; uniform float uAmp; uniform float uPhase; out vec3 vCol;
void main() {
  float ph = aSwayW.y + uPhase, s = sin(uTime * 1.9 + ph) * 0.75 + sin(uTime * 3.3 + ph * 1.7) * 0.25;
  float dx = floor(s * uAmp * aSwayW.x * 4.0 + 0.5) / 4.0;
  vCol = aColW; gl_Position = uMVP * uModel * vec4(aPosW + vec3(dx, -abs(dx) * 0.3, dx * 0.35), 1.0);
}`;
// plants: the same wind on voxel bodies coloured from the map texture (aSway = weight, face shade)
const VSP = `#version 300 es
in vec3 aPosP; in vec2 aUVP; in vec3 aSwayP; uniform mat4 uMVP; uniform mat4 uModel; uniform float uTime; uniform float uAmp; uniform float uPhase; out vec2 vUV; out float vShade;
void main() {
  float ph = uPhase + aSwayP.z, s = sin(uTime * 1.9 + ph) * 0.75 + sin(uTime * 3.3 + ph * 1.7) * 0.25, dx = floor(s * uAmp * aSwayP.x * 4.0 + 0.5) / 4.0;
  vUV = aUVP; vShade = aSwayP.y; gl_Position = uMVP * uModel * vec4(aPosP + vec3(dx, -abs(dx) * 0.3, dx * 0.35), 1.0);
}`;
const FSP = `#version 300 es
precision mediump float; in vec2 vUV; in float vShade; uniform sampler2D uTex; out vec4 o;
void main() { o = vec4(texture(uTex, vUV).rgb * vShade, 1.0); }`;
// fountain jet: droplet boxes flown along their arcs (kind 0 the rising column, 1 the falling crown, 2 splashes on the
// pool), positions snapped to half pixels; uJet = (column height, crown radius, droplet size, -)
const VSJ = `#version 300 es
in vec4 aCorner; in vec4 aSeed; uniform mat4 uMVP; uniform float uTime; uniform vec3 uOrigin; uniform vec4 uJet;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; out vec3 vCol;
void main() {
  float kind = aSeed.w, sp = aSeed.z, a = aSeed.y, H = uJet.x * (0.8 + 0.2 * sp), R = uJet.y * (0.55 + 0.45 * sp);
  float T = kind < 0.5 ? 0.9 : kind < 1.5 ? 1.3 : 0.5, t = fract(uTime / T + aSeed.x), r, y, size = uJet.z;
  vec3 col;
  if (kind < 0.5) { y = H * (1.0 - (1.0 - t) * (1.0 - t)); r = 0.35 * sp; col = mix(uC0, uC1, step(0.75, sp)); size *= 1.3; }
  else if (kind < 1.5) { y = H * (1.0 + 0.35 * t - 1.35 * t * t); r = R * t; col = mix(uC0, uC1, step(0.4, sp) * t); }
  else { y = 2.2 * 4.0 * t * (1.0 - t) * (0.5 + sp); r = R + 1.5 * t; col = mix(uC1, uC2, step(0.5, sp)); size *= 0.8; }
  vec3 p = floor((vec3(cos(a) * r, y, sin(a) * r * 0.85)) * 2.0 + 0.5) / 2.0;
  vCol = col * aCorner.w; gl_Position = uMVP * vec4(uOrigin + p + aCorner.xyz * size, 1.0);
}`;
// ripples on a pool: rings spreading from the middle, drawn in the pool's own pixels (the quad covers the pool
// rectangle, uSize its size in map px), clipped to the inscribed ellipse
const FSR = `#version 300 es
precision mediump float; in vec2 vUV; uniform float uTime; uniform vec2 uSize; uniform vec3 uCol; out vec4 o;
void main() {
  vec2 px = floor(vUV * uSize) + 0.5, q = (px - uSize * 0.5) / (uSize * 0.5); float d = length(q), a = 0.0;
  if (d > 0.97) discard;
  for (int k = 0; k < 3; k++) { float ph = fract(uTime * 0.42 + float(k) / 3.0), rr = 0.22 + ph * 0.75; if (abs(d - rr) < 1.3 / (uSize.y * 0.5)) a = max(a, 1.0 - ph); }
  a = floor(a * 3.0) / 3.0 * 0.8; if (a < 0.05) discard; o = vec4(uCol, a);
}`;

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
// courts the 3D court view knows: the match courts plus the training court (map 6, where the mini-games / drills such as
// the Tennis Machine are played: the same projection, players in the player banks, a machine panel as the far court)
const VIEW_COURTS = [...COURTS, 6];
const NET = { x0: -640, x1: 640, height: 96 };                           // posts at BG px 48/208, tape at Z = -96
// BG-pixel rectangles of the court map that stand upright instead of lying on the floor
const CUTS = [
  { name: "net",      x0: 40,  y0: 116, x1: 216, y1: 130, fill: "below" },              // the net band (top of the tape .. ground line)
  { name: "judge",    x0: 208, y0: 104, x1: 226, y1: 136, fill: "tile", key: true, skip: [6] },   // umpire chair / referee right of the net post
  { name: "backdrop", x0: 0,   y0: 0,   x1: 256, y1: 50,  fill: "below", skip: [6] },   // far fence, stands, castle
  { name: "backdrop", x0: 0,   y0: 0,   x1: 256, y1: 64,  fill: "below", courts: [6] }, // training court: sky and the stands band
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
  { name: "far",   inner: "bottom", seats: { x0: 18,  y0: 12,  x1: 370, y1: 96 },  wall: { x0: 18,  y0: 96,  x1: 370, y1: 112 }, base: 130, plane: { x0: -2030, x1: 2030,  y0: -1800, y1: -2514, h: 290 }, skipCourts: [2, 6, 7, 14] },
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
const WALL_SCALE = F3.WALL_SCALE, FIELD_TILT = 0.3, HUD_SCALE = 0.6;
// the island (map 21) is an aerial picture, not a top-down map: shown as parallax layers. The road between the courts
// (map 19) is a side-view picture too, but it is a walkable map: a field whose sky band and cafe stand up (FIELD_OBJECTS)
const SIDE_VIEW_MAPS = new Set([21]);

export class Voxel3D {
  constructor(canvas, gb, rom = null) {
    this.cv = canvas; this.gb = gb; this.rom = rom; this.courtMaps = rom ? courtTilemaps(rom, VIEW_COURTS) : null; this.courtId = -1; this.detectAt = 0; this.fieldAt = 0; this.fieldOn = false; this.stands = null;
    const gl = this.gl = canvas.getContext("webgl2", { alpha: false, antialias: true });
    if (!gl) throw new Error("WebGL2 unavailable");
    this.prog = this.link(VS, FS);
    this.u = {}; for (const n of ["uMVP", "uModel", "uUVRect", "uTex", "uTint", "uAlphaTest"]) this.u[n] = gl.getUniformLocation(this.prog, n);
    this.prog3 = this.link(VS3, FS, ["aPos3", "aUV3"]);
    this.u3 = {}; for (const n of ["uMVP", "uTex", "uTint", "uAlphaTest"]) this.u3[n] = gl.getUniformLocation(this.prog3, n);
    this.shimmer = new WindowShimmer(this);                                              // SHIMMER (voxel.shimmer.on / setOn: the LIGHT panel's "Window shimmer")
    this.progS = this.link(VS3, FS_SHIM, ["aPos3", "aUV3"]); this.uS = {}; for (const n of ["uMVP", "uTex", "uTint", "uAlphaTest", "uTime", "uShim"]) this.uS[n] = gl.getUniformLocation(this.progS, n);
    this.progG = this.link(VS_GLASS, FS_GLASS, ["aPos3", "aUV3"]); this.uG = {}; for (const n of ["uMVP", "uTime", "uShim"]) this.uG[n] = gl.getUniformLocation(this.progG, n);
    this.progV = this.link(VSV, FSV, ["aPosV", "aColV"]);
    this.uV = {}; for (const n of ["uMVP", "uModel"]) this.uV[n] = gl.getUniformLocation(this.progV, n);
    const uni = (p, names) => Object.fromEntries(names.map(n => [n, gl.getUniformLocation(p, n)]));
    this.progW = this.link(VSW, FSV, ["aPosW", "aColW", "aSwayW"]); this.uW = uni(this.progW, ["uMVP", "uModel", "uTime", "uAmp", "uPhase"]);
    this.progP = this.link(VSP, FSP, ["aPosP", "aUVP", "aSwayP"]); this.uP = uni(this.progP, ["uMVP", "uModel", "uTime", "uAmp", "uPhase", "uTex"]);
    this.progJ = this.link(VSJ, FSV, ["aCorner", "aSeed"]); this.uJ = uni(this.progJ, ["uMVP", "uTime", "uOrigin", "uJet", "uC0", "uC1", "uC2"]);
    this.progR = this.link(VS, FSR); this.uR = uni(this.progR, ["uMVP", "uModel", "uUVRect", "uTime", "uSize", "uCol"]);
    this.voxelMeshes = new Map(); this.objectMeshes = new Map(); this.voxelSprites = false;   // voxelSprites: cubes per opaque pixel instead of cards
    this.field = { mapId: -1, floorTex: null, walls: null, wallCount: 0, palHash: 0, cards: [], blocks: null, artTex: null };
    const quad = new Float32Array([-0.5, 0, 0, 1,  0.5, 0, 1, 1,  -0.5, 1, 0, 0,  0.5, 1, 1, 0]);   // x, y(0..1 up), u, v
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
    this.spriteTex = new Map(); this.groundTex = null; this.groundHash = -1; this.ground = null; this.frameTex = null; this.cuts = [];
    this.layer = { bg: null, win: null, hash: -1, whash: -1 };
    this.boxShadowTex = this.solidTexture([0, 0, 0, 110]);   // drop shadow of the overlay boxes
    this.shadowTex = this.blobTexture();                     // soft round shadow on the ground (players, ball)
    this.stadium = null;                                     // STADIUM: stadium3d.js (attachStadium) sets this; null = the flat stands
    this.light = null;                                       // LIGHT: lighting.js (attachLighting) sets this; null = off
    this.rounded = false;                                    // VOXSTYLE: voxround.js (attachVoxStyle) sets this: rounded solid bodies instead of cubes
    this.ballfx = null;                                      // BALLFX: ballfx.js (attachBallFX) sets this; null = off
    this.preset = "low"; this.cam = { yaw: 0, pitch: 0.9, dist: 3100, fitKey: "" };
    this.freeCam = false; this.mode = "none"; this.t0 = performance.now(); this.cur = null; this.prev = null; this.lastFrame = -1; this.alpha = 1;
    this.parallax = { px: 0, py: 0, gx: 0, gy: 0, gbase: null };
    this.bindControls();
  }
  link(vs, fs, attrs = ["aPos", "aUV"]) {
    const gl = this.gl, mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    attrs.forEach((a, i) => gl.bindAttribLocation(p, i, a)); gl.linkProgram(p);
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
  // HD text (web/js/hdtext.js, set by the page as this.hdText): its background / window canvas (4x the screen) as a
  // texture, uploaded again when the text changed; null when there is none
  hdTex(kind) {
    const h = this.hdText; if (!h || !h.active || !h.has[kind]) return null;
    const T = this.hdTexs || (this.hdTexs = {}), gl = this.gl;
    if (!T[kind]) T[kind] = { tex: this.texture(1, 1, null, true), ver: -1 };
    // premultiplied, so the smoothed edges of the text's patches fade out instead of to black (no outline round them)
    const ver = kind === "spr" ? h.sprVersion : kind === "under" ? h.underVersion : h.version;
    if (T[kind].ver !== ver) {
      gl.bindTexture(gl.TEXTURE_2D, T[kind].tex); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      const cv = h.canvas[kind];
      if (T[kind].w === cv.width && T[kind].h === cv.height) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, cv);      // same size: no new storage
      else { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv); T[kind].w = cv.width; T[kind].h = cv.height; }
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); T[kind].ver = ver;
    }
    return T[kind].tex;
  }
  drawHDText(model, mvp, uv = [0, 0, 1, 1], kinds = ["under", "bg", "win", "spr"]) {
    const gl = this.gl; gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);          // premultiplied (hdTex)
    for (const k of kinds) { const t = this.hdTex(k); if (t) this.draw(t, model, mvp, uv, [1, 1, 1, 1], 0.004); }
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  }
  blobTexture(n = 32) {                                    // black disc fading out to the edge (stretched into an ellipse)
    const d = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const r = Math.hypot((x + 0.5) / n * 2 - 1, (y + 0.5) / n * 2 - 1); d[(y * n + x) * 4 + 3] = r >= 1 ? 0 : Math.round(150 * Math.min(1, (1 - r) * 2.5)); }
    return this.texture(n, n, d, true);
  }
  setPreset(name) { if (PRESETS[name]) { this.preset = name; this.cam.fitKey = ""; } }
  // switch to another machine / ROM (the page loaded a new file): forget everything derived from the old one
  attach(gb, rom = null) {
    this.attachGen = (this.attachGen || 0) + 1; this.fcur = this.fprev = null;
    if (this.stadium) this.stadium.reset();   // STADIUM
    const gl = this.gl;
    this.gb = gb; this.rom = rom; this.courtMaps = rom ? courtTilemaps(rom, VIEW_COURTS) : null;
    this.courtId = -1; this.detectAt = 0; this.fieldAt = 0; this.fieldOn = false; this.fieldMap = -1; this.cur = this.prev = null; this.lastFrame = -1;
    for (const t of this.spriteTex.values()) gl.deleteTexture(t); this.spriteTex.clear(); this.texGen = (this.texGen || 0) + 1; this.meshGen = (this.meshGen || 0) + 1; this.actorMem = null;
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
  // an RPG map is on screen when the VRAM tilemap shows the WRAM3 map at the field scroll (checked every 5 frames).
  // While walking, the field scroll (wC320-23) runs a pixel ahead of SCX for a frame each time it crosses a tile
  // edge, so tile-aligned comparisons would compare neighbouring tiles: the screen is sampled at pixel centres
  // through both scrolls, with a tile of slack either way. Once on, the field view is kept until several checks
  // in a row fail (a new map id re-checks at once), so a single odd frame, or the fade and LCD-off frames of a walk
  // from one map to the next, never drop it to the flat view.
  fieldMatch() {
    const m = this.gb.mem, p = this.gb.ppu, v0 = m.vram[0], tm = m.wram[3], base = p.lcdc & 0x08 ? 0x1C00 : 0x1800, sc = this.fieldScroll();
    let best = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
      let same = 0, n = 0;
      for (let y = 4; y < 144; y += 16) for (let x = 4; x < 160; x += 16) {
        const X = ((sc.x + x) >> 3) + ox, Y = ((sc.y + y) >> 3) + oy; if (X < 0 || Y < 0 || X >= 64 || Y >= 64) continue; n++;
        if (v0[base + ((((p.scy + y) >> 3) & 31) << 5) + (((p.scx + x) >> 3) & 31)] === tm[Y * 64 + X]) same++;
      }
      if (n) best = Math.max(best, same / n);
    }
    return best;
  }
  isField() {
    const id = this.mapId();
    if (id < 17 || id > 36 || SIDE_VIEW_MAPS.has(id)) { this.fieldMap = -1; return this.fieldOn = false; }
    if (id !== this.fieldMap) { this.fieldMap = id; this.fieldAt = 0; this.fieldMiss = 0; }   // from map to map (faded out, LCD off) the field view stays
    const fr = this.gb.ppu.frames; if (fr < this.fieldAt && fr >= this.fieldAt - 5) return this.fieldOn; this.fieldAt = fr + 5;
    if (this.fieldMatch() >= 0.4) { this.fieldOn = true; this.fieldMiss = 0; }   // dialogue boxes written over the map can cover half the screen
    else if (++this.fieldMiss >= 4) this.fieldOn = false;
    return this.fieldOn;
  }
  // a court is loaded when the BG tilemap in VRAM is one of the court maps (checked every 20 frames)
  isCourt() {
    if (!this.courtMaps || this.mapId() > 15) { this.courtId = -1; this.detectAt = 0; this.lastBody = null; return false; }
    const fr = this.gb.ppu.frames; if (fr < this.detectAt) return this.courtId >= 0;
    this.detectAt = fr + 20;
    const v0 = this.gb.mem.vram[0], base = this.gb.ppu.lcdc & 0x08 ? 0x1C00 : 0x1800;
    // the best match, not the first: courts 4 and 5 share most of their map and differ in the far backdrop rows
    this.courtId = -1; let best = 600;
    for (const [id, m] of Object.entries(this.courtMaps)) {
      let same = 0; for (let i = 0; i < 1024; i++) if (v0[base + i] === m[i]) same++;
      if (same > best) { best = same; this.courtId = +id; }
    }
    return this.courtId >= 0;
  }
  // players: one bank per match slot (WRAM4 P1, WRAM5 P2, WRAM6/7 the partners in doubles); wPlayerX/Y/Z at $DF01/04/07
  players() {
    const m = this.gb.mem, n = m.wram[0][0x8F3] >= 4 ? 4 : 2, out = [];
    for (let k = 4; k < 4 + n; k++) {
      const b = m.wram[k], s16 = a => (b[a] | (b[a + 1] << 8)) << 16 >> 16, X = s16(0xF01), Y = s16(0xF04), Z = s16(0xF07);
      if (Math.abs(X) > 1400 || Math.abs(Y) > 2600 || Z > 0 || Z < -600) continue;
      out.push({ X, Y, Z, slot: k });
    }
    return out;
  }
  sampleState() { const p = this.gb.ppu; return { players: this.players(), ball: this.ballWorld(), scx: p.scx, scy: p.scy }; }
  // interpolated world state for the current display frame (positions that jumped are not interpolated)
  interp() { const r = this.interp0(); return this.intro ? this.intro.adjust(r) : r; }   // INTRO: the walk-out moves the drawn players
  interp0() {
    const a = this.alpha, c = this.cur, q = this.prev; if (!c) return this.sampleState(); if (!q || a >= 1) return c;
    const mix = (u, v, lim) => Math.abs(u - v) > lim ? u : v + (u - v) * a;
    const players = c.players.map((pl, i) => { const o = q.players.find(u => u.slot === pl.slot); return o ? { X: mix(pl.X, o.X, 300), Y: mix(pl.Y, o.Y, 300), Z: mix(pl.Z, o.Z, 300), slot: pl.slot } : pl; });
    const ball = { X: mix(c.ball.X, q.ball.X, 600), Y: mix(c.ball.Y, q.ball.Y, 600), Z: mix(c.ball.Z, q.ball.Z, 600) };
    return { players, ball, scx: mix(c.scx, q.scx, 8), scy: mix(c.scy, q.scy, 8) };
  }
  // the overworld at a game frame: the field scroll and the actor table (the slots' map positions), for interpolation
  sampleField() {
    const sc = this.fieldScroll(), act = new Map();
    for (const a of this.fieldActors()) act.set(a.slot, { obj: a.obj, x: a.x, y: a.y, lift: a.lift });
    return { sx: sc.x, sy: sc.y, act };
  }
  // the field at the current display frame: the scroll and each actor's position between the last two game frames (a map change,
  // a teleport or a slot reused by another object is not interpolated)
  fieldInterp() {
    const a = this.alpha, c = this.fcur, q = this.fprev;
    if (!c) return this.sampleField();
    if (!q || a >= 1) return c;
    const mix = (u, v, lim) => Math.abs(u - v) > lim ? u : v + (u - v) * a;
    const act = new Map();
    for (const [slot, u] of c.act) { const o = q.act.get(slot); act.set(slot, o && o.obj === u.obj ? { obj: u.obj, x: mix(u.x, o.x, 24), y: mix(u.y, o.y, 24), lift: mix(u.lift, o.lift, 24) } : u); }
    return { sx: mix(c.sx, q.sx, 16), sy: mix(c.sy, q.sy, 16), act };
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
    if (this.gb.look) { h ^= this.gb.look.gen; h = Math.imul(h, 0x01000193); }     // the player's look (web/js/look) colours the hero
    return (h >>> 0) * 4 + flipX * 2 + flipY;
  }
  // sprite tile (8 rows) as RGBA, colour 0 transparent
  spritePixels(tile, bank, pal, flipX, flipY) {
    const v = this.gb.mem.vram[bank], d = new Uint8Array(8 * 8 * 4), op = this.gb.ppu.objPal;
    const L = this.gb.look, reg = L ? L.tileRegions(bank, tile * 16) : null, fd = reg ? L.fade(op, pal) : -1;   // the player's look
    for (let y = 0; y < 8; y++) {
      const row = flipY ? 7 - y : y, lo = v[tile * 16 + row * 2], hi = v[tile * 16 + row * 2 + 1];
      for (let x = 0; x < 8; x++) {
        const bit = flipX ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), o = (y * 8 + x) * 4; if (!ci) continue;
        const lc = fd >= 0 ? L.rgba(reg[row * 8 + 7 - bit], fd) : 0;
        if (lc) { d[o] = lc & 255; d[o + 1] = (lc >> 8) & 255; d[o + 2] = (lc >> 16) & 255; d[o + 3] = 255; continue; }
        const c = this.col5(op, pal, ci); d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
      }
    }
    return d;
  }
  spriteTexture(tile, bank, pal, flipX, flipY) {
    const key = this.tileKey(tile * 16, bank, this.gb.ppu.objPal, pal, flipX, flipY);
    let t = this.spriteTex.get(key); if (t) return t;
    if (this.spriteTex.size >= 4000) { for (const tx of this.spriteTex.values()) this.gl.deleteTexture(tx); this.spriteTex.clear(); this.texGen = (this.texGen || 0) + 1; }   // evict before adding (the new one survives)
    t = this.texture(8, 8, this.spritePixels(tile, bank, pal, flipX, flipY)); this.spriteTex.set(key, t);
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
    return this.uploadMesh(pos, col);
  }
  // GL buffers for a triangle list (positions and colours, 3 floats each)
  uploadMesh(pos, col) {
    const gl = this.gl, vao = gl.createVertexArray(); gl.bindVertexArray(vao);
    const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, pos instanceof Float32Array ? pos : new Float32Array(pos), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const cb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cb); gl.bufferData(gl.ARRAY_BUFFER, col instanceof Float32Array ? col : new Float32Array(col), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(this.vao);
    return { vao, pb, cb, count: pos.length / 3 };
  }
  // the inflated body of a character: blocky cubes (meshFromPixels) or, in "Rounded" style, the smooth solid of voxround.js
  // (the top-down overworld camera sees the whole front and the top of a body: a thin inflation there keeps the head and the shoulders
  // reading as in the sprite instead of as stacked cylinders; the court cameras look from the side, where the full thickness reads best)
  bodyMesh(rgba, w, h, R, T) {
    if (!this.rounded) return this.meshFromPixels(rgba, w, h, R, T);
    const thin = this.mode === "field", d = thin ? roundedMeshData(rgba, w, h, R * 0.6, T * 0.3) : roundedMeshData(rgba, w, h, R, T); return this.uploadMesh(d.pos, d.col);
  }
  freeMesh(mesh) { if (!mesh) return; const gl = this.gl; gl.deleteBuffer(mesh.pb); gl.deleteBuffer(mesh.cb); gl.deleteVertexArray(mesh.vao); }
  voxelMesh(tile, bank, pal, flipX, flipY) {
    const key = this.tileKey(tile * 16, bank, this.gb.ppu.objPal, pal, flipX, flipY);
    let mesh = this.voxelMeshes.get(key); if (mesh) return mesh;
    if (this.voxelMeshes.size >= 3000) { for (const mm of this.voxelMeshes.values()) this.freeMesh(mm); this.voxelMeshes.clear(); }   // evict before adding
    mesh = this.meshFromPixels(this.spritePixels(tile, bank, pal, flipX, flipY), 8, 8); this.voxelMeshes.set(key, mesh);
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
    const dt = this.gb.detail && this.gb.detail.enabled ? this.gb.detail : null;           // "Sprites: Detailed" (web/js/look/spritedetail.js): the body redrawn at 3x
    const key = (this.rounded ? (this.mode === "field" ? "F" : "R") : "") + (dt ? "D" : "") + parts.map(q => `${q.key}@${q.dx},${q.dy}`).join("|");
    let mesh = this.objectMeshes.get(key);
    if (!mesh && dt) {
      const o = dt.objectImage(list, (t, b, p, fx, fy) => this.spritePixels(t, b, p, fx, fy), (t, b, p, fx, fy) => this.tileKey(t * 16, b, this.gb.ppu.objPal, p, fx, fy));
      mesh = this.bodyMesh(new Uint8Array(o.data.buffer, o.data.byteOffset, o.data.byteLength), o.w3, o.h3, 15, 13.5); this.objectMeshes.set(key, mesh);
      if (this.objectMeshes.size > 800) { for (const mm of this.objectMeshes.values()) if (mm !== mesh) this.freeMesh(mm); this.objectMeshes.clear(); this.objectMeshes.set(key, mesh); this.meshGen = (this.meshGen || 0) + 1; }
    } else if (!mesh) {
      const img = new Uint8Array(w * h * 4);
      for (const q of parts) { const d = this.spritePixels(q.tile, q.bank, q.pal, q.fx, q.fy); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const si = (y * 8 + x) * 4; if (!d[si + 3]) continue; const o = ((q.dy + y) * w + q.dx + x) * 4; img[o] = d[si]; img[o + 1] = d[si + 1]; img[o + 2] = d[si + 2]; img[o + 3] = 255; } }
      mesh = this.bodyMesh(img, w, h, 5, 4.5); this.objectMeshes.set(key, mesh);
      if (this.objectMeshes.size > 800) { for (const mm of this.objectMeshes.values()) if (mm !== mesh) this.freeMesh(mm); this.objectMeshes.clear(); this.objectMeshes.set(key, mesh); this.meshGen = (this.meshGen || 0) + 1; }
    }
    return { mesh, x0, y0, w, h, y1, ms: dt ? 1 / 3 : 1 };
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
    const cuts = CUTS.filter(c => (!c.courts || c.courts.includes(this.courtId)) && !(c.skip && c.skip.includes(this.courtId)));
    const inCut = (bx, by) => { for (const c of cuts) if (bx >= c.x0 && bx < c.x1 && by >= c.y0 && by < c.y1) return c; return null; };
    for (let j = 0; j < H; j++) {
      const Y = WORLD.y0 + j * WORLD.texel;
      for (let i = 0; i < W; i++) {
        const X = WORLD.x0 + i * WORLD.texel, p = project(X, Y, 0);
        let bx = Math.floor((0x1010 + p.xp) / 32), by = Math.floor((0x1010 + p.pp) / 32);
        if (bx < 0) bx = bx & (BAND - 1); else if (bx > 255) bx = 256 - BAND + ((bx - 256) & (BAND - 1));
        if (by < 0) by = by & (BAND - 1); else if (by > 255) by = 256 - BAND + ((by - 256) & (BAND - 1));
        const c = inCut(bx, by);
        if (c && c.fill === "tile") {          // the floor a whole number of tiles to the side (right first): its dither and pattern run on unbroken
          for (let k = 1; k <= 8; k++) { const r = bx + 8 * k, l = bx - 8 * k; if (r < 256 && !inCut(r, by)) { bx = r; break; } if (l >= 0 && !inCut(l, by)) { bx = l; break; } }
        } else if (c) { if (c.fill === "below") by = c.y1; else if (c.fill === "above") by = c.y0 - 1; else bx = c.x0 - 1; }
        src[j * W + i] = by * 256 + bx;
      }
    }
    let idx = null; try { idx = courtIndexMap(this.rom, this.courtId); } catch (e) { console.warn("court", e); }
    this.ground = { W, H, src, cuts, rgba: new Uint8Array(W * H * 4), idx: idx || new Uint8Array(256 * 256), fromRom: !!idx, court: this.courtId };
  }
  // the court colour under a world point (RGB 0..1), from the painted ground (BALLFX dust colour); null before it is painted
  groundColour(X, Y) {
    const g = this.ground; if (!g || !g.rgba) return null;
    const tx = (WORLD.x1 - WORLD.x0) / g.W, ty = (WORLD.y1 - WORLD.y0) / g.H; let r = 0, gg = 0, b = 0, n = 0;
    for (const [dx, dy] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30], [24, 24], [-24, -24]]) {
      const i = Math.floor((X + dx - WORLD.x0) / tx), j = Math.floor((Y + dy - WORLD.y0) / ty); if (i < 0 || j < 0 || i >= g.W || j >= g.H) continue;
      const o = (j * g.W + i) * 4, R = g.rgba[o], G = g.rgba[o + 1], B = g.rgba[o + 2]; if (R > 215 && G > 215 && B > 215) continue;   // court lines are not the surface
      r += R; gg += G; b += B; n++;
    }
    return n ? [r / n / 255, gg / n / 255, b / n / 255] : null;
  }
  paintGround() {                                        // per palette change: the ROM court picture coloured with the current palettes
    const g = this.ground, lut = new Uint8Array(33 * 4);
    if (!g.fromRom) this.composeMap(this.bgBase(), this.courtMaps[this.courtId], g.idx);
    for (let k = 0; k < 32; k++) { const c = this.col5(this.gb.ppu.bgPal, k >> 2, k & 3); lut[(k + 1) * 4] = c[0]; lut[(k + 1) * 4 + 1] = c[1]; lut[(k + 1) * 4 + 2] = c[2]; lut[(k + 1) * 4 + 3] = 255; }
    const bg = new Uint8Array(256 * 256 * 4);
    for (let i = 0; i < 65536; i++) { const k = g.idx[i] * 4; bg[i * 4] = lut[k]; bg[i * 4 + 1] = lut[k + 1]; bg[i * 4 + 2] = lut[k + 2]; bg[i * 4 + 3] = 255; }
    const d = g.rgba, src = g.src, idx = g.idx;
    for (let i = 0, n = src.length; i < n; i++) { const k = idx[src[i]] * 4, o = i * 4; d[o] = lut[k]; d[o + 1] = lut[k + 1]; d[o + 2] = lut[k + 2]; d[o + 3] = 255; }
    if (!(this.light && this.light.cfg.fx.floors === false)) {       // HD court floors (courtfloor.js): a surface of the court's own colours, exact lines
      const kind = surfaceKind(this.mapId());
      if (!g.detail || g.detail.kind !== kind) g.detail = buildDetail(kind, g.W, g.H, WORLD.x0, WORLD.y0, WORLD.texel);
      paintFloor(d, src, idx, lut, g.W, g.H, g.detail);
    }
    if (this.groundTex) this.gl.deleteTexture(this.groundTex);
    this.groundTex = this.texture(g.W, g.H, d, true);
    this.buildCuts(bg, g.cuts);
    if (this.stadium) this.stadium.paint(bg, this.courtId);   // STADIUM
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
  // edge: every entry the game wrote, also those just outside the 160x144 picture (the game puts a part into OAM while it is within 8 px of
  // the screen's left edge and up to the right edge + 8; the LCD shows only what is inside, the 3D view shows the surroundings too)
  // rects: (overworld) the overlay boxes of the frame: a sprite the HD art replaced counts as replaced only inside one (a cursor in a box); a character the
  // cursor finder took for an arrow, standing in the scenery, is still a character
  collectSprites(edge = false, rects = null, isActor = null) {
    const m = this.gb.mem, p = this.gb.ppu, oam = m.oam, tall = p.lcdc & 4, sprs = [], hd = this.hdText, hid = hd && hd.active && hd.hideSprites && hd.hiddenOam.size ? hd.hiddenOam : null;
    for (let i = 0; i < 40; i++) {
      const sy = oam[i * 4] - 16, sx = oam[i * 4 + 1] - 8; if (edge ? (sy <= -16 || sy >= 160 || sx < -8 || sx >= 168) : (sy <= -16 || sy >= 144 || sx <= -8 || sx >= 160)) continue;
      if (hid && hid.has(i) && !(isActor && isActor(sx, sy)) && !(rects && !rects.some(r => sx + 4 >= r.x0 && sx + 4 < r.x1 && sy + 8 >= r.y0 && sy + 8 < r.y1))) continue;   // replaced by HD art (web/js/hdui.js)
      let tile = oam[i * 4 + 2]; const attr = oam[i * 4 + 3], hgt = tall ? 16 : 8; if (tall) tile &= 0xFE;
      sprs.push({ sx, sy, h: hgt, tile, attr, owner: null, i });
    }
    return sprs;
  }
  // draws an OAM object (list of sprites) relative to an anchor screen point: as one inflated voxel body in
  // voxel mode, else as per-tile cards
  blitObject(list, ax, ay, X, Yw, lift, scale, tilt, mvp) { this.drawBody(this.bodyOf(list, ax, ay), X, Yw, lift, scale, tilt, mvp); }
  // an object's look relative to its anchor, independent of VRAM afterwards (kept for players off the 2D screen):
  // the inflated mesh in voxel mode, else one texture per 8x8 tile
  bodyOf(list, ax, ay) {
    if (this.voxelSprites) { const o = this.objectMesh(list); return { mesh: o.mesh, dx: o.x0 + o.w / 2 - ax, up: ay - o.y1, ms: o.ms, gen: this.meshGen || 0 }; }
    if (this.gb.detail && this.gb.detail.enabled) { const q = this.detailCard(list, ax, ay); if (q) return q; }          // "Sprites: Detailed": one 3x card for the whole object
    const cards = [];
    for (const sp of list) for (let half = 0; half < sp.h / 8; half++)
      cards.push({ tex: this.spriteTexture(sp.tile + (sp.attr & 0x40 ? (sp.h / 8 - 1 - half) : half), (sp.attr >> 3) & 1, sp.attr & 7, (sp.attr >> 5) & 1, (sp.attr >> 6) & 1),
                   dx: sp.sx + 4 - ax, up: ay - (sp.sy + (half + 1) * 8) });
    return { cards, gen: this.texGen || 0 };
  }
  // the object as one card of a 3x texture (spritedetail.js objectImage), cached by the object's tiles and layout
  detailCard(list, ax, ay) {
    const o = this.gb.detail.objectImage(list, (t, b, p, fx, fy) => this.spritePixels(t, b, p, fx, fy), (t, b, p, fx, fy) => this.tileKey(t * 16, b, this.gb.ppu.objPal, p, fx, fy));
    const cache = this.detailTex || (this.detailTex = new Map()); let tex = cache.get(o.key);
    if (!tex) {
      if (cache.size >= 300) { for (const t of cache.values()) this.gl.deleteTexture(t); cache.clear(); this.texGen = (this.texGen || 0) + 1; }
      tex = this.texture(o.w3, o.h3, new Uint8Array(o.data.buffer, o.data.byteOffset, o.data.byteLength)); cache.set(o.key, tex);
    }
    return { cards: [{ tex, dx: o.x0 + o.w / 2 - ax, up: ay - (o.y0 + o.h), w: o.w, h: o.h }], gen: this.texGen || 0 };
  }
  // post: an optional extra transform of the whole body in world space (BALLFX squash and stretch)
  drawBody(b, X, Yw, lift, scale, tilt, mvp, post = null) {
    if (b.gen !== (b.mesh ? this.meshGen || 0 : this.texGen || 0)) return;   // built from evicted cache entries
    const c = Math.cos(tilt), s = Math.sin(tilt), pm = post ? m => m4.mul(post, m) : m => m;
    if (b.mesh) { if (this.voxelSprites) this.drawMesh(b.mesh, pm(m4.trs3(X + b.dx * scale, lift + b.up * scale * c, Yw - b.up * scale * s, scale * (b.ms || 1), scale * (b.ms || 1), scale * (b.ms || 1), -tilt)), mvp); return; }
    if (this.voxelSprites) return;
    for (const q of b.cards) this.draw(q.tex, pm(m4.trs(X + q.dx * scale, lift + q.up * scale * c, Yw - q.up * scale * s, (q.w || 8) * scale, (q.h || 8) * scale, -tilt, 0)), mvp);
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
  // per game frame (also called by the page after each emulated frame, so skipped display frames keep it whole):
  // the ball's world position history the court effects are placed from
  tick(ball = null) {
    const fr = this.gb.ppu.frames, h = this.ballHist ||= [];
    if (h.length && h[h.length - 1].fr === fr) return;
    h.push({ fr, ball: ball || this.ballWorld() }); if (h.length > 40) h.shift();
    if (this.ballfx) this.ballfx.step(this);   // BALLFX: reads the game once per game frame
    if (this.stadium) this.stadium.step(this);   // STADIUM: crowd size by match class, cheer and crowd-sound events (read only)
  }
  // alpha: how far the display is between the last two game frames (0..1); the 3D view renders at the
  // display's refresh rate and interpolates world positions, the game itself stays at 60 Hz
  render(frame2d, alpha = 1) {
    const gl = this.gl, cv = this.cv, fr = this.gb.ppu.frames;
    this.frameChanged = false;
    if (fr !== this.lastFrame) {
      const cur = this.sampleState(); this.tick(cur.ball); this.prev = (this.cur && fr === this.lastFrame + 1) ? this.cur : cur; this.cur = cur;
      if (this.fieldOn) { const fc = this.sampleField(); this.fprev = (this.fcur && fr === this.lastFrame + 1) ? this.fcur : null; this.fcur = fc; } else this.fcur = this.fprev = null;
      this.lastFrame = fr; this.frameChanged = true;
    }
    this.alpha = Math.max(0, Math.min(1, alpha));
    const dpr = Math.min(2, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1), W = Math.round((cv.clientWidth || 160) * dpr), H = Math.round((cv.clientHeight || 144) * dpr);
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }   // render at device pixels (capped at 2x)
    // LIGHT: field and court scenes are drawn into lighting.js's off-screen target; post() / finish() put them on the canvas
    const LT = this.light && (this.isField() || this.isCourt()) && this.light.activeFor(this.isField() ? "field" : "court") && this.light.begin(cv.width, cv.height) ? this.light : null;
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0.05, 0.08, 0.12, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao); gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    if (this.isField()) { this.renderField(frame2d); if (LT) LT.finish(); return; }
    if (this.isCourt()) { this.renderCourt(frame2d); if (LT) LT.finish(); return; }
    if (LT) LT.finish();
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
    if (this.intro) this.intro.update();      // INTRO: the walk-out before a match (its own camera while it runs)
    const { mvp, tilt } = (this.intro && this.intro.camera(cv.width / cv.height, m4, COURT_CLIP, this.interp().players)) || this.courtCamera(cv.width / cv.height);
    if (this.light) this.light.camera(mvp, COURT_CLIP.near, COURT_CLIP.far, 7.5, "court", [0, 0, 0]);   // LIGHT
    // ground plane (lying flat: tilt -90deg around X so the quad's up axis becomes -Z, i.e. +Y world towards the camera)
    const gw = WORLD.x1 - WORLD.x0, gh = WORLD.y1 - WORLD.y0;
    this.draw(this.groundTex, m4.trs(0, -0.5, WORLD.y1, gw, gh, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.5);
    if (this.stadium && this.stadium.active) this.stadium.draw(mvp); else this.drawStands(mvp);   // STADIUM / bleachers with spectators beside and behind the court
    // upright cut-outs: net, chair, backdrop (cards, or voxels in voxel mode)
    const fx = this.ballfx && this.ballfx.on ? this.ballfx : null;       // BALLFX
    for (const c of this.cuts) {
      if (this.stadium && this.stadium.active && this.stadium.cut(c)) continue;   // STADIUM: replaced (umpire chair)
      const np = fx && c.name === "net" ? fx.netPost(c) : null, pm = np ? m => m4.mul(np, m) : m => m;   // BALLFX: the net rocks when the ball hits it
      if (this.voxelSprites) {
        for (const k of (c.wide ? [-1, 0, 1] : [0])) this.drawMesh(c.mesh, pm(m4.trs3(c.X + k * c.width, 0, c.Y, c.width / c.w, c.height / c.h, c.width / c.w * 1.2, 0)), mvp);
      } else if (c.wide) this.draw(c.tex, m4.trs(c.X, 0, c.Y, c.width * 3, c.height, 0, 0), mvp, [-1, 0, 3, 1], [1, 1, 1, 1], 0.5);
      else this.draw(c.tex, pm(m4.trs(c.X, 0, c.Y, c.width, c.height, 0, 0)), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.5);
    }
    const sprs = this.collectSprites(), players = this.players(), land = this.landing(), ball = this.ballWorld(), sm = this.interp();
    const [ballSx, ballSy] = this.screenOf(ball.X, ball.Y, ball.Z), [shSx, shSy] = this.screenOf(ball.X, ball.Y, 0);
    const SCALE = 7.5;
    // classification (order matters):
    //  1. the ball, its trail and its shadow: tiles $40-$4F (ball sizes, trail, shadow, landing marker) near the
    //     ball's projection; claimed first, so a ball passing in front of a player is never taken for part of them
    //  2. players: seeded by the sprites standing on the projected feet (+2 px, measured), then grown only by
    //     sprites that touch the body (racket, swing effects); the point-won faces reuse the same tile numbers
    //     but float free, so they are never pulled onto the court
    //  3. the landing marker (flat decal), 4. other ball-range tiles in the picture (world), 5. the rest is HUD
    const isBallTile = sp => sp.tile >= 0x40 && sp.tile < 0x50;
    // the score and point captions ("0-15", "NICE!") slide across the screen with sprites from VRAM bank 0; the players' bodies always use
    // bank 1. Captions never join a body (they used to be taken in as they passed a player and drawn beside them on the court): HUD.
    const isCaption = sp => sp.tile < 0x40 && !(sp.attr & 8);
    const near = (a, b, gap) => a.sx < b.sx + 8 + gap && b.sx < a.sx + 8 + gap && a.sy < b.sy + b.h + gap && b.sy < a.sy + a.h + gap;
    const ballGroup = [];
    for (const sp of sprs) if (isBallTile(sp) && Math.hypot(sp.sx + 4 - ballSx, sp.sy + sp.h / 2 - ballSy) < 12) { sp.owner = "ball"; ballGroup.push(sp); }
    for (let grew = true; grew && ballGroup.length;) {   // the trail: a chain of ball-range tiles behind the ball
      grew = false;
      for (const sp of sprs) if (!sp.owner && isBallTile(sp) && Math.hypot(sp.sx + 4 - ballSx, sp.sy + sp.h / 2 - ballSy) < 40 && ballGroup.some(b => near(sp, b, 3))) { sp.owner = "ball"; ballGroup.push(sp); grew = true; }
    }
    if (ball.Z < -4) { let best = null, d0 = 10; for (const sp of sprs) { if (sp.owner) continue; const d = Math.hypot(sp.sx + 4 - shSx, sp.sy + sp.h / 2 - shSy); if (d < d0) { d0 = d; best = sp; } } if (best) best.owner = "shadow"; }
    const feet = players.map(pl => { const [fx, fy] = this.screenOf(pl.X, pl.Y, pl.Z); return { pl, fx, fy: fy + 2, list: [] }; });
    // the game's own drop shadow under each player (tiles $58/$5A/$5C, drawn every other frame so it looks
    // see-through on the LCD): left out, the view draws its own shadow on the ground; taken into the body it stood
    // upright at the feet and blinked at 30 Hz
    for (const sp of sprs) if (!sp.owner && sp.tile >= 0x58 && sp.tile < 0x5E && feet.some(f => Math.abs(sp.sx + 4 - f.fx) <= 20 && Math.abs(sp.sy + sp.h - f.fy) <= 10)) sp.owner = "pshadow";
    for (const sp of sprs) {                              // seeds: the lowest body tiles (the player banks' tiles $00-$3F), standing on the feet
      if (sp.owner || isBallTile(sp) || sp.tile >= 0x40 || isCaption(sp)) continue;
      let best = null, d0 = 1e9;
      for (const f of feet) {
        // feet above the screen: the lowest visible tiles are higher up the body; feet below it: the body is cut
        // at the bottom edge, so its lowest tiles end there
        const dx = sp.sx + 4 - f.fx, dy = f.fy - (sp.sy + sp.h), low = f.fy < 8 ? -28 : -6, high = Math.max(10, f.fy - 134);
        if (Math.abs(dx) > 16 || dy < low || dy > high) continue;
        const d = Math.abs(dx) + Math.abs(dy); if (d < d0) { d0 = d; best = f; }
      }
      if (best) { best.list.push(sp); sp.owner = best; }
    }
    for (let grew = true; grew;) {                        // grow each body by touching sprites
      grew = false;
      for (const sp of sprs) {
        if (sp.owner || isBallTile(sp) || isCaption(sp)) continue;
        for (const f of feet) if (f.list.some(b => near(sp, b, 2)) && Math.abs(sp.sx + 4 - f.fx) <= 28 && sp.sy + sp.h <= f.fy + 6) { f.list.push(sp); sp.owner = f; grew = true; break; }
      }
    }
    // the lob landing marker (tiles $7C/$7E): only while the game shows it (wLandingMarkerActive $C4DA, set by
    // StartLandingMarker 08:52DA) and around the point it draws it at (wLandingMarkerX/Y $C480/$C482, the projected
    // target with its depth clamped), drawn flat on the court there
    const markers = [], w0 = this.gb.mem.wram[0];
    if (w0[0x4DA]) {
      const s16 = a => (w0[a] | (w0[a + 1] << 8)) << 16 >> 16, mx = (0x1010 - (p.scx << 5) + s16(0x480)) / 32, my = (0x1010 - (p.scy << 5) + s16(0x482)) / 32;
      for (const sp of sprs) if (!sp.owner && sp.tile >= 0x7C && sp.tile < 0x80 && Math.abs(sp.sx + 4 - mx) <= 14 && Math.abs(sp.sy + sp.h / 2 - my) <= 14) { sp.owner = "marker"; markers.push(sp); }
      if (markers.length) {
        const w = this.unprojectBG(mx + p.scx, my + p.scy), sc = SCALE * w.upp / 8;
        for (const sp of markers) for (let half = 0; half < sp.h / 8; half++) {   // flat decal: tile rows lie along the court
          const t = this.spriteTexture(sp.tile + (sp.attr & 0x40 ? (sp.h / 8 - 1 - half) : half), (sp.attr >> 3) & 1, sp.attr & 7, (sp.attr >> 5) & 1, (sp.attr >> 6) & 1);
          this.draw(t, m4.trs(w.X + (sp.sx + 4 - mx) * sc, 0.8, w.Y + (sp.sy + (half + 1) * 8 - my) * sc * 2, 8 * sc, 8 * sc * 2, -Math.PI / 2), mvp);
        }
      }
    }
    for (let k = 0; k < feet.length; k++) {
      const f = feet[k], ghost = this.lastBody && this.lastBody[f.pl.slot];
      if (!f.list.length && ghost && (f.fy < 8 || f.fy > 144 || f.fx < 0 || f.fx > 160)) {   // off the 2D screen
        const pl = sm.players[k] || f.pl, scale = SCALE * 1024 / (project(pl.X, pl.Y, 0).s || 128) / 8;
        this.draw(this.shadowTex, m4.trs(pl.X, 0.6, pl.Y + 4, 150, 70, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.75], 0);
        this.drawBody(ghost, pl.X, pl.Y, -pl.Z, scale, tilt, mvp);
        if (this.debug) this.debug.push({ X: pl.X, Y: pl.Y, Z: pl.Z, n: 0, ghost: true });
        continue;
      }
      if (!f.list.length) continue;
      const pl = sm.players[k] || f.pl, upp = 1024 / (project(pl.X, pl.Y, 0).s || 128), scale = SCALE * upp / 8;   // world units per px at that depth
      this.draw(this.shadowTex, m4.trs(pl.X, 0.6, pl.Y + 4, 150, 70, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 0.75], 0);
      const body = this.bodyOf(f.list, f.fx, f.fy); this.drawBody(body, pl.X, pl.Y, -pl.Z, scale, tilt, mvp);
      // the last whole body seen (feet on screen) stands in while the player is off the Game Boy screen
      if (f.fy <= 144 && f.fy >= 16) (this.lastBody ||= [])[f.pl.slot] = body;
      if (this.debug) this.debug.push({ X: pl.X, Y: pl.Y, Z: pl.Z, n: f.list.length, tiles: f.list.map(s => `${s.sx},${s.sy},${s.tile}`) });
    }
    if (ballGroup.length) {                               // the ball's projection point is the anchor: its tiles keep their 2D offsets
      const b = sm.ball;
      if (fx) fx.setBall(b);                              // BALLFX: its own shadow, squash and stretch, trail, seam
      this.drawBody(this.bodyOf(ballGroup, ballSx, ballSy), b.X, b.Y, -b.Z, SCALE, tilt, mvp, fx && fx.ballPost());
      if (!fx) this.draw(this.shadowTex, m4.trs(b.X, 0.5, b.Y, 50, 32, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);
    } else if (fx) fx.setBall(null);
    // ball effects: bounce dust (timer wC4A8, tiles $60/$62), hit spark (wC4A9, $68-$6E), special-shot flash
    // (wC4AA): the game projects the ball's position once when the effect starts (StartBounceEffect 08:5383,
    // StartHitEffect 08:53D0) and redraws it there through the camera; the ball's world position at the start
    // is kept here, so the effect stays where the ball was in 3D instead of floating as HUD
    // (the timers count down from $14 / $10 / $10 once per frame, so the start is that many frames back in the
    // per-frame ball history even when display frames were skipped)
    const fxs = this.effects ||= [[0xA8, 0x14], [0xA9, 0x10], [0xAA, 0x10]].map(([a, init]) => ({ a, init, t: 0, pos: null }));
    for (const e of fxs) {
      const t = this.gb.mem.wram[0][0x400 + e.a];
      if (t > e.t || (t && !e.pos)) {
        const at = this.gb.ppu.frames - (e.init - t), h = (this.ballHist || []).filter(q => q.fr <= at).pop();
        e.pos = { ...(h ? h.ball : ball) };
      }
      e.t = t; if (!t) e.pos = null;
    }
    for (const e of fxs) {
      if (!e.pos) continue;
      const [ex, ey] = this.screenOf(e.pos.X, e.pos.Y, e.pos.Z), grp = [];
      for (const sp of sprs) if (!sp.owner && sp.tile >= 0x60 && sp.tile < 0x80 && Math.abs(sp.sx + 4 - ex) <= 16 && Math.abs(sp.sy + sp.h / 2 - ey) <= 16) { sp.owner = "effect"; grp.push(sp); }
      if (!grp.length) continue;
      const upp = 1024 / (project(e.pos.X, e.pos.Y, 0).s || 128);
      this.blitObject(grp, ex, ey, e.pos.X, e.pos.Y, Math.max(0, -e.pos.Z), SCALE * upp / 8, tilt, mvp);
      if (this.debug) this.debug.push({ effect: e.a, n: grp.length });
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
    if (fx) fx.draw(mvp);   // BALLFX: shadow, dust, impact sparks, trail, spin seam (in the scene: lit and bloomed when LIGHT is on)
    // HUD: screen space, each sprite anchored to the nearest screen edge so the strips stay at the edges of
    // a wide or tall viewport
    if (this.light) this.light.post();   // LIGHT: the lit scene goes to the canvas; the HUD is drawn over it, unlit
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
    // captions, menus and score digits the game writes into the BG map (tiles that differ from the court's own map)
    // are drawn where they are on screen, as an overlay; `cover` marks the screen cells they (and the window) take
    const cover = new Uint8Array(21 * 19), m = this.gb.mem, v0 = m.vram[0], v1 = m.vram[1], base = this.bgBase(), pristine = this.courtMaps[this.courtId];
    for (let ty = 0; ty < 32; ty++) for (let tx = 0; tx < 32; tx++) {
      const i = ty * 32 + tx, tile = v0[base + i]; if (tile === pristine[i]) continue;
      const sx = ((tx * 8 - p.scx) & 255), sy = ((ty * 8 - p.scy) & 255); if (sx >= 160 || sy >= 144) continue;
      this.draw(this.bgTileTexture(tile, v1[base + i]), m4.trs(sx + 4, sy + 8, 0, 8, -8, 0), ortho);
      cover[(sy >> 3) * 21 + (sx >> 3)] = 1;
    }
    this.drawHDText(m4.trs(80, 144, 0, 160, -144, 0), ortho, [0, 0, 1, 1], ["under", "bg"]);
    // the window layer (score panel) as a screen-space overlay from the 2D frame
    if ((p.lcdc & 0x20) && p.wy < 144 && frame2d) {
      this.uploadFrame(frame2d);
      const wy = p.wy, wx = Math.max(0, p.wx - 7);
      this.draw(this.frameTex, m4.trs(wx + (160 - wx) / 2, 144, 0, 160 - wx, -(144 - wy), 0), ortho, [wx / 160, wy / 144, (160 - wx) / 160, (144 - wy) / 144], [1, 1, 1, 1], 0);
      this.drawHDText(m4.trs(wx + (160 - wx) / 2, 144, 0, 160 - wx, -(144 - wy), 0), ortho, [wx / 160, wy / 144, (160 - wx) / 160, (144 - wy) / 144], ["win"]);
      for (let y = wy >> 3; y < 18; y++) for (let x = wx >> 3; x < 20; x++) cover[y * 21 + x] = 1;
    }
    this.drawHDText(m4.trs(80, 144, 0, 160, -144, 0), ortho, [0, 0, 1, 1], ["spr"]);     // HD art that replaced sprites (cursors): over the window too
    // HUD sprites last (sprites are drawn over the BG and the window). A group lying on one of those overlays (the
    // digits in a mini-game's score panel, a menu cursor) stays with it at 1:1; the others go to the edges
    const covered = b => { for (let y = Math.max(0, b.y0 + 2) >> 3; y <= Math.min(143, b.y1 - 3) >> 3; y++) for (let x = Math.max(0, b.x0 + 2) >> 3; x <= Math.min(159, b.x1 - 3) >> 3; x++) if (cover[y * 21 + x]) return true; return false; };
    const midX = (l + r) / 2, midY = (top + bot) / 2;
    hud.forEach((s, i) => {
      const b = box.get(root(i)), bcx = (b.x0 + b.x1) / 2, bcy = (b.y0 + b.y1) / 2, cx = s.sx + 4;
      if (b.onPanel === undefined) b.onPanel = covered(b);
      const kk = b.onPanel ? 1 : k;
      const x = b.onPanel ? cx : bcx < 48 ? l + 3 + cx * k : bcx > 112 ? r - 3 - (160 - cx) * k : midX + (cx - 80) * k;
      const y0 = b.onPanel ? s.sy : bcy < 40 ? top + s.sy * k : bcy > 104 ? bot - (144 - s.sy) * k : midY + (s.sy - 72) * k;
      for (let half = 0; half < s.h / 8; half++) {
        const tex = this.spriteTexture(s.tile + (s.attr & 0x40 ? (s.h / 8 - 1 - half) : half), (s.attr >> 3) & 1, s.attr & 7, (s.attr >> 5) & 1, (s.attr >> 6) & 1);
        this.draw(tex, m4.trs(x, y0 + (half + 1) * 8 * kk, 0, 8 * kk, -8 * kk, 0), ortho);
      }
    });
  }
  hudOrtho() {                                             // 160x144 screen space letterboxed into the canvas (+ its edges)
    const a = this.cv.width / this.cv.height, g = 160 / 144;
    if (a >= g) { const w = 144 * a, m = (w - 160) / 2; return { ortho: m4.ortho(-m, 160 + m, 144, 0, -1, 1), l: -m, r: 160 + m, t: 0, b: 144 }; }
    const h = 160 / a, m = (h - 144) / 2; return { ortho: m4.ortho(0, 160, 144 + m, -m, -1, 1), l: 0, r: 160, t: -m, b: 144 + m };
  }

  blankPalette() {                               // every BG colour the same (faded out): nothing to build from
    const b = this.gb.ppu.bgPal; for (let i = 2; i < 64; i += 2) if (b[i] !== b[0] || b[i + 1] !== b[1]) return false; return true;
  }
  // ---- RPG areas: the whole 64x64 map as a floor, solid metatiles (collision grid) as extruded boxes ----
  composeField(pal = this.gb.ppu.bgPal) {               // WRAM3 tilemap + WRAM2 attributes (stride 64) -> 512x512 RGBA
    const img = new Uint8Array(512 * 512 * 4);
    for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) this.composeCell(img, tx, ty, pal);
    return img;
  }
  // the map's own colours, whatever the fade: palettes 2-7 as LoadMap loads them from the ROM (its descriptor's
  // palette, +$10), 0-1 live. Cut-outs are found in a picture of these, so a map entered during a fade is cut right.
  canonPalette(id) {
    const pal = Uint8Array.from(this.gb.ppu.bgPal); if (!this.rom || id < 17 || id > 36) return pal;
    try { const base = 0x59D9 + id * 16, src = this.rom.rawRef(this.rom.u8(0x0A, base + 2), this.rom.u8(0x0A, base + 3), 64); pal.set(src.subarray(16, 64), 16); } catch (e) { /* live colours */ }
    return pal;
  }
  mapSig() {                                     // WRAM map and size, sampled: a new or half-loaded map is built again
    const m = this.gb.mem, tm = m.wram[3], at = m.wram[2], w0 = m.wram[0]; let h = w0[0x32B] * 131 + w0[0x32C];
    for (let i = 0; i < 4096; i += 5) h = (Math.imul(h, 31) + tm[i] + at[i] * 7) | 0;
    return h;
  }
  // one 8x8 cell of the field picture (beyond wMapWidth/Height: leftovers in WRAM, shown as dark ground)
  composeCell(img, tx, ty, pal = this.gb.ppu.bgPal) {
    const m = this.gb.mem, p = this.gb.ppu, w0 = m.wram[0], MW = w0[0x32B] || 64, MH = w0[0x32C] || 64;   // wMapWidth/Height (tiles)
    if (tx >= MW || ty >= MH) {
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const o = ((ty * 8 + y) * 512 + tx * 8 + x) * 4; img[o] = 16; img[o + 1] = 20; img[o + 2] = 28; img[o + 3] = 255; }
      return;
    }
    const i = ty * 64 + tx, tile = m.wram[3][i], attr = m.wram[2][i], bank = attr & 8 ? m.vram[1] : m.vram[0];
    const addr = p.lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
    for (let y = 0; y < 8; y++) {
      const row = attr & 0x40 ? 7 - y : y, lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1];
      for (let x = 0; x < 8; x++) {
        const bit = attr & 0x20 ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), c = this.col5(pal, attr & 7, ci);
        const o = ((ty * 8 + y) * 512 + tx * 8 + x) * 4; img[o] = c[0]; img[o + 1] = c[1]; img[o + 2] = c[2]; img[o + 3] = 255;
      }
    }
  }
  // keyed cut-out of a map rectangle: pixels of the surrounding ground colours connected to the rectangle's
  // edge become transparent (interior pixels of the same colour stay, so canopies keep their shading)
  keyedCut(art, x0, y0, w, h) { return F3.keyedCut(art, x0, y0, w, h); }
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
  jetColours(art, wi, bi) {                      // the jet's white, light and blue from two pixels of the pool picture
    const white = [...art.subarray(wi * 4, wi * 4 + 3)], blue = [...art.subarray(bi * 4, bi * 4 + 3)], light = white.map((c, i) => (c * 2 + blue[i]) / 3);
    return [white, light, blue].map(c => c.map(v => v / 255));
  }
  // A palette fade (or any palette change) on the same map: everything keeps its shape and takes the new colours
  // from the same picture pixels as before (floor, building textures, cut-outs, flowers, jets). Voxel bodies are
  // dropped and the cut-outs drawn flat until the palette settles and the map is built again (renderField).
  recolourField() {
    const gl = this.gl, f = this.field; if (!f.floorSrc) return;
    const art = this.composeField(), copy = (dst, src, n) => { for (let i = 0; i < n; i++) { const o = i * 4, s = src[i] * 4; dst[o] = art[s]; dst[o + 1] = art[s + 1]; dst[o + 2] = art[s + 2]; } };
    const up = (tex, w, h, data) => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data); };
    copy(f.floorData, f.floorSrc, 512 * 512); up(f.floorTex, 512, 512, f.floorData);
    if (f.artData && f.artTex) { copy(f.artData, f.artSrc, 512 * 512); up(f.artTex, 512, 512, f.artData); }
    const done = new Set();
    for (const c of f.cards || []) {
      const o = c.shared || c; if (done.has(o) || !o.src) continue; done.add(o);
      for (let i = 0; i < o.src.length; i++) { if (!o.d[i * 4 + 3]) continue; const q = i * 4, s = o.src[i] * 4; o.d[q] = art[s]; o.d[q + 1] = art[s + 1]; o.d[q + 2] = art[s + 2]; if (o.cmap) { const t = o.cmap.get(art[s] << 16 | art[s + 1] << 8 | art[s + 2]); if (t) { o.d[q] = t[0]; o.d[q + 1] = t[1]; o.d[q + 2] = t[2]; } } }
      up(o.tex, c.w, c.h, o.d); if (o.mesh) { this.freeMesh(o.mesh); o.mesh = null; }
    }
    if (f.roof) { const [rx, ry, rw, rh] = f.roof.art, t = new Uint8Array(rw * rh * 4); for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const o = (y * rw + x) * 4, s = ((ry + y) * 512 + rx + x) * 4; t[o] = art[s]; t[o + 1] = art[s + 1]; t[o + 2] = art[s + 2]; t[o + 3] = 255; } up(f.roof.tex, rw, rh, t); }
    if (f.skirt) up(f.skirt, 1, 1, Uint8Array.from([...art.subarray(f.skirtSrc * 4, f.skirtSrc * 4 + 3), 255]));
    if (f.clear) f.clear = [...art.subarray(f.clearSrc * 4, f.clearSrc * 4 + 3)].map(v => v / 255);
    const fx = f.fx;
    if (fx) for (const m of fx.flowerGroups || []) {  // (plants take their colours from the building texture)
      if (!m) continue;
      const S = m.src, col = new Float32Array(S.length / 2 * 3);
      for (let v = 0; v < S.length / 2; v++) { const s = S[v * 2] * 4, k = S[v * 2 + 1] / 255; col[v * 3] = art[s] * k; col[v * 3 + 1] = art[s + 1] * k; col[v * 3 + 2] = art[s + 2] * k; }
      gl.bindBuffer(gl.ARRAY_BUFFER, m.bufs[1]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, col);
    }
    if (fx) for (const fo of fx.fountains) fo.cols = this.jetColours(art, fo.src[0], fo.src[1]);
    f.fading = true;
  }
  freeFieldFx(fx) {
    if (!fx) return; const gl = this.gl;
    for (const m of [...(fx.flowerGroups || []), ...(fx.shapes || [])]) if (m) { for (const b of m.bufs) gl.deleteBuffer(b); gl.deleteVertexArray(m.vao); }
  }
  // Builds what stands up on this map from its annotations (field_objects.js): cut-out cards (stamps, cards, sprites,
  // the sky backdrop of a side-view map), building blocks, extruded solids (planters, fountain basins), swaying
  // flowers and fountains; patches the floor under them. `art` is the map picture, `floor` its copy for the ground.
  buildFieldObjects(art, floor) {
    const gl = this.gl, f = this.field, def = FIELD_OBJECTS[f.mapId];
    for (const c of f.cards || []) { if (c.own) { gl.deleteTexture(c.tex); this.freeMesh(c.mesh); } }
    if (f.blocks) for (const b of [f.blocks.front, f.blocks.side]) { gl.deleteBuffer(b.pb); gl.deleteBuffer(b.ub); gl.deleteVertexArray(b.vao); }
    if (f.artTex) gl.deleteTexture(f.artTex);
    this.freeFieldFx(f.fx);
    if (f.skirt) gl.deleteTexture(f.skirt); if (f.roof) { gl.deleteTexture(f.roof.tex); for (const m of [f.roof.lit, f.roof.shade]) { gl.deleteBuffer(m.pb); gl.deleteBuffer(m.ub); gl.deleteVertexArray(m.vao); } }
    f.cards = []; f.blocks = null; if (f.glass) { gl.deleteBuffer(f.glass.pb); gl.deleteBuffer(f.glass.ub); gl.deleteVertexArray(f.glass.vao); } f.glass = null; f.artTex = null; f.covered = new Uint8Array(32 * 32); f.fx = null; f.clear = null; f.noWalls = false; f.skirt = null; f.roof = null;
    f.patched = null; f.artMod = null; f.artData = null; f.floorSrc = null; f.artSrc = null; f.skirtSrc = -1;
    if (!art) return;
    // where each floor / building-texture pixel comes from in the map picture: palette fades only recolour (recolourField)
    f.floorSrc = new Int32Array(512 * 512).map((_, i) => i); f.artSrc = new Int32Array(f.floorSrc);
    if (!def) return;
    f.noWalls = def.walls === false;
    f.patched = new Uint8Array(512 * 512); f.artMod = new Uint8Array(512 * 512);   // floor / art pixels that are no longer the map's (kept by live tile updates)
    const cover = (x0, y0, x1, y1) => {          // metatiles under annotated objects: no collision box there (it would show as a floor-textured block)
      for (let my = Math.max(0, y0 >> 4); my <= Math.min(31, (y1 - 1) >> 4); my++) for (let mx = Math.max(0, x0 >> 4); mx <= Math.min(31, (x1 - 1) >> 4); mx++) f.covered[my * 32 + mx] = 1;
    };
    const w0 = this.gb.mem.wram[0], MWp = (w0[0x32B] || 64) * 8, MHp = (w0[0x32C] || 64) * 8;
    const inMap = (x0, y0) => x0 < MWp && y0 < MHp;                       // annotations beyond the map size are never on screen
    // cut-outs: the floor under their opaque pixels is replaced by the ground strip below them (top-down maps), or
    // (patch "row", side-view maps) by the ground beside them in the same row, once every cut-out is known
    const rowMode = def.patch === "row", hole = new Uint8Array(512 * 512), erase = [];   // erase: rectangles of everything cut out (for the backdrop)
    const mark = (d, x0, y0, w, h) => { erase.push([x0, y0, x0 + w, y0 + h]); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] && x0 + x < 512 && y0 + y < 512) hole[(y0 + y) * 512 + x0 + x] = 1; };
    const patch = (d, x0, y0, w, h, above = false) => {     // above: from the tile row above the rectangle instead
      mark(d, x0, y0, w, h); if (rowMode) return;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (!d[(y * w + x) * 4 + 3]) continue;
        const X = x0 + x, Y = above ? Math.max(0, y0 - 8 + (y % 8)) : Math.min(511, y0 + h + ((y0 + h - (y0 + y)) % 8)), s = (Y * 512 + X) * 4, o = ((y0 + y) * 512 + X) * 4;
        floor[o] = art[s]; floor[o + 1] = art[s + 1]; floor[o + 2] = art[s + 2]; f.patched[(y0 + y) * 512 + X] = 1; f.floorSrc[(y0 + y) * 512 + X] = Y * 512 + X;
      }
    };
    // under a plant the ground is filled once every cut-out is known (fillPlants): from the nearest visible ground a
    // whole number of tiles away along its row or column, so grass and paths run on and no other tree is copied in
    const plantHoles = [];
    const plantHole = (d, x0, y0, w, h) => {      // (with the outline-coloured bits around it: its drawn shadow)
      const dk = F3.darkest(art, x0, y0, w, h), m = new Uint8Array(d);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (F3.packAt(art, x0 + x, y0 + y) === dk) m[(y * w + x) * 4 + 3] = 255;
      mark(m, x0, y0, w, h); plantHoles.push([m, x0, y0, w, h, F3.groundKeys(art, x0, y0, w, h, true), dk]);
    };
    const cutOpt = o => ({ cut: o.cut, only: o.only, drop: o.drop, bg: o.bg, add: o.add, seal: o.seal, see: o.see, furn: o.furn });
    // with a cut mode the card stands on its lowest opaque row (the transparent rows below it are dropped)
    const trim = (d, w, h) => { let r = h; while (r > 1 && !d.subarray((r - 1) * w * 4, r * w * 4).some((v, i) => i % 4 === 3 && v)) r--; return r < h ? { d: d.slice(0, r * w * 4), h: r } : { d, h }; };
    const srcOf = (x0, y0, w, h) => { const a = new Int32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = Math.min(511, y0 + y) * 512 + Math.min(511, x0 + x); return a; };
    const card = (d, x0, y0, w, h, o) => { const t = o.cut ? trim(d, w, h) : { d, h }; return { tex: this.texture(w, t.h, t.d), mesh: null, d: t.d, src: srcOf(x0, y0, w, t.h), own: true, w, h: t.h, X: x0 + w / 2, Z: o.z ?? y0 + t.h + (o.dz || 0), tilt: o.tilt ?? FIELD_TILT, flat: !!o.flat, hs: o.hs, R: o.R, T: o.T, lift: o.lift, cmap: o.furn && o.furn.map ? new Map(o.furn.map.map(([f, t]) => [f[0] << 16 | f[1] << 8 | f[2], t])) : null }; };   // hs: height scale; R / T: voxel mesh inflation (0 / 1: thin bars); lift: stands on something this high
    // plants (plant: tree | bush | palm | pot): voxel bodies with volume, one mesh per shape drawn at every place it
    // stands, rustling in the wind; the default cut keeps their outline
    const PLANT = { tree: [4, 3, 0.8], bush: [4, 3, 0.45], palm: [4, 3, 1.1], pot: [3, 2, 0.3], statue: [3, 3, 0] }, shapes = [], plants = [];
    const shapeOf = (d, x0, y0, w, h, kind) => {
      const [R, T] = PLANT[kind] || PLANT.tree, m = F3.plantMesh(d, w, h, R, T);
      for (let k = 0; k < m.uv.length; k += 2) { m.uv[k] = (m.uv[k] + x0) / 512; m.uv[k + 1] = (m.uv[k + 1] + y0) / 512; }
      const sh = { m, r: Math.hypot(w / 2, h) }; shapes.push(sh); return sh;
    };
    const placed = [];                          // a plant found twice (a stamp and a sprite of its top) stands once
    const taken = (x, y, w, h) => placed.some(q => Math.abs(q[0] - x) < w * 0.5 && Math.abs(q[1] - y) < h * 0.5 + 8);
    const placePlant = (shape, X, Z, o) => { const rnd = Math.abs(Math.sin(X * 12.9898 + Z * 78.233) * 43758.5453) % 1; plants.push({ shape, model: m4.trs3(X, o.lift || 0, Z, 1, 1, 1, -(o.tilt ?? FIELD_TILT)), phase: X * 0.11 + Z * 0.07 + rnd * 0.8, amp: (PLANT[o.plant] || PLANT.tree)[2] }); };
    const plantCut = o => o.plant ? { ...cutOpt(o), cut: o.cut || "outline", seal: o.seal ?? "b" } : cutOpt(o);   // (trunks reach the bottom edge)
    for (const st of def.stamps || []) {
      const d = F3.cutOut(art, st.x, st.y, st.w, st.h, plantCut(st)), t = (st.cut || st.plant) ? trim(d, st.w, st.h) : { d, h: st.h };
      let hits = this.findStamps(st);
      if (st.plant) {                            // plants: also every pixel-exact copy off the tile grid
        for (const m of F3.matchSprite(art, d, st.x, st.y, st.w, st.h, MWp, MHp, 0.9)) if (!hits.some(q => Math.abs(q.x - m.x) < 6 && Math.abs(q.y - m.y) < 6)) hits.push(m);
        const shape = shapeOf(t.d, st.x, st.y, st.w, t.h, st.plant);
        for (const hit of hits) { if (taken(hit.x, hit.y, st.w, st.h)) continue; placed.push([hit.x, hit.y]); plantHole(d, hit.x, hit.y, st.w, st.h); cover(hit.x, hit.y, hit.x + st.w, hit.y + st.h); placePlant(shape, hit.x + st.w / 2, hit.y + t.h + (st.dz || 0), st); }
        continue;
      }
      const shared = { tex: this.texture(st.w, t.h, t.d), mesh: null, d: t.d, src: srcOf(st.x, st.y, st.w, t.h), own: true };
      let first = true;
      for (const hit of hits) {
        patch(d, hit.x, hit.y, st.w, st.h); cover(hit.x, hit.y, hit.x + st.w, hit.y + st.h);
        f.cards.push({ ...shared, own: first, w: st.w, h: t.h, X: hit.x + st.w / 2, Z: hit.y + t.h + (st.dz || 0), tilt: st.tilt ?? FIELD_TILT, shared }); first = false;
      }
    }
    for (const c of def.cards || []) {
      if (!inMap(c.x0, c.y0)) continue;
      if (c.copy) {                              // a copy of a cut-out standing somewhere else (furniture behind the glass): the ground is left alone
        const w = c.x1 - c.x0, h = c.y1 - c.y0, d = F3.cutOut(art, c.x0, c.y0, w, h, plantCut(c)), cd = card(d, c.x0, c.y0, w, h, c);
        cd.X = c.copy[0] + w / 2; cd.Z = c.copy[1] + cd.h + (c.dz || 0); f.cards.push(cd); continue;
      }
      cover(c.x0, c.y0, c.x1, c.y1);
      const w = c.x1 - c.x0, h = c.y1 - c.y0; let d = F3.cutOut(art, c.x0, c.y0, w, h, plantCut(c));
      // a tennis net (a tape row, mesh rows, posts): a see-through net, only the mesh, the tape and the posts opaque (thin bars), the floor under its whole
      // band filled from the ground beside it so the court lines run on under it
      if (!c.cut && !c.plant && !c.see && w >= 48 && w <= 80 && h >= 8 && h <= 20) {
        const nt = F3.netCut(art, c.x0, c.y0, w, h);
        if (nt) { plantHole(nt.mask, c.x0, c.y0, w, h); f.cards.push(card(nt.d, c.x0, c.y0, w, h, { ...c, cut: "net", R: 0, T: 0.8 })); continue; }
      }
      if (c.umbrella) {                          // an umbrella stands up (pole and canopy), its picture is filled with ground
        const u = F3.umbrellaMesh(art, c.x0, c.y0, c.x1, c.y1, MHp);
        if (u) {
          const m = new Uint8Array(w * h * 4); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[(y * w + x) * 4 + 3] = 255;
          plantHole(m, c.x0, c.y0, w, h);
          for (let k = 0; k < u.mesh.uv.length; k++) u.mesh.uv[k] /= 512;
          const sh = { m: u.mesh, r: w }; shapes.push(sh); plants.push({ shape: sh, model: m4.identity(), phase: 0, amp: 0, centre: [(c.x0 + c.x1) / 2, 10, c.y1] });
          continue;
        }
      }
      // nets and umpire chairs (and any prop of that size on a patterned floor): the floor under them is filled from the nearest visible ground a
      // whole number of tiles away (plantHole), so its dither and court lines run on; the strip-below patch smeared a mirrored copy of it (the blur round the net)
      const prop = !c.plant && !c.see && c.fill !== "below" && ((w >= 48 && w <= 80 && h >= 8 && h <= 20) || (w === 16 && h >= 28 && h <= 40));
      if (c.plant || prop) plantHole(d, c.x0, c.y0, w, h); else patch(c.see ? new Uint8Array(w * h * 4).fill(255) : d, c.x0, c.y0, w, h);      // a see-through fence: the ground under all of it
      if (c.plant) { const t = trim(d, w, h); placePlant(shapeOf(t.d, c.x0, c.y0, w, t.h, c.plant), c.x0 + w / 2, c.y0 + t.h + (c.dz || 0), c); continue; }
      f.cards.push(card(d, c.x0, c.y0, w, h, c));
    }
    // sprites: one example cut out; every pixel-exact copy anywhere in the map (not tile-aligned) stands up too
    for (const sp of def.sprites || []) {
      const d = F3.cutOut(art, sp.x, sp.y, sp.w, sp.h, plantCut(sp)), t = sp.plant ? trim(d, sp.w, sp.h) : null, shape = sp.plant ? shapeOf(t.d, sp.x, sp.y, sp.w, t.h, sp.plant) : null;
      for (const hit of F3.matchSprite(art, d, sp.x, sp.y, sp.w, sp.h, MWp, MHp, sp.match ?? 1)) {
        if (sp.in && (hit.x < sp.in[0] || hit.y < sp.in[1] || hit.x >= sp.in[2] || hit.y >= sp.in[3])) continue;   // in: where copies may be
        if (shape) { if (taken(hit.x, hit.y, sp.w, sp.h)) continue; placed.push([hit.x, hit.y]); }
        if (shape) plantHole(hit.d, hit.x, hit.y, sp.w, sp.h); else patch(hit.d, hit.x, hit.y, sp.w, sp.h);
        cover(hit.x, hit.y, hit.x + sp.w, hit.y + sp.h);
        if (shape) { placePlant(shape, hit.x + sp.w / 2, hit.y + t.h + (sp.dz || 0), sp); continue; }
        f.cards.push(card(hit.d, hit.x, hit.y, sp.w, sp.h, sp));
      }
    }
    // buildings: one batched mesh for roofs + fronts (+ the tops and front walls of solids), one for the side walls
    const front = { pos: [], uv: [] }, side = { pos: [], uv: [] }, glass = { pos: [], uv: [] }, glassEdges = new Set(), keyed = [], roofs = [{ pos: [], uv: [] }, { pos: [], uv: [] }]; let roofArt = null;
    const quad = (o, a, b, c, d, ua, ub, uc, ud) => { for (const [v, t] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]]) { o.pos.push(...v); o.uv.push(t[0] / 512, t[1] / 512); } };
    for (const b of def.blocks || []) {
      if (!inMap(b.x0, b.y0)) continue;
      const { x0, x1, y0, y1, fold } = b, zb = b.back ?? y0;
      cover(x0, zb, x1, y1);
      if (b.key) {                      // the ground around the building transparent (keyRect: keyed as part of a bigger rectangle, so the
        const [kx0, ky0, kx1, ky1] = b.keyRect || [x0, y0, x1, y1], kw = kx1 - kx0;   // walls of a neighbouring part do not count as ground)
        const K = F3.cutOut(art, kx0, ky0, kw, ky1 - ky0, { cut: "outline" }), w = x1 - x0, h = y1 - y0, d = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const X = x0 + x - kx0, Y = y0 + y - ky0; if (X >= 0 && Y >= 0 && X < kw && Y < ky1 - ky0) d[(y * w + x) * 4 + 3] = K[(Y * kw + X) * 4 + 3]; }
        keyed.push([d, x0, y0, w, h]); mark(d, x0, y0, w, h);
      }
      if (b.gable) {                    // a gable end facing the viewer: the whole front picture stands up, the roof slopes run back
        const g = b.gable, S = WALL_SCALE, Ha = (y1 - g.ay) * S, He = (y1 - g.ey) * S, [rx0, ry0, rx1, ry1] = g.roof;
        quad(front, [x0, 0, y1], [x1, 0, y1], [x1, Ha, y1], [x0, Ha, y1], [x0, y1], [x1, y1], [x1, g.ay], [x0, g.ay]);
        // slopes: the roof tiles (art rectangle g.roof) repeated, shingle rows running along the ridge
        const rw = rx1 - rx0, rh = ry1 - ry0, D = (y1 - zb) / rw;
        for (const [ex, k] of [[x0, 0], [x1, 1]]) {
          const L = Math.hypot(g.ax - ex, Ha - He) / rh, o = roofs[k];
          for (const [v, t] of [[[ex, He, y1], [0, L]], [[g.ax, Ha, y1], [0, 0]], [[g.ax, Ha, zb], [D, 0]], [[ex, He, y1], [0, L]], [[g.ax, Ha, zb], [D, 0]], [[ex, He, zb], [D, L]]]) { o.pos.push(...v); o.uv.push(...t); }
        }
        roofArt = [rx0, ry0, rw, rh];
        quad(side, [x0, 0, zb], [x0, 0, y1], [x0, He, y1], [x0, He, zb], [x0 + 6, y1], [x0 + 12, y1], [x0 + 12, g.ey], [x0 + 6, g.ey]);
        quad(side, [x1, 0, y1], [x1, 0, zb], [x1, He, zb], [x1, He, y1], [x1 - 12, y1], [x1 - 6, y1], [x1 - 6, g.ey], [x1 - 12, g.ey]);
        continue;
      }
      const H = (y1 - fold) * WALL_SCALE;
      if (b.glass) {                    // a glass wall: thin vertical panes (32 wide, a slim frame) on the front and the two ends; no roof, no volume; the room's floor shows
        if (b.floorTile) {              // the room's floor behind the panes: one plain floor tile (map px) repeated over the footprint
          const [tx, ty] = b.floorTile;
          for (let y = zb; y < y1; y++) for (let x = x0; x < x1; x++) { const s = ((ty + (y & 7)) * 512 + tx + (x & 7)) * 4, o = (y * 512 + x) * 4; floor[o] = art[s]; floor[o + 1] = art[s + 1]; floor[o + 2] = art[s + 2]; f.patched[y * 512 + x] = 1; f.floorSrc[y * 512 + x] = (ty + (y & 7)) * 512 + tx + (x & 7); hole[y * 512 + x] = 1; }
          erase.push([x0, zb, x1, y1]);
        } else patch(new Uint8Array((x1 - x0) * (y1 - zb) * 4).fill(255), x0, zb, x1 - x0, y1 - zb, b.floor === "above");
        const pane = (a, c, wide) => { const n = Math.max(1, Math.round(wide / 32)); for (let k = 0; k < n; k++) { const t0 = k / n, t1 = (k + 1) / n, A = [a[0] + (c[0] - a[0]) * t0, a[2] + (c[2] - a[2]) * t0], C = [a[0] + (c[0] - a[0]) * t1, a[2] + (c[2] - a[2]) * t1];
          for (const [p, u, w] of [[[A[0], 0, A[1]], 0, 0], [[C[0], 0, C[1]], 1, 0], [[C[0], H, C[1]], 1, 1], [[A[0], 0, A[1]], 0, 0], [[C[0], H, C[1]], 1, 1], [[A[0], H, A[1]], 0, 1]]) { glass.pos.push(...p); glass.uv.push(u, w); } } };
        pane([x0, 0, y1], [x1, 0, y1], x1 - x0);
        const edge = (x) => { const key = x + ":" + zb + ":" + y1; if (!glassEdges.has(key)) { glassEdges.add(key); pane([x, 0, zb], [x, 0, y1], y1 - zb); } };
        edge(x0); edge(x1);
        continue;
      }
      quad(front, [x0, H, zb], [x1, H, zb], [x1, H, y1], [x0, H, y1], [x0, y0], [x1, y0], [x1, fold], [x0, fold]);   // roof
      quad(front, [x0, 0, y1], [x1, 0, y1], [x1, H, y1], [x0, H, y1], [x0, y1], [x1, y1], [x1, fold], [x0, fold]);   // front wall
      quad(side, [x0, 0, zb], [x0, 0, y1], [x0, H, y1], [x0, H, zb], [x0, y1], [x0 + 6, y1], [x0 + 6, fold], [x0, fold]);   // left wall
      quad(side, [x1, 0, y1], [x1, 0, zb], [x1, H, zb], [x1, H, y1], [x1 - 6, y1], [x1, y1], [x1, fold], [x1 - 6, fold]);   // right wall
    }
    // solids: low prisms with the exact outline of their picture (planters, fountain basins), stacked with "on"
    const solids = [];
    for (const so of def.solids || []) {
      if (!inMap(so.x0, so.y0)) { solids.push(null); continue; }
      const w = so.x1 - so.x0, h = so.y1 - so.y0, d = F3.cutOut(art, so.x0, so.y0, w, h, { cut: so.cut || "outline", only: so.only, drop: so.drop });
      const base = so.on != null && solids[so.on] ? solids[so.on] : null, stack = base ? base.stackTop : 0;
      const g = F3.solidMesh(d, so.x0, so.y0, w, h, so.h, stack, { top: front, front, side });
      solids.push({ ...g, stackTop: stack + so.h, d, so, w, h });
      cover(so.x0, so.y0, so.x1, so.y1);
      if (!base) patch(d, so.x0, so.y0, w, h, so.patch !== "below");   // the ground behind a low solid shows: the ground above it
    }
    if (!rowMode) for (const [d, x0, y0, w, h, keys, dk] of plantHoles) F3.fillNearest(floor, hole, d, x0, y0, w, h, keys, MWp, MHp, f.floorSrc, f.patched, dk);
    if (rowMode) { F3.fillRows(floor, hole, 0, MWp, 0, MHp, f.floorSrc); for (let i = 0; i < hole.length; i++) if (hole[i]) f.patched[i] = 1; }
    // side-view maps: the sky band stands up as a backdrop with everything cut out of it painted over with the sky
    // of its row; the ground runs on behind it (the first ground rows repeated up to the top)
    if (def.backdrop) {
      const bd = def.backdrop, y1 = bd.y1, ext = bd.extend || 0, side = bd.side || 0, W = MWp + 2 * side, H = y1 + ext, d = new Uint8Array(W * H * 4);
      for (const [ex0, ey0, ex1, ey1] of erase) for (let y = Math.max(0, ey0); y < Math.min(y1, ey1); y++) hole.fill(1, y * 512 + ex0, y * 512 + Math.min(512, ex1));   // whole rectangles: no stray bits of them in the sky
      const src = new Int32Array(W * H);
      const put = (j, i) => { const o = j * 4, s = i * 4; d[o] = art[s]; d[o + 1] = art[s + 1]; d[o + 2] = art[s + 2]; d[o + 3] = 255; src[j] = i; };
      let top = 0;
      for (let y = 0; y < y1; y++) {             // each row: its own pixels, the sky (its commonest colour) where things were cut out
        const hist = new Map(), where = new Map(); for (let x = 0; x < MWp; x++) if (!hole[y * 512 + x]) { const c = F3.packAt(art, x, y); hist.set(c, (hist.get(c) || 0) + 1); where.set(c, y * 512 + x); }
        const dom = [...hist].sort((a, b) => b[1] - a[1])[0], di = dom ? where.get(dom[0]) : y * 512; if (y === 0) top = di;
        for (let x = 0; x < W; x++) { const X = x - side; put((y + ext) * W + x, X < 0 || X >= MWp || hole[y * 512 + X] ? di : y * 512 + X); }
      }
      for (let y = 0; y < ext; y++) for (let x = 0; x < W; x++) put(y * W + x, top);
      f.cards.unshift({ tex: this.texture(W, H, d), mesh: null, d, src, own: true, w: W, h: H, X: MWp / 2, Z: bd.z, tilt: 0, flat: true });
      // the ground behind it (and below the map): one plain ground tile repeated; the same colour reaches the horizon
      const [gx, gy] = bd.tile || [0, y1], gh = new Map();
      for (let y = 0; y < 512; y++) {
        if (y >= y1 && y < MHp) continue;
        for (let x = 0; x < 512; x++) { const si = (gy + (y & 7)) * 512 + gx + (x & 7), s = si * 4, o = (y * 512 + x) * 4; floor[o] = art[s]; floor[o + 1] = art[s + 1]; floor[o + 2] = art[s + 2]; f.patched[y * 512 + x] = 1; f.floorSrc[y * 512 + x] = si; }
      }
      const gw = new Map(); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const c = F3.packAt(art, gx + x, gy + y); gh.set(c, (gh.get(c) || 0) + 1); gw.set(c, (gy + y) * 512 + gx + x); }
      f.skirtSrc = gw.get([...gh].sort((a, b) => b[1] - a[1])[0][0]); f.skirt = this.solidTexture([...art.subarray(f.skirtSrc * 4, f.skirtSrc * 4 + 3), 255]);
      if (def.clear === "sky") { f.clearSrc = top; f.clear = [...art.subarray(top * 4, top * 4 + 3)].map(v => v / 255); }
    }
    // flowers: lifted out of a solid's top (on) or out of every copy of a ground tile (tiles), swaying in the wind
    // flowers in groups of 64 x 64 map px (each group one mesh, drawn only when in view)
    const flGroups = new Map(), flOf = (X, Z) => { const key = (X >> 6) * 16 + (Z >> 6); let g = flGroups.get(key); if (!g) flGroups.set(key, g = { pos: [], col: [], sway: [], src: [], centre: [((X >> 6) + 0.5) * 64, 4, ((Z >> 6) + 0.5) * 64] }); return g; };
    const leaf = r => {                         // the commonest green of a region: the stems' colour
      const hist = new Map(), where = new Map();
      for (let y = r[1]; y < r[3]; y++) for (let x = r[0]; x < r[2]; x++) { const o = (y * 512 + x) * 4; if (art[o + 1] > art[o] && art[o + 1] > art[o + 2]) { const c = F3.packAt(art, x, y); hist.set(c, (hist.get(c) || 0) + 1); where.set(c, y * 512 + x); } }
      const t = [...hist].sort((a, b) => b[1] - a[1])[0], i = t ? where.get(t[0]) : r[1] * 512 + r[0]; return { c: [...art.subarray(i * 4, i * 4 + 3)], src: i };
    };
    const plant = (list, lift, shift, stem, stemC, onFloor) => {
      for (const p of list) {
        for (const [dx, dy] of p.px) { const i = (p.y + dy) * 512 + p.x + dx; f.artMod[i] = 1; if (onFloor) { const o = i * 4; floor[o] = art[o]; floor[o + 1] = art[o + 1]; floor[o + 2] = art[o + 2]; f.patched[i] = 1; f.floorSrc[i] = f.artSrc[i]; } }
        const X = p.x + p.w / 2, Z = p.y + p.h + shift, rnd = Math.abs(Math.sin(X * 12.9898 + Z * 78.233) * 43758.5453) % 1;
        F3.swayVoxels(flOf(X, Z), p.px, p.w, p.h, X, lift, Z - 0.5, 1, X * 0.11 + Z * 0.07 + rnd * 1.2, stem ? { h: stem, c: stemC.c, src: stemC.src } : null);
      }
    };
    for (const fd of def.flowers || []) {
      const s = fd.on != null ? solids[fd.on] : null; if (fd.on != null && !s) continue;
      const r = fd.region || [s.so.x0, s.so.y0, s.so.x1, s.so.y1];
      const keep = s ? (x, y) => s.d[((y - s.so.y0) * s.w + x - s.so.x0) * 4 + 3] > 0 : null;
      plant(F3.liftFlowers(art, r, keep, f.artSrc), s ? s.lift + s.H : 0, s ? s.shift : 0, fd.stem ?? 2, leaf(r), !s);
    }
    const tm = this.gb.mem.wram[3], at = this.gb.mem.wram[2], k = (x, y) => tm[y * 64 + x] | (at[y * 64 + x] & 0x6F) << 8;
    const flowerKeys = new Set((def.flowerTiles || []).map(ft => k(ft[0] >> 3, ft[1] >> 3)));
    for (const ft of def.flowerTiles || []) {                            // [x, y] of one cell (map px) with a flower painted on the ground
      const want = k(ft[0] >> 3, ft[1] >> 3);
      for (let ty = 0; ty < MHp >> 3; ty++) for (let tx = 0; tx < MWp >> 3; tx++) if (k(tx, ty) === want && !hole[ty * 8 * 512 + tx * 8]) {
        const r = [tx * 8, ty * 8, tx * 8 + 8, ty * 8 + 8]; plant(F3.liftFlowers(art, r, null, f.artSrc), 0, 0, ft[2] ?? 2, leaf(r), true);
        // the ground under it: a neighbouring plain cell (its stem and shadow are not left painted on the floor)
        const plain = (x, y) => x >= 0 && y >= 0 && x < MWp >> 3 && y < MHp >> 3 && !flowerKeys.has(k(x, y)) && !hole[y * 8 * 512 + x * 8];
        const nb = [[tx - 1, ty], [tx + 1, ty], [tx, ty - 1], [tx, ty + 1]].find(([x, y]) => plain(x, y));
        if (nb) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const i = (ty * 8 + y) * 512 + tx * 8 + x, j = (nb[1] * 8 + y) * 512 + nb[0] * 8 + x; floor.copyWithin(i * 4, j * 4, j * 4 + 3); f.floorSrc[i] = f.floorSrc[j]; f.patched[i] = 1; }
      }
    }
    const fx = f.fx = { flowerGroups: [], fountains: [], shapes: [], plants };
    for (const sh of shapes) {
      const m = sh.m, vao = gl.createVertexArray(); gl.bindVertexArray(vao); const bufs = [];
      [[m.pos, 3], [m.uv, 2], [m.sway, 3]].forEach(([a, n], i) => { const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 0, 0); });
      Object.assign(sh, { vao, bufs, count: m.pos.length / 3 }); delete sh.m; fx.shapes.push(sh);
    }
    gl.bindVertexArray(this.vao);
    fx.flowerGroups = [];
    for (const fl of flGroups.values()) {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const bufs = [];
      [[fl.pos, 3], [fl.col, 3], [fl.sway, 2]].forEach(([a, n], i) => { const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 0, 0); });
      fx.flowerGroups.push({ vao, bufs, count: fl.pos.length / 3, src: Float32Array.from(fl.src), centre: fl.centre });
    }
    gl.bindVertexArray(this.vao);
    // fountains: a jet from the middle of the pool (on the solid it is the top of) and rings on the water; colours
    // from the pool picture (its lightest colour and its most saturated one)
    for (const fo of def.fountains || []) {
      const s = solids[fo.on]; if (!s) continue;
      const [px0, py0, px1, py1] = fo.pool; let wi = py0 * 512 + px0, bi = wi, bl = -1, bs = -1;
      for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) { const o = (y * 512 + x) * 4, r = art[o], g = art[o + 1], b = art[o + 2], l = r + g + b, sat = Math.max(r, g, b) - Math.min(r, g, b); if (l > bl) { bl = l; wi = y * 512 + x; } if (b > r && sat > bs) { bs = sat; bi = y * 512 + x; } }
      const y = s.lift + s.H;
      fx.fountains.push({ origin: [(px0 + px1) / 2, y, (py0 + py1) / 2 + s.shift], jet: [fo.jet ?? 16, fo.spread ?? 8, fo.drop ?? 0.9, 0], src: [wi, bi], cols: this.jetColours(art, wi, bi),
        pool: { x0: px0, x1: px1, z0: py0 + s.shift, z1: py1 + s.shift, y: y + 0.08 } });
    }
    if (fx.fountains.length && !this.jetMesh) {
      const j = F3.jetDroplets(160), vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      [[j.pos, 4], [j.seed, 4]].forEach(([a, n], i) => { const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, a, gl.STATIC_DRAW); gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 0, 0); });
      gl.bindVertexArray(this.vao); this.jetMesh = { vao, count: j.count };
    }
    const upload = o => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const pb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, pb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(o.pos), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(o.uv), gl.STATIC_DRAW); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(this.vao); return { vao, pb, ub, count: o.pos.length / 3 };
    };
    if (roofArt) {
      const [rx, ry, rw, rh] = roofArt, t = new Uint8Array(rw * rh * 4);
      for (let y = 0; y < rh; y++) for (let x = 0; x < rw; x++) { const o = (y * rw + x) * 4, s = ((ry + y) * 512 + rx + x) * 4; t[o] = art[s]; t[o + 1] = art[s + 1]; t[o + 2] = art[s + 2]; t[o + 3] = 255; }
      f.roof = { tex: this.texture(rw, rh, t, false, true), lit: upload(roofs[0]), shade: upload(roofs[1]), art: roofArt };
    }
    if (front.pos.length || shapes.length) {
      const artA = new Uint8Array(art);                                   // keyed blocks: the ground around them transparent
      for (const [d, x0, y0, w, h] of keyed) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (!d[(y * w + x) * 4 + 3]) { const i = (y0 + y) * 512 + x0 + x; artA[i * 4 + 3] = 0; f.artMod[i] = 1; }
      if (front.pos.length) f.blocks = { front: upload(front), side: upload(side) };
      if (glass.pos.length) f.glass = upload(glass);                       // glass panes of buildings (block glass: true)
      f.artTex = this.texture(512, 512, artA); f.artData = artA;
    }
  }
  buildField() {
    const gl = this.gl, f = this.field, coll = this.gb.mem.wram[6];
    if (f.floorTex) gl.deleteTexture(f.floorTex);
    const id = this.mapId(), canon = this.canonPalette(id), art = this.composeField(canon), floor = new Uint8Array(art);
    const tw = Math.min(64, this.gb.mem.wram[0][0x32B] || 64), th = Math.min(64, this.gb.mem.wram[0][0x32C] || 64);
    f.lowPal = Uint8Array.from(this.gb.ppu.bgPal.subarray(0, 16)); f.usesLowPals = false;   // palettes 0-1 come live: a fade changes them
    for (let y = 0; y < th && !f.usesLowPals; y++) for (let x = 0; x < tw; x++) if ((this.gb.mem.wram[2][y * 64 + x] & 7) < 2) { f.usesLowPals = true; break; }
    this.buildFieldObjects(art, floor);
    f.floorTex = this.texture(512, 512, floor); f.floorData = floor;
    this.recolourField(); f.fading = false;                // the live colours
    this.watchTiles();
    // walls: one box (top + 4 sides) per solid 16x16 metatile, uv = the metatile's own texels; sides share them
    const H = 14, pos = [], uv = [], w0 = this.gb.mem.wram[0], MW = Math.min(32, (w0[0x32B] || 64) >> 1), MH = Math.min(32, (w0[0x32C] || 64) >> 1);   // metatiles inside wMapWidth/Height only
    const quad = (a, b, c, d, u) => { for (const [v, t] of [[a, u[0]], [b, u[1]], [c, u[2]], [a, u[0]], [c, u[2]], [d, u[3]]]) { pos.push(...v); uv.push(...t); } };
    let n = 0;
    // hedges and foliage banks: solid metatiles painted with foliage (mostly greens, with dark leaf shadows) rise as
    // rounded cushions (plant style, rustling) instead of boxes
    const fol = new Uint8Array(32 * 32);
    for (let my = 0; my < MH && !f.noWalls; my++) for (let mx = 0; mx < MW; mx++) {
      if (coll[my * 32 + mx] !== 0x0F || (f.covered && f.covered[my * 32 + mx])) continue;
      let g = 0, dk = 0; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const o = ((my * 16 + y) * 512 + mx * 16 + x) * 4, r = art[o], gg = art[o + 1], b = art[o + 2]; if (gg > r && gg > b) g++; if (r + gg + b < 150) dk++; }
      if (g >= 160 && dk >= 12) fol[my * 32 + mx] = 1;
    }
    this.hedgeArt = art; this.buildHedges(fol, MW, MH); this.hedgeArt = null;
    for (let my = 0; my < MH && !f.noWalls; my++) for (let mx = 0; mx < MW; mx++) {
      if (coll[my * 32 + mx] !== 0x0F || (f.covered && f.covered[my * 32 + mx]) || fol[my * 32 + mx]) continue;
      const x0 = mx * 16, x1 = x0 + 16, z0 = my * 16, z1 = z0 + 16, u0 = x0 / 512, u1 = x1 / 512, v0 = z0 / 512, v1 = z1 / 512;
      const top = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]], side = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      quad([x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1], top);
      const solid = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH && coll[y * 32 + x] === 0x0F;
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
  // one cushion mesh per connected group of foliage metatiles (drawn with the plants, coloured from the floor texture)
  buildHedges(fol, MW, MH) {
    const gl = this.gl, f = this.field; if (!f.fx) f.fx = { flowerGroups: [], fountains: [], shapes: [], plants: [] };
    f.fx.hedges = [];
    const seen = new Uint8Array(32 * 32);
    for (let i = 0; i < 32 * 32; i++) {
      if (!fol[i] || seen[i]) continue;
      const st = [i], cells = []; seen[i] = 1;
      while (st.length) { const j = st.pop(), x = j & 31, y = j >> 5; cells.push(j); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= MW || Y >= MH) continue; const k = Y * 32 + X; if (fol[k] && !seen[k]) { seen[k] = 1; st.push(k); } } }
      let x0 = 99, y0 = 99, x1 = -1, y1 = -1; for (const j of cells) { x0 = Math.min(x0, j & 31); x1 = Math.max(x1, j & 31); y0 = Math.min(y0, j >> 5); y1 = Math.max(y1, j >> 5); }
      const w = (x1 - x0 + 1) * 16, h = (y1 - y0 + 1) * 16, mask = new Uint8Array(w * h);
      const art = this.hedgeArt;                  // the foliage pixels only (greens and leaf shadows; not a kerb or fence line in the cell)
      for (const j of cells) { const cx = ((j & 31) - x0) * 16, cy = ((j >> 5) - y0) * 16; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const o = ((y0 * 16 + cy + y) * 512 + x0 * 16 + cx + x) * 4, r = art[o], g = art[o + 1], b = art[o + 2]; if ((g > r && g > b) || r + g + b < 150) mask[(cy + y) * w + cx + x] = 1; } }
      const m = F3.hedgeMesh(mask, x0 * 16, y0 * 16, w, h, 12, 6);
      for (let k = 0; k < m.uv.length; k++) m.uv[k] /= 512;
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao); const bufs = [];
      [[m.pos, 3], [m.uv, 2], [m.sway, 3]].forEach(([a, nn], k) => { const b = gl.createBuffer(); bufs.push(b); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW); gl.enableVertexAttribArray(k); gl.vertexAttribPointer(k, nn, gl.FLOAT, false, 0, 0); });
      const shape = { vao, bufs, count: m.pos.length / 3, r: Math.hypot(w, h) / 2 + 12 };
      f.fx.shapes.push(shape); f.fx.hedges.push({ shape, centre: [x0 * 16 + w / 2, 6, y0 * 16 + h / 2] });
    }
    gl.bindVertexArray(this.vao);
  }
  // The game animates some map tiles by rewriting their pixels in VRAM (the fountain's water, ...). The tiles of the
  // map's tile set (VRAM bank 1) are watched; when one changes, the cells showing it are drawn again into the floor
  // and building textures (8x8 sub-uploads; cells under cut-outs or repainted keep what they have).
  watchTiles() {
    const f = this.field, m = this.gb.mem, w0 = m.wram[0], MW = Math.min(64, w0[0x32B] || 64), MH = Math.min(64, w0[0x32C] || 64), lcdc = this.gb.ppu.lcdc;
    const byTile = new Map();
    for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
      const i = ty * 64 + tx, tile = m.wram[3][i], attr = m.wram[2][i]; if (!(attr & 8)) continue;
      const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
      let l = byTile.get(addr); if (!l) byTile.set(addr, l = []); l.push(tx, ty);
    }
    const addrs = [...byTile.keys()], snap = new Uint8Array(addrs.length * 16), v1 = m.vram[1];
    addrs.forEach((a, k) => snap.set(v1.subarray(a, a + 16), k * 16));
    f.live = { addrs, cells: addrs.map(a => byTile.get(a)), snap, frame: this.gb.ppu.frames };
  }
  updateTiles() {
    const f = this.field, L = f.live; if (!L || L.frame === this.gb.ppu.frames) return; L.frame = this.gb.ppu.frames;
    const v1 = this.gb.mem.vram[1], cells = new Set(); let tiles = 0;
    for (let k = 0; k < L.addrs.length; k++) {
      const a = L.addrs[k], o = k * 16; let same = true;
      for (let i = 0; i < 16; i++) if (v1[a + i] !== L.snap[o + i]) { same = false; break; }
      if (same) continue;
      L.snap.set(v1.subarray(a, a + 16), o); tiles++; const c = L.cells[k]; for (let i = 0; i < c.length; i += 2) cells.add(c[i + 1] * 64 + c[i]);
    }
    if (!cells.size) return;
    if (tiles > 32) { f.needBuild = true; return; }          // a new tile set (map loading), not an animation
    const gl = this.gl, img = this.liveImg || (this.liveImg = new Uint8Array(512 * 512 * 4)), blk = new Uint8Array(256);
    for (const ci of cells) {
      const tx = ci & 63, ty = ci >> 6; this.composeCell(img, tx, ty);
      for (const [data, keep, tex] of [[f.floorData, f.patched, f.floorTex], [f.artData, f.artMod, f.artTex]]) {
        if (!data || !tex) continue;
        let any = false;
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const i = (ty * 8 + y) * 512 + tx * 8 + x, o = i * 4;
          if (!keep || !keep[i]) { any = true; data[o] = img[o]; data[o + 1] = img[o + 1]; data[o + 2] = img[o + 2]; }
          blk.set(data.subarray(o, o + 4), (y * 8 + x) * 4);
        }
        if (!any) continue;
        gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, tx * 8, ty * 8, 8, 8, gl.RGBA, gl.UNSIGNED_BYTE, blk);
      }
    }
  }
  renderField(frame2d) {
    const gl = this.gl, cv = this.cv, m = this.gb.mem, p = this.gb.ppu, f = this.field, id = this.mapId(), c = this.cam;
    this.mode = "field";
    // built when the map changes; a palette change only recolours it (fades: about 16 steps), and once the palette has
    // settled for a few frames on colours it was not built with (and is not blank), it is built again
    let ph = 0; for (let i = 0; i < 64; i += 3) ph = (ph * 31 + p.bgPal[i]) | 0;
    const fr = this.gb.ppu.frames;
    // the map is loaded over several frames: built once the screen shows it, or once its WRAM map has stayed the same
    // for two frames (until then the previous build is shown, or nothing for a new map)
    const sig = this.mapSig(); if (sig !== f.sigSeen) { f.sigSeen = sig; f.sigAt = fr; }
    if (f.mapId !== id || f.sig !== sig || f.needBuild) {
      if (fr - f.sigAt < 2 && fr >= f.sigAt && this.fieldMatch() < 0.5) { if (f.mapId !== id) { this.drawFieldOverlays(frame2d); return; } }
      else { f.mapId = id; f.sig = sig; f.needBuild = false; f.palHash = ph; f.palAt = fr; this.buildField(); }
    }
    else if (f.palHash !== ph) { f.palHash = ph; f.palAt = fr; this.recolourField(); }
    else if (f.fading && (fr - f.palAt >= 3 || fr < f.palAt)) {
      // the palette settled: voxel bodies again; built again only if the map uses palettes 0-1 (live, not from the
      // ROM) and they are not what it was built with
      const lum = b => { let t = 0; for (let i = 0; i < 16; i += 2) { const c = b[i] | b[i + 1] << 8; t += (c & 31) + (c >> 5 & 31) + (c >> 10 & 31); } return t; };
      const now = lum(this.gb.ppu.bgPal), then = lum(f.lowPal);         // (a fade, not a text box changing a colour or two)
      if (f.usesLowPals && Math.abs(now - then) > 0.15 * Math.max(now, then) && !this.blankPalette()) this.buildField(); else f.fading = false;
    } else this.updateTiles();
    if (f.clear) { gl.clearColor(f.clear[0], f.clear[1], f.clear[2], 1); gl.clear(gl.COLOR_BUFFER_BIT); }
    const fi = this.fi = this.fieldInterp(), sc = { x: fi.sx, y: fi.sy }, aim = this.fieldAim || [0, 0], cx = sc.x + 80 + aim[0], cz = sc.y + 72 + aim[1], aspect = cv.width / cv.height;   // the camera between the last two game frames   // fieldAim: test views
    const yaw = this.freeCam ? c.yaw : 0, pitch = this.freeCam ? c.pitch : FIELD_CAM.pitch, dist = this.freeCam ? c.dist : FIELD_CAM.dist * Math.max(1, (160 / 144) / aspect);
    const eye = [cx + dist * Math.sin(yaw) * Math.cos(pitch), dist * Math.sin(pitch), cz + dist * Math.cos(yaw) * Math.cos(pitch)];
    const mvp = m4.mul(m4.perspective(FIELD_CAM.fov, aspect, FIELD_CAM.near, FIELD_CAM.far), m4.lookAt(eye, [cx, 0, cz], [0, 1, 0]));
    if (this.light) this.light.camera(mvp, FIELD_CAM.near, FIELD_CAM.far, 1, "field", [cx, 0, cz], id);   // LIGHT
    const T = this.animClock ?? performance.now() / 1000;
    // floor (512x512 map px; +z = down the map), on a plain ground reaching the horizon on side-view maps
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    if (f.skirt) this.draw(f.skirt, m4.trs(256, -0.6, 3000, 6000, 6000, -Math.PI / 2), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0);
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
      const SU = this.uS; gl.useProgram(this.progS); gl.bindTexture(gl.TEXTURE_2D, f.artTex); gl.uniformMatrix4fv(SU.uMVP, false, mvp); gl.uniform1f(SU.uAlphaTest, 0.5);   // SHIMMER: window glints on the facades
      gl.uniform1f(SU.uTime, T); gl.uniform1f(SU.uShim, this.shimmer.level());
      for (const [b, k] of [[f.blocks.front, 1], [f.blocks.side, 0.68]]) { gl.bindVertexArray(b.vao); gl.uniform4fv(SU.uTint, [k, k, k, 1]); gl.drawArrays(gl.TRIANGLES, 0, b.count); }
      gl.useProgram(this.prog3); gl.uniformMatrix4fv(this.u3.uMVP, false, mvp); gl.uniform1f(this.u3.uAlphaTest, 0.5);
      if (f.roof) { gl.bindTexture(gl.TEXTURE_2D, f.roof.tex); for (const [b, k] of [[f.roof.lit, 1], [f.roof.shade, 0.75]]) { gl.bindVertexArray(b.vao); gl.uniform4fv(this.u3.uTint, [k, k, k, 1]); gl.drawArrays(gl.TRIANGLES, 0, b.count); } }
      gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    }
    for (const c of f.cards || []) {
      const tilt = c.tilt ?? FIELD_TILT, hs = c.hs || 1;
      if (this.voxelSprites && !c.flat && !f.fading) {
        const owner = c.shared || c; if (!owner.mesh) owner.mesh = this.meshFromPixels(c.d, c.w, c.h, c.R ?? 4, c.T ?? 3.5);
        this.drawMesh(owner.mesh, m4.trs3(c.X, c.lift || 0, c.Z, 1, hs, 1, -tilt), mvp);
      } else this.draw(c.tex, m4.trs(c.X, c.lift || 0, c.Z, c.w, c.h * hs, -tilt, 0), mvp, [0, 0, 1, 1], [1, 1, 1, 1], 0.5);
    }
    this.drawFieldFx(mvp, T);
    this.fieldRects = this.fieldOverlayRects();                         // once per frame: the actors and the overlays both need them
    this.drawFieldActors(mvp);
    if (f.glass) {                                                       // glass walls (thin panes), after everything behind them
      gl.useProgram(this.progG); gl.uniformMatrix4fv(this.uG.uMVP, false, mvp); gl.uniform1f(this.uG.uTime, T); gl.uniform1f(this.uG.uShim, this.shimmer.level());
      gl.depthMask(false); gl.bindVertexArray(f.glass.vao); gl.drawArrays(gl.TRIANGLES, 0, f.glass.count); gl.depthMask(true);
      gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
    }
    // dialogue boxes and menus: the game writes them into the BG tile map over the scenery (and some screens use
    // the window layer); both are cut out of the 2D frame and shown at the top middle of the view
    if (this.light) this.light.post();   // LIGHT: the lit scene goes to the canvas; the overlays below are drawn over it, unlit
    this.drawFieldOverlays(frame2d);
  }
  // swaying flowers, fountain jets and the rings on their pools: geometry built once, moved by the shaders
  drawFieldFx(mvp, T) {
    const gl = this.gl, fx = this.field.fx; if (!fx) return;
    // (flowers, plants, then the jets)
    gl.useProgram(this.progW); gl.uniformMatrix4fv(this.uW.uMVP, false, mvp); gl.uniform1f(this.uW.uTime, T);
    // what is in view: a point's clip position within the frustum, with a margin of r map px
    const inView = (p, r) => { const c = m4.apply(mvp, [p[0], p[1], p[2], 1]), mg = r * 1.2 * Math.abs(mvp[5]) + 0.2 * c[3]; return c[3] <= 0 || !(c[0] < -c[3] - mg || c[0] > c[3] + mg || c[1] < -c[3] - mg || c[1] > c[3] + mg); };
    gl.uniformMatrix4fv(this.uW.uModel, false, m4.identity()); gl.uniform1f(this.uW.uPhase, 0); gl.uniform1f(this.uW.uAmp, 1.1);
    for (const g of fx.flowerGroups || []) if (inView(g.centre, 48)) { gl.bindVertexArray(g.vao); gl.drawArrays(gl.TRIANGLES, 0, g.count); }
    if (fx.plants.length && this.field.artTex) {   // trees and bushes: voxel bodies rustling in the same wind, those in view
      gl.useProgram(this.progP); gl.uniformMatrix4fv(this.uP.uMVP, false, mvp); gl.uniform1f(this.uP.uTime, T); gl.bindTexture(gl.TEXTURE_2D, this.field.artTex);
      let drawn = 0;
      for (const p of fx.plants) {
        const c = m4.apply(mvp, p.centre ? [...p.centre, 1] : [p.model[12], p.shape.r * 0.5, p.model[14], 1]), m = p.shape.r * 1.2 * Math.abs(mvp[5]) + 0.2 * c[3];   // centre in clip space, with a margin
        if (c[3] <= 0 || c[0] < -c[3] - m || c[0] > c[3] + m || c[1] < -c[3] - m || c[1] > c[3] + m) continue;
        gl.bindVertexArray(p.shape.vao); gl.uniformMatrix4fv(this.uP.uModel, false, p.model); gl.uniform1f(this.uP.uPhase, p.phase); gl.uniform1f(this.uP.uAmp, p.amp);
        gl.drawArrays(gl.TRIANGLES, 0, p.shape.count); drawn += p.shape.count;
      }
      this.plantVerts = drawn;                    // (vertices drawn this frame: for tests)
    }
    if (fx.hedges && fx.hedges.length) {           // hedges: coloured from the floor texture, the wind's phase by place
      gl.useProgram(this.progP); gl.uniformMatrix4fv(this.uP.uMVP, false, mvp); gl.uniform1f(this.uP.uTime, T); gl.bindTexture(gl.TEXTURE_2D, this.field.floorTex);
      gl.uniformMatrix4fv(this.uP.uModel, false, m4.identity()); gl.uniform1f(this.uP.uPhase, 0); gl.uniform1f(this.uP.uAmp, 0.5);
      for (const hg of fx.hedges) {
        const c = m4.apply(mvp, [...hg.centre, 1]), mg = hg.shape.r * 1.2 * Math.abs(mvp[5]) + 0.2 * c[3];
        if (c[3] <= 0 ? false : (c[0] < -c[3] - mg || c[0] > c[3] + mg || c[1] < -c[3] - mg || c[1] > c[3] + mg)) continue;
        gl.bindVertexArray(hg.shape.vao); gl.drawArrays(gl.TRIANGLES, 0, hg.shape.count);
      }
      gl.useProgram(this.progW);
    }
    if (fx.fountains.length && this.jetMesh) {
      gl.useProgram(this.progJ); gl.bindVertexArray(this.jetMesh.vao); gl.uniformMatrix4fv(this.uJ.uMVP, false, mvp); gl.uniform1f(this.uJ.uTime, T);
      for (const fo of fx.fountains) {
        if (!inView(fo.origin, 24)) continue;
        gl.uniform3fv(this.uJ.uOrigin, fo.origin); gl.uniform4fv(this.uJ.uJet, fo.jet);
        gl.uniform3fv(this.uJ.uC0, fo.cols[0]); gl.uniform3fv(this.uJ.uC1, fo.cols[1]); gl.uniform3fv(this.uJ.uC2, fo.cols[2]);
        gl.drawArrays(gl.TRIANGLES, 0, this.jetMesh.count);
      }
      gl.useProgram(this.progR); gl.bindVertexArray(this.vao); gl.depthMask(false);
      gl.uniformMatrix4fv(this.uR.uMVP, false, mvp); gl.uniform4fv(this.uR.uUVRect, [0, 0, 1, 1]); gl.uniform1f(this.uR.uTime, T);
      for (const fo of fx.fountains) {
        if (!inView(fo.origin, 24)) continue;
        const q = fo.pool, w = q.x1 - q.x0, d = q.z1 - q.z0;
        gl.uniformMatrix4fv(this.uR.uModel, false, m4.plane([w, 0, 0], [0, 0, -d], [(q.x0 + q.x1) / 2, q.y, q.z1]));
        gl.uniform2fv(this.uR.uSize, [w, d]); gl.uniform3fv(this.uR.uCol, fo.cols[0]);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      gl.depthMask(true);
    }
    gl.useProgram(this.prog); gl.bindVertexArray(this.vao);
  }
  // overworld actor slots (WRAM4 $D000, 24 x $40 bytes; a slot is in use when its script pointer's high byte is
  // non-zero): +$0C/+$0E position in 1/256 tile (= 32 per map px), +$10 height (64 per px, negative = up), +$21 object id
  fieldActors() {
    const w4 = this.gb.mem.wram[4], out = [];
    for (let i = 0; i < 24; i++) {
      const b = i * 0x40; if (!w4[b + 1] || !w4[b + 0x21]) continue;
      const u16 = o => w4[b + o] | (w4[b + o + 1] << 8);
      out.push({ slot: i, obj: w4[b + 0x21], x: u16(0x0C) / 32, y: u16(0x0E) / 32, lift: -((u16(0x10) << 16 >> 16) / 64), list: [] });
    }
    return out;
  }
  // Actors: OAM sprites at map px (screen + scroll), 1 px = 1 unit, leaning back. The game only puts actors that are
  // on its 160x144 screen into OAM (one whose sprites would cross the screen edge loses them one by one), but the 3D
  // view shows much more of the map: so each actor's look is remembered from the last time it was wholly on the
  // screen, and drawn at the actor's real position (the actor table) while it is off the Game Boy screen or cut by
  // its edge. Actors the game hides while on screen stay hidden; sprites that belong to no actor (emotes, effects)
  // are drawn as touching groups. Nothing is drawn under the sprites: the ground shows as on the Game Boy.
  drawFieldActors(mvp) {
    const p = this.gb.ppu, sc = this.fieldScroll(), TILT = 0.3, id = this.mapId();
    // sprites are placed with SCX/SCY, which can trail the field scroll by a pixel or two while walking
    const ox = sc.x + (((p.scx - sc.x) << 24) >> 24), oy = sc.y + (((p.scy - sc.y) << 24) >> 24);
    if (!this.actorMem || this.actorMem.map !== id) this.actorMem = { map: id, slots: new Map() };
    const mem = this.actorMem.slots, actors = this.fieldActors();
    for (const a of actors) { a.ax = a.x - ox; a.ay = a.y + 4 - oy; }
    // HD art may have replaced sprites it took for cursors; one standing on an actor's feet is that actor's body, whatever the finder thought
    const sprs = this.collectSprites(true, this.fieldRects || this.fieldOverlayRects(), (sx, sy) => actors.some(a => Math.abs(sx + 4 - a.ax) <= 12 && sy + 16 >= a.ay - 22 && sy <= a.ay + 4));     // screen point of the feet (sprites end 4 px below the position)
    sprs.forEach((s, i) => s.g = i);
    const find = i => { while (sprs[i].g !== i) i = sprs[i].g = sprs[sprs[i].g].g; return i; };
    for (let i = 0; i < sprs.length; i++) for (let j = i + 1; j < sprs.length; j++) { const a = sprs[i], b = sprs[j]; if (a.sx < b.sx + 10 && b.sx < a.sx + 10 && a.sy < b.sy + b.h + 2 && b.sy < a.sy + a.h + 2) sprs[find(j)].g = find(i); }
    const groups = new Map();
    for (const sp of sprs) { const r = find(sp.g); let g = groups.get(r); if (!g) groups.set(r, g = { list: [], x0: 999, x1: -999, y0: 999, y1: -999 }); g.list.push(sp); g.x0 = Math.min(g.x0, sp.sx); g.x1 = Math.max(g.x1, sp.sx + 8); g.y0 = Math.min(g.y0, sp.sy); g.y1 = Math.max(g.y1, sp.sy + sp.h); }
    const loose = [];
    for (const g of groups.values()) {
      // the actors whose feet are at this group (in the air: the shadowless body is lifted by the height)
      const own = actors.filter(a => a.ax >= g.x0 - 4 && a.ax <= g.x1 + 4 && a.ay - a.lift >= g.y0 + 6 && a.ay - a.lift <= g.y1 + 8);
      if (!own.length) { loose.push(g); continue; }
      for (const sp of g.list) {                                       // touching actors: each sprite to the nearest feet
        let best = own[0], d0 = 1e9;
        for (const a of own) { const d = Math.max(0, Math.abs(sp.sx + 4 - a.ax) - 4) + 0.5 * Math.abs(sp.sy + sp.h - (a.ay - a.lift)); if (d < d0) { d0 = d; best = a; } }   // a 16 px actor's sprites sit 4 px either side of its feet
        best.list.push(sp);
      }
    }
    this.actorSprs = actors.flatMap(a => a.list);                     // (drawFieldOverlays: people are left out of the text boxes)
    if (this.hdText) {                                                 // and the HD layer leaves their sprites alone (it smooths menu sprites)
      const ids = new Set(this.actorSprs.map(sp => sp.i)), was = this.hdText.actorOam;
      if (!was || was.size !== ids.size || [...ids].some(i => !was.has(i))) { this.hdText.actorOam = ids; this.hdText.dirty = true; this.hdText.key = ""; }
    }
    for (const a of actors) {
      const ia = this.fi && this.fi.act.get(a.slot), X = ia ? ia.x : a.x, Z = (ia ? ia.y : a.y) + 4; a.lift = ia ? ia.lift : a.lift;
      let m = mem.get(a.slot); if (m && m.obj !== a.obj) { mem.delete(a.slot); m = null; }
      if (a.list.length) {
        let x0 = 999, x1 = -999, y0 = 999, y1 = -999;
        for (const sp of a.list) { x0 = Math.min(x0, sp.sx); x1 = Math.max(x1, sp.sx + 8); y0 = Math.min(y0, sp.sy); y1 = Math.max(y1, sp.sy + sp.h); }
        const inside = x0 >= 0 && x1 <= 160 && y0 >= 0 && y1 <= 144;
        // straddling the picture edge: the game still wrote every part (they sit in the OAM margin), so the current pose is whole
        // as long as as many parts are there as when the actor was last seen inside; fewer = the game culled some -> the remembered look
        const whole = inside || (m && a.list.length >= m.n);
        if (whole || !m) {
          const body = this.bodyOf(a.list, a.ax, a.ay);
          if (inside) mem.set(a.slot, { obj: a.obj, body, n: a.list.length, bx0: x0 - a.ax, bx1: x1 - a.ax, by0: y0 - a.ay });
          this.drawBody(body, X, Z, 0, 1, TILT, mvp); continue;
        }
        this.drawBody(m.body, X, Z, a.lift, 1, TILT, mvp); continue;   // cut by the screen edge: the whole look
      }
      // no sprites and never seen: a student the game culled before it was ever on screen. Its two 8x16 parts (tile t at x-8, t+2 at x,
      // attribute from the actor table) are put together here. The game loads an actor's frame into VRAM only once (+0x32 = the frame
      // loaded, $FF = none yet): a loaded frame is drawn as it is; for the others the tiles of another student are borrowed (all
      // students share the same frames, only the palette differs), so the far courts are never empty
      if (!m && a.obj === 84 && (a.ax < -8 || a.ax >= 168 || a.ay < -4 || a.ay >= 176)) {
        const w4 = this.gb.mem.wram[4], b = a.slot * 0x40;
        let tile = w4[b + 0x36];
        if (w4[b + 0x32] === 0xFF) {
          const donor = actors.find(d => d !== a && d.obj === 84 && (d.list.length || mem.has(d.slot) || w4[d.slot * 0x40 + 0x32] !== 0xFF));
          if (!donor) continue;
          tile = w4[donor.slot * 0x40 + 0x36];
        }
        const attr = w4[b + 0x37], sx = a.ax - 8, sy = a.ay - 16;
        const list = [{ sx, sy, h: 16, tile: tile & 0xFE, attr, owner: null }, { sx: sx + 8, sy, h: 16, tile: (tile + 2) & 0xFE, attr, owner: null }];
        this.drawBody(this.bodyOf(list, a.ax, a.ay), X, Z, a.lift, 1, TILT, mvp); continue;
      }
      // no sprites: off the Game Boy screen (culled by the game) -> the remembered look; on screen -> hidden by the game
      if (m && (a.ax + m.bx0 < 0 || a.ax + m.bx1 > 160 || a.ay + m.by0 < 0 || a.ay > 144)) this.drawBody(m.body, X, Z, a.lift, 1, TILT, mvp);
    }
    for (const g of loose) { const cx2 = (g.x0 + g.x1) / 2; this.blitObject(g.list, cx2, g.y1, cx2 + ox, g.y1 + oy, 0, 1, TILT, mvp); }
    if (this.debug) this.debug.push({ actors: actors.map(a => `${a.slot}:${a.obj}@${Math.round(a.ax)},${Math.round(a.ay)}/${a.list.length}${mem.has(a.slot) ? "m" : ""}`).join(" "), loose: loose.length });
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
  // sprites the HD art replaced (menu captions, cursors) that lie outside every overlay box: their art gets a box of its own
  // in the stack (only the art is drawn there), as the game's own sprites would be cards in the scenery otherwise
  hdSpriteRects(rects) {
    const hd = this.hdText; if (!hd || !hd.active || !hd.ui || !hd.hiddenOam.size || !hd.has.spr) return;
    const left = hd.screen.oam.filter(o => hd.hiddenOam.has(o.i) && !rects.some(r => o.x + 4 >= r.x0 && o.x + 4 < r.x1 && o.y + o.h / 2 >= r.y0 && o.y + o.h / 2 < r.y1));
    const groups = [];
    for (const o of left) {
      const near = groups.filter(g => g.some(q => Math.abs(q.x - o.x) <= 8 && Math.abs(q.y - o.y) <= o.h));
      const merged = [o]; for (const g of near) { merged.push(...g); groups.splice(groups.indexOf(g), 1); } groups.push(merged);
    }
    for (const g of groups) {
      const x0 = Math.max(0, Math.min(...g.map(o => o.x))), y0 = Math.max(0, Math.min(...g.map(o => o.y))), x1 = Math.min(160, Math.max(...g.map(o => o.x + 8))), y1 = Math.min(144, Math.max(...g.map(o => o.y + o.h)));
      if (x1 > x0 && y1 > y0) rects.push({ x0, y0, x1, y1, sprOnly: true });
    }
  }
  drawFieldOverlays(frame2d) {
    const rects = this.fieldRects || this.fieldOverlayRects(); this.fieldRects = null; if (this.debug) this.debug.push({ overlays: rects });
    if (!rects.length || !frame2d) return;
    const gl = this.gl;
    // a person standing where a text box opens is drawn over it by the Game Boy (sprites lie above the window); they stand in the 3D
    // scene already, so inside the boxes their sprites are taken out (the background-and-window picture shows there instead)
    const hit = (this.actorSprs || []).filter(sp => rects.some(r => !r.sprOnly && sp.sx < r.x1 && sp.sx + 8 > r.x0 && sp.sy < r.y1 && sp.sy + sp.h > r.y0));
    if (hit.length) {
      const o = this.ovFrame ||= new Uint32Array(160 * 144), bg = this.gb.ppu.bgFrame; o.set(frame2d);
      for (const sp of hit) for (let y = Math.max(0, sp.sy); y < Math.min(144, sp.sy + sp.h); y++) for (let x = Math.max(0, sp.sx); x < Math.min(160, sp.sx + 8); x++) {
        if (rects.some(r => !r.sprOnly && x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)) o[y * 160 + x] = bg[y * 160 + x];
      }
      frame2d = o; this.frameTexKey = "";
    }
    this.actorSprs = null;
    this.uploadFrame(frame2d);
    gl.disable(gl.DEPTH_TEST);
    const { ortho, t, b } = this.hudOrtho();
    rects.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    let y = t + 3 + (this.topInset || 0) * (b - t) / (this.cv.clientHeight || 1);   // stacked from the top edge (below the HUD bar), centred
    for (const r of rects) {
      const w = r.x1 - r.x0, h = r.y1 - r.y0;
      if (r.sprOnly) { this.drawHDText(m4.trs(80, y + h, 0, w, -h, 0), ortho, [r.x0 / 160, r.y0 / 144, w / 160, h / 144], ["spr"]); y += h + 2; continue; }   // HD art of replaced sprites only
      this.draw(this.boxShadowTex, m4.trs(80 + 2, y + h + 2, 0, w, -h, 0), ortho, [0, 0, 1, 1], [1, 1, 1, 0.7], 0);
      this.draw(this.frameTex, m4.trs(80, y + h, 0, w, -h, 0), ortho, [r.x0 / 160, r.y0 / 144, w / 160, h / 144], [1, 1, 1, 1], 0);
      this.drawHDText(m4.trs(80, y + h, 0, w, -h, 0), ortho, [r.x0 / 160, r.y0 / 144, w / 160, h / 144]);
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
  // the 2D frame as a texture for the overlays: uploaded once per game frame (the display may refresh twice as often), again when the
  // frame the page passes changed (sprites the HD art replaced are cut out of it)
  uploadFrame(frame2d) {
    const gl = this.gl, hd = this.hdText, k = this.gb.ppu.frames + ":" + (hd ? hd.sprVersion + ":" + hd.version : "");
    if (!this.frameTex) { this.frameTex = this.texture(160, 144, null); this.frameTexKey = ""; }
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    if (this.frameTexKey === k && this.frameTexSrc === frame2d && this.frameTexGen === this.attachGen) return;
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(frame2d.buffer));
    this.frameTexKey = k; this.frameTexSrc = frame2d; this.frameTexGen = this.attachGen;
  }
  layerTexture(key, rgba) {
    const gl = this.gl, L = this.layer;
    if (!L[key]) L[key] = this.texture(160, 144, null);
    gl.bindTexture(gl.TEXTURE_2D, L[key]); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 160, 144, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    return L[key];
  }
  renderLayers() {
    const gl = this.gl, cv = this.cv, p = this.gb.ppu, L = this.layer; this.mode = "layers";
    // the layer pictures are made once per game frame (the display may refresh twice as often)
    let tBack, tPan, tWin;
    if (L.tex && !this.frameChanged && L.gen === this.attachGen) { tBack = L.tex[0]; tPan = L.tex[1]; tWin = L.tex[2]; }
    else {
    const mask = this.menuLayers(), N = 160 * 144, src = new Uint8Array(p.bgFrame.buffer);
    const back = L.back || (L.back = new Uint8Array(N * 4)), pan = L.pan || (L.pan = new Uint8Array(N * 4)), win = L.winBuf || (L.winBuf = new Uint8Array(N * 4));
    back.set(src); pan.fill(0); win.fill(0);
    for (let i = 0; i < N; i++) {
      if (!mask[i]) continue;
      const o = i * 4, dst = mask[i] === 1 ? pan : win;
      dst[o] = src[o]; dst[o + 1] = src[o + 1]; dst[o + 2] = src[o + 2]; dst[o + 3] = 255;
      back[o] = back[o] * 0.55; back[o + 1] = back[o + 1] * 0.55; back[o + 2] = back[o + 2] * 0.55;   // under a panel: in its shadow
    }
    tBack = this.layerTexture("tBack", back); tPan = this.layerTexture("tPan", pan); tWin = this.layerTexture("tWin", win);
    L.tex = [tBack, tPan, tWin]; L.gen = this.attachGen;
    }
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
    const hdPlane = (t, z) => { gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); plane(t, z, [1, 1, 1, 1], 0, 0, 0.004); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); };
    const hdUnder = this.hdTex("under"); if (hdUnder) hdPlane(hdUnder, 8.04);          // the smoothed picture under the HD art
    const hdBg = this.hdTex("bg"); if (hdBg) hdPlane(hdBg, 8.05);
    plane(tWin, 9, [0, 0, 0, 0.22], 4, 4); plane(tWin, 9.5, SH, 2.5, 2.5); plane(tWin, 14);
    const hdWin = this.hdTex("win"); if (hdWin) hdPlane(hdWin, 14.05);
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
    const hdSpr = this.hdTex("spr"); if (hdSpr) hdPlane(hdSpr, 21);       // HD art that replaced sprites (cursors)
  }
  drawFlatFrame(frame) {                            // the plain 2D frame as a textured quad filling the canvas
    const gl = this.gl;
    this.uploadFrame(frame);
    gl.disable(gl.DEPTH_TEST);
    this.draw(this.frameTex, m4.trs(0, -1, 0, 2, 2, 0), m4.identity(), [0, 0, 1, 1], [1, 1, 1, 1], 0);
    this.drawHDText(m4.trs(0, -1, 0, 2, 2, 0), m4.identity());
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

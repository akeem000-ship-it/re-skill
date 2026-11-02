// 3D OVERWORLD (render only; adapted from Mario Tennis's field3d.js / voxel.js "field" scene): the story mode's maps in 3D while the map
// engine runs (bank 04's actor tasks 04:4234 / 04:4B69 registered). The map is the one the game has loaded (wMapGfx $C32E): its tile
// map and attributes as the game holds them (WRAM3 / WRAM2 $D000, 64 x 64, edited by the map scripts), its MapGfxTable 0B:4048
// entry's collision grid (read from the ROM: 32 x 32 cells of 16 px, low nibble $0F = blocked) and event grid, drawn with the game's
// live tiles (VRAM $8800-$97FF: the map's animated tiles move as the game moves them) and palettes. On it:
//   * the blocked cells as low boxes (their own picture on the top and the front), unless the map's annotation says otherwise;
//   * the annotated objects (field_objects.js): building blocks (roof and front wall), plants and props found by their tiles stood
//     up as rounded bodies (voxround.js) that sway in the wind (FIELD LIFE);
//   * the people: the sprites the actors' code (bank 04) queues, joined into their figures (the touching 8 x 16 sprites: a 16 x 16
//     frame, a taller one) and stood up as rounded bodies at their feet's spot, at the game's own size, turned to the camera;
//   * the game's own picture of everything the map does not explain, laid over it as the game draws it: the window layer, the other
//     sprites, and the BG cells that are not the map's (the message boxes, menus and portraits bank 05 draws into the BG over the map).
// What it cannot draw it leaves to the 2D picture (render() returns false): a screen whose BG is mostly not the map (a full-screen
// picture, a menu, the name entry) and a map that is only a picture (no walls, no events, no annotation: the new character's room).
// The camera looks down at a slant over the game's own view centre (the scroll $C320 / $C322). GROUND (ground.js) adds grass
// blades and dirt to the ground's own colours, SHIMMER (shimmer.js) the glint on water and glass. Nothing of the game is written.
import { m4, program, vao, texture, updateTexture, clamp, mulberry32 } from "./gl.js";
import { rb, rw, lzDecompress, offset } from "../golf/rom.js";
import { roundedMeshData } from "./voxround.js";
import { FIELD_OBJECTS } from "./field_objects.js";
import { Golf3D } from "./scene.js";
import { tagsOf } from "./hud3d.js";
import { picKey } from "./sprites3d.js";
import { GROUND_GLSL } from "./ground.js";
import { SHIMMER_GLSL } from "./shimmer.js";

const VS = `#version 300 es
in vec3 aPos; in vec2 aUV; in float aShade; in float aSway; uniform mat4 uMVP; uniform float uTime; uniform vec2 uWind; out vec2 vUV; out float vShade; out vec3 vW; out float vFace;
void main() { vec3 p = aPos; float s = sin(uTime * 1.9 + p.x * 0.07 + p.z * 0.05) * 0.75 + sin(uTime * 3.3 + p.x * 0.11) * 0.25;
  p.xz += (uWind * 0.06 + vec2(0.35, 0.12)) * s * aSway;
  vUV = aUV; vShade = aShade; vW = p; vFace = aSway < -0.5 ? 1.0 : 0.0; gl_Position = uMVP * vec4(p, 1.0); }`;
const FS = `#version 300 es
precision highp float; in vec2 vUV; in float vShade; in vec3 vW; in float vFace; uniform sampler2D uMap; uniform float uTime, uGround, uShimmer, uLightK; uniform vec4 uFade; uniform vec2 uWind; out vec4 o;
${GROUND_GLSL}
${SHIMMER_GLSL}
void main() { vec4 t = texture(uMap, vUV); if (t.a < 0.5) discard; vec3 c = t.rgb;
  if (uGround > 0.5 && vShade > 0.99) c = groundDetail(c, vW.xz, uTime, uWind);
  if (uShimmer > 0.5) c = shimmer(c, vW, uTime);
  o = vec4(mix(c * vShade * uLightK, uFade.rgb, uFade.a), 1.0); }`;
const BVS = `#version 300 es
in vec3 aPos; in vec3 aCol; uniform mat4 uMVP; uniform mat4 uModel; out vec3 vCol; void main() { vCol = aCol; gl_Position = uMVP * uModel * vec4(aPos, 1.0); }`;
const BFS = `#version 300 es
precision mediump float; in vec3 vCol; uniform float uLightK; uniform vec4 uFade; out vec4 o; void main() { o = vec4(mix(vCol * uLightK, uFade.rgb, uFade.a), 1.0); }`;

const r16 = (b, a) => rb(b, a) | rb(b, (a + 1) & 0xFFFF) << 8;
function gfxRefs(id) { const e = (0x4048 + id * 18) & 0xFFFF; return Array.from({ length: 9 }, (_, k) => r16(0x0B, e + 2 * k)); }
function refData(hl) { const bank = hl >> 8, src = r16(bank, 0x4000 + (hl & 0xFF)); return lzDecompress(offset(bank, src)); }

export class Field3D {
  key = "field3d";
  active(game) {
    const w = game.w; if (!w.vram || !(w.lcd.lcdc & 0x80) || game.mark !== "menus") return false;
    return Golf3D.taskOn(w, 0x04, 0x4B69) && Golf3D.taskOn(w, 0x0B, 0x4784);
  }
  init(sc) {
    if (this.P) return;
    const gl = sc.gl;
    this.P = program(gl, VS, FS); this.B = program(gl, BVS, BFS);
    this.tex = texture(gl, 512, 512, new Uint8Array(512 * 512 * 4));
  }
  build(sc, w, id) {
    // the tile map and its attributes as the game holds them (WRAM3 / WRAM2 $D000: the map scripts edit them, doors and rooms);
    // the walls from the ROM's terrain grid
    const gl = sc.gl, refs = gfxRefs(id), tmap = w.wram[3].slice(0, 4096), amap = w.wram[2].slice(0, 4096), coll = refData(refs[4]);
    const ann = FIELD_OBJECTS[String(id)] || {};
    if (this.map) { this.map.mesh.free(); for (const b of this.map.bodies) { b.free(); } }
    // a map that is only a picture (no blocked cell, no event, no annotation): the 2D picture shows it
    const events = refData(refs[5]), picture = !FIELD_OBJECTS[String(id)] && coll.every(c => (c & 0x0F) !== 0x0F) && events.every(c => !c);
    this.map = { id, tmap, amap, coll, ann, picture, mapHash: mapHash(w), bodies: [], img: new Uint8Array(512 * 512 * 4), tileHash: -1, palHash: -1 };
    this.paint(w, true);
    // the boxes and the blocks: one mesh (position, uv, shade, sway)
    const pos = [], uv = [], sh = [], sw = [];
    const quad = (p, t, s, sway = 0) => { for (const i of [0, 1, 2, 0, 2, 3]) { pos.push(...p[i]); uv.push(t[i][0] / 512, t[i][1] / 512); sh.push(s); sw.push(sway); } };
    // (the plain round the map: its corner colour; well under the map, so a coarse depth buffer never lets it through the floor)
    quad([[-1500, -3, -1500], [2012, -3, -1500], [2012, -3, 2012], [-1500, -3, 2012]], [[0, 0], [1, 0], [1, 1], [0, 1]], 0.55);
    quad([[0, 0, 0], [512, 0, 0], [512, 0, 512], [0, 0, 512]], [[0, 0], [512, 0], [512, 512], [0, 512]], 1);   // the map
    const covered = new Uint8Array(32 * 32);
    for (const b of ann.blocks || []) {
      const h = b.y1 - b.fold, x0 = b.x0, x1 = b.x1, z0 = b.y0, z1 = b.y1;
      quad([[x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1]], [[x0, b.y0], [x1, b.y0], [x1, b.fold], [x0, b.fold]], 1.04);        // the roof
      quad([[x0, h, z1], [x1, h, z1], [x1, 0, z1], [x0, 0, z1]], [[x0, b.fold], [x1, b.fold], [x1, b.y1], [x0, b.y1]], 0.98);         // the front wall
      quad([[x0, h, z0], [x0, h, z1], [x0, 0, z1], [x0, 0, z0]], [[x0, b.fold], [x0 + 1, b.fold], [x0 + 1, b.y1], [x0, b.y1]], 0.7);   // the sides
      quad([[x1, h, z1], [x1, h, z0], [x1, 0, z0], [x1, 0, z1]], [[x1 - 1, b.fold], [x1, b.fold], [x1, b.y1], [x1 - 1, b.y1]], 0.7);
      for (let cz = z0 >> 4; cz < (z1 + 15) >> 4; cz++) for (let cx = x0 >> 4; cx < (x1 + 15) >> 4; cx++) covered[cz * 32 + cx] = 1;
    }
    if (ann.walls !== false) {
      const H = ann.wallH || 10;
      const blocked = (cx, cz) => cx >= 0 && cz >= 0 && cx < 32 && cz < 32 && (coll[cz * 32 + cx] & 0x0F) === 0x0F && !covered[cz * 32 + cx];
      for (let cz = 0; cz < 32; cz++) for (let cx = 0; cx < 32; cx++) {
        if (!blocked(cx, cz)) continue;
        const x0 = cx * 16, x1 = x0 + 16, z0 = cz * 16, z1 = z0 + 16;
        quad([[x0, H, z0], [x1, H, z0], [x1, H, z1], [x0, H, z1]], [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], 1.02);
        if (!blocked(cx, cz + 1)) quad([[x0, H, z1], [x1, H, z1], [x1, 0, z1], [x0, 0, z1]], [[x0, z1 - 4], [x1, z1 - 4], [x1, z1], [x0, z1]], 0.8);
        if (!blocked(cx - 1, cz)) quad([[x0, H, z0], [x0, H, z1], [x0, 0, z1], [x0, 0, z0]], [[x0, z0], [x0 + 2, z0], [x0 + 2, z1], [x0, z1]], 0.66);
        if (!blocked(cx + 1, cz)) quad([[x1, H, z1], [x1, H, z0], [x1, 0, z0], [x1, 0, z1]], [[x1 - 2, z0], [x1, z0], [x1, z1], [x1 - 2, z1]], 0.66);
        if (!blocked(cx, cz - 1)) quad([[x1, H, z0], [x0, H, z0], [x0, 0, z0], [x1, 0, z0]], [[x0, z0], [x1, z0], [x1, z0 + 2], [x0, z0 + 2]], 0.6);
      }
    }
    this.map.mesh = { ...vao(gl, this.P, { aPos: [new Float32Array(pos), 3], aUV: [new Float32Array(uv), 2], aShade: [new Float32Array(sh), 1], aSway: [new Float32Array(sw), 1] }), n: pos.length / 3 };
    this.buildPlants(sc);
  }
  // the annotated stamps: every cell whose tile (number and attribute) is one of the example's (not a plain one-colour tile) is part
  // of a plant; connected groups (up to 2 x 2 tiles) stand up as rounded bodies, all in one mesh
  buildPlants(sc) {
    const M = this.map, ann = M.ann, img = M.img, key = (x, y) => M.tmap[y * 64 + x] | ((M.amap[y * 64 + x] & 0x6F) << 8);
    const pos = [], col = [], used = new Uint8Array(64 * 64);
    for (const st of [...(ann.stamps || []), ...(ann.cards || [])]) {
      const keys = new Set();
      for (let y = st.y >> 3; y < (st.y + st.h) >> 3; y++) for (let x = st.x >> 3; x < (st.x + st.w) >> 3; x++) if (!this.plainTile(x, y)) keys.add(key(x, y));
      const plant = st.plant;
      for (let ty = 0; ty < 64; ty += 2) for (let tx = 0; tx < 64; tx += 2) {
        let any = false; for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (!used[(ty + dy) * 64 + tx + dx] && keys.has(key(tx + dx, ty + dy))) any = true;
        if (!any) continue;
        // the 16 x 16 picture of the group, the ground colour (its commonest border colour) cut away
        const w = 16, h = 16, rgba = new Uint8Array(w * h * 4), cnt = new Map();
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const q = ((ty * 8 + y) * 512 + tx * 8 + x) * 4; if (y === 0 || x === 0 || y === h - 1 || x === w - 1) { const c = img[q] << 16 | img[q + 1] << 8 | img[q + 2]; cnt.set(c, (cnt.get(c) || 0) + 1); } }
        const bg = [...cnt].sort((a, b) => b[1] - a[1])[0][0];
        let n = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          const ox = tx * 8 + x, oy = ty * 8 + y, cell = (oy >> 3) * 64 + (ox >> 3), q = (oy * 512 + ox) * 4, c = img[q] << 16 | img[q + 1] << 8 | img[q + 2];
          if (!keys.has(key(ox >> 3, oy >> 3)) || c === bg) continue;
          rgba.set([img[q], img[q + 1], img[q + 2], 255], (y * w + x) * 4); n++;
        }
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (keys.has(key(tx + dx, ty + dy))) used[(ty + dy) * 64 + tx + dx] = 1;
        if (n < 12) continue;
        const d = roundedMeshData(rgba, w, h, plant ? 4 : 2, plant ? 4 : 1.5), k = plant === "tree" ? 1.4 : 1, sway = plant ? 1 : 0;
        const fx = tx * 8 + 8, fz = ty * 8 + 16;
        for (let i = 0; i < d.pos.length; i += 3) {
          pos.push(fx + d.pos[i] * k, d.pos[i + 1] * k, fz - 2 + d.pos[i + 2] * k * 0.8);
          const up = d.pos[i + 1] / h; col.push(d.col[i], d.col[i + 1], d.col[i + 2]);
          (this.swayBuf || (this.swayBuf = [])).push(up * sway);
        }
      }
    }
    // (sway goes in through aCol's companion: a second mesh program would be cleaner; the bodies are drawn without wind here)
    this.swayBuf = null;
    if (pos.length) M.bodies.push({ ...vao(sc.gl, this.B, { aPos: [new Float32Array(pos), 3], aCol: [new Float32Array(col), 3] }), n: pos.length / 3 });
  }
  plainTile(tx, ty) {                                   // a tile of one colour (plain ground): never a plant's
    const img = this.map.img, q0 = ((ty * 8) * 512 + tx * 8) * 4, c0 = img[q0] << 16 | img[q0 + 1] << 8 | img[q0 + 2]; let same = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const q = ((ty * 8 + y) * 512 + tx * 8 + x) * 4; if ((img[q] << 16 | img[q + 1] << 8 | img[q + 2]) === c0) same++; }
    return same >= 58;
  }
  // the map's picture from the game's live tiles and palettes (repainted when either changes: the tile animations, a palette swap,
  // the end of a fade)
  paint(w, force) {
    const M = this.map, v1 = w.vram[1], pal = w.bgPal;
    let th = 2166136261; for (let i = 0x0800; i < 0x1800; i += 7) th = Math.imul(th ^ v1[i], 16777619);
    let ph = 2166136261; for (let i = 0; i < 64; i++) ph = Math.imul(ph ^ pal[i], 16777619);
    // (repainted on any change, a fade's palettes too: a faded screen is the 2D picture's, and the picture comes back with the colours)
    if (!force && th === M.tileHash && ph === M.palHash) return false;
    const palChanged = ph !== M.palHash; M.tileHash = th; M.palHash = ph;
    const img = M.img;
    for (let ty = 0; ty < 64; ty++) for (let tx = 0; tx < 64; tx++) {
      const t = M.tmap[ty * 64 + tx], a = M.amap[ty * 64 + tx], base = 0x1000 + ((t << 24 >> 24) << 4), bank = a & 8 ? v1 : w.vram[0];
      for (let y = 0; y < 8; y++) {
        const row = a & 0x40 ? 7 - y : y, lo = bank[base + row * 2], hi = bank[base + row * 2 + 1];
        for (let x = 0; x < 8; x++) {
          const bit = a & 0x20 ? x : 7 - x, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1), o = (a & 7) * 8 + ci * 2, c = pal[o] | pal[o + 1] << 8, q = ((ty * 8 + y) * 512 + tx * 8 + x) * 4;
          img[q] = (c & 31) << 3; img[q + 1] = ((c >> 5) & 31) << 3; img[q + 2] = ((c >> 10) & 31) << 3; img[q + 3] = 255;
        }
      }
    }
    return palChanged ? "pal" : true;
  }
  frame(sc, game, s) {
    this.on = !s && this.active(game);
    if (!this.on) return;
    const w = game.w, id = w.wram[0][0x32E];
    this.init(sc);
    if (!this.map || this.map.id !== id || ((sc.frames & 7) === 0 && mapHash(w) !== this.map.mapHash)) this.build(sc, w, id);
    const pt = (sc.frames & 7) === 0 && this.paint(w, false);
    if (pt) updateTexture(sc.gl, this.tex, 512, 512, this.map.img);
    if (pt === "pal") { for (const b of this.map.bodies) b.free(); this.map.bodies = []; this.buildPlants(sc); }   // (the plants in the new colours)
    if (this.map.fresh !== true) { updateTexture(sc.gl, this.tex, 512, 512, this.map.img); this.map.fresh = true; }
    this.w = w;
  }
  // the people: the actors' sprites (bank 04). An actor queues its figure's sprites in a row of slots, so a run of slots whose
  // sprites touch (side by side at one height, or one above the other in a column) is one figure: a 16 x 16 frame is two 8 x 16
  // sprites, a taller one more (at most 16 x 32: two people side by side stay two). Painted as the game paints them (the flips, the
  // OBJ palette, the lower slot in front); each is [mesh, feet x, feet z, the slots].
  people(sc, w, ox, oz) {
    const t = tagsOf(w), spr = [], sh = w.lcd.lcdc & 0x04 ? 16 : 8;
    for (let i = 0; i < 40; i++) {
      const y = w.oam[i * 4] - 16, x = w.oam[i * 4 + 1] - 8;
      if (t[i] === 0x04 && y > -sh && y < 144 && x > -8 && x < 160) spr.push({ i, y, x, tile: w.oam[i * 4 + 2], attr: w.oam[i * 4 + 3] });
    }
    const groups = [];
    for (const b of spr) {
      const g = groups[groups.length - 1], last = g && g[g.length - 1];
      const touch = g && last.i === b.i - 1 && g.some(m => (m.y === b.y && Math.abs(m.x - b.x) === 8) || (m.x === b.x && Math.abs(m.y - b.y) === sh));
      const span = (k, d) => Math.max(...g.map(m => m[k]), b[k]) - Math.min(...g.map(m => m[k]), b[k]) + d;
      if (touch && span("x", 8) <= 16 && span("y", sh) <= 32) g.push(b); else groups.push([b]);
    }
    const out = [], v = w.vram, pal = w.objPal;
    for (const g of groups) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const p of g) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + 8); y1 = Math.max(y1, p.y + sh); }
      const pw = x1 - x0, ph = y1 - y0;
      const rgba = new Uint8Array(pw * ph * 4); let any = false;
      for (const p of g.sort((a, b) => a.i - b.i)) for (let r = 0; r < sh; r++) {
        const row = p.attr & 0x40 ? sh - 1 - r : r, bank = v[p.attr & 8 ? 1 : 0], o = ((sh === 16 ? p.tile & 0xFE : p.tile) << 4) + row * 2, lo = bank[o], hi = bank[o + 1];
        for (let px = 0; px < 8; px++) {
          const bit = p.attr & 0x20 ? px : 7 - px, ci = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1); if (!ci) continue;
          const q = ((p.y - y0 + r) * pw + p.x - x0 + px) * 4; if (rgba[q + 3]) continue;
          const po = (p.attr & 7) * 8 + ci * 2, c = pal[po] | pal[po + 1] << 8;
          rgba[q] = (c & 31) << 3; rgba[q + 1] = ((c >> 5) & 31) << 3; rgba[q + 2] = ((c >> 10) & 31) << 3; rgba[q + 3] = 255; any = true;
        }
      }
      if (!any) continue;
      const mesh = this.bodyMesh(sc, { rgba, w: pw, h: ph }); if (!mesh) continue;
      out.push([mesh, ox + x0 + pw / 2, oz + y1, g.map(p => p.i)]);
    }
    return out;
  }
  bodyMesh(sc, pic) {                               // (cached by picture, in this layer's own program)
    const M = this.meshes || (this.meshes = new Map()), k = picKey(pic);
    let m = M.get(k);
    if (m) { M.delete(k); M.set(k, m); return m; }
    const d = roundedMeshData(pic.rgba, pic.w, pic.h, 3, 2.6); if (!d.pos.length) return null;
    m = { ...vao(sc.gl, this.B, { aPos: [d.pos, 3], aCol: [d.col, 3] }), n: d.pos.length / 3 };
    M.set(k, m);
    if (M.size > 160) { const k0 = M.keys().next().value; M.get(k0).free(); M.delete(k0); }
    return m;
  }
  // the BG cells (32 x 32, BG map order) on screen that are not the map's tile there (a message box, a menu, a portrait): their
  // count and the share of the screen's cells they are
  overlay(w, ox, oz) {
    const l = w.lcd, v0 = w.vram[0], v1 = w.vram[1], base = l.lcdc & 0x08 ? 0x1C00 : 0x1800, T = this.map.tmap, A = this.map.amap;
    const cells = this.cells || (this.cells = new Uint8Array(1024)); cells.fill(0);
    const bx0 = l.scx >> 3, by0 = l.scy >> 3, bx1 = (l.scx + 159) >> 3, by1 = (l.scy + 143) >> 3, dx = ox - l.scx, dz = oz - l.scy;
    let n = 0, all = 0;
    for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
      const c = ((by & 31) << 5) | (bx & 31), mx = (dx + bx * 8) >> 3, my = (dz + by * 8) >> 3; all++;
      const off = (dx & 7) || (dz & 7) || mx < 0 || my < 0 || mx > 63 || my > 63;
      if (off || v0[base + c] !== T[my * 64 + mx] || (v1[base + c] & 0x6F) !== (A[my * 64 + mx] & 0x6F)) { cells[c] = 1; n++; }
    }
    return { cells, n, share: n / all };
  }
  drawOther(sc, game, frame2d, dt) {
    if (!this.on || !this.map || !this.w || this.map.picture) return false;
    const gl = sc.gl, w = this.w, c = sc.canvas, W = c.width, H = c.height, ann = this.map.ann;
    const w0 = w.wram[0], ox = Math.floor((w0[0x320] | w0[0x321] << 8) / 32), oz = Math.floor((w0[0x322] | w0[0x323] << 8) / 32);
    // a screen that is mostly not the map (a full-screen picture or menu over it, a map not drawn yet): the 2D picture
    const ov = this.overlay(w, ox, oz); this.lastOverlay = ov;
    if (ov.share > 0.55) return false;
    // a fade (to black or white, between maps and scenes): the game's own faded picture
    const fd = fadeArr(w, this); if (fd[3] > 0.02) return false;
    const cx = ox + 80, cz = oz + 70;
    sc.light.update(null, dt);
    const lk = ann.sky ? sc.light.groundK : 1;
    const eye = [cx, 118, cz + 112], at = [cx, 0, cz + 6];
    const view = m4.lookAt(eye, at, [0, 1, 0]), proj = m4.perspective(0.72 * Math.min(1, 1.11 * H / W), W / H, 12, 4000), mvp = m4.mul(proj, view);   // (near 12: the depth buffer's precision on the floor)
    sc.view = view; sc.proj = proj; sc.mvp = mvp; sc.eye = eye; sc.cam.eye = eye;
    sc.fade = fd;
    gl.viewport(0, 0, W, H); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);
    const sky = sc.light.fogCol, edge = this.map.img;
    gl.clearColor(ann.sky ? sky[0] : edge[0] / 255 * 0.5, ann.sky ? sky[1] : edge[1] / 255 * 0.5, ann.sky ? sky[2] : edge[2] / 255 * 0.5, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const P = this.P; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uMVP, false, mvp); gl.uniform1f(P.u.uTime, sc.time); gl.uniform2fv(P.u.uWind, [3, 1]);
    gl.uniform1f(P.u.uGround, sc.on("fieldlife") ? 1 : 0); gl.uniform1f(P.u.uShimmer, sc.on("fieldlife") && ann.sky ? 1 : 0); gl.uniform1f(P.u.uLightK, lk); gl.uniform4fv(P.u.uFade, fd);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(P.u.uMap, 0);
    gl.bindVertexArray(this.map.mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, this.map.mesh.n);
    const B = this.B; gl.useProgram(B.p); gl.uniformMatrix4fv(B.u.uMVP, false, mvp); gl.uniform1f(B.u.uLightK, lk); gl.uniform4fv(B.u.uFade, fd);
    gl.uniformMatrix4fv(B.u.uModel, false, m4.identity());
    for (const b of this.map.bodies) { gl.bindVertexArray(b.vao); gl.drawArrays(gl.TRIANGLES, 0, b.n); }
    for (const fx of sc.layers.fx) if (fx.drawField) fx.drawField(sc, this, dt, ann);
    // (as in the game's picture, where a sprite is over the BG, no box hides a person: an actor stands in a hedge's cell, behind a
    // counter, on a cell the terrain grid blocks; the people hide only each other)
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST); gl.useProgram(B.p);
    // the people upright on their feet (the front of the feet on the sprite's bottom line), at the game's size, leaning back a little
    // to face the camera (which looks down at ~45 degrees; upright, a person would show at 0.7 of the game's height)
    const people = this.hidePeople ? [] : this.people(sc, w, ox, oz), stood = new Set();   // (hidePeople: web/tests/story3d.mjs measures them)
    for (const [mesh, x, z, slots] of people) {
      gl.uniformMatrix4fv(B.u.uModel, false, m4.tsy(x, -2.6 * Math.sin(PEOPLE_LEAN), z - 2.6, 1, 1, 1, 0, -PEOPLE_LEAN));
      gl.bindVertexArray(mesh.vao); gl.drawArrays(gl.TRIANGLES, 0, mesh.n);
      for (const i of slots) stood.add(i);
    }
    this.lastPeople = people.length;
    gl.bindVertexArray(null);
    // the game's own picture over it: the window, the sprites not stood up, the BG cells that are not the map
    const t = tagsOf(w), keep = this.hidePeople ? i => t[i] !== 0x04 : i => !stood.has(i);
    sc.hud.drawLayer(sc, w, keep, { bg: ov.n > 0, bgCells: ov.cells });
    return true;
  }
}
const PEOPLE_LEAN = 0.32;
// a hash of the map buffers (WRAM3 tiles, WRAM2 attributes): a map script's edit rebuilds the map
function mapHash(w) { let h = 2166136261; for (const b of [w.wram[3], w.wram[2]]) for (let i = 0; i < 4096; i += 3) h = Math.imul(h ^ b[i], 16777619); return h; }
function fadeArr(w, keep) {
  const h = w.high, st = h[0x1A2], lv = h[0x1A4];
  if (st & 0x80) keep.white = true; else if (st) keep.white = false;
  let k = 0; if (st & 1) k = 1 - lv / 0x7C; else if (st & 2) k = lv / 0x7C; else if (h[0x1BC]) k = 1;
  const c = keep.white ? 1 : 0; return [c, c, c, clamp(k, 0, 1)];
}
export { mulberry32, rw };

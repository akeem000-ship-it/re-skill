// GALLERY (3D hole view, render only; adapted from Mario Tennis's stadium3d / crowdfans / courtside): at a tournament round (game mode
// 1, $C834) people line the ropes round the green and beside the tee, behind a rope on little posts; in every mode a caddie stands by
// the golfer. The people are the game's own map characters (people.js: their tiles from the ROM, read at run time), recoloured so a
// few characters make a varied crowd. They react to the play: a hop and a wave of hands when the ball lands on the green, a long
// cheer for a ball that drops (the shot's outcome), a groan (they sink) for the water. Reads the game mode and the shot's events.
import { T, CELLS } from "./hole3d.js";
import { mulberry32, texture } from "./gl.js";
import { character, personPicture, facingOffset, ownColours, tableColours } from "./people.js";

const PEOPLE = [0, 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
const SHIRTS = [[220, 60, 60], [60, 110, 220], [250, 210, 60], [60, 170, 90], [240, 240, 240], [230, 120, 40], [150, 80, 200], [40, 40, 50], [250, 150, 180], [90, 200, 220]];
const V = 32;                                       // variants in the atlas

export class Gallery {
  key = "gallery";
  holeBuilt(sc, hole) { this.built = null; this.hop = 0; this.cheer = 0; }
  atlas(sc) {
    if (this.tex) return this.tex;
    const r = mulberry32(77), img = new Uint8Array(V * 16 * 16 * 4);
    for (let v = 0; v < V; v++) {
      const ch = character(PEOPLE[v % PEOPLE.length]); if (!ch) continue;
      const base = ownColours(ch) || (ch.pal >= 4 && ch.pal < 0x20 ? tableColours(ch.pal) : [[0, 0, 0], [250, 230, 200], [200, 80, 60], [24, 24, 28]]);
      const cols = base.map(c => c.slice());
      if (v >= PEOPLE.length || r() < 0.6) cols[2] = SHIRTS[(r() * SHIRTS.length) | 0];   // a different shirt
      const p = personPicture(ch, 0, facingOffset(0), cols); if (!p) continue;
      for (let y = 0; y < 16; y++) img.set(p.rgba.subarray(y * 64, y * 64 + 64), (y * V * 16 + v * 16) * 4);
    }
    this.tex = texture(sc.gl, V * 16, 16, img);
    return this.tex;
  }
  build(sc, s) {
    const h = sc.hole, art = h.art, r = mulberry32(h.id * 31 + 5), H = h.H, spots = [];
    const [cx, cz] = s.cup, tee = sc.teeAt || [cx, cz];
    const isT = (x, z, t) => art.terrainAtPx(x, z) === t;
    // rope lines: rough cells next to the woods or the semi-rough round the green, within reach of the green or the tee
    for (let cy = 0; cy < CELLS; cy += 2) for (let cxx = 0; cxx < CELLS; cxx += 2) {
      const x = cxx * 2 + 1, z = cy * 2 + 1, t = art.terrain[cy * CELLS + cxx];
      if (t !== T.ROUGH) continue;
      const dg = Math.hypot(x - cx, z - cz), dt = Math.hypot(x - tee[0], z - tee[1]);
      if (!((dg > 26 && dg < 70) || (dt > 14 && dt < 40))) continue;
      let edge = false; for (const [dx, dz] of [[6, 0], [-6, 0], [0, 6], [0, -6]]) if (isT(x + dx, z + dz, T.OB)) edge = true;
      if (edge && r() < 0.55) spots.push([x + (r() - 0.5) * 2, z + (r() - 0.5) * 2]);
    }
    const n = Math.min(spots.length, sc.lite ? 60 : 180);
    for (let i = spots.length - 1; i > 0; i--) { const j = (r() * (i + 1)) | 0; [spots[i], spots[j]] = [spots[j], spots[i]]; }
    const inst = new Float32Array(n * 4), uv = new Float32Array(n * 4), inst2 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const [x, z] = spots[i], v = (r() * V) | 0;
      inst.set([x, H(x, z), z, 2.6 + r() * 0.5], i * 4); uv.set([v / V, 0, 1 / V, 1], i * 4); inst2.set([r(), 0, 1, 0], i * 4);
    }
    this.built = { n, inst, uv, inst2, base: inst2.slice(), posts: spots.slice(0, n) };
  }
  frame(sc, game, s) {
    if (!s) return;
    this.mode = game.w.wram[0][0x834];
    for (const [k, d] of sc.events || []) {
      if (k === "land" && d.terr === T.GREEN) this.hop = Math.max(this.hop, 2);
      if (k === "stop") { if (d.outcome === 0x80) this.cheer = 5; else if (d.outcome === 3) this.groan = 2; else if (d.outcome === 6) this.hop = Math.max(this.hop, 1.5); }
    }
  }
  draw(sc, dt) {
    const s = sc.s; if (!s) return;
    const tex = this.atlas(sc);
    // the caddie by the golfer (every mode): a step behind and to the side, with the bag
    if (sc.golferShown && !sc.puttView) {   // (not in the putting view: the golfer is only his shadow there)
      const a = sc.golferAim || 0, g = sc.golferShown, x = g[0] - Math.cos(a) * 1.5 + Math.sin(a) * 7, z = g[1] - Math.sin(a) * 1.5 - Math.cos(a) * 7;   // (to the golfer's left)
      this.cad = this.cad || { inst: new Float32Array(4), uv: new Float32Array([5 / V, 0, 1 / V, 1]), inst2: new Float32Array([0, 0, 1, 0]) };
      this.cad.inst.set([x, sc.hole.H(x, z), z, 2.6]);
      sc.drawBillboards(tex, this.cad.inst, this.cad.uv, this.cad.inst2, 1);
      const bx = x + Math.cos(a + 1.2) * 0.7, bz = z + Math.sin(a + 1.2) * 0.7, by = sc.hole.H(bx, bz);   // the bag
      for (let k = 0; k < 6; k++) sc.point(bx, by + 0.3 + k * 0.3, bz, k > 3 ? 0.85 : 0.75, k > 3 ? 0.85 : 0.2, k > 3 ? 0.9 : 0.2, 1, 0.45);
    }
    if (this.mode !== 1 && !sc.layers.galleryAlways) return;
    if (!this.built) this.build(sc, s);
    const b = this.built; if (!b.n) return;
    this.hop = Math.max(0, this.hop - dt); this.cheer = Math.max(0, (this.cheer || 0) - dt); this.groan = Math.max(0, (this.groan || 0) - dt);
    const amp = this.cheer > 0 ? 0.9 : this.hop > 0 ? 0.6 : 0.08;
    for (let i = 0; i < b.n; i++) { b.inst2[i * 4 + 1] = amp * (0.6 + b.base[i * 4] * 0.4); b.inst[i * 4 + 3] = this.groan > 0 ? 2.3 : 2.6 + (b.base[i * 4] * 0.5); }
    sc.drawBillboards(tex, b.inst, b.uv, b.inst2, b.n);
    // the rope on its posts, in front of the people
    for (let i = 0; i < b.n; i += 3) { const [x, z] = b.posts[i], y = sc.hole.H(x, z); for (let k = 0; k < 3; k++) sc.point(x + 0.8, y + 0.3 + k * 0.35, z + 0.8, 0.95, 0.95, 0.9, 1, 0.22); }
  }
}

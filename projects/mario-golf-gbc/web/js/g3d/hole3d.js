// The hole as the 3D view sees it, built at run time from the user's ROM (nothing of the game is stored in this source):
// the course view's maps (HoleAssetTable 13:4A16 refs 0 and 1, decoded as HoleLoadMaps 13:4014 / HoleLoadTiles 13:40CA do,
// through js/golf/ball.js Hole), its tiles and colours; the terrain type of every 4 x 4 cell (TerrainAt 10:6536), the slope
// cells off the green (SlopeCellAt 10:674E) and the green's slope bytes (GreenSlopeAt 10:64D1), the trees (bit 7 of a tile's
// $D700 byte, TreeCheck 08:51D2) and the putting view's maps (refs 2 and 3: the green at 4x).
// World units of the 3D view: 1 = one pixel of the course view = 32 position units (a tile is 8 px = 256 units, about 8 yards,
// so a pixel is about a yard); x across the map, z down it, y up (heights in the same units: the ball's height / 32).
// Render-only: reads the ROM (and, for the green's corner, the game's memory); writes nothing of the game.
import { asset, holeRow, rb } from "../golf/rom.js";
import { Hole } from "../golf/ball.js";

export const T = { FAIRWAY: 0, ROUGH: 1, BUNKER: 2, WATER: 3, GREEN: 6, OB: 7, SEMI: 9, BUNKER2: 0x0D, TEE: 0x0E };
export const MAP = 64, CELLS = 256, PX = 512;      // tiles, 4x4 cells per tile, pixels across the course map

// a tile's 8 x 8 colour indices from 2bpp data at off, with the attribute's flips
function tileIdx(data, off, attr, out) {
  for (let y = 0; y < 8; y++) {
    const row = attr & 0x40 ? 7 - y : y, lo = data[off + row * 2], hi = data[off + row * 2 + 1];
    for (let x = 0; x < 8; x++) { const bit = attr & 0x20 ? x : 7 - x; out[y * 8 + x] = ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1); }
  }
  return out;
}

export class HoleArt {
  constructor(hid) {
    const row = holeRow(hid);
    this.id = hid;
    this.hole = new Hole(hid);
    this.tiles = asset(row[0], 1);                 // VRAM1 $9000 (tiles 0-127) then $8800 (128-255): tile t at t * 16
    this.romPal = asset(row[0], 0, 0x40);          // BG palettes 2-6 in its first $28 bytes
    this.course = row[0][1];                       // the course's tile set bank (50: Marion / Palm, 51: Dune / Links, 52: Peach)
    const h = this.hole, cm = h.course;            // [attrs, tilemap, slope/tree byte per tile, terrain nibbles]
    this.attrs = cm[0]; this.tmap = cm[1]; this.tileByte = cm[2];
    // the terrain type and slope of every cell (4 x 4 per tile)
    this.terrain = new Uint8Array(CELLS * CELLS);
    this.slopeDir = new Int16Array(CELLS * CELLS).fill(-1);
    for (let cy = 0; cy < CELLS; cy++) for (let cx = 0; cx < CELLS; cx++) {
      const hl = (cx >> 2) << 8 | (cx & 3) << 6 | 32, de = (cy >> 2) << 8 | (cy & 3) << 6 | 32;
      this.terrain[cy * CELLS + cx] = h.terrainAt(hl, de);
      const [nz, b] = h.slopeCell(hl, de);
      if (nz) this.slopeDir[cy * CELLS + cx] = b;
    }
    // trees: map tiles whose tile byte has bit 7
    this.treeTile = new Uint8Array(MAP * MAP);
    for (let i = 0; i < MAP * MAP; i++) this.treeTile[i] = this.tileByte[this.tmap[i]] & 0x80 ? 1 : 0;
    // the putting view's maps and tiles (refs 2 / 3)
    this.green = { attrs: h.green[0], tmap: h.green[1], slope: h.green[2], terrain: h.green[3], tiles: asset(row[2], 0), romPal: asset(row[3], 0, 0x40) };
  }
  terrainAtPx(x, z) {                              // the terrain type under a course pixel
    const cx = Math.floor(x / 2), cz = Math.floor(z / 2);
    if (cx < 0 || cz < 0 || cx >= CELLS || cz >= CELLS) return T.OB;
    return this.terrain[cz * CELLS + cx];
  }
  // colour indices of the 512 x 512 course map and its palette numbers (one per tile)
  indexMap() {
    if (this._idx) return this._idx;
    const idx = new Uint8Array(PX * PX), palOf = new Uint8Array(MAP * MAP), t = new Uint8Array(64);
    for (let ty = 0; ty < MAP; ty++) for (let tx = 0; tx < MAP; tx++) {
      const i = ty * MAP + tx, a = this.attrs[i];
      tileIdx(this.tiles, this.tmap[i] * 16, a, t);
      palOf[i] = a & 7;
      for (let y = 0; y < 8; y++) idx.set(t.subarray(y * 8, y * 8 + 8), (ty * 8 + y) * PX + tx * 8);
    }
    return (this._idx = { idx, palOf });
  }
  // the course map in colours (RGBA 512 x 512) with the palette RAM pal (64 bytes, as the course view holds it)
  paint(pal) {
    const { idx, palOf } = this.indexMap(), out = new Uint8Array(PX * PX * 4);
    for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) {
      const p = palOf[(y >> 3) * MAP + (x >> 3)], ci = idx[y * PX + x], o = p * 8 + ci * 2, c = pal[o] | pal[o + 1] << 8, q = (y * PX + x) * 4;
      out[q] = (c & 31) << 3; out[q + 1] = ((c >> 5) & 31) << 3; out[q + 2] = ((c >> 10) & 31) << 3; out[q + 3] = 255;
    }
    return out;
  }
  // the palette RAM as the course view shows it, from the ROM: palettes 2-6 of the course; the others from base
  palette(base) {
    const p = new Uint8Array(64); if (base) p.set(base);
    p.set(this.romPal.subarray(0, 0x28), 0x10);
    return p;
  }
  // does a live palette RAM hold this hole's course colours (not faded)?
  isCoursePalette(pal) { for (let i = 0; i < 0x28; i++) if (pal[0x10 + i] !== this.romPal[i]) return false; return true; }
  // the putting view's picture (RGBA, 512 x 512 green pixels; 4 green px = 1 course px) with its palette RAM
  paintGreen(pal) {
    const g = this.green, out = new Uint8Array(PX * PX * 4), t = new Uint8Array(64);
    for (let ty = 0; ty < MAP; ty++) for (let tx = 0; tx < MAP; tx++) {
      const i = ty * MAP + tx, a = g.attrs[i]; tileIdx(g.tiles, g.tmap[i] * 16, a, t);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const o = (a & 7) * 8 + t[y * 8 + x] * 2, c = pal[o] | pal[o + 1] << 8, q = ((ty * 8 + y) * PX + tx * 8 + x) * 4;
        out[q] = (c & 31) << 3; out[q + 1] = ((c >> 5) & 31) << 3; out[q + 2] = ((c >> 10) & 31) << 3; out[q + 3] = 255;
      }
    }
    return out;
  }
  // the green's terrain at a green-view cell (64 x 64 tiles of 4 x 4 cells, positions x4 from the green's corner)
  greenTerrain(gx, gz) {
    const hl = (gx >> 2) << 8 | (gx & 3) << 6 | 32, de = (gz >> 2) << 8 | (gz & 3) << 6 | 32;
    const h = this.hole, keep = [h.attrs, h.tmap, h.slope, h.terrain];
    h.use(true); const t = h.terrainAt(hl, de), s = h.slopeAt(hl, de); [h.attrs, h.tmap, h.slope, h.terrain] = keep;
    return [t, s[0], s[1]];
  }
  // the green's slope per green tile, as the ball reads it while putting (views 1-3: the green maps; GreenSlopeAt 10:64D1 and its
  // caller 10:66DB, as js/golf/ball.js slope()): RGBA 64 x 64, one texel per green tile (8 green px = 2 course px from the green's
  // corner): R, G the push (downhill) direction (SlopeDirTable 10:6516 with the tile's flips) * 127.5 + 127.5; B the strength
  // ((v >> 4) & 3) * 85; A 255 where the green maps' terrain at the tile's centre is the green (the push 10:6738: 2 / 4 / 6) else
  // 0 (the push $20)
  greenSlopes() {
    if (this._gs) return this._gs;
    const h = this.hole, keep = [h.attrs, h.tmap, h.slope, h.terrain], out = new Uint8Array(MAP * MAP * 4);
    h.use(true);
    for (let ty = 0; ty < MAP; ty++) for (let tx = 0; tx < MAP; tx++) {
      const hl = tx << 8 | 0x80, de = ty << 8 | 0x80, [v, b] = h.slopeAt(hl, de), s = (v >> 4) & 3, q = (ty * MAP + tx) * 4;
      const [dx, dz] = dirVec(b);
      out[q] = Math.round(dx * 127.5 + 127.5); out[q + 1] = Math.round(dz * 127.5 + 127.5); out[q + 2] = s * 85;
      out[q + 3] = h.terrainAt(hl, de) === T.GREEN ? 255 : 0;
    }
    [h.attrs, h.tmap, h.slope, h.terrain] = keep;
    return (this._gs = out);
  }
}

// the slope direction byte (SlopeDirTable 10:6516: an angle, 256 to the turn, from +x toward +y) as a unit vector of the push
export const dirVec = b => [Math.cos(b * Math.PI / 128), Math.sin(b * Math.PI / 128)];
export { rb };

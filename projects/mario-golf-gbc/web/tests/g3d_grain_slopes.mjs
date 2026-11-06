// The 3D view's grain on the green (GRASS: Carpet, web/js/g3d/groundshader.js) leans along the slope the ball rolls on. Its data is
// hole3d.js greenSlopes(): per green tile the push direction and strength. This test checks it against the engine's own slope
// (js/golf/ball.js slope(): 10:66DB with GreenSlopeAt 10:64D1 on the putting view's maps, the ball relative to the green's corner)
// at every quarter pixel of the green view's 40 x 32 px on every hole: the same tiles sloped, the same direction (SlopeDirTable
// 10:6516 with the tile's flips), the same push (2 / 4 / 6 on the green, $20 off it). No browser.
// usage: node web/tests/g3d_grain_slopes.mjs
import fs from "fs";
import path from "path";
import { useRom } from "../js/golf/rom.js";
import { HoleArt, dirVec } from "../js/g3d/hole3d.js";
import { slope, Hole } from "../js/golf/ball.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
let n = 0, bad = 0, sloped = 0, holes = 0;
for (let hid = 1; hid < 0x6C; hid++) {
  let art; try { art = new HoleArt(hid); } catch (e) { continue; }
  holes++;
  const gs = art.greenSlopes(), hole = new Hole(hid); hole.use(true);
  const cx = 20, cy = 24;                                   // (a green corner, in tiles: the check is relative to it)
  for (let pz = 0; pz < 32; pz += 0.25) for (let px = 0; px < 40; px += 0.25) {
    const s = new Uint8Array(256), X = Math.round((cx * 8 + px) * 32), Y = Math.round((cy * 8 + pz) * 32);
    s[0x01] = X & 0xFF; s[0x02] = X >> 8; s[0x04] = Y & 0xFF; s[0x05] = Y >> 8; s[0x41] = cx; s[0x42] = cy; s[0x43] = 1;
    const [mag, b, nz] = slope(s, hole), q = (Math.floor(pz / 2) * 64 + Math.floor(px / 2)) * 4, st = gs[q + 2] / 85;
    n++;
    if (!nz) { if (st) bad++; continue; }
    sloped++;
    const [dx, dz] = dirVec(b), ex = (gs[q] - 127.5) / 127.5, ez = (gs[q + 1] - 127.5) / 127.5;
    const want = gs[q + 3] ? [0, 2, 4, 6][st] : 0x20;
    if (Math.hypot(dx - ex, dz - ez) > 0.02 || mag !== want) { bad++; if (bad < 10) console.log("mismatch", hid.toString(16), px, pz, mag, want, b); }
  }
}
console.log(`${bad ? "FAIL" : "ok  "} grain: ${n} points on ${holes} greens (${sloped} sloped), the grain's data and the ball's slope ${bad ? `differ at ${bad}` : "agree everywhere"}`);
process.exit(bad ? 1 : 0);

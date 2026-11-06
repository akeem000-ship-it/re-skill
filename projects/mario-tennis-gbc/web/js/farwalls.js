// FAR END: Walls (3D / VOX court, render only): on the courts whose far end is a wall (the castle, Mario's pipes, Wario's hangar,
// Bowser's fortress), the wall goes on up in place of the far stand, so the court is closed in by it as the picture suggests:
//   13  the castle    a second storey of the same windows over the pink band, battlements along the top, the gate's pillars
//                     rising as two round towers with pink spires, a round window over the gate
//   10  the pipes     the brick blocks stacked up to the top (the sky behind the pipes filled in), and green pipes standing up
//                     out of it, each with its rim (the lying pipe's own pixels turned upright)
//   12  the hangar    the hangar's walls and shelves on up to a ribbed roof, the doorway open to the top over the biplane, a W
//   11  Bowser        the brick walls and the stairs climbing on up to a crown of the wall's spikes turned point up
// Built at run time from the court's own backdrop (the cut's pixels, rows 0-49 of its picture): extra rows go on top of it, and
// relief shapes for them (in the picture's coordinates, rows above the picture negative) join voxel.js RELIEF. Nothing is stored.
export const FAR_WALL_MAPS = [10, 11, 12, 13];
const KEY = "mt-farend";

// the picture's pixel (x, y) of the backdrop d (w x h, rows from 0); x wraps (the backdrop repeats sideways)
const at = (d, w, x, y) => { const o = (y * w + (((x % w) + w) % w)) * 4; return [d[o], d[o + 1], d[o + 2], d[o + 3]]; };
const shade = (c, k) => [Math.min(255, c[0] * k) | 0, Math.min(255, c[1] * k) | 0, Math.min(255, c[2] * k) | 0, c[3] ?? 255];

// the extended backdrop for map m: { d, h, EX (the rows added on top), shapes (relief, picture coordinates) } or null
export function tallWall(m, d, w, h) {
  const B = BUILD[m]; if (!B || w !== 256) return null;
  const EX = B.ex, H = EX + h, out = new Uint8Array(w * H * 4);
  out.set(d, EX * w * 4);
  const put = (x, y, c) => { if (x < 0 || x >= w || y < 0 || y >= H || !c || c[3] < 128) return; const o = (y * w + x) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; out[o + 3] = 255; };
  const src = (x, y) => at(d, w, x, y);                               // the original picture
  const get = (x, y) => { const o = (y * w + (((x % w) + w) % w)) * 4; return [out[o], out[o + 1], out[o + 2], out[o + 3]]; };   // what is built so far
  const shapes = B.build({ put, src, get, w, h, EX, H });
  return { d: out, h: H, EX, shapes };
}

const BUILD = {
  // ---- the castle ----
  13: {
    ex: 78, build({ put, src, w, EX }) {
      const top = EX - 8 - 34;                                        // the new storey's top row; the pink band below it, its windows over
      for (let y = 0; y < 34; y++) for (let x = 0; x < w; x++) {       // the storey: the stone with its windows (rows 7-40), the gate span
        const sx = x >= 88 && x < 168 ? x - 80 : x;                    //  walled up with the stone beside it
        put(x, top + y, src(sx, 7 + y));
      }
      for (let y = 0; y < 8; y++) for (let x = 0; x < w; x++) put(x, top + 34 + y, src(x >= 88 && x < 168 ? x - 80 : x, y));   // the pink band
      const bt = top - 10;                                            // battlements: merlons 10 px of every 16, from the plain stone (rows 8-15)
      for (let y = 0; y < 10; y++) for (let x = 0; x < w; x++) {
        if (y < 6 && (x + 3) % 16 >= 10) continue;
        const c = src(x, 8 + ((y + 3) % 8)); put(x, bt + y, y === 0 || (y < 6 && ((x + 3) % 16 === 0 || (x + 3) % 16 === 9)) ? shade(c, 0.75) : c);
      }
      for (let y = 0; y < 3; y++) for (let x = 0; x < w; x++) put(x, bt + 6 + y, y === 0 ? shade(src(x, 9), 1.15) : src(x, 9 + y));   // the walkway's lip
      // the round window over the gate: dark glass in a pink ring, its mullions
      const cx = 128, cy = top + 17, pink = src(20, 2), glass = src(30, 24);
      for (let y = -13; y <= 13; y++) for (let x = -13; x <= 13; x++) {
        const r = Math.hypot(x, y); if (r > 12.5) continue;
        put(cx + x, cy + y, r > 10 ? (x + y > 0 ? shade(pink, 0.8) : pink) : (Math.abs(x) < 1 || Math.abs(y) < 1 || Math.abs(Math.abs(x) - Math.abs(y)) < 0.8) ? shade(pink, 0.9) : shade(glass, 1 + 0.25 * Math.max(0, -y) / 10));
      }
      // the towers: the gate's pillars (88-103, 153-168) carried on up, their spires pink cones
      const spire = 18, tTop = spire + 2;
      for (const [x0, x1] of [[87, 104], [152, 169]]) {
        const mid = (x0 + x1) / 2, half = (x1 - x0) / 2;
        for (let y = tTop; y < EX; y++) for (let x = x0; x < x1; x++) put(x, y, src(Math.min(x1 - 2, Math.max(x0 + 1, x)) + (x0 < 128 ? 1 : 1), 8 + ((y - tTop) % 24)));
        for (let y = tTop - 2; y < tTop + 1; y++) for (let x = x0 - 2; x < x1 + 2; x++) put(x, y, shade(src(96, 8), y === tTop - 2 ? 1.2 : 0.85));   // the spire's eave
        for (let y = 0; y < spire; y++) {
          const hw = (half + 3) * (y + 1) / spire;
          for (let x = Math.floor(mid - hw); x < Math.ceil(mid + hw); x++) { const u = (x + 0.5 - mid) / hw; put(x, tTop - 2 - spire + y, shade(pink, 1.1 - 0.45 * Math.max(0, u) + 0.1 * (y % 4 === 0))); }
        }
        put(Math.round(mid), tTop - 2 - spire - 1, [250, 220, 90, 255]); put(Math.round(mid), tTop - 2 - spire - 2, [250, 220, 90, 255]);   // a gold finial
      }
      const Y = y => y - EX;
      return [{ r: [0, Y(bt), 256, Y(top)], k: "box", d: 4 }, { r: [0, Y(top + 34), 256, Y(top + 42)], k: "box", d: 4.5 },
        { r: [115, Y(cy - 13), 141, Y(cy + 13)], k: "recess", d: 0.7 },
        ...[[87, 104], [152, 169]].flatMap(([a, b]) => [{ r: [a, Y(tTop), b, 0], k: "pillar", d: 10 }, { r: [a - 3, Y(0), b + 3, Y(tTop)], k: "pillar", d: 10 }])];
    },
  },
  // ---- Mario's pipes ----
  10: {
    ex: 70, build({ put, src, get, w, h, EX }) {
      const top = 24, sky = c => c[2] > c[0] + 40 && c[2] >= c[1];   // the bricks' top row; the sky behind the lying pipes
      const brick = (x, y) => src(x, 26 + (((y - top) % 22) + 22) % 22);
      for (let y = top; y < EX; y++) for (let x = 0; x < w; x++) put(x, y, y === top ? shade(brick(x, y), 0.7) : brick(x, y));
      for (let y = 0; y < 26; y++) for (let x = 0; x < w; x++) if (sky(src(x, y))) put(x, EX + y, brick(x, EX + y));   // the gap and the sky filled with bricks
      // upright pipes: the lying pipe's body across (column 10, rows 8-25) and its rim (columns 34-46, rows 7-26) turned on end
      const pipes = [[22, 6], [70, 16], [186, 16], [234, 6]], shapes = [];
      for (const [xc, t] of pipes) {
        for (let y = t + 13; y < EX + 8; y++) for (let u = 0; u < 18; u++) put(xc - 9 + u, y, src(10, 8 + u));
        for (let dy = 0; dy < 13; dy++) for (let u = 0; u < 20; u++) put(xc - 10 + u, t + dy, src(34 + dy, 7 + u));
        shapes.push({ r: [xc - 9, t + 13 - EX, xc + 9, 8], k: "pillar", d: 9 }, { r: [xc - 10, t - EX, xc + 10, t + 13 - EX], k: "pillar", d: 11 });
      }
      return [{ r: [0, top - EX, 256, 8], k: "box", d: 5 }, ...shapes];
    },
  },
  // ---- Wario's hangar ----
  12: {
    ex: 70, build({ put, src, w, EX }) {
      const roof = 22, door = [88, 168];
      for (let y = roof; y < EX; y++) for (let x = 0; x < w; x++) {      // the walls and their shelves, on up
        if (x >= door[0] && x < door[1]) continue;
        put(x, y, src(x, 2 + ((y - roof) % 22)));
      }
      const skyA = src(128, 2), skyB = src(128, 12);                  // the doorway on up: the outside, fading to the sky
      for (let y = 0; y < EX; y++) for (let x = door[0]; x < door[1]; x++) {
        const k = y / EX; put(x, y, [skyA[0] * k + 110 * (1 - k), skyA[1] * k + 170 * (1 - k), skyA[2] * k + 230 * (1 - k), 255]);
      }
      const frame = shade(src(4, 30), 0.8);                           // the door's frame and its rails
      for (let y = roof - 6; y < EX; y++) for (const x of [door[0] - 3, door[0] - 2, door[0] - 1, door[1], door[1] + 1, door[1] + 2]) put(x, y, frame);
      // the roof: ribs over each bay, the eaves along the bottom
      const beam = shade(src(4, 30), 0.6);
      for (let y = 0; y < roof; y++) for (let x = 0; x < w; x++) {
        if (x >= door[0] - 3 && x < door[1] + 3) { if (y >= roof - 6) put(x, y, frame); continue; }
        const bay = x < 128 ? (x + 0.5) / (door[0] - 3) : (x - door[1] - 3 + 0.5) / (w - door[1] - 3), arch = roof - 4 - Math.sin(Math.PI * bay) * 16;
        if (y < arch) continue;
        put(x, y, (x % 12 === 0 || y > roof - 4) ? beam : shade(src(x, 14 + (y % 6)), 0.8 - 0.25 * (roof - y) / roof));
      }
      // a W over the door, gold on purple
      const wx = 128, wy = 10;
      for (let y = -8; y <= 8; y++) for (let x = -14; x <= 14; x++) put(wx + x, wy + y, [104, 48, 140, 255]);
      const W = ["X.....X.....X", "X.....X.....X", ".X...X.X...X.", ".X...X.X...X.", "..X.X...X.X..", "..X.X...X.X..", "...X.....X..."];
      W.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === "X") { put(wx - 6 + i, wy - 4 + j, [250, 214, 60, 255]); put(wx - 6 + i + 1, wy - 4 + j, [250, 214, 60, 255]); } }));
      const Y = y => y - EX;
      return [{ r: [0, Y(roof), 256, 0], k: "box", d: 3 }, { r: [0, Y(0), 256, Y(roof)], k: "inflate", d: 8 }, { r: [door[0], Y(0), door[1], 0], k: "recess", d: 0.3 },
        { r: [door[0] - 3, Y(roof - 6), door[0], 0], k: "box", d: 5 }, { r: [door[1], Y(roof - 6), door[1] + 3, 0], k: "box", d: 5 }, { r: [wx - 14, Y(wy - 8), wx + 15, Y(wy + 9)], k: "box", d: 9 }];
    },
  },
  // ---- Bowser's fortress ----
  11: {
    ex: 64, build({ put, src, w, EX }) {
      const crown = 12;
      for (let y = crown; y < EX; y++) for (let x = 0; x < w; x++) put(x, y, src(x, ((y - crown) % 32 + 32 - (EX - crown) % 32) % 32));   // the walls, the pillars and the stairs climbing on
      for (let y = 0; y < crown; y++) for (let x = 0; x < w; x++) put(x, y, src(x, 43 - y));   // the spikes along the top, turned point up
      const Y = y => y - EX;
      return [{ r: [0, Y(0), 256, Y(crown)], k: "inflate", d: 6 }, { r: [96, Y(crown), 106, 0], k: "pillar", d: 7 }, { r: [150, Y(crown), 160, 0], k: "pillar", d: 7 },
        { r: [80, Y(crown), 96, 0], k: "inflate", d: 6 }, { r: [160, Y(crown), 176, 0], k: "inflate", d: 6 }];
    },
  },
};

// the switch: ?farend=walls|stands, else the last choice (default: walls)
export function farWallsOn() { let m = null; try { m = new URLSearchParams(location.search).get("farend") ?? localStorage.getItem(KEY); } catch (e) { m = null; } return m !== "stands"; }
export function addFarEndButton(voxel, hud) {
  voxel.farWalls = farWallsOn();
  if (!hud) return;
  const b = document.createElement("span"); b.className = "k"; b.id = "farendbtn"; b.title = "3D court: on the courts with a wall at the far end (castle, pipes, hangar, Bowser), the wall goes all the way up instead of a stand behind it";
  const show = () => { b.textContent = "FAR END: " + (voxel.farWalls ? "Walls" : "Stands"); b.classList.toggle("on", voxel.farWalls); }; show();
  b.addEventListener("pointerdown", () => { voxel.farWalls = !voxel.farWalls; try { localStorage.setItem(KEY, voxel.farWalls ? "walls" : "stands"); } catch (e) { /* private mode */ } voxel.groundHash = -1; voxel.ground = null; if (voxel.stadium) voxel.stadium.buildAt = -999; show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b);
}

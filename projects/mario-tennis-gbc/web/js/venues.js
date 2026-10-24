// VENUES (3D stadium, render only): each court's stadium in a style of its own, on top of stadium3d.js's stands (the same boxes: no new
// geometry kinds). venueFor() picks the style from the court map (the same themes as the sky, skybox.js) and, on the class courts, the
// class of the match; stadium3d.js build() takes the venue's number of rows, materials and flags and calls its hooks:
//   extras(ctx)       the venue's own buildings and decorations (ctx: the stands built, the boxes, colours, random numbers, LITE)
//   tunnel(ctx, ...)  the players' tunnel mouths (replacing the plain banner)
//   board(ctx, pos)   the scoreboard's frame (the dot-matrix screen stays; its colours: boardInk)
//   torches           floodlight towers replaced by fire torches (the lighting's lamps hang in the same places)
// The venues:
//   castle    stone stands with battlements, round corner towers with spires and flags, banners down the back walls (pink stone at court 0)
//   pipes     brick stands, a row of blocks along the top, floating ? blocks over the corners, green pipes behind, pipe tunnel mouths
//   volcano   dark stone, spiked railings, fire torches for floodlights, lava pools in the far corners, iron-gate tunnels
//   hangar    steel stands with girders, an arched hangar roof over the right stand with a biplane hanging under it, hazard-striped doors
//   jungle    wooden stands hung with vines, big trees behind with their crowns over the stands, rope bridges in the far corners, log tunnels
//   tropics   white-painted beach bleachers, palms, umbrellas along the top, bamboo tunnels
//   city      a modern bowl: the second tier (stadium3d.js GIANT) all round, glass back walls, framed tunnels
//   junior    (class courts) a park: three rows of benches, trees, a fence, lamp posts
//   senior    (class courts) a club: five rows, hedges along the top, the clubhouse with its veranda and flag behind a corner
//   varsity   (class courts) the academy's stadium: all eight rows, flags in the academy's colours, the crest banner on the far stand
// Nothing is read from the game but the court and the match class; nothing written.
export const THEME_BY_MAP = { 0: "castle", 1: "castle", 13: "castle", 2: "city", 7: "city", 3: "campus", 4: "campus", 5: "campus", 8: "campus", 6: "campus",
  9: "tropics", 14: "tropics", 10: "pipes", 11: "volcano", 12: "airfield", 15: "jungle" };
// the theme of the court on screen (the sky's): the finals by their title, else by map
export function courtTheme(v) {
  const lk = v.courtLook && v.courtLook();
  if (lk && lk.name === "final") return lk.title === "ISLAND OPEN" ? "tropics" : "city";
  return THEME_BY_MAP[v.mapId()] || "campus";
}
// the venue: the theme, and on the class courts the class (the tour's court look, else the crowd's class)
export function venueFor(st) {
  if (st.forceVenue === undefined) { try { st.forceVenue = new URLSearchParams(location.search).get("venue"); } catch (e) { st.forceVenue = null; } }
  if (st.forceVenue && VENUES[st.forceVenue]) return VENUES[st.forceVenue];                       // (?venue=castle ...: try a venue on any court)
  const v = st.v, th = courtTheme(v);
  if (th !== "campus") return VENUES[th === "airfield" ? "hangar" : th];
  const lk = v.courtLook && v.courtLook(), cls = lk && VENUES[lk.name] ? lk.name : ({ junior: "junior", senior: "senior", major: "varsity" })[st.crowdClass()] || "senior";
  return VENUES[cls];
}

const shade = (c, k) => c.map(x => Math.max(0, Math.min(255, x * k)));
const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
// shared shapes (world coordinates; B.add(x, y0, z, sx, sy, sz, rgb, jitter): a box centred on x / z, standing on y0)
function tower(ctx, x, z, r, h, wall, roof, flag) {
  const B = ctx.B;                 // a round tower: an octagon of two crossed boxes, a ring, a spire, a flag
  B.add(x, 0, z, r * 2, h, r * 1.2, wall, 0.04); B.add(x, 0, z, r * 1.2, h, r * 2, wall, 0.04); B.add(x, 0, z, r * 1.7, h, r * 1.7, shade(wall, 0.94), 0.04);
  for (let a = -1; a <= 1; a += 2) for (let k = -2; k <= 2; k++) B.add(x + k * r * 0.45, h, z + a * r * 0.92, r * 0.3, r * 0.35, r * 0.3, wall), B.add(x + a * r * 0.92, h, z + k * r * 0.45, r * 0.3, r * 0.35, r * 0.3, wall);
  const sh = r * 2.6; for (let i = 0; i < 10; i++) { const w = r * 2.1 * (1 - i / 10); B.add(x, h + r * 0.35 + i * sh / 10, z, w, sh / 10 + 1, w, i & 1 ? roof : shade(roof, 0.9)); }
  if (flag) { B.add(x, h + r * 0.35 + sh, z, 6, 160, 6, [210, 210, 220]); flagOn(ctx, x + 3, h + r * 0.35 + sh + 100, z, 80, 50, flag); }
}
function dome(B, cx, y0, cz, rx, hy, rz, cs, colA, colB, top, rnd) {   // a rounded crown of cubes (stadium3d.js garden's)
  for (let y = 0; y < hy; y += cs) {
    const t = (y + cs * 0.5) / hy, k = Math.sqrt(Math.max(0, 1 - t * t)), ax = rx * k, az = rz * k, last = y + cs >= hy;
    for (let x = -ax; x <= ax; x += cs) for (let z = -az; z <= az; z += cs) {
      if ((x * x) / (ax * ax + 1) + (z * z) / (az * az + 1) > 1) continue;
      B.add(cx + x, y0 + y, cz + z, cs * 1.05, cs * 1.05, cs * 1.05, last ? top : rnd() > 0.5 ? colA : colB, 0.1);
    }
  }
}
function tree(B, x, z, h, r, rnd, leaf = [52, 128, 56]) { B.add(x, 0, z, 22, h, 22, [100, 72, 46], 0.06); dome(B, x, h - r * 0.5, z, r, r * 1.3, r, 34, leaf, shade(leaf, 0.82), mix(leaf, [255, 255, 200], 0.25), rnd); }
function palm(B, x, z, h, lean, rnd) {                            // a palm: a leaning ringed trunk, fronds drooping all round, coconuts
  const n = 12; let px = x, py = 0; for (let i = 0; i < n; i++) { const t = i / n; B.add(px, py, z, 26 - t * 6, h / n + 2, 26 - t * 6, i & 1 ? [150, 112, 70] : [128, 94, 58], 0.05); px += lean * t * 2.2; py += h / n; }
  for (let f = 0; f < 7; f++) { const a = f / 7 * 6.283 + rnd(); for (let s = 1; s <= 5; s++) B.add(px + Math.cos(a) * s * 34, py - s * s * 4, z + Math.sin(a) * s * 34, 40, 10, 40, s & 1 ? [64, 156, 60] : [52, 134, 50], 0.1); }
  for (let c = 0; c < 3; c++) B.add(px + (c - 1) * 18, py - 24, z + 10, 18, 18, 18, [110, 76, 40]);
}
function pipe(B, x, z, h, w = 120) { const g = [46, 172, 70]; B.add(x, 0, z, w, h, w, g, 0.03); B.add(x - w * 0.25, 0, z + w * 0.51, w * 0.14, h, 4, mix(g, [255, 255, 255], 0.4)); B.add(x, h, z, w * 1.28, 60, w * 1.28, shade(g, 1.08), 0.03); B.add(x, h + 58, z, w * 0.96, 3, w * 0.96, [14, 40, 20]); }
function qblock(B, x, y, z, s = 80) { B.add(x, y, z, s, s, s, [250, 196, 40], 0.02); for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) B.add(x + dx * s * 0.36, y + s * 0.5 + dy * s * 0.36 - 5, z + s * 0.5, 9, 9, 3, [120, 70, 20]); B.add(x, y + s * 0.42, z + s * 0.5, 16, 24, 3, [255, 255, 255]); B.add(x, y + s * 0.18, z + s * 0.5, 10, 10, 3, [255, 255, 255]); }
function spikes(B, x, y, z, s, along, n, gap, col) {               // a row of spikes (stepped pyramids) along x (along = 0) or z (1)
  for (let i = 0; i < n; i++) { const o = (i - (n - 1) / 2) * gap, px = along ? x : x + o, pz = along ? z + o : z; for (let k = 0; k < 4; k++) B.add(px, y + k * s * 0.3, pz, s * (1 - k * 0.24), s * 0.3, s * (1 - k * 0.24), shade(col, 1 - k * 0.04)); }
}
function frameAround(B, x, y, z, w, h, d, t, col, jit = 0) { B.add(x - w / 2 - t / 2, y - t, z, t, h + t * 2, d, col, jit); B.add(x + w / 2 + t / 2, y - t, z, t, h + t * 2, d, col, jit); B.add(x, y + h, z, w + t * 2, t, d, col, jit); B.add(x, y - t, z, w + t * 2, t, d, col, jit); }
// a flag's cloth: waving (courtside.js draws ctx.flags every frame), else a still box; along: the way it flies ("x" or "z")
function flagOn(ctx, x, y, z, w, h, col, along = "x") { if (ctx.flags) ctx.flags.push({ x, y, z, w, h, col, along }); else ctx.B.add(x + w / 2, y, z, w, h, 4, col); }
// a lamp (courtside.js: unlit by day, glowing at night, as the floodlights come on): a box of its colour
const lamp = (ctx, x, y, z, col, sx = 22, sy = 22, sz = 22) => { if (ctx.lights) ctx.lights.push({ x, y, z, sx, sy, sz, col }); };
// the tunnel mouth in stand coordinates: T the tunnel, o0 / o1 its opening along the stand, box() the stand's box helper
const mouth = (ctx, T, o0, o1, col, t = 30, top = 40) => { ctx.box(-16, 4, o0 - t, o0, 0, T.h + top, col, 0.04); ctx.box(-16, 4, o1, o1 + t, 0, T.h + top, col, 0.04); ctx.box(-16, 4, o0 - t, o1 + t, T.h, T.h + top, col, 0.04); };

export const VENUES = {
  castle: {
    name: "castle", fans: { sets: [16, 27, 24, 29, 20, 25], own: 0.35, shirts: [[240, 120, 180], [255, 200, 220], [60, 90, 210], [250, 250, 250], [240, 200, 60]] }, rows: 8, conc: c => c === 0 ? [[214, 178, 196], [196, 160, 180]] : [[176, 176, 188], [158, 158, 172]], boardInk: ["#ffd86a", "#ff9cc8", "#f4ecd8"],
    extras(ctx) {
      const { B, stands, rnd, court } = ctx, stone = court === 0 ? [206, 168, 188] : [170, 170, 184], roof = court === 0 ? [236, 100, 160] : [70, 110, 210];
      for (const s of stands) {
        for (let vv = s.S.v0 - 20; vv < s.S.v1 + 20; vv += 76) s.box(s.outer - 40, s.outer + 6, vv, vv + 42, s.top + 14, s.top + 66, stone, 0.04);   // battlements
        for (let vv = s.S.v0 + 460; vv < s.S.v1; vv += 520) { const [x, z] = s.at(s.outer - 20, vv); ctx.B.add(x, s.top + 14, z, 12, 60, 12, [80, 60, 50]); lamp(ctx, x, s.top + 74, z, [255, 160, 60], 26, 34, 26); }   // wall torches
        for (let vv = s.S.v0 + 200, k = 0; vv < s.S.v1 - 120; vv += 520, k++) s.box(s.outer - 48, s.outer - 40, vv - 46, vv + 46, s.top - 230, s.top + 4, [[200, 40, 60], [230, 180, 40], [50, 80, 190]][k % 3]);   // banners down the back wall
      }
      for (const s of stands.filter(s => s.S.side)) { const [x, z] = s.at(s.outer, s.S.v0 - 60); tower(ctx, x, z, 120, s.top + 260, stone, roof, [230, 50, 60]); const [x2, z2] = s.at(s.outer, s.S.v1 + 40); tower(ctx, x2, z2, 100, s.top + 160, stone, roof, null); }
      const far = stands.find(s => !s.S.side); if (far) for (const sx of [-1, 1]) { const [x, z] = far.at(far.outer, sx * 1100); tower(ctx, x, z, 90, far.top + 200, stone, roof, sx < 0 ? [60, 90, 210] : [230, 200, 60]); }
    },
    tunnel(ctx, T, o0, o1) { const st = ctx.court === 0 ? [196, 156, 178] : [150, 150, 164]; mouth(ctx, T, o0, o1, st, 34, 56); for (let k = 0; k < 6; k++) ctx.box(-20, -14, o0 + 10 + k * (o1 - o0 - 20) / 5, o0 + 18 + k * (o1 - o0 - 20) / 5, T.h - 50, T.h, [70, 66, 70]); },   // a gate with the portcullis up
    board(ctx, p) { const st = [160, 160, 172]; frameAround(ctx.B, p.x, p.y - 4, p.z - 30, p.w + 40, p.h + 30, 60, 36, st, 0.04); for (let i = -4; i <= 4; i++) ctx.B.add(p.x + i * 84, p.y + p.h + 62, p.z - 30, 46, 40, 60, st, 0.04); },
  },
  pipes: {
    name: "pipes", fans: { sets: [16, 27, 29, 18], own: 0.4, shirts: [[220, 40, 40], [40, 160, 70], [40, 80, 210], [250, 200, 40], [250, 250, 250]] }, rows: 8, conc: () => [[204, 98, 50], [184, 82, 40]], boardInk: ["#ffd23a", "#ffffff", "#7cf06a"],
    extras(ctx) {
      const { B, stands, lite } = ctx;
      for (const s of stands) {
        for (let vv = s.S.v0 - 20; vv < s.S.v1 + 20; vv += 66) s.box(s.outer - 34, s.outer + 6, vv, vv + 60, s.top + 14, s.top + 74, [196, 92, 44], 0.06);   // a row of brick blocks
        for (let vv = s.S.v0 + 300; vv < s.S.v1 - 200; vv += lite ? 1400 : 700) { const [x, z] = s.at(s.outer + 160, vv); pipe(B, x, z, s.top + 120 + ((vv / 7) % 3) * 70); }
        for (let vv = s.S.v0 + 100; vv < s.S.v1; vv += 600) { const [x, z] = s.at(s.outer - 14, vv); lamp(ctx, x, s.top + 76, z, [255, 220, 120], 30, 30, 30); }   // lanterns on the blocks
      }
      for (const s of stands.filter(s => s.S.side)) for (const vv of [s.S.v0 - 40, s.S.v1 + 20]) { const [x, z] = s.at(s.outer * 0.5, vv); qblock(B, x, s.top + 220, z); }
      const far = stands.find(s => !s.S.side); if (far) for (const sx of [-1, 1]) { const [x, z] = far.at(far.outer * 0.5, sx * 1500); qblock(B, x, far.top + 240, z); qblock(B, x + sx * 90, far.top + 240, z); }
    },
    tunnel(ctx, T, o0, o1) { const g = [46, 172, 70]; mouth(ctx, T, o0, o1, g, 36, 50); ctx.box(-24, -16, o0 - 46, o1 + 46, T.h + 30, T.h + 70, shade(g, 1.1)); },
    board(ctx, p) { const b = [196, 92, 44]; frameAround(ctx.B, p.x, p.y - 4, p.z - 30, p.w + 40, p.h + 30, 60, 40, b, 0.06); qblock(ctx.B, p.x - p.w / 2 - 20, p.y + p.h + 40, p.z - 30, 70); qblock(ctx.B, p.x + p.w / 2 + 20, p.y + p.h + 40, p.z - 30, 70); },
  },
  volcano: {
    name: "volcano", fans: { sets: [19, 21, 17, 28], own: 0.45, shirts: [[40, 36, 44], [170, 30, 30], [110, 50, 150], [240, 140, 40]] }, rows: 8, conc: () => [[78, 66, 76], [64, 54, 64]], torches: true, boardInk: ["#ff7a2a", "#ffd23a", "#f0d0c0"],
    extras(ctx) {
      const { B, stands } = ctx, iron = [190, 190, 204];
      for (const s of stands) for (let vv = s.S.v0 - 10; vv < s.S.v1 + 10; vv += 64) { const [x, z] = s.at(s.outer - 16, vv); spikes(B, x, s.top + 14, z, 30, 0, 1, 0, iron); }
      for (const sx of [-1, 1]) {                                                                       // lava pools in the far corners, a crust on them
        const x = sx * 1900, z = -2150; B.add(x, 0, z, 700, 8, 560, [255, 112, 30]); B.add(x, 8, z, 640, 2, 500, [255, 190, 70]);
        for (let i = 0; i < 9; i++) B.add(x + (ctx.rnd() - 0.5) * 560, 9, z + (ctx.rnd() - 0.5) * 420, 50 + ctx.rnd() * 60, 6, 40 + ctx.rnd() * 50, [60, 30, 30]);
        B.add(x, 0, z, 760, 4, 620, [40, 30, 34]);
      }
    },
    torch(ctx, x, z) { const { B } = ctx, st = [74, 64, 74]; B.add(x, 0, z, 70, 640, 70, st, 0.04); B.add(x, 640, z, 130, 40, 130, shade(st, 1.2)); B.add(x, 680, z, 110, 30, 110, [40, 34, 40]);
      for (let k = 0; k < 4; k++) B.add(x + (k & 1 ? 18 : -14), 710 + k * 34, z + (k & 2 ? 12 : -10), 90 - k * 18, 40, 90 - k * 18, k < 2 ? [255, 120, 30] : [255, 214, 90]); },
    tunnel(ctx, T, o0, o1) { const iron = [60, 54, 62]; mouth(ctx, T, o0, o1, iron, 36, 60); for (let k = 0; k < 7; k++) ctx.box(-22, -14, o0 + k * (o1 - o0) / 6 - 4, o0 + k * (o1 - o0) / 6 + 4, T.h - 30, T.h + 30, [180, 180, 196]); },
    board(ctx, p) { const iron = [56, 50, 58]; frameAround(ctx.B, p.x, p.y - 4, p.z - 30, p.w + 40, p.h + 30, 60, 38, iron, 0.04); spikes(ctx.B, p.x, p.y + p.h + 62, p.z - 30, 34, 0, 9, 84, [190, 190, 204]); },
  },
  hangar: {
    name: "hangar", fans: { sets: [21, 17, 16, 27, 19], own: 0.3, shirts: [[250, 200, 40], [120, 60, 170], [120, 128, 140], [240, 240, 236]] }, rows: 8, conc: () => [[128, 136, 148], [108, 116, 128]], boardInk: ["#ffd23a", "#7ce0ff", "#e8ecf4"],
    extras(ctx) {
      const { B, stands } = ctx, girder = [92, 100, 112];
      for (const s of stands) for (let vv = s.S.v0; vv <= s.S.v1; vv += 320) {                      // columns and cross-bracing on the back walls
        s.box(s.outer - 44, s.outer - 30, vv - 10, vv + 10, 0, s.top + 60, girder);
        if (vv + 320 <= s.S.v1) for (let i = 0; i < 10; i++) { const t = i / 9; s.box(s.outer - 46, s.outer - 38, vv + t * 300 - 8, vv + t * 300 + 8, s.top - 300 + t * 300, s.top - 284 + t * 300, girder); s.box(s.outer - 46, s.outer - 38, vv + t * 300 - 8, vv + t * 300 + 8, s.top - t * 300, s.top + 16 - t * 300, girder); }
      }
      const R = stands.find(s => s.S.side && s.S.dir > 0);
      if (R) {                                                                                         // the hangar roof: an arch over the right stand
        const u0 = R.outer * 0.42, u1 = R.outer + 80, apex = R.top + 300, n = 12;   // (over the upper rows: the lower ones stay in view)
        for (let i = 0; i < n; i++) {
          const a0 = Math.PI * i / n, a1 = Math.PI * (i + 1) / n, um = (u0 + u1) / 2, ur = (u1 - u0) / 2;
          const ua = um - Math.cos(a0) * ur, ub = um - Math.cos(a1) * ur, ya = R.top + 40 + Math.sin(a0) * (apex - R.top - 40), yb = R.top + 40 + Math.sin(a1) * (apex - R.top - 40);
          R.box(Math.min(ua, ub), Math.max(ua, ub) + 4, R.S.v0 - 40, R.S.v1 + 40, Math.min(ya, yb), Math.max(ya, yb) + 22, i & 1 ? [150, 156, 166] : [138, 144, 154], 0.02);
        }
        for (let vv = R.S.v0 - 40; vv <= R.S.v1 + 40; vv += 400) { R.box(u0 - 10, u0 + 14, vv - 12, vv + 12, 0, R.top + 60, girder); }   // the roof's front posts
        for (let vv = R.S.v0 + 200; vv < R.S.v1; vv += 400) { const [lx, lz] = R.at((u0 + u1) / 2, vv); B.add(lx, R.top + 150, lz, 4, apex - R.top - 150, 4, [60, 60, 66]); B.add(lx, R.top + 140, lz, 50, 14, 50, [60, 62, 70]); lamp(ctx, lx, R.top + 128, lz, [255, 236, 190], 34, 12, 34); }   // hanging lamps
        const [x, z] = R.at(R.outer * 0.2, -200), y = R.top + 60, red = [210, 50, 40], yel = [250, 200, 50];          // a biplane hung under the roof
        B.add(x, y, z, 70, 70, 360, red, 0.03); B.add(x, y + 20, z - 30, 420, 12, 90, yel); B.add(x, y + 90, z - 30, 420, 12, 90, yel);
        for (const dx of [-150, 150]) B.add(x + dx, y + 30, z - 30, 8, 62, 8, [80, 60, 40]);
        B.add(x, y + 30, z + 170, 140, 10, 50, yel); B.add(x, y + 40, z + 175, 10, 60, 50, red); B.add(x, y + 10, z - 190, 14, 100, 10, [60, 60, 66]);
        for (const dz of [-120, 120]) B.add(x, y + 70, z + dz, 4, R.top + 200 - y - 70, 4, [70, 70, 76]);
      }
    },
    tunnel(ctx, T, o0, o1) { for (let k = 0; ; k++) { const a = o0 - 30 + k * 40; if (a > o1 + 30) break; ctx.box(-18, 4, a, Math.min(a + 40, o1 + 30), T.h, T.h + 44, k & 1 ? [30, 30, 34] : [250, 200, 40]); } for (const e of [o0 - 30, o1]) for (let k = 0; k * 40 < T.h; k++) ctx.box(-18, 4, e, e + 30, k * 40, k * 40 + 40, k & 1 ? [30, 30, 34] : [250, 200, 40]); },
    board(ctx, p) { const g = [92, 100, 112]; frameAround(ctx.B, p.x, p.y - 4, p.z - 30, p.w + 40, p.h + 30, 40, 20, g); for (let i = 0; i < 8; i++) { const t = i / 7; ctx.B.add(p.x - p.w / 2 - 50, p.y - 4 + t * p.h, p.z - 30, 10, 14, 40, g); ctx.B.add(p.x + p.w / 2 + 50, p.y - 4 + t * p.h, p.z - 30, 10, 14, 40, g); } },
  },
  jungle: {
    name: "jungle", fans: { sets: [15, 18, 29, 16], own: 0.4, shirts: [[60, 140, 60], [140, 96, 56], [250, 210, 60], [200, 60, 40]] }, rows: 8, conc: () => [[146, 100, 58], [126, 84, 48]], boardInk: ["#ffd23a", "#9cf06a", "#f4e4c8"],
    extras(ctx) {
      const { B, stands, rnd, lite } = ctx, vine = [58, 140, 56];
      for (const s of stands) {
        for (let vv = s.S.v0; vv < s.S.v1; vv += lite ? 90 : 46) { const len = 60 + rnd() * 220; s.box(s.outer - 46, s.outer - 40, vv, vv + 8, s.top + 14 - len, s.top + 14, vine); if (rnd() < 0.5) s.box(s.outer - 50, s.outer - 36, vv - 10, vv + 18, s.top + 14 - len, s.top + 30 - len, shade(vine, 1.2)); }
        for (let vv = s.S.v0 + 200; vv < s.S.v1; vv += lite ? 1000 : 520) { const [x, z] = s.at(s.outer + 160 + rnd() * 120, vv); tree(B, x, z, s.top + 140 + rnd() * 160, 170 + rnd() * 70, rnd, [46, 118, 48]); }
        for (let vv = s.S.v0 + 400; vv < s.S.v1; vv += 450) { const [x, z] = s.at(s.outer - 16, vv); B.add(x, s.top + 14, z, 6, 80, 6, [90, 70, 44]); lamp(ctx, x, s.top + 94, z, [255, 150, 70], 30, 36, 30); }   // lanterns
      }
      const far = stands.find(s => !s.S.side);
      for (const s of stands.filter(s => s.S.side)) {                                               // rope bridges from the side stands' far ends
        const [x0, z0] = s.at(s.outer - 20, s.S.v0), x1 = s.S.dir * 2030, z1 = far ? far.at(far.outer - 20, 0)[1] : -2400, y0 = s.top + 30, y1 = (far ? far.top : s.top) + 30, n = 16;
        for (let i = 0; i <= n; i++) { const t = i / n, sag = Math.sin(Math.PI * t) * 90, x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t - sag;
          B.add(x, y, z, 54, 8, 54, i & 1 ? [150, 110, 64] : [130, 94, 54]); B.add(x, y + 60, z, 10, 6, 10, [200, 180, 130]); if (i % 4 === 2) lamp(ctx, x, y + 70, z, [255, 140, 60], 26, 34, 26); }
      }
    },
    tunnel(ctx, T, o0, o1) { const log = [120, 82, 46]; mouth(ctx, T, o0, o1, log, 40, 50); for (let k = 0; k < 8; k++) ctx.box(-26, -10, o0 - 40 + k * (o1 - o0 + 80) / 8, o0 - 10 + k * (o1 - o0 + 80) / 8, T.h + 30, T.h + 70, [60, 146, 58]); },
    board(ctx, p) { const w = [128, 88, 50]; frameAround(ctx.B, p.x, p.y - 4, p.z - 30, p.w + 40, p.h + 30, 60, 40, w, 0.06); for (let i = 0; i < 10; i++) ctx.B.add(p.x - p.w / 2 + i * p.w / 9, p.y + p.h + 60, p.z - 30, 70, 40, 70, [60, 146, 58], 0.1); },
  },
  tropics: {
    name: "tropics", fans: { sets: [18, 15, 25, 24, 16], own: 0.3, shirts: [[40, 190, 204], [255, 128, 96], [250, 220, 60], [240, 80, 160], [80, 200, 120], [250, 250, 250]] }, rows: 8, conc: () => [[238, 238, 230], [214, 226, 230]], seats: [[40, 190, 204], [255, 128, 96]], boardInk: ["#ffe45a", "#7cf0ff", "#ffffff"],
    extras(ctx) {
      const { B, stands, rnd, lite } = ctx, cols = [[240, 70, 70], [250, 200, 50], [60, 170, 220], [250, 250, 250], [70, 200, 120]];
      for (const s of stands) {
        for (let vv = s.S.v0 + 150, k = 0; vv < s.S.v1 - 100; vv += lite ? 600 : 300, k++) {     // umbrellas along the top row
          const [x, z] = s.at(s.outer - 70, vv), y = s.top + 14, c = cols[k % cols.length];
          B.add(x, y, z, 8, 150, 8, [230, 230, 230]); for (let i = 0; i < 4; i++) B.add(x, y + 150 + i * 14, z, 170 - i * 40, 14, 170 - i * 40, i & 1 ? [255, 255, 255] : c);
        }
        for (let vv = s.S.v0 + 260; vv < s.S.v1; vv += lite ? 1100 : 560) { const [x, z] = s.at(s.outer + 120 + rnd() * 160, vv); palm(B, x, z, s.top + 160 + rnd() * 180, (rnd() - 0.5) * 30, rnd); }
      }
      for (const sx of [-1, 1]) palm(B, sx * 1800, -2050, 760, -sx * 20, rnd);
      for (const s of stands) for (let vv = s.S.v0, k = 0; vv < s.S.v1; vv += 110, k++) { const [x, z] = s.at(s.outer - 16, vv); lamp(ctx, x, s.top + 34 + Math.abs(Math.sin(vv / 330)) * -16, z, cols[k % cols.length], 14, 18, 14); }   // string lights
    },
    tunnel(ctx, T, o0, o1) { const bam = [196, 186, 90]; mouth(ctx, T, o0, o1, bam, 26, 30); for (let k = 0; k < 10; k++) ctx.box(-22, -10, o0 - 20 + k * (o1 - o0 + 40) / 10, o0 - 4 + k * (o1 - o0 + 40) / 10, T.h + 24, T.h + 46, [[240, 70, 110], [250, 200, 50], [255, 255, 255]][k % 3]); },
    board(ctx, p) { const bam = [196, 186, 90]; frameAround(ctx.B, p.x, p.y - 4, p.z - 30, p.w + 40, p.h + 30, 50, 26, bam, 0.06); },
  },
  city: {
    name: "city", fans: { sets: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 27, 28, 29], own: 0.25 }, rows: 8, giant: true, boardInk: ["#ffc24a", "#7cf0a0", "#e8ecf4"],
    extras(ctx) {
      const { stands } = ctx; for (const s of stands) for (let vv = s.S.v0; vv < s.S.v1; vv += 260) s.box(s.outer - 40, s.outer - 34, vv + 10, vv + 230, s.top - 200, s.top - 10, [120, 170, 214]);
      for (const s of stands) { const L = s.S.v1 - s.S.v0, [x, z] = s.at(s.outer - 4, (s.S.v0 + s.S.v1) / 2); lamp(ctx, x, s.top + 2, z, [80, 230, 255], s.S.side ? 8 : L, 10, s.S.side ? L : 8); lamp(ctx, x, s.top - 220, z, [255, 80, 200], s.S.side ? 8 : L, 8, s.S.side ? L : 8); }   // neon bands
    },
    tunnel(ctx, T, o0, o1) { mouth(ctx, T, o0, o1, [40, 42, 52], 24, 30); ctx.box(-20, -14, o0, o1, T.h + 6, T.h + 16, T.col); },
  },
  junior: {
    name: "junior", home: true, fans: { sets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], own: 0.15 }, rows: 3, conc: () => [[178, 150, 112], [160, 132, 98]], boardInk: ["#ffffff", "#ffe45a", "#f0f0e0"],
    extras(ctx) {
      const { B, stands, rnd, lite } = ctx, post = [120, 124, 130];
      for (const s of stands) {
        for (let vv = s.S.v0 - 20; vv <= s.S.v1 + 20; vv += 300) s.box(s.outer - 10, s.outer, vv, vv + 10, 0, s.top + 240, post);   // a tall fence: posts, rails
        s.box(s.outer - 8, s.outer - 2, s.S.v0 - 20, s.S.v1 + 20, s.top + 230, s.top + 240, post); s.box(s.outer - 8, s.outer - 2, s.S.v0 - 20, s.S.v1 + 20, s.top + 110, s.top + 116, post);
        for (let vv = s.S.v0 + 150; vv < s.S.v1; vv += lite ? 900 : 450) { const [x, z] = s.at(s.outer + 180 + rnd() * 140, vv); tree(B, x, z, 220 + rnd() * 160, 150 + rnd() * 60, rnd); }
        for (let vv = s.S.v0 + 500; vv < s.S.v1; vv += 1200) { const [x, z] = s.at(s.outer + 60, vv); B.add(x, 0, z, 12, 420, 12, [60, 64, 70]); lamp(ctx, x, 420, z, [255, 236, 180], 50, 20, 30); }
      }
    },
    board(ctx, p) { frameAround(ctx.B, p.x, p.y - 4, p.z - 30, p.w + 40, p.h + 30, 40, 24, [126, 92, 60], 0.05); },
  },
  senior: {
    name: "senior", home: true, fans: { sets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], own: 0.15, shirts: [[240, 240, 236], [40, 90, 60], [200, 60, 60], [60, 80, 160], [230, 200, 120]] }, rows: 5, conc: () => [[200, 196, 184], [184, 178, 166]], boardInk: ["#ffffff", "#ffd23a", "#d8f0d8"],
    extras(ctx) {
      const { B, stands, rnd } = ctx, hedge = [56, 128, 60];
      for (const s of stands) for (let vv = s.S.v0 - 20; vv < s.S.v1 + 20; vv += 40) s.box(s.outer - 36, s.outer + 4, vv, vv + 40, s.top + 14, s.top + 64 + rnd() * 10, rnd() > 0.5 ? hedge : shade(hedge, 0.86), 0.1);
      const L = stands.find(s => s.S.side && s.S.dir < 0); if (!L) return;
      const [x, z] = L.at(L.outer + 420, L.S.v0 + 260), w = 720, d = 520, h = 330, wall = [236, 228, 210], roof = [170, 70, 56];   // the clubhouse
      B.add(x, 0, z, w, h, d, wall, 0.02);
      for (let i = 0; i < 8; i++) B.add(x, h + i * 22, z, w + 40 - i * 40, 22, d + 40 - i * 64, i & 1 ? roof : shade(roof, 0.9));
      for (let i = 0; i < 5; i++) lamp(ctx, x - w / 2 + 90 + i * 135, 150, z + d / 2 + 2, [255, 214, 140], 70, 100, 6);   // the windows (lit at night)
      for (let i = 0; i < 4; i++) lamp(ctx, x - w / 2 + 110 + i * (w - 220) / 3, 122, z + d / 2 + 120, [255, 230, 170], 18, 18, 18);
      B.add(x, 0, z + d / 2 + 70, w, 12, 140, [150, 110, 76]); B.add(x, 140, z + d / 2 + 70, w + 20, 10, 150, [236, 228, 210]);
      for (let i = 0; i < 5; i++) B.add(x - w / 2 + 20 + i * (w - 40) / 4, 12, z + d / 2 + 130, 12, 128, 12, [236, 228, 210]);
      B.add(x + w / 2 - 60, h + 176, z, 8, 260, 8, [220, 220, 226]); flagOn(ctx, x + w / 2 - 57, h + 380, z, 90, 56, [40, 90, 60]);
      B.add(x, h - 80, z + d / 2 + 4, 90, 90, 8, [250, 250, 244]); B.add(x, h - 40, z + d / 2 + 9, 6, 30, 2, [30, 30, 30]);   // the clock
    },
    board(ctx, p) { frameAround(ctx.B, p.x, p.y - 4, p.z - 30, p.w + 40, p.h + 30, 50, 30, [40, 96, 60], 0.04); },
  },
  varsity: {
    name: "varsity", home: true, fans: { sets: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], own: 0.15, shirts: [[40, 80, 190], [240, 190, 40], [240, 240, 236], [40, 80, 190], [30, 40, 90]] }, rows: 8, boardInk: ["#ffc24a", "#7cc8ff", "#e8ecf4"],
    extras(ctx) {
      const { B, stands } = ctx, blue = [40, 80, 190], gold = [240, 190, 40];
      for (const s of stands) for (let vv = s.S.v0 + 100, k = 0; vv < s.S.v1; vv += 380, k++) { const [x, z] = s.at(s.outer - 16, vv); B.add(x, s.top + 14, z, 8, 240, 8, [220, 220, 226]); flagOn(ctx, x + 3, s.top + 180, z, 80, 54, k & 1 ? gold : blue); }
      const far = stands.find(s => !s.S.side); if (far) { far.box(far.outer - 50, far.outer - 40, -500, 500, far.top - 260, far.top - 20, blue); far.box(far.outer - 54, far.outer - 46, -160, 160, far.top - 220, far.top - 60, gold); }
    },
  },
};

// ---- SEASONS (by the date; SEASON: Auto / Off, remembered; ?season=halloween|winter|spring tries one) ----
//   halloween   10 Oct - 2 Nov: pumpkins along the boards (their faces lit at night), orange and purple bunting, bats at dusk
//   winter      December to 6 January: snow on the stands, coloured lights along their tops, lit trees in the far corners, snowfall
//   spring      20 March - April: blossom trees round the stadium and petals on the air
const SEASON_KEY = "mt-season";
export function seasonSetting() { try { const q = new URLSearchParams(location.search).get("season"); if (q) return q; return localStorage.getItem(SEASON_KEY) || "auto"; } catch (e) { return "auto"; } }
export function setSeasonSetting(s) { try { localStorage.setItem(SEASON_KEY, s); } catch (e) { /* private mode */ } }
export function seasonNow(d = new Date()) {
  const set = seasonSetting(); if (set === "off") return null; if (SEASONS[set]) return set;
  const m = d.getMonth() + 1, day = d.getDate();
  if ((m === 10 && day >= 10) || (m === 11 && day <= 2)) return "halloween";
  if (m === 12 || (m === 1 && day <= 6)) return "winter";
  if ((m === 3 && day >= 20) || m === 4) return "spring";
  return null;
}
export const SEASONS = {
  halloween: {
    particles: ["bat"],
    extras(ctx) {
      const { B, stands } = ctx, orange = [236, 120, 30], purple = [120, 50, 160];
      for (const s of stands) {
        for (let vv = s.S.v0 + 180; vv < s.S.v1 - 60; vv += 420) {                                  // pumpkins on the boards
          const [x, z] = s.at(-30, vv), y = 92, n = s.S.side ? [-s.S.dir, 0] : [0, 1];
          B.add(x, y, z, 54, 40, 54, orange, 0.06); B.add(x, y + 4, z, 62, 30, 40, shade(orange, 0.9)); B.add(x, y + 4, z, 40, 30, 62, shade(orange, 0.9)); B.add(x, y + 40, z, 8, 14, 8, [70, 110, 40]);
          lamp(ctx, x + n[0] * 28, y + 16, z + n[1] * 28, [255, 170, 40], n[0] ? 4 : 24, 10, n[0] ? 24 : 4);
        }
        for (let vv = s.S.v0, k = 0; vv < s.S.v1; vv += 60, k++) s.box(s.outer - 48, s.outer - 42, vv, vv + 34, s.top - 30, s.top + 4, k & 1 ? purple : orange);   // bunting
      }
    },
  },
  winter: {
    particles: ["snow"],
    extras(ctx) {
      const { B, stands } = ctx, snow = [244, 248, 255], cols = [[255, 60, 60], [60, 220, 90], [255, 210, 50], [80, 140, 255]];
      for (const s of stands) {
        s.box(s.outer - 40, s.outer + 6, s.S.v0 - 30, s.S.v1 + 30, s.top + 14, s.top + 30, snow, 0.04);                       // snow on the tops
        s.box(-10, 0, s.S.v0, s.S.v1, 92, 100, snow, 0.04);                                                                   // and on the boards
        for (let vv = s.S.v0, k = 0; vv < s.S.v1; vv += 90, k++) { const [x, z] = s.at(s.outer - 18, vv); lamp(ctx, x, s.top + 34, z, cols[k % 4], 14, 16, 14); }
      }
      for (const sx of [-1, 1]) {                                                                                             // the trees in the far corners
        const x = sx * 1760, z = -1900; B.add(x, 0, z, 40, 120, 40, [100, 70, 40]);
        for (let i = 0; i < 9; i++) { const w = 380 - i * 38; B.add(x, 100 + i * 64, z, w, 70, w, i & 1 ? [40, 120, 60] : [30, 100, 50], 0.06); if (i < 8) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) lamp(ctx, x + dx * w / 2, 130 + i * 64, z + dz * w / 2, cols[(i + dx + dz + 4) % 4], 16, 16, 16); }
        lamp(ctx, x, 700, z, [255, 230, 90], 50, 50, 50);
      }
    },
  },
  spring: {
    particles: ["petal"],
    extras(ctx) {
      const { B, stands, rnd } = ctx;
      for (const s of stands) for (let vv = s.S.v0 + 300; vv < s.S.v1; vv += 700) { const [x, z] = s.at(s.outer + 200 + rnd() * 100, vv); B.add(x, 0, z, 24, s.top + 120, 24, [90, 60, 50]); dome(B, x, s.top + 60, z, 190, 230, 190, 34, [250, 190, 214], [240, 160, 196], [255, 230, 240], rnd); }
    },
  },
};

// ---- HOME COURT (the class courts in the tour): the venue is upgraded as you win the tour's ranking matches (your won-rank flags,
// wGameFlags $C9C0: the junior, senior and varsity ladders, singles and doubles): 2 wins a row more on every stand and the academy's
// flags, 5 a roof over the far stand, 8 a big screen on it showing the score ----
const RANK_FLAGS = [80, 81, 82, 83, 84, 85, 86, 87, 88, 64, 65, 66, 68, 69, 70, 72];
export function homeLevel(w) { let n = 0; for (const f of RANK_FLAGS) if (w[0x9C0 + (f >> 3)] & (0x80 >> (f & 7))) n++; return n >= 8 ? 3 : n >= 5 ? 2 : n >= 2 ? 1 : 0; }
export function homeUpgrades(ctx, up) {
  const { B, stands } = ctx, far = stands.find(s => !s.S.side), blue = [40, 80, 190], gold = [240, 190, 40];
  if (up >= 1) for (const s of stands) for (let vv = s.S.v0 + 300, k = 0; vv < s.S.v1; vv += 600, k++) { const [x, z] = s.at(s.outer - 16, vv); B.add(x, s.top + 14, z, 8, 260, 8, [220, 220, 226]); flagOn(ctx, x + 3, s.top + 200, z, 90, 56, k & 1 ? gold : blue); }
  if (up >= 2 && far) {                                                                                                        // the far stand's roof
    for (let vv = far.S.v0; vv <= far.S.v1; vv += 500) far.box(far.outer - 40, far.outer - 16, vv - 12, vv + 12, 0, far.top + 260, [200, 204, 214]);
    for (let k = 0; k < 6; k++) { const u0 = far.outer - k * 110; far.box(u0 - 120, u0, far.S.v0 - 40, far.S.v1 + 40, far.top + 260 - k * 14, far.top + 280 - k * 14, k & 1 ? [214, 218, 226] : [196, 200, 210], 0.02); }
  }
  if (up >= 3 && far && ctx.screens) {                                                                                       // the big screen on top
    const [x, z] = far.at(far.outer - 60, 0), y = far.top + 300; B.add(x, far.top + 280, z - 20, 60, 40, 60, [70, 72, 82]); B.add(x, y, z, 860, 300, 30, [30, 32, 40]);
    ctx.screens.push({ x, y: y + 20, z: z + 18, w: 800, h: 260 });
  }
}

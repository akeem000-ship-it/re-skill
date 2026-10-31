// COURT concepts (3D / VOX court, render only): the court surface repainted as one of five looks that step up with the tour, for trying
// out ideas (?court=junior|senior|varsity|open|final; voxel.courtConcept). The court LINES stay the game's own (copied as they are, a
// little weathered on the junior court, dusted with clay on the senior one); everything else of the floor is the concept's:
//   junior   a public park court: faded green acrylic, sun-bleached, cracks, resurfaced patches, leaves blown to the fences
//   senior   a club clay court: terracotta, drag-mat lines across the court, slide marks at the baselines, dusted lines
//   varsity  the academy's hard court: royal blue inside, green outside, the academy name painted behind each baseline
//   open     the Island Open's grass: crisp mowing stripes across the court, worn brown at the baselines, a dark surround
//   final    the championship (dream matches): deep navy inside, purple outside, a gold trim, a gloss with floodlight glints,
//            stars painted behind the baselines
// Nothing here comes from the ROM; the decals are drawn with the canvas at run time.
const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const hash = (x, y, s = 0) => { let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 2246822519)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const smooth = t => t * t * (3 - 2 * t);
const vnoise = (x, y, s) => { const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi); const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s); return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
const fbm = (x, y, s) => vnoise(x, y, s) * 0.6 + vnoise(x * 2.1, y * 2.1, s + 1) * 0.3 + vnoise(x * 4.3, y * 4.3, s + 2) * 0.1;

export const COURT_CONCEPTS = ["junior", "senior", "varsity", "open", "final"];
const LOOK = {
  junior:  { inC: [104, 146, 98],  outC: [126, 134, 116], lineFade: 0.28 },
  senior:  { inC: [200, 100, 60],  outC: [186, 92, 56],   lineDust: 0.22 },
  varsity: { inC: [46, 96, 176],   outC: [40, 126, 92] },
  open:    { inC: [96, 170, 72],   outC: [70, 128, 56] },
  final:   { inC: [28, 56, 132],   outC: [74, 44, 124] },
};

// decals: text and shapes drawn on a canvas the size of the ground texture (W x H texels); returns its RGBA (alpha = coverage)
function decals(name, W, H, tx, ty, box, title) {
  if (typeof document === "undefined") return null;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const g = cv.getContext("2d");
  const cx = tx(0), far = ty(box.y0 - 150), near = ty(box.y1 + 150), wTex = (box.x1 - box.x0) / 6;
  const label = (text, y, flip, px, colour) => { g.save(); g.translate(cx, y); if (flip) g.rotate(Math.PI); g.font = `bold ${px}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = colour; g.fillText(text, 0, 0, wTex * 0.6); g.restore(); };
  const star = (x, y, r, colour) => { g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, rr = k & 1 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); g.fillStyle = colour; g.fill(); };
  if (name === "varsity") { label("ROYAL ACADEMY", near, false, 26, "#ffffff"); label("ROYAL ACADEMY", far, true, 26, "#ffffff"); }
  else if (name === "final") {
    const t = title || "STAR CUP"; label(t, near, false, 30, "#f4c84a"); label(t, far, true, 30, "#f4c84a");   // (the text is kept within the middle half)
    for (const s of [-1, 1]) { star(cx - wTex * 0.42, s > 0 ? near : far, 13, "#f4c84a"); star(cx + wTex * 0.42, s > 0 ? near : far, 13, "#f4c84a"); }
  } else if (name === "open") { label("ISLAND OPEN", near, false, 24, "rgba(235,245,220,0.9)"); label("ISLAND OPEN", far, true, 24, "rgba(235,245,220,0.9)"); }
  else return null;
  return g.getImageData(0, 0, W, H).data;
}

// rgba: the painted ground (W x H x 4), already with the game's colours / courtfloor.js; src / idx / lut / L as in courtfloor.js paintFloor
// (L: the line colours); world: { x0, y0, texel }
// opts.title: the name painted behind the baselines (final: STAR CUP unless given)
export function paintConcept(rgba, src, idx, lut, L, W, H, world, name, opts = {}) {
  const look = LOOK[name]; if (!look) return;
  const N = W * H, isLine = new Uint8Array(N);
  for (let i = 0; i < N; i++) isLine[i] = L[idx[src[i]]];
  // the court's outer lines: the bounding box of the line texels near the middle (doubles sidelines and baselines)
  let bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    if (!isLine[j * W + i]) continue; const X = world.x0 + i * world.texel, Y = world.y0 + j * world.texel;
    if (Math.abs(X) > 900 || Math.abs(Y) > 1500) continue;
    bx0 = Math.min(bx0, X); bx1 = Math.max(bx1, X); by0 = Math.min(by0, Y); by1 = Math.max(by1, Y);
  }
  if (bx0 > bx1) { bx0 = -576; bx1 = 576; by0 = -1248; by1 = 1248; }
  const box = { x0: bx0, x1: bx1, y0: by0, y1: by1 }, tx = X => (X - world.x0) / world.texel, ty = Y => (Y - world.y0) / world.texel;
  const dec = decals(name, W, H, tx, ty, box, opts.title);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const o = j * W + i, p = o * 4, X = world.x0 + i * world.texel, Y = world.y0 + j * world.texel;
    const inside = X > bx0 && X < bx1 && Y > by0 && Y < by1, ay = Math.abs(Y), nearBase = Math.max(0, 1 - Math.abs(ay - by1) / 160);
    if (isLine[o]) {                                       // the lines: the game's, weathered or dusted on the lower tiers
      let r = rgba[p], g = rgba[p + 1], b = rgba[p + 2];
      if (look.lineFade) { const f = look.lineFade * smooth(clamp((fbm(X / 90, Y / 90, 3) - 0.35) * 2.5, 0, 1)); r += (look.inC[0] - r) * f; g += (look.inC[1] - g) * f; b += (look.inC[2] - b) * f; }
      if (look.lineDust) { const f = look.lineDust * (0.4 + 0.6 * fbm(X / 40, Y / 40, 4)); r += (look.inC[0] - r) * f; g += (look.inC[1] - g) * f; b += (look.inC[2] - b) * f; }
      rgba[p] = r; rgba[p + 1] = g; rgba[p + 2] = b; continue;
    }
    let [r, g, b] = inside ? look.inC : look.outC, m = 1;
    const grain = hash(i, j, 1) - 0.5;
    if (name === "junior") {
      m = 1 + grain * 0.08 + (fbm(X / 300, Y / 300, 5) - 0.5) * 0.22;                                           // sun-bleached unevenly
      const patch = fbm(X / 220 + 9, Y / 220, 6) > 0.68; if (patch) { r *= 1.08; g *= 1.06; b *= 1.04; }          // resurfaced patches
      const crack = (Math.abs(fbm(X / 160, Y / 160, 7) - 0.5) < 0.006 || Math.abs(fbm(X / 110 + 3, Y / 260, 8) - 0.5) < 0.004) && fbm(X / 400, Y / 400, 11) > 0.58;
      if (crack) m *= 0.7;                                                                                        // a few cracks, in places
      const edge = Math.min(Math.abs(Math.abs(X) - 1500), Math.abs(ay - 2000)), leaf = edge < 220 && hash(i >> 1, j >> 1, 9) > 0.93;
      if (leaf) { const t = hash(i, j, 10); r = 150 + 60 * t; g = 100 + 30 * t; b = 40; m = 1; }
    } else if (name === "senior") {
      m = 1 + grain * 0.12 + (fbm(X / 26, Y / 26, 5) - 0.5) * 0.16;                                             // the clay's granules
      m *= 1 + 0.05 * Math.sin(Y / 9 + fbm(X / 200, Y / 200, 6) * 6);                                           // drag-mat lines across
      const slide = nearBase * (fbm(X / 70, Y / 22, 7) > 0.55 ? 1 : 0); if (slide) { r *= 0.9; g *= 0.86; b *= 0.84; }   // slide marks
      if (!inside) m *= 0.97;
    } else if (name === "varsity") {
      m = 1 + grain * 0.05 + (fbm(X / 40, Y / 40, 5) - 0.5) * 0.06 + 0.05 * Math.sin(X / 500 + Y / 700);         // acrylic grain and sheen
      if (inside) { const wear = nearBase * smooth(clamp((fbm(X / 50, Y / 30, 6) - 0.45) * 2, 0, 1)) * 0.12; m *= 1 - wear; }
    } else if (name === "open") {
      const band = (by1 - by0) / 12, k = Math.floor((Y - by0) / band), f = (Y - by0) / band - k;
      const stripe = (k & 1 ? 1 : -1) * Math.min(1, Math.min(f, 1 - f) * 10);
      m = 1 + stripe * 0.07 + grain * 0.1 + (vnoise(X / 8, Y / 24, 5) - 0.5) * 0.12;                             // stripes, blades
      if (inside) {
        const wear = nearBase * smooth(clamp((fbm(X / 60, Y / 26, 6) - 0.3) * 2.2, 0, 1)) * (Math.abs(X) < 260 ? 1 : 0.4);
        r += (150 - r) * wear * 0.8; g += (128 - g) * wear * 0.8; b += (70 - b) * wear * 0.8;                       // worn to the soil
      }
    } else if (name === "final") {
      m = 1 + grain * 0.04 + 0.1 * Math.sin((X + Y) / 520);                                                     // a diagonal gloss
      for (const [lx, ly] of [[-1600, -2100], [1600, -2100], [-1600, 2100], [1600, 2100]]) {                     // the floodlights' glints
        const d = Math.hypot((X - lx * 0.45) / 300, (Y - ly * 0.45) / 520); if (d < 1) m += 0.22 * (1 - d) * (1 - d);
      }
      const trim = !inside && Math.max(Math.abs(X) - bx1, ay - by1) < 24 && Math.max(Math.abs(X) - bx1, ay - by1) > 12;
      if (trim) { r = 236; g = 190; b = 70; m = 1; }                                                             // gold trim round the court
    }
    r *= m; g *= m; b *= m;
    if (dec && dec[p + 3]) { const a = dec[p + 3] / 255; r += (dec[p] - r) * a; g += (dec[p + 1] - g) * a; b += (dec[p + 2] - b) * a; }
    rgba[p] = clamp(r, 0, 255); rgba[p + 1] = clamp(g, 0, 255); rgba[p + 2] = clamp(b, 0, 255); rgba[p + 3] = 255;
  }
}

// the HUD button "COURT: Tour / Game" (remembered, mt-courtlook): the tour's classes on courts of their own (voxel.js courtLook), or
// the game's courts everywhere but the finals
export function addCourtButton(voxel, hud) {
  let m = null; try { m = new URLSearchParams(location.search).get("courtlook") ?? localStorage.getItem("mt-courtlook"); } catch (e) { m = null; }
  voxel.courtTour = m !== "game";
  if (!hud) return;
  const b = document.createElement("span"); b.className = "k"; b.id = "courtbtn"; b.title = "3D court: each tour class on a court of its own (park, club clay, academy), or the game's courts";
  const show = () => { b.textContent = "COURT: " + (voxel.courtTour ? "Tour" : "Game"); b.classList.toggle("on", voxel.courtTour); }; show();
  b.addEventListener("pointerdown", () => { voxel.courtTour = !voxel.courtTour; try { localStorage.setItem("mt-courtlook", voxel.courtTour ? "tour" : "game"); } catch (e) { /* private mode */ } show(); });
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(b);
}

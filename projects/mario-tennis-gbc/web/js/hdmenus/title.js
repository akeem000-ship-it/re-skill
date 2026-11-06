// HD painters, agent B: the title screen (this file) and the menu marquee (b_marquee.js). Loaded by hdui.js (HDMENU_MODULES).
// The other screens of this group (main menu, Create / Pick a Character, name entry) are drawn by the shared painters: the
// panels by hdui_frames.js, the text by hdtext.js / data.js, the cursors by hdui_cursors.js.
//
// TITLE SCREEN. The logo, the checkered bar and the (c) line are the game's own pixels (read from the BG-only picture at
// run time) smoothed up 4x with Scale2x; "2D-HD" is added under the logo in the logo's colours (Luckiest Guy: yellow to
// orange fill, dark green outline, red shadow, sparkles) and "PRESS START" replaces the START sprites on the bar (the view
// leaves them out: scr.hide), with the same glint sweeping across it that the original's letters have. The bar moves down
// to make room for 2D-HD. The whole screen is claimed (the other painters would take logo tiles for box pieces). In a view
// that cannot leave sprites out (scr.canHide false: START stays) the bar stays and 2D-HD goes under it. Purely visual: nothing here touches
// the game's state; the screen is recognised by the content of a few logo tiles (hashes), not by any game variable.
import { registerHDPainter, HD } from "../hdui.js";
import { sigHits, smooth4, makeCanvas, useFont, sparkle } from "./b_common.js";
import "./b_marquee.js";

const FONT = "MT Luckiest Guy";
// tiles of the logo (hashes of their colour indices at fixed screen points; see sigHits)
const LOGO = [[20, 20, "3a2df153"], [60, 24, "847037c7"], [100, 40, "2ee97ec9"], [130, 30, "b3a7e81d"], [40, 56, "bf70c43a"], [80, 64, "10cddfdc"], [120, 60, "d82c442b"]];
export const isTitle = scr => sigHits(scr, "bg", LOGO) >= 5;

// the START sprites: a row of 8x16 sprites, one per 8 pixels, on the bar (10 of them in the original)
const BAR_SPR = { x0: 36, x1: 124, y0: 86, y1: 106 };
const startSprites = scr => scr.oam.filter(o => o.y >= 80 && o.y <= 100 && o.x >= 30 && o.x < 130);
// where the glint is on the original START (x of the glint-coloured sprite pixels, 36..124), or -1. The glint is the
// letters' orange (R high, G ~80, B low) against the letters' red; the few static pixels of that colour spread over
// the letters, so the glint is the busiest column
function glintAt(gb) {
  const p = gb.ppu, f = p.frame, b = p.bgFrame, col = new Uint8Array(160);
  for (let y = BAR_SPR.y0; y < BAR_SPR.y1; y++) for (let x = BAR_SPR.x0; x < BAR_SPR.x1; x++) {
    const i = y * 160 + x, a = f[i]; if (a === b[i]) continue;
    const r = a & 255, g = a >> 8 & 255, bl = a >> 16 & 255;
    if (r > 200 && g > 50 && g < 120 && bl < 60) col[x]++;
  }
  let best = 0, bx = -1; for (let x = BAR_SPR.x0 + 2; x < BAR_SPR.x1 - 2; x++) { const s = col[x - 2] + col[x - 1] + col[x] + col[x + 1] + col[x + 2]; if (s > best) { best = s; bx = x; } }
  if (best < 14) return -1;
  let sw = 0, sx = 0; for (let x = bx - 4; x <= bx + 4; x++) { sw += col[x]; sx += col[x] * x; }
  return sx / sw;
}
// ---- painting ---------------------------------------------------------------------------------------------------------
const SHIFT = 14;                                         // the bar moves down by this much (screen px)
function rows(px) {                                       // blocks of rows that are not all background: [{y0, y1}]
  const bgc = px[2], out = []; let cur = null, gap = 0;
  for (let y = 0; y < 144; y++) {
    let n = 0; for (let x = 0; x < 160; x++) if (px[y * 160 + x] !== bgc) n++;
    if (n) { if (!cur) out.push(cur = { y0: y, y1: y + 1 }); cur.y1 = y + 1; gap = 0; } else if (cur && ++gap >= 3) cur = null;
  }
  return out;
}
// whiteness of the fade (the original fades the title in and out through white): the darkest pixel of the logo
function fade(px, y0, y1) {
  let d = 255; for (let i = y0 * 160; i < y1 * 160; i++) { const a = px[i], m = Math.max(a & 255, a >> 8 & 255, a >> 16 & 255); if (m < d) d = m; }
  return Math.min(1, d / 248);
}

function outlined(g, text, x, y, o) {                    // text with an outline, a shadow and a fill (gradient or colour)
  g.save(); g.font = `${o.size}px "${FONT}"`; g.textBaseline = "alphabetic"; g.lineJoin = "round"; g.miterLimit = 2; g.textAlign = "center";
  if (o.shadow) { g.lineWidth = o.outline * 2; g.strokeStyle = o.shadow; g.strokeText(text, x + o.dx, y + o.dy); g.fillStyle = o.shadow; g.fillText(text, x + o.dx, y + o.dy); }
  g.lineWidth = o.outline * 2; g.strokeStyle = o.stroke; g.strokeText(text, x, y);
  g.fillStyle = o.fill; g.fillText(text, x, y); g.restore();
}

// The title screen is ours alone: the built-in frame finder and the other painters would take its logo tiles for box
// pieces, so it is claimed whole (scr.claim when the layer offers it; otherwise the snapshot's cell lists are emptied, which
// makes every later painter skip this screen)
function claim(scr) {
  if (scr.claim) { scr.claim(0, 0, 160, 144); return; }
  scr.cells.bg.length = 0; scr.cells.win.length = 0;
}

let cache = { key: null, S: null, LY: null };
function paintTitle(g, scr, layer) {
  if (layer !== "bg" || !isTitle(scr)) return;
  try { paintTitleArt(g, scr, layer); } catch (e) { if (!paintTitle.warned) { paintTitle.warned = true; console.warn("HD title", e); } g.clearRect(0, 0, 160, 144); claim(scr); }   // never leave half a title: the game's own picture
}
function paintTitleArt(g, scr, layer) {
  const font = useFont(FONT, "LuckiestGuy-Regular.ttf", registerTitle);
  const px = scr.px32, blocks = rows(px);
  if (!blocks.length) return;
  const logo = blocks[0], bgc = px[2], w = fade(px, logo.y0, logo.y1), alpha = 1 - w;
  const bar = blocks.find(b => b.y0 >= logo.y1 + 3 && b.y0 < 100 && b.y1 - b.y0 >= 12 && b.y1 - b.y0 <= 20) || { y0: 88, y1: 104 };   // mid-fade it can be all but white
  const css = a => `rgb(${a & 255},${a >> 8 & 255},${a >> 16 & 255})`;
  // the START sprites go (the view leaves them out) when it can; then the bar moves down and PRESS START / 2D-HD take over
  const spr = startSprites(scr), moved = font && scr.canHide && (!spr.length || scr.hide(spr, g, layer));
  const shift = moved ? SHIFT : 0;
  // 1. the picture smoothed. Plain background more than a pixel away from anything is left transparent, so the 3D views'
  // backdrop and shadows show there; next to the art it is opaque (it must cover the original's stair-steps)
  // (kept while the tiles and palettes stay the same: the glint changes sprites only)
  if (cache.key !== scr.key) {
    const near = new Uint8Array(160 * 144);
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) if (px[y * 160 + x] !== bgc) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < 160 && yy < 144) near[yy * 160 + xx] = 1; }
    cache = { key: scr.key, S: smooth4(px, 0, 0, 160, 144, i => !near[i]), LY: null, LYdone: false };
  }
  const S = cache.S;
  g.drawImage(S, 0, 0, 160, 144);
  // 2. the bar: its rows moved down, the place of the START sprites filled with the bar's own pattern
  const b0 = bar.y0, b1 = bar.y1, bh = b1 - b0;
  if (moved) {
    g.fillStyle = css(bgc); g.fillRect(0, b0 - 1, 160, bh + 2);
    g.drawImage(S, 0, b0 * 4, 640, bh * 4, 0, b0 + shift, 160, bh);
    for (let x = 32; x < 128; x += 8) g.drawImage(S, 8 * 4, b0 * 4, 8 * 4, bh * 4, x, b0 + shift, 8, bh);   // a clean 8-pixel column, repeated
  }
  claim(scr);
  if (!font) return;
  // 3. 2D-HD under the logo, in the logo's colours (drawn on a layer of its own, which fades with the picture)
  if (alpha < 0.02) return;
  const cx = 80, base = moved ? logo.y1 + 14.5 : bar.y1 + 17.5, LY = cache.LY || (cache.LY = makeCanvas(640, 576)), l = LY.getContext("2d");
  if (!cache.LYdone || cache.LYbase !== base) {
    l.setTransform(HD, 0, 0, HD, 0, 0); l.clearRect(0, 0, 160, 144);
    const grad = l.createLinearGradient(0, base - 13, 0, base + 1); grad.addColorStop(0, "rgb(255,238,70)"); grad.addColorStop(0.55, "rgb(255,190,30)"); grad.addColorStop(1, "rgb(255,140,15)");
    outlined(l, "2D-HD", cx, base, { size: 18, outline: 1.35, stroke: "rgb(18,86,28)", fill: grad, shadow: "rgb(205,32,36)", dx: 1.2, dy: 1.5 });
    sparkle(l, cx - 31, base - 12, 3.6); sparkle(l, cx + 32, base - 5, 2.8); sparkle(l, cx + 25, base - 14.5, 2);
    cache.LYdone = true; cache.LYbase = base;
  }
  // (the layer with 2D-HD is kept with the smoothed picture; PRESS START is drawn on a copy, as the glint moves)
  const L2 = makeCanvas(640, 576), l2 = L2.getContext("2d"); l2.drawImage(LY, 0, 0);
  // 4. PRESS START on the bar (while the original's START is shown), the glint sweeping across it
  if (moved && spr.length >= 6) {
    const gl = glintAt(scr.gb), by = b0 + shift + bh / 2 + 4.6, tw = 90, tx = cx - tw / 2, th = 14;
    const T = makeCanvas(Math.ceil((tw + 8) * HD), Math.ceil((th + 8) * HD)), t = T.getContext("2d");
    t.setTransform(HD, 0, 0, HD, (4 - tx) * HD, (th + 4 - by) * HD);
    // outline + shadow first, then the fill on a layer of its own so the glint lies on the letters only
    outlined(t, "PRESS START", cx, by, { size: 14, outline: 1.1, stroke: "rgb(255,255,255)", fill: "rgb(255,255,255)", shadow: "rgb(70,86,130)", dx: 0.8, dy: 1.1 });
    const F = makeCanvas(T.width, T.height), f = F.getContext("2d"); f.setTransform(HD, 0, 0, HD, (4 - tx) * HD, (th + 4 - by) * HD);
    const fill = f.createLinearGradient(0, by - 11, 0, by + 1); fill.addColorStop(0, "rgb(255,74,54)"); fill.addColorStop(1, "rgb(210,12,22)");
    f.font = `14px "${FONT}"`; f.textAlign = "center"; f.fillStyle = fill; f.fillText("PRESS START", cx, by);
    if (gl >= 0) {                                         // glint: a slanted orange band over the letters
      const gx = tx + 4 + (gl - BAR_SPR.x0) / (BAR_SPR.x1 - BAR_SPR.x0) * (tw - 8);
      f.globalCompositeOperation = "source-atop";
      const gg = f.createLinearGradient(gx - 7, 0, gx + 7, 0); gg.addColorStop(0, "rgba(255,170,30,0)"); gg.addColorStop(0.5, "rgba(255,176,40,1)"); gg.addColorStop(1, "rgba(255,170,30,0)");
      f.fillStyle = gg; f.beginPath(); f.moveTo(gx - 4, by - 14); f.lineTo(gx + 10, by - 14); f.lineTo(gx + 4, by + 3); f.lineTo(gx - 10, by + 3); f.closePath(); f.fill();
    }
    t.setTransform(1, 0, 0, 1, 0, 0); t.drawImage(F, 0, 0);
    l2.setTransform(HD, 0, 0, HD, 0, 0); l2.drawImage(T, tx - 4, by - th - 4, tw + 8, th + 8);
  }
  g.save(); g.globalAlpha = alpha; g.drawImage(L2, 0, 0, 160, 144); g.restore();
}

export function registerTitle() { registerHDPainter("title", paintTitle, { order: -30 }); }
registerTitle();

// HD UI, built-in art: the game's boxes (menu panels, dialogue boxes, windows). The ROM draws every box from the same
// nine tile shapes: a 1 px outline, a 1 px inner line and the fill, with rounded corners. They are found by SHAPE (a
// pattern of three colour indices a/b/c, bound at run time to whatever colours the tile uses, so every palette and
// fade works), grouped into panels, and each panel is painted again as a rounded bevel panel (hdui.js panelFrame) with
// the original's text / icons / portraits cut back out of its fill. Nothing from the ROM is stored here.
import { registerHDPainter, panelFrame, panelShadow, punchInk, markOpaque, shade, roundRect, HD } from "./hdui.js";

const flipX = p => p.map(r => [...r].reverse().join("")), flipY = p => [...p].reverse();
const rep = (r, n) => Array(n).fill(r);
// family "box": menu panels (1 px outline a, 1 px line b, fill c); symmetric, rounded corners
const BTL = ["aaaaaaaa", "aabbbbbb", "abbccccc", ...rep("abcccccc", 5)], BT = ["aaaaaaaa", "bbbbbbbb", ...rep("cccccccc", 6)], BL_ = rep("abcccccc", 8);
// family "talk": dialogue boxes (a, b, a, b, then the fill c; the bottom / right edge one step thicker)
const DTL = ["aaaaaaaa", "aabcbbbb", "abbaaaaa", "ababbbbb", ...rep("ababcccc", 4)], DT = ["aaaaaaaa", "bbbbbbbb", "aaaaaaaa", "bbbbbbbb", ...rep("cccccccc", 4)];
const DTR = ["aaaaaaaa", "bbbbbaaa", "aaaabbaa", "bbbbabaa", ...rep("ccccabaa", 4)], DL = rep("ababcccc", 8), DR = rep("ccccabaa", 8);
const DBL = [...rep("ababcccc", 4), "abbaaaaa", "aabbbbbb", "aaaaaaaa", "aaaaaaaa"], DB = [...rep("cccccccc", 4), "aaaaaaaa", "bbbbbbbb", "aaaaaaaa", "aaaaaaaa"];
const DBR = [...rep("ccccabaa", 3), "cccbabaa", "aaaabbaa", "bbbbbaaa", "aaaaaaaa", "aaaaaaaa"];
const FAMILIES = {
  box: { ring: 2, rimW: 1, borderW: 1, radius: 2.4, patterns: { TL: BTL, T: BT, TR: flipX(BTL), L: BL_, R: flipX(BL_), BL: flipY(BTL), B: flipY(BT), BR: flipY(flipX(BTL)) } },
  talk: { ring: 4, rimW: 1.2, borderW: 2.1, radius: 3, patterns: { TL: DTL, T: DT, TR: DTR, L: DL, R: DR, BL: DBL, B: DB, BR: DBR } },
};
const ROLES = ["TL", "T", "TR", "L", "R", "BL", "B", "BR"];

// the colour indices a, b, c if the tile's rows fit the pattern ({a, b, c} or null). a and b must match exactly (they are
// the outline and the inner line) and so must the fill c, unless `weak` (an edge tile of a box one tile tall carries text on its
// fill: then c is only the main colour of the c places, or unknown).
function bind(rows, pat, weak = false) {
  let a = -1, b = -1; const cv = [0, 0, 0, 0]; let cn = 0;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const v = rows[y].charCodeAt(x) - 48, ch = pat[y][x];
    if (ch === "a") { if (a < 0) a = v; else if (a !== v) return null; }
    else if (ch === "b") { if (b < 0) b = v; else if (b !== v) return null; }
    else { cv[v]++; cn++; }
  }
  if (a === b) return null;
  let c = -1, best = 0; for (let v = 0; v < 4; v++) if (v !== a && v !== b && cv[v] > best) { best = cv[v]; c = v; }
  if (c >= 0 && best === cn) return { a, b, c };
  return weak && c >= 0 && best >= cn * 0.3 ? { a, b, c } : weak ? { a, b, c: -1 } : null;
}
export function frameRole(cell) {
  if (cell._fr !== undefined) return cell._fr;
  let out = null; const rows = cell.rows;
  if (!cell.blank) for (const fam in FAMILIES) {
    for (const role of ROLES) { const b = bind(rows, FAMILIES[fam].patterns[role]); if (b) { out = { fam, role, ...b, style: fam + cell.colors[b.a].css + cell.colors[b.b].css }; break; } }
    if (out) break;
  }
  return cell._fr = out;
}

// an edge tile with text or an icon on its fill (a box one tile tall): only its outline and line match; it counts when it sits in a
// run of edge tiles of the same style (findPanels)
function weakRole(cell) {
  if (cell._wr !== undefined) return cell._wr;
  let out = null; const rows = cell.rows;
  if (!cell.blank) for (const fam in FAMILIES) {
    for (const role of ["T", "B", "L", "R"]) { const b = bind(rows, FAMILIES[fam].patterns[role], true); if (b) { out = { fam, role, ...b, style: fam + cell.colors[b.a].css + cell.colors[b.b].css }; break; } }
    if (out) break;
  }
  return cell._wr = out;
}
const H_NEXT = { TL: "T TR", T: "T TR", BL: "B BR", B: "B BR" };    // what may stand right of a tile (same row)
const V_NEXT = { TL: "L BL", L: "L BL", TR: "R BR", R: "R BR" };    // what may stand below a tile (same column)

// panels of one layer: [{x, y, w, h, style, a, b, c (css colours), corners: {tl, tr, br, bl}, cells}]
export function findPanels(scr, layer) {
  const cells = scr.cells[layer], at = new Map(), fr = [];
  for (const cl of cells) { if (scr.claims.length && scr.claimed(cl.x, cl.y, 8, 8)) continue; const f = frameRole(cl); if (f) { cl._f = f; at.set(cl.x + "," + cl.y, cl); fr.push(cl); } }
  if (!fr.length) return [];
  for (let pass = 0; pass < 3; pass++) {            // weak edge tiles next to accepted ones of the same style
    let added = false;
    for (const cl of cells) {
      if (cl._f || (scr.claims.length && scr.claimed(cl.x, cl.y, 8, 8))) continue;
      const w = weakRole(cl); if (!w) continue;
      const nb = (w.role === "T" || w.role === "B") ? [at.get((cl.x - 8) + "," + cl.y), at.get((cl.x + 8) + "," + cl.y)] : [at.get(cl.x + "," + (cl.y - 8)), at.get(cl.x + "," + (cl.y + 8))];
      if (nb.some(n => n && n._f.style === w.style && (n._f.role === w.role || n._f.role[n._f.role.length - 1] === w.role || n._f.role[0] === w.role))) { cl._f = w; at.set(cl.x + "," + cl.y, cl); fr.push(cl); added = true; }
    }
    if (!added) break;
  }
  const parent = new Map(fr.map(c => [c, c])), find = c => { while (parent.get(c) !== c) { parent.set(c, parent.get(parent.get(c))); c = parent.get(c); } return c; };
  const join = (u, v) => { if (v && v._f.style === u._f.style && (u._f.role in H_NEXT || u._f.role in V_NEXT)) parent.set(find(v), find(u)); };
  for (const u of fr) {
    const h = H_NEXT[u._f.role], v = V_NEXT[u._f.role];
    if (h) { const r = at.get((u.x + 8) + "," + u.y); if (r && h.split(" ").includes(r._f.role)) join(u, r); }
    if (v) { const d = at.get(u.x + "," + (u.y + 8)); if (d && v.split(" ").includes(d._f.role)) join(u, d); }
  }
  const groups = new Map(); for (const c of fr) { const k = find(c); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
  const out = [];
  for (const list of groups.values()) {
    const has = {}; for (const c of list) has[c._f.role] = true;
    // at least a corner or two opposite edges: a lone strip of T tiles is a ruler, not a panel
    const top = has.TL || has.T || has.TR, bot = has.BL || has.B || has.BR, lef = has.TL || has.L || has.BL, rig = has.TR || has.R || has.BR;
    if (list.length < 4) continue;                    // a stray tile or two (a panel mid-scroll) is not a panel
    if (!((top && bot) || (lef && rig) || (top && (lef || rig)) || (bot && (lef || rig)))) continue;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const c of list) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x + 8); y1 = Math.max(y1, c.y + 8); }
    // a side that is not drawn must lie off screen (the panel is cut by the screen's edge there); a drawn side needs its corners
    if ((!lef && x0 > 0) || (!rig && x1 < 160) || (!top && y0 > 0) || (!bot && y1 < 144)) continue;
    if ((top && lef && !has.TL) || (top && rig && !has.TR) || (bot && lef && !has.BL) || (bot && rig && !has.BR)) continue;
    const OPEN = 24;                                  // a side not on screen: the panel goes on past the edge
    if (!lef) x0 -= OPEN; if (!rig) x1 += OPEN; if (!top) y0 -= OPEN; if (!bot) y1 += OPEN;
    const f = list.find(c => c._f.c >= 0); if (!f) continue;                  // no tile shows the fill colour
    const cl = f.colors, ff = f._f;
    out.push({ layer, fam: f._f.fam, x: x0, y: y0, w: x1 - x0, h: y1 - y0, outline: cl[ff.a], line: cl[ff.b], fill: cl[ff.c], corners: { tl: !!has.TL, tr: !!has.TR, br: !!has.BR, bl: !!has.BL }, cells: list, open: { l: !lef, r: !rig, t: !top, b: !bot } });
  }
  return out;
}

// pixels in the old frame's ring that are neither its outline, line nor fill colour (a tab or label drawn over the edge) stay
function punchRing(g, scr, p, ring) {
  const px = scr.px32, tm = scr.textMask, ok = [p.outline, p.line, p.fill].map(c => (0xFF000000 | c.b << 16 | c.g << 8 | c.r) >>> 0);
  const x0 = Math.max(0, p.x | 0), y0 = Math.max(0, p.y | 0), x1 = Math.min(160, Math.ceil(p.x + p.w)), y1 = Math.min(144, Math.ceil(p.y + p.h));
  let any = false; g.save(); g.globalCompositeOperation = "destination-out"; g.fillStyle = "#000"; g.beginPath();
  for (let y = y0; y < y1; y++) {
    const edgeRow = y < p.y + ring || y >= p.y + p.h - ring;
    for (let x = x0; x < x1; x++) {
      if (!edgeRow && x >= p.x + ring && x < p.x + p.w - ring) { x = Math.max(x, Math.min(x1, Math.ceil(p.x + p.w - ring)) - 1); continue; }
      const c = px[y * 160 + x]; if (c === ok[0] || c === ok[1] || c === ok[2] || tm[y * 160 + x]) continue;
      g.rect(x, y, 1, 1); any = true;
    }
  }
  if (any) g.fill(); g.restore();
}
const isDark = c => c.r + c.g + c.b < 120;
function paintPanels(g, scr, layer) {
  const panels = findPanels(scr, layer); scr.panels = (scr.panels || []).filter(p => p.layer !== layer).concat(panels);
  if (!panels.length) return;
  const contains = (p, q) => p !== q && q.x >= p.x && q.y >= p.y && q.x + q.w <= p.x + p.w && q.y + q.h <= p.y + p.h;
  for (const p of panels) p.depth = panels.filter(o => contains(o, p)).length;
  panels.sort((a, b) => a.depth - b.depth || a.y - b.y || a.x - b.x);
  for (const p of panels) {
    const F = FAMILIES[p.fam], fill = p.fill.css, ring = F.ring;
    const rim = p.fam === "box" ? (isDark(p.outline) ? shade(fill, 0.5) : p.outline.css) : p.outline.css, border = p.line.css;
    const R = F.radius, rad = [p.corners.tl ? R : 0, p.corners.tr ? R : 0, p.corners.br ? R : 0, p.corners.bl ? R : 0];
    panelFrame(g, p.x, p.y, p.w, p.h, { fill, rim, border, radius: rad, rimW: F.rimW, borderW: F.borderW, sheen: p.fam === "box" ? 0.22 : 0.12 });
    // the original's non-fill pixels (text, icons, portraits, pictures) back on top of the HD fill; the squares at the
    // corners belong to the old rounded corner
    const ex = [], C = ring + 1;
    if (p.corners.tl) ex.push([p.x + ring, p.y + ring, C, C]); if (p.corners.tr) ex.push([p.x + p.w - ring - C, p.y + ring, C, C]);
    if (p.corners.bl) ex.push([p.x + ring, p.y + p.h - ring - C, C, C]); if (p.corners.br) ex.push([p.x + p.w - ring - C, p.y + p.h - ring - C, C, C]);
    punchInk(g, scr, p.x + ring, p.y + ring, p.w - 2 * ring, p.h - 2 * ring, p.fill, 12, ex);
    punchRing(g, scr, p, ring);
    markOpaque(scr, p.x + ring, p.y + ring, p.w - 2 * ring, p.h - 2 * ring, p.fill);
  }
}

registerHDPainter("frames", paintPanels, { order: 0 });
void HD; void panelShadow; void roundRect;

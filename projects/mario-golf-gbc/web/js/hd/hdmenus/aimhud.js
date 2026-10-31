// HD UI: the golf HUD (bank 12) while aiming and in the shot: its labels and numbers (the hole, the yards and par, the wind's
// speed, the distance left, the club, the shot type and the club's distance) redrawn as clean text with the HUD's own outline and
// colours, and its icon sprites (the wind arrow, the golfers' faces, the lie, the target marker) smoothed to 4x. What a sprite or a
// window cell shows as text is known from the HUD's own glyph drawing (hudtext.js): only tiles that show exactly what the HUD drew are
// replaced, so a blinking or hidden panel stays as the game shows it.
import { registerHDPainter } from "../hdui.js";
import { hudGlyphs } from "../hudtext.js";
import { drawSmooth } from "../hdui_cursors.js";

const hasTask = (scr, bank, addr) => { const t = scr.gb.mem.wram[0]; for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === bank && (t[p + 1] | t[p + 2] << 8) === addr) return true; return false; };
const hudOn = scr => hasTask(scr, 0x12, 0x449F);       // HudTask 12:449F

// glyph items at screen places -> words: [{text, x, y, w, h}]
function words(items) {
  const seen = new Set(), list = [];
  for (const it of items) { const k = it.name + "," + it.x + "," + it.y; if (!seen.has(k)) { seen.add(k); list.push(it); } }
  list.sort((a, b) => a.y - b.y || a.x - b.x);
  const out = [];
  for (const it of list) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.y - it.y) <= 1 && it.x >= last.x + last.w - 1 && it.x - (last.x + last.w) <= 4) {
      last.text += (it.x - (last.x + last.w) >= 3 ? " " : "") + it.name; last.w = it.x + it.w - last.x; last.h = Math.max(last.h, it.h); continue;
    }
    out.push({ text: it.name, x: it.x, y: it.y, w: it.w, h: it.h });
  }
  return out;
}
// the glyphs' fill and outline: the lightest and the darkest of colours 1-3 (the HUD's palettes differ in their order)
const lum = c => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;
const inkOf = cols => { const s = [cols[1], cols[2], cols[3]].sort((a, b) => lum(b) - lum(a)); return [s[0].css, s[2].css]; };
// a word in the HUD's look: the fill colour with the outline colour round it, filling the glyphs' box
export function drawHudWord(g, scr, word, fill, outline) {
  const em = word.h * 1.32, fam = scr.font ? `"${scr.font.family}"` : "system-ui, sans-serif";
  g.save();
  g.font = `bold ${em}px ${fam}`; g.textBaseline = "alphabetic";
  const m = g.measureText(word.text), tw = m.width || 1, sx = Math.max(0.55, Math.min(1.15, (word.w + 0.5) / tw));
  g.translate(word.x - 0.2, word.y + word.h - 0.6); g.scale(sx, 1);
  g.lineJoin = "round"; g.lineWidth = 2.1 / sx; g.strokeStyle = outline; g.strokeText(word.text, 0, 0);
  g.fillStyle = fill; g.fillText(word.text, 0, 0);
  g.restore();
}

// the HUD's text sprites (replaced) and icon sprites (smoothed)
function paintHudSprites(g, scr) {
  if (!scr.canHide || !hudOn(scr)) return;
  const vram = scr.gb.mem.vram, text = [], items = [], icons = [];
  for (const s of scr.oam) {
    if (!(s.attr & 8)) continue;                         // (the HUD's tiles are in VRAM bank 1)
    const bank = vram[1]; let known = true, any = false; const mine = [];
    if (!(s.attr & 0x60)) for (let hh = 0; hh < s.h / 8; hh++) {
      const list = hudGlyphs(bank, ((s.tile + hh) & 0xFF) << 4);
      if (list === undefined) { known = false; break; }
      for (const [name, x, y, w, h] of list) { if (name[0] === "~") continue; any = true; mine.push({ name, x: s.x + x, y: s.y + hh * 8 + y, w, h }); }
    } else known = false;
    if (known && any) { text.push(s); items.push(...mine.map(m => ({ ...m, s }))); }
    else if (s.tile >= 0x3A && s.tile < 0x78) icons.push(s);
  }
  if (text.length && scr.hide(text)) {
    for (const wd of words(items)) {
      const s = items.find(it => it.x <= wd.x + 1 && it.y === wd.y).s, c = s.colors;
      drawHudWord(g, scr, wd, ...inkOf(c));
    }
  }
  if (icons.length && scr.hide(icons)) {
    // icons that touch are one picture (a face is two sprites): smoothed together
    const groups = [];
    for (const s of icons) {
      const near = groups.filter(gr => gr.some(o => Math.abs(o.x - s.x) <= 8 && Math.abs(o.y - s.y) <= s.h));
      const merged = [s]; for (const gr of near) { merged.push(...gr); groups.splice(groups.indexOf(gr), 1); } groups.push(merged);
    }
    for (const gr of groups) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const s of gr) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x + 8); y1 = Math.max(y1, s.y + s.h); }
      const w = x1 - x0, h = y1 - y0, grid = new Uint32Array(w * h);
      for (const s of [...gr].sort((a, b) => b.i - a.i)) { const rg = s.rgba; for (let y = 0; y < s.h; y++) for (let x = 0; x < 8; x++) if (rg[y * 8 + x]) grid[(s.y + y - y0) * w + s.x + x - x0] = rg[y * 8 + x]; }
      drawSmooth(g, grid, w, h, x0, y0);
    }
  }
}
registerHDPainter("golf-hud-sprites", paintHudSprites, { order: 15, sprites: true });

// the shot panel in the window (the club, the shot type, the club's distance): its cells' text redrawn on the panel's ground
function paintHudWindow(g, scr, layer) {
  if (!hudOn(scr)) return;
  const items = [];
  for (const c of scr.cells[layer]) {
    if (c.attr & 0x60) continue;
    const bank = scr.gb.mem.vram[c.attr & 8 ? 1 : 0], addr = scr.regs.lcdc & 0x10 ? c.tile << 4 : 0x1000 + ((c.tile << 24 >> 24) << 4);
    const list = hudGlyphs(bank, addr);
    if (!list || !list.length || list.some(([n]) => n[0] === "~")) continue;
    const col = c.colors;
    g.fillStyle = col[0].css; g.fillRect(c.x, c.y, 8, 8);
    for (const [name, x, y, w, h] of list) items.push({ name, x: c.x + x, y: c.y + y, w, h, col });
  }
  for (const wd of words(items)) {
    const it = items.find(i => i.x <= wd.x + 1 && Math.abs(i.y - wd.y) <= 1);
    // (clipped to the cells it lies on: a glyph's box can reach into a neighbour cell the panel did not repaint)
    drawHudWord(g, scr, wd, ...inkOf(it.col));
  }
}
registerHDPainter("golf-hud-window", paintHudWindow, { order: 30 });

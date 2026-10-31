// HD UI, Golf: screens with a font of their own. The scorecard and the standings (bank 0E: ShowScorecard and its pages; their
// frame tasks 0E:6D47 strokes, 0E:76F5 match play, 0E:725F two players, 0E:5348 standings) write their words and numbers into the
// map as tile numbers that ARE the characters (putString / ScorecardDigitTileTable 0E:454A: tile '7' shows a 7), over a font of
// their own loaded at those tiles. While one of those tasks runs, such cells are redrawn as HD text in the card's colours: the
// cell's ground (its commonest colour) and the glyph's light fill and dark outline.
import { registerHDPainter } from "../hdui.js";
import { drawHudWord } from "./aimhud.js";

const CARD_TASKS = [0x6D47, 0x76F5, 0x725F, 0x5348];
const cardOn = scr => { const t = scr.gb.mem.wram[0]; for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === 0x0E && CARD_TASKS.includes(t[p + 1] | t[p + 2] << 8)) return true; return false; };
const lum = c => c.r * 0.3 + c.g * 0.59 + c.b * 0.11;

function paintCard(g, scr, layer) {
  if (!scr.font || layer !== "bg" || !cardOn(scr)) return;
  const rows = new Map();
  for (const c of scr.cells.bg) {
    if (c.attr & 0x68 || c.tile < 0x21 || c.tile > 0x7E || c.blank) continue;    // (VRAM bank 0, no flips: the card's font)
    const ch = String.fromCharCode(c.tile);
    if (!/[0-9A-Za-z+\-.]/.test(ch)) continue;
    const r = rows.get(c.y) || rows.set(c.y, []).get(c.y);
    r.push({ c, ch });
  }
  const css = v => `rgb(${v & 255},${v >> 8 & 255},${v >> 16 & 255})`;
  for (const list of rows.values()) {
    list.sort((a, b) => a.c.x - b.c.x);
    const words = [];
    for (const it of list) { const wd = words[words.length - 1]; if (wd && it.c.x === wd.x + wd.w) { wd.text += it.ch; wd.w += 8; wd.cells.push(it.c); } else words.push({ text: it.ch, x: it.c.x, y: it.c.y, w: 8, cells: [it.c] }); }
    for (const wd of words) {
      // the ground: the commonest colour just left and right of the word (the card's cell); the ink: the glyphs' other colours
      const n = new Map();
      for (let y = wd.y + 1; y < wd.y + 7; y++) for (const x of [wd.x - 3, wd.x - 2, wd.x - 1, wd.x + wd.w, wd.x + wd.w + 1, wd.x + wd.w + 2]) {
        if (x < 0 || x >= 160 || y < 0 || y >= 144) continue; const v = scr.px(x, y); n.set(v, (n.get(v) || 0) + 1);
      }
      let ground = null, best = 0; for (const [v, k] of n) if (k > best) { best = k; ground = v; }
      const c0 = wd.cells[0], ci = c0.ci, used = new Set(ci), gi = [0, 1, 2, 3].find(i => used.has(i) && ((c0.colors[i].r | c0.colors[i].g << 8 | c0.colors[i].b << 16) === (ground & 0xFFFFFF)));
      const ink = [...used].filter(i => i !== gi).map(i => c0.colors[i]).sort((a, b) => lum(b) - lum(a));
      if (ground === null || !ink.length) continue;
      g.fillStyle = css(ground); g.fillRect(wd.x, wd.y, wd.w, 8);
      drawHudWord(g, scr, { text: wd.text, x: wd.x + 0.5, y: wd.y + 0.5, w: wd.w - 1, h: 7 }, ink[0].css, ink[ink.length - 1].css);
    }
  }
}
registerHDPainter("golf-card-text", paintCard, { order: 40 });

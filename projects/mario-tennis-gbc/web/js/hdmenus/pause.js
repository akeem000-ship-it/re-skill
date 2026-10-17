// HD painters for agent C: pause menus, rules / briefing panels, results and ranking screens.
// The panels of these screens (boxes of the pause menu, rules, briefings, match stats ...) are painted by the built-in
// frames painter (web/js/hdui_frames.js); their text is read and redrawn by web/js/hdtext.js (the game's proportional
// font) and by agent D's painter (the 8x8 menu font). What is specific to these screens lives here.
import { registerHDPainter } from "../hdui.js";

// ---- text that is not (all) in the proportional font -----------------------------------------------------------------------
// The text layer reads lines glyph by glyph in the game's proportional font. Pages lettered in another font (the match
// stats list: "SERVICE ACES", "LOB SHOTS" ...) give it pieces of words by accident ("RVIC", "AC", "OTS"), and redrawing
// those garbles the page. A line that is a piece of a longer inked run (its ink goes on in the column right before or
// after it) is no line: it is taken out of the list, so the page's own pixels stay, or the menu-font reader (agent D)
// reads the whole row instead.
registerHDPainter("pause-fragments", (g, scr, layer) => {
  const lines = scr.lines; if (!lines || !lines.length) return;
  const px = scr.px32;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]; if ((l.win ? "win" : "bg") !== layer) continue;
    const c = l.c[2], ink = (0xFF000000 | ((c >> 10 & 31) << 19) | ((c >> 5 & 31) << 11) | ((c & 31) << 3)) >>> 0;     // the text colour as the frame holds it
    const inked = x => {
      if (x < 0 || x >= 160) return false;
      for (let y = Math.max(0, l.y); y < Math.min(144, l.y + 8); y++) if (px[y * 160 + x] === ink) return true;
      return false;
    };
    if (!inked(l.x - 1) && !inked(l.x + l.w)) continue;
    lines.splice(i, 1);
    for (let y = Math.max(0, l.y); y < Math.min(144, l.y + 8); y++) scr.textMask.fill(0, y * 160 + Math.max(0, l.x), y * 160 + Math.min(160, l.x + l.w + 1));
  }
}, { order: -20 });

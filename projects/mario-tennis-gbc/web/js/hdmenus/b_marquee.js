// The title banner of a menu ("CREATE A CHARACTER", "MAIN MENU", ...) is a row of 8x16 sprites standing on the dark dotted band
// at the top of the screen. The view leaves them out (scr.hide) and they are drawn again here as one picture, smoothed up 4x
// (Scale2x twice) with a soft drop shadow. Their colours come from the sprites themselves. The panels, the text and the
// smoothing of everything else on these screens belong to the shared painters (hdui_frames.js, hdmenus/data.js, pause.js).
import { registerHDPainter } from "../hdui.js";
import { spriteStrips, drawSmoothSprites } from "./b_common.js";

registerHDPainter("b-marquee", (g, scr, layer) => {
  if (layer !== "bg" || !scr.canHide) return;
  const strips = spriteStrips(scr.oam, 6, s => s.y <= 2 && s.y > -16 && s.h === 16);
  for (const st of strips) { if (!scr.hide(st, g, layer)) return; drawSmoothSprites(g, st); }
}, { order: 80 });

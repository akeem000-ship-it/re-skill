// The player's own match sprite on a small card: cheering (match sheet groups 23-25, the fist pump) or dejected (groups 26-28),
// coloured by the look like the game shows it. Used where the player's win / lose face was shown (the drill result pop-up, the
// results screen with UI: HD). Drawn from the running ROM (the look's patches included); nothing is stored.
import { off } from "./build.js";
import { charGfx } from "./mods.js";
import { decodeColMajor } from "./gfx.js";

export const POSE_FRAMES = { win: [115, 120, 125, 120], lose: [130, 135, 140, 135] };   // view 0 of each group, as an animation loop
export const POSE_STILL = { win: 125, lose: 140 };
const c15 = v => `rgb(${(v & 31) << 3},${((v >> 5) & 31) << 3},${((v >> 10) & 31) << 3})`;

export const heroChar = hero => (hero === "girl" ? 1 : 0);   // the look's heroes: boy (Alex, roster 0), girl (Nina, roster 1)
// a px x px canvas: the card, and the 32 x 32 sprite frame `slot` of roster character `ch` at the largest whole scale that fits
export function poseCanvas(gb, ch, slot, mood, px = 128) {
  const rom = gb.mem.rom, L = gb.look, G = charGfx(rom, ch), a = off(G.matchBank, G.match[slot]);
  const cols = rom[off(G.matchBank, G.matchInfo + 4 * slot + 2)] ? 4 : 3, im = decodeColMajor(rom, a, cols, 4);
  const pi = rom[off(0x02, 0x417E) + ch], po = off(0x0A, 0x5341 + pi * 8), pal = [0, 1, 2, 3].map(i => rom[po + 2 * i] | rom[po + 2 * i + 1] << 8);
  const c = document.createElement("canvas"); c.width = c.height = px; const g = c.getContext("2d");
  const r = px * 0.16, gr = g.createLinearGradient(0, 0, 0, px);
  if (mood === "win") { gr.addColorStop(0, "#ffe27a"); gr.addColorStop(1, "#ff9a3c"); } else { gr.addColorStop(0, "#9fb4d8"); gr.addColorStop(1, "#56688c"); }
  g.beginPath(); g.roundRect(px * 0.03, px * 0.03, px * 0.94, px * 0.94, r); g.fillStyle = gr; g.fill(); g.lineWidth = px * 0.035; g.strokeStyle = "#fff"; g.stroke();
  const k = Math.floor(px * 0.84 / 32), x0 = Math.round((px - cols * 8 * k) / 2), y0 = Math.round((px - 32 * k) / 2);
  for (let cx = 0; cx < cols; cx++) for (let cy = 0; cy < 4; cy++) {
    const reg = L && L.byOffset ? L.byOffset.get(a + (cx * 4 + cy) * 16) : null;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const v = im.px[(cy * 8 + y) * im.w + cx * 8 + x]; if (!v) continue;
      const rg = reg ? reg[y * 8 + x] : 0;
      g.fillStyle = c15(rg && L.colours[rg] !== 0xFFFF ? L.colours[rg] : pal[v]);
      g.fillRect(x0 + (cx * 8 + x) * k, y0 + (cy * 8 + y) * k, k, k);
    }
  }
  return c;
}

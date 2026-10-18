// HD UI painter: with "UI: HD" on, the player's redrawn faces (portraits, win / lose faces) are drawn as the smooth
// 96x96 / 128x128 art of hdface.js over the Game Boy picture, wherever the hero's face tiles are on screen.
// Registered by creator.js (the look's owner): nothing is painted without a look, and the pixel version underneath
// is still the one every other renderer (and the recorded frames) use. An opponent mod's face with a `photo` (mods.js) is
// drawn the same way, from its picture.
import { registerHDPainter } from "../hdui.js";
import { hdFaceCanvas } from "./hdface.js";
import { LookRenderer } from "./render.js";

const MOOD = { p24: "neutral", win: "win", lose: "lose" };
const cache = new Map(), photos = new Map();
// a mod's photo as a canvas of px x px, or null while it loads (the screen is repainted once it has: the look's gen)
function photoCanvas(src, px, look) {
  let im = photos.get(src);
  if (!im) { im = new Image(); photos.set(src, im); im.onload = () => { if (look) look.gen = LookRenderer.gens = (LookRenderer.gens || 0) + 1; }; im.src = src; }
  if (!im.complete || !im.naturalWidth) return null;
  const c = document.createElement("canvas"); c.width = c.height = px; const g = c.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(im, 0, 0, px, px); return c;
}
function make(spec, kind, d, look) {
  const key = (spec.photo ? spec.photo.slice(-64) + spec.photo.length : JSON.stringify(spec)) + kind + ":" + d;
  let c = cache.get(key); if (c) return c;
  if (cache.size > 40) cache.clear();
  const px = kind === "p24" ? 96 : 128;
  c = spec.photo ? photoCanvas(spec.photo, px, look) : hdFaceCanvas({ ...spec, mood: MOOD[kind] }, px);
  if (!c) return null;
  if (d !== 0) {                                                  // the game's fade (to white) or its grey for the character not selected
    const o = document.createElement("canvas"); o.width = o.height = px; const g = o.getContext("2d"); g.drawImage(c, 0, 0);
    if (d === 64) { const im = g.getImageData(0, 0, px, px), a = im.data; for (let i = 0; i < a.length; i += 4) { const l = 0.3 * a[i] + 0.59 * a[i + 1] + 0.11 * a[i + 2], v = 34 + Math.sqrt(l / 255) * 190; a[i] = a[i + 1] = a[i + 2] = v; } g.putImageData(im, 0, 0); }
    else { g.globalCompositeOperation = "source-atop"; g.fillStyle = `rgba(255,255,255,${d / 31})`; g.fillRect(0, 0, px, px); }
    c = o;
  }
  cache.set(key, c); return c;
}
export function installHDPortraits() {
  registerHDPainter("p_portraits", (g, scr, layer) => {
    const L = scr.gb.look; if (!L || !L.faces || !L.faceTile) return;
    const cells = scr.cells[layer]; if (!cells || !cells.length) return;
    const p = scr.gb.ppu, groups = new Map();
    for (const c of cells) {
      const bank = c.attr & 8 ? 1 : 0, addr = p.lcdc & 0x10 ? c.tile << 4 : 0x1000 + ((c.tile << 24 >> 24) << 4), e = L.faceTile(bank, addr);
      if (!e) continue;
      const ox = c.x - (e.t % e.cols) * 8, oy = c.y - ((e.t / e.cols) | 0) * 8, key = ox + "," + oy + e.kind + e.hero;
      let gr = groups.get(key); if (!gr) groups.set(key, gr = { ox, oy, e, n: 0, pal: c.pal }); gr.n++;
    }
    for (const gr of groups.values()) {
      if (gr.n < gr.e.cols * gr.e.cols) continue;                                   // a whole face only
      const d = L.fade(p.bgPal, gr.pal), spec = L.faces[gr.e.hero]; if (d < 0 || !spec) continue;
      const c = make(spec, gr.e.kind, d, L); if (c) g.drawImage(c, gr.ox, gr.oy, gr.e.cols * 8, gr.e.cols * 8);
    }
  }, { order: 95, watch: scr => (scr.gb.look ? "lk" + scr.gb.look.gen : "") });     // a changed look repaints the screen
}

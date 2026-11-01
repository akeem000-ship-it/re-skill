// Portrait layout for touch screens held upright (after the Mario Tennis project's web/js/portrait.js): the game sits at the top
// of the screen and the controls get a deck of their own below it, out of the picture. The deck is golf-themed: on a hole (and on
// the overworld's maps) its background is the place's own art, the whole map the game keeps in WRAM (64 x 64 tiles: WRAM3 the
// tiles, WRAM2 the attributes) drawn with its tiles from VRAM and the frame's palettes, taken once the picture is fully faded in
// and darkened towards the bottom; elsewhere a mown fairway (stripes drawn here). A and B are golf balls, Start and Select tees,
// and a label names the hole (hole, par and yards, read from RAM). Nothing from the game is stored; nothing is written to it.
import { mapPlace } from "./wide.js";
const PORTRAIT = 1.15;                                 // height / width above which the screen counts as upright (a foldable's
                                                       // near-square inner screen held upright too: the game on top, the deck below)

export function portraitArea() {                       // the game's box in CSS px when the portrait layout is on, else null
  const b = document.body, on = b.classList.contains("touch") && innerHeight > innerWidth * PORTRAIT;
  b.classList.toggle("portrait", on);
  if (!on) return null;
  const cv = document.getElementById("screen"), p = cv && cv.style.aspectRatio ? cv.style.aspectRatio.split("/").map(Number) : [160, 144], ar = p[0] / p[1] || 160 / 144;
  const w = innerWidth, h = Math.round(Math.min(w / ar, innerHeight * 0.6));
  b.style.setProperty("--game-h", h + "px"); b.style.setProperty("--deck-h", (innerHeight - h) + "px");
  return { w, h };
}

const col = (pal, p, i) => { const o = p * 8 + i * 2, c = pal[o] | (pal[o + 1] << 8); return 0xFF000000 | ((c >> 10 & 31) << 19) | ((c >> 5 & 31) << 11) | ((c & 31) << 3); };
// the map's bounds (tiles) drawn into out (Uint32Array 512 * 512); returns the mean brightness (0..255)
function grabMap(w, place, out) {
  const v0 = w.vram[0], v1 = w.vram[1], t3 = w.wram[3], t2 = w.wram[2], pal = w.bgPal, lcdc = w.lcd.lcdc, [bx0, by0, bx1, by1] = place.bounds;
  let sum = 0, n = 0; out.fill(0);
  for (let ty = by0; ty < by1; ty++) for (let tx = bx0; tx < bx1; tx++) {
    const mi = ((ty & 63) << 6) | (tx & 63), tile = t3[mi], attr = t2[mi], bank = attr & 8 ? v1 : v0;
    const addr = lcdc & 0x10 ? tile << 4 : 0x1000 + ((tile << 24 >> 24) << 4);
    for (let r = 0; r < 8; r++) {
      const row = attr & 0x40 ? 7 - r : r, lo = bank[addr + row * 2], hi = bank[addr + row * 2 + 1];
      for (let x = 0; x < 8; x++) {
        const bit = attr & 0x20 ? x : 7 - x, c = col(pal, attr & 7, ((lo >> bit) & 1) | (((hi >> bit) & 1) << 1));
        out[(ty * 8 + r) * 512 + tx * 8 + x] = c; if (!(x & 3) && !(r & 3)) { sum += (c & 255) + (c >> 8 & 255) + (c >> 16 & 255); n++; }
      }
    }
  }
  return n ? sum / (3 * n) : 0;
}

export function attachDeck() {
  const deck = document.createElement("div"); deck.id = "deck";
  deck.innerHTML = `<canvas id="deckbg"></canvas><span id="decklabel"></span>`;
  document.body.appendChild(deck);
  const cv = deck.querySelector("canvas"), g = cv.getContext("2d"), label = deck.querySelector("#decklabel");
  const art = document.createElement("canvas"); art.width = art.height = 512;
  const ag = art.getContext("2d"), img = ag.createImageData(512, 512), buf = new Uint32Array(img.data.buffer);
  const arts = new Map();                              // place key -> { canvas, mean, box: the map's bounds in pixels, at: the camera }
  let size = "", tick = 0, shown = null;
  function paint() {
    const w = deck.clientWidth, h = deck.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (!w || !h) return;
    const s = w + "x" + h + ":" + (shown ? shown.id : ""); if (s === size) return; size = s;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    if (!shown) {                                      // a mown fairway: stripes of two greens, a soft light from the top
      for (let i = 0, n = 10; i < n; i++) { g.fillStyle = i & 1 ? "#3f8f3a" : "#4a9c43"; g.fillRect(i * cv.width / n, 0, cv.width / n + 1, cv.height); }
    } else {                                           // the map round the camera, covering the deck
      const a = shown, sw = Math.min(a.box[2], 192), k = cv.width / sw, sh = Math.min(a.box[3], cv.height / k);
      let sx = Math.max(a.box[0], Math.min(a.box[0] + a.box[2] - sw, a.at[0] - sw / 2)), sy = Math.max(a.box[1], Math.min(a.box[1] + a.box[3] - sh, a.at[1] + 144 - sh / 3));
      g.imageSmoothingEnabled = false; g.drawImage(a.canvas, sx, sy, sw, sh, 0, 0, cv.width, cv.height);
    }
    const gr = g.createLinearGradient(0, 0, 0, cv.height); gr.addColorStop(0, "rgba(0,0,0,0.12)"); gr.addColorStop(1, "rgba(0,0,0,0.42)");
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
  }
  let ids = 0;
  return {
    frame(game) {                                      // once per drawn frame (cheap: works every 20th)
      if (++tick % 20 || !document.body.classList.contains("portrait") || !game) return;
      const w = game.w, w0 = w.wram[0], place = mapPlace(w);
      const round = game.mark && game.mark !== "menus";
      const key = round ? `hole${w.wram[6][0x320]}:${w.high[0x1B0]}` : w0[0x450] ? `map${w0[0x450]}` : "";
      if (place && key) {                              // keep the picture if it is a real one (not a fade or a flash)
        const mean = grabMap(w, place, buf), prev = arts.get(key);
        if (mean > 24 && (!prev || mean >= prev.mean * 0.95)) {
          const c = prev ? prev.canvas : document.createElement("canvas"); c.width = c.height = 512;
          ag.putImageData(img, 0, 0); c.getContext("2d").clearRect(0, 0, 512, 512); c.getContext("2d").drawImage(art, 0, 0);
          const [bx0, by0, bx1, by1] = place.bounds;
          arts.set(key, { canvas: c, mean, id: prev && Math.abs(prev.at[0] - place.x0) < 48 && Math.abs(prev.at[1] - place.y0) < 48 ? prev.id : ++ids,
            box: [bx0 * 8, by0 * 8, (bx1 - bx0) * 8, (by1 - by0) * 8], at: [place.x0 + 80, place.y0] });
        }
      }
      const a = key ? arts.get(key) : null;
      shown = a ? { ...a, id: key + a.id } : null;
      label.textContent = round && w0[0x837] ? `Hole ${w0[0x837]} · Par ${w.wram[6][0x325]} · ${w.wram[6][0x323] | w.wram[6][0x324] << 8} y` : "";
      paint();
    },
    resize() { size = ""; paint(); },
  };
}

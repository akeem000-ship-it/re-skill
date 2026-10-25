// Portrait layout for touch screens held upright (a foldable's cover screen, or its inner screen turned): the game sits in
// the top part of the screen and the controls get a deck of their own below it, out of the picture.
// In a match or in the Training Center the deck is themed: its background is the place's own pixel art (the game's BG
// map, read from VRAM once the picture is fully faded in, darkened towards the bottom), A and B are tennis balls, and the
// stick, the small buttons and their labels follow the place (a court: a court-lines ring and scoreboard / advert boards;
// the Training Center: the Tennis Machine's eye and glass panels). Elsewhere (the open world, menus) the deck is plain.
// Nothing from the game is stored: the art is drawn from the running game's VRAM.
const PORTRAIT = 1.15;                                 // height / width above which the screen counts as upright
const NAMES = { 2: "Grass court", 4: "Clay court", 5: "Hard court" };

export function portraitArea() {                       // the game's box in CSS px when the portrait layout is on, else null
  const b = document.body, on = b.classList.contains("touch") && innerHeight > innerWidth * PORTRAIT;
  b.classList.toggle("portrait", on);
  if (!on) return null;
  const w = innerWidth, h = Math.round(Math.min(w * 1.02, innerHeight * (w >= 600 ? 0.62 : 0.58)));   // (a wide upright screen, a foldable's inner one: the deck has room to spare)
  b.style.setProperty("--game-h", h + "px"); b.style.setProperty("--deck-h", (innerHeight - h) + "px");
  return { w, h };
}

const col5 = (pal, p, i) => { const o = p * 8 + i * 2, c = pal[o] | (pal[o + 1] << 8); return 0xFF000000 | ((c >> 10 & 31) * 8 << 16) | ((c >> 5 & 31) * 8 << 8) | ((c & 31) * 8); };
// the whole 256 x 256 BG map with the frame's palettes, rows starting a little above the screen's top so the part on
// screen sits in the middle; returns the mean brightness (0..255) and how many pixels share the commonest colour
function grabBg(gb, out) {
  const m = gb.mem, p = gb.ppu, v0 = m.vram[0], v1 = m.vram[1], lcdc = p.lcdc, pal = p.bgPal;
  const base = lcdc & 0x08 ? 0x1C00 : 0x1800, tileAddr = t => lcdc & 0x10 ? t << 4 : 0x1000 + ((t << 24 >> 24) << 4);
  let sum = 0; const seen = new Map();
  for (let y = 0; y < 256; y++) {
    const my = (y + p.scy - 56) & 255;
    for (let x = 0; x < 256; x++) {
      const i = base + (my >> 3) * 32 + (x >> 3), tile = v0[i], attr = v1[i], bank = attr & 8 ? v1 : v0, addr = tileAddr(tile);
      const row = attr & 0x40 ? 7 - (my & 7) : (my & 7), bit = attr & 0x20 ? (x & 7) : 7 - (x & 7);
      const ci = ((bank[addr + row * 2] >> bit) & 1) | (((bank[addr + row * 2 + 1] >> bit) & 1) << 1), c = col5(pal, attr & 7, ci);
      out[y * 256 + x] = c; sum += (c & 255) + (c >> 8 & 255) + (c >> 16 & 255);
      if (!(x & 3) && !(y & 3)) seen.set(c, (seen.get(c) || 0) + 1);
    }
  }
  return { mean: sum / (3 * 65536), top: Math.max(...seen.values()) / 4096 };
}

export function attachPortrait(getGb) {
  const deck = document.createElement("div"); deck.id = "deck";
  deck.innerHTML = `<canvas id="deckbg"></canvas><span id="decklabel"></span><div class="deckpills">
    <span class="dk" data-for="menu">MENU</span><span class="dk" data-for="cam">CAM</span><span class="dk" data-for="rec">REC</span></div>`;
  (document.querySelector("main") || document.body).prepend(deck);   // inside main (a fixed layer of its own on touch screens), under the controls
  const cv = deck.querySelector("canvas"), g = cv.getContext("2d"), label = deck.querySelector("#decklabel");
  const art = document.createElement("canvas"); art.width = art.height = 256;
  const ag = art.getContext("2d"), img = ag.createImageData(256, 256), buf = new Uint32Array(img.data.buffer);
  const arts = new Map();                              // theme key -> { canvas, mean } (the brightest full picture seen there)
  for (const p of deck.querySelectorAll(".dk")) p.addEventListener("pointerdown", e => {
    e.preventDefault(); e.stopPropagation();
    if (p.dataset.for === "menu") { if (window.__backPressed) window.__backPressed(); return; }
    const t = document.getElementById(p.dataset.for); if (t) t.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  let theme = "", shown = null, size = "", tick = 0;
  function paint() {                                   // the deck's background: the art scaled to cover, darker towards the bottom
    const w = deck.clientWidth, h = deck.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (!w || !h) return;
    const s = w + "x" + h + ":" + (shown ? shown.id : "") + ":" + theme; if (s === size) return; size = s;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    if (!shown || theme === "plain") { g.fillStyle = "#14161c"; g.fillRect(0, 0, cv.width, cv.height); return; }
    const k = Math.max(cv.width / 256, cv.height / 256);
    g.imageSmoothingEnabled = false; g.drawImage(shown.canvas, (cv.width - 256 * k) / 2, (cv.height - 256 * k) / 2, 256 * k, 256 * k);
    const gr = g.createLinearGradient(0, 0, 0, cv.height); gr.addColorStop(0, "rgba(0,0,0,0.17)"); gr.addColorStop(1, "rgba(0,0,0,0.33)");
    g.fillStyle = gr; g.fillRect(0, 0, cv.width, cv.height);
  }
  let ids = 0;
  function capture(gb, k) {                            // keep the picture if it is a real one (not a fade, a blank or a flash)
    if (!(gb.ppu.lcdc & 0x80)) return;
    const st = grabBg(gb, buf), prev = arts.get(k);
    if (st.top > 0.85 || st.mean < 24) return;
    if (prev && st.mean < prev.mean * 0.9) return;
    const c = prev ? prev.canvas : document.createElement("canvas"); c.width = c.height = 256;
    ag.putImageData(img, 0, 0); c.getContext("2d").drawImage(art, 0, 0);
    arts.set(k, { canvas: c, mean: Math.max(st.mean, prev ? prev.mean : 0), id: ++ids });
  }
  return {
    frame() {                                          // once per game frame (cheap: works every 20th)
      if (++tick % 20 || !document.body.classList.contains("portrait")) return;
      const gb = getGb(); if (!gb) return;
      const w = gb.mem.wram[0], map = w[0x32E], mode = w[0x8A6], drill = mode >= 5 && mode <= 8;
      const t = map === 34 || (map <= 15 && drill) ? "hall" : map <= 15 ? "court" : "plain";
      // a drill's deck shows the Training Center's hall when it was seen on the way in, else the drill's own court
      const k = t === "court" ? "court" + map : t === "hall" ? (map === 34 || arts.has("hall") ? "hall" : "drill" + map) : "";
      if (k && (k !== "hall" || map === 34)) capture(gb, k);
      const a = k ? arts.get(k) : null;
      if (t !== theme) { document.body.classList.remove("deck-" + theme); document.body.classList.add("deck-" + t); theme = t; }
      shown = a ? { canvas: a.canvas, id: k + a.id } : null;
      label.textContent = t === "hall" ? "Training Center" : t === "court" ? (NAMES[map] || "Court") : "";
      const cam = document.getElementById("cam"), rec = document.getElementById("rec");
      deck.querySelector('[data-for="cam"]').hidden = !cam || cam.hidden;
      if (rec) deck.querySelector('[data-for="rec"]').textContent = rec.textContent;
      paint();
    },
    resize() { size = ""; paint(); },
  };
}

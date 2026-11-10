// HD sprite packs: a hero's frames redrawn at high resolution (tools/cut_hd_sheets.py cuts them from redrawn sheets), drawn in place of
// the game's own frames. The game still decides which frame is on show; the pack answers by the frame's ROM offset (the key
// web/js/look/build.js gives each hero frame, found in VRAM by render.js frameTile), so a frame the pack lacks keeps the game's sprite.
//
// A private build bundles packs in hdpacks/ (gitignored: art of the game's characters) and lists their directories in
// hdpacks/index.json; each holds pack.json ({ hero, frames: { "<rom offset>": { x, y, w, h, ox, oy, s } } }), atlas.png (the pictures)
// and mask.png (255 where the picture is the team colour: cap, collar, shoes, racket frame). A picture covers the frame pixels
// (ox, oy) .. (ox + w / s, oy + h / s); it may reach outside the game frame (a racket, a bigger head).
//
// Team colour: the game draws a hero with a palette whose colour 2 is the side's colour; the masked parts take that hue when it is
// not the picture's own red.

const loaded = { packs: [], byKey: new Map(), ready: null };

function imageData(url) {
  return new Promise((res, rej) => {
    const im = new Image(); im.onload = () => {
      const c = document.createElement("canvas"); c.width = im.width; c.height = im.height; const x = c.getContext("2d");
      x.drawImage(im, 0, 0); res(x.getImageData(0, 0, im.width, im.height));
    }; im.onerror = rej; im.src = url;
  });
}

// load the bundled packs once (resolves to the key -> entry map; empty without packs)
export function loadHDPacks(base = "hdpacks/") {
  if (loaded.ready) return loaded.ready;
  loaded.ready = (async () => {
    let list = [];
    try { const r = await fetch(base + "index.json"); if (!r.ok) return loaded.byKey; list = await r.json(); } catch (e) { return loaded.byKey; }
    for (const dir of list) {
      try {
        const p = base + dir + "/", def = await (await fetch(p + "pack.json")).json();
        const [atlas, mask] = await Promise.all([imageData(p + "atlas.png"), imageData(p + "mask.png")]);
        const pack = { id: def.id || dir, hero: def.hero, atlas, mask };
        loaded.packs.push(pack);
        for (const [k, f] of Object.entries(def.frames || {})) loaded.byKey.set(+k, { pack, key: +k, ...f, gw: f.w / f.s, gh: f.h / f.s });
      } catch (e) { /* a broken pack is left out */ }
    }
    return loaded.byKey;
  })();
  return loaded.ready;
}
export const hdPacks = () => loaded.byKey;

// ---- colour ----------------------------------------------------------------------------------------------------------------
const rgb2hsv = (r, g, b) => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, mx ? d / mx : 0, mx / 255];
};
const hsv2rgb = (h, s, v) => {
  const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  const [r, g, b] = [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][((i % 6) + 6) % 6];
  return [r * 255, g * 255, b * 255];
};
// BGR555 colour 2 of OBJ palette `slot` (palRAM: 64 bytes) as [r, g, b] 0-255
export function teamColour(palRAM, slot) {
  const o = slot * 8 + 4, c = palRAM[o] | palRAM[o + 1] << 8;
  return [((c & 31) * 255 / 31) | 0, (((c >> 5) & 31) * 255 / 31) | 0, (((c >> 10) & 31) * 255 / 31) | 0];
}

// ---- pictures ----------------------------------------------------------------------------------------------------------------
const pics = new Map();
// the entry's picture with the team colour: { canvas, data (Uint8ClampedArray RGBA, colour bled into the clear pixels so linear
// filtering keeps no dark fringe), w, h }, cached by entry and colour
export function hdPicture(e, team) {
  const [tr, tg, tb] = team || [255, 0, 0], [th, ts] = rgb2hsv(tr, tg, tb);
  const red = th < 0.06 || th > 0.94 || ts < 0.25;                     // the picture's own red (or a grey palette: keep it as drawn)
  const ck = e.key + ":" + (red ? "r" : ((th * 64) | 0) + "," + ((ts * 16) | 0));
  let p = pics.get(ck); if (p) return p;
  const { atlas, mask } = e.pack, W = e.w, H = e.h, out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const so = ((e.y + y) * atlas.width + e.x) * 4; out.set(atlas.data.subarray(so, so + W * 4), y * W * 4);
    if (red) continue;
    for (let x = 0; x < W; x++) {
      if (!mask.data[so + x * 4]) continue;
      const o = (y * W + x) * 4, [, s, v] = rgb2hsv(out[o], out[o + 1], out[o + 2]), c = hsv2rgb(th, Math.min(1, s * Math.max(0.35, ts)), v);
      out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2];
    }
  }
  // bleed: clear pixels take their opaque neighbours' colour (alpha stays 0)
  for (let pass = 0; pass < 2; pass++) {
    const src = out.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4; if (src[o + 3]) continue;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue; const q = (Y * W + X) * 4;
        if (src[q + 3] || (pass && (src[q] | src[q + 1] | src[q + 2]))) { r += src[q]; g += src[q + 1]; b += src[q + 2]; n++; }
      }
      if (n) { out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; }
    }
  }
  let canvas = null;
  if (typeof document !== "undefined") { canvas = document.createElement("canvas"); canvas.width = W; canvas.height = H; canvas.getContext("2d").putImageData(new ImageData(out, W, H), 0, 0); }
  p = { canvas, data: out, w: W, h: H };
  if (pics.size > 400) pics.clear();
  pics.set(ck, p); return p;
}

// where an instance's picture goes on the screen (game pixels): { x, y, w, h, mir } (mir: drawn mirrored)
export function hdRect(inst, e) {
  const w = e.gw, h = e.gh;
  return { x: inst.mir ? inst.ox + 1 - e.ox - w : inst.ox + e.ox, y: inst.oy + e.oy, w, h, mir: inst.mir };
}

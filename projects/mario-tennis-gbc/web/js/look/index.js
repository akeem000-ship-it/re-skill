// The player's look ("create a character"): one object the page, the recorder and the replay tests share.
//   look = { v: 1, boy: { style, lefty, face: { shape, eyes, brows, mouth, extras }, colours: { skin, hair, hat, top, bottom, shoes, racket } } | null, girl: ... | null }
// colours are 15-bit Game Boy Color colours (BGR555). A hero left null keeps the game's own graphics.
//
// Two parts (see build.js / render.js): the ROM copy is patched with the restyled frames (shapes: hairstyles,
// hats), which every renderer and the game itself then use; the colours come from the render-time colouring
// (exclusive to the hero, any number of regions). The hero's faces (24x24 portrait, 32x32 win / lose faces, 16x16 heads) are
// redrawn by the portrait kit (portrait.js, faces.js) through the same render layer; hdface.js / hdportrait.js draw them
// as smooth 96x96 / 128x128 art when the HD UI is on. With no look nothing is patched or hooked.
import { buildLook, applyPatches, HEROES } from "./build.js";
import { LookRenderer } from "./render.js";
import { normalizeMod } from "./mods.js";
import { normalizeFace } from "./portrait.js";

export { HEROES };
export const LOOK_VERSION = 1;

export function normalizeLook(look) {
  if (!look || typeof look !== "object") return null;
  const hero = (h, key) => {
    if (!h || typeof h !== "object") return null;
    const c = {}; for (const k of ["skin", "hair", "hat", "top", "bottom", "shoes", "racket"]) if (Number.isInteger(h.colours && h.colours[k])) c[k] = h.colours[k] & 0x7FFF;
    return { style: typeof h.style === "string" ? h.style : null, ...(h.lefty ? { lefty: true } : {}), ...(h.face && typeof h.face === "object" ? { face: normalizeFace(h.face, key) } : {}), colours: c };
  };
  const out = { v: LOOK_VERSION, boy: hero(look.boy, "boy"), girl: hero(look.girl, "girl") };
  const mods = Array.isArray(look.mods) ? look.mods.map(normalizeMod).filter(Boolean) : [];       // opponent mods (mods.js)
  if (mods.length) out.mods = mods;
  return out.boy || out.girl || out.mods ? out : null;
}
export const lookKey = look => JSON.stringify(normalizeLook(look));

export class LookManager {
  constructor() { this.look = null; this.rom = null; this.undo = []; this.renderer = null; this.gb = null; this.built = null; this.notes = []; this.detail = false; }
  // before the machine is built: patch the ROM bytes it will run (the same array, kept)
  // opts.detail: also build the heroes' face data for the detailed sprites (render.js frameTile), look or not
  prepare(romBytes, look, opts = {}) {
    this.rom = romBytes; this.look = normalizeLook(look); this.detail = !!opts.detail;
    this._restore(); this._build();
    return this;
  }
  // after: hook the machine (DMA tags, PPU colouring, gb.look for the 3D and wide views)
  attach(gb) {
    this.gb = gb;
    if (this.renderer) this.renderer.detach();
    this.renderer = this.built && (this.look || this.detail) ? new LookRenderer(this.built) : null;
    if (this.renderer) this.renderer.attach(gb);
    return this;
  }
  // change the look while the game runs. The frames already in VRAM are swapped for the new ones (matched by
  // content), the rest follows at their next upload; the portraits change when their screen is next drawn.
  // Deterministic: a replay doing the same at the same frame gets the same machine.
  set(look) {
    const gb = this.gb, before = new Map();
    if (gb && this.rom) for (const p of this.undo) for (let o = 0; o + 16 <= p.bytes.length; o += 16) {   // current hero tiles -> their offsets
      const k = key16(this.rom, p.off + o); if (!before.has(k)) before.set(k, p.off + o);
    }
    this.look = normalizeLook(look);
    this._restore(); this._build();
    if (gb) {
      for (const p of this.undo) for (let o = 0; o + 16 <= p.bytes.length; o += 16) { const k = key16(p.bytes, o); if (!before.has(k)) before.set(k, p.off + o); }   // pristine tiles too
      for (let bank = 0; bank < 2; bank++) {
        const v = gb.mem.vram[bank];
        for (let t = 0; t < 384; t++) {
          const o = before.get(key16(v, t * 16));
          if (o !== undefined) for (let i = 0; i < 16; i++) v[t * 16 + i] = this.rom[o + i];
        }
      }
      this.attach(gb);
    }
    return this;
  }
  // switch the detailed sprites' face data on or off while the game runs
  setDetail(on) { if (!!on === this.detail) return this; const look = this.look; this.detail = !!on; return this.set(look); }
  _restore() { if (this.rom) for (const p of this.undo.slice().reverse()) this.rom.set(p.bytes, p.off); this.undo = []; this.built = null; }
  _build() {
    if (!this.rom || (!this.look && !this.detail)) { this.built = null; return; }
    this.built = buildLook(this.rom, this.look || {}, { detail: this.detail }); this.notes = this.built.notes;
    this.undo = applyPatches(this.rom, this.built.patches);
  }
  toJSON() { return this.look; }
}
const key16 = (b, o) => { let s = ""; for (let i = 0; i < 16; i++) s += String.fromCharCode(b[o + i]); return s; };

// recordings: meta.look holds the look at the start, events [frame, "look:<json>"] each change
export const lookEvent = look => "look:" + JSON.stringify(normalizeLook(look));
export const parseLookEvent = e => (typeof e === "string" && e.startsWith("look:")) ? JSON.parse(e.slice(5)) : undefined;

// presets and the swatch palette (15-bit GBC colours, written as 8-bit RGB here)
export const rgb15 = (r, g, b) => (r >> 3) | ((g >> 3) << 5) | ((b >> 3) << 10);
export const css15 = c => `rgb(${(c & 31) * 255 / 31 | 0},${((c >> 5) & 31) * 255 / 31 | 0},${((c >> 10) & 31) * 255 / 31 | 0})`;
const H = s => rgb15(parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16));
export const SWATCHES = {
  skin: ["#ffe0c8", "#f8c8a0", "#f0b080", "#e0a070", "#d08c58", "#b8743c", "#9c5e34", "#82492a", "#6a3a22", "#552c1a", "#3f2014", "#2a160e"].map(H),
  hair: ["#181818", "#2a1810", "#402010", "#5c3418", "#7a4824", "#a85820", "#c89048", "#e8c050", "#f8e8a0", "#c03018", "#e870a8", "#3050c0", "#28a098", "#8040c0", "#a0a0a8", "#f8f8f8"].map(H),
  cloth: ["#f8f8f0", "#202028", "#e02828", "#f87818", "#f8d020", "#38b048", "#20a8a0", "#2858e0", "#182868", "#9038c8", "#f060a8", "#a87040"].map(H),
};
const P = (style, skin, hair, hat, top, bottom, shoes, face) => ({ style, colours: { skin: H(skin), hair: H(hair), hat: H(hat), top: H(top), bottom: H(bottom), shoes: H(shoes) }, face });
export const PRESETS = {
  boy: [
    { name: "Classic", look: null },
    { name: "Ace", look: P("cap", "#f8c8a0", "#402010", "#e02828", "#f8f8f0", "#2858e0", "#f8f8f0", { shape: "round", eyes: "round", brows: "straight", mouth: "grin" }) },
    { name: "Sporty", look: P("headband", "#9c5e34", "#181818", "#f8d020", "#38b048", "#202028", "#f8f8f0", { shape: "square", eyes: "determined", brows: "angled", mouth: "smirk" }) },
    { name: "Breeze", look: P("ponytail", "#ffe0c8", "#e8c050", "#20a8a0", "#20a8a0", "#f8f8f0", "#2858e0", { shape: "oval", eyes: "sleepy", brows: "arched", mouth: "smile", extras: ["freckles"] }) },
    { name: "Street", look: P("short", "#6a3a22", "#181818", "#9038c8", "#f87818", "#202028", "#e02828", { shape: "round", eyes: "sharp", brows: "straight", mouth: "smirk" }) },
    { name: "Afro", look: P("afro", "#82492a", "#181818", "#f8d020", "#e02828", "#f8f8f0", "#f8f8f0", { shape: "round", eyes: "bright", brows: "arched", mouth: "grin" }) },
    { name: "Locs", look: P("locs", "#552c1a", "#2a1810", "#f87818", "#2858e0", "#202028", "#f8f8f0", { shape: "oval", eyes: "round", brows: "straight", mouth: "smile" }) },
    { name: "Rows", look: P("cornrows", "#b8743c", "#181818", "#f8f8f0", "#9038c8", "#f8f8f0", "#202028", { shape: "square", eyes: "determined", brows: "straight", mouth: "serious" }) },
  ],
  girl: [
    { name: "Classic", look: null },
    { name: "Sunny", look: P("pigtails", "#ffe0c8", "#a85820", "#f060a8", "#f060a8", "#f8f8f0", "#f8f8f0", { shape: "round", eyes: "bright", brows: "arched", mouth: "smile", extras: ["blush"] }) },
    { name: "Coach", look: P("cap", "#d08c58", "#181818", "#2858e0", "#f8f8f0", "#2858e0", "#f8f8f0", { shape: "oval", eyes: "determined", brows: "angled", mouth: "smirk" }) },
    { name: "Bold", look: P("bob", "#82492a", "#e870a8", "#9038c8", "#9038c8", "#202028", "#f8d020", { shape: "oval", eyes: "sharp", brows: "arched", mouth: "grin" }) },
    { name: "Swift", look: P("ponytail", "#f8c8a0", "#c03018", "#38b048", "#38b048", "#f8f8f0", "#38b048", { shape: "oval", eyes: "round", brows: "straight", mouth: "smile", extras: ["freckles"] }) },
    { name: "Puffs", look: P("puffs", "#6a3a22", "#181818", "#f8d020", "#f060a8", "#f8f8f0", "#f8f8f0", { shape: "round", eyes: "bright", brows: "arched", mouth: "smile", extras: ["blush"] }) },
    { name: "Braids", look: P("braids", "#552c1a", "#181818", "#f8d020", "#20a8a0", "#f8f8f0", "#f8f8f0", { shape: "oval", eyes: "happy", brows: "arched", mouth: "grin" }) },
    { name: "Afro", look: P("afro", "#9c5e34", "#2a1810", "#f87818", "#f87818", "#202028", "#f8f8f0", { shape: "round", eyes: "round", brows: "arched", mouth: "smile", extras: ["glasses"] }) },
    { name: "Rows", look: P("cornrows", "#82492a", "#181818", "#e02828", "#2858e0", "#f8f8f0", "#f8f8f0", { shape: "oval", eyes: "sleepy", brows: "straight", mouth: "smirk" }) },
  ],
};

// The player's look ("create a character"): one object the page, the recorder and the replay tests share.
//   look = { v: 1, boy: { style, colours: { skin, hair, hat, top, bottom, shoes } } | null, girl: ... | null }
// colours are 15-bit Game Boy Color colours (BGR555). A hero left null keeps the game's own graphics.
//
// Two parts (see build.js / render.js): the ROM copy is patched with the restyled frames (shapes: hairstyles,
// hats), which every renderer and the game itself then use; the colours come from the render-time colouring
// (exclusive to the hero, any number of regions). With no look nothing is patched or hooked.
import { buildLook, applyPatches, HEROES } from "./build.js";
import { LookRenderer } from "./render.js";

export { HEROES };
export const LOOK_VERSION = 1;

export function normalizeLook(look) {
  if (!look || typeof look !== "object") return null;
  const hero = h => {
    if (!h || typeof h !== "object") return null;
    const c = {}; for (const k of ["skin", "hair", "hat", "top", "bottom", "shoes"]) if (Number.isInteger(h.colours && h.colours[k])) c[k] = h.colours[k] & 0x7FFF;
    return { style: typeof h.style === "string" ? h.style : null, colours: c };
  };
  const out = { v: LOOK_VERSION, boy: hero(look.boy), girl: hero(look.girl) };
  return out.boy || out.girl ? out : null;
}
export const lookKey = look => JSON.stringify(normalizeLook(look));

export class LookManager {
  constructor() { this.look = null; this.rom = null; this.undo = []; this.renderer = null; this.gb = null; this.built = null; this.notes = []; }
  // before the machine is built: patch the ROM bytes it will run (the same array, kept)
  prepare(romBytes, look) {
    this.rom = romBytes; this.look = normalizeLook(look);
    this._restore(); this._build();
    return this;
  }
  // after: hook the machine (DMA tags, PPU colouring, gb.look for the 3D and wide views)
  attach(gb) {
    this.gb = gb;
    if (this.renderer) this.renderer.detach();
    this.renderer = this.built && this.look ? new LookRenderer(this.built) : null;
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
  _restore() { if (this.rom) for (const p of this.undo.slice().reverse()) this.rom.set(p.bytes, p.off); this.undo = []; this.built = null; }
  _build() {
    if (!this.rom || !this.look) { this.built = null; return; }
    this.built = buildLook(this.rom, this.look); this.notes = this.built.notes;
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
  skin: ["#ffe0c8", "#f8c8a0", "#f0b080", "#d89058", "#b87040", "#985830", "#704028", "#503020"].map(H),
  hair: ["#181818", "#402010", "#704020", "#a85820", "#e8c050", "#f8e8a0", "#c03018", "#e870a8", "#3050c0", "#28a098", "#a0a0a8", "#f8f8f8"].map(H),
  cloth: ["#f8f8f0", "#202028", "#e02828", "#f87818", "#f8d020", "#38b048", "#20a8a0", "#2858e0", "#182868", "#9038c8", "#f060a8", "#a87040"].map(H),
};
export const PRESETS = {
  boy: [
    { name: "Classic", look: null },
    { name: "Ace", look: { style: "cap", colours: { skin: H("#f8c8a0"), hair: H("#402010"), hat: H("#e02828"), top: H("#f8f8f0"), bottom: H("#2858e0"), shoes: H("#f8f8f0") } } },
    { name: "Sporty", look: { style: "headband", colours: { skin: H("#b87040"), hair: H("#181818"), hat: H("#f8d020"), top: H("#38b048"), bottom: H("#202028"), shoes: H("#f8f8f0") } } },
    { name: "Breeze", look: { style: "ponytail", colours: { skin: H("#ffe0c8"), hair: H("#e8c050"), hat: H("#20a8a0"), top: H("#20a8a0"), bottom: H("#f8f8f0"), shoes: H("#2858e0") } } },
    { name: "Street", look: { style: "short", colours: { skin: H("#704028"), hair: H("#181818"), hat: H("#9038c8"), top: H("#f87818"), bottom: H("#202028"), shoes: H("#e02828") } } },
  ],
  girl: [
    { name: "Classic", look: null },
    { name: "Sunny", look: { style: "pigtails", colours: { skin: H("#ffe0c8"), hair: H("#a85820"), hat: H("#f060a8"), top: H("#f060a8"), bottom: H("#f8f8f0"), shoes: H("#f8f8f0") } } },
    { name: "Coach", look: { style: "cap", colours: { skin: H("#d89058"), hair: H("#181818"), hat: H("#2858e0"), top: H("#f8f8f0"), bottom: H("#2858e0"), shoes: H("#f8f8f0") } } },
    { name: "Bold", look: { style: "bob", colours: { skin: H("#985830"), hair: H("#e870a8"), hat: H("#9038c8"), top: H("#9038c8"), bottom: H("#202028"), shoes: H("#f8d020") } } },
    { name: "Swift", look: { style: "ponytail", colours: { skin: H("#f8c8a0"), hair: H("#c03018"), hat: H("#38b048"), top: H("#38b048"), bottom: H("#f8f8f0"), shoes: H("#38b048") } } },
  ],
};

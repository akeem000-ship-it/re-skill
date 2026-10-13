// Fast in-memory copies of a whole machine (everything web/js/gb/state.js saves, typed arrays copied instead of
// base64), for running a ROM routine and its port from the same state.
const SKIP = new Set(["m", "mem", "ppu", "apu", "timer", "joypad", "machine", "exec", "rom", "cpu", "gb", "frame", "rgb5", "bgFrame", "pixCell", "out"]);   // refs, the ROM, video/audio output buffers
const PARTS = ["cpu", "mem", "ppu", "apu", "timer", "joypad"];
function clone(v) {
  if (ArrayBuffer.isView(v)) return v.slice();
  if (Array.isArray(v)) return v.map(clone);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) if (!SKIP.has(k) && typeof v[k] !== "function") o[k] = clone(v[k]); return o; }
  return v;
}
function apply(target, v) {
  if (ArrayBuffer.isView(v)) { if (ArrayBuffer.isView(target) && target.length === v.length) { target.set(v); return target; } return v.slice(); }
  if (Array.isArray(v)) { const a = Array.isArray(target) ? target : []; v.forEach((x, i) => { a[i] = apply(a[i], x); }); a.length = v.length; return a; }
  if (v && typeof v === "object") { const o = target && typeof target === "object" ? target : {}; for (const k of Object.keys(v)) o[k] = apply(o[k], v[k]); return o; }
  return v;
}
export function cloneMachine(gb) { const s = { frames: gb.frames, cycles: gb.cycles }; for (const p of PARTS) s[p] = clone(gb[p]); return s; }
export function applyMachine(gb, s) { for (const p of PARTS) apply(gb[p], s[p]); gb.frames = s.frames; gb.cycles = s.cycles; gb.mem.updateRom(); }
// compare the parts of two machines the game's code writes: WRAM, VRAM, OAM, HRAM, SRAM, palettes, I/O and banking
export function diffMachines(a, b, { ignore = () => false, limit = 12 } = {}) {
  const out = [];
  const cmp = (name, x, y, base, bank) => { for (let i = 0; i < x.length && out.length < limit; i++) if (x[i] !== y[i] && !ignore(bank, base + i)) out.push([name, bank, base + i, x[i], y[i]]); };
  for (let k = 0; k < 8; k++) cmp(`wram${k}`, a.mem.wram[k], b.mem.wram[k], k === 0 ? 0xC000 : 0xD000, k === 0 ? 0 : k);
  for (let k = 0; k < 2; k++) cmp(`vram${k}`, a.mem.vram[k], b.mem.vram[k], 0x8000, 0x10 + k);
  cmp("oam", a.mem.oam, b.mem.oam, 0xFE00, 0x20);
  cmp("hram", a.mem.hram, b.mem.hram, 0xFF80, -2);
  cmp("sram", a.mem.sram, b.mem.sram, 0xA000, 0x30);
  cmp("bgPal", a.ppu.bgPal, b.ppu.bgPal, 0, 0x40); cmp("objPal", a.ppu.objPal, b.ppu.objPal, 0, 0x41);
  for (const r of ["romBank", "ramBank", "ramEnable", "vbk", "svbk", "ie"]) if (a.mem[r] !== b.mem[r] && out.length < limit) out.push(["mem." + r, 0, 0, +a.mem[r], +b.mem[r]]);
  for (const r of ["lcdc", "scx", "scy", "wx", "wy", "bcps", "ocps", "lyc", "bgp", "obp0", "obp1"]) if (r in a.ppu && a.ppu[r] !== b.ppu[r] && out.length < limit) out.push(["ppu." + r, 0, 0, +a.ppu[r], +b.ppu[r]]);
  return out;
}

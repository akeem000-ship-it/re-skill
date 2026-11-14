// Exact machine save states for the JS core: every field of the CPU, memory (all RAM banks, SRAM, banking,
// HDMA), PPU (timing, palettes, frame buffers), APU (channels, frame sequencer), timer and joypad is copied,
// so a restored machine continues bit-identically. The ROM and the cross-references between the parts are
// not stored. saveState(gb) -> plain object (typed arrays as base64), loadState(gb, obj).
const SKIP = new Set(["m", "mem", "ppu", "apu", "timer", "joypad", "machine", "exec", "rom", "cpu", "gb",
  "look", "lookPix", "spr"]);                // the display-only look layer hung on the PPU (web/js/look): never part of the machine's state
const PARTS = ["cpu", "mem", "ppu", "apu", "timer", "joypad"];
const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function enc(v) {
  if (ArrayBuffer.isView(v)) return { $t: v.constructor.name, d: b64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) };
  if (Array.isArray(v)) return v.map(enc);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) if (!SKIP.has(k)) o[k] = enc(v[k]); return o; }
  return v;
}
function dec(target, v) {                       // writes v into target in place where possible
  if (v && v.$t) { const bytes = unb64(v.d); if (target && ArrayBuffer.isView(target) && target.byteLength === bytes.length) { new Uint8Array(target.buffer, target.byteOffset, target.byteLength).set(bytes); return target; } const T = globalThis[v.$t]; return new T(bytes.buffer); }
  if (Array.isArray(v)) { const a = Array.isArray(target) ? target : []; v.forEach((x, i) => { a[i] = dec(a[i], x); }); a.length = v.length; return a; }
  if (v && typeof v === "object") { const o = target && typeof target === "object" ? target : {}; for (const k of Object.keys(v)) if (!SKIP.has(k)) o[k] = dec(o[k], v[k]); return o; }   // (older states carry the skipped fields: left alone)
  return v;
}
export function saveState(gb) {
  const s = { v: 1, frames: gb.frames, cycles: gb.cycles };
  for (const p of PARTS) s[p] = enc(gb[p]);
  return s;
}
export function loadState(gb, s) {
  for (const p of PARTS) dec(gb[p], s[p]);
  gb.frames = s.frames; gb.cycles = s.cycles; gb.mem.updateRom();
}
// Fast in-memory copies of the same fields, for run-ahead (full.js): typed arrays are copied as they are (no base64), and a
// restore writes them back in place. snapshot(gb) -> object, restore(gb, snap); the snapshot can be restored any number of times.
function cp(v) {
  if (ArrayBuffer.isView(v)) return v.slice();
  if (Array.isArray(v)) return v.map(cp);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v)) if (!SKIP.has(k)) o[k] = cp(v[k]); return o; }
  return v;
}
function put(target, v) {
  if (ArrayBuffer.isView(v)) { if (target && ArrayBuffer.isView(target) && target.length === v.length && target.constructor === v.constructor) { target.set(v); return target; } return v.slice(); }
  if (Array.isArray(v)) { const a = Array.isArray(target) ? target : []; v.forEach((x, i) => { a[i] = put(a[i], x); }); a.length = v.length; return a; }
  if (v && typeof v === "object") { const o = target && typeof target === "object" ? target : {}; for (const k of Object.keys(v)) o[k] = put(o[k], v[k]); return o; }
  return v;
}
export function snapshot(gb) {
  const s = { frames: gb.frames, cycles: gb.cycles };
  for (const p of PARTS) s[p] = cp(gb[p]);
  return s;
}
export function restore(gb, s) {
  for (const p of PARTS) put(gb[p], s[p]);
  gb.frames = s.frames; gb.cycles = s.cycles; gb.mem.updateRom();
}

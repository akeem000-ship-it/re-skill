// Session recorder: the JS core is deterministic, so a play session is fully described by the machine state at
// the start (web/js/gb/state.js) plus the joypad state of every frame. A recording also keeps a frame hash every
// 60 frames so a replay can prove it reproduces the session exactly (web/tests/replay.mjs).
// File format (.mtrec, gzip of JSON): { format: "mtrec", v, core, rom, startedAt, frames, start, inputs (base64,
// one byte per frame: bit0 A, 1 B, 2 Select, 3 Start, 4 Right, 5 Left, 6 Up, 7 Down), hashes [[frame, hash]],
// events [[frame, "reset"] or [frame, "look:<json>"] (the player's look changed, web/js/look)], meta (meta.look: the look
// at the start) }.
import { saveState } from "./gb/state.js";
export const CORE_TAG = "mtenn3d-core-2";
export const maskOf = s => (s.a ? 1 : 0) | (s.b ? 2 : 0) | (s.select ? 4 : 0) | (s.start ? 8 : 0) | (s.right ? 16 : 0) | (s.left ? 32 : 0) | (s.up ? 64 : 0) | (s.down ? 128 : 0);
export const stateOf = m => ({ a: !!(m & 1), b: !!(m & 2), select: !!(m & 4), start: !!(m & 8), right: !!(m & 16), left: !!(m & 32), up: !!(m & 64), down: !!(m & 128) });
const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };

export class Recorder {
  constructor() { this.on = false; }
  start(gb, meta = {}) {
    this.on = true; this.start0 = saveState(gb); this.buf = new Uint8Array(1 << 16); this.n = 0;
    this.hashes = []; this.events = []; this.meta = meta; this.startedAt = new Date().toISOString();
  }
  frame(gb, mask) {                                  // call once per emulated frame, after runFrame
    if (!this.on) return;
    if (this.n === this.buf.length) { const b = new Uint8Array(this.buf.length * 2); b.set(this.buf); this.buf = b; }
    this.buf[this.n++] = mask;
    if (this.n % 60 === 0) this.hashes.push([this.n, gb.frameHash()]);
  }
  event(name) { if (this.on) this.events.push([this.n, name]); }
  stop(gb, romHash) { this.on = false; return this.snapshot(gb, romHash); }
  snapshot(gb, romHash) {                            // the recording so far (it goes on)
    return { format: "mtrec", v: 1, core: CORE_TAG, rom: romHash, startedAt: this.startedAt, frames: this.n, start: this.start0,
             inputs: b64(this.buf.subarray(0, this.n)), hashes: this.hashes, events: this.events, endHash: gb.frameHash(), meta: this.meta };
  }
  get seconds() { return this.n / 60; }
}
// gzip a JSON object to bytes (CompressionStream where available, else plain JSON)
export async function packRecording(obj) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === "undefined") return { bytes: json, gz: false };
  const cs = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  return { bytes: new Uint8Array(await new Response(cs).arrayBuffer()), gz: true };
}
export { b64 as bytesToBase64 };

// REC (the button bar, as Mario Tennis's): a recording of a play session, to send in with a bug report. The game here is the rewritten
// JS (no machine state to save), and it is deterministic: a session is fully described by how its round began and the buttons the
// game read. So from each start (play.js newRound) the page keeps them all, quietly (one byte a read, ~200 KB an hour); REC marks where
// the part you mean begins, REC again saves the whole session with that mark (a replay runs it from the start, quickly, to the mark).
// Hiding the page (the app sent to the background) saves it too.
// File (.mgrec, gzip of JSON): { format: "mgrec", v, rom (SHA-1), startedAt, start: { mode, seed, course, hole, sram (base64: the save
// RAM the power-on read, or null) }, reads (the number of button reads), inputs (base64, one byte each: hJoyHeld's bits, A 1, B 2,
// Select 4, Start 8, Right $10, Left $20, Up $40, Down $80), frames, from (the frame REC was pressed), hashes [[frame, FNV-1a of WRAM
// bank 0 and HRAM]] every 60 frames, marks (the game's own marks: [frame, name]), meta (the page: user agent, address, settings) }.
// Replayed by web/tests/rec_replay.mjs. The link mode (two machines) is not recorded.
const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(s); };
export const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
// the state checked along a replay: WRAM bank 0 and HRAM (FNV-1a)
export function stateHash(w) {
  let h = 0x811C9DC5;
  for (const a of [w.wram[0], w.high]) for (let i = 0; i < a.length; i++) h = Math.imul(h ^ a[i], 0x01000193);
  return h >>> 0;
}
export class GolfRecorder {
  constructor() { this.on = false; this.from = -1; }
  // a new start (newRound): start = { mode, seed, course, hole, sram }
  begin(start) {
    this.on = true; this.start = { ...start, sram: start.sram ? b64(start.sram) : null }; this.startedAt = new Date().toISOString();
    this.buf = new Uint8Array(1 << 16); this.n = 0; this.frames = 0; this.hashes = []; this.from = -1;
  }
  stop() { this.on = false; this.from = -1; }
  read(b) {                                        // each button read the game makes
    if (!this.on) return b;
    if (this.n === this.buf.length) { const x = new Uint8Array(this.buf.length * 2); x.set(this.buf); this.buf = x; }
    this.buf[this.n++] = b; return b;
  }
  frame(w) { if (!this.on) return; this.frames++; if (this.frames % 60 === 0) this.hashes.push([this.frames, stateHash(w)]); }
  get marking() { return this.on && this.from >= 0; }
  mark() { this.from = this.frames; }
  seconds() { return (this.frames - this.from) / 59.73; }
  snapshot({ rom, marks = [], meta = {} }) {
    return { format: "mgrec", v: 1, rom, startedAt: this.startedAt, start: this.start, reads: this.n, inputs: b64(this.buf.subarray(0, this.n)),
      frames: this.frames, from: this.from, hashes: this.hashes, marks, meta };
  }
}
// gzip a JSON object to bytes (CompressionStream where available, else plain JSON)
export async function pack(obj, quick = false) {
  const json = new TextEncoder().encode(JSON.stringify(obj));
  if (quick || typeof CompressionStream === "undefined") return { bytes: json, gz: false };
  const cs = new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"));
  return { bytes: new Uint8Array(await new Response(cs).arrayBuffer()), gz: true };
}
// the file to the user: the MTenn3D app's Downloads/MTenn3D and share sheet (its MTennApp bridge), else a download
export function saveFile(name, bytes) {
  const app = window.MTennApp;
  if (app && app.saveFile) { app.saveFile(name, b64(bytes)); return; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes])); a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

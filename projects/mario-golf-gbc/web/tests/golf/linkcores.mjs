// Two emulator cores (web/js/gb, the reference) linked by the cable of web/js/gb/link.js and run in step: the side
// whose base clock is behind runs its next instruction, so the two never drift apart by more than one instruction
// (a halted side wakes at either side's transfer end). Each side gets its buttons at each AdvanceFrame 00:2E3B /
// WaitVBlankFlag 00:2F82 entry (its frame k, as the screen harness counts them: web/tests/golf/screenstep.mjs) from
// a policy, or from a recording.
// The run logs, per side: the buttons by frame; every transfer end that reached it ([dots, byte]: a single core
// replays the side from these, web/js/gb/link.js ScriptCable); per frame k the base-clock counts of its VBlank
// (00:2EF9 VBlankHandler's entry before the wait ends), the wait's end (00:2EBF / 00:2F89: the frame's code starts)
// and the PPU frames' screen hashes. The native link test orders the two native machines' frames by these counts
// (web/tests/golf_link_vs_cores.mjs).
// usage: node web/tests/golf/linkcores.mjs --record NAME [--frames N] [--shots F,F,...] [--every N]
//   (writes out/link/NAME.json and, with --shots / --every, out/link/NAME_<side>_<frame>.png)
import fs from "fs";
import path from "path";
import { GBC } from "../../js/gb/gbc.js";
import { LinkCable, ScriptCable } from "../../js/gb/link.js";
import { rasterize } from "../../js/golf/render/raster.js";
import { writePng } from "./coreplay.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const NAMES = ["a", "b", "select", "start", "right", "left", "up", "down"];
const romBytes = () => new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc")));

// one side: a core, its frame count, the times
export class LinkSide {
  constructor(gb, id) {
    this.gb = gb; this.id = id;
    this.k = 0; this.held = 0;
    this.inputs = [];                            // buttons by frame k
    this.events = [];                            // [dots, byte] transfer ends reaching this side
    this.tv = []; this.tc = [];                  // per frame k: its VBlank's and its code's start (base clocks)
    this.lastVbl = 0;
    this.hashes = [];                            // per PPU frame
    this.starts = [];                            // [dots, sc] transfers this side started (internal clock)
    this.ta = [];                                // per frame k: the first access of its code to the link state (HRAM
                                                 // $FFC0-$FFC9, the buffers $CB00-$CB7F) outside the VBlank and serial
                                                 // handlers and AdvanceFrame (none: absent)
    this.syncs = [];                             // base-clock counts at 00:308C (SerialSendBlock past its wait: the
                                                 // native code's "sync" yield there)
  }
  setHeld(bits) {
    this.held = bits;
    const st = {};
    NAMES.forEach((n, i) => { if (bits >> i & 1) st[n] = true; });
    this.gb.setInput(st);
  }
  wram(b) { return this.gb.mem.wram[b]; }
  hram() { return this.gb.mem.hram; }
}

// a frame task registered (bank, addr) in the side's table $C1C0-$C1FF
export const hasTask = (s, bank, addr) => {
  const t = s.wram(0);
  for (let p = 0x1C0; p < 0x200; p += 4) if (t[p] && t[p + 3] === bank && (t[p + 1] | t[p + 2] << 8) === addr) return true;
  return false;
};

// run two power-on cores linked until both have done `frames` frames (or stop() says so). policy(side, k) -> buttons
// at frame k; onFrame(side, k) after the side's frame k began (its code).
export function runLinked({ frames = 10000, policy, sram = [null, null], onPpuFrame = null, stop = null, onFrame = null }) {
  const rom = romBytes();
  const sides = [0, 1].map(i => {
    const gb = new GBC(rom, { audio: false });
    if (sram[i]) gb.mem.sram.set(sram[i].subarray(0, gb.mem.sram.length));
    return new LinkSide(gb, i);
  });
  const cable = new LinkCable(sides[0].gb, sides[1].gb);
  const byGb = new Map(sides.map(s => [s.gb, s]));
  cable.onTransfer = (gb, got, peerGot) => {
    byGb.get(gb).events.push([gb.dots, got]);
    if (peerGot !== null) { const p = byGb.get(cable.peer(gb)); p.events.push([p.gb.dots, peerGot]); }
  };
  for (const s of sides) {
    const m = s.gb.mem, orig = m.writeIO.bind(m), cpu = s.gb.cpu;
    m.writeIO = (r, v) => { if (r === 2 && (v & 0x81) === 0x81) s.starts.push([s.gb.dots, v]); return orig(r, v); };
    const access = a => {
      if (!((a >= 0xFFC0 && a <= 0xFFC9) || (a >= 0xCB00 && a < 0xCB80)) || s.k === 0 || s.ta[s.k - 1] !== undefined) return;
      const pc = cpu.pc;
      if ((pc >= 0x2E3B && pc <= 0x2EBF) || (pc >= 0x2EF9 && pc < 0x304D) || (pc >= 0x30AD && pc < 0x30EB) || pc < 0x100) return;
      s.ta[s.k - 1] = s.gb.dots;
    };
    const rd = m.read.bind(m), wr = m.write.bind(m);
    m.read = a => { access(a); return rd(a); };
    m.write = (a, v) => { access(a); return wr(a, v); };
  }
  const stepSide = s => {
    const gb = s.gb, cpu = gb.cpu, pc = cpu.pc;
    if (pc === 0x2E3B || pc === 0x2F82) { s.setHeld(policy(s, s.k)); s.inputs[s.k] = s.held; }
    else if (pc === 0x2EF9) s.lastVbl = gb.dots;
    else if (pc === 0x308C) s.syncs.push(gb.dots);
    const p = gb.ppu; p.frameDone = false;
    gb.stepInstruction();
    if (cpu.pc === 0x2EBF || cpu.pc === 0x2F89) {
      // (00:2EBF: AdvanceFrame's wait ended, the VBlank done flag seen; 00:2F89 WaitVBlankFlag's)
      if ((pc >= 0x2EAC && pc < 0x2EBF) || (pc >= 0x2F82 && pc < 0x2F89)) {
        s.tv[s.k] = s.lastVbl; s.tc[s.k] = gb.dots; s.k++;
        if (onFrame) onFrame(s, s.k - 1);
      }
    }
    if (p.frameDone) { s.hashes.push(hashRgb(p.rgb5)); if (onPpuFrame) onPpuFrame(s, s.hashes.length - 1); }
  };
  for (;;) {
    if (sides.every(s => s.k >= frames) || (stop && stop(sides))) break;
    const s = sides[0].gb.dots <= sides[1].gb.dots ? sides[0] : sides[1];
    stepSide(s);
  }
  return sides;
}

export function hashRgb(b) { let h = 0x811c9dc5; for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193) >>> 0; } return h; }

// one side of a recording on a single core (ScriptCable): the same buttons at the same frames
export function replaySide(rec, id, { frames = Infinity, onPpuFrame = null } = {}) {
  const side = rec.sides[id];
  const gb = new GBC(romBytes(), { audio: false });
  new ScriptCable(gb, side.events);
  const s = new LinkSide(gb, id);
  let n = 0;
  while (s.k < Math.min(frames, side.inputs.length)) {
    const cpu = gb.cpu, pc = cpu.pc;
    if (pc === 0x2E3B || pc === 0x2F82) s.setHeld(side.inputs[s.k] || 0);
    const p = gb.ppu; p.frameDone = false;
    gb.stepInstruction();
    if ((cpu.pc === 0x2EBF && pc >= 0x2EAC && pc < 0x2EBF) || (cpu.pc === 0x2F89 && pc >= 0x2F82 && pc < 0x2F89)) s.k++;
    if (p.frameDone) { s.hashes.push(hashRgb(p.rgb5)); if (onPpuFrame) onPpuFrame(s, n); n++; }
  }
  return s;
}

// the recording as stored: inputs run-length coded
export function packRecording(sides, extra = {}) {
  const rle = a => { const out = []; for (let i = 0; i < a.length; i++) { const v = a[i] || 0; if (out.length && out[out.length - 1][1] === v) out[out.length - 1][0]++; else out.push([1, v]); } return out; };
  return { ...extra, sides: sides.map(s => ({ inputs: rle(s.inputs), events: s.events, tv: s.tv, tc: s.tc, ta: s.ta, hashes: s.hashes, starts: s.starts, syncs: s.syncs })) };
}
export function loadRecording(file) {
  const r = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  for (const s of r.sides) { const a = []; for (const [n, v] of s.inputs) for (let i = 0; i < n; i++) a.push(v); s.inputs = a; }
  return r;
}

// ---- the recorded session (--record): a link game from power-on, both save RAMs empty (the guest characters) ----
// side 0: Start at the title (frame 2600), in the link menu Down to the VS game and A (the request: it becomes the
// clock side); side 1 Start too and then waits in the link menu (it answers 09:4810). Both: the character select's
// cursor Right to slot 4 (side 0) / 3 (side 1), A; then A every 40 frames (side 0 the game mode and the course: the
// first ones; on the course both swing: A every 40 frames)
// (variant "title": side 1 presses nothing until its character select: side 0's request reaches it on the title
// screen, 40:4161, or in the demo; side 0 presses Start at frame `start`)
// (request: side 0's Down in the link menu not before that frame)
export function sessionPolicy({ variant = "", start = 2600, request = 0 } = {}) {
  const st = [{ menuAt: -1, downDone: false }, { menuAt: -1 }];
  let seen = false, pauseAt = -1;
  // (variant "giveup" / "quit": side 0's aiming menu of hole 2 after its first stroke ($C837 2, $D4D4 set): Start, the link pause menu's
  // Give Up (Down 4 times) or Quit (5 times), A, Up to Yes, A)
  const downs = variant === "giveup" ? 4 : 5;
  const pauseSteps = [[30, 8], ...Array.from({ length: downs }, (_, i) => [70 + 20 * i, 0x80]), [80 + 20 * downs, 1], [140 + 20 * downs, 0x40], [170 + 20 * downs, 1]];
  return (s, k) => {
    if ((variant === "giveup" || variant === "quit") && s.id === 0) {
      if (pauseAt < 0 && s.wram(0)[0x837] === 2 && s.wram(0)[0x8A0] && s.wram(6)[0x4D4] === 1) pauseAt = k;
      if (pauseAt >= 0 && k - pauseAt <= 200 + 20 * downs) { const e = pauseSteps.find(([d]) => d === k - pauseAt); return e ? e[1] : 0; }
    }
    if (variant === "title" && s.id === 1 && !seen) { if (!hasTask(s, 0x06, 0x65D9)) return 0; seen = true; }
    if (k < start) return 0;
    if (k === start) return 8;
    const t = st[s.id];
    const inLinkMenu = hasTask(s, 0x09, 0x4990) && s.wram(6)[0x205] === 1 && s.wram(6)[0x202] === 4;
    if (inLinkMenu) {
      if (s.id === 1) return 0;
      if (t.menuAt < 0) t.menuAt = k;
      const d = Math.max(t.menuAt + 60, request);
      if (k === d) return 0x80;
      if (k === d + 40) return 1;
      return 0;
    }
    // the swing meter running ($D44E, from 0): A at $38 (the power: the putter's one press at $14) and at $76 (the
    // impact, the cursor back near 0)
    const m = s.wram(6)[0x44E];
    if (m) {
      if (s.wram(6)[0x329] === 0x0D) return m === 0x14 || m === 0x15 ? 1 : 0;
      return m === 0x38 || m === 0x39 || m === 0x76 || m === 0x77 ? 1 : 0;
    }
    if (k % 40) return 0;
    if (hasTask(s, 0x06, 0x65D9) && s.wram(6)[0x214] !== (s.id ? 3 : 4)) return 0x10;
    return 1;
  };
}

if (process.argv[1] && process.argv[1].endsWith("linkcores.mjs")) {
  const argv = process.argv.slice(2), arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
  const name = arg("--record", "session"), frames = +arg("--frames", 6000), every = +arg("--every", 0);
  const shots = new Set((arg("--shots", "") || "").split(",").filter(Boolean).map(Number));
  fs.mkdirSync(path.join(root, "out/link"), { recursive: true });
  const t0 = Date.now();
  const sides = runLinked({ frames, policy: sessionPolicy({ variant: arg("--variant", ""), start: +arg("--start", 2600), request: +arg("--request", 0) }),
    onPpuFrame: (s, f) => {
      if (shots.has(f) || (every && f % every === 0)) writePng(path.join(root, `out/link/${name}_${s.id}_${f}.png`), s.gb.ppu.rgb5);
    } });
  fs.writeFileSync(path.join(root, `out/link/${name}.json`), JSON.stringify(packRecording(sides, { frames, variant: arg("--variant", ""), start: +arg("--start", 2600), request: +arg("--request", 0) })));
  for (const s of sides) console.log(`side ${s.id}: ${s.k} frames, ${s.hashes.length} PPU frames, ${s.events.length} transfers in, ${s.starts.length} started; role ${s.hram()[0x42]} link role $C33F ${s.wram(0)[0x33F]}`);
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// The emulator core (web/js/gb, tests only) as the reference for the native engine and renderer: it resumes the
// game a few frames before GolfRound's entry (out/round_entry_snap.json, tools/emu_round_entry_state.py) and is
// stepped instruction by instruction to the points a test compares at: AdvanceFrame 00:2E3B (one native frame),
// the steps the native engine marks (as tools/emu_hole_setup.py MARKS), the start of VBlank (a finished frame).
import fs from "fs";
import path from "path";
import { GBC } from "../../js/gb/gbc.js";
import { loadSnapshot } from "../../js/gb/snapshot.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
export const MARKS = { hole: [0x10, 0x44B4], flyover: [0x08, 0x6432], windintro: [0x12, 0x6F8D], pick: [0x10, 0x45D9],
  shotsetup: [0x10, 0x4798], aimmenu: [0x10, 0x5BA6], address: [0x10, 0x56B0] };
const NAMES = ["a", "b", "select", "start", "right", "left", "up", "down"];

export class CoreRun {
  constructor(snapFile = path.join(root, "out/round_entry_snap.json")) {
    this.gb = new GBC(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))), { audio: false });
    loadSnapshot(this.gb, JSON.parse(fs.readFileSync(snapFile, "utf8")));
    this.held = 0;
    this.frame = null;                         // the last finished frame: rgb5 and the display state it was drawn from
    this.frames = 0;
    this.advances = 0;
  }
  setHeld(bits) {                              // joypad bits as hJoyHeld: A 1, B 2, Select 4, Start 8, Right $10 ...
    this.held = bits;
    const st = {};
    NAMES.forEach((n, i) => { if (bits >> i & 1) st[n] = true; });
    this.gb.setInput(st);
  }
  at(bank, addr) {
    const c = this.gb.cpu, m = this.gb.mem;
    return c.pc === addr && (addr < 0x4000 || m.romBank === bank);
  }
  step() {
    const p = this.gb.ppu;
    p.frameDone = false;
    this.gb.stepInstruction();
    if (p.frameDone) {                         // line 144: the frame is complete (before the VBlank handler runs)
      this.frames++;
      if (this.onFrame) this.onFrame(this);
    }
  }
  // run until pc is at one of the targets ([bank, addr]); returns its index
  runTo(targets, max = 50_000_000) {
    for (let n = 0; n < max; n++) {
      for (let i = 0; i < targets.length; i++) if (this.at(...targets[i])) return i;
      this.step();
    }
    throw new Error("the core did not reach " + targets.map(([b, a]) => `${b.toString(16)}:${a.toString(16)}`).join(" / "));
  }
  // leave the current pc (one instruction), then run to the next target
  runToNext(targets, max) { this.step(); return this.runTo(targets, max); }
  toAdvance() { this.runToNext([[0, 0x2E3B]]); this.advances++; }
  // the display state as the hardware has it: VRAM, OAM, palette RAM, LCD registers
  display() {
    const m = this.gb.mem, p = this.gb.ppu;
    return { vram: [m.vram[0], m.vram[1]], oam: m.oam, bgPal: p.bgPal, objPal: p.objPal,
      lcdc: p.lcdc, scx: p.scx, scy: p.scy, wx: p.wx, wy: p.wy };
  }
  // log writes into [lo, hi): fn(addr, value, pc, romBank, vbk) (debugging: which ROM code wrote it)
  watchWrites(lo, hi, fn) {
    const m = this.gb.mem, cpu = this.gb.cpu, orig = m.write.bind(m);
    m.write = (a, v) => { if (a >= lo && a < hi) fn(a, v, cpu.pc, m.romBank, m.vbk, m.svbk); return orig(a, v); };
  }
  wram(bank) { return this.gb.mem.wram[bank]; }
  hram() { return this.gb.mem.hram; }
}

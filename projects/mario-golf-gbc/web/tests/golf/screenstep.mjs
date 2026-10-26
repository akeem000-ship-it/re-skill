// One ported screen (a routine that runs its own frames) beside the ROM's on the emulator core, from a core state
// saved at the routine's entry (web/tests/golf/mkstate.mjs): the native engine starts from the core's RAM and display,
// both get the same buttons each frame, and after each frame's VBlank work the display (VRAM, OAM, palette RAM, LCD
// registers, the display RAM of WRAM0) and the rasterized screens are compared; when both have returned, all RAM
// (WRAM0-7 but the stack, HRAM) and the display. Lag frames (the game's code running past a VBlank) are counted
// apart as in golf/lockstep.mjs.
import fs from "fs";
import path from "path";
import { CoreRun } from "./corerun.mjs";
import { useRom } from "../../js/golf/rom.js";
import { GolfMemory } from "../../js/golf/memory.js";
import { Shot } from "../../js/golf/shot.js";
import { initDisplay, displayFromCore } from "../../js/golf/render/display.js";
import { rasterize } from "../../js/golf/render/raster.js";
import { applyPendingPaletteUpdates } from "../../js/golf/render/display.js";
import { fadeVBlank, updateGameTimer } from "../../js/golf/screen.js";
import { runFrameTasks } from "../../js/golf/tasks.js";
import { loadState } from "../../js/gb/state.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const h2 = v => v.toString(16).padStart(2, "0"), h4 = v => v.toString(16).padStart(4, "0");
const WRAM0_DISPLAY = [[0x000, 0x0A0], [0x100, 0x1C0], [0x1C0, 0x200], [0x200, 0x280], [0x300, 0x320], [0x340, 0x360], [0x380, 0x3A0], [0x3C0, 0x3E0]];

// stateFile: out/...json from mkstate.mjs; run(sh, regs) -> the native routine (a generator); policy(frame) -> the
// buttons held (default: A on alternate frames); returns { frames, pixelExact, modelExact, lag, bad: [...], end }
export function runScreen({ stateFile, run, policy = f => (f & 1 ? 0 : 1), maxFrames = 20000, verbose = false, trace = false, hook = null, lagVBlanks = true, open = false, setRegs = null }) {
  useRom(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))));
  const saved = JSON.parse(fs.readFileSync(path.join(root, stateFile)));
  const core = new CoreRun();
  loadState(core.gb, saved.state);
  const [bank, addr] = saved.at;
  if (!core.at(bank, addr)) throw new Error("the state is not at the routine's entry");
  const gb = core.gb, cpu = gb.cpu;
  if (setRegs) for (const [k, v] of Object.entries(setRegs)) cpu[k] = v;   // (a case's own arguments)
  const regs = { a: cpu.a, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l };
  const sp0 = cpu.sp, ret = gb.mem.read(sp0) | gb.mem.read(sp0 + 1) << 8, retBank = gb.mem.romBank;
  const w = new GolfMemory();
  for (let i = 0; i < 8; i++) w.wram[i].set(core.wram(i));
  w.high.set(core.hram().subarray(0, 0x7F), 0x180);
  w.sram.set(gb.mem.sram.subarray(0, 0x2000));   // (the save RAM's first bank)
  initDisplay(w); displayFromCore(w, gb);
  w.high[0x195] = gb.mem.romBank;
  const res = { frames: 0, pixelExact: 0, modelExact: 0, lag: 0, bad: [], sounds: { core: [], native: [] } };
  let frame = 0, vb = 0, partial = 0, partialSeen = 0, early = false, lagFrames = new Set(), coreDone = false;
  w.onSound = id => res.sounds.native.push(`${frame}:${h2(id)}`);
  const orig = core.step.bind(core);
  let lastSound = null;
  let lastCall = "";
  const divQ = [];                               // rDIV as the game's code read it (ldh a, [$FF04]): the native code
  w.readDIV = () => (divQ.length ? divQ.shift() : 0);   // gets the same values (a hardware input, as the joypad)
  core.step = () => {
    if (gb.mem.read(cpu.pc) === 0xF0 && gb.mem.read((cpu.pc + 1) & 0xFFFF) === 0x04) divQ.push(gb.mem.read(0xFF04));
    if (trace && cpu.pc === 0x2E3B) {             // (trace: the caller of each of the game's AdvanceFrames)
      const sp = cpu.sp, rd = a => gb.mem.read(a);
      lastCall = `${gb.mem.romBank.toString(16)}:${(rd(sp) | rd(sp + 1) << 8).toString(16)}<${(rd(sp + 2) | rd(sp + 3) << 8).toString(16)}<${(rd(sp + 4) | rd(sp + 5) << 8).toString(16)}`;
    }
    if (cpu.pc === 0x2BCA) {
      const key = `${frame}:${h2(cpu.a)}`;
      if (!(lastSound && lastSound.key === key && lastSound.sp === cpu.sp)) res.sounds.core.push(key);
      lastSound = { key, sp: cpu.sp };
    }
    if (cpu.pc === 0x2EF9) {
      vb++;
      if (gb.mem.hram[0x0D]) partial++;          // hVBlankDone still set: a VBlank of the every-frame work only
      const sp = cpu.sp, r = gb.mem.read(sp) | gb.mem.read(sp + 1) << 8;
      if (!(r >= 0x2EAC && r < 0x2EBF) && !gb.mem.hram[0x0D]) early = true;
    }
    orig();
    if (!coreDone && cpu.pc === ret && cpu.sp === ((sp0 + 2) & 0xFFFF) && gb.mem.romBank === retBank) { coreDone = true; res.coreA = cpu.a; res.coreFrame = frame; }
  };
  const runAhead = () => {                       // the core's code for the frame, to its next AdvanceFrame (or return)
    const m = gb.mem, read = m.read, seen = {};
    let lag = false;
    m.read = function (a) {
      const v = read.call(this, a);
      if (a >= 0xFF90 && a <= 0xFF94 && !(a in seen) && (cpu.pc < 0x02EB || cpu.pc > 0x0341)) seen[a] = lag ? v : null;
      return v;
    };
    partial = 0;
    core.step();
    while (!coreDone && cpu.pc !== 0x2E3B) { if (cpu.pc === 0x0340) lag = true; core.step(); }
    let extra = partial; partialSeen = partial;
    delete m.read;
    for (const [a, v] of Object.entries(seen)) if (v !== null) w.high[a - 0xFE00] = v;
    // the game's code ran past a VBlank that found the frame's VRAM work done (lag): that VBlank's every-frame work
    // (00:2F46-00:2F64: the game timer, the fades, the palette update) runs on the native side too, before the
    // native code of the frame, so that the code after it sees the same fade (the native code takes no CPU time)
    lagWork(extra);
  };
  const lagWork = n => {
    if (lagVBlanks) for (; n > 0; n--) {
      applyPendingPaletteUpdates(w); updateGameTimer(w); fadeVBlank(w);
      if (w.sh) runFrameTasks(w, true, w.sh.dispatch);
      res.lagVBlanks = (res.lagVBlanks || 0) + 1;
    }
  };
  const compare = () => {
    const cd = core.display(), out = [], keys = [];
    const diff = (k, a, b, base) => {
      let n = 0, first = [];
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { n++; keys.push(`${k}${base + i}`); if (first.length < 4) first.push(`$${h4(base + i)} js ${h2(a[i])} game ${h2(b[i])}`); }
      if (n) out.push(`${k}: ${n} (${first.join(", ")})`);
    };
    diff("vram0", w.vram[0], cd.vram[0], 0x8000); diff("vram1", w.vram[1], cd.vram[1], 0x8000);
    diff("oam", w.oam, cd.oam, 0xFE00); diff("bgpal", w.bgPal, cd.bgPal, 0); diff("objpal", w.objPal, cd.objPal, 0);
    for (const r of ["lcdc", "scx", "scy", "wx", "wy"]) if (w.lcd[r] !== cd[r]) out.push(`${r} js ${h2(w.lcd[r])} game ${h2(cd[r])}`);
    for (const [lo, hi] of WRAM0_DISPLAY) diff("wram0", w.wram[0].subarray(lo, hi), core.wram(0).subarray(lo, hi), 0xC000 + lo);
    const a = rasterize({ vram: w.vram, oam: w.oam, bgPal: w.bgPal, objPal: w.objPal, ...w.lcd }), b = rasterize(cd);
    let px = 0;
    for (let i = 0; i < a.length; i += 3) if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) px++;
    return { out, px, keys };
  };
  const taint = new Set();                       // bytes that have differed in every frame since a lag frame
  const ev = kind => {
    if (kind === "F") {
      if (!core.at(0, 0x2E3B)) runAhead();       // (the first frame: the core's code from the entry)
      core.setHeld(policy(frame));
      partial = 0;
      core.runToNext([[0, 0x2EBF]]);
      w.high.set(core.hram().subarray(0x10, 0x15), 0x190);
      lagWork(partial);                          // (AdvanceFrame's halt woke at a VBlank that found the work done)
      return;
    }
    if (kind !== "V") return;
    const lagNow = vb > 1 || early;
    res.vbs = res.vbs || []; res.vbs.push(vb + (early ? 'e' : '') + '/' + partialSeen);
    vb = 0; early = false;
    if (lagNow) lagFrames.add(frame);
    res.frames++;
    if (hook) hook(frame, w, core);
    if (trace) {
      const js = new Error().stack.split("\n").slice(2).map(l => (l.match(/at (?:Generator\.next \()?(\S+)/) || [])[1])
        .filter(n => n && !n.startsWith("file") && !/\.next$|ev$|advance|runScreen/.test(n)).slice(0, 4).join("<");
      console.log(`frame ${frame}: game ${lastCall} / js ${js}`);
    }
    const { out, px, keys } = compare();
    let lag = false;
    for (let f = frame - 3; f <= frame; f++) if (lagFrames.has(f)) lag = true;
    const now = new Set(keys);
    for (const k of taint) if (!now.has(k)) taint.delete(k);
    if (lag) for (const k of keys) taint.add(k);
    else if (keys.length && keys.every(k => taint.has(k))) lag = true;
    if (trace && lagNow) console.log(`frame ${frame}: a lag frame`);
    if (!px) res.pixelExact++;
    if (!out.length) res.modelExact++;
    else if (lag) res.lag++;
    else { res.bad.push({ frame, px, out }); if (verbose) console.log(`frame ${frame}: ${px} px; ${out.join("; ")}`); }
    frame++;
    if (frame > maxFrames) throw new Error("too many frames");
    runAhead();
  };
  ev.v = true;
  const sh = new Shot(w, null, ev, null);
  const g = run(sh, regs);
  let r;
  for (r = g.next(); !r.done; r = g.next()) {}
  res.native = r.value;
  if (!coreDone && !open) {                      // the core's code after its last AdvanceFrame, to its return
                                                 // (open: a routine that does not return; compared to here)
    if (core.at(0, 0x2E3B)) runAhead();
    while (!coreDone) core.step();
  }

  const end = [];
  for (let b = 0; b < 8; b++) {
    let n = 0, first = [];
    for (let i = 0; i < 0x1000; i++) {
      if (b === 0 && i >= 0xE00) break;          // (the stack: WRAM0 $CE00-$CFFF)
      if (b === 0 && (i >= 0x4C0 && i < 0x62A || i === 0x33E || i === 0xAAB)) continue;   // (the sound driver's RAM)
      // (a free entry of the VRAM copy queue $C0A0 or the BG tile write queue $C180, free in both: its other bytes
      // are what an earlier copy left, and which slot a copy takes follows the game's lag frames)
      if (b === 0 && i >= 0x0A0 && i < 0x0F0 && !w.wram[0][i & ~7] && !core.wram(0)[i & ~7]) continue;
      if (b === 0 && i >= 0x180 && i < 0x1C0 && !w.wram[0][i & ~3] && !core.wram(0)[i & ~3]) continue;
      if (w.wram[b][i] !== core.wram(b)[i]) { n++; if (first.length < (process.env.SCREEN_ENDN ? +process.env.SCREEN_ENDN : 6)) first.push(`$${h4((b ? 0xD000 : 0xC000) + i)} js ${h2(w.wram[b][i])} game ${h2(core.wram(b)[i])}`); }
    }
    if (n) end.push(`wram${b}: ${n} (${first.join(", ")})`);
  }
  for (let i = 0; i < 0x7F; i++) if (w.high[0x180 + i] !== core.hram()[i] && i !== 0x15 && i !== 0x3F && i !== 0x4D && i !== 0x4E) end.push(`hram $ff${h2(0x80 + i)} js ${h2(w.high[0x180 + i])} game ${h2(core.hram()[i])}`);
  const fin = compare();
  if (fin.out.length) end.push(...fin.out.map(s => "display " + s));
  res.end = end;
  return res;
}

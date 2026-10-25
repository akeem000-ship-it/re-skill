// The native round (web/js/golf/game.js) and the emulator core (corerun.mjs) side by side: the core plays the same
// round from GolfRound's entry. Each native frame: at its start (F) the core is at its AdvanceFrame 00:2E3B and is
// run past its VBlank (00:2EBF), and the native engine takes the joypad bytes that VBlank read ($FF90-$FF94); after
// the native frame's VBlank work (V) a test compares the two (RAM, and the display model with the core's VRAM / OAM
// / palettes); then the core runs that frame's code ahead to its next AdvanceFrame, noting the steps it passes
// (ctx.passed) for the steps the native round marks (M) in its own code for the frame.
// Both get the same buttons: a swing's from a recorded round (out/roundin_<name>.json, as golf_native_round.mjs)
// from each address step, A on alternate frames elsewhere. When the game lags (its code runs past the next VBlank),
// that VBlank reads the joypad again and the code sees those bytes (a press can be lost): the native frame gets
// them too (ctx.lagInputs: the frames where they differed).
// When the core has to run whole frames to reach a step the native round marks, that is a slip (ctx.slips: the
// native round took fewer AdvanceFrames than the game); the two are in step again from there.
import fs from "fs";
import path from "path";
import { CoreRun, MARKS } from "./corerun.mjs";
import { useRom } from "../../js/golf/rom.js";
import { GolfMemory } from "../../js/golf/memory.js";
import { playRound } from "../../js/golf/game.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

// opts: name (the recorded round's swings), holes, onFrame(ctx) at each in-step AdvanceFrame (ctx: core, w, frame,
// shot, phase, mark), onMark(ctx, name), pokes {addr: byte} at GolfRound's entry (WRAM0), setup(w, core, ctx)
export function runLockstep({ name = "r18", holes = 1, onFrame = () => {}, onMark = () => {}, pokes = {}, setup = () => {} } = {}) {
  const romBytes = new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc")));
  useRom(romBytes);
  const rec = JSON.parse(fs.readFileSync(path.join(root, `out/roundin_${name}.json`)));
  const streams = rec.addresses.map((ad, k) => rec.held.slice(ad.frame, k + 1 < rec.addresses.length ? rec.addresses[k + 1].frame : rec.held.length));
  const core = new CoreRun();
  core.runTo([[0x10, 0x4451]]);
  for (const [a, v] of Object.entries(pokes)) core.wram(0)[parseInt(a, 16) - 0xC000] = v;
  const roundId = core.gb.cpu.a;
  const w = new GolfMemory();
  for (let i = 0; i < 8; i++) w.wram[i].set(core.wram(i));
  w.high.set(core.hram().subarray(0, 0x7F), 0x180);
  const ctx = { core, w, frame: 0, shot: -1, n: 0, phase: "menus", synced: true, toggle: 0, mark: "round", slips: [],
    passed: [], lagInputs: [] };
  setup(w, core, ctx);
  const policy = () => {
    if (ctx.phase === "swing") return (streams[ctx.shot] || [])[ctx.n++] || 0;
    return (ctx.toggle ^= 1) ? 1 : 0;
  };
  const markList = Object.entries(MARKS);
  // the core's code for the frame the native round is about to run, up to its next AdvanceFrame 00:2E3B: the
  // steps it passes (ctx.passed), and, when it lags, the joypad bytes $FF90-$FF94 its code first reads after a lag
  // VBlank read them again (ReadJoypad 00:02EB-00:0340): those are what the code saw
  const runAhead = () => {
    ctx.passed = [];
    const gb = core.gb, m = gb.mem, read = m.read;
    const seen = {};
    let lag = false;
    m.read = function (a) {
      const v = read.call(this, a);
      if (a >= 0xFF90 && a <= 0xFF94 && !(a in seen) && (gb.cpu.pc < 0x02EB || gb.cpu.pc > 0x0341)) seen[a] = lag ? v : null;
      return v;
    };
    core.step();
    for (;;) {
      const pc = gb.cpu.pc;
      if (pc === 0x2E3B) break;
      if (pc === 0x0340) lag = true;
      else for (const [n, mk] of markList) if (core.at(...mk)) ctx.passed.push(n);
      core.step();
    }
    delete m.read;
    core.advances++;
    return seen;
  };
  const ev = (kind, mname) => {
    if (kind === "M") {
      if (MARKS[mname]) {
        ctx.resynced = !ctx.synced;              // the core caught up through frames the native round leaves out
        const i = ctx.passed.indexOf(mname);
        if (i >= 0) ctx.passed.splice(0, i + 1); // the core passed it in this frame's code: in step
        else if (!core.at(...MARKS[mname])) {    // through the screens the native round leaves out: A
          let t = 0;
          let adv = 0;                           // the game's frames (AdvanceFrame 00:2E3B) on the way
          core.onFrame = () => core.setHeld((t ^= 1) ? 1 : 0);
          while (core.runTo([MARKS[mname], [0, 0x2E3B]], 400_000_000)) { adv++; core.step(); }
          core.onFrame = null;
          ctx.passed = [];
          if (ctx.synced && adv) ctx.slips.push({ frame: ctx.frame, mark: mname, shot: ctx.shot, frames: adv });
        }
        ctx.synced = true;
      }
      ctx.mark = mname;
      if (mname === "address") { ctx.shot++; ctx.n = 0; ctx.phase = "swing"; }
      else ctx.phase = "menus";
      onMark(ctx, mname);
      return;
    }
    if (kind === "V") {                        // both past VBlank (the core at 00:2EBF): compare here
      if (ctx.synced) onFrame(ctx);
      ctx.frame++;
      const seen = runAhead();
      let changed = false;                     // the game lagged: its code saw what its extra VBlank read
      for (const [a, v] of Object.entries(seen)) if (v !== null && w.high[a - 0xFE00] !== v) { w.high[a - 0xFE00] = v; changed = true; }
      if (changed) ctx.lagInputs.push(ctx.frame);
      return;
    }
    if (kind !== "F") return;
    if (!core.at(0, 0x2E3B)) core.toAdvance(); // (before the first frame, or after a step mid-frame)
    core.setHeld(policy());
    core.runToNext([[0, 0x2EBF]]);             // past its wait: the joypad its VBlank read
    w.high.set(core.hram().subarray(0x10, 0x15), 0x190);
  };
  ev.v = true;                                 // also an event after each frame's VBlank work
  const result = playRound(w, roundId, null, { ev, maxHoles: holes, onShot: () => { ctx.phase = "menus"; } });
  return { ctx, result };
}

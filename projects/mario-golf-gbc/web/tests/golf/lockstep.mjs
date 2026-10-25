// The native round (web/js/golf/game.js) and the emulator core (corerun.mjs) side by side: the core plays the same
// round from GolfRound's entry, and at every native AdvanceFrame the core is run to its own next AdvanceFrame
// 00:2E3B, so a test can compare the two there (RAM, and the display model with the core's VRAM / OAM / palettes).
// Both get the same joypad: a swing's buttons from a recorded round (out/roundin_<name>.json, as
// golf_native_round.mjs) from each address step, A on alternate frames elsewhere; the native engine takes the
// joypad bytes the core's VBlank read ($FF90-$FF94 as AdvanceFrame leaves its wait, 00:2EBF).
// The native round leaves out the frames of the captions and screens between shots: from a shot's outcome to
// the next step it marks (pick, hole, ...) the two are not in step; there the core is run on to that step and
// `synced` is false until it gets there.
import fs from "fs";
import path from "path";
import { CoreRun, MARKS } from "./corerun.mjs";
import { useRom } from "../../js/golf/rom.js";
import { GolfMemory } from "../../js/golf/memory.js";
import { playRound } from "../../js/golf/game.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");

// opts: name (the recorded round's swings), holes, onFrame(ctx) at each in-step AdvanceFrame (ctx: core, w, frame,
// shot, phase, mark), onMark(ctx, name), pokes {addr: byte} at GolfRound's entry (WRAM0)
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
  setup(w, core);
  const ctx = { core, w, frame: 0, shot: -1, n: 0, phase: "menus", synced: true, toggle: 0, mark: "round" };
  const policy = () => {
    if (ctx.phase === "swing") return (streams[ctx.shot] || [])[ctx.n++] || 0;
    return (ctx.toggle ^= 1) ? 1 : 0;
  };
  const ev = (kind, mname) => {
    if (kind === "M") {
      if (MARKS[mname]) {
        ctx.resynced = !ctx.synced;              // the core caught up through frames the native round leaves out
        if (!core.at(...MARKS[mname])) {         // through the captions and screens the native round leaves out: A
          let t = 0;
          core.onFrame = () => core.setHeld((t ^= 1) ? 1 : 0);
          core.runTo([MARKS[mname]], 400_000_000);
          core.onFrame = null;
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
      return;
    }
    if (kind !== "F") return;
    core.toAdvance();                          // the core at its AdvanceFrame (the native frame's start)
    core.setHeld(policy());
    core.runToNext([[0, 0x2EBF]]);             // past its wait: the joypad its VBlank read
    w.high.set(core.hram().subarray(0x10, 0x15), 0x190);
  };
  ev.v = true;                                 // also an event after each frame's VBlank work
  const result = playRound(w, roundId, null, { ev, maxHoles: holes, onShot: () => { ctx.synced = false; ctx.phase = "menus"; } });
  return { ctx, result };
}

// The native renderer against the emulator core, frame by frame through a Stroke round (web/tests/golf/lockstep.mjs:
// the native round and the core side by side, the same joypad). At every frame both have done (after VBlank's
// work) the test compares
//   - the display model the ported code wrote (render/display.js: VRAM banks 0 and 1, OAM, the BG and OBJ palette
//     RAM, LCDC SCX SCY WX WY) with the core's hardware state, plus the RAM the display code keeps (shadow OAM
//     $C000, the queues $C0A0 / $C180, the live and master palettes $C100-$C27F, the blit buffers $C300-$C3FF);
//   - the screen: render/raster.js on the native model against render/raster.js on the core's state (pixel for
//     pixel), and, once per frame the core finishes, render/raster.js on the core's state against the core's own
//     PPU output (so the rasterizer itself is checked: the core's first frame after the LCD is switched on is blank
//     on the hardware and is left out).
// The sound commands (rst $08 / PlaySoundManaged: the id as PlaySoundCmd 00:2BCA has it) the core's code gives
// and the ones the native round gives (w.onSound) are compared too, frame by frame where the two are in step.
// Frames where the game lags (its main loop took more than one frame: extra VBlanks run the fades, the clock and
// the joypad again, and the VRAM queues may be cut in two) are reported apart: the native code takes no CPU time,
// so it has no lag frames. Between a shot's outcome and the next shot's set-up the native round leaves the captions
// and screens out (not ported); those frames are not compared, and the display state they leave behind shows up at
// the next compared frames ("after unported screens").
// usage: node web/tests/golf_render_vs_core.mjs [--holes N] [--name r18|cpu18] [--shots out/...] [--verbose]
//   --shots DIR writes PPM screenshots of the native screen at the marks (address steps, flight, green, hole end)
import fs from "fs";
import path from "path";
import { runLockstep } from "./golf/lockstep.mjs";
import { initDisplay, displayFromCore } from "../js/golf/render/display.js";
import { rasterize } from "../js/golf/render/raster.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const arg = (n, d) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1] : d);
const holes = +arg("--holes", 1), name = arg("--name", "r18"), shotsDir = arg("--shots", null);
const verbose = process.argv.includes("--verbose");
const h2 = v => v.toString(16).padStart(2, "0"), h4 = v => v.toString(16).padStart(4, "0");

function diffs(a, b, base, skip) {
  const d = [];
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(skip && skip(i))) d.push(i);
  return d.length ? { n: d.length, first: d.slice(0, 6).map(i => `$${h4(base + i)} js ${h2(a[i])} game ${h2(b[i])}`).join(", ") } : null;
}
const coreDisplay = core => core.display();
// the shadow OAM, the live palettes and the BG tile-write queue, the frame task table, the master palettes, the BG
// row / column blit buffers (the VRAM copy queue $C0A0 is left to the VRAM it fills: lag frames can cut it in two)
const WRAM0_DISPLAY = [[0x000, 0x0A0], [0x100, 0x1C0], [0x1C0, 0x200], [0x200, 0x280], [0x300, 0x320], [0x340, 0x360], [0x380, 0x3A0], [0x3C0, 0x3E0]];

let vb = 0, early = false, afterUnsynced = false, lctx = null;
const coreSounds = [], nativeSounds = [];
const lagFrames = new Set(), mismatches = [];
const stats = { frames: 0, modelExact: 0, pixelExact: 0, lag: 0, unported: 0, bad: 0, rasterChecked: 0, rasterBad: 0, rasterBlank: 0 };
const badRuns = [];
const first = {};
let lastLcdOn = -1;
const ppm = (file, rgb5) => {
  const out = Buffer.alloc(160 * 144 * 3);
  for (let i = 0; i < out.length; i++) out[i] = rgb5[i] * 8 + (rgb5[i] >> 2);
  fs.writeFileSync(file, Buffer.concat([Buffer.from("P6 160 144 255\n"), out]));
};
const shotMarks = new Set(["address", "pick"]);
let shotN = 0;

const t0 = Date.now();
try {
  runLockstep({ name, holes,
    setup(w, core) {
      initDisplay(w); displayFromCore(w, core.gb);
      w.onSound = id => { if (lctx && lctx.synced) nativeSounds.push(`${lctx.frame}:${h2(id)}`); };
      const gb = core.gb, orig = core.step.bind(core);
      core.step = () => {
        if (gb.cpu.pc === 0x2BCA && lctx && lctx.synced) coreSounds.push(`${lctx.frame}:${h2(gb.cpu.a)}`);
        if (gb.cpu.pc === 0x2EF9) {              // VBlank: lag when it interrupts the game's code, not AdvanceFrame's wait
          vb++;
          const sp = gb.cpu.sp, ret = gb.mem.read(sp) | gb.mem.read(sp + 1) << 8;
          if (!(ret >= 0x2EAC && ret < 0x2EBF) && !gb.mem.hram[0x0D]) early = true;
        }
        if (gb.cpu.pc === 0x0371) lastLcdOn = core.frames;
        orig();
      };
      core.onFrame = null;
      const check = () => {                      // the rasterizer against the core's PPU at each finished frame
        if (core.frames - lastLcdOn <= 1) { stats.rasterBlank++; return; }
        stats.rasterChecked++;
        const mine = rasterize(coreDisplay(core)), ref = gb.ppu.rgb5;
        for (let i = 0; i < mine.length; i++) if (mine[i] !== ref[i]) { stats.rasterBad++; if (!first.raster) first.raster = `core frame ${core.frames}`; break; }
      };
      const origStep = core.step;
      core.step = () => { const p = gb.ppu; origStep(); if (p.frameDone && p.ly === 144) check(); };
    },
    onMark(ctx, m) { lctx = ctx; if (ctx.resynced) afterUnsynced = true; },
    onFrame(ctx) {
      stats.frames++;
      if (vb > 1 || early) lagFrames.add(ctx.frame);
      vb = 0; early = false;
      const w = ctx.w, c = ctx.core, cd = coreDisplay(c);
      const out = [];
      const add = (k, d) => { if (d) out.push(`${k}: ${d.n} differ (${d.first})`); };
      add("vram0", diffs(w.vram[0], cd.vram[0], 0x8000));
      add("vram1", diffs(w.vram[1], cd.vram[1], 0x8000));
      add("oam", diffs(w.oam, cd.oam, 0xFE00));
      add("bgpal", diffs(w.bgPal, cd.bgPal, 0));
      add("objpal", diffs(w.objPal, cd.objPal, 0));
      for (const r of ["lcdc", "scx", "scy", "wx", "wy"]) if (w.lcd[r] !== cd[r]) out.push(`${r} js ${h2(w.lcd[r])} game ${h2(cd[r])}`);
      for (const [lo, hi] of WRAM0_DISPLAY) add("wram " + h4(0xC000 + lo), diffs(w.wram[0].subarray(lo, hi), c.wram(0).subarray(lo, hi), 0xC000 + lo));
      const mine = rasterize({ vram: w.vram, oam: w.oam, bgPal: w.bgPal, objPal: w.objPal, ...w.lcd });
      const ref = rasterize(cd);
      let px = 0;
      for (let i = 0; i < mine.length; i += 3) if (mine[i] !== ref[i] || mine[i + 1] !== ref[i + 1] || mine[i + 2] !== ref[i + 2]) px++;
      if (!out.length) stats.modelExact++;
      if (!px) stats.pixelExact++;
      if (shotsDir && shotMarks.has(ctx.mark) && ctx.lastShot !== ctx.mark + ctx.shot) {
        ctx.lastShot = ctx.mark + ctx.shot;
        ppm(path.join(shotsDir, `render_${String(shotN++).padStart(3, "0")}_${ctx.mark}_native.ppm`), mine);
        ppm(path.join(shotsDir, `render_${String(shotN - 1).padStart(3, "0")}_${ctx.mark}_game.ppm`), ref);
      }
      if (!out.length && !px) { afterUnsynced = false; return; }
      mismatches.push({ frame: ctx.frame, px, out, mark: ctx.mark, shot: ctx.shot, unsynced: afterUnsynced });
    } });
} catch (e) {
  console.log(`stopped: ${e.message}`);
  stats.error = e.message;
}
for (const m of mismatches) {                  // a frame within 3 frames after (or 1 before) a lag frame is "lag"
  let kind = "bad";
  for (let f = m.frame - 3; f <= m.frame + 1; f++) if (lagFrames.has(f)) kind = "lag";
  if (kind === "bad" && m.unsynced) kind = "unported";
  stats[kind]++;
  const run = badRuns[badRuns.length - 1];
  if (run && run.kind === kind && run.to === m.frame - 1) { run.to = m.frame; run.px = Math.max(run.px, m.px); }
  else badRuns.push({ kind, from: m.frame, to: m.frame, mark: m.mark, shot: m.shot, px: m.px, what: m.out.slice(0, verbose ? 20 : 3) });
}
{                                              // the sound commands where in step
  let i = 0;
  while (i < coreSounds.length && i < nativeSounds.length && coreSounds[i] === nativeSounds[i]) i++;
  stats.soundBad = i < Math.max(coreSounds.length, nativeSounds.length);
  console.log(`  sound commands (frame:id): ${coreSounds.length} by the game, ${nativeSounds.length} native, ` +
    (stats.soundBad ? `first difference at #${i}: game ${coreSounds.slice(i, i + 4).join(" ")} / js ${nativeSounds.slice(i, i + 4).join(" ")}` : "the same"));
}
if (verbose) console.log("lag frames:", [...lagFrames].sort((a, b) => a - b).join(" "));
console.log(`${stats.frames} frames compared (${holes} hole(s) of ${name}, ${((Date.now() - t0) / 1000).toFixed(1)} s): ` +
  `${stats.pixelExact} pixel-exact screens, ${stats.modelExact} with VRAM / OAM / palettes / registers equal`);
console.log(`  differing: ${stats.lag} just after the game's lag frames, ${stats.unported} after the unported screens between shots, ${stats.bad} other`);
console.log(`  rasterizer vs the core's PPU: ${stats.rasterChecked} frames checked, ${stats.rasterBad} differ` +
  ` (${stats.rasterBlank} blank frames after the LCD is switched on left out)${first.raster ? "; first " + first.raster : ""}`);
for (const r of badRuns.filter(r => verbose || r.kind === "bad").slice(0, verbose ? 200 : 12))
  console.log(`  ${r.kind} frames ${r.from}-${r.to} (${r.mark}, shot ${r.shot + 1}), up to ${r.px} pixels:\n      ${r.what.join("\n      ")}`);
process.exit(stats.bad || stats.rasterBad || stats.soundBad || stats.error ? 1 : 0);

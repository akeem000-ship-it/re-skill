// Native step 2's renderer against the PPU's: plays recordings from power on on the native port (no CPU, events,
// gb/display.js) and draws every line twice, with gb/display.js and with gb/ppu.js's renderLine on a shadow copy of
// the screen's state, then compares everything a line writes: the picture (frame, rgb5), the background alone
// (bgFrame), the tile-map cell and place of each pixel (pixCell, pixSub), the window's first column and line count
// (winX, windowLine), the BG colours and priorities (lineColor, linePrio) and the sprite layer (spr).
// --look: with a player's look set (web/js/look), as the page has when one is chosen.
// usage: node web/tests/port/display_vs_ppu.mjs [a.mtrec ...] [--frames N]   (default: exh1, story1, minigame_star)
import { readRecording, loadRom } from "../engine/corpus.mjs";
import { stateOf } from "../../js/recorder.js";
import { GamePort } from "../../js/port/port.js";
import { program } from "../../js/port/program.js";
import { PPU } from "../../js/gb/ppu.js";
import { Display } from "../../js/gb/display.js";
import { LookManager, PRESETS } from "../../js/look/index.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const recs = a.filter((x, i) => !x.startsWith("--") && a[i - 1] !== "--frames");
if (!recs.length) recs.push("out/engine/exh1.mtrec", "out/port/story1.mtrec", "out/port/minigame_star.mtrec");
const maxFrames = +opt("--frames", 1e9), rom0 = loadRom(), withLook = a.includes("--look");
let bad = 0;
const SCALARS = ["ly", "lcdc", "scx", "scy", "wx", "wy", "windowLine"];
for (const path of recs) {
  const rec = readRecording(path), ins = Buffer.from(rec.inputs, "base64");
  if (rec.start.cpu.pc !== 0x100) { console.log(`${path}: from a saved state, skipped`); continue; }
  const rom = Uint8Array.from(rom0), look = withLook ? new LookManager().prepare(rom, { alex: PRESETS.boy[1].look, nina: PRESETS.girl[1].look }, { detail: true }) : null;
  const P = new GamePort(rom, program, { noCpu: true });
  if (look) { look.attach(P.gb); if (!P.ppu.look) throw new Error("the look did not attach"); }
  const D = P.ppu; if (!(D instanceof Display)) throw new Error("not the native display");
  const S = new PPU(P.mem);                                                   // the shadow: ppu.js's renderLine, its own buffers
  S.spr = { rgba: new Uint32Array(160 * 144), idx: new Uint8Array(160 * 144), hide: false };
  D.spr = { rgba: new Uint32Array(160 * 144), idx: new Uint8Array(160 * 144), hide: false };
  let lines = 0, diffs = 0;
  const fast = D.renderLine;
  D.renderLine = function () {
    for (const k of SCALARS) S[k] = D[k];
    S.bgPal.set(D.bgPal); S.objPal.set(D.objPal); S.look = D.look;
    PPU.prototype.renderLine.call(S);
    fast.call(D);
    lines++;
    const ly = D.ly, b = ly * 160, cmp = (name, x, y, n, k = 1) => {
      for (let i = b * k; i < (b + n) * k; i++) if (x[i] !== y[i]) { if (diffs++ < 5) console.log(`${path}: frame ${P.frames} line ${ly}: ${name} differs at ${i - b * k} (${y[i]} / ${x[i]})`); return; }
    };
    cmp("frame", D.frame, S.frame, 160); cmp("rgb5", D.rgb5, S.rgb5, 160, 3); cmp("bgFrame", D.bgFrame, S.bgFrame, 160);
    cmp("pixCell", D.pixCell, S.pixCell, 160); cmp("pixSub", D.pixSub, S.pixSub, 160);
    cmp("sprite rgba", D.spr.rgba, S.spr.rgba, 160); cmp("sprite index", D.spr.idx, S.spr.idx, 160);
    for (let x = 0; x < 160; x++) if (D.lineColor[x] !== S.lineColor[x] || D.linePrio[x] !== S.linePrio[x]) { if (diffs++ < 5) console.log(`${path}: line ${ly}: BG colour / priority differ at ${x}`); break; }
    if (D.winX[ly] !== S.winX[ly] || D.windowLine !== S.windowLine) { if (diffs++ < 5) console.log(`${path}: line ${ly}: window differs`); }
  };
  P.onVBlank = n => P.setInput(stateOf(ins[Math.min(n, ins.length - 1)])); P.setInput(stateOf(ins[0]));
  const frames = Math.min(maxFrames, rec.frames);
  for (let f = 0; f < frames; f++) P.frame();
  console.log(`${path}: ${frames} frames, ${lines} lines drawn both ways, ${diffs} differ`);
  if (diffs) bad++;
}
process.exit(bad ? 1 : 0);

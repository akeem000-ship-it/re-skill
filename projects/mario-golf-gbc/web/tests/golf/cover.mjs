// COVER=out/scratch/x.bin (any test that runs the emulator core: the screens, the lockstep rounds, the routine fuzzers):
// the ROM bytes the core executed, one byte per ROM byte, OR-merged into that file when the process exits
// (tools/cover_report.py lists the routines reached; tests only)
import fs from "fs";
import path from "path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const cover = process.env.COVER ? new Uint8Array(0x200000) : null;
if (cover) process.on("exit", () => {
  const f = path.join(root, process.env.COVER);
  if (fs.existsSync(f)) { const old = fs.readFileSync(f); for (let i = 0; i < cover.length; i++) cover[i] |= old[i]; }
  fs.writeFileSync(f, cover);
});
// note the instruction at the core's pc (call before the core steps it)
export function coverStep(gb) {
  if (!cover) return;
  const pc = gb.cpu.pc;
  if (pc < 0x4000) cover[pc] = 1; else if (pc < 0x8000) cover[gb.mem.romBank * 0x4000 + pc - 0x4000] = 1;
}
export const covering = !!cover;

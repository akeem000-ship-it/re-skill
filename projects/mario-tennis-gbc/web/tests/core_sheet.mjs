// Contact sheet of frames from the JS core with a key script (frame:button, 6-frame presses).
// usage: node web/tests/core_sheet.mjs OUT.png --skip S --step K --count N [--keys F:b,...] [--auto-a FROM TO EVERY]
import fs from "fs";
import { fileURLToPath } from "url";
import { GBC } from "../js/gb/gbc.js";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const out = a[0], skip = +opt("--skip", 0), step = +opt("--step", 60), count = +opt("--count", 20);
const keys = {}; for (const k of opt("--keys", "").split(",")) if (k) { const [f, b] = k.split(":"); keys[+f] = b; }
if (a.includes("--auto-a")) { const i = a.indexOf("--auto-a"); for (let f = +a[i + 1]; f < +a[i + 2]; f += +a[i + 3]) keys[f] = "a"; }
const rom = new Uint8Array(fs.readFileSync(here("../../rom/mario_tennis.gbc")));
const gb = new GBC(rom, { audio: false });
const cols = 5, rows = Math.ceil(count / cols), W = cols * 160, H = rows * 144, sheet = Buffer.alloc(W * H * 3, 20);
let shots = 0;
for (let f = 0; f < skip + step * count; f++) {
  const st = {}; for (const [kf, b] of Object.entries(keys)) if (f >= +kf && f < +kf + 6) st[b] = true;
  gb.setInput(st); gb.runFrame();
  if (f >= skip && (f - skip) % step === 0 && shots < count) {
    const b = gb.ppu.rgb5, x0 = (shots % cols) * 160, y0 = Math.floor(shots / cols) * 144;
    for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) { const s = (y * 160 + x) * 3, d = ((y0 + y) * W + x0 + x) * 3; sheet[d] = b[s] * 8; sheet[d + 1] = b[s + 1] * 8; sheet[d + 2] = b[s + 2] * 8; }
    shots++;
  }
}
fs.writeFileSync(out.replace(/\.png$/, ".ppm"), Buffer.concat([Buffer.from(`P6 ${W} ${H} 255\n`), sheet]));
console.log("wrote", out.replace(/\.png$/, ".ppm"), "map id", gb.mem.wram[0][0x281], "frame", skip + step * count);

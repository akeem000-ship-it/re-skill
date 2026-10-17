// Search for talkable NPCs on an RPG map: from a core state, walk dx/dy steps (16 px per step ~ 16 frames), face each
// direction, press A, and report where a dialogue box opens (visible BG tiles differing from the WRAM3 map).
// usage: node web/tests/talk_probe.mjs STATE.json.gz [--range N] [--save OUTSTATE dx,dy,dir]
import fs from "fs"; import zlib from "zlib";
import { GBC } from "../js/gb/gbc.js";
import { loadState, saveState } from "../js/gb/state.js";
globalThis.atob ??= s => Buffer.from(s, "base64").toString("binary"); globalThis.btoa ??= s => Buffer.from(s, "binary").toString("base64");
const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const rom = new Uint8Array(fs.readFileSync("rom/mario_tennis.gbc")), st = JSON.parse(zlib.gunzipSync(fs.readFileSync(a[0])));
const mod = await import("../gen/game.js");
const fresh = () => { const gb = new GBC(rom, { audio: false }); const T = {}; mod.install(T); gb.installRecomp(T); gb.exec.setHramSig(mod.HRAM_SIG); loadState(gb, st); return gb; };
const run = (gb, inp, n) => { for (let i = 0; i < n; i++) { gb.setInput(inp); gb.runFrame(); } };
const pos = gb => { const w = gb.mem.wram[0]; return [w[0x321] * 8 + (w[0x320] >> 5), w[0x323] * 8 + (w[0x322] >> 5)]; };
function dialog(gb) {
  const m = gb.mem, p = gb.ppu, v0 = m.vram[0], tm = m.wram[3], base = p.lcdc & 8 ? 0x1C00 : 0x1800, [sx, sy] = pos(gb);
  let n = 0; for (let ty = 0; ty < 18; ty++) for (let tx = 0; tx < 20; tx++) { const X = (sx >> 3) + tx, Y = (sy >> 3) + ty; if (X >= 64 || Y >= 64) continue; if (v0[base + ((((p.scy >> 3) + ty) & 31) << 5) + (((p.scx >> 3) + tx) & 31)] !== tm[Y * 64 + X]) n++; }
  let wn = 0; for (let y = 0; y < 144; y++) if (p.winX[y] !== 255) wn++;
  return n > 12 || wn > 8 || gb.mem.wram[0][0x32E] !== st0map;
}
const st0map = fresh().mem.wram[0][0x32E];
function trial(dx, dy, dir) {
  const gb = fresh();
  if (dx) run(gb, { [dx > 0 ? "right" : "left"]: true }, Math.abs(dx) * 16);
  if (dy) run(gb, { [dy > 0 ? "down" : "up"]: true }, Math.abs(dy) * 16);
  run(gb, { [dir]: true }, 3); run(gb, {}, 8);
  run(gb, { a: true }, 4); run(gb, {}, 40);
  return gb;
}
if (opt("--save")) {
  const [dx, dy, dir] = opt("--save", "").split(",").slice(0); const parts = a[a.indexOf("--save") + 2].split(",");
  const gb = trial(+parts[0], +parts[1], parts[2]); fs.writeFileSync(opt("--save"), zlib.gzipSync(JSON.stringify(saveState(gb)))); console.log("saved", pos(gb), gb.mem.wram[0][0x32E]); process.exit(0);
}
const R = +opt("--range", 4), step = +opt("--step", 1), hits = [], seen = new Map(), shotDir = opt("--shots");
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
for (let dy = -R; dy <= R; dy += step) for (let dx = -R; dx <= R; dx += step) for (const dir of ["up", "down", "left", "right"]) {
  const gb = trial(dx, dy, dir); if (!dialog(gb)) continue;
  hits.push(`${dx},${dy},${dir}`);
  if (!shotDir) continue;
  run(gb, {}, 60);                                   // let the first line finish typing; group NPCs by the text image
  const f = gb.ppu.rgb5; let h = 0x811c9dc5; for (let i = 0; i < f.length; i++) { h ^= f[i]; h = Math.imul(h, 16777619); }
  const key = (h >>> 0).toString(16); if (seen.has(key)) continue; seen.set(key, `${dx},${dy},${dir}`);
  const raw = Buffer.alloc(144 * 481); const fr = gb.ppu.frame;
  for (let y = 0; y < 144; y++) for (let x = 0; x < 160; x++) { const v = fr[y * 160 + x], o = y * 481 + 1 + x * 3; raw[o] = v & 255; raw[o + 1] = (v >> 8) & 255; raw[o + 2] = (v >> 16) & 255; }
  fs.writeFileSync(`${shotDir}/${dx}_${dy}_${dir}.raw`, raw);
}
console.log("start", pos(fresh()), "hits:", hits.length, "distinct:", [...seen.values()].join("  "));

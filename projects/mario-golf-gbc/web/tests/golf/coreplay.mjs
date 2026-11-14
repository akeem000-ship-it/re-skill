// The emulator core (reference only) run with a button script, for finding the way through screens the rewrite
// has not reached yet: from power-on (an empty or given save RAM) or a saved core state, presses held 6 frames,
// screenshots (PNG from the core's PPU), the map / entrance changes and the ROM routines of interest as they are
// entered, and at the end (or at --save-at) the core state and the save RAM.
// usage: node web/tests/golf/coreplay.mjs [--from out/state_X.json] [--sram out/X.sav] [--frames N]
//        [--press F:BITS ...] (bits as hJoyHeld: A 1 B 2 Sel 4 Start 8 R 10 L 20 U 40 D 80) [--repeat F0:F1:STEP:BITS ...]
//        [--recipe kid] (the presses that make out/kid.sav: a new character "Kid" saved at the mode select) [--shot F,F,...]
//        [--every N] [--shots-dir out] [--state-out out/state_Y.json] [--sram-out out/Y.sav]
//        [--save-at BB:AAAA] (stop at its first entry) [--watch BB:AAAA ...] (log entries) [--watch-write AAAA ...]
//        (log writes to a RAM address with the writer's pc and the return addresses on the stack)
//        [--or F:AAAA=VV ...] (at frame F, WRAM0 byte AAAA |= VV: a game flag set, e.g. #74 one hole only)
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { GBC } from "../../js/gb/gbc.js";
import { saveState, loadState } from "../../js/gb/state.js";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const all = n => argv.flatMap((a, i) => (a === n ? [argv[i + 1]] : []));
const ba = s => s.split(":").map(v => parseInt(v, 16));
const NAMES = ["a", "b", "select", "start", "right", "left", "up", "down"];

export function writePng(file, rgb5) {          // 160 x 144, 5-bit RGB -> 8-bit PNG
  const W = 160, H = 144, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W * 3; x++) raw[y * (W * 3 + 1) + 1 + x] = (rgb5[y * W * 3 + x] * 255 / 31) | 0;
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xFFFFFFFF; for (const v of b) c = crcT[(c ^ v) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ih), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]));
}

if (process.argv[1] && process.argv[1].endsWith("coreplay.mjs")) {
  const gb = new GBC(new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))), { audio: false });
  if (arg("--from")) loadState(gb, JSON.parse(fs.readFileSync(path.join(root, arg("--from")))).state);
  if (arg("--sram")) gb.mem.sram.set(fs.readFileSync(path.join(root, arg("--sram"))).subarray(0, gb.mem.sram.length));
  const cpu = gb.cpu, m = gb.mem;
  const presses = {};
  const RECIPES = {                              // power-on (empty save RAM): Start, one player, slot 0 (empty): the map
    // engine's new character (A through the texts, the picks and the name "Kid" given, Start to END, A), the story's
    // first scene, then the mode select, where SaveGame 02:4489 stores slot 0 (frame ~9066); stop at 9100
    // kid74: the same with game flag #74 ($C849 bit 2: a round is hole 18 only) set before the save
    kid74: { frames: 9100, presses: ["3000:8", "3300:1", "3550:1", "5030:1", "5150:8", "5200:1"], repeat: ["4000:4900:60:1", "5620:9000:60:1"], or: ["9000:C849=20"] },
    kid: { frames: 9100, presses: ["3000:8", "3300:1", "3550:1", "5030:1", "5150:8", "5200:1"], repeat: ["4000:4900:60:1", "5620:9000:60:1"] },
  };
  const recipe = RECIPES[arg("--recipe")] || { presses: [], repeat: [] };
  for (const p of [...recipe.presses, ...all("--press")]) { const [f, b] = p.split(":"); presses[+f] = parseInt(b, 16); }
  for (const p of [...recipe.repeat, ...all("--repeat")]) {
    const [f0, f1, st, b] = p.split(":");
    for (let f = +f0; f <= +f1; f += +st) presses[f] = parseInt(b, 16);
  }
  const shots = new Set((arg("--shot", "") || "").split(",").filter(Boolean).map(Number));
  const every = +arg("--every", 0), dir = arg("--shots-dir", "out"), mk = fs.mkdirSync(path.join(root, dir), { recursive: true }), frames = +arg("--frames", recipe.frames || 600);
  const watch = all("--watch").map(ba);
  const saveAt = arg("--save-at") ? ba(arg("--save-at")) : null;
  const ors = {};
  for (const p of [...(recipe.or || []), ...all("--or")]) { const [f, av] = p.split(":"); const [a, v] = av.split("="); (ors[+f] = ors[+f] || []).push([parseInt(a, 16), parseInt(v, 16)]); }
  const heldAt = f => { for (let k = 0; k < 6; k++) if (f - k in presses) return presses[f - k]; return 0; };
  const at = (b, a) => cpu.pc === a && (a < 0x4000 || m.romBank === b);
  let frame = 0, last = "";
  const ww = all("--watch-write").map(a => parseInt(a, 16));
  if (ww.length) {
    const orig = m.write.bind(m);
    m.write = (a, v) => {
      if (ww.includes(a)) {
        const st = []; for (let sp = cpu.sp, k = 0; k < 6; k++, sp += 2) st.push((m.read(sp) | m.read(sp + 1) << 8).toString(16));
        console.log(`frame ${frame}: [${a.toString(16)}] = ${v.toString(16)} at ${m.romBank.toString(16)}:${cpu.pc.toString(16)} (stack ${st.join(" ")})`);
      }
      return orig(a, v);
    };
  }
  const shoot = () => { const f = path.join(root, dir, `cp_${String(frame).padStart(5, "0")}.png`); writePng(f, gb.ppu.rgb5); };
  outer: for (;;) {
    for (const w of watch) if (at(...w)) console.log(`frame ${frame}: ${w.map(v => v.toString(16)).join(":")} a=${cpu.a.toString(16)} b=${cpu.b.toString(16)} c=${cpu.c.toString(16)} de=${(cpu.d << 8 | cpu.e).toString(16)} hl=${(cpu.h << 8 | cpu.l).toString(16)}`);
    if (saveAt && at(...saveAt)) { console.log(`at ${arg("--save-at")} (frame ${frame})`); break outer; }
    gb.ppu.frameDone = false;
    gb.stepInstruction();
    if (gb.ppu.frameDone) {
      frame++;
      const cur = `map ${m.wram[0][0x450].toString(16)} entrance ${m.wram[0][0x46A].toString(16)} mode ${m.wram[0][0x834].toString(16)}`;
      if (cur !== last) { console.log(`frame ${frame}: ${cur}`); last = cur; }
      if (shots.has(frame) || (every && frame % every === 0)) shoot();
      for (const [a, v] of ors[frame] || []) m.wram[0][a - 0xC000] |= v;
      const b = heldAt(frame), st = {};
      NAMES.forEach((n, i) => { if (b >> i & 1) st[n] = true; });
      gb.setInput(st);
      if (frame >= frames) break;
    }
  }
  shoot();
  if (arg("--state-out")) fs.writeFileSync(path.join(root, arg("--state-out")), JSON.stringify({ at: [m.romBank, cpu.pc], frame, state: saveState(gb) }));
  if (arg("--sram-out")) fs.writeFileSync(path.join(root, arg("--sram-out")), m.sram.subarray(0, 0x2000));
  console.log(`stopped at frame ${frame}, pc ${m.romBank.toString(16)}:${cpu.pc.toString(16)}`);
}

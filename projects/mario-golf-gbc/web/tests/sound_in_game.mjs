// The native sound driver against the game itself: the game runs on the CPU core from power-on with scripted
// (pseudo-random) button presses; every time the game enters the sound code (SoundInit, a sound command, the bank-0
// music helpers, the VBlank or timer sound update) the same call is made on web/js/sound/driver.js, and the
// sound-register writes the game made inside that call must equal the driver's. Writes the game makes to the sound
// registers outside the sound code are counted and listed (there should be none).
// usage: node web/tests/sound_in_game.mjs [frames=20000] [seed=1]
import { GBC } from "../js/gb/gbc.js";
import { SoundDriver } from "../js/sound/driver.js";
import { loadRom, fmtWrites } from "./sound_ref.mjs";

const [framesArg = "20000", seedArg = "1"] = process.argv.slice(2);
const FRAMES = +framesArg;
const rom = loadRom();
const gb = new GBC(rom, { audio: false });
const js = new SoundDriver(rom);
const cpu = gb.cpu, mem = gb.mem;

// the sound calls in progress (an interrupt's sound update can come inside a bank-0 helper): {name, run, writes, endSp | endPc}
const segs = [];
const foreign = [];
const apuWrite = gb.apu.write.bind(gb.apu);
gb.apu.write = (r, v) => { (segs.length ? segs[segs.length - 1].writes : foreign).push([r, v]); apuWrite(r, v); };

const h2 = v => v.toString(16).padStart(2, "0");
let checked = 0, fail = 0, frame = 0;
const counts = {};
let interrupted = 0;
function finish() {
  const s = segs.pop();
  if (segs.length) { segs[segs.length - 1].nested = true; interrupted++; }
  const want = s.writes, got = s.run();
  checked++; counts[s.name] = (counts[s.name] || 0) + 1;
  const n = Math.max(want.length, got.length);
  for (let i = 0; i < n; i++) {
    const a = got[i], b = want[i];
    if (!a || !b || a[0] !== b[0] || a[1] !== b[1]) {
      if (fail++ < 10) console.log(`FAIL frame ${frame} ${s.name}${s.nested ? " (interrupted by a sound update)" : ""}: write #${i}\n    js:   ${fmtWrites(got)}\n    game: ${fmtWrites(want)}`);
      return;
    }
  }
}
const begin = (name, run, end) => { segs.push({ name, run, writes: [], ...end }); };
const ended = s => s.endPc !== undefined ? cpu.pc === s.endPc : cpu.sp > s.endSp;
const word = a => mem.read(a) | (mem.read(a + 1) << 8);
const HELPERS = {
  0x2B54: ["ResumeBGM", () => () => js.resumeBGM()],
  0x2B6C: ["StopBGMIfPlaying", () => () => js.stopBGMIfPlaying()],
  0x2B7A: ["SyncBGMEnableFlag", () => { const o = mem.read(0xC818); return () => js.syncBGMEnableFlag(o); }],
  0x2B98: ["ApplyMusicOption", () => { const o = mem.read(0xC818); return () => js.applyMusicOption(o); }],
  0x2BBB: ["PlaySoundCmd", () => { const id = mem.read(word(cpu.sp)); return [() => js.playSound(id), id]; }],
  0x2C19: ["PlaySoundManaged", () => { const id = cpu.a; return [() => js.playSound(id), id]; }],
};

// called before each instruction
function hook() {
  const pc = cpu.pc;
  while (segs.length && ended(segs[segs.length - 1])) finish();
  const inUpdate = segs.some(s => s.update);
  if (segs.length && !(pc === 0x2F53 || pc === 0x2F79 || pc === 0x0377)) return;
  if (inUpdate) return;
  if (pc >= 0x4000) {
    if (pc === 0x4072 && mem.romBank === 0x7E) begin("SoundInit", () => js.init(), { endSp: cpu.sp });
    else if ((pc === 0x4016 || pc === 0x4022 || pc === 0x40EB) && mem.romBank === 0x7E)
      console.log(`unexpected call of 7E:${pc.toString(16)} at frame ${frame}`);
    return;
  }
  if (pc === 0x2F53) {                         // VBlankHandler: farcall SoundUpdate, then ResumeBGMAfterJingle
    const h = word(0xCAAB);
    begin("VBlank sound", () => { js.setBallHeight(h); return js.frame(); }, { endPc: 0x2F59, update: true });
  } else if (pc === 0x2F79) {                  // TimerHandler with the LCD off
    const h = word(0xCAAB);
    begin("Timer sound", () => { js.setBallHeight(h); return js.update(); }, { endPc: 0x2F7C, update: true });
  } else if (pc === 0x0377) {                  // EnableLCD: one SoundUpdate
    const h = word(0xCAAB);
    begin("EnableLCD sound", () => { js.setBallHeight(h); return js.update(); }, { endPc: 0x037A, update: true });
  } else if (pc === 0x2C35) {
    begin("WaitJingleEnd tail", () => js.endJingle(), { endPc: 0x2C45 });
  } else if (HELPERS[pc]) {
    const [name, mk] = HELPERS[pc];
    let run = mk(), label = name;
    if (Array.isArray(run)) { label = `${name} $${h2(run[1])}`; run = run[0]; }
    begin(label, run, { endSp: cpu.sp });
  }
}

let x = (+seedArg * 2654435761) >>> 0;
const rnd = n => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x % n; };
const KEYS = ["a", "a", "a", "b", "start", "start", "up", "down", "left", "right", "select"];
let input = {}, hold = 0;
const ppu = gb.ppu;
for (frame = 0; frame < FRAMES; frame++) {
  if (hold-- <= 0) {
    input = {};
    if (rnd(3)) input[KEYS[rnd(KEYS.length)]] = true;
    hold = 2 + rnd(20);
  }
  gb.setInput(input);
  ppu.frameDone = false; ppu.frameStart = false;
  let guard = 0;
  while (!ppu.frameStart && guard++ < 4000000) { hook(); gb.stepInstruction(); }
  gb.frames++;
}
console.log(`${checked} sound calls checked over ${FRAMES} frames: ` +
  Object.entries(counts).sort().map(([k, v]) => `${k} x${v}`).join(", "));
console.log(`writes to the sound registers outside the sound code: ${foreign.length}` + (foreign.length ? ` (first: ${fmtWrites(foreign.slice(0, 8))})` : ""));
console.log(`helpers interrupted by a sound update: ${interrupted}`);
console.log(fail ? `${fail} calls differ` : "all identical");
process.exit(fail ? 1 : 0);

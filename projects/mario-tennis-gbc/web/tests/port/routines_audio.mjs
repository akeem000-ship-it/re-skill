// Routine tests for web/js/port/audio, the sound driver (run by web/tests/port_routines.mjs; filter "Snd" or a name).
//
// APU check. The harness compares RAM; the driver's output is its APU register writes. So every entry here runs
// through apuChecked(): before the port runs, the machine (identical to the core's at that point) is copied to a
// private reference core, the ROM routine runs there too, and the APU writes of both (register, value, in order)
// and the APU's state afterwards must be the same; otherwise the entry fails with an "exception" naming the first
// differing write. (Neither machine steps its APU here: both are built with audio off, so its state changes only
// by register writes.)
//
// Code stubs. Sequences (a sound started, then N driver ticks; the rst $08 request) run as a few bytes of SM83 code
// written by prep into the stack page ($CF00-$CFFF: not compared, identical on both machines), which call the
// routines; ROM and port run the same stub, the port through its hooks. Scripts for the command tests are put
// there too (a channel's track address may be anywhere). Interrupts are disabled (IE = 0) for stubs: the port's
// CPU steps the hardware as it runs stub code, the reference's does not.
import { newCore } from "../engine/corpus.mjs";
import { romCall } from "../engine/romcall.mjs";
import { cloneMachine, applyMachine } from "./machine.mjs";
import { hookKey } from "../../js/port/port.js";

const ref = await newCore({ recomp: false });

// ---- the APU check ----
function recordWrites(apu) {
  const log = [];
  apu.write = function (r, v) { log.push((r << 8) | (v & 0xFF)); return Object.getPrototypeOf(this).write.call(this, r, v); };
  return log;
}
// the first difference of the APU's state (registers, wave RAM, power, the channels' internal state), or null
function apuDiff(a, b) {
  for (let i = 0; i < 0x30; i++) if (a.reg[i] !== b.reg[i]) return `reg ff${i.toString(16)} rom ${a.reg[i]} js ${b.reg[i]}`;
  for (let i = 0; i < 16; i++) if (a.wave[i] !== b.wave[i]) return `wave ${i} rom ${a.wave[i]} js ${b.wave[i]}`;
  if (a.on !== b.on || a.fsStep !== b.fsStep) return "power/sequencer";
  // (not ch.timer: machine.mjs does not copy fields named "timer", so it is stale from earlier runs)
  for (let c = 0; c < 4; c++) for (const k of Object.keys(a.ch[c])) if (k !== "timer" && a.ch[c][k] !== b.ch[c][k]) return `ch${c}.${k} rom ${a.ch[c][k]} js ${b.ch[c][k]}`;
  return null;
}
const fmtW = w => (w === undefined ? "none" : `ff${(w >> 8).toString(16)}=${(w & 0xFF).toString(16)}`);
function apuChecked(R) {
  return {
    ...R,
    js(P, regs) {
      if (R.addr < 0x8000 && !P.hooks.has(hookKey(R.bank, R.addr))) throw new Error("no port hooked");
      applyMachine(ref, cloneMachine(P.gb));
      const bank = P.gb.mem.svbk;
      const romLog = recordWrites(ref.apu), portLog = recordWrites(P.gb.apu);
      let ret;
      try {
        romCall(ref, R.bank, R.addr, regs, { wramBank: bank });
        P.cpu.halted = false;                                       // (as romCall does: the states are taken in a halt)
        ret = P.callRom(R.bank, R.addr, regs);
      } finally { delete ref.apu.write; delete P.gb.apu.write; }
      const n = Math.max(romLog.length, portLog.length);
      for (let i = 0; i < n; i++) {
        if (romLog[i] !== portLog[i]) throw new Error(`APU write #${i}: rom ${fmtW(romLog[i])} js ${fmtW(portLog[i])} (${romLog.length}/${portLog.length} writes)`);
      }
      const d = apuDiff(ref.apu, P.gb.apu);
      if (d) throw new Error(`APU ${d}`);
      return ret;
    },
  };
}

// ---- machine helpers for prep (mem: the emulator's Memory) ----
const W7 = (mem, addr, v) => { mem.wram[7][addr - 0xD000] = v & 0xFF; };
const R7 = (mem, addr) => mem.wram[7][addr - 0xD000];
const HR = (mem, addr, v) => { mem.hram[addr - 0xFF80] = v & 0xFF; };
const HRr = (mem, addr) => mem.hram[addr - 0xFF80];
const W0 = (mem, addr, v) => { mem.wram[0][addr - 0xC000] = v & 0xFF; };
const poke = (mem, addr, bytes) => bytes.forEach((b, i) => { mem.wram[0][addr - 0xC000 + i] = b & 0xFF; });
const BLOCK = c => 0xD100 + c * 0x20;
const SLOTS = 0xD1C0;
const hActiveJingle = 0xFFCD, hMusic = 0xFFCE, wCurrentBGM = 0xC33E, hSoundEngineBusy = 0xFFD2;
const STUB = 0xCF80, SCRIPT = 0xCF00, SFX_SCRIPT = 0xCF60;

// a deterministic generator per (state, entry), so that prep makes the same changes on both machines
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0; let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const seedOf = (s, k) => (s.f * 2654435761 + k * 40503 + (s.rec.length << 20)) >>> 0;
const pick = (r, a) => a[Math.floor(r() * a.length)];
const rb = r => Math.floor(r() * 256);
// every n-th state (the harness asks in corpus order)
const every = (n, off = 0) => { let i = 0; return () => (i++ % n) === off; };

// stubs: `call` the routine at addr with a = id (if given), then `ticks` calls of UpdateSoundEngine
function stub(mem, { call = null, id = null, rst = null, ticks = 0 }) {
  const code = [];
  if (rst !== null) code.push(0xCF, rst);                         // rst $08 ; db id
  if (call !== null) { if (id !== null) code.push(0x3E, id); code.push(0xCD, call & 0xFF, call >> 8); }
  if (ticks) code.push(0x06, ticks, 0xC5, 0xCD, 0x1A, 0x2F, 0xC1, 0x05, 0x20, 0xF8);   // ld b,n ; push bc ; call UpdateSoundEngine ; pop bc ; dec b ; jr nz
  code.push(0xC9);
  poke(mem, STUB, code);
  mem.ie = 0;
  HR(mem, hSoundEngineBusy, 0);
}

// a channel set to run `script` (at SCRIPT) from its next tick: command index 1, track address SCRIPT - 2
function injectScript(mem, c, type, script, at = SCRIPT) {
  const b = BLOCK(c);
  poke(mem, at, script);
  W7(mem, b + 0x00, 1); W7(mem, b + 0x01, 0);
  W7(mem, b + 0x02, (R7(mem, b + 0x02) & 0xF0) | type);
  W7(mem, b + 0x03, (at - 2) & 0xFF); W7(mem, b + 0x04, (at - 2) >> 8);
  W7(mem, b + 0x06, R7(mem, b + 0x06) & 0xF0);                    // tick rate 0: no skipped ticks
  W7(mem, b + 0x07, 0);
  W7(mem, b + 0x09, 0);                                           // the note is over: the script runs now
  W7(mem, b + 0x1B, 0);                                           // no echo
}

const ENTRIES = [];
const add = R => ENTRIES.push(apuChecked(R));
// routines that end in PlaySound's `ei`: on the ROM a pending interrupt would be taken before it returns
const noIrq = (prep = null) => (mem, s) => { if (prep) prep(mem, s); mem.ie = 0; };

// ---- UpdateSoundEngine: every state as recorded ----
const REGS = ["a", "b", "c", "d", "e", "h", "l"];
add({ name: "Snd UpdateSoundEngine", bank: 0, addr: 0x2F1A, out: REGS });
add({ name: "Snd UpdateSoundEngine busy", bank: 0, addr: 0x2F1A, out: [...REGS, "f"], when: every(5), prep(mem) { HR(mem, hSoundEngineBusy, 3); } });
add({ name: "Snd RunSoundEngine", bank: 0, addr: 0x3373, out: REGS, when: every(3) });
add({ name: "Snd UpdateSoundEngine x24", bank: 1, addr: STUB, when: every(4), prep(mem) { stub(mem, { ticks: 24 }); } });

// ---- UpdateSoundEngine with the channels' state scrambled (envelopes, slides, echo, vibrato, gates, update
// requests, wave reloads): the real scripts go on from wherever they are ----
for (let k = 0; k < 8; k++) {
  add({
    name: `Snd UpdateSoundEngine fuzz ${k}`, bank: 0, addr: 0x2F1A, out: REGS, when: every(2, k & 1),
    prep(mem, s) {
      const r = rng(seedOf(s, k + 1));
      for (let c = 0; c < 6; c++) {
        const b = BLOCK(c), ptr = R7(mem, b) | R7(mem, b + 1) << 8;
        if (ptr === 0xFFFF) continue;
        const f = (o, v) => { if (r() < 0.5) W7(mem, b + o, v); };
        f(0x02, (R7(mem, b + 2) & 0x0F) | (rb(r) & 0xF0));       // vibrato depth
        f(0x06, rb(r)); f(0x07, rb(r) & 0x0F);                     // duty, tick rate, accumulator
        f(0x08, rb(r));                                            // volume
        f(0x09, pick(r, [0, 1, 2, rb(r)]));                        // note timer
        f(0x0A, rb(r)); f(0x0B, pick(r, [0xFF, 0xFE, 0, 3, rb(r)]));
        f(0x0D, pick(r, [0, 0x10, 0x20, 0x30, rb(r) & 0xF0])); f(0x0E, pick(r, [0, 4, 8, 0x13, 0x47, rb(r)])); f(0x0F, rb(r) & 0x1F);
        f(0x10, pick(r, [0, 1, 3, 0xFF, 0xFD, rb(r)])); f(0x11, pick(r, [1, 2, 5])); f(0x12, pick(r, [1, 2, 0]));
        f(0x13, rb(r)); f(0x14, pick(r, [0x80, 0x00, 0xA3, 0x25, rb(r)]));
        f(0x15, rb(r)); f(0x16, rb(r)); f(0x17, rb(r) & 0x1F); f(0x18, pick(r, [0, 1, 3]));
        // instrument: only 0 is in the game's tables; other envelope tables are bytes of ROM. (Other wave pattern
        // sets would be pointers anywhere, the stack too, which differs between the ROM and the port.)
        f(0x19, pick(r, [0, 0, 0, rb(r) & 0x0F]));
        f(0x1A, pick(r, [0, 1, 2, 3])); f(0x1B, pick(r, [0, 0, 0xF2, 0xF3, 0xF1, 0xF0]));
        f(0x1F, pick(r, [0, 1, 2, rb(r)]));
      }
      if (r() < 0.3) { W7(mem, 0xD212, rb(r) & 0x3F); W7(mem, 0xD213, rb(r)); W7(mem, 0xD214, pick(r, [0, 0xFF, rb(r)])); }
      if (r() < 0.4) W7(mem, 0xD219, 0xFF);                        // wSndWaveReloadPending
      if (r() < 0.4) W7(mem, 0xD217, rb(r));                       // wSndLoadedWaveId
      if (r() < 0.5) W7(mem, 0xD20E, rb(r));                       // wSndFrameCounter
      if (r() < 0.3) W7(mem, 0xD209, rb(r));                       // wSndPanShadow
      if (r() < 0.2) W7(mem, 0xD215, pick(r, [1, 2, 5]));          // wSndFirstChannel
      if (r() < 0.1) mem.apu.write(0x26, 0);                       // the APU off: its writes are dropped
    },
  });
}

// ---- every script command, on each APU channel, on an effect channel (1), a music channel (3), and a music
// channel whose APU channel an effect (channel 0) drives ----
const N = [0x24, 0x01], END = [0xFF, 0x00];
const SCRIPTS = [
  ["volume", [0xA0, 0x7A, ...N, ...END]],
  ["volume 0", [0xA0, 0x80, 0xA0, 0x00, ...N, ...END]],
  ["wave", [0xA1, 0x03, ...N, ...END]],
  ["wave same", [0xA1, 0x00, ...N, ...END], (mem, c) => { W7(mem, BLOCK(c) + 0x0A, 0); W7(mem, 0xD217, 0); }],
  ["duty", [0xA2, 0x02, 0xA2, 0x81, ...N, ...END]],
  ["vibrato", [0xA3, 0x21, 0x30, 0x06, ...END], (mem, c) => W7(mem, 0xD20E, 0x0D)],
  ["vibrato deep", [0xA3, 0xE0, 0x30, 0x06, ...END]],
  ["vibrato off", [0xA3, 0xFE, ...N, ...END]],
  ["gate", [0xA4, 0x02, 0x30, 0x04, ...END]],
  ["gate neg", [0xA4, 0xFD, 0x30, 0x05, 0x32, 0x02, ...END]],
  ["gate len0", [0xA4, 0xFF, 0x30, 0x00, ...N, ...END]],
  ["pan", [0xA5, 0x5A, ...N, ...END]],
  ["pan swap", [0xA5, 0x01, ...N, ...END]],
  ["master volume", [0xA6, 0x55, ...N, ...END]],
  ["glide", [0xA7, 0x02, ...N, ...END]],
  ["instrument", [0xA8, 0x00, 0xC3, 0x18, 0xA0, 0x80, 0x30, 0x08, ...END]],
  ["instrument 2", [0xA8, 0x00, 0xC1, 0x27, 0xA0, 0x50, 0x30, 0x08, ...END]],
  ["transpose", [0xA9, 0x05, 0xA9, 0x85, 0xA9, 0xF0, 0xA9, 0xF1, 0xA9, 0xF2, 0xA9, 0xF3, 0xA9, 0xF0, 0xA9, 0xF2, ...N, ...END]],
  ["transpose table", [0xA9, 0xFF, 0x04, 0x00, 0x05, 0x00, ...N, 0x35, 0x01, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x0C, 0)],
  ["transpose table 1", [0xA9, 0xFF, 0x04, 0x00, 0x05, 0x00, ...N, 0x35, 0x01, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x0C, 1)],
  ["global transpose table", [0xA9, 0xFE, 0x04, 0x00, 0x05, 0x00, ...N, 0x35, 0x01, ...END], mem => W7(mem, 0xD218, 1)],
  ["echo", [0xAA, 0x23, 0x30, 0x06, ...N, ...END]],
  ["echo 3", [0xAA, 0x3F, 0x40, 0x05, 0x30, 0x02, ...END]],
  ["echo off", [0xAA, 0x05, ...N, ...END]],
  ["skip ab", [0xAB, 0x12, ...N, ...END]],
  ["call", [0xAC, 0x02, 0x08, 0x00, ...N, 0x30, 0x01, 0xAD, 0x00, ...END]],
  ["call last", [0xAC, 0x02, 0x08, 0x00, ...N, 0x30, 0x01, 0xAD, 0x00, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x1C, 1)],
  ["call again", [0xAC, 0x02, 0x08, 0x00, ...N, 0x30, 0x01, 0xAD, 0x00, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x1C, 3)],
  ["return", [0xAD, 0x00, ...N, ...END], (mem, c) => { W7(mem, BLOCK(c) + 0x1D, 2); W7(mem, BLOCK(c) + 0x1E, 0); }],
  ["tone flag", [0xAE, 0x10, ...N, 0xAE, 0x00, ...N, ...END]],
  ["tick rate", [0xAF, 0x08, 0x24, 0x03, ...END]],
  ["jump", [0xB0, 0xF1, ...N, ...END]],
  ["jump skip", [0xB0, 0x01, ...N, ...END]],
  ["loop", [0xB2, 0xF1, ...N, 0x30, 0x01, ...END]],
  ["loop point", [0xFD, 0xF2, ...N, 0xB1, 0xF2, ...END]],
  ["envelope", [0xC5, 0x10, 0x24, 0x08, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x08, 0xA0)],
  ["envelope 3", [0xC3, 0x46, 0x24, 0x08, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x08, 0x70)],
  ["envelope vol", [0xC5, 0x10, 0x24, 0x08, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x08, 0xA3)],
  ["slide up", [0xD3, 0x02, 0x24, 0x08, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x08, 0x30)],
  ["slide down", [0xE3, 0x01, 0x24, 0x08, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x08, 0x20)],
  ["slide top", [0xD2, 0x01, 0x24, 0x08, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x08, 0xE0)],
  ["unknown f", [0xF5, 0x00, ...N, ...END]],
  ["end", [...END]],
  ["hold", [0x2C, 0x02, 0x2F, 0x02, ...END]],
  ["hold silent", [0x2C, 0x02, ...END], (mem, c) => W7(mem, BLOCK(c) + 0x14, 0x80)],
  ["noise notes", [0x03, 0x01, 0x1F, 0x01, 0x45, 0x01, 0x0F, 0x01, ...END]],
  ["octaves", [0x00, 0x01, 0x1B, 0x01, 0x7B, 0x01, 0x6A, 0x01, ...END]],
  ["octaves alt", [0xAE, 0x10, 0x00, 0x01, 0x1B, 0x01, 0x7B, 0x01, ...END]],
];
// loop slots for the jump/loop scripts: slot 1 of the channel = (passes, command index)
const slotPrep = (mem, c, r) => {
  const s1 = SLOTS + c * 12 + 3;
  W7(mem, s1, pick(r, [0, 1, 2])); W7(mem, s1 + 1, 2); W7(mem, s1 + 2, 0);
};
const CHANNEL_CASES = [];
for (const type of [0, 1, 2, 3]) {
  CHANNEL_CASES.push({ tag: `sfx t${type}`, c: 1, type, under: false });
  CHANNEL_CASES.push({ tag: `bgm t${type}`, c: 3, type, under: false });
  CHANNEL_CASES.push({ tag: `bgm+sfx t${type}`, c: 3, type, under: true });
}
SCRIPTS.forEach(([cmd, script, extra], si) => {
  for (const cc of CHANNEL_CASES) {
    add({
      name: `Snd cmd ${cmd} ${cc.tag}`, bank: 1, addr: STUB, when: every(40, (si * 7 + cc.c + cc.type) % 40),
      prep(mem, s) {
        const r = rng(seedOf(s, 1000 + si));
        stub(mem, { ticks: 8 });
        injectScript(mem, cc.c, cc.type, script);
        if (cc.under) injectScript(mem, 0, cc.type, [0x30, 0x04, ...END], SFX_SCRIPT);
        else if (cc.c === 3) W7(mem, BLOCK(0), 0xFF), W7(mem, BLOCK(0) + 1, 0xFF), W7(mem, BLOCK(1), 0xFF), W7(mem, BLOCK(1) + 1, 0xFF);
        slotPrep(mem, cc.c, r);
        if (extra) extra(mem, cc.c);
        // the block's working copy is in WRAM; a few fields picked at random as well
        if (r() < 0.5) W7(mem, BLOCK(cc.c) + 0x14, pick(r, [0x80, 0xA4, 0x26]));
        if (r() < 0.3) W7(mem, BLOCK(cc.c) + 0x0D, 0x10), W7(mem, BLOCK(cc.c) + 0x0E, 0x08);
        if (r() < 0.3) mem.apu.write(0x1A, 0);                     // the wave channel off (AUD3ENA): NR52 bit 2 clear
      },
    });
  }
});

// ---- starting sounds: PlaySound (00:3297) for every id, then ticks of the driver. (Only the ids the index tables
// define, songs $01-$32 and effects $51-$C1: ids past them read code as table entries, whose "tracks" can be
// anywhere, I/O registers too, and the timer runs on in the port's stub code but not in the reference's.) ----
for (let id = 0; id < 0xC2; id++) {
  if (id > 0x32 && id < 0x50) continue;
  add({ name: `Snd PlaySound ${id.toString(16)}`, bank: 1, addr: STUB, when: every(97, id % 97), prep(mem) { stub(mem, { call: 0x3297, id, ticks: 40 }); } });
}
add({ name: "Snd PlaySound direct", bank: 0, addr: 0x3297, out: ["a"], when: every(3), prep: noIrq(), regs: s => ({ a: [0, 0x50, 0x0A, 0x23, 0x61, 0xC0][s.f % 6] }) });

// ---- sound requests: PlaySoundManaged (a = id) and rst $08 (the id after the rst), with the music muted or not,
// a jingle on or not, the id the current song or not ----
const REQUEST_IDS = [0x00, 0x01, 0x05, 0x0C, 0x23, 0x3F, 0x40, 0x41, 0x45, 0x48, 0x4F, 0x50, 0x51, 0x7A, 0xB3, 0xFF];
for (const id of REQUEST_IDS) {
  for (const v of [0, 1, 2, 3]) {
    const prep = (mem, s) => {
      if (v & 1) HR(mem, hMusic, HRr(mem, hMusic) | 1); else HR(mem, hMusic, HRr(mem, hMusic) & 0xFE);
      HR(mem, hActiveJingle, v & 2 ? 0x41 : 0);
      if (s.f & 1) W0(mem, wCurrentBGM, id);
    };
    add({ name: `Snd PlaySoundManaged ${id.toString(16)} v${v}`, bank: 1, addr: STUB, when: every(150, (id + v * 37) % 150), prep(mem, s) { prep(mem, s); stub(mem, { call: 0x3024, id, ticks: 6 }); } });
    add({ name: `Snd rst08 ${id.toString(16)} v${v}`, bank: 1, addr: STUB, when: every(150, (id * 3 + v * 11 + 5) % 150), prep(mem, s) { prep(mem, s); stub(mem, { rst: id, ticks: 2 }); } });
  }
}
add({ name: "Snd PlaySoundManaged direct", bank: 0, addr: 0x3024, out: REGS, when: every(3), prep: noIrq(), regs: s => ({ a: [0, 0x50, 0x0A, 0x23, 0x42, 0x61][s.f % 6] }) });

// ---- the music channels idle, the jingle's end, stopping, init ----
const musicIdle = (mem, s) => { for (let c = 2; c < 6; c++) if ((s.f >> c) & 1 || s.f % 3 === 0) { W7(mem, BLOCK(c), 0xFF); W7(mem, BLOCK(c) + 1, 0xFF); } };
add({ name: "Snd CheckMusicChannelsIdle", bank: 0, addr: 0x3110, out: [...REGS, "f"], when: every(2), prep: musicIdle });
add({
  name: "Snd ResumeBGMAfterJingle", bank: 0, addr: 0x305D, out: [...REGS, "f"], when: every(2),
  prep: noIrq((mem, s) => { musicIdle(mem, s); HR(mem, hActiveJingle, s.f & 4 ? 0 : 0x42); HR(mem, hMusic, (HRr(mem, hMusic) & 0xFE) | (s.f >> 3 & 1)); }),
});
add({
  name: "Snd ResumeBGMAfterJingle x8", bank: 1, addr: STUB, when: every(3),
  prep(mem, s) { musicIdle(mem, s); HR(mem, hActiveJingle, 0x42); HR(mem, hMusic, HRr(mem, hMusic) & 0xFE); stub(mem, { call: 0x305D, ticks: 8 }); },
});
// WaitJingleEnd (00:302A) waits for frames while a jingle plays; only its no-jingle path returns at once
add({ name: "Snd WaitJingleEnd idle", bank: 0, addr: 0x302A, out: [...REGS, "f"], when: every(5), prep(mem) { HR(mem, hActiveJingle, 0); } });
add({ name: "Snd StopMusic", bank: 0, addr: 0x3129, out: REGS, when: every(4) });
add({ name: "Snd InitAudioEngine", bank: 0, addr: 0x3078, out: REGS, when: every(4) });
add({ name: "Snd SetChannelUpdateRequest", bank: 0, addr: 0x30B4, out: ["a", "f"], when: every(4), regs: s => ({ b: s.f & 0x3F, c: s.f >> 3 & 0xFF }) });

// ---- the music on/off helpers (view_00.asm) ----
const muted = on => mem => HR(mem, hMusic, (HRr(mem, hMusic) & 0xFE) | on);
for (const on of [0, 1]) {
  add({ name: `Snd ResumeBGM m${on}`, bank: 0, addr: 0x2F32, out: REGS, when: every(5), prep: noIrq(muted(on)) });
  add({ name: `Snd StopBGMIfPlaying m${on}`, bank: 0, addr: 0x2F52, out: [...REGS, "f"], when: every(5), prep: noIrq(muted(on)) });
  add({ name: `Snd SyncBGMEnableFlag o${on}`, bank: 0, addr: 0x2F60, out: REGS, when: every(5), prep: noIrq(mem => W0(mem, 0xC8A3, on)) });
  add({ name: `Snd SetMusicMuted ${on}`, bank: 0, addr: 0x2F86, out: REGS, when: every(5), prep: noIrq(), regs: () => ({ a: on | 0x20 }) });
}

export const ROUTINES = ENTRIES;

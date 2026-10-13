// Routine tests for web/js/port/match (run by web/tests/port_routines.mjs).
// The engine's hooks (web/js/port/match/engine_hooks.js) are checked with the engine's own routine list
// (web/tests/engine/routines*.mjs: the same forced branches), here on the whole machine: every byte of RAM,
// VRAM, OAM, the sound driver and the I/O the ROM routine touches must come out the same.
import fs from "fs";

// a state in match play: the game waits in AdvanceFrame called from bank $08, on a court
export const inMatch = s => s.m.mem.romBank === 8 && s.map <= 15;
// a routine run with WRAM bank `wram` mapped the ROM's way (rSVBK and hWramBank), and no interrupt pending or
// enabled: the states are taken at the VBlank, and ROM code that ends with `ei` (FarReadWordDI) would take it
export const quiet = m => { m.iflag = 0; m.ie = 0; };
const mapBank = (R, prep) => (m, s) => { quiet(m); if (R.wram !== undefined) m.hram[0x16] = R.wram; if (prep) prep(m, s); };
// the port's side run as romcall.mjs runs the ROM's: the CPU awake and IME off. The states are taken in the halt
// at the VBlank, with the VBlank pending: with the state's IME the first instruction a hook runs in the ROM (a
// sound request) would take it.
export const callHook = (bank, addr) => (P, regs) => { P.cpu.halted = false; P.ime = false; return P.callRom(bank, addr, regs); };
// the registers an engine entry's out(ret) names (called on a stand-in value)
const any = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any) });
const outRegs = R => (R.out ? Object.keys(R.out(any)) : []);

const ENGINE = [];
const dir = new URL("../engine/", import.meta.url);
for (const f of fs.readdirSync(dir).filter(f => /^routines.*\.mjs$/.test(f)).sort())
  for (const R of (await import(new URL(f, dir))).ROUTINES)
    ENGINE.push({ name: "engine " + R.name, bank: R.bank, addr: R.addr, wram: R.wram, regs: R.regs, prep: mapBank(R, R.prep), out: outRegs(R), when: inMatch, js: callHook(R.bank, R.addr) });

export const ROUTINES = [...ENGINE];

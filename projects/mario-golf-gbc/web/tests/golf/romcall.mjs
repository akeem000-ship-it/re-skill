// Run one ROM routine on the emulator core's interpreter (web/js/gb, tests only) with the golf engine's RAM:
// used to check engine ports routine by routine against the real code on random inputs.
import fs from "fs";
import path from "path";
import { GBC } from "../../js/gb/gbc.js";
import { coverStep } from "./cover.mjs";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
export const romBytes = () => new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc")));
export function newCore() { return new GBC(romBytes(), { audio: false }); }

// the core's RAM <- GolfMemory w (WRAM banks and HRAM), WRAM bank 6 mapped
export function loadCore(gb, w) {
  for (let i = 0; i < 8; i++) gb.mem.wram[i].set(w.wram[i]);
  gb.mem.hram.set(w.high.subarray(0x180, 0x1FF));
  gb.mem.svbk = 6; gb.mem.hram[0x16] = 6;
}

const SENTINEL = 0xFFF0;
// regs: {a, b, c, d, e, h, l}; returns the registers after the routine returns
export function romCall(gb, bank, addr, regs = {}, maxSteps = 20_000_000) {
  const cpu = gb.cpu, m = gb.mem;
  if (addr >= 0x4000) { m.romBank = bank; m.updateRom(); m.hram[0x15] = bank; }
  for (const r of ["a", "b", "c", "d", "e", "h", "l"]) if (r in regs) cpu[r] = regs[r] & 0xFF;
  cpu.ime = false; cpu.halted = false;
  if ("eiPending" in cpu) cpu.eiPending = false;
  cpu.sp = 0xCFF0;
  cpu.sp = (cpu.sp - 2) & 0xFFFF; m.write(cpu.sp, SENTINEL & 0xFF); m.write(cpu.sp + 1, SENTINEL >> 8);
  cpu.pc = addr;
  let n = 0;
  while (cpu.pc !== SENTINEL) { coverStep(gb); cpu.step(); if (++n > maxSteps) throw new Error(`romCall ${bank.toString(16)}:${addr.toString(16)} did not return`); }
  return { a: cpu.a, b: cpu.b, c: cpu.c, d: cpu.d, e: cpu.e, h: cpu.h, l: cpu.l, bc: cpu.b << 8 | cpu.c, de: cpu.d << 8 | cpu.e, hl: cpu.h << 8 | cpu.l };
}

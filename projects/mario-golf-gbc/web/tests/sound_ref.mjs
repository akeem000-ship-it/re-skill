// Reference for the native sound driver: the game's own sound code run on the CPU core (web/js/gb), with the entry
// points called the way the game calls them, recording every sound-register write (FF10-FF3F) in order.
//   init()        SoundInit 7E:4072 (as Start farcalls it)
//   playSound(id) PlaySoundManaged 00:2C19 with a = id (the same code as `rst $08 ; db id`, PlaySoundCmd 00:2BBB)
//   playSong(n)   SoundCmdDispatch 7E:4016 with a = n
//   frame()       what VBlankHandler does for sound: farcall 7E:40EB SoundUpdate, then ResumeBGMAfterJingle 00:2C4A
// Each returns the writes as [register $10-$3F, value] pairs. Used by web/tests/sound_vs_core.mjs.
// As a script it prints one song's or effect's writes per frame:
//   node web/tests/sound_ref.mjs song 5 [frames]  |  node web/tests/sound_ref.mjs sfx 0x1A [frames]
import fs from "fs";
import path from "path";
import { GBC } from "../js/gb/gbc.js";

export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
export function loadRom() { return new Uint8Array(fs.readFileSync(path.join(root, "rom/mario_golf.gbc"))); }

const SENTINEL = 0xFEA0;          // unusable memory: a return address no game code ever runs at
const hROMBank = 0xFF95;

export class RomSound {
  constructor(rom) {
    this.gb = new GBC(rom, { audio: false });
    const gb = this.gb, apu = gb.apu, write = apu.write.bind(apu);
    this.out = [];
    apu.write = (r, v) => { this.out.push([r, v]); write(r, v); };
    gb.mem.ie = 0; gb.cpu.ime = false;
    gb.cpu.sp = 0xDFF0;
  }
  take() { const o = this.out; this.out = []; return o; }
  // call bank:addr with register a, as a far call would (bank mapped, hROMBank set), until it returns
  call(bank, addr, a = 0) {
    const gb = this.gb, c = gb.cpu, m = gb.mem;
    m.romBank = bank; m.updateRom(); m.hram[hROMBank - 0xFF80] = bank;
    c.a = a; c.push(SENTINEL); c.pc = addr; c.halted = false;
    let n = 0;
    while (c.pc !== SENTINEL) {
      gb.stepInstruction();
      if (++n > 5000000) throw new Error(`ROM call ${bank.toString(16)}:${addr.toString(16)} does not return`);
    }
  }
  init() { this.call(0x7E, 0x4072); return this.take(); }
  playSound(id) { this.call(0x01, 0x2C19, id & 0xFF); return this.take(); }
  playSong(n) { this.call(0x7E, 0x4016, n & 0xFF); return this.take(); }
  setBallHeight(h) { const w = this.gb.mem.wram[0]; w[0xAAB] = h & 0xFF; w[0xAAC] = (h >> 8) & 0xFF; }
  frame() { this.call(0x7E, 0x40EB); this.call(0x01, 0x2C4A); return this.take(); }
  ram(addr) { return this.gb.mem.read(addr); }
}

export const fmtWrites = ws => ws.map(([r, v]) => `${(0xFF00 + r).toString(16)}=${v.toString(16).padStart(2, "0")}`).join(" ");

if (process.argv[1] && process.argv[1].endsWith("sound_ref.mjs")) {
  const [kind = "song", idArg = "1", framesArg = "600"] = process.argv.slice(2);
  const s = new RomSound(loadRom());
  console.log("init:", fmtWrites(s.init()));
  const id = parseInt(idArg);
  console.log("cmd:", fmtWrites(kind === "sfx" ? s.playSound(0x40 + id) : s.playSound(id)));
  for (let f = 0; f < +framesArg; f++) { const w = s.frame(); if (w.length) console.log(f, fmtWrites(w)); }
}

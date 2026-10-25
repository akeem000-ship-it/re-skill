// The golf engine's memory: the Game Boy RAM the ROM's golf code works on, in the ROM's own layout, so every
// fixed-point quirk behaves the same and a state can be copied in from, or compared with, the running game.
//   wram[0]     $C000-$CFFF (round and player records at $C800-$C8FF; the frame task table at $C1C0)
//   wram[1..7]  $D000-$DFFF per bank (WRAM6 holds the shot: the ball at $D400, the swing, the green maps)
//   high        $FE00-$FFFF (HRAM: hJoyHeld $FF90 .. hJoyPressed $FF94, the repeat rate $FFA6)
// The ball state is passed around as ball(w) = WRAM6 $D400-$D4FF (a view: offsets in it are from $D400).

export class GolfMemory {
  constructor() {
    this.wram = Array.from({ length: 8 }, () => new Uint8Array(0x1000));
    this.high = new Uint8Array(0x200);
    this.sram = new Uint8Array(0x2000);
    this.tasks = null;                      // which frame tasks run (shot.js), set from the task table
  }
  // a snapshot as tools/emu_shot_record.py writes it: hex strings wram0-7, high, sram
  loadSnapshot(snap) {
    const hex = (s, n) => { const b = new Uint8Array(n); for (let i = 0; i < n; i++) b[i] = parseInt(s.substr(2 * i, 2), 16); return b; };
    for (let i = 0; i < 8; i++) if (snap["wram" + i]) this.wram[i].set(hex(snap["wram" + i], 0x1000));
    if (snap.high) this.high.set(hex(snap.high, 0x200));
    if (snap.sram) this.sram.set(hex(snap.sram, 0x2000));
    this.tasks = null;
    return this;
  }
  // from the emulator core's memory (web/js/gb, tests only): WRAM banks and HRAM
  loadFromCore(mem) {
    for (let i = 0; i < 8; i++) this.wram[i].set(mem.wram[i].subarray(0, 0x1000));
    this.high.fill(0); this.high.set(mem.hram, 0x180);
    this.tasks = null;
    return this;
  }
}

export const ball = w => w.wram[6].subarray(0x400, 0x500);
export const rd16 = (s, o) => s[o] | s[o + 1] << 8;
export const wr16 = (s, o, v) => { s[o] = v & 0xFF; s[o + 1] = (v >> 8) & 0xFF; };
// 10:4B14 PlayerField: the WRAM0 offset of the current player's ($C835) record byte f (records at $C880 / $C8C0)
export const playerField = (w, f) => 0x880 + f + (w.wram[0][0x835] ? 0x40 : 0);

// a CPU read as the game's code would see it with ROM bank `bank` and WRAM bank 6 mapped (for tables the code
// reads with addresses that run past their end); VRAM and SRAM are not modelled
import { rb as romByte } from "./rom.js";
export function busRead(w, bank, a) {
  a &= 0xFFFF;
  if (a < 0x8000) return romByte(a < 0x4000 ? 0 : bank, a);
  if (a < 0xC000) throw new Error(`a table read in VRAM / SRAM at $${a.toString(16)}`);
  if (a < 0xE000) return a < 0xD000 ? w.wram[0][a - 0xC000] : w.wram[6][a - 0xD000];
  if (a < 0xFE00) return busRead(w, bank, a - 0x2000);
  return w.high[a - 0xFE00];
}

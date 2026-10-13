// The CPU's view of the Game Boy Color's address space for the readable port: every access goes through the
// emulator's memory map (web/js/gb/mem.js), so I/O registers, banking, OAM DMA, HDMA and palette ports behave as
// on hardware. Same interface as the match engine's MatchMemory (u8/s8/u16/s16/u24/s24/s32 and w8/w16/w24/w32,
// bank, withBank, w0/wx/hram), so the engine runs on it unchanged.
const S8 = v => (v << 24) >> 24, S16 = v => (v << 16) >> 16, S24 = v => (v << 8) >> 8;

export class Bus {
  constructor(gb) { this.gb = gb; this.m = gb.mem; }
  u8(a) { return this.m.read(a & 0xFFFF); }
  w8(a, v) { this.m.write(a & 0xFFFF, v & 0xFF); }
  s8(a) { return S8(this.u8(a)); }
  u16(a) { return this.u8(a) | this.u8(a + 1) << 8; }
  s16(a) { return S16(this.u16(a)); }
  w16(a, v) { this.w8(a, v); this.w8(a + 1, v >> 8); }
  u24(a) { return this.u8(a) | this.u8(a + 1) << 8 | this.u8(a + 2) << 16; }
  s24(a) { return S24(this.u24(a)); }
  w24(a, v) { this.w8(a, v); this.w8(a + 1, v >> 8); this.w8(a + 2, v >> 16); }
  s32(a) { return this.u24(a) | this.u8(a + 3) << 24; }
  w32(a, v) { this.w24(a, v); this.w8(a + 3, v >> 24); }
  // the switchable WRAM bank as mapped by rSVBK (the match engine's "bank")
  get bank() { return this.m.svbk; }
  set bank(b) { this.m.svbk = (b & 7) || 1; }
  withBank(bank, fn) { const old = this.m.svbk; this.m.svbk = (bank & 7) || 1; try { return fn(); } finally { this.m.svbk = old; } }
  get w0() { return this.m.wram[0]; }
  get wx() { return this.m.wram; }
  get hram() { return this.m.hram; }
  // ROM through the cartridge's current bank mapping (code that reads ROM data via hRomBank-mapped pointers)
  romByte(bank, addr) { return addr < 0x4000 ? this.m.rom[addr] : this.m.rom[((bank % this.m.romBanks) << 14) | (addr & 0x3FFF)]; }
}

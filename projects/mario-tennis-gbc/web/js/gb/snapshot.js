// Resume the core from a memory snapshot dumped by tools/emu_dump_snapshot.py (PyBoy state ->
// JSON): registers, banks, WRAM/VRAM/OAM/HRAM, I/O registers, palette RAM from the game's shadow
// buffers, SRAM. Hardware timing restarts at the frame start.
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export function loadSnapshot(gb, snap) {
  const m = gb.mem, c = gb.cpu, p = gb.ppu;
  const r = snap.regs; c.a = r.A; c.f = r.F & 0xF0; c.b = r.B; c.c = r.C; c.d = r.D; c.e = r.E; c.hl = r.HL; c.sp = r.SP; c.pc = r.PC;
  c.ime = snap.ime === null || snap.ime === undefined ? true : !!snap.ime; c.halted = false; c.eiPending = false;
  m.wram[0].set(b64(snap.wram[0])); for (let b = 1; b < 8; b++) m.wram[b].set(b64(snap.wram[b]));
  m.vram[0].set(b64(snap.vram[0])); m.vram[1].set(b64(snap.vram[1]));
  m.oam.set(b64(snap.oam)); m.hram.set(b64(snap.hram).subarray(0, 0x7F));
  if (snap.sram) m.sram.set(b64(snap.sram).subarray(0, Math.min(0x2000, m.sram.length)));
  m.romBank = snap.romBank; m.updateRom(); m.svbk = snap.svbk || 1; m.vbk = snap.vbk & 1; m.ie = snap.ie;
  const io = b64(snap.io);
  m.doubleSpeed = !!(io[0x4D] & 0x80);
  m.timer.tma = io[0x06]; m.timer.tima = io[0x05]; m.timer.setTac(io[0x07]); m.timer.div = io[0x04] << 8;
  for (const rr of [0x40, 0x42, 0x43, 0x45, 0x47, 0x48, 0x49, 0x4A, 0x4B]) p.write(rr, io[rr]);
  p.stat = io[0x41] & 0x78; p.ly = 0; p.dots = 0; p.mode = 2; p.windowLine = 0;
  m.hdma.src = (io[0x51] << 8) | (io[0x52] & 0xF0); m.hdma.dst = ((io[0x53] & 0x1F) << 8) | (io[0x54] & 0xF0); m.hdma.active = false;
  m.iflag = io[0x0F] & 0x1F; m.io.set(io.subarray(0, 0x80));
  for (let rr = 0x10; rr < 0x40; rr++) if (rr !== 0x26) gb.apu.write(rr, io[rr]); gb.apu.write(0x26, io[0x26]);
  p.bgPal.set(b64(snap.bgpal)); p.objPal.set(b64(snap.objpal));
  m.joypad.select = io[0x00] & 0x30;
}

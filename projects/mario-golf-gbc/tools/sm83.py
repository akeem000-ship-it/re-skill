"""A small SM83 (Game Boy CPU) interpreter for running Mario Golf's ROM routines on a RAM image, without video.

It exists so that the Python ports (ball_sim.py) can run the ROM's own code for parts not ported yet, and so
that hand ports can be unit-tested against the ROM quickly. Timing, interrupts, video and sound are not
modelled: `call(bank, addr)` runs a routine until it returns, `AdvanceFrame` (00:2E3B) and the far-call
helpers work as in the ROM (they are ROM code too).

Memory model: ROM (MBC5 banking through writes to $2000-$3FFF), VRAM (2 banks, kept but unused), WRAM
bank 0 at $C000 and banks 1-7 at $D000 (SVBK $FF70), OAM/IO/HRAM as a flat $FE00-$FFFF array. SRAM ($A000)
is a flat 8 KiB array (bank 0 only). rLY reads as 145 and rSTAT as VBlank (no video).

usage (module):
    m = Machine(rom); m.load_ram(wram_bytes, hram_bytes)  # or m.wram[bank][i] = v
    m.call(0x10, 0x7263, a=0, hl=0) -> registers dict
"""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

FZ, FN, FH, FC = 0x80, 0x40, 0x20, 0x10


class Halt(Exception):
    pass


class Machine:
    def __init__(self, rom):
        self.rom = rom
        self.rom_bank = 1
        self.wram = [bytearray(0x1000) for _ in range(8)]
        self.vram = [bytearray(0x2000) for _ in range(2)]
        self.high = bytearray(0x200)          # $FE00-$FFFF
        self.sram = bytearray(0x2000)
        self.a = self.f = self.b = self.c = self.d = self.e = self.h = self.l = 0
        self.sp = 0xCFF0
        self.pc = 0
        self.steps = 0
        self.frame_hook = None                # called when AdvanceFrame (00:2E3B) is entered, if set
        self.overrides = {}                   # (bank, addr) -> fn(machine): a Python port run instead; then `ret`
        self.watches = {}                     # (bank, addr) -> fn(machine): called before executing there
        import collections
        self.trace = collections.deque(maxlen=200000)   # last (bank, pc) executed, for error reports

    # ---- memory ----
    def svbk(self):
        v = self.high[0x170] & 7
        return v or 1

    def rd(self, a):
        if a < 0x4000:
            return self.rom[a]
        if a < 0x8000:
            return self.rom[self.rom_bank * 0x4000 + a - 0x4000]
        if a < 0xA000:
            return self.vram[self.high[0x14F] & 1][a - 0x8000]
        if a < 0xC000:
            return self.sram[a - 0xA000]
        if a < 0xD000:
            return self.wram[0][a - 0xC000]
        if a < 0xE000:
            return self.wram[self.svbk()][a - 0xD000]
        if a < 0xFE00:
            return self.rd(a - 0x2000)
        if a == 0xFF44:                       # rLY: no video, so always in VBlank (lets LCD-off waits finish)
            return 0x91
        if a == 0xFF41:                       # rSTAT: mode 1 (VBlank)
            return (self.high[0x141] & 0xF8) | 0x01
        return self.high[a - 0xFE00]

    def wr(self, a, v):
        v &= 0xFF
        if a < 0x8000:
            if 0x2000 <= a < 0x3000:
                self.rom_bank = v or 0
            return
        if a < 0xA000:
            self.vram[self.high[0x14F] & 1][a - 0x8000] = v
        elif a < 0xC000:
            self.sram[a - 0xA000] = v
        elif a < 0xD000:
            self.wram[0][a - 0xC000] = v
        elif a < 0xE000:
            self.wram[self.svbk()][a - 0xD000] = v
        elif a < 0xFE00:
            self.wr(a - 0x2000, v)
        else:
            self.high[a - 0xFE00] = v

    # ---- registers ----
    def r16(self, i):                         # bc de hl sp
        return [lambda: self.b << 8 | self.c, lambda: self.d << 8 | self.e,
                lambda: self.h << 8 | self.l, lambda: self.sp][i]()

    def w16(self, i, v):
        v &= 0xFFFF
        if i == 0:
            self.b, self.c = v >> 8, v & 0xFF
        elif i == 1:
            self.d, self.e = v >> 8, v & 0xFF
        elif i == 2:
            self.h, self.l = v >> 8, v & 0xFF
        else:
            self.sp = v

    def r8(self, i):                          # b c d e h l [hl] a
        if i == 6:
            return self.rd(self.h << 8 | self.l)
        return (self.b, self.c, self.d, self.e, self.h, self.l, 0, self.a)[i]

    def w8(self, i, v):
        v &= 0xFF
        if i == 0: self.b = v
        elif i == 1: self.c = v
        elif i == 2: self.d = v
        elif i == 3: self.e = v
        elif i == 4: self.h = v
        elif i == 5: self.l = v
        elif i == 6: self.wr(self.h << 8 | self.l, v)
        else: self.a = v

    def fetch(self):
        v = self.rd(self.pc)
        self.pc = (self.pc + 1) & 0xFFFF
        return v

    def fetch16(self):
        lo = self.fetch()
        return self.fetch() << 8 | lo

    def push(self, v):
        self.sp = (self.sp - 1) & 0xFFFF
        self.wr(self.sp, v >> 8)
        self.sp = (self.sp - 1) & 0xFFFF
        self.wr(self.sp, v & 0xFF)

    def pop(self):
        lo = self.rd(self.sp)
        self.sp = (self.sp + 1) & 0xFFFF
        hi = self.rd(self.sp)
        self.sp = (self.sp + 1) & 0xFFFF
        return hi << 8 | lo

    def cond(self, y):
        return [not self.f & FZ, bool(self.f & FZ), not self.f & FC, bool(self.f & FC)][y]

    # ---- ALU ----
    def alu(self, op, v):
        a, c = self.a, 1 if self.f & FC else 0
        if op == 0 or op == 1:                # add / adc
            cin = c if op == 1 else 0
            r = a + v + cin
            self.f = (0 if r & 0xFF else FZ) | (FH if (a & 0xF) + (v & 0xF) + cin > 0xF else 0) | (FC if r > 0xFF else 0)
            self.a = r & 0xFF
        elif op == 2 or op == 3 or op == 7:   # sub / sbc / cp
            cin = c if op == 3 else 0
            r = a - v - cin
            f = FN | (0 if r & 0xFF else FZ) | (FH if (a & 0xF) - (v & 0xF) - cin < 0 else 0) | (FC if r < 0 else 0)
            self.f = f
            if op != 7:
                self.a = r & 0xFF
        elif op == 4:
            self.a = a & v
            self.f = (0 if self.a else FZ) | FH
        elif op == 5:
            self.a = a ^ v
            self.f = 0 if self.a else FZ
        elif op == 6:
            self.a = a | v
            self.f = 0 if self.a else FZ

    def cb(self):
        op = self.fetch()
        x, y, z = op >> 6, (op >> 3) & 7, op & 7
        v = self.r8(z)
        if x == 0:
            c = 1 if self.f & FC else 0
            if y == 0: r = (v << 1 | v >> 7) & 0xFF; co = v >> 7
            elif y == 1: r = (v >> 1 | v << 7) & 0xFF; co = v & 1
            elif y == 2: r = (v << 1 | c) & 0xFF; co = v >> 7
            elif y == 3: r = (v >> 1 | c << 7) & 0xFF; co = v & 1
            elif y == 4: r = (v << 1) & 0xFF; co = v >> 7
            elif y == 5: r = (v >> 1 | (v & 0x80)) & 0xFF; co = v & 1
            elif y == 6: r = ((v << 4) | (v >> 4)) & 0xFF; co = 0
            else: r = v >> 1; co = v & 1
            self.f = (0 if r else FZ) | (FC if co else 0)
            self.w8(z, r)
        elif x == 1:
            self.f = (self.f & FC) | FH | (0 if v >> y & 1 else FZ)
        elif x == 2:
            self.w8(z, v & ~(1 << y))
        else:
            self.w8(z, v | (1 << y))

    def step(self):
        if self.watches and self.pc < 0x8000:
            fn = self.watches.get((self.rom_bank if self.pc >= 0x4000 else 0, self.pc))
            if fn:
                fn(self)
        if self.overrides:
            key = (self.rom_bank if self.pc >= 0x4000 else 0, self.pc) if self.pc < 0x8000 else None
            fn = self.overrides.get(key)
            if fn and fn(self) is not False:     # an override may decline (return False): the ROM code runs
                self.pc = self.pop()
                return
        if self.pc == 0x2E3B and self.frame_hook:
            if self.frame_hook(self):          # True: skip AdvanceFrame (return at once)
                self.pc = self.pop()
                return
        self.trace.append((self.rom_bank, self.pc))
        op = self.fetch()
        self.steps += 1
        x, y, z = op >> 6, (op >> 3) & 7, op & 7
        p, q = y >> 1, y & 1
        if x == 1:
            if op == 0x76:
                raise Halt("halt at %04x" % ((self.pc - 1) & 0xFFFF))
            self.w8(y, self.r8(z))
            return
        if x == 2:
            self.alu(y, self.r8(z))
            return
        if x == 0:
            if z == 0:
                if y == 0: return                                    # nop
                if y == 1:                                           # ld [a16], sp
                    a = self.fetch16(); self.wr(a, self.sp & 0xFF); self.wr(a + 1, self.sp >> 8); return
                if y == 2:
                    self.fetch()
                    raise Halt("stop at %04x; last ROM code: %s" % ((self.pc - 2) & 0xFFFF, " ".join("%02x:%04x" % t for t in self.last_rom())))
                d = self.fetch()
                d = d - 256 if d & 0x80 else d
                if y == 3 or self.cond(y - 4):
                    self.pc = (self.pc + d) & 0xFFFF
                return
            if z == 1:
                if q == 0:
                    self.w16(p, self.fetch16())
                else:                                                # add hl, rr
                    hl, v = self.r16(2), self.r16(p)
                    r = hl + v
                    self.f = (self.f & FZ) | (FH if (hl & 0xFFF) + (v & 0xFFF) > 0xFFF else 0) | (FC if r > 0xFFFF else 0)
                    self.w16(2, r)
                return
            if z == 2:
                addr = [lambda: self.r16(0), lambda: self.r16(1), lambda: self.r16(2), lambda: self.r16(2)][p]()
                if q == 0:
                    self.wr(addr, self.a)
                else:
                    self.a = self.rd(addr)
                if p == 2: self.w16(2, addr + 1)
                if p == 3: self.w16(2, addr - 1)
                return
            if z == 3:
                self.w16(p, self.r16(p) + (1 if q == 0 else -1))
                return
            if z == 4 or z == 5:
                v = self.r8(y)
                r = (v + (1 if z == 4 else -1)) & 0xFF
                if z == 4:
                    self.f = (self.f & FC) | (0 if r else FZ) | (FH if (v & 0xF) == 0xF else 0)
                else:
                    self.f = (self.f & FC) | FN | (0 if r else FZ) | (FH if (v & 0xF) == 0 else 0)
                self.w8(y, r)
                return
            if z == 6:
                self.w8(y, self.fetch())
                return
            a, c = self.a, 1 if self.f & FC else 0
            if y == 0: self.a = (a << 1 | a >> 7) & 0xFF; self.f = FC if a & 0x80 else 0
            elif y == 1: self.a = (a >> 1 | a << 7) & 0xFF; self.f = FC if a & 1 else 0
            elif y == 2: self.a = (a << 1 | c) & 0xFF; self.f = FC if a & 0x80 else 0
            elif y == 3: self.a = (a >> 1 | c << 7) & 0xFF; self.f = FC if a & 1 else 0
            elif y == 4:                                                    # daa
                cor = 0
                cf = self.f & FC
                if self.f & FN:
                    if self.f & FH: cor |= 0x06
                    if cf: cor |= 0x60
                    a = (a - cor) & 0xFF
                else:
                    if self.f & FH or (a & 0xF) > 9: cor |= 0x06
                    if cf or a > 0x99: cor |= 0x60; cf = FC
                    a = (a + cor) & 0xFF
                self.a = a
                self.f = (self.f & FN) | (0 if a else FZ) | (FC if cf else 0)
            elif y == 5: self.a = a ^ 0xFF; self.f |= FN | FH
            elif y == 6: self.f = (self.f & FZ) | FC
            else: self.f = (self.f & FZ) | (0 if self.f & FC else FC)
            return
        # x == 3
        if z == 0:
            if y < 4:
                if self.cond(y): self.pc = self.pop()
                return
            if y == 4: self.wr(0xFF00 + self.fetch(), self.a); return
            if y == 6: self.a = self.rd(0xFF00 + self.fetch()); return
            d = self.fetch(); d = d - 256 if d & 0x80 else d
            sp = self.sp
            r = (sp + d) & 0xFFFF
            self.f = (FH if (sp & 0xF) + (d & 0xF) > 0xF else 0) | (FC if (sp & 0xFF) + (d & 0xFF) > 0xFF else 0)
            if y == 5: self.sp = r
            else: self.w16(2, r)
            return
        if z == 1:
            if q == 0:
                v = self.pop()
                if p == 3: self.a, self.f = v >> 8, v & 0xF0
                else: self.w16(p, v)
                return
            if p == 0 or p == 1: self.pc = self.pop(); return       # ret / reti
            if p == 2: self.pc = self.r16(2); return                # jp hl
            self.sp = self.r16(2); return
        if z == 2:
            if y < 4:
                a = self.fetch16()
                if self.cond(y): self.pc = a
                return
            if y == 4: self.wr(0xFF00 + self.c, self.a); return
            if y == 6: self.a = self.rd(0xFF00 + self.c); return
            a = self.fetch16()
            if y == 5: self.wr(a, self.a)
            else: self.a = self.rd(a)
            return
        if z == 3:
            if y == 0: self.pc = self.fetch16(); return
            if y == 1: self.cb(); return
            return                                                  # di / ei
        if z == 4:
            a = self.fetch16()
            if self.cond(y):
                self.push(self.pc); self.pc = a
            return
        if z == 5:
            if q == 0:
                self.push((self.a << 8 | self.f) if p == 3 else self.r16(p))
                return
            a = self.fetch16(); self.push(self.pc); self.pc = a
            return
        if z == 6:
            self.alu(y, self.fetch())
            return
        self.push(self.pc)
        self.pc = y * 8

    # ---- calling ----
    RET_TRAP = 0x3101                          # unused $FF fill in bank 0

    def call(self, bank, addr, max_steps=2_000_000, **regs):
        """Run bank:addr until it returns; registers a, b, c, d, e, h, l, f or bc, de, hl may be given."""
        for k, v in regs.items():
            if k in ("bc", "de", "hl"):
                self.w16("bc de hl".split().index(k), v)
            else:
                setattr(self, k, v & 0xFF)
        if bank:
            self.rom_bank = bank
            self.high[0x195] = bank            # hROMBank
        self.push(self.RET_TRAP)
        self.pc = addr
        start = self.steps
        while self.pc != self.RET_TRAP:
            self.step()
            if self.steps - start > max_steps:
                raise RuntimeError("no return from %02x:%04x after %d steps (pc %04x)" % (bank, addr, max_steps, self.pc))
        return dict(A=self.a, F=self.f, BC=self.r16(0), DE=self.r16(1), HL=self.r16(2))

    def last_rom(self, n=24):
        """The last n traced addresses before execution left ROM (for runaway jumps)."""
        t = list(self.trace)
        end = len(t)
        while end and t[end - 1][1] >= 0x8000:
            end -= 1
        return t[max(0, end - n):end]

    def run_until(self, stops, max_steps=2_000_000):
        """Run from the current pc until pc is one of `stops` (CPU addresses in the current bank);
        returns the stop address reached."""
        start = self.steps
        while self.pc not in stops:
            self.step()
            if self.steps - start > max_steps:
                raise RuntimeError("no stop after %d steps (pc %04x)" % (max_steps, self.pc))
        return self.pc

    def load_snapshot(self, snap):
        """snap: dict from tools/emu_shot_record.py (hex strings): wram0-7, vram0-1, high, sram, rom_bank, sp."""
        for i in range(8):
            if "wram%d" % i in snap:
                self.wram[i][:] = bytes.fromhex(snap["wram%d" % i])
        for i in range(2):
            self.vram[i][:] = bytes.fromhex(snap["vram%d" % i])
        self.high[:] = bytes.fromhex(snap["high"])
        self.sram[:] = bytes.fromhex(snap["sram"])
        self.rom_bank = snap["rom_bank"]

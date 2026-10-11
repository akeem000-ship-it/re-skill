"""Thin PyBoy wrapper for scripted validation (Ph5.5/Ph6).

    from tools.emu.session import Emu
    e = Emu()                       # headless, CGB, ROM from rom/
    e.run(120)                      # frames
    e.press("start"); e.run(30)
    e.shot("gfx/emu/title.png")
    e.r8(0xC2A1); e.r16(0xFF8A); e.dump(0xC000, 0xA0)
    e.wram(bank, addr) / e.sram(bank, addr)
    e.hook(bank, addr, fn)         # fn(emu) on execution of bank:addr
    e.save("states/title.state"); e.load(...)

Battery SRAM is kept in rom/mario_tennis.gbc.ram by PyBoy; pass fresh=True to start without it.
"""
import os, io, sys, warnings
warnings.filterwarnings("ignore")
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ROM = os.path.join(ROOT, "rom", "mario_tennis.gbc")


class Emu:
    def __init__(self, fresh=False, sound=False):
        from pyboy import PyBoy
        if fresh:
            ram = ROM + ".ram"
            if os.path.exists(ram):
                os.remove(ram)
        self.pb = PyBoy(ROM, window="null", cgb=True, sound_emulated=sound, log_level="ERROR")
        self.pb.set_emulation_speed(0)
        self.mem = self.pb.memory

    # -- execution --
    def run(self, frames=1):
        for _ in range(frames):
            self.pb.tick(1, True)

    def press(self, button, hold=6, after=0):
        """button: a b start select up down left right"""
        self.pb.button_press(button)
        self.run(hold)
        self.pb.button_release(button)
        self.run(after)

    def hook(self, bank, addr, fn):
        self.pb.hook_register(bank, addr, lambda ctx: fn(self), None)

    # -- memory --
    def r8(self, a):
        return self.mem[a]

    def r16(self, a):
        return self.mem[a] | self.mem[a + 1] << 8

    def w8(self, a, v):
        self.mem[a] = v

    def wram(self, bank, a, n=1):
        """WRAM bank 1-7 at D000-DFFF (bank 0 = C000). PyBoy's banked indexing for
        WRAM raises on slices, so temporarily switch rSVBK and read flat memory."""
        if a < 0xD000:
            data = bytes(self.mem[a:a + n])
        else:
            old = self.mem[0xFF70]
            self.mem[0xFF70] = bank
            data = bytes(self.mem[a:a + n])
            self.mem[0xFF70] = old
        return data[0] if n == 1 else data

    def sram(self, bank, a, n=1):
        if n == 1:
            return self.mem[bank, a]
        return bytes(self.mem[bank, a:a + n])

    def vram(self, bank, a, n):
        return bytes(self.mem[bank, a:a + n])

    def dump(self, a, n):
        data = bytes(self.mem[a:a + n])
        for i in range(0, n, 16):
            print("%04x: %s" % (a + i, " ".join("%02x" % b for b in data[i:i + 16])))

    def regs(self):
        r = self.pb.register_file
        return dict(PC=r.PC, SP=r.SP, A=r.A, F=r.F, B=r.B, C=r.C, D=r.D, E=r.E, HL=r.HL)

    def rom_bank(self):
        return self.mem[0xFF95]

    # -- output --
    def shot(self, path, scale=2):
        os.makedirs(os.path.dirname(os.path.join(ROOT, path)) or ".", exist_ok=True)
        img = self.pb.screen.image.convert("RGB")
        if scale != 1:
            img = img.resize((img.width * scale, img.height * scale), 0)
        img.save(os.path.join(ROOT, path))
        return path

    def save(self, path):
        p = os.path.join(ROOT, path); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, "wb") as f:
            self.pb.save_state(f)

    def load(self, path):
        with open(os.path.join(ROOT, path), "rb") as f:
            self.pb.load_state(f)

    def stop(self):
        self.pb.stop(save=False)

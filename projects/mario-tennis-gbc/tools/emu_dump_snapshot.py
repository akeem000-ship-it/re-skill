"""Dump a PyBoy state as a memory snapshot the JS core can resume (web/js/gb/snapshot.js): CPU
registers, ROM/RAM/WRAM/VRAM banks, OAM, HRAM, I/O registers, CGB palette RAM (from the game's
shadow buffers wBGPalBuf $C100 / wObjPalBuf $C140), SRAM. Timing state (PPU dot, timers) restarts.
usage: emu_dump_snapshot.py STATE OUT.json"""
import sys, os, json, base64
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
e = Emu(); e.load(sys.argv[1])
m = e.mem; r = e.regs()
b64 = lambda b: base64.b64encode(bytes(b)).decode()
snap = {
    "regs": r, "ime": None,
    "romBank": m[0xFF95], "svbk": m[0xFF70] & 7, "vbk": m[0xFF4F] & 1, "key1": m[0xFF4D],
    "wram": [b64(e.wram(0, 0xC000, 0x1000))] + [b64(e.wram(b, 0xD000, 0x1000)) for b in range(1, 8)],
    "vram": [b64(e.vram(0, 0x8000, 0x2000)), b64(e.vram(1, 0x8000, 0x2000))],
    "oam": b64(bytes(m[0xFE00:0xFEA0])), "hram": b64(bytes(m[0xFF80:0xFFFF])),
    "io": b64(bytes(m[0xFF00:0xFF80])), "ie": m[0xFFFF],
    "bgpal": b64(bytes(m[0xC100:0xC140])), "objpal": b64(bytes(m[0xC140:0xC180])),
}
try: snap["sram"] = b64(e.sram(0, 0xA000, 0x2000))
except Exception: pass
json.dump(snap, open(sys.argv[2], "w")); print("wrote", sys.argv[2], "pc %04x bank %02x" % (r["PC"], m[0xFF95]))
e.stop()

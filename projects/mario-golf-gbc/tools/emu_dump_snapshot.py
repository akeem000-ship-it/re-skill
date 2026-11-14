"""Dump a PyBoy state as a memory snapshot the JS core can resume (web/js/gb/snapshot.js): CPU
registers, ROM/RAM/WRAM/VRAM banks, OAM, HRAM, I/O registers, CGB palette RAM (from the game's
shadow buffers: Golf keeps all 128 bytes at wPalLive $C100), SRAM, and PyBoy's 16-bit divider counter (read
from its save-state bytes, so the timer phase carries over). The PPU restarts at line 0, as PyBoy's frames end there.
usage: emu_dump_snapshot.py STATE OUT.json"""
import sys, os, io, json, base64, struct
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
# PyBoy's Timer.save_state: DIV, TIMA, DIV_counter (16), TIMA_counter (16), TMA, TAC, reload state, ...
buf = io.BytesIO(); e.pb.save_state(buf); st = buf.getvalue()
div, tma, tac = m[0xFF04], m[0xFF06], m[0xFF07] & 7
hits = [i for i in range(len(st) - 9) if st[i] == div and st[i + 3] == div and st[i + 6] == tma and st[i + 7] == tac]
if len(hits) == 1:
    i = hits[0]
    snap["div16"] = st[i + 2] | st[i + 3] << 8
    snap["tima"] = st[i + 1]
else:
    print("timer block not found uniquely (%d candidates): divider phase not carried" % len(hits))
# PyBoy's LCD.save_state: LCDC BGP OBP0 OBP1, STAT LY LYC, SCY SCX WY WX, priority mode, 144 x 5 scanline bytes,
# cgb, dmg flag, speed_shift, frame_done, first_frame, reset, last_cycles (64), clock (64, dots into the frame)
pat = bytes([m[0xFF40], m[0xFF47], m[0xFF48], m[0xFF49]])
hits = [i for i in range(len(st) - 800) if st[i:i + 4] == pat and st[i + 5] == m[0xFF44] and st[i + 6] == m[0xFF45]
        and st[i + 7] == m[0xFF42] and st[i + 8] == m[0xFF43]]
if len(hits) == 1:
    o = hits[0] + 4 + 3 + 4 + 1 + 144 * 5
    snap["lcdClock"] = struct.unpack("<Q", st[o + 14:o + 22])[0]
else:
    print("LCD block not found uniquely (%d candidates): the PPU restarts at dot 0" % len(hits))
try: snap["sram"] = b64(e.sram(0, 0xA000, 0x2000))
except Exception: pass
json.dump(snap, open(sys.argv[2], "w")); print("wrote", sys.argv[2], "pc %04x bank %02x" % (r["PC"], m[0xFF95]))
e.stop()

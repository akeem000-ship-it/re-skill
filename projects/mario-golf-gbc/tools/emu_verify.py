"""Check the Python decoders against the running game (PyBoy).

Hooks, while the game boots and runs through the intro and the character screens:
  00:1F2F LZDecompress entry (hl = src in the current bank, de = dst) and 00:1F8D its end-of-stream
          exit (de = dst end): the bytes written must equal tools/decompress.py on the same source.
  05:61CF the common exit of LoadText: wTextBuffer must start with dump_text.py's string for the id.
  0A:4BFA the exit of MapLoadHeader: $C450-$C455 must equal the MapTable record (dump_maps.py).
  0B:4500 the exit of MapLoadGfxScreen: WRAM3 D000 (tilemap), WRAM2 D000 (attributes) and VRAM1
          $9000-$97FF / $8800-$8FFF (tiles) must equal render_map.py's decoding of descriptor wMapGfxLoaded.
Prints one line per mismatch and a summary.
usage: emu_verify.py [frames]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.gbrom import load_rom, to_offset
from tools.decompress import decompress
from tools.dump_text import strings
from tools.dump_maps import records
from tools.render_map import descriptors, lz

PRESSES = {3000: "start", 3300: "a", 3600: "a", 3900: "a", 4200: "a", 4500: "a"}


def main():
    frames = int(sys.argv[1]) if len(sys.argv) > 1 else 4800
    rom = load_rom()
    text = {}
    for b in range(0x18, 0x20):
        for i, s in strings(rom, b):
            text[((b - 0x18) << 10) | i] = s
    maps = {r[0]: r for r in records(rom)}
    stats = {"lz": [0, 0], "text": [0, 0], "map": [0, 0], "mapgfx": [0, 0]}
    descs = descriptors(rom)
    e = Emu(fresh=True)
    pending = {}

    def lz_in(emu):
        r = emu.regs()
        bank = emu.r8(0xFF95)
        src = r["HL"]
        pending["lz"] = (bank if src >= 0x4000 else 0, src, (r["D"] << 8) | r["E"], emu.r8(0xFF70))

    def lz_out(emu):
        if "lz" not in pending:
            return
        bank, src, dst, svbk = pending.pop("lz")
        end = (emu.regs()["D"] << 8) | emu.regs()["E"]
        got = bytes(emu.mem[dst:end]) if dst < 0xD000 else emu.wram(svbk, dst, end - dst)
        want, _ = decompress(rom, to_offset(bank, src))
        ok = got == want
        stats["lz"][ok] += 1
        if not ok:
            print("LZ  %02x:%04x -> %04x: game %d bytes, decompress.py %d bytes" % (bank, src, dst, len(got), len(want)))

    def text_out(emu):
        tid = pending.pop("text", None)
        if tid is None:
            return
        want = text.get(tid, b"")
        got = bytes(emu.mem[0xC600:0xC600 + len(want)])
        ok = got == want[:0x180]
        stats["text"][ok] += 1
        if not ok:
            print("TEXT %04x: game %r / dump_text %r" % (tid, got[:24], want[:24]))

    def text_in(emu):
        pending["text"] = emu.regs()["HL"]

    def map_out(emu):
        got = tuple(emu.mem[0xC450:0xC456])
        want = maps.get(got[0])
        ok = want is not None and got == want
        stats["map"][ok] += 1
        if not ok:
            print("MAP game %s / dump_maps %s" % (got, want))

    def gfx_out(emu):
        gid = emu.r8(0xC32E)
        d = descs[gid]
        tiles = lz(rom, d[8])
        checks = [("tilemap", emu.wram(3, 0xD000, 0x1000), lz(rom, d[2])),
                  ("attrs", emu.wram(2, 0xD000, 0x1000), lz(rom, d[3])),
                  ("tiles 9000", emu.vram(1, 0x9000, min(0x800, len(tiles))), tiles[:0x800])]
        if len(tiles) > 0x800:
            checks.append(("tiles 8800", emu.vram(1, 0x8800, min(0x800, len(tiles) - 0x800)), tiles[0x800:0x1000]))
        for name, got, want in checks:
            ok = got == want
            stats["mapgfx"][ok] += 1
            if not ok:
                diff = sum(1 for a, b in zip(got, want) if a != b)
                print("MAPGFX %02x %s: %d of %d bytes differ" % (gid, name, diff, len(want)))

    e.hook(0x0B, 0x4500, gfx_out)
    e.hook(0x00, 0x1F2F, lz_in)
    e.hook(0x00, 0x1F8D, lz_out)
    e.hook(0x05, 0x6179, text_in)
    e.hook(0x05, 0x61CF, text_out)
    e.hook(0x0A, 0x4BFA, map_out)
    for f in range(frames):
        if f in PRESSES:
            e.pb.button_press(PRESSES[f])
        if f - 6 in PRESSES:
            e.pb.button_release(PRESSES[f - 6])
        e.run(1)
    e.stop()
    for k, (bad, good) in stats.items():
        print("%-5s %4d match, %d mismatch" % (k, good, bad))


if __name__ == "__main__":
    main()

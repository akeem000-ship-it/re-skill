"""Struct/table decoder.

usage: decode_tables.py <BB:AAAA> <count> <fmt> [--follow ...]
  fmt: u8 s8 u16 s16 ptr16 bankref (idx,bank pair) or struct:<size>:<f1,f2,...>
       struct field types: u8 s8 u16 s16 bref (2-byte idx,bank asset ref) pad<N>
"""
import sys, os, struct as st
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, Labels, to_offset

SIZES = {"u8": 1, "s8": 1, "u16": 2, "s16": 2, "ptr16": 2, "bref": 2, "bankref": 2}


def field(rom, o, t):
    if t == "u8": return "%02x" % rom[o]
    if t == "s8": return "%d" % st.unpack("b", rom[o:o + 1])[0]
    if t in ("u16", "ptr16"): return "%04x" % (rom[o] | rom[o + 1] << 8)
    if t == "s16": return "%d" % st.unpack("<h", rom[o:o + 2])[0]
    if t in ("bref", "bankref"):
        idx, b = rom[o], rom[o + 1]
        if b == 0: return "--:--"
        p = to_offset(b, 0x4000 + idx)
        return "%02x:%02x(%04x)" % (b, idx, rom[p] | rom[p + 1] << 8)
    raise ValueError(t)


def main():
    a = sys.argv[1:]
    if len(a) < 3:
        print(__doc__); return
    rom = load_rom()
    b, ad = Labels().resolve(a[0]); n = int(a[1], 0); fmt = a[2]
    o = to_offset(b or 0, ad)
    if fmt.startswith("struct:"):
        _, size, fields = fmt.split(":", 2)
        size = int(size, 0); fields = fields.split(",")
        for i in range(n):
            p = o + i * size; vals = []
            for f in fields:
                if f.startswith("pad"):
                    p += int(f[3:]); continue
                vals.append(field(rom, p, f)); p += SIZES[f]
            print("#%03d %04x: %s" % (i, ad + i * size, "  ".join(vals)))
    else:
        sz = SIZES[fmt]
        for i in range(n):
            print("#%03d %04x: %s" % (i, ad + i * sz, field(rom, o + i * sz, fmt)))


if __name__ == "__main__":
    main()

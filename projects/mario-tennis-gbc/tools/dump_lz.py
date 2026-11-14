"""Hex-dump the decompressed contents of an LZ block.
usage: dump_lz.py BB:AAAA [start] [len]     or  dump_lz.py BB idx  (bank table index)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, Labels, to_offset
from decompress import decompress

rom = load_rom()
a = sys.argv[1:]
if ":" in a[0]:
    b, ad = Labels().resolve(a[0]); rest = a[1:]
else:
    b = int(a[0], 16); i = int(a[1], 16); o = to_offset(b, 0x4000 + i)
    ad = rom[o] | rom[o + 1] << 8; rest = a[2:]
data, clen = decompress(rom, to_offset(b, ad))
st = int(rest[0], 16) if rest else 0
ln = int(rest[1], 16) if len(rest) > 1 else len(data) - st
print("%02x:%04x clen=%d ulen=%d" % (b, ad, clen, len(data)))
for r in range(st, min(len(data), st + ln), 16):
    print("%04x: %s" % (r, " ".join("%02x" % x for x in data[r:r + 16])))

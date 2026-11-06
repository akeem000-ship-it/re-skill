"""Value histogram of a decompressed LZ entry (or raw bytes), to tell tilemaps, attribute maps and tiles apart.

usage: byte_hist.py BB:AAAA [--raw N]
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, Labels
from decompress import decompress


def main():
    rom = load_rom()
    bank, addr = Labels().resolve(sys.argv[1])
    o = to_offset(bank or 0, addr)
    if "--raw" in sys.argv:
        data = rom[o:o + int(sys.argv[sys.argv.index("--raw") + 1], 0)]
    else:
        data, _ = decompress(rom, o)
    c = collections.Counter(data)
    print("%d bytes, %d distinct values, min %02x max %02x" % (len(data), len(c), min(data), max(data)))
    print(" ".join("%02x:%d" % kv for kv in sorted(c.items())))


if __name__ == "__main__":
    main()

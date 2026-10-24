"""Reimplementation of the ROM's LZ decompressor at 00:1F2F (LZDecompress).

The same format as Mario Tennis's decompressor at 00:1797, unrolled differently.
Format (verified by reading 00:1F2F-2035):
  ctrl byte -> 8 flags, LSB first.  1 = literal byte, 0 = back-reference.
  back-ref: lo, hi.  lo==0 && hi==0 -> end of stream.
     disp   = ((hi >> 5) << 8 | lo) - 0x800      (-2048..-1, relative to dest)
     length = (hi & 0x1F) + 3                      (3..34)
  returns (data, compressed_length)
  The ROM routine takes hl = source, de = destination and returns hl = bytes written.

usage: decompress.py BB:AAAA [out.bin]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def decompress(buf, off, limit=0x10000):
    out = bytearray()
    start = off
    while True:
        ctrl = buf[off]; off += 1
        for bit in range(8):
            if ctrl >> bit & 1:
                out.append(buf[off]); off += 1
            else:
                lo, hi = buf[off], buf[off + 1]; off += 2
                if lo == 0 and hi == 0:
                    return bytes(out), off - start
                disp = ((hi >> 5) << 8 | lo) - 0x800
                src = len(out) + disp
                if src < 0:
                    raise ValueError("backref before start at %x" % off)
                for _ in range((hi & 0x1F) + 3):
                    out.append(out[src]); src += 1
            if len(out) > limit:
                raise ValueError("output too large")


def main():
    from gbrom import load_rom, Labels, to_offset
    rom = load_rom()
    bank, addr = Labels().resolve(sys.argv[1])
    data, clen = decompress(rom, to_offset(bank or 0, addr))
    print("%02x:%04x  compressed %d bytes -> %d bytes" % (bank or 0, addr, clen, len(data)))
    if len(sys.argv) > 2:
        open(sys.argv[2], "wb").write(data)


if __name__ == "__main__":
    main()

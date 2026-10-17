"""Dump all messages from the text banks.

Text bank layout (verified on bank $26 stub 26:7B27):
  $4000 dw GetMsg_C600   (copies message DE -> $C600, max 159 chars)
  $4002 dw GetMsg_D880   (copies message DE -> $D880, max 15 chars)
  $4004 dw offsets[]     u16 offsets relative to TEXT_BASE
  TEXT_BASE = immediate of `ld hl, $XXXX` that follows `add hl,de; ld e,[hl]; ...`
  Encoding: ASCII; $01 newline; $00 end.  Other bytes < $20 are control codes (shown as {XX}).

usage: dump_text.py [bank] [--out docs/text_dump.txt]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, ROOT

TEXT_BANKS = [0x1F, 0x25, 0x26, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x5E, 0x6E]


def bank_info(rom, b):
    stub = rom[to_offset(b, 0x4000)] | rom[to_offset(b, 0x4001)] << 8
    # stub: push af; ld a,0; call X  -> X: push bc/de/hl; ld hl,$4004; sla e; rl d; add hl,de; ld e,[hl]; inc hl; ld d,[hl]; ld hl,BASE
    o = to_offset(b, stub)
    call = rom[o + 4] | rom[o + 5] << 8
    p = to_offset(b, call)
    seq = rom[p:p + 0x20]
    i = seq.find(bytes([0x56, 0x21]))  # ld d,[hl]; ld hl,imm
    base = seq[i + 2] | seq[i + 3] << 8
    tab = seq[seq.find(b"\x21") + 1] | seq[seq.find(b"\x21") + 2] << 8
    return tab, base


def decode(rom, off):
    s = []
    while True:
        c = rom[off]; off += 1
        if c == 0:
            break
        if c == 1:
            s.append("\\n")
        elif 0x20 <= c < 0x7F:
            s.append(chr(c))
        else:
            s.append("{%02X}" % c)
        if len(s) > 400:
            break
    return "".join(s)


def messages(rom, b):
    tab, base = bank_info(rom, b)
    first = rom[to_offset(b, tab)] | rom[to_offset(b, tab + 1)] << 8
    n = (base - tab) // 2
    out = []
    for i in range(n):
        o = rom[to_offset(b, tab + i * 2)] | rom[to_offset(b, tab + i * 2 + 1)] << 8
        if base + o >= 0x8000:
            break
        out.append((i, base + o, decode(rom, to_offset(b, base + o))))
    return tab, base, out


def main():
    rom = load_rom()
    args = [x for x in sys.argv[1:] if not x.startswith("--")]
    banks = [int(args[0], 16)] if args and not args[0].endswith(".txt") else TEXT_BANKS
    out = sys.stdout
    if "--out" in sys.argv:
        out = open(os.path.join(ROOT, sys.argv[sys.argv.index("--out") + 1]), "w")
    total = 0
    for b in banks:
        tab, base, msgs = messages(rom, b)
        out.write("=== bank %02x  table %04x  base %04x  %d messages ===\n" % (b, tab, base, len(msgs)))
        for i, a, s in msgs:
            out.write("%02x:%04x #%04d  %s\n" % (b, a, i, s))
        total += len(msgs)
    out.write("total %d messages\n" % total)


if __name__ == "__main__":
    main()

"""Dump a song/SFX's channel sequences in the driver's command format (REVERSE.md "Sound driver").

Index: music ids $01-$32 at 00:3151, SFX $50-$AF at 00:31B5; entry = [bank&$0F | channels<<4, row index];
rows (4 bytes: slot, hw channel, ptr16) at bank:$4000 + index*4. Channel data: 4-byte header
[tempo fraction, duty (wave: volume code), volume, sweep (wave: wave id)] then 2-byte commands:
  nn dd      note: nn<$A0 = semitone (low nibble) + octave shift (high nibble), dd = duration in ticks;
             $1F = rest; noise channel: nn<$10 -> table 00:3836 else raw NR43
  A0 vv vol  A1 nn sweep/wave   A2 nn duty / wave vol   A3 nn vibrato (FE off)  A4 nn gate (signed)
  A5 nn pan (01 = swap)  A6 nn NR50  A7 nn wait   A8 nn instrument (wave set | envelope set)
  A9 xx counter ops (F0/F1 +-c1, F2/F3 +-c2, FE/FF switch on c2/c1, <80 c1=n, >=80 c2=n-80)
  AA nn portamento  AC rr lo hi call (offset in bytes, repeat rr)  AD return  AE nn alt note table
  AF nn tempo fraction  Bk nn loop: repeat k times via slot nn (B0 Fk = jump to slot k's point)
  Ck nn envelope (k = speed, nn = table)  Dn rr / En rr fade up/down n steps every rr ticks
  FD nn set loop point in slot nn   FF end
usage: dump_sound_seq.py ID [--max N]
"""
import sys, os
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROM = open(os.path.join(ROOT, "rom", "mario_tennis.gbc"), "rb").read()
NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

def song_rows(sid):
    e = (0x3151 + 2 * (sid - 1)) if sid < 0x50 else (0x31B5 + 2 * (sid - 0x50))
    bank, nch, idx = 0x70 | (ROM[e] & 0x0F), ROM[e] >> 4, ROM[e + 1]
    base = bank * 0x4000 + idx * 4
    return bank, [ROM[base + 4 * i: base + 4 * i + 4] for i in range(nch)]

def decode(bank, ptr, limit=400):
    o = bank * 0x4000 + ptr - 0x4000
    hdr = ROM[o:o + 4]; out = [("hdr", "tempo-frac %d duty/wavevol %02x vol %02x sweep/wave %02x" % (hdr[0] & 15, hdr[1], hdr[2], hdr[3]))]
    pc = 4
    while len(out) < limit:
        op, arg = ROM[o + pc], ROM[o + pc + 1]
        at = pc; pc += 2
        if op < 0xA0:
            if op == 0x1F: out.append((at, "rest %d" % arg))
            else: out.append((at, "%s%s %d" % (NOTES[op & 15] if (op & 15) < 12 else "?%x" % (op & 15), "+%d" % (op >> 4) if op >> 4 else "", arg)))
        elif op == 0xFF: out.append((at, "end")); break
        elif op == 0xFD: out.append((at, "looppoint slot %d" % (arg & 15)))
        elif op >= 0xF0: out.append((at, "nop %02x %02x" % (op, arg)))
        elif op >= 0xE0: out.append((at, "fade down %d every %d" % (op & 15, arg)))
        elif op >= 0xD0: out.append((at, "fade up %d every %d" % (op & 15, arg)))
        elif op >= 0xC0: out.append((at, "envelope speed %d table %02x" % (op & 15, arg)))
        elif op >= 0xB0:
            if op == 0xB0: out.append((at, "jump to slot %d point" % (arg & 15) if arg & 0xF0 == 0xF0 else "nop B0 %02x" % arg))
            else: out.append((at, "repeat x%d (slot %d)" % (op & 15, arg & 15)))
        elif op == 0xAC:
            lo, hi = ROM[o + pc], ROM[o + pc + 1]; pc += 2
            out.append((at, "call +%04x x%d" % (lo | hi << 8, arg)))
        elif op == 0xAD: out.append((at, "return"))
        else:
            name = {0xA0: "vol", 0xA1: "sweep/wave", 0xA2: "duty", 0xA3: "vibrato", 0xA4: "gate", 0xA5: "pan", 0xA6: "nr50",
                    0xA7: "wait", 0xA8: "instrument", 0xA9: "counter", 0xAA: "portamento", 0xAE: "alt-table", 0xAF: "tempo-frac"}.get(op, "op%02x" % op)
            out.append((at, "%s %02x" % (name, arg)))
    return out

if __name__ == "__main__":
    sid = int(sys.argv[1], 16); limit = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 60
    bank, rows = song_rows(sid)
    print("id %02x bank %02x channels %d" % (sid, bank, len(rows)))
    for i, r in enumerate(rows):
        ptr = r[2] | r[3] << 8
        print("-- row %d slot %02x hw %d @%02x:%04x" % (i, r[0], r[1], bank, ptr))
        for at, txt in decode(bank, ptr, limit):
            print("   %s %s" % ("+%04x" % at if isinstance(at, int) else at, txt))

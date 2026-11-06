"""Animation id per frame from a --banks recording (emu_record.py): prints each change of wDF2E
(animation id) for P1 (WRAM4) and P2 (WRAM5) with wDF15 (shot type), wDF19 (swing phase),
wDF0F (move flags), speed |v| and the ball's distance to the player.
usage: analyze_anims.py states/rec_NAME.npy
"""
import sys
import numpy as np
rec = np.load(sys.argv[1])
W = {4: 0x1080, 5: 0x1080 + 0x1000}
def b(f, bank, a): return int(rec[f, W[bank] + a - 0xD000])
def s16(v): return v - 65536 if v >= 32768 else v
def c(f, a): return int(rec[f, a - 0xC000])
for bank in (4, 5):
    prev = None
    print("== P%d" % (bank - 3))
    for f in range(len(rec)):
        anim = b(f, bank, 0xDF2E)
        if anim != prev:
            vx = s16(b(f, bank, 0xDF40) | b(f, bank, 0xDF41) << 8); vy = s16(b(f, bank, 0xDF42) | b(f, bank, 0xDF43) << 8)
            px = s16(b(f, bank, 0xDF01) | b(f, bank, 0xDF02) << 8); py = s16(b(f, bank, 0xDF04) | b(f, bank, 0xDF05) << 8)
            bx = s16(c(f, 0xC402) | c(f, 0xC403) << 8); by = s16(c(f, 0xC406) | c(f, 0xC407) << 8)
            print("f%5d anim %2d  DF15 %2d DF19 %2d DF0F %02x  |v| %5.1f  ball-dist (%5d,%5d)" % (
                f, anim, b(f, bank, 0xDF15), b(f, bank, 0xDF19), b(f, bank, 0xDF0F), (vx * vx + vy * vy) ** .5 / 256, bx - px, by - py))
            prev = anim

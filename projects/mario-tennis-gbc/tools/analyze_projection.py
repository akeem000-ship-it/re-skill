"""Verify the decoded ProjectPoint 00:2D8C against a --banks recording (REVERSE.md "Projection").

P = f1(Y) + f2(Z), Q = f2(Y) - f1(Z) with f1(x) = x*26368>>16, f2(x) = x*59904>>16 (bank 2F tables,
camera tilt 23.76 deg), s = floor(128*16384/(16384 - Q)) (bank 2E byte table), X' = 8*((X*s)>>8) + 16,
P' = 8*((P*s)>>8) + 16 (wDD1E/wDD20 for the ball); screen = (wC478 + X')/32, (wC47A + P')/32.
usage: analyze_projection.py states/rec_rally1.npy
"""
import sys, numpy as np

def tbl(x, k):                      # bank 2F tables: sign * ((|x| & ~1) * k >> 16)
    a = abs(int(x)) & ~1
    v = (a * k) >> 16
    return -v if x < 0 else v
def mul8x16(hl, a):                 # 00:0DFA MulSigned8x16: sign * ((|hl| * a) >> 8)
    v = (abs(int(hl)) * a) >> 8
    return -v if hl < 0 else v
def project(X, Y, Z):
    P = tbl(Y, 26368) + tbl(Z, 59904)
    Q = tbl(Y, 59904) - tbl(Z, 26368)
    s = min(255, (128 * 16384) // (16384 - Q))
    return 8 * mul8x16(X, s) + 16, 8 * mul8x16(P, s) + 16, Q, s

if __name__ == "__main__":
    rec = np.load(sys.argv[1])
    if rec.shape[1] < 0x2080:
        sys.exit("needs a --banks recording (WRAM4 holds the ball's projected words wDD1E/wDD20)")
    def s16(w, a):
        v = int(w[a]) | int(w[a + 1]) << 8
        return v - 65536 if v & 0x8000 else v
    ok = bad = 0
    for f in range(rec.shape[0]):
        w = rec[f]
        X, Y, Z = s16(w, 0x402), s16(w, 0x406), s16(w, 0x40A)
        xp, pp, Q, s = project(X, Y, Z)
        gx, gp = s16(w, 0x1080 + 0xD1E), s16(w, 0x1080 + 0xD20)
        if (xp, pp) == (gx, gp): ok += 1
        else:
            bad += 1
            if bad <= 5: print("frame %d ball (%d,%d,%d): calc %d/%d game %d/%d Q=%d s=%d" % (f, X, Y, Z, xp, pp, gx, gp, Q, s))
    print("%d frames match, %d differ" % (ok, bad))

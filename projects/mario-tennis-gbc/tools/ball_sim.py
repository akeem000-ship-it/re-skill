"""Re-implementation of the ball step (08:576B) without net/hit logic,
validated against PyBoy recordings (tools/emu_record.py).

Per frame (in-game order):
  pos += vel                                   (08:5A87; pos 16.16, vel 8.16)
  drag: k = (|speed_int| >> 4) + 1 ; v -= floor(v*k/512)   (08:55B4 for X, Y, Z)
        speed = wC42C/D, 8.8 magnitude of the velocity, recomputed each frame (quadratic-ish drag)
  spin (08:5613): side = wC41E: vX -= side*vY>>12, vY += side*vX>>12 ;
                 top = wC41C: vZ += top*|vxy|>>12, push -(top*vZ>>13) along heading wC40E ;
                 each spin -= 3*(spin>>8)
  airborne: vZ += $4A00 (/65536 = 0.289)        (08:57BC)
  ground (Z >= 0): Z = -Z ; vZ = ~vZ ; v *= wC4AC/256 (X,Y), wC4AD/256 (Z) (08:46B0)
  fences (08:5949): Y >= $6E0 or Y < -$700, |X| >= $3A0 -> reflect, re-step, damp twice
usage: ball_sim.py name F0 F1 [--self]   (--self: no values taken from the recording after F0)
"""
import sys, math
import numpy as np

def s32(r, o):
    v = int(r[o]) | int(r[o+1]) << 8 | int(r[o+2]) << 16 | int(r[o+3]) << 24
    return v - (1 << 32) if v >= 1 << 31 else v
def s24(r, o):
    v = int(r[o]) | int(r[o+1]) << 8 | int(r[o+2]) << 16
    return v - (1 << 24) if v >= 1 << 23 else v

def drag(v, k):
    # VERIFIED: full-precision v*k/512 (floor) matches PyBoy to <0.011 px over 39 frames
    return v - (v * k) // 512

def s16(r, o):
    v = int(r[o]) | int(r[o+1]) << 8
    return v - 65536 if v >= 32768 else v


def mshr(p, n):
    """game shifts the magnitude of a signed product, then restores the sign"""
    return (abs(p) >> n) * (1 if p >= 0 else -1)


def heading(s):
    """wC40E: atan2(vY, vX), 16-bit angle quantised to $40 steps"""
    a = math.atan2(s["vY"], s["vX"]) / (2 * math.pi) * 65536
    return int(round(a / 64)) * 64 & 0xFFFF


def spin(s, spdxy):
    """08:5613: sidespin (wC41E) curves the ball, topspin (wC41C) dips it; both decay 3/256 per frame"""
    vX88, vY88, vZ88 = s["vX"] >> 8, s["vY"] >> 8, s["vZ"] >> 8
    side, top = s.get("side", 0), s.get("top", 0)
    if side:
        dX = -mshr(side * vY88, 12); dY = mshr(side * vX88, 12)
        s["vY"] += dY; s["vX"] += dX
        s["side"] = side - 3 * (side >> 8)
    if top:
        t1 = -mshr(top * vZ88, 13)
        s["vZ"] += mshr(top * spdxy, 12)
        a = s["head"] / 65536 * 2 * math.pi
        s["vY"] += int(2 * t1 * math.sin(a)); s["vX"] += int(2 * t1 * math.cos(a))
        s["top"] = top - 3 * (top >> 8)


def damp(s, f_ac, f_ad):                       # 08:46B0
    s["vX"] = s["vX"] * f_ac // 256; s["vY"] = s["vY"] * f_ac // 256; s["vZ"] = s["vZ"] * f_ad // 256


def fences(s, f_ac, f_ad):                     # 08:5949
    Y = s["Y"] >> 16
    if Y >= 0x6E0 or Y < -0x700:
        s["vY"] = ~s["vY"]; s["Y"] += s["vY"]; damp(s, f_ac, f_ad); damp(s, f_ac, f_ad)
    if abs(s["X"] >> 16) >= 0x3A0:
        s["vX"] = ~s["vX"]; s["X"] += s["vX"]; damp(s, f_ac, f_ad); damp(s, f_ac, f_ad)


def speed_int(s):
    return int(((s["vX"] / 65536) ** 2 + (s["vY"] / 65536) ** 2 + (s["vZ"] / 65536) ** 2) ** 0.5)


def step(s, c42d, f_ac, f_ad):
    spdxy = int(math.hypot(s["vX"] / 65536, s["vY"] / 65536) * 256)   # wC42A, from the pre-step velocity
    s["head"] = heading(s)
    s["X"] += s["vX"]; s["Y"] += s["vY"]; s["Z"] += s["vZ"]
    fences(s, f_ac, f_ad)
    if c42d is None:
        c42d = speed_int(s)
    k = (abs(c42d) >> 4) + 1
    s["vX"], s["vY"], s["vZ"] = drag(s["vX"], k), drag(s["vY"], k), drag(s["vZ"], k)
    spin(s, spdxy)
    if s["Z"] < 0:
        s["vZ"] += 0x4A00
    else:
        s["Z"] = -s["Z"]; s["vZ"] = ~s["vZ"]
        damp(s, f_ac, f_ad)

def main():
    name, f0, f1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    rec = np.load("states/rec_%s.npy" % name)
    r = rec[f0]
    s = dict(X=s32(r, 0x400), Y=s32(r, 0x404), Z=s32(r, 0x408), vX=s24(r, 0x420), vY=s24(r, 0x423), vZ=s24(r, 0x426),
             side=s16(r, 0x41E), top=s16(r, 0x41C))
    worst = 0
    print("frame   simY      realY    simZ     realZ    errY   errZ")
    for f in range(f0 + 1, f1):
        r = rec[f]          # wC42C/D (ball speed 8.8) is recomputed inside this frame's step
        c = int(r[0x42D]); c = c - 256 if c > 127 else c
        if "--self" in sys.argv:
            c = None        # compute speed ourselves; bounce factor $CD
            step(s, c, 0xCD, 0xCD)
        else:
            step(s, c, int(r[0x4AC]), int(r[0x4AD]))
        R = rec[f]
        ey = (s["Y"] - s32(R, 0x404)) / 65536; ez = (s["Z"] - s32(R, 0x408)) / 65536
        worst = max(worst, abs(ey), abs(ez))
        print("%5d %8.2f %8.2f %8.2f %8.2f %6.3f %6.3f" % (f, s["Y"]/65536, s32(R, 0x404)/65536, s["Z"]/65536, s32(R, 0x408)/65536, ey, ez))
    print("max abs error: %.4f px" % worst)

if __name__ == "__main__":
    main()

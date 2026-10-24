"""List positions of a terrain type on a hole (cell centres, in the ball's x/y integer units).

usage: find_terrain.py HOLE_ID TYPE [--near X Y] [--n N]   (hex values; --near sorts by distance to X, Y)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_sim import Hole


def main():
    a = sys.argv[1:]
    h = Hole(int(a[0], 16))
    t = int(a[1], 16)
    n = int(a[a.index("--n") + 1]) if "--n" in a else 10
    pts = []
    for cy in range(256):
        for cx in range(256):
            x, y = (cx >> 2) << 8 | (cx & 3) << 6 | 0x20, (cy >> 2) << 8 | (cy & 3) << 6 | 0x20
            if h.terrain_at(x, y) == t:
                pts.append((x, y))
    if "--near" in a:
        i = a.index("--near")
        nx, ny = int(a[i + 1], 16), int(a[i + 2], 16)
        pts.sort(key=lambda p: (p[0] - nx) ** 2 + (p[1] - ny) ** 2)
    print("%d cells of type %x" % (len(pts), t))
    for x, y in pts[:n]:
        print("x %04x y %04x" % (x, y))


if __name__ == "__main__":
    main()

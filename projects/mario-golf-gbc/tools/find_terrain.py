"""List positions of a terrain type on a hole (cell centres, in the ball's x/y integer units), or with TYPE
"tree" the tree tiles (bit 7 of the tile's $D700 byte, read by the tree check 08:51D2; tile centres).

usage: find_terrain.py HOLE_ID TYPE|tree [--near X Y] [--n N]   (hex values; --near sorts by distance to X, Y)
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ball_sim import Hole


def main():
    a = sys.argv[1:]
    h = Hole(int(a[0], 16))
    n = int(a[a.index("--n") + 1]) if "--n" in a else 10
    pts = []
    if a[1] == "tree":
        t = "tree"
        for ty in range(64):
            for tx in range(64):
                if h.slope[h.tmap[ty << 6 | tx]] & 0x80:
                    pts.append((tx << 8 | 0x80, ty << 8 | 0x80))
    else:
        t = int(a[1], 16)
    for cy in range(256 if t != "tree" else 0):
        for cx in range(256):
            x, y = (cx >> 2) << 8 | (cx & 3) << 6 | 0x20, (cy >> 2) << 8 | (cy & 3) << 6 | 0x20
            if h.terrain_at(x, y) == t:
                pts.append((x, y))
    if "--near" in a:
        i = a.index("--near")
        nx, ny = int(a[i + 1], 16), int(a[i + 2], 16)
        pts.sort(key=lambda p: (p[0] - nx) ** 2 + (p[1] - ny) ** 2)
    print("%d %s" % (len(pts), "tree tiles" if t == "tree" else "cells of type %x" % t))
    for x, y in pts[:n]:
        print("x %04x y %04x" % (x, y))


if __name__ == "__main__":
    main()

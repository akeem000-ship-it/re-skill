"""Tile several PNGs into one contact sheet (nearest-neighbour downscale).
usage: render_montage.py out.png cols maxw img1.png img2.png ...
"""
import sys, png


def load(p):
    w, h, rows, info = png.Reader(filename=p).asRGB8()
    rows = [list(r) for r in rows]
    return w, h, rows


def main():
    out, cols, maxw = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    imgs = [load(p) for p in sys.argv[4:]]
    cell = maxw
    rows_n = (len(imgs) + cols - 1) // cols
    W, H = cols * (cell + 4), rows_n * (cell + 4)
    canvas = [[40] * (W * 3) for _ in range(H)]
    for k, (w, h, rows) in enumerate(imgs):
        sc = max(w, h) / cell
        cx, cy = (k % cols) * (cell + 4), (k // cols) * (cell + 4)
        for y in range(int(h / sc)):
            sr = rows[int(y * sc)]
            for x in range(int(w / sc)):
                sx = int(x * sc) * 3
                canvas[cy + y][(cx + x) * 3:(cx + x) * 3 + 3] = sr[sx:sx + 3]
    png.Writer(W, H, greyscale=False).write(open(out, "wb"), canvas)


if __name__ == "__main__":
    main()

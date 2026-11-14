"""Crop and enlarge a region of a PNG (nearest neighbour), for looking closely at screenshots.

usage: python3 tools/crop_zoom.py IN.png OUT.png X Y W H [SCALE=4]
Needs Pillow."""
import sys
from PIL import Image


def main():
    src, out = sys.argv[1], sys.argv[2]
    x, y, w, h = (int(v) for v in sys.argv[3:7])
    k = int(sys.argv[7]) if len(sys.argv) > 7 else 4
    im = Image.open(src).convert("RGB").crop((x, y, x + w, y + h))
    im.resize((w * k, h * k), Image.NEAREST).save(out)
    print(out, im.size)


if __name__ == "__main__":
    main()

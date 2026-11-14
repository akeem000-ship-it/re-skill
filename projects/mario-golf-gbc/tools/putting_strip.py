#!/usr/bin/env python3
"""Frame strips and GIFs of the 3D green's grass motion (GREEN: Clean) from web/tests/putting_view.mjs --shots pictures.

usage: python3 tools/putting_strip.py [dir]   (default out/putting_built)

For every NAME_desk_motion_t0..tN.png in the folder: NAME_motion_strip.png (the frames 0.25 s apart side by side, then |t0 - t2|
x 4 so the moving parts show) and NAME_motion.gif (the frames looped at 0.25 s), and a 2x crop of the middle (NAME_motion_crop.gif).
"""
import glob
import os
import sys

from PIL import Image, ImageChops, ImageDraw

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    d = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out", "putting_built")
    groups = {}
    for f in sorted(glob.glob(os.path.join(d, "*_motion_t[0-9].png"))):
        groups.setdefault(os.path.basename(f).split("_motion_t")[0], []).append(f)
    for name, files in sorted(groups.items()):
        ims = [Image.open(f).convert("RGB") for f in files]
        w, h = ims[0].size
        diff = ImageChops.difference(ims[0], ims[2 if len(ims) > 2 else -1]).point(lambda v: min(255, v * 4))
        strip = Image.new("RGB", ((w + 4) * (len(ims) + 1), h + 18), (20, 20, 20))
        dr = ImageDraw.Draw(strip)
        for i, im in enumerate(ims + [diff]):
            strip.paste(im, (i * (w + 4), 18))
            dr.text((i * (w + 4) + 4, 3), f"t = {i * 0.25:.2f} s" if i < len(ims) else "|t0 - t0.5s| x 4", fill=(230, 230, 230))
        strip.save(os.path.join(d, f"{name}_motion_strip.png"))
        ims[0].save(os.path.join(d, f"{name}_motion.gif"), save_all=True, append_images=ims[1:], duration=250, loop=0)
        box = (w // 4, int(h * 0.3), w * 3 // 4, int(h * 0.8))
        crop = [im.crop(box).resize(((box[2] - box[0]) * 2, (box[3] - box[1]) * 2), Image.LANCZOS) for im in ims]
        crop[0].save(os.path.join(d, f"{name}_motion_crop.gif"), save_all=True, append_images=crop[1:], duration=250, loop=0)
        mid = (w // 6, int(h * 0.45), w * 5 // 6, int(h * 0.8))   # (the green in front of the ball: how much moved)
        dd = ImageChops.difference(ims[0].crop(mid), ims[2 if len(ims) > 2 else -1].crop(mid)).convert("L")
        hist = dd.histogram(); n = sum(hist)
        moved = sum(hist[6:]) / n
        print(name, len(ims), "frames; the green in front of the ball: mean change", round(sum(i * c for i, c in enumerate(hist)) / n, 2), "levels,", round(moved * 100, 1), "% of pixels by 6+")


if __name__ == "__main__":
    main()

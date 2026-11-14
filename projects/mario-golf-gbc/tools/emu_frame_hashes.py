"""Per-frame screen hashes from PyBoy from power-on (no inputs, or a key script), for lockstep checks
of the JS core: FNV-1a over the 5-bit RGB framebuffer (r>>3, g>>3, b>>3 per pixel, row-major), the
same hash web/js/gb/gbc.js computes. Also saves a PNG every --png K frames into out/pyframes/.
--state FILE starts from a PyBoy state instead of power-on; --presses REC.json takes the presses of a recording
(tools/emu_play_hole.py: {"presses": {frame: "button[:hold]"}}, frames counted from the state).
usage: emu_frame_hashes.py FRAMES OUT.txt [--keys F:button,...] [--state FILE] [--presses REC.json] [--png K]"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
import numpy as np, json
a = sys.argv[1:]; N = int(a[0]); out = a[1]
png = int(a[a.index("--png") + 1]) if "--png" in a else 0
keys, hold = {}, {}
if "--keys" in a:
    for k in a[a.index("--keys") + 1].split(","):
        f, b = k.split(":"); keys[int(f)] = b
if "--presses" in a:
    for f, b in json.load(open(a[a.index("--presses") + 1]))["presses"].items():
        name, _, n = b.partition(":")
        keys[int(f)] = name
        if n: hold[int(f)] = int(n)
release = {}
e = Emu(fresh="--state" not in a)
if "--state" in a:
    e.load(a[a.index("--state") + 1])
def fnv(b):
    h = 0x811c9dc5
    for x in b: h = ((h ^ int(x)) * 0x01000193) & 0xFFFFFFFF
    return "%08x" % h
with open(out, "w") as f:
    for fr in range(N):
        if fr in keys:
            e.pb.button_press(keys[fr]); release.setdefault(fr + hold.get(fr, 6), []).append(keys[fr])
        for b in release.pop(fr, []): e.pb.button_release(b)
        e.run(1)
        arr = np.asarray(e.pb.screen.ndarray)[:, :, :3] >> 3   # H x W x RGB
        f.write("%d %s\n" % (fr, fnv(arr.astype(np.uint8).reshape(-1))))
        if png and fr % png == 0:
            os.makedirs("out/pyframes", exist_ok=True); e.shot("out/pyframes/f%05d.png" % fr, 1)
print("wrote", out)
e.stop()

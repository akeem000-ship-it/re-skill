"""Bot-play from STATE and save a contact sheet of screenshots: one every STEP frames, COUNT shots.
usage: emu_contact_sheet.py STATE STEP COUNT OUT.png [--skip N] [--scale K] [--save FRAME OUT.state]"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from PIL import Image, ImageDraw
a = sys.argv[1:]
step, count, out = int(a[1]), int(a[2]), a[3]
skip = int(a[a.index("--skip") + 1]) if "--skip" in a else 0
scale = int(a[a.index("--scale") + 1]) if "--scale" in a else 1
saves = {int(a[i + 1]): a[i + 2] for i, t in enumerate(a) if t == "--save"}   # several --save FRAME OUT pairs allowed
e = Emu(); e.load(a[0])
def s32(addr):
    m = e.mem; v = m[addr] | m[addr+1] << 8 | m[addr+2] << 16 | m[addr+3] << 24
    return (v - (1 << 32) if v >= 1 << 31 else v) / 65536
def s24w(b, addr):
    d = e.wram(b, addr, 3); v = d[0] | d[1] << 8 | d[2] << 16
    return (v - (1 << 24) if v >= 1 << 23 else v) / 256
held = set(); cool = 0
def hold(b, on):
    if on and b not in held: e.pb.button_press(b); held.add(b)
    if not on and b in held: e.pb.button_release(b); held.discard(b)
cols = 5; rows = (count + cols - 1) // cols
W, H = 160 * scale, 144 * scale + 10
sheet = Image.new("RGB", (cols * W, rows * H), (30, 30, 30)); draw = ImageDraw.Draw(sheet)
shots = 0
for f in range(skip + step * count):
    if f in saves: e.save(saves[f]); print("saved", saves[f])
    if f >= skip and (f - skip) % step == 0:
        img = e.pb.screen.image.convert("RGB").resize((160 * scale, 144 * scale), 0); x, y = (shots % cols) * W, (shots // cols) * H
        sheet.paste(img, (x, y + 10)); draw.text((x + 2, y), "f%d m%d" % (f, e.mem[0xC494]), fill=(255, 255, 0)); shots += 1
    bx, by, bz = s32(0xC400), s32(0xC404), s32(0xC408)
    vy = e.mem[0xC425]; vy = vy - 256 if vy > 127 else vy
    vz = e.mem[0xC428]; vz = vz - 256 if vz > 127 else vz
    px, py = s24w(4, 0xDF00), s24w(4, 0xDF03)
    coming = vy > 0 and by < py
    hold("right", (bx if coming else 0) > px + 12); hold("left", (bx if coming else 0) < px - 12)
    pa = False; tossing = abs(by - py) < 8 and vy == 0 and bz < -60
    if cool == 0 and coming and abs(by - py) < 160 and abs(bx - px) < 90: pa = True; cool = 40
    elif tossing and vz >= 0 and bz < -250 and cool == 0: pa = True; cool = 30
    elif not tossing and f % 90 == 5 and abs(bz) < 1 and vy == 0: pa = True
    hold("a", pa); cool = max(0, cool - 1)
    e.run(1)
sheet.save(out); print("wrote", out, shots, "shots")
e.stop()

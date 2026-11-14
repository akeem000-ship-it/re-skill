# A labelled grid of images (before / after sheets of the 3D view). usage: python3 tools/sheet.py OUT.png "TITLE" COLS W H label=path [label=path ...]   ("-" = blank)
# NOTE="line|line" in the environment: notes under the grid
import os, sys
from PIL import Image, ImageDraw, ImageFont
out, title, cols, W, H = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4]), int(sys.argv[5])
items = [a.split("=", 1) for a in sys.argv[6:]]
P, T, TT = 6, 20, 30
rows = (len(items) + cols - 1) // cols
notes = [l for l in os.environ.get("NOTE", "").split("|") if l]
img = Image.new("RGB", (cols * (W + P) + P, TT + rows * (H + T + P) + P + 18 * len(notes)), (24, 24, 22))
d = ImageDraw.Draw(img)
def font(n):
    try: return ImageFont.truetype("DejaVuSans-Bold.ttf", n)
    except OSError: return ImageFont.load_default()
f, ft = font(13), font(18)
d.text((P, 6), title, fill=(255, 235, 160), font=ft)
for i, (lab, p) in enumerate(items):
    x, y = P + (i % cols) * (W + P), TT + (i // cols) * (H + T + P)
    d.text((x, y + 3), lab, fill=(235, 235, 225), font=f)
    if p != "-":
        try: img.paste(Image.open(p).convert("RGB").resize((W, H), Image.LANCZOS), (x, y + T))
        except FileNotFoundError: d.text((x + 10, y + T + 10), "(missing)", fill=(200, 80, 80), font=f)
for k, l in enumerate(notes): d.text((P, TT + rows * (H + T + P) + 18 * k), l, fill=(210, 210, 200), font=f)
img.save(out)
print(out, img.size)

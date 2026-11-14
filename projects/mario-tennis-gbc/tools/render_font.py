"""Render the dialogue font: 91 glyphs ($20-$7A), 8x8 2bpp tiles at 05:7920 (16 bytes each), proportional widths at 05:7F80 (DrawGlyph 05:7322, CharWidth 05:7366).
usage: render_font.py [-o gfx/font.png] [--text "Hello"]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset
from PIL import Image

rom = load_rom()
GLYPHS, WIDTHS = to_offset(5, 0x7920), to_offset(5, 0x7F80)


SHADE = [255, 170, 85, 0]


def plot(img, g, ox, oy):
    for y in range(8):
        lo, hi = g[2 * y], g[2 * y + 1]
        for b in range(8):
            m = 0x80 >> b
            img.putpixel((ox + b, oy + y), SHADE[(1 if lo & m else 0) | (2 if hi & m else 0)])


def glyph(c):
    i = ord(c) - 0x20
    return rom[GLYPHS + i * 16:GLYPHS + i * 16 + 16], rom[WIDTHS + i]


def main():
    a = sys.argv[1:]
    out = a[a.index("-o") + 1] if "-o" in a else "gfx/font.png"
    text = a[a.index("--text") + 1] if "--text" in a else None
    if text:
        w = sum(glyph(c)[1] for c in text)
        img = Image.new("L", (w + 12, 12), 255); x = 2
        for c in text:
            g, cw = glyph(c); plot(img, g, x, 2); x += cw
    else:
        img = Image.new("L", (16 * 10, 6 * 10), 255)
        for i in range(91):
            g, _ = glyph(chr(0x20 + i)); plot(img, g, (i % 16) * 10, (i // 16) * 10)
    img = img.resize((img.width * 3, img.height * 3), Image.NEAREST)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True); img.save(out); print(out)


if __name__ == "__main__":
    main()

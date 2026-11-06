"""Contact sheet: a grid of PNG images with their file names, for looking at many screenshots at once.

usage: python3 tools/contact_sheet.py OUT.png COLS WIDTH IMG.png [IMG.png ...]
Each image is scaled to WIDTH pixels wide (nearest neighbour), laid out COLS per row with its name under it.
Needs Pillow."""
import sys
from PIL import Image, ImageDraw


def main():
    out, cols, width = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
    files = sys.argv[4:]
    ims = []
    for f in files:
        im = Image.open(f).convert("RGB")
        h = round(im.height * width / im.width)
        ims.append((f.rsplit("/", 1)[-1], im.resize((width, h))))
    rowh = []
    for i in range(0, len(ims), cols):
        rowh.append(max(im.height for _, im in ims[i:i + cols]) + 14)
    sheet = Image.new("RGB", (cols * (width + 4), sum(rowh)), (24, 24, 24))
    d = ImageDraw.Draw(sheet)
    y = 0
    for r, i in enumerate(range(0, len(ims), cols)):
        for c, (name, im) in enumerate(ims[i:i + cols]):
            x = c * (width + 4)
            sheet.paste(im, (x, y))
            d.text((x + 2, y + im.height + 1), name, fill=(230, 230, 230))
        y += rowh[r]
    sheet.save(out)
    print(out, sheet.size)


if __name__ == "__main__":
    main()

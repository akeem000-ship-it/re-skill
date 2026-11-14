"""2bpp tile decoding and PNG output helpers (pypng)."""
import png

DMG_GREYS = [(0xE0, 0xF8, 0xD0), (0x88, 0xC0, 0x70), (0x34, 0x68, 0x56), (0x08, 0x18, 0x20)]
GREYS = [(255, 255, 255), (170, 170, 170), (85, 85, 85), (0, 0, 0)]


def tile_pixels(data, off):
    """8x8 2bpp tile -> list of 8 rows of color indices 0-3."""
    rows = []
    for y in range(8):
        lo, hi = data[off + y * 2], data[off + y * 2 + 1]
        rows.append([((lo >> (7 - x)) & 1) | (((hi >> (7 - x)) & 1) << 1) for x in range(8)])
    return rows


def bgr555(w):
    r, g, b = w & 31, (w >> 5) & 31, (w >> 10) & 31
    return (r * 255 // 31, g * 255 // 31, b * 255 // 31)


def palette_from_bytes(data, off, n=4):
    return [bgr555(data[off + i * 2] | data[off + i * 2 + 1] << 8) for i in range(n)]


def apply_bgp(reg, pal=GREYS):
    return [pal[(reg >> (i * 2)) & 3] for i in range(4)]


def write_png(path, pixels, scale=1):
    """pixels: rows of (r,g,b) tuples."""
    h = len(pixels); w = len(pixels[0])
    rows = []
    for row in pixels:
        flat = []
        for p in row:
            flat.extend(p * scale)
        for _ in range(scale):
            rows.append(flat)
    with open(path, "wb") as f:
        png.Writer(w * scale, h * scale, greyscale=False).write(f, rows)


def tilesheet(data, ntiles, cols=16, pal=GREYS, off=0):
    rows_t = (ntiles + cols - 1) // cols
    img = [[(255, 0, 255)] * (cols * 8) for _ in range(rows_t * 8)]
    for t in range(ntiles):
        if off + t * 16 + 16 > len(data):
            break
        px = tile_pixels(data, off + t * 16)
        tx, ty = (t % cols) * 8, (t // cols) * 8
        for y in range(8):
            for x in range(8):
                img[ty + y][tx + x] = pal[px[y][x]]
    return img

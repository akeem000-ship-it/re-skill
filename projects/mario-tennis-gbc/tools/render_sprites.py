"""Render character sprite frames (LoadCharacterSprites 04:4B68).

Character table 04:4F75: per char id a bank ref (idx, bank). The 16-byte header at
[bank:$4000+idx] (copied to $DAD0 by the game):
  +0 u8  -> wDF37/wDF3A (TBD)      +2 u16 TBD
  +4 ptr frame tile-data pointer list   (wDF24)
  +6 ptr animation script list          (wDF28)
  +8 u16 0
  +A ptr per-frame info, 4 B/frame      (wDF38): dy, dx, flag, ntiles
Upload (00:2E6B): copies ntiles*16 bytes of the frame to VRAM; when flag != 0 a second
chunk at +$100 is copied 3 tiles further. Drawn as 8x16 OBJ column-major (00:2C2B/2CED):
tile t -> column t//4, row t%4 (8x8 units).

Char ids 0-29 -> banks 40-5D (145 frames each; tennis players). Ids 30-45 -> banks 6F-71
use a different header (+2 = 04 02) and small frame counts: NPC/minigame sprites (TBD).
Roster index -> sprite id: RosterToSprite 07:5A44 = table 07:5A50 (verified in PyBoy:
Luigi 23 -> 27, Baby Mario 25 -> 29).

usage: render_sprites.py [char|all] [--frames N]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset, ROOT
import gfx

CHAR_TABLE = (0x04, 0x4F75)
NCHARS = 46


ROSTER = ["Alex", "Nina", "Harry", "Kate", "Allie", "Joy", "Brian", "Pam", "Bob", "Beth", "Fay",
          "Curt", "Mark", "Sean", "Sammi", "Elden", "Spike", "Emily", "B. Coz", "A. Coz", "Kevin",
          "unused21", "unused22", "Luigi", "DK", "Baby Mario", "Mario", "Waluigi", "Yoshi",
          "Bowser", "Wario", "Peach"]
ROSTER_TO_SPRITE = (0x07, 0x5A50)
SCHEMES = (0x18, 0x4300)   # 5 OBJ palettes; header+0 (3..7) selects OBJ slot 3..7 loaded from here


def char_palette(rom, hdr):
    slot = hdr["raw"][0]
    if not 3 <= slot <= 7:
        return gfx.GREYS
    return gfx.palette_from_bytes(rom, to_offset(*SCHEMES) + (slot - 3) * 8)


def sprite_names(rom):
    o = to_offset(*ROSTER_TO_SPRITE)
    names = {}
    for c, n in enumerate(ROSTER):
        names.setdefault(rom[o + c], []).append(n)
    return {k: "/".join(v) for k, v in names.items()}


def w(rom, o):
    return rom[o] | rom[o + 1] << 8


def header(rom, cid):
    o = to_offset(*CHAR_TABLE) + cid * 2
    idx, bank = rom[o], rom[o + 1]
    hp = to_offset(bank, w(rom, to_offset(bank, 0x4000 + idx)))
    h = rom[hp:hp + 16]
    return bank, dict(raw=h, frames=h[4] | h[5] << 8, anims=h[6] | h[7] << 8, info=h[10] | h[11] << 8)


def frames(rom, bank, hdr, limit=256):
    out = []
    for i in range(limit):
        p = w(rom, to_offset(bank, hdr["frames"] + i * 2))
        if not 0x4000 <= p < 0x8000:
            break
        io = to_offset(bank, hdr["info"] + i * 4) if hdr["info"] else None
        info = tuple(rom[io:io + 4]) if io else (0, 0, 0, 12)
        out.append((p, info))
    return out


def draw_frame(rom, bank, ptr, info, pal=gfx.GREYS):
    n = info[3] or 12
    cols = (n + 3) // 4
    img = [[None] * (cols * 8) for _ in range(32)]
    base = to_offset(bank, ptr)
    for t in range(n):
        px = gfx.tile_pixels(rom, base + t * 16)
        c, r = t // 4, t % 4
        for y in range(8):
            for x in range(8):
                v = px[y][x]
                img[r * 8 + y][c * 8 + x] = None if v == 0 else pal[v]
    return img


def main():
    rom = load_rom()
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    nf = int(sys.argv[sys.argv.index("--frames") + 1]) if "--frames" in sys.argv else 16
    ids = range(NCHARS) if not args or args[0] == "all" else [int(args[0])]
    outdir = os.path.join(ROOT, "gfx", "sprites"); os.makedirs(outdir, exist_ok=True)
    bg = (176, 200, 232)
    for cid in ids:
        try:
            bank, hdr = header(rom, cid)
            fl = frames(rom, bank, hdr)
        except Exception as e:
            print("char %02d: error %s" % (cid, e)); continue
        if not fl:
            print("char %02d: bank %02x no frames" % (cid, bank)); continue
        shown = fl[:nf]
        pal = char_palette(rom, hdr)
        W = sum(len(draw_frame(rom, bank, p, i, pal)[0]) + 2 for p, i in shown)
        sheet = [[bg] * W for _ in range(32)]
        x0 = 0
        for p, i in shown:
            f = draw_frame(rom, bank, p, i, pal)
            for y in range(32):
                for x, c in enumerate(f[y]):
                    if c: sheet[y][x0 + x] = c
            x0 += len(f[0]) + 2
        path = os.path.join(outdir, "char_%02d.png" % cid)
        gfx.write_png(path, sheet, 2)
        print("char %02d %-16s bank %02x hdr %s frames %d info0 %s" % (
            cid, sprite_names(rom).get(cid, "-"), bank, hdr["raw"][:4].hex(), len(fl), bytes(fl[0][1]).hex()))


if __name__ == "__main__":
    main()

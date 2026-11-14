"""Find where a tile seen in a PPU dump comes from: searches the raw ROM and every LZ block reachable
from the banks' export tables for the tile's 16 bytes.
usage: find_tile_source.py DUMP.json BANK TILE [TILE...]   (hex tile numbers, VRAM $8000 + 16*tile)"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, nbanks, BANK_SIZE
from decompress import decompress
from scan_jumptables import table
rom = load_rom(); NB = nbanks(rom)
d = json.load(open(sys.argv[1])); vram = bytes.fromhex(d["vram%d" % int(sys.argv[2])])
blocks = []
for b in range(1, NB):
    try: ents = sorted(set(table(rom, b)))
    except Exception: continue
    for e in ents:
        try: out, clen = decompress(rom, b * BANK_SIZE + (e - 0x4000), limit=0x4000)
        except Exception: continue
        if len(out) >= 16: blocks.append((b, e, out))
print("%d LZ blocks" % len(blocks))
for t in sys.argv[3:]:
    tile = vram[int(t, 16) * 16:int(t, 16) * 16 + 16]
    if tile == bytes(16): print("tile", t, "is blank"); continue
    hits = []
    i = rom.find(tile)
    while i >= 0: hits.append("raw %02x:%04x" % (i // BANK_SIZE, (i % BANK_SIZE) + (0x4000 if i >= BANK_SIZE else 0))); i = rom.find(tile, i + 1)
    for b, e, out in blocks:
        j = out.find(tile)
        if j >= 0: hits.append("lz %02x:%04x +%04x (tile %d)" % (b, e, j, j // 16))
    print("tile", t, ":", ", ".join(hits[:8]) or "not found")

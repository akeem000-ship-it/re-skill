"""Print the SRAM block directory as built by the new-save routine 03:404A.

Directory: 113 records x 16 bytes at $A060 (bank 0): +0 valid, +1 SRAM bank, +2 offset from $A000,
+4 size, +6 checksum (byte sum), +8 tag (DE of SaveBlock 03:4A89). The defaults are written by a run of
`ld hl,$A0n1 / ld [hl],b1 / inc hl ...` at 03:405E, which this tool parses.
usage: dump_save_layout.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset

rom = load_rom()
o = to_offset(3, 0x405E); rows = []
while rom[o] == 0x21:
    a = rom[o + 1] | rom[o + 2] << 8
    seq = rom[o + 3:o + 17]
    bank, off_lo, off_hi, sz_lo, sz_hi = (seq[i + 1] for i in range(0, 15, 3))
    rows.append(((a - 0xA061) // 16, bank, off_hi << 8 | off_lo, sz_hi << 8 | sz_lo)); o += 17
for idx, bank, off, size in rows:
    print("block %3d ($%02x)  SRAM bank %2d  $%04x-$%04x  size $%04x%s" % (
        idx, idx, bank, 0xA000 + off, 0xA000 + off + size - 1, size, "" if bank < 4 else "  (bank >= 4: wraps on a 32 KB cart)"))

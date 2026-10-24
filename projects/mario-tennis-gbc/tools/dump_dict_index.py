"""The tennis dictionary's index (bank $3F): the first letter of each of the nine index rows (3F:545F), the index row of
each letter group (3F:54AD), and the term grid (3F:539E: a category byte per term, $00 between letters, $40 at the end)
grouped by letter, with each term's name (text 34:240 on into bank $35, as dump_text.py numbers them).
usage: dump_dict_index.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, to_offset

rom = load_rom()
rows = [rom[to_offset(0x3F, 0x545F + i)] for i in range(9)]
letter_rows = [rom[to_offset(0x3F, 0x54AD + i)] for i in range(23)]
print("index row -> first letter group:", rows)
print("letter group -> index row:", letter_rows)
groups, cur, o = [], [], to_offset(0x3F, 0x539E)
while True:
    b = rom[o]; o += 1
    if b == 0x40:
        groups.append(cur); break
    if b == 0:
        groups.append(cur); cur = []
        continue
    cur.append(b)
n = 0
for g, terms in enumerate(groups):
    print(f"group {g:2}: {len(terms)} terms, first term #{n}, categories {[hex(t) for t in terms]}")
    n += len(terms)
print("terms:", n)

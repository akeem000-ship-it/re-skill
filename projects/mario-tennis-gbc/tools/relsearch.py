"""Relative search: find byte runs whose deltas match a word's letter deltas
(finds text in unknown table encodings where a-z are contiguous).

usage: relsearch.py <word> [--max N]
prints location and inferred offset (byte - ord(letter)).
"""
import sys, os, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, from_offset

rom = load_rom()
word = sys.argv[1]
mx = int(sys.argv[sys.argv.index("--max") + 1]) if "--max" in sys.argv else 30
d = [ord(word[i + 1]) - ord(word[i]) for i in range(len(word) - 1)]
hits = collections.Counter(); shown = 0
for i in range(len(rom) - len(word)):
    ok = True
    for k, dd in enumerate(d):
        if rom[i + k + 1] - rom[i + k] != dd:
            ok = False; break
    if ok:
        off = rom[i] - ord(word[0])
        hits[off] += 1
        if shown < mx:
            b, a = from_offset(i)
            print("%02x:%04x  offset %+d" % (b, a, off)); shown += 1
print("offset histogram:", hits.most_common(5))

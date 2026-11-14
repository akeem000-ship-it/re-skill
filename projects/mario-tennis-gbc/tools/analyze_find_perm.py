"""Find byte tables T (len 32) with T[i]==v constraints and values < 46.
usage: analyze_find_perm.py i=v [i=v ...]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, from_offset
rom = load_rom()
cons = [tuple(int(x) for x in c.split("=")) for c in sys.argv[1:]]
for o in range(len(rom) - 32):
    if all(rom[o + i] == v for i, v in cons):
        t = rom[o:o + 32]
        if max(t) < 46 and len(set(t)) >= 20:
            b, a = from_offset(o)
            print("%02x:%04x  %s" % (b, a, " ".join(str(x) for x in t)))

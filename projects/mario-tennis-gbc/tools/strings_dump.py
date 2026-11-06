"""ASCII string scanner (text in this game is plain ASCII with control codes < $20).

usage: strings_dump.py [-n MINLEN] [-g pattern] [-b BANK] [--summary]
"""
import sys, os, re, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, from_offset

a = sys.argv[1:]
mn = int(a[a.index("-n") + 1]) if "-n" in a else 6
pat = re.compile(a[a.index("-g") + 1], re.I) if "-g" in a else None
bank = int(a[a.index("-b") + 1], 16) if "-b" in a else None
rom = load_rom()
lo, hi = (bank * 0x4000, bank * 0x4000 + 0x4000) if bank is not None else (0, len(rom))
per = collections.Counter()
for m in re.finditer(rb"[\x20-\x7e]{%d,}" % mn, rom[lo:hi]):
    s = m.group().decode()
    if sum(c.isalpha() for c in s) < len(s) * 0.6 or " " not in s and len(s) < 10:
        continue
    off = lo + m.start()
    b, ad = from_offset(off)
    per[b] += 1
    if "--summary" in a:
        continue
    if pat and not pat.search(s):
        continue
    print("%02x:%04x  %s" % (b, ad, s))
if "--summary" in a:
    for b, c in sorted(per.items()):
        print("bank %02x: %d strings" % (b, c))

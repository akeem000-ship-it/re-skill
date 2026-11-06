"""Heuristic search for the character stat table (roster order, 32 entries).

Scores candidate tables (stride s, 32 records) whose fields hold small values and
correlate with CharTypeTable (38:58FB): Power types should be higher in one field,
Speed types higher in another.
usage: analyze_stat_scan.py [--max-val N]
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, from_offset, to_offset

rom = load_rom()
T = rom[to_offset(0x38, 0x58FB):to_offset(0x38, 0x58FB) + 32]
POW = [i for i in range(32) if T[i] == 0]
SPD = [i for i in range(32) if T[i] == 4]
MAXV = int(sys.argv[sys.argv.index("--max-val") + 1]) if "--max-val" in sys.argv else 20
res = []
for s in range(2, 17):
    for o in range(0, len(rom) - 32 * s):
        recs = [rom[o + i * s:o + i * s + s] for i in range(30)]
        if any(max(r) > MAXV for r in recs):
            continue
        fields = [[r[f] for r in recs] for f in range(s)]
        if sum(1 for f in fields if len(set(f)) >= 3) < 3:
            continue
        def mean(f, ids): return sum(f[i] for i in ids if i < 30) / max(1, len([i for i in ids if i < 30]))
        best_p = max(mean(f, POW) - mean(f, SPD) for f in fields)
        best_s = max(mean(f, SPD) - mean(f, POW) for f in fields)
        score = min(best_p, best_s)
        if score > 0.8:
            res.append((score, s, o))
res.sort(reverse=True)
for score, s, o in res[:15]:
    b, a = from_offset(o)
    print("%.2f stride %d at %02x:%04x  %s" % (score, s, b, a, rom[o:o + s * 4].hex()))

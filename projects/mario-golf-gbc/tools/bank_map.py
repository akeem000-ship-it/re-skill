"""Per-bank evidence for the bank-role map (REVERSE.md "Bank map").

For every bank: number of $4000 table entries, how many decompress cleanly as LZ, share of $FF/$00
bytes, traced code bytes (states/code_map.json from trace_code.py, if present), and the far-call
graph from byte patterns `rst $18 ; db idx, bank` (idx even and inside the target's table):
'in' = call sites elsewhere that target this bank, 'out' = banks this bank calls.
usage: bank_map.py [--csv]
"""
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, nbanks, BANK_SIZE, ROOT
from scan_jumptables import table
from decompress import decompress

rom = load_rom(); NB = nbanks(rom)
tables = {b: table(rom, b) for b in range(1, NB)}
code = {}
cm = os.path.join(ROOT, "states", "code_map.json")
if os.path.exists(cm):
    for k, v in json.load(open(cm)).items():
        code[int(k)] = len(v)
calls_in = collections.Counter(); calls_out = collections.defaultdict(set)
for b in range(NB):
    base = b * BANK_SIZE
    data = rom[base:base + BANK_SIZE]
    for i in range(len(data) - 2):
        if data[i] != 0xDF: continue
        idx, tb = data[i + 1], data[i + 2]
        if not (1 <= tb < NB) or idx & 1 or idx // 2 >= len(tables[tb]) or tb == b: continue
        calls_in[tb] += 1; calls_out[b].add(tb)


def lz_count(b):
    ents = sorted(set(tables[b])); n = 0
    for k, e in enumerate(ents):
        try:
            out, clen = decompress(rom, b * BANK_SIZE + (e - 0x4000), limit=0x4000)
        except Exception:
            continue
        nxt = ents[k + 1] if k + 1 < len(ents) else 0x8000
        if len(out) >= 16 and e + clen <= nxt + 1 and e + clen >= nxt - 16:
            n += 1
    return n


rows = []
for b in range(NB):
    data = rom[b * BANK_SIZE:(b + 1) * BANK_SIZE]
    ff = data.count(0xFF) * 100 // BANK_SIZE; zz = data.count(0) * 100 // BANK_SIZE
    nt = len(tables[b]) if b else 0
    lz = lz_count(b) if b else 0
    rows.append((b, nt, lz, ff, zz, code.get(b, 0), calls_in[b], " ".join("%02x" % x for x in sorted(calls_out[b]))))
if "--csv" in sys.argv:
    print("bank,exports,lz,ff%,zero%,code_bytes,farcalls_in,calls_out")
    for r in rows: print(",".join(str(x) for x in r))
else:
    print("bank exports  lz  ff%  00%  code  in  out")
    for r in rows: print("%02x   %5d %4d %4d %4d %5d %4d  %s" % r)

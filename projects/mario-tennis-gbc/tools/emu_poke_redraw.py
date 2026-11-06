"""Poke WRAM bank B at ADDR with values, then play keys and screenshot (to map fields to UI).
usage: emu_poke_redraw.py STATE B ADDR v1,v2,... "keys" OUTNAME [--hook BANK:ADDR]
--hook: apply the poke every time BANK:ADDR executes (re-poke after the game re-initialises).
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
a = sys.argv[1:]
st, b, ad, vals, keys, out = a[0], int(a[1], 16), int(a[2], 16), [int(x) for x in a[3].split(",")], a[4], a[5]
e = Emu(); e.load(st)
def poke(em=None):
    old = e.mem[0xFF70]; e.mem[0xFF70] = b
    for i, v in enumerate(vals): e.mem[ad + i] = v
    e.mem[0xFF70] = old
poke()
for tok in [t for t in keys.split(",") if t]:
    wait = 30
    if "@" in tok: tok, w = tok.split("@"); wait = int(w)
    if tok != "wait":
        e.pb.button_press(tok); e.run(6); e.pb.button_release(tok)
    e.run(wait)
e.shot("gfx/emu/%s.png" % out)
print(" ".join("%02x" % x for x in e.wram(b, ad, len(vals))))
e.stop()

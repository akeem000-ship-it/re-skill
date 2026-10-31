"""Write states/phys_ref.json (ball states from rec_serve.npy) for web/tests/physics_vs_emulator.mjs.
Needs states/rec_serve.npy (tools/emu_record.py states/m2.state serve "10:a,60:a:4,90:right:30,150:a" 240).
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import numpy as np
from ball_sim import s32, s24, s16
from gbrom import ROOT
rec = np.load(os.path.join(ROOT, "states", "rec_serve.npy"))
def st(f):
    r = rec[f]
    return dict(X=s32(r, 0x400), Y=s32(r, 0x404), Z=s32(r, 0x408), vX=s24(r, 0x420), vY=s24(r, 0x423),
                vZ=s24(r, 0x426), top=s16(r, 0x41C), side=s16(r, 0x41E))
json.dump({"start66": st(66), "real66": [st(f) for f in range(66, 99)],
           "start116": st(116), "real116": [st(f) for f in range(116, 240)]},
          open(os.path.join(ROOT, "states", "phys_ref.json"), "w"))
print("wrote states/phys_ref.json")

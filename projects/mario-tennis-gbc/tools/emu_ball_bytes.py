"""Print the raw ball position/velocity bytes (wC400-wC42C) for a few frames to confirm the fixed-point
layout (position delta per frame vs the velocity bytes). usage: emu_ball_bytes.py STATE SKIP N"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
e = Emu(); e.load(sys.argv[1]); e.run(int(sys.argv[2]))
prev = None
for i in range(int(sys.argv[3])):
    m = e.mem; b = bytes(m[0xC400:0xC42D])
    y = int.from_bytes(b[4:8], "little", signed=True)
    print("Y=%10d  Ybytes %s  vY bytes %s  vX bytes %s  dY=%s" % (y, b[4:8].hex(" "), b[0x24:0x27].hex(" "), b[0x21:0x24].hex(" "), None if prev is None else y - prev))
    prev = y; e.run(1)
e.stop()

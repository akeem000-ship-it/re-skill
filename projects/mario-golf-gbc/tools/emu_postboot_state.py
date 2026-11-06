"""Save the PyBoy state at the end of the frame in which the boot ROM hands over to the cartridge ($0100), so
a JS-core snapshot (tools/emu_dump_snapshot.py) and PyBoy can run the same input script from the same point.
Prints the PyBoy frame number the state follows (power-on key scripts shift by frame + 1).
usage: emu_postboot_state.py OUT.state"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

e = Emu(fresh=True)
seen = []
e.hook(0, 0x100, lambda emu: seen.append(1))
f = 0
while not seen:
    e.run(1)
    f += 1
e.save(sys.argv[1])
print("state after PyBoy frame %d (the boot ROM handed over during it)" % (f - 1))
e.stop()

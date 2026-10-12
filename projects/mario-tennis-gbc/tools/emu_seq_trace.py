"""Log every note the sound driver plays (hook 00:3864 SeqNote) to validate dump_sound_seq.py.

usage: emu_seq_trace.py STATE FRAMES [--play ID]   (--play injects SoundStart ID at frame 5)
Prints: frame, driver channel index (wD20F), hw channel, note byte, duration, volume nibble, sequence offset.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

a = sys.argv[1:]
st, N = a[0], int(a[1])
play = int(a[a.index("--play") + 1], 16) if "--play" in a else None
e = Emu(); e.load(st)
frame = 0; log = []
def on_note(em):
    r = e.regs()
    hl = r["HL"]; note = r["A"]; dur = e.mem[hl]
    ch = e.wram(7, 0xD20F); hw = e.wram(7, 0xD20A)
    off = e.r8(0xFFD0) | e.r8(0xFFD1) << 8
    log.append((frame, ch, hw, note, dur, e.r8(0xFFD8) >> 4, off))
e.hook(0, 0x3864, on_note)
for frame in range(N):
    if play is not None and frame == 5:
        e.w8(0xC33E, play)          # wSoundQueued -> SoundStart on the next driver tick
    e.run(1)
for f, ch, hw, note, dur, vol, off in log:
    print("f%5d ch%d hw%d note %02x dur %3d vol %x off %04x" % (f, ch, hw, note, dur, vol, off))
print(len(log), "notes")
e.stop()

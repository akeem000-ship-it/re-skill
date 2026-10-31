"""Write bytes into a saved state's memory and save it as a new state (for testing rare situations).

usage: emu_poke_state.py IN.state OUT.state ADDR=HEXBYTES [...] [--frames N]
  ADDR is Wn:XXXX for WRAM bank n, or XXXX; e.g. W6:D401=a022 writes $A0 to D401 and $22 to D402.
  --frames runs N frames after poking (default 1) before saving; also saves out/<OUT name>.png
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu


def main():
    a = sys.argv[1:]
    e = Emu()
    e.load(a[0])
    for x in a[2:]:
        if "=" not in x:
            continue
        k, v = x.split("=")
        data = bytes.fromhex(v)
        if k.startswith("W"):
            bank, addr = k[1:].split(":")
            bank, addr = int(bank), int(addr, 16)
            old = e.pb.memory[0xFF70]
            e.pb.memory[0xFF70] = bank
            for i, b in enumerate(data):
                e.pb.memory[addr + i] = b
            e.pb.memory[0xFF70] = old
        else:
            for i, b in enumerate(data):
                e.pb.memory[int(k, 16) + i] = b
    n = int(a[a.index("--frames") + 1]) if "--frames" in a else 1
    e.run(n)
    e.save(a[1])
    png = "out/%s.png" % os.path.splitext(os.path.basename(a[1]))[0]
    e.shot(png)
    print(a[1], png)
    e.stop()


if __name__ == "__main__":
    main()

"""Check tools/launch_py.py (ShotLaunch 10:5F94 in Python) against the game.

1. Recorded launches (tools/emu_launch_record.py): from the RAM snapshot at ShotLaunch's entry, the ROM routine
   in tools/sm83.py and the Python port must both leave WRAM6 $D300-$D5FF and WRAM0 $C800-$CAFF as the game
   did at its return (10:49A3).
2. Random swings: the same snapshots with the club, meter, impact, lie, shot mode and golfer stats randomised;
   the ROM in the interpreter and the port must agree.

usage: test_launch.py LAUNCHES.json [...] [--n N]
"""
import sys, os, json, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom
from sm83 import Machine
import launch_py as lp

ROM = load_rom()


def ram(m):
    return bytes(m.wram[6][0x300:0x600]) + bytes(m.wram[0][0x800:0xB00])


def where(k):
    return 0xD300 + k if k < 0x300 else 0xC800 + k - 0x300


def machine(snap):
    m = Machine(ROM)
    m.load_snapshot(snap)
    m.high[0x170] = m.high[0x196] = 6
    m.frame_hook = lambda mm: True
    return m


def run_rom(m, sp):
    m.sp = sp
    m.call(0x10, 0x5F94)


def diff(a, b):
    return [(where(k), a[k], b[k]) for k in range(len(a)) if a[k] != b[k]]


def randomise(m):
    r6 = m.wram[6]
    r6[0x329] = random.randrange(0x0E)
    r6[0x44F] = random.randrange(-24, 25) & 0xFF
    r6[0x450] = random.choice([random.randrange(0x3D), 0x3C, 0x80])
    r6[0x44B], r6[0x44C] = random.randrange(-3, 4) & 0xFF, random.randrange(-3, 4) & 0xFF
    r6[0x446] = random.randrange(3)
    r6[0x4CD] = random.randrange(0x10)
    r6[0x32A] = random.choice([0, 0, 1, 2, 3])
    r6[0x32B] = random.randrange(4)
    for o in (0x4C8, 0x4CA, 0x4CB):
        r6[o] = random.randrange(-8, 8) & 0xFF
    r6[0x4CC] = random.randrange(8)
    r6[0x321] = random.randrange(8)
    r6[0x333] = random.randrange(2)
    r6[0x445] = random.choice([0, 0, 1])
    r6[0x4BF] = random.choice([0, 0, 0, 1])
    r6[0x418], r6[0x419] = random.randrange(256), random.randrange(256)


def main():
    a = sys.argv[1:]
    n = int(a[a.index("--n") + 1]) if "--n" in a else 300
    files = [x for x in a if x.endswith(".json")]
    random.seed(5)
    launches = [l for f in files for l in json.load(open(f))]
    for i, l in enumerate(launches):
        want = bytes.fromhex(l["after"]["d300"]) + bytes.fromhex(l["after"]["c800"])
        m = machine(l["snapshot"])
        run_rom(m, l["sp"])
        p = machine(l["snapshot"])
        lp.shot_launch(p)
        d_rom, d_py = diff(ram(m), want), diff(ram(p), want)
        print("launch %d: ROM in the interpreter %s, Python %s" % (i, "OK" if not d_rom else d_rom[:6], "OK" if not d_py else d_py[:6]))
    bad = 0
    for k in range(n):
        l = random.choice(launches)
        m = machine(l["snapshot"])
        random.seed(k)
        randomise(m)
        p = machine(l["snapshot"])
        random.seed(k)
        randomise(p)
        run_rom(m, l["sp"])
        lp.shot_launch(p)
        d = diff(ram(p), ram(m))
        if d:
            bad += 1
            if bad <= 3:
                r6 = p.wram[6]
                print("  case %d (club %d mode %d): %s" % (k, m.wram[6][0x329], m.wram[6][0x32A], " ".join("$%04x py %02x rom %02x" % x for x in d[:6])))
    print("random swings: %d cases, %s" % (n, "OK" if not bad else "%d mismatches" % bad))


if __name__ == "__main__":
    main()

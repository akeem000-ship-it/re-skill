"""Search the ROM for a byte pattern. usage: find_bytes.py HEXBYTES [--bank BB]   e.g. find_bytes.py "c0 5d" --bank 06"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, BANK_SIZE
rom = load_rom(); pat = bytes.fromhex(sys.argv[1].replace(" ", ""))
bank = int(sys.argv[sys.argv.index("--bank") + 1], 16) if "--bank" in sys.argv else None
i = rom.find(pat)
while i >= 0:
    b, o = i // BANK_SIZE, i % BANK_SIZE + (0x4000 if i >= BANK_SIZE else 0)
    if bank is None or b == bank: print("%02x:%04x" % (b, o))
    i = rom.find(pat, i + 1)

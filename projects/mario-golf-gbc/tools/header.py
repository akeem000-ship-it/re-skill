"""Print the cartridge header ($0100-$014F) and check both checksums.

usage: header.py
"""
import sys, os, hashlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gbrom import load_rom, ROM_PATH, BANK_SIZE

CART = {0x19: "MBC5", 0x1A: "MBC5+RAM", 0x1B: "MBC5+RAM+BATTERY", 0x1C: "MBC5+RUMBLE",
        0x1D: "MBC5+RUMBLE+RAM", 0x1E: "MBC5+RUMBLE+RAM+BATTERY", 0x03: "MBC1+RAM+BATTERY",
        0x13: "MBC3+RAM+BATTERY", 0x10: "MBC3+TIMER+RAM+BATTERY"}
RAMSZ = {0: 0, 1: 2, 2: 8, 3: 32, 4: 128, 5: 64}


def main():
    rom = load_rom()
    h = rom[0x100:0x150]
    title = rom[0x134:0x143]
    hc = 0
    for b in rom[0x134:0x14D]:
        hc = (hc - b - 1) & 0xFF
    gc = (sum(rom) - rom[0x14E] - rom[0x14F]) & 0xFFFF
    print("file        %s (%d bytes, %d banks)" % (ROM_PATH, len(rom), len(rom) // BANK_SIZE))
    print("sha1        %s" % hashlib.sha1(rom).hexdigest())
    print("entry       %s" % " ".join("%02x" % b for b in h[0:4]))
    logo_ok = hashlib.sha1(rom[0x104:0x134]).hexdigest()
    print("logo sha1   %s" % logo_ok)
    print("title       %r" % title.rstrip(b"\0").decode("ascii", "replace"))
    print("CGB flag    $%02x (%s)" % (rom[0x143], {0x80: "CGB+DMG", 0xC0: "CGB only"}.get(rom[0x143], "DMG")))
    print("licensee    new %r old $%02x" % (rom[0x144:0x146].decode("ascii", "replace"), rom[0x14B]))
    print("SGB flag    $%02x" % rom[0x146])
    print("cart type   $%02x %s" % (rom[0x147], CART.get(rom[0x147], "?")))
    print("ROM size    $%02x = %d KiB" % (rom[0x148], 32 << rom[0x148]))
    print("RAM size    $%02x = %d KiB" % (rom[0x149], RAMSZ.get(rom[0x149], -1)))
    print("region      $%02x (%s)" % (rom[0x14A], "Japan" if rom[0x14A] == 0 else "overseas"))
    print("version     $%02x" % rom[0x14C])
    print("hdr cksum   $%02x (computed $%02x) %s" % (rom[0x14D], hc, "OK" if hc == rom[0x14D] else "BAD"))
    g = rom[0x14E] << 8 | rom[0x14F]
    print("glob cksum  $%04x (computed $%04x) %s" % (g, gc, "OK" if g == gc else "BAD"))


if __name__ == "__main__":
    main()

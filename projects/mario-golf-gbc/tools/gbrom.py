"""Shared helpers: ROM loading, bank/address mapping, labels.csv, HW register names."""
import csv
import signal
signal.signal(signal.SIGPIPE, signal.SIG_DFL)
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROM_PATH = os.path.join(ROOT, "rom", "mario_golf.gbc")
LABELS_PATH = os.path.join(ROOT, "labels.csv")
BANK_SIZE = 0x4000


def load_rom(path=ROM_PATH):
    with open(path, "rb") as f:
        return f.read()


def nbanks(rom):
    return len(rom) // BANK_SIZE


def to_offset(bank, addr):
    """CPU address in a given ROM bank -> file offset."""
    if addr < 0x4000:
        return addr
    if addr < 0x8000:
        return bank * BANK_SIZE + (addr - 0x4000)
    raise ValueError("not a ROM address: %04x" % addr)


def from_offset(off):
    bank = off // BANK_SIZE
    addr = off % BANK_SIZE + (0x4000 if bank else 0)
    return bank, addr


def parse_ba(s):
    """Parse 'BB:AAAA', 'BB AAAA' or file offset '0xNNNNN' -> (bank, addr)."""
    s = s.strip()
    if ":" in s:
        b, a = s.split(":")
        return int(b, 16), int(a, 16)
    v = int(s, 16)
    if s.lower().startswith("0x") and v >= 0x8000:
        return from_offset(v)
    return (0 if v < 0x4000 else None), v


HW = {
    0xFF00: "rP1", 0xFF01: "rSB", 0xFF02: "rSC", 0xFF04: "rDIV", 0xFF05: "rTIMA",
    0xFF06: "rTMA", 0xFF07: "rTAC", 0xFF0F: "rIF", 0xFF10: "rNR10", 0xFF11: "rNR11",
    0xFF12: "rNR12", 0xFF13: "rNR13", 0xFF14: "rNR14", 0xFF16: "rNR21", 0xFF17: "rNR22",
    0xFF18: "rNR23", 0xFF19: "rNR24", 0xFF1A: "rNR30", 0xFF1B: "rNR31", 0xFF1C: "rNR32",
    0xFF1D: "rNR33", 0xFF1E: "rNR34", 0xFF20: "rNR41", 0xFF21: "rNR42", 0xFF22: "rNR43",
    0xFF23: "rNR44", 0xFF24: "rNR50", 0xFF25: "rNR51", 0xFF26: "rNR52",
    0xFF40: "rLCDC", 0xFF41: "rSTAT", 0xFF42: "rSCY", 0xFF43: "rSCX", 0xFF44: "rLY",
    0xFF45: "rLYC", 0xFF46: "rDMA", 0xFF47: "rBGP", 0xFF48: "rOBP0", 0xFF49: "rOBP1",
    0xFF4A: "rWY", 0xFF4B: "rWX", 0xFF4D: "rKEY1", 0xFF4F: "rVBK", 0xFF51: "rHDMA1",
    0xFF52: "rHDMA2", 0xFF53: "rHDMA3", 0xFF54: "rHDMA4", 0xFF55: "rHDMA5",
    0xFF56: "rRP", 0xFF68: "rBCPS", 0xFF69: "rBCPD", 0xFF6A: "rOCPS", 0xFF6B: "rOCPD",
    0xFF70: "rSVBK", 0xFFFF: "rIE",
    0x2000: "MBC5_ROMB0", 0x3000: "MBC5_ROMB1", 0x4000: "MBC5_RAMB", 0x0000: "MBC5_RAMG",
}
for _i in range(0xFF30, 0xFF40):
    HW[_i] = "_AUD3WAVE+%d" % (_i - 0xFF30)


class Labels:
    """labels.csv: bank,addr,name,comment.  bank '*' = applies to any bank (RAM/HRAM/IO)."""

    def __init__(self, path=LABELS_PATH):
        self.by = {}       # (bank, addr) -> (name, comment)
        self.names = {}    # name -> (bank, addr)
        if os.path.exists(path):
            with open(path, newline="") as f:
                for row in csv.reader(f):
                    if not row or row[0].startswith("#") or row[0] == "bank":
                        continue
                    row += [""] * (4 - len(row))
                    b, a, name, comment = row[:4]
                    bank = "*" if b.strip() == "*" else int(b, 16)
                    addr = int(a, 16)
                    self.by[(bank, addr)] = (name.strip(), comment.strip())
                    if name.strip():
                        self.names[name.strip()] = (bank, addr)

    def get(self, bank, addr):
        """Look up label for a CPU address as seen from code running in `bank`."""
        if addr < 0x4000:
            key = (0, addr)
        elif addr < 0x8000:
            key = (bank, addr)
        else:
            key = ("*", addr)
        if key in self.by:
            return self.by[key]
        if ("*", addr) in self.by:
            return self.by[("*", addr)]
        return None

    def name(self, bank, addr):
        hit = self.get(bank, addr)
        if hit and hit[0]:
            return hit[0]
        if addr in HW:
            return HW[addr]
        return None

    def resolve(self, s):
        """Accept a label name or BB:AAAA -> (bank, addr)."""
        if s in self.names:
            b, a = self.names[s]
            return (0 if b == "*" else b), a
        return parse_ba(s)

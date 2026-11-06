"""Check the decoded shot-selection rules against emu_shot_trace.py logs (REVERSE.md "Aiming and launch").

For every logged launch: recompute the speed threshold S from its logged parts, the min/max landing
distances from ball depth and heading, re-walk the ROM trajectory table and compare the record address,
and compare the real bounce with the predicted landing point.
usage: analyze_shots.py states/shots.json [more.json ...]
"""
import sys, os, json, math
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROM = open(os.path.join(ROOT, "rom", "mario_tennis.gbc"), "rb").read()
def u8(b, a): return ROM[b * 0x4000 + a - 0x4000]
def u16(b, a): return u8(b, a) | u8(b, a + 1) << 8
def s16(v): return v - 0x10000 if v & 0x8000 else v

SHOT_TABLES = {0: 0x4D31, 1: 0x4D81, 2: 0x4DD1, 3: 0x4E21, 4: 0x4E71, 9: 0x4EC1, 8: 0x4F11, 6: 0x4F61, 7: 0x4FB1,
               5: 0x5001, 10: 0x5051, 11: 0x5061, 12: 0x5071, 13: 0x50C1, 14: 0x5111}
SPEED_STAT = {0: "stroke", 1: "stroke", 2: "stroke", 3: "stroke", 4: "stroke", 9: "serve", 8: "volley", 6: "volley",
              7: "volley", 5: "volley", 12: "serve", 13: "serve", 14: "serve"}

def hband(z):                       # 424C: word table indexed by (-z)>>4 & $1F
    return ((-z) >> 4) & 0x1F

def table_base(s):
    """ROM address of the trajectory table the handler selected (bank, base, record size, mode)."""
    b, t, z = s["bank"], s["type"], s["ballZ"]
    if b in (0x20, 0x21, 0x22, 0x23):
        stat = s["slice"] if b in (0x20, 0x21) else s["top"]
        base = 0x427D + u16(b, 0x7E98 + 2 * hband(z)) + u16(b, 0x7ED8 + 2 * stat)
        return base, 6
    if b == 0x24:
        if s["variant"] == 0x4196:       # 7707 (type 5) / 6644 (type 10)
            tab, idx = (0x6707, 0x7719) if t == 5 else (0x5844, 0x6656)
            return tab + u16(b, idx + 2 * hband(z)), 4
        if s["variant"] == 0x415D:       # 4589 (type 4): 4289 + word[459C + 2*wDF92]  (wDF92 not logged)
            return None, 6
    if b == 0x2C:
        tab, idx = {0x7281: (0x4281, 0x7293)}.get(0, (None, None))
        return None, 4
    if b in (0x29, 0x2A, 0x2B):
        base = 0x427D + u16(b, 0x5EBF + 2 * s["top"]) + u16(b, 0x5ED3 + 2 * s["serve"]) + u16(b, 0x5EE7 + 2 * hband(z))
        return base, 6
    return None, 6

def walk(s, base, size):
    """TrajTableSearch: from record dMin>>6, first record with speed >= S, stop at index iMax."""
    S = s["S"]; i = s["dMin"] >> 6; hl = base + size * i
    if u16(s["bank"], hl) >= S:
        return "fallback", hl
    while True:
        if u16(s["bank"], hl) >= S or i >= s["iMax"]:
            return "ok", hl
        i += 1; hl += size

ok = bad = 0
for path in sys.argv[1:]:
    for s in json.load(open(os.path.join(ROOT, path))):
        if "rec" not in s:
            continue
        notes = []
        if s["type"] in (12, 13, 14):      # serves: direct record, speed boosted by the lateral aim offset
            s.setdefault("bank", {12: 0x29, 13: 0x2A, 14: 0x2B}[s["type"]])
            b = s["bank"]; spin = {0x29: s["top"], 0x2A: s["slice"], 0x2B: 0}[b]; d = -2 if b == 0x2B else 0
            base = 0x427D + u16(b, 0x5EBF + d + 2 * spin) + u16(b, 0x5ED3 + d + 2 * s["serve"]) + u16(b, 0x5EE7 + d + 2 * hband(s["ballZ"]))
            spd = s["rec"][0] + 4 * ((2 * abs(s["dX"]) * (s["rec"][0] >> 8)) >> 8)
            hoff = s["rec"][2]; lb = (s["heading"] + (-hoff if s["mirror"] else hoff)) & 0xFFFF
            print("f%5d type%2d bank%02x serve: addr %s speed %s hdg %s" % (s["frame"], s["type"], s["bank"],
                  "ok" if base == s["recAddr"] else "MISMATCH %04x/%04x" % (base, s["recAddr"]),
                  "ok" if spd == s["lbSpeed"] else "MISMATCH %d/%d" % (spd, s["lbSpeed"]), "ok" if lb == s["lbHeading"] else "MISMATCH"))
            continue
        if "S" not in s:
            continue
        # 1. speed threshold composition (07:5161 handler for this type)
        t = s["type"]; tab = SHOT_TABLES.get(t)
        if tab is not None:
            base_speed = u16(7, tab + 8 * s[SPEED_STAT[t]] + 4)
            S = base_speed + s["spd45A"] + (s["chg45E"] if t in (0, 1, 2, 3, 4, 9) else 0) + s["mov45C"] + (-0xC00 if s["moveFlags"] & 2 else 0)
            S = max(S, 0x100)
            notes.append("S %s" % ("ok" if S == s["S"] else "MISMATCH calc %d log %d (base %d)" % (S, s["S"], base_speed)))
        # 2. landing distance window from depth and heading
        th = s["heading"] / 65536 * 2 * math.pi
        sn = abs(math.sin(th))
        if sn > 0.5:
            dmin = (abs(s["ballY"]) + 0x140) / sn
            notes.append("dMin %s(%.0f/%d)" % ("ok" if abs(dmin - s["dMin"]) <= 3 else "OFF", dmin, s["dMin"]))
        # 3. re-walk the table
        base, size = table_base(s)
        if base is not None:
            res, hl = walk(s, base, size)
            if s.get("fallback"): notes.append("FALLBACK logged, walk says %s" % res)
            idx = (s["recAddr"] - base) // size
            notes.append("walk %s idx %d" % ("ok" if hl == s["recAddr"] else "MISMATCH %04x vs %04x (%s)" % (hl, s["recAddr"], res), idx))
            if hl == s["recAddr"]: ok += 1
            else: bad += 1
        # 4. heading offset
        hoff = s["rec"][2] if size == 6 else 0
        lb = (s["heading"] + (-hoff if s["mirror"] else hoff)) & 0xFFFF
        notes.append("hdg %s" % ("ok" if lb == s["lbHeading"] else "MISMATCH %04x/%04x" % (lb, s["lbHeading"])))
        # 5. real bounce vs predicted landing point and record distance
        if s.get("bounceX") is not None and s.get("pred"):
            d = math.hypot(s["bounceX"] - s["launchX"], s["bounceY"] - s["launchY"])
            dp = math.hypot(s["pred"][0] - s["launchX"], s["pred"][1] - s["launchY"])
            notes.append("bounce dist %.0f pred %.0f (idx*64=%d) err (%d,%d)" % (d, dp, idx * 64 if base else -1,
                         s["bounceX"] - s["pred"][0], s["bounceY"] - s["pred"][1]))
        print("f%5d type%2d bank%02x var%04x chg%2d z%4d S%6d  %s" % (s["frame"], t, s["bank"], s["variant"], s["charge"], s["ballZ"], s["S"], "; ".join(notes)))
print("table walk: %d ok, %d mismatch" % (ok, bad))

"""Trace the shot trajectory-table selection (banks 20-23, REVERSE.md "Aiming and launch").

Plays with emu_bot.py's controller from a mid-rally state and, on every shot, logs the inputs of
the selection (speed threshold BC from 07:5161, wC48A/8C min/max landing distance, wC48E/8F record
indices, heading wC43A, ball height wC40A, stats, charge wC4A2), the 6-byte record LaunchFromTraj
used (speed, elevation, heading offset) and LaunchBall's registers; then follows the ball to its
bounce and compares with the predicted landing point wC450/52 and the record index * 64.

usage: emu_shot_trace.py STATE FRAMES [--out states/shots.json] [--alt]  (--alt: alternate A/B swings)
"""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROMB = open(os.path.join(ROOT, "rom", "mario_tennis.gbc"), "rb").read()
a = sys.argv[1:]
st, N = a[0], int(a[1])
OUT = a[a.index("--out") + 1] if "--out" in a else "states/shots.json"
e = Emu(); e.load(st)

def s16(v): return v - 0x10000 if v & 0x8000 else v
def r16s(addr): return s16(e.r16(addr))
def s32(addr):
    m = e.mem; v = m[addr] | m[addr+1] << 8 | m[addr+2] << 16 | m[addr+3] << 24
    return (v - (1 << 32) if v >= 1 << 31 else v) / 65536
def s24w(bank, addr):
    d = e.wram(bank, addr, 3); v = d[0] | d[1] << 8 | d[2] << 16
    return (v - (1 << 24) if v >= 1 << 23 else v) / 256
def rom(bank, addr, n): o = bank * 0x4000 + addr - 0x4000; return ROMB[o:o + n]

frame = 0; shots = []; cur = None; pending = []   # pending: shots waiting for the bounce

def actor_stats():
    return dict(actor=e.r8(0xFFEA), stroke=e.r8(0xDF6B), serve=e.r8(0xDF6C), volley=e.r8(0xDF6D),
                top=e.r8(0xDF6E), slice=e.r8(0xDF6F), posCode=e.r8(0xDF0A), moveFlags=e.r8(0xDF0F),
                aimDir=s16(e.r8(0xDF4A) | (0xFF00 if e.r8(0xDF4A) & 0x80 else 0)),
                playerX=s24w(4, 0xDF00), playerY=s24w(4, 0xDF03), plVelY=r16s(0xDF42))

def on_5161(em):      # speed-threshold computation starts: snapshot the inputs
    global cur
    cur = dict(frame=frame, type=e.r8(0xC4A0), flag6=e.r8(0xC4A6), charge=e.r8(0xC4A2), mirror=e.r8(0xC4A7),
               ballX=r16s(0xC402), ballY=r16s(0xC406), ballZ=r16s(0xC40A), ballVY=r16s(0xC424), ballVX=r16s(0xC421),
               tgtX=r16s(0xC430), tgtY=r16s(0xC432), dX=r16s(0xC434), dY=r16s(0xC436), heading=e.r16(0xC43A),
               dMin=r16s(0xC48A), dMax=r16s(0xC48C), iMin=e.r8(0xC48E), iMax=e.r8(0xC48F), sideline=r16s(0xC484),
               **actor_stats())

def on_select(em, variant):   # 4102/4135/415D/4196/41C9 entry: BC = speed threshold
    if cur is None: return
    r = e.regs(); cur.update(bank=e.rom_bank(), variant=variant, S=r["B"] << 8 | r["C"],
                             spd45A=r16s(0xC45A), chg45E=r16s(0xC45E), mov45C=r16s(0xC45C))

def on_launch_traj(em):
    if cur is None: return
    r = e.regs(); hl = r["HL"]; rec = rom(e.rom_bank(), hl, 6)
    cur.setdefault("bank", e.rom_bank())
    cur.update(recAddr=hl, rec=[s16(rec[0] | rec[1] << 8), s16(rec[2] | rec[3] << 8), s16(rec[4] | rec[5] << 8)])

def on_fallback(em):
    if cur is not None: cur["fallback"] = True

def on_launchball(em):
    global cur
    r = e.regs()
    rec = cur if cur is not None else dict(frame=frame, type=e.r8(0xC4A0), heading=e.r16(0xC43A), **actor_stats())
    rec.update(lbSpeed=r["HL"], lbElev=s16(r["B"] << 8 | r["C"]), lbHeading=r["D"] << 8 | r["E"],
               launchX=r16s(0xC402), launchY=r16s(0xC406), launchZ=r16s(0xC40A), topspin=r16s(0xC41C), side=r16s(0xC41E))
    shots.append(rec); pending.append(rec); cur = None

def on_inout(em):     # 08:463A InOutCheck runs at the bounce: attach the landing point to the last shot
    if pending:
        p = pending.pop(0); pending.clear()
        p.update(bounceX=r16s(0xC402), bounceY=r16s(0xC406), bounceFrame=frame, pred=[r16s(0xC450), r16s(0xC452)])

e.hook(7, 0x5161, on_5161)
# the same trajectory library sits at $4000 in banks 20-23/29-2B, at +$0C in bank 24 and +$04 in bank 2C
for b, d in ((0x20, 0), (0x21, 0), (0x22, 0), (0x23, 0), (0x29, 0), (0x2A, 0), (0x2B, 0), (0x24, 0x0C), (0x2C, 0x04)):
    for addr in (0x4102, 0x4135, 0x415D, 0x4196, 0x41C9):
        e.hook(b, addr + d, lambda em, v=addr: on_select(em, v))
    e.hook(b, 0x405D + d, on_launch_traj); e.hook(b, 0x4084 + d, on_launch_traj); e.hook(b, 0x4098 + d, on_launch_traj)
    e.hook(b, 0x41F1 + d, on_fallback)
e.hook(8, 0x45A9, on_launchball)
e.hook(8, 0x463A, on_inout)

# --- bot controller (same as emu_bot.py) ---
held = set(); swing_cool = 0; swings = 0
ALT = "--alt" in a        # alternate A (topspin) and B (slice) swings
def hold(b, on):
    if on and b not in held: e.pb.button_press(b); held.add(b)
    if not on and b in held: e.pb.button_release(b); held.discard(b)
for frame in range(N):
    bx, by, bz = s32(0xC400), s32(0xC404), s32(0xC408)
    vy = e.mem[0xC425]; vy = vy - 256 if vy > 127 else vy
    px, py = s24w(4, 0xDF00), s24w(4, 0xDF03)
    coming = vy > 0 and by < py
    tx = bx if coming else 0
    hold("right", tx > px + 12); hold("left", tx < px - 12)
    press_a = False
    if swing_cool == 0 and coming and abs(by - py) < 160 and abs(bx - px) < 90:
        press_a = True; swing_cool = 40
    vz = e.mem[0xC428]; vz = vz - 256 if vz > 127 else vz
    tossing = abs(by - py) < 8 and vy == 0 and bz < -60
    if tossing and vz >= 0 and bz < -250 and swing_cool == 0:
        press_a = True; swing_cool = 30
    elif not tossing and frame % 90 == 5 and abs(bz) < 1 and vy == 0:
        press_a = True
    if press_a and swing_cool in (40, 30): swings += 1
    useB = ALT and swings % 2 == 1 and not tossing
    hold("a", press_a and not useB); hold("b", press_a and useB)
    swing_cool = max(0, swing_cool - 1)
    e.run(1)

with open(os.path.join(ROOT, OUT), "w") as f:
    json.dump(shots, f, indent=0)
print("%d launches, %d with table records, %d fallbacks" % (len(shots), sum("rec" in s for s in shots), sum(s.get("fallback", False) for s in shots)))
for s in shots:
    print("f%5d act%d type%2d bank%s var%s S=%s chg%2s  h=%04x dmin=%s dmax=%s i=%s..%s z=%s  rec=%s  LB=%s/%s/%04x  land=%s pred=%s" % (
        s["frame"], s["actor"], s["type"], "%02x" % s["bank"] if "bank" in s else "--", "%04x" % s["variant"] if "variant" in s else "----",
        s.get("S"), s.get("charge"), s["heading"], s.get("dMin"), s.get("dMax"), s.get("iMin"), s.get("iMax"), s.get("ballZ"),
        s.get("rec"), s.get("lbSpeed"), s.get("lbElev"), s.get("lbHeading", 0),
        (s.get("bounceX"), s.get("bounceY")), s.get("pred")))
e.stop()

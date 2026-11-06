"""The joypad as the game sees it: ReadJoypad (00:02EB, run in VBlank) in Python.

Joypad(high) keeps $FF90 hJoyHeld, $FF91 hJoyRepeat, $FF92 hJoyLast, $FF93 hJoyRepeatTimer and $FF94
hJoyPressed in the machine's HRAM (high[0x190..0x194]; the repeat rate is $FFA6). Bits: A 1, B 2, Select 4,
Start 8, Right $10, Left $20, Up $40, Down $80.
"""
BUTTONS = {"a": 0x01, "b": 0x02, "select": 0x04, "start": 0x08, "right": 0x10, "left": 0x20, "up": 0x40, "down": 0x80}


def read_joypad(high, held):            # 00:02EB
    high[0x194] = (high[0x190] ^ held) & held           # newly pressed
    high[0x190] = held
    if held and high[0x192] == held:
        t = (high[0x193] - 1) & 0xFF
        if t:
            high[0x193] = t
            high[0x191] = 0
        else:
            high[0x193] = high[0x1A6]                   # repeat after the rate
            high[0x191] = held
    else:
        high[0x193] = 0x12                              # first repeat after 18 frames
        high[0x192] = held
        high[0x191] = held


def held_at(presses, frame, hold=6):
    """Buttons held at an emulator frame for a tools/emu_script.py script ({frame: button}, each held 6 frames;
    "button:N" holds it N frames)."""
    v = 0
    for f, b in presses.items():
        name, _, n = b.partition(":")
        if f <= frame < f + (int(n) if n else hold):
            v |= BUTTONS[name]
    return v

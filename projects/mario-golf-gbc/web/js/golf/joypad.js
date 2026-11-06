// The joypad as the game sees it: ReadJoypad 00:02EB (run in VBlank; tools/joypad.py). HRAM (w.high, from
// $FE00): $FF90 hJoyHeld, $FF91 hJoyRepeat, $FF92 hJoyLast, $FF93 hJoyRepeatTimer, $FF94 hJoyPressed; the
// repeat rate is $FFA6. Bits: A 1, B 2, Select 4, Start 8, Right $10, Left $20, Up $40, Down $80.
export const BUTTONS = { a: 0x01, b: 0x02, select: 0x04, start: 0x08, right: 0x10, left: 0x20, up: 0x40, down: 0x80 };

export function readJoypad(high, held) {         // 00:02EB ReadJoypad
  high[0x194] = (high[0x190] ^ held) & held;     // newly pressed
  high[0x190] = held;
  if (held && high[0x192] === held) {
    const t = (high[0x193] - 1) & 0xFF;
    if (t) { high[0x193] = t; high[0x191] = 0; }
    else { high[0x193] = high[0x1A6]; high[0x191] = held; }   // repeat after the rate
  } else {
    high[0x193] = 0x12;                          // first repeat after 18 frames
    high[0x192] = held;
    high[0x191] = held;
  }
}

// buttons held at a frame of a tools/emu_script.py script ({frame: "button" or "button:N"}, held 6 frames
// or N)
export function heldAt(presses, frame, hold = 6) {
  let v = 0;
  for (const [f, b] of Object.entries(presses)) {
    const [name, n] = b.split(":");
    if (+f <= frame && frame < +f + (n ? +n : hold)) v |= BUTTONS[name];
  }
  return v;
}

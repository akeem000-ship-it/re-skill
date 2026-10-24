// The pad and the random seed, both run from the VBlank handler every frame (bank 0).
// Port of ReadJoypad (00:02EB) and AdvanceRandomSeed (00:0A3A); names and addresses from the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
const rJOYP = 0xFF00;

// ReadJoypad (00:02EB): read the pad into hPlayerInputFlags (held: A B SELECT START in bits 0-3, RIGHT LEFT UP
// DOWN in 4-7), hInputRisingEdge (newly pressed) and hInputPressed (newly pressed, then auto-repeated: after
// $12 frames held, every hInputRepeatDelay frames). Returns the registers it leaves: a, b, c.
export function readJoypad(P) {
  const { bus, V } = P;
  bus.w8(rJOYP, 0x20);                                   // select the d-pad; the ROM reads twice to let it settle
  bus.u8(rJOYP); let a = bus.u8(rJOYP);
  const dpad = (~a & 0x0F) << 4;
  bus.w8(rJOYP, 0x10);                                   // select the buttons (six reads)
  for (let i = 0; i < 5; i++) bus.u8(rJOYP);
  a = bus.u8(rJOYP);
  const held = (~a & 0x0F) | dpad;
  V.inputRisingEdge = (V.playerInputFlags ^ held) & held;
  V.playerInputFlags = held;
  bus.w8(rJOYP, 0x30);
  let pressed;
  if (held && (V.inputRepeatButtons & held || V.inputRepeatButtons === held)) {
    const t = (V.inputRepeatTimer - 1) & 0xFF;            // the same buttons still held: count down to a repeat
    if (t) { V.inputRepeatTimer = t; pressed = 0; }
    else { V.inputRepeatTimer = V.inputRepeatDelay; pressed = held; }
  } else {                                               // a new combination (or none): it counts as pressed now
    V.inputRepeatTimer = 0x12; V.inputRepeatButtons = held; pressed = held;
  }
  V.inputPressed = pressed;
  return { a: pressed, b: held, c: held };
}

// AdvanceRandomSeed (00:0A3A): hRandomSeed = hRandomSeed * 5 + $3573 (16-bit). Leaves hl = the new seed.
export function advanceRandomSeed(P) {
  const seed = (P.V.randomSeed * 5 + 0x3573) & 0xFFFF;
  P.V.randomSeed = seed;
  return seed;
}

export const HOOKS = [
  [0, 0x02EB, (P, c) => { const r = readJoypad(P); c.a = r.a; c.b = r.b; c.c = r.c; }],
  [0, 0x0A3A, (P, c) => { const hl = advanceRandomSeed(P); c.h = hl >> 8; c.l = hl & 0xFF; }],
];

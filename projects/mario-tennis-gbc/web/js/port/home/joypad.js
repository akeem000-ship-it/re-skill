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
  return storePad(P, (~a & 0x0F) | dpad);
}
// ReadJoypad entered at $0300: the operand byte of its `ldh a, [rJOYP]` at $02FF, which runs as `nop`. InitObjectScene
// (menus/scenes) gets here by a stray `ret` (its pushed WRAM bank 3 and flags $00 as the return address). The buttons
// are read with no row selected (the last ReadJoypad wrote $30), and b, whatever the caller left in it, stands in for
// the d-pad half: it becomes the held buttons. Returns the registers it leaves: a, b, c.
export function readJoypadFrom0300(P, b) {
  const { bus } = P;
  bus.u8(rJOYP); bus.u8(rJOYP);
  const a = bus.u8(rJOYP);
  return storePad(P, (~a & 0x0F) | b);
}
// the rest of ReadJoypad ($030D on): held buttons, rising edges, the auto-repeat, the deselected pad
function storePad(P, held) {
  const { bus, V } = P;
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
  if (P.menuWheel && P.menuWheel.on) { pressed = wheelPad(P, pressed, true); V.inputRisingEdge = wheelPad(P, V.inputRisingEdge, false); }   // MENU: Wheel: ▲ ▼ through every sub-menu's list
  V.inputPressed = pressed;
  return { a: pressed, b: held, c: held };
}
// MENU: Wheel (menuwheel.js, menuskins.js): every screen is drawn as one list round the ball, so ▲ ▼ step through it in that
// order everywhere, as on the main menu (A chooses, B goes back). On a row of choices (P.menuWheel.skin: tabs, a new tour's
// player, the CPU level (wCharSelectPrompt $D824), the character data's pages) ▲ / ▼ are the game's ◀ / ▶. On a grid (Status / Erase's files, the
// courts, the GB DATA items, the minigames) ▼ is the next cell in reading order and ▲ the one before: the cursor is put next to it in its row and the game
// given ◀ or ▶, so the game's own move (its sound, its redraw) lands on it. ◀ ▶ still work as the game's. The skin is the one
// the screen wrote last frame; screens with their own two-way layout (the match format's rows and values, the character grid,
// the dictionary's terms and letters) keep the game's pad.
const PAD_R = 0x10, PAD_L = 0x20, PAD_U = 0x40, PAD_D = 0x80;
function wheelPad(P, pressed, move) {   // move: the grids' cursor placed (once a frame: for the pressed buttons)
  const s = P.menuWheel.skin;
  if (!s || P.frames - s.at > 2 || !(pressed & (PAD_U | PAD_D)) || (pressed & (PAD_L | PAD_R))) return pressed;
  const down = !!(pressed & PAD_D), rest = pressed & ~(PAD_U | PAD_D), V = P.V;
  if ((s.id === "tabs" && !(s.rows > 1) && s.icon !== "pause") || s.id === "pick" || (s.id === "chars" && P.mem.wram[3][0x824]) || (s.id === "frame" && s.title === "CHARACTER DATA")) return rest | (down ? PAD_R : PAD_L);
  let rows = null;                                                    // the grid's rows in reading order: each row's cursor x positions
  const line = (n, w) => Array.from({ length: n }, () => Array.from({ length: w }, (_, x) => x));
  if (s.id === "files") rows = [[0, 1, 2], [0, 1]];
  else if (s.id === "court" && s.cols) rows = line(s.cols, s.cols);
  else if (s.id === "tabs" && s.rows > 1 && s.cols) rows = line(s.rows, s.cols);   // (the GB DATA items, 2 x 2)
  else if (s.id === "minigames" && s.cells) rows = s.cells.length === 6 ? [[0, 1, 2], [0, 2]] : line(3, 3);   // (the minigames: 3 over 2 (the bottom row's ends), or 3 x 3)
  if (!rows) return pressed;
  if (!move) return rest | (P.menuWheel.gridDir || 0);                 // (the rising edge: the same ◀ / ▶ as the move just made)
  const cells = rows.flatMap((xs, y) => xs.map(x => [x, y])), n = cells.length;
  const at = Math.max(0, cells.findIndex(([x, y]) => x === V.menuCursorX && y === V.menuCursorY)), [tx, ty] = cells[(at + (down ? 1 : n - 1)) % n];
  const xs = rows[ty], i = xs.indexOf(tx), fromRight = i < xs.length - 1;   // (the cursor next to the target, in its row: no wrap needed)
  V.menuCursorY = ty; V.menuCursorX = fromRight ? xs[i + 1] : xs[i - 1];
  P.menuWheel.gridDir = fromRight ? PAD_L : PAD_R;
  return rest | P.menuWheel.gridDir;
}

// AdvanceRandomSeed (00:0A3A): hRandomSeed = hRandomSeed * 5 + $3573 (16-bit). Leaves hl = the new seed.
export function advanceRandomSeed(P) {
  const seed = (P.V.randomSeed * 5 + 0x3573) & 0xFFFF;
  P.V.randomSeed = seed;
  return seed;
}

export const HOOKS = [
  [0, 0x02EB, (P, c) => { const r = readJoypad(P); c.a = r.a; c.b = r.b; c.c = r.c; }],
  [0, 0x0300, (P, c) => { const r = readJoypadFrom0300(P, c.b); c.a = r.a; c.b = r.b; c.c = r.c; }],
  [0, 0x0A3A, (P, c) => { const hl = advanceRandomSeed(P); c.h = hl >> 8; c.l = hl & 0xFF; }],
];

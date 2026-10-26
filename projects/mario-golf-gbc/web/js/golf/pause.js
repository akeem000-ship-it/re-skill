// The golf pause menu: Start in the aiming menu (10:5D9D) -> PauseMenu 08:4666 -> the game mode's menu in bank 41
// (GolfPauseMenuSave 41:6E96 in stroke play, GolfPauseMenuSave2 41:6EBB in match play): "Camera Mode / Course Map /
// Scorecard / Settings / Give Up / Save & Quit" (text $1482; "Quit" $1483 without a save slot) in a menu window
// (windows.js) run by RunMenu 41:6FF4. B or Start closes it (result 0: back to aiming); an item's handler sets
// wMenuResult $C3FD ($FF after Camera Mode, Course Map and Scorecard: the shot view is redrawn).
import { rw } from "./rom.js";
import * as D from "./render/display.js";
import * as W from "./windows.js";
import { restoreShadowFromMap } from "./shadow.js";
import { showScorecard } from "./scorecard.js";

const rd = D.rd, wr = D.wr;
const wbank = w => w.high[0x196];
const setW = (w, n) => D.setWramBank(w, n);
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };      // rst $20
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {                // a far call to a routine that waits frames
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// 01:422C QueueFontTiles: the font's tiles (01:44A0-01:50A0) queued to $9200-$97FF and $8800-$8DFF, $20 tiles a
// frame
export function* queueFontTiles(sh) {
  const w = sh.w;
  for (const [hl, de] of [[0x44A0, 0x9200], [0x46A0, 0x9400], [0x48A0, 0x9600], [0x4AA0, 0x8800], [0x4CA0, 0x8A00],
    [0x4EA0, 0x8C00]]) {
    D.inBank(w, 0x01, () => D.queueVRAMCopy(w, hl, de, 0x20));
    yield* sh.advance();
  }
}

// 41:707C ClearMenuState: $C3F9-$C3FC
export function clearMenuState(w) { w.wram[0].fill(0, 0x3F9, 0x3FD); }

// 41:708A DrawMenuIcons: the option icons of the menus with wMenuFlags $C3FC bits 4-6 (not ported); the golf menus
// have none
function drawMenuIcons(w) {
  if (rd(w, 0xC3FC) & 0x70) notPorted("the menu's option icons (~41:708A DrawMenuIcons)");
}

// 41:6FF4 RunMenu: hl = text id, bc = the handler table (bank 41), de = the window's position: wMenuResult $C3FD
// cleared, the menu window opened (05:4BB0; flag #24 set) and drawn (05:4492, 05:4949), the choice read (05:4CD7);
// unless the choice's bit is set in $C3FB, the window is closed and the screen redrawn; B / Start ($FF) clears
// the menu state, a row jumps to its handler
export function* runMenu(sh, hl, bc, de) {
  const w = sh.w;
  wr(w, 0xC3FD, 0);
  setW(w, 5);
  yield* sh.advance();
  yield* sh.advance();                           // (00:0684 DisableOAMDMA before: a write to the MBC)
  const s = yield* inBankGen(w, 0x05, W.openMenuWindow(sh, hl, de >> 8, de & 0xFF));
  setFlag(w, 24);
  wr(w, 0xC3F8, s);
  yield* sh.advance();
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
  yield* inBankGen(w, 0x05, W.updateWindows(sh));
  yield* sh.advance();
  drawMenuIcons(w);
  yield* sh.advance();
  yield* sh.advance();                           // (00:068A EnableOAMDMA before)
  const a = yield* inBankGen(w, 0x05, W.runMenu05(sh));
  let keep = false;
  if (a !== 0xFF && rd(w, 0xC3FB) & 0x80) {
    let b = rd(w, 0xC3FB) & 0x7F;
    for (let k = (rd(w, 0xD830) + 1) & 0xFF; ; ) { b = ((b >> 1) | (b << 7)) & 0xFF; k = (k - 1) & 0xFF; if (!k) break; }
    b = ((b << 1) | (b >> 7)) & 0xFF;
    keep = !!(b & 1);
  }
  if (!keep) {
    W.closeWindow(w, rd(w, 0xC3F8));             // 05:4C5C
    yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
    yield* inBankGen(w, 0x05, W.updateWindows(sh));
    yield* sh.advance();
  }
  if (a === 0xFF) { clearMenuState(w); return; }
  const h = rw(0x41, (bc + 2 * a) & 0xFFFF);
  yield* menuHandler(sh, h);
}

// the golf pause menus' handlers (41:743F stroke play, 41:756F match play)
function* menuHandler(sh, h) {
  const w = sh.w;
  switch (h) {
    case 0x7457: case 0x7587:                    // 41:7457 / 41:7587 Scorecard: 41:788B MenuShowScorecard
      wr(w, 0xC4BD, 0);
      yield* inBankGen(w, 0x0E, showScorecard(sh));   // 0E:43D6
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);                         // (jp 41:7078)
      return;
    default: {
      const names = { 0x744B: "Camera Mode (41:744B)", 0x7451: "Course Map (41:7451)", 0x745D: "Settings (41:745D)",
        0x746B: "Give Up (41:746B)", 0x74AE: "Save & Quit (41:74AE)", 0x757B: "Camera Mode (41:757B)",
        0x7581: "Course Map (41:7581)", 0x758D: "Settings (41:758D)", 0x759B: "Give Up (41:759B)",
        0x75DE: "Save & Quit (41:75DE)" };
      notPorted(`the pause menu's ${names[h] || `item ~41:${h.toString(16)}`}`);
    }
  }
}

// 41:6E96 GolfPauseMenuSave / 41:6EBB GolfPauseMenuSave2: the font tiles queued (01:422C), the text speed's bit 7
// set meanwhile (no typing), the menu (setup 41:7AEF / 41:7B1C: Start cancels too); returns wMenuResult
function* golfPauseMenu(sh, match) {
  const w = sh.w;
  yield* inBankGen(w, 0x01, queueFontTiles(sh));
  const old = wbank(w);
  wr(w, 0xC82D, rd(w, 0xC82D) | 0x80);
  let id;
  clearMenuState(w);
  wr(w, 0xC3FC, rd(w, 0xC3FC) | 0x80);
  if (match) id = 0x1482;
  else id = (rd(w, 0xC2A5) & 0x0F) === 0x0F ? 0x1483 : 0x1482;
  yield* runMenu(sh, id, match ? 0x756F : 0x743F, 0x0402);
  wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F);
  setW(w, old);
  return rd(w, 0xC3FD);
}

// 08:4666 PauseMenu: the shot clock's state ($C0F4, 2 while paused) and wCameraMode $D438 (0 meanwhile) kept; sound
// $62; the game mode's menu (PauseMenuModeTable 08:4695: modes 1 / 3 08:46B5, mode 2 08:46C6; then
// 08:46F3 PauseMenuDebugEditors, nothing without hDebugMode); returns the menu's result
export function* pauseMenu(sh) {
  const w = sh.w;
  const clock = rd(w, 0xC0F4);
  if (clock) wr(w, 0xC0F4, 2);
  const cam = rd(w, 0xD438);
  wr(w, 0xD438, 0);
  sh.sound(0x62);
  yield* sh.advance();
  const old = wbank(w);
  const mode = rd(w, 0xC834);
  if (w.high[0x19E]) notPorted("the debug editors (~08:46F3)");
  if (rd(w, 0xC33F)) notPorted("the link-play pause menu (~41:6E49 GolfPauseMenu)");
  let b;
  if (mode === 1 || mode === 3) b = yield* inBankGen(w, 0x41, golfPauseMenu(sh, false));
  else if (mode === 2) b = yield* inBankGen(w, 0x41, golfPauseMenu(sh, true));
  else notPorted(`the pause menu of game mode ${mode} (~08:4695)`);
  setW(w, old);
  wr(w, 0xD438, cam);
  wr(w, 0xC0F4, clock);
  return b;
}

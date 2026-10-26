// The golf pause menu: Start in the aiming menu (10:5D9D) -> PauseMenu 08:4666 -> the game mode's menu in bank 41
// (GolfPauseMenuSave 41:6E96 in stroke play, GolfPauseMenuSave2 41:6EBB in match play): "Camera Mode / Course Map /
// Scorecard / Settings / Give Up / Save & Quit" (text $1482; "Quit" $1483 without a save slot) in a menu window
// (windows.js) run by RunMenu 41:6FF4. B or Start closes it (result 0: back to aiming); an item's handler sets
// wMenuResult $C3FD ($FF after Camera Mode, Course Map and Scorecard: the shot view is redrawn; $81 Give Up, $80
// Quit). All the items are ported: Camera Mode (freelook.js), Course Map (coursemap.js), Scorecard, Settings, Give
// Up, Quit / Save & Quit (with the message box: msgbox.js).
import { rw } from "./rom.js";
import * as D from "./render/display.js";
import * as W from "./windows.js";
import { restoreShadowFromMap } from "./shadow.js";
import { showScorecard } from "./scorecard.js";
import * as M from "./msgbox.js";
import * as T from "./text.js";
import { freeLookCursor } from "./freelook.js";
import { courseMapScreen } from "./coursemap.js";
import { saveGame } from "./save.js";
import { playerField } from "./memory.js";

const rd = D.rd, wr = D.wr;
const wbank = w => w.high[0x196];
const setW = (w, n) => D.setWramBank(w, n);
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };      // rst $20
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); }; // rst $28
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

// 41:708A DrawMenuIcons: by wMenuFlags $C3FC: bit 6 the Settings menu's on / off icons (Music: wOptionFlags $C818
// bit 0, tiles $DD-$DF set / $DA-$DC clear, at x 10-12 of row 1; 3-D Screen: bit 1, row 3), a frame after each
// tile; bits 4 and 5 (other menus' icons) are not ported
function* drawMenuIcons(sh) {
  const w = sh.w;
  const f = rd(w, 0xC3FC);
  if (f & 0x10) notPorted("the menu's option icons (~41:71D6)");
  if (f & 0x20) notPorted("the text speed icons (~41:7141)");
  if (!(f & 0x40)) return;
  for (const [bit, y] of [[1, 1], [2, 3]]) {
    const t = rd(w, 0xC818) & bit ? 0xDD : 0xDA;
    for (let k = 0; k < 3; k++) {
      W.putMenuTile(w, t + k, 0x0A + k, y);
      yield* sh.advance();
    }
  }
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
  yield* runMenuBody(sh, bc);
}
// 41:701E: the icons, the choice (05:4CD7), the window closed unless the row's bit is set in $C3FB, the handler
// (handlers that stay in the menu come back here: jp 41:701E)
function* runMenuBody(sh, bc) {
  const w = sh.w;
  yield* drawMenuIcons(sh);
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

// 00:2B98 ApplyMusicOption: hSoundFlags bit 0 = wOptionFlags bit 0 (music off); the driver gets command 0 (off) or
// wCurrentBGM straight (7E:4016 SoundCmdDispatch, not through PlaySoundCmd)
function applyMusicOption(sh) {
  const w = sh.w;
  const c = rd(w, 0xC818) & 1;
  w.high[0x1CE] = (w.high[0x1CE] & 0xFE) | c;
  sh.musicOption(rd(w, 0xC818));                 // (the driver: SoundCmdDispatch 0 or the current song)
}
// 41:7BBD LoadTextToWram7: 16 zeros at WRAM7 $DC00, then text hl's bytes up to (not with) its $00; hl = $DC00
function loadTextToWram7(w, id) {
  setW(w, 7);
  for (let k = 0; k < 0x10; k++) wr(w, 0xDC00 + k, 0);
  setW(w, 5);
  T.loadText(w, id);
  for (let hl = 0xC600, de = 0xDC00; ; hl++, de++) {
    setW(w, 5);
    const a = rd(w, hl);
    if (!a) break;
    setW(w, 7);
    wr(w, de, a);
  }
  setW(w, 7);
}
// 41:78C6 MenuSettings: the option words (texts $1495 / $1496: drawn as glyphs to WRAM7 $DA00 / $DA30, queued to
// $8DA0) for the icons, then the Settings menu ($1487, handlers 41:7775; Left / Right on both rows and the window
// kept: $C3FA = $C3FB = $83; the icons: $C3FC = $C0) with flag #48 set meanwhile; then the menu state cleared but
// $C3FC bit 7
function* menuSettings(sh) {
  const w = sh.w, old = w.high[0x196];
  D.inBank(w, 3, () => T.resetGlyphBuffer(w));   // 03:4EB8
  yield* sh.advance();
  loadTextToWram7(w, 0x1495);
  D.inBank(w, 3, () => T.drawStringToGlyphs(w, 0xDC00, 0xDA00));
  loadTextToWram7(w, 0x1496);
  D.inBank(w, 3, () => T.drawStringToGlyphs(w, 0xDC00, 0xDA30));
  D.queueVRAMCopy(w, 0xDA00, 0x8DA0, 0x06);
  yield* sh.advance();
  setW(w, old);
  clearMenuState(w);
  wr(w, 0xC3FC, 0xC0); wr(w, 0xC3FA, 0x83); wr(w, 0xC3FB, 0x83);
  setFlag(w, 48);
  yield* runMenu(sh, 0x1487, 0x7775, 0x0205);
  clearMenuState(w);
  wr(w, 0xC3FC, rd(w, 0xC3FC) | 0x80);
  clearFlag(w, 48);
}

// a question in the message box with Yes / No (41:746B and the others): ScriptSetText, ScriptShowTextKeepOpen with
// no speaker ($80), the cursor's first row (when given), ScriptAskYesNo, ScriptCloseText, ScriptWaitFrames 5;
// returns 0 Yes / 1 No / $FF B
function* askYesNo(sh, id, cursor) {
  const w = sh.w;
  M.scriptSetText(w, id);                        // 0A:4124
  yield* inBankGen(w, 0x0A, M.scriptShowTextKeepOpen(sh, 0x80));   // 0A:4199
  if (cursor !== undefined) wr(w, 0xC3F9, cursor);
  const a = yield* inBankGen(w, 0x0A, M.scriptAskYesNo(sh));       // 0A:41D8
  yield* inBankGen(w, 0x0A, M.scriptCloseText(sh));                // 0A:41CE
  yield* inBankGen(w, 0x0A, M.scriptWaitFrames(sh, 5));            // 0A:410D
  return a;
}
// 41:7AEF SetupGolfPauseMenuSave / 41:7B1C SetupGolfPauseMenuSave2, then the menu again from row `cursor`
// (jp 41:6FF4 RunMenu)
function* reopen(sh, match, cursor) {
  const w = sh.w;
  clearMenuState(w);
  wr(w, 0xC3FC, rd(w, 0xC3FC) | 0x80);
  const id = match || (rd(w, 0xC2A5) & 0x0F) !== 0x0F ? 0x1482 : 0x1483;
  wr(w, 0xC3F9, cursor);
  yield* runMenu(sh, id, match ? 0x756F : 0x743F, 0x0402);
}
// 41:746B GolfPauseSaveGiveUp / 41:759B GolfPauseSave2GiveUp: on the first stroke 41:7935 MenuCantGiveUp (sound
// $5D, text $1491); else "Give up?" ($1490, No first): Yes gives wMenuResult $81 (10:488B: the strokes become 3 x
// par), No / B reopen the menu on Give Up
function* giveUp(sh, match) {
  const w = sh.w;
  if (!rd(w, 0xC000 + playerField(w, 0x20))) {
    sh.sound(0x5D);
    M.scriptSetText(w, 0x1491);
    yield* inBankGen(w, 0x0A, M.scriptShowText(sh, 0x80));        // 0A:4164
    clearMenuState(w);
    return;
  }
  if (!(yield* askYesNo(sh, 0x1490, 1))) { wr(w, 0xC3FD, 0x81); clearMenuState(w); return; }
  yield* reopen(sh, match, 4);
}
// 41:74AE GolfPauseSaveQuit / 41:75DE GolfPauseSave2SaveQuit: without a save slot (stroke play) "OK to quit this
// round?" ($148C, No first): Yes gives $80. Else (and always in match play) "Save current progress?" ($148B): Yes
// counts $C814 (up to $FF), SaveGame 02:4489, $80, $C2A6 = 1 (GolfSessionEnd then goes to the link menu); B reopens
// the menu on the last row; No asks to quit ($148C in stroke play, $148E in other modes, $148F in match play)
function* quit(sh, match) {
  const w = sh.w;
  if (!match && (rd(w, 0xC2A5) & 0x0F) === 0x0F) {
    if (!(yield* askYesNo(sh, 0x148C, 1))) { wr(w, 0xC3FD, 0x80); clearMenuState(w); return; }
    yield* reopen(sh, match, 5);
    return;
  }
  const a = yield* askYesNo(sh, 0x148B);
  if (!a) {
    if (rd(w, 0xC814) !== 0xFF) wr(w, 0xC814, rd(w, 0xC814) + 1);
    saveGame(w);
    wr(w, 0xC3FD, 0x80);
    wr(w, 0xC2A6, 1);
    clearMenuState(w);
    return;
  }
  if (a === 0xFF) { yield* reopen(sh, match, 5); return; }
  const id = match ? 0x148F : rd(w, 0xC834) === 3 ? 0x148C : 0x148E;
  if (!(yield* askYesNo(sh, id, 1))) { wr(w, 0xC3FD, 0x80); clearMenuState(w); return; }
  yield* reopen(sh, match, 5);
}

// the golf pause menus' handlers (41:743F stroke play, 41:756F match play)
function* menuHandler(sh, h) {
  const w = sh.w;
  switch (h) {
    case 0x745D: case 0x758D:                    // 41:745D / 41:758D Settings: 41:78C6 MenuSettings, the menu again on row 3
      yield* menuSettings(sh);
      yield* reopen(sh, false, 3);               // (match play's too: 41:7590 calls SetupGolfPauseMenuSave)
      return;
    case 0x7779: case 0x77B3: {                  // 41:7779 SettingsToggleMusic / 41:77B3 SettingsToggle3D
      const lr = rd(w, 0xC3FC) & 0x0F;
      if (lr && lr !== 3) {
        sh.sound(0x8B);
        wr(w, 0xC818, rd(w, 0xC818) ^ (h === 0x7779 ? 1 : 2));
      }
      if (h === 0x7779) applyMusicOption(sh);    // 00:2B98
      wr(w, 0xC3FC, rd(w, 0xC3FC) | 0xC0);
      wr(w, 0xC3F9, rd(w, 0xD830));
      yield* runMenuBody(sh, 0x7775);            // (jp 41:701E)
      return;
    }
    case 0x744B: case 0x757B:                    // Camera Mode: 41:7879 FreeLookMenuHandler (12:6D3D), wMenuResult $FF
      yield* inBankGen(w, 0x12, freeLookCursor(sh));
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);
      return;
    case 0x7451: case 0x7581:                    // Course Map: 41:7882 MenuShowCourseMap (17:437D), wMenuResult $FF
      yield* inBankGen(w, 0x17, courseMapScreen(sh));
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);
      return;
    case 0x746B: yield* giveUp(sh, false); return;
    case 0x759B: yield* giveUp(sh, true); return;
    case 0x74AE: yield* quit(sh, false); return;
    case 0x75DE: yield* quit(sh, true); return;
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

// The golf pause menu: Start in the aiming menu (10:5D9D) -> PauseMenu 08:4666 -> the game mode's menu in bank 41
// (GolfPauseMenuSave 41:6E96 in stroke play, GolfPauseMenuSave2 41:6EBB in match play): "Camera Mode / Course Map /
// Scorecard / Settings / Give Up / Save & Quit" (text $1482; "Quit" $1483 without a save slot) in a menu window
// (windows.js) run by RunMenu 41:6FF4. B or Start closes it (result 0: back to aiming); an item's handler sets
// wMenuResult $C3FD ($FF after Camera Mode, Course Map and Scorecard: the shot view is redrawn; $81 Give Up, $80
// Quit). All the items are ported: Camera Mode (freelook.js), Course Map (coursemap.js), Scorecard, Settings, Give
// Up, Quit / Save & Quit (with the message box: msgbox.js).
import { navigationMenu, eventListScreen } from "./nav.js";
import { charDataScreen } from "./levelup.js";
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
import { mapSaveReturnPoint } from "./start.js";
import { playerField } from "./memory.js";
import { hudDrawWind } from "./view.js";
import { debugPointsEditor, debugPaletteEditor } from "./debug.js";

const rd = D.rd, wr = D.wr;
const wbank = w => w.high[0x196];
const setW = (w, n) => D.setWramBank(w, n);
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };      // rst $20
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); }; // rst $28
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));                     // rst $30
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
// tile; bits 4 / 5 the text speed (the map's start menus)
function* drawMenuIcons(sh) {
  const w = sh.w;
  const f = rd(w, 0xC3FC);
  if (f & 0x30) {                                // 41:71D6 (bit 4: row 7) / 41:7141 (bit 5: row 5): the text speed's
    const s = rd(w, 0xC82D) & 0x7F;              // five tiles (Slow $DB.., Normal $D6.., Fast $D1..) at x 9-13
    const t = s === 0 ? 0xDB : s === 1 ? 0xD6 : 0xD1;
    for (let k = 0; k < 5; k++) W.putMenuTile(w, t + k, 0x09 + k, f & 0x10 ? 7 : 5);
    return;
  }
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

// ---- the link-play pause menu (41:6E49 GolfPauseMenu: wLinkRole $C33F set, 08:46C2 / 08:46D3) ----
// 41:7A53 SetupGolfPauseMenu: the menu state cleared, $C3FC bit 7; Camera Mode / Course Map / Scorecard / Settings /
// Give Up / Quit (text $147F, handlers 41:7317, at (5, 2))
function setupGolfPauseMenu(w) { clearMenuState(w); wr(w, 0xC3FC, rd(w, 0xC3FC) | 0x80); }
// 41:6E49 GolfPauseMenu: the font tiles (01:422C), the text speed's bit 7 meanwhile, the menu; returns wMenuResult
const golfPauseMenuLink = sh => bank41Menu(sh, setupGolfPauseMenu, 0x147F, 0x7317, 0x0502, 0);
// 41:7349 GolfPauseGiveUp: on the first stroke 41:7935 MenuCantGiveUp; else "Give up?" ($1490, No first): Yes $81;
// No / B: the menu again on row 4 (41:7381)
function* linkGiveUp(sh) {
  const w = sh.w;
  if (!rd(w, 0xC000 + playerField(w, 0x20))) {
    sh.sound(0x5D);
    M.scriptSetText(w, 0x1491);
    yield* inBankGen(w, 0x0A, M.scriptShowText(sh, 0x80));
    clearMenuState(w);
    return;
  }
  if (!(yield* askYesNo(sh, 0x1490, 1))) { wr(w, 0xC3FD, 0x81); clearMenuState(w); return; }
  setupGolfPauseMenu(w);
  wr(w, 0xC3F9, 4);
  yield* runMenu(sh, 0x147F, 0x7317, 0x0502);
}
// 41:739A GolfPauseQuit: "OK to quit this round?" ($148C; $148F in match play, No first): Yes $80; No / B: the menu
// again on row 5 (41:7A53)
function* linkQuit(sh) {
  const w = sh.w;
  if (!(yield* askYesNo(sh, rd(w, 0xC834) === 2 ? 0x148F : 0x148C, 1))) { wr(w, 0xC3FD, 0x80); clearMenuState(w); return; }
  setupGolfPauseMenu(w);
  wr(w, 0xC3F9, 5);
  yield* runMenu(sh, 0x147F, 0x7317, 0x0502);
}

// 41:72A1 MenuWindDirectionAdjust / 41:72D8 MenuWindSpeedAdjust (Left / Right on the row: $C3FC low nibble 1 / 2):
// the wind's angle wWindAngle $C816 -/+ $10, its speed wWindSpeed $C815 -/+ 1 within 0-$13 (sound $8B when it
// changes), HudDrawWind 12:4A81; WRAM5 after
function menuWindDirectionAdjust(sh) {
  const w = sh.w;
  setW(w, 6);
  const lr = rd(w, 0xC3FC) & 0x0F;
  if (lr === 1 || lr === 2) {
    sh.sound(0x8B);
    wr(w, 0xC816, (rd(w, 0xC816) + (lr === 1 ? -0x10 : 0x10)) & 0xFF);
  }
  hudDrawWind(w);
  setW(w, 5);
}
function menuWindSpeedAdjust(sh) {
  const w = sh.w;
  setW(w, 6);
  const lr = rd(w, 0xC3FC) & 0x0F, s = rd(w, 0xC815);
  if (lr === 1 && s) { sh.sound(0x8B); wr(w, 0xC815, s - 1); }
  else if (lr === 2 && s !== 0x13) { sh.sound(0x8B); wr(w, 0xC815, s + 1); }
  hudDrawWind(w);
  setW(w, 5);
}
// 41:7B2E SetupTrainingPauseMenu: Left / Right on rows 3 and 4 (Wind Direction, Speed), the window kept for them
// ($C3FA = $C3FB = $98), flag #51 set (text $1484, handlers 41:7654, at (3, 0))
function setupTrainingPauseMenu(w) {
  clearMenuState(w);
  wr(w, 0xC3FC, rd(w, 0xC3FC) | 0x80);
  wr(w, 0xC3FA, 0x98); wr(w, 0xC3FB, 0x98);
  setFlag(w, 51);
}
// 41:6EE0 TrainingPauseMenu / 41:6F55 ContinueMulliganMenu / 41:6F7A ContinueMulliganRestartMenu: the font tiles
// (01:422C), the text speed's bit 7 set meanwhile, the menu (Training: then flag #51 cleared); returns wMenuResult
function* bank41Menu(sh, setup, id, bc, de, clear) {
  const w = sh.w;
  yield* inBankGen(w, 0x01, queueFontTiles(sh));
  const old = wbank(w);
  wr(w, 0xC82D, rd(w, 0xC82D) | 0x80);
  setup(w);
  yield* runMenu(sh, id, bc, de);
  wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F);
  setW(w, old);
  if (clear) clearFlag(w, clear);
  return rd(w, 0xC3FD);
}
const setupPlain = w => { clearMenuState(w); wr(w, 0xC3FC, rd(w, 0xC3FC) | 0x80); };   // 41:7B7E / 41:7B90
// 41:7B4D SetupPracticeWindMenu: Left / Right on rows 1 and 2 ($86), flag #52
function setupPracticeWindMenu(w) {
  setupPlain(w);
  wr(w, 0xC3FA, 0x86); wr(w, 0xC3FB, 0x86);
  setFlag(w, 52);
}
// 41:6F08 PracticeWindMenu (flag #100: Quit Practice / Wind Direction / Wind Speed / Settings, $1485, 41:76FF; flag
// #52 cleared after) / 41:6F30 PracticeMenu (Quit Practice / Settings, $1486, 41:7741; 41:7B6C)
const practiceWindMenu = sh => bank41Menu(sh, setupPracticeWindMenu, 0x1485, 0x76FF, 0x0303, 52);
const practiceMenu = sh => bank41Menu(sh, setupPlain, 0x1486, 0x7741, 0x0305, 0);
// 41:6F9F MiniGamePauseMenu (game modes 5 / $0A / $0B, 08:46DE: Quit Mini-Game / Settings, $148A, 41:775B; 41:7BA2)
const miniGamePauseMenu = sh => bank41Menu(sh, setupPlain, 0x148A, 0x775B, 0x0305, 0);
export const continueMulliganMenu = sh => bank41Menu(sh, setupPlain, 0x1488, 0x76B9, 0x0504, 0);
export const continueMulliganRestartMenu = sh => bank41Menu(sh, setupPlain, 0x1489, 0x76D7, 0x0204, 0);

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
    // Training (41:7654): Camera Mode 41:7662, Course Map 41:7668 as above (the same bytes as 41:7323 / 41:7329; then
    // 41:7078); Hole Out 41:766E $80 with wRoundResult 0; Wind Direction 41:767A / Wind Speed 41:768C change the wind
    // and stay in the menu; Settings 41:769E, then the menu again on row 5; Back to Menu 41:76AC $80 with wRoundResult 1
    case 0x7662:
      yield* inBankGen(w, 0x12, freeLookCursor(sh));   // 41:7879
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);
      return;
    case 0x7668:
      yield* inBankGen(w, 0x17, courseMapScreen(sh));  // 41:7882
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);
      return;
    case 0x766E: case 0x76AC:
      wr(w, 0xC3FD, 0x80);
      wr(w, 0xC96C, h === 0x76AC ? 1 : 0);
      clearMenuState(w);
      return;
    case 0x767A: case 0x768C:
      if (h === 0x767A) menuWindDirectionAdjust(sh);   // 41:72A1
      else menuWindSpeedAdjust(sh);              // 41:72D8
      wr(w, 0xC3F9, rd(w, 0xD830));
      yield* runMenuBody(sh, 0x7654);            // (jp 41:701E)
      return;
    case 0x769E:
      yield* menuSettings(sh);
      setupTrainingPauseMenu(w);                 // 41:7B2E
      wr(w, 0xC3F9, 5);
      yield* runMenu(sh, 0x1484, 0x7654, 0x0300);
      return;
    // the practice menus (41:76FF, 41:7741): Quit Practice $82 (41:7707 PracticeWindQuit, ~41:7745); Wind Direction
    // 41:770F / Wind Speed 41:7721 stay in the menu; Settings (41:7733, ~41:774D), then the menu again on row 3 / 1
    case 0x7707: case 0x7745: case 0x775F:       // (41:775F MiniGameQuit)
      wr(w, 0xC3FD, 0x82);
      clearMenuState(w);
      return;
    case 0x770F: case 0x7721:
      if (h === 0x770F) menuWindDirectionAdjust(sh);   // 41:72A1
      else menuWindSpeedAdjust(sh);              // 41:72D8
      wr(w, 0xC3F9, rd(w, 0xD830));
      yield* runMenuBody(sh, 0x76FF);            // (jp 41:701E)
      return;
    case 0x7767:                                 // 41:7767 MiniGameSettings
      yield* menuSettings(sh);
      setupPlain(w);
      wr(w, 0xC3F9, 1);
      yield* runMenu(sh, 0x148A, 0x775B, 0x0305);
      return;
    case 0x7733: case 0x774D:
      yield* menuSettings(sh);
      if (h === 0x7733) setupPracticeWindMenu(w); else setupPlain(w);
      wr(w, 0xC3F9, h === 0x7733 ? 3 : 1);
      yield* runMenu(sh, h === 0x7733 ? 0x1485 : 0x1486, h === 0x7733 ? 0x76FF : 0x7741, h === 0x7733 ? 0x0303 : 0x0305);
      return;
    // after a training shot (41:76B9 Continue / Mulligan / Hole Out: 41:76BF 41:76C7 41:76CF; 41:76D7 Continue /
    // Mulligan / Start Over / Back to Main Menu: ~41:76DF 41:76E7 41:76EF ~41:76F7): wMenuResult 0, 2, 5; 0, 2, 3, 4
    case 0x76BF: case 0x76C7: case 0x76CF: case 0x76DF: case 0x76E7: case 0x76EF: case 0x76F7:
      wr(w, 0xC3FD, { 0x76BF: 0, 0x76C7: 2, 0x76CF: 5, 0x76DF: 0, 0x76E7: 2, 0x76EF: 3, 0x76F7: 4 }[h]);
      clearMenuState(w);
      return;
    case 0x7457: case 0x7587:                    // 41:7457 / 41:7587 Scorecard: 41:788B MenuShowScorecard
      wr(w, 0xC4BD, 0);
      yield* inBankGen(w, 0x0E, showScorecard(sh));   // 0E:43D6
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);                         // (jp 41:7078)
      return;
    case 0x73E4: case 0x73EA: case 0x73F0: case 0x7402: case 0x7413: case 0x7419: case 0x741F: case 0x7425: case 0x7437:
      if (h === 0x7413) {                        // 41:7413 MapStartNavigation: NavigationMenu 0A:7174, then 41:7078
        yield* inBankGen(w, 0x0A, navigationMenu(sh));
        clearMenuState(w);
        return;
      }
      yield* mapStartMenuHandler(sh, h);
      return;
    // the link-play pause menu (41:7317): Camera Mode 41:7323, Course Map 41:7329 (as above); Scorecard 41:732F
    // (41:78A5 MenuShowScorecardByMode: in match play through 3E:675C ShowStandingsFar, a jump to 0E:43D6 too);
    // Settings 41:7335 (then the menu again on row 3, without SetupGolfPauseMenu); Give Up 41:7349; Quit 41:739A
    case 0x7323:
      yield* inBankGen(w, 0x12, freeLookCursor(sh));   // 41:7879
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);
      return;
    case 0x7329:
      yield* inBankGen(w, 0x17, courseMapScreen(sh));  // 41:7882
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);
      return;
    case 0x732F:
      wr(w, 0xC4BD, 0);
      if (rd(w, 0xC834) === 2) yield* inBankGen(w, 0x3E, inBankGen(w, 0x0E, showScorecard(sh)));
      else yield* inBankGen(w, 0x0E, showScorecard(sh));
      wr(w, 0xC3FD, 0xFF);
      clearMenuState(w);
      return;
    case 0x7335:
      yield* menuSettings(sh);
      wr(w, 0xC3F9, 3);
      yield* runMenu(sh, 0x147F, 0x7317, 0x0502);
      return;
    case 0x7349: yield* linkGiveUp(sh); return;
    case 0x739A: yield* linkQuit(sh); return;
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
  let b;
  if ((mode === 1 || mode === 2 || mode === 3) && rd(w, 0xC33F)) b = yield* inBankGen(w, 0x41, golfPauseMenuLink(sh));   // 08:46C2 / 08:46D3
  else if (mode === 1 || mode === 3) b = yield* inBankGen(w, 0x41, golfPauseMenu(sh, false));
  else if (mode === 2) b = yield* inBankGen(w, 0x41, golfPauseMenu(sh, true));
  else if (mode === 4) b = yield* inBankGen(w, 0x41, bank41Menu(sh, setupTrainingPauseMenu, 0x1484, 0x7654, 0x0300, 51));   // 08:46D7
  else if (mode === 6 || mode === 0x0C) b = yield* inBankGen(w, 0x41, flag(w, 100) ? practiceWindMenu(sh) : practiceMenu(sh));   // 08:46E2
  else if (mode === 7) b = yield* inBankGen(w, 0x41, practiceMenu(sh));   // 08:46EF
  else if (mode === 5 || mode === 0x0A || mode === 0x0B) b = yield* inBankGen(w, 0x41, miniGamePauseMenu(sh));   // 08:46DE
  else notPorted(`the pause menu of game mode ${mode} (~08:4695)`);
  // 08:46F3 PauseMenuDebugEditors after the stroke, match and training menus (not in link play): with hDebugMode, Select
  // held 41:77EA DebugPointsEditor, then Up held 44:42FB DebugPaletteEditor
  if (!rd(w, 0xC33F) && mode >= 1 && mode <= 4 && w.high[0x19E]) {
    if (w.high[0x190] & 4) yield* inBankGen(w, 0x41, debugPointsEditor(sh));
    if (w.high[0x190] & 0x40) yield* inBankGen(w, 0x44, debugPaletteEditor(sh));
  }
  setW(w, old);
  wr(w, 0xD438, cam);
  wr(w, 0xC0F4, clock);
  return b;
}

// ---- the map's start menu (Start on the overworld: 0A:4AEF -> 41:6E6E MapStartMenu) ----
// 41:7A65 SetupMapStartMenu: the speed words Slow / Normal / Fast (texts $1492-$1494, as glyphs to WRAM7 $DA00 /
// $DA50 / $DAA0, queued to $8D10), a frame; then Char. Data / Stars / Message / Save & Quit ($1480, handlers 41:73DC,
// at 4, 2: Left / Right on Message, the text speed icons on row 5: flag #49) or on map 2 with Navigation first
// ($1481, 41:7409, at 3, 2: the icons on row 7, flag #50); returns RunMenu's [hl, bc, de]
function* setupMapStartMenu(sh) {
  const w = sh.w, old = wbank(w);
  D.inBank(w, 3, () => T.resetGlyphBuffer(w));   // 03:4EB8
  setW(w, 1);
  loadTextToWram7(w, 0x1492);
  D.inBank(w, 3, () => T.drawStringToGlyphs(w, 0xDC00, 0xDA00));
  loadTextToWram7(w, 0x1493);
  D.inBank(w, 3, () => T.drawStringToGlyphs(w, 0xDC00, 0xDA50));
  loadTextToWram7(w, 0x1494);
  D.inBank(w, 3, () => T.drawStringToGlyphs(w, 0xDC00, 0xDAA0));
  D.queueVRAMCopy(w, 0xDA00, 0x8D10, 0x0F);
  yield* sh.advance();
  setW(w, old);
  clearMenuState(w);
  if (rd(w, 0xC450) === 2) {
    wr(w, 0xC3FC, 0x90); wr(w, 0xC3FA, 0x88); wr(w, 0xC3FB, 0x88);
    setFlag(w, 50);
    return [0x1481, 0x7409, 0x0203];
  }
  wr(w, 0xC3FC, 0xA0); wr(w, 0xC3FA, 0x84); wr(w, 0xC3FB, 0x84);
  setFlag(w, 49);
  return [0x1480, 0x73DC, 0x0204];
}
// 41:6E6E MapStartMenu: instant text meanwhile; flags #49 / #50 cleared after; returns wMenuResult
export function* mapStartMenu(sh) {
  const w = sh.w, old = wbank(w);
  wr(w, 0xC82D, rd(w, 0xC82D) | 0x80);
  const [hl, bc, de] = yield* setupMapStartMenu(sh);
  yield* runMenu(sh, hl, bc, de);
  wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F);
  setW(w, old);
  clearFlag(w, 49); clearFlag(w, 50);
  return rd(w, 0xC3FD);
}
// 41:7969 MenuTextSpeedAdjust: Right (wMenuFlags low bits 1) the next speed (from 2 back to 0), Left (2) the one
// before (from 0 to 2), sound $8B; bit 7 of wTextSpeed stays set (instant while the menu is open)
function menuTextSpeedAdjust(sh) {
  const w = sh.w, lr = rd(w, 0xC3FC) & 0x0F;
  if (lr === 1) {
    sh.sound(0x8B);
    const b = ((rd(w, 0xC82D) & 0x7F) + 1) & 0xFF;
    wr(w, 0xC82D, b === 3 ? 0x80 : b | 0x80);
  } else if (lr === 2) {
    sh.sound(0x8B);
    const a = ((rd(w, 0xC82D) & 0x7F) - 1) & 0xFF;
    wr(w, 0xC82D, a & 0x80 ? 0x82 : a | 0x80);
  }
}
// the start menu again on Save & Quit (row 3): 41:7A65, $C3F9 = 3, flag #49 (or #50 on map 2's menu: $C4B8)
function* reopenMapStartMenu(sh) {
  const w = sh.w;
  const [hl, bc, de] = yield* setupMapStartMenu(sh);
  wr(w, 0xC3F9, 3);
  if (rd(w, 0xC4B8)) setFlag(w, 50); else setFlag(w, 49);
  yield* runMenu(sh, hl, bc, de);
}
// 41:79A7 MenuSaveAndQuit: "Save current progress?" ($148B): Yes: MapSaveReturnPoint 0A:4D5B (here), SaveGame
// 02:4489, map 0 entrance 1 (the link menu) by warp $FA; B: the menu again; No: "OK to return to Main Menu?"
// ($148D, No first): Yes: map 0 entrance 2 (the mode select), No / B: the menu again
function* menuSaveAndQuit(sh) {
  const w = sh.w;
  clearFlag(w, 49); clearFlag(w, 50);
  const a = yield* askYesNo(sh, 0x148B);
  if (a === 0) {
    wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F);
    mapSaveReturnPoint(w);                       // 0A:4D5B (b = $FF)
    saveGame(w);                                 // 02:4489
    wr(w, 0xC450, 0); wr(w, 0xC46A, 1); wr(w, 0xC441, 0xFA);
    clearMenuState(w);
    return;
  }
  if (a === 0xFF) { yield* reopenMapStartMenu(sh); return; }
  if (!(yield* askYesNo(sh, 0x148D, 1))) {
    wr(w, 0xC450, 0); wr(w, 0xC46A, 2); wr(w, 0xC441, 0xFA);
    clearMenuState(w);
    return;
  }
  yield* reopenMapStartMenu(sh);
}
// the start menu's handlers (41:73DC; map 2's 41:7409)
function* mapStartMenuHandler(sh, h) {
  const w = sh.w;
  switch (h) {
    case 0x73F0: case 0x7425:                    // Message (41:73F0 MapStartMessageSpeed): 41:7969, the menu stays (jp 41:701E)
      menuTextSpeedAdjust(sh);
      wr(w, 0xC3F9, rd(w, 0xD830));
      yield* runMenuBody(sh, h === 0x73F0 ? 0x73DC : 0x7409);
      return;
    case 0x7402: case 0x7437:                    // Save & Quit ($C4B8 = 0 / 1: 41:7402 MapStartSaveQuit)
      wr(w, 0xC4B8, h === 0x7402 ? 0 : 1);
      yield* menuSaveAndQuit(sh);
      return;
    case 0x73E4: case 0x7419:                    // Char. Data: 41:7943 MenuCharData (41:6506), the map again ($FA at
      yield* charDataScreen(sh, 0, 0);           // the saved position), then the menu closed (jp 41:7078)
      wr(w, 0xC441, 0xFA); wr(w, 0xC46A, 0xFA);
      for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));
      wr(w, 0xC465, rd(w, 0xC2A4));
      clearMenuState(w);
      return;
    case 0x73EA: case 0x741F:                    // Stars (41:73EA MapStartStars): 41:7965 -> 0A:6F56, then closed
      yield* inBankGen(w, 0x0A, eventListScreen(sh));
      clearMenuState(w);
      return;
    default: notPorted(`the start menu's item ~41:${h.toString(16)}`);
  }
}

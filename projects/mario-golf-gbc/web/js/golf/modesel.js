// ModeSelectMain 32:5037, the front end's driver (map $00's enter script, 32:5033): the title (40:4032), LinkMenu
// (09:4A12), the character select (06:6071) on the golfer list (02:5A2D), the game mode select (0D:4AA7), then for
// Stroke the course select (0F:4AB7), for match play the opponent's character select (list 02:5985) and the course,
// for Training the course and hole select (0F:4AD6) hole after hole; then GolfRound 10:4451 and GolfSessionEnd
// 10:4B94 through sh.playGolfRound (boot.js gameFromPowerOn; without it, it returns the holes where it would call
// GolfRound). Ported paths: one player, a preset golfer or a saved character, Stroke, match play, Tournament and
// Training; the others throw.
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import { clearFrameTasks, unregisterFrameTask, registerFrameTask } from "./tasks.js";
import { setLinkActive, serialSendBlock, serialWaitSendDone } from "./serial.js";
import * as Scr from "./screen.js";
import { initFontScreen } from "./pictures.js";
import { initWindowSystem } from "./round.js";
import { expScreen, drawGfxPrompt, awardExpPoints, openCharSummaryScreen } from "./exp.js";
import { titleScreen } from "./title.js";
import { linkMenu } from "./menu09.js";
import { characterSelectScreen, characterSelectNoPortrait, resetCharSelectCursor } from "./charsel.js";
import { gameModeSelect, courseSelect, courseHoleSelect } from "./select.js";
import { golfSessionEnd, scriptEnd } from "./boot.js";
import * as St from "./start.js";
import * as Sv from "./save.js";
import { modeSelectOptionsMenu } from "./options.js";
import { modeSelectMenuLoop } from "./records.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));   // rst $30 (00:2D10 TestGameFlag)
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

export { initSerialLink } from "./serial.js";   // 00:304D
import { initSerialLink } from "./serial.js";
// 00:2B54 ResumeBGM: hSoundFlags bit 0 set: cleared, wCurrentBGM played again
function resumeBGM(sh) {
  const w = sh.w;
  if (w.high[0x1CE] & 1) { w.high[0x1CE] &= 0xFE; sh.sound(rd(w, 0xC33E)); }
}


// 02:5AFB WriteGolferListEntry: entry c of the list de (32 bytes, cleared): +0 the golfer ($C890), +1 b, +2 player 1's
// first 11 bytes (the name), +$0D [$C892], +$0E [$C89A] [$C89B], +$10 [$C891], +$11 [$C89D]
function writeGolferListEntry(w, de, b, c) {
  const e = (de + ((c << 5) & 0xFFFF)) & 0xFFFF;
  D.clearMemory16(w, e, 2);
  wr(w, e, rd(w, 0xC890)); wr(w, e + 1, b);
  for (let k = 0; k < 11; k++) wr(w, e + 2 + k, rd(w, 0xC880 + k));
  for (const [o, a] of [[13, 0xC892], [14, 0xC89A], [15, 0xC89B], [16, 0xC891], [17, 0xC89D]]) wr(w, e + o, rd(w, a));
}
// 02:5AA6 ListGolferAlways / 02:5A17 ListGolfer: SetupPlayerGolfer(b, c)
const listGolfer = (w, b, c) => St.setupPlayerGolfer(w, b, c);

// 02:5A2D BuildGolferListBySave: the list at de (WRAM6): the 3 save slots (02:5ACA ListSaveSlotGolfer: an empty one
// $0F), Luigi (9), Mario (8), then golfers 4-7 and $0A when their save flags (02:5AA9) or hUnlockAll allow (else
// $FF); wOptionFlags $C818 = 0
function buildGolferListBySave(w, de) {
  setW(w, 6);
  for (let s = 0; s < 3; s++) {                  // 02:5ACA ListSaveSlotGolfer: the slot's character into $C800
    if (Sv.saveBlockLoad(w, s, 0xC800)) wr(w, 0xC890, rd(w, 0xC33F) ? 0xFF : 0x0F);
    else { wr(w, 0xC2A5, 0); listGolfer(w, 0x80, 0x00); }   // (wSaveSlot 0 whatever the slot)
    writeGolferListEntry(w, de, s, s);
  }
  listGolfer(w, 0x09, 0x00); writeGolferListEntry(w, de, 0x0F, 3);
  listGolfer(w, 0x08, 0x00); writeGolferListEntry(w, de, 0x0F, 4);
  for (const [g, k] of [[4, 5], [5, 6], [6, 7], [7, 8], [0x0A, 9]]) {   // 02:5AA9 ListGolferIfSaveFlag
    if (w.high[0x1CF] || Sv.testSaveFlag(w, g >> 3, (g << 5) & 0xFF)) listGolfer(w, g, 0x00);
    else wr(w, 0xC890, 0xFF);
    writeGolferListEntry(w, de, 0x0F, k);
  }
  wr(w, 0xC818, 0);
}
// 02:5B5B BuildSaveSlotList (export $50): the list at de (WRAM6): the 3 save slots (02:5B38 LoadSaveSlotGolfer: the
// slot's character into $C800 and SetupPlayerGolfer $80, entry b = c = the slot; an empty or bad one 02:5A24
// ListEmptyEntry: $C890 = $FF, b = $0F), then 7 empty entries; wOptionFlags $C818 = 0; returns the slots used
export function buildSaveSlotList(w, de) {
  setW(w, 6);
  let n = 0;
  for (let s = 0; s < 3; s++) {
    if (Sv.saveBlockLoad(w, s, 0xC800)) { wr(w, 0xC890, 0xFF); writeGolferListEntry(w, de, 0x0F, s); }
    else { St.setupPlayerGolfer(w, 0x80, 0x00); writeGolferListEntry(w, de, s, s); n++; }
  }
  for (let k = 3; k < 10; k++) { wr(w, 0xC890, 0xFF); writeGolferListEntry(w, de, 0x0F, k); }
  wr(w, 0xC818, 0);
  return n;
}

// 02:5985 BuildGolferListByFlags: the opponents: 3 empty entries (02:5A24), Luigi, then golfers 8, 4, 5, 6, 7, $0A
// by the game flags #139, -, #80, #82, #84, #117 (02:5A07; or hUnlockAll)
function buildGolferListByFlags(w, de) {
  setW(w, 6);
  for (let s = 0; s < 3; s++) { wr(w, 0xC890, 0xFF); writeGolferListEntry(w, de, 0x0F, s); }
  const list = [[0x09, -1], [0x08, 139], [0x04, -1], [0x05, 80], [0x06, 82], [0x07, 84], [0x0A, 117]];
  list.forEach(([g, f], k) => {
    if (f < 0 || w.high[0x1CF] || flag(w, f)) listGolfer(w, g, 0x00);
    else wr(w, 0xC890, 0xFF);
    writeGolferListEntry(w, de, 0x0F, 3 + k);
  });
}

// the number of holes (32:5220 / 32:5283): flag #74 hole 18 only (a = 1), #73 three holes, else $12
function roundHoles(w) {
  if (flag(w, 74)) { wr(w, 0xC837, 0x12); return 1; }
  return flag(w, 73) ? 3 : 0x12;
}

// GolfRound 10:4451 with `holes`, then GolfSessionEnd 10:4B94 (32:523C, 32:52C6, 32:52F1): run through
// sh.playGolfRound when the caller gives one (boot.js gameFromPowerOn); else the holes are returned (the caller
// runs the round)
function* golfRound(sh, holes) {
  if (!sh.playGolfRound) return holes;
  yield* sh.playGolfRound(holes);
  yield* inBankGen(sh.w, 0x10, golfSessionEnd(sh));
  return null;
}

// 32:5037 ModeSelectMain: returns the GolfRound argument (the holes) when a round starts (with sh.playGolfRound:
// at the script's end, after the round)
export function* modeSelectMain(sh) {
  const w = sh.w;
  for (let k = 0; k < 6; k++) wr(w, 0xCAB8 + k, 0);
  clearFrameTasks(w);
  initSerialLink(w);
  w.high[0x1B9] = w.high[0x1B8] = 0;
  const ent = rd(w, 0xC46A);
  let at = ent === 1 ? "link" : ent === 2 || ent === 0xFA ? "modes" : "title";
  let titleArg = 0;
  for (;;) {
    if (at === "title") {                        // 32:5067
      D.clearMemory16(w, 0xCB40, 4);
      initSerialLink(w);
      yield* inBankGen(w, 0x40, titleScreen(sh, titleArg));
      at = rd(w, 0xCB40) === 0x10 ? "partner" : "link";   // (32:508B: the partner's link game came in)
    }
    if (at === "link" || at === "partner") {     // 32:5080 (32:508B without the link's reset)
      if (at === "link") {
        D.clearMemory16(w, 0xCB40, 4);
        initSerialLink(w);
      }
      at = "link";
      sh.sound(0x01);
      resumeBGM(sh);
      wr(w, 0xC33F, 0);
      const r = yield* inBankGen(w, 0x09, linkMenu(sh));
      if (r === 0xFF) { at = "title"; titleArg = 0xFF; continue; }
      if (r === 3) { yield* modeSelectOptionsMenu(sh); continue; }   // 32:54F2 (32:79D8), then 32:5080 again
      if (r === 2) { yield* inBankGen(w, 0x0B, modeSelectMenuLoop(sh)); continue; }   // 32:54EC (0B:4D9D)
      if (r === 1 || r === 0x11) {               // 32:5313 / 32:53B8, the round, then 32:5080 (the link menu) again
        const v = yield* (r === 1 ? linkHost(sh) : linkGuest(sh));   // (without sh.playGolfRound: the holes returned)
        if (v !== null) return v;
        continue;
      }
      if (r !== 0) notPorted(`the link menu's item ${r} (~32:509F)`);
      at = "player";
    }
    if (at === "player") {                       // 32:50B1
      sh.sound(0x01);
      resumeBGM(sh);
      D.inBank(w, 0x02, () => buildGolferListBySave(w, 0xD658));
      resetCharSelectCursor(w);
      // (w.charSelNoPortrait: a test's patch of 32:50C5's far call to export $10, 06:6D3E CharacterSelectNoPortrait)
      const r = yield* inBankGen(w, 0x06, (w.charSelNoPortrait ? characterSelectNoPortrait : characterSelectScreen)(sh, 0xD658, 0));
      if (r === 0xFF) { at = "link"; continue; }
      const e = (0xD658 + ((r << 5) & 0xFFFF)) & 0xFFFF;
      const c = rd(w, e), b = rd(w, e + 1), d = rd(w, e + 0x10);
      wr(w, 0xC2A5, b & 0x0F);
      if ((b & 0x0F) !== 0x0F) {                 // 32:5114 a save slot
        w.high[0x1CF] = 0;                       // hUnlockAll
        if (Sv.saveBlockLoad(w, b & 0x0F, 0xC800)) {
          // 32:5121 an empty (or bad) slot: ResumeBGM, warp 5 (the map engine's new character: map $1E, then the
          // first day on map $05, then map $00 entrance 2's mode select)
          resumeBGM(sh);
          wr(w, 0xC441, 5);
          return null;
        }
        Sv.restoreGameTimer(w);                  // 00:2CDE
        wr(w, 0xC2A7, 0xFF);                     // wNavDestination
        if (rd(w, 0xC95E) === 0x64) {            // 32:5139 the pending EXP $C95C-$C95D (with $C95E = $64)
          const de = scaleExpByLevel(w, rd(w, 0xC95C) | rd(w, 0xC95D) << 8);   // 32:54B5
          yield* inBankGen(w, 0x48, awardExpPoints(sh, de, 0x01));            // 48:4D70
          wr(w, 0xC95C, 0); wr(w, 0xC95D, 0); wr(w, 0xC95E, 0);
          Sv.saveGame(w);                        // 02:4489
          sh.sound(0x01);
        }
        St.mapWarpToReturnPoint(w);              // 0A:4D8A
        const rp = rd(w, 0xC96D);
        if (rp !== 2 && (rp === 1 || rd(w, 0xC450) !== 0)) {
          // 32:516C the saved place is in the story or in a round: the card and its prompts (32:7D35), then (A on
          // "continue") GolfRound $FF and GolfSessionEnd for a round; the story's map engine is not ported
          clearBgMapsBlank(w);                   // 32:5474
          yield* inBankGen(w, 0x05, initWindowSystem(sh));   // 05:407A
          const r = yield* loadSummaryPrompt(sh);
          if (r === 0xFF) { at = "player"; continue; }
          D.inBank(w, 0x0A, () => scriptEnd(w)); // 0A:40D6
          Scr.beginFadeOut(w, 0x10);
          yield* Scr.waitFade(sh);
          if (!r) {
            if (!rd(w, 0xC96D)) notPorted("continuing the story (~32:5199: the map engine)");
            return yield* golfRound(sh, 0xFF);   // 32:519A
          }
        }
        wr(w, 0xC834, 9);                        // 32:51A3
        at = "modes1";
        continue;
      }
      St.newGame(w);                             // 02:4E3D
      St.setupPlayerGolfer(w, c & 0x0F, 0);      // 02:4A28
      St.setPlayerControl(w, 0, 0);              // 02:4994
      if (d & 1) St.setPlayerField11(w, 0, 1);   // 02:49A7
      wr(w, 0xC834, 9);                          // 32:51A3
      at = "modes1";
    }
    if (at === "modes" || at === "modes1") {
      if (at === "modes") wr(w, 0xC834, 9);
      sh.sound(0x01);                            // 32:51A8
      wr(w, 0xC450, 0); wr(w, 0xC46A, 2);
      St.setupPlayerGolfer(w, 0x80, 0);
      wr(w, 0xC96D, 0);
      St.mapSaveReturnPoint(w);                  // 0A:4D5B
      for (const n of [144, 145, 146, 147]) clearFlag(w, n);
      Sv.saveGame(w);                            // 02:4489 (a save slot only)
      const m = yield* inBankGen(w, 0x0D, gameModeSelect(sh));
      if (m === 0xFF) { at = "player"; continue; }
      wr(w, 0xC834, m);
      if (m === 9) {                             // 32:51F9 Mario's story: warp 4 (map $03 entrance 1, the clubhouse)
        wr(w, 0xC441, 4);
        return null;
      }
      if (m === 3) {                             // 32:52A3 Stroke
        if (flag(w, 139) && !flag(w, 123)) {     // 32:5304 ModeSelectCheckLinksUnlocked: the Links won (#139), #123
          wr(w, 0xC441, 6);                      // clear: 32:530C drops its caller's return, warp 6
          return null;
        }
        const course = yield* inBankGen(w, 0x0F, courseSelect(sh));
        if (course === 0xFF) { at = "modes1"; continue; }
        St.golfSessionInit(w);                   // 10:4B28
        St.setCourseHole(w, course, course, 1);  // 10:423B
        St.setupPlayerGolfer(w, 0xFF, 1);
        wr(w, 0xC834, 3);
        return yield* golfRound(sh, 0x12);
      }
      if (m === 2) {                             // 32:5240 match play
        for (;;) {
          D.inBank(w, 0x02, () => buildGolferListByFlags(w, 0xD658));
          resetCharSelectCursor(w);
          const r = yield* inBankGen(w, 0x06, characterSelectScreen(sh, 0xD658, 0));
          if (r === 0xFF) break;
          const c = rd(w, (0xD658 + ((r << 5) & 0xFFFF)) & 0xFFFF);
          const course = yield* inBankGen(w, 0x0F, courseSelect(sh));
          if (course === 0xFF) continue;
          St.golfSessionInit(w);
          St.setCourseHole(w, course, course, 1);
          St.setupPlayerGolfer(w, c, 1);
          wr(w, 0xC834, 2);
          return yield* golfRound(sh, roundHoles(w));
        }
        at = "modes1";
        continue;
      }
      if (m === 1) {                             // 32:51FF Tournament
        if (flag(w, 139) && !flag(w, 123)) {     // 32:5304 ModeSelectCheckLinksUnlocked (as for Stroke): warp 6
          wr(w, 0xC441, 6);
          return null;
        }
        const course = yield* inBankGen(w, 0x0F, courseSelect(sh));
        if (course === 0xFF) { at = "modes1"; continue; }
        St.golfSessionInit(w);                   // 10:4B28
        St.setCourseHole(w, course, course, 1);  // 10:423B
        St.setupPlayerGolfer(w, 0xFF, 1);        // 02:4A28
        wr(w, 0xC834, 1);
        return yield* golfRound(sh, roundHoles(w));
      }
      if (m === 4) {                             // 32:52CD Training: one hole at a time
        let h = 1, l = 1;
        for (;;) {
          sh.sound(0x01);                        // 32:52D0
          const [course, hole] = yield* inBankGen(w, 0x0F, courseHoleSelect(sh, h, l));
          if (course === 0xFF) break;
          St.golfSessionInit(w);                 // 10:4B28
          St.setCourseHole(w, course, course, hole);   // 10:423B
          wr(w, 0xC834, 4);
          const r = yield* golfRound(sh, 1);
          if (r !== null) return r;
          h = course; l = hole | 0x80;
          wr(w, 0xC834, 4);
          if (rd(w, 0xC96C)) return null;        // wRoundResult: Back to Menu
        }
        at = "modes1";
        continue;
      }
      notPorted(`the game mode ${m} (~32:51DF)`);
    }
  }
}

// ---- the link game (LinkMenu's item 1: 1 the side that asked, $11 the side that answered) ----
// 4A:6C1F LoadLinkWaitPicture: ClearFrameTasks; WRAM1; LCD off, no sprites; WY $90, no scroll; the palettes 4A:6CC5
// (8 BG, 00:056C); the LZ tiles 4A:6D05 -> VRAM1 $9000 / $9400 (queued) and $8800, the attributes 4A:74D9 -> VRAM1
// $9800, the map 4A:755E -> $9800 ($24 blocks each); LCD on; $C0F8 = 0 and the frame task LinkWaitPictureTask 4A:6CA2
// (the copy of 48:5EE9 PictureAnimTiles with its tiles at 4A:7650: pictures.js)
export function loadLinkWaitPicture(w) {
  clearFrameTasks(w);
  setW(w, 1);
  if (w.vram) D.disableLCDSafely(w);
  D.resetSprites(w);
  if (w.vram) w.lcd.wy = 0x90;
  w.high[0x18B] = w.high[0x18A] = 0;
  D.inBank(w, 0x4A, () => {
    D.loadPalettesImmediate(w, 0x6CC5, 0x00, 0x08);
    D.lzTo(w, 0x4A, 0x6D05, 0xD000);
    D.queueVRAMCopy(w, 0xD000, 0xB000, 0x40);
    D.queueVRAMCopy(w, 0xD400, 0xB400, 0x40);
    D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x40);
    D.lzTo(w, 0x4A, 0x74D9, 0xD000);
    D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x24);
    D.lzTo(w, 0x4A, 0x755E, 0xD000);
    D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x24);
  });
  if (w.vram) D.enableLCD(w);
  wr(w, 0xC0F8, 0);
  registerFrameTask(w, 0x01, 0x4A, 0x6CA2);
}

// 32:5428 LoadRosterEntryAsPlayer: the golfer list's entry a of de as player 1: its slot nibble to wSaveSlot; $F a
// preset golfer (SetupPlayerGolfer with its id, SetPlayerControl 0, its +$10 bit 0 -> SetPlayerField11 1), else the
// save slot loaded to $C800 (02:4355, its result not looked at), RestoreGameTimer 00:2CDE, SetupPlayerGolfer $80
export function loadRosterEntryAsPlayer(w, a, de) {
  const e = (de + ((a << 5) & 0xFFFF)) & 0xFFFF;
  const c = rd(w, e), b = rd(w, e + 1), d = rd(w, e + 0x10);
  wr(w, 0xC2A5, b & 0x0F);
  if ((b & 0x0F) === 0x0F) {
    St.setupPlayerGolfer(w, c & 0x0F, 0);
    St.setPlayerControl(w, 0, 0);
    if (d & 1) St.setPlayerField11(w, 0, 1);
    return;
  }
  Sv.saveBlockLoad(w, b & 0x0F, 0xC800);
  Sv.restoreGameTimer(w);
  St.setupPlayerGolfer(w, 0x80, 0);
}

// the character select of the link game (32:532F / 32:53C4): the golfer list by the save file (02:5A2D), the cursor
// reset (06:690F), the select (06:6071) until a pick (B starts it again); the pick as player 1 (32:5428)
function* linkCharSelect(sh) {
  const w = sh.w;
  for (;;) {
    D.inBank(w, 0x02, () => buildGolferListBySave(w, 0xD658));
    resetCharSelectCursor(w);
    const r = yield* inBankGen(w, 0x06, characterSelectScreen(sh, 0xD658, 0));
    if (r === 0xFF) continue;
    loadRosterEntryAsPlayer(w, r, 0xD658);
    return;
  }
}

// 32:5313 the side that asked (wLinkRole 1): the wait picture until the partner's $20 (its idle byte: it is in its
// character select), a quick fade out (00:258A, c $7F), a frame, SetLinkActive; the character select; the game mode
// (0D:4AA7 from wGameMode 2: the link list) to wGameMode and the record's +$17 ($C897), the course (0F:4AB7; B: the
// mode again); the record $C880 ($20 bytes) sent with the wait picture and $21 to follow, until the partner's $22;
// GolfSessionInit (10:4B28), player 1 ourselves ($80), player 2 the partner ($82: its record as received, field $13 3),
// SetCourseHole (the course, hole 1), the mode; GolfRound $12, GolfSessionEnd (then 32:5080, the link menu)
function* linkHost(sh) {
  const w = sh.w;
  wr(w, 0xC33F, 1);
  loadLinkWaitPicture(w);
  do yield* sh.advance(); while (w.high[0x1C0] !== 0x20);
  Scr.forceFadeOut(w, 0x7F);
  yield* sh.advance();
  setLinkActive(w);
  let course;
  for (;;) {
    yield* linkCharSelect(sh);
    wr(w, 0xC834, 2);
    let m;
    for (;;) {
      m = yield* inBankGen(w, 0x0D, gameModeSelect(sh));
      if (m === 0xFF) break;
      wr(w, 0xC834, m); wr(w, 0xC897, m);
      course = yield* inBankGen(w, 0x0F, courseSelect(sh));
      if (course !== 0xFF) break;
    }
    if (m !== 0xFF) break;
  }
  wr(w, 0xC836, course);
  D.copyMemoryFast(w, 0xC880, 0xCB00, 0x02);
  loadLinkWaitPicture(w);
  w.high[0x1C9] = 0x21;
  yield* serialSendBlock(sh, 0x20);
  yield* serialWaitSendDone(sh);
  do yield* sh.advance(); while (w.high[0x1C0] !== 0x22);
  const mode = rd(w, 0xC834);
  St.golfSessionInit(w);
  St.setupPlayerGolfer(w, 0x80, 0);
  St.setupPlayerGolfer(w, 0x82, 1);
  St.setCourseHole(w, course, course, 1);
  wr(w, 0xC834, mode);
  return yield* golfRound(sh, 0x12);
}

// 32:53B8 the side that answered (wLinkRole 2): idle byte $20, SetLinkActive; the character select; the record sent
// with the wait picture and $22 to follow, until the partner's $21; GolfSessionInit, player 1 copied to player 2 ($40
// bytes), player 1 the partner ($82; its +$17, the mode it chose, to wGameMode); GolfRound $12, GolfSessionEnd
function* linkGuest(sh) {
  const w = sh.w;
  wr(w, 0xC33F, 2);
  w.high[0x1C1] = 0x20;
  setLinkActive(w);
  yield* linkCharSelect(sh);
  loadLinkWaitPicture(w);
  D.copyMemoryFast(w, 0xC880, 0xCB00, 0x02);
  w.high[0x1C9] = 0x22;
  yield* serialSendBlock(sh, 0x20);
  yield* serialWaitSendDone(sh);
  do yield* sh.advance(); while (w.high[0x1C0] !== 0x21);
  St.golfSessionInit(w);
  D.copyMemoryFast(w, 0xC880, 0xC8C0, 0x04);
  St.setupPlayerGolfer(w, 0x82, 0);
  wr(w, 0xC834, rd(w, 0xC897));
  return yield* golfRound(sh, 0x12);
}

// 32:5474 ClearBgMapsBlank: LCD off; the WRAM2 / WRAM3 maps at $D000 cleared ($900 bytes); the BG map and its
// attributes from WRAM3 (both from the cleared tiles); LCD on
function clearBgMapsBlank(w) {
  const old = w.high[0x196];
  if (w.vram) D.disableLCDSafely(w);
  setW(w, 2); D.clearMemory16(w, 0xD000, 0x90);
  setW(w, 3); D.clearMemory16(w, 0xD000, 0x90);
  if (w.vram) {
    D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x24);
    D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x24);
    D.enableLCD(w);
  }
  setW(w, old);
}
// 32:7D82 TwoChoicePrompt: the cursor [$D251] (WRAM6) from a, its blink $D253; Up / Down switch it (sound $5B); A gives
// it (sound $5C), B $FF (sound $5D), a frame after
function* twoChoicePrompt(sh, a) {
  const w = sh.w;
  setW(w, 6);
  wr(w, 0xD251, a);
  wr(w, 0xD253, 0);
  for (;;) {
    yield* sh.advance();
    const p = w.high[0x194];
    if (!p) continue;
    wr(w, 0xD253, 0);
    if (p & 1) { sh.sound(0x5C); setW(w, 6); const r = rd(w, 0xD251); yield* sh.advance(); return r; }
    if (p & 2) { sh.sound(0x5D); yield* sh.advance(); return 0xFF; }
    if (p & 0xC0) { sh.sound(0x5B); setW(w, 6); wr(w, 0xD251, (rd(w, 0xD251) + 1) & 1); }
  }
}
// 32:7D35 LoadSummaryPrompt: the card (48:4053 with a = 0); the first prompt (48:4A81): B $FF, the first choice 0,
// the second the next prompt (48:4AC3; from its second row): its first choice 1, B or the second back to the first
// prompt; then the fade out, 41:7DF4 CloseCharSummaryScreen (its task 41:7E03 off), the font screen
function* loadSummaryPrompt(sh) {
  const w = sh.w;
  if (w.charSummary) yield* inBankGen(w, 0x41, openCharSummaryScreen(sh));   // (a test's patch: 41:7DB3)
  else yield* inBankGen(w, 0x48, expScreen(sh, 0, 0, 0));
  let r;
  for (;;) {
    D.inBank(w, 0x48, () => drawGfxPrompt(w, 0));
    const a = yield* twoChoicePrompt(sh, 0);
    if (a === 0xFF || a === 0) { r = a; break; }
    D.inBank(w, 0x48, () => drawGfxPrompt(w, 1));
    const b = yield* twoChoicePrompt(sh, 1);
    if (b === 0) { r = 1; break; }
  }
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  unregisterFrameTask(w, 0x41, 0x7E03);
  initFontScreen(w);                             // 01:41E8
  return r;
}

// 32:54B5 ScaleExpByLevel: de by wCharLevel: under 10 as is, under 20 x 1.5, under 30 x 2, under 40 x 2.5, else x 3
// (16-bit, the halves rounded down)
function scaleExpByLevel(w, de) {
  const l = rd(w, 0xC812);
  if (l < 0x0A) return de;
  if (l < 0x14) return (de + (de >> 1)) & 0xFFFF;
  if (l < 0x1E) return (de * 2) & 0xFFFF;
  if (l < 0x28) return (de * 2 + (de >> 1)) & 0xFFFF;
  return (de * 3) & 0xFFFF;
}

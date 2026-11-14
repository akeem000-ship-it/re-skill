// The story file's loaders and a debug stats screen (bank 2, $4FA6-$52CE): a story file read into the save image
// and court slot 0's record, a court slot 2 record for a match against a roster character or a story file's,
// and the unused debug screen that shows and edits the story file's main record.
// Port of debug_02.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are (its character-group routines at the end are in records.js; its roster,
// StoryCharacterRecords_02, is read by story02.js).
// Tests: web/tests/port/routines_story.mjs.
import { FZ, BANK_STORY_02, WRAM_STAGING, hook, hookGen, farcall, advanceFrame, randomSeed } from "./common.js";
import { copyMemoryFast } from "../home/memory.js";
import { levelUpPlayer } from "./equip.js";
import { enableLCD } from "../home/system.js";
import { beginFadeOut, beginFadeIn } from "../home/colorfade.js";
import { printString, printDecimalByte, printHexWord, printDecimalWord } from "../home/debugtext.js";
import { playSoundManaged } from "../audio/requests.js";
import { checkStorySlot, saveStorySlot } from "../save/storyslots.js";
import {
  initCa00RecordFromCharId, initStoryModeState, initPlayerRecordFromTemplate, unusedValidateN64TransferRecord,
  wStoryMainRecord,
} from "./story02.js";

const BANK = BANK_STORY_02, BANK_SAVE = 0x03, BANK_TEXT = 0x05, InitTextWindows = 0x4096;
const wStorySlotData = 0xC800, wLinkSessionActive = 0xC33F;
const wPlayer1MainName = 0xCA00, wPlayer1CurrentMainCharacter = 0xCA0B, wPlayer1MainPalette = 0xCA0C;
const wPlayer2MainName = 0xCA80, wPendingExpStory = 0xC9B0, wPendingExpTrophy = 0xC9B2;
const wStoryModeMainCharacterLeftHanded = 0xC90E, PENDING_EXP_SIZE = 8;
const CHAR_NONE = 0xFF, CHAR_STORY_MAIN = 0x80, CHAR_RECORD_SIZE = 0x40, NUM_STORY_SLOTS = 3;
const UNREAD_FILE_CHAR = 0x3F, UNREAD_FILE_PALETTE = 0x03;
const COURT_SLOT_PLAYER1 = 0, COURT_SLOT_PLAYER2 = 2;
const MenuTilemaps_02 = 0x51FA, DebugStoryStatsScreenString0 = 0x5202, DebugStoryStatsScreenString1 = 0x520A;
const DebugStoryStatsScreenString2 = 0x521A;
const BGM_DICTIONARY = 0x05, SFX_MENU_MOVE = 0x5E, SFX_MENU_SELECT = 0x5F, DEBUG_STEP_ON = 0x03, DEBUG_STEP_SOUND = 0x01;
const PADF_A = 0x01, PADF_B = 0x02, PADF_SELECT = 0x04, PADF_START = 0x08;
const PADF_RIGHT = 0x10, PADF_LEFT = 0x20, PADF_UP = 0x40, PADF_DOWN = 0x80;
const STATS_FADE = 127, TEMPLATES = 0x07, TEMPLATE_LEFT_HANDED = 0x04;
const CHARREC_CHAR = 0x0B, CHARREC_LEFT_HANDED = 0x0E, CHARREC_LEVEL = 0x18, CHARREC_SWING = 0x19;
const CHARREC_STAT_TOP = 0x20, CHARREC_PHYSICS_TEMPLATE = 0x30, CHARREC_TRAIN_LEVELS = 0x38;

const storySlot = (P, a) => farcall(P, BANK_SAVE, () => { P.V.currentStorySlot = a; return checkStorySlot(P); });

// LoadStorySlot (02:5247): story file a read into the save image. Read: court slot 0's record from its main record
// (wCurrentStorySlot set to 0 for that). Not read: court slot 0 shows character $3F in palette 3 (CHAR_NONE in a
// link session). Returns the registers it leaves.
export function loadStorySlot(P, a) {
  const { bus } = P, bc = (a << 8) | a;
  const r = storySlot(P, a);
  if (r.a) {
    if (bus.u8(wLinkSessionActive)) { bus.w8(wPlayer1CurrentMainCharacter, CHAR_NONE); return { a: CHAR_NONE, f: 0, bc, hl: wStorySlotData }; }
    bus.w8(wPlayer1CurrentMainCharacter, UNREAD_FILE_CHAR);
    bus.w8(wPlayer1MainPalette, UNREAD_FILE_PALETTE);
    P.V.currentStorySlot = a;
    return { a, f: FZ, bc, hl: wStorySlotData };
  }
  P.V.currentStorySlot = 0;
  const { de: _de, ...init } = initCa00RecordFromCharId(P, CHAR_STORY_MAIN, COURT_SLOT_PLAYER1);   // (bc, de popped)
  return { hl: wStorySlotData, ...init, bc };
}
// Unused_02_StorySlotVariant (02:5284): LoadStorySlot that leaves wCurrentStorySlot at a, and a = 0 when the
// file was read, $FF (and court slot 0 CHAR_NONE) when not. Nothing calls it.
export function unusedStorySlotVariant(P, a) {
  const bc = (a << 8) | a;
  const r = storySlot(P, a);
  if (r.a) { P.bus.w8(wPlayer1CurrentMainCharacter, CHAR_NONE); return { a: 0xFF, f: 0, bc, hl: wStorySlotData }; }
  const { de: _de, ...init } = initCa00RecordFromCharId(P, CHAR_STORY_MAIN, COURT_SLOT_PLAYER1);
  return { hl: wStorySlotData, ...init, a: 0, f: FZ, bc };
}
// LoadCharacterRecordToCa80 (02:52AA): court slot 2's record: for a with bit 7, story file a & $7F's main
// character (loaded into court slot 0, then both records copied on); else roster character a. All registers kept.
export function loadCharacterRecordToCa80(P, a) {
  if (a & 0x80) {
    loadStorySlot(P, a & 0x7F);
    copyMemoryFast(P, wPlayer1MainName, wPlayer2MainName, (2 * CHAR_RECORD_SIZE) / 16);
  } else initCa00RecordFromCharId(P, a, COURT_SLOT_PLAYER2);
}

// Unused_02_DebugStoryStatsScreen (02:4FA6): a screen of the story file's main record (slot, character, level,
// swing word, physics template, handedness, training levels, stats) that never returns. Up / Left / Right / Down:
// a spin / power / control / speed level-up; B: the music restarted; A: the next of 8 templates (with bit 2
// left-handed); Select: the next file; Start: saved. Nothing calls it.
export function* unusedDebugStoryStatsScreen(P) {
  const { bus, V } = P;
  playSoundManaged(P, BGM_DICTIONARY);
  P.wramBank(WRAM_STAGING);
  V.debugStepMode = DEBUG_STEP_ON;
  V.currentStorySlot = 0;
  P.callRom(BANK_TEXT, InitTextWindows);
  enableLCD(P);
  beginFadeOut(P, STATS_FADE);
  beginFadeIn(P, STATS_FADE);
  initStoryModeState(P);
  let d = 0;
  for (;;) {                                                       // .loop: the file read
    if (storySlot(P, V.currentStorySlot).a) {
      printString(P, 0x08, 0x02, MenuTilemaps_02);                 // "FAILED "
      printBlankExp(P);
    } else {
      printString(P, 0x08, 0x02, DebugStoryStatsScreenString0);
      if (unusedValidateN64TransferRecord(P).a) {
        printDecimalWord(P, 0x02, 0x10, bus.u16(wPendingExpStory));
        printDecimalWord(P, 0x0A, 0x10, bus.u16(wPendingExpTrophy));
        for (let i = 0; i < PENDING_EXP_SIZE; i++) bus.w8(wPendingExpStory + i, 0);
      } else printBlankExp(P);
    }
    for (let reread = false; !reread;) {                           // .loopB: the record shown
      printRecord(P);
      for (;;) {                                                   // .loop2: a frame
        yield* advanceFrame(P);
        randomSeed(P);
        const a = V.inputPressed, kind = levelUpKind(a);
        if (kind >= 0) {
          farcall(P, BANK, () => levelUpPlayer(P, 0, kind));
          playSoundManaged(P, SFX_MENU_MOVE);
          break;
        }
        if (a & PADF_B) {
          V.debugStepMode = DEBUG_STEP_SOUND;
          playSoundManaged(P, BGM_DICTIONARY);
          V.debugStepMode = DEBUG_STEP_ON;
          break;
        }
        if (a & PADF_A) {
          initStoryModeState(P);
          d = (d + 1) & TEMPLATES;
          initPlayerRecordFromTemplate(P, 0, d & ~TEMPLATE_LEFT_HANDED);
          if (d & TEMPLATE_LEFT_HANDED) bus.w8(wStoryModeMainCharacterLeftHanded, 1);
          break;
        }
        if (a & PADF_SELECT) {
          playSoundManaged(P, SFX_MENU_SELECT);
          const next = V.currentStorySlot + 1;
          V.currentStorySlot = next < NUM_STORY_SLOTS ? next : 0;
          reread = true;
          break;
        }
        if (a & PADF_START) {
          playSoundManaged(P, SFX_MENU_SELECT);
          printString(P, 0x08, 0x02, DebugStoryStatsScreenString1);
          farcall(P, BANK_SAVE, () => saveStorySlot(P, { withTimer: true }));
          break;
        }
      }
    }
  }
}
// the d-pad's level-up kind: Up spin, Left power, Right control, Down speed (in that order of precedence)
const levelUpKind = a => (a & PADF_UP ? 0 : a & PADF_LEFT ? 1 : a & PADF_RIGHT ? 2 : a & PADF_DOWN ? 3 : -1);
function printBlankExp(P) {
  printString(P, 0x02, 0x10, DebugStoryStatsScreenString2);
  printString(P, 0x08, 0x10, DebugStoryStatsScreenString2);
}
function printRecord(P) {
  const { bus } = P, bc = wStoryMainRecord;
  printDecimalByte(P, 0x02, 0x02, P.V.currentStorySlot);
  printDecimalByte(P, 0x02, 0x04, bus.u8(bc + CHARREC_CHAR));
  printDecimalByte(P, 0x02, 0x06, bus.u8(bc + CHARREC_LEVEL));
  printHexWord(P, 0x02, 0x07, bus.u16(bc + CHARREC_SWING));
  for (let i = 0; i < 4; i++) printHexWord(P, 0x02, 0x09 + i, bus.u16(bc + CHARREC_PHYSICS_TEMPLATE + 2 * i));
  printDecimalByte(P, 0x02, 0x0E, bus.u8(bc + CHARREC_LEFT_HANDED));
  [0x04, 0x06, 0x09, 0x0B].forEach((row, i) => printDecimalByte(P, 0x07, row, bus.u8(bc + CHARREC_TRAIN_LEVELS + i)));
  for (let i = 0; i < 11; i++) printDecimalByte(P, 0x0C, 0x04 + i, bus.u8(bc + CHARREC_STAT_TOP + i));
}

export const HOOKS = [
  [BANK, 0x4FA6, hookGen(P => unusedDebugStoryStatsScreen(P))],
  [BANK, 0x5247, hook((P, c) => loadStorySlot(P, c.a))],
  [BANK, 0x5284, hook((P, c) => unusedStorySlotVariant(P, c.a))],
  [BANK, 0x52AA, hook((P, c) => { loadCharacterRecordToCa80(P, c.a); })],
];

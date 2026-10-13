// Story matches (bank $0A, $4931-$4E0D): the default story match, running a match from the overworld and
// coming back to it, the characters on court (the story's player, partner, opponent and the opponent's partner),
// the story's match table (mode, opponent, court, sets and games, music), and the debug "clear status" menu that
// sets the story's progress flags.
// Port of match_0a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are. The match itself (RunMatch, bank 8) is the match engine's.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec (a match from the training court).
import {
  FZ, FN, FH, FC, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_CHAR1, BANK_STORY, BANK_STORY_02, FLAG_DOUBLES,
  FLAG_DEBUG_KEEP_MATCH_SETTINGS, hook, hookGen, farcall, farcallGen, testFlag, testFlagF, setFlagOp, clearFlagOp,
  ClearFrameTasks, DisableLCDSafely, EnableLCD, addFlags, zf, cpFlags,
} from "./common.js";
import { beginFadeOut, beginFadeIn, waitFadeEnd } from "../home/colorfade.js";
import { clearMemory16, queueVRAMCopy } from "../home/memory.js";
import { initCa00RecordFromCharId } from "./story02.js";
import { loadStoryObjPalettes } from "./story_interact.js";
import { setSinglesRankingClearFlags, setDoublesRankingClearFlags, getClearStatusResultCode } from "./story_loop.js";

const BANK = BANK_STORY;
const BANK_MATCH = 0x08, InitDefaultMatchSettings = 0x4070, RunMatch = 0x4190;
const BANK_SAVE = 0x03, SaveStorySlotWithTimer = 0x4D10;
const BANK_GAME = 0x01, LoadMenuFontGfx = 0x50E2;
const BANK_TEXT = 0x05, ResetTextWindowState = 0x6E09, CreateWindowFromScreenRect = 0x6E45;
const DrawTextWindowFrame = 0x6F70, RenderProportionalTextAt = 0x5DB3, RedrawWindowRows = 0x7205;
const CreateMenuWindowFromText = 0x46B0, RestoreShadowTilemap = 0x436F, RenderMenuWindowText = 0x7232;
const RunMenuSelection = 0x477F, CloseWindow = 0x72BD;
const DoublesPartnerTable_0a = 0x49D9;          // the doubles partner of each opponent
const SinglesMatchSettingsTable_0a = 0x4AB2, DoublesMatchSettingsTable_0a = 0x4B2F, MATCH_SETTINGS_SIZE = 5;
const TrainingCourtLevel1ClearFlags_0a = 0x4DF2, TrainingCourtLevel2ClearFlags_0a = 0x4E00;
const MATCHLIST_SINGLES = 0x00, MATCHLIST_DOUBLES = 0x01, CHAR_MARK = 0x0C, COURT_GRASS = 0x02;
const MATCHCONTEXT_STORY = 0x01, CHAR_STORY_MAIN = 0x80, CHAR_STORY_PARTNER = 0x81;
const STORYLOC_MAIN_MENU = 0x00, MATCH_FADE_SPEED = 16;
const DEFAULT_SETS = 1, DEFAULT_GAMES = 2;
// the clear-status menu: its record (WRAM 5 $DF00: mode, doubles, format, class, rank, window, result code)
const wClearStatusMode = 0xDF00, wClearStatusDoubles = 0xDF01, wClearStatusFormat = 0xDF02;
const wClearStatusClass = 0xDF03, wClearStatusRank = 0xDF04, wClearStatusWindowId = 0xDF05;
const wClearStatusResultCode = 0xDF06;
const wWindowShadowTilemap = 0xD000, CLEAR_STATUS_TEXT_CELL = wWindowShadowTilemap + 12 * 32 + 1;
const Text_34_215 = 0x10D7, Text_34_217 = 0x10D9, Text_34_218 = 0x10DA, Text_34_228 = 0x10E4;
const Text_34_229 = 0x10E5, Text_34_230 = 0x10E6, Text_34_232 = 0x10E8;
const RANK_LIST_SINGLES = 0x10DB, RANK_LIST_DOUBLES = 0x10DF;
const RESULT_CANCELLED = 0x08, RESULT_MODE_1 = 0x01;
const wScreenAttrmap = 0xD000, wShadowTilemap = 0xD000, vBGMap0 = 0x9800, VRAM_BANK1 = 0x2000;
const BG_MAP_BLOCKS = (18 * 32) / 16, BG_CLEAR_SIZE = 0x0500, BLANK_TILE = 0x20;
const TRAINING_FLAGS_FIRST = 0x1800, TRAINING_FLAGS = 0x1C, FLAG_STEP = 0x20;

// InitStoryMatchSettings (0A:4931): the default settings (bank 8's), then a story singles match against Mark on
// grass, 1 set of 2 games. Returns the registers it leaves.
export function initStoryMatchSettings(P) {
  const { V } = P, r = P.callRom(BANK_MATCH, InitDefaultMatchSettings);
  V.matchPlayerChar = V.storyModeMainCharacterOverworldSprite;
  V.matchIsDoubles = 0;
  V.onCourtCharCount = 2;
  P.bus.w8(P.A.currentMinigameStoryMatch, MATCHLIST_SINGLES);
  V.matchOpponentChar = CHAR_MARK;
  V.currentlyUsedCourt = COURT_GRASS;
  V.matchTypeNumberOfSets = DEFAULT_SETS;
  V.matchTypeNumberOfGames = DEFAULT_GAMES;
  V.matchContext = MATCHCONTEXT_STORY;
  return { a: MATCHCONTEXT_STORY, f: 0, bc: r.bc, de: r.de, hl: r.hl };
}
// RunStoryMatch (0A:4962): fade out, put the characters on court and play the match (bank 8). After a "save and
// quit" the story slot is saved and the story leaves for the main menu; otherwise the match's stats are dropped.
export function* runStoryMatch(P) {
  const { V } = P;
  beginFadeOut(P, MATCH_FADE_SPEED);
  yield* waitFadeEnd(P, { a: 0, f: 0, b: 0, c: MATCH_FADE_SPEED, d: 0, e: 0, h: 0, l: 0 });
  assignStoryMatchCharacters(P);
  const m = yield* P.runRom(BANK_MATCH, RunMatch);
  if (!V.saveAndQuitRequest) { V.keepMatchStatsFlag = 0; return { a: 0, f: FZ, bc: m.bc, de: m.de, hl: m.hl }; }
  const r = yield* P.runRom(BANK_SAVE, SaveStorySlotWithTimer);
  V.storyModeCurrentLocation = STORYLOC_MAIN_MENU;
  V.storyModeEntryPoint = 1;
  V.unusedExitTriggerIdMirror = 0xFF;
  V.storyModeExitTriggerRequest = 0xFF;
  return { a: 0xFF, f: r.f, bc: r.bc, de: r.de, hl: r.hl };
}
// RestoreOverworldAfterMatch (0A:4991): fade out; the overworld's OBJ palettes and the menu font back. Returns
// the registers it leaves.
export function* restoreOverworldAfterMatch(P) {
  beginFadeOut(P, MATCH_FADE_SPEED);
  yield* waitFadeEnd(P, { a: 0, f: 0, b: 0, c: MATCH_FADE_SPEED, d: 0, e: 0, h: 0, l: 0 });
  loadStoryObjPalettes(P);
  P.callRom(0, DisableLCDSafely);
  yield* P.runRom(BANK_GAME, LoadMenuFontGfx);
  const r = P.callRom(0, EnableLCD);
  P.V.matchContext = 0;
  return { a: 0, f: FZ, bc: r.bc, de: r.de, hl: r.hl };
}
// AssignStoryMatchCharacters (0A:49AA): court slot 0 the story's character, 2 the opponent; in doubles 1 the
// story's partner and 3 the opponent's partner (DoublesPartnerTable_0a). Returns the registers it leaves.
export function assignStoryMatchCharacters(P) {
  const { V } = P;
  const init = (char, slot) => farcall(P, BANK_STORY_02, () => initCa00RecordFromCharId(P, char, slot));
  init(CHAR_STORY_MAIN, 0);
  let r = init(V.matchOpponentChar, 2);
  if (!V.matchIsDoubles) return { ...r, a: 0, f: FZ };
  init(CHAR_STORY_PARTNER, 1);
  const at = (DoublesPartnerTable_0a + V.matchOpponentChar) & 0xFFFF;
  r = init(P.rom.u8(BANK, at), 3);
  return { hl: at, ...r };
}
// SetMatchDoublesMode (0A:4A41): doubles (a = 1) or singles: 2 or 4 characters on court.
export function setMatchDoublesMode(P, a) {
  P.V.matchIsDoubles = a;
  const x = (a << 1) & 0xFF;
  P.V.onCourtCharCount = x + 2;
  return { a: (x + 2) & 0xFF, f: addFlags(x, 2) };
}
// LoadMatchSettingsFromTable (0A:4A5C): story match wCurrentMinigameStoryMatch (list, index) from the singles or
// doubles table: mode, opponent, court, sets and games (1 set of 2 with the debug flag), music.
export function loadMatchSettingsFromTable(P) {
  const { bus, V } = P;
  const doubles = bus.u8(P.A.currentMinigameStoryMatch) === MATCHLIST_DOUBLES;
  const table = doubles ? DoublesMatchSettingsTable_0a : SinglesMatchSettingsTable_0a;
  setMatchDoublesMode(P, doubles ? 1 : 0);
  const index = bus.u8(P.A.currentMinigameStoryMatch + 1);
  let hl = (index * MATCH_SETTINGS_SIZE + table) & 0xFFFF;
  const rd = () => { const v = P.rom.u8(BANK, hl); hl = (hl + 1) & 0xFFFF; return v; };
  V.gameMode = rd(); V.matchOpponentChar = rd(); V.currentlyUsedCourt = rd();
  if (testFlag(P, FLAG_DEBUG_KEEP_MATCH_SETTINGS)) {
    V.matchTypeNumberOfGames = DEFAULT_GAMES; V.matchTypeNumberOfSets = DEFAULT_SETS;
    hl = (hl + 1) & 0xFFFF;
    const bgm = P.rom.u8(BANK, hl);
    V.matchBGM = bgm;
    return { a: bgm, f: testFlagF(true), de: table, hl };
  }
  const e = rd();
  V.matchTypeNumberOfGames = e & 0x0F;
  V.matchTypeNumberOfSets = e >> 4;
  const bgm = P.rom.u8(BANK, hl);
  V.matchBGM = bgm;
  return { a: bgm, f: zf(e >> 4) | FH, de: (table & 0xFF00) | e, hl };
}

// RunClearStatusSetupMenu (0A:4BAC), the debug menu: the story mode (cancel: result 8; 1: result 1), then for
// mode 0 its format (singles / doubles), class and rank; the story's progress flags are set to match. Returns
// the result code in a (bc, de, hl kept).
export function* runClearStatusSetupMenu(P) {
  const { bus } = P, old = P.V.wramBank;
  P.callRom(0, ClearFrameTasks);
  P.callRom(0, DisableLCDSafely);
  yield* P.runRom(BANK_GAME, LoadMenuFontGfx);
  P.callRom(0, EnableLCD);
  P.wramBank(WRAM_CHAR1);
  clearMemory16(P, wClearStatusMode, 2);
  yield* P.runRom(BANK_TEXT, ResetTextWindowState);
  clearBgTilemaps(P);
  const w = yield* P.runRom(BANK_TEXT, CreateWindowFromScreenRect, { d: 0x00, e: 0x0B, b: 0x14, c: 0x07 });
  bus.w8(wClearStatusWindowId, w.a);
  yield* P.runRom(BANK_TEXT, DrawTextWindowFrame, { a: w.a });
  beginFadeIn(P, MATCH_FADE_SPEED);
  yield* waitFadeEnd(P, { a: 0, f: 0, b: 0, c: MATCH_FADE_SPEED, d: 0, e: 0, h: 0, l: 0 });
  P.wramBank(WRAM_CHAR1);
  // one step of the menu: the prompt, then a menu of text hl at row d; its choice
  const step = function* (prompt, menu, row) {
    yield* P.runRom(BANK_TEXT, DrawTextWindowFrame, { a: bus.u8(wClearStatusWindowId) });
    yield* P.runRom(BANK_TEXT, RenderProportionalTextAt, { hl: prompt, de: CLEAR_STATUS_TEXT_CELL });
    yield* P.runRom(BANK_TEXT, RedrawWindowRows, { a: bus.u8(wClearStatusWindowId) });
    return yield* menuChoice(P, menu, row);
  };
  const STEP_MODE = 0, STEP_FORMAT = 1, STEP_CLASS = 2, STEP_RANK = 3;
  let s = STEP_MODE;
  for (;;) {
    if (s === STEP_MODE) {
      const mode = yield* step(Text_34_232, Text_34_215, 1);
      bus.w8(wClearStatusMode, mode);
      if (mode === 0xFF) { bus.w8(wClearStatusResultCode, RESULT_CANCELLED); break; }
      if (mode) { bus.w8(wClearStatusResultCode, RESULT_MODE_1); break; }
      bus.w8(wClearStatusDoubles, testFlag(P, FLAG_DOUBLES) ? 1 : 0);
      s = STEP_FORMAT;
    } else if (s === STEP_FORMAT) {
      const format = yield* step(Text_34_228, Text_34_217, 3);
      bus.w8(wClearStatusFormat, format);
      s = format === 0xFF ? STEP_MODE : STEP_CLASS;
    } else if (s === STEP_CLASS) {
      const cls = yield* step(Text_34_229, Text_34_218, 5);
      bus.w8(wClearStatusClass, cls);
      s = cls === 0xFF ? STEP_FORMAT : STEP_RANK;
    } else {
      yield* P.runRom(BANK_TEXT, DrawTextWindowFrame, { a: bus.u8(wClearStatusWindowId) });
      yield* P.runRom(BANK_TEXT, RenderProportionalTextAt, { hl: (Text_34_230 + bus.u8(wClearStatusFormat)) & 0xFFFF, de: CLEAR_STATUS_TEXT_CELL });
      yield* P.runRom(BANK_TEXT, RedrawWindowRows, { a: bus.u8(wClearStatusWindowId) });
      let list = bus.u8(wClearStatusDoubles) ? RANK_LIST_DOUBLES : RANK_LIST_SINGLES;
      if (bus.u8(wClearStatusFormat)) list = (list + ((bus.u8(wClearStatusClass) + 1) & 0xFF)) & 0xFFFF;
      const rank = yield* menuChoice(P, list, 7);
      bus.w8(wClearStatusRank, rank);
      if (rank === 0xFF) { s = STEP_CLASS; continue; }
      applyClearStatusFlags(P);
      getClearStatusResultCode(P);
      break;
    }
  }
  const b = bus.u8(wClearStatusResultCode);
  P.wramBank(old);
  return b;
}
// a menu of text hl at (d, 0): created, drawn, run and closed; returns the choice ($FF: cancelled)
function* menuChoice(P, text, row) {
  yield* P.runRom(BANK_TEXT, CreateMenuWindowFromText, { hl: text, d: row, e: 0 });
  yield* P.runRom(BANK_TEXT, RestoreShadowTilemap);
  yield* P.runRom(BANK_TEXT, RenderMenuWindowText);
  const choice = (yield* P.runRom(BANK_TEXT, RunMenuSelection)).a;
  yield* P.runRom(BANK_TEXT, CloseWindow, { a: P.bus.u8(P.A.menuWindowId) });
  return choice;
}
// ClearBgTilemaps (0A:4D2C): with the LCD off, both screen planes blank (attributes 0, tiles $20), copied to the BG
// map. Returns the registers it leaves (EnableLCD's).
export function clearBgTilemaps(P) {
  P.callRom(0, DisableLCDSafely);
  P.wramBank(WRAM_COURT_PLANES);
  fillMemoryFast(P, 0, wScreenAttrmap, BG_CLEAR_SIZE);
  P.wramBank(WRAM_SCREEN);
  fillMemoryFast(P, BLANK_TILE, wShadowTilemap, BG_CLEAR_SIZE);
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap0, BG_MAP_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES);
  const r = queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, BG_MAP_BLOCKS);
  return P.callRom(0, EnableLCD, { ...r, a: r.a });
}
// FillMemoryFast (0A:4D77): bc bytes (0: 64 KB) at hl = a.
export function fillMemoryFast(P, a, hl, bc) {
  let n = bc || 0x10000;
  for (; n > 0; n--) { P.bus.w8(hl, a); hl = (hl + 1) & 0xFFFF; }
  return { a: 0, f: FZ, bc: 0, e: a & 0xFF, hl };
}
// ApplyClearStatusFlags (0A:4D80): for mode 0: FLAG_DOUBLES as chosen, the training court's flags for the class,
// and the ranking flags (singles, or doubles for a doubles story with a format). Returns the registers it leaves.
export function applyClearStatusFlags(P) {
  const { bus } = P;
  const mode = bus.u8(wClearStatusMode);
  if (mode) return { a: mode, f: 0 };
  clearFlagOp(P, flagOp(FLAG_DOUBLES));
  if (bus.u8(wClearStatusDoubles)) setFlagOp(P, flagOp(FLAG_DOUBLES));
  setTrainingCourtClearFlags(P);
  if (bus.u8(wClearStatusDoubles) && bus.u8(wClearStatusFormat)) return setDoublesRankingClearFlags(P);
  return setSinglesRankingClearFlags(P);
}
const flagOp = n => ((n >> 3) << 8 | (n & 7) << 5);
// SetTrainingCourtClearFlags (0A:4DA9): clear the 28 training-court flags from $1800, then set the level-1 list for
// class 1 and also the level-2 list for class 2. Returns the registers it leaves.
export function setTrainingCourtClearFlags(P) {
  const { bus } = P;
  let de = TRAINING_FLAGS_FIRST;
  for (let c = TRAINING_FLAGS; c > 0; c--) { clearFlagOp(P, de); de = (de + FLAG_STEP) & 0xFFFF; }
  const cls = bus.u8(wClearStatusClass);
  if (!cls) return { a: 0, f: FZ, c: 0, de, hl: de };
  let r = setFlagList(P, TrainingCourtLevel1ClearFlags_0a);
  if (bus.u8(wClearStatusClass) === 1) return { ...r, a: 1, f: FZ | FN, c: 0 };
  r = setFlagList(P, TrainingCourtLevel2ClearFlags_0a);
  return { ...r, a: 0xFF, f: FZ | FN, c: 0 };
}
// set every flag of a list of operand words ended by a high byte of $FF; returns { de, hl } at its end
function setFlagList(P, list) {
  let hl = list, de;
  for (;;) {
    de = P.rom.u16(BANK, hl); hl = (hl + 2) & 0xFFFF;
    if ((de >> 8) === 0xFF) return { de, hl };
    setFlagOp(P, de);
  }
}

export const HOOKS = [
  [BANK, 0x4931, hook(P => initStoryMatchSettings(P))],
  [BANK, 0x4962, hookGen(P => runStoryMatch(P))],
  [BANK, 0x4991, hookGen(P => restoreOverworldAfterMatch(P))],
  [BANK, 0x49AA, hook(P => assignStoryMatchCharacters(P))],
  [BANK, 0x4A41, hook((P, c) => setMatchDoublesMode(P, c.a))],
  [BANK, 0x4A4C, hook((P, c) => { P.V.matchOpponentChar = c.a; })],
  [BANK, 0x4A50, hook((P, c) => { P.V.currentlyUsedCourt = c.a; })],
  [BANK, 0x4A54, hook((P, c) => { P.V.matchTypeNumberOfSets = c.a; })],
  [BANK, 0x4A58, hook((P, c) => { P.V.matchTypeNumberOfGames = c.a; })],
  [BANK, 0x4A5C, hook(P => loadMatchSettingsFromTable(P))],
  [BANK, 0x4BAC, hookGen(function* (P) { return { a: yield* runClearStatusSetupMenu(P) }; })],
  [BANK, 0x4D2C, hook(P => clearBgTilemaps(P))],
  [BANK, 0x4D77, hook((P, c) => fillMemoryFast(P, c.a, c.hl, c.bc))],
  [BANK, 0x4D80, hook(P => applyClearStatusFlags(P))],
  [BANK, 0x4DA9, hook(P => setTrainingCourtClearFlags(P))],
];

// Bank $1b: the minigame level select's start (RunMinigameLevelSelect: the levels cleared counted from the save's
// flags, the level panel's graphics, then the two- or three-level panel of level_variants.js; returns the level, or
// $FF), the level's description and panel palette, and the unused debug screens and prompts that sit beside them:
// an unlock-flag toggler with bobbing flag sprites, a story-data confirm, the high-score confirm screen, the erase /
// continue / "is this correct" prompts, a game-timer row, the "no N64 data found" and trophies placeholder screens.
// The level select keeps its state in WRAM 2's wScreenAttrmap bytes: [0] the minigame, [1] the levels cleared
// (0-2), [2] the levels shown (CountClearedMinigameLevelsTable), [3] the level chosen.
// Port of src/engine/menus/minigame_select/level_select_1b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables, palettes and graphics are read
// from the ROM.
// Tests: lockstep on out/port/mg_*.mtrec and minigame_*.mtrec (the level select of each minigame, levels cleared or
// not) and out/port/ms_debug.mtrec (the unused screens, scripted by stub calls); web/tests/port/routines_menus_misc.mjs.
import {
  FZ, FAR, rom, romWait, wram, u8, w8, idx, ixF, sound, advanceFrame, registerFrameTask, unregisterFrameTask,
  enableLCD, fadeIn, fadeOut, beginFadeIn, waitFadeEnd, loadPaletteShadow, loadCompressedTileBlock, queueCopy,
  disableLCDSafely, hook, hookGen, nop, regs8, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, WRAM_SOUND,
  TILEMAP_WIDTH, TILE_SIZE, VRAM_BANK1, vTiles0, vBGMap0, wDecompBuffer, wShadowTilemap, wScreenAttrmap, PADF_A,
  PADF_B, SFX_MENU_SELECT, SFX_MENU_CANCEL, chain, nested, getRegs,
} from "../equipment/defs.js";
import { decompressData, decompressDataFromBank } from "../../home/decompress.js";
import { queueVRAMCopy } from "../../home/memory.js";
import { getMenuCursorIndex, queueSpriteRegs } from "../common/cursors.js";
import { runMinigameLevelSelect2, runMinigameLevelSelect3 } from "./level_variants.js";

export const BANK = 0x1B;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF), rw = (P, a) => P.rom.u16(BANK, a & 0xFFFF);
export const Unused_1b_DrawUnlockDebugFlagSprites = 0x6938, Unused_1b_StubNop_1b_09 = 0x69D6;
const UnlockDebugCursorGfx = 0x690A, UnlockDebugCursorPalette = 0x6930, UnlockDebugFlagSprites = 0x6968;
const CountClearedMinigameLevelsTable = 0x6C0E, ClearedMinigameLevelsTable = 0x6C11;
const MinigameLevelSelectGfxTable = 0x6D2D, MinigameLevelSelectTable = 0x6D35;
const MinigameLevelDescriptionTable = 0x6D8F, MinigameLevelSelectPalettePtrs = 0x6DA8;
const Text_30_194 = 0x00C2, LOCKED_LEVEL_DESCRIPTION = 0x00C5;
const Text_31_106 = 0x046A, Text_31_107 = 0x046B, Text_31_109 = 0x046D, Text_31_113 = 0x0471, Text_30_354 = 0x0162;
const Text_31_123 = 0x047B, Text_31_124 = 0x047C;
// the level select's state bytes in WRAM 2 (see the header)
export const LEVEL_MINIGAME = 0, LEVEL_CLEARED = 1, LEVEL_SHOWN = 2, LEVEL_CHOSEN = 3;
export const levelState = (P, i) => u8(P, wScreenAttrmap + i);
const setLevelState = (P, i, v) => w8(P, wScreenAttrmap + i, v);
const LEVEL_TWO_CLEARED = 2, LEVEL_COLUMNS = 3, LEVEL_DESCRIPTION_ROW = 16;
const UNLOCK_DEBUG_FIRST_CHAR = 0x1A, UNLOCK_DEBUG_LAST_CHAR = 0x1F, UNLOCK_DEBUG_FLAG_BASE = 0x18;   // CHAR_MARIO-PEACH
const UNLOCK_DEBUG_FLAGS = 6, FLAG_SPRITE_TILE = 0x50, FLAG_SPRITE_ATTR = 0x00;
const UNLOCK_DEBUG_CURSOR_BLOCKS = 0x02;
const PROMPT_ROW = 0xD9C1, PROMPT_ROW_2 = 0xDA01, TIMER_ROW = 0xDA00;
const TIMER_HOURS = 0xDA05, TIMER_MINUTES = 0xDA07, TIMER_SECONDS = 0xDA0A, TIMER_SEPARATOR = 0x3A, TIMER_PAD = 0x64;
const NAME_MARK_ABOVE = 0xFFDF, DAKUTEN = 0xDE, HANDAKUTEN = 0xDF, DAKUTEN_TILE = 0x0E, HANDAKUTEN_TILE = 0x0F;
const ROW17 = 17, BLANK = 0x20;
const TILEBLOCK_MinigameLevelSelectGfx0 = 0x70, TILEBLOCK_MinigameLevelSelectIconGfx = 0x71;
const TILEBLOCK_SharedMenuGfx111 = 0x6F, TILEBLOCK_MinigameLevelSelectGfx1 = 0x72, TILEBLOCK_SharedMenuGfx27 = 0x1B;
const TILEBLOCK_MinigameLevelSelectGfx2Alias16 = 0x77;
// bank $18's unused confirm-screen routines (menus/common), bank 5's text arguments and bank 3's save flags
const U18 = {
  RenderProportionalTextAt32: [0x18, 0x439A], WriteTilemapByteAdvance: [0x18, 0x43A6],
  DrawDecimalNumberToTilemap: [0x18, 0x43A9], InitConfirmScreen: [0x18, 0x52DE], StubNop_18_1: [0x18, 0x5379],
  ForceFlushBgMapToVram: [0x18, 0x5418], RunTwoOptionSelectB: [0x18, 0x5469], DrawYesNoLabels: [0x18, 0x5561],
  ApplySpriteBobOffset: [0x18, 0x5A6A],
};
const PushTextArgString = [0x05, 0x50F7], TestSaveFlag = [0x03, 0x4D86];

// ---- the unused unlock-flag debug screen ----
// Unused_1b_ToggleSelectedUnlockFlag (1B:68A4): the unlock flag (WRAM 6's wUnlockFlagsBlock) of the selected Mario-cast
// character toggled (SFX_MENU_SELECT); other characters are refused (SFX_MENU_CANCEL)
export function unusedToggleSelectedUnlockFlag(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCENE);
  const ch = P.V.charSelectChar;
  let hl = P.A.unlockFlagsBlock;
  if (ch < UNLOCK_DEBUG_FIRST_CHAR || ch > UNLOCK_DEBUG_LAST_CHAR) sound(P, SFX_MENU_CANCEL);
  else {
    hl = idx(hl, ch - UNLOCK_DEBUG_FLAG_BASE);
    w8(P, hl, u8(P, hl) ^ 1);
    sound(P, SFX_MENU_SELECT);
  }
  wram(P, bank);
  return { a: bank, hl, f: entryF };
}
// Unused_1b_LoadUnlockDebugCursorGfx (1B:68D6): the flag sprite's tiles and palette (OBJ 0); its frame task started
export function unusedLoadUnlockDebugCursorGfx(P) {
  const bank = P.V.wramBank;
  wram(P, WRAM_STAGING);
  decompressData(P, UnlockDebugCursorGfx, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x50 * TILE_SIZE, UNLOCK_DEBUG_CURSOR_BLOCKS);
  wram(P, bank);
  loadPaletteShadow(P, UnlockDebugCursorPalette, 8, 1);
  return registerFrameTask(P, 1, Unused_1b_DrawUnlockDebugFlagSprites);
}
// Unused_1b_DrawUnlockDebugFlagSprites (1B:6938), a frame task: a bobbing flag sprite for each of the six flags set
// (wUnlockFlagsBlock + 2 on), at its place in UnlockDebugFlagSprites
export function unusedDrawUnlockDebugFlagSprites(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank, r = getRegs(P.cpu);
  wram(P, WRAM_SCENE);
  let hl = (P.A.unlockFlagsBlock + 2) & 0xFFFF;
  for (let i = 0; i < UNLOCK_DEBUG_FLAGS; i++) {
    const set = u8(P, hl) & 1;
    hl = (hl + 1) & 0xFFFF;
    if (!set) continue;
    const at = idx(UnlockDebugFlagSprites, i * 2);
    chain(r, nested(P, 2, () => unusedQueueBobbingFlagSprite(P, rb(P, at) << 8 | rb(P, at + 1))));   // (push af, push af)
  }
  wram(P, bank);
  return { ...r, a: bank, hl, f: entryF };
}
// Unused_1b_QueueBobbingFlagSprite (1B:6974): the flag sprite at de, bobbing (bank $18's offset); hl kept
export function unusedQueueBobbingFlagSprite(P, de) {
  const r = nested(P, 1, () => regs8(rom(P, U18.ApplySpriteBobOffset, { de })));          // (push hl)
  const q = queueSpriteRegs(P, r, FLAG_SPRITE_TILE, FLAG_SPRITE_ATTR);
  return { ...r, b: FLAG_SPRITE_ATTR, c: FLAG_SPRITE_TILE, ...q, hl: undefined, h: undefined, l: undefined };
}

// ---- the unused confirm screens and prompts ----
// Unused_1b_RunStoryDataConfirmMenu (1B:6982): a two-option confirm (bank $18's) over the screen as it is, with a
// stub frame task; returns its choice
export function* unusedRunStoryDataConfirmMenu(P) {
  wram(P, WRAM_STAGING);
  yield* fadeOut(P, 32);
  disableLCDSafely(P);
  P.V.minigameHighScoreMode = 0;
  P.V.storyDataPromptFlag = 0;
  rom(P, U18.ForceFlushBgMapToVram);
  enableLCD(P);
  yield* fadeIn(P, 32);
  wram(P, WRAM_SOUND);
  w8(P, P.A.stubbedPromptTaskState, 0);
  w8(P, P.A.stubbedPromptTaskState + 1, 0x0C);
  registerFrameTask(P, 1, Unused_1b_StubNop_1b_09);
  const r = yield* romWait(P, U18.RunTwoOptionSelectB, { b: 1 });
  unregisterFrameTask(P, Unused_1b_StubNop_1b_09);
  return { a: r.a, f: r.f };
}
// Unused_1b_ShowHighScoreConfirmScreen (1B:69D9): bank $18's confirm screen, faded in. (Its wait `and a / jr nz`
// spins for ever when the fade's wait leaves a non-zero a: the ROM's own loop is run then.)
export function* unusedShowHighScoreConfirmScreen(P) {
  P.V.minigameHighScoreMode = 1;
  wram(P, WRAM_STAGING);
  yield* fadeOut(P, 32);
  disableLCDSafely(P);
  rom(P, U18.InitConfirmScreen);                                  // (then Unused_1b_StubNop_1b_10: nothing)
  rom(P, U18.ForceFlushBgMapToVram);
  enableLCD(P);
  beginFadeIn(P, 32);
  const r = yield* waitFadeEnd(P);
  if (r.a) yield* P.runRom(BANK, 0x6A03, regs8(r));               // .loop: never returns
  rom(P, U18.StubNop_18_1, { b: 0 });
  return yield* advanceFrame(P);
}
// a prompt: text hl at (1, 14) of the WRAM 2 confirm map (bank $18's 32-wide text), then the yes / no labels
function drawPrompt(P, text, de = PROMPT_ROW, regs = {}) {
  const r = rom(P, U18.RenderProportionalTextAt32, { ...regs, hl: text, de });
  return rom(P, U18.DrawYesNoLabels, regs8(r));
}
// Unused_1b_DrawErasePrompt (1B:6A0F): the player's name as the text argument and drawn (with its marks), then
// "erase?" and yes / no
export function unusedDrawErasePrompt(P) {
  const r = rom(P, PushTextArgString, { hl: P.A.player1MainName });
  const c = unusedCopyMainCharNameWithDiacritics(P, PROMPT_ROW);
  return drawPrompt(P, Text_31_106, c.de, { ...regs8(r), ...c });
}
// Unused_1b_DrawContinuePrompt (1B:6A25) / DrawEraseConfirmPrompt (1B:6A32) / DrawIsThisCorrectPrompt (1B:6A3F)
export const unusedDrawContinuePrompt = P => drawPrompt(P, Text_31_109);
export const unusedDrawEraseConfirmPrompt = P => drawPrompt(P, Text_31_107);
export const unusedDrawIsThisCorrectPrompt = P => drawPrompt(P, Text_31_113);
// Unused_1b_DrawCharAndItemDataPrompt (1B:6A4C): the same line twice, on rows 14 and 16
export function unusedDrawCharAndItemDataPrompt(P) {
  rom(P, U18.RenderProportionalTextAt32, { hl: Text_30_354, de: PROMPT_ROW });
  return rom(P, U18.RenderProportionalTextAt32, { hl: Text_30_354, de: PROMPT_ROW_2 });
}
// Unused_1b_DrawGameTimerRow (1B:6A5F): the play time (hours, then minutes and seconds as 3 digits of 100 + n, their
// "1" overwritten by ':') in the confirm map's row 16, queued
export function unusedDrawGameTimerRow(P) {
  const t = P.A.gameTimer;
  rom(P, U18.DrawDecimalNumberToTilemap, { hl: u8(P, t + 3), a: 2, de: TIMER_HOURS });
  rom(P, U18.DrawDecimalNumberToTilemap, { hl: (u8(P, t + 2) + TIMER_PAD) & 0xFF, a: 3, de: TIMER_MINUTES });
  rom(P, U18.DrawDecimalNumberToTilemap, { hl: (u8(P, t + 1) + TIMER_PAD) & 0xFF, a: 3, de: TIMER_SECONDS });
  rom(P, U18.WriteTilemapByteAdvance, { a: TIMER_SEPARATOR, de: TIMER_MINUTES });
  rom(P, U18.WriteTilemapByteAdvance, { a: TIMER_SEPARATOR, de: TIMER_SECONDS });
  return unusedQueueStoryInfoRowToVram(P);
}
// Unused_1b_QueueStoryInfoRowToVram (1B:6AA1): the confirm map's row 16 (its first 16 cells) queued
export const unusedQueueStoryInfoRowToVram = P => queueCopy(P, TIMER_ROW, vBGMap0 + 16 * TILEMAP_WIDTH, 1);
// Unused_1b_CopyMainCharNameWithDiacritics (1B:6AAE): the main character's name at de, its marks ($DE / $DF) as
// tiles $0E / $0F in the cell above and left of the letter after (de - 33)
export function unusedCopyMainCharNameWithDiacritics(P, de) {
  let hl = P.A.storyModeNameOfMainCharacter, b;
  for (;;) {
    const ch = u8(P, hl);
    hl = (hl + 1) & 0xFFFF;
    if (!ch) return { a: 0, b, de, hl, f: FZ | 0x20 };
    if (ch === DAKUTEN || ch === HANDAKUTEN) w8(P, (de + NAME_MARK_ABOVE) & 0xFFFF, ch === DAKUTEN ? DAKUTEN_TILE : HANDAKUTEN_TILE);
    else { b = ch; w8(P, de, ch); de = (de + 1) & 0xFFFF; }
  }
}
// a placeholder screen: faded out, the screen flushed as it is (the caller's drawing in between), faded in; until A
// or B (SFX_MENU_SELECT)
function* showPlaceholderScreen(P, draw) {
  wram(P, WRAM_STAGING);
  yield* fadeOut(P, 32);
  disableLCDSafely(P);
  draw();
  rom(P, U18.ForceFlushBgMapToVram);
  enableLCD(P);
  yield* fadeIn(P, 32);
  while (!(P.V.inputRisingEdge & (PADF_A | PADF_B))) yield* advanceFrame(P);
  sound(P, SFX_MENU_SELECT);
}
// Unused_1b_ShowNoN64DataFoundScreen (1B:6ADE): rows 6-14 of the text buffer's map blanked (their attributes 0),
// the two lines of the message
export function* unusedShowNoN64DataFoundScreen(P) {
  const wTextTileBuffer = 0xD800;
  yield* showPlaceholderScreen(P, () => {
    for (const row of [6, 8, 10, 12, 14]) unusedFillTilemapRow17(P, BLANK, wTextTileBuffer + row * TILE_SIZE + 2);
    for (const row of [70, 72, 74, 76, 78]) unusedFillTilemapRow17(P, 0x00, wTextTileBuffer + row * TILE_SIZE + 2);
    rom(P, U18.RenderProportionalTextAt32, { hl: Text_31_123, de: wTextTileBuffer + 8 * TILE_SIZE + 3 });
    rom(P, U18.RenderProportionalTextAt32, { hl: Text_31_124, de: wTextTileBuffer + 12 * TILE_SIZE + 3 });
  });
}
// Unused_1b_FillTilemapRow17 (1B:6B5D): 17 bytes of a at hl (hl after them)
export function unusedFillTilemapRow17(P, a, hl) {
  for (let i = 0; i < ROW17; i++) { w8(P, hl, a); hl = (hl + 1) & 0xFFFF; }
  return { hl };
}
// Unused_1b_ShowTrophiesPlaceholderScreen (1B:6B6F): the screen as it is
export function* unusedShowTrophiesPlaceholderScreen(P) { yield* showPlaceholderScreen(P, () => {}); }

// ---- the level select ----
// RunMinigameLevelSelect (1B:6B9C), slot $4028: minigame c's level select (see the header); returns the level
export function* runMinigameLevelSelect(P, minigame, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_COURT_PLANES);
  setLevelState(P, LEVEL_MINIGAME, minigame);
  setLevelState(P, LEVEL_CLEARED, 0);
  countClearedMinigameLevels(P);
  yield* loadMinigameLevelSelectGfx(P);
  if (levelState(P, LEVEL_CLEARED) === LEVEL_TWO_CLEARED) yield* runMinigameLevelSelect3(P);
  else yield* runMinigameLevelSelect2(P);
  wram(P, WRAM_COURT_PLANES);
  const level = levelState(P, LEVEL_CHOSEN);
  wram(P, bank);
  return { a: level, c: level, f: entryF };
}
// CountClearedMinigameLevels (1B:6BD3): the minigame's two "level cleared" save flags counted (WRAM 2 mapped)
export function countClearedMinigameLevels(P) {
  let c = 0;
  const flags = rw(P, idx(ClearedMinigameLevelsTable, levelState(P, LEVEL_MINIGAME) * 2));
  if (!(rom(P, TestSaveFlag, { de: rw(P, flags) }).f & FZ)) c++;
  const de = rw(P, flags + 2), second = rom(P, TestSaveFlag, { de });
  if (!(second.f & FZ)) c++;
  setLevelState(P, LEVEL_CLEARED, c);
  const { hl, f } = ixF(CountClearedMinigameLevelsTable, c);
  const a = rb(P, hl);
  setLevelState(P, LEVEL_SHOWN, a);
  return { a, b: second.b, c, de, hl, f };
}
// LoadMinigameLevelSelectGfx (1B:6C59): the level labels (3 when a level is cleared, else 4; a frame each), the
// panel's tiles (the second set by the levels cleared), the cursor palette
export function* loadMinigameLevelSelectGfx(P, entryF = P.cpu.f) {
  const bank = P.V.wramBank;
  wram(P, WRAM_STAGING);
  const cleared = () => P.withWramBank(WRAM_COURT_PLANES, () => levelState(P, LEVEL_CLEARED));
  for (let c = 0; ; ) {
    const slot = rw(P, MinigameLevelSelectGfxTable + 2 * c);
    decompressDataFromBank(P, slot >> 8, slot & 0xFF, wDecompBuffer);
    queueVRAMCopy(P, wDecompBuffer, rw(P, MinigameLevelSelectTable + 2 * c), 16);
    c++;
    yield* advanceFrame(P);
    if (c === (cleared() ? 3 : 4)) break;
  }
  loadCompressedTileBlock(P, TILEBLOCK_MinigameLevelSelectGfx0, vTiles0 + VRAM_BANK1, 0x10);
  yield* advanceFrame(P);
  loadCompressedTileBlock(P, cleared() ? TILEBLOCK_MinigameLevelSelectIconGfx : TILEBLOCK_SharedMenuGfx111, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1, 0x10);
  yield* advanceFrame(P);
  loadCompressedTileBlock(P, TILEBLOCK_MinigameLevelSelectGfx1, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1, 0x10);
  yield* advanceFrame(P);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx27, vTiles0 + 0x70 * TILE_SIZE + VRAM_BANK1, 0x04);
  yield* advanceFrame(P);
  loadCompressedTileBlock(P, TILEBLOCK_MinigameLevelSelectGfx2Alias16, vTiles0, 0x14);
  yield* advanceFrame(P);
  const r = rom(P, FAR.LoadIndexedPalette, { b: 0x08, c: 0x10 });
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// DrawMinigameLevelDescription (1B:6D3D): the hovered level's description (Text_30_194 + level), or, with no level
// cleared, the locked text over the second level
export function drawMinigameLevelDescription(P, entryF = P.cpu.f, entry = getRegs(P.cpu)) {
  const bank = P.V.wramBank, regs = { ...entry, c: LEVEL_COLUMNS };
  wram(P, WRAM_COURT_PLANES);
  let r;
  const far = x => nested(P, 1, () => rom(P, FAR.RenderTextToBuffer64, x));      // (push af)
  if (!levelState(P, LEVEL_CLEARED) && chain(regs, getMenuCursorIndex(P, LEVEL_COLUMNS)).a === 1) {
    wram(P, WRAM_SCREEN);
    r = far({ ...regs, a: WRAM_SCREEN, hl: LOCKED_LEVEL_DESCRIPTION, de: wShadowTilemap + LEVEL_DESCRIPTION_ROW * TILEMAP_WIDTH + 1, c: 0x20 });
  } else {
    wram(P, WRAM_SCREEN);
    chain(regs, getMenuCursorIndex(P, LEVEL_COLUMNS));
    const level = regs.a, hl = idx(Text_30_194, level);
    r = far({ ...regs, a: hl & 0xFF, b: level, hl, de: rw(P, idx(MinigameLevelDescriptionTable, level * 2)), c: 0x20 });
  }
  wram(P, bank);
  return { ...r, a: bank, f: entryF };
}
// LoadMinigameLevelSelectPalette (1B:6D95): BG palette 4 from level a's entry of MinigameLevelSelectPalettePtrs
export function loadMinigameLevelSelectPalette(P, level) {
  return loadPaletteShadow(P, rw(P, idx(MinigameLevelSelectPalettePtrs, level * 2)), 4, 1);
}

export const HOOKS = [
  [BANK, 0x68A4, hook((P, c) => unusedToggleSelectedUnlockFlag(P, c.f))],
  [BANK, 0x68D6, hook(P => unusedLoadUnlockDebugCursorGfx(P))],
  [BANK, 0x6938, hook((P, c) => unusedDrawUnlockDebugFlagSprites(P, c.f))],
  [BANK, 0x6974, hook((P, c) => unusedQueueBobbingFlagSprite(P, c.de))],
  [BANK, 0x6982, hookGen(P => unusedRunStoryDataConfirmMenu(P))],
  [BANK, 0x69D6, nop],                                              // Unused_1b_StubNop_1b_09
  [BANK, 0x69D7, nop],                                              // Unused_1b_StubRet1
  [BANK, 0x69D8, nop],                                              // Unused_1b_StubRet2
  [BANK, 0x69D9, hookGen(P => unusedShowHighScoreConfirmScreen(P))],
  [BANK, 0x6A0F, hook(P => unusedDrawErasePrompt(P))],
  [BANK, 0x6A25, hook(P => unusedDrawContinuePrompt(P))],
  [BANK, 0x6A32, hook(P => unusedDrawEraseConfirmPrompt(P))],
  [BANK, 0x6A3F, hook(P => unusedDrawIsThisCorrectPrompt(P))],
  [BANK, 0x6A4C, hook(P => unusedDrawCharAndItemDataPrompt(P))],
  [BANK, 0x6A5F, hook(P => unusedDrawGameTimerRow(P))],
  [BANK, 0x6AA1, hook(P => unusedQueueStoryInfoRowToVram(P))],
  [BANK, 0x6AAD, nop],                                              // Unused_1b_StubNop_1b_10
  [BANK, 0x6AAE, hook((P, c) => unusedCopyMainCharNameWithDiacritics(P, c.de))],
  [BANK, 0x6ADE, hookGen(P => unusedShowNoN64DataFoundScreen(P))],
  [BANK, 0x6B5D, hook((P, c) => unusedFillTilemapRow17(P, c.a, c.hl))],
  [BANK, 0x6B6F, hookGen(P => unusedShowTrophiesPlaceholderScreen(P))],
  [BANK, 0x6B9C, hookGen((P, c) => runMinigameLevelSelect(P, c.c, c.f))],
  [BANK, 0x6BD3, hook(P => countClearedMinigameLevels(P))],
  [BANK, 0x6C59, hookGen((P, c) => loadMinigameLevelSelectGfx(P, c.f))],
  [BANK, 0x6D3D, hook((P, c) => drawMinigameLevelDescription(P, c.f))],
  [BANK, 0x6D95, hook((P, c) => loadMinigameLevelSelectPalette(P, c.a))],
];

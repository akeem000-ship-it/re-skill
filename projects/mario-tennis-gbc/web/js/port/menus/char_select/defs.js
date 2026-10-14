// Shared pieces of the character-select and character-data menu ports (web/js/port/menus/char_select and
// char_data): constants, RAM names, the routines of other parts of the game these menus call, and the hook adapters.
// Names, addresses and constants from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm); the values of its generated constants (screen assets, tile blocks, decoded sizes) are
// the operands of the ROM's own instructions.
//
// Calls. A routine here calls
//   - verified ports directly (home/*, audio, save), inside far(P, bank, ...) when the ROM reaches them with a farcall,
//     since FarCall maps the callee's bank (hRomBank and the MBC: the VRAM copy queue and the frame tasks note it);
//   - its own routines directly (far ones inside far());
//   - anything else (the menu library, text, characters, link) through its ROM address: rom() / P.callRom, or
//     yield* P.runRom for code that waits. Those run the ported JS where other parts hooked it.
// Waiting routines are generators (`yield* advanceFrame(P)`); the lockstep test does not need the ROM's stack.
// RAM is read and written through the WRAM bank mapped at the time (P.bus), as the ROM does: these menus switch
// banks constantly and several names share addresses in different banks.
import { queueVRAMCopy, copyMemoryFast, copyMemoryBC } from "../../home/memory.js";
import { queueSprite } from "../../home/fade.js";
import { registerFrameTask as homeRegisterFrameTask, unregisterFrameTask as homeUnregisterFrameTask, beginFadeOut,
  beginFadeIn, waitFadeEnd as homeWaitFadeEnd } from "../../home/colorfade.js";
import { advanceFrame as homeAdvanceFrame, waitFrames as homeWaitFrames } from "../../home/frame.js";
import { formatDecimalNumberUnsigned } from "../../home/debugtext.js";
import { testGameFlag, setGameFlag, clearGameFlag, flagOperand } from "../../home/flags.js";
import { playSoundManaged } from "../../audio/requests.js";
import { getRegs, setRegs } from "../../home/cpu.js";

export { queueVRAMCopy, copyMemoryFast, copyMemoryBC, queueSprite, formatDecimalNumberUnsigned, beginFadeOut, beginFadeIn };

// ---- flags ----
export const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;
export const orFlags = v => ((v & 0xFF) === 0 ? FZ : 0);
export const cpFlags = (a, n) => ((a & 0xFF) === (n & 0xFF) ? FZ : 0) | FN | ((a & 0xF) < (n & 0xF) ? FH : 0) | ((a & 0xFF) < (n & 0xFF) ? FC : 0);

// ---- constants (include/constants/*.inc, include/hardware.inc) ----
export const WRAM_STAGING = 1, WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5, WRAM_SCENE = 6;
export const WRAM_SOUND = 7;
export const WRAM_CHAR0 = 4, WRAM_CHAR1 = 5, WRAM_CHAR2 = 6, WRAM_CHAR3 = 7;   // the on-court characters' structs
export const TILE_SIZE = 16, TILEMAP_WIDTH = 32, SCREEN_HEIGHT = 18;
export const VRAM_BANK1 = 0x2000;
export const vTiles0 = 0x8000, vTiles1 = 0x8800, vTiles2 = 0x9000, vBGMap0 = 0x9800;
export const OAM_BANK1 = 0x08, OAM_XFLIP = 0x20;
export const PADF_A = 0x01, PADF_B = 0x02, PADF_SELECT = 0x04, PADF_START = 0x08;
export const PADF_RIGHT = 0x10, PADF_LEFT = 0x20, PADF_UP = 0x40, PADF_DOWN = 0x80;
export const rWY = 0xFF4A, rIE = 0xFFFF, IE_TIMER = 0x04;
export const BGM_NONE = 0x00, BGM_MENU = 0x03, BGM_STATUS_SCREEN = 0x04, BGM_EXP_DISTRIBUTION = 0x0C;
export const BGM_STAT_DISTRIBUTION = 0x0D, BGM_COURT_WAREHOUSE = 0x14;
export const SFX_STOP = 0x50, SFX_MENU_MOVE = 0x5E, SFX_MENU_SELECT = 0x5F, SFX_MENU_CANCEL = 0x62;
export const CHAR_ALEX = 0x00, CHAR_NINA = 0x01, CHAR_HARRY = 0x02, CHAR_KATE = 0x03;
export const CHAR_NONE = 0xFF, CHAR_STORY_MAIN = 0x80;
export const STORYSLOT_NONE = 0x03;
export const CHARANIM_STAND = 0x00, CHARANIM_FOREHAND = 0x05, CHARANIM_OVERHEAD = 0x07;
export const LINKSTATE_MASTER = 1;
export const CHARSELECTMODE_EXHIBITION_SINGLES = 0, CHARSELECTMODE_EXHIBITION_DOUBLES = 1;
export const CHARSELECTMODE_LINK_SINGLES_P1 = 2, CHARSELECTMODE_LINK_SINGLES_P2 = 3;
export const CHARSELECTMODE_LINK_DOUBLES_P1 = 4, CHARSELECTMODE_LINK_DOUBLES_P2 = 5;
export const SAVEFLAG_OPENING_SEEN = 0x0120;
export const FLAG_CHAR_DATA_START_EXITS = flagOperand(28);   // wGameFlags byte 3 bit 4
export const CHAR_RECORD_SIZE = 0x40;                         // a story character record ($C900 main, $C940 partner)
// tile blocks of the menu library (TileBlockPtrs_39) and their decoded sizes in 16-byte blocks
export const TILEBLOCK_SharedMenuGfx17Alias17 = 0x11, SharedMenuGfx17_BLOCKS = 0x10;
export const TILEBLOCK_NameEntryGfx = 0x12, NameEntryGfx_BLOCKS = 0x02;
export const TILEBLOCK_CharacterSelectGfx = 0x13, CharacterSelectGfx_BLOCKS = 0x04;
export const TILEBLOCK_StatLabelTiles = 0x15, StatLabelTiles_BLOCKS = 0x10;
export const TILEBLOCK_SharedMenuGfx72 = 0x48, SharedMenuGfx72_BLOCKS = 0x14;
export const TILEBLOCK_CharGridGfx1 = 0x64, CharGridGfx1_BLOCKS = 0x14;
export const TILEBLOCK_CharGridGfx2 = 0x75, CharGridGfx2_BLOCKS = 0x14;
export const TILEBLOCK_DigitFontTiles = 0x79, DigitFontTiles_BLOCKS = 0x14;
export const SCREENASSET_MatchTypeMenu = 0x00, SCREENASSET_ExhibitionSetup = 0x01, SCREENASSET_CharacterSelect = 0x05;
export const SCREENASSET_NameEntry = 0x06;
// text ids (include/text_ids.inc)
export const Text_30_27 = 0x001B, Text_30_117 = 0x0075, Text_30_118 = 0x0076, Text_30_119 = 0x0077;
export const Text_30_132 = 0x0084, Text_30_149 = 0x0095, Text_30_153 = 0x0099, Text_31_123 = 0x047B;

// ---- RAM buffers (ram/*.asm, include/ram_mirrored.inc) ----
export const wDecompBuffer = 0xD000, wTextTileBuffer = 0xD800, wTextTileBuffer_SIZE = 0x800;   // WRAM 1
export const wScreenAttrmap = 0xD000;                                                          // WRAM 2
export const wShadowTilemap = 0xD000, wShadowAttrmap = 0xD400, wScreenScratch = 0xD800;        // WRAM 3
export const wCharDataScreenCell = 0xD000, wCharDataPagePlane = 0xD400, wCharDataScreenBackup = 0xD430;
export const wCharDataPageSlot1 = 0xD7E0, wCharDataPageSlot2 = 0xDA20, wCharDataPageSlot3 = 0xDC60;
// the on-court character struct (WRAM 4-7, one bank per character)
export const wCharPosX = 0xDF00, wCharSpriteFrame = 0xDF1B, wCharFacingOctant = 0xDF32, wCharTileBase = 0xDF36;
export const wCharScreenX = 0xDF53, wCharScreenY = 0xDF54, wCharSpriteSlot = 0xDF80;
export const wStoryModeNameOfMainCharacter = 0xC900, wStorySlotData = 0xC800;
export const wCharGridEntries_SIZE = 0x80, wCharUnlockFlags_SIZE = 0x28, wCreatedCharRecords_SIZE = 0xC0;
export const wNameEntryBuffer_SIZE = 0x0B, wCharSelectRoster_SIZE = 0x80, wCharDataEditBackup_SIZE = 6;
export const wCharDataChoiceBackup_SIZE = 0x65, wCharStatPageShown_SIZE = 6, wCharDataNumberBuffer_SIZE = 6;

// ---- RAM through the mapped banks ----
// A(P, name): a variable's address; rd/wr: a byte at name (+ offset) through the WRAM bank mapped now
export const A = (P, name) => { const a = P.A[name]; if (a === undefined) throw new Error(`no RAM name ${name}`); return a; };
export const rd = (P, name, off = 0) => P.bus.u8((A(P, name) + off) & 0xFFFF);
export const wr = (P, name, v, off = 0) => P.bus.w8((A(P, name) + off) & 0xFFFF, v & 0xFF);
export const rd16 = (P, name, off = 0) => P.bus.u16((A(P, name) + off) & 0xFFFF);
export const wr16 = (P, name, v, off = 0) => P.bus.w16((A(P, name) + off) & 0xFFFF, v & 0xFFFF);
export const u8 = (P, addr) => P.bus.u8(addr & 0xFFFF);
export const w8 = (P, addr, v) => P.bus.w8(addr & 0xFFFF, v & 0xFF);
// the ROM's table index: hl = table + a (8-bit add, carry into h)
export const idx = (table, a) => (table + (a & 0xFF)) & 0xFFFF;
// a story character's record field: `ld hl, wStoryModeNameOfMainCharacter / (slot: ld l, $40) / add offset`
export const storyField = (slot, offset) => ((slot ? 0xC940 : 0xC900) + offset) & 0xFFFF;

// ---- banks ----
const rROMB0 = 0x2000;
export function setRomBank(P, bank) { P.V.romBank = bank; P.bus.w8(rROMB0, bank); }
// a farcall into code ported here (or a verified port) that does not wait: the callee's bank mapped meanwhile
export function far(P, bank, fn) {
  const old = P.V.romBank;
  if (old === bank) return fn();
  setRomBank(P, bank);
  try { return fn(); } finally { setRomBank(P, old); }
}
// the same for a routine that waits
export function* farGen(P, bank, gen) {
  const old = P.V.romBank;
  setRomBank(P, bank);
  try { return yield* gen; } finally { setRomBank(P, old); }
}
// wram_bank b (hWramBank and rSVBK)
export const wram = (P, b) => P.wramBank(b);
// push_wram_bank b ... pop_wram_bank around fn (fn may be a generator function: then use withWramGen)
export function withWram(P, b, fn) {
  const old = P.V.wramBank;
  P.wramBank(b);
  const r = fn();
  P.wramBank(old);
  return r;
}
export function* withWramGen(P, b, gen) {
  const old = P.V.wramBank;
  P.wramBank(b);
  const r = yield* gen;
  P.wramBank(old);
  return r;
}

// ---- the ROM's routines, by address ----
export const HOME = {
  ClearMemory16: 0x03AF, DisableLCDSafely: 0x0346, EnableTimerInterrupt: 0x2A0E, JumpSoftReset: 0x285D,
  ResetSerialState: 0x28F8, WaitVBlank: 0x2814, TestGameFlag: 0x249F, PrintDecimalByte: 0x1AE4,
};
export const FAR = {
  // bank 1 / 2 / 3 / 4 / 5
  LoadMenuFontGfx: [0x01, 0x50E2], InitCa00RecordFromCharId: [0x02, 0x4066], GetCharPaletteIndex: [0x02, 0x4173],
  InitStoryModeState: [0x02, 0x421C], RollStoryRandomByte: [0x02, 0x434E], InitPlayerRecordFromTemplate: [0x02, 0x43A3],
  RefreshPlayerStatsAndGetPtr: [0x02, 0x4485], RefreshMainCharacterStats: [0x02, 0x478F],
  RecomputeStatsWithoutRacket: [0x02, 0x47C6], LevelUpPlayer: [0x02, 0x49BE], ComputeLevelUpStatDeltas: [0x02, 0x4A00],
  AddPlayerExp: [0x02, 0x4D8F], HasReachedNextLevelExp: [0x02, 0x4D99], GetExpRemainingToNextLevel: [0x02, 0x4DC8],
  GetExpProgressInCurrentLevel: [0x02, 0x4E02], GetExpRequiredForLevel: [0x02, 0x4E3A],
  Unused_02_ValidateN64TransferRecord: [0x02, 0x4044],
  CheckStorySlot: [0x03, 0x4D64], TestSaveFlag: [0x03, 0x4D86], SaveStorySlotWithTimer: [0x03, 0x4D10],
  EraseStorySlotSaveData: [0x03, 0x4E13], ReinitSaveRamPreservingBlock6: [0x03, 0x4F7D],
  InitActorEngine: [0x04, 0x4041],
  RenderProportionalTextAt: [0x05, 0x5DB3], RenderTextToBuffer64: [0x05, 0x5F52], ResetTextWindowState: [0x05, 0x6E09],
  CreateWindowFromScreenRect: [0x05, 0x6E45], DrawTextWindowFrame: [0x05, 0x6F70], RedrawWindowRows: [0x05, 0x7205],
  PrepareGlyphBuffer: [0x05, 0x72DC], UploadGlyphBuffer: [0x05, 0x7792],
  // bank 7 (link) / 8 (characters)
  SyncLinkFrame: [0x07, 0x4747], RunLinkInputFrame: [0x07, 0x4833], ResyncLinkSession: [0x07, 0x4A51],
  RunLinkCommandFrame: [0x07, 0x4BF3],
  InitDefaultMatchSettings: [0x08, 0x4070], ResetMatchState: [0x08, 0x40AB], DrawCharSprite: [0x08, 0x650A],
  InitChar: [0x08, 0x684A], ReloadCharFrameGfx: [0x08, 0x69C2], SetCharAnimation: [0x08, 0x69EA],
  EaseCharFacing: [0x08, 0x75C0], ReloadCharFacingTiles: [0x08, 0x7621], BuildCharSpriteSlots: [0x08, 0x7672],
  StepCharAnimation: [0x08, 0x7791],
  // bank $18 / $1a / $1b / $1d / $1e (menus)
  LoadIndexedPalette_18: [0x18, 0x4339], LoadMenuHandCursorGfx: [0x18, 0x437C], Unused_18_RenderProportionalTextAt32: [0x18, 0x439A],
  Unused_18_DrawBox: [0x18, 0x43C8], Unused_18_FindRosterEntry: [0x18, 0x44EF], LoadCharacterRecordToBuffer: [0x18, 0x4507],
  CheckCharacterUnlocked: [0x18, 0x452A], Unused_18_MoveGridCursor: [0x18, 0x45CA],
  Unused_18_InitPlayerRecordForCharacter: [0x18, 0x463B], Unused_18_LoadCharSelectCursorGfx: [0x18, 0x59C1],
  Unused_18_DrawCharSelectCursor: [0x18, 0x59D6], LoadOnCourtCharTilesA: [0x18, 0x5AB9],
  Unused_1a_ShowExpGainScreen: [0x1A, 0x44D8],
  Unused_1b_ResetMugshotPalettes: [0x1B, 0x4E0D], Unused_1b_SetMugshotAttrs: [0x1B, 0x4E18],
  LoadCharMugshotToBuffer: [0x1B, 0x4E37], Unused_1b_StubNop_1b_01: [0x1B, 0x4E43], CopyMugshotBufferToVram: [0x1B, 0x4E46],
  LoadIndexedPaletteThunk: [0x1B, 0x4E58], DecompressCharMugshot: [0x1B, 0x4E5C],
  Unused_1b_RunLevelUpStatusTrophiesMenu: [0x1B, 0x6467], Unused_1b_RunDebugSaveDataMenu: [0x1B, 0x64B9],
  Unused_1b_RunMinigameFlagsDebugScreen: [0x1B, 0x671C], Unused_1b_StubNop_1b_09: [0x1B, 0x69D6],
  Unused_1b_ShowNoN64DataFoundScreen: [0x1B, 0x6ADE], Unused_1b_ShowTrophiesPlaceholderScreen: [0x1B, 0x6B6F],
  RunExpDistributionLoop: [0x1D, 0x6F3E], UpdateExpScreenSelectionPalettes: [0x1D, 0x7189],
  GrayscalePaletteColorInPlace: [0x1D, 0x7205], ClearPendingExpAwards: [0x1D, 0x7CAE], SetPendingExpAward: [0x1D, 0x7CC6],
  ShowMatchResultsScreen: [0x1E, 0x400E],
  // bank $38 (the common menu code and the link screens around the character grid)
  DrawSelectedOptionBox: [0x38, 0x4018], ApplySpriteBobOffsetX: [0x38, 0x407B], ApplySpriteBobOffsetY: [0x38, 0x40A5],
  Unused_38_DrawCornerBrackets: [0x38, 0x40CF], MoveMenuCursorGrid_38: [0x38, 0x410A],
  Unused_38_MoveMenuCursorGridFromLinkInput: [0x38, 0x4188], GetMenuCursorIndex_38: [0x38, 0x4399],
  SetMenuCursorFromIndex_38: [0x38, 0x43BB], StoreRemoteCpuDifficulty: [0x38, 0x6609],
  ApplyRemoteCharSelection: [0x38, 0x661E], ApplyRemoteCharCancel: [0x38, 0x6655], CheckLinkSelectionComplete: [0x38, 0x66E9],
  HandleLinkGridButtons: [0x38, 0x6720], DrawRemoteSlotPortrait: [0x38, 0x688D], InitLinkMatchCharsFromSelection: [0x38, 0x6A7F],
  DrawEnteredName: [0x38, 0x728F], AppendCharToName: [0x38, 0x72B3], DeleteLastNameChar: [0x38, 0x7341],
  DrawNameEntryUnderlineSprites: [0x38, 0x7385], TrimTrailingSpacesFromName: [0x38, 0x73AE],
  GetActiveStoryNameBuffer: [0x38, 0x73FA],
  // bank $39 (the menu library)
  LoadScreenAssetRecord: [0x39, 0x407E], QueueWram3MapToVRAM: [0x39, 0x4325], UpdateAnimatedTiles: [0x39, 0x4342],
  LoadFixedTileBlockAndPalette: [0x39, 0x44D3], CopyTilemapRect: [0x39, 0x4530], FillTilemapRect: [0x39, 0x4558],
  LoadIndexedPalette: [0x39, 0x457F], LoadCompressedTileBlock: [0x39, 0x468B], ApplySpriteWaveOffset: [0x39, 0x4A75],
  InitMenuBgScroll: [0x39, 0x4B13], LoadMenuSpritePalettePair: [0x39, 0x4B3A], TickMenuBgScroll: [0x39, 0x4B6D],
};
// a call (or farcall) of a routine that is the ROM's or another part's: through its address (P.callRom maps its bank
// and sets hRomBank, and puts the caller's back afterwards, as FarCall does). Returns the registers it leaves.
export const rom = (P, [bank, addr], regs = {}) => P.callRom(bank, addr, regs);
export const home = (P, addr, regs = {}) => P.callRom(0, addr, regs);
export function* romWait(P, [bank, addr], regs = {}) { return yield* P.runRom(bank, addr, regs); }
// the far routines used most, with their arguments by name
export const fillTilemapRect = (P, de, w, h, value) => rom(P, FAR.FillTilemapRect, { de, b: w, c: h, h: value });
export const copyTilemapRect = (P, hl, de, w, h) => rom(P, FAR.CopyTilemapRect, { hl, de, b: w, c: h });
export const loadIndexedPalette = (P, slot, index) => rom(P, FAR.LoadIndexedPalette, { b: slot, c: index });
export const loadCompressedTileBlock = (P, block, dest, blocks) => rom(P, FAR.LoadCompressedTileBlock, { b: block, c: blocks, de: dest });
export const loadScreenAssetRecord = (P, asset) => rom(P, FAR.LoadScreenAssetRecord, { c: asset });
export const queueWram3MapToVRAM = P => rom(P, FAR.QueueWram3MapToVRAM);
export const renderTextToBuffer64 = (P, text, de, c = 0x20) => rom(P, FAR.RenderTextToBuffer64, { hl: text, de, c });
export const getMenuCursorIndex = (P, cols) => rom(P, FAR.GetMenuCursorIndex_38, { c: cols }).a;
export const setMenuCursorFromIndex = (P, cols, index) => rom(P, FAR.SetMenuCursorFromIndex_38, { b: cols, c: index });
export const drawSelectedOptionBox = (P, de, bc) => rom(P, FAR.DrawSelectedOptionBox, { de, bc });
export const disableLCDSafely = P => home(P, HOME.DisableLCDSafely);
// a text window over a screen rect (rect_cell x, y / rect_size w, h, then CreateWindowFromScreenRect,
// DrawTextWindowFrame, RedrawWindowRows)
export function drawTextWindow(P, x, y, w, h) {
  rom(P, FAR.CreateWindowFromScreenRect, { d: x, e: y, b: w, c: h });
  rom(P, FAR.DrawTextWindowFrame);
  rom(P, FAR.RedrawWindowRows);
}

// ---- home routines used as JavaScript ----
export const sound = (P, id) => playSoundManaged(P, id);
export const advanceFrame = P => homeAdvanceFrame(P);
export const waitFrames = (P, n) => homeWaitFrames(P, n);
export function* waitFadeEnd(P) { return yield* homeWaitFadeEnd(P, getRegs(P.cpu)); }
// `ld c, speed / call BeginFadeOut / call WaitFadeEnd` and `script_fade_in speed / call WaitFadeEnd`
export function* fadeOut(P, speed) { beginFadeOut(P, speed); yield* waitFadeEnd(P); }
export function* fadeIn(P, speed) { beginFadeIn(P, speed); yield* waitFadeEnd(P); }
// RegisterFrameTask / UnregisterFrameTask of a routine in the ROM bank mapped now (the caller's); the ROM builds
// its key on the stack below the call's return address
export const registerFrameTask = (P, priority, routine) => homeRegisterFrameTask(P, priority, routine, (P.cpu.sp - 2) & 0xFFFF);
export const unregisterFrameTask = (P, routine) => homeUnregisterFrameTask(P, routine, (P.cpu.sp - 2) & 0xFFFF);
export { testGameFlag, setGameFlag, clearGameFlag };
// QueueVRAMCopy of `rows` map rows from row `row` of a WRAM map buffer to the background map (bank 0 or 1)
export const queueMapRows = (P, src, dest, row, rows) =>
  queueVRAMCopy(P, (src + row * TILEMAP_WIDTH) & 0xFFFF, (dest + row * TILEMAP_WIDTH) & 0xFFFF, rows * TILEMAP_WIDTH / 16);
// the IE timer bit: `ld hl, rIE / res 2, [hl]` (the timer interrupt off while the LCD is on) and `set 2, [hl]`
export const timerInterruptOff = P => P.bus.w8(rIE, P.bus.u8(rIE) & ~IE_TIMER);
export const timerInterruptOn = P => P.bus.w8(rIE, P.bus.u8(rIE) | IE_TIMER);
// the scroll and the camera back to 0 (the screens' setup: hScrollX/Y, wCameraX/Y)
export function resetScrollAndCamera(P) {
  P.V.scrollX = 0; P.V.scrollY = 0;
  wr16(P, "cameraX", 0); wr16(P, "cameraY", 0);
}

// ---- hook adapters ----
// fn(P, cpu) runs the routine and returns the registers the ROM routine leaves that its callers use ({ a, f, ... });
// the others are put back as they were at the call (the routine's calls into the ROM change the CPU's registers).
export const hook = fn => (P, cpu) => {
  const saved = getRegs(cpu);
  const out = fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
};
export const hookGen = fn => function* (P, cpu) {
  const saved = getRegs(cpu);
  const out = yield* fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
};
export { getRegs, setRegs };

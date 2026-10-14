// Shared pieces of the EXP, results and ranking menu ports (web/js/port/menus/exp, menus/results, menus/ranking):
// constants, RAM names, the routines of other parts of the game these screens call, and small helpers. Built on the
// character-menu ports' defs (menus/char_select/defs.js: RAM through the mapped banks, far(), the hook adapters with
// HOOK_TRACE for the routine tests).
// Names, addresses and constants from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm); the values of its generated constants (screen assets, tile blocks, decoded sizes) are
// the operands of the ROM's own instructions.
//
// Calls. A routine here calls
//   - verified ports directly (home/*, audio, save, menus/common, menus/char_data), inside far(P, bank, ...) when the
//     ROM reaches them with a farcall (FarCall maps the callee's bank: hRomBank and the MBC, which the VRAM copy queue,
//     the frame tasks and ROM reads through the bus see);
//   - its own routines directly (far ones inside far());
//   - the text engine, the characters (bank 8), the actors and the rest through their ROM addresses (rom() /
//     P.callRom, which runs the ported JS where another part has hooked it), as the character-menu ports do.
// Routines that wait are generators (`yield* advanceFrame(P)`); the lockstep test does not need the ROM's stack.
import {
  FZ, FN, FH, FC, orFlags, cpFlags, rd, wr, rd16, wr16, u8, w8, idx, rom, home, romWait, far, farGen, setRomBank,
  withWram, withWramGen, hook, hookGen, HOOK_TRACE, getRegs, setRegs, sound, advanceFrame, waitFrames, fadeIn, fadeOut,
  waitFadeEnd, registerFrameTask, unregisterFrameTask, queueVRAMCopy, queueSprite, formatDecimalNumberUnsigned,
  beginFadeOut, beginFadeIn, testGameFlag, setGameFlag, clearGameFlag, disableLCDSafely, resetScrollAndCamera,
  HOME as HOME_CS, FAR as FAR_CS,
} from "../char_select/defs.js";
import { flagOperand } from "../../home/flags.js";

export {
  FZ, FN, FH, FC, orFlags, cpFlags, rd, wr, rd16, wr16, u8, w8, idx, rom, home, romWait, far, farGen, setRomBank,
  withWram, withWramGen, hook, hookGen, HOOK_TRACE, getRegs, setRegs, sound, advanceFrame, waitFrames, fadeIn, fadeOut,
  waitFadeEnd, registerFrameTask, unregisterFrameTask, queueVRAMCopy, queueSprite, formatDecimalNumberUnsigned,
  beginFadeOut, beginFadeIn, testGameFlag, setGameFlag, clearGameFlag, disableLCDSafely, resetScrollAndCamera,
  flagOperand,
};

// ---- banks ----
export const BANK_RESULT = 0x16, BANK_RANKING = 0x1B, BANK_EXP_DISTRIBUTE = 0x1D, BANK_EXP = 0x1E, BANK_BRACKET = 0x3B;
export const BANK_SAVE = 0x03, BANK_STORY = 0x02, BANK_TEXT = 0x05, BANK_CHARS = 0x08, BANK_MENU_LIB = 0x39;
export const BANK_CURSORBOX = 0x18, BANK_BOOT = 0x01, BANK_CHAR_DATA = 0x1C, BANK_CURSOR_38 = 0x38;

// ---- flags, registers ----
export const addFlags = (a, x) => (((a + x) & 0xFF) === 0 ? FZ : 0) | ((a & 0xF) + (x & 0xF) > 0xF ? FH : 0) | (a + x > 0xFF ? FC : 0);
export const subFlags = (a, x) => (((a - x) & 0xFF) === 0 ? FZ : 0) | FN | ((a & 0xF) < (x & 0xF) ? FH : 0) | (a < x ? FC : 0);
export const decFlags = (v, carry = 0) => (((v - 1) & 0xFF) === 0 ? FZ : 0) | FN | ((v & 0x0F) === 0 ? FH : 0) | carry;
export const incFlags = (v, carry = 0) => (((v + 1) & 0xFF) === 0 ? FZ : 0) | ((v & 0x0F) === 0x0F ? FH : 0) | carry;
// `add hl, rr`: Z kept, N clear, H from bit 11, C from bit 15
export const addHLFlags = (hl, rr, f = 0) => (f & FZ) | (((hl & 0xFFF) + (rr & 0xFFF)) > 0xFFF ? FH : 0) | (hl + rr > 0xFFFF ? FC : 0);
// `and n`: Z, H set
export const andFlags = v => ((v & 0xFF) ? 0 : FZ) | FH;
// the ROM's table index `ld hl, table / add l / ld l, a / jr nc / inc h` (or ld_hl_indexed): table + a (8-bit a)
export const ix = (table, a) => (table + (a & 0xFF)) & 0xFFFF;
// a word of the ROM table at addr (through the bank mapped: the routine's own)
export const romByte = (P, addr) => P.bus.u8(addr & 0xFFFF);
export const romWord = (P, addr) => P.bus.u16(addr & 0xFFFF);

// ---- the game flags (include/flag_constants.inc): the flag number; testFlag etc. take the number ----
export const FLAG = {
  TEXT_RENDER_ACTIVE: 0x23, DOUBLES: 0x2F, WON_DREAM_MATCH_DOUBLES: 0x34, WON_ISLAND_OPEN_DOUBLES_FINAL: 0x35,
  WON_ISLAND_OPEN_DOUBLES_SEMIFINAL: 0x36, WON_ISLAND_OPEN_DOUBLES_ROUND_1: 0x37, WON_DREAM_MATCH_SINGLES: 0x3B,
  WON_ISLAND_OPEN_SINGLES_FINAL: 0x3C, WON_ISLAND_OPEN_SINGLES_SEMIFINAL: 0x3D, WON_ISLAND_OPEN_SINGLES_ROUND_2: 0x3E,
  WON_ISLAND_OPEN_SINGLES_ROUND_1: 0x3F, WON_JUNIOR_DOUBLES_RANK_3: 0x40, WON_JUNIOR_DOUBLES_RANK_2: 0x41,
  WON_JUNIOR_DOUBLES_RANK_1: 0x42, WON_SENIOR_DOUBLES_RANK_3: 0x44, WON_SENIOR_DOUBLES_RANK_2: 0x45,
  WON_SENIOR_DOUBLES_RANK_1: 0x46, WON_VARSITY_DOUBLES_RANK_2: 0x48, ISLAND_SKY_SCENE_ACTIVE: 0x4F,
  WON_JUNIOR_SINGLES_RANK_4: 0x50, WON_JUNIOR_SINGLES_RANK_3: 0x51, WON_JUNIOR_SINGLES_RANK_2: 0x52,
  WON_JUNIOR_SINGLES_RANK_1: 0x53, WON_SENIOR_SINGLES_RANK_4: 0x54, WON_SENIOR_SINGLES_RANK_3: 0x55,
  WON_SENIOR_SINGLES_RANK_2: 0x56, WON_SENIOR_SINGLES_RANK_1: 0x57, WON_VARSITY_SINGLES_RANK_4: 0x58,
  HAVE_LARGE_RACKET: 0x61, HAVE_SMALL_RACKET: 0x62, HAVE_IRON_RACKET: 0x63, HAVE_DRIVE_RACKET: 0x66,
  HAVE_IRON_SHOES: 0x67, HAVE_LIGHT_SHOES: 0x68, CLEARED_MACHINE_MASTER: 0xDA, CLEARED_WALL_MASTER: 0xDB,
  TEMP_WIDE_GLYPH_STREAM: 0xFD, TEMP_PROGRESS_SCREEN_OPEN: 0xFE, TEMP_RESULTS_SCREEN_OPEN: 0xFF,
};
// test_flag / set_flag / clear_flag n (rst $30 / $20 / $28): by number
export const testFlag = (P, n) => testGameFlag(P, flagOperand(n));
export const setFlag = (P, n) => setGameFlag(P, flagOperand(n));
export const clearFlag = (P, n) => clearGameFlag(P, flagOperand(n));
// the flags TestGameFlag leaves (Z when clear, H from its `and`)
export const testFlagF = set => (set ? 0 : FZ) | FH;
// save flags (include/constants/saveflags.inc): the (byte << 8) | (bit << 5) operand SetSaveFlag takes in de
export const SAVEFLAG = {
  UNLOCKED_SAMMI: 0x01C0, UNLOCKED_ELDEN: 0x01E0, COURT_STAR: 0x0720, COURT_CASTLE: 0x0740, COURT_TROPICS: 0x0760,
  COURT_JUNGLE: 0x0780, COURT_WAREHOUSE: 0x07A0,
};

// ---- constants (include/constants/*.inc) ----
export const GAMEMODE = {
  NONE: 0x00, RANKING_MATCH: 0x01, ISLAND_OPEN: 0x02, PRACTICE_MATCH: 0x03, EXHIBITION: 0x04, TRAINING_DRILL: 0x05,
  TENNIS_MACHINE: 0x06, WALL_PRACTICE: 0x07, MARIO_MINIGAME: 0x08, LINK_MATCH: 0x09, DREAM_MATCH: 0x0A,
};
export const WINLOSE_WIN = 0x01, WINLOSE_LOSE = 0xFF;
export const LINKSTATE_MASTER = 0x01, LINKSTATE_SLAVE = 0x02;
export const MATCHLIST_DOUBLES = 0x01, MATCHLIST_TRAINING = 0x02;
export const MINIGAME_TENNIS_MACHINE_HIGH_SCORE = 0x1A, MINIGAME_BOO_BLAST = 0x1C, MINIGAME_SHOOTING_STAR = 0x1D;
export const MINIGAME_TARGET_SHOT = 0x1F, MINIGAME_BANANA_BUNCH = 0x21;
export const MATCHABORTB_MATCH = 7;
export const STORYLOC_PEACHS_CASTLE = 0x1D;
export const MENUSLIDE_BACK = 0x00;
export const CHARANIM_CELEBRATE = 0x03;
export const CHARREC_NAME = 0x00, CHARREC_LEVEL = 0x18;              // a character record's fields
export const WRAM_STAGING = 1, WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5, WRAM_SCENE = 6;
export const WRAM_SOUND = 7, WRAM_CHAR0 = 4, WRAM_CHAR1 = 5, WRAM_CHAR2 = 6, WRAM_CHAR3 = 7;
export const TILE_SIZE = 16, TILEMAP_WIDTH = 32, SCREEN_HEIGHT = 18;
export const VRAM_BANK1 = 0x2000;
export const vTiles0 = 0x8000, vTiles1 = 0x8800, vTiles2 = 0x9000, vBGMap0 = 0x9800;
export const OAM_BANK1 = 0x08, OAM_XFLIP = 0x20;
export const PADF_A = 0x01, PADF_B = 0x02, PADF_RIGHT = 0x10, PADF_LEFT = 0x20, PADF_UP = 0x40, PADF_DOWN = 0x80;
export const rWY = 0xFF4A, rSTAT = 0xFF41, rIE = 0xFFFF, rRAMG = 0x0000;
export const IE_STAT = 0x02;
// sounds (include/constants/sound.inc)
export const BGM_NONE = 0x00, BGM_MENU = 0x03, BGM_STATUS_SCREEN = 0x04, BGM_WIN = 0x09, BGM_LOSE = 0x0A;
export const BGM_EXP_AWARD = 0x0B, BGM_EXP_DISTRIBUTION = 0x0C, BGM_ISLAND_OPEN_LOSE = 0x2A, BGM_ISLAND_OPEN_WIN = 0x2B;
export const BGM_LEVEL_UP = 0x2F;
export const SFX_MENU_MOVE = 0x5E, SFX_MENU_SELECT = 0x5F, SFX_MENU_CANCEL = 0x62, SFX_MARKER = 0x78;
export const SFX_RANKING_BOARD = 0x7F, SFX_RANKING_HIGHLIGHT = 0x80;
// screen assets and tile blocks of the menu library (bank $39), sizes in 16-byte blocks (the ROM's operands)
export const SCREENASSET_ExhibitionMenu = 0x0C, SCREENASSET_MatchStats = 0x13, SCREENASSET_MatchStats2 = 0x14;
export const SCREENASSET_MatchStats3 = 0x23, SCREENASSET_VarsityTeamChart = 0x25, SCREENASSET_VarsityTeamChart2 = 0x26;
export const SCREENASSET_TournamentBracketSingles = 0x29, SCREENASSET_TournamentBracketDoubles = 0x2A;
export const TILEBLOCK_MatchWinLoseGfx = 0x09, MatchWinLoseGfx_BLOCKS = 0x04;
export const TILEBLOCK_TournamentBracketGfx = 0x69, TournamentBracketGfx_BLOCKS = 0x10;

// ---- RAM (ram/*.asm, include/ram_mirrored.inc) ----
export const wDecompBuffer = 0xD000, wTextTileBuffer = 0xD800, wTextTileBuffer_BLOCKS = 0x80;   // WRAM 1
export const wScreenAttrmap = 0xD000;                                                          // WRAM 2
export const wShadowTilemap = 0xD000, wShadowAttrmap = 0xD400;                                 // WRAM 3
export const wCharDataScreenCell = 0xD000, wMugshotBuffer = 0xD600;
export const wWindowShadowTilemap = 0xD000;                                                    // WRAM 5
export const wTextBuffer = 0xC600;
// the on-court character struct (WRAM 4-7, one bank per character; include/ram_mirrored.inc)
export const CHAR = {
  PosX: 0xDF00, PosHeight: 0xDF06, SpriteFrame: 0xDF1B, FrameVramDest: 0xDF26, FacingOctant: 0xDF32,
  TileBase: 0xDF36, SpriteAttr: 0xDF37, ScreenX: 0xDF53, ScreenY: 0xDF54, Id: 0xDF78, SpriteSlot: 0xDF80,
  ExpTier: 0xDF95,
};
// the game-progress list (WRAM 5, over the character struct's addresses)
export const PROGRESS = { VisibleCount: 0xDF03, ListIndex: 0xDF05, EntryUnlocked: 0xDF10, EntryEarned: 0xDF40, VisibleEntries: 0xDF70 };
// a cell of a 32-wide map buffer
export const cell = (base, row, col) => (base + row * TILEMAP_WIDTH + col) & 0xFFFF;

// ---- the ROM's routines, by address ----
export const HOME = {
  ...HOME_CS, ClearBytes: 0x03A7, CopyMemoryBC: 0x03DB, DivAHLByE: 0x0FBC, MulHLByA: 0x0926, MulHLByAFracSigned: 0x0BB6,
  FormatDecimalNumber: 0x1972, DecompressDataFromBank: 0x0234, TestGameFlagByNumber: 0x24EF,
};
export const FAR = {
  ...FAR_CS,
  // bank 2 (story records) / 3 (saves) / 4 (actors) / 5 (text)
  GetExpRequiredForLevel: [0x02, 0x4E3A], RemapExtendedCharId: [0x02, 0x4C58],
  InitTextWindows: [0x05, 0x4096], PushTextArgNumber: [0x05, 0x5147], FetchDialogueText: [0x05, 0x5C18],
  AddTextIdOffset: [0x05, 0x5D2B], ResetGlyphStream: [0x05, 0x730D],
  // bank 8 (characters)
  InitChar: [0x08, 0x684A], SetCharAnimation: [0x08, 0x69EA], StepCharAnimation: [0x08, 0x7791],
  ReloadCharFacingTiles: [0x08, 0x7621], DrawCharSprite: [0x08, 0x650A],
  // bank $38 / $3b (menus)
  ApplySpriteBobOffsetY: [0x38, 0x40A5], IsMarioCastCharacter: [0x38, 0x6208],
  ApplyCursorBounceX: [0x3B, 0x409B], ApplyCursorBounceY: [0x3B, 0x40C5], PrintNumberRightAligned: [0x3B, 0x5C2B],
};
// the 8-bit registers of a register set (P.callRom's result): to pass on with some of them changed (a pair given
// to P.callRom would win over its halves)
export const regs8 = r => ({ a: r.a, f: r.f, b: r.b, c: r.c, d: r.d, e: r.e, h: r.h, l: r.l });
// A farcall into ROM code that may wait, with the ROM's stack below it: `words` words the caller has pushed, then
// FarCall's frame (the rst's return address, hl, af) and the callee's return address. For the character-data
// screens (their ROM code keeps a stack address: ComputeLevelUpStatDeltas' buffer in hStatDeltaRecordCopy).
export function* farcallWait(P, [bank, addr], regs = {}, words = 0) {
  const sp = P.cpu.sp;
  for (let i = 0; i < words + 3; i++) { P.cpu.sp = (P.cpu.sp - 2) & 0xFFFF; P.bus.w16(P.cpu.sp, 0); }
  try { return yield* P.runRom(bank, addr, regs); } finally { P.cpu.sp = sp; }
}
export const RunExpDistributionFlow = [0x1D, 0x682C], CharDataScreen_Show = [0x1C, 0x401A];

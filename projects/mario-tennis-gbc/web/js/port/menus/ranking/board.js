// The Island Open ranking board (bank $1B): after a tournament round the bracket of names, with the rounds the player
// has won highlighted, then (the board's mode: 0 shown, 1 a round won, 2 lost; 3 shown silently) the round just
// played animated: the banner slides in, markers move along the bracket, the next rows light up. A or B closes it.
// Also bank $1B's mugshot loaders the character menus share.
// Port of the code of src/engine/menus/ranking/board_mugshots_1b.asm (and its twin routines, src/twins/) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own.
// Graphics, tables and marker scripts are read from the ROM.
//
// The board's state (WRAM 3): wRankingBoardDoubles, wRankingBoardPlayerRow (the round: the row the player reached),
// wRankingBoardMode, wRankingBoardSilent; the markers (wRankingMarkerSlots: 12 x [tile, x, y, -]) and the four marker
// animation channels (board_markers.js).
// Covered by the lockstep on out/port/xr_board_s.mtrec and xr_board_d.mtrec (the singles and doubles boards: rounds
// won, lost, shown and shown silently) and by web/tests/port/routines_menus_exp.mjs.
import {
  FZ, FH, cpFlags, rd, wr, far, rom, home, HOME, FAR, hook, hookGen, sound, waitFrames, fadeIn, beginFadeOut, waitFadeEnd,
  registerFrameTask, queueVRAMCopy, resetScrollAndCamera, romWord, ix, getRegs, BANK_RANKING, BANK_BOOT, BANK_MENU_LIB,
  BANK_CURSORBOX, WRAM_STAGING, WRAM_SCREEN, TILE_SIZE, VRAM_BANK1, vTiles0, wDecompBuffer, wMugshotBuffer,
  BGM_ISLAND_OPEN_WIN, BGM_ISLAND_OPEN_LOSE, SFX_MARKER, SFX_RANKING_BOARD, SFX_RANKING_HIGHLIGHT,
  SCREENASSET_TournamentBracketSingles, SCREENASSET_TournamentBracketDoubles,
} from "../exp/defs.js";
import { enableLCD, clearBytes } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { decompressData, decompressDataFromBank } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { loadIndexedPalette18, unusedLoadAllIndexedPalettes } from "../common/cursorbox.js";
import { loadScreenAssetRecord, queueWram3MapToVRAM, updateAnimatedTiles } from "../common/tilemaps.js";
import {
  unusedClearWram3Row64, drawNameWithDiacritics, unusedDrawDecimalNumber, unusedDrawAsciiDigitString,
  unusedDrawAsciiDigitChar,
} from "../main_menu/n64.js";
import { loadMenuFontGfx } from "../main_menu/boot.js";
import {
  highlightDoublesRankingRows, highlightDoublesRankingRow, pushRankingBoardTilemapRows, clearRankingMarkerSlots,
  loadRankingMarkerCoords, getRankingMarkerSlot, startRankingMarkerAnim,
} from "./board_markers.js";
import {
  waitForAOrBPress, drawSinglesRankingNames, drawDoublesRankingNames, highlightSinglesRankingRows, highlightRankingRow,
} from "./board_names.js";

export const BANK = BANK_RANKING;
// ROM data and routines (bank $1B)
const CharMugshotGfxPointers = 0x4CEC, RankingBoardScreenPalettes = 0x4F76;
const RankingBoardAnimHandlers = [0x504F, 0x5059, 0x5063, 0x506D];   // by layout: 1 singles won, 2 singles, 3 / 4 doubles
const RankingBoardAnimTask_1b = 0x5912, RankingCursorBobTask = 0x5A04, DrawRankingMarkersTask = 0x5A45;
const BRACKET_ICON_BANK = 0x3F, BRACKET_ICON_SLOTS = [0x30, 0x32, 0x34];   // DataPtr_BracketCharIcon00-02 (bank $3F)
const MUGSHOT_BLOCKS = 9, STORY_HERO_MUGSHOT = 0x3F, MUGSHOT_IDS = 0x40;
const MODE_SHOWN = 0, MODE_WON = 1, MODE_LOST = 2, MODE_SILENT = 3;
const RANKING_MARKER_STATE_BYTES = 0x53;
// the marker scripts' tables (bank $1B, from RankingBoardAnimState_5077Table0)
const T5077Table0 = 0x5B94, T5077Table1 = 0x5B95, T546dTable = 0x5B98, T5077Table2 = 0x5B9D, T5077Table3 = 0x5BA5;
const T5077Table4 = 0x5BB2, T516fTable0 = 0x5BBB, T516fTable1 = 0x5BBC, T516fTable2 = 0x5BC3, T5387Table0 = 0x5BC5;
const T516fTable3 = 0x5BCC, T516fTable4 = 0x5BCD, T516fTable5 = 0x5BD4, T5368Table0 = 0x5BDD, T5368Table1 = 0x5BE2;
const T5273Table0 = 0x5BE7, T53faTable = 0x5BEF, T5387Table1 = 0x5BF7, T5273Table1 = 0x5C0C;

// ---- the mugshots ----
// Unused_1b_ResetMugshotPalettes (1B:4E0D): wModeScratch = $FF, the five indexed palettes from palette 3
export function unusedResetMugshotPalettes(P) {
  P.V.modeScratch = 0xFF;
  far(P, BANK_CURSORBOX, () => unusedLoadAllIndexedPalettes(P, 3));
  return { a: 0xFF, d: 3 };
}
// Unused_1b_SetMugshotAttrs (1B:4E18): a 3 x 3 block of attribute (a & 7) + 3 | 8 at $DC00 + de (rows 32 apart).
// Registers kept.
export function unusedSetMugshotAttrs(P, a, de) {
  const v = (((a & 0x07) + 0x03) | 0x08) & 0xFF;
  let hl = (0xDC00 + de) & 0xFFFF;
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 3; i++) P.bus.w8(hl + i, v);
    hl = (hl + 3 + 0x1D) & 0xFFFF;
  }
}
// LoadCharMugshotToBuffer (1B:4E37): mugshot a (below $40) into wMugshotBuffer
export function loadCharMugshotToBuffer(P, a) {
  if (a >= MUGSHOT_IDS) return { a, f: cpFlags(a, MUGSHOT_IDS) };
  return decompressCharMugshot(P, a, wMugshotBuffer);
}
// CopyMugshotBufferToVram (1B:4E46): wMugshotBuffer (9 tiles) queued to VRAM de. Registers kept.
export function copyMugshotBufferToVram(P, de) { queueVRAMCopy(P, wMugshotBuffer, de, MUGSHOT_BLOCKS); }
// LoadIndexedPaletteThunk (1B:4E58): LoadIndexedPalette_18 (palette a as palette d)
export function loadIndexedPaletteThunk(P, a, d) { far(P, BANK_CURSORBOX, () => loadIndexedPalette18(P, a, d)); }
// DecompressCharMugshot (1B:4E5C): mugshot a (the story hero, $3F: $40 + the story file) decompressed to de
// (CharMugshotGfxPointers). af, de, hl kept; bc = the table.
export function decompressCharMugshot(P, a, de) {
  const id = a === STORY_HERO_MUGSHOT ? (P.V.currentStorySlot + a + 1) & 0xFF : a;
  decompressData(P, romWord(P, (CharMugshotGfxPointers + id * 4) & 0xFFFF), de);
  return { bc: CharMugshotGfxPointers };
}

// ---- the board ----
// ShowRankingBoard (1B:4E81): the board for doubles b, row c, mode d (see the header)
export function* showRankingBoard(P, b, c, d) {
  P.wramBank(WRAM_SCREEN);
  wr(P, "rankingBoardSilent", 0);
  wr(P, "rankingBoardDoubles", b);
  wr(P, "rankingBoardPlayerRow", c);
  wr(P, "rankingBoardMode", d);
  if (d === MODE_SILENT) { wr(P, "rankingBoardMode", MODE_SHOWN); wr(P, "rankingBoardSilent", 1); }
  const mode = rd(P, "rankingBoardMode");
  if (mode === MODE_WON) sound(P, BGM_ISLAND_OPEN_WIN);
  else if (mode === MODE_LOST) sound(P, BGM_ISLAND_OPEN_LOSE);
  home(P, HOME.DisableLCDSafely);
  yield* buildRankingBoardScreen(P);
  enableLCD(P);
  yield* fadeIn(P, 4);
  P.wramBank(WRAM_SCREEN);
  yield* dispatchRankingBoardAnim(P);
  yield* waitFrames(P, 30);
  yield* waitForAOrBPress(P);
  let speed = 0x20;
  if (!rd(P, "rankingBoardMode") && !rd(P, "rankingBoardSilent")) { sound(P, SFX_RANKING_BOARD); speed = 2; }
  beginFadeOut(P, speed);
  yield* waitFadeEnd(P, { ...getRegs(P.cpu), c: speed });
  return clearFrameTasks(P);
}
// BuildRankingBoardScreen (1B:4EF2): the bracket (singles or doubles) with its names and highlighted rows, the
// markers at their places, the icons and palettes, the marker task (and in mode 2 the cursor's)
export function* buildRankingBoardScreen(P) {
  resetScrollAndCamera(P);
  far(P, BANK_BOOT, () => loadMenuFontGfx(P));
  rom(P, FAR.PrepareGlyphBuffer);
  P.wramBank(WRAM_SCREEN);
  wr(P, "rankingBannerAnimFrame", 0);
  wr(P, "rankingAnimStateDone", 0);
  clearBytes(P, P.A.rankingMarkerSlots, RANKING_MARKER_STATE_BYTES);
  clearRankingMarkerSlots(P);
  loadRankingMarkerCoords(P);
  const two = rd(P, "rankingBoardDoubles");
  far(P, BANK_MENU_LIB, () => loadScreenAssetRecord(P, two ? SCREENASSET_TournamentBracketDoubles : SCREENASSET_TournamentBracketSingles));
  P.wramBank(WRAM_SCREEN);
  if (two) { yield* drawDoublesRankingNames(P); highlightDoublesRankingRows(P); }
  else { yield* drawSinglesRankingNames(P); highlightSinglesRankingRows(P); }
  loadRankingBoardTiles(P);
  loadPaletteShadow(P, RankingBoardScreenPalettes, 8, 6);
  registerFrameTask(P, 1, DrawRankingMarkersTask);
  if (rd(P, "rankingBoardMode") === MODE_LOST) registerFrameTask(P, 1, RankingCursorBobTask);
  return far(P, BANK_MENU_LIB, () => queueWram3MapToVRAM(P));
}
// LoadRankingBoardTiles (1B:4FA6): the three bracket icon sets (bank $3F) to $8000, $8100, $8200 (VRAM bank 1)
export function loadRankingBoardTiles(P) {
  const bank = P.V.wramBank;
  P.wramBank(WRAM_STAGING);
  let r;
  BRACKET_ICON_SLOTS.forEach((slot, i) => {
    decompressDataFromBank(P, BRACKET_ICON_BANK, slot, wDecompBuffer);
    r = queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x10 * i * TILE_SIZE + VRAM_BANK1, 16);
  });
  P.wramBank(bank);
  return { ...r, a: bank, f: undefined };                           // (pop af: the flags as at the call)
}
// DispatchRankingBoardAnim (1B:4FF1): unless silent or lost, the animation of the round (row): singles shown /
// won, doubles shown / won (RankingBoardAnimHandlers1-4_1b by row)
export function* dispatchRankingBoardAnim(P) {
  if (rd(P, "rankingBoardSilent")) return {};
  const mode = rd(P, "rankingBoardMode");
  if (mode === MODE_LOST) return {};
  const table = rd(P, "rankingBoardDoubles") ? (mode ? RankingBoardAnimHandlers[2] : RankingBoardAnimHandlers[3])
    : (mode ? RankingBoardAnimHandlers[0] : RankingBoardAnimHandlers[1]);
  const handler = romWord(P, ix(table, rd(P, "rankingBoardPlayerRow") * 2));
  const script = SCRIPTS[handler];
  if (!script) throw new Error(`DispatchRankingBoardAnim: row ${rd(P, "rankingBoardPlayerRow")} jumps to ${handler.toString(16)}`);
  return yield* runRankingBoardAnim(P, script);
}
// RankingBoardAnimState_*_1b (1B:5077 ...): the animations as scripts of steps:
//   BANNER the banner task (RankingBoardAnimTask_1b) started; wait(n) frames; sfx(id);
//   marker(c, table, k): marker c's animation channel k started with the offsets table (StartRankingMarkerAnim0-3);
//   row(b) / drow(b) the singles / doubles bracket row b highlighted; PUSH the map rows pushed to VRAM (three
//   frames); DONE wRankingAnimStateDone set. Each ends at RankingBoardAnimNop_1b.
const BANNER = { op: "banner" }, PUSH = { op: "push" }, DONE = { op: "done" };
const wait = n => ({ op: "wait", n }), sfx = id => ({ op: "sfx", id }), marker = (c, table, k) => ({ op: "marker", c, table, k });
const row = b => ({ op: "row", b }), drow = b => ({ op: "drow", b });
const SCRIPTS = {
  0x5077: [BANNER, wait(140), sfx(SFX_MARKER), marker(0x00, T5077Table3, 2), marker(0x01, T5077Table4, 1), row(0x01), PUSH,
    wait(30), sfx(SFX_RANKING_HIGHLIGHT), marker(0x03, T5077Table0, 0), marker(0x04, T5077Table0, 1), wait(90), sfx(SFX_MARKER),
    marker(0x03, T5077Table3, 2), marker(0x04, T5077Table4, 1), row(0x02), PUSH, wait(30), sfx(SFX_RANKING_HIGHLIGHT),
    marker(0x06, T5077Table2, 0), marker(0x07, T5077Table2, 1), wait(90), sfx(SFX_MARKER), marker(0x06, T5077Table3, 2),
    marker(0x07, T5077Table1, 1), row(0x03), PUSH, wait(30), sfx(SFX_RANKING_HIGHLIGHT), marker(0x09, T5077Table2, 0),
    marker(0x0a, T5077Table2, 1), wait(90), sfx(SFX_MARKER), marker(0x09, T5077Table3, 2), marker(0x0a, T5077Table1, 1),
    row(0x04), PUSH, wait(30), DONE],
  0x516F: [BANNER, wait(140), sfx(SFX_MARKER), marker(0x00, T516fTable0, 2), marker(0x02, T516fTable3, 1), row(0x05), PUSH,
    wait(30), sfx(SFX_RANKING_HIGHLIGHT), marker(0x05, T516fTable0, 1), wait(4), marker(0x03, T516fTable2, 0), wait(120),
    sfx(SFX_MARKER), marker(0x05, T516fTable3, 3), marker(0x03, T516fTable5, 0), row(0x06), PUSH, wait(30),
    sfx(SFX_RANKING_HIGHLIGHT), marker(0x08, T516fTable4, 1), wait(4), marker(0x06, T516fTable5, 0), wait(90), sfx(SFX_MARKER),
    marker(0x08, T516fTable3, 3), marker(0x06, T516fTable2, 0), row(0x07), PUSH, wait(30), sfx(SFX_RANKING_HIGHLIGHT),
    marker(0x0b, T516fTable4, 1), wait(4), marker(0x09, T516fTable5, 0), wait(90), sfx(SFX_MARKER), marker(0x0b, T516fTable1, 1),
    marker(0x09, T516fTable0, 2), row(0x08), PUSH, wait(30), DONE],
  0x5273: [BANNER, wait(140), sfx(SFX_MARKER), marker(0x00, T5273Table0, 2), marker(0x05, T516fTable5, 0), row(0x09), PUSH,
    wait(90), sfx(SFX_RANKING_HIGHLIGHT), marker(0x08, T516fTable5, 0), marker(0x09, T516fTable5, 1), wait(90), sfx(SFX_MARKER),
    marker(0x08, T5077Table1, 0), marker(0x09, T5273Table1, 3), row(0x0a), PUSH, wait(30), DONE],
  0x52EB: [BANNER, wait(140), DONE],
  0x52FF: [wait(20), sfx(SFX_RANKING_HIGHLIGHT), marker(0x00, T5077Table0, 0), marker(0x01, T5077Table0, 1), wait(20)],
  0x5322: [wait(10), sfx(SFX_RANKING_HIGHLIGHT), marker(0x02, T516fTable0, 1), wait(4), marker(0x00, T516fTable2, 0), wait(20)],
  0x5349: [wait(20), sfx(SFX_RANKING_HIGHLIGHT), marker(0x00, T5077Table0, 0), marker(0x05, T5077Table0, 1)],
  0x5368: [wait(30), sfx(SFX_RANKING_HIGHLIGHT), marker(0x00, T5368Table0, 0), marker(0x09, T5368Table1, 1)],
  0x5387: [BANNER, wait(140), sfx(SFX_MARKER), marker(0x00, T5387Table1, 2), marker(0x01, T516fTable5, 1), drow(0x01), PUSH,
    wait(90), sfx(SFX_RANKING_HIGHLIGHT), marker(0x03, T516fTable5, 0), marker(0x04, T5077Table2, 1), wait(90), sfx(SFX_MARKER),
    marker(0x03, T5387Table1, 2), marker(0x04, T5387Table0, 1), drow(0x02), PUSH, wait(90)],
  0x53FA: [BANNER, wait(140), sfx(SFX_MARKER), marker(0x00, T53faTable, 2), marker(0x02, T516fTable3, 1), drow(0x03), PUSH,
    wait(90), sfx(SFX_RANKING_HIGHLIGHT), marker(0x03, T516fTable5, 0), marker(0x05, T516fTable3, 1), wait(140), sfx(SFX_MARKER),
    marker(0x03, T53faTable, 2), marker(0x05, T516fTable0, 1), drow(0x04), PUSH, wait(30)],
  0x546D: [BANNER, wait(140), sfx(SFX_MARKER), marker(0x00, T546dTable, 0), marker(0x03, T5077Table0, 1), drow(0x06), PUSH, wait(30)],
  0x54A0: [],
  0x54A3: [wait(30), sfx(SFX_RANKING_HIGHLIGHT), marker(0x00, T5077Table0, 0), marker(0x01, T5077Table0, 1)],
  0x54C2: [wait(30), sfx(SFX_RANKING_HIGHLIGHT), marker(0x02, T516fTable0, 1), wait(8), marker(0x00, T5077Table0, 0)],
  0x54E5: [wait(30), sfx(SFX_RANKING_HIGHLIGHT), marker(0x00, T5077Table0, 0), marker(0x03, T5077Table2, 1)],
  0x5504: [],
};
export function* runRankingBoardAnim(P, script) {
  for (const s of script) {
    switch (s.op) {
      case "banner": registerFrameTask(P, 1, RankingBoardAnimTask_1b); break;
      case "wait": yield* waitFrames(P, s.n); break;
      case "sfx": sound(P, s.id); break;
      case "marker": startRankingMarkerAnim(P, s.k, getRankingMarkerSlot(P, s.c).hl, s.table); break;
      case "row": highlightRankingRow(P, s.b); break;
      case "drow": highlightDoublesRankingRow(P, s.b); break;
      case "push": yield* pushRankingBoardTilemapRows(P); break;
      case "done": wr(P, "rankingAnimStateDone", 1); break;
    }
  }
  return {};
}

export const HOOKS = [
  [BANK, 0x4403, hook((P, c) => unusedClearWram3Row64(P, c.hl, c.f))],
  [BANK, 0x4419, hook((P, c) => unusedClearWram3Row64(P, c.hl, c.f))],
  [BANK, 0x4430, hook(P => { far(P, BANK_MENU_LIB, () => updateAnimatedTiles(P)); })],   // UpdateAnimatedTilesTask
  [BANK, 0x4434, hook((P, c) => drawNameWithDiacritics(P, c.hl, c.de))],                  // DrawNameWithDiacritics_1b
  [BANK, 0x446D, hook((P, c) => unusedDrawDecimalNumber(P, c))],
  [BANK, 0x448E, hook((P, c) => unusedDrawAsciiDigitString(P, c.hl, c.de))],
  [BANK, 0x4498, hook((P, c) => unusedDrawAsciiDigitChar(P, c.a, c.de))],
  [BANK, 0x4E0C, () => {}],                                                                // StubNop_1b_00
  [BANK, 0x4E0D, hook(P => unusedResetMugshotPalettes(P))],
  [BANK, 0x4E18, hook((P, c) => { unusedSetMugshotAttrs(P, c.a, c.de); })],
  [BANK, 0x4E37, hook((P, c) => loadCharMugshotToBuffer(P, c.a))],
  ...[0x4E43, 0x4E44, 0x4E45, 0x4E57, 0x4E7F, 0x4E80].map(addr => [BANK, addr, () => {}]),   // Unused_1b_StubNop_1b_01-06
  [BANK, 0x4E46, hook((P, c) => { copyMugshotBufferToVram(P, c.de); })],
  [BANK, 0x4E58, hook((P, c) => { loadIndexedPaletteThunk(P, c.a, c.d); })],
  [BANK, 0x4E5C, hook((P, c) => decompressCharMugshot(P, c.a, c.de))],
  [BANK, 0x4E81, hookGen((P, c) => showRankingBoard(P, c.b, c.c, c.d))],
  [BANK, 0x4EF2, hookGen(function* (P) { yield* buildRankingBoardScreen(P); })],
  [BANK, 0x4FA6, hook(P => loadRankingBoardTiles(P))],
  [BANK, 0x4FF1, hookGen(P => dispatchRankingBoardAnim(P))],
  [BANK, 0x504E, () => {}],                                                                // RankingBoardAnimNop_1b
  ...Object.entries(SCRIPTS).map(([addr, script]) => [BANK, +addr, hookGen(P => runRankingBoardAnim(P, script))]),
];

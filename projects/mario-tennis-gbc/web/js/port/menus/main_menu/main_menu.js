// The main menu (bank $3B): a 3 x 3 grid of panels over the stadium background. The middle row is the three story
// files (with each file's character, level and play time on the caption line when chosen), the top row Exhibition,
// Mini-games and Link, the bottom row Status (the files' and the N64's records), Dictionary and Erase. The panels slide in from the side
// (MainMenuSlideIn / SlideOut: one panel layout per frame, from TilemapAssemblyDispatch_39); the chosen cell is
// highlighted with its own palette and a bobbing frame of sprites (MainMenuCursorSpriteTask, a frame task), with the
// scrolling banner sprites behind.
// States of RunMainMenu: load (graphics over 16 frames, the save files' summaries), slide in, choose (every frame:
// the cheat-code watcher, the cursor, the selection redrawn when it moves), then A: slide out forward and return the
// item id (MapMainMenuCursorToItemIdTable; the Link cell first tries the link handshake, and comes back to a fresh
// main menu if it fails), or B: slide out back and return $FF (to the title screen).
// The other menus of the bank are built the same way (picker.js has the shared pieces).
// Port of src/engine/menus/main_menu/main_menu_3b.asm and the main menu's part of saveslots_3b.asm
// (BuildSaveSlotSummaries .. Unused_3b_RestoreScreenAfterLinkAttempt) of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm). Tables are read from the ROM.
// Tests: the lockstep on out/engine/exh1.mtrec (Exhibition), out/port/save1.mtrec (Saved Data, Erase) and the
// main-menu recordings out/port/menus_*.mtrec; routine tests for the routines that do not wait
// (web/tests/port/routines_menus_main.mjs).
import { decompressDataFromBank } from "../../home/decompress.js";
import { copyMemoryBC, clearMemory16 } from "../../home/memory.js";
import { registerFrameTask } from "../../home/colorfade.js";
import { queueSpriteTemplate } from "../../home/fade.js";
import { beginFadeIn, beginFadeOut, waitFadeEnd } from "../../home/colorfade.js";
import {
  FZ, FN, FC, hook, hookGen, push, pop, callGen, farGen, callHome, callFar, waitFarCall, waitRom, advanceFrame, sound,
  withRomBank, wramBank, pushWramBank, popWramBank, withWramBank, queueCopy, loadPalettes, getRegs, cell, HOME,
  WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, TILE_SIZE, TILEMAP_WIDTH, VRAM_BANK1, vTiles0, vTiles1, vTiles2,
  vBGMap0, wDecompBuffer, wShadowTilemap, wShadowAttrmap, OAM_BANK1, PADF_A, PADF_B, rIE, rIF, IE_TIMER,
  MENUSLIDE_BACK, MENUSLIDE_FORWARD, BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL,
} from "../common/defs.js";
import { ixFlags } from "../common/defs.js";
import { moveMenuCursorGrid, getMenuCursorIndex, setMenuCursorFromIndex } from "../common/cursors.js";
import { BANK_MENU_LIB, restoreMenuBgAndDrawPanel, flushWram3MapRows, fillTilemapRect, updateAnimatedTiles } from "../common/tilemaps.js";
import { TILEBLOCK, farLoadTileBlock, loadIndexedPalette, initMenuBgScroll, loadMenuSpritePalettePair, tickMenuBgScroll, applySpriteBobOffset, resetScreenAndTextWindows } from "../common/menu_lib.js";
import { updateCheatCodeEntry, resetCheatCodeBuffer } from "../common/widgets.js";
import { BANK_CURSORBOX, loadIndexedPalette18, loadCharacterRecordToBuffer, checkCharacterUnlocked } from "../common/cursorbox.js";
import {
  ix, wSaveSlotSummaries, SUMMARY_SIZE, slideIn, slideOut, fillPickerCell, loadPickerCellPalette, drawCaptionFrame,
  queuePickerRows, drawFileCaption, loadFilePalette, loadLabelSets, loadFileMugshots, RenderTextToBuffer64,
} from "./picker.js";
import { BANK_BOOT, loadMenuFontGfx } from "./boot.js";

export const BANK_MAIN_MENU = 0x3B;
const MapMainMenuCursorToItemIdTable = 0x56BA, MainMenuTable0 = 0x57E0, MainMenuTable1 = 0x57EC;
const MainMenuCursorSpriteTask = 0x5863, MainMenuCursorSpriteTaskPtrs = 0x58BA, MainMenuCursorSpriteTask_SpriteTemplate = 0x5912;
const MainMenuCursorSpriteTaskTable0 = 0x591B, MainMenuCursorSpriteTaskTable1 = 0x592D, MainMenuCursorSpriteTaskTable2 = 0x5936;
const FillMainMenuCellHighlightTable = 0x5A43, MainMenuItemPalettePtrs = 0x5A6A;
const MainMenuCaptionTable = 0x5C03, MainMenuCaptionTable1 = 0x5C15;
const GRID_COLS = 3, GRID_ROWS = 3, CELLS = 9;
const LINK_CELL_X = 2, LINK_CELL_Y = 0;
// the story files are the middle row (cells 3-5)
const FIRST_FILE_CELL = 3, FILE_CELLS = 3;
const isFileCell = i => i >= FIRST_FILE_CELL && i < FIRST_FILE_CELL + FILE_CELLS;
// the files' summaries (BuildSaveSlotSummaries), 16 bytes each in WRAM 3 below the screen: [character (or a lock
// code >= 4: no file), its color, level, name (11 bytes), hours, minutes]
const SUMMARY_LEVEL = 2, SUMMARY_NAME = 3, SUMMARY_NAME_SIZE = 0x0B, SUMMARY_HOURS = 0x0E, SUMMARY_MINUTES = 0x0F;
const FRAME_TASK_PRIORITY = 0x7F;
const MAIN_MENU_SLIDE = { inPanel: 0, inSteps: 0x10, backFrom: 9, outPanel: 1, outSteps: 0x0C, backOutFrom: 0x0F, rows: 0 };
const ShowLinkMessageScreen = [0x3E, 0x49E6], TryEstablishLink = [0x07, 0x4048], ShowLinkStatusMessage = [0x3E, 0x4BA3];
const AnimateLinkStatusPalette = [0x3E, 0x4A54];
const Text_30_124 = 0x007C;                                 // "no file" caption
const LINK_RX_READY = 0xC1;                                 // hLinkRxByte: the partner is already there

// ---- RunMainMenu (3B:55D1) ----
// Returns a = the chosen item's id (0-2 a story file, 3 Exhibition, 4 Mini-games, 5 Link, 6 Status, 7 Dictionary,
// 8 Erase) or $FF (B: back to the title screen).
export function* runMainMenu(P) {
  const { V, bus } = P;
  for (;;) {                                                 // (jp RunMainMenu: after a failed link handshake)
    callHome(P, HOME.InitSerialLink);
    sound(P, BGM_MENU);
    bus.w8(rIE, bus.u8(rIE) & ~IE_TIMER);
    buildSaveSlotSummaries(P);
    V.cheatCodeLength = 0;
    yield* callGen(P, loadMainMenuGfx(P));
    withRomBank(P, BANK_MENU_LIB, () => { initMenuBgScroll(P); loadMenuSpritePalettePair(P, 1, 1); });
    setMenuCursorFromIndex(P, GRID_COLS, V.mainMenuCursor);
    bus.w8(P.A.menuBgScrollTile + 1, 0);
    bus.w8(P.A.menuBgScrollAttr + 1, 1);
    wramBank(P, WRAM_SCREEN);
    yield* callGen(P, mainMenuSlideIn(P, V.menuSlideDirection));
    registerFrameTask(P, FRAME_TASK_PRIORITY, MainMenuCursorSpriteTask, P.cpu.sp - 2);
    drawMainMenuSelection(P);
    callHome(P, HOME.ResetSerialState);
    withRomBank(P, BANK_MENU_LIB, () => resetCheatCodeBuffer(P));
    wramBank(P, WRAM_SCREEN);
    for (;;) {
      yield* advanceFrame(P);
      withRomBank(P, BANK_MENU_LIB, () => updateCheatCodeEntry(P));
      V.menuInputPressed = V.inputPressed;
      if (moveMenuCursorGrid(P, GRID_COLS, GRID_ROWS).a) { sound(P, SFX_MENU_MOVE); drawMainMenuSelection(P); }
      const input = V.menuInputPressed;
      if (input & PADF_A) {
        V.cheatUnlockTriggered = 1;
        sound(P, SFX_MENU_SELECT);
        callHome(P, HOME.ClearFrameTasks);
        bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
        yield* callGen(P, mainMenuSlideOut(P, 1));
        if (V.menuCursorX === LINK_CELL_X && V.menuCursorY === LINK_CELL_Y) {
          V.mainMenuCursor = getMenuCursorIndex(P, GRID_COLS).a;
          const r = yield* callGen(P, tryMainMenuLinkHandshake(P));
          if (r.f & FC) break;                               // no link: the main menu again
        }
        V.menuSlideDirection = MENUSLIDE_FORWARD;
        const index = getMenuCursorIndex(P, GRID_COLS).a;
        V.mainMenuCursor = index;
        return mapMainMenuCursorToItemId(P, index);
      }
      if (input & PADF_B) {
        sound(P, SFX_MENU_CANCEL);
        callHome(P, HOME.ResetSerialState);
        callHome(P, HOME.ClearFrameTasks);
        bus.w8(rIE, bus.u8(rIE) | IE_TIMER);
        yield* callGen(P, mainMenuSlideOut(P, 0));
        V.menuSlideDirection = MENUSLIDE_BACK;
        return { a: 0xFF };
      }
    }
  }
}
// MapMainMenuCursorToItemId (3B:56B0): the item id of grid cell a. Returns a and hl = its table entry.
export function mapMainMenuCursorToItemId(P, index) {
  const hl = ix(MapMainMenuCursorToItemIdTable, index);
  return { a: P.bus.u8(hl), hl, f: ixFlags(MapMainMenuCursorToItemIdTable, index) };
}

// LoadMainMenuGfx (3B:56C4), over 16 frames: the six label tile sets (MainMenuTable0, each to its VRAM place in
// MainMenuTable1), the three story files' character mugshots, the panel tile blocks into VRAM bank 1 $8000-$87FF,
// the cursor palette (IndexedPalettes $10 as OBJ palette 0) and the frame tiles to $8000. The WRAM bank is kept.
const LABEL_SETS = 6;
const PANEL_BLOCKS = [[TILEBLOCK.MainMenuGfx0, 0x00], [TILEBLOCK.SharedMenuGfx29, 0x10], [TILEBLOCK.SharedMenuGfx30, 0x20],
  [TILEBLOCK.MainMenuGfx1, 0x32], [TILEBLOCK.MainMenuGfx2, 0x42], [TILEBLOCK.MainMenuGfx3, 0x52], [TILEBLOCK.MainMenuGfx4, 0x62]];
export function* loadMainMenuGfx(P) {
  pushWramBank(P, WRAM_STAGING);
  yield* loadLabelSets(P, MainMenuTable0, MainMenuTable1, LABEL_SETS);
  yield* loadFileMugshots(P);
  for (const [block, tile] of PANEL_BLOCKS) {
    farLoadTileBlock(P, block, vTiles0 + tile * TILE_SIZE + VRAM_BANK1);
    yield* advanceFrame(P);
  }
  farLoadTileBlock(P, TILEBLOCK.SharedMenuGfx27, vTiles0 + 0x72 * TILE_SIZE + VRAM_BANK1);
  withRomBank(P, BANK_MENU_LIB, () => loadIndexedPalette(P, 0x08, 0x10));
  yield* advanceFrame(P);
  farLoadTileBlock(P, TILEBLOCK.MainMenuGfx5Alias4, vTiles0);
  popWramBank(P);
}

// MainMenuSlideIn (3B:5800) / MainMenuSlideOut (3B:5832): the panels slide, one step a frame: in forward (b != 0)
// panel layout 0 steps 0-15, back layout 1 steps 9-0; out forward layout 1 steps 0-11, back layout 0 steps 15-1.
export const mainMenuSlideIn = (P, forward) => slideIn(P, forward, MAIN_MENU_SLIDE);
export const mainMenuSlideOut = (P, forward) => slideOut(P, forward, MAIN_MENU_SLIDE);

// MainMenuCursorSpriteTask (3B:5863), a frame task: the banner sprites, then the bobbing frame around the chosen
// cell (MainMenuCursorSpriteTaskPtrs: a wide one for Mini-games) and its corner piece.
export function mainMenuCursorSpriteTask(P, sp = P.cpu.sp - 2) {
  const { bus } = P;
  withRomBank(P, BANK_MENU_LIB, () => tickMenuBgScroll(P, sp));
  const index = getMenuCursorIndex(P, GRID_COLS).a;
  const tile = bus.u8(MainMenuCursorSpriteTaskTable1 + index);
  const at = bus.u16(MainMenuCursorSpriteTaskTable0 + 2 * index);
  const y = withRomBank(P, BANK_MENU_LIB, () => applySpriteBobOffset(P, at & 0xFF)).e, x = at >> 8;
  queueSpriteTemplate(P, bus.u16(MainMenuCursorSpriteTaskPtrs + 2 * index), x, y, tile, OAM_BANK1, sp);
  const dy = bus.u8(MainMenuCursorSpriteTaskTable2 + index);
  const de = ((x << 8 | y) + 0x17F8) & 0xFFFF;
  return queueSpriteTemplate(P, MainMenuCursorSpriteTask_SpriteTemplate, ((de >> 8) + dy) & 0xFF, de & 0xFF, 0x72, OAM_BANK1, sp);
}

// DrawMainMenuSelection (3B:5968): every cell's attributes plain, the chosen one highlighted; palette 4 for it (a
// story file: its character's palette, LoadIndexedPalette_18; else the item's); the caption line (rows 15-16: a
// frame and the caption text) redrawn; the three rows of cells' attributes and the caption queued to VRAM.
export function drawMainMenuSelection(P) {
  wramBank(P, WRAM_SCREEN);
  for (let i = 0; i < CELLS; i++) fillMainMenuCellHighlight(P, i, 0);
  const index = getMenuCursorIndex(P, GRID_COLS).a;
  fillMainMenuCellHighlight(P, index, 1);
  if (isFileCell(index)) loadFilePalette(P, index - FIRST_FILE_CELL); else loadMainMenuItemPalette(P, index);
  drawCaptionFrame(P);
  drawMainMenuCaption(P);
  return queuePickerRows(P, [3, 7, 11]);
}
// FillMainMenuCellHighlight (3B:5A09): the attributes of cell b (5 x 3, a story file's 3 x 3): highlighted (c != 0,
// palette $0C) or plain ($0D). Registers kept.
export const fillMainMenuCellHighlight = (P, index, highlighted) => fillPickerCell(P, FillMainMenuCellHighlightTable, index, highlighted, isFileCell(index) ? 3 : 5);
// LoadMainMenuItemPalette (3B:5A57): item a's palette as BG palette 4
export const loadMainMenuItemPalette = (P, index) => loadPickerCellPalette(P, MainMenuItemPalettePtrs, index);

// ---- the story files' summaries and the caption ----
// BuildSaveSlotSummaries (3B:5AAC): for files 0-2 (records $80-$82, LoadCharacterRecordToBuffer): the file's lock
// code when it has none (>= 4: [code, 3]), else its character, color, level, name, play time (hours, minutes) into
// its 16 bytes of wSaveSlotSummaries. The WRAM bank is kept.
const CHAR_RECORD_LOCK = 0xD580 + 11, NO_FILE_LOCK = 4;
export function buildSaveSlotSummaries(P, f = 0, de = 0) {
  const { V, bus, A } = P, old = V.wramBank;
  let bc = wSaveSlotSummaries;
  withWramBank(P, WRAM_SCREEN, () => {
    clearMemory16(P, wSaveSlotSummaries, 3);
    for (let rec = 0x80; rec < 0x83; rec++) {
      wramBank(P, WRAM_COURT_PLANES);
      withRomBank(P, BANK_CURSORBOX, () => { loadCharacterRecordToBuffer(P, rec); checkCharacterUnlocked(P, rec); });
      wramBank(P, WRAM_COURT_PLANES);
      const lock = bus.u8(CHAR_RECORD_LOCK);
      wramBank(P, WRAM_SCREEN);
      if (lock >= NO_FILE_LOCK) {
        bus.w8(bc, lock); bus.w8(bc + 1, 3);
      } else {
        bus.w8(bc, V.storyModeMainCharacterOverworldSprite);
        bus.w8(bc + 1, V.storyModeMainCharacterOverworldSpriteColor);
        bus.w8(bc + SUMMARY_LEVEL, V.storyMainCharExpTier);
        de = copyMemoryBC(P, A.storyModeNameOfMainCharacter, (bc & 0xFF00) | ((bc + SUMMARY_NAME) & 0xFF), SUMMARY_NAME_SIZE).de;
        bus.w8(bc + SUMMARY_MINUTES, bus.u8(A.savedGameTimer + 3));
        bus.w8(bc + SUMMARY_HOURS, bus.u8(A.charDataSyncValues));
      }
      bc = (bc + SUMMARY_SIZE) & 0xFFFF;
    }
  });
  return { a: old, f, bc, de, hl: bc };                   // (pop_wram_bank: the bank and the flags of the call)
}
// DrawMainMenuCaption (3B:5B3E): the caption of the chosen cell on row 16: a story file's name, "Lv" and level,
// hours ":" minutes (or the "no file" text), or the item's caption text (RenderTextToBuffer64). The WRAM bank is
// kept (the ":" is written after it is restored, into whichever bank that is). Returns the registers it leaves.
export function drawMainMenuCaption(P, f = 0) {
  const { bus } = P, index = getMenuCursorIndex(P, GRID_COLS).a;
  if (isFileCell(index)) return drawFileCaption(P, index - FIRST_FILE_CELL, Text_30_124, true, f);
  const de = bus.u16(ix(MainMenuCaptionTable, index * 2)), text = bus.u16(ix(MainMenuCaptionTable1, index * 2));
  const old = P.V.wramBank;
  pushWramBank(P, WRAM_SCREEN);
  const r = callFar(P, RenderTextToBuffer64, { a: text & 0xFF, b: index, hl: text, de, c: 0x20 });
  popWramBank(P);
  return { ...r, a: old, f };
}
// PrintNumberRightAligned (3B:5C2B; width a = 0) / Print2DigitNumberRightAligned (3B:5C27; width 2): hl in decimal
// (FormatDecimalNumber into the buffer bc), written right to left ending at de, spaces as '0'. Leaves a = the first
// character, c = 0, de before it, hl = the buffer - 1.
export function printNumberRightAligned(P, value, dest, buffer, width) {
  const { bus } = P;
  callHome(P, HOME.FormatDecimalNumber, { a: width, hl: value, de: buffer, bc: buffer });
  let len = 0, hl = buffer;
  while (bus.u8(hl)) { len++; hl++; }
  hl = (buffer + len - 1) & 0xFFFF;
  let a = 0, n = len;
  do {
    a = bus.u8(hl); hl = (hl - 1) & 0xFFFF;
    if (a === 0x20) a = 0x30;
    bus.w8(dest, a); dest = (dest - 1) & 0xFFFF;
    n = (n - 1) & 0xFF;
  } while (n);
  return { a, b: buffer >> 8, c: 0, de: dest, hl, f: FZ | FN };
}

// TryMainMenuLinkHandshake (3B:5C53): only for the Link cell: the link message screen and TryEstablishLink (bank 7)
// until it answers (a partner already sending $C1 is tried at once, after 6 frames); an answer of failure shows its
// status message for up to 500 frames (A or B ends it); then the screen fades back to the stadium. Returns the
// flags of TryEstablishLink (C: no link) with its a; any other cell returns NC at once. The timer interrupt is
// left off.
export function* tryMainMenuLinkHandshake(P) {
  const { V, bus } = P;
  P.di(); bus.w8(rIF, 0); bus.w8(rIE, bus.u8(rIE) & 0x09); P.ei();
  if (V.menuCursorX !== LINK_CELL_X) return { a: V.menuCursorX, f: 0 };    // scf / ccf: NC (Z clear from the compare)
  if (V.menuCursorY !== LINK_CELL_Y) return { a: V.menuCursorY, f: 0 };
  P.di(); const rx = V.linkRxByte; P.ei();
  if (rx === LINK_RX_READY) {
    push(P, 0); push(P, P.cpu.bc);                           // wait_frames 6: WaitFramesCmd's frame, then WaitFrames
    yield* waitRom(P, 0, HOME.WaitFrames, { c: 6 });
    pop(P); pop(P);
    const r = yield* waitFarCall(P, TryEstablishLink);
    if (!(r.f & FC)) return r;
  }
  yield* waitFarCall(P, ShowLinkMessageScreen);
  const result = yield* waitFarCall(P, TryEstablishLink);
  push(P, result.a << 8 | result.f);
  if (result.f & FC) {
    const bank = V.wramBank;                                 // (ldh a, [hWramBank] / push af ... pop_wram_bank)
    push(P, bank << 8);
    yield* waitFarCall(P, ShowLinkStatusMessage, { a: bank, c: result.a ? 1 : 0 });
    popWramBank(P);
    // up to 500 frames: the counter lives in de, through the calls (as on the ROM)
    let de = 0x1F4;
    do {
      de = (yield* waitFarCall(P, AnimateLinkStatusPalette, { de })).de;
      withRomBank(P, BANK_MENU_LIB, () => updateAnimatedTiles(P));
      yield* advanceFrame(P);
      if (V.inputPressed & (PADF_A | PADF_B)) break;
      de = (de - 1) & 0xFFFF;
    } while (de);
  }
  beginFadeOut(P, 64);
  yield* callGen(P, waitFadeEnd(P, getRegs(P.cpu)));
  callHome(P, HOME.DisableLCDSafely);
  yield* farGen(P, BANK_MENU_LIB, resetScreenAndTextWindows(P, P.cpu.a));
  callHome(P, HOME.EnableLCD);
  beginFadeIn(P, 64);
  yield* callGen(P, waitFadeEnd(P, getRegs(P.cpu)));
  pop(P);
  return result;
}
// Unused_3b_RestoreScreenAfterLinkAttempt (3B:5CE1): the menu font and the stadium screen again, LCD off meanwhile,
// and a fade-in started.
export function* unusedRestoreScreenAfterLinkAttempt(P) {
  callHome(P, HOME.DisableLCDSafely);
  withRomBank(P, BANK_BOOT, () => loadMenuFontGfx(P));
  yield* farGen(P, BANK_MENU_LIB, resetScreenAndTextWindows(P, P.cpu.a));
  callHome(P, HOME.EnableLCD);
  beginFadeIn(P, 16);
}

export const HOOKS = [
  [BANK_MAIN_MENU, 0x55D1, hookGen(P => runMainMenu(P))],
  [BANK_MAIN_MENU, 0x56B0, hook((P, c) => mapMainMenuCursorToItemId(P, c.a))],
  [BANK_MAIN_MENU, 0x56C3, () => {}],                        // Unused_3b_StubNop_56c3
  [BANK_MAIN_MENU, 0x56C4, hookGen(P => loadMainMenuGfx(P))],
  [BANK_MAIN_MENU, 0x5800, hookGen((P, c) => mainMenuSlideIn(P, c.b))],
  [BANK_MAIN_MENU, 0x5832, hookGen((P, c) => mainMenuSlideOut(P, c.b))],
  [BANK_MAIN_MENU, 0x5863, hook((P, c) => mainMenuCursorSpriteTask(P, c.sp - 2))],
  [BANK_MAIN_MENU, 0x5968, hook(P => drawMainMenuSelection(P))],
  [BANK_MAIN_MENU, 0x5A09, hook((P, c) => { fillMainMenuCellHighlight(P, c.b, c.c); })],
  [BANK_MAIN_MENU, 0x5A57, hook((P, c) => loadMainMenuItemPalette(P, c.a))],
  [BANK_MAIN_MENU, 0x5AAC, hook((P, c) => buildSaveSlotSummaries(P, c.f, c.de))],
  [BANK_MAIN_MENU, 0x5B3E, hook((P, c) => drawMainMenuCaption(P, c.f))],
  [BANK_MAIN_MENU, 0x5C27, hook((P, c) => printNumberRightAligned(P, c.hl, c.de, c.bc, 2))],
  [BANK_MAIN_MENU, 0x5C2B, hook((P, c) => printNumberRightAligned(P, c.hl, c.de, c.bc, 0))],
  [BANK_MAIN_MENU, 0x5C52, () => {}],                        // Unused_3b_StubNop3
  [BANK_MAIN_MENU, 0x5C53, hookGen(P => tryMainMenuLinkHandshake(P))],
  [BANK_MAIN_MENU, 0x5CE1, hookGen(P => unusedRestoreScreenAfterLinkAttempt(P))],
];

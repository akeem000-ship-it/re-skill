// The name-entry screen ("Enter Name", bank $38): a 15 x 6 grid of letters (5 rows of 3 groups of 5) with DEL and
// END on the bottom row; A types the letter under the hand cursor (or acts on the bottom row), B deletes (or leaves
// on an empty name), SELECT deletes too. The name is typed into wNameEntryBuffer (WRAM 3) and stored into the story
// character's record.
// Port of the name-entry half of src/engine/menus/char_select/name_38.asm (RunNameEntryScreen on) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own.
// The name buffer's editing (AppendCharToName, DeleteLastNameChar, DrawEnteredName, ...) is link_sequence_38.asm,
// another part's, called through the ROM. Tables are read from the ROM.
// Covered by the lockstep on out/port/cs_story_new.mtrec (typing, deleting, the bottom row, cancelling both names,
// an empty name kept) and cs_story_new2.mtrec.
import {
  FZ, rd, wr, u8, idx, rom, FAR, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_TEXT, TILEMAP_WIDTH, VRAM_BANK1, vTiles0,
  vTiles2, vBGMap0, wShadowTilemap, wScreenAttrmap, OAM_BANK1, PADF_A, PADF_B, PADF_SELECT, PADF_RIGHT, PADF_LEFT,
  SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, TILEBLOCK_NameEntryGfx, NameEntryGfx_BLOCKS,
  TILEBLOCK_SharedMenuGfx17Alias17, SharedMenuGfx17_BLOCKS, TILEBLOCK_SharedMenuGfx72, SharedMenuGfx72_BLOCKS,
  SCREENASSET_NameEntry, wNameEntryBuffer_SIZE, sound, advanceFrame, fadeIn, fadeOut, registerFrameTask, withWram,
  queueMapRows, queueSprite, loadIndexedPalette, loadCompressedTileBlock, loadScreenAssetRecord, queueWram3MapToVRAM,
  getMenuCursorIndex, setMenuCursorFromIndex, disableLCDSafely, drawTextWindow, timerInterruptOff, timerInterruptOn,
  copyMemoryBC, w8, hook, hookGen,
} from "./defs.js";
import { UpdateAnimatedTilesTask_38, drawNameWithDiacritics } from "./matchtype.js";
import { TickMenuBgScrollTask_38 } from "./character.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks, printDecimalByte } from "../../home/debugtext.js";

export const BANK = 0x38;
const DrawNameEntryCursor = 0x7090, NameEntryCursorTable = 0x70A5, EnterNameText_38 = 0x7171;
export const NameEntryCharset_38 = 0x71B6;
const NameEntryBottomRowActionTable = 0x722D, SnapNameEntryCursorRightTable = 0x724C, SnapNameEntryCursorLeftTable = 0x726B;
const GRID_COLUMNS = 0x0F, GRID_ROWS = 6, BOTTOM_ROW = 5;
const ACTION_NONE = 0, ACTION_DELETE = 1;                  // (2: END)
const STORY_RECORD_PALETTE = 0x0C;                         // the name buffer's record + $0C: the character's palette
const nameBuffer = P => rom(P, FAR.GetActiveStoryNameBuffer).bc;

// RunNameEntryScreen (38:6E14): the screen for story character b (0 main, 1 partner) with mugshot c. Returns a = 0
// (the name stored; an empty one keeps the old name) or $FF (B on an empty name).
export function* runNameEntryScreen(P, slot, mugshot) {
  wr(P, "storyCharacterSlot", slot);
  P.wramBank(WRAM_COURT_PLANES);
  w8(P, wScreenAttrmap + 1, mugshot);
  disableLCDSafely(P);
  clearFrameTasks(P);
  setupNameEntryScreen(P);
  registerFrameTask(P, 1, UpdateAnimatedTilesTask_38);
  registerFrameTask(P, 1, DrawNameEntryCursor);
  registerFrameTask(P, 1, FAR.DrawNameEntryUnderlineSprites[1]);
  enableLCD(P);
  yield* fadeIn(P, 16);
  timerInterruptOff(P);
  registerFrameTask(P, 1, TickMenuBgScrollTask_38);
  for (;;) {
    // .redraw: the cursor moves with the pad
    printDecimalByte(P, 3, 3, rd(P, "menuCursorX"));     // (a debug readout of the column)
    wr(P, "menuInputPressed", P.V.inputPressed);
    if (rom(P, FAR.MoveMenuCursorGrid_38, { b: GRID_COLUMNS, c: GRID_ROWS }).a) handleNameEntryCursorMove(P);
    if (P.menuWheel && P.menuWheel.on) P.menuWheel.skin = { id: "name", at: P.frames, x: rd(P, "menuCursorX"), y: rd(P, "menuCursorY") };   // MENU: Wheel (menuskins.js), read only
    // .inputLoop: a frame, then the buttons (of the input read before it)
    yield* advanceFrame(P);
    const input = rd(P, "menuInputPressed");
    if (input & PADF_A) {
      if (rd(P, "menuCursorY") !== BOTTOM_ROW) { rom(P, FAR.AppendCharToName); continue; }
      const action = getNameEntryBottomRowAction(P);
      if (action === ACTION_NONE) sound(P, SFX_MENU_MOVE);
      else if (action !== ACTION_DELETE) return yield* acceptName(P);
      sound(P, SFX_MENU_CANCEL);
      rom(P, FAR.DeleteLastNameChar);
    } else if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      if (!withWram(P, WRAM_SCREEN, () => rd(P, "nameEntryBuffer"))) {
        sound(P, SFX_MENU_CANCEL);
        yield* fadeOut(P, 16);
        clearFrameTasks(P);
        timerInterruptOn(P);
        return { a: 0xFF };
      }
      rom(P, FAR.DeleteLastNameChar);
    } else if (input & PADF_SELECT) {
      sound(P, SFX_MENU_MOVE);                              // (.beep falls into .backspace)
      sound(P, SFX_MENU_CANCEL);
      rom(P, FAR.DeleteLastNameChar);
    }
  }
}
// .accept: a typed name (trailing spaces trimmed) into the record; an empty one: the record's name back into the
// buffer and redrawn for a frame first
function* acceptName(P) {
  const typed = withWram(P, WRAM_SCREEN, () => rd(P, "nameEntryBuffer"));
  P.wramBank(WRAM_SCREEN);
  if (typed) {
    rom(P, FAR.TrimTrailingSpacesFromName);
    copyMemoryBC(P, P.A.nameEntryBuffer, nameBuffer(P), wNameEntryBuffer_SIZE);
    sound(P, SFX_MENU_SELECT);
  } else {
    copyMemoryBC(P, nameBuffer(P), P.A.nameEntryBuffer, wNameEntryBuffer_SIZE);
    copyMemoryBC(P, P.A.nameEntryBuffer, nameBuffer(P), wNameEntryBuffer_SIZE);
    rom(P, FAR.DrawEnteredName);
    queueMapRows(P, wShadowTilemap, vBGMap0, 5, 2);
    yield* advanceFrame(P);
    sound(P, SFX_MENU_SELECT);
  }
  yield* fadeOut(P, 16);
  clearFrameTasks(P);
  timerInterruptOn(P);
  return { a: 0, f: FZ };
}
// SetupNameEntryScreen (38:6F6E): the screen with the LCD off: the hand cursor, the screen asset with three windows
// (the prompt, the letters, the name), the letters, the mugshot and its palette, the scrolling background, and the
// record's current name in the buffer
export function setupNameEntryScreen(P) {
  loadCompressedTileBlock(P, TILEBLOCK_NameEntryGfx, vTiles0 + 0x10 * 16 + VRAM_BANK1, NameEntryGfx_BLOCKS);
  rom(P, FAR.LoadMenuHandCursorGfx, { hl: vTiles0 + VRAM_BANK1, de: 0x0801 });
  setMenuCursorFromIndex(P, GRID_COLUMNS, 0);
  loadScreenAssetRecord(P, SCREENASSET_NameEntry);
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  P.wramBank(WRAM_TEXT);
  wr(P, "shadowTilemapBank", WRAM_SCREEN);
  wr(P, "windowTileAttr", 0);
  drawTextWindow(P, 0x00, 0x02, 0x14, 0x03);
  drawTextWindow(P, 0x00, 0x08, 0x14, 0x09);
  drawTextWindow(P, 0x06, 0x05, 0x09, 0x03);
  drawNameEntryCharGrid(P, NameEntryCharset_38);
  drawEnterNameLabel(P);
  loadIndexedPalette(P, 0x0A, 0x0C);
  withWram(P, WRAM_COURT_PLANES, () => {
    const mugshot = u8(P, wScreenAttrmap + 1);
    rom(P, FAR.LoadCharMugshotToBuffer, { a: mugshot });
    rom(P, FAR.CopyMugshotBufferToVram, { de: vTiles2 + 0x20 * 16 + VRAM_BANK1 });
    P.wramBank(WRAM_COURT_PLANES);
    rom(P, FAR.LoadIndexedPalette_18, { a: u8(P, nameBuffer(P) + STORY_RECORD_PALETTE), d: 0x04 });
  });
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  wr(P, "menuBgScrollTile", 0x10); wr(P, "menuBgScrollTile", 0x10, 1);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx72, vTiles0 + 0x10 * 16, SharedMenuGfx72_BLOCKS);
  withWram(P, WRAM_COURT_PLANES, () => {
    w8(P, wScreenAttrmap, 0);
    P.wramBank(WRAM_SCREEN);
    copyMemoryBC(P, nameBuffer(P), P.A.nameEntryBuffer, wNameEntryBuffer_SIZE);
  });
  rom(P, FAR.DrawEnteredName);
  queueWram3MapToVRAM(P);
}
// HandleNameEntryCursorMove (38:7072): the move sound; on the bottom row right/left snap to DEL or END
export function handleNameEntryCursorMove(P) {
  sound(P, SFX_MENU_MOVE);
  if (rd(P, "menuCursorY") !== BOTTOM_ROW) return;
  const input = P.V.inputPressed;
  if (input & PADF_RIGHT) snapNameEntryCursor(P, SnapNameEntryCursorRightTable);
  else if (input & PADF_LEFT) snapNameEntryCursor(P, SnapNameEntryCursorLeftTable);
}
// DrawNameEntryCursor (38:7090), a frame task: the hand at the cursor's letter (NameEntryCursorTable)
export function drawNameEntryCursor(P) {
  const at = idx(NameEntryCursorTable, getMenuCursorIndex(P, GRID_COLUMNS) * 2);
  queueNameEntryCursorSprites(P, P.bus.u8(at + 1) << 8 | P.bus.u8(at));
}
// DrawEnterNameLabel (38:7159): "Enter Name" on row 3
export function drawEnterNameLabel(P) {
  withWram(P, WRAM_SCREEN, () => drawNameWithDiacritics(P, EnterNameText_38, wShadowTilemap + 3 * TILEMAP_WIDTH + 1));
}
// DrawNameEntryCharGrid (38:717C): the charset at hl into rows 9 on of WRAM 3's map: each row 3 groups of a space
// and 5 letters, rows until a 0 after a row
export function drawNameEntryCharGrid(P, hl) {
  withWram(P, WRAM_SCREEN, () => {
    let de = wShadowTilemap + 9 * TILEMAP_WIDTH + 1;
    for (;;) {
      for (let group = 0; group < 3; group++) {
        w8(P, de++, 0x20);
        for (let i = 0; i < 5; i++) { w8(P, de++, u8(P, hl)); hl = (hl + 1) & 0xFFFF; }
      }
      if (!u8(P, hl)) break;
      de += TILEMAP_WIDTH - 18;
    }
  });
}
// GetNameEntryBottomRowAction (38:7220): the bottom row's action at the cursor's column (0 none, 1 DEL, 2 END)
export const getNameEntryBottomRowAction = P => P.bus.u8(idx(NameEntryBottomRowActionTable, rd(P, "menuCursorX")));
// SnapNameEntryCursorRight / Left (38:723C / 38:725B): the column moved to DEL (7) or END (10) on the bottom row
export function snapNameEntryCursor(P, table) { wr(P, "menuCursorX", P.bus.u8(idx(table, rd(P, "menuCursorX")))); }
// QueueNameEntryCursorSprites (38:727A): the hand, two 8x16 sprites (tiles 0 and 2, VRAM bank 1) at de
export function queueNameEntryCursorSprites(P, de) {
  queueSprite(P, OAM_BANK1, 0x00, de >> 8, de & 0xFF);
  queueSprite(P, OAM_BANK1, 0x02, ((de >> 8) + 8) & 0xFF, de & 0xFF);
}

export const HOOKS = [
  [BANK, 0x6E14, hookGen((P, c) => runNameEntryScreen(P, c.b, c.c))],
  [BANK, 0x6F6E, hook(P => setupNameEntryScreen(P))],
  [BANK, 0x7072, hook(P => handleNameEntryCursorMove(P))],
  [BANK, 0x7090, hook(P => drawNameEntryCursor(P))],
  [BANK, 0x7159, hook(P => drawEnterNameLabel(P))],
  [BANK, 0x717C, hook((P, c) => drawNameEntryCharGrid(P, c.hl))],
  [BANK, 0x7220, hook(P => ({ a: getNameEntryBottomRowAction(P) }))],
  [BANK, 0x723C, hook(P => snapNameEntryCursor(P, SnapNameEntryCursorRightTable))],
  [BANK, 0x725B, hook(P => snapNameEntryCursor(P, SnapNameEntryCursorLeftTable))],
  [BANK, 0x727A, hook((P, c) => queueNameEntryCursorSprites(P, c.de))],
];

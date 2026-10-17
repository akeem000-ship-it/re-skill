// The results screen's player panel, characters and "Continue?" prompt (bank $1E): the story player's name and level
// in the left box, the characters (the player's, in doubles also the partner) celebrating on the right, and the
// prompt: up / down picks yes or no, A on "yes" continues (a = 1); "no" turns the page to the save warning, where
// "yes" quits (a = 0) and "no" goes back; B quits from the first page ($FF) or goes back from the second.
// Port of the code of src/engine/menus/results/results_prompt_1e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Maps and tables are read from the ROM.
// Covered by the lockstep on out/engine/exh1.mtrec, rec1.mtrec and the out/port/xr_* recordings.
import {
  FZ, FN, FC, rd, wr, u8, w8, ix, far, rom, FAR, hook, hookGen, testFlag, sound, advanceFrame, queueVRAMCopy, queueSprite,
  formatDecimalNumberUnsigned, romByte, regs8, BANK_EXP, BANK_RANKING, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN,
  WRAM_SCENE, WRAM_ACTORS, WRAM_CHAR0, WRAM_CHAR2, TILE_SIZE, VRAM_BANK1, vTiles0, vBGMap0, wDecompBuffer, wShadowTilemap,
  wScreenAttrmap, wTextBuffer, OAM_BANK1, PADF_A, PADF_B, PADF_UP, PADF_DOWN, SFX_MENU_MOVE, SFX_MENU_SELECT,
  SFX_MENU_CANCEL, MENUSLIDE_BACK, GAMEMODE, FLAG, CHAR, CHARANIM_CELEBRATE, cell,
} from "../exp/defs.js";
import { decompressData } from "../../home/decompress.js";
import { loadIndexedPaletteThunk } from "../ranking/board.js";
import {
  drawProportionalTextLine, copyStringToTextBuffer, writeTextToTilemap, fetchAndDrawDialogueText,
  drawContinuePromptText, drawSaveWarningTextLine1, drawSaveWarningTextLine2,
} from "./results_text.js";
import { fillMemoryC } from "./results_screen.js";

export const BANK = BANK_EXP;
// ROM data (bank $1E)
const ResultsPlayerPanelTilemap_1e = 0x5405, ResultsPlayerPanelAttrmap_1e = 0x5421;
const UpdateResultsCharSpriteTable = 0x4B24;
const Text_31_224 = 0x04E0, Text_31_228 = 0x04E4, Text_31_234 = 0x04EA;
const hInputRisingEdge = 0xFF94;
const TEXT_ROW = 0x0020, BLANK = 0x20, PANEL_ATTR = 0x04, PANEL_ATTRS_AT = 0xC8;
const CHAR_ROWS = [[0, 0x0F, vTiles0 + VRAM_BANK1, 0x00, 7], [2, 0x0E, vTiles0 + 0x10 * TILE_SIZE + VRAM_BANK1, 0x10, 6]];

// ClearRoundLabelRow (1E:4867): the round label's row (14, columns 10-18) blanked, the window edge above restored.
// Leaves WRAM 3 mapped.
export function clearRoundLabelRow(P) {
  P.wramBank(WRAM_SCREEN);
  P.bus.w8(cell(wShadowTilemap, 13, 10), 0x03);
  for (let i = 0; i < 9; i++) P.bus.w8(cell(wShadowTilemap, 14, 10 + i), BLANK);
  return { a: BLANK, hl: cell(wShadowTilemap, 14, 18) };
}
// DrawPracticeMatchLabel (1E:4881) / DrawMarioExhibitionLabel (1E:488E)
export const drawPracticeMatchLabel = P => drawProportionalTextLine(P, Text_31_224, cell(wScreenAttrmap, 14, 11));
export const drawMarioExhibitionLabel = P => drawProportionalTextLine(P, Text_31_234, cell(wScreenAttrmap, 14, 1));
// DrawPlayerNameAndLevel (1E:489B): outside the exhibition, the left box (rows 5-9): its frame from
// ResultsPlayerPanelTilemap/Attrmap (decompressed into WRAM 1, the attributes $C8 bytes after the tiles), the story
// player's name and "Lv" with its level, attribute 4
export function drawPlayerNameAndLevel(P) {
  if (P.V.gameMode === GAMEMODE.EXHIBITION) return { a: GAMEMODE.EXHIBITION, f: FZ };
  P.wramBank(WRAM_STAGING);
  decompressData(P, ResultsPlayerPanelTilemap_1e, wDecompBuffer);
  decompressData(P, ResultsPlayerPanelAttrmap_1e, wDecompBuffer + 12 * TILE_SIZE + 8);
  let r = copyTilesAndAttrsRun(P, wDecompBuffer, wDecompBuffer + 10 * TILE_SIZE, 8);
  for (let row = 6; row <= 9; row++) r = copyTilesAndAttrsRun(P, r.hl, cell(wScreenAttrmap, row, 0), 8);
  P.wramBank(WRAM_SCREEN);
  for (let row = 5; row <= 8; row++) fill7Bytes(P, cell(wShadowTilemap, row, 0), BLANK);
  copyStringToTextBuffer(P, P.A.storyModeNameOfMainCharacter);
  writeTextToTilemap(P, cell(wShadowTilemap, 6, 0), 0, TEXT_ROW);
  fetchAndDrawDialogueText(P, Text_31_228, cell(wShadowTilemap, 8, 1), TEXT_ROW);
  formatDecimalNumberUnsigned(P, P.V.storyMainCharExpTier, 2, wTextBuffer);
  writeTextToTilemap(P, cell(wShadowTilemap, 8, 4), 0, TEXT_ROW);
  P.wramBank(WRAM_COURT_PLANES);
  let f;
  for (let row = 5; row <= 8; row++) f = fill7Bytes(P, cell(wScreenAttrmap, row, 0), PANEL_ATTR);
  return f;
}
// Fill7Bytes (1E:495A): 7 bytes of a from hl (hl left on the last)
export function fill7Bytes(P, hl, a) {
  for (let i = 0; i < 7; i++) P.bus.w8(hl + i, a);
  return { hl: (hl + 6) & 0xFFFF };
}
// CopyTilesAndAttrsRun (1E:4962): c cells: the tile at hl and the attribute $C8 bytes after it (WRAM 1) to de in
// WRAM 3 and WRAM 2
export function copyTilesAndAttrsRun(P, hl, de, c) {
  let b = 0, carry = 0;
  for (let n = c || 0x100; n > 0; n--) {
    P.wramBank(WRAM_STAGING); b = P.bus.u8(hl);
    P.wramBank(WRAM_SCREEN); P.bus.w8(de, b);
    P.wramBank(WRAM_STAGING); b = P.bus.u8((hl + PANEL_ATTRS_AT) & 0xFFFF);
    carry = (hl & 0xFF) + PANEL_ATTRS_AT > 0xFF ? FC : 0;
    P.wramBank(WRAM_COURT_PLANES); P.bus.w8(de, b);
    hl = (hl + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
  }
  return { a: b, b, c: 0, f: FZ | FN | carry, hl, de };          // (`dec c`; C from the last `add l`)
}
// InitResultsScreenCharacters (1E:498F): this side's character (struct bank 4, 5 for the link's second player: the
// story character's overworld sprite in story mode) celebrating, OBJ palette 7, tiles at $8000 (bank 1); with the
// prompt kind set or in doubles also the partner (bank 6 / 7), palette 6, tiles at $8100. Leaves WRAM 4 mapped.
export function initResultsScreenCharacters(P) {
  const side = P.V.linkMatchRole >> 1;
  initResultsChar(P, (side + WRAM_ACTORS) & 0xFF, side, false);
  P.wramBank(WRAM_SCENE);
  if (!rd(P, "continuePromptKind")) {
    P.wramBank(WRAM_ACTORS);
    if (!testFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN)) return {};
  }
  initResultsChar(P, (side + 6) & 0xFF, side, true);
  P.wramBank(WRAM_CHAR0);
  return {};
}
function initResultsChar(P, bank, side, partner) {
  const V = P.V;
  P.wramBank(bank);
  let d, e;
  if (V.gameMode === 0) {
    d = partner ? V.storyModePartnerCharacterOverworldSprite : V.storyModeMainCharacterOverworldSprite;
    e = partner ? V.storyModePartnerCharacterOverworldSpriteColor : V.storyModeMainCharacterOverworldSpriteColor;
  } else if (!side) {
    d = partner ? V.player1CurrentPartnerCharacter : V.player1CurrentMainCharacter;
    e = partner ? V.player1PartnerPalette : V.player1MainPalette;
  } else {
    d = partner ? V.player2CurrentPartnerCharacter : V.player2CurrentMainCharacter;
    e = partner ? V.player2PartnerPalette : V.player2MainPalette;
  }
  const [slot, attr, vram, tileBase, palette] = CHAR_ROWS[partner ? 1 : 0];
  rom(P, FAR.InitChar, { a: slot, bc: CHAR.PosX, d, e });
  w8(P, CHAR.SpriteAttr, attr);
  P.bus.w16(CHAR.FrameVramDest, vram);
  w8(P, CHAR.TileBase, tileBase);
  rom(P, FAR.SetCharAnimation, { bc: CHAR.PosX, d: CHARANIM_CELEBRATE, e: vram & 0xFF, hl: CHAR.TileBase });
  const index = rom(P, FAR.GetCharPaletteIndex, { a: d }).a;
  far(P, BANK_RANKING, () => loadIndexedPaletteThunk(P, index, 8 + palette, 1));
}
// DrawResultsCharSprites (1E:4A76), a frame task: the player's character (WRAM 4) and in doubles the partner (WRAM 6)
export function drawResultsCharSprites(P) {
  P.wramBank(WRAM_CHAR0);
  rom(P, FAR.DrawCharSprite, { ...updateResultsCharSprite(P, 0), hl: CHAR.SpriteSlot });
  P.wramBank(WRAM_CHAR0);
  if (!testFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN)) return {};
  P.wramBank(WRAM_CHAR2);
  rom(P, FAR.DrawCharSprite, { ...updateResultsCharSprite(P, 1), hl: CHAR.SpriteSlot });
  P.wramBank(WRAM_CHAR0);
  return {};
}
// UpdateResultsCharSprite (1E:4AA8): the mapped character's next frame facing front; its sprite slot (tile base,
// attribute, y, x, the frame's three bytes, and $80 + the step's e / 32: the ROM pops a pushed de into af there) and
// its screen position: the middle (singles) or left of the right half, or (a = 1) its right
export function updateResultsCharSprite(P, a) {
  const step = rom(P, FAR.StepCharAnimation, { a, bc: CHAR.PosX, hl: CHAR.PosX });
  rom(P, FAR.ReloadCharFacingTiles, { ...regs8(step), d: 0 });
  let b = romByte(P, ix(UpdateResultsCharSpriteTable, 0));
  if (a ? P.V.player2MainLeftHanded : P.V.player1MainLeftHanded) b ^= 0x20;
  const c = u8(P, CHAR.TileBase);
  b = (u8(P, CHAR.TileBase + 1) | b) & 0xFF;
  const d = a ? 0x60 : testFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN) ? 0x48 : 0x54, e = 0x56;
  w8(P, CHAR.ScreenX, d); w8(P, CHAR.ScreenY, e);
  const hl = CHAR.SpriteSlot;
  const top = ((step.e << 3) >> 8) & 0xFF;                           // h of (0, e) x 8
  const bytes = [c, b, e, d, u8(P, CHAR.SpriteFrame + 2), u8(P, CHAR.SpriteFrame + 1), u8(P, CHAR.SpriteFrame), (top + 0x80) & 0xFF];
  bytes.forEach((v, i) => w8(P, hl + i, v));
  return { a: bytes[7], b, c, d, e, hl: hl + 8 };
}
// RunContinuePrompt (1E:4B2C): the prompt's loop (see the header). The result in wContinuePromptResult.
export function* runContinuePrompt(P) {
  for (;;) {
    drawContinuePromptCursor(P);
    yield* advanceFrame(P);
    const edge = P.bus.u8(hInputRisingEdge);
    if (edge & (PADF_UP | PADF_DOWN)) {                              // .playSfx
      sound(P, SFX_MENU_MOVE);
      P.wramBank(WRAM_SCENE);
      wr(P, "continuePromptRow", rd(P, "continuePromptRow") ^ 1);
    } else if (edge & PADF_A) {                                      // .playSfx2
      sound(P, SFX_MENU_SELECT);
      P.wramBank(WRAM_SCENE);
      const page = rd(P, "continuePromptPage"), row = rd(P, "continuePromptRow");
      if (!row) { wr(P, "continuePromptResult", page ? (page + 0xFF) & 0xFF : 1); return { a: page ? (page - 1) & 0xFF : 1 }; }
      wr(P, "continuePromptPage", page ? 0 : 1);
      refreshContinuePromptText(P);
    } else if (edge & PADF_B) {                                      // .playSfx3
      sound(P, SFX_MENU_CANCEL);
      P.wramBank(WRAM_SCENE);
      if (!rd(P, "continuePromptPage")) {
        wr(P, "continuePromptResult", 0xFF);
        P.V.menuSlideDirection = MENUSLIDE_BACK;
        return { a: MENUSLIDE_BACK };
      }
      wr(P, "continuePromptPage", 0);
      refreshContinuePromptText(P);
    }
  }
}
// DrawContinuePromptCursor (1E:4B46): the cursor at "yes" or "no"
export function drawContinuePromptCursor(P) {
  P.wramBank(WRAM_SCENE);
  const y = rd(P, "continuePromptRow") ? 0x44 : 0x3C;
  return { b: OAM_BANK1, c: 0x8E, d: 0x7A, e: y, ...queueSprite(P, OAM_BANK1, 0x8E, 0x7A, y) };
}
// RefreshContinuePromptText (1E:4BCA): the prompt window's text for the page ("Continue?" / the save warning), the
// cursor on "yes" / "no", the window's rows queued
export function refreshContinuePromptText(P) {
  const page = rd(P, "continuePromptPage");
  wr(P, "continuePromptRow", page ? 1 : 0);
  clearContinuePromptRows(P);
  if (!page) drawContinuePromptText(P, (P.A.continuePromptTilemapRow2 + 1) & 0xFFFF);
  else {
    drawSaveWarningTextLine1(P, (P.A.continuePromptTilemapRow1 + 1) & 0xFFFF);
    drawSaveWarningTextLine2(P, (P.A.continuePromptTilemapRow3 + 1) & 0xFFFF);
  }
  queueVRAMCopy(P, P.A.continuePromptKind, vBGMap0, 8);              // (the map's rows 0-3 in WRAM 3)
  P.wramBank(WRAM_SCENE);
  return {};
}
// ClearContinuePromptRows (1E:4C15): the prompt window's top edge and three rows blanked (WRAM 3, left mapped)
export function clearContinuePromptRows(P, f = 0) {
  P.wramBank(WRAM_SCREEN);
  fillMemoryC(P, cell(wShadowTilemap, 0, 1), 0x03, 0x12);
  for (let row = 1; row <= 3; row++) fillMemoryC(P, cell(wShadowTilemap, row, 1), BLANK, 0x12);
  return { a: BLANK, hl: cell(wShadowTilemap, 3, 19), c: 0, f: FZ | FN | (f & FC) };
}

export const HOOKS = [
  [BANK, 0x4867, hook(P => clearRoundLabelRow(P))],
  [BANK, 0x4881, hook(P => drawPracticeMatchLabel(P))],
  [BANK, 0x488E, hook(P => drawMarioExhibitionLabel(P))],
  [BANK, 0x489B, hook(P => { drawPlayerNameAndLevel(P); })],
  [BANK, 0x495A, hook((P, c) => fill7Bytes(P, c.hl, c.a))],
  [BANK, 0x4962, hook((P, c) => copyTilesAndAttrsRun(P, c.hl, c.de, c.c))],
  [BANK, 0x498F, hook(P => { initResultsScreenCharacters(P); })],
  [BANK, 0x4A76, hook(P => { drawResultsCharSprites(P); })],
  [BANK, 0x4AA8, hook((P, c) => updateResultsCharSprite(P, c.a))],
  [BANK, 0x4B2C, hookGen(P => runContinuePrompt(P))],
  [BANK, 0x4B46, hook(P => drawContinuePromptCursor(P))],
  [BANK, 0x4BCA, hook(P => { refreshContinuePromptText(P); })],
  [BANK, 0x4C15, hook((P, c) => clearContinuePromptRows(P, c.f))],
];

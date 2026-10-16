// The EXP award screen (bank $1E): the results screen's EXP part. A message window at the top ("You got EXP!" and
// the award's line), the player's (or in doubles both characters') panel with name and level and the characters
// celebrating, and the total EXP counted up in digit sprites; the pending awards are shown one after another
// (award_sequence.js). Returns the total.
// Port of the code of src/engine/menus/exp/award_screen_1e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Graphics, maps and tables are read from
// the ROM.
// Covered by the lockstep on out/engine/rec2.mtrec and the out/port/xr_* recordings (xr_award: singles and doubles,
// four awards, a five-digit total), and by web/tests/port/routines_menus_exp.mjs.
import {
  FZ, FN, FC, rd, wr, u8, w8, ix, far, rom, romWait, home, HOME, FAR, hook, hookGen, romWord, romByte, testFlag, advanceFrame,
  waitFrames, fadeIn, fadeOut, registerFrameTask, unregisterFrameTask, queueVRAMCopy, queueSprite,
  formatDecimalNumberUnsigned, resetScrollAndCamera, BANK_EXP, BANK_BOOT, BANK_CHARS, WRAM_STAGING, WRAM_COURT_PLANES,
  WRAM_SCREEN, WRAM_SCENE, WRAM_ACTORS, WRAM_CHAR0, TILE_SIZE, TILEMAP_WIDTH, SCREEN_HEIGHT, VRAM_BANK1, vTiles0, vTiles1,
  vTiles2, vBGMap0, wDecompBuffer, wTextTileBuffer, wTextTileBuffer_BLOCKS, wShadowTilemap, wScreenAttrmap, wTextBuffer,
  CHAR, CHARREC_NAME, CHARREC_LEVEL, LINKSTATE_SLAVE, FLAG, rWY, cell, regs8,
} from "./defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { clearSpriteQueue } from "../../home/fade.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { loadMenuFontGfx } from "../main_menu/boot.js";
import { hasPendingExpAwards, runExpAwardSequence, getDigitSpriteTile } from "./award_sequence.js";
import {
  copyStringToTextBuffer, writeTextToTilemap, fetchAndDrawDialogueText, drawProportionalTextLine,
} from "../results/results_text.js";
import { initResultsScreenCharacters } from "../results/results_prompt.js";

export const BANK = BANK_EXP;
// ROM data (bank $1E)
const PanelFrameGfx_1e = 0x5343, PanelFrameGfx_BLOCKS = 0x10;
const ExpAwardScreenPalettes0 = 0x5BE1, ExpAwardScreenGfx_1e = 0x5BF9, ExpAwardScreenTilemap_1e = 0x62CA;
const ExpAwardScreenAttrmap_1e = 0x644F, ExpAwardScreenPalettes1 = 0x6495, ExpDigitSpriteGfx_1e = 0x649D;
const ExpDigitSpriteGfx_BLOCKS = 0x14, ExpAwardScreenGfx_BLOCKS = 128;   // (128 of its 256 tiles)
const UpdateExpScreenCharSpriteTable = 0x59B3, DrawNextExpAwardMessageTable = 0x5A44;
const DrawExpScreenCharSprites = 0x5914, DrawExpTotalDigits = 0x5A4E;   // frame tasks
const Text_31_199 = 0x04C7, Text_31_200 = 0x04C8, Text_31_228 = 0x04E4, Text_31_231 = 0x04E7;
const SCREEN_MAP_BYTES = 0x240, AWARDS = 5, TEXT_ROW = 0x0020;
const BLANK = 0x20, DIGIT_ZERO = 0x30;

// ShowExpAwardScreen (1E:5438): when an award is pending, the screen (fade in, the awards, fade out). Returns hl =
// the total EXP awarded (and a = 0 when nothing was pending).
export function* showExpAwardScreen(P) {
  const pending = hasPendingExpAwards(P);
  if (!pending.a) return pending;
  far(P, BANK_BOOT, () => loadMenuFontGfx(P));
  rom(P, FAR.InitTextWindows);
  P.V.shadowTilemapBank = WRAM_SCREEN;
  rom(P, FAR.PrepareGlyphBuffer);
  clearFrameTasks(P);
  home(P, HOME.DisableLCDSafely);
  resetScrollAndCamera(P);
  P.bus.w8(rWY, 0x90);
  clearSpriteQueue(P);
  rom(P, FAR.InitActorEngine);
  initExpAwardScreenState(P);
  yield* buildExpAwardScreenTilemap(P);
  initResultsScreenCharacters(P);
  enableLCD(P);
  yield* advanceFrame(P);
  registerFrameTask(P, 1, DrawExpScreenCharSprites);
  registerFrameTask(P, 1, DrawExpTotalDigits);
  yield* fadeIn(P, 16);
  yield* waitFrames(P, 20);
  yield* runExpAwardSequence(P);
  yield* fadeOut(P, 16);
  unregisterFrameTask(P, DrawExpScreenCharSprites);
  unregisterFrameTask(P, DrawExpTotalDigits);
  P.wramBank(WRAM_SCENE);
  return { hl: P.bus.u16(P.A.expAwardRunningTotal) };
}
// InitExpAwardScreenState (1E:54BB): the screen's state (WRAM 6 from wExpAwardScreenState): zeros (the total, the
// award index), two blank number buffers ("    0"), the prompt kind 1
export function initExpAwardScreenState(P) {
  P.wramBank(WRAM_SCENE);
  let hl = P.A.expAwardScreenState;
  for (const [a, d] of [[0, 5], [BLANK, 4], [DIGIT_ZERO, 1], [0, 0x0B], [BLANK, 4], [DIGIT_ZERO, 1], [0, 0x0A]]) hl = fillMemoryD(P, hl, a, d).hl;
  wr(P, "continuePromptKind", 1);
  return { a: 1, hl };
}
// FillMemoryD (1E:54F0): d bytes of a from hl
export function fillMemoryD(P, hl, a, d, f = 0) {
  for (let n = d || 0x100; n > 0; n--) { P.bus.w8(hl, a); hl = (hl + 1) & 0xFFFF; }
  return { hl, d: 0, f: FZ | FN | (f & FC) };                        // (`dec d`: C kept)
}
// BuildExpAwardScreenTilemap (1E:54F5): graphics, panels, both maps queued (18 rows)
export function* buildExpAwardScreenTilemap(P) {
  loadExpAwardScreenGraphics(P);
  yield* drawExpAwardScreenPanels(P);
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap0, SCREEN_HEIGHT * TILEMAP_WIDTH / 16);
  P.wramBank(WRAM_COURT_PLANES);
  return queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, SCREEN_HEIGHT * TILEMAP_WIDTH / 16);
}
// LoadExpAwardScreenGraphics (1E:551E): palettes, the screen's tiles and the text tiles, its maps (WRAM 3 / 2), the
// panel frame tiles, the digit sprites
export function loadExpAwardScreenGraphics(P) {
  loadPaletteShadow(P, ExpAwardScreenPalettes0, 0, 3);
  P.wramBank(WRAM_STAGING);
  decompressData(P, ExpAwardScreenGfx_1e, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + VRAM_BANK1, ExpAwardScreenGfx_BLOCKS);
  queueVRAMCopy(P, wTextTileBuffer, vTiles1 + VRAM_BANK1, wTextTileBuffer_BLOCKS);
  P.wramBank(WRAM_STAGING);
  decompressData(P, ExpAwardScreenTilemap_1e, wDecompBuffer);
  expScreenCopyToTilemap(P, wDecompBuffer, SCREEN_MAP_BYTES);
  P.wramBank(WRAM_STAGING);
  decompressData(P, ExpAwardScreenAttrmap_1e, wDecompBuffer);
  expScreenCopyToAttrmap(P, wDecompBuffer, SCREEN_MAP_BYTES);
  P.wramBank(WRAM_STAGING);
  decompressData(P, PanelFrameGfx_1e, wDecompBuffer);
  queueVRAMCopy(P, wDecompBuffer, vTiles2, PanelFrameGfx_BLOCKS);
  loadPaletteShadow(P, ExpAwardScreenPalettes1, 8, 1);
  P.wramBank(WRAM_STAGING);
  decompressData(P, ExpDigitSpriteGfx_1e, wDecompBuffer);
  return queueVRAMCopy(P, wDecompBuffer, vTiles0 + 0x6C * TILE_SIZE + VRAM_BANK1, ExpDigitSpriteGfx_BLOCKS);
}
// ExpScreenCopyToTilemap (1E:55BA) / ExpScreenCopyToAttrmap (1E:55CF): bc bytes at hl from WRAM 1 to the same
// address in WRAM 3 / WRAM 2
export const expScreenCopyToTilemap = (P, hl, bc) => copyWram1To(P, WRAM_SCREEN, hl, bc);
export const expScreenCopyToAttrmap = (P, hl, bc) => copyWram1To(P, WRAM_COURT_PLANES, hl, bc);
export function copyWram1To(P, bank, hl, bc) {
  let d = 0;
  do {
    P.wramBank(WRAM_STAGING); d = P.bus.u8(hl);
    P.wramBank(bank); P.bus.w8(hl, d);
    hl = (hl + 1) & 0xFFFF; bc = (bc - 1) & 0xFFFF;
  } while (bc);
  return { a: 0, f: FZ, d, hl, bc: 0 };
}
// DrawExpAwardScreenPanels (1E:55E4): the message window with the first award's message, the total's panel, the
// player's panel (doubles: both characters')
export function* drawExpAwardScreenPanels(P) {
  drawExpMessageWindow(P);
  yield* drawNextExpAwardMessage(P);
  drawExpTotalPanel(P);
  if (!testFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN)) return drawExpSinglesPlayerPanel(P);
  drawExpDoublesPlayerPanel(P);
  return drawExpDoublesPartnerPanel(P);
}
// a framed box: rows of [tile, count] runs from (row, col) (FillTilemapRun, attribute 0)
function box(P, row, col, rows, f = 0) {
  let r;
  rows.forEach((runs, i) => { let hl = cell(wShadowTilemap, row + i, col); for (const [b, c] of runs) { r = fillTilemapRun(P, hl, b, c, f); hl = r.hl; } });
  return r;
}
const frame = (inner, rows) => [[[2, 1], [3, inner], [4, 1]], ...Array(rows).fill([[5, 1], [BLANK, inner], [6, 1]]), [[7, 1], [8, inner], [9, 1]]];
// the player's name (bc: a character record) and "Lv" with its level, at the name cell and level row of a panel
function drawNameAndLevel(P, bc, nameCell, labelCell, levelCell) {
  copyStringToTextBuffer(P, (bc + CHARREC_NAME) & 0xFFFF);
  writeTextToTilemap(P, nameCell, 0x00, TEXT_ROW);
  fetchAndDrawDialogueText(P, Text_31_228, labelCell, TEXT_ROW);
  formatDecimalNumberUnsigned(P, u8(P, bc + CHARREC_LEVEL), 2, wTextBuffer);
  return writeTextToTilemap(P, levelCell, 0x00, TEXT_ROW);
}
// the player's record: player 1's, the second player's on the link's slave side (with its level from the link)
function playerRecord(P, story, partner) {
  if (story) return partner ? P.A.storyModeNameOfPartnerCharacter : P.A.storyModeNameOfMainCharacter;
  if (P.V.linkMatchRole !== LINKSTATE_SLAVE) return partner ? P.A.player1PartnerName : P.A.player1MainName;
  if (!partner) P.V.player2MainExpTier = P.V.linkMatchCharLevel;
  return partner ? P.A.player2PartnerName : P.A.player2MainName;
}
// DrawExpSinglesPlayerPanel (1E:55FD): the player's panel, one row (name, "Lv", level)
export function drawExpSinglesPlayerPanel(P) {
  box(P, 5, 3, [[[2, 1], [3, 12], [4, 1]], [[5, 1], [BLANK, 12], [6, 1]], [[7, 1], [8, 12], [9, 1]]]);
  return drawNameAndLevel(P, playerRecord(P, false, false), cell(wShadowTilemap, 6, 4), cell(wShadowTilemap, 6, 12),
    cell(wShadowTilemap, 6, 14));
}
// DrawExpDoublesPlayerPanel (1E:5693) / DrawExpDoublesPartnerPanel (1E:5758): the left / right panel in doubles
// (the story's characters in story mode)
export function drawExpDoublesPlayerPanel(P) {
  box(P, 5, 0, frame(7, 3));
  return drawNameAndLevel(P, playerRecord(P, P.V.gameMode === 0, false), cell(wShadowTilemap, 6, 1),
    cell(wShadowTilemap, 8, 1), cell(wShadowTilemap, 8, 4));
}
export function drawExpDoublesPartnerPanel(P) {
  box(P, 5, 11, frame(7, 3));
  return drawNameAndLevel(P, playerRecord(P, P.V.gameMode === 0, true), cell(wShadowTilemap, 6, 12),
    cell(wShadowTilemap, 8, 12), cell(wShadowTilemap, 8, 15));
}
// DrawExpTotalPanel (1E:5814): the total's label box and its number box
export function drawExpTotalPanel(P) {
  box(P, 14, 2, [[[2, 1], [3, 8], [4, 1], [2, 1], [3, 4], [4, 1]], [[5, 1], [BLANK, 8], [6, 1], [5, 1], [BLANK, 4], [6, 1]],
    [[7, 1], [8, 8], [9, 1], [7, 1], [8, 4], [9, 1]]]);
  return fetchAndDrawDialogueText(P, Text_31_231, cell(wShadowTilemap, 15, 3), TEXT_ROW);
}
// DrawExpMessageWindow (1E:5896): the message window (20 x 5) at the top
export function drawExpMessageWindow(P, f = 0) { return box(P, 0, 0, frame(0x12, 3), f); }
// FillTilemapRun (1E:5900): c cells of tile b (attribute 0) from hl. Leaves WRAM 2 mapped.
export function fillTilemapRun(P, hl, b, c, f = 0) {
  for (let n = c || 0x100; n > 0; n--) {
    P.wramBank(WRAM_SCREEN); P.bus.w8(hl, b);
    P.wramBank(WRAM_COURT_PLANES); P.bus.w8(hl, 0);
    hl = (hl + 1) & 0xFFFF;
  }
  return { a: 0, c: 0, f: FZ | FN | (f & FC), hl };               // (`dec c`: C kept)
}

// ---- the sprites ----
// DrawExpScreenCharSprites (1E:5914), a frame task: this side's character (WRAM 4, or 5 for the link's second
// player) celebrating, and in doubles its partner (two banks on)
export function drawExpScreenCharSprites(P) {
  let b = WRAM_ACTORS;
  if (P.V.linkMatchRole) b = (b + (P.V.linkMatchRole >> 1)) & 0xFF;
  P.wramBank(b);
  rom(P, FAR.DrawCharSprite, { ...updateExpScreenCharSprite(P, 0), hl: CHAR.SpriteSlot });
  P.wramBank(WRAM_ACTORS);
  if (!testFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN)) return {};
  P.wramBank((b + 2) & 0xFF);
  rom(P, FAR.DrawCharSprite, { ...updateExpScreenCharSprite(P, 1), hl: CHAR.SpriteSlot });
  P.wramBank(WRAM_CHAR0);
  return {};
}
// UpdateExpScreenCharSprite (1E:5954): the mapped character's next animation frame, facing front, its sprite slot
// (tile base, attribute: its own | 8, mirrored for a left-hander, x, y) at the left (doubles) or middle (singles)
// panel, or (a = 1) the right one
export function updateExpScreenCharSprite(P, a) {
  const step = rom(P, FAR.StepCharAnimation, { a, bc: CHAR.PosX, hl: CHAR.PosX });
  w8(P, CHAR.FacingOctant, 0);
  rom(P, FAR.ReloadCharFacingTiles, { ...regs8(step), a: 0, d: 0 });
  const facing = u8(P, CHAR.FacingOctant);
  let b = ((u8(P, CHAR.SpriteAttr) | 0x08) ^ romByte(P, ix(UpdateExpScreenCharSpriteTable, facing))) & 0xFF;
  if (a ? P.V.player2MainLeftHanded : P.V.player1MainLeftHanded) b ^= 0x20;
  const c = u8(P, CHAR.TileBase);
  const d = a ? 0x5C : testFlag(P, FLAG.TEMP_RESULTS_SCREEN_OPEN) ? 0x44 : 0x50, e = 0x66;
  const hl = CHAR.SpriteSlot;
  [c, b, e, d].forEach((v, i) => w8(P, hl + i, v));
  return { a: e, b, c, d, e, hl: hl + 3 };
}
// DrawNextExpAwardMessage (1E:59BB): the message of the next pending award from wExpAwardIndex on (those of 0 EXP
// skipped): "You got EXP" (or "You got more EXP" once some is counted), the award's line (its text by award and
// variant), the glyphs uploaded. Returns a = 1 and bc = the amount, or a = 0 when no award is left.
export function* drawNextExpAwardMessage(P) {
  for (;;) {
    P.wramBank(WRAM_SCENE);
    const index = rd(P, "expAwardIndex");
    if (index === AWARDS) { yield* romWait(P, FAR.UploadGlyphBuffer); return { a: 0, f: FZ }; }
    const amount = P.bus.u16(ix(P.A.pendingExpAwardAmounts, index * 2));
    if (!amount) { wr(P, "expAwardIndex", index + 1); continue; }   // .zero
    const variant = P.bus.u8(ix(P.A.pendingExpAwardVariants, index));
    const text = ix(romWord(P, ix(DrawNextExpAwardMessageTable, index * 2)), variant);
    drawExpMessageWindow(P);
    P.wramBank(WRAM_SCENE);
    const first = P.bus.u16(P.A.expAwardRunningTotal) ? Text_31_200 : Text_31_199;
    drawProportionalTextLine(P, first, cell(wScreenAttrmap, 1, 2), TEXT_ROW);
    drawProportionalTextLine(P, text, cell(wScreenAttrmap, 3, 2), TEXT_ROW);
    const r = yield* romWait(P, FAR.UploadGlyphBuffer, { bc: amount });
    return { a: 1, bc: r.bc };
  }
}
// DrawExpTotalDigits (1E:5A4E), a frame task: the running total in digit sprites, 4 digits (5 from 10000)
export function drawExpTotalDigits(P) {
  P.wramBank(WRAM_SCENE);
  formatDecimalNumberUnsigned(P, P.bus.u16(P.A.expAwardRunningTotal), 4, wTextBuffer);
  const five = P.bus.u8(wTextBuffer + 4) !== 0, xs = five ? [0x67, 0x6F, 0x77, 0x7F, 0x87] : [0x6B, 0x73, 0x7B, 0x83];
  let r = {};
  xs.forEach((x, i) => {
    const ch = P.bus.u8(wTextBuffer + i);
    if (ch === BLANK) return;
    const s = getDigitSpriteTile(ch);
    r = queueSprite(P, s.b, s.c, x, 0x77);
  });
  return r;
}

export const HOOKS = [
  [BANK, 0x5438, hookGen(P => showExpAwardScreen(P))],
  [BANK, 0x54BB, hook(P => initExpAwardScreenState(P))],
  [BANK, 0x54F0, hook((P, c) => fillMemoryD(P, c.hl, c.a, c.d, c.f))],
  [BANK, 0x54F5, hookGen(P => buildExpAwardScreenTilemap(P))],
  [BANK, 0x551E, hook(P => { loadExpAwardScreenGraphics(P); })],
  [BANK, 0x55BA, hook((P, c) => expScreenCopyToTilemap(P, c.hl, c.bc))],
  [BANK, 0x55CF, hook((P, c) => expScreenCopyToAttrmap(P, c.hl, c.bc))],
  [BANK, 0x55E4, hookGen(function* (P) { yield* drawExpAwardScreenPanels(P); })],
  [BANK, 0x55FD, hook(P => { drawExpSinglesPlayerPanel(P); })],
  [BANK, 0x5693, hook(P => { drawExpDoublesPlayerPanel(P); })],
  [BANK, 0x5758, hook(P => { drawExpDoublesPartnerPanel(P); })],
  [BANK, 0x5814, hook(P => { drawExpTotalPanel(P); })],
  [BANK, 0x5896, hook((P, c) => drawExpMessageWindow(P, c.f))],
  [BANK, 0x5900, hook((P, c) => fillTilemapRun(P, c.hl, c.b, c.c, c.f))],
  [BANK, 0x5914, hook(P => { drawExpScreenCharSprites(P); })],
  [BANK, 0x5954, hook((P, c) => updateExpScreenCharSprite(P, c.a))],
  [BANK, 0x59BB, hookGen(P => drawNextExpAwardMessage(P))],
  [BANK, 0x5A4E, hook(P => { drawExpTotalDigits(P); })],
];

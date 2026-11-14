// The drill briefing screen (bank $17): before a training-court drill (ShowDrillBriefingScreen, slot $400A), a
// diagram of the court with sprites for the player, the opponent, the ball, the markers (arrows) and the target
// brackets, the targets' service boxes patched into the map and blinking (CycleDiagramTargetPalette), and a caption
// window under it. Each drill's briefing (drills.js) is a series of panels: the sprites set up as frame tasks, a
// caption, then A or B (WaitForInputBlinking: a blinking prompt) or an animation looping until A or B
// (AdvanceFrameCheckInput).
// The sprites' places and states live in WRAM 3 (wBriefing*); each sprite is a frame task (priority 1) that maps
// WRAM 3 and queues it. ClearFrameTasks ends a panel; the animated court tiles (UpdateAnimatedTilesTask_17) are
// registered again for the next.
// Also here: the bank's unused copies of the menu helpers (corner brackets, the grid index, the decimal and name
// writers) and an unused test screen of the diagram.
// Port of src/engine/menus/briefing/slots_17.asm, briefing_screen_17.asm and briefing_diagram_17.asm of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses are its own;
// tables, maps and graphics are read from the ROM.
// Tests: lockstep on out/port/brief_*.mtrec (the story's drills, from story1); routines_menus_pause.mjs.
import {
  FAR, HOME, rom, home, wram, rd, wr, u8, w8, u16, sound, advanceFrame, prepareGlyphBuffer, uploadGlyphBuffer,
  renderProportionalTextAt, registerFrameTask, clearFrameTasks, queueVRAMCopy, copyMemoryBC, decompressData,
  loadPaletteShadow, queueSprite, queueSpriteTemplate, enableLCD, disableLCDSafely, fadeIn, fillTilemapRect,
  copyTilemapRect, loadCompressedTileBlock, loadScreenAssetRecord, queueWram3MapToVRAM, hook, hookGen, FZ,
  WRAM_SCREEN, WRAM_TEXT, OBJ_PALETTES, vTiles2, vBGMap0, wShadowTilemap, OAM_BANK1, OAM_XFLIP, OAM_YFLIP, PADF_A, PADF_B,
  MINIGAME_SERVICE_PRACTICE_1, MINIGAME_TENNIS_MACHINE_1,
} from "../pause/defs.js";

export const BANK_BRIEFING = 0x17;
const rb = (P, a) => P.rom.u8(BANK_BRIEFING, a), rw = (P, a) => P.rom.u16(BANK_BRIEFING, a);
// the sprite tasks (frame tasks of this bank)
export const AnimatedTiles = 0x4406, TargetPalette = 0x4676, Player = 0x46E2, Opponent = 0x470C, Ball = 0x4736;
export const HMarker = 0x4754, Swing = 0x478E, Poles = 0x47EF, VMarker = 0x481C, SpinMarker = 0x4843;
export const RotMarker = 0x4876, Brackets = 0x48C1;
// tables and data (bank $17)
const DiagramTargetPaletteRamp_17 = 0x46CA, DrawBriefingPlayerSprite_SpriteTemplate = 0x4703;
const DrawBriefingOpponentSprite_SpriteTemplate = 0x472D, DrawBriefingMarkerHFlip_SpriteTemplate = 0x4785;
const BriefingSwingAnimTable0 = 0x47C3, DrawBriefingSwingAnim_SpriteTemplate = 0x47CD, BriefingSwingAnimTable1 = 0x47E2;
const DrawSpinServeBriefingMarker_SpriteTemplate = 0x486D, BriefingMarkerRotatedTable = 0x489E;
const QueueSpritePair_17_SpriteTemplate = 0x4A29, DiagramTargetPatchRecords_17 = 0x4A75;
const CourtDiagramGraphicsList = 0x4ABB, CycleDiagramTargetPaletteData = 0x4ED2, CourtDiagramObjPalettes = 0x5567;
const ApplySpriteWobbleX_17 = [0x17, 0x4079], ApplySpriteWobbleY_17 = [0x17, 0x40A3];   // (cursor_17.asm)
const FormatDecimalNumber = 0x1972;
const SCREENASSET_CourtDiagram = 0x24;
const TILEBLOCK_SharedMenuGfx17Alias17 = 0x11, SharedMenuGfx17_BLOCKS = 0x10;
const Text_30_228 = 0x00E4, Text_30_309 = 0x0135;
const TARGET_PALETTE_SIZE = 8, TARGET_PALETTE_STEPS = 12, TARGET_BG_PALETTE = 2;
const SWING_FRAMES_SHORT = 6;                                    // swing frames from 6 use the 3-sprite template
const CAPTION_ROW = 11, CAPTION_TEXT = wShadowTilemap + 12 * 32 + 1, CAPTION_WIDTH = 0x12;
const PROMPT_X = 0x50, PROMPT_Y = 0x8C, BLINK = 0x10;
const DRILL_BRIEFINGS = 9;

// ---- the panel helpers of the scripts ----
// a sprite's place: wBriefing<name>X / Y
export function at(P, name, x, y) { wr(P, `briefing${name}X`, x); wr(P, `briefing${name}Y`, y); }
export function bracketSize(P, w, h) { wr(P, "briefingBracketWidth", w); wr(P, "briefingBracketHeight", h); }
// `ld a, $01 / ld hl, routine / call RegisterFrameTask`
export const task = (P, routine) => registerFrameTask(P, 1, routine);
// the next panel: ClearFrameTasks, then the animated court tiles' task again
export function nextPanel(P) { clearFrameTasks(P); return task(P, AnimatedTiles); }
// (the value position tables of the animations: `ld a, [hl] / inc hl / inc hl / ld b, [hl]`: x at +0, y at +2)
export function fromTable(P, name, table, offset) {
  const at0 = (table + (offset & 0xFF)) & 0xFFFF;
  wr(P, `briefing${name}X`, rb(P, at0));
  wr(P, `briefing${name}Y`, rb(P, (at0 + 2) & 0xFFFF));
}
export const byteAt = (P, table, i) => rb(P, (table + (i & 0xFF)) & 0xFFFF);

// ShowDrillBriefingScreen (17:4487), slot $400A: the scroll and camera reset, the diagram screen loaded, then the
// briefing of the drill wCurrentMinigameStoryMatch + 1 (service drills 3-6, then two sets of three, from 3 each;
// none from the tennis machine on)
export function* showDrillBriefingScreen(P, drills) {
  const { V } = P;
  V.bGColumnBlitPending = 0; V.bGRowBlitPending = 0; V.scrollY = 0; V.scrollX = 0;
  wr(P, "cameraX", 0, 1); wr(P, "cameraY", 0, 1);
  clearFrameTasks(P);
  disableLCDSafely(P);
  loadCourtDiagramScreen(P);
  prepareGlyphBuffer(P);
  enableLCD(P);
  wr(P, "animatedTileSet", 0);
  task(P, AnimatedTiles);
  wr(P, "animatedTilePeriod", 0x03);
  yield* fadeIn(P, 16);
  let drill = rd(P, "currentMinigameStoryMatch", 1);
  if (drill >= MINIGAME_TENNIS_MACHINE_1) { clearFrameTasks(P); return; }
  drill = (drill - MINIGAME_SERVICE_PRACTICE_1) & 0xFF;
  if (drill >= 4) {
    drill = (drill - 3) & 0xFF;
    if (drill >= 6) drill = (drill - 3) & 0xFF;
  }
  if (drill >= DRILL_BRIEFINGS) throw new Error(`ShowDrillBriefingScreen: briefing ${drill} jumps off its table`);
  yield* drills[drill](P);
}

// Unused_17_ShowCourtDiagramTestScreen (17:44EB), slot $4000: every sprite of the diagram in three panels
export function* unusedShowCourtDiagramTestScreen(P) {
  disableLCDSafely(P);
  loadCourtDiagramScreen(P);
  enableLCD(P);
  wr(P, "animatedTileSet", 0);
  task(P, AnimatedTiles);
  wr(P, "animatedTilePeriod", 0x03);
  yield* fadeIn(P, 16);
  at(P, "Player", 0x50, 0x40);
  task(P, Player);
  at(P, "Opponent", 0x30, 0x20);
  task(P, Opponent);
  at(P, "Ball", 0x60, 0x30);
  task(P, Ball);
  wr(P, "briefingHMarkerUnflipped", 0x01);
  at(P, "HMarker", 0x60, 0x40);
  task(P, HMarker);
  yield* drawBriefingCaption(P, Text_30_228);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingSwingFrame", 0x09);
  at(P, "Swing", 0x40, 0x32);
  task(P, Swing);
  at(P, "Pole1", 0x40, 0x20);
  at(P, "Pole2", 0x50, 0x20);
  task(P, Poles);
  wr(P, "briefingVMarkerUpright", 0x01);
  at(P, "VMarker", 0x30, 0x20);
  task(P, VMarker);
  wr(P, "briefingSpinMarkerUnflipped", 0x01);
  at(P, "SpinMarker", 0x20, 0x40);
  task(P, SpinMarker);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x10, 0x10);
  task(P, RotMarker);
  bracketSize(P, 0x18, 0x08);
  at(P, "Bracket", 0x20, 0x40);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_30_309);
  drawDiagramTargetOverlay(P, 0x02);
  task(P, TargetPalette);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  drawDiagramTargetOverlay(P, 0x00);
  yield* drawBriefingCaption(P, Text_30_228);
  at(P, "HMarker", 0x70, 0x20);
  task(P, HMarker);
  drawDiagramTargetOverlay(P, 0x05);
  task(P, TargetPalette);
  yield* waitForInputBlinking(P);
  clearFrameTasks(P);
}

// ---- the caption and the targets ----
// DrawBriefingCaption (17:4654): the caption window cleared, the text hl written in it, queued; a frame
export function* drawBriefingCaption(P, text) {
  clearBriefingCaptionTilemap(P);
  prepareGlyphBuffer(P);
  yield* renderProportionalTextAt(P, text, CAPTION_TEXT, CAPTION_WIDTH);
  yield* uploadGlyphBuffer(P);
  queueCaptionRowToVRAM(P);
  yield* advanceFrame(P);
}
// DrawDiagramTargetOverlay (17:466C): the service boxes back to plain, then target patch b (1-6; 0 none), queued
export function drawDiagramTargetOverlay(P, target) {
  restoreDiagramServiceBoxes(P);
  drawDiagramTargetPatch(P, target);
  return queueDiagramServiceBoxesToVRAM(P);
}
// CycleDiagramTargetPalette (17:4676), a frame task: BG palette 2 from CycleDiagramTargetPaletteData with its
// color 2 cycling through DiagramTargetPaletteRamp_17 (a step every 4 frames, 16 steps a cycle: the last 4 the first)
export function cycleDiagramTargetPalette(P) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  copyMemoryBC(P, CycleDiagramTargetPaletteData, P.A.briefingTargetPalette, TARGET_PALETTE_SIZE);
  let step = (P.V.vBlankCounter & 0x3C) >> 2;
  if (step >= TARGET_PALETTE_STEPS) step = 0;
  P.bus.w16(P.A.briefingTargetPalette + 4, u16(P, (DiagramTargetPaletteRamp_17 + step * 2) & 0xFFFF));
  const r = loadPaletteShadow(P, P.A.briefingTargetPalette, TARGET_BG_PALETTE, 1);
  wram(P, bank);
  return r;
}

// ---- the sprite tasks (each maps WRAM 3 meanwhile) ----
function inScreenBank(P, fn) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  const r = fn();
  wram(P, bank);
  return r;
}
const xOf = (P, name) => rd(P, `briefing${name}X`), yOf = (P, name) => rd(P, `briefing${name}Y`);
const blinkOffset = P => (P.V.vBlankCounter & BLINK ? 1 : 0);
// DrawBriefingPlayerSprite (17:46E2) / DrawBriefingOpponentSprite (17:470C): the two 16x16 figures (tiles 0 / 4)
export const drawBriefingPlayerSprite = P => inScreenBank(P, () =>
  queueSpriteTemplate(P, DrawBriefingPlayerSprite_SpriteTemplate, xOf(P, "Player"), yOf(P, "Player"), 0x00, OAM_BANK1));
export const drawBriefingOpponentSprite = P => inScreenBank(P, () =>
  queueSpriteTemplate(P, DrawBriefingOpponentSprite_SpriteTemplate, xOf(P, "Opponent"), yOf(P, "Opponent"), 0x04, OAM_BANK1));
// DrawBriefingBallSprite (17:4736): the ball (tile $6E, palette 1)
export const drawBriefingBallSprite = P => inScreenBank(P, () =>
  queueSprite(P, OAM_BANK1 | 1, 0x6E, xOf(P, "Ball"), yOf(P, "Ball")));
// DrawBriefingMarkerHFlip (17:4754): the arrow (tiles $60), mirrored unless wBriefingHMarkerUnflipped is 1, a pixel
// right every other 16 frames
export const drawBriefingMarkerHFlip = P => inScreenBank(P, () => {
  const attr = rd(P, "briefingHMarkerUnflipped") === 1 ? OAM_BANK1 | 1 : OAM_BANK1 | OAM_XFLIP | 1;
  return queueSpriteTemplate(P, DrawBriefingMarkerHFlip_SpriteTemplate, (xOf(P, "HMarker") + blinkOffset(P)) & 0xFF,
    yOf(P, "HMarker"), 0x60, attr);
});
// DrawBriefingSwingAnim (17:478E): the swing's frame wBriefingSwingFrame (first tile from BriefingSwingAnimTable0;
// frames 0-5 five sprites wide, from 6 three)
export const drawBriefingSwingAnim = P => inScreenBank(P, () => {
  const frame = rd(P, "briefingSwingFrame");
  const template = frame < SWING_FRAMES_SHORT ? DrawBriefingSwingAnim_SpriteTemplate : BriefingSwingAnimTable1;
  return queueSpriteTemplate(P, template, xOf(P, "Swing"), yOf(P, "Swing"), byteAt(P, BriefingSwingAnimTable0, frame), OAM_BANK1 | 1);
});
// DrawBriefingPoleSprites (17:47EF): the two poles (tile $6A)
export const drawBriefingPoleSprites = P => inScreenBank(P, () => {
  queueSprite(P, OAM_BANK1 | 1, 0x6A, xOf(P, "Pole1"), yOf(P, "Pole1"));
  return queueSprite(P, OAM_BANK1 | 1, 0x6A, xOf(P, "Pole2"), yOf(P, "Pole2"));
});
// DrawBriefingMarkerVFlip (17:481C): the vertical arrow (tile $70), upside down unless wBriefingVMarkerUpright is 1
export const drawBriefingMarkerVFlip = P => inScreenBank(P, () => {
  const attr = rd(P, "briefingVMarkerUpright") === 1 ? OAM_BANK1 | 1 : OAM_BANK1 | OAM_YFLIP | 1;
  return queueSprite(P, attr, 0x70, xOf(P, "VMarker"), yOf(P, "VMarker"));
});
// DrawSpinServeBriefingMarker (17:4843): the spin arrow (tiles $64), mirrored unless wBriefingSpinMarkerUnflipped is 1
export const drawSpinServeBriefingMarker = P => inScreenBank(P, () => {
  const attr = rd(P, "briefingSpinMarkerUnflipped") === 1 ? OAM_BANK1 | 1 : OAM_BANK1 | OAM_XFLIP | 1;
  return queueSpriteTemplate(P, DrawSpinServeBriefingMarker_SpriteTemplate, xOf(P, "SpinMarker"), yOf(P, "SpinMarker"), 0x64, attr);
});
// DrawBriefingMarkerRotated (17:4876): the short arrow (tile $68) in direction wBriefingRotMarkerDir (its flips from
// BriefingMarkerRotatedTable)
export const drawBriefingMarkerRotated = P => inScreenBank(P, () =>
  queueSprite(P, byteAt(P, BriefingMarkerRotatedTable, rd(P, "briefingRotMarkerDir")), 0x68, xOf(P, "RotMarker"), yOf(P, "RotMarker")));
// DrawBlinkingPrompt (17:48A2): the "press a button" mark at ($50, $8C), every other 16 frames
export const drawBlinkingPrompt = P => inScreenBank(P, () => {
  if (P.V.vBlankCounter & BLINK) return queueSprite(P, OAM_BANK1 | 1, 0x72, PROMPT_X, PROMPT_Y);
});
// DrawBriefingTargetBrackets (17:48C1): the four corners (tile $6C) of a target, wBriefingBracketWidth + 3 wide and
// wBriefingBracketHeight - 5 high from (X, Y), each a pixel inwards every other 16 frames
export const drawBriefingTargetBrackets = P => inScreenBank(P, () => {
  const x = xOf(P, "Bracket"), y = yOf(P, "Bracket"), blink = blinkOffset(P);
  const right = (x + rd(P, "briefingBracketWidth") + 3) & 0xFF, bottom = (y + rd(P, "briefingBracketHeight") - 5) & 0xFF;
  queueSprite(P, OAM_BANK1 | 2, 0x6C, (x + blink) & 0xFF, (y + blink) & 0xFF);
  queueSprite(P, OAM_BANK1 | OAM_XFLIP | 2, 0x6C, (right - blink) & 0xFF, (y + blink) & 0xFF);
  queueSprite(P, OAM_BANK1 | OAM_XFLIP | OAM_YFLIP | 2, 0x6C, (right - blink) & 0xFF, (bottom - blink) & 0xFF);
  return queueSprite(P, OAM_BANK1 | OAM_YFLIP | 2, 0x6C, (x + blink) & 0xFF, (bottom - blink) & 0xFF);
});

// ---- the screen ----
// LoadCourtDiagramScreen (17:4960): the diagram's screen asset, the caption window, the sprite graphics
// (DecompressGraphicsList) and palettes, the maps to VRAM. Leaves WRAM 3 mapped.
export function loadCourtDiagramScreen(P) {
  loadScreenAssetRecord(P, SCREENASSET_CourtDiagram);
  initCourtDiagramTextWindow(P);
  wram(P, WRAM_SCREEN);
  decompressGraphicsList(P);
  loadCourtDiagramObjPalettes(P);
  queueWram3MapToVRAM(P);
  wram(P, WRAM_SCREEN);
}
// WaitForInputBlinking (17:497E): frames until A or B, the prompt blinking
export function* waitForInputBlinking(P) {
  for (;;) {
    yield* advanceFrame(P);
    if (P.V.inputRisingEdge & (PADF_A | PADF_B)) return;
    drawBlinkingPrompt(P);
  }
}
// AdvanceFrameCheckInput (17:498D): a frame; returns A / B pressed (a != 0), else 0 after the prompt, which shows
// unless c was 1 (the ROM's `dec c / jr z`)
export function* advanceFrameCheckInput(P, c) {
  yield* advanceFrame(P);
  const keys = P.V.inputRisingEdge & (PADF_A | PADF_B);
  if (keys) return keys;
  if ((c - 1) & 0xFF) drawBlinkingPrompt(P);
  return 0;
}
// InitCourtDiagramTextWindow (17:499F): the text windows reset, the font tiles, a window over rows $0B-$11 drawn
// into the WRAM 3 maps
export function initCourtDiagramTextWindow(P) {
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  wram(P, WRAM_TEXT);
  wr(P, "shadowTilemapBank", WRAM_SCREEN);
  wr(P, "windowTileAttr", 0);
  rom(P, FAR.CreateWindowFromScreenRect, { d: 0x00, e: 0x0B, b: 0x14, c: 0x07 });
  rom(P, FAR.DrawTextWindowFrame);
  return rom(P, FAR.RedrawWindowRows);
}
// ClearBriefingCaptionTilemap (17:49CE): the caption window's top border and its text rows blank. Registers kept.
export function clearBriefingCaptionTilemap(P) {
  fillTilemapRect(P, wShadowTilemap + CAPTION_ROW * 32, 0x14, 0x01, 0x03);
  w8(P, wShadowTilemap + CAPTION_ROW * 32, 0x02);
  w8(P, wShadowTilemap + CAPTION_ROW * 32 + 19, 0x04);
  fillTilemapRect(P, CAPTION_TEXT, CAPTION_WIDTH, 0x05, 0x20);
}
// QueueCaptionRowToVRAM (17:49F9): the caption rows ($0B-$10) to VRAM
export function queueCaptionRowToVRAM(P) {
  return queueVRAMCopy(P, wShadowTilemap + CAPTION_ROW * 32, vBGMap0 + CAPTION_ROW * 32, 6 * 32 / 16);
}
// Unused_17_DrawSecondCaptionRow (17:4A06): a test caption at $D1C1, rows from $D1A0 queued. Nothing calls it.
export function unusedDrawSecondCaptionRow(P) {
  P.callRom(...FAR.RenderProportionalTextAt, { hl: Text_30_309, de: 0xD1C1 });
  return queueVRAMCopy(P, 0xD1A0, vBGMap0 + 13 * 32, 6 * 32 / 16);
}
// Unused_17_QueueSpritePair (17:4A1B): a 16x16 pair (tiles 4) at ($20, $20). Nothing calls it.
export const unusedQueueSpritePair = P => queueSpriteTemplate(P, QueueSpritePair_17_SpriteTemplate, 0x20, 0x20, 0x04, OAM_BANK1 | 1);
// RestoreDiagramServiceBoxes (17:4A32): the plain service boxes (6x6 from row $12, column 6) over the diagram at
// (7, 3). Registers kept.
export const restoreDiagramServiceBoxes = P => copyTilemapRect(P, wShadowTilemap + 18 * 32 + 6, wShadowTilemap + 3 * 32 + 7, 6, 6);
// QueueDiagramServiceBoxesToVRAM (17:4A48): rows 3-8 to VRAM
export const queueDiagramServiceBoxesToVRAM = P => queueVRAMCopy(P, wShadowTilemap + 3 * 32, vBGMap0 + 3 * 32, 6 * 32 / 16);
// DrawDiagramTargetPatch (17:4A54): target b's highlighted patch (DiagramTargetPatchRecords_17: source, place,
// width, height) copied over the boxes; b = 0: none
export function drawDiagramTargetPatch(P, target) {
  if (!target) return;
  const rec = (DiagramTargetPatchRecords_17 + (((target - 1) * 6) & 0xFF)) & 0xFFFF;
  copyTilemapRect(P, rw(P, rec), rw(P, rec + 2), rb(P, rec + 4), rb(P, rec + 5));
}
// DecompressGraphicsList (17:4A99): each [source, VRAM place] of CourtDiagramGraphicsList ($0000 ends it)
export function decompressGraphicsList(P) {
  for (let at = CourtDiagramGraphicsList; ; at += 4) {
    const src = rw(P, at);
    if (!src) return;
    decompressData(P, src, rw(P, at + 2));
  }
}
// LoadCourtDiagramObjPalettes (17:4B0D): object palettes 0-2
export const loadCourtDiagramObjPalettes = P => loadPaletteShadow(P, CourtDiagramObjPalettes, OBJ_PALETTES, 3);
// UpdateAnimatedTilesTask_17 (17:4406), a frame task: UpdateAnimatedTiles (bank $39)
export const updateAnimatedTilesTask = P => rom(P, FAR.UpdateAnimatedTiles);

// ---- the bank's unused helpers ----
// Unused_17_DrawWobblingCornerBrackets (17:4016): four corner sprites (tile 0) of a b x c box at (d, e), each
// wobbling outwards (the bank's ApplySpriteWobbleX / Y). Nothing calls it.
export function unusedDrawWobblingCornerBrackets(P, x, y, w, h) {
  const corner = (cx, cy, wx, wy, attr) => {
    const d = rom(P, ApplySpriteWobbleX_17, { c: wx, d: cx, e: cy }).d;
    const e = rom(P, ApplySpriteWobbleY_17, { c: wy, d, e: cy }).e;
    queueSprite(P, attr, 0x00, d, e);
  };
  corner(x, y, 0, 0, OAM_BANK1);
  corner((x + w) & 0xFF, y, 1, 0, OAM_BANK1 | OAM_XFLIP);
  corner((x + w) & 0xFF, (y + h) & 0xFF, 1, 1, OAM_BANK1 | OAM_XFLIP | OAM_YFLIP);
  corner(x, (y + h) & 0xFF, 0, 1, OAM_BANK1 | OAM_YFLIP);
  return { de: (x << 8 | (y + h) & 0xFF) & 0xFFFF };
}
// Unused_17_WriteGridPosFromLinearIndex (17:43CB): c / b as (remainder, quotient) at hl
export function unusedWriteGridPosFromLinearIndex(P, index, cols, hl) {
  let q = 0, r = index;
  while (r >= cols) { q = (q + 1) & 0xFF; r -= cols; }
  w8(P, hl, r); w8(P, hl + 1, q);
  return { a: q, d: q, hl: (hl + 1) & 0xFFFF };
}
// Unused_17_ClearWram3Row64 (17:43D9) / ...Alt (17:43EF): 64 zero bytes at hl in WRAM 3
export function unusedClearWram3Row64(P, hl) {
  const bank = P.V.wramBank;
  wram(P, WRAM_SCREEN);
  for (let i = 0; i < 0x40; i++, hl = (hl + 1) & 0xFFFF) w8(P, hl, 0);
  wram(P, bank);
  return { hl, c: 0, a: bank };
}
// Unused_17_DrawNameWithDiacritics (17:440A): the 0-ended name at hl into the map at de; a letter followed by a
// diacritic ($DE / $DF) gets it in the cell above ($0E / $0F over the blank tile 3); at a row's end de is doubled
// (the ROM's slip). af, bc kept.
export function unusedDrawNameWithDiacritics(P, hl, de) {
  for (;;) {
    const ch = u8(P, hl);
    if (!ch) return { hl, de };
    w8(P, de, ch);
    hl = (hl + 1) & 0xFFFF;
    const mark = u8(P, hl);
    if (mark === 0xDE || mark === 0xDF) {
      const above = (de - 0x20) & 0xFFFF;
      w8(P, above, u8(P, above) === 0x03 ? mark - 0xD0 : mark);
      hl = (hl + 1) & 0xFFFF;
    }
    de = (de + 1) & 0xFFFF;
    if (!(de & 0x1F)) de = (de * 2) & 0xFFFF;
  }
}
// Unused_17_DrawDecimalNumber (17:4443): hl in decimal (FormatDecimalNumber, width a) through a buffer on the stack,
// then its digits at de. af, bc, hl kept.
export function unusedDrawDecimalNumber(P, value, width, de) {
  const sp = P.cpu.sp, buf = (sp - 16) & 0xFFFF;               // (push af, bc, hl / add sp, -10: the buffer)
  P.cpu.sp = (sp - 20) & 0xFFFF;                               // (push bc / push de)
  home(P, FormatDecimalNumber, { hl: value, de: buf, bc: buf, a: width });
  P.cpu.sp = sp;
  return unusedDrawAsciiDigitString(P, buf, de);
}
// Unused_17_DrawAsciiDigitString (17:4464): the 0-ended string at hl at de, a digit a cell (Unused_17_DrawAsciiDigitChar)
export function unusedDrawAsciiDigitString(P, hl, de) {
  for (let ch; (ch = u8(P, hl)); hl = (hl + 1) & 0xFFFF) de = unusedDrawAsciiDigitChar(P, ch, de).de;
  return { hl: (hl + 1) & 0xFFFF, de, a: 0 };
}
// Unused_17_DrawAsciiDigitChar (17:446E): a at de (WRAM 3, left mapped) unless below '0' (the cell skipped)
export function unusedDrawAsciiDigitChar(P, ch, de) {
  if (ch < 0x30) return { de: (de + 1) & 0xFFFF };
  wram(P, WRAM_SCREEN);
  w8(P, de, ch);
  return { de: (de + 1) & 0xFFFF, a: ch, b: ch };
}

const B = BANK_BRIEFING;
export const SCREEN_HOOKS = [
  [B, 0x4016, hook((P, c) => unusedDrawWobblingCornerBrackets(P, c.d, c.e, c.b, c.c))],
  [B, 0x43CB, hook((P, c) => unusedWriteGridPosFromLinearIndex(P, c.c, c.b, c.hl))],
  [B, 0x43D9, hook((P, c) => unusedClearWram3Row64(P, c.hl))],
  [B, 0x43EF, hook((P, c) => unusedClearWram3Row64(P, c.hl))],
  [B, AnimatedTiles, hook(P => { updateAnimatedTilesTask(P); })],
  [B, 0x440A, hook((P, c) => unusedDrawNameWithDiacritics(P, c.hl, c.de))],
  [B, 0x4443, hook((P, c) => { unusedDrawDecimalNumber(P, c.hl, c.a, c.de); })],
  [B, 0x4464, hook((P, c) => unusedDrawAsciiDigitString(P, c.hl, c.de))],
  [B, 0x446E, hook((P, c) => unusedDrawAsciiDigitChar(P, c.a, c.de))],
  [B, 0x44EB, hookGen(P => unusedShowCourtDiagramTestScreen(P))],
  [B, 0x4654, hookGen((P, c) => drawBriefingCaption(P, c.hl))],
  [B, 0x466C, hook((P, c) => { drawDiagramTargetOverlay(P, c.b); })],
  [B, TargetPalette, hook(P => { cycleDiagramTargetPalette(P); })],
  [B, Player, hook(P => { drawBriefingPlayerSprite(P); })],
  [B, Opponent, hook(P => { drawBriefingOpponentSprite(P); })],
  [B, Ball, hook(P => { drawBriefingBallSprite(P); })],
  [B, HMarker, hook(P => { drawBriefingMarkerHFlip(P); })],
  [B, Swing, hook(P => { drawBriefingSwingAnim(P); })],
  [B, Poles, hook(P => { drawBriefingPoleSprites(P); })],
  [B, VMarker, hook(P => { drawBriefingMarkerVFlip(P); })],
  [B, SpinMarker, hook(P => { drawSpinServeBriefingMarker(P); })],
  [B, RotMarker, hook(P => { drawBriefingMarkerRotated(P); })],
  [B, 0x48A2, hook(P => { drawBlinkingPrompt(P); })],
  [B, Brackets, hook(P => { drawBriefingTargetBrackets(P); })],
  [B, 0x4960, hook(P => { loadCourtDiagramScreen(P); })],
  [B, 0x497E, hookGen(P => waitForInputBlinking(P))],
  [B, 0x498D, hookGen(function* (P, c) { const a = yield* advanceFrameCheckInput(P, c.c); return { a, f: a ? 0 : FZ }; })],
  [B, 0x499F, hook(P => { initCourtDiagramTextWindow(P); })],
  [B, 0x49CE, hook(P => { clearBriefingCaptionTilemap(P); })],
  [B, 0x49F9, hook(P => { queueCaptionRowToVRAM(P); })],
  [B, 0x4A05, hook(() => {})],
  [B, 0x4A06, hook(P => { unusedDrawSecondCaptionRow(P); })],
  [B, 0x4A1B, hook(P => { unusedQueueSpritePair(P); })],
  [B, 0x4A32, hook(P => { restoreDiagramServiceBoxes(P); })],
  [B, 0x4A48, hook(P => { queueDiagramServiceBoxesToVRAM(P); })],
  [B, 0x4A54, hook((P, c) => { drawDiagramTargetPatch(P, c.b); })],
  [B, 0x4A99, hook(P => { decompressGraphicsList(P); })],
  [B, 0x4B0D, hook(P => { loadCourtDiagramObjPalettes(P); })],
];

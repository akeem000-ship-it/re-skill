// The EXP distribution screen's input loop and frame tasks (bank $1D): the pool of EXP won is given point by point
// to the main character (cursor up) or the partner (cursor down) with RIGHT / A, taken back with LEFT (held: a run,
// faster after the first repeat delay); the bar marker sweeps over the character's level bar meanwhile. With the
// pool empty, or when the screen is only shown again, the "OK?" prompt slides in at the bottom: A on "yes" ends the
// loop, B or "no" slides it out again. Also the pending-award list the results screens fill (ClearPendingExpAwards,
// SetPendingExpAward).
// Port of src/engine/menus/exp/distribute_loop_1d.asm, distribute_readouts_1d.asm and the code of
// distribute_gfx_1d.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names
// and addresses are its own. Tables, patches and sprite templates are read from the ROM.
// The screen itself (ShowExpDistributionScreen, the stats readouts) is menus/char_data/exp.js.
//
// The state (WRAM 6): wExpCursorChar bit 0 = the cursor sliding between the two, bit 1 = a point was just given or
// taken (the marker sweeps), bit 2 = the prompt is up; wExpCursorSlide (0 main .. $18 partner), wExpBarMarkerX
// ($A8: off the screen), wExpRedrawPending (frames until the next point of a run), wExpRepeatDelay (8, then 0
// once a run repeats), wExpInputRepeating (frames a direction is held), wExpLevelUpFanfare ($FF: a level-up just
// happened; then the frames left of its jingle), wExpPromptCursorRow (0 yes, 1 no). wExpScreenCharStats: see exp.js.
// Covered by the lockstep on out/port/cd_levelup.mtrec and xr_expmove.mtrec (EXP given and taken back, one at a time
// and in fast runs, past a level up and down; the partner selected; the prompt answered both ways), and by
// web/tests/port/routines_menus_exp.mjs.
import {
  FZ, FN, FH, FC, rd, wr, u8, w8, rd16, ix, far, hook, hookGen, sound, advanceFrame, waitFrames, queueVRAMCopy,
  queueSprite, registerFrameTask, unregisterFrameTask, formatDecimalNumberUnsigned, rom, FAR, subFlags,
  BANK_EXP_DISTRIBUTE, BANK_CHAR_DATA, BANK_RANKING, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE,
  TILEMAP_WIDTH, VRAM_BANK1, vBGMap0, wShadowTilemap, wDecompBuffer, wCharDataScreenCell, OAM_BANK1, PADF_A, PADF_B,
  PADF_RIGHT, PADF_LEFT, PADF_UP, PADF_DOWN, BGM_NONE, BGM_EXP_DISTRIBUTION, BGM_LEVEL_UP, SFX_MENU_MOVE,
  SFX_MENU_SELECT, SFX_MENU_CANCEL, cell,
} from "./defs.js";
import { clearBytes } from "../../home/system.js";
import { queueSpriteTemplate } from "../../home/fade.js";
import { drawExpPoolReadout, drawExpScreenLevelNumber, drawExpScreenLevelBar } from "../char_data/exp.js";
import { backupCharDataScreenRow, restoreCharDataScreenRow } from "../char_data/screen.js";
import { loadIndexedPaletteThunk } from "../ranking/board.js";

export const BANK = BANK_EXP_DISTRIBUTE;
// ROM data (bank $1D)
const ExpBarFillTiles_1d = 0x6F35;                                   // (the bar's tiles: exp.js)
const ExpPromptWindowFrame_1d = 0x77C8;
const ExpLevelDownTilemapPatch = [0x77E1, 0x77F6, 0x7807, 0x7814, 0x781D];   // the prompt sliding in: 4 .. 0
const DrawExpCharCursorTask_SpriteTemplate = 0x7930, DrawExpBarFillMarkersTask_SpriteTemplate = 0x797A;
const DrawExpBarSweepSpriteTask_SpriteTemplate = 0x79B4;
const DrawExpToNextLevelTask_SpriteTemplate0 = 0x7B59, DrawExpToNextLevelTask_SpriteTemplate1 = 0x7C7D;
const DrawExpCharCursorTaskTable = 0x7746;                           // the cursor's y by slide step
const PendingExpAwardSetters_1d = 0x7CD9;
// its routines (frame tasks are registered by address)
const SlideExpCursorToMainCharTask = 0x70CC, SlideExpCursorToPartnerTask = 0x70E6;
const SetPendingExpAward_N64 = 0x7CE3, SetPendingExpAward_Exhibition = 0x7CEE, SetPendingExpAward_Linked = 0x7CF9;
const SetPendingExpAward_Match = 0x7D04, SetPendingExpAward_Trophy = 0x7D0F;

const hPlayerInputFlags = 0xFF90, hInputRisingEdge = 0xFF94, hVBlankCounter = 0xFF8C, hPaletteDirtyFlags = 0xFF9D;
const rRAMG = 0x0000;
const MARKER_OFF = 0xA8, MARKER_START = 0x18, MARKER_BAR_X = 0x36;   // the sweep marker's x: off, start, bar origin
const REPEAT_DELAY = 0x08, FANFARE_NEW = 0xFF, FANFARE_FRAMES = 0xA0, SLIDE_TO_PARTNER = 0x18;
const CURSOR_SLIDING = 0x01, CURSOR_POINT_MOVED = 0x02, CURSOR_PROMPT = 0x04;   // wExpCursorChar bits
const PROMPT_ROWS = cell(wCharDataScreenCell, 18, 0);                // the patches' source: the map's hidden rows
// wExpScreenCharStats fields (+ 15 for the partner): see exp.js
const S = { LEVEL: 0, NEEDED: 1, BAR: 3, PROGRESS: 4, GIVEN: 6, TO_NEXT: 8, NAME_PAL: 10, PARTNER: 15 };
const stat = (P, off) => (P.A.expScreenCharStats + off) & 0xFFFF;
const base = P => (P.V.storyCharacterSlot ? S.PARTNER : 0);
const get16 = (P, off) => P.bus.u16(stat(P, off));
const put16 = (P, off, v) => P.bus.w16(stat(P, off), v & 0xFFFF);
const cursor = P => rd(P, "expCursorChar");
const setCursor = (P, bits, on) => wr(P, "expCursorChar", on ? cursor(P) | bits : cursor(P) & ~bits);

// ---- the loop ----
// RunExpDistributionLoop (1D:6F3E): until the prompt is answered "yes" (returns a = 0)
export function* runExpDistributionLoop(P) {
  P.wramBank(WRAM_SCENE);
  if (rd(P, "charDataViewOnly")) {                                   // only showing: straight to the prompt
    wr(P, "charDataViewOnly", 0);
    if (yield* expLevelDownPrompt(P)) return { a: 0, f: FZ };
  }
  for (;;) {
    P.wramBank(WRAM_SCENE);                                          // .tick
    if ((rd(P, "expInputRepeating") & 0x08) && rd(P, "expRepeatDelay")) {   // held 8 frames: the run speeds up
      wr(P, "expRepeatDelay", rd(P, "expRepeatDelay") - 1);
      wr(P, "expInputRepeating", 0);
    }
    if (rd(P, "expRedrawPending")) wr(P, "expRedrawPending", rd(P, "expRedrawPending") - 1);
    tickLevelUpJingle(P);
    uploadExpScreenTilemapRows(P);
    yield* advanceFrame(P);
    const held = P.bus.u8(hPlayerInputFlags);
    if (held & PADF_B) { P.wramBank(WRAM_SCENE); wr(P, "expRedrawPending", 0); }   // B: no wait between points
    let prompt = false;
    if (held & PADF_LEFT) prompt = decreaseOrIncrease(P, false);
    else if (held & (PADF_RIGHT | PADF_A)) prompt = decreaseOrIncrease(P, true);
    else {
      P.wramBank(WRAM_SCENE);
      wr(P, "expBarMarkerX", MARKER_OFF);
      wr(P, "expRepeatDelay", REPEAT_DELAY);
      wr(P, "expInputRepeating", 0);
      setCursor(P, CURSOR_POINT_MOVED, false);
      const edge = P.bus.u8(hInputRisingEdge);
      if (edge & PADF_UP) selectChar(P, 0);
      else if (edge & PADF_DOWN) selectChar(P, 1);
    }
    if (prompt && (yield* expLevelDownPrompt(P))) return { a: 0, f: FZ };
  }
}
// .selectMainChar / .selectPartner: the cursor slides to the other character
function selectChar(P, slot) {
  P.wramBank(WRAM_SCENE);
  if ((P.V.storyCharacterSlot ? 1 : 0) === slot) return;
  sound(P, SFX_MENU_MOVE);
  P.V.storyCharacterSlot = slot;
  updateExpScreenSelectionPalettes(P);
  unregisterFrameTask(P, slot ? SlideExpCursorToMainCharTask : SlideExpCursorToPartnerTask);
  registerFrameTask(P, 1, slot ? SlideExpCursorToPartnerTask : SlideExpCursorToMainCharTask);
  setCursor(P, CURSOR_SLIDING, true);
}
// .decrease / .increase: a point taken back or given (two when the run is fast). Returns true when the pool is
// empty and RIGHT / A was pressed: the prompt.
function decreaseOrIncrease(P, increase) {
  P.wramBank(WRAM_SCENE);
  if (cursor(P) & CURSOR_SLIDING) return false;
  wr(P, "expInputRepeating", rd(P, "expInputRepeating") + 1);
  const sweep = () => (increase ? sweepExpBarMarkerRight(P) : sweepExpBarMarkerLeft(P));
  if (rd(P, "expRedrawPending")) { sweep(); return false; }           // .decreaseRepeat / .increaseRepeat
  const move = () => (increase ? assignExpPointToChar(P) : unassignExpPointFromChar(P)).a;
  if (!move()) {                                                     // .decreaseFailed / .increaseFailed
    setCursor(P, CURSOR_POINT_MOVED, false);
    wr(P, "expBarMarkerX", MARKER_OFF);
    return increase;
  }
  sound(P, increase ? SFX_MENU_SELECT : SFX_MENU_CANCEL);
  P.wramBank(WRAM_SCENE);
  if (!rd(P, "expRepeatDelay")) move();                              // a fast run: two points a step
  setCursor(P, CURSOR_POINT_MOVED, true);                            // .applyDecrease / .applyIncrease
  wr(P, "expRedrawPending", rd(P, "expRepeatDelay"));
  refreshExpScreenReadouts(P);
  sweep();
  return false;
}
// CheckExpLevelDown.step2 (1D:743F) and its prompt loop (UploadExpPromptWindowRows.loop, DrawExpPromptCursor's
// branches): the "OK?" window slides in over the bottom rows (both characters' palettes in colour again); A on "yes"
// returns true (the loop ends); "no" or B slides it out (the rows put back from the backup) and returns false.
function* expLevelDownPrompt(P) {
  P.wramBank(WRAM_SCENE);
  setCursor(P, CURSOR_PROMPT, true);
  P.wramBank(WRAM_SCENE);
  copyNamePalettes(P);
  loadNameplatePalettes(P);
  P.bus.w8(hPaletteDirtyFlags, P.bus.u8(hPaletteDirtyFlags) | 1);
  sound(P, SFX_MENU_SELECT);
  far(P, BANK_CHAR_DATA, () => backupCharDataScreenRow(P));
  for (let i = 4; i >= 0; i--) {                                    // the window slides in
    applyTilemapPatchListExpScreen(P, ExpLevelDownTilemapPatch[i], PROMPT_ROWS);
    uploadExpPromptWindowRows(P);
    yield* waitFrames(P, 2);
  }
  applyTilemapPatchListExpScreen(P, ExpPromptWindowFrame_1d, PROMPT_ROWS);
  uploadExpPromptWindowRows(P);
  yield* waitFrames(P, 12);
  P.wramBank(WRAM_SCENE);
  wr(P, "expPromptCursorRow", 1);
  for (;;) {                                                         // UploadExpPromptWindowRows.loop
    drawExpPromptCursor(P);
    tickLevelUpJingle(P);
    yield* advanceFrame(P);
    const edge = P.bus.u8(hInputRisingEdge);
    if (edge & (PADF_UP | PADF_DOWN)) {                              // .playSfx: the other answer
      sound(P, SFX_MENU_MOVE);
      wr(P, "expPromptCursorRow", rd(P, "expPromptCursorRow") ^ 1);
      continue;
    }
    if (edge & PADF_A) {
      if (!rd(P, "expPromptCursorRow")) { sound(P, SFX_MENU_SELECT); return true; }   // .bit0Set: yes
      break;
    }
    if (edge & PADF_B) break;
  }
  sound(P, SFX_MENU_CANCEL);                                         // .playSfx2: the window slides out
  for (let i = 0; i <= 4; i++) {
    far(P, BANK_CHAR_DATA, () => restoreCharDataScreenRow(P));
    applyTilemapPatchListExpScreen(P, ExpLevelDownTilemapPatch[i], PROMPT_ROWS);
    uploadExpPromptWindowRowsClosing(P);
    yield* waitFrames(P, 2);
  }
  far(P, BANK_CHAR_DATA, () => restoreCharDataScreenRow(P));
  uploadExpPromptWindowRowsClosing(P);
  yield* waitFrames(P, 2);
  P.wramBank(WRAM_SCENE);
  setCursor(P, CURSOR_PROMPT, false);
  updateExpScreenSelectionPalettes(P);
  return false;
}

// TickLevelUpJingle (1D:77A7): after a level-up the level-up jingle, then (after $A0 frames) the screen's music again
export function tickLevelUpJingle(P) {
  P.wramBank(WRAM_SCENE);
  const a = rd(P, "expLevelUpFanfare");
  if (!a) return { a, f: FZ };
  if (a === FANFARE_NEW) {
    wr(P, "expLevelUpFanfare", FANFARE_FRAMES);
    sound(P, BGM_NONE);
    sound(P, BGM_LEVEL_UP);
    return { a: FANFARE_FRAMES, f: FZ | FN };                        // (the flags of `cp $ff`)
  }
  const left = (a - 1) & 0xFF, f = (left ? 0 : FZ) | FN | ((a & 0x0F) === 0 ? FH : 0) | FC;   // `dec a` (C from `cp $ff`)
  wr(P, "expLevelUpFanfare", left);
  if (left) return { a: left, f };
  sound(P, BGM_EXP_DISTRIBUTION);
  return { a: 0, f };
}

// ---- the cursor and the bar marker ----
// SlideExpCursorToMainCharTask (1D:70CC) / SlideExpCursorToPartnerTask (1D:70E6): one step of the cursor's slide;
// at the end the cursor is free again and the task removes itself
export function slideExpCursorToMainCharTask(P) {
  P.wramBank(WRAM_SCENE);
  const a = (rd(P, "expCursorSlide") - 1) & 0xFF;
  wr(P, "expCursorSlide", a);
  if (a) return { a };
  setCursor(P, CURSOR_SLIDING, false);
  return unregisterFrameTask(P, SlideExpCursorToMainCharTask);
}
export function slideExpCursorToPartnerTask(P) {
  P.wramBank(WRAM_SCENE);
  const a = (rd(P, "expCursorSlide") + 1) & 0xFF;
  wr(P, "expCursorSlide", a);
  if (a !== SLIDE_TO_PARTNER) return { a };
  setCursor(P, CURSOR_SLIDING, false);
  return unregisterFrameTask(P, SlideExpCursorToPartnerTask);
}
// SweepExpBarMarkerLeft (1D:7102): the marker one step left over the bar (from its fill end when it was off;
// off again past x $18)
export function sweepExpBarMarkerLeft(P) {
  const { b } = getExpBarSweepStep(P);
  P.wramBank(WRAM_SCENE);
  let a = rd(P, "expBarMarkerX");
  if (a === MARKER_OFF) {                                            // .checkStoryCharacterSlot
    a = (u8(P, stat(P, base(P) + S.BAR)) + MARKER_BAR_X) & 0xFF;
    wr(P, "expBarMarkerX", a);
    return { a, b };
  }
  a = (a - b) & 0xFF;
  wr(P, "expBarMarkerX", a);
  if (a >= MARKER_START) return { a, b };
  wr(P, "expBarMarkerX", MARKER_OFF);
  return { a: MARKER_OFF, b };
}
// SweepExpBarMarkerRight (1D:7133): the marker one step right (from x $18 when it was off; off again past the
// bar's fill end)
export function sweepExpBarMarkerRight(P) {
  let { b } = getExpBarSweepStep(P);
  P.wramBank(WRAM_SCENE);
  let a = rd(P, "expBarMarkerX");
  if (a === MARKER_OFF) { wr(P, "expBarMarkerX", MARKER_START); return { a: MARKER_START, b }; }
  a = (a + b) & 0xFF;
  wr(P, "expBarMarkerX", a);
  b = a;
  const c = (u8(P, stat(P, base(P) + S.BAR)) + MARKER_BAR_X) & 0xFF;
  if (a < c) return { a, b, c };
  wr(P, "expBarMarkerX", MARKER_OFF);
  return { a: MARKER_OFF, b, c };
}
// GetExpBarSweepStep (1D:7168): the marker's step, (bar + $18) / 16 + 1 pixels (b)
export function getExpBarSweepStep(P) {
  P.wramBank(WRAM_SCENE);
  const a = ((((u8(P, stat(P, base(P) + S.BAR)) + 0x18) & 0xFF) >> 4) + 1) & 0xFF;
  return { a, b: a };
}

// ---- the palettes ----
// UpdateExpScreenSelectionPalettes (1D:7189): both characters' palettes (BG 1 and 2); the one not selected greyed,
// its name's colour (the word at +10 of its stats, in BG palettes 7 / 4) replaced by the grey $2108
export function updateExpScreenSelectionPalettes(P) {
  loadNameplatePalettes(P);
  P.wramBank(WRAM_SCENE);
  copyNamePalettes(P);
  const bg = P.A.bGPalettes, partnerSelected = !!P.V.storyCharacterSlot;
  let r;
  for (let i = 0; i < 4; i++) r = grayscalePaletteColorInPlace(P, bg + (partnerSelected ? 8 : 16) + 2 * i);
  const name = partnerSelected ? 58 : 34;                            // the other one's name colour
  P.bus.w8(bg + name, 0x08); P.bus.w8(bg + name + 1, 0x21);
  return { ...r, a: 0x21 };
}
// the two characters' overworld palettes as BG palettes 1 and 2 (LoadIndexedPaletteThunk)
function loadNameplatePalettes(P) {
  far(P, BANK_RANKING, () => loadIndexedPaletteThunk(P, P.V.storyModeMainCharacterOverworldSpriteColor, 1, 1));
  far(P, BANK_RANKING, () => loadIndexedPaletteThunk(P, P.V.storyModePartnerCharacterOverworldSpriteColor, 2, 1));
}
// the names' colours (stats +10 / +25) into BG palettes 7 and 4, colour 1
function copyNamePalettes(P) {
  const bg = P.A.bGPalettes;
  P.bus.w8(bg + 58, u8(P, stat(P, S.NAME_PAL))); P.bus.w8(bg + 59, u8(P, stat(P, S.NAME_PAL + 1)));
  P.bus.w8(bg + 34, u8(P, stat(P, S.PARTNER + S.NAME_PAL))); P.bus.w8(bg + 35, u8(P, stat(P, S.PARTNER + S.NAME_PAL + 1)));
}
// GrayscalePaletteColorInPlace (1D:7205): the colour at hl replaced by its grey (ConvertColorToGrayscale).
// Returns hl + 1 and the registers the conversion leaves.
export function grayscalePaletteColorInPlace(P, hl) {
  const r = convertColorToGrayscale(P, P.bus.u16(hl));
  P.bus.w8(hl, r.e); P.bus.w8(hl + 1, r.d);
  return { a: r.e, b: r.b, d: r.d, e: r.e, hl: (hl + 1) & 0xFFFF };
}
// ConvertColorToGrayscale (1D:7210): a colour (de) as a grey: the mean of its components, worked out in wDecompBuffer
// (WRAM 1). The ROM's bugs kept (docs/bugs.md): green loses its top bit (shifted by 2, not 3), blue goes to $0002 (the
// MBC's RAM gate) instead of $D002, so the sum takes the stale byte there, and it is halved, not divided by three.
// Returns the grey in de; a and the flags are the caller's (pop af), b = green's low bits; hl kept.
export function convertColorToGrayscale(P, de) {
  const { bus } = P, e = de & 0xFF, d = de >> 8, old = P.V.wramBank;
  P.wramBank(WRAM_STAGING);
  bus.w8(wDecompBuffer, e & 0x1F);                                   // red
  const b = (e & 0xE0) >> 5;
  bus.w8(wDecompBuffer + 1, ((d & 0x03) << 2) | b);                  // green (one bit short)
  bus.w8(rRAMG + 2, (d & 0x7C) >> 2);                                // blue: to the RAM gate
  let sum = (bus.u8(wDecompBuffer) + bus.u8(wDecompBuffer + 1)) & 0xFF;
  sum = (sum + bus.u8(wDecompBuffer + 2)) & 0xFF;
  const grey = (sum >> 1) & 0x1F;
  bus.w8(wDecompBuffer + 3, grey);
  const ne = (((grey << 5) & 0xE0) | grey) & 0xFF;
  const nd = ((grey >> 3) & 0x03) | ((grey << 2) & 0xFF);
  P.wramBank(old);
  return { a: old, b, d: nd, e: ne, de: (nd << 8) | ne };
}

// ---- the points ----
// AssignExpPointToChar (1D:726D): one point of the pool to the selected character (given + 1, progress + 1, to the
// next level - 1; a level-up when that reaches 0). Returns a = 1, or 0 when the pool is empty.
export function assignExpPointToChar(P) {
  P.wramBank(WRAM_SCENE);
  const pool = rd16(P, "expPoolRemaining");
  if (!pool) return { a: 0, f: FZ };
  P.bus.w16(P.A.expPoolRemaining, pool - 1);
  const k = base(P);
  put16(P, k + S.GIVEN, get16(P, k + S.GIVEN) + 1);
  put16(P, k + S.PROGRESS, get16(P, k + S.PROGRESS) + 1);
  put16(P, k + S.TO_NEXT, get16(P, k + S.TO_NEXT) - 1);
  checkExpLevelUp(P);
  return { a: 1 };
}
// UnassignExpPointFromChar (1D:72DD): one point given back to the pool (given - 1, progress - 1, to the next level
// + 1; a level-down below the level's start). Returns a = 1, or 0 when nothing was given to the character.
export function unassignExpPointFromChar(P) {
  P.wramBank(WRAM_SCENE);
  const k = base(P), given = get16(P, k + S.GIVEN);
  if (!given) return { a: 0, f: FZ };
  put16(P, k + S.GIVEN, given - 1);
  put16(P, k + S.PROGRESS, get16(P, k + S.PROGRESS) - 1);
  put16(P, k + S.TO_NEXT, get16(P, k + S.TO_NEXT) + 1);
  checkExpLevelDown(P);
  const pool = (rd16(P, "expPoolRemaining") + 1) & 0xFFFF;           // .step2
  P.bus.w16(P.A.expPoolRemaining, pool);
  return { a: 1, de: pool, hl: (P.A.expPoolRemaining + 1) & 0xFFFF };
}
// CheckExpLevelUp (1D:737D): no EXP left to the next level: the level up (the fanfare due), the new level's EXP
// needed as the EXP to the next one, the progress 0
export function checkExpLevelUp(P) {
  P.wramBank(WRAM_SCENE);
  const k = base(P), toNext = get16(P, k + S.TO_NEXT);
  if (toNext) return { a: (toNext >> 8 | toNext) & 0xFF, f: 0, de: toNext, hl: stat(P, k + S.TO_NEXT + 1) };
  wr(P, "expLevelUpFanfare", FANFARE_NEW);
  const level = (u8(P, stat(P, k + S.LEVEL)) + 1) & 0xFF;
  w8(P, stat(P, k + S.LEVEL), level);
  const needed = far(P, 0x02, () => rom(P, FAR.GetExpRequiredForLevel, { a: (level - 1) & 0xFF })).hl;
  put16(P, k + S.NEEDED, needed);
  put16(P, k + S.TO_NEXT, needed);
  put16(P, k + S.PROGRESS, 0);
  return { a: 0, f: FZ, hl: needed };
}
// CheckExpLevelDown (1D:73E7): the progress below 0 ($FFFF): the level down, its EXP needed, the progress its last
// point (needed - 1), 1 to the next level
export function checkExpLevelDown(P) {
  P.wramBank(WRAM_SCENE);
  const k = base(P), next = (get16(P, k + S.PROGRESS) + 1) & 0xFFFF;
  if (next) return { a: (next >> 8 | next) & 0xFF, f: 0, de: next, hl: stat(P, k + S.PROGRESS + 1) };
  const level = (u8(P, stat(P, k + S.LEVEL)) - 1) & 0xFF;
  w8(P, stat(P, k + S.LEVEL), level);
  const needed = far(P, 0x02, () => rom(P, FAR.GetExpRequiredForLevel, { a: (level - 1) & 0xFF })).hl;
  put16(P, k + S.NEEDED, needed);
  put16(P, k + S.PROGRESS, needed - 1);
  put16(P, k + S.TO_NEXT, 1);
  return { a: 0, hl: (needed - 1) & 0xFFFF };
}
// RefreshExpScreenReadouts (1D:7373): the pool, and the selected character's level and bar, redrawn
export function refreshExpScreenReadouts(P) {
  drawExpPoolReadout(P);
  drawExpScreenLevelNumber(P);
  return drawExpScreenLevelBar(P);
}

// ---- the maps ----
// UploadExpScreenTilemapRows (1D:734B): the tilemap rows that change (1-11, 13-14 and half of 16) queued to VRAM
export function uploadExpScreenTilemapRows(P) {
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, cell(wShadowTilemap, 1, 0), vBGMap0 + 1 * TILEMAP_WIDTH, 11 * TILEMAP_WIDTH / 16);
  queueVRAMCopy(P, cell(wShadowTilemap, 13, 0), vBGMap0 + 13 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
  return { c: 1, ...queueVRAMCopy(P, cell(wShadowTilemap, 16, 0), vBGMap0 + 16 * TILEMAP_WIDTH, 1) };
}
// UploadExpPromptWindowRows (1D:7505) / UploadExpPromptWindowRowsClosing (1D:7545): map rows 12-17 (tiles and
// attributes) queued to VRAM
export function uploadExpPromptWindowRows(P) {
  const rows = cell(wCharDataScreenCell, 12, 0), dest = vBGMap0 + 12 * TILEMAP_WIDTH, blocks = 6 * TILEMAP_WIDTH / 16;
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, rows, dest, blocks);
  P.wramBank(WRAM_COURT_PLANES);
  return { c: blocks, ...queueVRAMCopy(P, rows, dest + VRAM_BANK1, blocks) };
}
export const uploadExpPromptWindowRowsClosing = uploadExpPromptWindowRows;
// DrawExpPromptCursor (1D:7568): the prompt's blinking cursor (8 frames on, 8 off) at "yes" or "no"
export function drawExpPromptCursor(P) {
  const blink = P.bus.u8(hVBlankCounter) & 0x08;
  if (!blink) return { a: 0, f: FZ | FH };
  const y = rd(P, "expPromptCursorRow") ? 0x87 : 0x7F;
  return { b: OAM_BANK1, c: 0x16, d: 0x0C, e: y, ...queueSprite(P, OAM_BANK1, 0x16, 0x0C, y) };
}
// ApplyTilemapPatchListExpScreen (1D:7610): patch records [offset (big-endian, from $D000), source (from bc),
// count] until $FF: count cells of tiles (WRAM 3) and attributes (WRAM 2) copied from bc + source to $D000 + offset.
// The source address passes through wCharDataNumberBuffer (WRAM 6), as in the ROM.
export function applyTilemapPatchListExpScreen(P, hl, bc) {
  const { bus } = P;
  let de = 0;
  for (;;) {
    if (bus.u8(hl) === 0xFF) return { a: 0xFF, f: FZ | FN, hl, ...(de ? { de } : {}) };
    de = (wCharDataScreenCell + (bus.u8(hl) << 8 | bus.u8(hl + 1))) & 0xFFFF;
    P.wramBank(WRAM_SCENE);
    const from = ix(bc, bus.u8(hl + 2));
    wr(P, "charDataNumberBuffer", from & 0xFF); wr(P, "charDataNumberBuffer", from >> 8, 1);
    let src = rd16(P, "charDataNumberBuffer");
    for (let c = bus.u8(hl + 3) || 0x100; c > 0; c--) {
      P.wramBank(WRAM_SCREEN); bus.w8(de, bus.u8(src));
      P.wramBank(WRAM_COURT_PLANES); bus.w8(de, bus.u8(src));
      src = (src + 1) & 0xFFFF; de = (de + 1) & 0xFFFF;
    }
    hl = (hl + 4) & 0xFFFF;
  }
}

// ---- the frame tasks ----
// DrawExpToNextLevelTask (1D:765E): the selected character's EXP to the next level (3 digit sprites) and its label,
// unless the cursor slides, the prompt is up, the screen only shows, or the character is at the level cap
export function drawExpToNextLevelTask(P) {
  P.wramBank(WRAM_SCENE);
  const c = cursor(P);
  if (c & (CURSOR_SLIDING | CURSOR_PROMPT) || rd(P, "charDataViewOnly")) return {};
  const partner = !!P.V.storyCharacterSlot, k = partner ? S.PARTNER : 0;
  P.wramBank(WRAM_SCENE);
  if (u8(P, stat(P, k + S.LEVEL)) >= 0x64) return {};
  const buf = P.A.charDataNumberBuffer, y = partner ? 0x62 : 0x2F;
  formatDecimalNumberUnsigned(P, get16(P, k + S.TO_NEXT), 3, buf);
  [0x18, 0x1F, 0x26].forEach((x, i) => {
    const ch = P.bus.u8(buf + i);
    if (i < 2 && ch === 0x20) return;                                // leading blanks not drawn
    const s = getExpScreenDigitSprite(ch);
    queueSprite(P, s.b, s.c, x, y);
  });
  return queueSpriteTemplate(P, partner ? DrawExpToNextLevelTask_SpriteTemplate1 : DrawExpToNextLevelTask_SpriteTemplate0,
    0x14, partner ? 0x61 : 0x2E, partner ? 0x44 : 0x2C, OAM_BANK1 | 6, P.cpu.sp - 2);
}
// GetExpScreenDigitSprite (1D:771E): the sprite of digit a: tile (a - '0') * 2 + $18, attribute $0E
export function getExpScreenDigitSprite(a) {
  const c = (((((a - 0x30) & 0xFF) << 1) | (((a - 0x30) & 0xFF) >> 7)) + 0x18) & 0xFF;
  return { a: c, b: 0x0E, c };
}
// DrawExpCharCursorTask (1D:7727): the cursor beside the selected character, at its slide step's y
export function drawExpCharCursorTask(P) {
  P.wramBank(WRAM_SCENE);
  const y = (u8(P, ix(DrawExpCharCursorTaskTable, rd(P, "expCursorSlide"))) + 1) & 0xFF;
  return queueSpriteTemplate(P, DrawExpCharCursorTask_SpriteTemplate, 0x19, y, 0x00, OAM_BANK1 | 6, P.cpu.sp - 2);
}
// DrawExpBarFillMarkersTask (1D:7760): the markers at the end of both characters' bar fills
export function drawExpBarFillMarkersTask(P) {
  P.wramBank(WRAM_SCENE);
  queueSpriteTemplate(P, DrawExpBarFillMarkersTask_SpriteTemplate, (u8(P, stat(P, S.BAR)) + 0x38) & 0xFF, 0x01, 0x0C,
    OAM_BANK1 | 7, P.cpu.sp - 2);
  return queueSpriteTemplate(P, DrawExpBarFillMarkersTask_SpriteTemplate, (u8(P, stat(P, S.PARTNER + S.BAR)) + 0x38) & 0xFF,
    0x49, 0x0C, OAM_BANK1 | 7, P.cpu.sp - 2);
}
// DrawExpBarSweepSpriteTask (1D:7789): the sweep marker on the selected character's bar
export function drawExpBarSweepSpriteTask(P) {
  const y = P.V.storyCharacterSlot ? 0x49 : 0x01;
  P.wramBank(WRAM_SCENE);
  return queueSpriteTemplate(P, DrawExpBarSweepSpriteTask_SpriteTemplate, rd(P, "expBarMarkerX"), y, 0x10, OAM_BANK1 | 7,
    P.cpu.sp - 2);
}

// ---- the pending awards (filled by the results screens, shown by the EXP award screen) ----
// ClearPendingExpAwards (1D:7CAE): no awards pending (the amounts and their variants). Registers kept; WRAM 6 left
// mapped.
export function clearPendingExpAwards(P) {
  P.wramBank(WRAM_SCENE);
  clearBytes(P, P.A.pendingExpAwardAmounts, 0x0F);
}
// SetPendingExpAward (1D:7CC6): award b (0 N64, 1 exhibition, 2 linked play, 3 match, 4 trophies) of de EXP, its
// message variant c (through PendingExpAwardSetters_1d)
export function setPendingExpAward(P, b, c, de) {
  P.wramBank(WRAM_SCENE);
  const i = ((b << 1) | (b >> 7)) & 0xFF, lo = (i + (PendingExpAwardSetters_1d & 0xFF)) & 0xFF;
  const hi = ((PendingExpAwardSetters_1d >> 8) + ((i + (PendingExpAwardSetters_1d & 0xFF)) >> 8)) & 0xFF;
  const f = subFlags(((lo + hi) & 0xFF), lo);                       // ld_hl_indexed's `sub l`
  const at = (hi << 8) | lo, setter = P.bus.u16(at), k = SETTERS.indexOf(setter);
  if (k < 0) throw new Error(`SetPendingExpAward: award ${b} jumps to ${setter.toString(16)}`);
  return { ...setPendingExpAwardSlot(P, k, c, de), f };
}
const SETTERS = [SetPendingExpAward_N64, SetPendingExpAward_Exhibition, SetPendingExpAward_Linked, SetPendingExpAward_Match,
  SetPendingExpAward_Trophy];
// SetPendingExpAward_N64 (1D:7CE3) ... _Trophy (1D:7D0F): award k's variant c and amount de
export function setPendingExpAwardSlot(P, k, c, de) {
  wr(P, "pendingExpAwardVariants", c, k);
  const hl = (P.A.pendingExpAwardAmounts + 2 * k) & 0xFFFF;
  P.bus.w8(hl, de & 0xFF); P.bus.w8(hl + 1, de >> 8);
  return { a: de & 0xFF, hl: (hl + 1) & 0xFFFF };
}

export const HOOKS = [
  [BANK, 0x6F3E, hookGen(P => runExpDistributionLoop(P))],
  [BANK, 0x70CC, hook(P => slideExpCursorToMainCharTask(P))],
  [BANK, 0x70E6, hook(P => slideExpCursorToPartnerTask(P))],
  [BANK, 0x7102, hook(P => sweepExpBarMarkerLeft(P))],
  [BANK, 0x7133, hook(P => sweepExpBarMarkerRight(P))],
  [BANK, 0x7168, hook(P => getExpBarSweepStep(P))],
  [BANK, 0x7189, hook(P => updateExpScreenSelectionPalettes(P))],
  [BANK, 0x7205, hook((P, c) => grayscalePaletteColorInPlace(P, c.hl))],
  [BANK, 0x7210, hook((P, c) => { const r = convertColorToGrayscale(P, c.de); return { a: r.a, b: r.b, d: r.d, e: r.e }; })],
  [BANK, 0x726D, hook(P => assignExpPointToChar(P))],
  [BANK, 0x72DD, hook(P => unassignExpPointFromChar(P))],
  [BANK, 0x734B, hook(P => uploadExpScreenTilemapRows(P))],
  [BANK, 0x7373, hook(P => { refreshExpScreenReadouts(P); })],
  [BANK, 0x737D, hook(P => checkExpLevelUp(P))],
  [BANK, 0x73E7, hook(P => checkExpLevelDown(P))],
  [BANK, 0x7505, hook(P => uploadExpPromptWindowRows(P))],
  [BANK, 0x7545, hook(P => uploadExpPromptWindowRowsClosing(P))],
  [BANK, 0x7568, hook(P => drawExpPromptCursor(P))],
  [BANK, 0x7610, hook((P, c) => applyTilemapPatchListExpScreen(P, c.hl, c.bc))],
  [BANK, 0x765E, hook(P => { drawExpToNextLevelTask(P); })],
  [BANK, 0x771E, hook((P, c) => getExpScreenDigitSprite(c.a))],
  [BANK, 0x7727, hook(P => { drawExpCharCursorTask(P); })],
  [BANK, 0x7760, hook(P => { drawExpBarFillMarkersTask(P); })],
  [BANK, 0x7789, hook(P => { drawExpBarSweepSpriteTask(P); })],
  [BANK, 0x77A7, hook(P => tickLevelUpJingle(P))],
  [BANK, 0x7CAE, hook(P => { clearPendingExpAwards(P); })],
  [BANK, 0x7CC6, hook((P, c) => setPendingExpAward(P, c.b, c.c, c.de))],
  [BANK, 0x7CE3, hook((P, c) => setPendingExpAwardSlot(P, 0, c.c, c.de))],
  [BANK, 0x7CEE, hook((P, c) => setPendingExpAwardSlot(P, 1, c.c, c.de))],
  [BANK, 0x7CF9, hook((P, c) => setPendingExpAwardSlot(P, 2, c.c, c.de))],
  [BANK, 0x7D04, hook((P, c) => setPendingExpAwardSlot(P, 3, c.c, c.de))],
  [BANK, 0x7D0F, hook((P, c) => setPendingExpAwardSlot(P, 4, c.c, c.de))],
];

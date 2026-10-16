// Bank $1a: the debug EXP editor (in debug step mode, Select opens a window with both story characters' EXP: A adds
// 100, Right 10, Left 1 to the character picked with Up / Down; B closes it and shows the EXP gain screen for each)
// and the unused EXP gain screen itself: the character's name, level and sprite, the EXP counted up into a gauge
// (A / B to hurry it), a bonus message, and the award added at the end.
// Port of src/engine/menus/debug/expeditor_1a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own. Nothing in the game reaches this code.
// Tests: web/tests/port/routines_menus_misc.mjs (Unused_1a_DebugAddExp; the hotkey check outside debug step mode);
// lockstep on out/port/dbg_expgain.mtrec and dbg_expedit.mtrec (scripted).
import {
  FZ, FAR, rom, romWait, u8, w8, wram, sound, advanceFrame, waitFrames, fadeOut, fadeIn, clearFrameTasks, disableLCDSafely,
  enableLCD, registerFrameTask, unregisterFrameTask, hook, hookGen, WRAM_STAGING, WRAM_TEXT, WRAM_SCENE, VRAM_BANK1,
  vBGMap0, wDecompBuffer, PADF_A, PADF_B, PADF_SELECT, PADF_LEFT, PADF_RIGHT, PADF_UP, PADF_DOWN, SFX_MENU_MOVE,
  SFX_MENU_SELECT, SFX_MENU_CANCEL, wWindowShadowTilemap, wStoryMainCharExp, wStoryPartnerCharExp, wStoryCharacterSlot,
  wPauseMenuWindowId, wExpBonusPending, wExpBonusAmount, wCharDataAnimCounter, wExpScreenFlags, wExpAwardTotal,
  wExpAwardCounted, wExpCountedSprite, wExpCountDone, wExpCountFastForward, wExpNumberSpriteShiftX, wExpLevelUpQueued,
  wExpToNextLevel, wExpToNextSprite, wExpToNextDisplayed, wExpAwardSlot, MAX_LEVEL, storyRecord, STORY_RECORD_LEVEL,
  farFlagsAt,
} from "./defs.js";
import { queueVRAMCopy } from "../../home/memory.js";
import { clearSpriteQueue } from "../../home/fade.js";
import { copyMapToScrollBuffers } from "../../home/palettes.js";
import { formatDecimalNumber } from "../../home/debugtext.js";
import { getRegs } from "../../home/cpu.js";
import { drawExpScreenNameAndLevel } from "./expscreen.js";
import { loadExpScreenGfx, drawExpScreenYesNoBox } from "./exp_boxes.js";
import {
  drawExpScreenCaption, unusedAdvanceExpGaugeFill, unusedDrawExpBonusMessage, unusedResetCharDataScreenAnim,
} from "./exp_gauge.js";

export const BANK = 0x1A;
export const Unused_1a_StubNop_1a_0 = 0x4779, Unused_1a_ExpScreenDrawTask = 0x477A;
export const Unused_1a_ExpScreenNumberTask = 0x4E65;
const EDITOR_WINDOW = { x: 0, y: 0, w: 0x14, h: 0x04 }, EXP_DIGITS = 4, MAIN_EXP_CELL = 0x0801, PARTNER_EXP_CELL = 0x0802;
const ADD_A = 100, ADD_RIGHT = 10, ADD_LEFT = 1;
const LAYOUT_YES_NO = 0x00, NO_COUNTING = 0x04;
const CAPTION_COUNTING = 0x02, CAPTION_MAX_LEVEL = 0x05;
const MAP_BLOCKS = 0x24;                                          // SCREEN_HEIGHT * TILEMAP_WIDTH / 16
const COUNTED_SPRITE = [0x1C, 0x6C, 0xCA, 0x0F], TO_NEXT_SPRITE = [0x68, 0x84, 0xCA, 0x08];
const COUNT_STEP_FRAMES = 4, FAST_FILL_STEPS = 6, FASTER_FILL_STEPS = 8, FAST_FROM = 1000, FASTER_FROM = 10000;
const NUMBER_SLIDE_FROM = 0xFC, BONUS_WAIT = 0x28, FINAL_WAIT = 0xF0, BONUS_SHOWN_FRAMES = 20;

// Unused_1a_CheckDebugExpEditorHotkey (1A:4399): in debug step mode, Select held opens the EXP editor
export function* unusedCheckDebugExpEditorHotkey(P) {
  if (P.V.debugStepMode && P.V.playerInputFlags & PADF_SELECT) yield* unusedRunDebugExpEditor(P);
}
// Unused_1a_RunDebugExpEditor (1A:43AA): the editor window; B shows the gain screen for the main character (slot 0)
// and the partner (slot 1), each with its EXP as the award
export function* unusedRunDebugExpEditor(P) {
  const old = P.V.wramBank;
  wram(P, WRAM_TEXT);
  const { x, y, w, h } = EDITOR_WINDOW;
  w8(P, wPauseMenuWindowId, rom(P, FAR.CreateWindow, { d: x, e: y, b: w, c: h }).a);
  yield* romWait(P, FAR.RestoreShadowTilemap);
  rom(P, FAR.Unused_05_StubNop_05_0);
  let slot = 0;                                                   // (c, which the window routines keep)
  for (;;) {
    for (const [exp, cell] of [[wStoryMainCharExp, MAIN_EXP_CELL], [wStoryPartnerCharExp, PARTNER_EXP_CELL]]) {
      formatDecimalNumber(P, P.bus.u16(exp), EXP_DIGITS, wWindowShadowTilemap);
      slot = rom(P, FAR.WriteStringToWindow, { hl: wWindowShadowTilemap, de: cell, a: u8(P, wPauseMenuWindowId), c: slot }).c;
    }
    slot = (yield* romWait(P, FAR.RestoreShadowTilemap, { c: slot })).c;
    slot = rom(P, FAR.Unused_05_StubNop_05_0, { c: slot }).c;
    yield* advanceFrame(P);
    const input = P.V.playerInputFlags;
    const add = n => unusedDebugAddExp(P, slot, n, { ...getRegs(P.cpu), c: slot });
    if (input & PADF_A) { sound(P, SFX_MENU_SELECT); add(ADD_A); continue; }
    if (input & PADF_RIGHT) { sound(P, SFX_MENU_MOVE); add(ADD_RIGHT); continue; }
    if (input & PADF_LEFT) { sound(P, SFX_MENU_MOVE); add(ADD_LEFT); continue; }
    if (input & (PADF_UP | PADF_DOWN)) { sound(P, SFX_MENU_CANCEL); slot ^= 1; continue; }
    if (input & PADF_B) break;
  }
  yield* romWait(P, FAR.CloseWindow, { a: u8(P, wPauseMenuWindowId) });
  for (const [exp, which] of [[wStoryMainCharExp, 0], [wStoryPartnerCharExp, 1]]) {
    const de = P.bus.u16(exp);
    yield* unusedResetCharDataScreenAnim(P, { ...getRegs(P.cpu), a: de & 0xFF, d: de >> 8, e: de & 0xFF, h: exp >> 8, l: which });
  }
  wram(P, old);
}
// Unused_1a_DebugAddExp (1A:4473): de EXP to story character c (AddPlayerExp; bc kept)
export function unusedDebugAddExp(P, slot, de, entry) {
  const r = rom(P, FAR.AddPlayerExp, { ...entry, f: farFlagsAt(P, 1), a: slot, de });
  return { ...r, b: entry.b, c: entry.c };
}
// Unused_1a_ShowExpGainScreen (1A:44D8): the gain screen of story character l (wStoryCharacterSlot) with layout a
// (0: a yes / no box and nothing more; 1: one sprite; others: two). Otherwise caption h, the level caption, then the
// award de counted into the gauge (not for h = 4) with the bonus of wExpBonusPending; added to the character's EXP
// at the end (AddPlayerExp's registers returned). Layout 0 returns a = the WRAM bank, the caller's flags.
export function* unusedShowExpGainScreen(P, entry) {
  const { a: layout, h: caption, l: slot, f: entryF } = entry, award = entry.d << 8 | entry.e;
  w8(P, wStoryCharacterSlot, slot);
  const old = P.V.wramBank;
  yield* fadeOut(P, 16);
  clearFrameTasks(P);
  rom(P, FAR.InitTextWindows);
  rom(P, FAR.LoadMenuFontGfx);
  disableLCDSafely(P);
  clearSpriteQueue(P);
  P.V.scrollY = 0;
  P.V.scrollX = 0;
  loadExpScreenGfx(P, { ...getRegs(P.cpu), a: 0, h: layout, l: slot });
  yield* drawExpScreenNameAndLevel(P);
  if (layout === LAYOUT_YES_NO) {
    yield* drawExpScreenYesNoBox(P);
    registerFrameTask(P, 0x0E, Unused_1a_StubNop_1a_0);
    yield* showExpScreen(P);
    wram(P, old);
    return { a: old, f: entryF };
  }
  wram(P, old);
  yield* drawExpScreenCaption(P, caption);
  wram(P, WRAM_SCENE);
  yield* drawExpScreenCaption(P, u8(P, storyRecord(P) + STORY_RECORD_LEVEL) === MAX_LEVEL ? CAPTION_MAX_LEVEL : CAPTION_COUNTING);
  wram(P, WRAM_SCENE);
  P.bus.w16(wExpAwardTotal, award);
  P.bus.w16(wExpAwardCounted, 0);
  COUNTED_SPRITE.forEach((v, i) => w8(P, wExpCountedSprite + i, v));
  w8(P, wExpCountDone, 0);
  w8(P, wExpCountFastForward, 0);
  w8(P, wExpNumberSpriteShiftX, 0);
  w8(P, wExpAwardSlot, slot);
  const toNext = rom(P, FAR.GetExpRemainingToNextLevel, {
    ...getRegs(P.cpu), f: farFlagsAt(P, 4), a: slot, de: 0, b: caption, c: entry.c, h: entry.h, l: slot,
  }).hl;
  P.bus.w16(wExpToNextLevel, toNext);
  P.bus.w16(wExpToNextDisplayed, toNext);
  TO_NEXT_SPRITE.forEach((v, i) => w8(P, wExpToNextSprite + i, v));
  w8(P, wExpLevelUpQueued, 0);
  w8(P, wExpScreenFlags, 0);
  yield* showExpScreen(P, Unused_1a_ExpScreenNumberTask);
  wram(P, WRAM_SCENE);
  if (caption !== NO_COUNTING && P.bus.u16(wExpAwardTotal)) yield* countExpAward(P);
  yield* waitWithNumbersSliding(P, FINAL_WAIT);
  yield* fadeOut(P, 16);
  unregisterFrameTask(P, Unused_1a_ExpScreenDrawTask);
  unregisterFrameTask(P, Unused_1a_ExpScreenNumberTask);
  yield* advanceFrame(P);
  wram(P, old);
  wram(P, WRAM_SCENE);
  const total = P.bus.u16(wExpAwardTotal), hl = (wExpAwardTotal + 1) & 0xFFFF;
  if (!total) return { a: 0, f: FZ, b: entry.b, c: entry.c, de: 0, hl };
  return rom(P, FAR.AddPlayerExp, { ...getRegs(P.cpu), f: farFlagsAt(P, 0), a: u8(P, wExpAwardSlot), de: total, hl, b: entry.b, c: entry.c });
}
export const showExpGainScreen = unusedShowExpGainScreen;
// the tile buffer's maps queued, the scroll planes filled, the draw task started, the LCD on and the fade in; then
// the second task (ShowExpGainScreen.queueVRAMCopy for layout 0, and the same steps inline for the others)
function* showExpScreen(P, secondTask) {
  wram(P, WRAM_STAGING);
  queueVRAMCopy(P, wDecompBuffer, vBGMap0 + VRAM_BANK1, MAP_BLOCKS);
  queueVRAMCopy(P, wDecompBuffer + 0x400, vBGMap0, MAP_BLOCKS);
  copyMapToScrollBuffers(P);
  registerFrameTask(P, 0x0F, Unused_1a_ExpScreenDrawTask);
  enableLCD(P);
  yield* fadeIn(P, 16);
  if (secondTask) registerFrameTask(P, 0x0F, secondTask);
}
// the award counted one a step (a sound and 4 frames each); A or B, once pressed, hurries it: one step a frame,
// 7 for an award of 1000 or more, 15 for 10000 or more. At the total, a pending bonus is shown and added, and the
// counting goes on.
function* countExpAward(P) {
  for (;;) {
    unusedAdvanceExpGaugeFill(P, 0);
    if (u8(P, wExpCountDone)) {
      sound(P, SFX_MENU_SELECT);
      const bonus = u8(P, wExpBonusPending);
      if (!bonus) return;
      wram(P, WRAM_SCENE);
      yield* waitWithNumbersSliding(P, BONUS_WAIT);
      yield* unusedDrawExpBonusMessage(P, bonus, getRegs(P.cpu));
      sound(P, SFX_MENU_SELECT);
      yield* waitFrames(P, BONUS_SHOWN_FRAMES);
      wram(P, WRAM_SCENE);
      P.bus.w16(wExpAwardTotal, (P.bus.u16(wExpAwardTotal) + P.bus.u16(wExpBonusAmount)) & 0xFFFF);
      w8(P, wExpBonusPending, 0);
      w8(P, wExpCountDone, 0);
      continue;
    }
    if (!u8(P, wExpCountFastForward) && !(P.V.playerInputFlags & (PADF_A | PADF_B))) {
      sound(P, SFX_MENU_MOVE);
      yield* waitFrames(P, COUNT_STEP_FRAMES);
      continue;
    }
    w8(P, wExpCountFastForward, 1);
    sound(P, SFX_MENU_SELECT);
    unusedAdvanceExpGaugeFill(P, 0);
    const total = P.bus.u16(wExpAwardTotal);
    if (total >= FAST_FROM) {
      const steps = (total >= FASTER_FROM ? FASTER_FILL_STEPS : 0) + FAST_FILL_STEPS;
      for (let i = 0; i < steps; i++) unusedAdvanceExpGaugeFill(P, 0);
    }
    yield* advanceFrame(P);
  }
}
// up to n frames (a press ends them), the number sprites sliding in from 4 pixels left unless a level-up runs
function* waitWithNumbersSliding(P, frames) {
  wram(P, WRAM_SCENE);
  w8(P, wExpNumberSpriteShiftX, u8(P, wCharDataAnimCounter) ? 0 : NUMBER_SLIDE_FROM);
  for (let b = frames; ;) {
    const shift = u8(P, wExpNumberSpriteShiftX);
    if (shift) w8(P, wExpNumberSpriteShiftX, shift + 1);
    yield* advanceFrame(P);
    b = (b - 1) & 0xFF;
    if (!b || P.V.inputRisingEdge) return;
  }
}

export const HOOKS = [
  [BANK, 0x4399, hookGen(P => unusedCheckDebugExpEditorHotkey(P))],
  [BANK, 0x43AA, hookGen(P => unusedRunDebugExpEditor(P))],
  [BANK, 0x4473, hook((P, c) => unusedDebugAddExp(P, c.c, c.de, getRegs(c)))],
  [BANK, 0x44D8, hookGen((P, c) => unusedShowExpGainScreen(P, getRegs(c)))],
];

// The stat pages of bank $1D's character-data screen and the slides between them: the main character's page (left of
// the summary) and the partner's (right), their stat digits as sprites, the bobbing arrows, the input loop of the
// three pages, and the slides: a fixed run of steps, each the base page with the next patches of the pages that
// slide in or out, the stat and values sprites moved, the screen flushed (three frames).
// Port of src/engine/menus/char_data/page_slides_1d.asm and partner_1d.asm of the gerbiljames/mario-tennis-gbc-disasm
// (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own. Patch lists, tables and sprite
// templates are read from the ROM.
//
// The pages' arrow mode (wCharDataPageArrowMode): 0 the summary (arrows both ways), 1 the main character's page
// (an arrow right, back), 2 the partner's (an arrow left). wCharDataArrowHold pushes the arrows out (the slide-out
// task) and back (the slide-in task); wCharDataArrowPhase bobs them.
import {
  rd, wr, u8, w8, idx, far, farGen, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, TILEMAP_WIDTH, PADF_A, PADF_B,
  PADF_RIGHT, PADF_LEFT, OAM_BANK1, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, wCharDataScreenCell,
  wCharDataPagePlane, wCharDataPageSlot1, wCharDataPageSlot2, wCharDataPageSlot3, wCharStatPageShown_SIZE,
  storyField, sound, advanceFrame, registerFrameTask, unregisterFrameTask, queueSprite, copyMemoryBC,
  formatDecimalNumberUnsigned, hook, hookGen,
} from "../char_select/defs.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { queueSpriteTemplate } from "../../home/fade.js";
import { charDataScreenDrawStats, charDataScreenWriteStatNumber, flushCharDataTilemaps, startCharDataScreenAnimTask } from "./screen.js";
import { drawStatChangeArrows } from "./stat_arrows.js";
import { applySlideOffsetToSpriteX, getCharDataDigitSprite } from "./confirm.js";
import { writeNameStringTiles, loadBasePageIntoWorkTilemap, writeRecordNumber, CharDataScreenBgScrollTask,
  CharDataValuesSyncTask } from "./pages.js";
import { PATCH, MAIN, PARTNER, TEMPLATE, F } from "./patches.js";

export const BANK = 0x1D;
const BANK_SCREEN = 0x1C, BANK_STAT_ARROWS = 0x1A;
// frame tasks (bank $1D)
export const DrawCharDataPageArrowsTask = 0x4C04, SlideCharDataArrowsOutTask = 0x4E5E;
export const SlideCharDataArrowsInTask = 0x4E76, DrawCharStatDigitsTask = 0x57D2;
const CharDataArrowBobOffsetTable_1d = 0x4C9C;
const MODE_SUMMARY = 0, MODE_MAIN = 1, MODE_PARTNER = 2;
const DRILL_CELL = wCharDataScreenCell + 28 * TILEMAP_WIDTH + 16;   // where the drill display / its blank go
const rrca = a => ((a >> 1) | (a << 7)) & 0xFF;
const rlca = a => ((a << 1) | (a >> 7)) & 0xFF;
const record = (P, off) => storyField(rd(P, "storyCharacterSlot"), off);

// ---- the stat pages ----
// BuildMainCharStatPage (1D:4AEB) / BuildPartnerStatPage (1D:4B50): story character 0's / 1's stat display, its stat
// levels kept in wCharStatPageMain / Partner, and the page's patches
const STAT_PAGE_PATCHES = [
  [PATCH.StatPageTilemapPatch1, wCharDataScreenCell + 18 * TILEMAP_WIDTH],
  [PATCH.StatPageTilemapPatch2, wCharDataScreenCell + 20 * TILEMAP_WIDTH],
  [PATCH.StatPageTilemapPatch3, wCharDataScreenCell + 22 * TILEMAP_WIDTH + 16],
  [PATCH.StatPageTilemapPatch4, wCharDataScreenCell + 24 * TILEMAP_WIDTH + 16],
  [PATCH.StatPageTilemapPatch5, wCharDataPagePlane + 9 * TILEMAP_WIDTH + 16],
];
export function buildMainCharStatPage(P) {
  buildStatPage(P, 0, "charStatPageMain", [[MAIN[0], wCharDataScreenCell + 27 * TILEMAP_WIDTH + 16],
    [MAIN[1], wCharDataPagePlane + 8 * TILEMAP_WIDTH]]);
}
export function buildPartnerStatPage(P) {
  buildStatPage(P, 1, "charStatPagePartner", [[PARTNER[1], wCharDataPagePlane + 8 * TILEMAP_WIDTH],
    [PARTNER[0], wCharDataScreenCell + 28 * TILEMAP_WIDTH]]);
}
function buildStatPage(P, slot, page, patches) {
  wr(P, "storyCharacterSlot", slot);
  buildCharStatDisplay(P);
  P.wramBank(WRAM_SCENE);
  for (let i = 0; i < 4; i++) wr(P, page, rd(P, "charDataLevels", i), i);
  for (const [patch, src] of [...patches, ...STAT_PAGE_PATCHES]) applyTilemapPatchList(P, patch, src);
}
// ApplyTilemapPatchList (1D:4BB6): for each entry [offset (big-endian word), source offset, count] up to $FF: count
// tiles (WRAM 3) and attributes (WRAM 2) from bc + source offset to the screen map at wCharDataScreenCell + offset.
// The source pointer goes through wCharDataNumberBuffer (WRAM 6). (Instruction-identical to bank $1A's
// ApplyTilemapPatchList_1a.)
export function applyTilemapPatchList(P, hl, bc) {
  while (u8(P, hl) !== 0xFF) {
    let de = (wCharDataScreenCell + (u8(P, hl) << 8 | u8(P, hl + 1))) & 0xFFFF;
    const from = idx(bc, u8(P, hl + 2));
    P.wramBank(WRAM_SCENE);
    wr(P, "charDataNumberBuffer", from); wr(P, "charDataNumberBuffer", from >> 8, 1);
    let c = u8(P, hl + 3);
    let src = rd(P, "charDataNumberBuffer") | rd(P, "charDataNumberBuffer", 1) << 8;
    do {
      P.wramBank(WRAM_SCREEN);
      w8(P, de, u8(P, src));
      P.wramBank(WRAM_COURT_PLANES);
      w8(P, de, u8(P, src));
      src = (src + 1) & 0xFFFF; de = (de + 1) & 0xFFFF; c = (c - 1) & 0xFF;
    } while (c);
    hl = (hl + 4) & 0xFFFF;
  }
}
// BuildCharStatDisplay (1D:4E8D): the current story character's stat levels (wCharDataLevels) and skills + 1
// (wCharDataStats) drawn (CharDataScreen_DrawStats); its header row: a bar of tiles $A3 (cells 1-7), its name
// (cells 15 on, cleared first) and level (cell 25)
const F_SKILLS = F.SKILLS, NUM_SKILLS = 11;
export function buildCharStatDisplay(P) {
  P.wramBank(WRAM_SCENE);
  for (let i = 0; i < 4; i++) wr(P, "charDataLevels", u8(P, record(P, F.STAT_LEVELS + i)), i);
  for (let i = 0; i < NUM_SKILLS; i++) wr(P, "charDataStats", u8(P, record(P, F_SKILLS + i)) + 1, i);
  far(P, BANK_SCREEN, () => charDataScreenDrawStats(P));
  const header = wCharDataPagePlane + 8 * TILEMAP_WIDTH;
  P.wramBank(WRAM_SCREEN);
  for (let i = 0; i < 7; i++) { w8(P, header + 1 + i, 0xA3); w8(P, header + 15 + i, 0); }
  P.wramBank(WRAM_COURT_PLANES);
  for (let i = 0; i < 7; i++) { w8(P, header + 1 + i, 0x08); w8(P, header + 15 + i, 0x08); }
  writeNameStringTiles(P, record(P, 0), header + 15, 0x0E);
  writeRecordNumber(P, F.LEVEL, header + 25);
}

// ---- the arrows ----
// DrawCharDataPageArrowsTask (1D:4C04), a frame task: the bob advanced (while the arrows are not held out); the
// summary's two arrows, or the stat page's one, bobbing
export function drawCharDataPageArrowsTask(P) {
  P.wramBank(WRAM_SCENE);
  if (!rd(P, "charDataArrowHold")) wr(P, "charDataArrowPhase", rd(P, "charDataArrowPhase") + 1);
  const sp = (P.cpu.sp - 2) & 0xFFFF, mode = rd(P, "charDataPageArrowMode");
  if (mode === MODE_SUMMARY) {
    queueSpriteTemplate(P, TEMPLATE.DrawCharDataPageArrowsTask_SpriteTemplate0, bobArrowSpriteLeft(P, 0x10), 0x10,
      0x14, OAM_BANK1 | 6, sp);
    queueSpriteTemplate(P, TEMPLATE.DrawCharDataPageArrowsTask_SpriteTemplate1, bobArrowSpriteRight(P, 0x68), 0x10,
      0x1E, OAM_BANK1 | 6, sp);
  } else if (mode === MODE_MAIN) {
    queueSpriteTemplate(P, TEMPLATE.DrawCharDataPageArrowsTask_SpriteTemplate3, bobArrowSpriteRight(P, 0x7F), 0x03,
      0x30, OAM_BANK1 | 6, sp);
  } else {
    queueSpriteTemplate(P, TEMPLATE.DrawCharDataPageArrowsTask_SpriteTemplate2, bobArrowSpriteLeft(P, 0x01), 0x03,
      0x28, OAM_BANK1 | 6, sp);
  }
}
// BobArrowSpriteLeft (1D:4C60) / BobArrowSpriteRight (1D:4C80): x d moved out by the bob (phase / 2 into a 16-step
// table) and by the hold
const bob = P => {
  P.wramBank(WRAM_SCENE);
  return u8(P, idx(CharDataArrowBobOffsetTable_1d, rrca(rd(P, "charDataArrowPhase")) & 0x0F));
};
export const bobArrowSpriteLeft = (P, d) => (d - bob(P) - rd(P, "charDataArrowHold")) & 0xFF;
export const bobArrowSpriteRight = (P, d) => (d + bob(P) + rd(P, "charDataArrowHold")) & 0xFF;
// SlideCharDataArrowsOutTask (1D:4E5E): the hold out by 4 a frame, to $40 / SlideCharDataArrowsInTask (1D:4E76): back
// by 8 a frame, to 0; each task ends itself
export function slideCharDataArrowsOutTask(P) {
  P.wramBank(WRAM_SCENE);
  const hold = (rd(P, "charDataArrowHold") + 4) & 0xFF;
  wr(P, "charDataArrowHold", hold);
  if (hold >= 0x40) unregisterFrameTask(P, SlideCharDataArrowsOutTask);
}
export function slideCharDataArrowsInTask(P) {
  P.wramBank(WRAM_SCENE);
  const hold = (rd(P, "charDataArrowHold") - 8) & 0xFF;
  wr(P, "charDataArrowHold", hold);
  if (!hold) unregisterFrameTask(P, SlideCharDataArrowsInTask);
}

// ---- the input loop ----
// RunDrillResultInputLoop (1D:4CAC): on the summary, right slides to the partner's page and left to the main
// character's; on a stat page the other way back. A (select sound) or B (cancel sound) leaves, on any page.
export function* runDrillResultInputLoop(P) {
  P.wramBank(WRAM_SCENE);
  let mode = rd(P, "charDataPageArrowMode");
  if (mode > MODE_PARTNER) mode = MODE_PARTNER;
  for (;;) {
    yield* advanceFrame(P);
    const edge = P.V.inputRisingEdge;
    if (mode === MODE_SUMMARY) {
      if (edge & PADF_RIGHT) { yield* toStatPage(P, "charStatPagePartner", slideToPartnerStatPage, MODE_PARTNER); mode = MODE_PARTNER; continue; }
      if (edge & PADF_LEFT) { yield* toStatPage(P, "charStatPageMain", slideToMainCharStatPage, MODE_MAIN); mode = MODE_MAIN; continue; }
    } else {
      const back = mode === MODE_MAIN ? PADF_RIGHT : PADF_LEFT;
      if (edge & back) {
        yield* toSummary(P, mode === MODE_MAIN ? slideFromMainCharStatPage : slideFromPartnerStatPage);
        mode = MODE_SUMMARY;
        continue;
      }
    }
    if (edge & PADF_B) { sound(P, SFX_MENU_CANCEL); return; }
    if (edge & PADF_A) { sound(P, SFX_MENU_SELECT); return; }
  }
}
// the summary to a stat page: the arrows out, the stat digits shown with the page's levels and EXP, the slide, then
// the page's arrow in
function* toStatPage(P, page, slide, mode) {
  sound(P, SFX_MENU_MOVE);
  unregisterFrameTask(P, CharDataScreenBgScrollTask);
  unregisterFrameTask(P, SlideCharDataArrowsInTask);
  registerFrameTask(P, 1, SlideCharDataArrowsOutTask);
  registerFrameTask(P, 1, DrawCharStatDigitsTask);
  P.wramBank(WRAM_SCENE);
  for (let i = 0; i < 4; i++) wr(P, "charDataLevels", rd(P, page, i), i);
  copyMemoryBC(P, (P.A[page] + 4) & 0xFFFF, P.A.charStatPageShown, wCharStatPageShown_SIZE);
  yield* slide(P);
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataPageArrowMode", mode);
  registerFrameTask(P, 1, SlideCharDataArrowsInTask);
}
// a stat page back to the summary: the arrows out, the slide, then the summary's tasks again
function* toSummary(P, slide) {
  sound(P, SFX_MENU_MOVE);
  unregisterFrameTask(P, SlideCharDataArrowsInTask);
  registerFrameTask(P, 1, SlideCharDataArrowsOutTask);
  yield* slide(P);
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataPageArrowMode", MODE_SUMMARY);
  clearFrameTasks(P);
  registerFrameTask(P, 1, CharDataScreenBgScrollTask);
  registerFrameTask(P, 1, SlideCharDataArrowsInTask);
  registerFrameTask(P, 1, DrawCharDataPageArrowsTask);
  registerFrameTask(P, 1, CharDataValuesSyncTask);
  far(P, BANK_SCREEN, () => startCharDataScreenAnimTask(P));
}

// ---- the slides ----
// A slide: after the anim task's flush phase comes round to 0, each step sets the stat sprites' and the values'
// slide x (where given), puts the base page on the screen, patches it and flushes it (FlushCharDataTilemapsFar);
// then (but after SlideFromMainCharStatPage) the last slide x back to 0. Steps: [stats x, values x, patches [[list, source], ...]] (null: unchanged).
const rows = (base, a, b, c) => [[a, base], [b, base + 8 * TILEMAP_WIDTH], [c, base + 16 * TILEMAP_WIDTH]];
const M = (base, n) => rows(base, MAIN[n], MAIN[n + 1], MAIN[n + 2]);
const Pt = (base, n) => rows(base, PARTNER[n], PARTNER[n + 1], PARTNER[n + 2]);
const SP678 = rows(wCharDataPageSlot1, PATCH.StatPageTilemapPatch6, PATCH.StatPageTilemapPatch7, PATCH.StatPageTilemapPatch8);
const DRILL = [PATCH.DrillDisplayData_1d, DRILL_CELL], DRILL_BLANK = [PATCH.StatPageTilemapPatch0, DRILL_CELL];
function* runSlide(P, steps, last) {
  do yield* advanceFrame(P); while (rd(P, "charDataFlushChunk"));
  for (const [stats, values, patches] of steps) {
    if (stats !== null || values !== null) {
      P.wramBank(WRAM_SCENE);
      if (stats !== null) P.bus.w16(P.A.charDataStatsSlideX, stats);
      if (values !== null) P.bus.w16(P.A.charDataValuesSlideX, values);
    }
    loadBasePageIntoWorkTilemap(P);
    for (const [patch, src] of patches) applyTilemapPatchList(P, patch, src);
    yield* farGen(P, BANK_SCREEN, flushCharDataTilemaps(P));
  }
  if (!last) return;
  P.wramBank(WRAM_SCENE);
  P.bus.w16(P.A[last], 0);
}
// SlideToMainCharStatPage (1D:509C): the summary out to the right, the main character's page in from the left
const TO_MAIN = [
  [null, null, [...M(wCharDataPageSlot1, 2), DRILL]],
  [null, 0x0020, [...M(wCharDataPageSlot1, 5), DRILL_BLANK]],
  [0xFF60, 0x0040, [...M(wCharDataPageSlot1, 8), ...M(wCharDataPageSlot2, 26)]],
  [0xFF80, 0x0060, [...M(wCharDataPageSlot1, 11), ...M(wCharDataPageSlot2, 23)]],
  [0xFFA0, 0x0080, M(wCharDataPageSlot2, 20)],
  [0xFFC0, 0x00A0, M(wCharDataPageSlot2, 17)],
  [0xFFE0, 0x00A8, M(wCharDataPageSlot2, 14)],
];
export function* slideToMainCharStatPage(P) { yield* runSlide(P, TO_MAIN, "charDataStatsSlideX"); }
// SlideFromMainCharStatPage (1D:5268): back
const FROM_MAIN = [
  [0xFFE0, null, M(wCharDataPageSlot2, 17)],
  [0xFFC0, 0x00A0, M(wCharDataPageSlot2, 20)],
  [0xFFA0, 0x0080, [...M(wCharDataPageSlot1, 11), ...M(wCharDataPageSlot2, 23)]],
  [0xFF80, 0x0060, [...M(wCharDataPageSlot1, 8), ...M(wCharDataPageSlot2, 26)]],
  [0xFF60, 0x0040, [...M(wCharDataPageSlot1, 5), DRILL_BLANK]],
  [0x00A8, 0x0010, [...M(wCharDataPageSlot1, 2), DRILL]],
  [null, 0x0000, [...SP678, DRILL]],
];
export function* slideFromMainCharStatPage(P) { yield* runSlide(P, FROM_MAIN, null); }
// SlideToPartnerStatPage (1D:543D): the summary out to the left, the partner's page in from the right
const TO_PARTNER = [
  [null, 0xFFE0, [...Pt(wCharDataPageSlot1, 2), DRILL]],
  [0x00A0, 0xFFC0, [...Pt(wCharDataPageSlot1, 5), ...Pt(wCharDataPageSlot3, 26), DRILL_BLANK]],
  [0x0080, 0xFFA0, [...Pt(wCharDataPageSlot1, 8), ...Pt(wCharDataPageSlot3, 23)]],
  [0x0060, 0xFF80, [...Pt(wCharDataPageSlot1, 11), ...Pt(wCharDataPageSlot3, 20)]],
  [0x0040, 0xFF60, Pt(wCharDataPageSlot3, 17)],
  [0x0020, 0x00A8, Pt(wCharDataPageSlot3, 14)],
];
export function* slideToPartnerStatPage(P) { yield* runSlide(P, TO_PARTNER, "charDataStatsSlideX"); }
// SlideFromPartnerStatPage (1D:5603): back
const FROM_PARTNER = [
  [0x0020, null, Pt(wCharDataPageSlot3, 17)],
  [0x0040, 0xFF60, [...Pt(wCharDataPageSlot1, 11), ...Pt(wCharDataPageSlot3, 20)]],
  [0x0060, 0xFF80, [...Pt(wCharDataPageSlot1, 8), ...Pt(wCharDataPageSlot3, 23)]],
  [0x0080, 0xFFA0, [...Pt(wCharDataPageSlot1, 5), ...Pt(wCharDataPageSlot3, 26), DRILL_BLANK]],
  [0x00A0, 0xFFC0, [...Pt(wCharDataPageSlot1, 2), DRILL]],
  [0x00A8, 0xFFE0, [...SP678, DRILL]],
];
export function* slideFromPartnerStatPage(P) { yield* runSlide(P, FROM_PARTNER, "charDataValuesSlideX"); }

// ---- the stat page's sprites ----
// DrawCharStatDigitsTask (1D:57D2), a frame task: the four stat levels (one or two digits) and the EXP shown
// (wCharStatPageShown: five characters, blanks left out but the last), moved with the stats' slide; then bank $1A's
// racket arrows
const LEVEL_DIGITS = [[0x05, 0x0C, 0x09, 0x1C], [0x05, 0x0C, 0x09, 0x44], [0x55, 0x5C, 0x59, 0x1C], [0x55, 0x5C, 0x59, 0x44]];
const EXP_X = [0x29, 0x31, 0x39, 0x41, 0x49];
export function drawCharStatDigitsTask(P) {
  P.wramBank(WRAM_SCENE);
  const slide = P.A.charDataStatsSlideX;
  const put = (b, c, x, y) => queueSprite(P, b, c, applySlideOffsetToSpriteX(P, slide, x), y);
  LEVEL_DIGITS.forEach(([tensX, onesX, singleX, y], i) => {
    const level = rd(P, "charDataLevels", i);
    if (level >= 0x0A) {
      formatDecimalNumberUnsigned(P, level, 2, P.A.charDataNumberBuffer);
      put(0x0F, rlca((rd(P, "charDataNumberBuffer") - 0x30) & 0xFF), tensX, y);
      put(0x0F, rlca((rd(P, "charDataNumberBuffer", 1) - 0x30) & 0xFF), onesX, y);
    } else put(0x0F, rlca(level), singleX, y);
  });
  EXP_X.forEach((x, i) => {
    const ch = rd(P, "charStatPageShown", i + 1);
    if (i < 4 && ch === 0x20) return;
    const s = getCharDataDigitSprite(ch);
    put(s.b, s.c, x, 0x84);
  });
  far(P, BANK_STAT_ARROWS, () => drawStatChangeArrows(P));
}

export const HOOKS = [
  [BANK, 0x4AEB, hook(P => { buildMainCharStatPage(P); })],
  [BANK, 0x4B50, hook(P => { buildPartnerStatPage(P); })],
  [BANK, 0x4BB6, hook((P, c) => { applyTilemapPatchList(P, c.hl, c.bc); })],
  [BANK, 0x4C04, hook(P => { drawCharDataPageArrowsTask(P); })],
  [BANK, 0x4C60, hook((P, c) => ({ d: bobArrowSpriteLeft(P, c.d) }))],
  [BANK, 0x4C80, hook((P, c) => ({ d: bobArrowSpriteRight(P, c.d) }))],
  [BANK, 0x4CAC, hookGen(P => runDrillResultInputLoop(P))],
  [BANK, 0x4E5E, hook(P => { slideCharDataArrowsOutTask(P); })],
  [BANK, 0x4E76, hook(P => { slideCharDataArrowsInTask(P); })],
  [BANK, 0x4E8D, hook(P => { buildCharStatDisplay(P); })],
  [BANK, 0x509C, hookGen(P => slideToMainCharStatPage(P))],
  [BANK, 0x5268, hookGen(P => slideFromMainCharStatPage(P))],
  [BANK, 0x543D, hookGen(P => slideToPartnerStatPage(P))],
  [BANK, 0x5603, hookGen(P => slideFromPartnerStatPage(P))],
  [BANK, 0x57D2, hook(P => { drawCharStatDigitsTask(P); })],
];

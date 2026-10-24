// Bank $1D's character-data confirm screen ("OK? YES/NO" over a character's stat page, from the new-game setup),
// with the small helpers of the character-data pages: the sprite x of a sliding page, the digit sprites, the EXP
// progress bar (its scale and tiles), the video setup the pages share and the values-sync task's switch.
// Port of src/engine/menus/char_data/confirm_1d.asm (with src/twins/draw_confirm_selection_cursor.asm) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own.
// Tables, patch lists and graphics are read from the ROM.
import {
  rd, wr, u8, w8, idx, rom, FAR, far, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, TILEMAP_WIDTH,
  SCREEN_HEIGHT, VRAM_BANK1, vTiles2, vBGMap0, wDecompBuffer, OAM_BANK1, PADF_A, PADF_B, SFX_MENU_MOVE,
  SFX_MENU_SELECT, SFX_MENU_CANCEL, wShadowTilemap, wScreenAttrmap, wCharDataScreenCell, wCharDataPagePlane,
  storyField, sound, advanceFrame, fadeIn, fadeOut, registerFrameTask, unregisterFrameTask, queueVRAMCopy, queueSprite,
  disableLCDSafely, resetScrollAndCamera, hook, hookGen,
} from "../char_select/defs.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { clearSpriteQueue } from "../../home/fade.js";
import { pop as popStack } from "../../home/cpu.js";
import { mulHLByDESigned, divAHLByDE } from "../../home/math.js";
import { charDataScreenLoadScreen, loadCharDataScreenTilemaps, startCharDataScreenAnimTask,
  stopCharDataScreenAnimTask } from "./screen.js";
import { initDrillWorkRam, buildCharDataScreenPages, CharDataValuesSyncTask } from "./pages.js";
import { applyTilemapPatchList, buildCharStatDisplay } from "./page_slides.js";
import { PATCH, F } from "./patches.js";

export const BANK = 0x1D;
const BANK_SCREEN = 0x1C;
const rWY = 0xFF4A;
const DrawExpProgressBarTilesTable = 0x5A51;
const SCREEN_BLOCKS = SCREEN_HEIGHT * TILEMAP_WIDTH / 16;
const SPRITE_OFFSCREEN_X = 0xA8;
const rlca = a => ((a << 1) | (a >> 7)) & 0xFF;
const slotField = (P, off) => storyField(rd(P, "storyCharacterSlot"), off);

// ---- sprite helpers ----
// ApplySlideOffsetToSpriteX (1D:5997): a sprite's x d moved by the page's slide (the word at hl, WRAM 6); off the
// screen ($A8) once past x = 160 or below 0. b and c kept.
export function applySlideOffsetToSpriteX(P, slide, x) {
  P.wramBank(WRAM_SCENE);
  const v = (P.bus.u16(slide) + x) & 0xFFFF;
  return v >> 8 || (v & 0xFF) >= 0xA0 ? SPRITE_OFFSCREEN_X : v & 0xFF;
}
// GetCharDataDigitSprite (1D:59B5): the sprite (bank 1, palette 0) of the digit character a ("0"-"9")
export const getCharDataDigitSprite = a => ({ b: 0x08, c: (rlca((a - 0x30) & 0xFF) + 0x38) & 0xFF });

// ---- the EXP bar ----
// ComputeExpProgressBar (1D:59BE): the current story character's progress through its level, 0-64 pixels (0 at
// the level cap: nothing left to the next level). `slip`: see ScaleValueToBar.
export function computeExpProgressBar(P) {
  const slot = rd(P, "storyCharacterSlot");
  const remaining = rom(P, FAR.GetExpRemainingToNextLevel, { a: slot }).hl;
  if (!remaining) return { a: 0 };
  const progress = rom(P, FAR.GetExpProgressInCurrentLevel, { a: rd(P, "storyCharacterSlot") }).hl;
  return scaleValueToBar(P, (progress + remaining) & 0xFFFF, progress, 0x40, () => 0x59D9);
}
// ScaleValueToBar (1D:59DC): value * b / total (a:hl over de), capped at b when the quotient has a high byte.
// A quotient over b (value > total, which the screens never pass) takes the ROM's extra `pop bc`: the caller's
// return address goes to bc (a = its high byte) and the `ret` leaves the caller too. pop() gives that word;
// the result says slip (the caller returns at once).
export function scaleValueToBar(P, total, value, b, pop) {
  mulHLByDESigned(P, b, value);
  const m = P.A.mulResult, product = u8(P, m) | u8(P, m + 1) << 8;
  const q = divAHLByDE(P, u8(P, m + 2), product, total).hl;
  if (q >> 8) return { a: b };
  if ((q & 0xFF) < ((b + 1) & 0xFF)) return { a: q & 0xFF };
  const bc = pop();
  return { a: bc >> 8, bc, slip: true };
}
// DrawExpProgressBarTiles (1D:59FC): a bar of `pixels` (0-64) as 8 cells at de (WRAM 3), each with its lower
// half 10 cells on: full cells ($E8/$F8), then the partial one
export function drawExpProgressBarTiles(P, pixels, de) {
  let b = pixels;
  P.wramBank(WRAM_SCREEN);
  for (;;) {
    const rest = (b - 8) & 0xFF;
    const last = b < 8 || rest === 0;
    const hl = idx(DrawExpProgressBarTilesTable, b < 8 ? rlca(b) : rlca(8));
    w8(P, de, u8(P, hl));
    w8(P, idx(de, 0x0A), u8(P, hl + 1));
    if (last) return;
    b = rest;
    de = (de + 1) & 0xFFFF;
  }
}

// ---- the confirm screen ----
// PromptCharDataConfirm (1D:5A63): story character a's stat page with "OK? YES/NO" (from the new-game setup).
// Up/down move between YES (0) and NO (1); A on YES confirms, A on NO or B cancels. Returns the state with WRAM 6
// mapped; the frame tasks are cleared.
export function* promptCharDataConfirm(P, slot) {
  clearFrameTasks(P);
  disableLCDSafely(P);
  resetScrollAndCamera(P);
  P.bus.w8(rWY, 0x90);
  clearSpriteQueue(P);
  initDrillWorkRam(P);
  buildCharDataConfirmScreen(P, slot);
  enableLCD(P);
  yield* advanceFrame(P);
  far(P, BANK_SCREEN, () => startCharDataScreenAnimTask(P));
  yield* fadeIn(P, 16);
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataConfirmState", 1);
  for (;;) {
    drawConfirmSelectionCursor1d(P);
    if (P.menuWheel && P.menuWheel.on) P.menuWheel.skin = { id: "cardconfirm", ok: true, at: P.frames, sel: P.withWramBank(WRAM_SCENE, () => rd(P, "charDataConfirmState")) };   // MENU: Wheel (menuskins.js), read only
    yield* advanceFrame(P);
    const edge = P.V.inputRisingEdge;
    if (edge & PADF_A) {
      P.wramBank(WRAM_SCENE);
      if (!rd(P, "charDataConfirmState")) { sound(P, SFX_MENU_SELECT); break; }
      cancel(P);
      break;
    }
    if (edge & PADF_B) { cancel(P); break; }
    if (edge & 0xC0) {
      sound(P, SFX_MENU_MOVE);
      wr(P, "charDataConfirmState", rd(P, "charDataConfirmState") ^ 1);
    }
  }
  yield* fadeOut(P, 16);
  far(P, BANK_SCREEN, () => stopCharDataScreenAnimTask(P));
  clearFrameTasks(P);
  P.wramBank(WRAM_SCENE);
  return { a: rd(P, "charDataConfirmState") };
}
// .beginFadeOut2: NO
function cancel(P) {
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataConfirmState", 1);
  sound(P, SFX_MENU_CANCEL);
}
// DrawConfirmSelectionCursor_1d (1D:5AFA): the hand beside YES (state 0) or NO
export function drawConfirmSelectionCursor1d(P) {
  P.wramBank(WRAM_SCENE);
  queueSprite(P, OAM_BANK1 | 7, 0xD4, 0x7A, rd(P, "charDataConfirmState") ? 0x14 : 0x0C);
}
// BuildCharDataConfirmScreen (1D:5B1A): the character-data screen's graphics and maps, character a's palette (BG 4)
// and mugshot (3 x 3 tiles at VRAM bank 1 $9200/$9300/$9400), its stat page (BuildCharStatDisplay) with the confirm
// layout's patches and the prompt, all queued to VRAM
const CONFIRM_PATCHES = [
  [PATCH.CharDataConfirmScreenTilemapPatch0, wScreenAttrmap + 18 * TILEMAP_WIDTH],
  [PATCH.CharDataConfirmScreenTilemapPatch1, wScreenAttrmap + 20 * TILEMAP_WIDTH],
  [PATCH.CharDataConfirmScreenTilemapPatch2, wScreenAttrmap + 22 * TILEMAP_WIDTH + 16],
  [PATCH.CharDataConfirmScreenTilemapPatch3, wScreenAttrmap + 24 * TILEMAP_WIDTH + 16],
  [PATCH.CharDataConfirmScreenTilemapPatch4, wScreenAttrmap + 27 * TILEMAP_WIDTH + 16],
  [PATCH.CharDataConfirmScreenTilemapPatch5, wCharDataPagePlane + 10 * TILEMAP_WIDTH + 16],
];
export function buildCharDataConfirmScreen(P, slot) {
  far(P, BANK_SCREEN, () => charDataScreenLoadScreen(P));
  far(P, BANK_SCREEN, () => loadCharDataScreenTilemaps(P));
  wr(P, "storyCharacterSlot", slot);
  loadMugshot(P, 4, vTiles2 + 0x20 * 16);
  buildCharStatDisplay(P);
  for (const [patch, src] of CONFIRM_PATCHES) applyTilemapPatchList(P, patch, src);
  drawCharDataConfirmPrompt(P);
  queueScreenMaps(P);
}
// the current story character's palette (BG palette `pal`) and its mugshot's three rows of three tiles at `dest`
// (VRAM bank 1, rows $100 apart): the ROM's `ld a, [record + $0C] / ld_bg_pals de, pal, 1 / farcall
// LoadIndexedPaletteThunk` and DecompressCharMugshot of record + $0B, the WRAM bank left at 1
export function loadMugshot(P, pal, dest) {
  const palPtr = slotField(P, F.PALETTE);
  rom(P, FAR.LoadIndexedPaletteThunk, { a: u8(P, palPtr), de: pal << 8 | 1, hl: palPtr });
  P.wramBank(WRAM_STAGING);
  const mugPtr = slotField(P, F.MUGSHOT);
  rom(P, FAR.DecompressCharMugshot, { a: u8(P, mugPtr), de: wDecompBuffer, hl: mugPtr });
  for (let row = 0; row < 3; row++)
    queueVRAMCopy(P, wDecompBuffer + row * 3 * 16, dest + row * 0x100 + VRAM_BANK1, 3);
}
// the screen's tiles (WRAM 3) and attributes (WRAM 2) to the background map
export function queueScreenMaps(P) {
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap0, SCREEN_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES);
  queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, SCREEN_BLOCKS);
}
// InitCharDataScreenVideo (1D:5BE3): tasks cleared, LCD off, scroll and camera at 0, the window away, no sprites; the
// menu font, the pages' work RAM and the pages built
export function initCharDataScreenVideo(P) {
  clearFrameTasks(P);
  disableLCDSafely(P);
  resetScrollAndCamera(P);
  P.bus.w8(rWY, 0x90);
  clearSpriteQueue(P);
  rom(P, FAR.LoadMenuFontGfx);
  initDrillWorkRam(P);
  buildCharDataScreenPages(P);
}
// DrawCharDataConfirmPrompt (1D:5C0B): "OK? YES NO" onto the screen
export function drawCharDataConfirmPrompt(P) {
  applyTilemapPatchList(P, PATCH.CharDataConfirmPromptTilemapPatch, wCharDataPagePlane + 12 * TILEMAP_WIDTH);
}
// StartCharDataValuesSyncTask (1D:5C15) / StopCharDataValuesSyncTask (1D:5C1E)
export const startCharDataValuesSyncTask = P => registerFrameTask(P, 1, CharDataValuesSyncTask);
export const stopCharDataValuesSyncTask = P => unregisterFrameTask(P, CharDataValuesSyncTask);

export const HOOKS = [
  [BANK, 0x5997, hook((P, c) => ({ d: applySlideOffsetToSpriteX(P, c.hl, c.d) }))],
  [BANK, 0x59B5, hook((P, c) => getCharDataDigitSprite(c.a))],
  [BANK, 0x59BE, hook(P => {
    const r = computeExpProgressBar(P);
    return r.slip ? { a: r.a, bc: r.bc } : { a: r.a };
  })],
  [BANK, 0x59DC, hook((P, c) => {
    const r = scaleValueToBar(P, c.hl, c.de, c.b, () => popStack(P));
    return r.slip ? { a: r.a, bc: r.bc } : { a: r.a };
  })],
  [BANK, 0x59FC, hook((P, c) => { drawExpProgressBarTiles(P, c.a, c.de); })],
  [BANK, 0x5A63, hookGen((P, c) => promptCharDataConfirm(P, c.a))],
  [BANK, 0x5AFA, hook(P => { drawConfirmSelectionCursor1d(P); })],
  [BANK, 0x5B1A, hook((P, c) => { buildCharDataConfirmScreen(P, c.a); })],
  [BANK, 0x5BE3, hook(P => { initCharDataScreenVideo(P); })],
  [BANK, 0x5C0B, hook(P => { drawCharDataConfirmPrompt(P); })],
  [BANK, 0x5C15, hook(P => { startCharDataValuesSyncTask(P); })],
  [BANK, 0x5C1E, hook(P => { stopCharDataValuesSyncTask(P); })],
];

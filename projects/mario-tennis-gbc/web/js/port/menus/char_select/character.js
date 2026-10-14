// The story-mode character select ("Create a Character", bank $38): the four created characters Alex, Nina (the
// main character) or Harry, Kate (the partner) shown as live on-court characters, a 2 x 1 grid; START flips the
// handedness, A picks, B backs out.
// Port of src/engine/menus/char_select/character_38.asm and of the character-select half of grid_screen_38.asm
// (UpdateCharSelectCharSprite to DrawCharacterSelectCursor) of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables are read from the ROM.
//
// The four characters are on-court character structs, one per WRAM bank 4-7 (WRAM_CHAR0-3), run by the match
// engine's character code (bank 8) through the ROM: each frame the frame task DrawCharacterSelectChars steps their
// animation and draws them; the highlighted one swings its racket (forehand, and an overhead every 15 swings).
// Covered by the lockstep on out/port/cs_story_new.mtrec and cs_story_new2.mtrec (story mode, new game).
import {
  FZ, rd, wr, u8, w8, idx, rom, FAR, HOME, home, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_ACTORS, WRAM_TEXT, WRAM_SCENE,
  WRAM_SOUND, WRAM_CHAR0, WRAM_CHAR1, WRAM_CHAR2, WRAM_CHAR3, TILEMAP_WIDTH, VRAM_BANK1, vTiles0, vTiles2,
  wShadowTilemap, wShadowAttrmap, wCharPosX, wCharSpriteSlot, wCharFacingOctant, PADF_A, PADF_B, PADF_START, rWY,
  BGM_MENU, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, CHAR_ALEX, CHAR_NINA, CHAR_HARRY, CHAR_KATE,
  CHARANIM_STAND, CHARANIM_FOREHAND, CHARANIM_OVERHEAD, TILEBLOCK_SharedMenuGfx17Alias17, SharedMenuGfx17_BLOCKS,
  TILEBLOCK_CharacterSelectGfx, CharacterSelectGfx_BLOCKS, TILEBLOCK_SharedMenuGfx72, SharedMenuGfx72_BLOCKS,
  SCREENASSET_CharacterSelect, Text_30_117, Text_30_118, Text_30_119, sound, advanceFrame, fadeIn, fadeOut,
  registerFrameTask, withWram, fillTilemapRect, loadIndexedPalette, loadCompressedTileBlock, loadScreenAssetRecord,
  queueWram3MapToVRAM, getMenuCursorIndex, setMenuCursorFromIndex, drawSelectedOptionBox, disableLCDSafely,
  drawTextWindow, storyField, timerInterruptOff, timerInterruptOn, resetScrollAndCamera, queueSprite, hook, hookGen,
} from "./defs.js";
import { UpdateAnimatedTilesTask_38 } from "./matchtype.js";
import { enableLCD } from "../../home/system.js";
import { clearFrameTasks } from "../../home/debugtext.js";
import { clearSpriteQueue } from "../../home/fade.js";
import { clearMemory16 } from "../../home/memory.js";

export const BANK = 0x38;
export const DrawCharacterSelectChars = 0x4BAC, DrawCharacterSelectCursor = 0x4E23, TickMenuBgScrollTask_38 = 0x4E52;
const CharacterSelectScreenTable = 0x4924, SelectedCharWramBankTable = 0x4E1F, CharacterSelectCursorTable = 0x4E4A;
const CHAR_BANKS = [WRAM_CHAR0, WRAM_CHAR1, WRAM_CHAR2, WRAM_CHAR3];
const CHAR_STRUCT_BLOCKS = 0x10;                            // wCharPosX: 256 bytes per character
const CHAR_ACTIVE = 0x22, CHAR_ANIM_DONE = 0x2E;           // struct offsets: drawn at all / the animation ended
const IDLE_SWING_PERIOD = 0x1F, IDLE_OVERHEAD_EVERY = 0x0F;
const OFFSCREEN = 0xC8;                                     // a sprite slot's x/y that hides a character
const SLOT_X = 2, SLOT_Y = 3, SLOT_ATTR = 1;                // wCharSpriteSlot fields: screen position, OAM attribute
const OAMB_XFLIP = 5;
const FACING_OCTANT_FRONT = 2;
// where each character stands: [x, y] for the main pair (Alex, Nina) and the partner pair (Harry, Kate)
const POS_LEFT = [0x58, 0x20], POS_RIGHT = [0x58, 0x61], POS_HIDDEN = [OFFSCREEN, OFFSCREEN];
const word = (P, addr) => P.rom.u16(BANK, addr);

// RunCharacterSelectScreen (38:47C7): the screen; b = 0 for the main character, 1 for the partner. Returns a = the
// character picked (0-3) or $FF (B), and the registers its last calls leave (de: what the caller stores as the
// cursor, wCharSelectCursorCol/Row).
export function* runCharacterSelectScreen(P, partner) {
  sound(P, BGM_MENU);
  P.wramBank(WRAM_COURT_PLANES);
  wr(P, "charSelectIsPartner", partner);
  for (const bank of [WRAM_CHAR3, WRAM_CHAR2, WRAM_CHAR1, WRAM_CHAR0]) { P.wramBank(bank); clearMemory16(P, wCharPosX, CHAR_STRUCT_BLOCKS); }
  rom(P, FAR.ResetMatchState);
  clearFrameTasks(P);
  wr(P, "charSelectIdleAnimState", 0); wr(P, "charSelectHandedness", 0); wr(P, "charSelectIdleTimer", 0);
  disableLCDSafely(P);
  clearFrameTasks(P);
  setupCharacterSelectScreen(P);
  drawCharacterSelectChars(P);
  registerFrameTask(P, 1, UpdateAnimatedTilesTask_38);
  registerFrameTask(P, 1, DrawCharacterSelectChars);
  registerFrameTask(P, 1, DrawCharacterSelectCursor);
  enableLCD(P);
  yield* fadeIn(P, 8);
  timerInterruptOff(P);
  registerFrameTask(P, 1, TickMenuBgScrollTask_38);
  let de;
  for (;;) {
    // .redraw: the cursor moves with the pad; .inputLoop: a frame, then A / B / START
    wr(P, "menuInputPressed", P.V.inputPressed);
    const move = rom(P, FAR.MoveMenuCursorGrid_38, { b: 2, c: 1 });
    de = move.de;
    if (move.a) de = refreshCharacterSelectHighlight(P).de ?? de;
    yield* advanceFrame(P);
    const input = P.V.inputPressed;
    if (input & PADF_A) break;
    if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      yield* fadeOut(P, 16);
      leaveScreen(P);
      return { a: 0xFF, de };
    }
    if (input & PADF_START) {                               // .viewStats: flip the handedness
      sound(P, SFX_MENU_MOVE);
      withWram(P, WRAM_COURT_PLANES, () => wr(P, "charSelectHandedness", rd(P, "charSelectHandedness") ^ 1));
    }
  }
  // .confirm: the record of the character (cursor + 2 for the partner pair) with the handedness
  sound(P, SFX_MENU_SELECT);
  yield* fadeOut(P, 16);
  const cursor = getMenuCursorIndex(P, 2);
  P.wramBank(WRAM_COURT_PLANES);
  const handedness = rd(P, "charSelectHandedness"), char = (cursor + rd(P, "charSelectIsPartner") * 2) & 0xFF;
  const slot = rd(P, "storyCharacterSlot");
  const r = rom(P, FAR.InitPlayerRecordFromTemplate, { a: slot, b: handedness, c: rd(P, "charSelectIsPartner") * 2, d: char });
  w8(P, storyField(rd(P, "storyCharacterSlot"), 0x0E), rd(P, "charSelectHandedness"));
  leaveScreen(P);
  return { a: char, de: r.de };
}
// the screen's end: tasks off, the timer interrupt back, the menu font reloaded with the LCD off
function leaveScreen(P) {
  clearFrameTasks(P);
  timerInterruptOn(P);
  disableLCDSafely(P);
  rom(P, FAR.LoadMenuFontGfx);
  enableLCD(P);
}

// Unused_38_DrawCharSelectCursorBox (38:490C): DrawCharGridCursorBox sized for this 2 x 2 grid. Nothing calls it.
export function unusedDrawCharSelectCursorBox(P) {
  const at = idx(CharacterSelectScreenTable, getMenuCursorIndex(P, 2) * 2);
  drawSelectedOptionBox(P, P.bus.u8(at + 1) << 8 | P.bus.u8(at), 0x3018);
}
// LoadCharSelectCharPalettes (38:492C): background palettes 4-7 = indexed palette $0B
export function loadCharSelectCharPalettes(P) {
  let r;
  for (let slot = 4; slot < 8; slot++) r = loadIndexedPalette(P, slot, 0x0B);
  return r;
}
// LoadHighlightedCharPalette (38:4949): the highlighted character's own palette into BG palette 4 + its index
export function loadHighlightedCharPalette(P) {
  const b = getMenuCursorIndex(P, 2);
  const c = withWram(P, WRAM_COURT_PLANES, () => rd(P, "charSelectIsPartner"));
  const index = (c * 2 + b) & 0xFF;
  const palette = rom(P, FAR.GetCharPaletteIndex, { a: index, b: index }).a;
  return rom(P, FAR.LoadIndexedPalette_18, { a: palette, b: index, d: (index + 4) & 0xFF });
}
// SetupCharacterSelectScreen (38:4975): the screen with the LCD off: the screen asset, two text windows (the prompt
// and the "START: Change Hands" line), the four characters, the mugshots, the scrolling background
export function setupCharacterSelectScreen(P) {
  P.V.scrollX = 0; P.V.scrollY = 0;
  P.wramBank(WRAM_COURT_PLANES);
  wr(P, "charSelectIdleAnimState", 0); wr(P, "charSelectHandedness", 0); wr(P, "charSelectIdleTimer", 0);
  resetScrollAndCamera(P);
  P.bus.w8(rWY, 0x90);
  clearSpriteQueue(P);
  wr(P, "onCourtCharCount", 2);
  rom(P, FAR.InitActorEngine);
  setMenuCursorFromIndex(P, 2, 0);
  rom(P, FAR.LoadMenuFontGfx);
  loadScreenAssetRecord(P, SCREENASSET_CharacterSelect);
  loadCharSelectCharPalettes(P);
  rom(P, FAR.ResetTextWindowState);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx17Alias17, vTiles2, SharedMenuGfx17_BLOCKS);
  P.wramBank(WRAM_TEXT);
  wr(P, "shadowTilemapBank", WRAM_SCREEN);
  wr(P, "windowTileAttr", 0);
  drawTextWindow(P, 0x00, 0x0F, 0x14, 0x03);
  drawTextWindow(P, 0x00, 0x02, 0x14, 0x03);
  rom(P, FAR.PrepareGlyphBuffer);
  initCharacterSelectChars(P);
  reloadSelectedCharGfx(P);
  loadHighlightedCharPalette(P);
  setCharSelectAnimations(P);
  drawCharacterSelectPrompt(P);
  rom(P, FAR.UploadGlyphBuffer);
  const mugshot = (char, de) => { rom(P, FAR.LoadCharMugshotToBuffer, { a: char }); rom(P, FAR.CopyMugshotBufferToVram, { a: char, de }); };
  mugshot(CHAR_ALEX, vTiles2 + 0x20 * 16 + VRAM_BANK1);
  mugshot(CHAR_NINA, vTiles2 + 0x30 * 16 + VRAM_BANK1);
  P.wramBank(WRAM_COURT_PLANES);
  if (rd(P, "charSelectIsPartner")) {
    mugshot(CHAR_HARRY, vTiles2 + 0x20 * 16 + VRAM_BANK1);
    mugshot(CHAR_KATE, vTiles2 + 0x30 * 16 + VRAM_BANK1);
    P.wramBank(WRAM_SCREEN);
    fillTilemapRect(P, wShadowAttrmap + 8 * TILEMAP_WIDTH + 6, 3, 3, 0x0E);
    fillTilemapRect(P, wShadowAttrmap + 8 * TILEMAP_WIDTH + 14, 3, 3, 0x0F);
  }
  loadCompressedTileBlock(P, TILEBLOCK_CharacterSelectGfx, vTiles0, CharacterSelectGfx_BLOCKS);
  loadIndexedPalette(P, 0x08, 0x0C);
  queueWram3MapToVRAM(P);
  P.wramBank(WRAM_COURT_PLANES);
  wr(P, "charSelectIdleAnimState", 0); wr(P, "charSelectIdleTimer", 0); wr(P, "charSelectHandedness", 0);
  rom(P, FAR.InitMenuBgScroll);
  rom(P, FAR.LoadMenuSpritePalettePair, { b: 1, c: 1 });
  wr(P, "menuBgScrollTile", 0x10); wr(P, "menuBgScrollTile", 0x10, 1);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx72, vTiles0 + 0x10 * 16, SharedMenuGfx72_BLOCKS);
  loadCharSelectCharPalettes(P);
  loadHighlightedCharPalette(P);
  setCharSelectAnimations(P);
  return reloadSelectedCharGfx(P);
}
// RefreshCharacterSelectHighlight (38:4AAE): the cursor moved: palettes, animations and graphics for the new one,
// the idle timer back to 0. Returns the registers its last call leaves.
export function refreshCharacterSelectHighlight(P) {
  sound(P, SFX_MENU_MOVE);
  loadCharSelectCharPalettes(P);
  loadHighlightedCharPalette(P);
  setCharSelectAnimations(P);
  const r = reloadSelectedCharGfx(P);
  withWram(P, WRAM_COURT_PLANES, () => wr(P, "charSelectIdleTimer", 0));
  return r;
}
// DrawCharacterSelectPrompt (38:4ACF): "Pick a Character" / the partner's prompt on row 3, "START: Change Hands" on
// row 16 (proportional text into the WRAM 3 shadow map). All registers kept.
export function drawCharacterSelectPrompt(P) {
  withWram(P, WRAM_COURT_PLANES, () => {
    const partner = rd(P, "charSelectIsPartner");
    P.wramBank(WRAM_SCREEN);
    if (!partner) rom(P, FAR.RenderProportionalTextAt, { hl: Text_30_117, de: wShadowTilemap + 3 * TILEMAP_WIDTH + 1, c: 0x12 });
    else rom(P, FAR.RenderProportionalTextAt, { hl: Text_30_119, de: wShadowTilemap + 3 * TILEMAP_WIDTH + 2, c: 0x12 });
    P.wramBank(WRAM_SCREEN);
    rom(P, FAR.RenderProportionalTextAt, { hl: Text_30_118, de: wShadowTilemap + 16 * TILEMAP_WIDTH + 1, c: 0x12 });
  });
}
// InitCharacterSelectChars (38:4B21): the four character structs cleared and set up (InitChar: index, character,
// palette), Alex to Kate in WRAM 4-7; WRAM 4 mapped after
export function initCharacterSelectChars(P) {
  for (const bank of [WRAM_CHAR3, WRAM_CHAR2, WRAM_CHAR1, WRAM_CHAR0]) { P.wramBank(bank); clearMemory16(P, wCharPosX, CHAR_STRUCT_BLOCKS); }
  [CHAR_ALEX, CHAR_NINA, CHAR_HARRY, CHAR_KATE].forEach((char, i) => {
    const e = rom(P, FAR.GetCharPaletteIndex, { a: char }).a;
    P.wramBank(CHAR_BANKS[i]);
    rom(P, FAR.InitChar, { a: i, d: char, e });
  });
  P.wramBank(WRAM_CHAR0);
}
// DrawCharacterSelectChars (38:4BAC), a frame task: each character stepped (UpdateCharSelectCharSprite), placed
// (the main pair on screen, the partner pair hidden, or the other way round), mirrored when left-handed, drawn;
// then the idle animation
export function drawCharacterSelectChars(P) {
  const place = (bank, [x, y]) => { P.wramBank(bank); w8(P, wCharSpriteSlot + SLOT_X, x); w8(P, wCharSpriteSlot + SLOT_Y, y); };
  [POS_LEFT, POS_RIGHT, POS_HIDDEN, POS_HIDDEN].forEach((pos, i) => {
    P.wramBank(CHAR_BANKS[i]);
    updateCharSelectCharSprite(P, wCharPosX);
    w8(P, wCharSpriteSlot + SLOT_X, pos[0]); w8(P, wCharSpriteSlot + SLOT_Y, pos[1]);
  });
  P.wramBank(WRAM_ACTORS);
  if (withWram(P, WRAM_COURT_PLANES, () => rd(P, "charSelectIsPartner"))) {
    [POS_HIDDEN, POS_HIDDEN, POS_LEFT, POS_RIGHT].forEach((pos, i) => place(CHAR_BANKS[i], pos));
    P.wramBank(WRAM_ACTORS);
  }
  if (withWram(P, WRAM_COURT_PLANES, () => rd(P, "charSelectHandedness"))) {
    for (const bank of CHAR_BANKS) { P.wramBank(bank); w8(P, wCharSpriteSlot + SLOT_ATTR, u8(P, wCharSpriteSlot + SLOT_ATTR) | 1 << OAMB_XFLIP); }
  }
  for (const bank of CHAR_BANKS) { P.wramBank(bank); rom(P, FAR.DrawCharSprite, { hl: wCharSpriteSlot }); }
  P.wramBank(WRAM_ACTORS);
  tickCharSelectIdleAnim(P);
}

// UpdateCharSelectCharSprite (38:4CE2): one character's frame (the struct at hl, its bank mapped): facing eased,
// animation stepped, its tiles reloaded facing the front, its sprite slots built. Nothing for a struct not in use.
// (The ROM also copies the struct's first 128, then 96 bytes onto themselves with CopyMemoryFast: no change.)
export function updateCharSelectCharSprite(P, hl) {
  if (!u8(P, hl + CHAR_ACTIVE)) return;
  rom(P, FAR.EaseCharFacing);
  rom(P, FAR.StepCharAnimation);
  w8(P, wCharFacingOctant, FACING_OCTANT_FRONT);
  rom(P, FAR.ReloadCharFacingTiles, { a: FACING_OCTANT_FRONT, d: FACING_OCTANT_FRONT });
  rom(P, FAR.BuildCharSpriteSlots, { d: FACING_OCTANT_FRONT });
}
// SetCharSelectAnimations (38:4D14): all four standing, the highlighted one swinging (forehand); the idle state reset
export function setCharSelectAnimations(P) {
  for (const bank of CHAR_BANKS) { P.wramBank(bank); rom(P, FAR.SetCharAnimation, { d: CHARANIM_STAND }); }
  P.wramBank(getSelectedCharWramBank(P).b);
  rom(P, FAR.SetCharAnimation, { d: CHARANIM_FOREHAND });
  P.wramBank(WRAM_ACTORS);
  withWram(P, WRAM_COURT_PLANES, () => wr(P, "charSelectIdleAnimState", 0));
}
// ReloadSelectedCharGfx (38:4D66): object palettes $0B-$0F = indexed palette $0B, the highlighted character's frame
// graphics reloaded; WRAM 4 mapped after. Returns the registers ReloadCharFrameGfx leaves (a = 4).
export function reloadSelectedCharGfx(P) {
  for (let slot = 0x0B; slot < 0x10; slot++) loadIndexedPalette(P, slot, 0x0B);
  P.wramBank(getSelectedCharWramBank(P).b);
  const r = rom(P, FAR.ReloadCharFrameGfx);
  P.wramBank(WRAM_CHAR0);
  return { ...r, a: WRAM_CHAR0 };
}
// TickCharSelectIdleAnim (38:4D9B): when the highlighted character's animation is over, every 32 frames it swings
// again, and every 15th swing is an overhead
export function tickCharSelectIdleAnim(P) {
  P.wramBank(getSelectedCharWramBank(P).b);
  if (u8(P, wCharPosX + CHAR_ANIM_DONE) !== 1) return;
  const state = withWram(P, WRAM_COURT_PLANES, () => { const v = (rd(P, "charSelectIdleAnimState") + 1) & 0xFF; wr(P, "charSelectIdleAnimState", v); return v; });
  if (state & IDLE_SWING_PERIOD) return;
  rom(P, FAR.SetCharAnimation, { d: CHARANIM_FOREHAND });
  withWram(P, WRAM_COURT_PLANES, () => {
    const timer = (rd(P, "charSelectIdleTimer") + 1) & 0xFF;
    wr(P, "charSelectIdleTimer", timer);
    if (timer !== IDLE_OVERHEAD_EVERY) return;
    wr(P, "charSelectIdleTimer", 0);
    P.wramBank(getSelectedCharWramBank(P).b);
    rom(P, FAR.SetCharAnimation, { d: CHARANIM_OVERHEAD });
  });
}
// GetSelectedCharWramBank (38:4DFA): the WRAM bank of the highlighted character (cursor + 2 for the partner pair).
// Returns it in b; a = its index, hl at its table entry, c = the partner flag.
export function getSelectedCharWramBank(P) {
  const b = getMenuCursorIndex(P, 2);
  const c = withWram(P, WRAM_COURT_PLANES, () => rd(P, "charSelectIsPartner"));
  const a = (c * 2 + b) & 0xFF, hl = idx(SelectedCharWramBankTable, a);
  return { a, b: P.bus.u8(hl), c, hl };
}
// DrawCharacterSelectCursor (38:4E23), a frame task: the hand cursor at the highlighted character (tile 2, or 0 for
// a left-handed one)
export function drawCharacterSelectCursor(P) {
  const at = idx(CharacterSelectCursorTable, getMenuCursorIndex(P, 2) * 2);
  const e = P.bus.u8(at), d = P.bus.u8(at + 1);
  P.wramBank(WRAM_COURT_PLANES);
  queueSprite(P, 0, rd(P, "charSelectHandedness") ? 0x00 : 0x02, d, e);
}
// TickMenuBgScrollTask_38 (38:4E52), a frame task: the scrolling background (TickMenuBgScroll, bank $39)
export const tickMenuBgScrollTask = P => { rom(P, FAR.TickMenuBgScroll); };
// Unused_38_WramBank3Nop (38:4E56): push_wram_bank WRAM_SCREEN / pop_wram_bank and nothing between. a = the bank.
export const unusedWramBank3Nop = P => ({ a: P.V.wramBank });

export const HOOKS = [
  [BANK, 0x47C7, hookGen((P, c) => runCharacterSelectScreen(P, c.b))],
  [BANK, 0x490C, hook(P => unusedDrawCharSelectCursorBox(P))],
  [BANK, 0x492C, hook(P => { loadCharSelectCharPalettes(P); })],
  [BANK, 0x4949, hook(P => { loadHighlightedCharPalette(P); })],
  [BANK, 0x4975, hook(P => { setupCharacterSelectScreen(P); })],
  [BANK, 0x4AAE, hook(P => { refreshCharacterSelectHighlight(P); })],
  [BANK, 0x4ACF, hook(P => drawCharacterSelectPrompt(P))],
  [BANK, 0x4B21, hook(P => initCharacterSelectChars(P))],
  [BANK, 0x4BAC, hook(P => drawCharacterSelectChars(P))],
  [BANK, 0x4CE2, hook((P, c) => updateCharSelectCharSprite(P, c.hl))],
  [BANK, 0x4D14, hook(P => setCharSelectAnimations(P))],
  [BANK, 0x4D66, hook(P => { reloadSelectedCharGfx(P); })],
  [BANK, 0x4D9B, hook(P => tickCharSelectIdleAnim(P))],
  [BANK, 0x4DFA, hook(P => getSelectedCharWramBank(P))],
  [BANK, 0x4E23, hook(P => drawCharacterSelectCursor(P))],
  [BANK, 0x4E52, hook(P => tickMenuBgScrollTask(P))],
  [BANK, 0x4E56, hook(P => unusedWramBank3Nop(P))],
];

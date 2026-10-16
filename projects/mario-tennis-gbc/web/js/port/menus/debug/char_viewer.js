// Bank $1a: the unused debug character viewer's scene: the chosen character standing among four actors, a row of 22
// animations and a row of 5 palettes to pick from (the picked cells highlighted, the hovered one's name below), the
// character's pose cycled with Start / Select; and the copies of decoded maps from WRAM 1 into WRAM 3 / 2.
// Port of src/engine/menus/debug/char_viewer_1a.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables and the actor list are read from the
// ROM. Nothing in the game reaches this code.
// Tests: web/tests/port/routines_menus_misc.mjs (the routines that do not wait); lockstep on
// out/port/dbg_viewer.mtrec (scripted).
import {
  FZ, FN, FAR, rom, near, u8, w8, wram, sound, advanceFrame, hook, hookGen, addFlags, WRAM_STAGING, WRAM_COURT_PLANES,
  WRAM_SCREEN, WRAM_ACTORS, WRAM_SCENE, WRAM_CHAR0, VRAM_BANK1, TILEMAP_WIDTH, vBGMap0, wShadowTilemap, wScreenAttrmap,
  OAM_BANK1, PADF_A, PADF_B, PADF_SELECT, PADF_START, PADF_UP, PADF_DOWN, PADF_LEFT, PADF_RIGHT, SFX_MENU_MOVE,
  SFX_MENU_CANCEL, chain, hlIndexed, farFlagsAt,
} from "./defs.js";
import { queueVRAMCopy, clearMemory16 } from "../../home/memory.js";
import { queueSprite } from "../../home/fade.js";
import { getRegs } from "../../home/cpu.js";

export const BANK = 0x1A;
export const Unused_1a_DrawCharViewerCursorSprite = 0x6C28;
const Unused_1a_DrawCharViewerCharSprite = 0x7012, Unused_1a_LoadCharViewerMugshot = 0x7096;
const Unused_1a_ApplyCharViewerPalette = 0x70C0;
const rb = (P, a) => P.rom.u8(BANK, a);
// WRAM 6
const wCharViewerRow = 0xD000, wCharViewerCursor = 0xD001, wCharViewerCharId = 0xD002, wCharViewerSavedCursor = 0xD003;
const wCharViewerPalette = 0xD004, wCharViewerPose = 0xD005;
// WRAM 4
const wActors = 0xD000, ACTOR_SIZE = 0x40, ACTORF_OAM_ATTR = 0x37, SCENE_ACTORS = 4, ANIM_WALK = 0x01;
const wCharPosX = 0xDF00, wCharFrameVramDest = 0xDF26, wCharTileBase = 0xDF36, wCharSpriteAttr = 0xDF37;
const wMatchPlayerChar = 0xC3B0, ACTOR_PALETTE = 0x07, CHAR_TILES_AT = 0x8600, CHAR_TILE_BASE = 0x60;
const CharViewerSceneActors_1a = 0x6FCF, CharViewerInputLoopTable = 0x792F;
const DrawCharViewerCursorSpriteTable0 = 0x6C69, DrawCharViewerCursorSpriteTable1 = 0x6C95;
const ROW_ANIMS = 0, ROW_PALETTES = 1, ANIMS_PER_LINE = 0x0B, ANIMS = 0x16, PALETTES = 5, POSES = 8;
const CURSOR_ATTR = OAM_BANK1 | 5, CURSOR_LEFT_TILE = 0x80, CURSOR_RIGHT_TILE = 0x82;
const CELL_NORMAL = 0x09, CELL_PICKED = 0x08;
const ANIM_CELLS = [wScreenAttrmap + 9 * TILEMAP_WIDTH + 8, wScreenAttrmap + 10 * TILEMAP_WIDTH + 8];
const PALETTE_CELLS = wScreenAttrmap + 14 * TILEMAP_WIDTH + 8;
const NAME_ROWS = wShadowTilemap + 15 * TILEMAP_WIDTH, NAME_AT = wShadowTilemap + 16 * TILEMAP_WIDTH + 1, BLANK = 0x20;
const Text_34_192 = 0x10C0, NAME_WIDTH = 0x20;               // "palette"; the animations' names follow it

// Unused_1a_CopyBank1ToBank3Buffer (1A:6BE1) / Unused_1a_CopyBank1ToBank2Buffer (1A:6BF6): bc bytes at hl from
// WRAM 1 to the same addresses of WRAM 3 / 2 (left mapped)
function copyFromBank1(P, bank, hl, bc) {
  let d;
  do {
    wram(P, WRAM_STAGING);
    d = u8(P, hl);
    wram(P, bank);
    w8(P, hl, d);
    hl = (hl + 1) & 0xFFFF;
    bc = (bc - 1) & 0xFFFF;
  } while (bc);
  return { a: 0, f: FZ, b: 0, c: 0, d, hl };
}
export const unusedCopyBank1ToBank3Buffer = (P, hl, bc) => copyFromBank1(P, WRAM_SCREEN, hl, bc);
export const unusedCopyBank1ToBank2Buffer = (P, hl, bc) => copyFromBank1(P, WRAM_COURT_PLANES, hl, bc);
// Unused_1a_InitCharViewerState (1A:6C0B): the cursors and pose 0, the character's own palette picked
export function unusedInitCharViewerState(P, entry) {
  wram(P, WRAM_SCENE);
  for (const v of [wCharViewerCursor, wCharViewerRow, wCharViewerSavedCursor, wCharViewerPose]) w8(P, v, 0);
  const r = rom(P, FAR.GetCharPaletteIndex, { ...entry, f: farFlagsAt(P, 0), a: u8(P, wCharViewerCharId) });
  w8(P, wCharViewerPalette, r.a);
  return r;
}
// Unused_1a_DrawCharViewerCursorSprite (1A:6C28), a frame task: the two-sprite cursor at the hovered cell
export function unusedDrawCharViewerCursorSprite(P, entry) {
  const r = { ...entry };
  wram(P, WRAM_SCENE);
  const table = u8(P, wCharViewerRow) ? DrawCharViewerCursorSpriteTable1 : DrawCharViewerCursorSpriteTable0;
  const cursor = u8(P, wCharViewerCursor), at = hlIndexed(table, (cursor << 1 | cursor >> 7) & 0xFF);
  const e = rb(P, at.hl);
  let d = rb(P, at.hl + 1);
  chain(r, { hl: at.hl + 1, d, e, b: CURSOR_ATTR, c: CURSOR_LEFT_TILE, a: P.V.vBlankCounter });
  chain(r, queueSprite(P, CURSOR_ATTR, CURSOR_LEFT_TILE, d, e));
  const f = addFlags(8, d);
  d = (d + 8) & 0xFF;
  chain(r, { a: d, d, f, c: CURSOR_RIGHT_TILE });
  return chain(r, queueSprite(P, CURSOR_ATTR, CURSOR_RIGHT_TILE, d, e));
}
// Unused_1a_RunCharViewerInputLoop (1A:6C9F): until B: up / down switch lines (the animation rows wrap to the
// palette row), left / right move, A plays the animation (or applies the palette) under the cursor, Start / Select
// change the pose
export function* unusedRunCharViewerInputLoop(P) {
  const get = a => u8(P, a), set = (a, v) => w8(P, a, v);
  for (;;) {
    near(P, Unused_1a_DrawCharViewerCharSprite);
    wram(P, WRAM_SCENE);
    yield* advanceFrame(P);
    const input = P.V.inputPressed, row = () => get(wCharViewerRow), cursor = () => get(wCharViewerCursor);
    const switchRow = () => {
      set(wCharViewerRow, row() ^ 1);
      set(wCharViewerCursor, get(row() === ROW_PALETTES ? wCharViewerPalette : wCharViewerSavedCursor));
    };
    if (input & (PADF_UP | PADF_DOWN)) {
      sound(P, SFX_MENU_MOVE);
      wram(P, WRAM_SCENE);
      const up = input & PADF_UP;
      if (row() !== ROW_ANIMS) switchRow();
      else if (up ? cursor() < ANIMS_PER_LINE : cursor() >= ANIMS_PER_LINE) switchRow();
      else set(wCharViewerCursor, up ? cursor() - ANIMS_PER_LINE : cursor() + ANIMS_PER_LINE);
    } else if (input & PADF_LEFT) {
      sound(P, SFX_MENU_MOVE);
      wram(P, WRAM_SCENE);
      const c = (cursor() - 1) & 0xFF;
      if (row() !== ROW_ANIMS) set(wCharViewerCursor, c === 0xFF ? PALETTES - 1 : c);
      else set(wCharViewerCursor, c === 0xFF ? ANIMS_PER_LINE - 1 : c === ANIMS_PER_LINE - 1 ? ANIMS - 1 : c);
    } else if (input & PADF_RIGHT) {
      sound(P, SFX_MENU_MOVE);
      wram(P, WRAM_SCENE);
      const c = cursor() + 1;
      if (row() !== ROW_ANIMS) set(wCharViewerCursor, c === PALETTES ? 0 : c);
      else set(wCharViewerCursor, c === ANIMS_PER_LINE ? 0 : c === ANIMS ? ANIMS_PER_LINE : c);
    } else if (input & PADF_A) {
      sound(P, SFX_MENU_MOVE);
      wram(P, WRAM_SCENE);
      if (row() !== ROW_ANIMS) {
        set(wCharViewerPalette, cursor());
        near(P, Unused_1a_ApplyCharViewerPalette);
      } else {
        set(wCharViewerSavedCursor, cursor());
        const hl = (CharViewerInputLoopTable + cursor()) & 0xFFFF;
        wram(P, WRAM_ACTORS);
        rom(P, FAR.SetCharAnimation, { a: WRAM_ACTORS, d: rb(P, hl), hl });
        wram(P, WRAM_SCENE);
      }
    } else if (input & PADF_B) {
      sound(P, SFX_MENU_CANCEL);
      return;
    } else if (input & (PADF_START | PADF_SELECT)) {
      set(wCharViewerPose, (get(wCharViewerPose) + (input & PADF_START ? -1 : 1)) & (POSES - 1));
      continue;
    } else continue;
    unusedRefreshCharViewerSelection(P, getRegs(P.cpu));
    yield* advanceFrame(P);
  }
}
// Unused_1a_RefreshCharViewerSelection (1A:6E41): the picked animation and palette highlighted (attribute rows
// queued) and the hovered cell's name (the animation's, or "palette") in the name rows
export function unusedRefreshCharViewerSelection(P, entry) {
  const r = { ...entry };
  const queue = (src, dest, blocks) => chain(chain(r, { hl: src, de: dest, c: blocks }), queueVRAMCopy(P, src, dest, blocks));
  wram(P, WRAM_COURT_PLANES);
  for (const at of ANIM_CELLS) for (let i = 0; i < ANIMS_PER_LINE; i++) w8(P, at + i, CELL_NORMAL);
  for (let i = 0; i < PALETTES; i++) w8(P, PALETTE_CELLS + i, CELL_NORMAL);
  wram(P, WRAM_SCENE);
  const saved = u8(P, wCharViewerSavedCursor);
  const picked = saved < ANIMS_PER_LINE ? ANIM_CELLS[0] + saved : ANIM_CELLS[1] + saved - ANIMS_PER_LINE;
  wram(P, WRAM_COURT_PLANES);
  w8(P, picked, CELL_PICKED);
  queue(wScreenAttrmap + 9 * TILEMAP_WIDTH, vBGMap0 + 9 * TILEMAP_WIDTH + VRAM_BANK1, 2 * TILEMAP_WIDTH / 16);
  wram(P, WRAM_SCENE);
  const palette = (PALETTE_CELLS + u8(P, wCharViewerPalette)) & 0xFFFF;
  wram(P, WRAM_COURT_PLANES);
  w8(P, palette, CELL_PICKED);
  queue(wScreenAttrmap + 14 * TILEMAP_WIDTH, vBGMap0 + 14 * TILEMAP_WIDTH + VRAM_BANK1, TILEMAP_WIDTH / 16);
  wram(P, WRAM_SCREEN);
  for (let i = 0; i < 16; i++) {
    w8(P, NAME_ROWS + 1 + i, BLANK);
    w8(P, NAME_ROWS + TILEMAP_WIDTH + 1 + i, BLANK);
  }
  wram(P, WRAM_SCENE);
  const text = u8(P, wCharViewerRow) ? Text_34_192 : (Text_34_192 + u8(P, wCharViewerCursor) + 1) & 0xFFFF;
  wram(P, WRAM_SCREEN);
  chain(r, rom(P, FAR.RenderTextToBuffer64, { ...r, f: farFlagsAt(P, 0), a: WRAM_SCREEN, hl: text, de: NAME_AT, c: NAME_WIDTH }));
  wram(P, WRAM_SCREEN);
  r.a = WRAM_SCREEN;
  return queue(NAME_ROWS, vBGMap0 + 15 * TILEMAP_WIDTH, 2 * TILEMAP_WIDTH / 16);
}
// Unused_1a_SetupCharViewerScene (1A:6F3D): the mugshot, four walking actors of the character's object around it
// (palette 7), and the character itself (WRAM 4's character 0: palette 7, its tiles at $8600)
export function unusedSetupCharViewerScene(P, entry) {
  const r = { ...entry };
  const far = (fn, regs) => chain(r, rom(P, fn, { ...r, f: farFlagsAt(P, 0), ...regs }));
  chain(r, near(P, Unused_1a_LoadCharViewerMugshot, r));
  wram(P, WRAM_SCENE);
  far(FAR.Unused_04_GetCharObjectId, { a: u8(P, wCharViewerCharId) });
  wram(P, WRAM_ACTORS);
  far(FAR.SpawnActorsFromList, { a: P.V.romBank, d: r.a, hl: CharViewerSceneActors_1a });
  for (let i = 0; i < SCENE_ACTORS; i++) far(FAR.LoadActorObjectDefIfValid, { bc: wActors + i * ACTOR_SIZE });
  r.d = ANIM_WALK;
  for (let i = 0; i < SCENE_ACTORS; i++) far(FAR.SetActorAnimationChecked, { bc: wActors + i * ACTOR_SIZE });
  for (let i = 0; i < SCENE_ACTORS; i++) w8(P, wActors + i * ACTOR_SIZE + ACTORF_OAM_ATTR, ACTOR_PALETTE);
  wram(P, WRAM_SCENE);
  const id = u8(P, wCharViewerCharId);
  w8(P, wMatchPlayerChar, id);
  wram(P, WRAM_CHAR0);
  chain(r, { hl: clearMemory16(P, wCharPosX, 0x10), a: 0, c: 0, d: id, f: FZ | FN });
  far(FAR.InitChar, { a: 0 });
  w8(P, wCharSpriteAttr, ACTOR_PALETTE);
  P.bus.w16(wCharFrameVramDest, CHAR_TILES_AT);
  w8(P, wCharTileBase, CHAR_TILE_BASE);
  return chain(r, { a: CHAR_TILES_AT & 0xFF, de: CHAR_TILES_AT, hl: wCharTileBase });
}

export const HOOKS = [
  [BANK, 0x6BE1, hook((P, c) => unusedCopyBank1ToBank3Buffer(P, c.hl, c.bc))],
  [BANK, 0x6BF6, hook((P, c) => unusedCopyBank1ToBank2Buffer(P, c.hl, c.bc))],
  [BANK, 0x6C0B, hook((P, c) => unusedInitCharViewerState(P, getRegs(c)))],
  [BANK, 0x6C28, hook((P, c) => unusedDrawCharViewerCursorSprite(P, getRegs(c)))],
  [BANK, 0x6C9F, hookGen(P => unusedRunCharViewerInputLoop(P))],
  [BANK, 0x6E41, hook((P, c) => unusedRefreshCharViewerSelection(P, getRegs(c)))],
  [BANK, 0x6F3D, hook((P, c) => unusedSetupCharViewerScene(P, getRegs(c)))],
];

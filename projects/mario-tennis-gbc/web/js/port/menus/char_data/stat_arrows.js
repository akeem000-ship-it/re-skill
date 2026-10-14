// Bank $1A's part of the character-data screens: the racket's arrows beside the main character's stats (how much the
// racket equipped adds or takes, CharDataScreen_BuildStats / DrawStatChangeArrows, with their tiles), the story's
// "OK?" confirm screen over the character-data screen (RunCharDataConfirmScreen) and three helpers of the unused
// character viewer.
// Port of src/engine/menus/char_data/stat_arrows_1a.asm (with src/twins/draw_confirm_selection_cursor.asm) of the
// gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm); names and addresses are its own.
// Tables and graphics are read from the ROM.
import {
  FZ, FC, rd, wr, u8, w8, idx, rom, FAR, far, WRAM_STAGING, WRAM_COURT_PLANES, WRAM_SCREEN, WRAM_SCENE, WRAM_CHAR0,
  TILEMAP_WIDTH, SCREEN_HEIGHT, VRAM_BANK1, vTiles0, vTiles2, vBGMap0, wDecompBuffer, wTextTileBuffer, OAM_BANK1,
  PADF_A, PADF_B, SFX_MENU_MOVE, SFX_MENU_SELECT, SFX_MENU_CANCEL, wCharPosX, wCharSpriteFrame, wCharTileBase,
  wCharScreenX, wCharScreenY, wCharSpriteSlot, wCharDataScreenCell, wShadowTilemap, wScreenAttrmap, sound,
  advanceFrame, fadeIn, fadeOut, queueVRAMCopy, queueSprite, hook, hookGen,
} from "../char_select/defs.js";
import { enableLCD } from "../../home/system.js";
import { decompressData } from "../../home/decompress.js";
import { loadPaletteShadow } from "../../home/palettes.js";
import { loadCharDataScreenTilemaps, startCharDataScreenAnimTask, stopCharDataScreenAnimTask } from "./screen.js";
import { applyTilemapPatchList } from "./page_slides.js";
import { initCharDataScreenVideo, drawCharDataConfirmPrompt, startCharDataValuesSyncTask,
  stopCharDataValuesSyncTask } from "./confirm.js";

export const BANK = 0x1A;
const BANK_SCREEN = 0x1C, BANK_PAGES = 0x1D;
// tables and graphics (bank $1A)
const DrawCharViewerCharSprite_CharScreenPosTable = 0x708E;
const CharDataConfirmScreenTable0 = 0x7E46, CharDataConfirmScreenGfx1 = 0x7E53, CharDataConfirmScreenGfx2 = 0x7E75;
const CharDataScreen_LoadPalette = 0x7E7E;
// the arrow tiles: [compressed tiles, VRAM bank 1 address]; each decodes to 2 tiles (CharDataScreenGfx0-3_SIZE / 16)
const ARROW_GFX = [[0x7E8E, vTiles0 + 0x78 * 16], [0x7E99, vTiles0 + 0x7A * 16], [0x7EA4, vTiles0 + 0x7C * 16],
  [0x7EAF, vTiles0 + 0x7E * 16]];
const ARROW_GFX_BLOCKS = 2;
const ComputeStatArrowSpriteXTable = 0x7E34;
const CONFIRM_GFX_BUFFER = wTextTileBuffer + 106 * 16, CONFIRM_GFX_SIZE = 0x2A;
const SCREEN_BLOCKS = SCREEN_HEIGHT * TILEMAP_WIDTH / 16;
const NUM_STATS = 11;
const rlca = a => ((a << 1) | (a >> 7)) & 0xFF;

// ---- the unused character viewer's helpers ----
// Unused_1a_DrawCharViewerCharSprite (1A:7012): two marker sprites, then the viewer's character (WRAM 4) animated
// and drawn at (32, 104) with the tile base of its frame, in the palette wCharDataNewLevels picks. Returns the
// registers DrawCharSprite leaves.
export function unusedDrawCharViewerCharSprite(P) {
  queueSprite(P, 7, 0x70, 0x46, 0x15);
  const q = queueSprite(P, 7, 0x72, 0x4E, 0x15);
  P.wramBank(WRAM_CHAR0);
  const r = rom(P, FAR.StepCharAnimation, { a: WRAM_CHAR0, bc: wCharPosX, de: 0x4E15, hl: wCharPosX, f: q.f });
  P.wramBank(WRAM_SCENE);
  const d = rd(P, "charDataNewLevels");
  P.wramBank(WRAM_CHAR0);
  const e = r.e;
  rom(P, FAR.ReloadCharFacingTiles, { ...r, a: WRAM_CHAR0, d });
  const b0 = u8(P, idx(DrawCharViewerCharSprite_CharScreenPosTable, d));
  const c = u8(P, wCharTileBase), b = u8(P, wCharTileBase + 1) | b0;
  w8(P, wCharScreenX, 0x20); w8(P, wCharScreenY, 0x68);
  const hl8 = ((d << 8 | e) << 3) & 0xFFFF;                       // de * 8: its high byte + $80, the slot's last byte
  const a = ((hl8 >> 8) + 0x80) & 0xFF;
  [c, b, 0x68, 0x20, u8(P, wCharSpriteFrame + 2), u8(P, wCharSpriteFrame + 1), u8(P, wCharSpriteFrame), a]
    .forEach((v, i) => w8(P, wCharSpriteSlot + i, v));
  return rom(P, FAR.DrawCharSprite, { a, f: (a ? 0 : FZ) | ((hl8 >> 8) >= 0x80 ? FC : 0), b, c, de: 0x2068,
    hl: wCharSpriteSlot });
}
// Unused_1a_LoadCharViewerMugshot (1A:7096): BG palette 7 from entry 0, and the mugshot wCharDataFlushChunk names
// into VRAM bank 1 tile $110
export function unusedLoadCharViewerMugshot(P) {
  rom(P, FAR.LoadIndexedPaletteThunk, { a: 0, de: 0x0701 });
  P.wramBank(WRAM_SCENE);
  const mugshot = rd(P, "charDataFlushChunk");
  P.wramBank(WRAM_STAGING);
  rom(P, FAR.DecompressCharMugshot, { a: mugshot, b: mugshot, de: wDecompBuffer });
  queueVRAMCopy(P, wDecompBuffer, vTiles2 + 0x10 * 16 + VRAM_BANK1, 9);
}
// Unused_1a_ApplyCharViewerPalette (1A:70C0): BG and OBJ palette 7 from the entry wCharDataLevel names
export function unusedApplyCharViewerPalette(P) {
  P.wramBank(WRAM_SCENE);
  rom(P, FAR.LoadIndexedPaletteThunk, { a: rd(P, "charDataLevel"), de: 0x0701 });
  return rom(P, FAR.LoadIndexedPaletteThunk, { a: rd(P, "charDataLevel"), de: 0x0F01 });
}

// ---- the confirm screen ----
// RunCharDataConfirmScreen (1A:7945), from the story: the character-data screen's look with "OK? YES/NO" (the box's
// pieces from this bank patched in at rows 0-2), the values sync and anim tasks running. Up/down move between
// YES (state 0) and NO (1); A on YES confirms, A on NO or B cancels. Returns the state (0 yes, 1 no) with WRAM 6
// mapped.
export function* runCharDataConfirmScreen(P) {
  far(P, BANK_PAGES, () => initCharDataScreenVideo(P));
  far(P, BANK_SCREEN, () => loadCharDataScreenTilemaps(P));
  P.wramBank(WRAM_STAGING);
  decompressData(P, CharDataConfirmScreenGfx1, CONFIRM_GFX_BUFFER);
  copyBank1ToBank3BufferAlt(P, CONFIRM_GFX_BUFFER, CONFIRM_GFX_SIZE);
  P.wramBank(WRAM_STAGING);
  decompressData(P, CharDataConfirmScreenGfx2, CONFIRM_GFX_BUFFER);
  copyBank1ToBank2BufferAlt(P, CONFIRM_GFX_BUFFER, CONFIRM_GFX_SIZE);
  applyTilemapPatchList1a(P, CharDataConfirmScreenTable0, CONFIRM_GFX_BUFFER);
  far(P, BANK_PAGES, () => drawCharDataConfirmPrompt(P));
  P.wramBank(WRAM_SCREEN);
  queueVRAMCopy(P, wShadowTilemap, vBGMap0, SCREEN_BLOCKS);
  P.wramBank(WRAM_COURT_PLANES);
  queueVRAMCopy(P, wScreenAttrmap, vBGMap0 + VRAM_BANK1, SCREEN_BLOCKS);
  enableLCD(P);
  yield* advanceFrame(P);
  far(P, BANK_SCREEN, () => startCharDataScreenAnimTask(P));
  far(P, BANK_PAGES, () => startCharDataValuesSyncTask(P));
  yield* fadeIn(P, 16);
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataConfirmState", 1);
  for (;;) {
    drawConfirmSelectionCursor1a(P);
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
  far(P, BANK_PAGES, () => stopCharDataValuesSyncTask(P));
  far(P, BANK_SCREEN, () => stopCharDataScreenAnimTask(P));
  P.wramBank(WRAM_SCENE);
  return { a: rd(P, "charDataConfirmState") };
}
// .beginFadeOut2: NO
function cancel(P) {
  P.wramBank(WRAM_SCENE);
  wr(P, "charDataConfirmState", 1);
  sound(P, SFX_MENU_CANCEL);
}
// DrawConfirmSelectionCursor_1a (1A:7A1D): the hand beside YES (state 0) or NO
export function drawConfirmSelectionCursor1a(P) {
  P.wramBank(WRAM_SCENE);
  queueSprite(P, OAM_BANK1 | 7, 0xD4, 0x7A, rd(P, "charDataConfirmState") ? 0x14 : 0x0C);
}
// CopyBank1ToBank3BufferAlt (1A:7A3D) / CopyBank1ToBank2BufferAlt (1A:7A52): bc bytes at hl from WRAM 1 to the same
// addresses in WRAM 3 (2), the destination bank left mapped
export const copyBank1ToBank3BufferAlt = (P, hl, bc) => copyBank1To(P, WRAM_SCREEN, hl, bc);
export const copyBank1ToBank2BufferAlt = (P, hl, bc) => copyBank1To(P, WRAM_COURT_PLANES, hl, bc);
function copyBank1To(P, bank, hl, bc) {
  do {
    P.wramBank(WRAM_STAGING);
    const v = u8(P, hl);
    P.wramBank(bank);
    w8(P, hl, v);
    hl = (hl + 1) & 0xFFFF; bc = (bc - 1) & 0xFFFF;
  } while (bc);
}
// ApplyTilemapPatchList_1a (1A:7A67): instruction-identical to bank $1D's ApplyTilemapPatchList: for each entry
// [offset (big-endian word), source offset, count] up to $FF, count tiles (WRAM 3) and attributes (WRAM 2) from bc +
// source offset to the screen map at wCharDataScreenCell + offset
export const applyTilemapPatchList1a = (P, hl, bc) => applyTilemapPatchList(P, hl, bc);

// ---- the racket's arrows ----
// CharDataScreen_BuildStats (1A:7AB5), on the main character's screen (slot 0) only: wCharDataRacketDeltas, what
// the racket adds to each stat (shown value - 1 - the value without the racket), zero without a racket. The stats
// without it are computed into the record and copied to wCharDataStatsNoRacket, then the record's stats are
// recomputed. Returns the registers it leaves.
export function charDataScreenBuildStats(P) {
  const slot = rd(P, "storyCharacterSlot");
  if (slot) return { a: slot, f: 0 };
  P.wramBank(WRAM_SCENE);
  for (let i = 0; i < NUM_STATS; i++) wr(P, "charDataRacketDeltas", 0, i);
  if (!rd(P, "equippedRacket")) return { a: 0, f: FZ, hl: (P.A.charDataRacketDeltas + NUM_STATS) & 0xFFFF };
  rom(P, FAR.RecomputeStatsWithoutRacket, { a: rd(P, "equippedRacket"), hl: (P.A.charDataRacketDeltas + NUM_STATS) & 0xFFFF });
  for (let i = 0; i < NUM_STATS; i++) wr(P, "charDataStatsNoRacket", rd(P, "storyMainCharStats", i), i);
  for (let i = 0; i < NUM_STATS; i++)
    wr(P, "charDataRacketDeltas", rd(P, "charDataStats", i) - 1 - rd(P, "charDataStatsNoRacket", i), i);
  return rom(P, FAR.RefreshMainCharacterStats);
}
// CharDataScreen_LoadGfx (1A:7B85): OBJ palettes 4-5 (the arrows: up, down) and the four arrow tile pairs at VRAM bank
// 1 tiles $78-$7F
export function charDataScreenLoadGfx(P) {
  loadPaletteShadow(P, CharDataScreen_LoadPalette, 8 + 4, 2);
  P.wramBank(WRAM_STAGING);
  for (const [gfx, dest] of ARROW_GFX) {
    decompressData(P, gfx, wDecompBuffer);
    queueVRAMCopy(P, wDecompBuffer, dest + VRAM_BANK1, ARROW_GFX_BLOCKS);
  }
}
// DrawStatChangeArrows (1A:7BE5), from the stat sprites' frame tasks: while the stats page is shown at rest (arrow
// mode 1, slide 0) and in the blink's lit phase (hVBlankCounter & $18), an arrow beside each stat the racket changes,
// at the end of the stat's bar; a change of 3 or more has a second arrow.
const ARROW_ROWS = [[0x14, 0x2C], [0x14, 0x3C], [0x14, 0x54], [0x14, 0x64], [0x14, 0x74], [0x64, 0x2C], [0x64, 0x3C],
  [0x64, 0x54], [0x64, 0x64], [0x64, 0x74], [0x64, 0x84]];
export function drawStatChangeArrows(P) {
  P.wramBank(WRAM_SCENE);
  if (rd(P, "charDataPageArrowMode") !== 1) return;
  if (rd(P, "charDataStatsSlideX") | rd(P, "charDataStatsSlideX", 1)) return;
  if (!(P.V.vBlankCounter & 0x18)) return;
  ARROW_ROWS.forEach(([x, y], i) => {
    const delta = rd(P, "charDataRacketDeltas", i);
    if (!delta) return;
    const attr = getStatArrowSpriteAttr(delta);
    const { tile, kind, rest } = getStatArrowTile(delta);
    const value = (rd(P, "charDataStatsNoRacket", i) + rd(P, "charDataStatDeltas", i)) & 0xFF;
    const ax = computeStatArrowSpriteX(P, value, kind, x);
    queueSprite(P, attr, tile, ax, y);
    if (!rest) return;
    queueSprite(P, attr, getStatArrowExtraTile(rest).tile, offsetStatArrowSpriteX(rest, ax), y);
  });
}
// GetStatArrowSpriteAttr (1A:7DEE): OBJ palette 4 (up) or 5 (down), VRAM bank 1
export const getStatArrowSpriteAttr = delta => (delta & 0x80 ? 0x0D : 0x0C);
// GetStatArrowTile (1A:7DF5): the arrow for a change: +1 tile $7C, +2 or more $7E, -1 $78, -2 or less $7A; kind
// indexes the x offset table; rest is the change beyond 2 (a left by the ROM: nonzero adds a second arrow)
export function getStatArrowTile(delta) {
  if (!(delta & 0x80)) {
    if (delta === 1) return { tile: 0x7C, kind: 2, rest: 0 };
    return { tile: 0x7E, kind: 2, rest: (delta - 2) & 0xFF };
  }
  if (delta === 0xFF) return { tile: 0x78, kind: 1, rest: 0 };
  return { tile: 0x7A, kind: 1, rest: (delta + 2) & 0xFF };
}
// GetStatArrowExtraTile (1A:7E15): the second arrow: $7C (kind 3) up, $78 (kind 0) down
export const getStatArrowExtraTile = rest => (rest & 0x80 ? { tile: 0x78, kind: 0 } : { tile: 0x7C, kind: 3 });
// ComputeStatArrowSpriteX (1A:7E23): x + (value + 1) * 4 (rotated as the ROM does) + the kind's offset
export function computeStatArrowSpriteX(P, value, kind, x) {
  const d = (rlca(rlca((value + 1) & 0xFF)) + x) & 0xFF;
  return (u8(P, idx(ComputeStatArrowSpriteXTable, kind)) + d) & 0xFF;
}
// OffsetStatArrowSpriteX (1A:7E38): the second arrow 8 px further out (right up, left down)
export const offsetStatArrowSpriteX = (rest, x) => ((rest & 0x80 ? 0xF8 : 0x08) + x) & 0xFF;

export const HOOKS = [
  [BANK, 0x7012, hook(P => unusedDrawCharViewerCharSprite(P))],
  [BANK, 0x7096, hook(P => { unusedLoadCharViewerMugshot(P); })],
  [BANK, 0x70C0, hook(P => { unusedApplyCharViewerPalette(P); })],
  [BANK, 0x7945, hookGen(P => runCharDataConfirmScreen(P))],
  [BANK, 0x7A1D, hook(P => { drawConfirmSelectionCursor1a(P); })],
  [BANK, 0x7A3D, hook((P, c) => { copyBank1ToBank3BufferAlt(P, c.h << 8 | c.l, c.b << 8 | c.c); })],
  [BANK, 0x7A52, hook((P, c) => { copyBank1ToBank2BufferAlt(P, c.h << 8 | c.l, c.b << 8 | c.c); })],
  [BANK, 0x7A67, hook((P, c) => { applyTilemapPatchList1a(P, c.h << 8 | c.l, c.b << 8 | c.c); })],
  [BANK, 0x7AB5, hook(P => charDataScreenBuildStats(P))],
  [BANK, 0x7B85, hook(P => { charDataScreenLoadGfx(P); })],
  [BANK, 0x7BE5, hook(P => { drawStatChangeArrows(P); })],
  [BANK, 0x7DEE, hook((P, c) => ({ b: getStatArrowSpriteAttr(c.a) }))],
  [BANK, 0x7DF5, hook((P, c) => { const t = getStatArrowTile(c.a); return { a: t.rest, c: t.tile, h: t.kind }; })],
  [BANK, 0x7E15, hook((P, c) => { const t = getStatArrowExtraTile(c.a); return { c: t.tile, h: t.kind }; })],
  [BANK, 0x7E23, hook((P, c) => ({ d: computeStatArrowSpriteX(P, c.a, c.h, c.d) }))],
  [BANK, 0x7E38, hook((P, c) => ({ d: offsetStatArrowSpriteX(c.a, c.d) }))],
];

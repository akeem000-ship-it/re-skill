// The story's racket and shoes select screens (bank $3e): the items owned (item 0 always, the others by their game
// flags; the one equipped marked) as 2x2 icons in a row, the hovered one's name, description and stat changes below,
// a box cursor over the hovered icon and a marker over the equipped one. A equips the hovered item (wEquippedRacket:
// racket in the low nibble, shoes in the high one) and leaves 20 frames later (the main character's stats
// refreshed: a = 0); B leaves at once (a = $FF). The equipment status screen (choicetab.js) shows the two equipped
// items with the panels drawn here.
// Port of src/engine/menus/equipment/racket_select_3e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; tables, palettes and graphics are read
// from the ROM.
// Tests: lockstep on out/port/story_pause_items.mtrec (the status screen's panels) and out/port/eq_all.mtrec
// (scripted from a story state, items owned: moves, equip, back); web/tests/port/routines_menus_misc.mjs.
import {
  FZ, FN, FAR, rom, romWait, near, wram, rd, wr, u8, w8, idx, sound, advanceFrame, registerFrameTask, clearFrameTasks,
  loadPaletteShadow, enableLCD, fadeIn, fadeOut, copyTilemapRect, loadCompressedTileBlock, loadScreenAssetRecord,
  queueWram3MapToVRAM, prepareGlyphBuffer, disableLCDSafely, testFlag, hook, hookGen, WRAM_SCREEN, TILEMAP_WIDTH,
  TILE_SIZE, VRAM_BANK1, vTiles0, wShadowTilemap, wShadowAttrmap, PADF_A, PADF_B, SFX_MENU_MOVE, SFX_MENU_DECIDE,
  SFX_MENU_CANCEL, FH, FC, orFlags, chain, nested, nestedGen, getRegs, ixF,
} from "./defs.js";
import { clearMemory16 } from "../../home/memory.js";
import { clearBytes } from "../../home/system.js";
import {
  loadEquipSelectCommon, clearEquipSelectTextRows, flushEquipSelectTextRows, getHoveredItemId, getEquippedItemId,
  drawEquippedItemStatMods, drawHoveredItemStatMods, renderShoesDescText, renderRacketDescText, renderShoesNameText,
  renderRacketNameText, EquipListCursorSpriteTask, EquippedItemMarkerSpriteTask,
} from "./equip.js";

export const BANK = 0x3E;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF);
const Palette_3e = 0x555B, RacketItemTiles_3e = 0x57A2, ShoeItemTiles_3e = 0x57F2;
const SCREENASSET_EquipmentSelect = 0x21, TILEBLOCK_SharedMenuGfx99 = 0x63, SharedMenuGfx99_BLOCKS = 0x02;
const OBJ_PALETTE_1 = 9;
export const EQUIP_RACKET = 0, EQUIP_SHOES = 1;           // wEquipItemKind
const ROWSET_HOVERED = 0, ROWSET_STATUS_RACKET = 1, ROWSET_STATUS_SHOES = 2;   // wEquipStatRowSet
const OWNED = 1, EQUIPPED = 2, ITEM_SLOTS = 8;            // wEquipOwnedMap entries; the list's size
const RACKET_FLAGS = 6, SHOE_FLAGS = 2;                   // the items past item 0, each owned by a game flag
const LIST_COLUMNS = 7, LIST_CLEAR_BLOCKS = 2, STATUS_CLEAR_BLOCKS = 3;
const EXIT_EQUIPPED = 0x01, EXIT_CANCELLED = 0x44, EXIT_AT = 0x14, CANCELLED_AT = 0x45;   // wEquipSelectExitTimer
const ICON_ROW_RACKETS = wShadowTilemap + 18 * TILEMAP_WIDTH, ICON_ROW_SHOES = wShadowTilemap + 20 * TILEMAP_WIDTH;
const ATTRMAP_OFFSET = wShadowAttrmap - wShadowTilemap;
const setMenuCursorFromIndex3e = (P, cols, index) => near(P, FAR.SetMenuCursorFromIndex_3e[1], { b: cols, c: index });

// ---- the status screen's panels ----
// The equipped item of the kind: its icon at `icon`, its name after it, its stat changes in the rows of `rowSet`
// (wMenuCursorX = its place in the list, for the cursor routines)
function* drawEquippedPanel(P, kind, markOwned, rowSet, icon, renderName, r) {
  wr(P, "equipItemKind", kind);
  chain(r, markOwned(P));
  chain(r, buildOwnedItemList(P));
  wr(P, "equipStatRowSet", rowSet);
  P.V.menuCursorX = rd(P, "equipEquippedIndex");
  chain(r, getEquippedItemId(P));
  chain(r, { c: r.a, de: icon });
  drawItemIcon2x2(P, r.a, icon);
  chain(r, getEquippedItemId(P));
  chain(r, { c: r.a, de: (icon + 3) & 0xFFFF });
  chain(r, yield* nestedGen(P, 1, renderName(P, r.a, (icon + 3) & 0xFFFF, r)));
  drawEquippedItemStatMods(P);
  return r;
}
// DrawEquippedRacketPanel (3E:5458): the upper panel
export const drawEquippedRacketPanel = (P, entry = getRegs(P.cpu)) => drawEquippedPanel(P, EQUIP_RACKET, markOwnedRackets,
  ROWSET_STATUS_RACKET, wShadowTilemap + 1 * TILEMAP_WIDTH + 5, renderRacketNameText, { ...entry });
// DrawEquippedShoesPanel (3E:5486): the lower panel (the item list cleared first)
export function* drawEquippedShoesPanel(P, entry = getRegs(P.cpu)) {
  const hl = clearMemory16(P, P.A.equipItemList, STATUS_CLEAR_BLOCKS);
  const r = { ...entry, a: 0, b: 0, c: 0, h: hl >> 8, l: hl & 0xFF, f: FZ | FN };
  return yield* drawEquippedPanel(P, EQUIP_SHOES, markOwnedShoes, ROWSET_STATUS_SHOES, wShadowTilemap + 10 * TILEMAP_WIDTH + 5,
    renderShoesNameText, r);
}

// ---- the select screens ----
// RunRacketSelectScreen (3E:54BD), slot $400C / RunShoesSelectScreen (3E:5645), slot $400E: see the header
function* runEquipSelectScreen(P, load) {
  disableLCDSafely(P);
  yield* load(P);
  registerFrameTask(P, 1, EquipListCursorSpriteTask);
  registerFrameTask(P, 1, EquippedItemMarkerSpriteTask);
  enableLCD(P);
  yield* fadeIn(P, 16);
  for (;;) {
    yield* handleEquipSelectInput(P);
    let timer = rd(P, "equipSelectExitTimer");
    if (timer) {
      timer = (timer + 1) & 0xFF;
      wr(P, "equipSelectExitTimer", timer);
      if (timer >= EXIT_AT) {
        yield* fadeOut(P, 16);
        clearFrameTasks(P);
        if (timer === CANCELLED_AT) return { a: 0xFF };
        rom(P, FAR.RefreshMainCharacterStats);
        return { a: 0, f: FZ };
      }
    }
    yield* advanceFrame(P);
  }
}
export const runRacketSelectScreen = P => runEquipSelectScreen(P, loadRacketSelectScreen);
export const runShoesSelectScreen = P => runEquipSelectScreen(P, loadShoesSelectScreen);
// The list (the items owned of the kind) with its icons and the hovered item's panel, the marker's tiles and
// palette, the screen queued
function* loadEquipList(P, kind, markOwned, drawInfoPanel) {
  setMenuCursorFromIndex3e(P, LIST_COLUMNS, 0);
  wram(P, WRAM_SCREEN);
  clearMemory16(P, P.A.equipItemList, LIST_CLEAR_BLOCKS);
  wr(P, "equipItemKind", kind);
  wr(P, "equipStatRowSet", ROWSET_HOVERED);
  markOwned(P);
  buildOwnedItemList(P);
  drawOwnedItemIcons(P);
  yield* drawInfoPanel(P);
  loadCompressedTileBlock(P, TILEBLOCK_SharedMenuGfx99, vTiles0 + 0x20 * TILE_SIZE + VRAM_BANK1, SharedMenuGfx99_BLOCKS);
  loadPaletteShadow(P, Palette_3e, OBJ_PALETTE_1, 1);
  return queueWram3MapToVRAM(P);
}
// LoadRacketSelectScreen (3E:550D)
export function* loadRacketSelectScreen(P) {
  loadScreenAssetRecord(P, SCREENASSET_EquipmentSelect);
  prepareGlyphBuffer(P);
  loadEquipSelectCommon(P);
  return yield* loadEquipList(P, EQUIP_RACKET, markOwnedRackets, drawRacketInfoPanel);
}
// LoadShoesSelectScreen (3E:5696): the same, the screen's top four rows (tiles and attributes) from rows 26-29
// (the shoes' heading)
export function* loadShoesSelectScreen(P) {
  loadScreenAssetRecord(P, SCREENASSET_EquipmentSelect);
  prepareGlyphBuffer(P);
  loadEquipSelectCommon(P);
  wram(P, WRAM_SCREEN);
  copyTilemapRect(P, wShadowTilemap + 26 * TILEMAP_WIDTH, wShadowTilemap, 0x14, 0x04);
  copyTilemapRect(P, wShadowAttrmap + 26 * TILEMAP_WIDTH, wShadowAttrmap, 0x14, 0x04);
  return yield* loadEquipList(P, EQUIP_SHOES, markOwnedShoes, drawShoesInfoPanel);
}
// DrawOwnedItemIcons (3E:5563): the listed items' icons in a row from (7, 1), two cells apart
export function drawOwnedItemIcons(P, entryF = P.cpu.f) {
  let hl = P.A.equipItemList, de = wShadowTilemap + 1 * TILEMAP_WIDTH + 7, c = 0;
  for (let n = rd(P, "equipItemCount") || 0x100; n > 0; n--) {      // (never 0: item 0 is always owned)
    c = u8(P, hl); hl = (hl + 1) & 0xFFFF;
    drawItemIcon2x2(P, c, de);
    de = (de + 2) & 0xFFFF;
  }
  return { a: 0, b: 0, c, de, hl, f: FZ | FN | (entryF & FC) };       // (C: DrawItemIcon2x2 keeps the caller's)
}
// DrawItemIcon2x2 (3E:557A): item c's 2x2 icon (tiles and attributes) from the kind's icon row to de. Registers kept.
export function drawItemIcon2x2(P, item, de) {
  const hl = idx(rd(P, "equipItemKind") ? ICON_ROW_SHOES : ICON_ROW_RACKETS, item * 2);
  copyTilemapRect(P, hl, de, 0x02, 0x02);
  copyTilemapRect(P, (hl + ATTRMAP_OFFSET) & 0xFFFF, (de + ATTRMAP_OFFSET) & 0xFFFF, 0x02, 0x02);
}
// HandleEquipSelectInput (3E:55AF): a frame's input: A (unless leaving already) equips the hovered item and starts
// the exit timer; B starts it at $44 (cancelled); otherwise the cursor moves, redrawing the hovered item's panel
export function* handleEquipSelectInput(P, entry = getRegs(P.cpu)) {
  const input = P.V.inputPressed;
  P.V.menuInputPressed = input;
  const r = { ...entry, a: input };
  if (input & PADF_A) {
    const timer = rd(P, "equipSelectExitTimer");
    if (!timer) {
      sound(P, SFX_MENU_DECIDE);
      wr(P, "equipSelectExitTimer", EXIT_EQUIPPED);
      const count = rd(P, "equipItemCount");
      chain(r, near(P, FAR.GetMenuCursorIndex_3e[1], { ...r, c: count }));
      wr(P, "equipEquippedIndex", r.a);
      const item = getEquippedItemId(P).a, old = P.V.equippedRacket;
      const b = rd(P, "equipItemKind") !== EQUIP_RACKET ? ((item << 4) | (item >> 4)) & 0xFF : item;   // (swap a)
      const v = (b === item ? old & 0xF0 : old & 0x0F) | b;
      P.V.equippedRacket = v;
      return { ...r, a: v, b, f: orFlags(v) };
    }
  } else if (input & PADF_B) {
    sound(P, SFX_MENU_CANCEL);
    wr(P, "equipSelectExitTimer", EXIT_CANCELLED);
    return { ...r, a: EXIT_CANCELLED, f: FH | (entry.f & FC) };
  }
  const count = rd(P, "equipItemCount");
  chain(r, near(P, FAR.MoveMenuCursorGrid_3e[1], { ...r, a: count, b: count, c: 1 }));
  if (!r.a) return { ...r, f: FZ };
  sound(P, SFX_MENU_MOVE);
  chain(r, nested(P, 1, () => clearEquipSelectTextRows(P, r)));
  const kind = rd(P, "equipItemKind");
  chain(r, { a: kind, f: orFlags(kind) });
  chain(r, yield* nestedGen(P, 1, kind ? drawShoesInfoPanel(P, r) : drawRacketInfoPanel(P, r)));
  return nested(P, 1, () => flushEquipSelectTextRows(P, r));
}
// The hovered item's panel: its stat changes, icon, description and name (the glyphs uploaded over frames with the
// LCD on)
function* drawInfoPanel(P, renderDesc, renderName, entry = getRegs(P.cpu)) {
  const r = chain({ ...entry }, prepareGlyphBuffer(P, entry));
  drawHoveredItemStatMods(P);
  chain(r, getHoveredItemId(P));
  const item = r.a, b = r.b;
  r.c = item;
  chain(r, { de: wShadowTilemap + 5 * TILEMAP_WIDTH + 5 });
  drawItemIcon2x2(P, item, wShadowTilemap + 5 * TILEMAP_WIDTH + 5);
  chain(r, yield* nestedGen(P, 2, renderDesc(P, item, r)));
  chain(r, { b, c: item });
  chain(r, yield* nestedGen(P, 1, renderName(P, item, wShadowTilemap + 5 * TILEMAP_WIDTH + 8, r)));
  return yield* romWait(P, FAR.UploadGlyphBuffer, r);
}
// DrawRacketInfoPanel (3E:5624) / DrawShoesInfoPanel (3E:5704)
export const drawRacketInfoPanel = (P, entry) => drawInfoPanel(P, renderRacketDescText, renderRacketNameText, entry);
export const drawShoesInfoPanel = (P, entry) => drawInfoPanel(P, renderShoesDescText, renderShoesNameText, entry);

// ---- the items owned ----
// BuildOwnedItemList (3E:5725): wEquipItemList = the items marked in wEquipOwnedMap, in order; wEquipItemCount their
// number, wEquipEquippedIndex the place of the equipped one. Returns a = the count.
export function buildOwnedItemList(P) {
  wr(P, "equipEquippedIndex", 0);
  wr(P, "equipItemCount", 0);
  const list = P.A.equipItemList, map = P.A.equipOwnedMap;
  clearBytes(P, list, ITEM_SLOTS);
  let count = 0;
  for (let item = 0; item < ITEM_SLOTS; item++) {
    const mark = u8(P, map + item);
    if (!mark) continue;
    if (mark !== OWNED) wr(P, "equipEquippedIndex", count);
    w8(P, list + count, item);
    count++;
  }
  wr(P, "equipItemCount", count);
  return { a: count, b: count, c: ITEM_SLOTS, de: list + count, hl: map + ITEM_SLOTS, f: FZ | FN };
}
// wEquipOwnedMap: item 0 owned, item 1 + i owned when its flag (the table's) is set; then the equipped one marked
function markOwned(P, flagTable, flags, equipped) {
  const map = P.A.equipOwnedMap;
  clearBytes(P, map, ITEM_SLOTS);
  w8(P, map, OWNED);
  let e = 0;
  for (let i = 0; i < flags; i++) {
    e = rb(P, flagTable + i);
    if (testFlag(P, e)) w8(P, map + 1 + i, OWNED);
  }
  const { hl: at, f } = ixF(map, equipped);
  w8(P, at, EQUIPPED);
  return { a: EQUIPPED, b: 0, c: flags, d: 0, e, hl: at, f };
}
// MarkOwnedRackets (3E:575A) / MarkOwnedShoes (3E:57A8)
export const markOwnedRackets = P => markOwned(P, RacketItemTiles_3e, RACKET_FLAGS, P.V.equippedRacket & 0x0F);
export const markOwnedShoes = P => markOwned(P, ShoeItemTiles_3e, SHOE_FLAGS, P.V.equippedRacket >> 4);

export const HOOKS = [
  [BANK, 0x5458, hookGen(P => drawEquippedRacketPanel(P))],
  [BANK, 0x5486, hookGen(P => drawEquippedShoesPanel(P))],
  [BANK, 0x54BD, hookGen(P => runRacketSelectScreen(P))],
  [BANK, 0x550D, hookGen(P => loadRacketSelectScreen(P))],
  [BANK, 0x5563, hook(P => drawOwnedItemIcons(P))],
  [BANK, 0x557A, hook((P, c) => { drawItemIcon2x2(P, c.c, c.de); })],
  [BANK, 0x55AF, hookGen(P => handleEquipSelectInput(P))],
  [BANK, 0x5624, hookGen(P => drawRacketInfoPanel(P))],
  [BANK, 0x5645, hookGen(P => runShoesSelectScreen(P))],
  [BANK, 0x5696, hookGen(P => loadShoesSelectScreen(P))],
  [BANK, 0x5704, hookGen(P => drawShoesInfoPanel(P))],
  [BANK, 0x5725, hook(P => buildOwnedItemList(P))],
  [BANK, 0x575A, hook(P => markOwnedRackets(P))],
  [BANK, 0x57A8, hook(P => markOwnedShoes(P))],
];

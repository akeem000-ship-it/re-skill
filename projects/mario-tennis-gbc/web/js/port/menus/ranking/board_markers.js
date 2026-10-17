// The ranking board's markers and doubles highlights (bank $1B): the doubles bracket's highlighted rows (rects from
// the map's hidden rows), the 12 marker sprites ([tile, x, y, -] each in wRankingMarkerSlots) and the four
// animation channels that move them (a script of per-frame x or y offsets, ended by $40), the sliding banner and the
// bobbing cursor tasks, and the map rows pushed to VRAM over three frames.
// Port of the code of src/engine/menus/ranking/board_markers_1b.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm); names and addresses are its own. Tables, coordinates, scripts and sprite
// templates are read from the ROM.
// Covered by the lockstep on out/port/xr_board_s.mtrec and xr_board_d.mtrec.
import {
  FZ, rd, wr, ix, far, hook, hookGen, advanceFrame, registerFrameTask, unregisterFrameTask, queueVRAMCopy, queueSprite,
  romWord, romByte, BANK_RANKING, BANK_MENU_LIB, VRAM_BANK1, vBGMap0, wShadowTilemap, wShadowAttrmap, OAM_BANK1, cell,
} from "../exp/defs.js";
import { clearBytes } from "../../home/system.js";
import { copyMemoryBC } from "../../home/memory.js";
import { queueSpriteTemplate } from "../../home/fade.js";
import { copyTilemapRect } from "../common/tilemaps.js";
import { applySpriteBobOffset } from "../common/menu_lib.js";

export const BANK = BANK_RANKING;
// ROM data and routines (bank $1B)
const RankingMarkerHandlers_1b = 0x5857;
const RankingBoardAnimTask_1b_SpriteTemplate = 0x595A, RankingBoardAnimTaskTable = 0x597B;
const RankingCursorBobTask_SpriteTemplate = 0x5A24;
const RankingMarkerCoordsTable = 0x5C8D, RankingMarkerCoordsTable0 = 0x5D57, RankingMarkerCoordsTable2 = 0x5E21;
const RankingMarkerCoordsTable1 = 0x5EB9;
const RankingBoardAnimTask_1b = 0x5912;
const UpdateScriptedOffsetChannel = [0x5ADA, 0x5B08, 0x5B36, 0x5B65];
const MARKERS = 0x0C, MARKER_SLOT_SIZE = 4, MARKER_BYTES = 0x30, MARKER_NONE = 0xFF, SCRIPT_END = 0x40;
const BANNER_START_X = 0xA0, BANNER_FRAMES = 0x87;
const tile = (row, col) => cell(wShadowTilemap, row, col);
const copy = (P, hl, de, w, h) => far(P, BANK_MENU_LIB, () => copyTilemapRect(P, hl, de, w, h));

// HighlightDoublesRankingRows (1B:5829): the rows already won before the round: row 2's two, or (past it) row 5
export function highlightDoublesRankingRows(P) {
  const a = rd(P, "rankingBoardPlayerRow");
  if (a === 0 || a === 1) return { a, f: FZ };
  if (a === 2) { highlightDoublesRankingRow(P, 1); return highlightDoublesRankingRow(P, 2); }
  return highlightDoublesRankingRow(P, 5);
}
// HighlightDoublesRankingRow (1B:5846): row b's highlight (RankingMarkerHandlers_1b), from the hidden rows 18-24
const DOUBLES_ROWS = {                                               // handler: [source col, dest col, width, height]
  0x5865: [0, 6, 4, 4], 0x5875: [4, 10, 4, 4], 0x5885: [8, 6, 4, 7], 0x5895: [12, 10, 4, 7], 0x58A5: [8, 6, 8, 7],
  0x58B5: [16, 6, 8, 7],
};
export function highlightDoublesRankingRow(P, b) {
  if (!b) return { a: 0, f: FZ };
  const handler = romWord(P, ix(RankingMarkerHandlers_1b, b * 2)), rect = DOUBLES_ROWS[handler];
  if (!rect) throw new Error(`HighlightDoublesRankingRow: row ${b} jumps to ${handler.toString(16)}`);
  return drawDoublesRankingMarker(P, ...rect);
}
// DrawDoublesRankingMarker0/2-6 (1B:5865 ...): a highlight rect from row 18 to row 3 (then StubNop_1b_08)
export function drawDoublesRankingMarker(P, from, to, w, h) {
  copy(P, tile(18, from), tile(3, to), w, h);
  return { b: w, c: h, de: tile(3, to), hl: tile(18, from) };
}
// PushRankingBoardTilemapRows (1B:58C5): both maps' rows 0-7, 8-15, 16-19 queued, a frame after each
export function* pushRankingBoardTilemapRows(P) {
  for (const [row, rows] of [[0, 8], [8, 8], [16, 4]]) {
    queueVRAMCopy(P, cell(wShadowTilemap, row, 0), vBGMap0 + row * 32, rows * 2);
    queueVRAMCopy(P, cell(wShadowAttrmap, row, 0), vBGMap0 + row * 32 + VRAM_BANK1, rows * 2);
    yield* advanceFrame(P);
  }
}
// RankingBoardAnimTask_1b (1B:5912), a frame task: the banner sliding in from x $A0 by RankingBoardAnimTaskTable's
// steps, $87 frames; then the task removes itself
export function rankingBoardAnimTask(P) {
  let frame = rd(P, "rankingBannerAnimFrame");
  if (!frame) wr(P, "rankingBannerX", BANNER_START_X);
  const x = (rd(P, "rankingBannerX") + romByte(P, ix(RankingBoardAnimTaskTable, frame))) & 0xFF;
  wr(P, "rankingBannerX", x);
  queueSpriteTemplate(P, RankingBoardAnimTask_1b_SpriteTemplate, x, rd(P, "rankingBoardDoubles") ? 0x50 : 0x40, 0x10,
    OAM_BANK1 | 4, P.cpu.sp - 2);
  frame = (rd(P, "rankingBannerAnimFrame") + 1) & 0xFF;
  wr(P, "rankingBannerAnimFrame", frame);
  if (frame !== BANNER_FRAMES) return { a: frame };
  return unregisterFrameTask(P, RankingBoardAnimTask_1b);
}
// RankingCursorBobTask (1B:5A04), a frame task: the bobbing cursor at the player's row (mode 2)
export function rankingCursorBobTask(P) {
  const y = far(P, BANK_MENU_LIB, () => applySpriteBobOffset(P, rd(P, "rankingBoardDoubles") ? 0x50 : 0x40)).e;
  return queueSpriteTemplate(P, RankingCursorBobTask_SpriteTemplate, 0x30, y, 0x20, OAM_BANK1 | 5, P.cpu.sp - 2);
}
// DrawRankingMarkersTask (1B:5A45), a frame task: the 12 markers (a tile of $FF: none)
export function drawRankingMarkersTask(P) {
  for (let c = 0; c < MARKERS; c++) {
    const { hl } = getRankingMarkerSlot(P, c), t = P.bus.u8(hl);
    if (t !== MARKER_NONE) queueRankingMarkerSprite(P, t, P.bus.u8(hl + 1), P.bus.u8(hl + 2));
  }
  return { a: MARKERS, c: MARKERS, f: FZ };
}
// QueueRankingMarkerSprite (1B:5A5F): marker b's sprite at (d, e): tile b * 2, palette b (bank 1). af, bc kept.
export function queueRankingMarkerSprite(P, b, d, e) { return queueSprite(P, b | OAM_BANK1, (b * 2) & 0xFF, d, e); }
// StartRankingMarkerAnim0-3 (1B:5A6E ...): channel k moves the marker slot hl by the offsets script de (channels
// 0-1 its x, 2-3 its y)
export function startRankingMarkerAnim(P, k, hl, de) {
  P.bus.w16(P.A.rankingAnimSlotPtrs + 2 * k, hl);
  P.bus.w16(P.A.rankingAnimScriptPtrs + 2 * k, de);
  wr(P, "rankingAnimStepIndex", 0, k);
  return { bc: hl, ...registerFrameTask(P, 1, UpdateScriptedOffsetChannel[k]) };
}
// UpdateScriptedOffsetChannel0-3 (1B:5ADA ...), frame tasks: the channel's next offset added to its marker's x (or
// y); at the script's end ($40) the task removes itself
export function updateScriptedOffsetChannel(P, k) {
  const step = rd(P, "rankingAnimStepIndex", k);
  const offset = P.bus.u8((P.bus.u16(P.A.rankingAnimScriptPtrs + 2 * k) + step) & 0xFFFF);
  if (offset === SCRIPT_END) return unregisterFrameTask(P, UpdateScriptedOffsetChannel[k]);
  const at = (P.bus.u16(P.A.rankingAnimSlotPtrs + 2 * k) + (k < 2 ? 1 : 2)) & 0xFFFF;
  P.bus.w8(at, P.bus.u8(at) + offset);
  wr(P, "rankingAnimStepIndex", step + 1, k);
  return { a: (step + 1) & 0xFF, c: offset, hl: at };
}
// ClearRankingMarkerSlots (1B:5C31): the 12 marker slots 0
export function clearRankingMarkerSlots(P) {
  return { hl: clearBytes(P, P.A.rankingMarkerSlots, MARKER_BYTES), bc: 0, a: 0, f: FZ };
}
// LoadRankingMarkerCoords (1B:5C3B): the markers' start (RankingMarkerCoords*: singles shown / won, doubles shown /
// won, by the player's row) copied to marker slot c on (c is 0 where the board calls it)
export function loadRankingMarkerCoords(P, c) {
  const won = rd(P, "rankingBoardMode") !== 0;
  const table = rd(P, "rankingBoardDoubles") ? (won ? RankingMarkerCoordsTable1 : RankingMarkerCoordsTable2)
    : (won ? RankingMarkerCoordsTable0 : RankingMarkerCoordsTable);
  const src = romWord(P, ix(table, rd(P, "rankingBoardPlayerRow") * 2));
  const de = getRankingMarkerSlot(P, c).hl;
  return { bc: 0, ...copyMemoryBC(P, src, de, MARKER_BYTES) };
}
// GetRankingMarkerSlot (1B:5F51): hl = marker c's slot. af kept.
export function getRankingMarkerSlot(P, c) { return { hl: ix(P.A.rankingMarkerSlots, c * MARKER_SLOT_SIZE) }; }
// Unused_1b_WriteRankingMarkerSlot (1B:5F5F): [b, d, e] at hl (hl + 4 after). af kept.
export function unusedWriteRankingMarkerSlot(P, hl, b, d, e) {
  P.bus.w8(hl, b); P.bus.w8(hl + 1, d); P.bus.w8(hl + 2, e);
  return { hl: (hl + 4) & 0xFFFF };
}
// Unused_1b_AddRankingMarkerSlotByte1 (1B:5F69) / Byte2 (1B:5F72): b added to the slot's x / y. Registers kept.
export function unusedAddRankingMarkerSlotByte(P, hl, b, k) { const at = (hl + k) & 0xFFFF; P.bus.w8(at, P.bus.u8(at) + b); }

export const HOOKS = [
  [BANK, 0x5829, hook(P => { highlightDoublesRankingRows(P); })],
  [BANK, 0x5846, hook((P, c) => { highlightDoublesRankingRow(P, c.b); })],
  [BANK, 0x5856, () => {}],                                          // StubNop_1b_08
  ...Object.entries(DOUBLES_ROWS).map(([addr, rect]) => [BANK, +addr, hook(P => { drawDoublesRankingMarker(P, ...rect); })]),
  [BANK, 0x58C5, hookGen(P => pushRankingBoardTilemapRows(P))],
  [BANK, 0x5912, hook(P => { rankingBoardAnimTask(P); })],
  [BANK, 0x5A04, hook(P => { rankingCursorBobTask(P); })],
  [BANK, 0x5A45, hook(P => drawRankingMarkersTask(P))],
  [BANK, 0x5A5F, hook((P, c) => { queueRankingMarkerSprite(P, c.b, c.d, c.e); })],
  ...[0x5A6E, 0x5A89, 0x5AA4, 0x5ABF].map((addr, k) => [BANK, addr, hook((P, c) => { startRankingMarkerAnim(P, k, c.hl, c.de); })]),
  ...UpdateScriptedOffsetChannel.map((addr, k) => [BANK, addr, hook(P => { updateScriptedOffsetChannel(P, k); })]),
  [BANK, 0x5C31, hook(P => clearRankingMarkerSlots(P))],
  [BANK, 0x5C3B, hook((P, c) => loadRankingMarkerCoords(P, c.c))],
  [BANK, 0x5F51, hook((P, c) => getRankingMarkerSlot(P, c.c))],
  [BANK, 0x5F5F, hook((P, c) => unusedWriteRankingMarkerSlot(P, c.hl, c.b, c.d, c.e))],
  [BANK, 0x5F69, hook((P, c) => { unusedAddRankingMarkerSlotByte(P, c.hl, c.b, 1); })],
  [BANK, 0x5F72, hook((P, c) => { unusedAddRankingMarkerSlotByte(P, c.hl, c.b, 2); })],
];

// The match's HUD objects (bank $09): five object slots in WRAM bank 4 ($DD80-$DDCF, 16 bytes each) that draw a
// sprite template where a move curve takes them: the court banners (FAULT, GAME, ...), the serve indicators, the
// score display and the result icons; and the score digits, serve graphics and banner tiles they show, queued for
// upload to VRAM. Ports of obj_09 and indicators_09 in the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm), whose names and addresses these are. Like the ROM, the slots are reached
// through the WRAM bank mapped at the time (bank 4 in match play).
// Covered by out/engine/exh1.mtrec and rec1.mtrec (match play; port_lockstep.mjs).
import { callHome } from "./draw.js";
import { playSoundManaged } from "./engine_port.js";
import { findServerCharBank } from "../../engine/flow.js";
import { engine } from "./engine_port.js";

// the slots and the working copy a slot's handler runs on
export const OBJSLOT = [0xDD80, 0xDD90, 0xDDA0, 0xDDB0, 0xDDC0];
const OBJSLOT_WORK = 0xDDF0, OBJSLOT_SIZE = 0x10;
// slot fields (include/constants/match.inc)
const ID = 0x00, FLAGS = 0x01, SPRITE_TEMPLATE = 0x02, OAM_ATTR = 0x04, TILE = 0x05, X = 0x06, Y = 0x07, HANDLER = 0x08;
const CURVE_X = 0x0A, CURVE_Y = 0x0B, STATE = 0x0C, CURVE_STEP = 0x0D, CURVE = 0x0E, ANCHOR = 0x0F;
const FLAG_DRAW = 0x01, FLAG_ACTIVE = 0x80;
// the handlers a slot can hold (bank 9 code addresses)
const OBJ_UPDATE_SHOW = 0x4758, OBJ_UPDATE_HIDE = 0x475E, OBJ_UPDATE_RUN_CURVE = 0x4764, OBJ_UPDATE_DONE = 0x4781;
// bank 9 tables
const OBJ_TEMPLATES = 0x41BC, GAME_SCORE_DISPLAY_OBJ_TEMPLATE = 0x41FC, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE = 0x420C;
const SERVE_INDICATOR_OBJ_TEMPLATES = 0x4298, WIN_LOSE_RESULT_OBJ_TEMPLATE = 0x4300, SERVE_INDICATOR_SIDE_OBJ_TEMPLATES = 0x4327;
const COURT_BANNER_OBJ_TEMPLATES = 0x4385, MOVE_CURVE_TABLE = 0x47AE, VRAM_TILESET = 0x488A;
const VRAM_GFX_PTR_TABLE = 0x616D, PLAYER1_SCORE_DIGIT_GFX = 0x6171, PLAYER2_SCORE_DIGIT_GFX = 0x6175, DEUCE_ADVANTAGE_TILES = 0x6BC0;
const SERVE_GFX_PTR_TABLE = 0x6C6E, OBJ_COLUMN8_ROWS2 = 0x7098;
const PLAYER1_SERVE_INDICATOR_SPRITES = 0x7112, PLAYER2_SERVE_INDICATOR_SPRITES = 0x7129;
const PLAYER1_CHAR_ICON_SPRITES = 0x71A4, PLAYER2_CHAR_ICON_SPRITES = 0x71BB;
const VTILES0 = 0x8000, TILE_SIZE = 0x10;

const u8 = v => v & 0xFF, u16 = v => v & 0xFFFF;
const rom = (P, a) => P.rom.u8(9, a), romWord = (P, a) => P.rom.u16(9, a);
const indexed = (base, a) => u16(base + u8(a));                          // ld_hl_indexed: table + a
// QueueVRAMCopy (00:0480) of c 16-byte blocks from bank 9 (hl) to VRAM (de)
const queueVRAMCopy = (P, hl, de, c) => callHome(P, 0x0480, { h: hl >> 8, l: hl & 0xFF, d: de >> 8, e: de & 0xFF, c }, 9);

// ---- slot setup (obj_09) ----
// 09:4598 InitObjSlot: cleared, no handler (ObjUpdateRunCurve.done), the two-row column template, free ($FF)
export function initObjSlot(P, bc) {
  const bus = P.bus;
  for (let i = 0; i < OBJSLOT_SIZE; i++) bus.w8(bc + i, 0);               // ClearMemory16
  bus.w16(bc + HANDLER, OBJ_UPDATE_DONE);
  bus.w16(bc + SPRITE_TEMPLATE, OBJ_COLUMN8_ROWS2);
  bus.w8(bc + ID, 0xFF);
}
// 09:4555 InitAllObjSlots: slots 2-4 on OBJ palette 1 with their tile bases ($30, $20, $38)
export function initAllObjSlots(P) {
  P.wramBank(4);
  initObjSlot(P, OBJSLOT[0]); initObjSlot(P, OBJSLOT[1]);
  for (const [k, tile] of [[2, 0x30], [3, 0x20], [4, 0x38]]) { initObjSlot(P, OBJSLOT[k]); setObjSpriteAttr(P, OBJSLOT[k], 0x01); setObjTileOffset(P, OBJSLOT[k], tile); }
}
// 09:45BC SetObjSpriteTemplate / 09:45C4 SetObjPosition (d -> +6, e -> +7) / 09:45CC SetObjTileOffset /
// 09:45D2 SetObjSpriteAttr / 09:45EC SetObjMoveCurve / 09:45F2 SetObjDrawMode
export function setObjSpriteTemplate(P, bc, de) { P.bus.w16(bc + SPRITE_TEMPLATE, de); }
export function setObjPosition(P, bc, de) { P.bus.w8(bc + X, de >> 8); P.bus.w8(bc + Y, de); }
export function setObjTileOffset(P, bc, d) { P.bus.w8(bc + TILE, d); }
export function setObjSpriteAttr(P, bc, d) { P.bus.w8(bc + OAM_ATTR, d); }
export function setObjMoveCurve(P, bc, d) { P.bus.w8(bc + CURVE, d); }
export function setObjDrawMode(P, bc, d) { P.bus.w8(bc + ANCHOR, d); }
// 09:45D8 SetObjUpdateRoutine: a new handler, from its first state and curve step
export function setObjUpdateRoutine(P, bc, de) { const bus = P.bus; bus.w16(bc + HANDLER, de); bus.w8(bc + STATE, 0); bus.w8(bc + CURVE_STEP, 0); }
// 09:460A LoadObjTemplate_09: record a (16 bytes) of the template table hl into the slot bc: id, position, sprite
// template, handler and curve, its sound (played now, 0 = none) and draw mode; curve offsets cleared, active
export function loadObjTemplate(P, a, hl, bc) {
  const bus = P.bus;
  bus.w8(bc + ID, a);
  const t = u16(hl + a * 16);
  setObjPosition(P, bc, rom(P, t + 1) << 8 | rom(P, t));
  setObjSpriteTemplate(P, bc, romWord(P, t + 2));
  setObjUpdateRoutine(P, bc, romWord(P, t + 4));
  setObjMoveCurve(P, bc, rom(P, t + 6));
  const sound = rom(P, t + 12);
  if (sound) playSoundManaged(P, sound);
  setObjDrawMode(P, bc, rom(P, t + 14));
  bus.w8(bc + CURVE_X, 0); bus.w8(bc + CURVE_Y, 0);
  bus.w8(bc + FLAGS, bus.u8(bc + FLAGS) | FLAG_ACTIVE);
}
// 09:4658 StartObjExitAnim: an active slot leaves by its record's exit handler and curve (+8, +10). The record
// offset is computed in 8 bits (id * 16 + 8), so records from 16 on wrap round to the table's start.
export function startObjExitAnim(P, hl, bc) {
  const bus = P.bus, flags = bus.u8(bc + FLAGS);
  if (!(flags & FLAG_ACTIVE)) return;
  bus.w8(bc + FLAGS, flags & ~FLAG_ACTIVE);
  const t = u16(hl + u8(bus.u8(bc + ID) * 16 + 8));
  setObjUpdateRoutine(P, bc, romWord(P, t));
  setObjMoveCurve(P, bc, rom(P, t + 2));
}
// 09:4683 ClearAllObjSlots: every slot free
export function clearAllObjSlots(P) { for (const bc of OBJSLOT) P.bus.w8(bc + ID, 0xFF); }

// ---- the per-frame update (09:4695 UpdateAllObjSprites) ----
// each used slot runs its handler on a working copy (wObjSlotWork), is drawn, steps its curve counter and is
// copied back (09:46B5 ProcessObjSlot, 09:46D3 DrawObjSlot, 09:46E1 FinishObjSlotUpdate)
export function updateAllObjSprites(P) { for (const bc of OBJSLOT) processObjSlot(P, bc); }
export function processObjSlot(P, bc) {
  const bus = P.bus, W = OBJSLOT_WORK;
  if (bus.u8(bc + ID) === 0xFF) return;
  for (let i = 0; i < OBJSLOT_SIZE; i++) bus.w8(W + i, bus.u8(bc + i));   // CopyMemoryFast
  const handler = bus.u16(W + HANDLER);
  switch (handler) {
    case OBJ_UPDATE_SHOW: objUpdateShow(P); break;
    case OBJ_UPDATE_HIDE: objUpdateHide(P); break;
    case OBJ_UPDATE_RUN_CURVE: objUpdateRunCurve(P); break;
    case OBJ_UPDATE_DONE: break;
    default: throw new Error(`object slot $${bc.toString(16)}: handler 09:${handler.toString(16)}`);
  }
  const anchor = bus.u8(W + ANCHOR);
  if (anchor === 0) drawObjAtOffset(P);
  else if (anchor === 1) drawObjOnServer(P);
  else throw new Error(`object slot $${bc.toString(16)}: draw mode ${anchor}`);   // the ROM returns into the slot's RAM
  bus.w8(W + CURVE_STEP, bus.u8(W + CURVE_STEP) + 1);
  for (let i = 0; i < OBJSLOT_SIZE; i++) bus.w8(bc + i, bus.u8(W + i));
}
// FinishObjSlotUpdate.drawAtOffset (09:46F0): the template at the stored position plus the curve offset
function drawObjAtOffset(P) {
  const bus = P.bus, W = OBJSLOT_WORK;
  if (!(bus.u8(W + FLAGS) & FLAG_DRAW)) return;
  queueObjTemplate(P, u8(bus.u8(W + CURVE_X) + bus.u8(W + X)), u8(bus.u8(W + CURVE_Y) + bus.u8(W + Y)));
}
// FinishObjSlotUpdate.drawOnServer (09:4718): the same, relative to the serving character on screen
function drawObjOnServer(P) {
  const bus = P.bus, W = OBJSLOT_WORK;
  if (!(bus.u8(W + FLAGS) & FLAG_DRAW)) return;
  const b = findServerCharBank(engine(P));                               // farcall FindServerCharBank (08:46E7)
  P.wramBank(b);
  const sx = bus.u8(0xDF53), sy = bus.u8(0xDF54);                         // wCharScreenX / Y
  P.wramBank(4);
  queueObjTemplate(P, u8(bus.u8(W + CURVE_X) + bus.u8(W + X) + sx), u8(bus.u8(W + CURVE_Y) + bus.u8(W + Y) + sy));
}
function queueObjTemplate(P, d, e) {
  const bus = P.bus, W = OBJSLOT_WORK, hl = bus.u16(W + SPRITE_TEMPLATE);
  callHome(P, 0x1E9D, { b: bus.u8(W + OAM_ATTR), c: bus.u8(W + TILE), d, e, h: hl >> 8, l: hl & 0xFF }, 9);   // QueueSpriteTemplate
}
// 09:4758 ObjUpdateShow / 09:475E ObjUpdateHide
function objUpdateShow(P) { const a = OBJSLOT_WORK + FLAGS; P.bus.w8(a, P.bus.u8(a) | FLAG_DRAW); }
function objUpdateHide(P) { const a = OBJSLOT_WORK + FLAGS; P.bus.w8(a, P.bus.u8(a) & ~FLAG_DRAW); }
// 09:4764 ObjUpdateRunCurve: shown while the curve runs; at its end the state moves on (state 1: done)
function objUpdateRunCurve(P) {
  const bus = P.bus, W = OBJSLOT_WORK, state = bus.u8(W + STATE);
  if (state === 1) return;
  if (state !== 0) throw new Error(`ObjUpdateRunCurve: state ${state} past its jump table`);
  objUpdateShow(P);
  if (getNextMoveCurveValue(P)) return;
  bus.w8(W + STATE, state + 1);
}
// 09:4782 GetNextMoveCurveValue: the curve's value at the step into the X offset (returns true); $80 holds the
// object where it is, $81 also frees the slot (both return false)
export function getNextMoveCurveValue(P) {
  const bus = P.bus, W = OBJSLOT_WORK;
  const curve = romWord(P, indexed(MOVE_CURVE_TABLE, bus.u8(W + CURVE) * 2));
  const v = rom(P, u16(curve + bus.u8(W + CURVE_STEP)));
  if (v === 0x80) return false;
  if (v === 0x81) { bus.w8(W + ID, 0xFF); return false; }
  bus.w8(W + CURVE_X, v);
  return true;
}

// ---- the objects the match shows (obj_09) ----
// 09:4367 ShowCourtBanner: banner a (its tiles queued, then its object in slot 3, the others cleared)
export function showCourtBanner(P, a) {
  clearAllObjSlots(P);
  loadTilesetGfx(P, a);
  loadObjTemplate(P, a, COURT_BANNER_OBJ_TEMPLATES, OBJSLOT[3]);         // 09:4371 SpawnCourtBannerObj
}
// 09:437B HideCourtBanner
export function hideCourtBanner(P) { startObjExitAnim(P, COURT_BANNER_OBJ_TEMPLATES, OBJSLOT[3]); }
// 09:4242 SpawnServeIndicatorObjs: the server's side marker (slot 4) and both players' serve indicators (slots
// 0, 1) by the server's court position; the doubles scoreboard has one indicator, moved down for the near end
export function spawnServeIndicatorObjs(P) {
  const V = P.V, bus = P.bus;
  clearAllObjSlots(P);
  loadObjTemplate(P, V.servingCharCourtPos, SERVE_INDICATOR_SIDE_OBJ_TEMPLATES, OBJSLOT[4]);   // 09:4310 SpawnServeIndicatorSideObj
  loadObjTemplate(P, V.servingCharCourtPos, SERVE_INDICATOR_OBJ_TEMPLATES, OBJSLOT[0]);
  setObjSpriteTemplate(P, OBJSLOT[0], getSprites(P, PLAYER1_SERVE_INDICATOR_SPRITES));
  if (V.scoreboardLayout === 3) {
    if (V.servingCharCourtPos & 2) return;
    bus.w8(OBJSLOT[0] + Y, bus.u8(OBJSLOT[0] + Y) + 0x10);
    return;
  }
  loadObjTemplate(P, V.servingCharCourtPos, SERVE_INDICATOR_OBJ_TEMPLATES, OBJSLOT[1]);
  setObjSpriteTemplate(P, OBJSLOT[1], getSprites(P, PLAYER2_SERVE_INDICATOR_SPRITES));
}
// 09:4282 DismissServeIndicatorObjs (09:431D DismissServeIndicatorSideObj first)
export function dismissServeIndicatorObjs(P) {
  startObjExitAnim(P, SERVE_INDICATOR_SIDE_OBJ_TEMPLATES, OBJSLOT[4]);
  startObjExitAnim(P, SERVE_INDICATOR_OBJ_TEMPLATES, OBJSLOT[0]);
  startObjExitAnim(P, SERVE_INDICATOR_OBJ_TEMPLATES, OBJSLOT[1]);
}
// 09:412A SpawnGameScoreDisplayObjs: the two players' icons (by who serves and from which end) and the score
// panel; the doubles scoreboard has one combined object
export function spawnGameScoreDisplayObjs(P) {
  const V = P.V, bus = P.bus;
  P.wramBank(4);
  clearAllObjSlots(P);
  if (V.scoreboardLayout === 3) { loadObjTemplate(P, 0, GAME_SCORE_DISPLAY_OBJ_TEMPLATE, OBJSLOT[0]); return; }
  let b = ~V.currentServingPlayer & 1;
  P.wramBank(4);                                                         // wram_bank WRAM_CHAR0
  b |= bus.u8(0xDF0A) & 2;                                               // wCharCourtPos
  P.wramBank(4);
  loadObjTemplate(P, b, OBJ_TEMPLATES, OBJSLOT[0]);
  setObjSpriteTemplate(P, OBJSLOT[0], getSprites(P, PLAYER1_CHAR_ICON_SPRITES));
  loadObjTemplate(P, b ^ 3, OBJ_TEMPLATES, OBJSLOT[1]);
  setObjSpriteTemplate(P, OBJSLOT[1], getSprites(P, PLAYER2_CHAR_ICON_SPRITES));
  loadObjTemplate(P, 0, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE, OBJSLOT[2]);
}
// 09:4190 DismissGameScoreDisplayObjs
export function dismissGameScoreDisplayObjs(P) {
  if (P.V.drillIsPracticeLesson) { startObjExitAnim(P, GAME_SCORE_DISPLAY_OBJ_TEMPLATE, OBJSLOT[0]); return; }
  startObjExitAnim(P, OBJ_TEMPLATES, OBJSLOT[0]);
  startObjExitAnim(P, OBJ_TEMPLATES, OBJSLOT[1]);
  startObjExitAnim(P, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE, OBJSLOT[2]);
}
// 09:422C SpawnGameResultObj / 09:4238 DismissGameResultObj
export function spawnGameResultObj(P) { loadObjTemplate(P, 1, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE, OBJSLOT[2]); }
export function dismissGameResultObj(P) { startObjExitAnim(P, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE, OBJSLOT[2]); }
// 09:42D8 SpawnWinLoseResultObj: the winner's icon (a: $01 player 1, $FF player 2) / 09:42F6 DismissWinLoseResultObj
export function spawnWinLoseResultObj(P, a) {
  loadObjTemplate(P, 0, WIN_LOSE_RESULT_OBJ_TEMPLATE, OBJSLOT[0]);
  setObjSpriteTemplate(P, OBJSLOT[0], getSprites(P, a & 0x80 ? PLAYER2_CHAR_ICON_SPRITES : PLAYER1_CHAR_ICON_SPRITES));
}
export function dismissWinLoseResultObj(P) { startObjExitAnim(P, WIN_LOSE_RESULT_OBJ_TEMPLATE, OBJSLOT[0]); }
// 09:7103 GetPlayer1ServeIndicatorSprites / 09:711A GetPlayer2... / 09:7195 GetPlayer1CharIconSprites / 09:71AC
// GetPlayer2...: the sprite template for the number of characters on court -> de
export function getSprites(P, table) { return romWord(P, indexed(table, P.V.onCourtCharCountMinus1 * 2)); }

// ---- the score digits and the graphics the objects show (obj_09, indicators_09) ----
// 09:4036 UpdatePointDigitsDisplay: each player's points digit (40 drawn as "A" against a 40 is AD: 5); in a
// tiebreak the plain count (7 against 7: 8)
export function updatePointDigitsDisplay(P) {
  const V = P.V;
  if (!V.tiebreakerIndicator) {
    loadPlayer1PointsDigitGfx(P, V.player2PointsWon === 4 ? 5 : V.player1PointsWon, 0);
    loadPlayer2PointsDigitGfx(P, V.player1PointsWon === 4 ? 5 : V.player2PointsWon, 0);
  } else {
    loadPlayer1PointsDigitGfx(P, V.player2PointsWon === 7 ? 8 : V.player1PointsWon, 1);
    loadPlayer2PointsDigitGfx(P, V.player1PointsWon === 7 ? 8 : V.player2PointsWon, 1);
  }
}
// 09:4082 GetPointScoreForDisplay: the points, the server's first -> { d, e, a: wDeuceIndicator }
export function getPointScoreForDisplay(P) {
  const V = P.V;
  let d = V.player1PointsWon, e = V.player2PointsWon;
  if (V.currentServingPlayer & 1) [d, e] = [e, d];
  return { d, e, a: V.deuceIndicator };
}
// 09:4098 UpdateScorePanelDisplay: the score panel's digits, or DEUCE
export function updateScorePanelDisplay(P) {
  const { d, e, a } = getPointScoreForDisplay(P);
  if (a) { loadDeuceAdvantageGfx(P); return; }
  loadPlayer1ScoreDigitGfx(P, d, P.V.scoreDisplayIsTiebreak);
  loadPlayer2ScoreDigitGfx(P, e, P.V.scoreDisplayIsTiebreak);
}
// 09:4873 LoadTilesetGfx: banner a's tiles (VramTileset_09: source, block count) to tile $20
export function loadTilesetGfx(P, a) {
  const t = indexed(VRAM_TILESET, a * 4);
  queueVRAMCopy(P, romWord(P, t), VTILES0 + 0x20 * TILE_SIZE, rom(P, t + 2));
}
// 09:6154 GetGfxSourcePtr: entry b of the word table hl, plus a * $40 (a sign-extended: sra b / rr c twice)
export function getGfxSourcePtr(P, hl, b, a) { return u16(romWord(P, u16(hl + u8(b * 2))) + (((a << 24) >> 24) * 0x40)); }
// 09:6100 LoadScoreDigitGfx (to de) / 09:610C LoadPlayer1PointsDigitGfx (tile $78) / 09:611B LoadPlayer2PointsDigitGfx
// (tile $7C) / 09:612A LoadPlayer1ScoreDigitGfx (tile $30) / 09:6139 LoadPlayer2ScoreDigitGfx (tile $34): digit a
// of set b, four blocks
export function loadScoreDigitGfx(P, a, b, de) { queueVRAMCopy(P, getGfxSourcePtr(P, VRAM_GFX_PTR_TABLE, b, a), de, 4); }
export function loadPlayer1PointsDigitGfx(P, a, b) { queueVRAMCopy(P, getGfxSourcePtr(P, VRAM_GFX_PTR_TABLE, b, a), VTILES0 + 0x78 * TILE_SIZE, 4); }
export function loadPlayer2PointsDigitGfx(P, a, b) { queueVRAMCopy(P, getGfxSourcePtr(P, VRAM_GFX_PTR_TABLE, b, a), VTILES0 + 0x7C * TILE_SIZE, 4); }
export function loadPlayer1ScoreDigitGfx(P, a, b) { queueVRAMCopy(P, getGfxSourcePtr(P, PLAYER1_SCORE_DIGIT_GFX, b, a), VTILES0 + 0x30 * TILE_SIZE, 4); }
export function loadPlayer2ScoreDigitGfx(P, a, b) { queueVRAMCopy(P, getGfxSourcePtr(P, PLAYER2_SCORE_DIGIT_GFX, b, a), VTILES0 + 0x34 * TILE_SIZE, 4); }
// 09:6148 LoadDeuceAdvantageGfx: the DEUCE panel over both score digits (8 blocks to tile $30)
export function loadDeuceAdvantageGfx(P) { queueVRAMCopy(P, DEUCE_ADVANTAGE_TILES, VTILES0 + 0x30 * TILE_SIZE, (0x6C40 - DEUCE_ADVANTAGE_TILES) / 16); }
// 09:6C40 LoadServeGfx: the server's serve graphic (by player, by first or second serve and the server's end) to tile $38
export function loadServeGfx(P) {
  const V = P.V, ptr = romWord(P, indexed(SERVE_GFX_PTR_TABLE, V.currentServingPlayer * 2));
  const k = u8(((V.serveFaultFlag & 1) | (V.servingCharCourtPos & 2)) * 64);
  queueVRAMCopy(P, u16(ptr + k), VTILES0 + 0x38 * TILE_SIZE, 4);
}

// 09:45F8 UnusedToggleObjMoveCurveBits_1 / 09:4601 ..._2: flip curve bits 1 / 0-1 (nothing calls them)
export function toggleObjMoveCurveBits(P, bc, bits) { P.bus.w8(bc + CURVE, P.bus.u8(bc + CURVE) ^ bits); }
const DE = (c, v) => { c.de = v; };
export const HOOKS = [
  [9, 0x4310, P => loadObjTemplate(P, P.V.servingCharCourtPos, SERVE_INDICATOR_SIDE_OBJ_TEMPLATES, OBJSLOT[4])],   // SpawnServeIndicatorSideObj
  [9, 0x431D, P => startObjExitAnim(P, SERVE_INDICATOR_SIDE_OBJ_TEMPLATES, OBJSLOT[4])],                          // DismissServeIndicatorSideObj
  [9, 0x4371, (P, c) => loadObjTemplate(P, c.a, COURT_BANNER_OBJ_TEMPLATES, OBJSLOT[3])],                         // SpawnCourtBannerObj
  [9, 0x45F8, (P, c) => toggleObjMoveCurveBits(P, c.bc, 0x02)],
  [9, 0x4601, (P, c) => toggleObjMoveCurveBits(P, c.bc, 0x03)],
  [9, 0x4758, P => objUpdateShow(P)],
  [9, 0x475E, P => objUpdateHide(P)],
  [9, 0x4764, P => objUpdateRunCurve(P)],
  [9, 0x4782, (P, c) => { const more = getNextMoveCurveValue(P); c.a = more ? 1 : 0; c.f = more ? 0x00 : 0x80; }],   // GetNextMoveCurveValue
  [9, 0x6154, (P, c) => { const a = c.a; c.hl = getGfxSourcePtr(P, c.hl, c.b, a); c.bc = (((a << 24) >> 24) * 0x40) & 0xFFFF; }],   // GetGfxSourcePtr
  [9, 0x4555, P => initAllObjSlots(P)],
  [9, 0x4598, (P, c) => initObjSlot(P, c.bc)],
  [9, 0x45BC, (P, c) => setObjSpriteTemplate(P, c.bc, c.de)],
  [9, 0x45C4, (P, c) => setObjPosition(P, c.bc, c.de)],
  [9, 0x45CC, (P, c) => setObjTileOffset(P, c.bc, c.d)],
  [9, 0x45D2, (P, c) => setObjSpriteAttr(P, c.bc, c.d)],
  [9, 0x45D8, (P, c) => setObjUpdateRoutine(P, c.bc, c.de)],
  [9, 0x45EC, (P, c) => setObjMoveCurve(P, c.bc, c.d)],
  [9, 0x45F2, (P, c) => setObjDrawMode(P, c.bc, c.d)],
  [9, 0x460A, (P, c) => loadObjTemplate(P, c.a, c.hl, c.bc)],
  [9, 0x4658, (P, c) => startObjExitAnim(P, c.hl, c.bc)],
  [9, 0x4683, P => clearAllObjSlots(P)],
  [9, 0x4695, P => updateAllObjSprites(P)],
  [9, 0x46B5, (P, c) => processObjSlot(P, c.bc)],
  [9, 0x4367, (P, c) => showCourtBanner(P, c.a)],
  [9, 0x437B, P => hideCourtBanner(P)],
  [9, 0x4242, P => spawnServeIndicatorObjs(P)],
  [9, 0x4282, P => dismissServeIndicatorObjs(P)],
  [9, 0x412A, P => spawnGameScoreDisplayObjs(P)],
  [9, 0x4190, P => dismissGameScoreDisplayObjs(P)],
  [9, 0x422C, P => spawnGameResultObj(P)],
  [9, 0x4238, P => dismissGameResultObj(P)],
  [9, 0x42D8, (P, c) => spawnWinLoseResultObj(P, c.a)],
  [9, 0x42F6, P => dismissWinLoseResultObj(P)],
  [9, 0x7103, (P, c) => DE(c, getSprites(P, PLAYER1_SERVE_INDICATOR_SPRITES))],
  [9, 0x711A, (P, c) => DE(c, getSprites(P, PLAYER2_SERVE_INDICATOR_SPRITES))],
  [9, 0x7195, (P, c) => DE(c, getSprites(P, PLAYER1_CHAR_ICON_SPRITES))],
  [9, 0x71AC, (P, c) => DE(c, getSprites(P, PLAYER2_CHAR_ICON_SPRITES))],
  [9, 0x4036, P => updatePointDigitsDisplay(P)],
  [9, 0x4082, (P, c) => { const r = getPointScoreForDisplay(P); c.d = r.d; c.e = r.e; c.a = r.a; }],
  [9, 0x4098, P => updateScorePanelDisplay(P)],
  [9, 0x4873, (P, c) => loadTilesetGfx(P, c.a)],
  [9, 0x6100, (P, c) => loadScoreDigitGfx(P, c.a, c.b, c.de)],
  [9, 0x610C, (P, c) => loadPlayer1PointsDigitGfx(P, c.a, c.b)],
  [9, 0x611B, (P, c) => loadPlayer2PointsDigitGfx(P, c.a, c.b)],
  [9, 0x612A, (P, c) => loadPlayer1ScoreDigitGfx(P, c.a, c.b)],
  [9, 0x6139, (P, c) => loadPlayer2ScoreDigitGfx(P, c.a, c.b)],
  [9, 0x6148, P => loadDeuceAdvantageGfx(P)],
  [9, 0x6C40, P => loadServeGfx(P)],
];

// The match's HUD objects (bank $09): five object slots in WRAM bank 4 ($DD80-$DDCF, 16 bytes each) that draw a
// sprite template where a move curve takes them: the court banners (FAULT, GAME, ...), the serve indicators, the
// score display and the result icons; and the score digits, serve graphics and banner tiles they show, queued for
// upload to VRAM. Ports of obj_09 and indicators_09 in the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm), whose names and addresses these are. Like the ROM, the slots are reached
// through the WRAM bank mapped at the time (bank 4 in match play).
//
// These routines pass their arguments and results in registers and call each other in long chains, and their
// callers (the minigames' code among them) go on with what they leave, so each is written on a register file r
// (regs.js Regs): it reads its arguments from r and leaves r as the ROM routine leaves the CPU, scratch registers
// and flags included. The bank-0 routines they use (QueueVRAMCopy, QueueSpriteTemplate, CopyMemoryFast,
// ClearMemory16, PlaySoundManaged) are called with all of r and give back what they leave (romCall).
// Covered by out/engine/exh1.mtrec and rec1.mtrec (match play; port_lockstep.mjs).
import { Regs, regsOf, threaded, romCall } from "./regs.js";
import { add8, sub8, addHL, andFlags, bitFlags, incFlags, hlIndexed, FZ, FC } from "./leftovers.js";

// the slots and the working copy a slot's handler runs on
export const OBJSLOT = [0xDD80, 0xDD90, 0xDDA0, 0xDDB0, 0xDDC0];
const OBJSLOT_WORK = 0xDDF0;
// slot fields (include/constants/match.inc)
const ID = 0x00, FLAGS = 0x01, SPRITE_TEMPLATE = 0x02, OAM_ATTR = 0x04, TILE = 0x05, X = 0x06, Y = 0x07, HANDLER = 0x08;
const CURVE_X = 0x0A, CURVE_Y = 0x0B, STATE = 0x0C, CURVE_STEP = 0x0D, CURVE = 0x0E, ANCHOR = 0x0F;
// the handlers a slot can hold (bank 9 code addresses), and where their dispatch returns
const OBJ_UPDATE_SHOW = 0x4758, OBJ_UPDATE_HIDE = 0x475E, OBJ_UPDATE_RUN_CURVE = 0x4764, OBJ_UPDATE_DONE = 0x4781;
const OBJ_UPDATE_RUN_CURVE_TABLE = 0x4768, FINISH_OBJ_SLOT_UPDATE = 0x46E1;
// bank 9 tables
const OBJ_TEMPLATES = 0x41BC, GAME_SCORE_DISPLAY_OBJ_TEMPLATE = 0x41FC, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE = 0x420C;
const SERVE_INDICATOR_OBJ_TEMPLATES = 0x4298, WIN_LOSE_RESULT_OBJ_TEMPLATE = 0x4300, SERVE_INDICATOR_SIDE_OBJ_TEMPLATES = 0x4327;
const COURT_BANNER_OBJ_TEMPLATES = 0x4385, MOVE_CURVE_TABLE = 0x47AE, VRAM_TILESET = 0x488A;
const VRAM_GFX_PTR_TABLE = 0x616D, PLAYER1_SCORE_DIGIT_GFX = 0x6171, PLAYER2_SCORE_DIGIT_GFX = 0x6175, DEUCE_ADVANTAGE_TILES = 0x6BC0;
const SERVE_GFX_PTR_TABLE = 0x6C6E, OBJ_COLUMN8_ROWS2 = 0x7098, LOAD_ON_COURT_CHAR_GFX_TABLE = 0x40C1;
const PLAYER1_SERVE_INDICATOR_SPRITES = 0x7112, PLAYER2_SERVE_INDICATOR_SPRITES = 0x7129;
const PLAYER1_CHAR_ICON_SPRITES = 0x71A4, PLAYER2_CHAR_ICON_SPRITES = 0x71BB;
const VTILES0 = 0x8000, TILE_SIZE = 0x10;
// RAM
const CHAR_COURT_POS = 0xDF0A, CHAR_SCREEN_X = 0xDF53, CHAR_SCREEN_Y = 0xDF54, CHAR_SPRITE_SET_ID = 0xDF7E;
// bank-0 routines
const CLEAR_MEMORY16 = 0x03AF, COPY_MEMORY_FAST = 0x03F3, QUEUE_VRAM_COPY = 0x0480, QUEUE_SPRITE_TEMPLATE = 0x1E9D;
const PLAY_SOUND_MANAGED = 0x3024;

const u8 = v => v & 0xFF, u16 = v => v & 0xFFFF;
const rom = (P, a) => P.rom.u8(9, a);
const home = (P, addr, r) => romCall(P, 0, addr, r, 9);                  // a bank-0 routine, bank 9 mapped
const queueVRAMCopy = (P, r) => home(P, QUEUE_VRAM_COPY, r);             // c 16-byte blocks from hl to VRAM de
// ld hl, off / add hl, bc: a field of the slot bc (Z kept, H and C of the add)
function field(r, off) { const s = addHL(off, r.bc, r.f); r.hl = s.r; r.f = s.f; return r.hl; }
// ld_hl_indexed table after `add a` (a word table): hl at the entry, a = h, f of the index
function wordEntry(r, table) { const i = hlIndexed(table, add8(r.a, r.a).r); r.hl = i.hl; r.a = i.a; r.f = i.f; return r.hl; }
// add l / ld l, a / jr nc / inc h: hl += a (8 bits into l, a carry into h)
function addToL(r) {
  const s = add8(r.a, r.l); r.l = s.r; r.a = s.r; r.f = s.f;
  if (s.f & FC) { r.f = incFlags(r.h, r.f); r.h = u8(r.h + 1); }
}
// rst $00 (JumpTableDispatch 00:06C4) on the inline table at `table`: entry a; leaves hl = the target, a its low byte
function jumpTable(P, r, table) {
  r.hl = table; r.a = add8(r.a, r.a).r; addToL(r);
  const target = P.rom.u16(9, r.hl);
  r.a = target & 0xFF; r.hl = target;
  return target;
}

// ---- slot setup (obj_09) ----
// 09:45C4 SetObjPosition (d -> x, e -> y) / 09:45BC SetObjSpriteTemplate (de) / 09:45CC SetObjTileOffset /
// 09:45D2 SetObjSpriteAttr / 09:45EC SetObjMoveCurve / 09:45F2 SetObjDrawMode (d): fields of slot bc
export function setObjPosition(P, r) { P.bus.w8(field(r, X), r.d); r.hl = r.hl + 1; P.bus.w8(r.hl, r.e); }
export function setObjSpriteTemplate(P, r) { field(r, SPRITE_TEMPLATE); r.a = r.e; P.bus.w8(r.hl, r.e); r.hl = r.hl + 1; P.bus.w8(r.hl, r.d); }
const setByte = off => (P, r) => P.bus.w8(field(r, off), r.d);
export const setObjTileOffset = setByte(TILE), setObjSpriteAttr = setByte(OAM_ATTR);
export const setObjMoveCurve = setByte(CURVE), setObjDrawMode = setByte(ANCHOR);
// 09:45D8 SetObjUpdateRoutine: a new handler (de), from its first state and curve step
export function setObjUpdateRoutine(P, r) {
  const bus = P.bus;
  field(r, HANDLER); r.a = r.e; bus.w8(r.hl, r.e); r.hl = r.hl + 1; bus.w8(r.hl, r.d);
  bus.w8(field(r, STATE), 0);
  bus.w8(field(r, CURVE_STEP), 0);
}
// 09:45F8 UnusedToggleObjMoveCurveBits_1 / 09:4601 ..._2: flip curve bits 1 / 0-1 (nothing calls them)
const toggleCurveBits = bits => (P, r) => { field(r, CURVE); r.a = P.bus.u8(r.hl) ^ bits; r.f = r.a ? 0 : FZ; P.bus.w8(r.hl, r.a); };
// 09:4598 InitObjSlot: slot bc cleared, no handler (ObjUpdateRunCurve.done), the two-row column template, free ($FF)
export function initObjSlot(P, r) {
  const bc = r.bc;
  r.hl = bc; r.c = 1;
  home(P, CLEAR_MEMORY16, r);
  r.bc = bc;
  for (const [off, word] of [[HANDLER, OBJ_UPDATE_DONE], [SPRITE_TEMPLATE, OBJ_COLUMN8_ROWS2]]) {
    field(r, off); r.de = word; r.a = r.e; P.bus.w8(r.hl, r.e); r.hl = r.hl + 1; P.bus.w8(r.hl, r.d);
  }
  P.bus.w8(field(r, ID), 0xFF);
}
// 09:4555 InitAllObjSlots: slots 2-4 on OBJ palette 1 with their tile bases ($30, $20, $38)
export function initAllObjSlots(P, r) {
  r.a = 4; P.wramBank(4);                                                // wram_bank WRAM_ACTORS
  for (const [k, tile] of [[0, null], [1, null], [2, 0x30], [3, 0x20], [4, 0x38]]) {
    r.bc = OBJSLOT[k]; initObjSlot(P, r);
    if (tile === null) continue;
    r.d = 0x01; setObjSpriteAttr(P, r);
    r.d = tile; setObjTileOffset(P, r);
  }
}
// 09:460A LoadObjTemplate_09: record a (16 bytes) of the template table hl into the slot bc: id, position, sprite
// template, handler and curve, its sound (played now, 0 = none) and draw mode; curve offsets cleared, active
export function loadObjTemplate(P, r) {
  const bus = P.bus, table = r.hl;
  bus.w8(field(r, ID), r.a);
  let rec = r.a, f = r.f;
  for (let i = 0; i < 4; i++) { const s = addHL(rec, rec, f); rec = s.r; f = s.f; }   // h = 0, l = a; add hl, hl (x4)
  const t = addHL(rec, table, f); r.f = t.f;                                          // pop de; add hl, de
  r.de = table;
  for (const [off, set] of [[0, setObjPosition], [2, setObjSpriteTemplate], [4, setObjUpdateRoutine]]) {
    r.e = rom(P, t.r + off); r.d = rom(P, t.r + off + 1); r.a = r.d; set(P, r);
  }
  r.d = rom(P, t.r + 6); setObjMoveCurve(P, r);
  const sound = addHL(t.r, 0x000C, r.f); r.de = 0x000C; r.f = sound.f;
  r.a = rom(P, sound.r); r.hl = sound.r + 2; r.f = andFlags(r.a);
  if (r.a) home(P, PLAY_SOUND_MANAGED, r);
  r.d = rom(P, r.hl); setObjDrawMode(P, r);
  r.a = 0; r.f = FZ;
  field(r, CURVE_X); bus.w8(r.hl, 0); bus.w8(r.hl + 1, 0); r.hl = r.hl + 2;
  field(r, FLAGS); bus.w8(r.hl, bus.u8(r.hl) | 0x80);
}
// 09:4658 StartObjExitAnim: an active slot leaves by its record's exit handler and curve (+8, +10). The record
// offset is computed in 8 bits (id * 16 + 8), so records from 16 on wrap round to the table's start.
export function startObjExitAnim(P, r) {
  const bus = P.bus;
  let s = add8(FLAGS, r.c); r.a = s.r; r.f = s.f; r.e = s.r; r.d = r.b;
  const flags = bus.u8(r.de);
  r.a = flags; r.f = bitFlags(flags, 7, r.f);
  if (!(flags & 0x80)) return;
  r.a = flags & 0x7F; bus.w8(r.de, r.a);
  s = add8(ID, r.c); r.a = s.r; r.e = s.r; r.d = r.b;
  let a = bus.u8(r.de);
  for (let i = 0; i < 4; i++) a = add8(a, a).r;
  r.a = add8(a, 0x08).r; addToL(r);
  const t = r.hl;
  r.e = rom(P, t); r.d = rom(P, t + 1); r.a = r.d; setObjUpdateRoutine(P, r);
  r.hl = t + 2; r.d = rom(P, r.hl); setObjMoveCurve(P, r);
}
// 09:4683 ClearAllObjSlots: every slot free
export function clearAllObjSlots(P, r) { r.a = 0xFF; for (const bc of OBJSLOT) P.bus.w8(bc + ID, 0xFF); }

// ---- the per-frame update ----
// 09:4695 UpdateAllObjSprites: each slot in turn
export function updateAllObjSprites(P, r) { for (const bc of OBJSLOT) { r.bc = bc; processObjSlot(P, r); } }
// 09:46B5 ProcessObjSlot: a used slot runs its handler on a working copy (wObjSlotWork), is drawn (09:46D3 DrawObjSlot),
// steps its curve counter and is copied back (09:46E1 FinishObjSlotUpdate)
export function processObjSlot(P, r) {
  const bus = P.bus, W = OBJSLOT_WORK, slot = r.bc;
  r.a = bus.u8(field(r, ID)); r.f = sub8(r.a, 0xFF).f;
  if (r.a === 0xFF) return;
  r.hl = slot; r.de = W; r.c = 1;
  home(P, COPY_MEMORY_FAST, r);
  r.a = bus.u8(W + HANDLER); r.h = bus.u8(W + HANDLER + 1); r.l = r.a;     // jp hl
  const handler = r.hl;
  switch (handler) {
    case OBJ_UPDATE_SHOW: objUpdateShow(P, r); break;
    case OBJ_UPDATE_HIDE: objUpdateHide(P, r); break;
    case OBJ_UPDATE_RUN_CURVE: objUpdateRunCurve(P, r); break;
    case OBJ_UPDATE_DONE: break;
    default: throw new Error(`object slot $${slot.toString(16)}: handler 09:${handler.toString(16)}`);
  }
  // DrawObjSlot (returning into FinishObjSlotUpdate)
  r.hl = FINISH_OBJ_SLOT_UPDATE;
  r.a = bus.u8(W + ANCHOR); r.f = andFlags(r.a);
  if (r.a === 0) drawObjAtOffset(P, r);
  else {
    r.f = sub8(r.a, 1).f;
    if (r.a !== 1) throw new Error(`object slot $${slot.toString(16)}: draw mode ${r.a}`);   // the ROM runs on into the slot's RAM
    drawObjOnServer(P, r);
  }
  // FinishObjSlotUpdate
  r.hl = W + CURVE_STEP; r.a = bus.u8(r.hl); r.f = incFlags(r.a, r.f); bus.w8(r.hl, r.a + 1);
  r.de = slot; r.hl = W; r.c = 1;
  home(P, COPY_MEMORY_FAST, r);
}
// FinishObjSlotUpdate.drawAtOffset (09:46F0): the template at the stored position plus the curve offset
function drawObjAtOffset(P, r) {
  const bus = P.bus, W = OBJSLOT_WORK;
  r.hl = W + FLAGS; r.f = bitFlags(bus.u8(r.hl), 0, r.f);
  if (!(bus.u8(r.hl) & 1)) return;
  r.hl = W + X; r.d = add8(bus.u8(W + CURVE_X), bus.u8(W + X)).r;
  r.hl = W + Y; const y = add8(bus.u8(W + CURVE_Y), bus.u8(W + Y)); r.e = y.r; r.f = y.f;
  queueObjTemplate(P, r);
}
// FinishObjSlotUpdate.drawOnServer (09:4718): the same, relative to the serving character on screen
function drawObjOnServer(P, r) {
  const bus = P.bus, W = OBJSLOT_WORK;
  r.hl = W + FLAGS; r.f = bitFlags(bus.u8(r.hl), 0, r.f);
  if (!(bus.u8(r.hl) & 1)) return;
  romCall(P, 8, 0x46E7, r);                                               // farcall FindServerCharBank -> b
  r.a = r.b; P.wramBank(r.b);
  r.d = bus.u8(CHAR_SCREEN_X); r.e = bus.u8(CHAR_SCREEN_Y); r.a = r.e;
  r.a = 4; P.wramBank(4);                                                // wram_bank WRAM_ACTORS
  r.hl = W + X; r.d = add8(add8(bus.u8(W + CURVE_X), bus.u8(W + X)).r, r.d).r;
  r.hl = W + Y; const y = add8(add8(bus.u8(W + CURVE_Y), bus.u8(W + Y)).r, r.e); r.e = y.r; r.f = y.f;
  queueObjTemplate(P, r);
}
// the slot's sprite template (hl) at d, e with its attributes (b) and tile base (c): QueueSpriteTemplate
function queueObjTemplate(P, r) {
  const bus = P.bus, W = OBJSLOT_WORK;
  r.b = bus.u8(W + OAM_ATTR); r.c = bus.u8(W + TILE);
  r.a = bus.u8(W + SPRITE_TEMPLATE); r.h = bus.u8(W + SPRITE_TEMPLATE + 1); r.l = r.a;
  home(P, QUEUE_SPRITE_TEMPLATE, r);
}
// 09:4758 ObjUpdateShow / 09:475E ObjUpdateHide
function objUpdateShow(P, r) { r.hl = OBJSLOT_WORK + FLAGS; P.bus.w8(r.hl, P.bus.u8(r.hl) | 1); }
function objUpdateHide(P, r) { r.hl = OBJSLOT_WORK + FLAGS; P.bus.w8(r.hl, P.bus.u8(r.hl) & ~1); }
// 09:4764 ObjUpdateRunCurve: shown while the curve runs (.stepCurve); at its end the state moves on (state 1: .done)
function objUpdateRunCurve(P, r) {
  const W = OBJSLOT_WORK;
  r.a = P.bus.u8(W + STATE);
  if (r.a > 1) throw new Error(`ObjUpdateRunCurve: state ${r.a} past its jump table`);
  if (jumpTable(P, r, OBJ_UPDATE_RUN_CURVE_TABLE) === OBJ_UPDATE_DONE) return;
  objUpdateShow(P, r);
  if (getNextMoveCurveValue(P, r)) return;
  r.hl = W + STATE; r.f = incFlags(P.bus.u8(r.hl), r.f); P.bus.w8(r.hl, P.bus.u8(r.hl) + 1);
}
// 09:4782 GetNextMoveCurveValue: the curve's value at the step into the X offset (a = 1, nz); $80 holds the
// object where it is, $81 also frees the slot (both a = 0, z)
export function getNextMoveCurveValue(P, r) {
  const bus = P.bus, W = OBJSLOT_WORK;
  r.a = bus.u8(W + CURVE); wordEntry(r, MOVE_CURVE_TABLE);
  r.a = rom(P, r.hl); r.h = rom(P, r.hl + 1); r.l = r.a;
  r.a = bus.u8(W + CURVE_STEP); addToL(r);
  r.a = rom(P, r.hl);
  if (r.a === 0x81) bus.w8(W + ID, 0xFF);
  if (r.a === 0x80 || r.a === 0x81) { r.a = 0; r.f = FZ; return false; }
  bus.w8(W + CURVE_X, r.a);
  r.a = 1; r.f = 0;                                                      // xor a / inc a
  return true;
}

// ---- the objects the match shows (obj_09, indicators_09) ----
// 09:7103 GetPlayer1ServeIndicatorSprites / 09:711A GetPlayer2... / 09:7195 GetPlayer1CharIconSprites / 09:71AC
// GetPlayer2...: the sprite template for the number of characters on court -> de
const getSprites = table => (P, r) => { r.a = P.V.onCourtCharCountMinus1; wordEntry(r, table); r.a = rom(P, r.hl); r.hl = r.hl + 1; r.d = rom(P, r.hl); r.e = r.a; };
const getPlayer1ServeIndicatorSprites = getSprites(PLAYER1_SERVE_INDICATOR_SPRITES), getPlayer2ServeIndicatorSprites = getSprites(PLAYER2_SERVE_INDICATOR_SPRITES);
const getPlayer1CharIconSprites = getSprites(PLAYER1_CHAR_ICON_SPRITES), getPlayer2CharIconSprites = getSprites(PLAYER2_CHAR_ICON_SPRITES);
// object a of a template table into a slot / a slot's exit
const spawn = (P, r, a, table, k) => { r.a = a; r.hl = table; r.bc = OBJSLOT[k]; loadObjTemplate(P, r); };
const dismiss = (P, r, table, k) => { r.hl = table; r.bc = OBJSLOT[k]; startObjExitAnim(P, r); };
// 09:4367 ShowCourtBanner: banner a (the other slots cleared, its tiles queued), falling into 09:4371
// SpawnCourtBannerObj: its object in slot 3 (push af ... pop af around the calls: a and f as given)
export function showCourtBanner(P, r) {
  const { a, f } = r;
  clearAllObjSlots(P, r); r.a = a; r.f = f;
  loadTilesetGfx(P, r); r.a = a; r.f = f;
  spawnCourtBannerObj(P, r);
}
export function spawnCourtBannerObj(P, r) { spawn(P, r, r.a, COURT_BANNER_OBJ_TEMPLATES, 3); }
// 09:437B HideCourtBanner
export function hideCourtBanner(P, r) { dismiss(P, r, COURT_BANNER_OBJ_TEMPLATES, 3); }
// 09:4310 SpawnServeIndicatorSideObj / 09:431D DismissServeIndicatorSideObj: the server's side marker (slot 4)
export function spawnServeIndicatorSideObj(P, r) { spawn(P, r, P.V.servingCharCourtPos, SERVE_INDICATOR_SIDE_OBJ_TEMPLATES, 4); }
export function dismissServeIndicatorSideObj(P, r) { dismiss(P, r, SERVE_INDICATOR_SIDE_OBJ_TEMPLATES, 4); }
// 09:4242 SpawnServeIndicatorObjs: the side marker and both players' serve indicators (slots 0, 1) by the
// server's court position; the doubles scoreboard has one indicator, moved down for the near end
export function spawnServeIndicatorObjs(P, r) {
  const V = P.V, bus = P.bus;
  clearAllObjSlots(P, r);
  spawnServeIndicatorSideObj(P, r);
  spawn(P, r, V.servingCharCourtPos, SERVE_INDICATOR_OBJ_TEMPLATES, 0);
  getPlayer1ServeIndicatorSprites(P, r); setObjSpriteTemplate(P, r);
  r.a = V.scoreboardLayout; r.f = sub8(r.a, 3).f;
  if (r.a === 3) {
    r.a = V.servingCharCourtPos & 2; r.f = andFlags(r.a);
    if (r.a) return;
    r.hl = OBJSLOT[0] + Y; const y = add8(bus.u8(r.hl), 0x10); r.a = y.r; r.f = y.f; bus.w8(r.hl, y.r);
    return;
  }
  spawn(P, r, V.servingCharCourtPos, SERVE_INDICATOR_OBJ_TEMPLATES, 1);
  getPlayer2ServeIndicatorSprites(P, r); setObjSpriteTemplate(P, r);
}
// 09:4282 DismissServeIndicatorObjs
export function dismissServeIndicatorObjs(P, r) {
  dismissServeIndicatorSideObj(P, r);
  dismiss(P, r, SERVE_INDICATOR_OBJ_TEMPLATES, 0);
  dismiss(P, r, SERVE_INDICATOR_OBJ_TEMPLATES, 1);
}
// 09:412A SpawnGameScoreDisplayObjs: the two players' icons (by who serves and from which end) and the score
// panel; the doubles scoreboard has one combined object
export function spawnGameScoreDisplayObjs(P, r) {
  const V = P.V;
  r.a = 4; P.wramBank(4);                                                // wram_bank WRAM_ACTORS
  clearAllObjSlots(P, r);
  r.a = V.scoreboardLayout; r.f = sub8(r.a, 3).f;
  if (r.a === 3) { spawn(P, r, 0, GAME_SCORE_DISPLAY_OBJ_TEMPLATE, 0); return; }
  r.b = ~V.currentServingPlayer & 1;
  P.wramBank(4);                                                         // wram_bank WRAM_CHAR0
  r.b |= P.bus.u8(CHAR_COURT_POS) & 2; r.a = r.b; r.f = r.b ? 0 : FZ;     // and $02 / or b
  r.a = 4; P.wramBank(4);
  const side = r.b;
  spawn(P, r, side, OBJ_TEMPLATES, 0);
  getPlayer1CharIconSprites(P, r); setObjSpriteTemplate(P, r);
  r.a = side ^ 3; r.f = r.a ? 0 : FZ;                                     // pop bc / ld a, b / xor $03
  spawn(P, r, side ^ 3, OBJ_TEMPLATES, 1);
  getPlayer2CharIconSprites(P, r); setObjSpriteTemplate(P, r);
  spawn(P, r, 0, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE, 2);
}
// 09:4190 DismissGameScoreDisplayObjs
export function dismissGameScoreDisplayObjs(P, r) {
  r.a = P.V.drillIsPracticeLesson; r.f = andFlags(r.a);
  if (r.a) { dismiss(P, r, GAME_SCORE_DISPLAY_OBJ_TEMPLATE, 0); return; }
  dismiss(P, r, OBJ_TEMPLATES, 0);
  dismiss(P, r, OBJ_TEMPLATES, 1);
  dismiss(P, r, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE, 2);
}
// 09:422C SpawnGameResultObj / 09:4238 DismissGameResultObj
export function spawnGameResultObj(P, r) { spawn(P, r, 1, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE, 2); }
export function dismissGameResultObj(P, r) { dismiss(P, r, SPAWN_GAME_SCORE_DISPLAY_OBJ_TEMPLATE, 2); }
// 09:42D8 SpawnWinLoseResultObj: the winner's icon (a: $01 player 1, $FF player 2) / 09:42F6 DismissWinLoseResultObj
export function spawnWinLoseResultObj(P, r) {
  const winner = r.a;
  spawn(P, r, 0, WIN_LOSE_RESULT_OBJ_TEMPLATE, 0);
  const s = add8(winner, winner); r.a = s.r; r.f = s.f;                   // pop af / add a
  (winner & 0x80 ? getPlayer2CharIconSprites : getPlayer1CharIconSprites)(P, r);
  setObjSpriteTemplate(P, r);
}
export function dismissWinLoseResultObj(P, r) { dismiss(P, r, WIN_LOSE_RESULT_OBJ_TEMPLATE, 0); }

// ---- the score digits and the graphics the objects show ----
// 09:4036 UpdatePointDigitsDisplay: each player's points digit (40 drawn as "A" against a 40 is AD: 5); in a
// tiebreak the plain count (7 against 7: 8)
export function updatePointDigitsDisplay(P, r) {
  const V = P.V;
  r.a = V.tiebreakerIndicator; r.f = andFlags(r.a);
  const [top, shown, set] = r.a ? [7, 8, 1] : [4, 5, 0];
  for (const [other, own, load] of [[V.player2PointsWon, V.player1PointsWon, loadPlayer1PointsDigitGfx], [V.player1PointsWon, V.player2PointsWon, loadPlayer2PointsDigitGfx]]) {
    r.f = sub8(other, top).f; r.a = other === top ? shown : own;
    r.b = set; load(P, r);
  }
}
// 09:4082 GetPointScoreForDisplay: the points, the server's first -> d, e; a = wDeuceIndicator
export function getPointScoreForDisplay(P, r) {
  const V = P.V;
  r.d = V.player1PointsWon; r.e = V.player2PointsWon;
  r.a = V.currentServingPlayer & 1; r.f = andFlags(r.a);
  if (r.a) { r.a = r.d; r.d = r.e; r.e = r.a; }
  r.a = V.deuceIndicator;
}
// 09:4098 UpdateScorePanelDisplay: the score panel's digits, or DEUCE
export function updateScorePanelDisplay(P, r) {
  getPointScoreForDisplay(P, r);
  r.f = andFlags(r.a);
  if (r.a) { loadDeuceAdvantageGfx(P, r); return; }
  const de = r.de;
  r.a = r.b = P.V.scoreDisplayIsTiebreak; r.a = r.d; loadPlayer1ScoreDigitGfx(P, r);
  r.de = de; r.a = r.b = P.V.scoreDisplayIsTiebreak; r.a = r.e; loadPlayer2ScoreDigitGfx(P, r);
}
// 09:4873 LoadTilesetGfx: banner a's tiles (VramTileset_09: source, block count) to tile $20
export function loadTilesetGfx(P, r) {
  r.a = add8(r.a, r.a).r; wordEntry(r, VRAM_TILESET);
  r.e = rom(P, r.hl); r.d = rom(P, r.hl + 1); r.a = r.d; r.c = rom(P, r.hl + 2);
  r.hl = r.de; r.de = VTILES0 + 0x20 * TILE_SIZE;
  queueVRAMCopy(P, r);
}
// 09:6154 GetGfxSourcePtr: entry b of the word table hl, plus a * $40 (a sign-extended: sra b / rr c twice), in hl
export function getGfxSourcePtr(P, r) {
  const { a, f } = r;
  r.a = add8(r.b, r.b).r; addToL(r);
  r.a = rom(P, r.hl); r.h = rom(P, r.hl + 1); r.l = r.a;
  r.a = a; r.f = f; r.b = a; r.c = 0;
  for (let i = 0; i < 2; i++) {                                           // sra b / rr c
    const out = r.c & 1, b = r.b;
    r.b = (b >> 1) | (b & 0x80); r.c = (r.c >> 1) | ((b & 1) << 7);
    r.f = (r.c ? 0 : FZ) | (out ? FC : 0);
  }
  const s = addHL(r.hl, r.bc, r.f); r.hl = s.r; r.f = s.f;
}
// 09:6100 LoadScoreDigitGfx (to de) / 09:610C LoadPlayer1PointsDigitGfx (tile $78) / 09:611B LoadPlayer2PointsDigitGfx
// (tile $7C) / 09:612A LoadPlayer1ScoreDigitGfx (tile $30) / 09:6139 LoadPlayer2ScoreDigitGfx (tile $34): digit a
// of set b, four blocks
const digitGfx = (table, dest) => (P, r) => {
  r.hl = table; getGfxSourcePtr(P, r);
  if (dest !== null) r.de = dest;
  r.c = 4; queueVRAMCopy(P, r);
};
export const loadScoreDigitGfx = digitGfx(VRAM_GFX_PTR_TABLE, null);
export const loadPlayer1PointsDigitGfx = digitGfx(VRAM_GFX_PTR_TABLE, VTILES0 + 0x78 * TILE_SIZE);
export const loadPlayer2PointsDigitGfx = digitGfx(VRAM_GFX_PTR_TABLE, VTILES0 + 0x7C * TILE_SIZE);
export const loadPlayer1ScoreDigitGfx = digitGfx(PLAYER1_SCORE_DIGIT_GFX, VTILES0 + 0x30 * TILE_SIZE);
export const loadPlayer2ScoreDigitGfx = digitGfx(PLAYER2_SCORE_DIGIT_GFX, VTILES0 + 0x34 * TILE_SIZE);
// 09:6148 LoadDeuceAdvantageGfx: the DEUCE panel over both score digits (8 blocks to tile $30)
export function loadDeuceAdvantageGfx(P, r) {
  r.hl = DEUCE_ADVANTAGE_TILES; r.de = VTILES0 + 0x30 * TILE_SIZE; r.c = (0x6C40 - DEUCE_ADVANTAGE_TILES) / 16;
  queueVRAMCopy(P, r);
}
// 09:6C40 LoadServeGfx: the server's serve graphic (by player, by first or second serve and the server's end) to tile $38
export function loadServeGfx(P, r) {
  const V = P.V;
  r.a = V.currentServingPlayer; wordEntry(r, SERVE_GFX_PTR_TABLE);
  r.a = rom(P, r.hl); r.h = rom(P, r.hl + 1); r.l = r.a;
  r.b = V.serveFaultFlag & 1;
  let s = { r: (V.servingCharCourtPos & 2) | r.b, f: 0 };
  for (let i = 0; i < 6; i++) s = add8(s.r, s.r);                         // add a (x6): * 64
  r.a = s.r; addToL(r);
  r.de = VTILES0 + 0x38 * TILE_SIZE; r.c = 4;
  queueVRAMCopy(P, r);
}
// 09:40B5 LoadOnCourtCharacterGfx: each on-court character's sprite tiles (farcalls of 18:5AB9 LoadOnCourtCharTilesA
// and 18:5ACE LoadOnCourtCharTilesB by wCharSpriteSetId) into its block of OBJ tiles, after the shared block at tile
// $14 (set $FF); by the number on court (the jump table falls through): character 2 ($10), 3 ($18), 1 ($08), then 0
// ($00); bank 4 mapped after
export function loadOnCourtCharacterGfx(P, r) {
  const tiles = (fn, a, tile) => { r.a = a; r.de = VTILES0 + tile * TILE_SIZE; romCall(P, 0x18, fn, r); };
  const A = 0x5AB9, B = 0x5ACE;
  tiles(B, 0xFF, 0x14);
  const n = P.V.onCourtCharCountMinus1;
  if (n > 3) throw new Error(`LoadOnCourtCharacterGfx: ${n + 1} characters, past its jump table`);
  r.a = n; jumpTable(P, r, LOAD_ON_COURT_CHAR_GFX_TABLE);
  const chain = [[], [[5, 0x08]], [[7, 0x18], [5, 0x08]], [[6, 0x10], [7, 0x18], [5, 0x08]]][n];
  for (const [bank, tile] of [...chain, [4, 0x00]]) {
    r.a = bank; P.wramBank(bank);
    tiles(A, P.bus.u8(CHAR_SPRITE_SET_ID), tile);
    tiles(B, P.bus.u8(CHAR_SPRITE_SET_ID), tile + 4);
  }
}

// ---- entry points for the engine (E.ext) and the match setup: the routine on the CPU's registers, the
// arguments given ----
const onCpu = (fn, args = {}) => P => fn(P, new Regs({ ...regsOf(P.cpu), ...args }));
export const run = (P, fn, args = {}) => onCpu(fn, args)(P);

export const HOOKS = [
  [9, 0x40B5, threaded(loadOnCourtCharacterGfx)],
  [9, 0x4310, threaded(spawnServeIndicatorSideObj)],
  [9, 0x431D, threaded(dismissServeIndicatorSideObj)],
  [9, 0x4371, threaded(spawnCourtBannerObj)],
  [9, 0x45F8, threaded(toggleCurveBits(0x02))],
  [9, 0x4601, threaded(toggleCurveBits(0x03))],
  [9, 0x4758, threaded(objUpdateShow)],
  [9, 0x475E, threaded(objUpdateHide)],
  [9, 0x4764, threaded(objUpdateRunCurve)],
  [9, 0x4782, threaded(getNextMoveCurveValue)],
  [9, 0x6154, threaded(getGfxSourcePtr)],
  [9, 0x4555, threaded(initAllObjSlots)],
  [9, 0x4598, threaded(initObjSlot)],
  [9, 0x45BC, threaded(setObjSpriteTemplate)],
  [9, 0x45C4, threaded(setObjPosition)],
  [9, 0x45CC, threaded(setObjTileOffset)],
  [9, 0x45D2, threaded(setObjSpriteAttr)],
  [9, 0x45D8, threaded(setObjUpdateRoutine)],
  [9, 0x45EC, threaded(setObjMoveCurve)],
  [9, 0x45F2, threaded(setObjDrawMode)],
  [9, 0x460A, threaded(loadObjTemplate)],
  [9, 0x4658, threaded(startObjExitAnim)],
  [9, 0x4683, threaded(clearAllObjSlots)],
  [9, 0x4695, threaded(updateAllObjSprites)],
  [9, 0x46B5, threaded(processObjSlot)],
  [9, 0x4367, threaded(showCourtBanner)],
  [9, 0x437B, threaded(hideCourtBanner)],
  [9, 0x4242, threaded(spawnServeIndicatorObjs)],
  [9, 0x4282, threaded(dismissServeIndicatorObjs)],
  [9, 0x412A, threaded(spawnGameScoreDisplayObjs)],
  [9, 0x4190, threaded(dismissGameScoreDisplayObjs)],
  [9, 0x422C, threaded(spawnGameResultObj)],
  [9, 0x4238, threaded(dismissGameResultObj)],
  [9, 0x42D8, threaded(spawnWinLoseResultObj)],
  [9, 0x42F6, threaded(dismissWinLoseResultObj)],
  [9, 0x7103, threaded(getPlayer1ServeIndicatorSprites)],
  [9, 0x711A, threaded(getPlayer2ServeIndicatorSprites)],
  [9, 0x7195, threaded(getPlayer1CharIconSprites)],
  [9, 0x71AC, threaded(getPlayer2CharIconSprites)],
  [9, 0x4036, threaded(updatePointDigitsDisplay)],
  [9, 0x4082, threaded(getPointScoreForDisplay)],
  [9, 0x4098, threaded(updateScorePanelDisplay)],
  [9, 0x4873, threaded(loadTilesetGfx)],
  [9, 0x6100, threaded(loadScoreDigitGfx)],
  [9, 0x610C, threaded(loadPlayer1PointsDigitGfx)],
  [9, 0x611B, threaded(loadPlayer2PointsDigitGfx)],
  [9, 0x612A, threaded(loadPlayer1ScoreDigitGfx)],
  [9, 0x6139, threaded(loadPlayer2ScoreDigitGfx)],
  [9, 0x6148, threaded(loadDeuceAdvantageGfx)],
  [9, 0x6C40, threaded(loadServeGfx)],
];

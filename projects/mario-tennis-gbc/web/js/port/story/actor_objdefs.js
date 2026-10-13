// Wandering, the last actor-script opcodes, and drawing (bank 4, $48C3-$4BBA): the random reachable point an
// as_rand_box picks, as_wait_move2 and as_flag, the screen origin of the actors (camera and screen shake), the
// DrawActors frame task, and loading an actor's object definition (its sprite frames, animations, palette).
// Port of actor_objdefs_04.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm),
// whose routine names these are.
// Tests: web/tests/port/routines_story.mjs; lockstep on out/engine/rec2.mtrec and out/port/story1.mtrec.
import {
  FZ, FN, FH, FC, WRAM_ACTORS, BANK_ACTORS, wActors, ACTOR_SIZE, NUM_ACTORS, ACTORF_FLAGS, ACTORF_WAIT, ACTORF_X,
  ACTORF_Y, ACTORF_TARGET_X, ACTORF_LEADER, ACTORF_MODE, ACTORF_OBJECT, ACTORF_GFX_BANK, ACTORF_FRAME_TABLE,
  ACTORF_ANIM_TABLE, ACTORF_DRAW_DELAY, ACTORF_DRAWN_FACING, ACTORF_FACING_COUNT, ACTORF_OAM_ATTR,
  ACTORF_SHADOW_TABLE, ACTORFLAG_MOVING, ACTORFLAG_BLOCKED, ACTOR_MODE_DRAWN, FLAG_HIDE_OVERWORLD_ACTORS,
  FLAG_ENDING_CREDITS_RUNNING, a8, a16, w8, w16, setBits, actorPtr, hook, testFlag, randomSeed, decFlags,
} from "./common.js";
import { farReadByte, farReadWord, farCopyBytes, loadPalettesMasterOnly } from "../home/palettes.js";
import { copyDataFromBank } from "../home/decompress.js";
import { angleFromVectorCoarse, vectorFromLengthAndAngleRaw } from "../home/math.js";
import { setActorAnimation } from "./scripted.js";
import { setActorMoveTarget, projectPointFromActor, offsetPointByPolarVector } from "./player.js";
import { testPointInBox, isTerrainBlockedAtPoint, drawAndAnimateActor } from "./actor_queries.js";

const BANK = BANK_ACTORS;
const ObjectIdList_04 = 0x4F75;          // per OBJ_* id: (slot, bank) of its object definition
const BitMaskTable_04 = 0x4A1F;          // $01 $02 ... $80
const OBJDEF_SIZE = 0x10;                // wActorObjDef: [attr, facings, ?, ?, frames(2), anims(2), palette(2), shadow(2), ...]
const OBJDEF_OWN_PALETTE = 0x63;         // an attribute byte of $63: the object brings its own palette (into OBJ palette 2)
const OWN_PALETTE_ATTR = 0x02, OWN_PALETTE_FIRST = 8 + 2, OWN_PALETTE_COUNT = 1;
const ANIM_STILL = 0x00, CHARANIM_IDLE = 0x01;
const PROBE_LENGTH = 0x0100, PROBE_WIDTH = 0x00E0, PROBE_SPREAD = 0x20;
const SETTLE_WAIT = 0x28, BLOCKED_WAIT = 0x0A;
const SetCharAnimation = 0x69EA, BANK_MATCH = 0x08;
// the character struct of the WRAM bank mapped (WRAM 4-7 hold one each): SetupCharSpriteFromObjectDef fills it
const wCharObjectDefId = 0xDF21, wCharObjectBank = 0xDF22, wCharFrameTablePtr = 0xDF24, wCharAnimTablePtr = 0xDF28;
const wCharFacingOctant = 0xDF32, wCharSpriteAttr = 0xDF37, wCharShadowTablePtr = 0xDF38, wCharGfxBank = 0xDF3A;

const field = (P, off) => { const a = actorPtr(P); return (a & 0xFF00) | ((a + off) & 0xFF); };
const scriptBank = P => P.bus.u8(P.A.actorScriptBank);

// TryPickRandomReachableTarget (04:48C3): one try for a wandering actor (hActorPtr): a random direction (the seed's
// low byte, in steps of 4), the point a tile that way; it must lie in the box (wActorRandBoxHalfWidth/Depth) round
// home (ACTORF_LEADER: X tile, Y tile) and have free terrain at $E0 ahead, and $20 to either side. Then it walks
// there. Returns a = 1 for a pick, 0 for none, and the registers it leaves.
export function tryPickRandomReachableTarget(P) {
  const { bus } = P, actor = actorPtr(P);
  const angle = randomSeed(P) & 0xFC;
  bus.w8(P.A.actorProbeAngle, angle);
  const point = projectPointFromActor(P, actor, PROBE_LENGTH, angle);
  const px = point.hl, py = point.de, home = a16(P, actor, ACTORF_LEADER);
  const fail = { a: 0, f: FZ, de: py, hl: px };
  const box = testPointInBox(P, home, px >> 8, py >> 8, bus.u8(P.A.actorRandBoxHalfWidth), bus.u8(P.A.actorRandBoxHalfDepth));
  if (box.a) return fail;
  for (const turn of [0, PROBE_SPREAD, (-PROBE_SPREAD) & 0xFF]) {
    const probe = offsetPointByPolarVector(P, px, py, (bus.u8(P.A.actorProbeAngle) + turn) & 0xFF, PROBE_WIDTH);
    if (isTerrainBlockedAtPoint(P, probe.hl, probe.de).a) return fail;
  }
  const me = actorPtr(P);
  setActorMoveTarget(P, me, px, py);
  setBits(P, me + ACTORF_FLAGS, ACTORFLAG_MOVING);
  return { a: 1, f: FZ, de: px, hl: me + ACTORF_FLAGS };
}

// ActorScriptOp_WaitMove2 (04:4949), as_wait_move2: once the walk is over, wait $28 frames and go on; if it is
// blocked (by the player), wait $0A and go on; else stay. Yields.
export function actorScriptOpWaitMove2(P, de) {
  const { bus } = P;
  let hl = field(P, ACTORF_FLAGS);
  if (!(bus.u8(hl) & ACTORFLAG_MOVING)) {
    hl = field(P, ACTORF_WAIT); bus.w8(hl, SETTLE_WAIT); de = (de + 1) & 0xFFFF;
  } else if (bus.u8(hl) & ACTORFLAG_BLOCKED) {
    hl = field(P, ACTORF_WAIT); bus.w8(hl, BLOCKED_WAIT); de = (de + 1) & 0xFFFF;
  }
  return { a: 0, f: FZ, de, hl };
}

// Unused_04_ActorScriptOpMoveVector (04:497B): an opcode no table names. Its target is (w2, w1) + the vector of
// the following byte's length toward the actor's own position; the byte is read in the bank mapped (not the
// script's), and it sets bit 7 of the byte 10 past its operands (in ROM: an MBC write) and returns de = the new
// target Y. Nothing calls it.
export function unusedActorScriptOpMoveVector(P, de) {
  const { bus } = P, bank = scriptBank(P), at = (de + 1) & 0xFFFF;
  const w1 = farReadWord(P, bank, at), w2 = farReadWord(P, bank, at + 2);
  const len = farReadByte(P, P.V.romBank, at + 4);
  const actor = actorPtr(P);
  const angle = angleFromVectorCoarse(P, a16(P, actor, ACTORF_Y), a16(P, actor, ACTORF_X)).a;
  const v = vectorFromLengthAndAngleRaw(P, len, angle);
  const tx = (v.hl + w2) & 0xFFFF, ty = (w1 + v.de) & 0xFFFF;
  const t = field(P, ACTORF_TARGET_X);
  bus.w16(t, tx); bus.w16(t + 2, ty);
  const hl = (at + 10) & 0xFFFF;
  bus.w8(hl, bus.u8(hl) | ACTORFLAG_MOVING);
  return { a: 1, bc: (at + 5) & 0xFFFF, de: ty, hl };
}

// ActorScriptOp_Flag (04:49DE), as_flag mode, off, bit: set (mode 1) or clear bit `bit` of the actor's field off.
export function actorScriptOpFlag(P, actor, de) {
  const { bus } = P, bank = scriptBank(P);
  const mode = farReadByte(P, bank, (de + 1) & 0xFFFF), off = farReadByte(P, bank, (de + 2) & 0xFFFF);
  const bit = farReadByte(P, bank, (de + 3) & 0xFFFF);
  const mask = P.rom.u8(BANK, (BitMaskTable_04 + bit) & 0xFFFF);
  const a = actorPtr(P), hl = (a & 0xFF00) | ((off + a) & 0xFF);
  const v = mode === 1 ? bus.u8(hl) | mask : ~mask & bus.u8(hl);
  bus.w8(hl, v);
  return { a: 1, de: (de + 4) & 0xFFFF, hl, f: (v & 0xFF ? 0 : FZ) | (mode === 1 ? 0 : FH) };
}

// ComputeSpriteScrollOffset (04:4A27): the screen position of world (0, 0) for the actors' sprites, in 1/256
// tile: minus the camera and the screen shake (in pixels, << 5); during the ending credits the raster scroll's
// start line is added to the camera's Y. Into wActorScreenOriginX/Y. Returns the registers it leaves.
export function computeSpriteScrollOffset(P) {
  const { bus, V } = P;
  const shake = off => ((off << 24 >> 24) << 5);
  const ox = (-(V.cameraX + shake(V.screenShakeOffsetX))) & 0xFFFF;
  bus.w16(P.A.actorScreenOriginX, ox);
  let de = V.cameraY;
  if (testFlag(P, FLAG_ENDING_CREDITS_RUNNING)) de = (bus.u16(P.A.rasterScrollStartLY) + de) & 0xFFFF;
  const oy = (-(de + shake(V.screenShakeOffsetY))) & 0xFFFF;
  bus.w16(P.A.actorScreenOriginY, oy);
  return { a: oy & 0xFF, bc: oy, de, hl: P.A.actorScreenOriginY + 1 };
}

// DrawActors (04:4A82), a frame task (unless the actors are hidden): each live actor in mode 2 is drawn and
// animated, after its spawn delay (ACTORF_DRAW_DELAY) has run out. Returns the registers it leaves.
export function drawActors(P) {
  const { bus } = P;
  if (testFlag(P, FLAG_HIDE_OVERWORLD_ACTORS)) return { f: FH };
  P.wramBank(WRAM_ACTORS);
  const de = computeSpriteScrollOffset(P).de;
  let a = 0;
  for (let n = 0, actor = wActors; n < NUM_ACTORS; n++, actor += ACTOR_SIZE) {
    a = bus.u8(actor + 1);
    if (!a) continue;
    const delayAt = actor + ACTORF_DRAW_DELAY;
    a = bus.u8(delayAt);
    if (a) { bus.w8(delayAt, a - 1); continue; }
    bus.w8(P.A.actorScriptBank, bus.u8(actor + ACTORF_GFX_BANK));
    a = bus.u8(actor + ACTORF_MODE);
    if (a === ACTOR_MODE_DRAWN) a = drawAndAnimateActor(P, actor).a ?? a;
  }
  return { a, bc: wActors + NUM_ACTORS * ACTOR_SIZE, d: de >> 8, e: 0, hl: wActors + NUM_ACTORS * ACTOR_SIZE, f: FZ | FN };
}

// LoadActorObjectDefIfValid (04:4AC3) / LoadActorObjectDef (04:4AC6): give actor bc object d: its definition
// (16 bytes from ObjectIdList_04's entry, into wActorObjDef), attribute, facings, frame, animation and shadow
// tables; an object with its own palette (attribute $63) loads it into OBJ palette 2. Then mode 2, no facing
// drawn yet, animation 0. WRAM bank 4. Keeps the registers.
export function loadActorObjectDef(P, actor, obj) {
  const { bus } = P, objdef = P.A.actorObjDef;
  P.wramBank(WRAM_ACTORS);
  w8(P, actor, ACTORF_OBJECT, obj);
  const entry = P.rom.u16(BANK, (ObjectIdList_04 + ((obj * 2) & 0xFF)) & 0xFFFF);
  const gfxBankAt = (actor & 0xFF00) | ((actor + ACTORF_GFX_BANK) & 0xFF);
  bus.w8(gfxBankAt, entry >> 8);
  copyDataFromBank(P, entry >> 8, entry & 0xFF, objdef, OBJDEF_SIZE);
  w8(P, actor, ACTORF_OAM_ATTR, bus.u8(objdef));
  w8(P, actor, ACTORF_FACING_COUNT, bus.u8(objdef + 1));
  w16(P, actor, ACTORF_FRAME_TABLE, bus.u16(objdef + 4));
  w16(P, actor, ACTORF_ANIM_TABLE, bus.u16(objdef + 6));
  w16(P, actor, ACTORF_SHADOW_TABLE, bus.u16(objdef + 10));
  if (a8(P, actor, ACTORF_OAM_ATTR) === OBJDEF_OWN_PALETTE) {
    w8(P, actor, ACTORF_OAM_ATTR, OWN_PALETTE_ATTR);
    farCopyBytes(P, bus.u8(gfxBankAt), bus.u16(objdef + 8), objdef, 8);
    loadPalettesMasterOnly(P, objdef, OWN_PALETTE_FIRST, OWN_PALETTE_COUNT);
  }
  w8(P, actor, ACTORF_MODE, ACTOR_MODE_DRAWN);
  w8(P, actor, ACTORF_DRAWN_FACING, 0xFF);
  w8(P, actor, ACTORF_DRAWN_FACING + 1, 0xFF);
  setActorAnimation(P, actor, ANIM_STILL);
}

// SetupCharSpriteFromObjectDef (04:4B68): set up the character struct of the WRAM bank mapped (a match
// character) from object d's definition, then SetCharAnimation (bank 8, still the ROM's) to the idle animation.
// Returns SetCharAnimation's registers.
export function setupCharSpriteFromObjectDef(P, obj) {
  const { bus } = P, objdef = P.A.actorObjDef;
  bus.w8(wCharObjectDefId, obj);
  const entry = P.rom.u16(BANK, (ObjectIdList_04 + ((obj * 2) & 0xFF)) & 0xFFFF);
  bus.w8(wCharObjectBank, entry >> 8);
  copyDataFromBank(P, entry >> 8, entry & 0xFF, objdef, OBJDEF_SIZE);
  const attr = bus.u8(objdef);
  bus.w8(wCharSpriteAttr, attr);
  bus.w8(wCharGfxBank, attr);
  bus.w16(wCharFrameTablePtr, bus.u16(objdef + 4));
  bus.w16(wCharAnimTablePtr, bus.u16(objdef + 6));
  bus.w16(wCharShadowTablePtr, bus.u16(objdef + 10));
  bus.w8(wCharFacingOctant, 0xFF); bus.w8(wCharFacingOctant + 1, 0xFF);
  const r = P.callRom(BANK_MATCH, SetCharAnimation, { a: 0xFF, b: 0, c: 0, d: CHARANIM_IDLE, e: (objdef + OBJDEF_SIZE) & 0xFF, h: (wCharFacingOctant + 2) >> 8, l: (wCharFacingOctant + 2) & 0xFF });
  return { a: r.a, f: r.f, bc: r.bc, de: r.de, hl: r.hl };
}

export const HOOKS = [
  [BANK, 0x48C3, hook(P => tryPickRandomReachableTarget(P))],
  [BANK, 0x497B, hook((P, c) => unusedActorScriptOpMoveVector(P, c.de))],
  [BANK, 0x4A27, hook(P => computeSpriteScrollOffset(P))],
  [BANK, 0x4A82, hook(P => drawActors(P))],
  [BANK, 0x4AC3, hook((P, c) => {
    const b = c.b, f = (b === 0 ? FZ : 0) | FN | (((b + 1) & 0x0F) === 0 ? FH : 0) | (c.f & FC);
    if (b) loadActorObjectDef(P, c.bc, c.d);
    return { f };
  })],
  [BANK, 0x4AC6, hook((P, c) => { loadActorObjectDef(P, c.bc, c.d); })],
  [BANK, 0x4B68, hook((P, c) => setupCharSpriteFromObjectDef(P, c.d))],
];

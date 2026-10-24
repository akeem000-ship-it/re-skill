// The on-court characters (bank $08: char_update_08, char_states_08, shot_select_08, char_movement_08 and
// char_input_08 in the gerbiljames disassembly; bank $07: LoadCharacterAttributes in char_07). One struct per
// WRAM bank 4-7 (character k in bank 4 + k); E.C is the struct of the mapped bank, which is what the ROM's
// "wChar*" means, so every routine here works on "the current character" exactly like the ROM.
//
// Frame order (UpdateChar): ball geometry -> input -> state machine -> body-hit test -> velocity -> movement ->
// jump -> facing -> animation script -> sprite slots. The state machine is two-level (wCharState, then
// wCharStatePhase); docs/match_engine.md "On-court characters" in the disassembly describes it.
//
// Drawing outside the engine goes through E.ext (engine.js): the VRAM tile uploads of QueueCharFrameTiles (the copy
// queue at $C0A0-$C0EF), the serve indicator objects (bank 4 $DD80-$DDCF) and the on-court character graphics.
// Everything else these routines write -- palettes in the $C1xx/$C2xx buffers, the sprite-slot records and shadow
// OAM entries -- is the engine's own, so the whole of WRAM matches the ROM.
import * as ball from "./ball.js";
import * as shot from "./shot.js";
import * as ai from "./ai.js";
import { plusRunSpeed, plusTourDifficulty } from "./plus.js";   // PLAY+

export const CHARSTATE = { INERT: 0, RALLY: 1, RECOVER: 2, SERVE: 3, AWAIT_SERVE: 4, STANDBY: 5, WALK: 6, POINT_END: 7 };
export const CHARANIM = {
  STAND: 0x00, IDLE: 0x01, RUN: 0x02, CELEBRATE: 0x03, DEJECTED: 0x04, FOREHAND: 0x05, BACKHAND: 0x06, OVERHEAD: 0x07,
  SMASH: 0x08, FOREHAND_QUICK: 0x09, BACKHAND_QUICK: 0x0A, OVERHEAD_QUICK: 0x0B, SMASH_QUICK: 0x0C,
  OVERHEAD_READY: 0x0F, SERVE_READY: 0x10, SERVE_PREP: 0x11, DIVE: 0x12,
};
// wCharFlags bits
export const CHARF = { RECOIL: 0x01, DIVING: 0x02, AIRBORNE: 0x04, MOVING: 0x10, CHARGING: 0x20, MOVE_BLOCKED: 0x40 };
// wCharBallReachFlags bits
export const REACH = { SWING: 0x01, CONTACT: 0x02, BODY: 0x04, NEAR_NET: 0x10, STEER_X: 0x40, STEER_DEPTH: 0x80 };
const PAD = { A: 0x01, B: 0x02, SELECT: 0x04, RIGHT: 0x10, LEFT: 0x20, UP: 0x40, DOWN: 0x80 };
const SFX_SWING_CHARGE = 0x59, SFX_SWING = 0x5C;
const LINKSTATE_MASTER = 1, LINKSTATE_SLAVE = 2;

// ROM tables, read at run time
const DPAD_TO_FACING = 0x7286;           // 08:7286 DpadToFacingTable_08: facing angle by d-pad nibble, $FF = none
const SERVE_SHOT_TYPES = 0x707A;         // 08:707A by wCharShotButton1
const RALLY_SHOT_TYPES_NET = 0x709B;     // 08:709B RallyShotTypeTable0 (reach flags bit 4), by button1 + 4 * button2
const RALLY_SHOT_TYPES = 0x70B4;         // 08:70B4 RallyShotTypeTable1
const FACING_TILE_ROW = 0x7643;          // 08:7643 ReloadCharFacingTilesTable: frame-table row by facing octant
const OCTANT_FLIP = 0x76FC;              // 08:76FC BuildCharSpriteSlotsTable: OAM X-flip by facing octant
const CHAR_PALETTES = 0x50F6;            // 01:50F6 the character palettes (8 bytes each) LoadDebugMenuPalette reads
const CHAR_ATTR_PTRS = 0x5C42;           // 07:5C42 CharAttrStructPtrs_07: the four character records in WRAM
const STAT_SPEED = 0x5C4A, STAT_ACCEL = 0x5C5E, STAT_DECEL = 0x5C72;          // 07: word tables by 0-9 stat
const STAT_EASE = 0x5C86, STAT_AIM_SCALE = 0x5C90, STAT_JITTER = 0x5C9A;      // 07: byte tables by 0-9 stat
const SPRITE_SET_TABLE = 0x5A50;         // 07:5A50 CharSpriteSetTable
const FRAME_VRAM_DEST = 0x5AA7, TILE_BASE = 0x5AAF;                           // 07: by character index
const NAME_REMAP = 0x4C6A;               // 02:4C6A NameTextRemap_02 (RemapExtendedCharId)
const OBJECT_ID_LIST = 0x4F75;           // 04:4F75 ObjectIdList_04: (bank, slot) per object definition

const U8 = v => v & 0xFF, U16 = v => v & 0xFFFF, S16 = v => (v << 16) >> 16, NEG16 = v => (-v) & 0xFFFF;
const ABS16 = v => (v & 0x8000 ? NEG16(v) : v & 0xFFFF);          // $8000 stays $8000, as on the CPU
const NEG = v => (v & 0x8000) !== 0;                                  // "bit 7, h" of a 16-bit result
const SRA16 = (v, n) => (S16(v) >> n) & 0xFFFF;
const indexed = (base, a) => (base + (a & 0xFF)) & 0xFFFF;           // ld_hl_indexed table + a

// ============================================================================================================
// setup (char_update_08, char_07)
// ============================================================================================================

// 08:684A InitChar: a = index, d = character id, e = palette; loads sprite, stats, inert at (X $3C0, depth 0)
export function initChar(E, index, id, palette) {
  const C = E.C;
  C.index = index;
  C.id = id;
  C.spriteSetId = remapExtendedCharId(E, C.id);
  const set = lookupCharSpriteSet(E, C.spriteSetId);
  setupCharacterSprite(E, set, U8(palette + 3));
  loadCharacterAttributes(E);
  setCharState(E, CHARSTATE.INERT);
  setCharPosAndTarget(E, 0x03C0, 0x0000);
  C.inputSource = 1;                                                    // every character starts as the CPU
}
// 02:4C58 RemapExtendedCharId: ids $20+ (story/extra characters) map to a roster id
export function remapExtendedCharId(E, a) { return a < 0x20 ? a : E.rom.u8(2, indexed(NAME_REMAP, (a - 0x20) & 0x7F)); }
// 07:5A43 LookupCharSpriteSet
export function lookupCharSpriteSet(E, a) { return E.rom.u8(7, indexed(SPRITE_SET_TABLE, a & 0x3F)); }
// 07:5A70 SetupCharacterSprite: d = object definition, e = palette
export function setupCharacterSprite(E, d, e) {
  const C = E.C;
  setupCharSpriteFromObjectDef(E, d);
  C.gfxBank = e;
  C.spriteAttr = C.index + 4;                                           // OBJ palette 4 + index
  C.tileBase = E.rom.u8(7, indexed(TILE_BASE, C.index));
  C.frameVramDest = E.rom.u16(7, indexed(FRAME_VRAM_DEST, C.index * 2));
  reloadCharFrameGfx(E);
}
// 04:4B68 SetupCharSpriteFromObjectDef: the 16-byte object definition (bank:slot from ObjectIdList_04) is
// copied to wActorObjDef ($DAD0 of the mapped bank); it gives the palette byte and the three table pointers
export function setupCharSpriteFromObjectDef(E, d) {
  const C = E.C, m = E.mem, rom = E.rom;
  C.objectDefId = d;
  const w = rom.u16(4, indexed(OBJECT_ID_LIST, d * 2)), bank = w >> 8;
  C.objectBank = bank;
  const src = rom.u16(bank, 0x4000 + (w & 0xFF));                       // CopyDataFromBank: [bank:$40xx] -> source
  for (let i = 0; i < 16; i++) m.w8(0xDAD0 + i, rom.u8(bank, src + i));
  C.spriteAttr = m.u8(0xDAD0); C.gfxBank = m.u8(0xDAD0);
  C.frameTablePtr = m.u16(0xDAD4);
  C.animTablePtr = m.u16(0xDAD6);
  C.shadowTablePtr = m.u16(0xDADA);
  C.facingOctant = 0xFF; C.animFrame = 0xFF;
  setCharAnimation(E, CHARANIM.IDLE);
}
// 07:5AB3 LoadCharacterAttributes: the character's record (wPlayer1MainName etc.) into the stat block
export function loadCharacterAttributes(E) {
  const C = E.C, m = E.mem, rom = E.rom;
  const rec = rom.u16(7, indexed(CHAR_ATTR_PTRS, C.index * 2));
  const r8 = o => m.u8(rec + o), r16 = o => m.u16(rec + o);
  C.reachHeight = U16(r16(0x10) - 0x10);
  C.reachX = r16(0x12);
  C.smashJumpSpeed = U16(r16(0x14) + 0x200);
  C.diveSpeed = r16(0x16);
  C.swingAttrWord = r16(0x19);
  C.expTier = r8(0x18);
  C.mirrorAttrMask = r8(0x0E) ? 0x20 : 0;                              // left-handed: the sprite is drawn flipped
  C.maxSpeedX = rom.u16(7, indexed(STAT_SPEED, r8(0x27) * 2));
  let a = U8(r8(0x27) + r8(0x2B));                                       // speed + bonus, clamped to 0-9 ($80+ -> 0)
  a = a & 0x80 ? 0 : a < 10 ? a : 9;
  C.maxSpeedDepth = rom.u16(7, indexed(STAT_SPEED, a * 2));
  C.acceleration = rom.u16(7, indexed(STAT_ACCEL, r8(0x28) * 2));
  C.deceleration = rom.u16(7, indexed(STAT_DECEL, r8(0x2A) * 2));
  C.facingEaseRate = rom.u8(7, indexed(STAT_EASE, r8(0x29)));
  C.aimOffsetScale = rom.u8(7, indexed(STAT_AIM_SCALE, r8(0x25)));
  C.aimJitterScale = rom.u8(7, indexed(STAT_JITTER, r8(0x26)));
  C.groundStrokeSpeedIndex = r8(0x23);
  C.smashServeSpeedIndex = r8(0x22);
  C.reachSpeedIndex = r8(0x24);
  C.slicePlacementIndex = r8(0x21);
  C.topspinPlacementIndex = r8(0x20);
  C.aiPositionStrategy = r8(0x0F);
  C.aiReactionDelayNear = r8(0x1B);
  C.aiReactionDelayFar = r8(0x1C);
  C.aiTrackingParam = r8(0x1D);
  C.aiAimAwayChance = r8(0x1E);
  C.aiServeStyle = r8(0x1F);
  C.lobPlacementIndex = (C.swingAttrWord >> 8) & 1;
  C.dropPlacementIndex = (C.swingAttrWord >> 9) & 1;
  if (E.S.debugMatchFlags & 0x02) overrideCharStatsForDebug(E);
  if (E.plus) plusTourDifficulty(E);                                     // PLAY+: the tour's opponents by its stage
}
// 07:5CF4 OverrideCharStatsForDebug: a fixed, accurate CPU
export function overrideCharStatsForDebug(E) {
  const C = E.C;
  C.aiReactionDelayNear = 4; C.aiReactionDelayFar = 4; C.aiTrackingParam = 0; C.aiAimAwayChance = 0xFF;
  C.aiServeStyle = 2; C.aimJitterScale = 0; C.aiPositionStrategy = 1;
}
// 08:687F InitAllChars: clear the four structs, then set up the on-court characters (character 0 on the pad).
// The graphics upload at the end (LoadOnCourtCharacterGfx, 09) only writes VRAM and its copy queue.
export function initAllChars(E) {
  const S = E.S, m = E.mem;
  for (const bank of [7, 6, 5, 4]) { E.setBank(bank); for (let i = 0; i < 0x100; i++) m.w8(0xDF00 + i, 0); }
  S.standingShadowsEnabled = !S.matchIsDoubles && !S.linkSessionActive ? 1 : 0;
  const n = S.onCourtCharCountMinus1;
  if (n >= 3) { E.setBank(6); initChar(E, 2, S.player1CurrentPartnerCharacter, S.player1PartnerPalette); }
  if (n >= 2) { E.setBank(7); initChar(E, 3, S.player2CurrentPartnerCharacter, S.player2PartnerPalette); }
  if (n >= 1) { E.setBank(5); initChar(E, 1, S.player2CurrentMainCharacter, S.player2MainPalette); }
  E.setBank(4); initChar(E, 0, S.player1CurrentMainCharacter, S.player1MainPalette);
  E.C.inputSource = 0;
  E.ext.loadOnCourtCharacterGfx(E);                                     // 09:40B5 (VRAM and its copy queue)
}

// ============================================================================================================
// the frame (char_update_08)
// ============================================================================================================

// 08:692C UpdateAllChars: characters 0-3 in order; bank 4 mapped at the end
export function updateAllChars(E) {
  for (let k = 0; k < 4; k++) { E.setBank(4 + k); updateChar(E); }
  E.setBank(4);
}
// 08:6958 UpdateChar (an empty slot -- wCharObjectBank 0 -- is skipped)
export function updateChar(E) {
  if (!E.C.objectBank) return;
  updateCharBallGeometry(E);
  readCharInput(E);
  updateCharStateMachine(E);
  checkCharBallContact(E);
  updateCharVelocityFromInput(E);
  stepCharMovement(E);
  stepCharJumpPhysics(E);
  easeCharFacing(E);
  stepCharAnimation(E);
  const octant = updateCharFacingOctant(E);
  reloadCharFacingTiles(E, octant);
  buildCharSpriteSlots(E);
  updateChargeFlash(E);
  buildAirborneShadowSlot(E);
}
// 08:6988 SetCharPosAndTarget: position (fractions cleared, height 0) and walk target
export function setCharPosAndTarget(E, x, depth) {
  const C = E.C;
  C.posDepth = U16(depth) << 8; C.walkTargetDepth = depth;
  C.posX = U16(x) << 8; C.walkTargetX = x;
  C.posHeight = 0;
}
// 08:69AE SetCharTarget
export function setCharTarget(E, x, depth) {
  const C = E.C; C.walkTargetDepth = depth; C.walkTargetX = x; C.walkTargetFlag = 0;
}
// 08:69C2 ReloadCharFrameGfx: the character's palette (wCharGfxBank) into OBJ palette (attr & 7) + 8
export function reloadCharFrameGfx(E) { loadCharPalette(E, E.C.gfxBank, (E.C.spriteAttr & 7) + 8); }
// 08:69D5 LoadCharChargeFlashGfx: the flashing variant, 8 palettes further on
export function loadCharChargeFlashGfx(E) { loadCharPalette(E, U8(E.C.gfxBank + 8), (E.C.spriteAttr & 7) + 8); }
// 01:519A LoadDebugMenuPalette (through the far-call vector $0110): palette b of the table at 01:50F6 -> slot d
function loadCharPalette(E, b, d) { loadBGPalettes(E, 1, indexed(CHAR_PALETTES, b * 8), d, 1); }
// 00:05B0 LoadBGPalettes: e palettes from ROM (bank:hl) into slot d of the palette buffers. While faded out
// ($FFBC) only the fade target buffer ($C2xx) is written; otherwise both, and hPaletteDirtyFlags marks BG
// (d < 8) and/or OBJ (d + e >= 9) palettes for upload.
export function loadBGPalettes(E, bank, hl, d, e) {
  const m = E.mem, S = E.S;
  if (S.fadedOut) {
    let lo = U8(d * 8);
    for (let n = U8(e * 8) || 0x100; n > 0; n--, hl++) { m.w8(0xC200 | lo, E.rom.u8(bank, hl)); lo = U8(lo + 1); }
    return;
  }
  let lo = U8(d * 8);
  for (let n = U8(e * 4) || 0x100; n > 0; n--) {
    let v = E.rom.u8(bank, hl++); m.w8(0xC100 | lo, v); m.w8(0xC200 | lo, v); lo = U8(lo + 1);
    v = E.rom.u8(bank, hl++); m.w8(0xC200 | lo, v); m.w8(0xC100 | lo, v); lo = U8(lo + 1);
  }
  if (!(d & 0x08)) S.paletteDirtyFlags |= 1;
  if (U8(e + d) >= 9) S.paletteDirtyFlags |= 2;
}
// 08:69EA SetCharAnimation: start animation d from its script (no-op if it is already playing)
export function setCharAnimation(E, d) {
  const C = E.C;
  if (C.animId === d) return;
  C.animId = d;
  C.animDelay = 0;
  C.spriteAttr &= 0x0F;                                                 // clear the flip bits
  const ptr = E.rom.u16(C.objectBank, U16(C.animTablePtr + U8(d * 2)));
  C.animScriptBase = ptr; C.animScriptPtr = ptr;
}
// 08:6A1C SetCharState: state, phase 0, AI phase 0, freeze timer 0, AI action timer 0
export function setCharState(E, state) {
  const C = E.C; C.state = state; C.statePhase = 0; C.aiPhase = 0; C.freezeTimer = 0; C.aiActionTimer = 0;
}
// 08:6A2C SetCharFacing
export function setCharFacing(E, a) { E.C.facingDesired = a; E.C.facingShown = a; }
// 08:6A33 FlipCharPositionCode
export function flipCharPositionCode(E, b) { E.C.courtPos ^= b; }
// 08:6A3A ForEachCharBank: fn in banks 7, 6, 5, 4; bank 4 stays mapped
export function forEachCharBank(E, fn) { for (const k of [3, 2, 1, 0]) { E.setBank(4 + k); fn(); } }

// ============================================================================================================
// the state machine (char_update_08, char_states_08)
// ============================================================================================================

export const advancePhase = E => { E.C.statePhase = U8(E.C.statePhase + 1); };     // 08:6A8B AdvanceCharStatePhase
// each state: its phase handlers (a missing entry is the shared `ret`)
export const STATES = [
  [],                                                                                       // 0 inert
  [charRallyEndState, charRallyReadyPhase, charSwingWindupPhase, charSwingContactPhase],    // 1 rally
  [charRallyEndState, charRecoverMovementPhase],                                            // 2 recover
  [charServeInitPhase, charServeWaitAnimPhase, charServeTossPhase, charServeSwingWindowPhase, charServeStrikePhase],  // 3
  [charRallyEndState, charAwaitServeStart, charAwaitServeMove],                             // 4 await serve
  [charRallyEndState, charAwaitServeMove],                                                  // 5 standby
  [charWalkToTargetPhase],                                                                  // 6 walk
  [charRallyEndState, charWalkToTargetPhase, charPointReactionPhase],                       // 7 point end
];
// 08:6A62 UpdateCharStateMachine
export function updateCharStateMachine(E) {
  const C = E.C;
  C.scriptedMove = 0;
  if (C.freezeTimer) { C.freezeTimer--; return; }
  if (C.shotComboTimer) C.shotComboTimer--;
  const phases = STATES[C.state];
  if (!phases) throw new Error(`UpdateCharStateMachine: state ${C.state}`);
  const fn = phases[C.statePhase];
  if (fn) fn(E);
}
// 08:6A90 CharRallyEndState: phase 0 of states 1, 2, 4, 5, 7 -- wait for the swing/dive (or the jump) to end
export function charRallyEndState(E) {
  const C = E.C, A = CHARANIM;
  const swinging = [A.FOREHAND, A.BACKHAND, A.OVERHEAD, A.FOREHAND_QUICK, A.BACKHAND_QUICK, A.OVERHEAD_QUICK, A.DIVE].includes(C.animId);
  if (!swinging && !(C.flags & CHARF.AIRBORNE)) {
    C.shotButton1 = 0; C.shotButton2 = 0; C.lastShotButton = 0; C.swingFrames = 0;
    C.flags &= ~(CHARF.RECOIL | CHARF.DIVING | CHARF.CHARGING);
    advancePhase(E);
  }
  C.shotButton1 = 0; C.shotButton2 = 0; C.rallyReady = 0;
  C.chargeFlashOn = 0;
  endChargeFlash(E);
}
// ---- state 3: serve ----
// 08:6AF2 CharServeInitPhase
export function charServeInitPhase(E) {
  const C = E.C, S = E.S;
  ball.resetBallState(E, a => shot.setBallTrailColor(E, a));
  C.shotButton1 = 0; C.shotButton2 = 0; C.lastShotButton = 0;
  C.flags &= ~(CHARF.RECOIL | CHARF.DIVING);
  if (!S.minigameUsesTennisMachine && !S.minigameUsesWall && !S.minigameIsBooBlast)
    E.withWramBank(4, () => E.ext.spawnServeIndicatorObjs(E));          // 09:4242: HUD objects in bank 4 $DD80-$DDCF
  setCharAnimation(E, CHARANIM.SERVE_PREP);
  advancePhase(E);
}
// 08:6B33 CharServeWaitAnimPhase: the prep flourish chains into SERVE_READY
export function charServeWaitAnimPhase(E) { if (E.C.animId === CHARANIM.SERVE_READY) advancePhase(E); }
// 08:6B3F CharServeTossPhase: shuffle sideways; A or B tosses the ball from the server's spot, 144 up
export function charServeTossPhase(E) {
  const C = E.C, S = E.S;
  handleServePositioning(E);
  if (!(C.inputBits & (PAD.A | PAD.B))) return;
  ball.setBallPosition(E, U16(C.posXInt), U16(C.posDepthInt), 0xFF70);
  ball.setBallVelocityPolar(E, 0x0B00, 0xC000, 0x0000);                // straight up
  S.ballSpriteEnabled = 1; S.ballShadowEnabled = 1; S.ballTrailEnabled = 1;
  E.withWramBank(4, () => E.ext.dismissServeIndicatorObjs(E));          // 09:4282 (HUD objects)
  setCharAnimation(E, CHARANIM.OVERHEAD_READY);
  advancePhase(E);
}
// 08:6B8D CharServeSwingWindowPhase: a press while the ball is in reach starts the serve swing; a ball that
// falls past the reach height restarts the serve
export function charServeSwingWindowPhase(E) {
  const C = E.C, S = E.S;
  if (!NEG(S.ballVelocityHeight) && (U16(S.ballHeight) + U16(C.reachHeight)) > 0xFFFF) { C.statePhase = 0; return; }
  if (!bufferShotButtonPress(E)) return;
  C.swingAnim = CHARANIM.OVERHEAD;
  setCharAnimation(E, CHARANIM.OVERHEAD);
  advancePhase(E);
  S.courtViewLocked |= 0x02;
}
// 08:6BC2 CharServeStrikePhase: once the second-button window closes, aim and hit
export function charServeStrikePhase(E) {
  const C = E.C;
  bufferShotButtonPress(E);
  if (C.shotComboTimer) return;
  captureServeAim(E);
  selectServeShotType(E);
  shot.executeShot(E);
  advancePhase(E);
}
// ---- state 2: recover ----
// 08:6BE3 CharRecoverMovementPhase
export function charRecoverMovementPhase(E) { applyCharMovementInput(E); updateCharRunAnimation(E); }
// ---- state 1: rally ----
// 08:6BF8 CharRallyReadyPhase: move; a shot button starts the windup (forehand/backhand ready pose)
export function charRallyReadyPhase(E) {
  const C = E.C;
  C.rallyReady = 1;
  applyCharMovementInput(E);
  updateCharRunAnimation(E);
  if (!bufferShotButtonPress(E)) return;
  selectForehandBackhand(E);
  setCharAnimation(E, U8(C.swingAnim + 8));
  C.flags |= CHARF.CHARGING;
  C.swingFrames = 0; C.swingHoldButton = 0; C.swingHoldFrames = 0;
  C.chargeFlashOn = 1;
  advancePhase(E);
}
// 08:6C2F CharSwingWindupPhase: charge until the ball is in swing range (SELECT aborts)
export function charSwingWindupPhase(E) {
  const C = E.C;
  C.swingFrames = U8(C.swingFrames + 1);
  applyCharMovementInput(E);
  bufferShotButtonPress(E);
  if (checkSwingRelease(E)) {
    C.flags &= ~CHARF.CHARGING;
    C.chargeFlashOn = 0;
    endChargeFlash(E);
    C.shotButton1 = 0; C.shotButton2 = 0; C.lastShotButton = 0;
    C.statePhase = U8(C.statePhase - 1);
    return;
  }
  if (!(C.ballReachFlags & REACH.SWING)) return;
  startCharSwing(E);
  setCharAnimation(E, C.swingAnim);
  E.sfx(SFX_SWING_CHARGE);
  C.chargeFlashOn = 0;
  endChargeFlash(E);
  advancePhase(E);
}
// 08:6C7A CharSwingContactPhase: aim while swinging; the shot goes off when the ball enters the contact window
export function charSwingContactPhase(E) {
  const C = E.C;
  C.swingFrames = U8(C.swingFrames + 1);
  applyCharMovementInput(E);
  captureShotAim(E);
  resetSwingAnimation(E);
  if (!(C.ballReachFlags & REACH.CONTACT)) return;
  selectRallyShotType(E);
  shot.executeShot(E);
  advancePhase(E);
}
// 08:6C99 ResetSwingAnimation: a landed smash returns to idle; idle (the swing over) restarts the rally phases
export function resetSwingAnimation(E) {
  const C = E.C;
  if ((C.animId === CHARANIM.SMASH || C.animId === CHARANIM.SMASH_QUICK) && !(C.flags & CHARF.AIRBORNE)) setCharAnimation(E, CHARANIM.IDLE);
  if (C.animId === CHARANIM.IDLE) C.statePhase = 0;
}
// ---- states 4 / 5: waiting for the serve ----
// 08:6CD4 CharAwaitServeState.checkInput
export function charAwaitServeMove(E) { applyCharMovementInput(E); updateCharRunAnimation(E); }
// 08:6CDB CharAwaitServeState.startServe: move; once 512 or more from the net, the serve indicator goes
export function charAwaitServeStart(E) {
  applyCharMovementInput(E);
  updateCharRunAnimation(E);
  if (NEG(ABS16(E.C.posDepthInt) + 0xFE00)) return;
  E.withWramBank(4, () => E.ext.dismissServeIndicatorObjs(E));          // 09:4282 (HUD objects)
  advancePhase(E);
}
// ---- states 6 / 7: scripted walks and the end of the point ----
// 08:6D27 CharPointReactionPhase: celebrate (result > 0) or hang the head (< 0); also restores the palette
export function charPointReactionPhase(E) {
  const C = E.C;
  reloadCharFrameGfx(E);
  const a = C.pointResult & 0xFF;
  if (a & 0x7F) setCharAnimation(E, a & 0x80 ? CHARANIM.DEJECTED : CHARANIM.CELEBRATE);
  advancePhase(E);
}
// 08:6D3E CharWalkToTargetPhase
export function charWalkToTargetPhase(E) {
  const moving = moveCharTowardTarget(E);
  updateCharRunAnimation(E);
  if (!moving) advancePhase(E);
}
// 08:6D4B UpdateCharRunAnimation
export function updateCharRunAnimation(E) { setCharAnimation(E, E.C.flags & CHARF.MOVING ? CHARANIM.RUN : CHARANIM.IDLE); }

// 08:6D5A StartCharSwing: dive (out of reach, toward the held side), jump smash (ball high), overhead (a bit
// lower), else the forehand/backhand already chosen; a short windup (< 5 frames) makes it a quick swing
export function startCharSwing(E) {
  const C = E.C, S = E.S, M = E.M;
  let hl = predictBallLateralOffset(E);
  const held = NEG(hl) ? C.inputBits & PAD.LEFT : C.inputBits & PAD.RIGHT;
  if (held) {
    const bc = C.ballReachFlags & REACH.NEAR_NET ? 0xFFF0 : 0;
    if (!NEG(ABS16(hl) + bc - U16(C.reachX))) {
      // dive
      C.swingAnim = CHARANIM.DIVE;
      C.facingShown = C.inputBits & PAD.RIGHT ? 0x00 : 0x80;
      C.flags |= CHARF.DIVING; C.flags &= ~CHARF.CHARGING;
      const v = M.vectorFromLengthAndAngleRaw(U16(C.diveSpeed), C.facingDesired);
      C.velX = (v.hl & 0xFF) << 8;                                      // the low byte of each part, as 8.8
      C.velDepth = (v.de & 0xFF) << 8;
      E.sfx(SFX_SWING);
      return;
    }
  }
  const bc = (S16(S.ballVelocityHeight) >> 8) * 2;                     // sign-extended high byte, doubled
  const de = S16(C.reachHeight), h = S16(S.ballHeight);
  if (NEG(h + de + de + bc)) {
    // jump smash
    C.flags |= CHARF.AIRBORNE;
    C.velHeight = NEG16(C.smashJumpSpeed);
    C.swingAnim = CHARANIM.SMASH;
    E.sfx(SFX_SWING);
    return;
  }
  if (NEG(h + de + (de >> 1) + bc)) C.swingAnim = CHARANIM.OVERHEAD;
  C.quickSwing = 0;
  if (C.swingFrames < 5) { C.swingAnim = U8(C.swingAnim + 4); C.quickSwing = 1; }
}
// 08:6E44 SelectForehandBackhand: the predicted lateral offset against the court end (mirrored for left-handers)
export function selectForehandBackhand(E) {
  const C = E.C;
  let h = predictBallLateralOffset(E) >> 8;
  if (C.mirrorAttrMask) h = ~h;
  C.swingAnim = ((C.posDepthInt >> 8) ^ h) & 0x80 ? CHARANIM.BACKHAND : CHARANIM.FOREHAND;
}

// ============================================================================================================
// ball geometry and shot selection (char_states_08, shot_select_08)
// ============================================================================================================

// 08:6E64 UpdateCharBallGeometry: ball position relative to the character, and the reach flags
export function updateCharBallGeometry(E) {
  const C = E.C, S = E.S;
  S.ballRelCharX = S.ballX - C.posXInt;
  S.ballRelCharDepth = S.ballDepth - C.posDepthInt;
  S.ballRelCharHeight = S.ballHeight - C.posHeightInt;
  C.ballReachFlags = ABS16(C.posDepthInt) < 0x2A0 ? REACH.NEAR_NET : 0;
  checkBallInSwingRange(E);
  if (C.ballReachFlags & REACH.SWING) checkBallContactWindow(E);
}
// 08:6EC5 CheckCharBallContact: the body hit (rally state, no swing buffered, point still open) -- the
// character goes inert and the ball bounces back off it, slowed
export function checkCharBallContact(E) {
  const C = E.C, S = E.S, M = E.M, m = E.mem;
  if (C.shotButton1) return;
  if (C.state !== CHARSTATE.RALLY) return;
  if (S.pointOutcome) return;
  if (ABS16(S.ballRelCharDepth) >= 0x10) return;
  if (U16(ABS16(S.ballRelCharX) * 2) >= U16(C.reachX)) return;
  if (ABS16(S.ballRelCharHeight) >= U16(C.reachHeight)) return;
  C.ballReachFlags |= REACH.BODY;
  S.ballTouchCharFlag = 1;
  S.ballTouchCharIndex = C.index;
  C.flags |= CHARF.RECOIL; C.flags &= ~CHARF.CHARGING;
  setCharState(E, CHARSTATE.INERT);
  C.velDepth = SRA16(S.ballVelocityDepth, 1);
  for (let i = 0; i < 3; i++) m.w8(0xC423 + i, ~m.u8(0xC423 + i));     // reverse the depth velocity (cpl)
  M.addVel24ToPos32(0xC404, 0xC423);
  S.ballVelocityDepth = SRA16(S.ballVelocityDepth, 4);
  S.ballVelocityX = SRA16(S.ballVelocityX, 1);
  S.ballVelocityHeight = SRA16(S.ballVelocityHeight, 1);
}
// 08:6FA7 CheckBallContactWindow: depth < $60, lateral < reach X (x1.25 diving), height < 2 x reach height
export function checkBallContactWindow(E) {
  const C = E.C, S = E.S;
  if (ABS16(S.ballRelCharDepth) >= 0x60) return;
  let reach = U16(C.reachX);
  if (C.flags & CHARF.DIVING) reach = U16(reach + SRA16(reach, 2));
  // (the animation-id test at 08:6FDA leads to the same place either way)
  if (ABS16(S.ballRelCharX) >= reach) return;
  if (ABS16(S.ballRelCharHeight) >= U16(C.reachHeight * 2)) return;
  C.ballReachFlags |= REACH.CONTACT;
}
// 08:702A CheckBallInSwingRange: depth < $A0, lateral < 1.5 x reach X
export function checkBallInSwingRange(E) {
  const C = E.C, S = E.S;
  if (ABS16(S.ballRelCharDepth) >= 0xA0) return;
  const reach = U16(C.reachX + SRA16(C.reachX, 1));
  if (ABS16(S.ballRelCharX) >= reach) return;
  C.ballReachFlags |= REACH.SWING;
}
// 08:706B SelectServeShotType
export function selectServeShotType(E) { E.C.shotType = E.rom.u8(8, indexed(SERVE_SHOT_TYPES, E.C.shotButton1)); }
// 08:707E SelectRallyShotType: button1 + 4 * button2 in the net table (reach flags bit 4) or the normal one
export function selectRallyShotType(E) {
  const C = E.C, e = U8(C.shotButton2 * 4 + C.shotButton1);
  C.shotType = E.rom.u8(8, (C.ballReachFlags & REACH.NEAR_NET ? RALLY_SHOT_TYPES_NET : RALLY_SHOT_TYPES) + e);
}
// 08:70F5 PredictBallLateralOffset: where the ball crosses the character's depth, relative X
// (relX + (-relDepth) * tan(heading))
export function predictBallLateralOffset(E) {
  const S = E.S;
  return U16(S.ballRelCharX + E.M.mulHLByTangent(NEG16(S.ballRelCharDepth), U16(S.ballHeadingAngle)));
}
// 08:7112 BufferShotButtonPress: latch A/B into wCharShotButton1/2 (5-frame window for a second button;
// both together or a different button inside the window = 3). Returns the ROM's a: 0 when nothing was
// pressed and when a second button was stored, else nonzero.
export function bufferShotButtonPress(E) {
  const C = E.C;
  let b = C.inputBits & (PAD.A | PAD.B);
  if (!b) return 0;
  if (b !== 3) {
    if (C.shotComboTimer && C.lastShotButton !== b) b = 3;
    else {
      C.lastShotButton = b;
      C.shotComboTimer = 5;
      if (C.shotButton1) {
        if (C.shotButton2) return C.shotButton2;
        C.shotButton2 = b; C.shotComboTimer = 0;
        return 0;
      }
    }
  }
  C.shotButton1 = b;
  return b;
}
// 08:7151 CaptureServeAim: right 1, left -1, else 0
export function captureServeAim(E) {
  const i = E.C.inputBits; E.C.aimOffset = i & PAD.RIGHT ? 1 : i & PAD.LEFT ? 0xFF : 0;
}
// 08:7167 CaptureShotAim: left/right alone = -2/+2, with anything else held or pressed = -1/+1
export function captureShotAim(E) {
  const i = E.C.inputBits;
  E.C.aimOffset = i === PAD.LEFT ? 0xFE : i & PAD.LEFT ? 0xFF : i === PAD.RIGHT ? 2 : i & PAD.RIGHT ? 1 : 0;
}
// 08:719A ApplyCharMovementInput: the d-pad sets the desired facing; steering (reach flags bits 6/7) only
// once the shown facing is within $30 of it
export function applyCharMovementInput(E) {
  const C = E.C;
  const pad = C.inputBits & 0xF0;
  if (!pad) return;
  const f = E.rom.u8(8, indexed(DPAD_TO_FACING, pad >> 4));
  if (f === 0xFF) return;
  C.facingDesired = f;
  let diff = U8(f - C.facingShown); if (diff & 0x80) diff = U8(-diff);
  if (diff >= 0x30) return;
  if (C.inputBits & (PAD.RIGHT | PAD.LEFT)) C.ballReachFlags |= REACH.STEER_X;
  if (C.inputBits & (PAD.UP | PAD.DOWN)) C.ballReachFlags |= REACH.STEER_DEPTH;
}
// 08:71DD HandleServePositioning: left/right steps the server 10 along X while $20 <= |X| < $180 (the
// wall minigame drops the lower bound)
export function handleServePositioning(E) {
  const C = E.C;
  const pad = C.inputBits & (PAD.RIGHT | PAD.LEFT);
  if (!pad) return;
  const f = E.rom.u8(8, indexed(DPAD_TO_FACING, pad >> 4));
  if (f === 0xFF) return;
  const bc = E.M.vectorFromLengthAndAngleRaw(0x000A, f).hl;
  const x = ABS16(C.posXInt + bc);
  if (!E.S.minigameUsesWall && x < 0x20) return;
  if (x >= 0x180) return;
  C.posXInt = C.posXInt + bc;
}
// 08:7267 CheckSwingRelease: SELECT abandons the windup (returns 1); otherwise ticks wCharSwingHoldFrames
// (08:7280, the tail of the unused UnusedLatchSwingHoldButton) and returns 0
export function checkSwingRelease(E) {
  const C = E.C;
  if (!(C.inputBits & PAD.SELECT)) { C.swingHoldFrames = U8(C.swingHoldFrames + 1); return 0; }
  C.swingHoldButton = 0; C.swingHoldFrames = 0;
  return 1;
}

// ============================================================================================================
// movement (char_movement_08)
// ============================================================================================================

// 08:72A6 StepCharJumpPhysics: airborne only; gravity $90 per frame on the 24-bit height, landing at 0
export function stepCharJumpPhysics(E) {
  const C = E.C, M = E.M;
  if (!(C.flags & CHARF.AIRBORNE)) return;
  M.addDEToMem24(0xDF06, U16(C.velHeight));
  if (C.posHeight < 0) { C.velHeight = C.velHeight + 0x90; return; }
  C.posHeight = 0; C.velHeight = 0;
  C.flags &= ~CHARF.AIRBORNE;
}
// 08:72DE StepCharMovement: velocity into position (/8 while charging). Moves that leave the court box are
// refused per axis, not clamped (so a diagonal push into a wall slides); the CPU (input source 1) is only
// kept on its own side of the net. The game lets the near side up to $90 from the net but the far side only to
// $100 (in its flat picture the far player's sprite overlaps the net); NET: Even uses $90 for both
export function stepCharMovement(E) {
  const C = E.C, M = E.M;
  let bc = U16(C.velX), de = U16(C.velDepth);
  if (C.flags & CHARF.CHARGING) { bc = SRA16(bc, 3); de = SRA16(de, 3); }
  C.flags &= ~CHARF.MOVE_BLOCKED;
  const block = () => { C.flags |= CHARF.MOVE_BLOCKED; };
  const far = E.evenNet ? 0x0090 : 0x0100;                               // NET: Even (full.js): the far side may come as close to the net as the near side
  if (C.inputSource === 1) {
    M.addDEToMem24(0xDF00, bc);                                          // AddBCToMem24
    const d = M.addDEToMem24IntoBC(0xDF03, de);
    const ok = NEG(d) ? U16(d) + far <= 0xFFFF : U16(d) + 0xFF70 > 0xFFFF;
    if (ok) M.addDEToMem24(0xDF03, de); else block();
    return;
  }
  // X: -$3A0 <= X < $3A0, and not into the umpire's chair box (X >= $240 on the far side between the net and -$2A0)
  const x = M.addDEToMem24IntoBC(0xDF00, bc);
  let okX = !NEG(x + 0xFC60) ? false : NEG(x + 0x03A0) ? false : true;
  if (okX && !NEG(x + 0xFDC0)) {
    const depth = U16(C.posDepthInt);
    if (NEG(depth) && !NEG(depth + 0x02A0)) okX = false;
  }
  if (okX) M.addDEToMem24(0xDF00, bc); else block();
  // depth: near side $90 <= d < $6E0, far side -$700 <= d < -$100 (and the chair box again)
  const d = M.addDEToMem24IntoBC(0xDF03, de);
  let okD;
  if (!NEG(d)) okD = d + 0xFF70 > 0xFFFF && d + 0xF920 <= 0xFFFF;
  else {
    okD = d + far <= 0xFFFF && d + 0x0700 > 0xFFFF;
    if (okD && !NEG(d + 0x02A0) && !NEG(U16(C.posXInt) + 0xFDC0)) okD = false;
  }
  if (okD) M.addDEToMem24(0xDF03, de); else block();
}
// 08:73CA UpdateCharVelocityFromInput: accelerate the steered axes (reach flags 6/7), brake the others, cap the
// steered ones; diving or recoiling drops the steering. A stop with the d-pad released faces the base facing.
export function updateCharVelocityFromInput(E) {
  const C = E.C, m = E.mem;
  if (C.scriptedMove) return;
  if (C.flags & (CHARF.DIVING | CHARF.RECOIL)) C.ballReachFlags &= ~(REACH.STEER_X | REACH.STEER_DEPTH);
  if (C.ballReachFlags & REACH.STEER_X) accelerateCharX(E); else decelerateCharX(E);
  if (C.ballReachFlags & REACH.STEER_DEPTH) accelerateCharDepth(E); else decelerateCharDepth(E);
  if (C.ballReachFlags & REACH.STEER_X) clampCharXSpeed(E);
  if (C.ballReachFlags & REACH.STEER_DEPTH) clampCharDepthSpeed(E);
  C.ballReachFlags &= ~(REACH.STEER_X | REACH.STEER_DEPTH);
  C.flags |= CHARF.MOVING;
  if (m.u8(0xDF40) | m.u8(0xDF41) | m.u8(0xDF42) | m.u8(0xDF43)) return;
  C.flags &= ~CHARF.MOVING;
  if (!(C.inputBits & 0xF0)) C.facingDesired = C.baseFacing;
}
// 08:7441 AccelerateCharDepth / 08:745B AccelerateCharX: acceleration * sin/cos(desired facing) * 4
export function accelerateCharDepth(E) { const C = E.C; C.velDepth = C.velDepth + U16(E.M.mulHLBySin(U16(C.acceleration), C.facingDesired) * 4); }
export function accelerateCharX(E) { const C = E.C; C.velX = C.velX + U16(E.M.mulHLByCos(U16(C.acceleration), C.facingDesired) * 4); }
// brake v toward 0 by k, stopping at 0 (a sign change gives 0)
function brake(v, k) {
  v = U16(v); if (!v) return null;
  const hl = U16((NEG(v) ? k : NEG16(k)) + v);
  return ((v ^ hl) & 0x8000) ? 0 : hl;
}
// 08:7475 DecelerateCharDepth
export function decelerateCharDepth(E) { const C = E.C, v = brake(C.velDepth, U16(C.deceleration)); if (v !== null) C.velDepth = v; }
// 08:74A1 DecelerateCharX (a flat $40 while diving)
export function decelerateCharX(E) {
  const C = E.C, v = brake(C.velX, C.flags & CHARF.DIVING ? 0x0040 : U16(C.deceleration));
  if (v !== null) C.velX = v;
}
// cap |v| at |max| (max = the signed limit along the facing; the signed value is what gets stored)
function clampSpeed(v, max) {
  v = U16(v);
  let c = max, l = v;
  if (NEG(v)) { l = NEG16(v); c = NEG16(max); }
  return c >= l ? null : max;
}
// 08:74D7 ClampCharDepthSpeed / 08:750C ClampCharXSpeed
export function clampCharDepthSpeed(E) { const C = E.C, v = clampSpeed(C.velDepth, E.M.mulHLBySinSigned(U16(E.plus ? plusRunSpeed(E, C.maxSpeedDepth) : C.maxSpeedDepth), C.facingDesired)); if (v !== null) C.velDepth = v; }
export function clampCharXSpeed(E) { const C = E.C, v = clampSpeed(C.velX, E.M.mulHLByCosSigned(U16(E.plus ? plusRunSpeed(E, C.maxSpeedX) : C.maxSpeedX), C.facingDesired)); if (v !== null) C.velX = v; }
// 08:7541 MoveCharTowardTarget: a fixed $1000 step toward the walk target (returns 1), or snap onto it once
// within $18 on both axes (returns 0)
export function moveCharTowardTarget(E) {
  const C = E.C, M = E.M, m = E.mem;
  if (checkCharNearTarget(E)) {
    C.posXInt = C.walkTargetX; C.posDepthInt = C.walkTargetDepth;
    for (let i = 0; i < 4; i++) m.w8(0xDF40 + i, 0);
    C.flags &= ~CHARF.MOVING;
    return 0;
  }
  const dx = U16(C.walkTargetX - C.posXInt), dd = U16(C.walkTargetDepth - C.posDepthInt);
  C.facingDesired = M.angleFromVectorCoarse(dd, dx);
  const v = M.mulSinCos(0x1000, C.facingDesired << 8);
  M.addDEToMem24(0xDF00, v.hl);                                          // AddBCToMem24
  M.addDEToMem24(0xDF03, v.de);
  C.flags |= CHARF.MOVING;
  C.scriptedMove = 1;
  return 1;
}
// 08:75C0 EaseCharFacing: shown facing toward desired by at most the ease rate (frozen while diving)
export function easeCharFacing(E) {
  const C = E.C;
  if (C.flags & CHARF.DIVING) return;
  const b = C.facingEaseRate;
  let a = U8(C.facingDesired - C.facingShown);
  if (!a) return;
  if (a & 0x80) { a = U8(-a); if (a >= b) a = b; a = U8(-a); }
  else if (a >= b) a = b;
  C.facingShown = U8(C.facingShown + a);
}
// 08:75E8 UpdateCharFacingOctant: which of 8 sprite directions to draw (running/idle follow the shown facing,
// the dive halfway to it, everything else the base facing); returns d = the octant
export function updateCharFacingOctant(E) {
  const C = E.C;
  let a;
  if (C.animId === CHARANIM.RUN || C.animId === CHARANIM.IDLE) a = U8(C.facingShown + 0x10);
  else if (C.animId === CHARANIM.DIVE) a = U8(((U8(C.facingShown - C.baseFacing) << 24) >> 25) + C.baseFacing);
  else a = C.baseFacing;
  const d = a >> 5;
  if (C.facingOctant !== d) { C.facingOctant = d; C.spriteDirty |= 0x40; }
  return d;
}
// 08:7621 ReloadCharFacingTiles: on a frame/octant change, queue the frame's tiles (QueueCharFrameTiles 00:2E6B)
export function reloadCharFacingTiles(E, d) {
  const C = E.C;
  if (!(C.spriteDirty & 0x40)) return;
  C.spriteDirty &= ~0x40;
  const row = E.rom.u8(8, indexed(FACING_TILE_ROW, d));
  E.ext.queueCharFrameTiles(E, U8(C.animFrame * 5 + row) * 2);
}
// 00:2E6B QueueCharFrameTiles: the frame's 3-byte sprite descriptor (wCharSpriteFrame) from the shadow table;
// the tile copies it queues (VRAM copy queue $C0A0-$C0EF) are drawing only: E.ext.queueCharFrameTiles does the
// whole routine where there is VRAM
export function queueCharFrameTiles(E, de) {
  const C = E.C, m = E.mem, src = U16(C.shadowTablePtr + de + de);
  for (let i = 0; i < 3; i++) m.w8(0xDF1B + i, E.rom.u8(C.objectBank, src + i));
}

// ============================================================================================================
// drawing-side state the frame keeps, animation, input (char_input_08)
// ============================================================================================================

// 08:764B UpdateChargeFlash: after 20 windup frames the palette flashes every 4 frames
export function updateChargeFlash(E) {
  const C = E.C;
  if (!C.chargeFlashOn) return;
  if (C.swingFrames < 0x14) return;
  if (!(C.swingFrames & 4)) { endChargeFlash(E); return; }
  if (C.chargeFlashGfxLoaded) return;
  C.chargeFlashGfxLoaded = 1;
  loadCharChargeFlashGfx(E);
}
// 08:7666 EndChargeFlash
export function endChargeFlash(E) {
  const C = E.C;
  if (!C.chargeFlashGfxLoaded) return;
  C.chargeFlashGfxLoaded = 0;
  reloadCharFrameGfx(E);
}
// 08:59BB ApplyCameraProjection: projected (x, y) plus the camera offset -> screen pixel { d: x, e: y }
function toScreen(E, p) {
  const S = E.S;
  return { d: (U16((S.cameraOffsetX + p.hl) * 8) >> 8), e: (U16((S.cameraOffsetY + p.bc) * 8) >> 8) };
}
// 08:7672 BuildCharSpriteSlots: project the character; on screen -> sprite slot (+ the flickering standing
// shadow every other frame), off screen -> an edge arrow
export function buildCharSpriteSlots(E) {
  const C = E.C, S = E.S, m = E.mem;
  const { d, e } = toScreen(E, E.M.projectWorldToScreen(U16(C.posXInt), U16(C.posDepthInt), U16(C.posHeightInt)));
  C.screenX = d; C.screenY = e;
  if (U8(d + 8) >= 0xB0 || e >= 0xA0) { drawOffscreenCharArrow(E, d, e); return; }
  C.depthKey = U8((U16(C.posDepthInt * 8) >> 8) + 0x80);
  let b = (C.spriteAttr | 0x08) ^ E.rom.u8(8, indexed(OCTANT_FLIP, C.facingOctant));
  if (C.facingOctant === 2 || C.facingOctant === 6) b ^= C.mirrorAttrMask;
  m.w8(0xDF80, C.tileBase); m.w8(0xDF81, b); m.w8(0xDF82, e); m.w8(0xDF83, d);
  if (!S.standingShadowsEnabled) return;
  if (C.flags & CHARF.AIRBORNE) return;
  if (!(S.matchFrameCounter & 1)) return;
  m.w8(0xDF8C, 0x58); m.w8(0xDF8D, 0x08); m.w8(0xDF8E, e); m.w8(0xDF8F, d);
}
// 08:7704 DrawOffscreenCharArrow: an arrow at the screen edge (every other frame) toward the character
export function drawOffscreenCharArrow(E, d, e) {
  const C = E.C, S = E.S;
  if (!S.offscreenArrowsEnabled) return;
  if (!(S.matchFrameCounter & 1)) return;
  if (U8(d - 8) >= 0x90) d = C.posXInt < 0 ? 0x08 : 0x98;
  if (U8(e - 0x10) >= 0x80) e = C.posDepthInt < 0 ? 0x10 : 0x90;
  queueSprite16(E, C.spriteAttr & ~0x20, U8(C.index * 8), d, e);
}
// 00:1E55 QueueSprite16: two 8x16 OAM entries (y = e, x = d / d + 8, tiles c / c + 2, attr b; swapped if b
// has the X flip) into the shadow OAM page wSpriteBufferPage at hSpriteQueueIndex
export function queueSprite16(E, b, c, d, e) {
  const S = E.S, m = E.mem;
  let i = S.spriteQueueIndex;
  if (i === 0xA0) return;
  const page = S.spriteBufferPage << 8;
  const put = x => { m.w8(page | i, e); m.w8(page | U8(i + 1), x); m.w8(page | U8(i + 2), c); m.w8(page | U8(i + 3), b); i = U8(i + 4); };
  const [x1, x2] = b & 0x20 ? [U8(d + 8), d] : [d, U8(d + 8)];
  put(x1); c = U8(c + 2);
  if (i !== 0xA0) put(x2);
  S.spriteQueueIndex = i;
}
// 08:7745 BuildAirborneShadowSlot: while airborne, a shadow on the ground under the character that shrinks
// with height (tiles $50-$56 by height / 32, up to 3)
export function buildAirborneShadowSlot(E) {
  const C = E.C, m = E.mem;
  if (!(C.flags & CHARF.AIRBORNE)) return;
  const { d, e } = toScreen(E, E.M.projectWorldToScreen(U16(C.posXInt), U16(C.posDepthInt), 0));
  let h = ABS16(C.posHeightInt), a = 0;
  while (a < 3 && h + 0xFFE0 > 0xFFFF) { h = U16(h + 0xFFE0); a++; }
  m.w8(0xDF88, 0x50 + a * 2); m.w8(0xDF89, 0x08); m.w8(0xDF8A, e); m.w8(0xDF8B, d);
}
// 08:7791 StepCharAnimation: the animation script, one word per command when the delay runs out:
// [frame < $F0, delay], $FF d = jump to base + d, $FE d = switch to animation d, $FB d = toggle flip bits,
// any other $Fx = hold the frame forever. A frame change marks the sprite dirty (bit 6).
export function stepCharAnimation(E) {
  const C = E.C, rom = E.rom;
  let e, word = null;                                                   // the last script word read (the ROM leaves it in bc)
  if (C.animDelay) e = C.animFrame;
  else {
    for (let guard = 0; ; guard++) {
      if (guard > 1000) throw new Error("StepCharAnimation: script loops without a frame");
      const w = rom.u16(C.objectBank, C.animScriptPtr), cmd = w & 0xFF, d = w >> 8;
      word = w;
      if (cmd < 0xF0) { C.animDelay = d; C.animScriptPtr = U16(C.animScriptPtr + 2); e = cmd; break; }
      if (cmd === 0xFF) { C.animScriptPtr = U16(C.animScriptBase + d); continue; }
      if (cmd === 0xFE) { setCharAnimation(E, d); continue; }
      if (cmd === 0xFB) { C.spriteAttr = (C.spriteAttr & 0x0F) ^ d; C.animScriptPtr = U16(C.animScriptPtr + 2); continue; }
      C.animDelay = 0xFF; e = C.animFrame; break;
    }
  }
  C.animDelay = U8(C.animDelay - 1);
  if (C.animFrame !== e) { C.animFrame = e; C.spriteDirty |= 0x40; }
  return word;
}
// 08:780C ReadCharInput: this frame's wCharInputBits from the character's input source
export function readCharInput(E) {
  const C = E.C, S = E.S;
  C.inputBits = 0;
  switch (C.inputSource) {
    case 1: ai.charInputHandler1(E); return;                              // 08:7863 the CPU (ai.js)
    case 4: C.inputBits = S.linkInput; return;                            // 08:782D CharInputHandler4_08
    case 5:                                                               // 08:7833 link, local seat
      if (S.linkState === LINKSTATE_SLAVE) { C.inputBits = S.linkRemoteInput; return; }
      if (S.linkState === LINKSTATE_MASTER) { C.inputBits = S.linkRemoteInputBuf; return; }
      break;
    case 6:                                                               // 08:783F link, remote seat
      if (S.linkState === LINKSTATE_SLAVE) { C.inputBits = S.linkRemoteInputBuf; return; }
      if (S.linkState === LINKSTATE_MASTER) { C.inputBits = S.linkRemoteInput; return; }
      break;
    case 0: case 2: case 3: break;
    default: throw new Error(`ReadCharInput: input source ${C.inputSource}`);
  }
  readCharPadInput(E);
}
// 08:7855 ReadCharPadInput: d-pad held (high nibble) | buttons newly pressed (low nibble)
export function readCharPadInput(E) { E.C.inputBits = (E.S.playerInputFlags & 0xF0) | (E.S.inputRisingEdge & 0x0F); }
// 08:78BE CheckCharNearTarget: within $18 of the walk target on both axes -> 1
export function checkCharNearTarget(E) {
  const C = E.C;
  if (ABS16(C.walkTargetX - C.posXInt) >= 0x18) return 0;
  if (ABS16(C.walkTargetDepth - C.posDepthInt) >= 0x18) return 0;
  return 1;
}

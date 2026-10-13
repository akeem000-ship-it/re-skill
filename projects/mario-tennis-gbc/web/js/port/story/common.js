// What the story-mode engine's modules share: the actor record and its fields, the WRAM banks, the event flags
// the engine reads, flag tests, far calls between the engine's banks (02, 04, 0A), and the bank-0 routines it
// calls that have no verified port yet (run as the ROM's code).
// Names, addresses and the model come from the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm: src/engine/story/, include/constants/overworld.inc, docs/story_mode.md).
//
// The actor model. The overworld has 24 actor records of $40 bytes in WRAM bank 4 at wActors ($D000): slot 0 is
// the player, slot 1 the follower that trails the player (it is what the scripts move when they "move the
// player"), slot 2 the doubles partner, and slots 3 on the location's map_actor list (first free slot first).
// A record whose byte 1 (the script pointer's high byte) is 0 is free. Each live record runs a small bytecode
// (its "actor script", 22 opcodes, actor_ops.js) every frame from the UpdateActors frame task, walks toward its
// move target, and is drawn by the DrawActors frame task from its object definition (sprite frames and
// animation scripts in a walk-sprite bank). Positions are 16-bit, 1/256 tile (the high byte is the tile).
import { FZ, FN, FH, FC, setRegs, switchRomBank } from "../home/memory.js";

export { FZ, FN, FH, FC, setRegs, switchRomBank };

// ---- WRAM banks (include/constants/memory.inc) ----
export const WRAM_STAGING = 1, WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5;
export const WRAM_SCENE = 6, WRAM_CHAR1 = 5;

// ---- the engine's ROM banks ----
export const BANK_STORY_02 = 0x02, BANK_ACTORS = 0x04, BANK_STORY = 0x0A;

// ---- actor records ----
export const wActors = 0xD000, ACTOR_SIZE = 0x40, NUM_ACTORS = 0x18;
export const ACTOR_PLAYER = 0, ACTOR_PLAYER_SHADOW = 1;
export const wFollowerActor = wActors + ACTOR_PLAYER_SHADOW * ACTOR_SIZE;  // slot 1: what the scripts walk
export const ACTORF_SCRIPT = 0x00;       // word: the actor script's next opcode
export const ACTORF_SCRIPT_BANK = 0x02;
export const ACTORF_WAIT = 0x03;         // as_wait countdown
export const ACTORF_FLAGS = 0x05;        // bit 0 paused, 1 frozen in place, 2 path mode, 3 solid, 4 talkable,
                                         // 6 blocked this frame, 7 moving
export const ACTORF_SPEED = 0x06;        // word: step length per frame
export const ACTORF_TARGET_X = 0x08, ACTORF_TARGET_Y = 0x0A;
export const ACTORF_X = 0x0C, ACTORF_Y = 0x0E;
export const ACTORF_HEIGHT = 0x10;       // word: height above the ground, negative = up
export const ACTORF_JUMP_VEL = 0x12;     // word: added to the height each frame (gravity adds ACTORF_HEIGHT, $10)
export const ACTORF_HEADING = 0x14;      // movement angle (256 = a full turn)
export const ACTORF_TURN_RATE = 0x15;    // how far the heading may turn toward the target in a frame
export const ACTORF_LEADER = 0x16;       // word: the actor followed (waypoint/step movers), or the home tile
export const ACTORF_ANIM_SPEED = 0x18;   // animation frames are this much shorter (walking: 1, running: 3)
export const ACTORF_ANIM_SPEED_MOVING = 0x19;
export const ACTORF_MODE = 0x20;         // 0 inactive, 1 the camera follows it, 2 drawn
export const ACTORF_OBJECT = 0x21;       // OBJ_* id
export const ACTORF_GFX_BANK = 0x22;     // the walk-sprite bank of its object definition
export const ACTORF_FRAME_TABLE = 0x24;  // word: the object's frame array
export const ACTORF_VRAM_DEST = 0x26;    // word: its 4 tiles' VRAM slot (bank 1 at $8800 + slot * $40)
export const ACTORF_ANIM_TABLE = 0x28;   // word: the object's animation scripts
export const ACTORF_ANIM_BASE = 0x2A;    // word: the running animation script's start (for $FF loops)
export const ACTORF_ANIM_PTR = 0x2C;     // word: its cursor
export const ACTORF_ANIM_ID = 0x2E;
export const ACTORF_ANIM_DELAY = 0x2F;
export const ACTORF_STATUS = 0x30;       // bit 0 facing locked, 1 animation held, 3 animate when off screen,
                                         // 6 frame dirty, 7 drawn this frame
export const ACTORF_DRAW_DELAY = 0x31;   // frames before it is first drawn (spawned actors are staggered)
export const ACTORF_DRAWN_FACING = 0x32; // FACE_* the sprite shows
export const ACTORF_ANIM_FRAME = 0x33;   // the frame the animation shows
export const ACTORF_FACING = 0x34;       // angle: follows the heading unless locked
export const ACTORF_FACING_COUNT = 0x35; // 1: one facing only
export const ACTORF_TILE = 0x36;         // the OAM tile number of its VRAM slot
export const ACTORF_OAM_ATTR = 0x37;
export const ACTORF_SHADOW_TABLE = 0x38;
export const ACTORFLAG_PAUSED = 0x01, ACTORFLAG_FROZEN = 0x02, ACTORFLAG_PATH = 0x04, ACTORFLAG_SOLID = 0x08;
export const ACTORFLAG_TALKABLE = 0x10, ACTORFLAG_BLOCKED = 0x40, ACTORFLAG_MOVING = 0x80;
export const ACTORSTATUS_FACING_LOCKED = 0x01, ACTORSTATUS_ANIM_HELD = 0x02, ACTORSTATUS_ANIM_OFFSCREEN = 0x08;
export const ACTORSTATUS_FRAME_DIRTY = 0x40, ACTORSTATUS_LIVE = 0x80;
export const ACTOR_MODE_INACTIVE = 0, ACTOR_MODE_CAMERA = 1, ACTOR_MODE_DRAWN = 2;
export const FACE_RIGHT = 0x00, FACE_DOWN = 0x40, FACE_LEFT = 0x80, FACE_UP = 0xC0;

// An actor's fields through the WRAM bank mapped now, as the ROM reads them (the engine maps bank 4 first).
export const a8 = (P, actor, off) => P.bus.u8((actor + off) & 0xFFFF);
export const a16 = (P, actor, off) => P.bus.u16((actor + off) & 0xFFFF);
export const w8 = (P, actor, off, v) => P.bus.w8((actor + off) & 0xFFFF, v);
export const w16 = (P, actor, off, v) => P.bus.w16((actor + off) & 0xFFFF, v);
export const setBits = (P, at, mask) => P.bus.w8(at, P.bus.u8(at) | mask);
export const clearBits = (P, at, mask) => P.bus.w8(at, P.bus.u8(at) & ~mask);
// hActorPtr: the actor the engine is working on (the scripts' opcodes and many helpers read it)
export const actorPtr = P => P.bus.u16(P.A.actorPtr);
export const setActorPtr = (P, actor) => P.bus.w16(P.A.actorPtr, actor);

// ---- event flags (wGameFlags, flag n = byte n >> 3; FlagMaskTable gives the bit) ----
export const FLAG_NEW_GAME_CLEARED_BIT = 14, FLAG_NEW_GAME_SET_BIT = 15;
export const FLAG_DEBUG_NOCLIP = 16, FLAG_PLAYER_RUNNING = 17, FLAG_HIDE_OVERWORLD_ACTORS = 20;
export const FLAG_CUTSCENE_FAST_FORWARD = 22, FLAG_VRAM_UPDATE_BUSY = 24, FLAG_DEBUG_FREEZE_TILE_ANIM = 26;
export const FLAG_DEBUG_SHOW_PLAYER_POS = 32, FLAG_DEBUG_KEEP_MATCH_SETTINGS = 33;
export const FLAG_STORY_MENU_LOCKED = 46, FLAG_DOUBLES = 47;
export const FLAG_ENDING_CREDITS_PENDING = 109, FLAG_ENDING_CREDITS_RUNNING = 110, FLAG_ACTORS_FROZEN = 111;
const FlagMaskTable = 0x2497;                         // (bank 0) $80 $40 ... $01
// The operand word of rst $20/$28/$30 and SetGameFlag (de): byte << 8 | bit << 5
export const flagOperand = n => ((n >> 3) << 8 | (n & 7) << 5) & 0xFFFF;
const opByte = (P, op) => (P.A.gameFlags + (op >> 8)) & 0xFFFF;
const opMask = (P, op) => { const e = op & 0xFF; return P.rom.u8(0, FlagMaskTable + (((e << 3) | (e >> 5)) & 0xFF)); };
// TestGameFlag (00:249F) / SetGameFlag (00:24BA) / ClearGameFlag (00:24D4) by operand, and by flag number (the
// rst commands). The test's flags: Z when clear, H set (its `and [hl]`), C clear.
export const testFlagOp = (P, op) => (P.bus.u8(opByte(P, op)) & opMask(P, op)) !== 0;
export const setFlagOp = (P, op) => P.bus.w8(opByte(P, op), P.bus.u8(opByte(P, op)) | opMask(P, op));
export const clearFlagOp = (P, op) => P.bus.w8(opByte(P, op), P.bus.u8(opByte(P, op)) & ~opMask(P, op));
export const testFlag = (P, n) => testFlagOp(P, flagOperand(n));
export const setFlag = (P, n) => setFlagOp(P, flagOperand(n));
export const clearFlag = (P, n) => clearFlagOp(P, flagOperand(n));
export const testFlagF = set => (set ? 0 : FZ) | FH;

// ---- CPU flags of common instructions ----
export const zf = v => ((v & 0xFF) === 0 ? FZ : 0);
// `inc h / dec h` (a 16-bit pointer's "is it null" test): Z when h is 0, N set, H when h's low nibble is 0
export const incDecHFlags = (h, carry) => (h === 0 ? FZ : 0) | FN | ((h & 0x0F) === 0 ? FH : 0) | carry;
export const addFlags = (a, b, carryIn = 0) => {
  const r = a + b + carryIn;
  return zf(r) | (((a & 0xF) + (b & 0xF) + carryIn) > 0xF ? FH : 0) | (r > 0xFF ? FC : 0);
};
export const subFlags = (a, b, carryIn = 0) => {
  const r = a - b - carryIn;
  return zf(r) | FN | (((a & 0xF) - (b & 0xF) - carryIn) < 0 ? FH : 0) | (r < 0 ? FC : 0);
};
export const cpFlags = subFlags;
export const decFlags = (v, carry = 0) => zf(v - 1) | FN | ((v & 0x0F) === 0 ? FH : 0) | carry;
export const incFlags = (v, carry = 0) => zf(v + 1) | ((v & 0x0F) === 0x0F ? FH : 0) | carry;
// `add hl, rr`: Z kept, N clear, H and C from the 16-bit add
export const addHLFlags = (hl, rr, f) => (f & FZ) | (((hl & 0xFFF) + (rr & 0xFFF)) > 0xFFF ? FH : 0) | ((hl + rr) > 0xFFFF ? FC : 0);
// `ld hl, sp + e` / `add sp, e`
export const spAddFlags = (sp, e) => (((sp & 0x0F) + (e & 0x0F)) > 0x0F ? FH : 0) | (((sp & 0xFF) + (e & 0xFF)) > 0xFF ? FC : 0);
// `bit n, r`: Z when clear, H set, C kept
export const bitFlags = (set, carry) => (set ? 0 : FZ) | FH | carry;

// ---- WRAM banks ----
// push_wram_bank b ... pop_wram_bank around fn (hWramBank read through the bus, as the ROM's `ldh a, [hWramBank]`:
// the lockstep test counts such reads to place a VBlank the ROM took mid-work)
export function withWramBank(P, bank, fn) {
  const old = P.V.wramBank;
  P.wramBank(bank);
  const r = fn();
  P.wramBank(old);
  return r;
}

// ---- far calls between the engine's banks ----
// FarCall (rst $18) from JavaScript to JavaScript: hRomBank and the MBC set to the callee's bank around it, as the
// ROM's trampoline does (the callee reads hRomBank: frame tasks and actor scripts take the caller's bank).
export function farcall(P, bank, fn) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const r = fn();
  switchRomBank(P, old);
  return r;
}
export function* farcallGen(P, bank, gen) {
  const old = P.V.romBank;
  switchRomBank(P, bank);
  const r = yield* gen;
  switchRomBank(P, old);
  return r;
}
// FarCall to code that is still the ROM's: the target from the bank's $4000 table (`farcall X` names
// FarPtr_X, the table entry), run on the CPU (P.runRom maps the bank and maps the caller's back).
export const farTarget = (P, bank, slot) => P.rom.u16(bank, 0x4000 | slot);

// ---- bank-0 routines without a verified port, run as the ROM's code ----
export const AdvanceFrame = 0x2631, WaitFrames = 0x2740, AdvanceRandomSeed = 0x0A3A;
export const ClearFrameTasks = 0x1B38, DisableLCDSafely = 0x0346, EnableLCD = 0x0376;
export const BlitBGRowFrom64 = 0x222C, BlitBGColumnFrom64 = 0x2299;
export const PrintString = 0x1906, PrintHexByte = 0x1AB7, PrintHexWord = 0x1ACE, PrintDecimalByte = 0x1AE4;
export const Unused_00_PrintDecimalWord = 0x1B15, FormatDecimalNumber = 0x1972;
export function* advanceFrame(P, regs = {}) { return yield* P.runRom(0, AdvanceFrame, regs); }
export function* waitFrames(P, count, regs = {}) { return yield* P.runRom(0, WaitFrames, { ...regs, c: count }); }
// AdvanceRandomSeed (00:0A3A): the new seed in hl
export const randomSeed = P => P.callRom(0, AdvanceRandomSeed).hl;

// ---- hook adapters ----
// Every hook puts the registers back as they were at the call (ROM code a routine calls on the CPU changes them),
// then writes the registers the routine leaves changed: fn returns them as an object ({ a, f, bc, de, hl, ... }),
// or nothing for a routine that keeps them all (push ... pop around its work).
const REGS = ["a", "f", "b", "c", "d", "e", "h", "l"];
export const getRegs = c => { const o = {}; for (const r of REGS) o[r] = c[r]; return o; };
export const hook = fn => (P, c) => { const s = getRegs(c); const out = fn(P, c); setRegs(c, s); if (out) setRegs(c, out); };
export const hookGen = gen => function* (P, c) {
  const s = getRegs(c); const out = yield* gen(P, c); setRegs(c, s); if (out) setRegs(c, out);
};

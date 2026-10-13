// Minigames and training drills (banks $0B and $0D): what the modules of this area share — the game's constants,
// the routines of other parts they call (still the ROM's: P.callRom / P.runRom), and the CPU idioms the code
// leans on (rst $00 jump tables, WRAM bank pushes, far calls between the two banks).
// Names, addresses and constants from the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm; src/engine/minigames/*.asm and src/twins/).
//
// How the minigames run. A training drill (ids $00-$11, bank $0B) or a minigame (ids $12-$23, bank $0D) is a match
// played by the match engine (bank $08) with a "mode hook table": eight routines the engine calls at fixed moments
// (CallModeHook 08:66F1, which saves every register):
//   0 PerFrame   every simulated frame        4 BallHit    a character struck the ball
//   1 PointStart before each serve            5 Bounce     the ball bounced
//   2 PointEnd   after the rally (may wait)   6 RallyTick  each frame of a rally (the wall: the ball reached it)
//   3 MinigameStart once, before the first point (may wait)
//   7 Draw       after the sprites are queued (the minigames' target actors)
// The hooks judge the rally, keep the score and end the point or the match through wMatchAbortFlag.
//
// RAM. Variables in WRAM0/HRAM are used by name (P.V). The banked ones ($D000-$DFFF: the minigame actors in bank 4,
// the court planes in bank 2, a character's struct at $DF00 in banks 4-7) are read and written through P.bus in
// whatever bank is mapped, as the ROM's code does.
// ROM data. Tables are read from the ROM where the code reads them (P.bus: the bank mapped, which is the code's
// own), never copied here, so an index past a table's end reads what the ROM's code reads.
import { playSoundManaged } from "../audio/requests.js";
import { setRomBank } from "../home/system.js";

export const BANK_DRILLS = 0x0B, BANK_MINIGAMES = 0x0D;
export const FLAG_Z = 0x80, FLAG_N = 0x40, FLAG_H = 0x20, FLAG_C = 0x10;

// ---- the game's constants (include/constants of the disassembly) ----
export const POINTOUTCOME = {
  NONE: 0, FAULT: 1, DOUBLE_FAULT: 2, LET: 3, NET: 4, OUT: 5, WINNER: 6,
  SERVE_VOLLEYED: 7,       // the receiver hit the serve before it bounced
  WRONG_RECEIVER: 8,
  BALL_HIT_PLAYER: 9,      // the ball reached a character's body
  MINIGAME_CLEARED: 0x0B,  // bank $0D only: the target score was reached
};
export const WINLOSE_NONE = 0x00, WINLOSE_WIN = 0x01, WINLOSE_LOSE = 0xFF;      // wPointWinLoseFlag: player 1 / 2
export const MATCHABORT_POINT = 0x01, MATCHABORT_MATCH = 0x80;                 // wMatchAbortFlag
export const CHARSTATE_INERT = 0, CHARSTATE_RALLY = 1, CHARSTATE_STANDBY = 5, CHARSTATE_WALK = 6;
export const CHARANIM_FOREHAND = 0x05;
export const SHOTTYPE_SMASH = 0x09, SHOTTYPE_LOB = 0x0A, SHOTTYPE_DROP = 0x0B;
// WRAM banks
export const WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5, WRAM_SOUND = 7;
export const WRAM_CHAR0 = 4, WRAM_CHAR1 = 5;                                    // character n's struct: bank 4 + n
// sounds
export const BGM_NONE = 0x00, BGM_WIN = 0x09, BGM_LOSE = 0x0A;
export const SFX_MENU_SELECT = 0x5F, SFX_BEEP = 0x72, SFX_COUNTDOWN = 0x74, SFX_COUNTDOWN_GO = 0x75, SFX_BALL_LAUNCH = 0x76;
export const SFX_BALL_CONTACT = 0x77, SFX_THUD = 0x86, SFX_GRID_CLEAR = 0x94, SFX_CHIME = 0x97;
// minigame ids (wCurrentMinigameStoryMatch + 1)
export const MINIGAME_SERVICE_MATCH_2 = 0x01, MINIGAME_TENNIS_MACHINE_1 = 0x12, MINIGAME_TENNIS_MACHINE_HIGH_SCORE = 0x1A;
export const MINIGAME_BOO_BLAST = 0x1C, MINIGAME_TWO_ON_ONE = 0x24;
export const MATCHLIST_TRAINING = 0x02;
// drill messages (wDrillMessageId -> DrillMessageTextIds_0b)
export const DRILLMSG_NONE = 0x00, DRILLMSG_HIDE = 0xFF, DRILLMSG_NO_MESSAGE_FOR_THIS_CASE = 0x6C;

// A character's struct: at $DF00 in WRAM bank 4 + its index (the fields the minigames use)
export const CHAR = {
  posX: 0xDF00, posDepth: 0xDF03, freezeTimer: 0xDF10, shotButton1: 0xDF16, shotButton2: 0xDF17,
  aimOffset: 0xDF4A, swingFrames: 0xDF4B, stateFlags: 0xDF50, pointResult: 0xDF57,
  aimOffsetScale: 0xDF69, aimJitterScale: 0xDF6A, groundStrokeSpeedIndex: 0xDF6B, reachSpeedIndex: 0xDF6D,
  topspinPlacementIndex: 0xDF6E, slicePlacementIndex: 0xDF6F, id: 0xDF78, spriteSlot: 0xDF80,
};
export const CHAR_UNUSED_15 = 0x15, CHAR_NONE = 0xFF;

// ---- routines of other parts (bank, address), run as the ROM's code until they are ported ----
export const ROM = {
  // match engine (bank $08)
  AdvanceMatchRng: [0x08, 0x43F6], StepMatchFrames: [0x08, 0x4428], StepMatchFramesSkippable: [0x08, 0x4436],
  RunMatchFramesUntilInput: [0x08, 0x4452], StepMatchFrame: [0x08, 0x4465], RunMatch: [0x08, 0x4190],
  SetBallPosition: [0x08, 0x458B], MulMem24ByFrac: [0x08, 0x468B], StartPointEndReactions: [0x08, 0x4FB8],
  CharPointEndReaction: [0x08, 0x4FC7], StartBounceEffect: [0x08, 0x5383], ProjectWorldToScreen_08: [0x08, 0x59B8],
  ApplyCameraProjection: [0x08, 0x59BB], AwardPoint: [0x08, 0x5C14], UpdatePointStats: [0x08, 0x5C2B],
  ResolvePointWinner: [0x08, 0x5D9A], SetCameraTarget: [0x08, 0x61C9], RunMinigameMatch: [0x08, 0x6557],
  InitMinigameMatchSettings: [0x08, 0x6544], SetModeHookTable: [0x08, 0x671A], SetMinigamePointTable: [0x08, 0x6728],
  SetBallGatePoint1: [0x08, 0x6731], SetBallGatePoint2: [0x08, 0x6740], SetTargetZoneCorner1: [0x08, 0x674F],
  SetTargetZoneCorner2: [0x08, 0x675E], DidBallCrossGate: [0x08, 0x676D], IsBallInTargetZone: [0x08, 0x67C2],
  SetCharPosAndTarget: [0x08, 0x6988], SetCharTarget: [0x08, 0x69AE], SetCharAnimation: [0x08, 0x69EA],
  SetCharState: [0x08, 0x6A1C], SelectRallyShotType: [0x08, 0x707E],
  // match HUD and court objects (bank $09)
  UpdateScorePanelDisplay: [0x09, 0x4098], SpawnGameScoreDisplayObjs: [0x09, 0x412A],
  DismissGameScoreDisplayObjs: [0x09, 0x4190], ShowCourtBanner: [0x09, 0x4367], SpawnCourtBannerObj: [0x09, 0x4371],
  HideCourtBanner: [0x09, 0x437B], LoadScoreDigitGfx: [0x09, 0x6100], LoadPlayer1PointsDigitGfx: [0x09, 0x610C],
  LoadPlayer2PointsDigitGfx: [0x09, 0x611B],
  // field engine: the wall minigames' targets, the score digits (bank $0A)
  InitMinigameTargets: [0x0A, 0x6596], DrawNumberWithSprites: [0x0A, 0x67CA],
  DeflectBallOffMinigameTarget: [0x0A, 0x6774], SpawnMinigameTargetFormation: [0x0A, 0x6C7B],
  // others
  LoadMenuFontGfx: [0x01, 0x50E2], InitCa00RecordFromCharId: [0x02, 0x4066], ReadMinigameRecord: [0x03, 0x5015],
  PushTextArgNumber: [0x05, 0x5147], ShowSpeakerDialogue: [0x05, 0x581F], MeasureDialogueWidthTiles: [0x05, 0x5BFC],
  AddTextIdOffset: [0x05, 0x5D2B], ResetTextWindowState: [0x05, 0x6E09], ShowMessageWindow: [0x06, 0x44FE],
  FlushTilemapToVram: [0x06, 0x45F8], LoadCharacterAttributes: [0x07, 0x5AB3], ProcessMatchRewards: [0x1E, 0x6534],
  QueueMatchSpriteFrameA: [0x28, 0x606C], QueueMatchSpriteFrameB: [0x28, 0x6086], LoadEffectFrameTiles_28: [0x28, 0x60A0],
  // bank 0 (calls that need the ROM's stack or registers: the frame-task table works on the stack, DisableLCDSafely
  // polls rLY, FarCallVector hands its target address to the callee)
  DisableLCDSafely: [0, 0x0346], FarCallVector: [0, 0x07C5], RegisterFrameTask: [0, 0x1B6A],
  UnregisterFrameTask: [0, 0x1BCB], WaitFadeEnd: [0, 0x1DA4], AdvanceFrame: [0, 0x2631],
};
// ld_slot hl, FarPtr_ExecuteShot (bank $07's export $3C): the shot routine, through FarCallVector
export const FARPTR_EXECUTE_SHOT = 0x073C;

// A call into a routine of another part that does not wait for frames; returns the registers it leaves.
export const far = (P, [bank, addr], regs = {}) => P.callRom(bank, addr, regs);
// The same for a routine that may wait (a generator: yield* farWait(...)).
export function* farWait(P, [bank, addr], regs = {}) { return yield* P.runRom(bank, addr, regs); }

// rst $08 ; db id — and PlaySoundManaged (00:3024): request a sound (every register kept)
export const sound = (P, id) => playSoundManaged(P, id);

// push_wram_bank b: map bank b, returning the bank to restore (pop_wram_bank = P.wramBank(old))
export function pushWramBank(P, bank) { const old = P.V.wramBank; P.wramBank(bank); return old; }

// Far calls between the two minigame banks done in JavaScript: FarCall's bank switch around fn (the callee reads its
// tables through the bank mapped, and hRomBank names its bank).
export function inBank(P, bank, fn) {
  const old = P.V.romBank;
  setRomBank(P, bank);
  try { return fn(); } finally { setRomBank(P, old); }
}
export function* inBankWait(P, bank, gen) {
  const old = P.V.romBank;
  setRomBank(P, bank);
  try { return yield* gen; } finally { setRomBank(P, old); }
}

// ROM data through the bank mapped (the routine's own bank while it runs)
export const rb = (P, addr) => P.bus.u8(addr & 0xFFFF);
export const rw = (P, addr) => P.bus.u16(addr & 0xFFFF);
// `add l / ld l, a / jr nc / inc h` and ld_hl_indexed: a 16-bit base plus an 8-bit index
export const at = (base, a) => (base + (a & 0xFF)) & 0xFFFF;

export const s8 = v => ((v & 0xFF) ^ 0x80) - 0x80;
export const s16 = v => ((v & 0xFFFF) ^ 0x8000) - 0x8000;

// rst $00 (JumpTableDispatch, 00:06C4) with an inline table at `table`: run cases[index]. An index past the cases
// jumps where the ROM's code would, to the word at table + (2 * index mod 256) — code or data after the table — run
// as the ROM's (with hl = that address and a = its low byte, as JumpTableDispatch leaves them). Returns what the
// case returns; for the ROM's code, its a.
export function jumpTable(P, bank, table, index, cases, regs = {}) {
  if (index < cases.length) return cases[index]();
  const target = P.bus.u16(table + ((index << 1) & 0xFF));
  return far(P, [bank, target], { ...regs, a: target & 0xFF, h: target >> 8, l: target & 0xFF }).a;
}
export function* jumpTableWait(P, bank, table, index, cases, regs = {}) {
  if (index < cases.length) return yield* cases[index]();
  const target = P.bus.u16(table + ((index << 1) & 0xFF));
  return (yield* farWait(P, [bank, target], { ...regs, a: target & 0xFF, h: target >> 8, l: target & 0xFF })).a;
}

// `xor a / scf / .loop: rla / dec b / jr nz`: the bit that b passes of a 9-bit rotate (a and the carry) leaves in a.
// Used as "1 << n" for b = n + 1 (b = 0 makes 256 passes).
export function rlaBit(b) {
  const p = ((b & 0xFF) || 256) - 1;
  const pos = p % 9;
  return pos < 8 ? 1 << pos : 0;
}
// `.loop: ld a, 0 / rr b / adc 0 / dec c / jr nz` over c passes, b = bits: the bit shifted out last. The adc clears
// the carry after the first pass, so the first `rr b` brings in the caller's carry (cin): pass 9 shifts it out, later
// passes zeros. (c = 0 makes 256 passes.)
export function shiftedOutBit(bits, c, cin) {
  const n = (c & 0xFF) || 256;
  if (n <= 8) return (bits >> (n - 1)) & 1;
  return n === 9 ? (cin ? 1 : 0) : 0;
}
// The number of set bits of a byte (`rr b / adc 0` eight times)
export function popcount8(v) { let n = 0; for (let i = 0; i < 8; i++) n += (v >> i) & 1; return n; }

// Hook adapters. A routine returns nothing, a number (its a) or the registers it leaves ({ a, f, hl, ... }); the
// adapter writes them back. Generator routines are wrapped the same way (the hook returns the generator).
export function put(c, r) {
  if (r === undefined || r === null) return;
  if (typeof r === "number") { c.a = r & 0xFF; return; }
  for (const k in r) {
    if (k === "hl" || k === "de" || k === "bc") c[k] = r[k] & 0xFFFF;
    else if (k === "f") c.f = r.f & 0xF0;
    else if (k.length === 1) c[k] = r[k] & 0xFF;
  }
}
export const hook = fn => (P, c) => put(c, fn(P, c));
export const hookGen = fn => (P, c) => (function* () { put(c, yield* fn(P, c)); })();
// the result of `or a` / `and a` on a: Z when 0 (C and N clear, H set by `and`)
export const flagsOfA = (a, and = false) => ((a & 0xFF) === 0 ? FLAG_Z : 0) | (and ? FLAG_H : 0);
// The same for either kind: a routine that returns a generator (it waits) gets a generator hook
export const auto = fn => (P, c) => {
  const r = fn(P, c);
  if (r && typeof r.next === "function") return (function* () { put(c, yield* r); })();
  put(c, r);
};
// CPU registers kept around fn (a routine that pushes and pops all it uses, around ROM calls that change them)
export const keepRegs = fn => (P, c) => {
  const saved = { a: c.a, f: c.f, b: c.b, c: c.c, d: c.d, e: c.e, h: c.h, l: c.l };
  fn(P, c);
  Object.assign(c, saved);
};

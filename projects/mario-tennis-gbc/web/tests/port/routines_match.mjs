// Routine tests for web/js/port/match (run by web/tests/port_routines.mjs).
// The engine's hooks (web/js/port/match/engine_hooks.js) are checked with the engine's own routine list
// (web/tests/engine/routines*.mjs: the same forced branches), here on the whole machine: every byte of RAM,
// VRAM, OAM, the sound driver and the I/O the ROM routine touches must come out the same.
import fs from "fs";

// a state in match play: the game waits in AdvanceFrame called from bank $08, on a court
export const inMatch = s => s.m.mem.romBank === 8 && s.map <= 15;
// a routine run with WRAM bank `wram` mapped the ROM's way (rSVBK and hWramBank), and no interrupt pending or
// enabled: the states are taken at the VBlank, and ROM code that ends with `ei` (FarReadWordDI) would take it
export const quiet = m => { m.iflag = 0; m.ie = 0; };
const mapBank = (R, prep) => (m, s) => { quiet(m); if (R.wram !== undefined) m.hram[0x16] = R.wram; if (prep) prep(m, s); };
// the port's side run as romcall.mjs runs the ROM's: the CPU awake and IME off. The states are taken in the halt
// at the VBlank, with the VBlank pending: with the state's IME the first instruction a hook runs in the ROM (a
// sound request) would take it.
export const callHook = (bank, addr) => (P, regs) => { P.cpu.halted = false; P.ime = false; return P.callRom(bank, addr, regs); };
// the registers an engine entry's out(ret) names (called on a stand-in value)
const any = new Proxy({}, { get: (t, k) => (k === Symbol.toPrimitive ? () => 0 : any) });
const outRegs = R => (R.out ? Object.keys(R.out(any)) : []);

const ENGINE = [];
const dir = new URL("../engine/", import.meta.url);
for (const f of fs.readdirSync(dir).filter(f => /^routines.*\.mjs$/.test(f)).sort())
  for (const R of (await import(new URL(f, dir))).ROUTINES)
    ENGINE.push({ name: "engine " + R.name, bank: R.bank, addr: R.addr, wram: R.wram, regs: R.regs, prep: mapBank(R, R.prep), out: outRegs(R), when: inMatch, js: callHook(R.bank, R.addr) });

// ---- the drawing, the HUD objects and the match loop's routines that do not wait ----
const H = (s, k) => { let h = Math.imul(s.f + 1, 0x9E3779B1) ^ Math.imul(k + 1, 0x85EBCA77); h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; return h >>> 0; };
const r8 = (s, k) => H(s, k) & 0xFF, r16 = (s, k) => H(s, k) & 0xFFFF;
const g8 = (m, a, v) => { m.wram[0][a - 0xC000] = v & 0xFF; }, g16 = (m, a, v) => { g8(m, a, v); g8(m, a + 1, v >> 8); };
const c8 = (m, b, a, v) => { m.wram[b][a - 0xD000] = v & 0xFF; }, c16 = (m, b, a, v) => { c8(m, b, a, v); c8(m, b, a + 1, v >> 8); };
const pick = (s, k, list) => list[H(s, k) % list.length];
const E = (name, bank, addr, more = {}) => ({ name: "match " + name, bank, addr, wram: 4, when: inMatch, out: [], ...more, js: callHook(bank, addr),
  prep: (m, s) => { quiet(m); m.hram[0x16] = more.wram ?? 4; if (more.prep) more.prep(m, s); } });
// the ball's drawing state scrambled: effect timers, flags, positions near the net, the trail
function ballDraw(m, s) {
  g8(m, 0xC4BA, r8(s, 1) & 1); g8(m, 0xC4BB, r8(s, 2) & 1); g8(m, 0xC4BC, r8(s, 3) & 1); g8(m, 0xC4BD, r8(s, 4) % 3);
  g8(m, 0xC4A8, pick(s, 5, [0, 0, 1, 9, 10, 20])); g8(m, 0xC4A9, pick(s, 6, [0, 1, 5, 12, 16])); g8(m, 0xC4AA, pick(s, 7, [0, 1, 4, 13, 16]));
  g8(m, 0xC4AB, pick(s, 8, [0, 0, 1, 8, 0x28])); g8(m, 0xC4AF, r8(s, 9) & 1); g8(m, 0xC4DA, r8(s, 10) & 1);
  g8(m, 0xC4D8, pick(s, 11, [0, 0, 4, 6])); g8(m, 0xC7B8, r8(s, 12) % 5 === 0 ? 1 : 0);
  if (r8(s, 13) & 1) { g16(m, 0xC406, -(r16(s, 14) % 0x220)); g16(m, 0xC402, (r16(s, 15) % 0x500) - 0x280); }
  g8(m, 0xC78C, r8(s, 16) % 4 === 0 ? 1 : 0);
  for (const a of [0xC790, 0xC792, 0xC794, 0xC796]) g16(m, a, (r16(s, a) % 0x800) - 0x400);
  for (const a of [0xC460, 0xC462, 0xC464, 0xC466, 0xC480, 0xC482]) if (r8(s, a) & 1) g16(m, a, (r16(s, a + 1) % 0x1000) - 0x800);
  for (let b = 4; b < 8; b++) if (r8(s, 20 + b) & 1) c8(m, b, 0xDF96, r8(s, 30 + b));
}
// a HUD object slot in a random state (bank 4 $DD80 + 16 k): handler, curve, step, flags, anchor
function objSlots(m, s) {
  const handlers = [0x4758, 0x475E, 0x4764, 0x4764, 0x4781];
  for (let k = 0; k < 5; k++) {
    const b = 0xDD80 + k * 16;
    if (r8(s, 40 + k) % 3 === 0) { c8(m, 4, b, 0xFF); continue; }
    c8(m, 4, b, r8(s, 50 + k) % 16); c8(m, 4, b + 1, r8(s, 60 + k) & 0x81);
    c16(m, 4, b + 8, pick(s, 70 + k, handlers)); c8(m, 4, b + 12, r8(s, 80 + k) & 1); c8(m, 4, b + 13, r8(s, 90 + k) % 12);
    c8(m, 4, b + 14, r8(s, 100 + k) & 15); c8(m, 4, b + 15, r8(s, 110 + k) & 1);
    c8(m, 4, b + 6, r8(s, 120 + k)); c8(m, 4, b + 7, r8(s, 130 + k)); c8(m, 4, b + 10, r8(s, 140 + k)); c8(m, 4, b + 11, r8(s, 150 + k));
  }
}
const scores = (m, s) => { for (const [a, n] of [[0xC8E4, 8], [0xC8E5, 8], [0xC8E7, 2], [0xC8E6, 2], [0xC4D3, 2], [0xC8EE, 2], [0xC4D4, 4], [0xC494, 5], [0xC7BD, 2], [0xC4CF, 4], [0xC7BB, 2]]) g8(m, a, r8(s, a) % n); };
const DRAW = [
  E("ClearSpriteSlots", 8, 0x630E),
  E("UpdateBallVisuals", 8, 0x5153), E("UpdateBallVisuals/forced", 8, 0x5153, { prep: ballDraw }),
  E("BuildNetBallSlot/forced", 8, 0x528C, { prep: ballDraw }),
  E("DrawActorsByDepth", 8, 0x6429), E("DrawActorsByDepth/forced", 8, 0x6429, { prep: ballDraw }),
  E("DrawMarkersAndShadows", 8, 0x6481), E("DrawMarkersAndShadows/forced", 8, 0x6481, { prep: ballDraw }),
  E("DrawBallTouchCharEffect/forced", 8, 0x5482, { prep: ballDraw }),
  E("ApplyCameraProjection", 8, 0x59BB, { out: ["a", "d", "e", "h", "l"], regs: s => ({ h: r8(s, 1), l: r8(s, 2), b: r8(s, 3), c: r8(s, 4) }) }),
  E("UpdateMatchFrame", 8, 0x41F7), E("UpdateMatchFrame/forced", 8, 0x41F7, { prep: (m, s) => { ballDraw(m, s); objSlots(m, s); g8(m, 0xC4C0, r8(s, 200) % 4 === 0 ? 0xFF : 0); g8(m, 0xC4C1, r8(s, 201) % 4 === 0 ? 0xFF : 0); } }),
];
const OBJ = [
  E("UpdateAllObjSprites", 9, 0x4695), E("UpdateAllObjSprites/forced", 9, 0x4695, { prep: objSlots }),
  ...Array.from({ length: 29 }, (_, a) => E(`ShowCourtBanner ${a}`, 9, 0x4367, { regs: () => ({ a }), prep: objSlots })),
  E("HideCourtBanner", 9, 0x437B, { prep: objSlots }),
  E("SpawnServeIndicatorObjs", 9, 0x4242, { prep: (m, s) => { objSlots(m, s); scores(m, s); } }),
  E("DismissServeIndicatorObjs", 9, 0x4282, { prep: objSlots }),
  E("SpawnGameScoreDisplayObjs", 9, 0x412A, { prep: (m, s) => { objSlots(m, s); scores(m, s); c8(m, 4, 0xDF0A, r8(s, 9) & 3); } }),
  E("DismissGameScoreDisplayObjs", 9, 0x4190, { prep: (m, s) => { objSlots(m, s); scores(m, s); } }),
  E("SpawnGameResultObj", 9, 0x422C, { prep: objSlots }), E("DismissGameResultObj", 9, 0x4238, { prep: objSlots }),
  E("SpawnWinLoseResultObj", 9, 0x42D8, { regs: s => ({ a: pick(s, 1, [1, 0xFF]) }), prep: (m, s) => { objSlots(m, s); scores(m, s); } }),
  E("DismissWinLoseResultObj", 9, 0x42F6, { prep: objSlots }),
  E("InitAllObjSlots", 9, 0x4555),
  E("UpdatePointDigitsDisplay", 9, 0x4036, { prep: scores }), E("UpdateScorePanelDisplay", 9, 0x4098, { prep: scores }),
  E("LoadServeGfx", 9, 0x6C40, { prep: scores }),
  E("GetPointScoreForDisplay", 9, 0x4082, { prep: scores, out: ["a", "d", "e"] }),
  E("LoadScoreDigitGfx", 9, 0x6100, { regs: s => ({ a: r8(s, 1) % 10, b: r8(s, 2) & 1, d: 0x83, e: 0x00 }) }),
];
// the match loop's routines that do not wait (match_loop.js)
const posPrep = (m, s) => { scores(m, s); g8(m, 0xC8EC, r8(s, 300) % 13); g8(m, 0xC8ED, r8(s, 301) % 24); for (let b = 4; b < 8; b++) { c8(m, b, 0xDF0A, r8(s, 310 + b) & 3); c8(m, b, 0xDF09, r8(s, 320 + b) & 3); c8(m, b, 0xDF19, r8(s, 330 + b) % 3); } };
const LOOP = [
  E("ResetPointState", 8, 0x4CB9), E("ResetPointState/forced", 8, 0x4CB9, { prep: (m, s) => { posPrep(m, s); g8(m, 0xC7B8, r8(s, 1) & 1); } }),
  E("ResetMatchState", 8, 0x40AB, { prep: (m, s) => { g8(m, 0xC8A7, r8(s, 1) & 1); g8(m, 0xC8F5, r8(s, 2) % 3); g8(m, 0xC8A6, pick(s, 3, [4, 8, 9])); g8(m, 0xC8F2, r8(s, 4) & 1); } }),
  E("EndPointBallEffects", 8, 0x4FA4), E("ResetBallState", 8, 0x511C),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(a => E(`SetBallTrailColor ${a}`, 8, 0x5189, { regs: () => ({ a }) })),
  ...[4, 5, 6, 7].map(b => E(`ResetCharForPoint@${b}`, 8, 0x4F6F, { wram: b, prep: posPrep })),
  ...[4, 5, 6, 7].map(b => E(`CharPointEndReaction@${b}`, 8, 0x4FC7, { wram: b, prep: (m, s) => { posPrep(m, s); g8(m, 0xC8EB, pick(s, 5, [0, 1, 0xFF])); } })),
  E("FindServerCharBank", 8, 0x46E7, { prep: posPrep, out: ["b"] }),
  E("IdentifyServingPlayer", 8, 0x4C7A, { prep: posPrep }),
  E("CheckAllCharsPhaseDone", 8, 0x6063, { prep: posPrep, out: ["a", "f"] }),
  E("ComputePairSpread", 8, 0x506E, { regs: s => ({ d: r8(s, 1), e: r8(s, 2), h: r8(s, 1) ^ (r8(s, 3) & 3), l: r8(s, 4) }), out: ["d", "e", "b", "c"] }),
  E("GetServeCameraTarget", 8, 0x6199, { prep: posPrep, out: ["h", "l", "d", "e"] }),
  E("ForEachCharBank SetCharFacingFromCourtPos", 8, 0x6A3A, { regs: () => ({ h: 0x4C, l: 0x99 }), prep: posPrep }),
  E("StartCharChangeoverWalk@5", 8, 0x5FE5, { wram: 5, prep: posPrep }), E("PlaceCharAtBasePosition@5", 8, 0x6003, { wram: 5, prep: posPrep }),
  E("SelectScoreboardLayout", 8, 0x454B, { prep: (m, s) => { g8(m, 0xC8F5, r8(s, 1) % 3); for (const a of [0xC7B8, 0xC7B9, 0xC7BA, 0xC7BB, 0xC7BC]) g8(m, a, r8(s, a) % 3 === 0 ? 1 : 0); } }),
];

// match.js: setup, the court's scoreboard, the minigame helpers
const gate = (m, s) => { for (const a of [0xC798, 0xC79A, 0xC79C, 0xC79E, 0xC790, 0xC792, 0xC794, 0xC796]) g16(m, a, (r16(s, a) % 0x600) - 0x300); g16(m, 0xC416, (r16(s, 5) % 0x600) - 0x300); };
const MATCH = [
  E("InitDefaultMatchSettings", 8, 0x4070), E("InitMinigameMatchSettings", 8, 0x6544),
  E("InitViewFlipPreference", 8, 0x450E, { prep: (m, s) => { g8(m, 0xC8A6, pick(s, 1, [4, 8, 9, 5])); g8(m, 0xC8F5, r8(s, 2) % 3); } }),
  E("ApplyMatchBgmPreference", 8, 0x4539, { prep: (m, s) => { g8(m, 0xC8A6, pick(s, 1, [4, 9])); } }),
  E("LoadCourtSceneData", 8, 0x5E28, { prep: (m, s) => g8(m, 0xC8F4, r8(s, 1) % 3) }),
  E("SnapshotCourtTilemaps", 8, 0x5E52),
  E("RefreshCourtScoreboard", 8, 0x5E93, { prep: (m, s) => { g8(m, 0xC4C8, r8(s, 1) % 3); g8(m, 0xC4CB, r8(s, 2) & 1); } }),
  E("InitMatchScene", 8, 0x4145, { prep: (m, s) => { g8(m, 0xC8F4, r8(s, 1) % 3); g8(m, 0xC8A6, pick(s, 2, [4, 9])); } }),
  E("CallModeHook (none)", 8, 0x66F1, { regs: s => ({ d: r8(s, 1) & 7 }), prep: m => g8(m, 0xC7B4, 0) }),
  E("SetModeHookTable", 8, 0x671A, { regs: s => ({ a: r8(s, 1), d: r8(s, 2), e: r8(s, 3) }) }),
  E("LoadMinigamePointLayout", 8, 0x6662, { prep: (m, s) => { g8(m, 0xC7B4, pick(s, 1, [0, 0x0A, 0x0D, 0x1B])); g16(m, 0xC7B0, 0x4000 + (r16(s, 2) & 0x3FF8)); g8(m, 0xC8ED, r8(s, 3) % 8); } }),
  E("SetBallGatePoint1", 8, 0x6731, { regs: s => ({ h: r8(s, 1), l: r8(s, 2), d: r8(s, 3), e: r8(s, 4) }), out: ["b", "c"] }),
  E("SetTargetZoneCorner2", 8, 0x675E, { regs: s => ({ h: r8(s, 1), l: r8(s, 2), d: r8(s, 3), e: r8(s, 4) }), out: ["b", "c"] }),
  E("DidBallCrossGate", 8, 0x676D, { prep: gate, out: ["a", "f"] }),
  E("IsBallInTargetZone", 8, 0x67C2, { prep: gate, out: ["a", "f"] }),
];

// the smaller engine routines (engine_hooks.js MORE), on the engine tests' scrambled states: a routine is run with
// the inputs another routine's forced entries set up (cycled by state)
const ENG = new Map();
for (const f of fs.readdirSync(dir).filter(f => /^routines.*\.mjs$/.test(f)).sort())
  for (const R of (await import(new URL(f, dir))).ROUTINES) ENG.set(R.name, R);
const prepsOf = re => [...ENG.values()].filter(R => re.test(R.name) && R.prep).map(R => R.prep);
const cycled = preps => (m, s) => preps[s.f % preps.length](m, s);
const AI_PREPS = prepsOf(/^CharInputHandler1_08\//), SHOT_PREPS = prepsOf(/^ExecuteShot\/.*\/w4$/), SCORE_PREPS = prepsOf(/^ScorePoint$/);
const DISPATCH = { 0x6AE2: 3, 0x6BD9: 2, 0x6BEA: 1, 0x6CBE: 5, 0x6CC8: 4, 0x6D0E: 6, 0x6D16: 7 };   // the character-state dispatchers
const STATE_PREPS = b => prepsOf(new RegExp(`^UpdateCharStateMachine/forced@${b}$`));
const MORE = [
  ...[0x796D, 0x7992, 0x799E, 0x79B0, 0x79C2, 0x7A02, 0x7A4D, 0x7A5F, 0x7ADD, 0x7AE7, 0x7C10, 0x7C21, 0x7CAE, 0x7CED,
    0x7D0A, 0x7D23, 0x7D73, 0x7DAD, 0x7DCB, 0x7E08, 0x7E22, 0x7E7E, 0x7E99, 0x7EB1, 0x7EC0,
    0x7ED2, 0x7F11, 0x7F8A].map(addr => E(`ai 08:${addr.toString(16)}`, 8, addr, { wram: 5, prep: cycled(AI_PREPS) })),
  // the AI's state dispatchers (rst $00 on wAiPhase), with phases in their tables
  ...[[0x79F2, /\/singles s3 p/], [0x7CFA, /\/singles s1 p/], [0x7CA4, /\/singles s2 p/], [0x7E52, /\/doubles-net s1 p/], [0x7E68, /\/doubles-base s1 p/],
    [0x7DF2, /\/doubles-net s2 p/], [0x7DFC, /\/doubles-base s2 p/]].map(([addr, re]) => E(`ai 08:${addr.toString(16)}`, 8, addr, { wram: 5, prep: cycled(prepsOf(new RegExp("^CharInputHandler1_08" + re.source))) })),
  E("AiSetMirroredTarget", 8, 0x79D3, { wram: 5, prep: cycled(AI_PREPS), regs: s => ({ h: r8(s, 1), l: r8(s, 2), d: r8(s, 3), e: r8(s, 4) }) }),
  E("AiIsIncomingDropOrLobShot", 8, 0x79D9, { wram: 5, prep: cycled(AI_PREPS), out: ["a"] }),
  E("AiIsIncomingLobShot", 8, 0x79E0, { wram: 5, prep: cycled(AI_PREPS), out: ["a"] }),
  E("CharIndexToWramBank", 8, 0x7C30, { regs: s => ({ a: r8(s, 1) }), out: ["a"] }),
  E("OffsetFromBallLanding", 8, 0x7C57, { regs: s => ({ h: r8(s, 1), l: r8(s, 2) }), out: ["h", "l", "d", "e"] }),
  ...[4, 5, 6, 7].flatMap(b => [0x6A8B, 0x6A90, 0x6AE2, 0x6BD9, 0x6BEA, 0x6CBE, 0x6CC8, 0x6D0E, 0x6D16, 0x6AF2, 0x6B33, 0x6B3F, 0x6B8D, 0x6BC2,
    0x6BE3, 0x6BF8, 0x6C2F, 0x6C7A, 0x6C99, 0x6CD4, 0x6CDB, 0x6D27, 0x6D3E, 0x6D4B, 0x69C2, 0x69D5, 0x7441, 0x745B, 0x7475, 0x74A1, 0x74D7, 0x750C,
    0x7855, 0x782D, 0x7833, 0x783F, 0x4274, 0x4F91, 0x6046, 0x6059, 0x4971].map(addr => E(`char 08:${addr.toString(16)}@${b}`, 8, addr, { wram: b, prep: (m, s) => {
      cycled(STATE_PREPS(b))(m, s); m.hram[0x42] = r8(s, 7) % 3; m.hram[0x53] = r8(s, 8); m.hram[0x54] = r8(s, 9); m.hram[0x55] = r8(s, 10);
      const n = DISPATCH[addr]; if (n !== undefined) { c8(m, b, 0xDF18, n); c8(m, b, 0xDF19, r8(s, 11) % [1, 4, 2, 5, 3, 2, 1, 3][n]); } } }))),
  ...[4, 5].map(b => E(`DrawOffscreenCharArrow@${b}`, 8, 0x7704, { wram: b, prep: cycled(STATE_PREPS(b)), regs: s => ({ d: r8(s, 1), e: r8(s, 2) }) })),
  ...[0x58BE, 0x58D3, 0x58EC, 0x5901, 0x591A, 0x592D, 0x593D, 0x5952, 0x5967, 0x597C, 0x5991, 0x59A8, 0x59C5, 0x59D2, 0x59DF]
    .map(addr => E(`shot 07:${addr.toString(16)}`, 7, addr, { prep: cycled(SHOT_PREPS) })),
  ...[0x5183, 0x519B, 0x51B3, 0x51CB, 0x51E3, 0x5248, 0x5222, 0x5235, 0x520F, 0x51F9, 0x525B, 0x5268, 0x5275, 0x5284, 0x5293]
    .map(addr => E(`placement 07:${addr.toString(16)}`, 7, addr, { prep: cycled(SHOT_PREPS), out: ["b", "c"] })),
  ...[0x52F1, 0x5301, 0x531D, 0x5345, 0x535C, 0x537F, 0x53A2].map(addr => E(`speed 07:${addr.toString(16)}`, 7, addr, { prep: cycled(SHOT_PREPS),
    regs: s => ({ b: r8(s, 1) & 0x3F, c: r8(s, 2) }), out: ["b", "c"] })),
  E("LoadShotPlacementEntry", 7, 0x52A0, { prep: cycled(SHOT_PREPS), regs: s => ({ h: 0x4F, l: 0x11 + (r8(s, 1) & 0xF0), d: r8(s, 2) & 7, e: r8(s, 3) & 7 }), out: ["b", "c"] }),
  ...[0x5BC6, 0x5BDB, 0x5BF4, 0x5C14, 0x5C47, 0x5C53, 0x5C5F, 0x5C6F, 0x5C7F, 0x5C90, 0x5CA1, 0x4D63, 0x47EF, 0x5001, 0x5034, 0x43E5, 0x4274]
    .map(addr => E(`flow 08:${addr.toString(16)}`, 8, addr, { prep: cycled(SCORE_PREPS), regs: s => ({ b: r8(s, 1) % 8 }) })),
  E("EvalWinByTwo", 8, 0x5D71, { regs: s => ({ d: r8(s, 1) % 9, e: r8(s, 2) % 9, b: r8(s, 3) % 8, c: r8(s, 4) % 8 }), out: ["a"] }),
  E("LoadPositionRecord", 8, 0x48ED, { regs: s => ({ a: r8(s, 1) % 4, h: 0x49, l: 0x79 }) }), E("LoadPositionRecord.doubles", 8, 0x491A, { regs: s => ({ a: r8(s, 1) % 24, h: 0x4A, l: 0x99 }) }),
  E("GetBallHeightSign", 8, 0x4677, { prep: ballDraw, out: ["a"] }),
  E("MulMem24ByFrac", 8, 0x468B, { regs: s => ({ h: 0xC4, l: pick(s, 1, [0x20, 0x23, 0x26]), b: r8(s, 2) }), out: ["a", "d", "e"] }),
  E("MulHLByDESigned32", 8, 0x59FB, { regs: s => ({ h: r8(s, 1), l: r8(s, 2), d: r8(s, 3), e: r8(s, 4) }), out: ["h", "l"] }),
  E("MulHLByDEAbs", 8, 0x5A1D, { regs: s => ({ h: r8(s, 1), l: r8(s, 2), d: r8(s, 3), e: r8(s, 4) }), out: ["h", "l"] }),
  E("MulSignedHLByAFrac", 8, 0x5A39, { regs: s => ({ h: r8(s, 1), l: r8(s, 2), a: r8(s, 3) }), out: ["h", "l", "a"] }),
  E("MulHLByTangent", 8, 0x5A51, { regs: s => ({ h: r8(s, 1), l: r8(s, 2), b: r8(s, 3), c: r8(s, 4) }), out: ["d", "e"] }),
  E("NegateADE", 8, 0x5A63, { regs: s => ({ a: pick(s, 1, [0, r8(s, 2)]), d: r8(s, 3), e: r8(s, 4) }), out: ["a", "d", "e"] }),
  E("UnusedAbsADE", 8, 0x5A60, { regs: s => ({ a: r8(s, 2), d: r8(s, 3), e: r8(s, 4) }), out: ["a", "d", "e"] }),
  E("AddVel24ToPos32", 8, 0x5A87, { regs: s => ({ h: 0xC4, l: pick(s, 1, [0x00, 0x04, 0x08]), d: 0xC4, e: pick(s, 2, [0x20, 0x23, 0x26]) }), out: ["a", "h", "l", "d", "e"] }),
  E("Add24ToMem24", 8, 0x5A9E, { regs: s => ({ h: 0xC4, l: pick(s, 1, [0x20, 0x23, 0x26]), a: r8(s, 2), d: r8(s, 3), e: r8(s, 4) }), out: ["a", "h", "l"] }),
  ...[0x5AA7, 0x5A77, 0x5AB7, 0x5AC7].map(addr => E(`mem24 08:${addr.toString(16)}`, 8, addr, { regs: s => ({ h: 0xC4, l: pick(s, 1, [0x20, 0x23, 0x26]), d: r8(s, 3), e: r8(s, 4), b: r8(s, 5), c: r8(s, 6) }), out: ["a", "h", "l", "b", "c"] })),
  E("LookupCharSpriteSet", 7, 0x5A43, { regs: s => ({ a: r8(s, 1) }), out: ["a"] }),
  ...[4, 5].map(b => E(`SetupCharacterSprite@${b}`, 7, 0x5A70, { wram: b, regs: s => ({ d: pick(s, 1, [0, 5, 0x10, 0x17]), e: r8(s, 2) & 7 }) })),
  E("OverrideCharStatsForDebug", 7, 0x5CF4, { wram: 5 }),
];

export const ROUTINES = [...ENGINE, ...DRAW, ...OBJ, ...LOOP, ...MATCH, ...MORE];

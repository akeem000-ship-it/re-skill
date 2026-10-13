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

export const ROUTINES = [...ENGINE, ...DRAW, ...OBJ, ...LOOP, ...MATCH];

// Routine tests for web/js/port/minigames (run by web/tests/port_routines.mjs; filter "MG"): the routines of the
// training drills (bank $0B) and the minigames (bank $0D) that do not wait for frames. Registers come from the
// state (a hash of the recording and frame), and prep() writes the RAM the routine reads — rally lengths, point
// outcomes, counters, the characters' state bits, the minigame actors — drawn the same way, so every branch is
// reached across the states. The states are best taken from recordings of the minigames themselves:
//   node web/tests/port_routines.mjs MG --rec out/engine/rec2.mtrec,out/port/minigame_banana.mtrec,out/port/mg_1c.mtrec
// (the recordings made for the lockstep; see web/js/port/minigames/minigame_core.js).
// The ROM side runs with interrupts off (romCall); so does the port here.
const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];

function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
let salt = 0;
const regsOf = gen => { const k = ++salt * 7919; return s => {
  const r = rng(s, k), g = { a: r(256), f: r(16) << 4, bc: r(0x10000), de: r(0x10000), hl: r(0x10000), ...gen(r, s) };
  return { a: g.a, f: g.f, b: g.bc >> 8, c: g.bc & 0xFF, d: g.de >> 8, e: g.de & 0xFF, h: g.hl >> 8, l: g.hl & 0xFF };
}; };
const pick = (r, list) => list[r(list.length)];
// RAM (WRAM0 / HRAM as mapped; a character's struct in WRAM 4 + n)
const W = (mem, addr, v) => mem.write(addr, v & 0xFF);
const W16 = (mem, addr, v) => { W(mem, addr, v); W(mem, addr + 1, v >> 8); };
const CHARW = (mem, n, off, v) => { mem.wram[4 + n][off - 0xD000] = v & 0xFF; };
const BANKED = (mem, bank, addr, v) => { mem.wram[bank][addr - 0xD000] = v & 0xFF; };
const R = {
  pointWinLoseFlag: 0xC8EB, totalPoints: 0xC8ED, practice: 0xC7BB, shotBits: 0xC2FC, p1: 0xC8E4, p2: 0xC8E5,
  judgement: 0xC2FF, rally: 0xC4B6, outcome: 0xC4D8, bounce: 0xC4B2, hasBounced: 0xC4BF, shotType: 0xC4A0,
  recoil: 0xC4A1, lastShot: 0xC4B8, special: 0xC4A5, serving: 0xC4D3, msg: 0xC2E6, counters: 0xC2E7,
  hitBits: 0xC2E4, gateBits: 0xC2E5, gateActive: 0xC78B, zone: 0xC78C, abortActive: 0xC2E1, abortCount: 0xC2E0,
  doubleFaults: 0xC8C6, leftHanded: 0xC90E, ace: 0xC4D0, minigameId: 0xC8F7, level: 0xC376, highScoreMode: 0xC7BC,
  score: 0xC47C, target: 0xC47E, highScore: 0xC4EC, streak: 0xC789, hitScored: 0xC788, popupTimer: 0xC787,
  serveSlot: 0xC785, serveSpeed: 0xC784, serveGroup: 0xC786, serveCount: 0xC780, serveState: 0xC7A7,
  shotRoll: 0xC7A5, lastShotButtons: 0xC490, grid: 0xC7C0, lastCell: 0xC7BF, hitPending: 0xC78E, hitType: 0xC78D,
  tileHit: 0xC7A6, pointWinLose: 0xC8EB, wPointOutcomeSide: 0xC4D9,
};
const STATE_BIT4 = 0xDF50;
// a drill's point in a random state: the RAM every judge reads
function randomPoint(mem, r) {
  W(mem, R.judgement, r(3) ? 0 : pick(r, [1, 0xFF]));
  W(mem, R.outcome, r(12));
  W(mem, R.bounce, r(3));
  W(mem, R.hasBounced, r(2));
  W(mem, R.shotType, pick(r, [0, 1, 2, 4, 9, 10, 11, r(16)]));
  W(mem, R.recoil, r(3));
  W(mem, R.lastShot, r(2));
  W(mem, R.special, r(2));
  W(mem, R.totalPoints, r(9));
  W(mem, R.serving, r(2));
  W(mem, R.hitBits, r(256)); W(mem, R.gateBits, r(256));
  W(mem, R.leftHanded, r(2));
  W(mem, R.doubleFaults, pick(r, [0, 0, 1, 4]));
  for (let i = 0; i < 9; i++) W(mem, R.counters + i, pick(r, [0, 1, 2, 3, 4, r(256)]));
  CHARW(mem, 0, STATE_BIT4, r(256)); CHARW(mem, 1, STATE_BIT4, r(256));
}
const inMatch = s => s.m.mem.wram[0][0x7B4] !== 0;                 // wModeHookBank: a drill or minigame running
// an entry: bank:addr with registers from gen and RAM from prep(mem, r, s)
const M = (name, bank, addr, { gen = () => ({}), out = [], prep, when, wram } = {}) => {
  const k = ++salt * 104729;
  return {
    name: `MG ${name}`, bank, addr, out, regs: regsOf(gen), when, wram,
    prep: prep ? (mem, s) => prep(mem, rng(s, k), s) : undefined,
    js(P, regs) { P.ime = false; P.cpu.halted = false; return P.callRom(bank, addr, regs); },
  };
};
const B0B = 0x0B, B0D = 0x0D;
// a judge: JudgePoint with a = event, the rally length within its table
const J = (name, addr, rallies) => M(name, B0B, addr, {
  gen: r => ({ a: r(4) }), out: ["a"],
  prep: (mem, r) => { randomPoint(mem, r); W(mem, R.rally, 1 + r(rallies)); },
});
// the drills' four JudgeOn* routines, with the rally length within the table
const JO = (name, addrs, rallies) => addrs.map((addr, i) => M(`${name} JudgeOn ${i}`, B0B, addr, {
  prep: (mem, r) => { randomPoint(mem, r); W(mem, R.rally, 1 + r(rallies)); },
}));
const ANY = (name, bank, addr, opts = {}) => M(name, bank, addr, { prep: (mem, r) => randomPoint(mem, r), ...opts });

// actors for the minigame states: active ones with random states and timers (handler as the game set it)
function randomActors(mem, r, handler) {
  for (let i = 0; i < 7; i++) {
    const at = 0xDC00 + i * 16;
    if (handler) { BANKED(mem, 4, at, 3); BANKED(mem, 4, at + 14, handler & 0xFF); BANKED(mem, 4, at + 15, handler >> 8); }
    BANKED(mem, 4, at + 1, r(4)); BANKED(mem, 4, at + 2, r(5)); BANKED(mem, 4, at + 3, pick(r, [0, 1, 2, 0x10, 0x20]));
    for (let j = 6; j < 14; j++) BANKED(mem, 4, at + j, r(256));
  }
  for (let j = 0; j < 16; j++) BANKED(mem, 4, 0xDC70 + j, mem.wram[4][0xC00 + j]);
}
// the ball near or far from the scene actor, for the hit-zone tests
function ballNear(mem, r) {
  const sx = mem.wram[4][0xC76] | mem.wram[4][0xC77] << 8, sd = mem.wram[4][0xC78] | mem.wram[4][0xC79] << 8;
  const near = v => (v + (r(2) ? r(0x200) - 0x100 : r(0x10000))) & 0xFFFF;
  W16(mem, 0xC402, near(sx)); W16(mem, 0xC406, near(sd)); W16(mem, 0xC40A, r(2) ? r(0x180) - 0xC0 : r(0x10000));
  W(mem, R.lastShot, r(2)); W(mem, R.shotType, pick(r, [9, 1, r(16)]));
}
function randomScore(mem, r) {
  W16(mem, R.score, pick(r, [0, 1, 29, 30, 31, 9998, 9999, r(0x10000)]));
  W16(mem, R.target, pick(r, [0, 30, 100, r(0x10000)]));
  W16(mem, R.highScore, pick(r, [0, 30, 9999, r(0x10000)]));
  W(mem, R.streak, r(9)); W(mem, R.hitScored, r(2)); W(mem, R.highScoreMode, r(2)); W(mem, R.level, r(3));
  W(mem, R.outcome, pick(r, [0, 5, 6, 9, 0x0B, r(12)]));
}

export const ROUTINES = [
  // ---- drills.js ----
  M("RecordDrillPointResultBits", B0B, 0x407B, { prep: (mem, r) => { W(mem, R.pointWinLoseFlag, pick(r, [0, 1, 0xFF, r(256)])); W(mem, R.totalPoints, pick(r, [r(9), r(256)])); W(mem, R.practice, r(2)); } }),
  M("CountDrillShotSuccesses", B0B, 0x40C0, { gen: r => ({ a: r(3) }), out: ["a", "b", "c", "h", "l"], prep: (mem, r) => { for (let i = 0; i < 3; i++) W(mem, R.shotBits + i, r(256)); } }),
  M("Unused_0b_CheckTwoPointLead", B0B, 0x40FD, { out: ["a", "b"], prep: (mem, r) => { W(mem, R.p1, r(8)); W(mem, R.p2, r(8)); } }),
  M("Unused_0b_GetBallXAndDepth", B0B, 0x4122, { out: ["a", "d", "e", "h", "l"] }),
  M("UnusedGetObjectXAndDepth", B0B, 0x412F, { gen: r => ({ a: r(32) }), out: ["a", "b", "c", "d", "e", "h", "l"], wram: 4 }),
  M("ResetActiveCharState", B0B, 0x414B, { when: inMatch }),
  M("IndexDrillTableByPoint", B0B, 0x415F, { gen: r => ({ hl: pick(r, [0x4A6A, 0x52E0]) }), prep: (mem, r) => W(mem, R.totalPoints, r(8)) }),
  M("SetDrillTargetZoneForPoint", B0B, 0x4191, { gen: r => ({ hl: pick(r, [0x4EA0, 0x5060, 0x5302, 0x5CD7, 0x6C5F]) }), prep: (mem, r) => W(mem, R.totalPoints, r(4)) }),
  M("UpdateDrillAbortCountdown", B0B, 0x41C3, { prep: (mem, r) => { W(mem, R.abortActive, r(2)); W(mem, R.outcome, r(2) ? 0 : r(10)); W(mem, R.abortCount, r(3)); } }),
  ANY("RecordDrillTargetZoneHitIfInPlay", B0B, 0x41DA, { when: inMatch }),
  ANY("RecordDrillTargetZoneHit", B0B, 0x41E6, { when: inMatch }),
  ANY("CountDrillResultBitsSet", B0B, 0x420B, { out: ["a", "b", "c"] }),
  ANY("CheckDrillTargetZoneMissed", B0B, 0x421C, { out: ["a", "f", "b", "c"] }),
  ANY("RecordGateCrossOnServe", B0B, 0x4233, { when: inMatch, prep: (mem, r) => { randomPoint(mem, r); W(mem, R.rally, r(2) + 1); W(mem, R.gateActive, r(2)); } }),
  ANY("CountDrillResultBitsSetAlt", B0B, 0x4257, { out: ["a", "b", "c"] }),
  ANY("CountDrillResultBitsThisGame", B0B, 0x4268, { out: ["a", "f", "b", "c"] }),
  M("Unused_0b_WriteCharStructByte", B0B, 0x442B, { gen: r => ({ a: r(256), hl: r(0x80) }) }),
  M("UnusedSetAiReactionDelayFar", B0B, 0x4440, { gen: r => ({ a: r(256) }) }),
  ANY("TestCharStateBit4", B0B, 0x4447, { gen: r => ({ a: r(2) }), out: ["a", "f", "b"] }),
  ANY("SyncPointWinLoseFlagTask", B0B, 0x446E),
  ANY("UnusedQueueDrillOutcomeMessage", B0B, 0x4484, { prep: (mem, r) => { randomPoint(mem, r); W(mem, R.rally, 1 + r(3)); W(mem, R.ace, r(2)); W(mem, R.minigameId, r(4)); } }),
  ANY("QueueDrillOutcomeMessage", B0B, 0x44F2, { prep: (mem, r) => { randomPoint(mem, r); W(mem, R.rally, 1 + r(3)); W(mem, R.ace, r(2)); } }),
  ANY("QueueDrillResultMessage", B0B, 0x4534, { gen: r => ({ a: pick(r, [0xFF, r(256)]), bc: r(0x10000) }) }),
  ANY("SetDrillMessageByServer", B0B, 0x4545, { gen: r => ({ a: pick(r, [0xFF, r(256)]), bc: r(0x10000) }) }),
  ANY("SetDrillMessageByRallyParity", B0B, 0x4558, { gen: r => ({ a: pick(r, [0xFF, r(256)]), bc: r(0x10000) }), prep: (mem, r) => { randomPoint(mem, r); W(mem, R.rally, r(6)); } }),
  M("QueueDrillMarker1_0b", B0B, 0x46A0, { when: inMatch, prep: (mem, r) => W(mem, R.gateActive, r(2)) }),
  M("QueueDrillMarker2_0b", B0B, 0x46C4, { when: inMatch, prep: (mem, r) => W(mem, R.gateActive, r(2)) }),
  M("FillMemoryBC_0b", B0B, 0x4823, { gen: r => ({ hl: 0xCE00 + r(0x80), bc: 1 + r(0x60) }), out: ["a", "e", "h", "l", "b", "c"] }),
  ...[0x4B05, 0x4CEE, 0x5491, 0x5724, 0x5A4F, 0x67C2, 0x6A0D].map(a => ANY(`AwardPointToSide ${a.toString(16)}`, B0B, a, { prep: (mem, r) => { randomPoint(mem, r); W(mem, R.pointWinLoseFlag, pick(r, [0, 1, 0xFF, r(256)])); } })),
  // ---- the drills' judges ----
  J("ServiceMatch1JudgePoint", 0x4922, 2), J("ServiceMatch2JudgePoint", 0x4B53, 2), J("ServiceMatch3JudgePoint", 0x4D3D, 2),
  J("NetGameMatch1JudgePoint", 0x54F9, 5), J("NetGameMatch2JudgePoint", 0x5773, 5), J("NetGameMatch3JudgePoint", 0x5A9E, 5),
  J("NetGamePractice1JudgePoint", 0x5D6D, 3), J("NetGamePractice2JudgePoint", 0x6027, 3), J("NetGamePractice3JudgePoint", 0x62E6, 3),
  J("StrokeMatch1JudgePoint", 0x6505, 8), J("StrokeMatch2JudgePoint", 0x6810, 4), J("StrokeMatch3JudgePoint", 0x6A5B, 4),
  J("StrokePractice1JudgePoint", 0x6CF5, 2), J("StrokePractice2JudgePoint", 0x6F3D, 2), J("StrokePractice3JudgePoint", 0x719F, 2),
  ...JO("ServiceMatch1", [0x48FC, 0x4905, 0x490E, 0x4918], 2), ...JO("ServiceMatch2", [0x4B2E, 0x4B37, 0x4B40, 0x4B4A], 2),
  ...JO("ServiceMatch3", [0x4D17, 0x4D20, 0x4D29, 0x4D33], 2), ...JO("NetGameMatch1", [0x54D3, 0x54DC, 0x54E5, 0x54EF], 5),
  ...JO("NetGameMatch2", [0x574D, 0x5756, 0x575F, 0x5769], 5), ...JO("NetGameMatch3", [0x5A78, 0x5A81, 0x5A8A, 0x5A94], 5),
  ...JO("NetGamePractice1", [0x5D48, 0x5D51, 0x5D5A, 0x5D63], 3), ...JO("NetGamePractice2", [0x6002, 0x600B, 0x6014, 0x601D], 3),
  ...JO("NetGamePractice3", [0x62C1, 0x62CA, 0x62D3, 0x62DC], 3), ...JO("StrokeMatch1", [0x64E0, 0x64E9, 0x64F2, 0x64FB], 8),
  ...JO("StrokeMatch2", [0x67EB, 0x67F4, 0x67FD, 0x6806], 4), ...JO("StrokeMatch3", [0x6A36, 0x6A3F, 0x6A48, 0x6A51], 4),
  ...JO("StrokePractice1", [0x6CD0, 0x6CD9, 0x6CE2, 0x6CEB], 2), ...JO("StrokePractice2", [0x6F18, 0x6F21, 0x6F2A, 0x6F33], 2),
  ...JO("StrokePractice3", [0x717A, 0x7183, 0x718C, 0x7195], 2),
  // ---- the drills' other routines that do not wait ----
  ...[["ServicePractice1EvaluateResult", 0x4E3F], ["ServicePractice2EvaluateResult", 0x4FCF], ["ServicePractice3EvaluateResult", 0x5251],
      ["NetGamePractice1EvaluateResult", 0x5C76], ["NetGamePractice2EvaluateResult", 0x5F1E], ["NetGamePractice3EvaluateResult", 0x61D0],
      ["StrokePractice1EvaluateResult", 0x6C01], ["StrokePractice2EvaluateResult", 0x6E40], ["StrokePractice3EvaluateResult", 0x70A5],
      ["NetGameMatch1DecideWinner", 0x54BA], ["StrokeMatch1AwardPointToSide", 0x64C3], ["TestBallBounceDepth", 0x66B5, ["a"]],
      ["ServicePractice1QueueOutcomeMessage", 0x4F22, ["a"]], ["ServicePractice2QueueOutcomeMessage", 0x513F, ["a"]],
      ["ServicePractice3QueueOutcomeMessage", 0x537B, ["a"]], ["ServicePractice2SetupShotTarget", 0x50E5],
      ["ServicePractice3SetupShotTarget", 0x52C3], ["UnusedNetGameMatch3JudgePoint", 0x5994, ["a"]],
      ["UnusedServeSecondBounceSound_1", 0x4E7F], ["UnusedServeSecondBounceSound_2", 0x5041],
  ].map(([n, a, out]) => ANY(n, B0B, a, { out: out || (/Evaluate/.test(n) ? ["a"] : []),
    prep: (mem, r) => { randomPoint(mem, r); W(mem, R.rally, 1 + r(4)); W(mem, R.pointWinLoseFlag, pick(r, [0, 1, 0xFF])); W(mem, R.p1, r(5)); W(mem, R.p2, r(5)); W16(mem, 0xC406, r(0x10000)); } })),
  ...[["ServiceMatch1Hook_PerFrame", 0x484D], ["ServiceMatch1Hook_PointStart", 0x4851], ["ServiceMatch2Hook_PointStart", 0x49F2],
      ["ServiceMatch2Hook_Draw", 0x49EB], ["ServiceMatch3Hook_PointStart", 0x4C37], ["ServicePractice1Hook_PointStart", 0x4E0C],
      ["ServicePractice1Hook_Bounce", 0x4E75], ["ServicePractice1Hook_BallHit", 0x4E8E], ["ServicePractice2Hook_MinigameStart", 0x4F8F],
      ["ServicePractice2Hook_PointStart", 0x4F9C], ["ServicePractice2Hook_Bounce", 0x5032], ["ServicePractice2Hook_BallHit", 0x5050],
      ["ServicePractice3Hook_MinigameStart", 0x51F3], ["ServicePractice3Hook_PerFrame", 0x51FE], ["ServicePractice3Hook_PointStart", 0x5213],
      ["ServicePractice3Hook_BallHit", 0x52B0], ["NetGameMatch3Hook_PointStart", 0x58E3], ["NetGamePractice1Hook_MinigameStart", 0x5C00],
      ["NetGamePractice1Hook_BallHit", 0x5CC9], ["NetGamePractice2Hook_BallHit", 0x5F83], ["StrokeMatch1Hook_PointStart", 0x642A],
      ["StrokeMatch1Hook_MinigameStart", 0x6420], ["StrokePractice1Hook_PointStart", 0x6B94], ["EnableTargetZoneAfterDelayTask", 0x6BD0],
      ["StrokePractice1Hook_BallHit", 0x6C52], ["StrokePractice2Hook_PointStart", 0x6DE0], ["StrokePractice2Hook_RallyTick", 0x6E92],
      ["StrokePractice3Hook_PointStart", 0x7045], ["StrokePractice3TargetZoneDelayTask", 0x7081],
  ].map(([n, a]) => ANY(n, B0B, a, { when: inMatch,
    prep: (mem, r) => { randomPoint(mem, r); W(mem, R.rally, 1 + r(3)); W(mem, R.gateActive, r(2)); W(mem, R.abortActive, r(2)); W(mem, R.abortCount, r(3)); W(mem, R.counters + 8, r(3)); } })),

  // ---- minigame_core.js ----
  M("GetMinigameTargetScore", B0D, 0x4121, { gen: r => ({ a: pick(r, [r(0x12), 0x12 + r(18), r(256)]), bc: r(3) << 8 }), out: ["a", "d", "e"] }),
  M("GetDefaultMinigameRecordValue", B0D, 0x41A6, { gen: r => ({ a: r(11) }), out: ["a", "d", "e", "h", "l"] }),
  M("IncrementCappedCounter", B0D, 0x41CB, { gen: r => ({ bc: r(9) << 8 }), prep: (mem, r) => randomScore(mem, r) }),
  M("IsMinigameTargetReached", B0D, 0x41D3, { out: ["a"], prep: (mem, r) => randomScore(mem, r) }),
  M("IsMinigameScoreLimitReached", B0D, 0x41EE, { out: ["a"], prep: (mem, r) => randomScore(mem, r) }),
  M("InitMinigameScore", B0D, 0x40CF, { when: inMatch, prep: (mem, r) => { W(mem, R.minigameId, pick(r, [0x12 + r(18), r(0x12)])); W(mem, R.level, r(3)); } }),
  M("StartScorePopup", B0D, 0x4211),
  M("UpdateScorePopup", B0D, 0x4237, { when: inMatch, prep: (mem, r) => { W(mem, R.popupTimer, r(3) ? r(0x11) : 0); W16(mem, 0xC782, r(1000)); } }),
  M("AddToMinigameScore", B0D, 0x4266, { gen: r => ({ de: pick(r, [1, 3, 7, 100, r(0x10000)]) }), out: ["d", "e"], prep: (mem, r) => randomScore(mem, r) }),
  M("GetMinigameGridCellIndex", B0D, 0x42BF, { out: ["a"], prep: (mem, r) => { for (let i = 0; i < 4; i++) BANKED(mem, 4, 0xDD1E + i, r(256)); } }),
  M("DrawMinigameGrid", B0D, 0x4302, { wram: 2, prep: (mem, r) => { for (let i = 0; i < 24; i++) W(mem, R.grid + i, r(3) ? 0 : r(8)); } }),
  M("DrawMinigameGridCell", B0D, 0x431B, { wram: 2, gen: r => ({ a: r(24), bc: r(8) << 8 }) }),
  M("QueueMinigameHudVRAMCopy", B0D, 0x43A3, { wram: 2 }),
  M("DetermineMinigamePointResult", B0D, 0x43DF, { out: ["a", "d"], prep: (mem, r) => randomScore(mem, r) }),
  M("ClearMinigameActors", B0D, 0x4440),
  M("SetMinigameActorHandler", B0D, 0x444F, { gen: r => ({ bc: 0xDC00 + r(7) * 16 }) }),
  M("SetMinigameActorPosition", B0D, 0x4465, { when: inMatch, gen: r => ({ bc: 0xDC00 + r(7) * 16 }) }),
  M("SetMinigameActorWorldPos", B0D, 0x449A, { when: inMatch, wram: 4 }),
  M("UpdateMinigameActors", B0D, 0x44BD, { when: inMatch, prep: (mem, r) => { randomActors(mem, r, pick(r, [0x5231, 0x5719, 0x5ACC, 0x5DEE])); ballNear(mem, r); randomScore(mem, r); W(mem, R.outcome, 0); } }),
  M("DrawMinigameScoreHud", B0D, 0x46D7, { when: inMatch, prep: (mem, r) => W(mem, R.serveState, r(2)) }),
  M("KeepMinigameCameraFixed", B0D, 0x47BE),
  M("CheckMinigameStartBannerTrigger", B0D, 0x47C3, { prep: (mem, r) => { W(mem, R.outcome, r(2) ? 0 : r(10)); W(mem, R.rally, pick(r, [4, r(6)])); W(mem, R.bounce, r(3)); } }),
  M("FreezeMinigameOpponentOnReturn", B0D, 0x47E2, { prep: (mem, r) => W(mem, R.rally, pick(r, [3, r(6)])) }),
  M("LaunchBall", B0D, 0x47FD, { when: inMatch, prep: (mem, r) => { W(mem, R.serveSpeed, pick(r, [r(26), r(256)])); W(mem, R.serveGroup, r(3)); } }),
  M("ApplyMinigameCharTargetFromTable", B0D, 0x48B6, { when: inMatch, prep: (mem, r) => W(mem, R.serveSlot, r(9)) }),
  M("GetMinigameCharCoordsEntry", B0D, 0x4926, { gen: r => ({ a: r(9) }), out: ["d", "e", "h", "l"] }),
  M("SnapCameraTo_0d", B0D, 0x493A),
  M("UpdateMinigameHudAndBallTrail", B0D, 0x4ABB, { when: inMatch, prep: (mem, r) => { W(mem, R.pointWinLose, r(2)); for (let i = 0; i < 18; i++) BANKED(mem, 4, 0xDD00 + i, r(256)); } }),
  M("MarkMinigameObjectOffscreen", B0D, 0x4AF1, { wram: 4, gen: r => ({ hl: 0xDD00 + r(3) * 6, de: 0xDE14 + r(3) * 4 }), prep: (mem, r) => { for (let i = 0; i < 18; i++) BANKED(mem, 4, 0xDD00 + i, r(256)); } }),
  M("StartMinigameSoloPoint", B0D, 0x4B01, { when: inMatch, prep: (mem, r) => { W(mem, R.minigameId, 0x16 + r(4)); W(mem, R.level, r(3)); } }),
  M("AwardMinigamePointAndReflectBall", B0D, 0x4B59, { when: inMatch, prep: (mem, r) => randomScore(mem, r) }),
  M("ReflectBallVelocity", B0D, 0x4B70, { when: inMatch, prep: (mem, r) => W(mem, R.outcome, r(2) ? 0 : r(10)) }),
  M("HideLandingMarkerAndExtendSoloCourt", B0D, 0x4BC8, { prep: (mem, r) => W(mem, R.rally, r(3)) }),
  M("DrawMinigameScore", B0D, 0x4BEA, { when: inMatch }),
  M("LoadMatchUiCourtTilemap", B0D, 0x50FA, { wram: 2, gen: r => ({ a: r(7) }) }),
  M("LoadTargetZoneConfig", B0D, 0x5148, { gen: r => ({ a: r(7) }) }),
  M("ProjectMinigameWorldPosition", B0D, 0x53AA, { wram: 4, out: ["b", "d", "e"], prep: (mem, r) => W(mem, R.streak, r(8)) }),
  M("QueueMinigameHitBurst", B0D, 0x53CE, { gen: r => ({ a: r(0x30), bc: 0x0F3C }) }),
  M("QueueMinigameHitBurstFirstFour", B0D, 0x53D8, { gen: r => ({ a: r(0x30), bc: 0x0F3C }), out: ["e", "h", "l"] }),
  M("QueueMinigameHitBurstFirstTwo", B0D, 0x53F6, { gen: r => ({ a: r(0x30), bc: 0x0F3C }), out: ["e", "h", "l"] }),
  // ---- games.js ----
  ...[["InitMinigame_TennisMachine2", 0x4969], ["InitMinigame_TennisMachineHighScore", 0x4CE9], ["InitMinigame_TargetShot", 0x4D9B],
      ["InitMinigame_ShootingStar", 0x51A4], ["InitMinigame_BooBlast", 0x5625], ["InitMinigame_TreasureBox", 0x59DB],
      ["InitMinigame_MedallionMatch", 0x5CFA]].map(([n, a]) => M(n, B0D, a, { prep: (mem, r) => W(mem, R.level, r(3)) })),
  M("SelectRandomMinigameShot", B0D, 0x4E20, { when: inMatch, prep: (mem, r) => W(mem, R.level, r(3)) }),
  M("CheckBallLandedOut", B0D, 0x4E80, { when: inMatch, prep: (mem, r) => W(mem, R.lastShot, r(2)) }),
  M("LookupMinigameShotResult", B0D, 0x4E96, { out: ["a"], prep: (mem, r) => { W(mem, R.shotRoll, r(8)); W(mem, R.lastShotButtons, pick(r, [0x11, 0x22, 0x21, 0x12, 0x30, r(256)])); W(mem, R.shotType, pick(r, [1, 3, 4, 6, 7, 9, 10, 11, r(16)])); } }),
  ...[["InitBallTargetActor", 0x5205], ["ResetTargetHitState", 0x521E], ["InitMinigameControllerActor", 0x5691],
      ["SpawnMedallionMatchTargets", 0x5D65], ["ResetMedallionMatchHitState", 0x5DD6], ["SelectRandomTreasureBoxTargetZone", 0x5A70],
      ["UpdateBooBlastHitStreak", 0x56F0], ["DisableOffscreenArrows", 0x56BB], ["DisableMinigameControllerActor", 0x56AA]]
    .map(([n, a]) => M(n, B0D, a, { when: inMatch, prep: (mem, r) => { randomScore(mem, r); W(mem, R.lastShot, r(2)); } })),
  // the target actors' handlers and states, on the scene actor (WRAM 4)
  ...[["ShootingStarTargetActorHandler", 0x5231], ["BooBlastControllerActorHandler", 0x5719], ["TreasureBoxTargetActorHandler", 0x5ACC],
      ["MedallionMatchTargetActorHandler", 0x5DEE], ["ShootingStarTargetState0", 0x5244], ["ShootingStarTargetState2", 0x5270],
      ["BooBlastControllerState2", 0x573D], ["TreasureBoxTargetState0", 0x5ADF], ["MedallionMatchTargetState2", 0x5E12]]
    .map(([n, a]) => M(n, B0D, a, { when: inMatch, wram: 4, prep: (mem, r) => { randomActors(mem, r, 0); ballNear(mem, r); randomScore(mem, r); W(mem, R.outcome, 0); W(mem, R.shotRoll, r(5)); W16(mem, R.serveCount, r(20)); } })),
  ...[["IsBallInHitZone", 0x5292], ["IsBallWithinTargetZone", 0x575F], ["IsBallInTreasureBoxHitZone", 0x5BC5], ["IsBallInMedallionMatchHitZone", 0x5E37]]
    .map(([n, a]) => M(n, B0D, a, { wram: 4, out: ["a"], prep: (mem, r) => { randomActors(mem, r, 0); ballNear(mem, r); } })),
  ...[["AwardHitScore", 0x52F9], ["ScoreBallHit", 0x57BE], ["AwardTreasureBoxHitScore", 0x5C2C], ["AwardMedallionMatchHitScore", 0x5E9E]]
    .map(([n, a]) => M(n, B0D, a, { wram: 4, prep: (mem, r) => { randomActors(mem, r, 0); randomScore(mem, r); W(mem, R.shotType, pick(r, [9, r(16)])); W(mem, R.streak, r(6)); } })),
  ...[["DrawTargetReticleSprite", 0x535F], ["DrawTargetHitCountdown", 0x539E], ["DrawBooBlastTargetSprite", 0x57FD], ["DrawBooBlastHitBurst", 0x583C],
      ["DrawTreasureBoxSprite", 0x5C89], ["DrawTreasureBoxHitCountdown", 0x5CCB], ["DrawMedallionMatchSprite", 0x5EF2], ["DrawMedallionMatchHitCountdown", 0x5F13]]
    .map(([n, a]) => M(n, B0D, a, { when: inMatch, wram: 4, prep: (mem, r) => { randomActors(mem, r, 0); W(mem, R.streak, r(8)); W(mem, 0xC78A, r(256)); } })),
  M("ScoreMinigameTargetHitOrDeflectBall", B0D, 0x55CA, { when: inMatch, prep: (mem, r) => { randomScore(mem, r); W(mem, R.hitPending, r(2)); W(mem, R.hitType, pick(r, [0xFF, r(4)])); W(mem, R.lastCell, pick(r, [0xFF, r(24)])); for (let i = 0; i < 24; i++) W(mem, R.grid + i, pick(r, [0, 5, 6, 7])); } }),
  M("AreAllTargetsHit", B0D, 0x59B7, { out: ["a"], prep: (mem, r) => { const all = r(2); for (let i = 0; i < 24; i++) W(mem, R.grid + i, all || r(4) ? 1 : 0); } }),
  M("ResetTargetGrid", B0D, 0x5979, { when: inMatch }),
  M("ProjectBallSprite", B0D, 0x5848, { wram: 4, out: ["b", "d", "e", "h", "l"], prep: (mem, r) => W(mem, R.streak, r(8)) }),
];

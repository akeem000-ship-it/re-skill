// Routine tests for web/js/port/story, the story-mode engine (banks 2, 4 and $0A; run by web/tests/port_routines.mjs,
// filter "Story"). Every routine that returns without waiting for a frame is called at its ROM address on the ROM
// and on the port from recorded states of the overworld (out/engine/rec2.mtrec: a mid-game story file;
// out/port/story1.mtrec: a new game from power-on), with its registers drawn per state: live actors, other slots,
// points near the actors and anywhere, random bytes; prep() makes the branches (records' levels and EXP around
// the limits, flags set and clear, actors moving or jumping, frames dirty). The generators (the story loop, the
// cutscene commands that wait) are checked by the lockstep (web/tests/port_lockstep.mjs).
// usage: node web/tests/port_routines.mjs Story --rec out/engine/rec2.mtrec,out/port/story1.mtrec --every 97

const ALL = ["a", "f", "b", "c", "d", "e", "h", "l"];
const B2 = 0x02, B4 = 0x04, BA = 0x0A;
const ACTORS = 0xD000, ACTOR_SIZE = 0x40, NUM_ACTORS = 24;
const BUF = 0xCE80;                               // a scratch record for the Raw routines (WRAM 0, off the stack page)

// ---- deterministic randomness per (state, entry) ----
function rng(s, salt) {
  let x = 2166136261 ^ salt;
  for (const ch of `${s.rec}@${s.f}`) x = Math.imul(x ^ ch.charCodeAt(0), 16777619);
  x = (x >>> 0) || 1;
  return n => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x % n; };
}
let salt = 0;

// ---- the recorded machine ----
const W4 = (s, addr) => s.m.mem.wram[4][addr - 0xD000];
const live = s => { const out = []; for (let i = 0; i < NUM_ACTORS; i++) if (W4(s, ACTORS + i * ACTOR_SIZE + 0x20)) out.push(i); return out; };
// the overworld: a story location running (the story loop's banks mapped, the player drawn)
const overworld = s => [0x04, 0x05, 0x0A].includes(s.m.mem.romBank) && W4(s, ACTORS + 0x20) === 2;
const anyState = () => true;

// prep writers (on both machines)
const W = (mem, addr, v) => mem.write(addr, v & 0xFF);
const WW = (mem, addr, v) => { W(mem, addr, v); W(mem, addr + 1, v >> 8); };
const BANKED = (mem, bank, addr, v) => { mem.wram[bank][addr - 0xD000] = v & 0xFF; };

// per-state draws: r is the entry's rng for the state
function draw(s, r) {
  const L = live(s), slot = L.length && r(4) ? L[r(L.length)] : r(NUM_ACTORS);
  const actor = ACTORS + slot * ACTOR_SIZE;
  const x = W4(s, actor + 0x0C) | W4(s, actor + 0x0D) << 8, y = W4(s, actor + 0x0E) | W4(s, actor + 0x0F) << 8;
  const near = v => (v + r(0x100) - 0x80) & 0xFFFF;
  return {
    b8: () => r(256), w: () => r(0x10000), slot, actor, L, liveActor: ACTORS + (L.length ? L[slot % L.length] : 0) * ACTOR_SIZE,
    other: () => ACTORS + (L.length ? L[r(L.length)] : r(NUM_ACTORS)) * ACTOR_SIZE,
    px: () => (r(3) ? near(x) : r(0x10000)), py: () => (r(3) ? near(y) : r(0x10000)),
    tile: () => r(64), f: () => r(16) << 4,
  };
}

// an entry: regs(d, s, r) from the draws, prep(mem, s, d) on both machines with the same draws
// the harness's ROM call takes single registers: pairs split
const singles = r => {
  const o = {};
  for (const [k, v] of Object.entries(r)) if (k.length === 2) { o[k[0]] = (v >> 8) & 0xFF; o[k[1]] = v & 0xFF; } else o[k] = v & 0xFF;
  return o;
};
function T(name, bank, addr, regs = () => ({}), opt = {}) {
  const id = ++salt;
  // the same draws for regs and for each machine's prep (a fresh rng with the entry's seed: same slot, same actor)
  const D = s => { const r = rng(s, id); return { d: draw(s, r), r }; };
  const e = {
    name: "Story " + name, bank, addr, wram: opt.wram ?? 4, out: opt.out ?? ALL, when: opt.when ?? overworld,
    regs: s => { const { d, r } = D(s); return singles({ f: d.f(), ...regs(d, s, r) }); },
  };
  // interrupts off on both machines (the ROM's routines that end with `ei`, PlaySound's, would take one on the ROM
  // side only: the port's hooks run whole)
  e.prep = (mem, s) => { if (opt.prep) opt.prep(mem, s, D(s).d); mem.ie = 0; };
  if (opt.ignore) e.ignore = opt.ignore;
  return e;
}
const randBuf = n => (mem, s, d) => { for (let i = 0; i < n; i++) W(mem, BUF + i, d.b8()); };
const setPtr = (mem, d) => WW(mem, 0xFFEA, d.actor);    // hActorPtr
// actors made to move / jump / show a dirty frame at random
const stirActors = (mem, s, d) => {
  for (const i of d.L) {
    const a = ACTORS + i * ACTOR_SIZE, bank = 4;
    if (d.b8() < 64) BANKED(mem, bank, a + 0x05, mem.wram[bank][a + 0x05 - 0xD000] ^ 0x80);
    if (d.b8() < 48) { BANKED(mem, bank, a + 0x10, d.b8()); BANKED(mem, bank, a + 0x12, d.b8()); }
    if (d.b8() < 64) BANKED(mem, bank, a + 0x30, mem.wram[bank][a + 0x30 - 0xD000] ^ 0x40);
  }
};

// story file records (wStoryMainRecord $C900, partner $C940, court slots $CA00..)
const REC = [0xC900, 0xC940];
const recPrep = (mem, s, d) => {
  for (const rec of REC) {
    const k = d.b8();
    if (k < 40) W(mem, rec + 0x18, [1, 2, 0x62, 0x63, 0x64][k % 5]);        // level round the limits
    if (k >= 40 && k < 120) { W(mem, rec + 0x2C, d.b8()); W(mem, rec + 0x2D, d.b8()); W(mem, rec + 0x2E, d.b8() & 3); }
    if (d.b8() < 60) W(mem, rec + 0x3C, d.b8() & 0x37);                      // equipment
    if (d.b8() < 60) for (let i = 0; i < 4; i++) W(mem, rec + 0x38 + i, d.b8() % 12);
  }
};

export const ROUTINES = [
  // ---- bank 4: actor slots (actor_slots.js) ----
  T("ClearActorSlots", B4, 0x4032),
  T("InitActorEngine", B4, 0x4041),
  T("SpawnActor", B4, 0x4055, d => ({ a: B4, hl: 0x41D1 })),
  T("SetActorScript", B4, 0x40AC, d => ({ bc: d.actor, a: B4, hl: [0x41D1, 0x41D8, 0x41DC, 0x41E2][d.b8() & 3] })),
  T("InitActorSlotFields", B4, 0x40AF, d => ({ bc: d.actor, a: B4, hl: 0x41D1 })),
  T("SetActorPosition", B4, 0x40C6, d => ({ bc: d.actor, hl: d.px(), de: d.py() })),
  T("UnusedSetActorTarget", B4, 0x40F4, d => ({ bc: d.actor, hl: d.px(), de: d.py(), a: d.b8() })),
  T("UnusedSetActorTargetRelative", B4, 0x4114, d => ({ bc: d.actor, hl: d.b8(), de: d.b8(), a: d.b8() })),
  T("SetActorMode", B4, 0x4148, d => ({ bc: d.actor, d: d.b8() % 3 })),
  T("AttachActorControllerScript", B4, 0x415B, d => ({ bc: d.actor })),
  T("AttachActorWaypointFollower", B4, 0x417B, d => ({ bc: d.actor, de: d.other() })),
  T("AttachActorStepMover", B4, 0x41A6, d => ({ bc: d.actor, de: d.other() })),
  T("UpdateActors", B4, 0x41E7, () => ({}), { prep: stirActors }),
  T("StepActorScript", B4, 0x4229, d => ({ bc: d.liveActor })),
  T("UpdateActorJumpPhysics", B4, 0x426E, d => ({ bc: d.actor }), { prep: stirActors }),
  T("AdvanceActorTowardTarget", B4, 0x42AE, d => ({ bc: d.actor }), { prep: stirActors }),
  // ---- bank 4: the actor script's opcodes and helpers (actor_ops.js) ----
  T("UpdateCameraIfActorIsCameraTarget", B4, 0x4402, d => ({ bc: d.actor })),
  T("UpdateCameraToActor", B4, 0x440A, d => ({ bc: d.actor })),
  T("ApplyActorHeadingStep", B4, 0x4500, d => ({ de: BUF, a: d.b8() }), { prep: (m, s, d) => { randBuf(2)(m, s, d); setPtr(m, d); } }),
  T("IsActorAtTarget", B4, 0x475A, d => ({ bc: d.actor })),
  // opcode handlers: actor bc at an operand record de (random bytes at BUF)
  ...[["Op_Jump", 0x44D0], ["Op_Move", 0x44DF], ["Op_MoveRel", 0x44EB], ["Op_SetPos", 0x4556], ["Op_SetTarget", 0x457B],
    ["Op_TargetRel", 0x45A0], ["Op_WaitMove", 0x45F8], ["Op_Halt", 0x460A], ["Op_Wait", 0x460C],
    ["Op_FollowWaypoint", 0x4623], ["Op_Step", 0x46B0], ["Op_SetField", 0x477F], ["Op_AddField", 0x47BA],
    ["Op_Anim", 0x4824], ["Op_Sound", 0x483D], ["Op_BeginPath", 0x484E]].map(([n, at]) =>
    T("ActorScript" + n, B4, at, d => ({ bc: d.actor, de: BUF }), {
      prep: (m, s, d) => { randBuf(8)(m, s, d); if (n === "Op_Anim") W(m, BUF + 1, d.b8() & 7); if (n === "Op_Sound") W(m, BUF + 1, 0x5E + (d.b8() & 1)); setPtr(m, d); stirActors(m, s, d); },
    })),
  // ---- bank 4: object definitions and drawing (actor_objdefs.js) ----
  T("TryPickRandomReachableTarget", B4, 0x48C3, () => ({}), { prep: (m, s, d) => setPtr(m, d) }),
  T("ComputeSpriteScrollOffset", B4, 0x4A27),
  T("DrawActors", B4, 0x4A82, () => ({}), { prep: stirActors }),
  T("LoadActorObjectDef", B4, 0x4AC6, d => ({ bc: d.actor, d: d.b8() % 0x30 })),
  // ---- bank 4: scripted spawns (scripted.js) ----
  T("SetActorAnimationChecked", B4, 0x4BBB, d => ({ bc: d.b8() < 16 ? 0 : d.actor, d: d.b8() & 7 })),
  T("SetActorAnimation", B4, 0x4BBE, d => ({ bc: d.actor, d: d.b8() & 7 })),
  T("GetObjectDefCount", B4, 0x4C0B),
  T("UnusedGetCharObjectId", B4, 0x4C1D, d => ({ a: d.b8() & 0x3F })),
  T("EvalFlagCondition", B4, 0x4C49, d => ({ de: [0, d.b8() << 1 | 1, 0x8000 | d.b8() << 1, d.b8() * 3][d.b8() & 3] })),
  T("SpawnCompanionActor", B4, 0x4F10),
  // ---- bank 4: the player's controls (player.js) ----
  T("SetActorMoveTarget", B4, 0x5061, d => ({ bc: d.actor, hl: d.px(), de: d.py() })),
  T("GetPointAheadOfActorFixed", B4, 0x50D2, d => ({ bc: d.actor, a: d.b8() })),
  T("GetPointAheadOfActorRanged", B4, 0x50DC, d => ({ bc: d.actor, a: d.b8() })),
  T("ProjectPointFromActor", B4, 0x5113, d => ({ bc: d.actor, hl: d.b8() * 4, a: d.b8() })),
  T("OffsetPointByPolarVector", B4, 0x512F, d => ({ hl: d.px(), de: d.py(), a: d.b8(), bc: d.b8() * 4 })),
  T("CheckTileTriggerAtPoint", B4, 0x5141, d => ({ h: d.tile(), d: d.tile() })),
  T("UpdatePlayerControl", B4, 0x516B),
  // ---- bank 4: actor queries (actor_queries.js) ----
  T("IsPointBlocked", B4, 0x533D, d => ({ hl: d.px(), de: d.py() })),
  T("IsTerrainBlockedAtPoint", B4, 0x534B, d => ({ hl: d.px(), de: d.py() })),
  T("TestPointInBox", B4, 0x535C, d => ({ bc: d.w(), d: d.tile(), e: d.tile(), h: d.b8() & 15, l: d.b8() & 15 })),
  T("IsPointNearPlayer", B4, 0x537A, d => ({ hl: d.px(), de: d.py() })),
  T("FindActorAtPoint", B4, 0x53D7, d => ({ hl: d.px(), de: d.py() })),
  T("BuildNearbyActorList", B4, 0x5456),
  T("BuildActorQueryList", B4, 0x54D7),
  T("ActorSlotPtrToIndex", B4, 0x5514, d => ({ hl: d.actor })),
  T("DrawAndAnimateActor", B4, 0x5526, d => ({ bc: d.actor }), { prep: stirActors }),
  T("DrawActorSprite", B4, 0x5542, d => ({ bc: d.actor }), { prep: stirActors }),
  T("AdvanceActorAnimation", B4, 0x55C1, d => ({ bc: d.actor, de: d.w() }), { prep: stirActors }),
  T("UpdateActorFacingFromHeading", B4, 0x5673, d => ({ bc: d.actor, de: d.w() }), { prep: stirActors }),
  T("QueueActorFrameTileCopy", B4, 0x56C3, d => ({ bc: d.actor, d: d.b8() & 0xC0, e: d.b8() & 7 }), { prep: stirActors }),
  T("IsActorJumping", B4, 0x5703, d => ({ hl: d.b8() < 16 ? 0 : d.actor }), { prep: stirActors }),
  T("IsActorMoving", B4, 0x5738, d => ({ hl: d.b8() < 16 ? 0 : d.actor }), { prep: stirActors }),
  // ---- bank $0A: the cutscene commands (script.js, actor_moves.js, actor_waits.js) ----
  T("ToggleCutsceneFastForward", BA, 0x40A4),
  T("BeginCutsceneScriptMode", BA, 0x40D0),
  T("EndCutsceneScriptMode", BA, 0x4105),
  T("AdvanceDialogueTextCursor", BA, 0x4172),
  T("GetActorStateAddr", BA, 0x4312, d => ({ a: d.b8() < 32 ? d.b8() : d.slot })),
  T("ScriptSetActorMoveSpeed", BA, 0x433B, d => ({ a: d.slot, bc: d.b8() })),
  T("ScriptSetActorScript", BA, 0x4350, d => ({ a: d.slot, b: B4, de: 0x41D1 })),
  T("SetActorNullScript", BA, 0x4364, d => ({ a: d.slot })),
  T("CheckActorScriptEnd", BA, 0x438A, d => ({ hl: d.actor })),
  T("ScriptSetActorPosition", BA, 0x43B2, d => ({ a: d.slot, bc: d.px(), de: d.py() })),
  T("SetActorPositionRaw", BA, 0x43D8, d => ({ bc: BUF }), { prep: (m, s, d) => { randBuf(4)(m, s, d); setPtr(m, d); } }),
  T("ScriptSetActorMoveTarget", BA, 0x43F9, d => ({ a: d.slot, bc: d.px(), de: d.py() })),
  T("SetActorMoveTargetRaw", BA, 0x441F, d => ({ bc: BUF }), { prep: (m, s, d) => { randBuf(4)(m, s, d); setPtr(m, d); } }),
  T("UnusedMoveActorTowardPoint", BA, 0x4440, d => ({ a: d.slot, bc: d.px(), de: d.py(), l: d.b8() })),
  T("UnusedMoveActorTowardPointRaw", BA, 0x4465, d => ({ bc: BUF, de: d.w() }), { prep: (m, s, d) => { randBuf(5)(m, s, d); setPtr(m, d); } }),
  T("MoveActorByDelta", BA, 0x44CB, d => ({ a: d.slot, bc: d.b8() - 0x80 & 0xFFFF, de: d.b8() - 0x80 & 0xFFFF })),
  T("MoveActorByDeltaRaw", BA, 0x44F1, d => ({ bc: BUF }), { prep: (m, s, d) => { randBuf(4)(m, s, d); setPtr(m, d); } }),
  T("MoveActorByAngle", BA, 0x4545, d => ({ a: d.slot, b: d.b8(), de: d.b8() * 2 })),
  T("MoveActorByAngleRaw", BA, 0x4569, d => ({ bc: BUF }), { prep: (m, s, d) => { randBuf(3)(m, s, d); setPtr(m, d); } }),
  T("ScriptSetActorFacingLock", BA, 0x45C0, d => ({ a: d.slot, b: d.b8() & 1 })),
  T("SetActorFacing", BA, 0x45E2, d => ({ a: d.slot, b: d.b8() })),
  T("FaceActorTowardActor", BA, 0x45F5, d => ({ a: d.slot, b: d.L.length ? d.L[d.b8() % d.L.length] : 0 })),
  T("FaceActorsTowardEachOther", BA, 0x466F, d => ({ a: d.slot, b: d.L.length ? d.L[d.b8() % d.L.length] : 0 })),
  T("ScriptSetActorAnimation", BA, 0x4702, d => ({ a: d.slot, d: d.b8() & 7 })),
  T("ScriptSetActorJumpVelocity", BA, 0x4719, d => ({ a: d.slot, de: (0x10000 - d.b8() * 4) & 0xFFFF })),
  T("SetActorActive", BA, 0x472E, d => ({ a: d.slot, b: d.b8() % 3 })),
  T("UnusedSubDEFromHL", BA, 0x4741, d => ({ hl: d.w(), de: d.w() })),
  T("UnusedSetActorMoveTarget", BA, 0x4750, d => ({ hl: d.actor, de: d.w() })),
  T("IsActorBusy", BA, 0x476C, d => ({ hl: d.b8() < 16 ? 0 : d.actor })),
  T("SetPlayerMoveSpeed", BA, 0x47A3, d => ({ bc: d.b8() })),
  T("SetScreenShake", BA, 0x48C0, d => ({ a: d.b8() & 3 })),
  T("UpdateScreenShake", BA, 0x4908),
  // ---- bank $0A: matches from the story (match.js) ----
  T("InitStoryMatchSettings", BA, 0x4931),
  T("AssignStoryMatchCharacters", BA, 0x49AA),
  T("SetMatchDoublesMode", BA, 0x4A41, d => ({ a: d.b8() & 1 })),
  T("SetMatchOpponentChar", BA, 0x4A4C, d => ({ a: d.b8() })),
  T("SetCurrentlyUsedCourt", BA, 0x4A50, d => ({ a: d.b8() })),
  T("SetMatchSets", BA, 0x4A54, d => ({ a: d.b8() })),
  T("SetMatchGames", BA, 0x4A58, d => ({ a: d.b8() })),
  T("LoadMatchSettingsFromTable", BA, 0x4A5C),
  T("FillMemoryFast", BA, 0x4D77, d => ({ a: d.b8(), hl: BUF, bc: 1 + d.b8() % 0x40 })),
  T("ApplyClearStatusFlags", BA, 0x4D80),
  T("SetTrainingCourtClearFlags", BA, 0x4DA9),
  // ---- bank $0A: the story loop's helpers (story_loop.js) ----
  T("SetSinglesRankingClearFlags", BA, 0x4E0E),
  T("SetDoublesRankingClearFlags", BA, 0x4E75),
  T("GetClearStatusResultCode", BA, 0x4ECA),
  T("DrawPlayerPositionDebugOverlay", BA, 0x4EFC),
  T("ClearTemporaryStoryFlags", BA, 0x50E4),
  T("ClearStoryEventRequests", BA, 0x50F1),
  T("CheckStoryEventRequests", BA, 0x5104),
  T("LoadStoryLocationHeader", BA, 0x5114),
  T("WriteStoryStateWord", BA, 0x5161, d => ({ de: d.b8() & 0x3E, hl: d.w() })),
  T("LoadStoryEntryPointRecord", BA, 0x516F),
  // ---- bank $0A: interaction (story_interact.js) ----
  T("GetPointAheadOfActor", BA, 0x51CF, d => ({ hl: d.actor, de: d.b8(), a: d.b8() })),
  T("GetFacingTileInteractionId", BA, 0x5200),
  T("FindActorFacingPlayer", BA, 0x5227),
  T("SaveStoryReturnPoint", BA, 0x527F, d => ({ b: d.b8() & 1 ? 0xFF : d.b8() & 0x3F, c: d.b8() & 7 })),
  T("RestoreStoryReturnPoint", BA, 0x52AE),
  T("LoadStoryObjPalettes", BA, 0x5337),
  T("GetTileTriggerAtPlayer", BA, 0x5369),
  T("EvalFlagConditionA", BA, 0x53A2, d => ({ de: [0, d.b8() << 1 | 1, 0x8000 | d.b8() << 1, d.b8() * 3][d.b8() & 3] })),
  T("CheckTriggerFacingMask", BA, 0x53BD, d => ({ b: d.b8() & 1 ? 0xFF : d.b8() })),
  // ---- bank $0A: scene graphics, collision and behaviour maps (scene_*.js) ----
  T("GetStoryLocationCount", BA, 0x574B),
  T("GetStoryLocationRecordPtr", BA, 0x574E, d => ({ a: d.b8() % 0x30 })),
  T("UpdateSceneScroll", BA, 0x5976),
  T("GetSceneSlotPtr", BA, 0x5D0B, d => ({ a: d.b8() & 7 })),
  T("GetCollisionMapCellAddr", BA, 0x5EDD, d => ({ d: d.b8(), e: d.b8() })),
  T("ReadCollisionMapCell", BA, 0x5EFB, d => ({ d: d.tile(), e: d.tile() })),
  T("UnusedWriteCollisionMapCell", BA, 0x5F15, d => ({ d: d.tile(), e: d.tile(), a: d.b8() & 15 })),
  T("GetBehaviorMapCellAddr", BA, 0x5F31, d => ({ d: d.b8(), e: d.b8() })),
  T("ReadBehaviorMapCell", BA, 0x5F4F, d => ({ d: d.tile(), e: d.tile() })),
  T("WriteBehaviorMapCell", BA, 0x5F74, d => ({ d: d.tile(), e: d.tile(), a: d.b8() })),
  T("CopyCollisionMapRect", BA, 0x5F90, d => ({ b: d.tile() & 31, c: d.tile() & 31, d: d.tile() & 31, e: d.tile() & 31, h: 2 + (d.b8() & 14), l: 2 + (d.b8() & 14) })),
  T("CopyBehaviorMapRect", BA, 0x5FD6, d => ({ b: d.tile() & 31, c: d.tile() & 31, d: d.tile() & 31, e: d.tile() & 31, h: 2 + (d.b8() & 14), l: 2 + (d.b8() & 14) })),
  T("UnusedUpdateSceneViewerScroll", BA, 0x60C2),
  T("UnusedMoveSceneViewerCamera", BA, 0x6160),
  T("GetSceneTilemapAddr", BA, 0x621F, d => ({ hl: d.w() & 0x0FFF })),
  T("UpdateCameraFromPlayer", BA, 0x6235),
  T("UpdateSceneTileAnimations", BA, 0x6465),
  // (AdvanceSceneTileAnimation, 0A:64BB, is checked through UpdateSceneTileAnimations: for an animation not set up
  // it loops for ever, on the ROM as on the port)
  T("FreezeAllActors", BA, 0x6F1D),
  // ---- bank 2: characters, records, stats, EXP (story02.js, stat.js, equip.js, records.js, debug.js) ----
  ...[["UnusedValidateN64TransferRecord", 0x4044, () => ({})],
    ["UnusedCharIdRemapLookup", 0x4128, d => ({ a: d.b8() % 0x70 })],
    ["GetCharPaletteIndex", 0x4173, d => ({ a: d.b8() % 0x70 })],
    ["GetStoryCharacterRecordPtr", 0x41EE, d => ({ a: d.b8() % 0x64 })],
    ["GetPlayerRecordPtr", 0x4206, d => ({ a: d.b8() & 1 })],
    ["GetCa00RecordPtr", 0x420E, d => ({ a: d.b8() })],
    ["InitCa00RecordFromCharId", 0x4066, d => ({ b: [0xFF, 0x90, 0x80, 0x81, d.b8() % 0x64, 0x40 | d.b8() % 0x24][d.b8() % 6], c: d.b8() & 3 })],
    ["UnusedSignExtendL", 0x4257, d => ({ hl: d.w() })],
    ["Copy4Bytes", 0x42C9, d => ({ hl: 0xC900 + (d.b8() & 0x3F), de: BUF })],
    ["CheckStorySignatureCollision", 0x42D6, () => ({})],
    ["CompareNextByte", 0x4347, d => ({ de: 0xC900 + (d.b8() & 0x3F), hl: 0xC900 + (d.b8() & 0x3F) })],
    ["UnusedLoadMainCharacterFromRoster", 0x443B, d => ({ d: d.b8() })],
    ["UnusedCopy64Bytes", 0x447A, d => ({ hl: 0xC900, de: 0xCE00 })],
    ["RefreshPlayerStatsAndGetPtr", 0x4485, d => ({ a: d.b8() & 1 })],
    ["LookupStatBarLevel", 0x4494, d => ({ hl: 0x47FA + 13 + 9 * (d.b8() % 11), b: d.b8() })],
    ["ScaleStatForBarLevel", 0x44B7, d => ({ hl: 0xC938 + (d.b8() & 3), a: 5, bc: REC[d.b8() & 1] })],
    ["RecomputeCharacterStats", 0x44E9, d => ({ bc: [0xC900, 0xC940, 0xCA00, 0xCA40, 0xC800][d.b8() % 5] })],
    ["ApplyStatModifiers", 0x468E, d => ({ bc: REC[d.b8() & 1] })],
    ["ApplyStatModifierRow", 0x46B3, d => ({ a: d.b8() % 7, d: d.b8() & 1, bc: REC[d.b8() & 1] })],
    ["RefreshMainCharacterStats", 0x478F, () => ({})],
    ["RecomputeStatsWithoutRacket", 0x47C6, () => ({})],
    ["LevelUpPlayer", 0x49BE, d => ({ a: d.b8() & 1, d: d.b8() % 6 })],
    ["LevelUpPlayerRecord", 0x49C1, d => ({ bc: REC[d.b8() & 1], d: d.b8() % 6 })],
    ["ComputeLevelUpStatDeltas", 0x4A00, d => ({ a: d.b8() & 1, d: d.b8() % 6, hl: BUF })],
    ["UnusedListForEach", 0x4B99, d => ({ a: d.b8() & 15 })],
    ["RemapExtendedCharId", 0x4C58, d => ({ a: d.b8() })],
    ["SetStorySlotFlagB", 0x4CB1, d => ({ a: d.b8() & 1 })],
    ["TestStorySlotFlagB", 0x4CD4, () => ({})],
    ["SetStorySlotFlagA", 0x4CED, d => ({ a: d.b8() & 1 })],
    ["TestStorySlotFlagA", 0x4D10, () => ({})],
    ["UnusedCheckExpAwardAllowed", 0x4D29, d => ({ a: d.b8() })],
    ["AddExpCapped", 0x4D30, d => ({ hl: 0xC92C, de: d.w() })],
    ["Compare24Bit", 0x4D54, d => ({ de: 0xC92C, hl: 0xC96C })],
    ["UnusedClearCa00RecordExp", 0x4D61, d => ({ a: d.b8() })],
    ["UnusedAddExpToCa00RecordChecked", 0x4D6D, d => ({ a: d.b8(), de: d.w() })],
    ["AddPlayerExp", 0x4D8F, d => ({ a: d.b8() & 1, de: d.w() })],
    ["HasReachedNextLevelExp", 0x4D99, d => ({ a: d.b8() & 1 })],
    ["GetExpRemainingToNextLevel", 0x4DC8, d => ({ a: d.b8() & 1 })],
    ["GetExpProgressInCurrentLevel", 0x4E02, d => ({ a: d.b8() & 1 })],
    ["GetExpRequiredForLevel", 0x4E3A, d => ({ a: 1 + d.b8() % 99 })],
    ["LoadStorySlot", 0x5247, d => ({ a: d.b8() % 4 })],
    ["UnusedStorySlotVariant", 0x5284, d => ({ a: d.b8() % 4 })],
    ["LoadCharacterRecordToCa80", 0x52AA, d => ({ a: d.b8() & 0x80 ? 0x80 | d.b8() % 4 : d.b8() % 0x64 })],
    ["GetCharGroupEntry", 0x5EB3, d => ({ a: d.b8() % 9, b: d.b8() })],
    ["UnusedCharGroupFind", 0x5EC8, d => ({ a: d.b8() % 9 })],
    ["DoesCharGroupRowContain", 0x5EE2, d => ({ a: d.b8() % 9, b: d.b8() & 7 })],
  ].map(([n, at, regs]) => T(n, B2, at, regs, {
    when: anyState, wram: 1,
    prep: (m, s, d) => { recPrep(m, s, d); if (d.b8() < 128) W(m, 0xC36C, d.b8() % 4); },
  })),
];

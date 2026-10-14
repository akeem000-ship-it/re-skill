// The registers the match's ROM routines leave besides their results: scratch registers and flags, as the
// routine's last instructions leave them. A ROM caller may go on with any of them (InitStoryMatchSettings uses the
// hl InitDefaultMatchSettings leaves), so the hooks give back the same. Each entry is [bank, addr, { pre?, post }]
// for regs.js: post(P, out, inp, ctx) sets them from the RAM the routine left (and what pre noted before it ran).
// The hooks set the results themselves; these are the rest, worked out from each routine's asm.
// Names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).

export const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;
const zero = v => ((v & 0xFF) ? 0 : FZ);
// the flags of the SM83's 8-bit add/adc, sub/sbc/cp, inc and dec, and of `add hl, x` (Z kept from f)
export function add8(a, x, cy = 0) {
  const r = a + x + cy;
  return { r: r & 0xFF, f: zero(r) | (((a & 0xF) + (x & 0xF) + cy) > 0xF ? FH : 0) | (r > 0xFF ? FC : 0) };
}
export function sub8(a, x, cy = 0) {
  const r = a - x - cy;
  return { r: r & 0xFF, f: FN | zero(r) | (((a & 0xF) - (x & 0xF) - cy) < 0 ? FH : 0) | (r < 0 ? FC : 0) };
}
export const incFlags = (v, f) => (f & FC) | zero(v + 1) | ((v & 0xF) === 0xF ? FH : 0);
export const decFlags = (v, f) => (f & FC) | FN | zero(v - 1) | ((v & 0xF) === 0 ? FH : 0);
export function addHL(hl, x, f) {
  const r = hl + x;
  return { r: r & 0xFFFF, f: (f & FZ) | (((hl & 0xFFF) + (x & 0xFFF)) > 0xFFF ? FH : 0) | (r > 0xFFFF ? FC : 0) };
}
// `and x` / `bit n, x` (C kept)
export const andFlags = r => FH | zero(r);
export const bitFlags = (v, n, f) => (f & FC) | FH | ((v >> n) & 1 ? 0 : FZ);
// the ld_hl_indexed macro (add LOW / ld l, a / adc HIGH / sub l / ld h, a): hl = base + a, a = h
export function hlIndexed(base, a) {
  const lo = add8(a, base & 0xFF), hi = add8(lo.r, base >> 8, lo.f & FC ? 1 : 0), h = sub8(hi.r, lo.r);
  return { hl: h.r << 8 | lo.r, a: h.r, f: h.f };
}
// the negation idiom xor a / sub l / ld l, a / sbc a / sub h / ld h, a
export function negHL(hl) {
  const l = sub8(0, hl & 0xFF), h = sub8(l.f & FC ? 0xFF : 0, hl >> 8);
  return { hl: h.r << 8 | l.r, a: h.r, f: h.f };
}

const u8 = (P, a) => P.bus.u8(a), u16 = (P, a) => P.bus.u16(a);

// RAM (bank 0 unless noted; $DFxx is the character's struct in the mapped WRAM bank 4-7)
const BALL_X = 0xC402, BALL_DEPTH = 0xC406, BALL_PREV_DEPTH = 0xC416;
const BALL_X_FRAC = 0xC400, BALL_DEPTH_FRAC = 0xC404;
const CAMERA_OFFSET_Y = 0xC47A, COURT_LIMIT_DEPTH = 0xC486;
const BOUNCE_EFFECT_X = 0xC460, BOUNCE_EFFECT_Y = 0xC462, AIM_SPREAD_BASE = 0xC43E;
const CURRENT_SHOT_TYPE = 0xC4A0, BALL_TOUCH_CHAR_INDEX = 0xC4AF, RALLY_LENGTH = 0xC4B6, LAST_SHOT_CHAR_INDEX = 0xC4B8;
const SERVICE_ACE_FLAG = 0xC4D0, RETURN_ACE_FLAG = 0xC4D1, POINT_OUTCOME = 0xC4D8, POINT_OUTCOME_SIDE = 0xC4D9;
const SCOREBOARD_LAYOUT = 0xC494, MATCH_CONTEXT = 0xC8F5, MATCHCONTEXT_MINIGAME = 2;
const TARGET_ZONE_X1 = 0xC790, TARGET_ZONE_DEPTH1 = 0xC792, TARGET_ZONE_X2 = 0xC794, TARGET_ZONE_DEPTH2 = 0xC796;
const DRILL_GATE1 = 0xC798, DRILL_GATE2 = 0xC79C;
const STATS = 0xC8C0;                    // wCharacter1ServiceAces: 7 counters per character, 8 bytes apart
const MATCH_RNG_STATE = 0xC8DF, POINT_WIN_LOSE_FLAG = 0xC8EB, TOTAL_POINTS = 0xC8ED, SERVE_FAULT_FLAG = 0xC8EE;
const CHAR_POS_X = 0xDF00, CHAR_POS_DEPTH = 0xDF03, CHAR_SERVE_ROLE = 0xDF09;
const CHAR_FACING_DESIRED = 0xDF0D, CHAR_FACING_SHOWN = 0xDF0E, CHAR_FLAGS = 0xDF0F, CHAR_AI_ACTION_TIMER = 0xDF12;
const CHAR_SPRITE_DIRTY = 0xDF30, CHAR_FACING_OCTANT = 0xDF32, CHAR_POS_HEIGHT = 0xDF06;
const CHAR_VEL_X = 0xDF40, CHAR_WALK_TARGET_FLAG = 0xDF55, CHAR_FACING_EASE_RATE = 0xDF68;
const CHAR_SHOT_BUTTON1 = 0xDF16, CHAR_SHOT_BUTTON2 = 0xDF17, CHAR_BALL_REACH_FLAGS = 0xDF50;
const CHARB_DIVING = 1, CHARB_AIRBORNE = 2, CHAR_SHOT_TYPE = 0xDF14;
const CHAR_ANIM_TABLE_PTR = 0xDF28, CHAR_ANIM_SCRIPT_PTR = 0xDF2C, CHAR_ANIM_ID = 0xDF2E, CHAR_ANIM_FRAME = 0xDF33;
const CHAR_SCREEN_X = 0xDF53, CHAR_SCREEN_Y = 0xDF54, CHAR_SPRITE_SLOT = 0xDF80, CHAR_GROUND_SHADOW_SLOT = 0xDF8C;
const STANDING_SHADOWS_ENABLED = 0xC4CA, MATCH_FRAME_COUNTER = 0xFFE9;
const BALL_VELOCITY_X_FRAC = 0xC420, BALL_VELOCITY_DEPTH_FRAC = 0xC423;
const SHOTTYPE_SMASH = 0x09, SHOTTYPE_LOB = 0x0A, SHOTTYPE_DROP = 0x0B;
const POINTOUTCOME_FAULT = 1, POINTOUTCOME_DOUBLE_FAULT = 2, POINTOUTCOME_LET = 3, POINTOUTCOME_WINNER = 6;
const POINTOUTCOME_BALL_HIT_PLAYER = 9;
const OBJSLOT_X = 0x06;              // OBJSLOT_X: the slot's x, then y

// the setters' `ld c, l / ld b, h ... ld a, c / ld [hl+], a / ld [hl], b`: bc = the hl given, a = its low byte,
// hl at the second word's high byte
const setterPair = hlAfter => ({ post(P, out, inp) { out.bc = inp.hl; out.a = inp.l; out.hl = hlAfter; } });

// a gate/zone test's `ld hl, v / sub e ... sbc d` chain: steps [de, value, leaveWhenNegative]; the first step
// whose sign says so leaves (a = 0, Z); getting through them all is a yes (xor a / inc a: a = 1, no flags)
function signChain(out, steps) {
  let de = 0, hl = 0;
  for (const [d, v, leaveIfNegative] of steps) {
    de = d & 0xFFFF; hl = (v - de) & 0xFFFF;
    if (!!(hl & 0x8000) === leaveIfNegative) { out.de = de; out.hl = hl; out.a = 0; out.f = FZ; return; }
  }
  out.de = de; out.hl = hl; out.a = 1; out.f = 0;
}

// RecordDropShotWinnerStat.bumpStat (08:5CB2) from UpdatePointStats: hl = the counter, a its old value, and the
// flags of `cp $63` (99 already: ret nc) or of the `inc [hl]` after it
function bumpStat(st, base, before) {
  st.hl = (base + ((st.lastShot * 8) & 0xFF)) & 0xFFFF;
  const v = before(st.hl), cp = sub8(v, 0x63);
  st.a = v; st.f = v >= 0x63 ? cp.f : incFlags(v, cp.f);
}

export const LEFTOVERS = [
  // 08:43F6 AdvanceMatchRng: push hl ... pop hl; the flags of the last `add [hl]` (wBallDepthFrac + 1)
  [8, 0x43F6, { post(P, out) { const x = u8(P, BALL_DEPTH_FRAC + 1); out.f = add8((u8(P, MATCH_RNG_STATE) - x) & 0xFF, x).f; } }],
  // 08:458B SetBallPosition: de = the x given (pop de), hl at wBallXFrac + 3, a = the x's low byte, Z from xor a
  [8, 0x458B, { post(P, out, inp) { out.de = inp.hl; out.hl = BALL_X_FRAC + 3; out.a = inp.l; out.f = FZ; } }],
  // 08:45D8 Unused_08_SetBallSpinComponents: hl at wBallTopspin + 1, a = c
  [8, 0x45D8, { post(P, out, inp) { out.hl = 0xC41D; out.a = inp.c; } }],
  // 08:463A CheckBallOutOfBounds: bc = wCourtLimitDepth, hl = |depth| + that, f from that add (Z from the
  // `bit 7, h` or the negation before it), a = d = the bits
  [8, 0x463A, { post(P, out, inp) {
    const limit = u16(P, COURT_LIMIT_DEPTH), depth = u16(P, BALL_DEPTH);
    let hl = depth, f = FZ | FH | (inp.f & FC);               // bit 7, h with bit 7 clear
    if (depth & 0x8000) { const n = negHL(depth); hl = n.hl; f = n.f; }
    const sum = addHL(hl, limit, f);
    out.bc = limit; out.hl = sum.r; out.f = sum.f; out.d = out.a;
  } }],
  // 08:468B MulMem24ByFrac: hl = the 16-bit product before the result's negation (a negative value is made
  // positive, multiplied, and negated back)
  [8, 0x468B, { post(P, out, inp) {
    const v = out.d << 16 | out.e << 8 | out.a;
    out.hl = u8(P, (inp.hl + 2) & 0xFFFF) & 0x80 ? ((-v) & 0xFFFFFF) >> 8 : v >> 8;
  } }],
  // 08:46E7 FindServerCharBank: hl = wCharServeRole, a = 4 (WRAM_CHAR0 mapped back), f from the last `and a`
  [8, 0x46E7, { post(P, out) { out.hl = CHAR_SERVE_ROLE; out.a = 4; out.f = out.b === 7 ? FH : FZ | FH; } }],
  // 08:5383 StartBounceEffect: ProjectWorldToScreen (a = the ROM bank, f as entered); de, bc = the screen x and y
  // it stored, hl at wBounceEffectY + 1, a = $14
  [8, 0x5383, { post(P, out, inp) { out.de = u16(P, BOUNCE_EFFECT_X); out.bc = u16(P, BOUNCE_EFFECT_Y); out.hl = BOUNCE_EFFECT_Y + 1; out.a = 0x14; out.f = inp.f; } }],
  // 08:59BB ApplyCameraProjection: f from the y path's last `add hl, hl` (Z as entered)
  [8, 0x59BB, { post(P, out, inp) { const t = ((u16(P, CAMERA_OFFSET_Y) + inp.bc) * 4) & 0xFFFF; out.f = addHL(t, t, inp.f).f; } }],
  // 08:5B7F HandleServeFault: a and f from the test that ended it
  [8, 0x5B7F, { post(P, out) {
    const rally = u8(P, RALLY_LENGTH), side = u8(P, POINT_OUTCOME_SIDE);
    if (rally !== 1) { out.a = rally; out.f = sub8(rally, 1).f; return; }
    if (side !== 0xFF) { out.a = side; out.f = sub8(side, 0xFF).f; return; }
    const firstFault = u8(P, SERVE_FAULT_FLAG) === 1;              // the flag was clear: now set
    out.a = firstFault ? POINTOUTCOME_FAULT : POINTOUTCOME_DOUBLE_FAULT; out.f = firstFault ? FZ | FH : FH;
  } }],
  // 08:5C14 AwardPoint: no winner: a = flag * 2, its flags; else a = 0, hl at the points counter, its inc's flags
  [8, 0x5C14, { post(P, out) {
    const flag = u8(P, POINT_WIN_LOSE_FLAG), twice = add8(flag, flag);
    if (!twice.r) { out.a = 0; out.f = twice.f; return; }
    out.a = 0; out.hl = TOTAL_POINTS; out.f = incFlags((u8(P, TOTAL_POINTS) - 1) & 0xFF, 0);
  } }],
  // 08:5C2B UpdatePointStats: what the last of its stat routines leaves (the counters as they were before it)
  [8, 0x5C2B, {
    pre(P) { const k = u8(P, LAST_SHOT_CHAR_INDEX), at = (STATS + ((k * 8) & 0xFF)) & 0xFFFF; return { at, v: [0, 1, 2, 3, 4, 5, 6].map(i => u8(P, at + i)) }; },
    post(P, out, inp, pre) {
      const st = { a: inp.a, f: inp.f, hl: inp.hl, lastShot: u8(P, LAST_SHOT_CHAR_INDEX) }, before = hl => pre.v[hl - pre.at];
      const outcome = u8(P, POINT_OUTCOME), shotType = u8(P, CURRENT_SHOT_TYPE);
      const test = (v, x) => { st.a = v; st.f = sub8(v, x).f; return v === x; };
      if (test(outcome, POINTOUTCOME_FAULT)) bumpStat(st, STATS + 5, before);
      if (test(outcome, POINTOUTCOME_DOUBLE_FAULT)) bumpStat(st, STATS + 6, before);
      if (test(outcome, POINTOUTCOME_WINNER)) {
        if (test(shotType, SHOTTYPE_DROP)) bumpStat(st, STATS + 4, before);
        if (test(shotType, SHOTTYPE_LOB)) bumpStat(st, STATS + 3, before);
        if (test(shotType, SHOTTYPE_SMASH)) bumpStat(st, STATS + 2, before);
        for (const [flagAt, base] of [[RETURN_ACE_FLAG, STATS + 1], [SERVICE_ACE_FLAG, STATS]]) {
          const v = u8(P, flagAt); st.a = v; st.f = andFlags(v);
          if (v) bumpStat(st, base, before);
        }
      }
      out.a = st.a; out.f = st.f; out.hl = st.hl;
    },
  }],
  // 08:5D9A ResolvePointWinner: the flags of the last instruction of the branch taken
  [8, 0x5D9A, { post(P, out) {
    const outcome = u8(P, POINT_OUTCOME);
    if (outcome === POINTOUTCOME_FAULT || outcome === POINTOUTCOME_LET) out.f = FZ;                       // xor a
    else if (outcome === POINTOUTCOME_BALL_HIT_PLAYER) out.f = u8(P, BALL_TOUCH_CHAR_INDEX) & 1 ? FN : FN | FH;   // add a / dec a
    else if (u8(P, LAST_SHOT_CHAR_INDEX) & 1) { const n = ~u8(P, POINT_OUTCOME_SIDE) & 0xFF; out.f = incFlags(n, 0); }   // cpl / inc a
    else out.f = FZ | FH;                                                                                   // and $01: 0
  } }],
  // 08:61C9 SetCameraTarget: bc = the x given, hl at wMatchCameraTargetY + 1, Z from the xor a
  [8, 0x61C9, { post(P, out, inp) { out.bc = inp.hl; out.hl = 0xC447; out.a = 0; out.f = FZ; } }],
  // 08:630E ClearSpriteSlots: a = $FF; WRAM_CHAR0 mapped back
  [8, 0x630E, { post(P, out) { out.a = 0xFF; } }],
  // 08:6728 SetMinigamePointTable: a = e (push hl ... pop hl)
  [8, 0x6728, { post(P, out, inp) { out.a = inp.e; } }],
  // 08:6731 SetBallGatePoint1 / 08:6740 SetBallGatePoint2 / 08:674F SetTargetZoneCorner1 / 08:675E SetTargetZoneCorner2
  [8, 0x6731, setterPair(DRILL_GATE1 + 1)], [8, 0x6740, setterPair(DRILL_GATE2 + 1)],
  [8, 0x674F, setterPair(TARGET_ZONE_X1 + 1)], [8, 0x675E, setterPair(TARGET_ZONE_X2 + 1)],
  // 08:676D DidBallCrossGate: bc = the gate's depth; the depth sign test, then gate 1's and gate 2's x
  [8, 0x676D, { post(P, out) {
    const gateDepth = u16(P, DRILL_GATE1 + 2), prev = (u16(P, BALL_PREV_DEPTH) - gateDepth) & 0xFFFF, now = (u16(P, BALL_DEPTH) - gateDepth) & 0xFFFF;
    out.bc = gateDepth;
    if (!((now ^ prev) & 0x8000)) { out.de = prev; out.hl = now; out.a = 0; out.f = FZ; return; }
    signChain(out, [[u16(P, DRILL_GATE1), u16(P, BALL_X), true], [u16(P, DRILL_GATE2), u16(P, BALL_X), false]]);
  } }],
  // 08:67C2 IsBallInTargetZone: the zone widened by 16 on each side, x then depth
  [8, 0x67C2, { post(P, out) {
    const x = u16(P, BALL_X), depth = u16(P, BALL_DEPTH);
    signChain(out, [[u16(P, TARGET_ZONE_X1) - 16, x, true], [u16(P, TARGET_ZONE_X2) + 16, x, false],
      [u16(P, TARGET_ZONE_DEPTH1) - 16, depth, true], [u16(P, TARGET_ZONE_DEPTH2) + 16, depth, false]]);
  } }],
  // 08:6988 SetCharPosAndTarget: bc = the x given, hl past wCharPosHeight, Z from the xor a
  [8, 0x6988, { post(P, out, inp) { out.bc = inp.hl; out.hl = CHAR_POS_HEIGHT + 3; out.a = 0; out.f = FZ; } }],
  // 08:69AE SetCharTarget: bc = the x given, hl = wCharWalkTargetFlag, a = the x's low byte
  [8, 0x69AE, { post(P, out, inp) { out.bc = inp.hl; out.hl = CHAR_WALK_TARGET_FLAG; out.a = inp.l; } }],
  // 08:6A1C SetCharState: hl past wCharAiActionTimer, Z from the xor a
  [8, 0x6A1C, { post(P, out) { out.hl = CHAR_AI_ACTION_TIMER + 1; out.a = 0; out.f = FZ; } }],
  // 08:4FC7 CharPointEndReaction: SetCharTarget with the character's own place, then wCharVelX..+5 cleared
  [8, 0x4FC7, { post(P, out) { out.bc = u16(P, CHAR_POS_X + 1); out.de = u16(P, CHAR_POS_DEPTH + 1); out.hl = CHAR_VEL_X + 6; out.a = 0; out.f = FZ; } }],
  // 08:707E SelectRallyShotType: de = button2 * 4 + button1, hl = the table entry (add hl, de: Z from bit 4)
  [8, 0x707E, { post(P, out, inp) {
    const e = ((u8(P, CHAR_SHOT_BUTTON2) * 4) + u8(P, CHAR_SHOT_BUTTON1)) & 0xFF, reach = u8(P, CHAR_BALL_REACH_FLAGS);
    const base = reach & 0x10 ? 0x709B : 0x70B4;               // RallyShotTypeTable0 / RallyShotTypeTable1
    const sum = addHL(base, e, bitFlags(reach, 4, add8((u8(P, CHAR_SHOT_BUTTON2) * 4) & 0xFF, u8(P, CHAR_SHOT_BUTTON1)).f));
    out.de = e; out.hl = sum.r; out.f = sum.f; out.a = u8(P, CHAR_SHOT_TYPE);
  } }],
  // 08:75C0 EaseCharFacing: the step toward the desired facing (b = the ease rate), hl = wCharFacingShown
  [8, 0x75C0, {
    pre(P) { return u8(P, CHAR_FACING_SHOWN); },
    post(P, out, inp, shown) {
      const flags = u8(P, CHAR_FLAGS);
      if (flags & (1 << CHARB_DIVING)) { out.hl = CHAR_FLAGS; out.f = bitFlags(flags, CHARB_DIVING, inp.f); return; }
      const b = u8(P, CHAR_FACING_EASE_RATE), diff = sub8(u8(P, CHAR_FACING_DESIRED), shown);
      out.b = b; out.hl = CHAR_FACING_SHOWN;
      if (!diff.r) { out.a = 0; out.f = diff.f; return; }
      let step;
      if (!(diff.r & 0x80)) step = sub8(diff.r, b).f & FC ? diff.r : b;
      else { const n = (-diff.r) & 0xFF; step = (-(sub8(n, b).f & FC ? n : b)) & 0xFF; }
      const s = add8(step, shown); out.a = s.r; out.f = s.f;
    },
  }],
  // 08:75E8 UpdateCharFacingOctant: a = the old octant, the flags of comparing it with the new one (d); hl at
  // wCharSpriteDirty when it changed
  [8, 0x75E8, {
    pre(P) { return u8(P, CHAR_FACING_OCTANT); },
    post(P, out, inp, old) { const cp = sub8(old, out.d); out.a = old; out.f = cp.f; out.hl = cp.r ? CHAR_SPRITE_DIRTY : CHAR_FACING_OCTANT; },
  }],
];

// 08:40AB ResetMatchState: bc = the aim spread (or SelectScoreboardLayout's b in a minigame), de = the net height,
// hl past wAimSpreadBase, Z from the closing xor a
LEFTOVERS.push([8, 0x40AB, { post(P, out) {
  const spread = u16(P, AIM_SPREAD_BASE);
  out.bc = u8(P, MATCH_CONTEXT) === MATCHCONTEXT_MINIGAME ? u8(P, SCOREBOARD_LAYOUT) << 8 | (spread & 0xFF) : spread;
  out.de = 0x0060; out.hl = AIM_SPREAD_BASE + 1; out.a = 0; out.f = FZ;
} }]);
// 08:684A InitChar: SetCharPosAndTarget($03C0, 0) last, then a = 1
LEFTOVERS.push([8, 0x684A, { post(P, out) { out.bc = 0x03C0; out.de = 0; out.hl = CHAR_POS_HEIGHT + 3; out.a = 1; out.f = FZ; } }]);
// 09:45C4 SetObjPosition: hl at the slot's y; f from `add hl, bc` (Z as entered)
LEFTOVERS.push([9, 0x45C4, { post(P, out, inp) { out.hl = (inp.bc + OBJSLOT_X + 1) & 0xFFFF; out.f = addHL(OBJSLOT_X, inp.bc, inp.f).f; } }]);
// 07:5A43 LookupCharSpriteSet: push hl ... pop hl; the flags of the table index
LEFTOVERS.push([7, 0x5A43, { post(P, out, inp) { out.f = hlIndexed(0x5A50, inp.a & 0x3F).f; } }]);

// 08:7791 StepCharAnimation: a = the frame shown before, compared with the new one (e); hl at wCharSpriteDirty when
// it changed. (bc and d, the last script word read, the hook sets.)
LEFTOVERS.push([8, 0x7791, {
  pre(P) { return u8(P, CHAR_ANIM_FRAME); },
  post(P, out, inp, old) { const e = u8(P, CHAR_ANIM_FRAME), cp = sub8(old, e); out.e = e; out.a = old; out.f = cp.f; out.hl = cp.r ? CHAR_SPRITE_DIRTY : CHAR_ANIM_FRAME; },
}]);
// 08:69EA SetCharAnimation: already showing d: a = d (cp), hl = wCharAnimId; else the script start read by
// FarReadWordDI (bc, a = its low byte), hl past wCharAnimScriptPtr, f from indexing the animation table
LEFTOVERS.push([8, 0x69EA, {
  pre(P) { return u8(P, CHAR_ANIM_ID); },
  post(P, out, inp, old) {
    if (old === inp.d) { out.a = old; out.f = sub8(old, inp.d).f; out.hl = CHAR_ANIM_ID; return; }
    const table = u16(P, CHAR_ANIM_TABLE_PTR), at = add8(add8(inp.d, inp.d).r, table & 0xFF);
    out.bc = u16(P, CHAR_ANIM_SCRIPT_PTR); out.a = out.c; out.hl = CHAR_ANIM_SCRIPT_PTR + 1;
    out.f = at.f & FC ? incFlags(table >> 8, at.f) : at.f;
  },
}]);
// 08:45A9 SetBallVelocityPolar: the second MulSinCosSigned's results stored last: bc = the x velocity, de = the
// depth velocity, a = its low byte, hl at its high byte, Z from the xor a
LEFTOVERS.push([8, 0x45A9, { post(P, out) { out.bc = u16(P, BALL_VELOCITY_X_FRAC + 1); out.de = u16(P, BALL_VELOCITY_DEPTH_FRAC + 1); out.a = out.e; out.hl = BALL_VELOCITY_DEPTH_FRAC + 2; out.f = FZ; } }]);
// 08:7672 BuildCharSpriteSlots on screen: d, e = the screen position; bc = the sprite's attr and tile (or the
// ground shadow's $0858), hl where the last slot write or test was, a and f from the last test
LEFTOVERS.push([8, 0x7672, { post(P, out, inp) {
  const d = u8(P, CHAR_SCREEN_X), e = u8(P, CHAR_SCREEN_Y);
  if (((d + 8) & 0xFF) >= 0xB0 || e >= 0xA0) return;                       // DrawOffscreenCharArrow: not modelled
  out.d = d; out.e = e; out.c = u8(P, CHAR_SPRITE_SLOT); out.b = u8(P, CHAR_SPRITE_SLOT + 1);
  const shadows = u8(P, STANDING_SHADOWS_ENABLED);
  if (!shadows) { out.a = 0; out.f = FZ | FH; out.hl = CHAR_SPRITE_SLOT + 3; return; }
  const flags = u8(P, CHAR_FLAGS);
  if (flags & (1 << CHARB_AIRBORNE)) { out.a = shadows; out.hl = CHAR_FLAGS; out.f = FH; return; }   // bit (C from the and a: 0)
  const odd = u8(P, MATCH_FRAME_COUNTER) & 1;
  out.hl = CHAR_FLAGS; out.a = odd; out.f = andFlags(odd);
  if (odd) { out.bc = 0x0858; out.a = e; out.hl = CHAR_GROUND_SHADOW_SLOT + 3; }
} }]);

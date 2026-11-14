// The on-court character routines (web/js/engine/chars.js) for web/tests/engine_routines.mjs. Each per-character
// routine runs once per WRAM bank 4-7 ("@5" = character 1); "/forced" variants scramble the inputs per state
// (prep) so the branches recorded play does not reach run too.
import * as chars from "../../js/engine/chars.js";

const hl = r => ({ h: (r >> 8) & 0xFF, l: r & 0xFF });
// a pseudo-random but reproducible byte per state and key
const R = (s, k) => ((s.f * 2654435761 + k * 40503 + (k * k) * 977) >>> 11) & 0xFF;
const R16 = (s, k) => R(s, k) | R(s, k + 101) << 8;
const W = (m, bank, addr, v) => { m.wram[bank][addr - 0xD000] = v & 0xFF; };
const W16 = (m, bank, addr, v) => { W(m, bank, addr, v); W(m, bank, addr + 1, v >> 8); };
const G = (m, addr, v) => { m.wram[0][addr - 0xC000] = v & 0xFF; };
const G16 = (m, addr, v) => { G(m, addr, v); G(m, addr + 1, v >> 8); };
const pick = (s, k, list) => list[R(s, k) % list.length];
const BANKS = [4, 5, 6, 7];

// Singles leaves banks 6-7 unused (wCharObjectBank 0, other data in the struct), so their entries first make
// the slot a live doubles partner: a copy of character k-2's struct with its own index.
function liveSlot(m, bank) {
  if (bank < 6) return;
  m.wram[bank].set(m.wram[bank - 2].subarray(0xF00, 0x1000), 0xF00);
  m.wram[bank][0xF0B] = bank - 4;
}
// one entry per character bank
function each(name, addr, js, more = {}) {
  return BANKS.map(bank => ({ name: `${name}@${bank}`, bank: 8, addr, wram: bank, js, ...more,
    prep: (m, s) => { liveSlot(m, bank); if (more.prep) more.prep(m, s, bank); } }));
}
// the ball somewhere around the character (relative offsets small enough to hit the reach tests)
function ballNearChar(m, s, bank, k = 0) {
  const c = m.wram[bank], x = c[0xF01] | c[0xF02] << 8, d = c[0xF04] | c[0xF05] << 8;
  G16(m, 0xC402, x + ((R16(s, 300 + k) & 0x1FF) - 0x100));
  G16(m, 0xC406, d + ((R16(s, 310 + k) & 0x1FF) - 0x100));
  G16(m, 0xC40A, -(R16(s, 320 + k) & 0x1FF));
}
// scramble the character's input-facing state
function scrambleChar(m, s, bank, k = 0) {
  W(m, bank, 0xDF1F, R(s, 1 + k));                                       // input bits
  W(m, bank, 0xDF0F, R(s, 2 + k) & 0x77);                                // flags
  W(m, bank, 0xDF50, R(s, 3 + k));                                       // reach flags
  W(m, bank, 0xDF11, R(s, 4 + k) % 7);                                   // combo timer
  W(m, bank, 0xDF16, R(s, 5 + k) & 3); W(m, bank, 0xDF17, R(s, 6 + k) % 5 === 0 ? R(s, 7 + k) & 3 : 0);
  W(m, bank, 0xDF4F, R(s, 8 + k) & 3);
  W(m, bank, 0xDF4B, R(s, 9 + k) & 0x1F);                                // swing frames
  W(m, bank, 0xDF0D, R(s, 10 + k)); W(m, bank, 0xDF0E, R(s, 11 + k));     // facing desired / shown
}
const STATE_PHASES = [1, 4, 2, 5, 3, 2, 1, 3];                           // reachable phases per state

export const ROUTINES = [
  // ---- the whole frame ----
  { name: "UpdateAllChars", bank: 8, addr: 0x692C, wram: 4, js: E => chars.updateAllChars(E) },
  { name: "UpdateAllChars/pad", bank: 8, addr: 0x692C, wram: 4, prep: (m, s) => {
    m.hram[0x10] = R(s, 1) & 0xF0; m.hram[0x14] = R(s, 2) & 0x0F;      // hPlayerInputFlags, hInputRisingEdge
    for (const b of BANKS) if (R(s, 10 + b) % 3 === 0) W(m, b, 0xDF1E, 0);
  }, js: E => chars.updateAllChars(E) },
  { name: "UpdateAllChars/forced", bank: 8, addr: 0x692C, wram: 4, prep: (m, s) => {
    m.hram[0x10] = R(s, 1) & 0xF0; m.hram[0x14] = R(s, 2) & 0x0F; m.hram[0x42] = R(s, 3) % 3;
    m.hram[0x53] = R(s, 4); m.hram[0x54] = R(s, 5); m.hram[0x55] = R(s, 6);
    for (const b of BANKS) {
      W(m, b, 0xDF1E, pick(s, 20 + b, [0, 0, 1, 4, 5, 6]));
      if (R(s, 30 + b) & 1) { const st = R(s, 40 + b) & 7; W(m, b, 0xDF18, st); W(m, b, 0xDF19, R(s, 50 + b) % STATE_PHASES[st]); W(m, b, 0xDF1A, 0); }
      if (R(s, 60 + b) % 4 === 0) ballNearChar(m, s, b, b);
    }
  }, js: E => chars.updateAllChars(E) },
  ...each("UpdateChar", 0x6958, E => chars.updateChar(E)),
  ...each("UpdateChar/forced", 0x6958, E => chars.updateChar(E), { prep: (m, s, b) => {
    m.hram[0x10] = R(s, 1) & 0xF0; m.hram[0x14] = R(s, 2) & 0x0F;
    W(m, b, 0xDF1E, pick(s, 3, [0, 0, 1]));
    const st = R(s, 4) & 7; W(m, b, 0xDF18, st); W(m, b, 0xDF19, R(s, 5) % STATE_PHASES[st]); W(m, b, 0xDF1A, 0);   // AI phase 0: valid in every state
    W(m, b, 0xDF10, R(s, 6) % 5 === 0 ? 2 : 0);
    if (R(s, 7) & 1) ballNearChar(m, s, b);
    W(m, b, 0xDF0F, R(s, 8) & 0x37);
    if (R(s, 9) % 3 === 0) W16(m, b, 0xDF44, -(R16(s, 10) & 0x3FF));
  } }),
  // ---- the state machine ----
  ...each("UpdateCharStateMachine", 0x6A62, E => chars.updateCharStateMachine(E)),
  ...each("UpdateCharStateMachine/forced", 0x6A62, E => chars.updateCharStateMachine(E), { prep: (m, s, b) => {
    scrambleChar(m, s, b);
    const st = R(s, 40) & 7; W(m, b, 0xDF18, st); W(m, b, 0xDF19, R(s, 41) % STATE_PHASES[st]);
    W(m, b, 0xDF10, R(s, 42) % 6 === 0 ? 3 : 0);
    W(m, b, 0xDF2E, pick(s, 43, [1, 2, 5, 6, 7, 8, 9, 0x0C, 0x10, 0x11, 0x12]));
    W(m, b, 0xDF57, pick(s, 44, [0, 1, 0xFF, 0x80]));
    W(m, b, 0xDF51, R(s, 45) & 1); W(m, b, 0xDF52, R(s, 46) & 1);
    G(m, 0xC7B9, R(s, 47) % 4 === 0 ? 1 : 0);
    if (R(s, 48) & 1) ballNearChar(m, s, b);
    if (R(s, 49) % 3 === 0) { W16(m, b, 0xDF46, R16(s, 50) & 0x3FF); W16(m, b, 0xDF48, R16(s, 51) & 0x3FF); }
    G16(m, 0xC427, R16(s, 52));
  } }),
  // ---- geometry and shot selection ----
  ...each("UpdateCharBallGeometry", 0x6E64, E => chars.updateCharBallGeometry(E)),
  ...each("UpdateCharBallGeometry/forced", 0x6E64, E => chars.updateCharBallGeometry(E), { prep: (m, s, b) => { ballNearChar(m, s, b); W(m, b, 0xDF0F, R(s, 2) & 2); } }),
  ...each("CheckCharBallContact/forced", 0x6EC5, E => chars.checkCharBallContact(E), { prep: (m, s, b) => {
    ballNearChar(m, s, b); const c = m.wram[b];
    G16(m, 0xC406, (c[0xF04] | c[0xF05] << 8) + (R(s, 1) & 0x1F) - 0x10);
    G16(m, 0xC40A, -(R(s, 2) & 0x3F));
    W(m, b, 0xDF16, R(s, 3) % 4 === 0 ? 1 : 0); W(m, b, 0xDF18, R(s, 4) % 5 === 0 ? 2 : 1);
    G(m, 0xC4D8, R(s, 5) % 5 === 0 ? 4 : 0);
    for (let i = 0; i < 3; i++) { G(m, 0xC420 + i, R(s, 6 + i)); G(m, 0xC423 + i, R(s, 9 + i)); G(m, 0xC426 + i, R(s, 12 + i)); }
    // the relative position the test reads is UpdateCharBallGeometry's: recompute it here
    const rel = (ba, ca) => { const v = ((m.wram[0][ba - 0xC000] | m.wram[0][ba - 0xBFFF] << 8) - (c[ca - 0xD000] | c[ca - 0xCFFF] << 8)) & 0xFFFF; return v; };
    G16(m, 0xC448, rel(0xC402, 0xDF01)); G16(m, 0xC44A, rel(0xC406, 0xDF04)); G16(m, 0xC44C, rel(0xC40A, 0xDF07));
  } }),
  ...each("CheckBallContactWindow/forced", 0x6FA7, E => chars.checkBallContactWindow(E), { prep: (m, s, b) => {
    G16(m, 0xC448, (R16(s, 1) & 0xFF) - 0x80); G16(m, 0xC44A, (R16(s, 2) & 0xFF) - 0x80); G16(m, 0xC44C, (R16(s, 3) & 0x7F) - 0x40);
    W(m, b, 0xDF0F, R(s, 4) & 2);
  } }),
  ...each("CheckBallInSwingRange/forced", 0x702A, E => chars.checkBallInSwingRange(E), { prep: (m, s, b) => {
    G16(m, 0xC448, (R16(s, 1) & 0x1FF) - 0x100); G16(m, 0xC44A, (R16(s, 2) & 0x1FF) - 0x100);
  } }),
  ...each("PredictBallLateralOffset", 0x70F5, E => chars.predictBallLateralOffset(E), { out: v => hl(v) }),
  ...each("PredictBallLateralOffset/forced", 0x70F5, E => chars.predictBallLateralOffset(E), { out: v => hl(v), prep: (m, s) => {
    G16(m, 0xC40E, R16(s, 1)); G16(m, 0xC448, R16(s, 2)); G16(m, 0xC44A, (R16(s, 3) & 0x7FF) - 0x400);
  } }),
  ...each("StartCharSwing/forced", 0x6D5A, E => chars.startCharSwing(E), { prep: (m, s, b) => {
    scrambleChar(m, s, b); G16(m, 0xC448, (R16(s, 20) & 0x1FF) - 0x100); G16(m, 0xC44A, (R16(s, 21) & 0x1FF) - 0x100);
    G16(m, 0xC40A, -(R16(s, 22) & 0x1FF)); G16(m, 0xC427, (R16(s, 23) & 0x3FF) - 0x200); G16(m, 0xC40E, R16(s, 24));
  } }),
  ...each("SelectForehandBackhand/forced", 0x6E44, E => chars.selectForehandBackhand(E), { prep: (m, s, b) => {
    G16(m, 0xC448, R16(s, 1)); G16(m, 0xC44A, (R16(s, 2) & 0x3FF) - 0x200); G16(m, 0xC40E, R16(s, 3)); W(m, b, 0xDF94, R(s, 4) & 0x20);
  } }),
  ...each("SelectServeShotType/forced", 0x706B, E => chars.selectServeShotType(E), { prep: (m, s, b) => W(m, b, 0xDF16, R(s, 1) & 3) }),
  ...each("SelectRallyShotType/forced", 0x707E, E => chars.selectRallyShotType(E), { prep: (m, s, b) => { W(m, b, 0xDF16, R(s, 1) & 3); W(m, b, 0xDF17, R(s, 2) & 3); W(m, b, 0xDF50, R(s, 3)); } }),
  ...each("BufferShotButtonPress/forced", 0x7112, E => chars.bufferShotButtonPress(E), { out: a => ({ a }), prep: (m, s, b) => scrambleChar(m, s, b) }),
  ...each("CaptureServeAim/forced", 0x7151, E => chars.captureServeAim(E), { prep: (m, s, b) => W(m, b, 0xDF1F, R(s, 1)) }),
  ...each("CaptureShotAim/forced", 0x7167, E => chars.captureShotAim(E), { prep: (m, s, b) => W(m, b, 0xDF1F, pick(s, 2, [0x10, 0x20, R(s, 1), R(s, 1) & 0xF0])) }),
  ...each("ApplyCharMovementInput/forced", 0x719A, E => chars.applyCharMovementInput(E), { prep: (m, s, b) => scrambleChar(m, s, b) }),
  ...each("HandleServePositioning/forced", 0x71DD, E => chars.handleServePositioning(E), { prep: (m, s, b) => {
    scrambleChar(m, s, b); W16(m, b, 0xDF01, (R16(s, 30) & 0x3FF) - 0x200); G(m, 0xC7B9, R(s, 31) & 1);
  } }),
  ...each("CheckSwingRelease/forced", 0x7267, E => chars.checkSwingRelease(E), { out: a => ({ a }), prep: (m, s, b) => scrambleChar(m, s, b) }),
  // ---- movement ----
  ...each("StepCharJumpPhysics/forced", 0x72A6, E => chars.stepCharJumpPhysics(E), { prep: (m, s, b) => {
    W(m, b, 0xDF0F, R(s, 1) | 4); W16(m, b, 0xDF07, -(R16(s, 2) & 0x7F)); W(m, b, 0xDF06, R(s, 3)); W16(m, b, 0xDF44, R16(s, 4) - 0x8000 >> 4);
  } }),
  ...each("StepCharMovement", 0x72DE, E => chars.stepCharMovement(E)),
  ...each("StepCharMovement/forced", 0x72DE, E => chars.stepCharMovement(E), { prep: (m, s, b) => {
    W16(m, b, 0xDF40, (R16(s, 1) & 0x3FFF) - 0x2000); W16(m, b, 0xDF42, (R16(s, 2) & 0x3FFF) - 0x2000);
    W(m, b, 0xDF0F, R(s, 3)); W(m, b, 0xDF1E, pick(s, 4, [0, 1, 0, 5]));
    const near = [0x200, 0x8A, 0x92, 0x6DC, 0x6E4, -0xFC, -0x104, -0x6FC, -0x704, -0x290, -0x2A8, -0x100];
    W16(m, b, 0xDF04, pick(s, 5, near) + (R(s, 6) & 7) - 4);
    W16(m, b, 0xDF01, pick(s, 7, [0, 0x23C, 0x244, 0x39C, 0x3A4, -0x39C, -0x3A4, 0x300]) + (R(s, 8) & 7) - 4);
  } }),
  ...each("UpdateCharVelocityFromInput", 0x73CA, E => chars.updateCharVelocityFromInput(E)),
  ...each("UpdateCharVelocityFromInput/forced", 0x73CA, E => chars.updateCharVelocityFromInput(E), { prep: (m, s, b) => {
    scrambleChar(m, s, b); W(m, b, 0xDF56, R(s, 30) % 5 === 0 ? 1 : 0);
    W16(m, b, 0xDF40, R(s, 31) % 4 === 0 ? 0 : (R16(s, 32) & 0x1FFF) - 0x1000); W16(m, b, 0xDF42, R(s, 33) % 4 === 0 ? 0 : (R16(s, 34) & 0x1FFF) - 0x1000);
  } }),
  ...each("MoveCharTowardTarget/forced", 0x7541, E => chars.moveCharTowardTarget(E), { out: a => ({ a }), prep: (m, s, b) => {
    const c = m.wram[b];
    W16(m, b, 0xDF46, (c[0xF01] | c[0xF02] << 8) + (R16(s, 1) & 0x7F) - 0x40); W16(m, b, 0xDF48, (c[0xF04] | c[0xF05] << 8) + (R16(s, 2) & 0x7F) - 0x40);
  } }),
  ...each("CheckCharNearTarget/forced", 0x78BE, E => chars.checkCharNearTarget(E), { out: a => ({ a }), prep: (m, s, b) => {
    const c = m.wram[b];
    W16(m, b, 0xDF46, (c[0xF01] | c[0xF02] << 8) + (R16(s, 1) & 0x3F) - 0x20); W16(m, b, 0xDF48, (c[0xF04] | c[0xF05] << 8) + (R16(s, 2) & 0x3F) - 0x20);
  } }),
  ...each("EaseCharFacing/forced", 0x75C0, E => chars.easeCharFacing(E), { prep: (m, s, b) => scrambleChar(m, s, b) }),
  ...each("UpdateCharFacingOctant/forced", 0x75E8, E => chars.updateCharFacingOctant(E), { out: d => ({ d }), prep: (m, s, b) => {
    scrambleChar(m, s, b); W(m, b, 0xDF2E, pick(s, 30, [1, 2, 5, 0x12])); W(m, b, 0xDF0C, R(s, 31));
  } }),
  ...each("ReloadCharFacingTiles/forced", 0x7621, (E, r) => chars.reloadCharFacingTiles(E, r.d), { regs: s => ({ d: R(s, 1) & 7 }), prep: (m, s, b) => {
    W(m, b, 0xDF30, R(s, 2) & 0x40); W(m, b, 0xDF33, R(s, 3) % 6);
  } }),
  // ---- animation, drawing-side state, input ----
  ...each("StepCharAnimation", 0x7791, E => chars.stepCharAnimation(E)),
  ...each("StepCharAnimation/forced", 0x7791, E => chars.stepCharAnimation(E), { prep: (m, s, b) => { if (R(s, 1) & 1) W(m, b, 0xDF2F, 0); } }),
  ...each("SetCharAnimation/forced", 0x69EA, (E, r) => chars.setCharAnimation(E, r.d), { regs: s => ({ d: R(s, 1) % 0x13 }) }),
  ...each("UpdateChargeFlash/forced", 0x764B, E => chars.updateChargeFlash(E), { prep: (m, s, b) => {
    W(m, b, 0xDF51, R(s, 1) % 4 ? 1 : 0); W(m, b, 0xDF4B, R(s, 2) & 0x3F); W(m, b, 0xDF52, R(s, 3) & 1); m.hram[0x3C] = R(s, 4) % 5 === 0 ? 1 : 0;
  } }),
  ...each("EndChargeFlash/forced", 0x7666, E => chars.endChargeFlash(E), { prep: (m, s, b) => { W(m, b, 0xDF52, R(s, 1) & 1); m.hram[0x3C] = R(s, 2) % 5 === 0 ? 1 : 0; } }),
  ...each("BuildCharSpriteSlots", 0x7672, E => chars.buildCharSpriteSlots(E)),
  ...each("BuildCharSpriteSlots/forced", 0x7672, E => chars.buildCharSpriteSlots(E), { prep: (m, s, b) => {
    W16(m, b, 0xDF01, (R16(s, 1) & 0xFFF) - 0x800); W16(m, b, 0xDF04, (R16(s, 2) & 0xFFF) - 0x800); W16(m, b, 0xDF07, -(R16(s, 3) & 0xFF));
    W(m, b, 0xDF0F, R(s, 4) & 4); W(m, b, 0xDF32, R(s, 5) & 7); G(m, 0xC4C4, R(s, 6) & 1); G(m, 0xC4CA, R(s, 7) & 1);
    m.hram[0x69] = R(s, 8); m.hram[0x1B] = pick(s, 9, [0, 0x40, 0x9C, 0xA0, 0x98]); W(m, b, 0xDF37, R(s, 10));
  } }),
  ...each("BuildAirborneShadowSlot/forced", 0x7745, E => chars.buildAirborneShadowSlot(E), { prep: (m, s, b) => {
    W(m, b, 0xDF0F, R(s, 1) & 4); W16(m, b, 0xDF07, (R16(s, 2) & 0xFF) - 0x80);
  } }),
  ...each("ReadCharInput", 0x780C, E => chars.readCharInput(E)),
  ...each("ReadCharInput/forced", 0x780C, E => chars.readCharInput(E), { prep: (m, s, b) => {
    W(m, b, 0xDF1E, pick(s, 1, [0, 1, 2, 3, 4, 5, 6])); m.hram[0x42] = R(s, 2) % 3;
    m.hram[0x10] = R(s, 3); m.hram[0x14] = R(s, 4); m.hram[0x53] = R(s, 5); m.hram[0x54] = R(s, 6); m.hram[0x55] = R(s, 7);
  } }),
  // ---- setup ----
  ...each("SetCharPosAndTarget", 0x6988, (E, r) => chars.setCharPosAndTarget(E, r.h << 8 | r.l, r.d << 8 | r.e), { regs: s => ({ ...hl(R16(s, 1)), d: R(s, 2), e: R(s, 3) }) }),
  ...each("SetCharTarget", 0x69AE, (E, r) => chars.setCharTarget(E, r.h << 8 | r.l, r.d << 8 | r.e), { regs: s => ({ ...hl(R16(s, 1)), d: R(s, 2), e: R(s, 3) }) }),
  ...each("SetCharFacing", 0x6A2C, (E, r) => chars.setCharFacing(E, r.a), { regs: s => ({ a: R(s, 1) }) }),
  ...each("FlipCharPositionCode", 0x6A33, (E, r) => chars.flipCharPositionCode(E, r.b), { regs: s => ({ b: R(s, 1) & 3 }) }),
  // ForEachCharBank with hl = FlipCharPositionCode (b survives the loop)
  { name: "ForEachCharBank", bank: 8, addr: 0x6A3A, wram: 5, regs: s => ({ h: 0x6A, l: 0x33, b: R(s, 1) & 3 }),
    js: (E, r) => chars.forEachCharBank(E, () => chars.flipCharPositionCode(E, r.b)) },
  ...each("SetCharState", 0x6A1C, (E, r) => chars.setCharState(E, r.a), { regs: s => ({ a: R(s, 1) & 7 }) }),
  ...BANKS.map(bank => ({ name: `LoadCharacterAttributes@${bank}`, bank: 7, addr: 0x5AB3, wram: bank, prep: m => { m.hram[0x15] = 7; liveSlot(m, bank); }, js: E => chars.loadCharacterAttributes(E) })),
  ...BANKS.map(bank => ({ name: `LoadCharacterAttributes/forced@${bank}`, bank: 7, addr: 0x5AB3, wram: bank, prep: (m, s) => {
    m.hram[0x15] = 7; liveSlot(m, bank);                                  // hRomBank as romCall sets it
    W(m, bank, 0xDF0B, R(s, 1) & 3); G(m, 0xC4EE, R(s, 2) & 2);
    const rec = [0xCA00, 0xCA80, 0xCA40, 0xCAC0][m.wram[bank][0xF0B] & 3];
    for (const o of [0x0E, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2A]) G(m, rec + o, R(s, 10 + o) % 10);
    G(m, rec + 0x2B, pick(s, 3, [0, 1, 3, 9, 0x7F, 0x80, 0xF8])); G(m, rec + 0x1A, R(s, 4));
  }, js: E => chars.loadCharacterAttributes(E) })),
  ...each("InitChar/forced", 0x684A, (E, r) => chars.initChar(E, r.a, r.d, r.e), { regs: s => ({ a: R(s, 1) & 3, d: pick(s, 2, [0, 5, 0x10, 0x17, 0x1A, 0x1F, 0x20, 0x35, 0x50]), e: R(s, 3) & 7 }),
    prep: (m, s) => { m.hram[0x3C] = R(s, 4) % 5 === 0 ? 1 : 0; } }),
  { name: "InitAllChars", bank: 8, addr: 0x687F, wram: 4, js: E => chars.initAllChars(E) },
  { name: "InitAllChars/forced", bank: 8, addr: 0x687F, wram: 4, prep: (m, s) => {
    G(m, 0xC4CF, R(s, 1) & 3); G(m, 0xC8F2, R(s, 2) & 1); G(m, 0xC33F, R(s, 3) % 4 === 0 ? 1 : 0);
    for (const a of [0xCA0B, 0xCA4B, 0xCA8B, 0xCACB]) G(m, a, R(s, a & 0xFF) & 0x1F);
  }, js: E => chars.initAllChars(E) },
];

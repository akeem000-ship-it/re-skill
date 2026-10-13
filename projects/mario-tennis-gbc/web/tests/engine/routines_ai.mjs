// The CPU player (web/js/engine/ai.js) checked routine by routine against the ROM. The CPU opponent in the
// recordings is character 1 (WRAM bank 5). The "/forced" entries put the AI into each state, phase, strategy,
// serve style and doubles role, with the inputs it branches on (reach flags, incoming shot type, walk target
// near or far, teammate swinging...) scrambled per state from the frame number, the same on both sides.
import * as ai from "../../js/engine/ai.js";

const CPU = 5;                                         // WRAM bank of the CPU character
const hl = r => ({ h: r >> 8, l: r & 0xFF }), de = r => ({ d: r >> 8, e: r & 0xFF });
// a few pseudo-random bits from the frame and a salt
function r(s, salt, n) {                              // a well-mixed hash of (frame, salt), 0..n-1
  let h = Math.imul(s.f + 1, 0x9E3779B1) ^ Math.imul(salt + 1, 0x85EBCA77);
  h ^= h >>> 16; h = Math.imul(h, 0x7FEB352D); h ^= h >>> 15; h = Math.imul(h, 0x846CA68B); h ^= h >>> 16;
  return (h >>> 0) % n;
}
// raw writes into the core's RAM: a char field (bank, $DFxx) and a WRAM0 global ($Cxxx)
const c8 = (m, bank, addr, v) => { m.wram[bank][addr - 0xD000] = v & 0xFF; };
const c16 = (m, bank, addr, v) => { c8(m, bank, addr, v); c8(m, bank, addr + 1, v >> 8); };
const c16get = (m, bank, addr) => m.wram[bank][addr - 0xD000] | m.wram[bank][addr - 0xD000 + 1] << 8;
const g8 = (m, addr, v) => { m.wram[0][addr - 0xC000] = v & 0xFF; };
const g16 = (m, addr, v) => { g8(m, addr, v); g8(m, addr + 1, v >> 8); };

// scramble everything the AI branches on (salt varies the draw per entry)
function scramble(m, s, salt, { state, phase, doubles = 0, netPlayer = 0 } = {}) {
  const R = n => r(s, salt++, n);
  if (state !== undefined) c8(m, CPU, 0xDF18, state);
  if (phase !== undefined) c8(m, CPU, 0xDF1A, phase);
  c8(m, CPU, 0xDF12, R(8) ? 0 : 1 + R(4));                          // wAiActionTimer: mostly expired
  c8(m, CPU, 0xDF13, [0, 0, 1, 5][R(4)]);                            // wAiSecondButtonDelay
  c8(m, CPU, 0xDF50, [0, 1, 2, 3, 0x10, 0x11, 0x12, 0x13][R(8)]);     // wCharBallReachFlags
  c8(m, CPU, 0xDF5A, R(4) ? 1 : 0);                                  // wCharRallyReady
  c8(m, CPU, 0xDF59, [0, 0, 1, 6][R(4)]);                            // wAiTrackingCountdown
  c8(m, CPU, 0xDF17, R(2) ? 0 : 1 + R(3));                           // wCharShotButton2
  c8(m, CPU, 0xDF7F, R(8));                                          // wAiPositionStrategy 0-7
  c8(m, CPU, 0xDF7D, R(9));                                          // wAiServeStyle: CharGroupTable rows 0-8
  c8(m, CPU, 0xDF7C, R(256));                                        // wAiAimAwayChance
  c8(m, CPU, 0xDF2E, R(2) ? 0x10 : R(0x20));                         // wCharAnimId: serve stance half the time
  c8(m, CPU, 0xDF0A, R(4));                                          // wCharCourtPos (bit 0 left, bit 1 far side)
  if (R(2)) {                                                        // walk target near the character
    c16(m, CPU, 0xDF46, c16get(m, CPU, 0xDF01) + R(0x40) - 0x20);
    c16(m, CPU, 0xDF48, c16get(m, CPU, 0xDF04) + R(0x40) - 0x20);
  }
  g8(m, 0xC4A0, [0x0A, 0x0B, 0, 1, 2, 3, 0x0C][R(7)]);               // wCurrentShotType: lob, drop, others
  g8(m, 0xC4C6, R(4) ? 0 : 1);                                       // wFallbackTrajectoryFlag
  g8(m, 0xC4DA, R(3) ? 0 : 1);                                       // wLandingMarkerActive
  g8(m, 0xC4BF, R(2)); g8(m, 0xC4B4, R(2));                          // wBallHasBouncedFlag, wBallCrossedNetFlag
  g8(m, 0xC4B6, R(4));                                               // wRallyLength
  g16(m, 0xC7B6, R(3) ? 0 : R(0x400) - 0x200);                       // wAiServeTargetX
  g8(m, 0xC7A8, R(4) ? 0 : 1);                                       // wAiServeSkipToss
  g8(m, 0xC7B5, R(3) ? 0xFF : [0, 0x10, 0x20][R(3)]);                // wAiServeAimOverride
  g8(m, 0xC8EE, R(4) ? 0 : 1);                                       // wServeFaultFlag
  if (!R(3)) g16(m, 0xC44A, R(0x600) - 0x300);                       // wBallRelCharDepth: around the lob threshold
  g8(m, 0xC8F2, doubles);                                            // wMatchIsDoubles
  if (doubles) {
    g8(m, 0xC8F3, 4);                                                // wOnCourtCharCount
    c8(m, CPU, 0xDF09, (R(4) & ~2) | (netPlayer ? 2 : 0));           // wCharServeRole: bit 1 = forward member
    for (const b of [4, 6, 7]) {                                     // the others: role, swing button, depth, X
      c8(m, b, 0xDF09, R(4)); c8(m, b, 0xDF16, R(2) ? 0 : 1 + R(2));
      c16(m, b, 0xDF04, R(0xA00) - 0x500); c16(m, b, 0xDF46, R(0x600) - 0x300);
      c16(m, b, 0xDF01, R(0x600) - 0x300); c16(m, b, 0xDF40, R(3) ? R(0x200) - 0x100 : 0);
    }
  }
}

const E_AI = (name, extra = {}) => ({ bank: 8, addr: 0x7863, wram: CPU, js: E => ai.charInputHandler1(E), ...extra, name });
const forced = [];
let salt = 1;
// singles: rally 0-5, recovery 0-2, serve 0-5 (plus the inert states)
for (const [state, phases] of [[1, 6], [2, 3], [3, 6]])
  for (let p = 0; p < phases; p++) { const k = salt++; forced.push(E_AI(`CharInputHandler1_08/singles s${state} p${p}`, { prep: (m, s) => scramble(m, s, k * 100, { state, phase: p }) })); }
for (const state of [0, 4, 5, 6, 7]) { const k = salt++; forced.push(E_AI(`CharInputHandler1_08/singles s${state}`, { prep: (m, s) => scramble(m, s, k * 100, { state, phase: 0 }) })); }
// doubles: net player and baseliner, rally 0-8, recovery, serve
for (const netPlayer of [1, 0]) {
  const role = netPlayer ? "net" : "base";
  for (const [state, phases] of [[1, 9], [2, netPlayer ? 3 : 4], [3, 6]])
    for (let p = 0; p < phases; p++) { const k = salt++; forced.push(E_AI(`CharInputHandler1_08/doubles-${role} s${state} p${p}`, { prep: (m, s) => scramble(m, s, k * 100, { state, phase: p, doubles: 1, netPlayer }) })); }
}
// each strategy through the choose-position phase, each serve style through the toss and the shot pick
for (let st = 0; st < 8; st++) forced.push(E_AI(`CharInputHandler1_08/strategy ${st}`, { prep: (m, s) => { scramble(m, s, 7000 + st, { state: 1, phase: 1 }); c8(m, CPU, 0xDF12, 0); c8(m, CPU, 0xDF7F, st); } }));
for (let st = 0; st < 8; st++) forced.push(E_AI(`CharInputHandler1_08/home ${st}`, { prep: (m, s) => { scramble(m, s, 7100 + st, { state: 2, phase: 0 }); c8(m, CPU, 0xDF12, 0); c8(m, CPU, 0xDF7F, st); } }));
for (let st = 0; st < 16; st++) forced.push(E_AI(`CharInputHandler1_08/serve-style ${st}`, { prep: (m, s) => { scramble(m, s, 7200 + st, { state: 3, phase: 2 }); c8(m, CPU, 0xDF12, 0); c8(m, CPU, 0xDF7D, st); g8(m, 0xC7A8, 0); g8(m, 0xC8EE, 0); } }));
for (let st = 0; st < 9; st++) forced.push(E_AI(`CharInputHandler1_08/shot-style ${st}`, { prep: (m, s) => { scramble(m, s, 7300 + st, { state: 1, phase: 3 }); c8(m, CPU, 0xDF12, 0); c8(m, CPU, 0xDF7D, st); c8(m, CPU, 0xDF50, 1); } }));

export const ROUTINES = [
  // the whole controller on the recorded states, as is and with the reaction timer expired
  E_AI("CharInputHandler1_08"),
  E_AI("CharInputHandler1_08/timer0", { prep: (m, s) => c8(m, CPU, 0xDF12, 0) }),
  ...forced,
  // helpers on their own
  { name: "AiSteerTowardTarget", bank: 8, addr: 0x7908, wram: CPU, js: E => ai.aiSteerTowardTarget(E) },
  { name: "AiSteerTowardBall", bank: 8, addr: 0x7944, wram: CPU, js: E => ai.aiSteerTowardBall(E) },
  { name: "AiAdvancePhase", bank: 8, addr: 0x7968, wram: CPU, js: E => ai.aiAdvancePhase(E) },
  { name: "CheckCharNearTarget(TEMP)", bank: 8, addr: 0x78BE, wram: CPU, prep: (m, s) => scramble(m, s, 9000), js: E => ai.checkCharNearTarget(E), out: a => ({ a }) },
  { name: "PredictBallXAtDepth", bank: 8, addr: 0x7C86, wram: CPU, regs: s => de(r(s, 1, 0x10000)), js: (E, R) => ai.predictBallXAtDepth(E, R.d << 8 | R.e), out: v => hl(v) },
  { name: "MirrorDepthForFarSide", bank: 8, addr: 0x7C33, wram: CPU, regs: s => de(r(s, 2, 0x10000)), prep: (m, s) => c8(m, CPU, 0xDF0A, s.f & 3),
    js: (E, R) => ai.mirrorDepthForFarSide(E, R.d << 8 | R.e), out: v => de(v) },
  { name: "GetCharRoleByIndex", bank: 8, addr: 0x7C40, wram: CPU, regs: s => ({ a: s.f & 3 }), js: (E, R) => ai.getCharRoleByIndex(E, R.a), out: b => ({ b }) },
  { name: "SetCharTargetMirrored", bank: 8, addr: 0x7C70, wram: CPU, regs: s => ({ ...hl(r(s, 3, 0x10000)), ...de(r(s, 4, 0x10000)) }), prep: (m, s) => c8(m, CPU, 0xDF0A, s.f & 3),
    js: (E, R) => ai.setCharTargetMirrored(E, R.h << 8 | R.l, R.d << 8 | R.e) },
  { name: "SetCharTarget(TEMP)", bank: 8, addr: 0x69AE, wram: CPU, regs: s => ({ ...hl(r(s, 5, 0x10000)), ...de(r(s, 6, 0x10000)) }),
    js: (E, R) => ai.setCharTarget(E, R.h << 8 | R.l, R.d << 8 | R.e) },
  { name: "AiRollAimAwayFromChar", bank: 8, addr: 0x7B13, wram: CPU, regs: s => ({ a: s.f & 1 }), prep: (m, s) => scramble(m, s, 9100), js: (E, R) => ai.aiRollAimAwayFromChar(E, R.a) },
  { name: "AiAimAwayFromChar", bank: 8, addr: 0x7B1F, wram: CPU, regs: s => ({ c: s.f & 3 }), prep: (m, s) => scramble(m, s, 9200, { doubles: 1 }), js: (E, R) => ai.aiAimAwayFromChar(E, R.c) },
  { name: "AiPickShotButtons", bank: 8, addr: 0x7B7B, wram: CPU, prep: (m, s) => scramble(m, s, 9300, { doubles: s.f % 3 === 0 ? 1 : 0 }), js: E => ai.aiPickShotButtons(E) },
  { name: "AiPickServeButtons", bank: 8, addr: 0x7B62, wram: CPU, js: E => ai.aiPickServeButtons(E) },
  { name: "AiApplyServeAim", bank: 8, addr: 0x7AEB, wram: CPU, prep: (m, s) => scramble(m, s, 9400), js: E => ai.aiApplyServeAim(E) },
];

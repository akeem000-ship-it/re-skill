// Match play and the two-player contests (bank 08). Match play (wGameMode 2) counts holes: each hole goes to the
// player who holes out in fewer strokes (wMatchHoles $C96E: 1 / 2, 0 halved), the match ends when one leads by more
// holes than are left (wRoundResult $C96C), a level match after the last hole goes to a playoff (wMatchPlayoff
// $C83A). With two players there are contests on par 3s (nearest the pin) and par 5s (longest drive): the leader
// $D491, the best $D48F, the wins this hole $D494-$D497 added to the players' records (+$17 drive, +$18 near pin).
// Several of these routines print their values to the debug text buffer ($CC00, PrintHexByte 00:22A5 /
// PrintDecimalByte 00:22D2): kept, as the game does it.
import { rd16, wr16, ball, playerField as pf } from "./memory.js";
import { registerFrameTask, unregisterFrameTask } from "./tasks.js";
import { showCaptionAndWait } from "./captions.js";
import { pinDist, shotLength } from "./cup.js";
import { lieTerrain } from "./shot.js";
import { formatDecimalNumber } from "./render/text.js";
import * as D from "./render/display.js";
import { showScorecard } from "./scorecard.js";

const W0 = w => w.wram[0];
const field = (w, p, f) => 0x880 + (p ? 0x40 : 0) + f;    // player p's record byte f

// ---- the debug text buffer: 00:209C GetDebugTextBufferAddr ($CC00 + d + e x 32), 00:20B1 PrintString ----
function printString(w, s, d, e) {
  const w0 = W0(w);
  let p = (0xCC00 + d + e * 32) & 0xFFFF;
  for (const ch of s) {
    if (!ch) break;
    w0[p - 0xC000] = ch;
    p = (p + 1) & 0xFFFF;
    if (!(p & 0x1F)) p = (p - 0x20) & 0xFFFF;
  }
  w.high[0x18E] = 1;
}
const hexDigit = v => (v < 10 ? 0x30 + v : 0x37 + v);
// 00:22A5 PrintHexByte: FormatHexWord 00:20E0 of a (4 digits; the skip of the first two is lost: all four print)
export function printHexByte(w, a, de) {
  printString(w, [0x30, 0x30, hexDigit(a >> 4), hexDigit(a & 0x0F), 0], de >> 8, de & 0xFF);
}
export function printDecimalByte(w, a, de) {     // 00:22D2 PrintDecimalByte (width 4)
  printString(w, formatDecimalNumber(a, 4), de >> 8, de & 0xFF);
}

// ---- the match standing ----
export function matchLeadP1(w) {                 // 08:403C MatchLeadP1: holes won by P1 - by P2 before this hole
  const w0 = W0(w);
  printHexByte(w, w0[0x83A], 0x0905);
  if (w0[0x83A]) return 0;                       // a playoff
  printHexByte(w, w0[0x837], 0x0906);
  let d = 0;
  for (let c = (w0[0x837] - 1) & 0xFF, p = 0x96E; c; c--, p++) {
    const v = w0[p];
    if (v < 1) continue;
    if (v === 1) d++; else d--;
  }
  return d & 0xFF;
}
const matchLeadP2 = w => (-matchLeadP1(w)) & 0xFF;   // 08:407C MatchLeadP2

// 08:4091 MatchStatus: |lead| against wHolesLeft: $FF decided / 1 or 2 the lead equals the holes left (P1 / P2
// leading: dormie) / 3 one hole less, or one hole left / 0
export function matchStatus(w) {
  const w0 = W0(w);
  let b = w0[0x839];
  printHexByte(w, b, 0x0903);
  const c = matchLeadP1(w);
  printHexByte(w, c, 0x0904);
  const a = c & 0x80 ? (-c) & 0xFF : c;
  if (a === b) return c & 0x80 ? 2 : 1;
  if (a > b) return 0xFF;
  b = (b - 1) & 0xFF;
  if (!b || a === b) return 3;
  return 0;
}
function matchStatusDebug(w) {                   // 08:4082 MatchStatusDebug
  const a = matchStatus(w);
  printHexByte(w, a, 0x0902);
  return a;
}

function setHonourFromHole(w, a) {               // 08:40D5 SetHonourFromHole: the hole's winner has the honour
  a = (a - 1) & 0xFF;
  if (a < 2) W0(w)[0x83B] = a;
}

// 08:40E1 MatchHoleStatus: the current player's strokes against the other's ($2A holed out, $20 strokes) and the
// match: 0-3 (1: caption $1C; 2, 3: caption $1A on the green)
function matchHoleStatus(w) {
  const w0 = W0(w), cur = w0[0x835], other = cur ^ 1;
  const b = w0[field(w, other, 0x2A)], c = w0[field(w, other, 0x20)];
  const a = w0[field(w, cur, 0x20)];
  if (b) {                                       // the other has holed out in c
    const c1 = (c - 1) & 0xFF;
    if (a > c1) return 0;
    if (a === c1) return matchStatusDebug(w) !== cur + 1 ? 1 : 3;
  }
  if (a < c) {                                   // 08:4120
    const st = matchStatusDebug(w);
    if (st === cur + 1) return 3;
    if (st !== other + 1) return 2;
    if (!b) return 2;
    return ((a + 2) & 0xFF) >= c ? 1 : 2;
  }
  if (a >= ((c + 1) & 0xFF) || b) return 0;     // 08:4147
  return matchStatusDebug(w) === cur + 1 ? 3 : 0;
}

// 08:4199 MatchHoleOutcome: 0 undecided / 1 P1 / 2 P2 / 3 halved
function matchHoleOutcome(w) {
  const w0 = W0(w);
  const b = w0[field(w, 1, 0x2A)], c = w0[field(w, 1, 0x20)];   // P2 holed out, strokes
  const d = w0[field(w, 0, 0x2A)], e = w0[field(w, 0, 0x20)];   // P1
  if (!(d | b)) return 0;
  if (d && b) return c === e ? 3 : c < e ? 2 : 1;
  if (d) {                                       // 08:41EF: P1 holed out, P2 not
    const a = (e - 1) & 0xFF;
    if (a < c) return 1;
    if (a !== c) return 0;
    return matchStatusDebug(w) === 1 ? 3 : 0;
  }
  const a = (c - 1) & 0xFF;                      // 08:41DB: P2 holed out, P1 not
  if (a < e) return 2;
  if (a !== e) return 0;
  return matchStatusDebug(w) === 2 ? 3 : 0;
}

// 08:4161 MatchHoleResult: [outcome, c]: c = 1 / 2 when this hole also ends the match for P1 / P2
function matchHoleResult(w) {
  const a = matchHoleOutcome(w);
  if (!a) return [0, 0];
  const s = matchStatusDebug(w);
  if (!s) return [a, 0];
  if (a === 1) return [a, matchLeadP1(w) & 0x80 ? 0 : 1];
  if (a === 2) return [a, matchLeadP2(w) & 0x80 ? 0 : 2];
  return [a, s === 3 ? 0 : s];
}

// ---- the contests ----
export function clearContestWins(w) {            // 08:4203 ClearContestWins
  const w0 = W0(w);
  w0[0x897] = w0[0x898] = 0;
  w0[0x8D7] = w0[0x8D8] = 0;
}

function setContestLeader(w, a, hl) {            // 08:4244 SetContestLeader
  const r6 = w.wram[6];
  r6[0x491] = a;
  wr16(r6, 0x48F, hl);
}

// 08:420F InitHoleContest: par 3: nearest the pin (best $1900, caption $2A); par 5: the longest drive (best 0,
// caption $29)
export function* initHoleContest(sh) {
  const w = sh.w, r6 = w.wram[6];
  r6.fill(0, 0x494, 0x499);
  if (r6[0x325] === 3) {
    yield* showCaptionAndWait(sh, 0x2A);
    setContestLeader(w, 0xFF, 0x1900);
  } else if (r6[0x325] === 5) {
    yield* showCaptionAndWait(sh, 0x29);
    setContestLeader(w, 0xFF, 0x0000);
  }
}

// 08:4250 UpdateHoleContest: each player's first shot ($D498 counts them)
export function* updateHoleContest(sh) {
  const w = sh.w, r6 = w.wram[6], w0 = W0(w), s = ball(w);
  if (r6[0x498] >= 2) return;
  r6[0x498]++;
  const cur = w0[0x835];
  if (r6[0x325] === 3) {                         // nearest the pin: a ball on the green ($2A: holed out counts 0)
    let hl = null;
    if (w0[pf(w, 0x2A)]) hl = 0;
    else if (lieTerrain(sh.hole, s) === 6) hl = pinDist(s);   // 10:648B, 10:62AD
    if (hl !== null) {
      const d = (hl - rd16(r6, 0x48F)) & 0xFFFF;
      if (d && d & 0x8000) setContestLeader(w, cur, hl);
    }
    if (r6[0x498] < 2 || r6[0x491] === 0xFF) return;
    r6[0x496 + (r6[0x491] & 1)]++;               // wNearPinWins
    const leader = r6[0x491];
    if (r6[0x443] !== 1) {
      registerPictureStop(w);
      yield* sh.loadView(1);                     // 13:432B
    }
    showLeaderSprite(w, leader);
    yield* showCaptionAndWait(sh, 0x22);
    hideLeaderSprite(w);
    return;
  }
  if (r6[0x325] !== 5) return;
  const t = lieTerrain(sh.hole, s);              // the longest drive: on the fairway, the green, $0A or $0E
  if ([0, 6, 0x0A, 0x0E].includes(t)) {
    const hl = shotLength(s, r6.subarray(0x5F8, 0x5FE));   // 10:6276 ShotLength
    const d = (hl - ((rd16(r6, 0x48F) + 1) & 0xFFFF)) & 0xFFFF;
    if (d && !(d & 0x8000)) setContestLeader(w, cur, hl);
  }
  if (r6[0x498] < 2 || r6[0x491] === 0xFF) return;
  r6[0x494 + (r6[0x491] & 1)]++;                 // wDriveContestWins
  showLeaderSprite(w, r6[0x491]);
  yield* showCaptionAndWait(sh, 0x20);
  hideLeaderSprite(w);
}
function registerPictureStop(w) { unregisterFrameTask(w, 0x4A, 0x62A3); }   // 4A:629C PictureCycleStop

function showLeaderSprite(w, a) {                // 08:437C ShowContestLeaderSprite
  registerFrameTask(w, 0x20, 0x08, a ? 0x43AB : 0x439E);
}
function hideLeaderSprite(w) {                   // 08:4391 HideContestLeaderSprite
  unregisterFrameTask(w, 0x08, 0x439E);
  unregisterFrameTask(w, 0x08, 0x43AB);
}
export function contestLeaderSpriteTask(w, p) {  // 08:439E / 08:43AB: a 2 x 1 sprite grid at ($38, $48)
  if (w.vram) D.inBank(w, 0x08, () => D.queueSpriteGrid(w, 0x0201, 0x4838, p ? 0x0D6C : 0x0C5C));
}

export function addContestWinsToPlayers(w) {     // 08:432F AddContestWinsToPlayers
  const w0 = W0(w), r6 = w.wram[6];
  printDecimalByte(w, w.high[0x196], 0x0808);
  w0[0x897] = (w0[0x897] + r6[0x494]) & 0xFF;
  w0[0x898] = (w0[0x898] + r6[0x496]) & 0xFF;
  w0[0x8D7] = (w0[0x8D7] + r6[0x495]) & 0xFF;
  w0[0x8D8] = (w0[0x8D8] + r6[0x497]) & 0xFF;
  printDecimalByte(w, w0[0x897], 0x0809);
  printDecimalByte(w, w0[0x898], 0x080A);
  printDecimalByte(w, w0[0x8D7], 0x080B);
  printDecimalByte(w, w0[0x8D8], 0x080C);
}

// ---- the round hooks of match play ----
export function* holeStartMode2(sh, playRoundMusic) {   // 08:4847 HoleStartMode2Match
  const w = sh.w, w0 = W0(w);
  w0[0x835] = !w0[0x83A] && w0[0x837] === 1 ? 1 : w0[0x83B] ^ 1;
  yield* initHoleContest(sh);                    // 08:420F
  if (w0[0x83A]) { yield* showCaptionAndWait(sh, 0x1E); return; }   // a playoff
  const s = matchStatusDebug(w);
  if (((s - 1) & 0xFF) >= 2) return;
  w0[0x832] = 1;                                 // dormie: wDecisiveHole, its music and caption $26
  playRoundMusic(sh);                            // 08:5062
  yield* showCaptionAndWait(sh, 0x26);
}

export function* playerUpMode2(sh, showPuttForCaption) {   // 08:48BD PlayerUpMode2Match
  const w = sh.w;
  yield* showPuttForCaption(sh);                 // 08:4F30
  const a = matchHoleStatus(w);                  // 08:40DD
  if (!a) return;
  if (a === 1) { yield* showCaptionAndWait(sh, 0x1C); return; }
  if (w.wram[6][0x4CD] === 6) yield* showCaptionAndWait(sh, 0x1A);
}

export function* afterShotMode2(sh, scorecard) { // 08:494B AfterShotMode2Match
  const w = sh.w, w0 = W0(w), r6 = w.wram[6];
  yield* updateHoleContest(sh);                  // 08:4250
  if (r6[0x48E] & 0x80) {                        // the other player's putt is given: holed with one stroke more
    const o = w0[0x835] ^ 1;
    if (!w0[field(w, o, 0x2A)]) {
      w0[field(w, o, 0x2A)] = 1;
      w0[field(w, o, 0x20)] = (w0[field(w, o, 0x20)] + 1) & 0xFF;
    }
  }
  const [a, c] = matchHoleResult(w);             // 08:4161
  if (!a) return;
  setHonourFromHole(w, a);
  const slot = 0x96E + Math.min((w0[0x837] - 1) & 0xFF, 0x11);
  const asPlayer = (p, fn) => { const k = w0[0x835]; w0[0x835] = p; fn(); w0[0x835] = k; };
  if (a === 1 || a === 2) {
    if (!w0[0x83A]) w0[slot] = a;
    scorecard(w);                                // 10:4101
    if (a === 1) asPlayer(1, () => { w0[0x8E0] = (w0[0x8A0] + 1) & 0xFF; scorecard(w); });
    else asPlayer(0, () => { w0[0x8A0] = (w0[0x8E0] + 1) & 0xFF; scorecard(w); });
    sh.sound((a === 1) !== (w0[0x893] === 3) ? 0x20 : 0x21);   // (link play: the other way round)
  } else {
    if (!w0[0x83A]) w0[slot] = 0;
    scorecard(w);
    const b = w0[0x835], strokes = w0[field(w, b, 0x20)];
    asPlayer(b ^ 1, () => { w0[field(w, b ^ 1, 0x20)] = strokes; scorecard(w); });
    sh.sound(0x22);
  }
  w0[0x8AA] = w0[0x8EA] = 1;                     // both holed out
  if (c) w0[0x96C] = c;                          // wRoundResult
}

export function* holeEndMode2(sh, showHalfwayPicture, setDecisiveHoleOnLast) {   // 08:4B64 HoleEndMode2Match
  const w = sh.w, w0 = W0(w);
  addContestWinsToPlayers(w);
  w0[0x4BD] = 1;                                 // wStandingsPhase
  yield* showStandingsFar(sh);                   // 3E:675C
  if (w0[0x96C]) { w0[0x839] = 1; return; }      // decided: the round ends
  if (w0[0x839] < 2) { w0[0x83A] = 1; w0[0x839] = 2; }   // level after the last hole: a playoff
  yield* showHalfwayPicture(sh);                 // 08:4F75
  setDecisiveHoleOnLast(w);                      // 08:4BAA
}

function* showStandingsFar(sh) {                 // 3E:675C ShowStandingsFar: farcall 0E:43D6 ShowScorecard
  yield* showScorecard(sh);
}


// 08:4D7D-08:4E8C after a match: a win against golfers 4-$0A: the first-win EXP bonus (08:4E97 AwardFirstWinBonus:
// game flags $0A00-$0B80 by golfer) and a save flag ($80-$140; 02:4522 SetSaveFlag sets bit e of SRAM $A038[d], its
// SaveCommit not modelled); golfer 7 also sets the return map $30 entrance 5 unless flag #188; a loss against
// golfers 4-7 sets flags #132-#135
export function matchRoundEndFlags(w) {
  const w0 = W0(w), c = w0[0x8D0];
  if (w0[0x33F]) return;                         // link play
  if (w0[0x96C] !== 1) {
    if (c >= 4 && c <= 7) setFlag(w, 132 + c - 4);
    return;
  }
  const win = { 4: [0x0A00, 0x28, 0x14, 0x80], 5: [0x0A40, 0x46, 0x15, 0xA0], 6: [0x0A80, 0x8C, 0x16, 0xC0],
    7: [0x0AC0, 0xC8, 0x17, 0xE0], 8: [0x0B00, 0x190, 0x18, 0x100], 9: [0x0B40, 0x32, 0x19, 0x120], 0x0A: [0x0B80, 0x190, 0x1A, 0x140] }[c];
  if (!win) return;
  const [de, hl, kind, save] = win;
  awardFirstWinBonus(w, de, hl, kind);
  setSaveFlag(w, save);
  if (c === 7 && w0[0x960] === 0 && !testFlag(w, 188)) { w0[0x960] = 0x30; w0[0x961] = 0x05; }
}
const testFlag = (w, n) => W0(w)[0x840 + (n >> 3)] & (0x80 >> (n & 7));   // 00:2D10
const setFlag = (w, n) => { W0(w)[0x840 + (n >> 3)] |= 0x80 >> (n & 7); };   // 00:2D2E
function awardFirstWinBonus(w, de, hl, c) {      // 08:4E97 AwardFirstWinBonus: de = flag << 5
  const w0 = W0(w), n = de >> 5;
  if (!testFlag(w, n)) { w0[0xAAD] = c; w0[0xAAE] = hl & 0xFF; w0[0xAAF] = hl >> 8; }
  setFlag(w, n);
  if (!w0[0x814]) setFlag(w, ((de + 0x20) & 0xFFFF) >> 5);
}
export function setSaveFlag(w, de) {                    // 02:4522 SetSaveFlag: d = byte, e = bit (00:2D08 masks)
  const e = de & 0xFF, d = de >> 8;
  w.sram[0x38 + d] |= 0x80 >> (((e << 3) | (e >> 5)) & 7);
}

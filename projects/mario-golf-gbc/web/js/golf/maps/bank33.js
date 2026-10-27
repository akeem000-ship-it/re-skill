// Bank 33's map scripts (REVERSE.md "The map engine and the story"): maps $08-$0B, the Caddie Master's offices of
// the four clubs (one header, 33:400A; the club is wMapId - 8): the enter script, the Caddie Master's call and his
// round menu, the club rounds (StartClubTournamentRound 33:4F05, StartClubPracticeRound 33:4F28) and the walk back
// in after them, the golfers, the signs, the exits.
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import * as St from "../start.js";
import { golfSessionEnd } from "../boot.js";
import { advanceRandomSeed } from "../round.js";
import { expToNextLevel } from "../exp.js";
import { pushTextNumberArg, setTextCourseIndex } from "../text.js";
import { mapBufCopyRectRedraw } from "../mapgfx.js";

const rd = D.rd, wr = D.wr;
function notPorted(what) { throw new Error(`${what} is not ported`); }
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const mapId = w => rd(w, 0xC450);
const wait = (sh, n) => S.scriptWaitFrames(sh, n);
function* moveAndWait(sh, a, bc, de) { S.actorMoveTo(sh.w, a, bc, de); yield* S.waitActorMoveDone(sh, a); }

// 33:4C94 SetCaddieMasterTextBase: wScriptTextBase $C4BA = $0C1B on map $08 (Marion), else $0893
function setCaddieMasterTextBase(w) { const v = mapId(w) === 0x08 ? 0x0C1B : 0x0893; wr(w, 0xC4BA, v & 0xFF); wr(w, 0xC4BB, v >> 8); }
// 33:4C89 ScriptSetTextFromBase: text = the word at $C4BA + de
function setTextFromBase(w, de) { T.scriptSetText(w, ((rd(w, 0xC4BA) | rd(w, 0xC4BB) << 8) + de) & 0xFFFF); }
// 33:4DDC SetTextClubIndex: SetTextCourseIndex 05:57C3 = 4 / 3 / 2 for maps $0B / $0A / $09, else 1
function setTextClubIndex(w) {
  const m = mapId(w);
  D.inBank(w, 0x05, () => setTextCourseIndex(w, m === 0x0B ? 4 : m === 0x0A ? 3 : m === 0x09 ? 2 : 1));
}
// 33:4DBE HasPartnerB: a partner flag #144-#147 set
const hasPartner = w => [144, 145, 146, 147].some(n => flag(w, n));
// 33:5551 SetClubFlag / 33:557A TestClubFlag: flag n + (wMapId - 8)
const clubFlag = (w, n) => (n + mapId(w) - 8) & 0xFFFF;

// 33:4722 Map08EnterCaddieMasterOffice: the temporary flags cleared (#224 #225 #118 #190-#193 #101 #102); entrance
// $FA (back from a menu screen) or 6 (back from a round) clears the name banner's text; per club the golfers
// (33:40E1), the lists, the decoration, the hidden friend (actor $0B) and the Caddie Master (actor 5) by progress: #227 qualified for the club's tournament, #226 the club won; entrance 6 or $FA:
// after the round (33:4666), else the door's sound $27
function* map08Enter(sh) {
  const w = sh.w;
  for (const n of [224, 225, 118, 190, 191, 192, 193, 101, 102]) clearFlag(w, n);
  const e = rd(w, 0xC46A);
  if (e === 0xFA || e === 0x06) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }   // 33:471A / 33:474C
  const m = mapId(w);
  // the other clubs (33:4757 Links, 33:47A5 Dune, 33:47EF Palm): the golfers 33:40E1, the warp list, the office's
  // decoration, the hidden friend (actor $0B) away; qualified (#114 / #113 / #112): the Caddie Master (actor 5) at
  // ($1D00, $0B00) facing left; won (#139 / #138 / #137): #226 instead of #227
  const club = (won, qual) => {
    if (!flag(w, qual)) return;
    setFlag(w, 227);
    S.actorSetPos(w, 0x05, 0x1D00, 0x0B00);
    S.actorSetFacing(w, 0x05, 0x40);
    if (flag(w, won)) { setFlag(w, 226); clearFlag(w, 227); }
  };
  if (m === 0x0B) {
    M.scriptRespawnActors(w, 0x33, 0x40E1);
    M.scriptSetMapField(w, 0x4262, 0x0008);
    yield* decorateOffice(sh, 0x1F, 0x568E, true);                // 33:55DB Map0BDecorateLinks
    if (!flag(w, 140)) S.actorSetPos(w, 0x0B, 0x0100, 0x3500);
    club(139, 114);
  } else if (m === 0x0A) {
    yield* decorateOffice(sh, 0x1A, 0x564E, false);               // 33:55BF Map0ADecorateDune
    M.scriptRespawnActors(w, 0x33, 0x40E1);
    M.scriptSetMapField(w, 0x4219, 0x0008);
    club(138, 113);
    S.actorSetPos(w, 0x0B, 0x0100, 0x3500);
  } else if (m === 0x09) {
    M.scriptRespawnActors(w, 0x33, 0x40E1);
    M.scriptSetMapField(w, 0x41D0, 0x0008);
    yield* decorateOffice(sh, 0x15, 0x560E, false);               // 33:55A3 Map09DecoratePalm
    club(137, 112);
    S.actorSetPos(w, 0x0B, 0x0100, 0x3500);
  } else {
    M.scriptSetMapField(w, 0x4389, 0x000C);                       // 33:4841
    setFlag(w, 227);                                              // 33:4844
    if (flag(w, 136)) { setFlag(w, 226); clearFlag(w, 227); }      // 33:4847
  }
  const e2 = rd(w, 0xC46A);                                       // 33:4854
  if (e2 === 0x06 || e2 === 0xFA) { yield* map08AfterRound(sh); return; }
  sh.sound(0x27);                                                 // 33:4861
}
// 33:55A3 / 55BF / 55DB Map09DecoratePalm / Map0ADecorateDune / Map0BDecorateLinks: WaitScriptActorIdle, the
// office's $3A x 4 tiles from the map buffer's column 1 row c (MapBufCopyRectRedraw 0B:4864 to (1, 6)), its six
// palettes from 2 (master only); Links then 10 frames
function* decorateOffice(sh, c, pal, links) {
  const w = sh.w;
  yield* S.waitScriptActorIdle(sh);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x01, c, 0x01, 0x06, 0x3A, 0x04));
  if (w.vram) D.inBank(w, 0x33, () => D.loadPalettesMasterOnly(w, pal, 0x02, 0x06));
  if (links) yield* wait(sh, 0x0A);
}
// 33:4666: back from a club round (wStoryRoundKind $C967; wRoundResult $C96C): a placed round (result not 0)
// ends the partner (flags #144-#147, its actor reset and hidden), else the player (and partner) at the counter
// (33:5138); flag #119 cleared; a tournament ($0A) becomes $64 (33:462F: a result 1-3 -> warp 5 + result, the
// ceremonies), a partner match ($1E: 33:464C) 0 or $5A (warp 9); $64 sets the result flags (33:45FE); then the
// door's sound $27 and the Caddie Master (actor $11 on map $08, else 2) walks in from the left behind the player's
// walk to the counter (33:4864)
function* map08AfterRound(sh) {
  const w = sh.w;
  const kind = rd(w, 0xC967);
  let toSound = false;
  if (kind !== 0) {
    if (rd(w, 0xC96C) === 0) { placePlayerAndPartnerAtCounter(w); toSound = true; }   // 33:4674
    else {
      for (const n of [144, 145, 146, 147]) clearFlag(w, n);      // 33:4679
      S.actorResetScript(w, rd(w, 0xC298));
      S.actorSetPos(w, rd(w, 0xC298), 0x3F00, 0x3F00);
    }
  }
  if (!toSound) {
    clearFlag(w, 119);                                            // 33:4697
    const k = rd(w, 0xC967);
    if (k === 0x0A) {                                             // 33:462F
      wr(w, 0xC967, 0x64);
      const r = rd(w, 0xC96C);
      if (r !== 0) {
        if (r < 4) { wr(w, 0xC441, (r + 5) & 0xFF); return; }     // 33:4643
        map08SetRoundResultFlags(w);                              // 33:46AA
      }
    } else if (k === 0x1E) {                                      // 33:464C
      wr(w, 0xC967, 0);
      if (!flag(w, 188) && flag(w, 86)) { wr(w, 0xC967, 0x5A); wr(w, 0xC441, 0x09); return; }
    } else if (k === 0x64) map08SetRoundResultFlags(w);
  }
  sh.sound(0x27);                                                 // 33:46AD
  const cm = mapId(w) === 0x08 ? 0x11 : 0x02;
  S.actorSetPos(w, cm, 0x0100, 0x3500);                           // 33:46B8 / 33:46EA
  S.actorSetSpeed(w, cm, 0x0008);
  yield* map08WalkInAfterRound(sh);
  S.actorSetPos(w, cm, 0x0100, 0x0D00);
  yield* moveAndWait(sh, cm, 0x0300, 0x0D00);
}
// 33:45FE Map08SetRoundResultFlags: the Caddie Master at the counter (actor $0B on map $08, else 5), flag #240 and
// #241 (won: result 1), #243 (out of the places: >= 4) or #242 (placed)
function map08SetRoundResultFlags(w) {
  S.actorSetPos(w, mapId(w) === 0x08 ? 0x0B : 0x05, 0x19C0, 0x0D00);
  setFlag(w, 240);
  const r = rd(w, 0xC96C);
  setFlag(w, r === 1 ? 241 : r >= 4 ? 243 : 242);
}
// 33:5138 PlacePlayerAndPartnerAtCounter: unless entrance $FA, the player at ($0900, $0D00) and the partner below,
// both facing up
function placePlayerAndPartnerAtCounter(w) {
  if (rd(w, 0xC46A) === 0xFA) return;
  S.actorSetPos(w, 0x00, 0x0900, 0x0D00);
  S.actorSetPos(w, rd(w, 0xC298), 0x0900, 0x0F00);
  S.actorSetFacing(w, 0x00, 0xC0);
  S.actorSetFacing(w, rd(w, 0xC298), 0xC0);
}
// 33:4864 Map08WalkInAfterRound: (not at entrance $FA) ScriptBegin, fade in (speed 4), the player to the counter
// (speed $0C), facing the Caddie Master (actor 6) then up; after a tournament ($64) the result speech (map $08:
// 33:4D97, else 33:4D25), else ScriptEnd
function* map08WalkInAfterRound(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) === 0xFA) return;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  S.actorSetSpeed(w, 0x00, 0x000C);
  yield* moveAndWait(sh, 0x00, 0x0900, 0x0D00);
  yield* wait(sh, 0x0A);
  S.actorFaceActor(w, 0x00, 0x06);
  S.actorSetFacing(w, 0x00, 0xC0);
  if (rd(w, 0xC967) === 0x64) {
    if (mapId(w) === 0x08) yield* marionResultSpeech(sh); else yield* clubResultSpeech(sh);
    return;
  }
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 33:4D25: the result speech of maps $09-$0B ($0C33 / $0C36 / $0C39, + 2 won, + 1 placed)
function* clubResultSpeech(sh) {
  const w = sh.w, m = mapId(w);
  T.scriptSetText(w, m === 0x0B ? 0x0C39 : m === 0x0A ? 0x0C36 : 0x0C33);
  if (flag(w, 241)) { T.scriptSkipText(w); T.scriptSkipText(w); }
  else if (flag(w, 242)) T.scriptSkipText(w);
  yield* T.scriptShowText(sh, 0x06);
}
// 33:4D97: Marion's result speech: won $0883 (set twice: 33:4D8E), placed $0880 (a yes / no question: 33:4D69,
// No skips a text), else $0884
function* marionResultSpeech(sh) {
  const w = sh.w;
  if (flag(w, 241)) {
    T.scriptSetText(w, 0x0883);
    T.scriptSetText(w, 0x0883);                                   // 33:4D8E (hl kept)
    yield* T.scriptShowText(sh, 0x06);
    return;
  }
  if (flag(w, 242)) {
    T.scriptSetText(w, 0x0880);
    yield* T.scriptShowTextKeepOpen(sh, 0x06);                    // 33:4D69
    yield* wait(sh, 0x05);
    const a = yield* T.scriptAskYesNo(sh);
    yield* T.scriptCloseText(sh);
    yield* wait(sh, 0x05);
    if (a) T.scriptSkipText(w);
    yield* T.scriptShowText(sh, 0x06);
    return;
  }
  T.scriptSetText(w, 0x0884);
  yield* T.scriptShowText(sh, 0x06);
}

// 33:4BD3 Map08TriggerCallOver (trigger 1): the Caddie Master (actor 6) faces down and calls (base + 0; the club's
// champion: + $15); the player hops (sound $8A), walks to him and they face each other; then 33:48EF
function* map08TriggerCallOver(sh) {
  const w = sh.w;
  setCaddieMasterTextBase(w);
  setTextFromBase(w, 0x0000);
  S.actorSetFacing(w, 0x06, 0x00);
  if (flag(w, 226)) setTextFromBase(w, 0x0015);
  yield* T.scriptShowText(sh, 0x06);
  S.scriptActorSetSpeed(w, 0x0040);
  sh.sound(0x8A);
  S.actorJump(w, 0x00, 0xFF80);
  yield* S.waitActorLanded(sh, 0x00);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0900, 0x0B00);
  yield* S.waitScriptActorIdle(sh);
  yield* wait(sh, 0x05);
  yield* moveAndWait(sh, 0x00, 0x0D00, 0x0D00);
  yield* wait(sh, 0x05);
  S.actorSetFacing(w, 0x06, 0x40);
  yield* moveAndWait(sh, 0x00, 0x0900, 0x0D00);
  S.actorsFaceEachOther(w, 0x00, 0x06);
  yield* map08TalkCaddieMaster(sh);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 33:48EC Map08TalkCaddieMasterB: flag #248, then 33:48EF Map08TalkCaddieMaster: #224 cleared; with a partner
// the match against the partner (33:4ABB); #248 cleared, the player to the counter facing him; after a
// round (#240) the result speech, else the round menu (33:5166)
function* map08TalkCaddieMasterB(sh) { setFlag(sh.w, 248); yield* map08TalkCaddieMaster(sh); }
function* map08TalkCaddieMaster(sh) {
  const w = sh.w;
  clearFlag(w, 224);
  setCaddieMasterTextBase(w);
  if (hasPartner(w)) { yield* talkWithPartner(sh); return; }
  clearFlag(w, 248);
  yield* moveAndWait(sh, 0x00, 0x0900, 0x0D00);
  S.actorsFaceEachOther(w, 0x00, 0x06);
  if (!flag(w, 240)) { yield* map08RoundMenu(sh); return; }
  if (mapId(w) === 0x08) yield* marionResultSpeech(sh); else yield* clubResultSpeech(sh);
}
// 33:5166 Map08CaddieMasterRoundMenu: the club won (#226: ~33:54CA) not ported; text base + 4 (the club's name),
// the menu $0892 at (5, 1) (0A:42BF): B or Quit -> base + 5; Club Tournament: not qualified (#227 clear) -> base +
// 7 and the player's animation 7, else base + $0D and the start scene (33:5257); Practice Round (#224 set): not
// qualified -> base + 8 asked (Yes: base + 3, flag #119, #180 + club, the walk out 33:50BB; No: base + 2, #224
// cleared), qualified -> base + 9 asked (Yes: base + $0A, #119, #224, the start scene, #184 + club)
function* map08RoundMenu(sh) {
  const w = sh.w;
  if (flag(w, 226)) { yield* championRoundMenu(sh); return; }
  setTextFromBase(w, 0x0004);
  setTextClubIndex(w);
  yield* T.scriptShowText(sh, 0x06);
  yield* wait(sh, 0x14);
  const a = yield* S.scriptRunMenu(sh, 0x0892, 0x05, 0x01);
  if (a === 0xFF || a === 0x02) { setTextFromBase(w, 0x0005); yield* T.scriptShowText(sh, 0x06); return; }
  if (a === 0x00) {                                               // 33:51A7
    clearFlag(w, 224);
    if (!flag(w, 227)) {
      setTextFromBase(w, 0x0007);
      setTextClubIndex(w);
      yield* T.scriptShowText(sh, 0x06);
      S.actorPlayAnim(w, 0x00, 0x07);
      yield* S.waitActorAnimDone(sh, 0x00);
      return;
    }
    setTextFromBase(w, 0x000D);                                   // 33:51CC
    yield* T.scriptShowText(sh, 0x06);
    yield* clubRoundStartScene(sh);
    return;
  }
  if (a !== 0x01) return;
  yield* practiceRoundAsk(sh);
}
// 33:51DB: the practice round asked (flag #224 set)
function* practiceRoundAsk(sh) {
  const w = sh.w;
  setFlag(w, 224);                                                // 33:51DB
  const qualified = flag(w, 227);
  setTextFromBase(w, qualified ? 0x0009 : 0x0008);
  yield* T.scriptShowTextKeepOpen(sh, 0x06);
  const yes = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (yes) {                                                      // 33:5212 (No)
    setTextFromBase(w, 0x0002);
    yield* T.scriptShowText(sh, 0x06);
    clearFlag(w, 224);
    return;
  }
  if (!qualified) {
    setTextFromBase(w, 0x0003);                                   // 33:51FE
    yield* T.scriptShowText(sh, 0x06);
    setFlag(w, 119);
    setFlag(w, clubFlag(w, 180));                                 // 33:556C SetClubPracticeFlag
    yield* walkOutToPractice(sh);
    return;
  }
  setTextFromBase(w, 0x000A);                                     // 33:523F
  yield* T.scriptShowText(sh, 0x06);
  setFlag(w, 119); setFlag(w, 224);
  yield* clubRoundStartScene(sh);
  setFlag(w, clubFlag(w, 184));                                   // 33:5573 SetClubGroupPracticeSeen
}
// 33:54CA: the club's champion: base + $16 with the club, #227 cleared, a question: Yes (0) the practice round
// (33:51DB); No: one of two random lines ($08AB + (wMapId - 8) * 2 + 0-1, speaker 6), the player's animation 5
function* championRoundMenu(sh) {
  const w = sh.w;
  setTextFromBase(w, 0x0016);
  clearFlag(w, 227);
  setTextClubIndex(w);
  yield* T.scriptShowTextKeepOpen(sh, 0x06);
  yield* wait(sh, 0x0A);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (!a) { yield* practiceRoundAsk(sh); return; }
  const r = advanceRandomSeed(w) & 0x01;
  T.scriptSetText(w, (0x08AB + r + (((mapId(w) - 8) * 2) & 0xFF)) & 0xFFFF);
  yield* T.scriptShowText(sh, 0x06);
  S.actorPlayAnim(w, 0x00, 0x05);
  yield* S.waitActorAnimDone(sh, 0x00);
}
// 33:50BB: the player goes to ($1900, $0B00) and to the door ($1A00, $0D80), the walk-out actor script 33:5105 for
// the player and the partner, 200 frames; with #225 a match against the partner (33:4F4B), else the practice
// round (33:4F28) and a fade-out started
function* walkOutToPractice(sh) {
  const w = sh.w;
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x0B00);
  yield* moveAndWait(sh, 0x00, 0x1A00, 0x0D80);
  S.actorSetScript(w, 0x00, 0x5105, 0x33);
  S.actorSetScript(w, rd(w, 0xC298), 0x5105, 0x33);
  yield* wait(sh, 0xC8);
  if (flag(w, 225)) { yield* startPartnerMatch(sh); return; }   // quirk kept: no fade-out started after it
  yield* startClubRound(sh, 0x14, 0x03);
  Scr.beginFadeOut(w, 0x04);                                      // 33:50FF
}
// 33:5522 CaddieMasterSendOff: the Caddie Master faces down, 30 frames, base + $0F, the two face each other, the
// text, the player's animation 5
function* caddieMasterSendOff(sh) {
  const w = sh.w;
  S.actorSetFacing(w, 0x06, 0x00);
  yield* wait(sh, 0x1E);
  setTextFromBase(w, 0x000F);
  S.actorsFaceEachOther(w, 0x00, 0x06);
  yield* T.scriptShowText(sh, 0x06);
  S.actorPlayAnim(w, 0x00, 0x05);
  yield* S.waitActorAnimDone(sh, 0x00);
}
// 33:5257 ClubRoundStartScene: seen before (tournament #176 + club; practice #184 + club): the send-off and the
// round; else base + $0E (sound $65, speaker 7), the waiting group (actors 2-5; map $08: placed in a row, actor $0B
// away; the other clubs: the player steps aside and they walk up, 33:52C1), the send-off, the player's animation 5, to the door, the group facing
// down, the starter (actor 7) at ($1D00, $0B00), speed $0D; tournament: actor 4 away; the player to ($1280, $0D80),
// text (speaker 7), the walk-out script 33:5105 for actors 4, 5, 3, 2; the tournament: the player too, 300 frames
// (33:544C), the practice: 33:545E; then flag #119 cleared, fade out, the round
function* clubRoundStartScene(sh) {
  const w = sh.w;
  const practice = !!flag(w, 224);
  if (practice ? flag(w, clubFlag(w, 184)) : flag(w, clubFlag(w, 176))) {
    yield* caddieMasterSendOff(sh);
    if (practice) yield* practiceRoundStart(sh); else yield* tournamentRoundStart(sh);
    return;
  }
  setTextFromBase(w, 0x000E);                                     // 33:5272
  sh.sound(0x65);
  yield* T.scriptShowText(sh, 0x07);
  if (mapId(w) === 0x08) {
    S.actorSetPos(w, 0x02, 0x1500, 0x0D80);
    S.actorSetPos(w, 0x03, 0x1700, 0x0D80);
    S.actorSetPos(w, 0x04, 0x1B00, 0x0D80);
    S.actorSetPos(w, 0x05, 0x1900, 0x0D80);
    S.actorSetPos(w, 0x0B, 0x3F00, 0x3F00);
  } else {                                                        // 33:52C1: the other clubs' group walks up
    S.actorLockSpriteFacing(w, 0x00, 0x01);
    S.actorMoveDir(w, 0x00, 0x40, 0x0280);
    yield* S.waitActorMoveDone(sh, 0x00);
    S.actorSetScript(w, 0x04, 0x7BDE, 0x33);
    yield* wait(sh, 0x01);
    for (const a of [0x02, 0x03, 0x04, 0x05]) S.actorSetSpeed(w, a, 0x0010);
    yield* wait(sh, 0x01);
    S.actorMoveTo(w, 0x02, 0x1580, 0x0D80);
    S.actorMoveDir(w, 0x03, 0xC0, 0x0200);
    yield* S.waitActorMoveDone(sh, 0x03);
    S.actorMoveTo(w, 0x03, 0x1700, 0x0D80);
    S.actorMoveTo(w, 0x04, 0x1A00, 0x0D80);
    S.actorMoveTo(w, 0x05, 0x1880, 0x0D80);
    yield* S.waitActorMoveDone(sh, 0x05);
    S.actorLockSpriteFacing(w, 0x00, 0x00);
    yield* wait(sh, 0x0F);
    yield* moveAndWait(sh, 0x00, 0x0900, 0x0D00);
  }
  yield* caddieMasterSendOff(sh);                                 // 33:536E
  S.actorPlayAnim(w, 0x00, 0x05);
  yield* wait(sh, 0x1E);
  S.scriptActorSetSpeed(w, 0x0040);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x0B00);
  yield* S.waitActorMoveDone(sh, 0x02);
  for (const a of [0x02, 0x03, 0x04, 0x05]) S.actorSetFacing(w, a, 0x00);
  S.actorSetPos(w, 0x07, 0x1D00, 0x0B00);
  S.actorSetSpeed(w, 0x00, 0x000D);
  if (!flag(w, 224)) S.actorSetPos(w, 0x04, 0x3F00, 0x3F00);     // 33:53C9
  S.actorMoveTo(w, 0x00, 0x1280, 0x0D80);
  yield* T.scriptShowText(sh, 0x07);
  S.actorSetScript(w, 0x04, 0x5105, 0x33);
  yield* wait(sh, 0x15);
  for (const a of [0x05, 0x03, 0x02]) {
    S.actorSetScript(w, a, 0x5105, 0x33);
    yield* wait(sh, 0x01);
  }
  if (!flag(w, 224)) {                                            // 33:5433
    S.actorSetScript(w, 0x00, 0x5105, 0x33);
    yield* wait(sh, 0xC8);
    yield* wait(sh, 0x64);
    yield* tournamentRoundStart(sh);
    return;
  }
  yield* wait(sh, 0xC8);                                          // 33:545E
  yield* moveAndWait(sh, 0x00, 0x1980, 0x0D80);
  yield* wait(sh, 0x1E);
  S.actorFaceActor(w, 0x07, 0x00);
  S.actorPlayAnim(w, 0x07, 0x05);
  yield* wait(sh, 0x3C);
  S.actorPlayAnim(w, 0x00, 0x05);
  yield* wait(sh, 0x3C);
  S.actorSetScript(w, 0x00, 0x5105, 0x33);
  S.actorSetFacing(w, 0x07, 0x80);
  yield* wait(sh, 0xC8);
  yield* practiceRoundStart(sh);
}
// 33:544C: flag #119 cleared, #176 + club (33:5565), fade out (speed 4), the tournament (33:4F05)
function* tournamentRoundStart(sh) {
  const w = sh.w;
  clearFlag(w, 119);
  setFlag(w, clubFlag(w, 176));
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* startClubRound(sh, 0x0A, 0x01);
}
// 33:54BB: flag #119 cleared, fade out (speed 4), the practice round (33:4F28)
function* practiceRoundStart(sh) {
  const w = sh.w;
  clearFlag(w, 119);
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  yield* startClubRound(sh, 0x14, 0x03);
}
// 33:4F05 StartClubTournamentRound (kind $0A, game mode 1) / 33:4F28 StartClubPracticeRound (kind $14, mode 3):
// wStoryRoundKind, GolfSessionInit 10:4B28, wGameMode, SetupPlayerGolfer ($80 player 0, $FF player 1), the club's
// course and the return point (33:4F96), GolfRound (33:66CB: 1 hole with flag #72, else 18), GolfSessionEnd 10:4B94
function* startClubRound(sh, kind, mode) {
  const w = sh.w;
  wr(w, 0xC967, kind);
  St.golfSessionInit(w);
  wr(w, 0xC834, mode);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  yield* clubRound(sh);
}
// 33:4F96 ... 10:4B94: the club's course, the round and its end
function* clubRound(sh) {
  const w = sh.w;
  // 33:4F96 SetClubCourseAndReturn: MapSaveReturnPoint 0A:4D5B (this map, entrance 6), SetCourseHole 10:423B
  // (course = club = wMapId - 7, hole 1; the wind byte h is 1)
  const m = mapId(w);
  wr(w, 0xC960, m); wr(w, 0xC961, 0x06);
  St.setCourseHole(w, 0x01, m - 7, 0x01);
  if (!sh.playGolfRound) notPorted("a club round outside the game loop");
  yield* sh.playGolfRound(flag(w, 72) ? 0x01 : 0x12);             // 33:66CB
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));
}

// 33:4ABB the Caddie Master's talk with a partner: the player and the partner at speed $1A; base + $13 asked
// (speaker 6, 10 frames before the question): No: #248 #227 #225 cleared, the text shown again (33:4B9A: nothing
// new set) and he faces left; Yes: base + 3, he faces left; from the talk B (#248): the player to ($0D00, $0D00);
// else the player's and the partner's sprites locked, the partner to ($0700, $0D00), the player to ($0900, $0D00),
// unlocked; then the player to ($1900, $0B00) and the door ($1A00, $0D00), the walk-out scripts 33:5105 / 33:5123,
// 250 frames, #248 cleared, the match against the partner (33:4F4B)
function* talkWithPartner(sh) {
  const w = sh.w;
  S.actorSetSpeed(w, 0x00, 0x001A);
  S.actorSetSpeed(w, rd(w, 0xC298), 0x001A);
  setTextFromBase(w, 0x0013);
  yield* T.scriptShowTextKeepOpen(sh, 0x06);
  yield* wait(sh, 0x0A);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) {                                                        // 33:4B91
    for (const n of [248, 227, 225]) clearFlag(w, n);
    yield* T.scriptShowText(sh, 0x06);
    S.actorSetFacing(w, 0x06, 0x40);
    return;
  }
  setTextFromBase(w, 0x0003);
  yield* T.scriptShowText(sh, 0x06);
  S.actorSetFacing(w, 0x06, 0x40);
  if (flag(w, 248)) yield* moveAndWait(sh, 0x00, 0x0D00, 0x0D00);
  else {
    S.actorLockSpriteFacing(w, 0x00, 0x01);
    S.actorLockSpriteFacing(w, rd(w, 0xC298), 0x01);
    S.actorMoveTo(w, rd(w, 0xC298), 0x0700, 0x0D00);
    yield* moveAndWait(sh, 0x00, 0x0900, 0x0D00);
    S.actorLockSpriteFacing(w, 0x00, 0x00);
    S.actorLockSpriteFacing(w, rd(w, 0xC298), 0x00);
  }
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x0B00);
  yield* moveAndWait(sh, 0x00, 0x1A00, 0x0D00);
  S.actorSetScript(w, 0x00, 0x5105, 0x33);
  S.actorSetScript(w, rd(w, 0xC298), 0x5123, 0x33);
  yield* wait(sh, 0xFA);
  clearFlag(w, 248);
  yield* startPartnerMatch(sh);
}
// 33:4F4B StartPartnerMatchGame: wStoryRoundKind $1E, GolfSessionInit, wGameMode 2 (Match Play), the partner as
// player 2 (33:4F6B SetupPartnerOpponent: golfer 4-7 by #144-#146, else 7), the player as player 1, the club's
// course (33:4F96), the round (33:66CB), GolfSessionEnd
function* startPartnerMatch(sh) {
  const w = sh.w;
  wr(w, 0xC967, 0x1E);
  St.golfSessionInit(w);
  wr(w, 0xC834, 0x02);
  St.setupPlayerGolfer(w, flag(w, 144) ? 0x04 : flag(w, 145) ? 0x05 : flag(w, 146) ? 0x06 : 0x07, 0x01);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  yield* clubRound(sh);
}

// 33:4317 ... 33:434D Map08TalkGolferA-D (talks 2-5): text base $08B7 / $08C9 / $08DB / $08ED, 33:4CAC, speaker 2-5
function* map08TalkGolfer(sh, base, speaker) {
  const w = sh.w;
  wr(w, 0xC4BA, base & 0xFF); wr(w, 0xC4BB, base >> 8);
  setClubGolferText(w);
  yield* T.scriptShowText(sh, speaker);
}
// 33:4CAC SetClubGolferText: base + the club (Links + $0C, Dune + 6) + by progress: after a round (#240) won + 4,
// placed + 3, else + 2 (the test of #243 is not used: 33:4CF3); champion (#226) + 5; qualified (#227) + 1
function setClubGolferText(w) {
  let hl = rd(w, 0xC4BA) | rd(w, 0xC4BB) << 8;
  if (mapId(w) === 0x0B) hl += 0x0C;
  if (mapId(w) === 0x0A) hl += 0x06;
  if (flag(w, 240)) hl += flag(w, 241) ? 4 : flag(w, 242) ? 3 : 2;
  else if (flag(w, 226)) hl += 5;
  else if (flag(w, 227)) hl += 1;
  T.scriptSetText(w, hl & 0xFFFF);
}
// 33:435F Map08TalkLevelAdvisor (talk $0B): level 99 -> $087F, else $087E with the EXP to the next level (02:5498,
// PushTextNumberArg 05:551F); speaker $0B
function* map08TalkLevelAdvisor(sh) {
  const w = sh.w;
  if (rd(w, 0xC812) === 0x63) T.scriptSetText(w, 0x087F);
  else {
    T.scriptSetText(w, 0x087E);
    pushTextNumberArg(w, expToNextLevel(w));
  }
  yield* T.scriptShowText(sh, 0x0B);
}
// 33:443B / 4447 / 4453: the signs (talks 8-$0A): texts $08B3-$08B5, speaker $80
function* map08Sign(sh, id) { T.scriptSetText(sh.w, id); yield* T.scriptShowText(sh, 0x80); }
// 33:506F SetPartnerText: wScriptArg $C4BC = the partner (0-3 by the first of #144-#147 set) and the text hl + it;
// none: a = 5, nothing set
function setPartnerText(w, hl) {
  const k = [144, 145, 146, 147].findIndex(n => flag(w, n));
  if (k < 0) return;
  wr(w, 0xC4BC, k);
  T.scriptSetText(w, (hl + k) & 0xFFFF);
}
// 33:50A6 ClearPartnerFlag: #144 + $C4BC cleared
const clearPartnerFlag = w => clearFlag(w, (144 + rd(w, 0xC4BC)) & 0xFFFF);
// 33:4FE5 CheckPartnerBeforeLeaving: no partner -> 0 (go); else 33:4FEF: the partner asks ($0C42 + the partner,
// speaker the partner's slot) with the player facing it: Yes: $0C4A + the partner, its script reset, it walks
// up 6 tiles, 30 frames, fade out (8), its flag cleared, its script reset again, it is put away ($3F00, $3F00): 0;
// No: the player steps back a tile (facing + $80) -> 1
function* checkPartnerBeforeLeaving(sh) {
  const w = sh.w;
  if (!hasPartner(w)) return 0;
  setPartnerText(w, 0x0C42);
  yield* T.scriptShowTextKeepOpen(sh, rd(w, 0xC298));
  S.actorFaceActor(w, 0x00, rd(w, 0xC298));
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) {                                                        // 33:5058
    S.actorMoveDir(w, 0x00, (rd(w, 0xC28A) + 0x80) & 0xFF, 0x0100);
    yield* S.waitActorMoveDone(sh, 0x00);
    return 1;
  }
  setPartnerText(w, 0x0C4A);
  yield* T.scriptShowText(sh, rd(w, 0xC298));
  S.actorResetScript(w, rd(w, 0xC298));
  S.actorMoveDir(w, rd(w, 0xC298), 0x80, 0x0600);
  yield* wait(sh, 0x1E);
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  clearPartnerFlag(w);
  S.actorResetScript(w, rd(w, 0xC298));
  S.actorSetPos(w, rd(w, 0xC298), 0x3F00, 0x3F00);
  return 0;
}
// 33:44F1 / 33:451B Map08TriggerExitHole1 / ExitRange (triggers 2 / 3): speed 8, to x ($2520 / $3520, $0B00), the
// walk out (33:4566), warp 2 / 3, sound $92
function* map08TriggerExit(sh, x, warp) {
  const w = sh.w;
  if ((yield* checkPartnerBeforeLeaving(sh)) === 1) return;
  S.actorSetSpeed(w, 0x00, 0x0008);
  yield* moveAndWait(sh, 0x00, x, 0x0B00);
  yield* map08WalkOutAnim(sh);
  wr(w, 0xC441, warp);
  sh.sound(0x92);
}
// 33:4545 Map08TriggerExitDown (trigger 4): speed 8, two tiles down, warp 4, sound $92
function* map08TriggerExitDown(sh) {
  const w = sh.w;
  if ((yield* checkPartnerBeforeLeaving(sh)) === 1) return;
  S.actorSetSpeed(w, 0x00, 0x0008);
  S.actorMoveDir(w, 0x00, 0x00, 0x0200);
  wr(w, 0xC441, 0x04);
  sh.sound(0x92);
}
// 33:4566 Map08WalkOutAnim: facing up, 4.5 tiles up at speed $0B, 10 frames, animation $0A, 35 frames
function* map08WalkOutAnim(sh) {
  const w = sh.w;
  S.actorSetFacing(w, 0x00, 0xC0);
  S.actorMoveDir(w, 0x00, 0xC0, 0x0480);
  S.actorSetSpeed(w, 0x00, 0x000B);
  yield* wait(sh, 0x0A);
  S.actorPlayAnim(w, 0x00, 0x0A);
  yield* wait(sh, 0x23);
}
// 33:45C7 Map08TriggerStepBack (the second triggers 2 / 3): the facing locked, a tile down, 10 frames, half a tile
// left, the facing unlocked
function* map08TriggerStepBack(sh) {
  const w = sh.w;
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  S.actorMoveDir(w, 0x00, 0x80, 0x0100);
  yield* wait(sh, 0x0A);
  S.actorMoveDir(w, 0x00, 0x40, 0x0080);
  yield* S.waitActorMoveDone(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
}

export const SCRIPTS = {
  "33:4722": map08Enter,
  "33:4bd3": map08TriggerCallOver,
  "33:48ec": map08TalkCaddieMasterB,
  "33:48ef": map08TalkCaddieMaster,
  "33:4317": sh => map08TalkGolfer(sh, 0x08B7, 0x02),
  "33:4329": sh => map08TalkGolfer(sh, 0x08C9, 0x03),
  "33:433b": sh => map08TalkGolfer(sh, 0x08DB, 0x04),
  "33:434d": sh => map08TalkGolfer(sh, 0x08ED, 0x05),
  "33:435f": map08TalkLevelAdvisor,
  "33:443b": sh => map08Sign(sh, 0x08B3),
  "33:4447": sh => map08Sign(sh, 0x08B4),
  "33:4453": sh => map08Sign(sh, 0x08B5),
  "33:44f1": sh => map08TriggerExit(sh, 0x2520, 0x02),
  "33:451b": sh => map08TriggerExit(sh, 0x3520, 0x03),
  "33:4545": map08TriggerExitDown,
  "33:45c7": map08TriggerStepBack,
};
export const TASKS = () => ({});

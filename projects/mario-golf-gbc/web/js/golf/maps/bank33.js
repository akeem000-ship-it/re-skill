// Bank 33's map scripts (REVERSE.md "The map engine and the story"): maps $08-$0B, the Caddie Master's offices of
// the four clubs (one header, 33:400A; the club is wMapId - 8): the enter script, the Caddie Master's call and his
// round menu, the club rounds (StartClubTournamentRound 33:4F05, StartClubPracticeRound 33:4F28) and the walk back
// in after them, the golfers, the signs, the exits; the Road to Peach's Castle and the castle (maps $1C / $1D); the Club
// Maker's Hut (maps $2E / $2F).
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as A from "../actors.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import * as St from "../start.js";
import { golfSessionEnd } from "../boot.js";
import { saveGame } from "../save.js";
import { showPictureTimed } from "../title.js";
import { endingSequence } from "../ending.js";
import { advanceRandomSeed } from "../round.js";
import { addExp, expToNextLevel } from "../exp.js";
import { levelUpScreen, charRefreshStats } from "../levelup.js";
import * as Ls from "./lessons.js";
import { golfViewExit } from "../round.js";
import { golfDictionary } from "../dict.js";
import { awardFoundAllRivalsExp } from "./bank34.js";
import { pushTextNumberArg, setTextCourseIndex } from "../text.js";
import { mapBufCopyRectRedraw, mapCopyTerrainRect, mapCopyEventRect } from "../mapgfx.js";

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
  // (w.oldCaddieDialog: a test's jump 33:491B -> 33:4929, the older dialog nothing reaches)
  if (!flag(w, 240)) { yield* (w.oldCaddieDialog ? map08OldRoundDialog(sh) : map08RoundMenu(sh)); return; }
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
  if (practice ? flag(w, clubFlag(w, 184)) : flag(w, clubFlag(w, 176))) {   // 33:559C TestClubGroupPracticeSeen / 33:558E TestClubTournamentSeen
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
  // (course = club = wMapId - 7, hole 1; the wind byte is a, still 6 from 33:4F96's entrance: MapSaveReturnPoint keeps af)
  const m = mapId(w);
  wr(w, 0xC960, m); wr(w, 0xC961, 0x06);
  St.setCourseHole(w, 0x06, m - 7, 0x01);
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
// 33:4566 Map08WalkOutAnim (33:4C59 Map08WalkOutAnimB is the same code): facing up, 4.5 tiles up at speed $0B, 10 frames, animation $0A, 35 frames
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

// ---- map $1C, the Road to Peach's Castle (header 33:56BE) ----
// 33:588F Map1CEnterRoadToCastle: #125, no name banner
function* map1CEnter(sh) {
  const w = sh.w;
  setFlag(w, 125);
  wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
}
// a launcher frame: the map buffer's 4 x l block at (b, c) to (9, e), redrawn (0B:4864)
const launcherFrame = (sh, b, c, e, l) => inBankGen(sh.w, 0x0B, mapBufCopyRectRedraw(sh, b, c, 0x09, e, 0x04, l));
// 33:5899 Map1CLauncherOpenAnim: the frames from columns $15 $1A $1F $24 $29 (row $0B) to (9, $0B), each with sound
// $9A and 30 frames (the last 15)
function* launcherOpenAnim(sh) {
  for (const b of [0x15, 0x1A, 0x1F, 0x24, 0x29]) {
    yield* launcherFrame(sh, b, 0x0B, 0x0B, 0x04);
    sh.sound(0x9A);
    yield* wait(sh, b === 0x29 ? 0x0F : 0x1E);
  }
}
// 33:5912 Map1CLauncherShootAnim: frame $15 (row $10, 4 x 6 to (9, 9)), the player to ($0B00, $0A80), sound $9B, 20
// frames; the player and the Bob-omb at speed $1A, the player flying (state 2) to ($0B00, $0100); frames $1A, $1F;
// the Bob-omb's facing locked, sound $89, it hops and goes to ($0B00, $1200); the player at speed $10, animation $0A;
// frame $24, 5 frames, frame $29, 10 frames
function* launcherShootAnim(sh) {
  const w = sh.w;
  yield* launcherFrame(sh, 0x15, 0x10, 0x09, 0x06);
  S.actorMoveTo(w, 0x00, 0x0B00, 0x0A80);
  sh.sound(0x9B);
  yield* wait(sh, 0x14);
  S.actorSetSpeed(w, 0x00, 0x001A);
  S.actorSetSpeed(w, 0x05, 0x001A);
  S.actorSetState(w, 0x00, 0x02);
  S.actorMoveTo(w, 0x00, 0x0B00, 0x0100);
  yield* launcherFrame(sh, 0x1A, 0x10, 0x09, 0x06);
  yield* launcherFrame(sh, 0x1F, 0x10, 0x09, 0x06);
  S.actorLockSpriteFacing(w, 0x05, 0x01);
  sh.sound(0x89);
  S.actorJump(w, 0x05, 0xFF40);
  S.actorMoveTo(w, 0x05, 0x0B00, 0x1200);
  yield* S.waitActorMoveDone(sh, 0x05);
  S.actorSetSpeed(w, 0x00, 0x0010);
  S.actorPlayAnim(w, 0x00, 0x0A);
  yield* launcherFrame(sh, 0x24, 0x10, 0x09, 0x06);
  yield* wait(sh, 0x05);
  yield* launcherFrame(sh, 0x29, 0x10, 0x09, 0x06);
  yield* wait(sh, 0x0A);
}
// 33:57CE Map1CBobombLaunch: the player hidden (state 0), 15 frames, animation 2; the Bob-omb (actor 5) at speed $0C
// to ($0900, $1040) and ($0B00, $1080), 15 frames, facing up; the player to ($0B00, $0700); the launcher opens
// (33:5899); the Bob-omb to ($0B00, $0F00), 10 frames, its animation 7; the shot (33:5912), sound $9C, 45 frames,
// the player hidden, 20 frames, fade out (2), warp 1 (Peach's Castle)
function* bobombLaunch(sh) {
  const w = sh.w;
  S.actorSetState(w, 0x00, 0x00);
  yield* wait(sh, 0x0F);
  S.actorPlayAnim(w, 0x00, 0x02);
  S.actorSetSpeed(w, 0x05, 0x000C);
  S.actorMoveTo(w, 0x05, 0x0900, 0x1040);
  yield* S.waitActorMoveDone(sh, 0x05);
  S.actorMoveTo(w, 0x05, 0x0B00, 0x1080);
  yield* S.waitActorMoveDone(sh, 0x05);
  yield* wait(sh, 0x0F);
  S.actorSetFacing(w, 0x05, 0xC0);
  yield* S.scriptActorGoTo(sh, 0x00, 0x0B00, 0x0700);
  yield* launcherOpenAnim(sh);
  yield* S.waitScriptActorIdle(sh);
  S.actorMoveTo(w, 0x05, 0x0B00, 0x0F00);
  yield* S.waitActorMoveDone(sh, 0x05);
  yield* wait(sh, 0x0A);
  S.actorPlayAnim(w, 0x05, 0x07);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* launcherShootAnim(sh);
  sh.sound(0x9C);
  yield* wait(sh, 0x2D);
  S.actorSetState(w, 0x00, 0x00);
  yield* wait(sh, 0x14);
  Scr.beginFadeOut(w, 0x02);
  yield* Scr.waitFade(sh);
  wr(w, 0xC441, 0x01);
}
// 33:57A6 Map1CWalkToBobomb (trigger 1): the player to ($0B00, $0DC0) (not awaited), facing up, 5 frames, animation
// $0A, 20 frames, the launch (33:57CE)
function* map1CWalkToBobomb(sh) {
  const w = sh.w;
  S.actorMoveTo(w, 0x00, 0x0B00, 0x0DC0);
  S.actorSetFacing(w, 0x00, 0xC0);
  yield* wait(sh, 0x05);
  S.actorPlayAnim(w, 0x00, 0x0A);
  yield* wait(sh, 0x14);
  yield* bobombLaunch(sh);
}
// 33:5729 Map1CTalkBobombJump (talk 6, the second entry): sound $8A, the player hops, 33:57A6
function* map1CTalkBobombJump(sh) {
  sh.sound(0x8A);
  S.actorJump(sh.w, 0x00, 0xFF40);
  yield* map1CWalkToBobomb(sh);
}
// 33:5737 Map1CTalkBobomb (talk 6): sound $8A, the player hops, to ($0B00, $0DC0), facing up, animation $0A, 10
// frames, the launch (33:57CE)
function* map1CTalkBobomb(sh) {
  const w = sh.w;
  sh.sound(0x8A);
  S.actorJump(w, 0x00, 0xFF40);
  yield* moveAndWait(sh, 0x00, 0x0B00, 0x0DC0);
  S.actorSetFacing(w, 0x00, 0xC0);
  S.actorPlayAnim(w, 0x00, 0x0A);
  yield* wait(sh, 0x0A);
  yield* bobombLaunch(sh);
}
// 33:5876 Map1CTriggerExit (trigger 2): sound $99, warp 2
function* map1CTriggerExit(sh) { sh.sound(0x99); wr(sh.w, 0xC441, 0x02); }

// ---- map $1D, Peach's Castle (header 33:5AC6) ----
// 33:5F5B Map1DResultTestEntrances: entrances $0A / $0B / $0C (a test's way in) fake the result 1 / 2 / 3, set #126
// and become entrance 6
function map1DResultTestEntrances(w) {
  const r = { 0x0A: 1, 0x0B: 2, 0x0C: 3 }[rd(w, 0xC46A)];
  if (!r) return;
  wr(w, 0xC96C, r);
  setFlag(w, 126);
  wr(w, 0xC46A, 0x06);
}
// 33:5F8F Map1DSetResultFlags: entrance 6 with a result: #106 (else entrance 6 with none: nothing more); other
// entrances but $FA clear #106; then #106 sets #240 and the result #241 (1) / #243 (4 or more) / #242
function map1DSetResultFlags(w) {
  const e = rd(w, 0xC46A);
  if (e === 0x06) {
    if (rd(w, 0xC96C) === 0) return;
    setFlag(w, 106);
  } else if (e !== 0xFA) clearFlag(w, 106);
  if (flag(w, 106)) setFlag(w, 240);
  const r = rd(w, 0xC96C);
  setFlag(w, r === 1 ? 241 : r >= 4 ? 243 : 242);
}
// 33:63F9 Map1DOpenCastleDoor: #127: the open door's 8 x 5 block from ($2A, 6) to ($1A, 6): tiles redrawn, terrain
// and events (0B:4864, 0B:4653, 0B:4699)
function* map1DOpenCastleDoor(sh) {
  const w = sh.w;
  if (!flag(w, 127)) return;
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x2A, 0x06, 0x1A, 0x06, 0x08, 0x05));
  mapCopyTerrainRect(w, 0x2A, 0x06, 0x1A, 0x06, 0x08, 0x05);
  mapCopyEventRect(w, 0x2A, 0x06, 0x1A, 0x06, 0x08, 0x05);
}
// 33:5FCE: entrance 1 (shot over from the road): sound $9C, the player pops up, 2 frames, fade in (4), its facing
// locked, to ($1400, $1100) then ($1400, $0F00), 2 frames, two hops (sound $8A) with the facing unlocked between
function* map1DArriveFromRoad(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) !== 0x01) return;
  sh.sound(0x9C);
  S.actorJump(w, 0x00, 0xFF00);
  yield* wait(sh, 0x02);
  Scr.beginFadeIn(w, 0x04);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1400, 0x1100);
  yield* moveAndWait(sh, 0x00, 0x1400, 0x0F00);
  yield* wait(sh, 0x02);
  sh.sound(0x8A);
  S.actorJump(w, 0x00, 0xFF80);
  yield* S.waitActorLanded(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
  yield* wait(sh, 0x02);
  sh.sound(0x8A);
  S.actorJump(w, 0x00, 0xFF80);
  yield* S.waitActorLanded(sh, 0x00);
}
// 33:6040 Map1DPlayerArrivesAnim: the player pops up (sound $9C), 2 frames, fade in (4), its facing locked, to
// ($1400, $1300), 2 frames, to ($1400, $0F00), 2 frames, two hops (sound $8A) with the facing unlocked between
function* map1DPlayerArrives(sh) {
  const w = sh.w;
  S.actorJump(w, 0x00, 0xFF00);
  sh.sound(0x9C);
  yield* wait(sh, 0x02);
  Scr.beginFadeIn(w, 0x04);
  S.actorLockSpriteFacing(w, 0x00, 0x01);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1400, 0x1300);
  yield* wait(sh, 0x02);
  yield* moveAndWait(sh, 0x00, 0x1400, 0x0F00);
  yield* wait(sh, 0x02);
  sh.sound(0x8A);
  S.actorJump(w, 0x00, 0xFF80);
  yield* S.waitActorLanded(sh, 0x00);
  S.actorLockSpriteFacing(w, 0x00, 0x00);
  yield* wait(sh, 0x02);
  sh.sound(0x8A);
  S.actorJump(w, 0x00, 0xFF80);
  yield* S.waitActorLanded(sh, 0x00);
}
// 33:6E5D LoadEffectSpritesB: the tiles 33:6CB0 ($18 blocks) to VRAM0 $8500, OBJ palette 7 (d = $0F) from 33:6E3D
function loadEffectSpritesB(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x33, () => {
    D.queueVRAMCopy(w, 0x6CB0, 0x8500, 0x18);
    D.loadPalettesImmediate(w, 0x6E3D, 0x0F, 0x01);
  });
}
// 33:6E75 DrawEffectFrameAtPoint: the sprite 33:6E30 at the map's ($1600, $0C80) less the scroll (<< 3, the high
// bytes) for 6 frames, tiles c, attributes b
function* drawEffectFrame(sh, b, c) {
  const w = sh.w;
  for (let h = 0x06; h; h--) {
    const x = (((0x1600 - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF) << 3) >> 8 & 0xFF;
    const y = (((0x0C80 - (rd(w, 0xC322) | rd(w, 0xC323) << 8)) & 0xFFFF) << 3) >> 8 & 0xFF;
    D.inBank(w, 0x33, () => D.queueSpriteTemplate(w, 0x6E30, y, x, c, b));
    yield* sh.advance();
  }
}
// 33:6EAA PlayEffectAnim: the tiles $50, $56, $5C (attributes 7) four times
function* playEffectAnim(sh) {
  for (let k = 0; k < 4; k++) for (const c of [0x50, 0x56, 0x5C]) yield* drawEffectFrame(sh, 0x07, c);
}
// 33:60B2 Map1DFirstVisitScene: #116 (Peach's Castle placed) -> 33:5FCE; #127 sets #126; #126 -> 33:5FCE; else the
// welcome: music $10, Peach (actor 2) and Toad (6) placed, the arrival (33:6040), 60 frames, #126, texts from $144A
// through Toad (3), Peach (2), Bowser ($0C), Yoshi ($0A, with its effect sprites 33:6E5D / 33:6EAA and actor
// scripts 33:6F39 / 6F40), Luigi (8), Mario (7), and "May we begin the tournament?" (33:66DC)
function* map1DFirstVisitScene(sh) {
  const w = sh.w;
  if (flag(w, 116)) { yield* map1DArriveFromRoad(sh); return; }
  if (flag(w, 127)) setFlag(w, 126);
  if (flag(w, 126)) { yield* map1DArriveFromRoad(sh); return; }
  sh.sound(0x10);
  S.actorSetPos(w, 0x02, 0x1400, 0x0700);
  S.actorSetPos(w, 0x06, 0x1F00, 0x0B00);
  yield* map1DPlayerArrives(sh);
  yield* wait(sh, 0x3C);
  setFlag(w, 126);
  T.scriptSetText(w, 0x144A);
  sh.sound(0x8A);
  S.actorJump(w, 0x03, 0xFF80);
  yield* S.waitActorLanded(sh, 0x03);
  yield* moveAndWait(sh, 0x03, 0x1280, 0x1100);
  S.actorFaceActor(w, 0x03, 0x00);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x03, 0x05);
  yield* S.waitActorAnimDone(sh, 0x03);
  yield* T.scriptShowText(sh, 0x03);
  S.actorFaceActor(w, 0x03, 0x02);
  yield* T.scriptShowText(sh, 0x03);
  S.actorLockSpriteFacing(w, 0x03, 0x01);
  yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
  yield* moveAndWait(sh, 0x03, 0x1100, 0x1300);
  S.actorLockSpriteFacing(w, 0x03, 0x00);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* wait(sh, 0x1E);
  S.actorFaceActor(w, 0x00, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  S.actorPlayAnim(w, 0x00, 0x05);
  yield* S.waitActorAnimDone(sh, 0x00);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x02, 0x07);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* moveAndWait(sh, 0x02, 0x1400, 0x0A00);
  S.actorSetFacing(w, 0x02, 0x80);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x00);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* S.waitScriptActorIdle(sh);
  yield* T.scriptShowText(sh, 0x02);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  S.actorPlayAnim(w, 0x0C, 0x07);
  yield* S.waitActorAnimDone(sh, 0x0C);
  yield* T.scriptShowText(sh, 0x0C);
  S.actorSetFacing(w, 0x00, 0x80);
  yield* moveAndWait(sh, 0x0C, 0x1000, 0x0F00);
  yield* T.scriptShowText(sh, 0x0C);
  S.actorPlayAnim(w, 0x0C, 0x06);
  yield* S.waitActorAnimDone(sh, 0x0C);
  yield* T.scriptShowText(sh, 0x0C);
  loadEffectSpritesB(w);
  sh.sound(0x9D);
  S.actorJump(w, 0x0A, 0xFF80);
  yield* moveAndWait(sh, 0x0A, 0x1800, 0x1000);
  S.actorPlayAnim(w, 0x0A, 0x07);
  yield* S.waitActorAnimDone(sh, 0x0A);
  S.actorSetScript(w, 0x0A, 0x6F39, 0x33);
  yield* playEffectAnim(sh);
  sh.sound(0x9D);
  S.actorPlayAnim(w, 0x0A, 0x06);
  yield* S.waitActorAnimDone(sh, 0x0A);
  S.actorPlayAnim(w, 0x0A, 0x06);
  S.actorJump(w, 0x0A, 0xFF80);
  yield* S.waitActorLanded(sh, 0x0A);
  S.actorPlayAnim(w, 0x0A, 0x07);
  yield* playEffectAnim(sh);
  yield* wait(sh, 0x0A);
  sh.sound(0x9D);
  S.actorPlayAnim(w, 0x0A, 0x06);
  yield* playEffectAnim(sh);
  S.actorFaceActor(w, 0x08, 0x0A);
  S.actorPlayAnim(w, 0x08, 0x05);
  yield* S.waitActorAnimDone(sh, 0x08);
  S.actorFaceActor(w, 0x08, 0x0C);
  yield* T.scriptShowText(sh, 0x08);
  S.actorPlayAnim(w, 0x08, 0x06);
  yield* S.waitActorAnimDone(sh, 0x08);
  yield* moveAndWait(sh, 0x08, 0x1000, 0x0D00);
  S.actorSetScript(w, 0x0A, 0x6F40, 0x33);
  S.actorPlayAnim(w, 0x08, 0x07);
  yield* S.waitActorAnimDone(sh, 0x08);
  yield* T.scriptShowText(sh, 0x08);
  S.actorsFaceEachOther(w, 0x0C, 0x08);
  S.actorPlayAnim(w, 0x0C, 0x07);
  yield* S.waitActorAnimDone(sh, 0x0C);
  yield* T.scriptShowText(sh, 0x0C);
  S.actorFaceActor(w, 0x02, 0x0C);
  yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
  yield* S.waitScriptActorIdle(sh);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  S.actorSetFacing(w, 0x0C, 0x00);
  S.actorSetFacing(w, 0x08, 0x00);
  S.actorLockSpriteFacing(w, 0x08, 0x01);
  yield* moveAndWait(sh, 0x08, 0x1000, 0x0C00);
  S.actorSetFacing(w, 0x00, 0xC0);
  S.actorLockSpriteFacing(w, 0x08, 0x00);
  S.actorSetFacing(w, 0x08, 0x00);
  yield* wait(sh, 0x14);
  S.actorsFaceEachOther(w, 0x02, 0x07);
  yield* wait(sh, 0x28);
  S.actorPlayAnim(w, 0x07, 0x05);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* S.waitScriptActorIdle(sh);
  S.actorFaceActor(w, 0x07, 0x00);
  S.actorFaceActor(w, 0x02, 0x00);
  yield* wait(sh, 0x1E);
  yield* map1DAskStartTournament(sh);
}
// 33:6E45 LoadEffectSpritesA: the tiles 33:6C10 (8 blocks) to VRAM0 $8600, OBJ palette 7 (d = $0F) from 33:6CA1
function loadEffectSpritesA(w) {
  if (w.vram) w.lcd.vbk = 0;
  D.inBank(w, 0x33, () => {
    D.queueVRAMCopy(w, 0x6C10, 0x8600, 0x08);
    D.loadPalettesImmediate(w, 0x6CA1, 0x0F, 0x01);
  });
}
// 33:6BB3 DrawMapSpriteFrames: the sprite 33:6C90 for 5 frames (tiles c, attributes b) at the map point ($E8, $48 +
// $C3E2) in 1/32 tiles less the scroll (<< 3, the high bytes; quirk kept: $C3E2 is added as an unsigned byte with its
// carry, so the "rising" offsets $FE, $FC... put the point $100 / 32 tiles further down)
function* drawMapSpriteFrames(sh, b, c) {
  const w = sh.w;
  for (let h = 0x05; h; h--) {
    const x = ((((0xE8 << 5) - (rd(w, 0xC320) | rd(w, 0xC321) << 8)) & 0xFFFF) << 3 & 0xFFFF) >> 8;
    const y = (((((0x48 + rd(w, 0xC3E2)) << 5) & 0xFFFF) - (rd(w, 0xC322) | rd(w, 0xC323) << 8) & 0xFFFF) << 3 & 0xFFFF) >> 8;
    D.inBank(w, 0x33, () => D.queueSpriteTemplate(w, 0x6C90, y, x, c, b));
    yield* sh.advance();
  }
}
// 33:6B62 Map1DRisingSpriteEffect: five times the tiles $60, $62, $64, $66 (attributes 7), $C3E2 down by 2 before
// each
function* risingSpriteEffect(sh) {
  const w = sh.w;
  wr(w, 0xC3E2, 0); wr(w, 0xC3E0, 0);
  while (rd(w, 0xC3E0) !== 0x05) {
    for (const c of [0x60, 0x62, 0x64, 0x66]) {
      wr(w, 0xC3E2, (rd(w, 0xC3E2) + 0xFE) & 0xFF);
      yield* drawMapSpriteFrames(sh, 0x07, c);
    }
    wr(w, 0xC3E0, (rd(w, 0xC3E0) + 1) & 0xFF);
  }
}
// 33:642C Map1DTournamentOpening (after "May we begin?" Yes): with #127 (the door already open) straight to the
// round (33:668D); else $146E, Mario (7) and Peach (2) face each other then down and bow, Toad (6) leads the player
// to ($1F00, $0B00), his effect sprites (33:6E45) and the rising effect (33:6B62) at the door, fade out (2), #127,
// the actors' palettes (04:4D2B), the door opened (33:63F9), fade in (2); Toad steps aside, Peach comes over: two
// texts; the residents' cheering (scripts 33:6EFA / 6F15 / 6F21, hops), 100 frames; Peach and the player walk
// through the door and are put away ($1F00, $3000); then 33:668D: no result yet, sound $99, wStoryRoundKind $0A,
// fade out (4), GolfSessionInit 10:4B28, the return point (map $1D, entrance 6), game mode 1 (a tournament), the
// player and no second player (02:4A28), course 5 hole 1 (10:423B: the wind byte a is 0, left by ClearMemory16),
// the round (33:66CB: 1 hole with #72, else 18), GolfSessionEnd 10:4B94
function* map1DTournamentOpening(sh) {
  const w = sh.w;
  if (!flag(w, 127)) {
    T.scriptSetText(w, 0x146E);
    S.actorsFaceEachOther(w, 0x07, 0x02);
    yield* wait(sh, 0x1E);
    S.actorSetFacing(w, 0x07, 0x00);
    S.actorSetFacing(w, 0x02, 0x00);
    S.actorPlayAnim(w, 0x02, 0x05);
    S.actorPlayAnim(w, 0x07, 0x05);
    yield* S.waitActorAnimDone(sh, 0x07);
    S.actorSetFacing(w, 0x06, 0x80);
    yield* S.scriptActorGoTo(sh, 0x00, 0x1F00, 0x0B00);
    yield* S.waitScriptActorIdle(sh);
    S.actorSetFacing(w, 0x06, 0x80);
    S.actorPlayAnim(w, 0x06, 0x05);
    yield* S.waitActorAnimDone(sh, 0x06);
    S.actorSetFacing(w, 0x06, 0xC0);
    loadEffectSpritesA(w);
    yield* wait(sh, 0x1E);
    S.actorPlayAnim(w, 0x06, 0x06);
    yield* S.waitActorAnimDone(sh, 0x06);
    S.actorPlayAnim(w, 0x06, 0x06);
    yield* S.waitActorAnimDone(sh, 0x06);
    yield* risingSpriteEffect(sh);
    Scr.beginFadeOut(w, 0x02);
    S.actorPlayAnim(w, 0x06, 0x06);
    yield* S.waitActorAnimDone(sh, 0x06);
    setFlag(w, 127);
    D.inBank(w, 0x04, () => A.loadActorPalettes(w));               // 04:4D2B
    yield* map1DOpenCastleDoor(sh);
    Scr.beginFadeIn(w, 0x02);
    yield* Scr.waitFade(sh);
    S.actorSetFacing(w, 0x06, 0x80);
    yield* wait(sh, 0x14);
    S.actorLockSpriteFacing(w, 0x06, 0x01);
    S.actorMoveTo(w, 0x06, 0x2100, 0x0B00);
    yield* S.waitActorMoveDone(sh, 0x06);
    S.actorLockSpriteFacing(w, 0x06, 0x00);
    S.actorSetFacing(w, 0x06, 0x80);
    yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
    yield* S.waitScriptActorIdle(sh);
    S.actorFaceActor(w, 0x02, 0x00);
    yield* T.scriptShowText(sh, 0x02);
    S.actorPlayAnim(w, 0x02, 0x05);
    yield* S.waitActorAnimDone(sh, 0x02);
    yield* T.scriptShowText(sh, 0x02);
    sh.sound(0x89);
    S.actorJump(w, 0x0B, 0xFF80);
    S.actorSetScript(w, 0x0A, 0x6EFA, 0x33);
    S.actorMoveDir(w, 0x07, 0x40, 0x0200);
    sh.sound(0x8A);
    S.actorJump(w, 0x09, 0xFF40);
    yield* S.waitActorLanded(sh, 0x09);
    sh.sound(0x89);
    S.actorJump(w, 0x07, 0xFF40);
    yield* S.waitActorLanded(sh, 0x07);
    S.actorSetScript(w, 0x0A, 0x6F15, 0x33);
    S.actorSetScript(w, 0x09, 0x6F15, 0x33);
    S.actorSetScript(w, 0x0B, 0x6F15, 0x33);
    S.actorSetScript(w, 0x07, 0x6F15, 0x33);
    S.actorSetScript(w, 0x08, 0x6F15, 0x33);
    S.actorSetScript(w, 0x0C, 0x6F21, 0x33);
    yield* wait(sh, 0x64);
    S.actorSetSpeed(w, 0x02, 0x0010);
    S.actorSetSpeed(w, 0x00, 0x0010);
    S.actorMoveTo(w, 0x02, 0x1400, 0x0C00);
    yield* S.waitActorMoveDone(sh, 0x02);
    S.actorPlayAnim(w, 0x02, 0x05);
    yield* S.waitActorAnimDone(sh, 0x02);
    S.actorMoveTo(w, 0x02, 0x1F00, 0x0B00);
    S.scriptActorSetSpeed(w, 0x0010);
    yield* S.scriptActorGoTo(sh, 0x00, 0x2100, 0x0B00);
    yield* wait(sh, 0x1E);
    S.actorMoveTo(w, 0x00, 0x1F00, 0x0D00);
    yield* S.waitActorMoveDone(sh, 0x02);
    S.actorSetFacing(w, 0x02, 0xC0);
    yield* wait(sh, 0x03);
    S.actorMoveTo(w, 0x02, 0x1F00, 0x0800);
    yield* wait(sh, 0x0A);
    S.actorPlayAnim(w, 0x02, 0x0A);
    yield* wait(sh, 0x14);
    S.actorMoveTo(w, 0x00, 0x1F00, 0x0800);
    yield* S.waitActorMoveDone(sh, 0x02);
    S.actorPlayAnim(w, 0x00, 0x0A);
    S.actorSetPos(w, 0x02, 0x1F00, 0x3000);
    yield* wait(sh, 0x14);
    yield* S.waitActorMoveDone(sh, 0x00);
    S.actorSetPos(w, 0x00, 0x1F00, 0x3000);
  }
  wr(w, 0xC96C, 0x00);                                            // 33:668D
  sh.sound(0x99);
  wr(w, 0xC967, 0x0A);
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  St.golfSessionInit(w);
  wr(w, 0xC960, 0x1D); wr(w, 0xC961, 0x06);                     // 0A:4D5B MapSaveReturnPoint
  wr(w, 0xC834, 0x01);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x05, 0x01);
  if (!sh.playGolfRound) notPorted("Peach's Tournament outside the game loop");
  yield* sh.playGolfRound(flag(w, 72) ? 0x01 : 0x12);             // 33:66CB
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));
}
// 33:66DC Map1DAskStartTournament: "May we begin the tournament?" ($1477, Peach) asked: No: after a round (#240)
// $1476, else the next text ($1478); Yes: the player to ($1400, $0F00) facing up, the opening (33:642C)
function* map1DAskStartTournament(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x1477);
  yield* T.scriptShowTextKeepOpen(sh, 0x02);
  yield* wait(sh, 0x0A);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) {
    if (flag(w, 240)) T.scriptSetText(w, 0x1476);
    yield* T.scriptShowText(sh, 0x02);
    return;
  }
  yield* moveAndWait(sh, 0x00, 0x1400, 0x0F00);
  S.actorSetFacing(w, 0x00, 0xC0);
  yield* map1DTournamentOpening(sh);
}
// 33:672A Map1DAwardCeremony: unless back from Peach's Tournament (entrance 6) placed 1-3: music $10 (33:69F5).
// Placed: a win sets #111, the return point (map 0, entrance $FA) and saves (02:4489) unless #111 was already set
// (then straight to 33:696B); the stage (2 x 2 block $2A,$10 to $10,$11), the actors 33:6A00, the player led to Peach
// (speed $40) and put at ($1400, $0E00); the trophy by the place (the 2 x 2 blocks $2A / $2D / $30,$0D to $13,$0E;
// the other two trophy actors $0E-$10 hidden; text $1479 and #121 for a win, else $147A with the place as its
// number and #121 cleared); sound $04 and $93, fade in (2), the trophy handed over ($147B), fade out (4); then
// 33:696B: a win: ShowPictureTimed 40:6666 (the character's picture), EndingSequence 0A:56B1, #111, map 0 entrance
// 2, wReplayActive $C96D = 0, the return point (map 0 at the saved position), SaveGame, map 0 entrance 3 by warp
// $FA (the title); else after a round kind $32
// warp 2, or the actors 33:6ABD, the stage blocks ($2D,$10 and $30,$10 to $13,$0E / $10,$11), music $10, the player
// at ($1400, $0F00), 60 frames, fade in (4)
function* map1DAwardCeremony(sh) {
  const w = sh.w;
  const r = rd(w, 0xC96C);
  if (rd(w, 0xC46A) !== 0x06 || r === 0 || r >= 4) { sh.sound(0x10); return; }
  if (!flag(w, 111)) {
    if (r === 1) {
      setFlag(w, 111);
      wr(w, 0xC960, 0x00); wr(w, 0xC961, 0xFA);                   // 0A:4D5B MapSaveReturnPoint
      saveGame(w);                                                // 02:4489
    }
    yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x2A, 0x10, 0x10, 0x11, 0x02, 0x02));   // 33:675C
    M.scriptRespawnActors(w, 0x33, 0x6A00);
    S.scriptActorSetSpeed(w, 0x0040);
    yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
    S.actorSetPos(w, 0x00, 0x1400, 0x0E00);
    const trophy = b => inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, b, 0x0D, 0x13, 0x0E, 0x02, 0x02));
    if (r === 1) {
      yield* trophy(0x2A);
      S.actorSetState(w, 0x0F, 0x00); S.actorSetState(w, 0x10, 0x00);
      T.scriptSetText(w, 0x1479);
      setFlag(w, 121);
    } else {
      clearFlag(w, 121);
      yield* trophy(r === 2 ? 0x2D : 0x30);
      T.scriptSetText(w, 0x147A);
      S.actorSetState(w, 0x0E, 0x00); S.actorSetState(w, r === 2 ? 0x10 : 0x0F, 0x00);
      pushTextNumberArg(w, r);                                    // 05:551F
    }
  sh.sound(0x04);
  sh.sound(0x93);
  yield* S.waitScriptActorIdle(sh);
  Scr.beginFadeIn(w, 0x02);
  yield* Scr.waitFade(sh);
  S.actorSetSpeed(w, 0x02, 0x0008);
  S.actorSetSpeed(w, 0x0E, 0x0008);
  S.actorSetSpeed(w, 0x0F, 0x0008);
  S.actorSetSpeed(w, 0x10, 0x0008);
  yield* wait(sh, 0x96);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  S.actorMoveTo(w, 0x02, 0x1300, 0x1200);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorMoveTo(w, 0x0E, 0x1380, 0x1180);
  S.actorMoveTo(w, 0x0F, 0x1380, 0x1180);
  S.actorMoveTo(w, 0x10, 0x1380, 0x1180);
  yield* wait(sh, 0x1E);
  S.actorSetFacing(w, 0x02, 0xC0);
  S.actorSetPos(w, 0x0E, 0x13C0, 0x1100);
  S.actorSetPos(w, 0x0F, 0x13C0, 0x1100);
  S.actorSetPos(w, 0x10, 0x13C0, 0x1100);
  S.actorMoveTo(w, 0x02, 0x1400, 0x1080);
  yield* wait(sh, 0x0A);
  S.actorMoveTo(w, 0x0E, 0x1400, 0x1000);
  S.actorMoveTo(w, 0x0F, 0x1400, 0x1000);
  S.actorMoveTo(w, 0x10, 0x1400, 0x1000);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorFaceActor(w, 0x02, 0x00);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  S.actorPlayAnim(w, 0x00, 0x05);
  yield* S.waitActorAnimDone(sh, 0x00);
  T.scriptSetText(w, 0x147B);
  yield* T.scriptShowText(sh, 0x02);
  sh.sound(0x93);
  S.actorMoveTo(w, 0x0E, 0x1480, 0x0F40);
  S.actorMoveTo(w, 0x0F, 0x1480, 0x0F40);
  S.actorMoveTo(w, 0x10, 0x1480, 0x0F40);
  yield* wait(sh, 0x1E);
  S.actorPlayAnim(w, 0x00, 0x07);
  yield* wait(sh, 0x96);
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  }
  if (r === 1) {                                                  // 33:696B
    yield* inBankGen(w, 0x40, showPictureTimed(sh, rd(w, 0xC810)));   // 40:6666 ShowPictureTimed (wCharId)
    yield* inBankGen(w, 0x0A, endingSequence(sh));                // 0A:56B1 EndingSequence
    setFlag(w, 111);
    wr(w, 0xC450, 0x00); wr(w, 0xC46A, 0x02);
    wr(w, 0xC96D, 0x00);
    St.mapSaveReturnPoint(w);                                     // 0A:4D5B (bc = $FFFF: map 0 at the saved position)
    saveGame(w);                                                  // 02:4489
    wr(w, 0xC450, 0x00); wr(w, 0xC46A, 0x03);
    wr(w, 0xC441, 0xFA);
    return;
  }
  if (rd(w, 0xC967) === 0x32) { wr(w, 0xC441, 0x02); return; }   // 33:69A5
  M.scriptRespawnActors(w, 0x33, 0x6ABD);
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x2D, 0x10, 0x13, 0x0E, 0x02, 0x02));
  yield* inBankGen(w, 0x0B, mapBufCopyRectRedraw(sh, 0x30, 0x10, 0x10, 0x11, 0x02, 0x02));
  sh.sound(0x10);
  S.actorSetPos(w, 0x00, 0x1400, 0x0F00);
  yield* wait(sh, 0x3C);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
}
// 33:5D8D Map1DTalkToadPracticeRound (talk 6): ScriptBegin; without #127 (the door shut) $146C; else "A practice
// round?" ($146A, Toad) asked: No: the next text; Yes (33:5DCB): Toad hops (sound $89) to the door ($2100, $0B00),
// faces left, the next text, the player through the door (speed 8, animation $0A, sound $99), fade out (4); the
// round: wStoryRoundKind $1E (quirk kept: the match kind, not $14), GolfSessionInit, the return point map $1D
// entrance 2, game mode 3 (practice), the player and no second player, course 5 hole 1 (the wind byte a is 0, from
// ClearMemory16), the round (33:66CB), GolfSessionEnd; ScriptEnd
function* map1DTalkToad(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  if (!flag(w, 127)) T.scriptSetText(w, 0x146C);
  else {
    T.scriptSetText(w, 0x146A);
    yield* T.scriptShowTextKeepOpen(sh, 0x06);
    yield* wait(sh, 0x05);
    const a = yield* T.scriptAskYesNo(sh);
    yield* T.scriptCloseText(sh);
    yield* wait(sh, 0x05);
    if (!a) { yield* toadPracticeRound(sh); return; }
    T.scriptSkipText(w);
  }
  yield* T.scriptShowText(sh, 0x06);                              // 33:5DC2
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
function* toadPracticeRound(sh) {
  const w = sh.w;
  yield* wait(sh, 0x05);                                          // 33:5DCB
  sh.sound(0x89);
  S.actorJump(w, 0x06, 0xFF40);
  yield* wait(sh, 0x0F);
  yield* moveAndWait(sh, 0x06, 0x2100, 0x0B00);
  S.actorSetFacing(w, 0x06, 0x80);
  yield* T.scriptShowText(sh, 0x06);
  S.actorSetSpeed(w, 0x00, 0x0008);
  S.actorMoveTo(w, 0x00, 0x1F00, 0x0900);
  yield* wait(sh, 0x19);
  S.actorPlayAnim(w, 0x00, 0x0A);
  yield* wait(sh, 0x0A);
  sh.sound(0x99);
  yield* wait(sh, 0x0A);
  Scr.beginFadeOut(w, 0x04);
  yield* Scr.waitFade(sh);
  wr(w, 0xC967, 0x1E);
  St.golfSessionInit(w);
  wr(w, 0xC960, 0x1D); wr(w, 0xC961, 0x02);                     // 0A:4D5B MapSaveReturnPoint
  wr(w, 0xC834, 0x03);
  St.setupPlayerGolfer(w, 0x80, 0x00);
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  St.setCourseHole(w, 0x00, 0x05, 0x01);
  if (!sh.playGolfRound) notPorted("Peach's Castle's practice round outside the game loop");
  yield* sh.playGolfRound(flag(w, 72) ? 0x01 : 0x12);             // 33:66CB
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 33:6F47 Map1DObject1UpMushroom (object 4): at level 99 nothing; else #158, the EXP to the next level (02:5498,
// 02:5465), the mushroom (actor $0F) pops up at ($0B00, $1B00) (sound $63, a jump), 16 frames, put away, "got a
// 1-UP Mushroom!" ($0C5F, speaker $82), the level-up screen (33:7CB7, a copy of 32:7EE7), the map again at the
// saved position (warp $FA)
function* map1DObject1UpMushroom(sh) {
  const w = sh.w;
  if (rd(w, 0xC812) === 0x63) return;
  setFlag(w, 158);
  addExp(w, expToNextLevel(w));
  S.actorSetPos(w, 0x0F, 0x0B00, 0x1B00);
  sh.sound(0x63);
  S.actorJump(w, 0x0F, 0xFF00);
  yield* S.waitActorLanded(sh, 0x0F);
  yield* wait(sh, 0x10);
  S.actorSetPos(w, 0x0F, 0x3F00, 0x3F00);
  T.scriptSetText(w, 0x0C5F);
  yield* T.scriptShowText(sh, 0x82);
  Scr.beginFadeOut(w, 0x08);                                      // 33:7CB7 FadeToLevelUpScreenB
  yield* Scr.waitFade(sh);
  yield* inBankGen(w, 0x41, levelUpScreen(sh));                   // 41:402A
  wr(w, 0xC441, 0xFA); wr(w, 0xC46A, 0xFA);
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));   // 00:03D3 CopyMemoryBC
  wr(w, 0xC465, rd(w, 0xC2A4));
}
// 33:5F42 Map1DEnterPeachsCastle: no name banner, #125, 33:5F5B, 33:5F8F, the door (33:63F9), the first visit
// (33:60B2), the ceremony (33:672A)
function* map1DEnter(sh) {
  const w = sh.w;
  wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
  setFlag(w, 125);
  map1DResultTestEntrances(w);
  map1DSetResultFlags(w);
  yield* map1DOpenCastleDoor(sh);
  yield* map1DFirstVisitScene(sh);
  yield* map1DAwardCeremony(sh);
}
// 33:5F25 Map1DTriggerExit (trigger 1): sound $9C, fade out (8), 30 frames, warp 1
function* map1DTriggerExit(sh) {
  const w = sh.w;
  sh.sound(0x9C);
  Scr.beginFadeOut(w, 0x08);
  yield* wait(sh, 0x1E);
  wr(w, 0xC441, 0x01);
}
// 33:5BD1 Map1DTalkGoBackDown (talk $0E, object 1): sound $8A, the player hops ($FF40), 5 frames, to ($1500,
// $1D00), put away, 33:5F25
function* map1DGoBackDown(sh) {
  const w = sh.w;
  sh.sound(0x8A);
  S.actorJump(w, 0x00, 0xFF40);
  yield* wait(sh, 0x05);
  yield* moveAndWait(sh, 0x00, 0x1500, 0x1D00);
  S.actorSetPos(w, 0x00, 0x3F00, 0x3F00);
  yield* map1DTriggerExit(sh);
}
// 33:5C4D Map1DTalkPeach (talk 2): beaten Mario (#117) or won (#241): $1474 shown, then the next text asked; placed
// out of the three (#243): $1470 asked; placed (#240): $1472 asked; no round yet: 33:66DC; Yes -> 33:66DC, No -> the
// next text shown
function* map1DTalkPeach(sh) {
  const w = sh.w;
  if (!flag(w, 117)) {
    if (!flag(w, 240)) { yield* map1DAskStartTournament(sh); return; }
    if (flag(w, 241)) { T.scriptSetText(w, 0x1474); yield* T.scriptShowText(sh, 0x02); }
    else T.scriptSetText(w, flag(w, 243) ? 0x1470 : 0x1472);
  } else { T.scriptSetText(w, 0x1474); yield* T.scriptShowText(sh, 0x02); }
  yield* T.scriptShowTextKeepOpen(sh, 0x02);                      // 33:5C89
  yield* wait(sh, 0x0A);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (!a) { yield* map1DAskStartTournament(sh); return; }
  yield* T.scriptShowText(sh, 0x02);
}
// 33:5C01 Map1DTalkPeachWalk (talk 2, facing $60): Peach's animation 5, the player round her to ($1600, $0840),
// ($1600, $0D00), she faces left, the player to ($1400, $0D00) facing her, then 33:5C4D
function* map1DTalkPeachWalk(sh) {
  const w = sh.w;
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* moveAndWait(sh, 0x00, 0x1600, 0x0840);
  yield* moveAndWait(sh, 0x00, 0x1600, 0x0D00);
  S.actorSetFacing(w, 0x02, 0x40);
  yield* moveAndWait(sh, 0x00, 0x1400, 0x0D00);
  S.actorFaceActor(w, 0x00, 0x02);
  yield* map1DTalkPeach(sh);
}
// a text, the next one after #117 (ScriptSkipText 0A:4140), speaker b: 33:5CB0 Mario ($145A, 7), 33:5D51 / 5D65 /
// 5D79 the residents ($1464 / $1466 / $1468; 5 / 4 / 5)
function* map1DTalkAfter117(sh, id, b) {
  const w = sh.w;
  T.scriptSetText(w, id);
  if (flag(w, 117)) T.scriptSkipText(w);
  yield* T.scriptShowText(sh, b);
}
// 33:5CC4 Map1DTalkLuigi (talk 8): #117 $1460; else $145E, + 1 after a round (#240) placed (not #243), + 1 more
// when not #242 (won); speaker 8
function* map1DTalkLuigi(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x1460);
  if (!flag(w, 117)) {
    T.scriptSetText(w, 0x145E);
    if (flag(w, 240) && !flag(w, 243)) {
      T.scriptSkipText(w);
      if (!flag(w, 242)) T.scriptSkipText(w);
    }
  }
  yield* T.scriptShowText(sh, 0x08);
}
// 33:5D2A Map1DTalkBowser (talk $0C): #117 $1463; else $1461, + 1 after a round (#240), + 1 more when won (#241);
// speaker $0C
function* map1DTalkBowser(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x1463);
  if (!flag(w, 117)) {
    T.scriptSetText(w, 0x1461);
    if (flag(w, 240)) {
      T.scriptSkipText(w);
      if (flag(w, 241)) T.scriptSkipText(w);
    }
  }
  yield* T.scriptShowText(sh, 0x0C);
}
// 33:5CFC Map1DTalkDK (talk $0B): ScriptBegin, $145D (speaker $0B), ScriptEnd
function* map1DTalkDK(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x145D);
  yield* T.scriptShowText(sh, 0x0B);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
// 33:5D0E / 5D1C Map1DTalkYoshiA / B (talk $0A): $1459 with sound $9D, speaker $83 / $81
function* map1DTalkYoshi(sh, b) {
  T.scriptSetText(sh.w, 0x1459);
  sh.sound(0x9D);
  yield* T.scriptShowText(sh, b);
}
// 33:5EE5 Map1DObjectCastleDoor (object 3): sound $9E; $147E ("shut tight"), or $147D with flag #23; speaker $80
function* map1DObjectCastleDoor(sh) {
  const w = sh.w;
  sh.sound(0x9E);
  T.scriptSetText(w, flag(w, 23) ? 0x147D : 0x147E);
  yield* T.scriptShowText(sh, 0x80);
}

// ---- maps $2E / $2F, the Club Maker's Hut and the Windy Valley hut (one header, 33:781E) ----
// 02:539C SetCharFlags12: wCharFlags $C819 bits 1-2 = a
const setCharFlags12 = (w, a) => wr(w, 0xC819, (rd(w, 0xC819) & 0xF9) | ((a << 1) & 0x06));
// 33:795C Map2EEnterClubMakersHut: no name banner at entrance $FA; map $2E: the bounds $C329 = 1 / $C32B = $15, #124
// (the hut seen); map $2F: $1B / $2F
function* map2EEnter(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) === 0xFA) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  const m = mapId(w);
  if (m === 0x2E) { wr(w, 0xC329, 0x01); wr(w, 0xC32B, 0x15); setFlag(w, 124); }
  else if (m === 0x2F) { wr(w, 0xC329, 0x1B); wr(w, 0xC32B, 0x2F); }
}
// a question of the club maker (speaker 2): shown, 10 and 5 frames, asked; 5 frames after: true for No
function* clubMakerAsk(sh) {
  yield* T.scriptShowTextKeepOpen(sh, 0x02);
  yield* wait(sh, 0x0A);
  yield* wait(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  return a;
}
// the club handed over or back: the player faces left, animation $0A, (sound $94), the text (speaker $80), the player
// faces the maker, animation 1, then (handed over) $1814 or (given back, 33:7B12) the text's next part (speaker 2)
function* clubMakerHandOver(sh, id, handed) {
  const w = sh.w;
  T.scriptSetText(w, id);
  S.actorSetFacing(w, 0x00, 0x40);
  S.actorPlayAnim(w, 0x00, 0x0A);
  if (handed) sh.sound(0x94);
  yield* T.scriptShowText(sh, 0x80);
  S.actorFaceActor(w, 0x00, 0x02);
  S.actorPlayAnim(w, 0x00, 0x01);
  if (handed) T.scriptSetText(w, 0x1814);
  yield* T.scriptShowText(sh, 0x02);
}
// 33:7990 Map2EClubMakerOffer: $180C asked: No: the next text; Yes: the next asked: No: $180F; Yes: the next shown,
// the menu $1811 at (1, 1) (0A:42BF): B ($FF) or None (2) -> $180F; Distance (0) / Control (1, #217): #215 #216 #225, the
// character's special club (SetCharFlags12 02:539C = 1 / 2), $1812 + the choice handed over with sound $94
function* clubMakerOffer(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x180C);
  if (yield* clubMakerAsk(sh)) { yield* T.scriptShowText(sh, 0x02); return; }
  T.scriptSkipText(w);
  if (!(yield* clubMakerAsk(sh))) {
    T.scriptSkipText(w);
    yield* T.scriptShowText(sh, 0x02);
    const m = yield* S.scriptRunMenu(sh, 0x1811, 0x01, 0x01);
    if (m !== 0xFF && m !== 0x02) {
      const a = m === 0x00 ? 0x00 : 0x01;                         // 33:7A06 (quirk kept: any other answer is 1)
      wr(w, 0xC3E0, a);
      if (a === 0x01) setFlag(w, 217);
      setFlag(w, 215); setFlag(w, 216); setFlag(w, 225);
      setCharFlags12(w, (a + 1) & 0xFF);
      yield* clubMakerHandOver(sh, (0x1812 + a) & 0xFFFF, true);
      return;
    }
  }
  T.scriptSetText(w, 0x180F);                                     // 33:79E5
  yield* T.scriptShowText(sh, 0x02);
}
// 33:7A73 Map2EClubMakerExchange: $1816 asked: No -> $1817; Yes: the next asked: No -> $1817; Yes: #225; with the
// club (#216): it is given back (#216 cleared, SetCharFlags12 0), the return point (map 0, entrance $FA), SaveGame,
// $1819; else it is taken again (#216, SetCharFlags12 1, or 2 with #217), the return point, SaveGame, $181B with sound
// $94
function* clubMakerExchange(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x1816);
  if (!(yield* clubMakerAsk(sh))) {
    T.scriptSkipText(w);
    if (!(yield* clubMakerAsk(sh))) {
      setFlag(w, 225);
      const had = flag(w, 216);
      if (had) { clearFlag(w, 216); setCharFlags12(w, 0x00); }
      else { setFlag(w, 216); setCharFlags12(w, flag(w, 217) ? 0x02 : 0x01); }
      wr(w, 0xC960, 0x00); wr(w, 0xC961, 0xFA);                   // 0A:4D5B MapSaveReturnPoint
      saveGame(w);                                                // 02:4489
      yield* clubMakerHandOver(sh, had ? 0x1819 : 0x181B, !had);
      return;
    }
  }
  T.scriptSetText(w, 0x1817);                                     // 33:7A9C
  yield* T.scriptShowText(sh, 0x02);
}
// 33:7882 Map2ETalkClubMaker (talk 2): a fresh deal (#225): $1814 with the club (#216), else $181A; no club ever
// (#215 clear): the offer (33:7990); #224 clear: the exchange (33:7A73); else as a fresh deal
function* map2ETalkClubMaker(sh) {
  const w = sh.w;
  if (!flag(w, 225)) {
    if (!flag(w, 215)) { yield* clubMakerOffer(sh); return; }
    if (!flag(w, 224)) { yield* clubMakerExchange(sh); return; }
  }
  T.scriptSetText(w, flag(w, 216) ? 0x1814 : 0x181A);            // 33:7899
  yield* T.scriptShowText(sh, 0x02);
}
// 33:78B6 Map2ETalkGuardian (talk 3, the Windy Valley guardian): after #212: $14D4, his animation 5, the maker's $0A,
// #213, warp 3 (the second target); else $14D0 (the next text once #200 is set; #200 set the first time)
function* map2ETalkGuardian(sh) {
  const w = sh.w;
  if (flag(w, 212)) {
    T.scriptSetText(w, 0x14D4);
    S.actorPlayAnim(w, 0x03, 0x05);
    yield* S.waitActorAnimDone(sh, 0x03);
    S.actorPlayAnim(w, 0x02, 0x0A);
    yield* T.scriptShowText(sh, 0x03);
    setFlag(w, 213);
    wr(w, 0xC441, 0x03);
    return;
  }
  T.scriptSetText(w, 0x14D0);
  if (flag(w, 200)) T.scriptSkipText(w);
  else setFlag(w, 200);
  yield* T.scriptShowText(sh, 0x03);
}
// 33:791C Map2ETriggerLeave (trigger 1): a fresh club (#225 and #216): the maker faces left, $1815, 30 frames; warp 1
function* map2ETriggerLeave(sh) {
  const w = sh.w;
  if (flag(w, 225) && flag(w, 216)) {
    S.actorSetFacing(w, 0x02, 0x40);
    T.scriptSetText(w, 0x1815);
    yield* T.scriptShowText(sh, 0x02);
    yield* wait(sh, 0x1E);
  }
  wr(w, 0xC441, 0x01);
}
// 33:7945 Map2ETriggerExit2 (trigger 2): warp 2
function* map2ETriggerExit2(sh) { wr(sh.w, 0xC441, 0x02); }
// 33:7B6B Map2EObject1UpMushroom (object 1): as 33:6F47 but #157 is set before the level-99 test (quirk kept: at
// level 99 the flag is still set), the mushroom is actor 4 at ($0500, $0700), the text's speaker is $88
function* map2EObject1UpMushroom(sh) {
  const w = sh.w;
  setFlag(w, 157);
  if (rd(w, 0xC812) === 0x63) return;
  addExp(w, expToNextLevel(w));
  S.actorSetPos(w, 0x04, 0x0500, 0x0700);
  sh.sound(0x63);
  S.actorJump(w, 0x04, 0xFF00);
  yield* S.waitActorLanded(sh, 0x04);
  yield* wait(sh, 0x10);
  S.actorSetPos(w, 0x04, 0x3F00, 0x3F00);
  T.scriptSetText(w, 0x0C5F);
  yield* T.scriptShowText(sh, 0x88);
  Scr.beginFadeOut(w, 0x08);                                      // 33:7CB7 FadeToLevelUpScreenB
  yield* Scr.waitFade(sh);
  yield* inBankGen(w, 0x41, levelUpScreen(sh));                   // 41:402A
  wr(w, 0xC441, 0xFA); wr(w, 0xC46A, 0xFA);
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));   // 00:03D3 CopyMemoryBC
  wr(w, 0xC465, rd(w, 0xC2A4));
}

// 33:445F Map08ObjectHiddenFriend (object $0F of the offices): on map $0B only, once (#140), not when the player is
// Mario (wCharId 0): $0C57 (speaker $0B), Mario (actor $0B) at ($2B00, $0700) steps $0100 right, hops ($FF40), walks
// to ($2700, $0B00), faces right, $0C5B; 33:7CF1 HiddenFriendsBonus (the code of 34:7E12)
function* map08ObjectHiddenFriend(sh) {
  const w = sh.w;
  if (mapId(w) !== 0x0B || flag(w, 140) || rd(w, 0xC810) === 0x00) return;
  setFlag(w, 140);
  T.scriptSetText(w, 0x0C57);
  yield* T.scriptShowText(sh, 0x0B);
  S.actorSetPos(w, 0x0B, 0x2B00, 0x0700);
  S.actorMoveDir(w, 0x0B, 0x40, 0x0100);
  yield* S.waitActorMoveDone(sh, 0x0B);
  S.actorJump(w, 0x0B, 0xFF40);
  yield* moveAndWait(sh, 0x0B, 0x2700, 0x0B00);
  S.actorSetFacing(w, 0x0B, 0x40);
  T.scriptSetText(w, 0x0C5B);
  yield* T.scriptShowText(sh, 0x0B);
  yield* awardFoundAllRivalsExp(sh);                              // 33:7CF1
}
// ---- map $26, the Windy Valley Special Hole (header 33:6FB9) ----
// 33:7813 SetTempFlagFromHand: #224 when GetCharHand 02:53AC (wCharFlags bit 0) is 1
function setTempFlagFromHand(w) { if ((rd(w, 0xC819) & 0x01) === 0x01) setFlag(w, 224); }
// 33:701F Map26TalkGuardianA (talk 2): $14C8 with his animation 6 (speaker 2); the first time (#199) he steps aside:
// his facing locked, $0300 to the left ($C0), unlocked
function* map26TalkGuardianA(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x14C8);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  if (flag(w, 199)) return;
  setFlag(w, 199);
  S.actorLockSpriteFacing(w, 0x02, 0x01);
  S.actorMoveDir(w, 0x02, 0xC0, 0x0300);
  yield* S.waitActorMoveDone(sh, 0x02);
  S.actorLockSpriteFacing(w, 0x02, 0x00);
}
// 33:705D Map26TalkGuardianB (talk 2, the other entry): the same text; the first time (#199) he walks round: $0200
// up ($00), $0400 left ($C0), $0200 down ($80), then faces right ($40)
function* map26TalkGuardianB(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x14C8);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  if (flag(w, 199)) return;
  setFlag(w, 199);
  for (const [b, de] of [[0x00, 0x0200], [0xC0, 0x0400], [0x80, 0x0200]]) {
    S.actorMoveDir(w, 0x02, b, de);
    yield* S.waitActorMoveDone(sh, 0x02);
  }
  S.actorSetFacing(w, 0x02, 0x40);
}
// 33:70E1 Map26ObjectLockedDoor (object 1) / the locked branch of 33:7116: (sound $9E,) "The door is locked." ($14D2,
// speaker $83)
function* map26LockedText(sh) { T.scriptSetText(sh.w, 0x14D2); yield* T.scriptShowText(sh, 0x83); }
// 33:7116 Map26TriggerDoor (trigger 4): without #198 locked; else a step up ($0100, $C0), warp 2, sound $92
function* map26TriggerDoor(sh) {
  const w = sh.w;
  if (!flag(w, 198)) { yield* map26LockedText(sh); return; }
  S.actorMoveDir(w, 0x00, 0xC0, 0x0100);
  yield* S.waitActorMoveDone(sh, 0x00);
  wr(w, 0xC441, 0x02);
  sh.sound(0x92);
}
// 33:713E Map26TriggerLeave (trigger 5): challenged (#199) and not passed (#198): "Hmph!" ($14C9, speaker 2); warp 1,
// sound $92
function* map26TriggerLeave(sh) {
  const w = sh.w;
  if (flag(w, 199) && !flag(w, 198)) { T.scriptSetText(w, 0x14C9); yield* T.scriptShowText(sh, 0x02); }
  wr(w, 0xC441, 0x01);
  sh.sound(0x92);
}
// 33:70F8 / 7109 / 710D Map26TriggerTarget1-3: (target 1 without #199: the guardian's talk 33:701F first) wScriptArg
// $C4BC = the target, 33:72BE
function* map26TriggerTarget(sh, n) {
  const w = sh.w;
  if (n === 1 && !flag(w, 199)) yield* map26TalkGuardianA(sh);
  wr(w, 0xC4BC, n);
  yield* map26AskTargetShot(sh);
}
// 33:72BE Map26AskTargetShot: "Shoot from here?" ($14D3, speaker $80; 5 frames, the question, 5 frames): Yes:
// wStoryRoundKind $0A, GolfSessionInit, the player and no second player, the tee and mode (33:730C), the wind and hole
// (33:751B), the hooks 33:736F in this bank, GolfRound for one hole, GolfSessionEnd
function* map26AskTargetShot(sh) {
  const w = sh.w;
  T.scriptSetText(w, 0x14D3);
  yield* T.scriptShowTextKeepOpen(sh, 0x80);
  yield* wait(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) return;
  wr(w, 0xC967, 0x0A);
  St.golfSessionInit(w);                                          // 10:4B28
  St.setupPlayerGolfer(w, 0x80, 0x00);                            // 02:4A28
  St.setupPlayerGolfer(w, 0xFF, 0x01);
  map26SetTargetTee(w);
  map26SetTargetWindHole(w);
  Ls.setGolfEventHook(w, 0x33, 0x736F);                           // 10:4BC7
  if (!sh.playGolfRound) notPorted("Windy Valley's target shot outside the game loop");
  yield* sh.playGolfRound(0x01);                                  // 10:4451
  yield* inBankGen(w, 0x10, golfSessionEnd(sh));                  // 10:4B94
}
// 33:730C Map26SetTargetTee: SetForcedTee 10:4C04 by the target (1: ($2320, $1DA0); 2: ($1CA0, $2980); else ($11E0,
// $2CE0)); game mode 6 with $C82C = 7, except target 1 before the first success (#198 clear) or for the second
// target (#213 set), both while #201 is clear: game mode 5 with $C82C = $28
function map26SetTargetTee(w) {
  const n = rd(w, 0xC4BC);
  let mini = false;
  if (n === 0x01) {
    Ls.setForcedTee(w, 0x2320, 0x1DA0);
    mini = !flag(w, 201) && (!flag(w, 198) || flag(w, 213));
  } else if (n === 0x02) Ls.setForcedTee(w, 0x1CA0, 0x2980);
  else Ls.setForcedTee(w, 0x11E0, 0x2CE0);
  wr(w, 0xC834, mini ? 0x05 : 0x06);
  wr(w, 0xC82C, mini ? 0x28 : 0x07);
}
// 33:751B Map26SetTargetWindHole: a = the random low byte & 3 (0 -> 3); before #213: SetForcedWind $C006 + a, course
// 0 hole 7; after: $E006 + a (0 with flag #72), course 8 hole $0B. SetCourseHole's wind byte is the a SetForcedWind
// leaves (6: its WRAM bank)
function map26SetTargetWindHole(w) {
  let a = advanceRandomSeed(w) & 0x03;                            // 00:0A61
  if (!a) a = 0x03;
  if (!flag(w, 213)) {
    Ls.setForcedWind(w, 0xC006 + a);
    St.setCourseHole(w, 0x06, 0x00, 0x07);                        // 10:423B
  } else {
    Ls.setForcedWind(w, flag(w, 72) ? 0x0000 : 0xE006 + a);
    St.setCourseHole(w, 0x06, 0x08, 0x0B);
  }
}
// 33:7390 Map26TargetShotAfterShot (hook 1): $C3E0 = 0; GolfViewExit; within $3C of the pin (33:7C72
// BallWithinPinDist_33): $C3E0 = 1 and flag #99 = player 1 holed out; the round over ($80); GolfAdvanceFrame
function* map26TargetAfterShot(sh) {
  const w = sh.w;
  wr(w, 0xC3E0, 0x00);
  yield* Ls.inBankGen(w, 0x10, golfViewExit(sh));               // 10:4C6E
  if (!Ls.ballWithinPinDist(w, 0x003C)) {
    wr(w, 0xC3E0, 0x01);
    clearFlag(w, 99);
    if (rd(w, 0xC8AA)) setFlag(w, 99);
  }
  Ls.setGolfEventFlag(w, 0x80);                                   // 10:4CAD
  yield* Ls.golfAdvanceFrame(sh);                                 // 10:4CB9
}
// the guardian at the player's (33:7473 / 7612 halves): text set, ScriptActorSetSpeed $48, the script actor walks to
// the guardian's spot (a = 2, b = 0), his animation 6
function* guardianComesOver(sh) {
  S.scriptActorSetSpeed(sh.w, 0x0048);
  yield* S.scriptActorGoToActor(sh, 0x02, 0x00);
  yield* S.waitScriptActorIdle(sh);
  S.actorPlayAnim(sh.w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
}
// the rest of 33:74C8 / 33:7612: 30 frames, the guardian hops ($FF80), the text (speaker 2), the script actor walks to
// the player's own spot, 30 frames
function* guardianHopAndBack(sh) {
  yield* wait(sh, 0x1E);
  S.actorJump(sh.w, 0x02, 0xFF80);
  yield* S.waitActorLanded(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* S.waitScriptActorIdle(sh);
  yield* wait(sh, 0x1E);
}
// a failure (33:7452 / 75F1): the text, animation 6, shown (speaker 2), animation 6 again
function* guardianFailText(sh, id) {
  const w = sh.w;
  T.scriptSetText(w, id);
  S.actorPlayAnim(w, 0x02, 0x06);
  yield* S.waitActorAnimDone(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  S.actorPlayAnim(w, 0x02, 0x06);
}
// a success's start (33:73E8 / 758E): the text, the guardian hops ($FF80), shown (speaker 2), his animation 5
function* guardianCheers(sh, id) {
  const w = sh.w;
  T.scriptSetText(w, id);
  S.actorJump(w, 0x02, 0xFF80);
  yield* S.waitActorLanded(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  S.actorPlayAnim(w, 0x02, 0x05);
  yield* S.waitActorAnimDone(sh, 0x02);
}
// the EXP de, a quarter more with flag #99 (sra h / rr l twice)
const withBonus = (w, de) => (flag(w, 99) ? (de + ((de << 16 >> 16) >> 2)) & 0xFFFF : de);
// 33:73BB Map26FirstTargetResult (back at entrance $FA): unless #198 or wStoryRoundKind is not $0A: the player faces
// the guardian, fade in (4); target 1: passed ($C3E0 = 1): $14CD and its next part, 40 EXP (AwardExpWithBonus: AddExp,
// $011B with sound $38, WaitJingleEnd, 33:7CB7 the level-up screen), the return point (map 0, $FA), SaveGame, warp
// $0F; else $14CC (33:7452). Targets 2 / 3 (33:7473): before #199 "$14C7" (speaker $80), the guardian comes over and
// talks, #199, steps aside as in 33:701F; after: $14CA (speaker $80), comes over, 33:74F0
function* map26FirstTargetResult(sh) {
  const w = sh.w;
  if (flag(w, 198) || rd(w, 0xC967) !== 0x0A) return;
  S.actorFaceActor(w, 0x00, 0x02);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  if (rd(w, 0xC4BC) === 0x01) {
    if (rd(w, 0xC3E0) !== 0x01) { yield* guardianFailText(sh, 0x14CC); return; }
    yield* guardianCheers(sh, 0x14CD);
    yield* T.scriptShowText(sh, 0x02);
    yield* Ls.awardExpPlain(sh, withBonus(w, 0x0028));            // 33:7427 ... 33:7CB7
    Ls.saveReturnPoint(w, 0x00, 0xFA);                            // 0A:4D5B
    saveGame(w);                                                  // 02:4489
    wr(w, 0xC441, 0x0F);
    return;
  }
  if (!flag(w, 199)) {
    T.scriptSetText(w, 0x14C7);
    yield* T.scriptShowText(sh, 0x80);
    yield* guardianComesOver(sh);
    yield* T.scriptShowText(sh, 0x02);
    setFlag(w, 199);
    S.actorLockSpriteFacing(w, 0x02, 0x01);
    S.actorMoveDir(w, 0x02, 0xC0, 0x0300);
    yield* S.waitActorMoveDone(sh, 0x02);
    S.actorLockSpriteFacing(w, 0x02, 0x00);
    return;
  }
  T.scriptSetText(w, 0x14CA);                                     // 33:74C8
  yield* T.scriptShowText(sh, 0x80);
  yield* guardianComesOver(sh);
  yield* wait(sh, 0x3C);
  S.actorJump(w, 0x02, 0xFF80);
  yield* S.waitActorLanded(sh, 0x02);
  yield* T.scriptShowText(sh, 0x02);
  yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
  yield* S.waitScriptActorIdle(sh);
  yield* wait(sh, 0x1E);
}
// 33:755B Map26SecondTargetResult: with #213, without #201, wStoryRoundKind $0A: the player faces the guardian, fade
// in (4); target 1 passed: $14D9 (33:758E), 180 EXP (a quarter more with #99), #201, AddExp, $011B (speaker $80; no
// sound or jingle wait here), 33:7CB7, the return point (map 0, $FA), SaveGame, warp $0E; failed: $14D8 (33:75F1);
// targets 2 / 3 (33:7612): $14D7 set but not shown, the guardian comes over, 30 frames, hops, the text, back
function* map26SecondTargetResult(sh) {
  const w = sh.w;
  if (!flag(w, 213) || flag(w, 201) || rd(w, 0xC967) !== 0x0A) return;
  S.actorFaceActor(w, 0x00, 0x02);
  Scr.beginFadeIn(w, 0x04);
  yield* Scr.waitFade(sh);
  if (rd(w, 0xC4BC) === 0x01) {
    if (rd(w, 0xC3E0) !== 0x01) { yield* guardianFailText(sh, 0x14D8); return; }
    yield* guardianCheers(sh, 0x14D9);
    const de = withBonus(w, 0x00B4);
    setFlag(w, 201);
    addExp(w, de);                                                // 02:5465
    pushTextNumberArg(w, de);                                     // 05:551F
    T.scriptSetText(w, 0x011B);
    yield* T.scriptShowText(sh, 0x80);
    Scr.beginFadeOut(w, 0x08);                                    // 33:7CB7 FadeToLevelUpScreenB
    yield* Scr.waitFade(sh);
    yield* inBankGen(w, 0x41, levelUpScreen(sh));                 // 41:402A
    Ls.saveReturnPoint(w, 0x00, 0xFA);
    saveGame(w);
    wr(w, 0xC441, 0x0E);
    return;
  }
  T.scriptSetText(w, 0x14D7);
  yield* guardianComesOver(sh);
  yield* guardianHopAndBack(sh);
}
// a question of the guru (speaker 2): shown, 10 and 5 frames, asked, closed, 5 frames: true for No
function* guruAsk(sh) {
  yield* T.scriptShowTextKeepOpen(sh, 0x02);
  yield* wait(sh, 0x0A);
  yield* wait(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  return a;
}
// 33:779F SwapShotCurve: #214, SetCharHand 02:53B2 (wCharFlags bit 0 flipped, CharRefreshStats 02:4EF6), the guru's
// animation 6, six flashes (fade out and in at speed $20)
function* swapShotCurve(sh) {
  const w = sh.w;
  setFlag(w, 214);
  wr(w, 0xC819, (rd(w, 0xC819) & 0xFE) | ((rd(w, 0xC819) & 0x01) ^ 0x01));
  charRefreshStats(w);
  S.actorPlayAnim(w, 0x02, 0x06);
  for (let k = 0; k < 6; k++) {
    Scr.beginFadeOut(w, 0x20);
    yield* Scr.waitFade(sh);
    Scr.beginFadeIn(w, 0x20);
    yield* Scr.waitFade(sh);
  }
}
// 33:7660 Map26GuruOfferSwap (entrance $0E): the banner's text cleared; $14DA with #224 (the hand), else $14DE, asked:
// No: its next part shown, then the next question; Yes: the next part skipped, the next question; that one No: $14E7;
// Yes: $14DD asked: No: $14E7; Yes: 33:779F, then $14E4 (#224) or $14E6
function* map26GuruOfferSwap(sh) {
  const w = sh.w;
  wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
  T.scriptSetText(w, flag(w, 224) ? 0x14DA : 0x14DE);
  if (yield* guruAsk(sh)) yield* T.scriptShowText(sh, 0x02);      // 33:76CE
  else T.scriptSkipText(w);
  if (!(yield* guruAsk(sh))) {
    T.scriptSetText(w, 0x14DD);                                   // 33:76D5
    if (!(yield* guruAsk(sh))) {
      yield* swapShotCurve(sh);
      T.scriptSetText(w, flag(w, 224) ? 0x14E4 : 0x14E6);
      yield* T.scriptShowText(sh, 0x02);
      return;
    }
  }
  T.scriptSetText(w, 0x14E7);                                     // 33:76C2
  yield* T.scriptShowText(sh, 0x02);
}
// 33:771A Map26GuruRevisit: switched before (#214): $14E8; else $14E2 asked: No $14E7; Yes: $14E3 (#224) / $14E5
// asked: No $14E7; Yes: 33:779F and the text's next part
function* map26GuruRevisit(sh) {
  const w = sh.w;
  if (flag(w, 214)) { T.scriptSetText(w, 0x14E8); yield* T.scriptShowText(sh, 0x02); return; }
  T.scriptSetText(w, 0x14E2);
  if (!(yield* guruAsk(sh))) {
    T.scriptSetText(w, flag(w, 224) ? 0x14E3 : 0x14E5);
    if (!(yield* guruAsk(sh))) {
      yield* swapShotCurve(sh);
      yield* T.scriptShowText(sh, 0x02);
      return;
    }
  }
  T.scriptSetText(w, 0x14E7);                                     // 33:7754
  yield* T.scriptShowText(sh, 0x02);
}
// 33:70B2 Map26TalkGuru (talk 2, the third entry): after #201 33:771A, else $14D5
function* map26TalkGuru(sh) {
  if (flag(sh.w, 201)) { yield* map26GuruRevisit(sh); return; }
  T.scriptSetText(sh.w, 0x14D5);
  yield* T.scriptShowText(sh, 0x02);
}
// 33:7184 Map26EnterWindyValley: #224 by the hand (33:7813); the guardian (actor 2) at ($2300, $1E00) before #199,
// put away while #198 is set and #213 clear; entrance $FA (back from a target shot): the banner's text cleared, the
// results 33:73BB and 33:755B; wStoryRoundKind 0; entrance $0F (33:71FA, the first target passed): without #114 #198,
// the return point and SaveGame, fade in, $14CF, the guardian (speed $0A, animation 5) walks off up to ($2300, $1900)
// (animation 6) and on to ($2300, $1500) while the screen fades out (4), warp 1; with #114 (33:7270) #198 #200 #212
// #213, the save, fade in, $14E9, animation 6, $14D5; entrance 3 (33:71D5, from the hut's guardian): #213, the
// guardian's animation $0A, fade in, $14D5; entrance $0E (33:72B2): fade in, the guru's offer 33:7660
function* map26Enter(sh) {
  const w = sh.w;
  setTempFlagFromHand(w);
  if (!flag(w, 199)) S.actorSetPos(w, 0x02, 0x2300, 0x1E00);
  if (!flag(w, 213) && flag(w, 198)) S.actorSetPos(w, 0x02, 0x3F00, 0x3F00);
  if (rd(w, 0xC46A) === 0xFA) {
    wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
    yield* map26FirstTargetResult(sh);
    yield* map26SecondTargetResult(sh);
  }
  wr(w, 0xC967, 0x00);
  const e = rd(w, 0xC46A);
  if (e === 0x0F) {
    wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
    if (flag(w, 114)) {
      for (const n of [198, 200, 212, 213]) setFlag(w, n);
      Ls.saveReturnPoint(w, 0x00, 0xFA);
      saveGame(w);
      Scr.beginFadeIn(w, 0x04);
      yield* Scr.waitFade(sh);
      T.scriptSetText(w, 0x14E9);
      yield* T.scriptShowText(sh, 0x02);
      S.actorPlayAnim(w, 0x02, 0x06);
      yield* S.waitActorAnimDone(sh, 0x02);
      T.scriptSetText(w, 0x14D5);
      yield* T.scriptShowText(sh, 0x02);
      return;
    }
    setFlag(w, 198);
    Ls.saveReturnPoint(w, 0x00, 0xFA);
    saveGame(w);
    Scr.beginFadeIn(w, 0x04);
    yield* Scr.waitFade(sh);
    T.scriptSetText(w, 0x14CF);
    yield* T.scriptShowText(sh, 0x02);
    S.actorSetSpeed(w, 0x02, 0x000A);
    S.actorPlayAnim(w, 0x02, 0x05);
    yield* S.waitActorAnimDone(sh, 0x02);
    yield* moveAndWait(sh, 0x02, 0x2300, 0x1900);
    S.actorPlayAnim(w, 0x02, 0x06);
    yield* S.waitActorAnimDone(sh, 0x02);
    S.actorMoveTo(w, 0x02, 0x2300, 0x1500);
    Scr.beginFadeOut(w, 0x04);
    yield* Scr.waitFade(sh);
    wr(w, 0xC441, 0x01);
  } else if (e === 0x03) {
    wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0);
    setFlag(w, 213);
    S.actorPlayAnim(w, 0x02, 0x0A);
    Scr.beginFadeIn(w, 0x04);
    yield* Scr.waitFade(sh);
    T.scriptSetText(w, 0x14D5);
    yield* T.scriptShowText(sh, 0x02);
  } else if (e === 0x0E) {
    Scr.beginFadeIn(w, 0x04);
    yield* Scr.waitFade(sh);
    yield* map26GuruOfferSwap(sh);
  }
}

// ---- map $08's tutors (talks $0C-$11, the list 33:4389): the golf dictionary (3F:4002) by category ----
// 33:4E74 TutorShowTextFromBase / 33:4E8C TutorShowTextFromBaseKeepOpen: text wScriptTextBase $C4BA + de by the
// speaker wScriptArg $C4BC, then 10 / 5 frames
function* tutorText(sh, de, keep) {
  const w = sh.w;
  T.scriptSetText(w, ((rd(w, 0xC4BA) | rd(w, 0xC4BB) << 8) + de) & 0xFFFF);
  if (keep) yield* T.scriptShowTextKeepOpen(sh, rd(w, 0xC4BC));
  else yield* T.scriptShowText(sh, rd(w, 0xC4BC));
  yield* wait(sh, keep ? 0x05 : 0x0A);
}
// 33:4DFF Map08TutorAskDictionary: the question (base + 0) and Yes / No; No: base + 1; Yes: fade out, the dictionary
// in mode wScriptArg - $0C (33:4E1C), then the map again where the player stood (warp $FA, wPlayerPosSave $C2A0)
function* map08TutorAskDictionary(sh) {
  const w = sh.w;
  yield* tutorText(sh, 0, true);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) { yield* tutorText(sh, 1, false); return; }
  yield* map08TutorDictionary(sh);
}
// 33:4E1C: fade out, the dictionary in mode wScriptArg - $0C (3F:4002), then the map again where the player stood (warp
// $FA, wPlayerPosSave $C2A0)
function* map08TutorDictionary(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* inBankGen(w, 0x3F, golfDictionary(sh, (rd(w, 0xC4BC) - 0x0C) & 0xFF));
  wr(w, 0xC441, 0xFA);                           // wMapWarpRequest
  wr(w, 0xC46A, 0xFA);                           // wMapEntrance
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));
  wr(w, 0xC465, rd(w, 0xC2A4));
}
// 33:4E49 Map08TutorAskKeepChecking (unreferenced): fade in (8); "Keep checking?" ($087D) kept open by the speaker
// wScriptArg; 5 frames; Yes / No; closed; 5 frames; Yes: the dictionary again (33:4E1C); No (or B): it falls into
// 33:4E74 TutorShowTextFromBase with the de it was entered with, kept by every routine on the way (from
// Map08TalkTutor*: the text base, so text base x 2: $10AE for the lingo tutor)
function* map08TutorAskKeepChecking(sh, de) {
  const w = sh.w;
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  T.scriptSetText(w, 0x087D);
  yield* T.scriptShowTextKeepOpen(sh, rd(w, 0xC4BC));
  yield* wait(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (!a) { yield* map08TutorDictionary(sh); return; }
  yield* tutorText(sh, de, false);
}
// 33:42AB / 42BD / 42CF / 42E1 / 42F3 / 4305 Map08Talk*Tutor: the text base and the speaker (= the talk $0C-$11)
function* map08TalkTutor(sh, base, arg) {
  const w = sh.w;
  wr(w, 0xC4BA, base & 0xFF); wr(w, 0xC4BB, base >> 8);
  wr(w, 0xC4BC, arg);
  // (w.keepCheckingPatch: a test's patch of the call in 33:42B9 to 33:4E49, entered with de = the text base)
  if (w.keepCheckingPatch) yield* map08TutorAskKeepChecking(sh, base);
  else yield* map08TutorAskDictionary(sh);
}

export const HOOKS = {
  "33:738f": function* () {},                     // 33:738F Map26TargetShotShotSetup: ret
  "33:7390": map26TargetAfterShot,
};

export const SCRIPTS = {
  "33:4722": map08Enter,
  // (sh.w.placeGolfersPatch: a test's patch of map $08's trigger 1 word, 33:459A, to 33:4BA7)
  "33:4bd3": sh => (sh.w.placeGolfersPatch ? map08PlaceGolfersThenCallOver(sh) : map08TriggerCallOver(sh)),
  "33:4ba7": map08PlaceGolfersThenCallOver,
  "33:48ec": map08TalkCaddieMasterB,
  "33:48ef": map08TalkCaddieMaster,
  "33:4317": sh => map08TalkGolfer(sh, 0x08B7, 0x02),
  "33:4329": sh => map08TalkGolfer(sh, 0x08C9, 0x03),
  "33:433b": sh => map08TalkGolfer(sh, 0x08DB, 0x04),
  "33:434d": sh => map08TalkGolfer(sh, 0x08ED, 0x05),
  "33:435f": map08TalkLevelAdvisor,
  "33:42ab": sh => map08TalkTutor(sh, 0x0857, 0x0C),   // the lingo (dictionary mode 0)
  "33:42bd": sh => map08TalkTutor(sh, 0x085E, 0x0D),   // the rules (1)
  "33:42cf": sh => map08TalkTutor(sh, 0x0865, 0x0E),   // the equipment (2)
  "33:42e1": sh => map08TalkTutor(sh, 0x086C, 0x0F),   // the techniques (3)
  "33:42f3": sh => map08TalkTutor(sh, 0x0873, 0x10),   // the facilities (4)
  "33:4305": sh => map08TalkTutor(sh, 0x087A, 0x11),   // how to look words up (5: all, the category hints)
  "33:443b": sh => map08Sign(sh, 0x08B3),
  "33:4447": sh => map08Sign(sh, 0x08B4),
  "33:4453": sh => map08Sign(sh, 0x08B5),
  "33:445f": map08ObjectHiddenFriend,
  "33:44f1": sh => map08TriggerExit(sh, 0x2520, 0x02),
  "33:451b": sh => map08TriggerExit(sh, 0x3520, 0x03),
  "33:4545": map08TriggerExitDown,
  "33:45c7": map08TriggerStepBack,
  "33:588f": map1CEnter,
  "33:5737": map1CTalkBobomb,
  "33:5729": map1CTalkBobombJump,
  "33:57a6": map1CWalkToBobomb,
  "33:5876": map1CTriggerExit,
  "33:5f42": map1DEnter,
  "33:5f25": map1DTriggerExit,
  "33:5bd1": map1DGoBackDown,
  "33:5c4d": map1DTalkPeach,
  "33:5c01": map1DTalkPeachWalk,
  "33:5cb0": sh => map1DTalkAfter117(sh, 0x145A, 0x07),
  "33:5d51": sh => map1DTalkAfter117(sh, 0x1464, 0x05),
  "33:5d65": sh => map1DTalkAfter117(sh, 0x1466, 0x04),
  "33:5d79": sh => map1DTalkAfter117(sh, 0x1468, 0x05),
  "33:5cc4": map1DTalkLuigi,
  "33:5cf0": function* (sh) { T.scriptSetText(sh.w, 0x145C); yield* T.scriptShowText(sh, 0x09); },   // 33:5CF0 the baby
  "33:5cfc": map1DTalkDK,
  "33:5d0e": sh => map1DTalkYoshi(sh, 0x83),
  "33:5d1c": sh => map1DTalkYoshi(sh, 0x81),
  "33:5d2a": map1DTalkBowser,
  "33:5ee5": map1DObjectCastleDoor,
  "33:5d8d": map1DTalkToad,
  "33:6f47": map1DObject1UpMushroom,
  "33:795c": map2EEnter,
  "33:7882": map2ETalkClubMaker,
  "33:78b6": map2ETalkGuardian,
  "33:7b6b": map2EObject1UpMushroom,
  "33:791c": map2ETriggerLeave,
  "33:7945": map2ETriggerExit2,
  "33:7184": map26Enter,
  "33:701f": map26TalkGuardianA,
  "33:705d": map26TalkGuardianB,
  "33:70b2": map26TalkGuru,
  "33:70e1": function* (sh) { sh.sound(0x9E); yield* map26LockedText(sh); },   // 33:70E1 Map26ObjectLockedDoor
  "33:70f8": sh => map26TriggerTarget(sh, 0x01),
  "33:7109": sh => map26TriggerTarget(sh, 0x02),
  "33:710d": sh => map26TriggerTarget(sh, 0x03),
  "33:7116": map26TriggerDoor,
  "33:713e": map26TriggerLeave,
};
export const TASKS = () => ({});

// 33:4929 Map08CaddieMasterOldRoundDialog (dead: 33:491B jumps over it to 33:5166): an older dialog. A question
// (ShowTextKeepOpen 6, 10 frames, AskYesNo, CloseText, 5 frames) is `ask`; returns its answer (0 Yes)
function* oldAsk(sh, keepWait = true) {
  yield* T.scriptShowTextKeepOpen(sh, 0x06);
  if (keepWait) yield* wait(sh, 0x0A);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  return a;
}
// not qualified (#227 clear): base + 1 asked: No: its next text, done; Yes: that text skipped, the one after shown, the
// walk out (33:50BB). Qualified: base + 1 asked: No: the next text; Yes: base + $0A, the round's start scene (33:5257),
// the round menu (33:5166), then a question (the text where the cursor is): No: the next text; Yes: base + 6, then
// 33:49C4 (not qualified: asked: No: the club index, its text, the player's animation 7; Yes: 33:49F6) or 33:4A68
// (qualified). 33:49F6: #224; not qualified: #244, base + 8 asked: Yes: base + 3, the walk out; No (33:4A2A): #224
// cleared, base + 2. Qualified (33:4A39): #224 #244, base + 9 asked: No: 33:4A2A; Yes: base + $0A, #224, then 33:4A68:
// base + $0B asked (no wait first: as the code has it, with one): No: the next text, then asked again (Yes: 33:49F6;
// No: base + 5); Yes: the next text skipped, the one after shown, and on into 33:4ABB (the partner's talk)
function* map08OldRoundDialog(sh) {
  const w = sh.w;
  setTextFromBase(w, 0x0001);
  if (!flag(w, 227)) {
    const a = yield* oldAsk(sh);
    if (a) { yield* T.scriptShowText(sh, 0x06); return; }
    T.scriptSkipText(w);
    yield* T.scriptShowText(sh, 0x06);
    yield* walkOutToPractice(sh);
    return;
  }
  let a = yield* oldAsk(sh);
  if (a) { yield* T.scriptShowText(sh, 0x06); return; }
  setTextFromBase(w, 0x000A);                                     // 33:498A
  yield* T.scriptShowText(sh, 0x06);
  yield* clubRoundStartScene(sh);
  yield* map08RoundMenu(sh);
  yield* wait(sh, 0x0A);
  a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* wait(sh, 0x05);
  if (a) { yield* T.scriptShowText(sh, 0x06); return; }
  setTextFromBase(w, 0x0006);                                     // 33:49B8
  let at = flag(w, 227) ? "4A68" : "49C4";
  for (;;) {
    if (at === "49C4") {
      a = yield* oldAsk(sh);
      if (a) {
        setTextClubIndex(w);
        yield* T.scriptShowText(sh, 0x06);
        S.actorPlayAnim(w, 0x00, 0x07);
        yield* S.waitActorAnimDone(sh, 0x00);
        return;
      }
      at = "49F6";
    }
    if (at === "49F6") {
      setFlag(w, 224);
      if (flag(w, 227)) at = "4A39";
      else {
        setFlag(w, 244);
        setTextFromBase(w, 0x0008);
        a = yield* oldAsk(sh, false);
        if (a) { at = "4A2A"; }
        else { setTextFromBase(w, 0x0003); yield* T.scriptShowText(sh, 0x06); yield* walkOutToPractice(sh); return; }
      }
    }
    if (at === "4A2A") { clearFlag(w, 224); setTextFromBase(w, 0x0002); yield* T.scriptShowText(sh, 0x06); return; }
    if (at === "4A39") {
      setFlag(w, 224); setFlag(w, 244);
      setTextFromBase(w, 0x0009);
      a = yield* oldAsk(sh, false);
      if (a) { at = "4A2A"; continue; }
      setTextFromBase(w, 0x000A);
      yield* T.scriptShowText(sh, 0x06);
      setFlag(w, 224);
      at = "4A68";
    }
    if (at === "4A68") {
      setTextFromBase(w, 0x000B);
      a = yield* oldAsk(sh);
      if (!a) { T.scriptSkipText(w); yield* T.scriptShowText(sh, 0x06); yield* talkWithPartner(sh); return; }
      a = yield* oldAsk(sh);
      if (!a) { at = "49F6"; continue; }
      setTextFromBase(w, 0x0005);
      yield* T.scriptShowText(sh, 0x06);
      return;
    }
  }
}

// 33:4BA7 Map08PlaceGolfersThenCallOver (unreferenced): actors 2-5 placed in a row at y $0D80 (x $1500 / $1700 /
// $1B00 / $1900, 0A:43C6), then on into 33:4BD3 Map08TriggerCallOver
function* map08PlaceGolfersThenCallOver(sh) {
  const w = sh.w;
  for (const [a, x] of [[0x02, 0x1500], [0x03, 0x1700], [0x04, 0x1B00], [0x05, 0x1900]]) S.actorSetPos(w, a, x, 0x0D80);
  yield* map08TriggerCallOver(sh);
}

// Bank 32's map scripts (REVERSE.md "Bank 32"): map $00 (the mode select), map $05 (the Director's Room) ...
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import { modeSelectMain } from "../modesel.js";
import { rb } from "../rom.js";
import { registerFrameTask, unregisterFrameTask } from "../tasks.js";
import { mapBufCopyRectRedraw } from "../mapgfx.js";
import { advanceRandomSeed } from "../round.js";
import { addExp, expToNextLevel } from "../exp.js";
import { levelUpScreen } from "../levelup.js";
import { setTextCourseIndex } from "../text.js";
import * as A from "../actors.js";

const rd = D.rd, wr = D.wr;
function notPorted(what) { throw new Error(`${what} is not ported`); }
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));

// 32:5033 Map00EnterModeSelect: ModeSelectMain 32:5037 (modesel.js)
function* map00EnterModeSelect(sh) { return yield* modeSelectMain(sh); }

// 32:71CF Map05EnterDirectorsRoom: entrance 2 (the first day, after the new character's creation): the director
// pro (actor 2), the Caddie Master (3) and the coach (4) introduce themselves (texts $487-$48F), then warp 2 (map
// $00 entrance 2: the mode select); the other entrances (~32:7461: the talk lists by progress) are not ported
function* map05EnterDirectorsRoom(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) !== 2) { yield* map05EnterRegular(sh); return; }
  T.scriptSetText(w, 0x0487);                                     // 32:71DA
  M.scriptRespawnActors(w, 0x32, 0x6F08);                         // 32:71E2
  S.actorSetSpeed(w, 0x02, 0x0010);                               // 32:71EA
  S.actorSetSpeed(w, 0x03, 0x0010);                               // 32:71F2
  S.actorSetSpeed(w, 0x04, 0x0010);                               // 32:71FA
  Scr.beginFadeIn(w, 0x08);                                       // 32:71FF
  yield* Scr.waitFade(sh);                                        // 32:7202
  yield* S.scriptWaitFrames(sh, 0x28);                            // 32:7208
  S.actorPlayAnim(w, 0x02, 0x07);                                 // 32:7211
  yield* S.waitActorAnimDone(sh, 0x02);                           // 32:7216
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:721C
  yield* T.scriptShowText(sh, 0x02);                              // 32:7222
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7228
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 32:7231
  yield* S.waitActorAnimDone(sh, 0x02);                           // 32:7236
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:723C
  yield* T.scriptShowText(sh, 0x02);                              // 32:7242
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7248
  S.actorSetFacing(w, 0x02, 0x80);                                // 32:7250
  yield* S.scriptWaitFrames(sh, 0x14);                            // 32:7256
  S.actorSetFacing(w, 0x03, 0x00);                                // 32:725E
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7264
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 32:726D
  yield* S.waitActorAnimDone(sh, 0x03);                           // 32:7272
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7278
  S.actorSetFacing(w, 0x02, 0x40);                                // 32:7280
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7286
  S.actorSetFacing(w, 0x03, 0x40);                                // 32:728E
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7294
  S.actorMoveDir(w, 0x03, 0x40, 0x0200);                          // 32:729F
  yield* S.waitActorMoveDone(sh, 0x03);                           // 32:72A4
  yield* T.scriptShowText(sh, 0x03);                              // 32:72A9
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:72AF
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:72B6
  S.actorSetFacing(w, 0x03, 0xC0);                                // 32:72BE
  yield* S.scriptWaitFrames(sh, 0x14);                            // 32:72C4
  S.actorPlayAnim(w, 0x03, 0x07);                                 // 32:72CD
  yield* S.waitActorAnimDone(sh, 0x03);                           // 32:72D2
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:72D8
  yield* T.scriptShowText(sh, 0x03);                              // 32:72DE
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:72E4
  S.actorSetFacing(w, 0x03, 0x40);                                // 32:72EC
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:72F2
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 32:72FB
  yield* S.waitActorAnimDone(sh, 0x03);                           // 32:7300
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7306
  yield* T.scriptShowText(sh, 0x03);                              // 32:730C
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7312
  S.actorSetFacing(w, 0x03, 0x40);                                // 32:731A
  S.actorMoveDir(w, 0x04, 0x40, 0x0200);                          // 32:7324
  yield* S.waitActorMoveDone(sh, 0x04);                           // 32:7329
  S.actorPlayAnim(w, 0x04, 0x05);                                 // 32:7331
  yield* S.waitActorAnimDone(sh, 0x04);                           // 32:7336
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:733C
  yield* T.scriptShowText(sh, 0x04);                              // 32:7342
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7348
  S.actorMoveDir(w, 0x02, 0x40, 0x0200);                          // 32:7353
  yield* S.waitActorMoveDone(sh, 0x02);                           // 32:7358
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 32:735E
  S.actorSetFacing(w, 0x02, 0x00);                                // 32:7366
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 32:736C
  S.actorSetFacing(w, 0x04, 0x80);                                // 32:7374
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 32:737A
  S.actorSetFacing(w, 0x02, 0x80);                                // 32:7382
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 32:7388
  S.actorSetFacing(w, 0x03, 0x00);                                // 32:7390
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 32:7396
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 32:739F
  yield* S.waitActorAnimDone(sh, 0x02);                           // 32:73A4
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:73AA
  yield* T.scriptShowText(sh, 0x02);                              // 32:73B0
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:73B6
  S.actorPlayAnim(w, 0x03, 0x05);                                 // 32:73BF
  yield* S.waitActorAnimDone(sh, 0x03);                           // 32:73C4
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:73CA
  S.actorSetFacing(w, 0x02, 0x00);                                // 32:73D2
  yield* S.scriptWaitFrames(sh, 0x14);                            // 32:73D8
  S.actorPlayAnim(w, 0x04, 0x05);                                 // 32:73E1
  yield* S.waitActorAnimDone(sh, 0x04);                           // 32:73E6
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:73EC
  S.actorSetFacing(w, 0x03, 0x40);                                // 32:73F4
  S.actorSetFacing(w, 0x04, 0x40);                                // 32:73FB
  S.actorSetFacing(w, 0x02, 0x40);                                // 32:7402
  yield* S.scriptWaitFrames(sh, 0x14);                            // 32:7408
  S.actorPlayAnim(w, 0x02, 0x07);                                 // 32:7411
  yield* S.waitActorAnimDone(sh, 0x02);                           // 32:7416
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:741C
  yield* T.scriptShowText(sh, 0x02);                              // 32:7422
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7428
  S.actorPlayAnim(w, 0x02, 0x05);                                 // 32:7431
  yield* S.waitActorAnimDone(sh, 0x02);                           // 32:7436
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:743C
  yield* T.scriptShowText(sh, 0x02);                              // 32:7442
  yield* S.scriptWaitFrames(sh, 0x0A);                            // 32:7448
  Scr.beginFadeOut(w, 0x04);                                      // 32:744E
  yield* Scr.waitFade(sh);                                        // 32:7451
  yield* S.scriptWaitFrames(sh, 0x1E);                            // 32:7457
  wr(w, 0xC441, 0x02);                                            // 32:745D
}

// 32:5E07 Map03EnterClubhouse: wStoryRoundKind $C967 = 0; entrance 1 after beating Mario (#117, not yet #120):
// warp $0E; the talk list (+6) by progress (#139, #115, #114, #113, #112: 32:5B09 5A4C 59C7 5928 5853; with #115 or
// #114 actor 9 gets the script 32:7E19); entrances 3-7 come out of doors 1-5 (~32:5D94 Map03WalkOutOfDoor: not
// ported yet)
function* map03EnterClubhouse(sh) {
  const w = sh.w;
  wr(w, 0xC967, 0x00);
  const ent = rd(w, 0xC46A);
  if (ent === 1 && flag(w, 117) && !flag(w, 120)) { wr(w, 0xC441, 0x0E); return; }
  if (flag(w, 139)) M.scriptSetMapField(w, 0x5B09, 0x000C);
  else if (flag(w, 115)) { M.scriptSetMapField(w, 0x5A4C, 0x000C); S.actorSetScript(w, 0x09, 0x7E19, 0x32); }
  else if (flag(w, 114)) { M.scriptSetMapField(w, 0x59C7, 0x000C); S.actorSetScript(w, 0x09, 0x7E19, 0x32); }
  else if (flag(w, 113)) M.scriptSetMapField(w, 0x5928, 0x000C);
  else if (flag(w, 112)) M.scriptSetMapField(w, 0x5853, 0x000C);
  if (ent >= 3 && ent <= 7) yield* map03WalkOutOfDoor(sh, ent - 3);   // 32:5DD5 / 5DDF / 5DE9 / 5DF3 / 5DFD
}
// Map 3's five doors (to the offices and rooms): the door tiles' rectangle (x d, y e, h wide, 2 tall) copied from
// the open / closed frames in the buffers at (b, row c): 4 frames each way, 3 frames apart (0B:4864)
const M03_DOORS = [                              // [d, e, h, c, step]
  [0x06, 0x04, 0x02, 0x3C, 2], [0x04, 0x12, 0x02, 0x3C, 2], [0x08, 0x12, 0x02, 0x3C, 2],
  [0x2C, 0x04, 0x04, 0x3E, 4], [0x2C, 0x12, 0x02, 0x3C, 2]];
function* doorFrames(sh, door, frames) {
  const [d, e, h, c, step] = M03_DOORS[door];
  for (const k of frames) {
    yield* inBankGen(sh.w, 0x0B, mapBufCopyRectRedraw(sh, k * step, c, d, e, h, 0x02));
    yield* S.scriptWaitFrames(sh, 0x03);
  }
}
// 32:5EF5 / 5FBE / 6087 / 6150 / 6219 Map03DoorOpenAnim1-5; 32:5F4E / 6017 / 60E0 / 61A9 / 6272 Map03DoorSetOpen1-5;
// 32:5F65 / 602E / 60F7 / 61C0 / 6289 Map03DoorCloseAnim1-5
const map03DoorOpenAnim = (sh, n) => doorFrames(sh, n, [1, 2, 3, 4]);
const map03DoorSetOpen = (sh, n) => doorFrames(sh, n, [4]);
const map03DoorCloseAnim = (sh, n) => doorFrames(sh, n, [3, 2, 1, 0]);
// 32:5D94 Map03WalkOutOfDoor: the door open, the player (and the partner) walk 2 tiles down (speed $0A), fade in, the
// door closes, the player's walk awaited
function* map03WalkOutOfDoor(sh, n) {
  const w = sh.w;
  yield* map03DoorSetOpen(sh, n);                // (00:0699 JumpToHL)
  S.actorSetSpeed(w, 0x00, 0x000A);
  S.actorMoveDir(w, 0x00, 0x40, 0x0200);
  const p = rd(w, 0xC298);
  if (p !== 0xFF) { S.actorSetSpeed(w, p, 0x000A); S.actorMoveDir(w, p, 0x40, 0x0200); }
  Scr.beginFadeIn(w, 0x08);
  yield* Scr.waitFade(sh);
  yield* map03DoorCloseAnim(sh, n);
  yield* S.waitActorMoveDone(sh, 0x00);
}
// 32:5CAF / 5CCF / 5CEF / 5D0F / 5D2F Map03TriggerDoor1-5 (triggers 3-7): the player steps up 2 tiles at speed 8,
// the door opens, warp 3-7 (sound $92)
function* map03TriggerDoor(sh, n) {
  const w = sh.w;
  yield* S.waitScriptActorIdle(sh);
  S.actorSetSpeed(w, 0x00, 0x0008);
  S.actorMoveDir(w, 0x00, 0xC0, 0x0200);
  yield* map03DoorOpenAnim(sh, n);
  wr(w, 0xC441, n + 3);
  sh.sound(0x92);
}
// 32:5C09 Map03TriggerExitToMap (trigger 2): warp 2 (sound $92), a fade out and 30 frames
function* map03TriggerExitToMap(sh) {
  const w = sh.w;
  wr(w, 0xC441, 0x02);
  sh.sound(0x92);
  Scr.beginFadeOut(w, 0x08);
  yield* S.scriptWaitFrames(sh, 0x1E);
}
// 32:5C25 Map03TriggerGoingOutside (trigger 1): plain warp 1 (32:5C1D) unless the Links Club is won (#139) and
// neither #149 nor #127: then a member walks up: "Going outside?" ($1CE): Yes: #149, warp 1; No: the player is
// walked back in
function* map03TriggerGoingOutside(sh) {
  const w = sh.w;
  if (!flag(w, 139) || flag(w, 149) || flag(w, 127)) { wr(w, 0xC441, 0x01); sh.sound(0x92); return; }
  T.scriptSetText(w, 0x01CE);
  S.actorSetFacing(w, 0x0A, 0x40);
  S.scriptActorSetSpeed(w, 0x0040);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1900, 0x1D00);
  yield* S.waitScriptActorIdle(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  yield* T.scriptShowTextKeepOpen(sh, 0x0A);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (!a) {
    setFlag(w, 149);
    yield* T.scriptShowText(sh, 0x0A);
    yield* S.scriptWaitFrames(sh, 0x0A);
    wr(w, 0xC441, 0x01);
    sh.sound(0x92);
    return;
  }
  T.scriptSkipText(w);
  yield* T.scriptShowText(sh, 0x0A);
  yield* S.scriptActorGoTo(sh, 0x00, 0x1A00, 0x2500);
  S.actorMoveTo(w, 0x00, 0x1A00, 0x2500);
  yield* S.waitActorMoveDone(sh, 0x00);
  yield* S.waitScriptActorIdle(sh);
}
// 32:62F7 HasPartner: a partner flag #144-#147
const hasPartner = w => [144, 145, 146, 147].some(n => flag(w, n));
// 32:5BBE SetTextCourseByProgress: SetTextCourseIndex 05:57C3 = 5 (#139), 4 (#115 or #114), 3 (#113), else 2
function setTextCourseByProgress(w) {
  setTextCourseIndex(w, flag(w, 139) ? 5 : flag(w, 115) || flag(w, 114) ? 4 : flag(w, 113) ? 3 : 2);
}
// 32:5B5A SetTextByClubProgress: the text hl + n by the partner and its club: the Links champ (#147) 9 after the
// Links win (#139) else 8; Dune (#146) 7 / 6 (#138); Palm (#145) 5 (#137), 4 (#114), 3 (#113), 2; Marion (#144) 1
// (#136) / 0; none 0; then 32:5BBE
function setTextByClubProgress(w, hl) {
  let a = 0;
  if (flag(w, 147)) a = flag(w, 139) ? 9 : 8;
  else if (flag(w, 146)) a = flag(w, 138) ? 7 : 6;
  else if (flag(w, 145)) a = flag(w, 137) ? 5 : flag(w, 114) ? 4 : flag(w, 113) ? 3 : 2;
  else if (flag(w, 144)) a = flag(w, 136) ? 1 : 0;
  T.scriptSetText(w, (hl + a) & 0xFFFF);
  setTextCourseByProgress(w);
}
// 32:56EA Map03TalkMemberCounter / 32:5704 Map03TalkVisitorCounter (talks 2 / 3): text $16B / $16C by the speaker;
// with a partner $1D1 / $1DB + its progress (32:5B5A)
function* map03TalkCounter(sh, speaker) {
  const w = sh.w;
  if (hasPartner(w)) setTextByClubProgress(w, speaker === 2 ? 0x01D1 : 0x01DB);
  else T.scriptSetText(w, speaker === 2 ? 0x016B : 0x016C);
  yield* T.scriptShowText(sh, speaker);
}
// 32:5BEA Map03ObjectBookshelf (object 2): one of the texts $1E5-$1E8 at random (00:0A61's low byte & 3)
function* map03ObjectBookshelf(sh) {
  const w = sh.w;
  const r = advanceRandomSeed(w) & 3;
  T.scriptSetText(w, 0x01E5 + r);
  yield* T.scriptShowText(sh, 0xFF);
}

// 32:7461 (Map05EnterDirectorsRoom, entrances other than 2): no name banner but for entrance 1; after beating Mario
// (#117) the staff (32:6F35) and the talk list 32:712F, and once (not #120) the cover-up scene (~32:7533, not ported)
// and warp 1; else the talk list by progress (#127 #139 #115 #138 #114 #137 #113 #136 #112: 32:710E ... 32:7006; the
// first two with the staff respawned)
function* map05EnterRegular(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) !== 1) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  if (flag(w, 117)) {
    M.scriptRespawnActors(w, 0x32, 0x6F35);
    M.scriptSetMapField(w, 0x712F, 0x000C);
    if (flag(w, 120)) return;
    notPorted("the Director's cover-up scene (~32:7533 Map05BeatMarioCoverUpScene)");
  }
  if (flag(w, 127)) { M.scriptRespawnActors(w, 0x32, 0x6F35); M.scriptSetMapField(w, 0x710E, 0x000C); return; }
  if (flag(w, 139)) { M.scriptRespawnActors(w, 0x32, 0x6F35); M.scriptSetMapField(w, 0x70ED, 0x000C); return; }
  for (const [n, hl] of [[115, 0x70CC], [138, 0x70AB], [114, 0x708A], [137, 0x7069], [113, 0x7048], [136, 0x7027],
    [112, 0x7006]]) if (flag(w, n)) { M.scriptSetMapField(w, hl, 0x000C); return; }
}
// 32:7156 Map05ObjectBookshelfA (object 2): text $806-$809 at random; 32:716C Map05ObjectBookshelfB (object 1): $80A-$80D
function* map05Bookshelf(sh, base) {
  const w = sh.w;
  T.scriptSetText(w, base + (advanceRandomSeed(w) & 3));
  yield* T.scriptShowText(sh, 0xFF);
}
// 32:71B4 Map05TriggerWindTip / 32:7E67 MapScriptNop
function* map05TriggerWindTip(sh) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptBegin(w));
  T.scriptSetText(w, 0x0172);
  yield* T.scriptShowText(sh, 0x00);
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
}
function* mapScriptNop() {}
// 32:7966 Map05Object1UpMushroom (object 4, once: flag #156): unless level 99 the EXP to the next level (02:5498,
// 02:5465), the mushroom (actor 6) pops up (sound $63, a jump), "got a 1-UP Mushroom!" ($C5F), the level-up screen
// (32:7EE7 FadeToLevelUpScreen), the map again at the saved position (warp $FA)
function* map05Object1UpMushroom(sh) {
  const w = sh.w;
  setFlag(w, 156);
  if (rd(w, 0xC812) === 0x63) return;
  addExp(w, expToNextLevel(w));
  S.actorSetPos(w, 0x06, 0x1900, 0x0300);
  sh.sound(0x63);
  S.actorJump(w, 0x06, 0xFF00);
  yield* S.waitActorLanded(sh, 0x06);
  yield* S.scriptWaitFrames(sh, 0x10);
  S.actorSetPos(w, 0x06, 0x3F00, 0x3F00);
  T.scriptSetText(w, 0x0C5F);
  yield* T.scriptShowText(sh, 0x86);
  yield* fadeToLevelUpScreen(sh);
  wr(w, 0xC441, 0xFA); wr(w, 0xC46A, 0xFA);
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));   // 00:03D3 CopyMemoryBC
  wr(w, 0xC465, rd(w, 0xC2A4));
}
// 32:7EE7 FadeToLevelUpScreen
function* fadeToLevelUpScreen(sh) {
  Scr.beginFadeOut(sh.w, 0x08);
  yield* Scr.waitFade(sh);
  yield* inBankGen(sh.w, 0x41, levelUpScreen(sh));   // 41:402A
}

// 32:69B5 Map04EnterLounge: no name banner on a return ($FA); the champs following the player (partner flags
// #144-#147) hidden (actors 7-$0A to $3F00); the talk list by progress (#139 #115 #114 #113 #112: 32:65C2 6579 6530
// 64E7 649E; with #113 actor 4 gets the script 32:6A5C)
function* map04EnterLounge(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) === 0xFA) { wr(w, 0xC4B4, 0); wr(w, 0xC4B5, 0); }
  for (let k = 0; k < 4; k++) if (flag(w, 144 + k)) S.actorSetPos(w, 0x07 + k, 0x3F00, 0x3F00);
  if (flag(w, 139)) M.scriptSetMapField(w, 0x65C2, 0x000C);
  else if (flag(w, 115)) M.scriptSetMapField(w, 0x6579, 0x000C);
  else if (flag(w, 114)) M.scriptSetMapField(w, 0x6530, 0x000C);
  else if (flag(w, 113)) { M.scriptSetMapField(w, 0x64E7, 0x000C); S.actorSetScript(w, 0x04, 0x6A5C, 0x32); }
  else if (flag(w, 112)) M.scriptSetMapField(w, 0x649E, 0x000C);
}
// ---- the Lounge's club champions (talks 7-$0A) and a champion joining as the partner ----
// the champ's text base wScriptTextBase $C4BA and slot wScriptArg $C4BC (7-$0A: Marion, Palm, Dune, Links)
const champArg = w => rd(w, 0xC4BC);
const champText = (w, de) => ((rd(w, 0xC4BA) | rd(w, 0xC4BB) << 8) + de) & 0xFFFF;
const champFlag = (w, de) => flag(w, de + champArg(w) - 7);              // 32:6B2F ChampTestFlag
const champFlag2 = (w, de) => flag(w, de + 2 * (champArg(w) - 7));       // 32:6B57 ChampTestFlag2
const champSetFlag = (w, de) => setFlag(w, de + champArg(w) - 7);        // 32:6B43 ChampSetFlag
// 32:6AFF ChampShowTextAt: the text base + de by the champ, 10 frames
function* champSay(sh, de) {
  T.scriptSetText(sh.w, champText(sh.w, de));
  yield* T.scriptShowText(sh, champArg(sh.w));
  yield* S.scriptWaitFrames(sh, 0x0A);
}
// 32:6B17 ChampShowTextKeepOpen (5 frames), then the question (Yes: true), closed, 10 frames
function* champAsk(sh, de) {
  T.scriptSetText(sh.w, champText(sh.w, de));
  yield* T.scriptShowTextKeepOpen(sh, champArg(sh.w));
  yield* S.scriptWaitFrames(sh, 0x05);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x0A);
  return !a;
}
// the champ joins: the text, 32:6DCF, the partner flag (#144 +) and the asked flag (#128 +); (#118 cleared: clear)
function* champJoin(sh, de, clear) {
  const w = sh.w;
  yield* champSay(sh, de);
  yield* champJoinAsPartner(sh);
  champSetFlag(w, 0x90);
  champSetFlag(w, 0x80);
  if (clear) clearFlag(w, 118);
}
// 32:6B81 Map04TalkClubChamp (32:63A8 / 63BA / 63CC / 63DE: Marion $1FD, Palm $416, Dune $42F, Links $448 (the Links
// champ sets #131 first)): by the flags of the champ's club (de + slot - 7: #128 asked, #132 played, #136 won; the
// pairs #78 / #80 / #82 + 2 (slot - 7)) the texts +$11 / +$12 (not yet met: #78 pair clear but Marion), +$10 / +$0F /
// +$18 (the #80 pair set), or the offer: after the Links win (#139; the Links champ too): +$13 (won) or +$14, then
// +$15, the join with +$16 / +$09 (#118 cleared); else won: +$0A (unless asked) and +$0C, the join with +$0E; played
// (#132 +): +$05 (not for Palm and Links) and +$07, the join with +$09; else +$00 (unless asked) and +$02, the join with
// +$04; No answers +$0B / +$0D / +$17 / +$06 / +$08 / +$01 / +$03
function* map04TalkClubChamp(sh) {
  const w = sh.w, arg = champArg(w);
  if (arg !== 0x07 && !champFlag2(w, 0x4E)) { yield* champSay(sh, champFlag(w, 0x88) ? 0x12 : 0x11); return; }
  if (champFlag2(w, 0x50)) {
    if (champFlag(w, 0x88)) yield* champSay(sh, 0x10);
    else yield* champSay(sh, champFlag2(w, 0x52) ? 0x18 : 0x0F);
    return;
  }
  if (arg === 0x0A || !flag(w, 139)) {
    if (champFlag(w, 0x88)) {
      if (!champFlag(w, 0x80) && !(yield* champAsk(sh, 0x0A))) { yield* champSay(sh, 0x0B); return; }
      if (!(yield* champAsk(sh, 0x0C))) { yield* champSay(sh, 0x0D); return; }
      yield* champJoin(sh, 0x0E, false);
      return;
    }
    if (champFlag(w, 0x84)) {
      if (arg !== 0x08 && arg !== 0x0A && !(yield* champAsk(sh, 0x05))) { yield* champSay(sh, 0x06); return; }
      if (!(yield* champAsk(sh, 0x07))) { yield* champSay(sh, 0x08); return; }
      yield* champJoin(sh, 0x09, false);
      return;
    }
    if (!champFlag(w, 0x80) && !(yield* champAsk(sh, 0x00))) { yield* champSay(sh, 0x01); return; }
    if (!(yield* champAsk(sh, 0x02))) { yield* champSay(sh, 0x03); return; }
    yield* champJoin(sh, 0x04, false);
    return;
  }
  if (champFlag(w, 0x88)) {
    if (!(yield* champAsk(sh, 0x13))) { yield* champSay(sh, 0x0B); return; }
    if (!(yield* champAsk(sh, 0x15))) { yield* champSay(sh, 0x0D); return; }
    yield* champJoin(sh, 0x16, true);
    return;
  }
  if (!(yield* champAsk(sh, 0x14))) { yield* champSay(sh, 0x17); return; }
  if (!(yield* champAsk(sh, 0x15))) { yield* champSay(sh, 0x0D); return; }
  yield* champJoin(sh, 0x09, true);
}
// 32:6DCF Map04ChampJoinAsPartner: with the player facing left ($C0) the Palm champ (8) walks round the sofa by ($0500,
// $0700), ($0500, $0B00), ($0700, $0B00) and the Dune champ (9) by ($0F00, $0700), ($0F00, $0B00), ($0D00, $0B00) (their
// +$1A flags cleared first); sound $94; the champ follows the player (04:4525) as the partner: wPartnerSlot $C298,
// wPartnerActor $C294, wPartnerId $C299 = slot - 3
function* champJoinAsPartner(sh) {
  const w = sh.w, arg = champArg(w);
  D.setWramBank(w, 4);
  const pl = rd(w, 0xC290) | rd(w, 0xC291) << 8;
  if (rd(w, (pl + 0x10) & 0xFFFF) === 0xC0 && (arg === 0x08 || arg === 0x09)) {
    wr(w, (A.actorSlotAddr(arg) + 0x1A) & 0xFFFF, 0x00);
    const path = arg === 0x08 ? [[0x0500, 0x0700], [0x0500, 0x0B00], [0x0700, 0x0B00]] : [[0x0F00, 0x0700], [0x0F00, 0x0B00], [0x0D00, 0x0B00]];
    for (const [bc, de] of path) { S.actorMoveTo(w, arg, bc, de); yield* S.waitActorMoveDone(sh, arg); }
  }
  sh.sound(0x94);
  const hl = A.actorSlotAddr(arg);
  D.inBank(w, 0x04, () => A.actorStartFollow(w, hl, rd(w, 0xC290) | rd(w, 0xC291) << 8));
  wr(w, 0xC298, arg);
  const p = A.actorSlotAddr(rd(w, 0xC298));
  wr(w, 0xC294, p & 0xFF); wr(w, 0xC295, p >> 8);
  wr(w, 0xC299, (arg - 7 + 4) & 0xFF);
}
// 32:63A8 / 63BA / 63CC / 63DE: the champs' talks
function* champTalk(sh, base, slot) {
  const w = sh.w;
  if (slot === 0x0A) setFlag(w, 131);
  wr(w, 0xC4BA, base & 0xFF); wr(w, 0xC4BB, base >> 8);
  wr(w, 0xC4BC, slot);
  yield* map04TalkClubChamp(sh);
}
// 32:6AB6 Map04ChampArrowTask (32:6735): the pointing hand (tile $7C, the attribute of 32:6AA2's entry; bit 5: it
// bobs the other way) over the champ $C4B3 names (entry 0 is off screen), sound $90 every 16 frames while one is named
function map04ChampArrowTask(w) {
  const n = rd(w, 0xC4B3), fc = rd(w, 0xC4B2);
  if (n && !((fc >> 1) & 7)) w.sh.sound(0x90);
  const t = (0x6AA2 + ((n << 2) & 0xFF)) & 0xFFFF;
  const b = rb(0x32, t + 2);
  let o = (fc >> 1 | fc << 7) & 7;
  if (b & 0x20) o = ~o & 0xFF;
  const d = (o + rb(0x32, t)) & 0xFF;
  const e = (((fc >> 1 | fc << 7) & 7) + 8 + rb(0x32, t + 1)) & 0xFF;
  if (w.vram) D.queueSprite16(w, e, d, 0x7C, b);   // 00:26A4
}
// 32:6739 Map04TriggerChampIntro (trigger 1, once: flag #96; nothing with #189): a member (actor 6) introduces the
// Lounge; another (5) shows the player each Club Champ with the hand ($C4B3 1-4; texts $1F1-$1F4, or $1F9-$1FC for a
// club won) and asks if that was clear ($1F5): No: once more; Yes: the end
function* map04TriggerChampIntro(sh) {
  const w = sh.w;
  setFlag(w, 96);
  if (flag(w, 189)) return;
  wr(w, 0xC4B3, 0x00);
  D.inBank(w, 0x01, () => {                      // 01:4289 LoadCursorSprite: the hand's tiles -> $87C0, OBJ palette 0
    D.queueVRAMCopy(w, 0x5120, 0x87C0, 0x04);
    D.loadPalettesMasterOnly(w, 0x50E0, 0x08, 0x01);
  });
  D.restorePalettesFromMaster(w);                // 00:05DD
  D.inBank(w, 0x32, () => registerFrameTask(w, 0x0F, 0x32, 0x6735));
  T.scriptSetText(w, 0x01EE);
  S.scriptActorSetSpeed(w, 0x0040);
  S.actorSetFacing(w, 0x06, 0xC0);
  S.actorPlayAnim(w, 0x06, 0x07);
  yield* S.waitActorAnimDone(sh, 0x06);
  yield* S.scriptWaitFrames(sh, 0x0A);
  S.actorSetFacing(w, 0x00, 0x40);
  yield* T.scriptShowText(sh, 0x06);
  S.actorSetFacing(w, 0x05, 0xC0);
  S.actorPlayAnim(w, 0x05, 0x05);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* S.scriptWaitFrames(sh, 0x0A);
  S.actorMoveDir(w, 0x05, 0xC0, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x05);
  yield* S.scriptWaitFrames(sh, 0x0A);
  const allWon = () => flag(w, 136) && flag(w, 137) && flag(w, 138) && flag(w, 139);
  if (allWon()) T.scriptSkipText(w);
  yield* T.scriptShowText(sh, 0x05);
  yield* S.scriptWaitFrames(sh, 0x0A);
  for (;;) {                                     // 32:67E3
    yield* S.scriptActorGoTo(sh, 0x00, 0x0A00, 0x1040);
    yield* S.waitScriptActorIdle(sh);
    yield* S.scriptWaitFrames(sh, 0x14);
    S.actorSetFacing(w, 0x00, 0xC0);
    yield* S.scriptWaitFrames(sh, 0x14);
    for (const [k, id, won, actor] of [[1, 0x01F1, 139, 5], [2, 0x01F2, 138, 6], [3, 0x01F3, 137, 5], [4, 0x01F4, 136, 0]]) {
      wr(w, 0xC4B3, k);
      T.scriptSetText(w, id);
      if (flag(w, won)) T.scriptSetText(w, id + 8);
      yield* T.scriptShowText(sh, 0x86);
      wr(w, 0xC4B3, 0x00);
      yield* S.scriptWaitFrames(sh, 0x0A);
      if (!actor) break;
      S.actorPlayAnim(w, actor, 0x05);
      yield* S.waitActorAnimDone(sh, actor);
      yield* S.scriptWaitFrames(sh, 0x0A);
    }
    yield* S.scriptActorGoToActor(sh, 0x00, 0x00);
    yield* S.scriptWaitFrames(sh, 0x14);
    S.actorSetFacing(w, 0x00, 0x40);
    yield* S.scriptWaitFrames(sh, 0x0A);
    S.actorPlayAnim(w, 0x06, 0x05);
    yield* S.waitActorAnimDone(sh, 0x06);
    yield* S.scriptWaitFrames(sh, 0x0A);
    T.scriptSetText(w, 0x01F5);
    yield* T.scriptShowTextKeepOpen(sh, 0x06);
    yield* S.scriptWaitFrames(sh, 0x0A);
    const a = yield* T.scriptAskYesNo(sh);
    yield* T.scriptCloseText(sh);
    yield* S.scriptWaitFrames(sh, 0x0A);
    if (!a) break;
    S.actorPlayAnim(w, 0x05, 0x05);              // No (or B): "Once more" and the tour again
    yield* S.waitActorAnimDone(sh, 0x05);
    yield* S.scriptWaitFrames(sh, 0x0A);
    yield* T.scriptShowText(sh, 0x05);
    yield* S.scriptWaitFrames(sh, 0x0A);
  }
  T.scriptSkipText(w);                           // 32:694E
  if (allWon()) T.scriptSkipText(w);
  yield* T.scriptShowText(sh, 0x05);
  yield* S.scriptWaitFrames(sh, 0x0A);
  S.actorPlayAnim(w, 0x05, 0x05);
  yield* S.waitActorAnimDone(sh, 0x05);
  yield* S.scriptWaitFrames(sh, 0x0A);
  S.actorMoveDir(w, 0x05, 0x40, 0x0200);
  yield* S.waitActorMoveDone(sh, 0x05);
  S.actorSetFacing(w, 0x05, 0xC0);
  yield* S.scriptWaitFrames(sh, 0x0A);
  unregisterFrameTask(w, 0x32, 0x6735);
}

export const SCRIPTS = {
  "32:69b5": map04EnterLounge, "32:6739": map04TriggerChampIntro,
  "32:63a8": sh => champTalk(sh, 0x01FD, 0x07), "32:63ba": sh => champTalk(sh, 0x0416, 0x08),
  "32:63cc": sh => champTalk(sh, 0x042F, 0x09), "32:63de": sh => champTalk(sh, 0x0448, 0x0A),
  "32:7156": sh => map05Bookshelf(sh, 0x0806), "32:716c": sh => map05Bookshelf(sh, 0x080A),
  "32:71b4": map05TriggerWindTip, "32:7e67": mapScriptNop, "32:7966": map05Object1UpMushroom,
  "32:5e07": map03EnterClubhouse,
  "32:5c09": map03TriggerExitToMap,
  "32:5c25": map03TriggerGoingOutside,
  "32:5caf": sh => map03TriggerDoor(sh, 0), "32:5ccf": sh => map03TriggerDoor(sh, 1), "32:5cef": sh => map03TriggerDoor(sh, 2),
  "32:5d0f": sh => map03TriggerDoor(sh, 3), "32:5d2f": sh => map03TriggerDoor(sh, 4),
  "32:56ea": sh => map03TalkCounter(sh, 2), "32:5704": sh => map03TalkCounter(sh, 3),
  "32:5bea": map03ObjectBookshelf,
  "32:5033": map00EnterModeSelect,
  "32:71cf": map05EnterDirectorsRoom,
};
export const TASKS = w => ({
  "32:6735": () => map04ChampArrowTask(w),       // 32:6735 Map04ChampArrowTaskStub
});

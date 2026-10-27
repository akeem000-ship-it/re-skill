// Bank 32's map scripts (REVERSE.md "Bank 32"): map $00 (the mode select), map $05 (the Director's Room) ...
import * as D from "../render/display.js";
import * as Scr from "../screen.js";
import * as S from "../script.js";
import * as T from "../msgbox.js";
import * as M from "../mapengine.js";
import { modeSelectMain } from "../modesel.js";

const rd = D.rd, wr = D.wr;
function notPorted(what) { throw new Error(`${what} is not ported`); }
const flag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));

// 32:5033 Map00EnterModeSelect: ModeSelectMain 32:5037 (modesel.js)
function* map00EnterModeSelect(sh) { return yield* modeSelectMain(sh); }

// 32:71CF Map05EnterDirectorsRoom: entrance 2 (the first day, after the new character's creation): the director
// pro (actor 2), the Caddie Master (3) and the coach (4) introduce themselves (texts $487-$48F), then warp 2 (map
// $00 entrance 2: the mode select); the other entrances (~32:7461: the talk lists by progress) are not ported
function* map05EnterDirectorsRoom(sh) {
  const w = sh.w;
  if (rd(w, 0xC46A) !== 2) notPorted("the Director's Room's other entrances (~32:7461)");
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
  if (ent >= 3 && ent <= 7) notPorted(`walking out of door ${ent - 2} (~32:5D94 Map03WalkOutOfDoor)`);
}

export const SCRIPTS = {
  "32:5e07": map03EnterClubhouse,
  "32:5033": map00EnterModeSelect,
  "32:71cf": map05EnterDirectorsRoom,
};
export const TASKS = () => ({});

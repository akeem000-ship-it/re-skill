// What the story scripts' modules share (web/js/port/story_scripts): the script commands (the script_* macros of
// include/macros/story_script.inc, each one register setup and a far call into the story engine of bank $0A), the
// constants and RAM the scenes use, the exit request every scene ends with, and the hook adapters.
// Names, addresses and constants from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm: src/story/, include/macros/story_script.inc, include/constants/*.inc).
//
// The scenes. A story location's map tables (map_entry, map_script, its init script; data, read from the ROM by the
// engine) name native routines in the location's bank: arrival scenes, the init script, NPC talk, facing-tile and
// step-on handlers, exits. The engine (web/js/port/story) calls them with the cutscene mode on
// (RunStoryScriptOrDialogue) and keeps its registers around the call, so what a handler leaves in the registers is
// never used: the hooks of those handlers put the caller's back. A routine that other ROM code calls returns the
// registers its callers read (named at each one).
//
// Calls. The engine's routines are called as JavaScript (story/*.js, verified), inside farcall(P, bank, ...) as the
// ROM reaches them through FarCall: the callee's bank is mapped meanwhile (hRomBank and the MBC: the routines that
// start an actor script or a frame task take the bank from hRomBank). Bank-0 routines with a verified port (home/,
// audio/) are called directly. Code not ported yet (the other story files, the menus some scenes open) runs as the
// ROM's: P.callRom, or yield* P.runRom when it may wait (it runs the JS where another part has hooked it).
// The scenes wait inside the engine's commands (WaitScriptFrames, the dialogue, the walks): they are generators.
// The ROM's stack under the waits is not rebuilt here (the lockstep test lines the two up by frames, and copies the
// ROM's state in at a timing event whatever the depth).
import { FZ, FN, FH, FC, farcall, farcallGen, wActors, ACTOR_SIZE, ACTORF_FLAGS, ACTORF_X, ACTORF_Y } from "../story/common.js";
import {
  getActorStateAddr, scriptSetActorMoveSpeed, scriptSetActorScript, setActorNullScript, waitActorScriptDone,
  scriptWaitActorMoveDone, scriptWaitActorJumpDone, scriptSetActorPosition, initDialogueTextCursor,
  advanceDialogueTextCursor, scriptShowSpeakerDialogue, scriptCloseDialogueWindow, runDialogueYesNoPrompt,
  beginCutsceneScriptMode, endCutsceneScriptMode, waitScriptFrames, scriptRespawnLocationActors, runMenuFromText,
} from "../story/script.js";
import {
  scriptSetActorMoveTarget, moveActorByAngle, scriptSetActorFacingLock, setActorFacing, faceActorTowardActor,
  faceActorsTowardEachOther,
} from "../story/actor_moves.js";
import {
  scriptSetActorAnimation, scriptWaitActorIdle, scriptSetActorJumpVelocity, setActorActive, setPlayerMoveSpeed,
  movePlayerToPosition, movePlayerToActor as engineMovePlayerToActor, waitPlayerMoveDone, setScreenShake,
} from "../story/actor_waits.js";
import { loadActorObjectDef } from "../story/actor_objdefs.js";
import { attachActorStepMover } from "../story/actor_slots.js";
import { writeBehaviorMapCell, copySceneTilemapRect, copyCollisionMapRect, copyBehaviorMapRect } from "../story/scene_viewer.js";
import { copyScrolledSceneTilemapToVram } from "../story/scene_collision.js";
import { writeStoryStateWord } from "../story/story_loop.js";
import { saveStoryReturnPoint, restoreStoryReturnPoint } from "../story/story_interact.js";
import { initStoryMatchSettings, runStoryMatch, restoreOverworldAfterMatch, loadMatchSettingsFromTable } from "../story/match.js";
import { beginFadeOut, beginFadeIn, waitFadeEnd as homeWaitFadeEnd, registerFrameTask as homeRegisterFrameTask,
  unregisterFrameTask as homeUnregisterFrameTask } from "../home/colorfade.js";
import { clearFrameTasks } from "../home/debugtext.js";
import { enableLCD } from "../home/system.js";
import { queueVRAMCopy, copyMemoryBC } from "../home/memory.js";
import { queueSpriteTemplate as homeQueueSpriteTemplate } from "../home/fade.js";
import { loadPaletteShadow, loadPalettesImmediate } from "../home/palettes.js";
import { advanceRandomSeed } from "../home/joypad.js";
import { advanceFrame } from "../home/frame.js";
import { playSoundManaged, waitJingleEnd } from "../audio/requests.js";
import { resumeBGM, setMusicMuted } from "../audio/bgm.js";
import { getRegs, setRegs } from "../home/cpu.js";
import { runPagedTextMenu } from "../text/paged.js";
import { pushTextArgString, pushTextArgNumber } from "../text/arg.js";
import { fetchShortTextToBuffer } from "../text/window_tilemap.js";
import { HOOK_TRACE } from "../menus/char_select/defs.js";

export {
  FZ, FN, FH, FC, farcall, farcallGen, wActors, ACTOR_SIZE, beginFadeOut, beginFadeIn, clearFrameTasks, enableLCD,
  queueVRAMCopy, copyMemoryBC, loadPaletteShadow, loadPalettesImmediate, advanceFrame, waitJingleEnd, resumeBGM,
  setMusicMuted, getRegs, setRegs, HOOK_TRACE, writeStoryStateWord, initStoryMatchSettings, saveStoryReturnPoint,
  restoreStoryReturnPoint, copyScrolledSceneTilemapToVram,
};

// ---- banks ----
export const BANK_ACTORS = 0x04, BANK_STORY = 0x0A, BANK_TEXT = 0x05, BANK_SAVE = 0x03, BANK_STORY_02 = 0x02;

// ---- WRAM banks (include/constants/memory.inc) ----
export const WRAM_STAGING = 1, WRAM_COURT_PLANES = 2, WRAM_SCREEN = 3, WRAM_ACTORS = 4, WRAM_TEXT = 5;
export const WRAM_SCENE = 6;

// ---- actors (include/constants/overworld.inc) ----
export const ACTOR_PLAYER = 0x00, ACTOR_PLAYER_SHADOW = 0x01, ACTOR_PARTNER = 0x02;
export const SPEAKER_NONE = 0x80;                       // script_speak SPEAKER_NONE | n: no speaker, window row from n
export const FACE_RIGHT = 0x00, FACE_DOWN = 0x40, FACE_LEFT = 0x80, FACE_UP = 0xC0;
export const ANIM_STILL = 0x00, ANIM_WALK = 0x01, ANIM_BOUNCE = 0x02, ANIM_NOD = 0x03, ANIM_SHAKE = 0x04;
export const ACTORFLAGB_SOLID = 3, ACTORFLAGB_TALKABLE = 4;
export const ACTORFLAG_SOLID = 1 << ACTORFLAGB_SOLID, ACTORFLAG_TALKABLE = 1 << ACTORFLAGB_TALKABLE;
export { ACTORF_FLAGS, ACTORF_X, ACTORF_Y };
// the behaviour map's cell values (include/constants/overworld.inc)
export const BEHAVIOR_NONE = 0x00, BEHAVIOR_TRIGGER = 0x01, BEHAVIOR_EXIT = 0x03, BEHAVIOR_ACTION = 0x08;

// ---- the event flags the scenes test most (include/flag_constants.inc: wGameFlags byte n >> 3, bit n & 7) ----
export const FLAG_DOUBLES = 47, FLAG_TEMP_SCENE_VARIANT_A = 0xE0, FLAG_TEMP_SCENE_VARIANT_B = 0xE1;
// test_flag / set_flag / clear_flag n (rst $30 / $20 / $28): the flag's byte and mask as TestGameFlag finds them
const FlagMaskTable = 0x2497;
const flagAt = (P, n) => (P.A.gameFlags + (n >> 3)) & 0xFFFF;
const flagMask = (P, n) => { const e = (n & 7) << 5; return P.rom.u8(0, FlagMaskTable + (((e << 3) | (e >> 5)) & 0xFF)); };
export const testFlag = (P, n) => (P.bus.u8(flagAt(P, n)) & flagMask(P, n)) !== 0;
export const setFlag = (P, n) => P.bus.w8(flagAt(P, n), P.bus.u8(flagAt(P, n)) | flagMask(P, n));
export const clearFlag = (P, n) => P.bus.w8(flagAt(P, n), P.bus.u8(flagAt(P, n)) & ~flagMask(P, n));
// the flags the test leaves: Z when clear, H (its `and`)
export const testFlagF = set => (set ? 0 : FZ) | FH;

// ---- story locations and entries (include/constants/story.inc) ----
export const STORYENTRY_NONE = 0xFF;                   // enter keeping the saved position (no entry record)
export const EXIT_REQUEST = 0xFF;                      // wStoryModeExitTriggerRequest: leave for the location set

// ---- RAM through the mapped banks ----
// rd/wr: the byte at a variable (+ offset) through the WRAM bank mapped now, as the ROM's ld [wX], a does
export const rd = (P, name, off = 0) => P.bus.u8((P.A[name] + off) & 0xFFFF);
export const wr = (P, name, v, off = 0) => P.bus.w8((P.A[name] + off) & 0xFFFF, v & 0xFF);
export const rd16 = (P, name, off = 0) => P.bus.u16((P.A[name] + off) & 0xFFFF);
export const wr16 = (P, name, v, off = 0) => P.bus.w16((P.A[name] + off) & 0xFFFF, v & 0xFFFF);

// ---- positions, speeds (the macros' fixed-point literals) ----
// a map position or distance in tiles (11.0, 14.875) as the engine's 1/256-tile word
export const tiles = t => Math.round(t * 256) & 0xFFFF;
// a speed in pixels per frame (1.5) as the move-speed word (1 px = $20)
export const pxSpeed = s => Math.round(s * 32) & 0xFFFF;
// a jump velocity in pixels per frame (-2.0) as the word (1 px = 64, negative: up)
export const pxVelocity = v => Math.round(v * 64) & 0xFFFF;

// ---- the script commands (include/macros/story_script.inc), the story engine's routines of bank $0A ----
const story = (P, fn) => farcall(P, BANK_STORY, fn);
function* storyGen(P, gen) { return yield* farcallGen(P, BANK_STORY, gen); }
// script_move_target actor, x, y: ScriptSetActorMoveTarget (0A:43F9), actor walks to (x, y)
export const moveTarget = (P, actor, x, y) => story(P, () => scriptSetActorMoveTarget(P, actor, tiles(x), tiles(y)));
// script_set_position actor, x, y: ScriptSetActorPosition (0A:43B2), actor placed at (x, y)
export const setPosition = (P, actor, x, y) => story(P, () => scriptSetActorPosition(P, actor, tiles(x), tiles(y)));
// script_set_position with the point as words (bc, de) already
export const setPositionRaw = (P, actor, x, y) => story(P, () => scriptSetActorPosition(P, actor, x, y));
export const moveTargetRaw = (P, actor, x, y) => story(P, () => scriptSetActorMoveTarget(P, actor, x, y));
// script_move_angle actor, angle, distance: MoveActorByAngle (0A:4545)
export const moveAngle = (P, actor, angle, dist) => story(P, () => moveActorByAngle(P, actor, angle, tiles(dist)));
// farcall MoveActorByAngle with the angle (b) and length (de, 1/256 tile) as words
export const moveAngleRaw = (P, actor, angle, length) => story(P, () => moveActorByAngle(P, actor, angle, length));
// script_set_speed actor, speed: ScriptSetActorMoveSpeed (0A:433B)
export const setSpeed = (P, actor, speed) => story(P, () => scriptSetActorMoveSpeed(P, actor, pxSpeed(speed)));
// script_jump_velocity actor, velocity: ScriptSetActorJumpVelocity (0A:4719)
export const jumpVelocity = (P, actor, v) => story(P, () => scriptSetActorJumpVelocity(P, actor, pxVelocity(v)));
// script_move_player x, y: MovePlayerToPosition (0A:47B4) with a = 0: the player walks there
export function* movePlayer(P, x, y) { return yield* storyGen(P, movePlayerToPosition(P, tiles(x), tiles(y), 0)); }
// script_player_speed speed: SetPlayerMoveSpeed (0A:47A3)
export const playerSpeed = (P, speed) => story(P, () => setPlayerMoveSpeed(P, pxSpeed(speed)));
// script_set_text id (farcall InitDialogueTextCursor with hl = id): the dialogue goes on from text id
export function* setText(P, id) { return yield* storyGen(P, initDialogueTextCursor(P, { a: WRAM_TEXT, hl: id })); }
// farcall AdvanceDialogueTextCursor (0A:4172): skip a message
export const advanceText = P => story(P, () => advanceDialogueTextCursor(P));
// script_set_anim actor, anim: ScriptSetActorAnimation (0A:4702)
export const setAnim = (P, actor, anim) => story(P, () => scriptSetActorAnimation(P, actor, anim));
// script_get_actor_state actor: GetActorStateAddr (0A:4312), the actor's record (WRAM 4 mapped)
export const actorState = (P, actor) => story(P, () => getActorStateAddr(P, actor)).hl;
// script_set_objdef objdef, actor: the actor's record, then LoadActorObjectDefIfValid (04:4AC3)
export function setObjdef(P, objdef, actor) {
  const bc = actorState(P, actor);
  if (bc >> 8) farcall(P, BANK_ACTORS, () => loadActorObjectDef(P, bc, objdef));
}
// script_face actor, facing: SetActorFacing (0A:45E2)
export const face = (P, actor, facing) => story(P, () => setActorFacing(P, actor, facing));
// script_face_pair actor1, actor2: FaceActorsTowardEachOther (0A:466F) (a = actor2, b = actor1)
export const facePair = (P, actor1, actor2) => story(P, () => faceActorsTowardEachOther(P, actor2, actor1));
// script_face_toward actor, target: FaceActorTowardActor (0A:45F5) (a = target, b = actor)
export const faceToward = (P, actor, target) => story(P, () => faceActorTowardActor(P, target, actor));
// script_lock_facing / script_unlock_facing actor: ScriptSetActorFacingLock (0A:45C0) with b = 1 / 0
export const lockFacing = (P, actor) => story(P, () => scriptSetActorFacingLock(P, actor, 1));
export const unlockFacing = (P, actor) => story(P, () => scriptSetActorFacingLock(P, actor, 0));
// script_set_active actor, state: SetActorActive (0A:472E)
export const setActive = (P, actor, state) => story(P, () => setActorActive(P, actor, state));
// script_move_player_to_actor actor: MovePlayerToActor (0A:4813) with b = 0
export function* movePlayerToActor(P, actor) { return yield* storyGen(P, engineMovePlayerToActor(P, actor, 0)); }
// script_speak actor / script_speak_restore actor: the dialogue's next message, spoken by actor
// (ScriptShowSpeakerDialogue 0A:4192 / ScriptShowSpeakerDialogueRestoreBG 0A:41C1)
export function* speak(P, actor) { return yield* storyGen(P, scriptShowSpeakerDialogue(P, { a: actor })); }
export function* speakRestore(P, actor) { return yield* storyGen(P, scriptShowSpeakerDialogue(P, { a: actor }, true)); }
// farcall RunDialogueYesNoPrompt (0A:41F6): the Yes/No menu of the message shown; 0 = yes
export function* yesNo(P) { return yield* storyGen(P, runDialogueYesNoPrompt(P)); }
// farcall ScriptCloseDialogueWindow (0A:41F2)
export function* closeDialogue(P) { return yield* storyGen(P, scriptCloseDialogueWindow(P, {})); }
// the scenes' question: script_speak_restore actor, the Yes/No prompt, the window closed, 5 frames. 0 = yes
export function* askYesNo(P, actor) {
  yield* speakRestore(P, actor);
  const choice = yield* yesNo(P);
  yield* closeDialogue(P);
  yield* wait(P, 5);
  return choice;
}
// the scenes' common question: script_set_text text, then askYesNo; on a no the other answer
// (AdvanceDialogueTextCursor); script_speak actor
export function* question(P, text, actor) {
  yield* setText(P, text);
  if ((yield* askYesNo(P, actor)) !== 0) advanceText(P);
  yield* speak(P, actor);
}
// farcall RunMenuFromText (0A:42CF): a menu from text hl at (d, e); the choice
export function* menuFromText(P, text, d, e) { return (yield* storyGen(P, runMenuFromText(P, { hl: text, d, e }))).a; }
// script_wait_idle actor: ScriptWaitActorIdle (0A:470B), until its animation is back to still or walk
export function* waitIdle(P, actor) { return yield* storyGen(P, scriptWaitActorIdle(P, actor)); }
// script_set_anim actor, anim / script_wait_idle actor: a gesture (nod, shake, bounce) played to its end
export function* gesture(P, actor, anim) {
  setAnim(P, actor, anim);
  yield* waitIdle(P, actor);
}
// the scenes' run of questions: askYesNo n times, the dialogue's next message after each yes; false at a no
export function* agrees(P, actor, n) {
  for (let i = 0; i < n; i++) {
    if ((yield* askYesNo(P, actor)) !== 0) return false;
    advanceText(P);
  }
  return true;
}
// script_wait_move actor: ScriptWaitActorMoveDone (0A:43A4), until it stops walking
export function* waitMove(P, actor) { return yield* storyGen(P, scriptWaitActorMoveDone(P, actor)); }
// farcall ScriptWaitActorJumpDone (0A:43AB) with actor a: until it lands
export function* waitJump(P, actor) { return yield* storyGen(P, scriptWaitActorJumpDone(P, actor)); }
// script_wait_actor_script actor: WaitActorScriptDone (0A:4372), until its script halts (at most $258 frames)
export function* waitActorScript(P, actor) { return yield* storyGen(P, waitActorScriptDone(P, actor)); }
// script_null_script actor: SetActorNullScript (0A:4364), the actor's script detached (it stands)
export const nullScript = (P, actor) => story(P, () => setActorNullScript(P, actor));
// script_set_actor_script actor, script: ScriptSetActorScript (0A:4350) with b = hRomBank (the scene's bank)
export function setActorScript(P, actor, script) {
  const bank = P.V.romBank;
  return story(P, () => scriptSetActorScript(P, actor, bank, script));
}
// the same with the bank given (b set by the caller)
export const setActorScriptIn = (P, actor, bank, script) => story(P, () => scriptSetActorScript(P, actor, bank, script));
// script_wait_frames n: WaitScriptFrames (0A:413F), n frames (2 when fast-forwarding)
export function* wait(P, frames) { yield* storyGen(P, waitScriptFrames(P, frames, P.cpu.f, P.cpu.bc)); }
// farcall WaitPlayerMoveDone (0A:4892): until the player stands
export function* waitPlayerMove(P) { yield* storyGen(P, waitPlayerMoveDone(P)); }
// script_copy_scene_rect src col, row, dst col, row, width, height: CopySceneTilemapRect (0A:619E)
export function* copySceneRect(P, sc, sr, dc, dr, w, h) {
  yield* storyGen(P, copySceneTilemapRect(P, (w << 8 | h) & 0xFFFF, (sc << 8 | sr) & 0xFFFF, (dc << 8 | dr) & 0xFFFF));
}
// farcall BeginCutsceneScriptMode / EndCutsceneScriptMode (0A:40D0 / 0A:4105)
export const beginCutscene = P => story(P, () => beginCutsceneScriptMode(P, P.cpu.sp));
export const endCutscene = P => story(P, () => endCutsceneScriptMode(P, P.cpu.sp));
// ldh a, [hRomBank] / ld hl, list / farcall ScriptRespawnLocationActors (0A:4152): the actors of a map_actor list in
// the scene's bank spawned anew
export function respawnActors(P, list) {
  const bank = P.V.romBank;
  story(P, () => scriptRespawnLocationActors(P, bank, list));
}
// map_cell col, row / ld a, v / farcall WriteBehaviorMapCell (0A:5F74)
export const writeBehaviorCell = (P, col, row, v) => story(P, () => writeBehaviorMapCell(P, col, row, v));
// farcall CopyCollisionMapRect / CopyBehaviorMapRect (0A:5F90 / 0A:5FD6): h x l tiles from (b, c) to (d, e)
export const copyCollisionRect = (P, w, h, sc, sr, dc, dr) => story(P, () => copyCollisionMapRect(P, (w << 8 | h) & 0xFFFF, (sc << 8 | sr) & 0xFFFF, (dc << 8 | dr) & 0xFFFF));
export const copyBehaviorRect = (P, w, h, sc, sr, dc, dr) => story(P, () => copyBehaviorMapRect(P, (w << 8 | h) & 0xFFFF, (sc << 8 | sr) & 0xFFFF, (dc << 8 | dr) & 0xFFFF));
// farcall CopyScrolledSceneTilemapToVram (0A:5C29) with a
export const copySceneToVram = (P, a) => story(P, () => copyScrolledSceneTilemapToVram(P, a));
// farcall SetScreenShake (0A:48C0) with a = magnitude (0 stops it)
export const screenShake = (P, magnitude) => story(P, () => setScreenShake(P, magnitude, P.cpu.sp));
// farcall AttachActorStepMover (04:41A6): actor (bc) walks after leader (de)
export const attachStepMover = (P, actor, leader) => farcall(P, BANK_ACTORS, () => attachActorStepMover(P, actor, leader));
// script_get_actor_state actor / ld c, l / ld b, h / ld de, wActors / farcall AttachActorStepMover: the actor
// follows the player
export const followPlayer = (P, actor) => attachStepMover(P, actorState(P, actor), wActors);
// script_get_actor_state actor / ld hl, ACTORF_FLAGS / add hl, bc / set bit, [hl] (res: clear)
export function setActorFlag(P, actor, mask) {
  const at = (actorState(P, actor) + ACTORF_FLAGS) & 0xFFFF;
  P.bus.w8(at, P.bus.u8(at) | mask);
}
export function clearActorFlag(P, actor, mask) {
  const at = (actorState(P, actor) + ACTORF_FLAGS) & 0xFFFF;
  P.bus.w8(at, P.bus.u8(at) & ~mask);
}
// farcall SaveStoryReturnPoint (0A:527F) with b = location, c = entry; RestoreStoryReturnPoint (0A:52AE)
export const saveReturnPoint = (P, loc, entry) => story(P, () => saveStoryReturnPoint(P, loc, entry));
export const restoreReturnPoint = P => story(P, () => restoreStoryReturnPoint(P));
// farcall InitStoryMatchSettings / RunStoryMatch / RestoreOverworldAfterMatch (0A:4931 / 4962 / 4991)
export const initMatchSettings = P => story(P, () => initStoryMatchSettings(P));
export function* runMatch(P) { return yield* storyGen(P, runStoryMatch(P)); }
export function* restoreAfterMatch(P) { return yield* storyGen(P, restoreOverworldAfterMatch(P)); }
// load_match_settings list, index: wCurrentMinigameStoryMatch = (list, index), then LoadMatchSettingsFromTable
// (0A:4A5C): the story match's settings (opponents, court, format)
export function loadMatchSettings(P, list, index) {
  P.bus.w8(P.A.currentMinigameStoryMatch, list);
  P.bus.w8(P.A.currentMinigameStoryMatch + 1, index);
  story(P, () => loadMatchSettingsFromTable(P));
}
// a story match: InitStoryMatchSettings, load_match_settings list, index, RunStoryMatch, RestoreOverworldAfterMatch
export function* playStoryMatch(P, list, index) {
  initMatchSettings(P);
  loadMatchSettings(P, list, index);
  yield* runMatch(P);
  yield* restoreAfterMatch(P);
}
export const MATCHLIST_SINGLES = 0x00, MATCHLIST_DOUBLES = 0x01, MATCHLIST_TRAINING = 0x02;
// ld de, offset / ld hl, value / farcall WriteStoryStateWord (0A:5161): a word of the story state
export const writeStoryWord = (P, off, value) => story(P, () => writeStoryStateWord(P, off, value));
// the location's NPC talk records replaced (ld hl, list / ld de, wMapNpcScriptsPtr - wStoryModeCurrentLocation)
export const setNpcScripts = (P, list) => writeStoryWord(P, P.A.mapNpcScriptsPtr - P.A.storyModeCurrentLocation, list);

// ---- the text engine (bank 5) ----
const text = (P, fn) => farcall(P, BANK_TEXT, fn);
// farcall RunPagedTextMenu (05:4944): a menu of pages of text hl (a pages): the choice, $FF when cancelled
export function* pagedTextMenu(P, hl, pages) { return yield* farcallGen(P, BANK_TEXT, runPagedTextMenu(P, hl, pages)); }
// farcall PushTextArgNumber (05:5147) / PushTextArgString (05:50F7): the next message's argument
export const pushTextNumber = (P, n) => text(P, () => pushTextArgNumber(P, n));
export const pushTextString = (P, ptr) => text(P, () => pushTextArgString(P, ptr));
// farcall FetchShortTextToBuffer (05:409A): short text id into the buffer at de
export const fetchShortText = (P, id, dest) => text(P, () => fetchShortTextToBuffer(P, id, dest));

// ---- bank-0 routines ----
// script_fade_in speed: BeginFadeIn (00:1D2E) (no wait)
export const fadeIn = (P, speed) => beginFadeIn(P, speed);
export const fadeOut = (P, speed) => beginFadeOut(P, speed);
// call WaitFadeEnd (00:1DA4)
export function* waitFadeEnd(P) { return yield* homeWaitFadeEnd(P, getRegs(P.cpu)); }
// ld c, speed / call BeginFadeOut / call WaitFadeEnd
export function* fadeOutAndWait(P, speed) { beginFadeOut(P, speed); yield* waitFadeEnd(P); }
export function* fadeInAndWait(P, speed) { beginFadeIn(P, speed); yield* waitFadeEnd(P); }
// sound id (rst $08): PlaySoundCmd's request (audio/requests.js)
export const sound = (P, id) => playSoundManaged(P, id);
// call DisableLCDSafely (00:0346): a busy wait for the VBlank (CPU time), still the ROM's
export const disableLCDSafely = P => P.callRom(0, 0x0346);
// call AdvanceRandomSeed (00:0A3A): the new random word (hl)
export const randomWord = P => advanceRandomSeed(P);
// RegisterFrameTask / UnregisterFrameTask (00:1B6A / 00:1BCB) of a routine in the bank mapped now (the scene's);
// the ROM builds its key on the stack below the call's return address
export const registerFrameTask = (P, priority, routine) => homeRegisterFrameTask(P, priority, routine, (P.cpu.sp - 2) & 0xFFFF);
export const unregisterFrameTask = (P, routine) => homeUnregisterFrameTask(P, routine, (P.cpu.sp - 2) & 0xFFFF);
// QueueSpriteTemplate (00:1E9D): template hl at (d, e), tile + c, attribute + b
export const queueSpriteTemplate = (P, hl, x, y, tile, attr) => homeQueueSpriteTemplate(P, hl, x, y, tile, attr, (P.cpu.sp - 2) & 0xFFFF);
// rst $00 (JumpTableDispatch, 00:06C4) with a, its table of words right after the rst: the entry's address
export const jumpTableTarget = (P, bank, table, a) => P.rom.u16(bank, (table + ((a * 2) & 0xFF)) & 0xFFFF);
// push_wram_bank b ... pop_wram_bank around fn
export function withWram(P, bank, fn) {
  const old = P.V.wramBank;
  P.wramBank(bank);
  const r = fn();
  P.wramBank(old);
  return r;
}

// ---- the exit request the scenes end with ----
// ld a, location / ld [wStoryModeCurrentLocation], a / ld a, entry / ld [wStoryModeEntryPoint], a / ld a, $ff /
// ld [wUnusedExitTriggerIdMirror], a / ld [wStoryModeExitTriggerRequest], a: when the scene returns, the story loop
// leaves for that location, at that entry point
export function goToLocation(P, location, entry) {
  P.V.storyModeCurrentLocation = location;
  P.V.storyModeEntryPoint = entry;
  requestExit(P, EXIT_REQUEST);
}
// ld hl, wStoryModePlayersXPosition / ld de, wStoryModeSpawnPosition / ld bc, 5 / call CopyMemoryBC / ld a,
// STORYENTRY_NONE / ld [wStoryModeEntryPoint], a / (the exit request): come back to this very place (the player's
// position and facing kept as the spawn point) when the scene returns (after a match)
export function returnHereAfter(P) {
  copyMemoryBC(P, P.A.storyModePlayersXPosition, P.A.storyModeSpawnPosition, 5);
  P.V.storyModeEntryPoint = STORYENTRY_NONE;
  requestExit(P, STORYENTRY_NONE);
}
// ld a, id / ld [wUnusedExitTriggerIdMirror], a / ld [wStoryModeExitTriggerRequest], a: take exit id (a map_script of
// the location's exit list) when the scene returns
export function requestExit(P, id) {
  P.V.unusedExitTriggerIdMirror = id;
  P.V.storyModeExitTriggerRequest = id;
}

// ---- hook adapters ----
// fn(P, cpu) runs the routine and returns the registers its callers read ({ a, f, ... }); the others are put back
// as they were at the call. HOOK_TRACE.out (char_select/defs.js): the registers the last hook gave (the routine
// tests compare these with the ROM's).
export const hook = fn => (P, cpu) => {
  const saved = getRegs(cpu);
  const out = fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
  HOOK_TRACE.out = out;
};
export const hookGen = fn => function* (P, cpu) {
  const saved = getRegs(cpu);
  const out = yield* fn(P, cpu);
  setRegs(cpu, saved);
  if (out) setRegs(cpu, out);
};
// a scene handler the engine calls (its registers unused): [bank, addr, generator function (P)]
export const scene = (bank, addr, gen) => [bank, addr, hookGen(P => gen(P))];

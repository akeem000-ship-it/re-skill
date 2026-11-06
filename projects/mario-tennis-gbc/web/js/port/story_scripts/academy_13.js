// The dorm room's roommate (bank $13, $56BB-$5B8A): the "play doubles today?" prompt, the academy questions menu
// (the roommate's answers, a topic per page, worded by the story's progress), the narration that takes the player
// from the dorm room to the next day's place (DormRoomEntry08/09/0aScene), the story stage the dorm scenes go by,
// and the arrival cutscene. The actor scripts here (ActorScript_13_00..03, the cat's idle walks) are data.
// Port of src/story/academy_13.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec2.mtrec (the dorm room in Tour mode) and out/port/ss1_dorm*.mtrec (scripted: the dorm
// room's scenes by story stage).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, SPEAKER_NONE, FACE_DOWN, ANIM_NOD, ACTORFLAG_SOLID, ACTORFLAG_TALKABLE, WRAM_ACTORS,
  FLAG_DOUBLES, pagedTextMenu, FLAG_TEMP_SCENE_VARIANT_A, testFlag, testFlagF, setFlag, clearFlag, setText, advanceText,
  speak, askYesNo, setAnim, waitIdle, wait, face, setPosition, setActive, moveTarget, waitMove, nullScript,
  followPlayer, setActorFlag, copySceneRect, fadeIn, waitFadeEnd, sound, goToLocation, hook, hookGen, scene,
} from "./common.js";
import { setDormRoomEventTriggerCells } from "./dorm_13.js";

const BANK = 0x13;
// actors of the dorm room (DormRoomActors_13)
const ACTOR_DORM_ROOM_KATE = 0x03, ACTOR_DORM_ROOM_CAT = 0x04;
const BGM_NONE = 0x00;
const STORYLOC_ACADEMY_ENTRANCE = 0x14, STORYLOC_TOURNAMENT_COURTYARD = 0x15;
const FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL = 0x35, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL = 0x3C;
const FLAG_WON_JUNIOR_DOUBLES_RANK_1 = 0x42, FLAG_WON_SENIOR_DOUBLES_RANK_1 = 0x46, FLAG_WON_VARSITY_DOUBLES_RANK_2 = 0x48;
const FLAG_WON_JUNIOR_SINGLES_RANK_1 = 0x53, FLAG_WON_SENIOR_SINGLES_RANK_1 = 0x57, FLAG_WON_VARSITY_SINGLES_RANK_4 = 0x58;
const FLAG_REACHED_ISLAND_OPEN_SINGLES = 0xAE, FLAG_REACHED_ISLAND_OPEN_DOUBLES = 0xAF;
const FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
// text ids (include/text_ids.inc)
const Text_30_496 = 0x01F0, Text_30_497 = 0x01F1, Text_31_268 = 0x050C, Text_31_273 = 0x0511;
const Text_31_304 = 0x0530, Text_31_307 = 0x0533, Text_31_310 = 0x0536, Text_31_313 = 0x0539;
const Text_31_332 = 0x054C, Text_31_333 = 0x054D, Text_31_334 = 0x054E;
// the answers' first text ids (the operands of RunAcademyQuestionsMenu's ld de): the roommate of variant A / B
const ACADEMY_ANSWERS_A = 0x054F, ACADEMY_ANSWERS_B = 0x0808;
// routines of this bank not ported here (src/story/varsity_courtyard_13.asm)
const SetRoommateDoublesNoReplyText_13 = 0x5B8B, SetRoommateSinglesNoReplyText_13 = 0x5BA7;
const SetRoommateSinglesYesReplyText_13 = 0x5BC3, SetRoommateDoublesYesReplyText_13 = 0x5BDF;
const AcademyTopicHandlerTable = 0x5928;               // 7 words: the topics' handlers
const YES = 0, MENU_CANCELLED = 0xFF;

// `call` of one of the roommate's reply-text routines (no wait; they set the dialogue's next text by the stage)
const replyText = (P, addr) => P.callRom(BANK, addr);
// ld a, $00/$01 / ld [wMatchIsDoubles], a after `wram_bank WRAM_ACTORS`
function setMatchIsDoubles(P, doubles) {
  P.wramBank(WRAM_ACTORS);
  P.V.matchIsDoubles = doubles;
}

// RunPlayDoublesTodayPrompt (13:56BB): the roommate asks whether to play doubles today (or, already partners,
// singles). Yes to doubles: FLAG_DOUBLES and wMatchIsDoubles set, the roommate follows the player and can be talked
// to; no: she stays (solid, standing). The dorm's step-on cells follow the choice (SetDormRoomEventTriggerCells_13).
export function* runPlayDoublesTodayPrompt(P) {
  if (!testFlag(P, FLAG_DOUBLES)) {
    yield* setText(P, testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? Text_31_304 : Text_31_310);
    if ((yield* askYesNo(P, ACTOR_DORM_ROOM_KATE)) === YES) {
      setFlag(P, FLAG_DOUBLES);
      replyText(P, SetRoommateDoublesYesReplyText_13);
      yield* speak(P, ACTOR_DORM_ROOM_KATE);
      yield* playerNods(P);
      yield* wait(P, 5);
      face(P, ACTOR_PLAYER, FACE_DOWN);
      setMatchIsDoubles(P, 1);
      setDormRoomEventTriggerCells(P);
      yield* wait(P, 5);
      followPlayer(P, ACTOR_DORM_ROOM_KATE);
      setActorFlag(P, ACTOR_DORM_ROOM_KATE, ACTORFLAG_TALKABLE);
      yield* wait(P, 5);
      face(P, ACTOR_PLAYER, FACE_DOWN);
      return;
    }
    replyText(P, SetRoommateDoublesNoReplyText_13);                     // .declined
    advanceText(P);
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    clearFlag(P, FLAG_DOUBLES);
    setMatchIsDoubles(P, 0);
    nullScript(P, ACTOR_DORM_ROOM_KATE);
    setActorFlag(P, ACTOR_DORM_ROOM_KATE, ACTORFLAG_SOLID);
    setDormRoomEventTriggerCells(P);
    face(P, ACTOR_DORM_ROOM_KATE, FACE_DOWN);
    return;
  }
  // .accepted: partners already; singles today?
  yield* setText(P, testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? Text_31_307 : Text_31_313);
  if ((yield* askYesNo(P, ACTOR_DORM_ROOM_KATE)) === YES) {
    replyText(P, SetRoommateSinglesYesReplyText_13);
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    nullScript(P, ACTOR_DORM_ROOM_KATE);
    clearFlag(P, FLAG_DOUBLES);
    setMatchIsDoubles(P, 0);
    moveTarget(P, ACTOR_DORM_ROOM_KATE, 11.0, 9.0);                      // back to her place
    yield* waitMove(P, ACTOR_DORM_ROOM_KATE);
    yield* wait(P, 5);
    face(P, ACTOR_DORM_ROOM_KATE, FACE_DOWN);
    yield* wait(P, 5);
    setActorFlag(P, ACTOR_DORM_ROOM_KATE, ACTORFLAG_SOLID);
    setDormRoomEventTriggerCells(P);
    nullScript(P, ACTOR_DORM_ROOM_KATE);
    face(P, ACTOR_DORM_ROOM_KATE, FACE_DOWN);
    return;
  }
  replyText(P, SetRoommateSinglesNoReplyText_13);                       // .done: doubles it stays
  advanceText(P);
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  yield* playerNods(P);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  yield* wait(P, 5);
  setMatchIsDoubles(P, 1);
  setFlag(P, FLAG_DOUBLES);
  setDormRoomEventTriggerCells(P);
  followPlayer(P, ACTOR_DORM_ROOM_KATE);
  setActorFlag(P, ACTOR_DORM_ROOM_KATE, ACTORFLAG_TALKABLE);
  face(P, ACTOR_PLAYER, FACE_DOWN);
}
// script_set_anim ACTOR_PLAYER, ANIM_NOD / script_wait_idle ACTOR_PLAYER
function* playerNods(P) {
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
}

// RunAcademyQuestionsMenu (13:58BE): the questions menu (a paged text menu of topics, its last pages unlocked by
// the senior and varsity wins); each topic's answer is spoken, then "anything else?" until no or B. The answers'
// first text id is kept in wMapScratch.
// Each round stores its de at hl. In the rounds after the first, both still hold what InitDialogueTextCursor left
// (the text id of "anything else?", below $4000): the two stores go to the MBC (its RAM-enable register: the save
// RAM is switched off). The ROM does that, so the port does.
export function* runAcademyQuestionsMenu(P) {
  const { bus } = P;
  let hl = P.A.mapScratch, de = testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? ACADEMY_ANSWERS_A : ACADEMY_ANSWERS_B;
  for (;;) {
    bus.w8(hl, de & 0xFF); bus.w8((hl + 1) & 0xFFFF, de >> 8);       // .menuLoop
    let menu = Text_31_332;
    if (testFlag(P, FLAG_WON_SENIOR_SINGLES_RANK_1)) menu = testFlag(P, FLAG_WON_VARSITY_SINGLES_RANK_4) ? Text_31_334 : Text_31_333;
    const topic = yield* pagedTextMenu(P, menu, 1);              // (ld de, $0101: unused)
    if (topic === MENU_CANCELLED) return;
    yield* academyTopic(P, topic);
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    const r = yield* setText(P, bus.u16(P.A.mapScratch));            // "anything else?"
    if ((yield* askYesNo(P, ACTOR_DORM_ROOM_KATE)) !== YES) return;
    hl = r.hl; de = r.de;
  }
}
// add a / ld_hl_indexed AcademyTopicHandlerTable / call JumpToHL: the topic's handler (from the ROM's table)
function* academyTopic(P, topic) {
  const handler = P.rom.u16(BANK, (AcademyTopicHandlerTable + ((topic * 2) & 0xFF)) & 0xFFFF);
  const fn = TOPICS[handler];
  if (fn) yield* fn(P);
  else yield* P.runRom(BANK, handler);
}

// The topic handlers: the answer's text id = the answers' first id (wMapScratch) + the topic's offset + one more
// for each win, in order, the player has (a later answer for a later stage).
// AcademyTopicSinglesRank (13:5936) .. AcademyTopicTopRanked (13:5A1A)
function* topicAnswer(P, offset, flags) {
  let id = (P.bus.u16(P.A.mapScratch) + offset) & 0xFFFF;
  for (const flag of flags) {
    if (!testFlag(P, flag)) break;
    id = (id + 1) & 0xFFFF;
  }
  yield* setText(P, id);
}
export const academyTopicSinglesRank = P => topicAnswer(P, 0x01,
  [FLAG_WON_SENIOR_SINGLES_RANK_1, FLAG_WON_VARSITY_SINGLES_RANK_4, FLAG_WON_ISLAND_OPEN_SINGLES_FINAL]);
export const academyTopicDoublesRank = P => topicAnswer(P, 0x05,
  [FLAG_WON_JUNIOR_DOUBLES_RANK_1, FLAG_WON_SENIOR_DOUBLES_RANK_1, FLAG_WON_VARSITY_DOUBLES_RANK_2, FLAG_WON_ISLAND_OPEN_DOUBLES_FINAL]);
export const academyTopicRules = P => topicAnswer(P, 0x0A, [FLAG_WON_JUNIOR_SINGLES_RANK_1]);
export const academyTopicClassRank = P => topicAnswer(P, 0x0C, [FLAG_WON_JUNIOR_SINGLES_RANK_1, FLAG_WON_SENIOR_SINGLES_RANK_1]);
export const academyTopicVarsity = P => topicAnswer(P, 0x0F, [FLAG_WON_VARSITY_SINGLES_RANK_4]);
export const academyTopicIslandOpen = P => topicAnswer(P, 0x11, [FLAG_WON_VARSITY_SINGLES_RANK_4]);
export const academyTopicTopRanked = P => topicAnswer(P, 0x13, []);
const TOPICS = {
  0x5936: academyTopicSinglesRank, 0x5968: academyTopicDoublesRank, 0x59A6: academyTopicRules,
  0x59C0: academyTopicClassRank, 0x59E6: academyTopicVarsity, 0x5A00: academyTopicIslandOpen, 0x5A1A: academyTopicTopRanked,
};

// ShowStoryNarration_13 (13:5A28): the night's narration (text set by the caller) over the dorm's dark copy: the
// music stopped, the room's actors put away, the dark scene copied over the room, faded in, the narration window.
export function* showStoryNarration(P) {
  sound(P, BGM_NONE);
  setPosition(P, ACTOR_DORM_ROOM_KATE, 63.0, 63.0);
  setPosition(P, ACTOR_DORM_ROOM_CAT, 63.0, 63.0);
  setActive(P, ACTOR_PLAYER, 0);
  setActive(P, ACTOR_PARTNER, 0);
  yield* copySceneRect(P, 0, 32, 0, 0, 22, 24);
  fadeIn(P, 8);
  yield* wait(P, 4);
  yield* speak(P, SPEAKER_NONE | 5);
  yield* wait(P, 4);
}
// DormRoomEntry0aScene (13:5A76) / DormRoomEntry09Scene (13:5A92) / DormRoomEntry08Scene (13:5AAE): the
// narration, then on to the academy entrance (entry $0A) or the tournament courtyard (entry $0F).
function* narrationThen(P, text, location, entry) {
  yield* setText(P, text);
  yield* showStoryNarration(P);
  goToLocation(P, location, entry);
}
export const dormRoomEntry0aScene = P => narrationThen(P, Text_30_496, STORYLOC_ACADEMY_ENTRANCE, 0x0A);
export const dormRoomEntry09Scene = P => narrationThen(P, Text_30_497, STORYLOC_TOURNAMENT_COURTYARD, 0x0F);
export const dormRoomEntry08Scene = P => narrationThen(P, Text_30_496, STORYLOC_ACADEMY_ENTRANCE, 0x0A);

// GetDormRoomStoryStage_13 (13:5ACA): a = the story's stage for the dorm scenes: 0 before the Island Open, 1 once
// reached, 2 once the story is complete (singles or doubles flags by FLAG_DOUBLES). F: the last flag test's.
export function getDormRoomStoryStage(P) {
  const doubles = testFlag(P, FLAG_DOUBLES);
  const complete = testFlag(P, doubles ? FLAG_STORY_COMPLETE_DOUBLES : FLAG_STORY_COMPLETE_SINGLES);
  if (complete) return { a: 2, f: testFlagF(true) };
  const reached = testFlag(P, doubles ? FLAG_REACHED_ISLAND_OPEN_DOUBLES : FLAG_REACHED_ISLAND_OPEN_SINGLES);
  return { a: reached ? 1 : 0, f: testFlagF(reached) };
}

// DormRoomArrivalCutscene_13 (13:5AEE): back in the dorm room at the Island Open stage: the partner put away, the
// roommate at her place; she speaks (in doubles twice, after skipping a message: then she follows the player and
// can be talked to); the player nods.
export function* dormRoomArrivalCutscene(P) {
  yield* setText(P, testFlag(P, FLAG_TEMP_SCENE_VARIANT_A) ? Text_31_273 : Text_31_268);
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, 11.0, 30.0);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  setPosition(P, ACTOR_DORM_ROOM_KATE, 11.0, 10.0);
  face(P, ACTOR_DORM_ROOM_KATE, FACE_DOWN);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  if (testFlag(P, FLAG_DOUBLES)) {
    advanceText(P);
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    yield* speak(P, ACTOR_DORM_ROOM_KATE);
    yield* playerNods(P);
    face(P, ACTOR_PLAYER, FACE_DOWN);
    yield* wait(P, 5);
    followPlayer(P, ACTOR_DORM_ROOM_KATE);
    setActorFlag(P, ACTOR_DORM_ROOM_KATE, ACTORFLAG_TALKABLE);
    return;
  }
  yield* speak(P, ACTOR_DORM_ROOM_KATE);
  yield* playerNods(P);
}

export const HOOKS = [
  scene(BANK, 0x56BB, runPlayDoublesTodayPrompt),
  scene(BANK, 0x58BE, runAcademyQuestionsMenu),
  scene(BANK, 0x5936, academyTopicSinglesRank),
  scene(BANK, 0x5968, academyTopicDoublesRank),
  scene(BANK, 0x59A6, academyTopicRules),
  scene(BANK, 0x59C0, academyTopicClassRank),
  scene(BANK, 0x59E6, academyTopicVarsity),
  scene(BANK, 0x5A00, academyTopicIslandOpen),
  scene(BANK, 0x5A1A, academyTopicTopRanked),
  scene(BANK, 0x5A28, showStoryNarration),
  scene(BANK, 0x5A76, dormRoomEntry0aScene),
  scene(BANK, 0x5A92, dormRoomEntry09Scene),
  scene(BANK, 0x5AAE, dormRoomEntry08Scene),
  [BANK, 0x5ACA, hook(P => getDormRoomStoryStage(P))],
  scene(BANK, 0x5AEE, dormRoomArrivalCutscene),
];

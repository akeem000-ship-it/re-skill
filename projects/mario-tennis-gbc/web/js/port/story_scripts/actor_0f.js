// The Island Open's shared helpers (bank $0F, $78EC-$7DBA): the finished round's name in the next message, the
// break between rounds (doubles), the partner's stand-in actor, the short-text argument, the arrival walk by entry,
// the player's and partner's court sprites, unused map-script stubs and the bank's copies of the story-rank
// routines. The actor scripts here (ActorScript_0f_07..12) and the facing table are data.
// Port of src/story/actor_0f.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_island*.mtrec (scripted: the Island Open's rounds).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_DOWN, FACE_UP, ANIM_NOD, ANIM_WALK, BANK_ACTORS, FLAG_DOUBLES, STORYENTRY_NONE,
  WRAM_TEXT, testFlag, setText, speak, setAnim, waitIdle, wait, face, facePair, setPosition, moveTarget, waitMove,
  movePlayer, movePlayerToActor, waitPlayerMove, setSpeed, nullScript, actorState, sound, fetchShortText,
  pushTextString, moveAngleRaw, farcall, hook, scene,
} from "./common.js";
import { loadCourtPlayerPartnerObjDefs, computeRankingProgressIndex, computeStoryRankTier } from "./twins.js";
import { loadActorObjectDef } from "../story/actor_objdefs.js";

const BANK = 0x0F;
// actors of the doubles rounds (IslandOpenRoundActorsDoubles_0f, island_rounds_0f.asm)
const ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_08 = 0x03, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_06 = 0x04, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_07 = 0x05;
const ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_6F_07_1 = 0x06, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_6F_07_2 = 0x07;
const ACTOR_ISLAND_OPEN_ROUND_WALK_74_07 = 0x05;
const OBJ_HARRY_B = 0x58, OBJ_KATE_B = 0x59;
const SFX_STORY_CUE = 0xA2;
const WRAM_CHAR1 = 0x05, WRAM_CHAR3 = 0x07;
// the round names (include/text_ids.inc): singles rounds from Text_25_97, doubles from Text_25_101
const Text_25_97 = 0x2861, Text_25_101 = 0x2865, Text_25_105 = 0x2869;
const wTextArgFetchBuffer = 0xDF00;                   // (WRAM 5)
const WalkActorsInFromEntryPointFacings_0f = 0x7B16;   // 5 headings by entry point, then 5 for the partner's step

// QueueShortText (0F:7A8E): short text id hl into wTextArgFetchBuffer (WRAM 5), pushed as the next message's
// string argument. Keeps the registers but the text routines' (the callers set theirs after).
export function queueShortText(P, id) {
  const old = P.V.wramBank;
  P.wramBank(WRAM_CHAR3);
  P.wramBank(WRAM_CHAR1);
  fetchShortText(P, id, wTextArgFetchBuffer);
  pushTextString(P, wTextArgFetchBuffer);
  P.wramBank(old);
}
// ld a, [wMapSceneStage] (/ dec a) / ld hl, base / add l / ld l, a / jr nc / inc h: base + the round
const roundText = (P, base, minus) => (base + ((P.V.mapSceneStage - minus) & 0xFF)) & 0xFFFF;

// QueueFinishedRoundNameText (0F:78EC): the name of the round just played (wMapSceneStage - 1) as the argument
export function queueFinishedRoundNameText(P) {
  queueShortText(P, roundText(P, testFlag(P, FLAG_DOUBLES) ? Text_25_101 : Text_25_97, 1));
}

// IslandOpenBreakCutscene (0F:7911): between doubles rounds: two officials walk in and announce the round finished
// and the next one; they walk out and the player rejoins.
export function* islandOpenBreakCutscene(P) {
  const A = ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_6F_07_1, B = ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_6F_07_2;
  setPosition(P, A, 21.0, 23.0);
  setPosition(P, B, 23.0, 23.0);
  moveTarget(P, A, 35.0, 23.0);
  moveTarget(P, B, 37.0, 23.0);
  yield* waitMove(P, B);
  yield* setText(P, Text_25_105);
  yield* movePlayer(P, 35.0, 17.0);
  yield* waitPlayerMove(P);
  face(P, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_08, FACE_DOWN);
  face(P, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_06, FACE_DOWN);
  face(P, ACTOR_ISLAND_OPEN_ROUND_DOUBLES_WALK_74_07, FACE_DOWN);
  face(P, ACTOR_PLAYER, FACE_DOWN);
  face(P, ACTOR_PARTNER, FACE_DOWN);
  face(P, A, FACE_UP);
  face(P, B, FACE_UP);
  setAnim(P, A, ANIM_NOD);
  yield* waitIdle(P, A);
  queueFinishedRoundNameText(P);
  yield* speak(P, A);
  setAnim(P, A, ANIM_NOD);
  yield* waitIdle(P, A);
  queueShortText(P, roundText(P, Text_25_97, 0));                     // (the next round: the singles names' list)
  yield* speak(P, A);
  facePair(P, B, A);
  yield* wait(P, 20);
  setAnim(P, A, ANIM_NOD);
  setAnim(P, B, ANIM_NOD);
  yield* waitIdle(P, B);
  moveTarget(P, A, 21.0, 23.0);
  moveTarget(P, B, 23.0, 23.0);
  yield* waitMove(P, B);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  setPosition(P, A, 63.0, 63.0);
  setPosition(P, B, 63.0, 63.0);
  yield* waitPlayerMove(P);
}

// ReplacePartnerWithStandInActor (0F:7A17): the court sprites (SetPlayerAndPartnerObjectDefs); in doubles the
// partner is shown by the round's stand-in actor (Harry or Kate by the partner's gender) and put away itself
export function replacePartnerWithStandInActor(P) {
  setPlayerAndPartnerObjectDefs(P);
  if (!testFlag(P, FLAG_DOUBLES)) return;
  const objdef = P.V.storyModeGenderOfPartnerCharacter ? OBJ_KATE_B : OBJ_HARRY_B;
  const bc = actorState(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_07);       // .apply
  if (bc >> 8) farcall(P, BANK_ACTORS, () => loadActorObjectDef(P, bc, objdef));
  setAnim(P, ACTOR_ISLAND_OPEN_ROUND_WALK_74_07, ANIM_WALK);
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
}

// WalkActorsInFromEntryPoint_0f (0F:7AAF): the arrival walk of entry points 1-5 (none with no entry point): in
// doubles the partner steps 2 tiles at full speed along the entry's partner heading and turns to the entry's
// heading; the player walks 2 tiles along it (not waited for)
export function* walkActorsInFromEntryPoint(P) {
  const { V } = P;
  if (V.storyModeEntryPoint === STORYENTRY_NONE) return;
  const heading = k => P.rom.u8(BANK, (WalkActorsInFromEntryPointFacings_0f + k + ((V.storyModeEntryPoint - 1) & 0xFF)) & 0xFFFF);
  if (testFlag(P, FLAG_DOUBLES)) {
    setSpeed(P, ACTOR_PARTNER, 7.96875);
    moveAngleRaw(P, ACTOR_PARTNER, heading(5), 0x0200);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, heading(0));
    setSpeed(P, ACTOR_PARTNER, 0.5);
  }
  setSpeed(P, ACTOR_PLAYER, 0.5);                                     // .walkOff
  moveAngleRaw(P, ACTOR_PLAYER, heading(0), 0x0200);
}

// SetPlayerAndPartnerObjectDefs (0F:7B20): the player's (and in doubles the partner's) court sprites; the body of
// src/twins/load_court_player_partner_obj_defs.asm, written out here
export const setPlayerAndPartnerObjectDefs = P => loadCourtPlayerPartnerObjDefs(P);

// the unused map-script stubs: Unused_0f_MapScriptNopAlt (0F:7B7F), Unused_0f_MapScriptClearActiveFlag (0F:7B80,
// wStoryScriptRan = 0: a = 0, Z), Unused_0f_MapScriptPlaySoundA2 (0F:7B85), Unused_0f_MapScriptHideLocationName
// (0F:7B88, no location name: a = 0, Z)
export function unusedMapScriptClearActiveFlag(P) { P.V.storyScriptRan = 0; return { a: 0, f: 0x80 }; }
export function unusedMapScriptHideLocationName(P) { P.V.storyModeShowLocationName = 0; return { a: 0, f: 0x80 }; }

export const HOOKS = [
  [BANK, 0x78EC, hook(P => { queueFinishedRoundNameText(P); })],
  scene(BANK, 0x7911, islandOpenBreakCutscene),
  [BANK, 0x7A17, hook(P => { replacePartnerWithStandInActor(P); })],
  [BANK, 0x7A8E, hook((P, c) => { queueShortText(P, c.hl); })],
  scene(BANK, 0x7AAF, walkActorsInFromEntryPoint),
  [BANK, 0x7B20, hook(P => { setPlayerAndPartnerObjectDefs(P); })],
  [BANK, 0x7B7F, hook(() => {})],
  [BANK, 0x7B80, hook(P => unusedMapScriptClearActiveFlag(P))],
  [BANK, 0x7B85, hook(P => { sound(P, SFX_STORY_CUE); })],
  [BANK, 0x7B88, hook(P => unusedMapScriptHideLocationName(P))],
  [BANK, 0x7D43, hook(P => computeRankingProgressIndex(P))],
  [BANK, 0x7D8A, hook(P => computeStoryRankTier(P))],
];

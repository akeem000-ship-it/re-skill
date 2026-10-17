// The varsity court (bank $13, $62BE-$6B18): the partner's sprite by gender, the courtyard's walk in, Emily's tour
// of the varsity courts, two unused routines for the tour's animated sprite (its graphics, its frame task), and
// the varsity practice matches (singles and doubles). The facings, actor lists, sprite templates, LZ records,
// palette and actor scripts are data.
// Port of src/story/varsity_tour_13.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/engine/rec1.mtrec, rec2.mtrec (the courtyard walks), out/port/ss2_varsity*.mtrec (scripted: the
// tour, the practice matches, singles and doubles).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, ANIM_BOUNCE, ANIM_NOD, ANIM_WALK, FACE_DOWN, FACE_LEFT, FACE_RIGHT, FACE_UP,
  FLAG_DOUBLES, MATCHLIST_DOUBLES, MATCHLIST_SINGLES, OAM_BANK1, OBJ_PALETTES, STORYENTRY_NONE, VRAM_BANK1,
  WRAM_STAGING, beginCutscene, face, fadeIn, hook, moveAngleRaw, movePlayer, moveTarget, nullScript, playStoryMatch,
  playerSpeed, queueSpriteTemplate, requestExit, respawnActors, scene, setActorScript, setAnim, setFlag, setObjdef,
  setPosition, setSpeed, setText, sound, speak, sub8, testFlag, vTiles0, wait, waitActorScript, waitFadeEnd,
  waitIdle, waitMove, waitPlayerMove, withWram,
} from "./common.js";
import { getRegs } from "../home/cpu.js";
import { decompressData } from "../home/decompress.js";
import { queueVRAMCopy } from "../home/memory.js";
import { loadPaletteShadow } from "../home/palettes.js";
import { addToHL } from "./shared2.js";

const STORYMATCH_VARSITY_PRACTICE = 0x0A;
const VarsityCourtTourActors_13 = 0x6638;
const BANK = 0x13;
const ACTOR_PARTNER_VARIANT = 0x0D;                     // the partner-to-be's slot in the courtyard's lists
// data of this bank (read from the ROM)
const CourtyardEntryWalkInFacings_13 = 0x6366, VarsityCourtTourSpritePtrs_13 = 0x66FF;
const VarsityCourtTourLzPtrs_13 = 0x678B, VarsityCourtTourPalette_13 = 0x6A08;
const ACTOR_VARSITY_COURT_A_BETH = 0x07;
const ACTOR_VARSITY_COURT_A_CURT = 0x06;
const ACTOR_VARSITY_COURT_A_FAY = 0x05;
const ACTOR_VARSITY_COURT_A_KEVIN = 0x03;
const ACTOR_VARSITY_COURT_B_BETH = 0x07;
const ACTOR_VARSITY_COURT_B_CURT = 0x06;
const ACTOR_VARSITY_COURT_B_FAY = 0x05;
const ACTOR_VARSITY_COURT_B_KEVIN = 0x03;
const ACTOR_VARSITY_COURT_TOUR_BALLOON_QUESTION = 0x04;
const ACTOR_VARSITY_COURT_TOUR_EMILY = 0x06;
const ActorScript_13_04 = 0x6B19;
const ActorScript_13_06 = 0x6B31;
const ActorScript_13_08 = 0x6B47;
const ActorScript_13_10 = 0x6B69;
const ActorScript_13_11 = 0x6B80;
const ActorScript_13_15 = 0x6BDC;
const ActorScript_13_16 = 0x6BE7;
const FLAG_TEMP_SCENE_VARIANT_A = 0xE0;
const OBJ_HARRY = 0x28;
const SFX_EMOTE = 0x98;
const Text_30_518 = 0x206;

// ApplyPartnerCharacterVariant_13 (13:62BE): a boy partner: Harry's sprite for actor $0D, and the scenes' variant
// A flag set
export function applyPartnerCharacterVariant(P) {
  if (P.V.storyModeGenderOfPartnerCharacter) return;
  setObjdef(P, OBJ_HARRY, ACTOR_PARTNER_VARIANT);
  setAnim(P, ACTOR_PARTNER_VARIANT, ANIM_WALK);
  setFlag(P, FLAG_TEMP_SCENE_VARIANT_A);
}

// CourtyardEntryWalkIn_13 (13:62FF): (unless entering keeping the position) the walk in from the entry point:
// in doubles the partner steps 2 tiles out at full speed (CourtyardEntryWalkInFacings_13 + 3 by the entry) and
// turns (the entry's facing); the player walks 2 tiles on the entry's facing (not waited for)
export function* courtyardEntryWalkIn(P) {
  const entry = P.V.storyModeEntryPoint;
  if (entry === STORYENTRY_NONE) return;
  const facing = k => P.rom.u8(BANK, (CourtyardEntryWalkInFacings_13 + k + ((entry - 1) & 0xFF)) & 0xFFFF);
  if (testFlag(P, FLAG_DOUBLES)) {
    setSpeed(P, ACTOR_PARTNER, 7.96875);
    moveAngleRaw(P, ACTOR_PARTNER, facing(3), 0x0200);
    yield* waitMove(P, ACTOR_PARTNER);
    face(P, ACTOR_PARTNER, facing(0));
    setSpeed(P, ACTOR_PARTNER, 0.5);
  }
  setSpeed(P, ACTOR_PLAYER, 0.5);                         // .walkOff
  moveAngleRaw(P, ACTOR_PLAYER, facing(0), 0x0200);
}

// VarsityCourtTourCutscene (13:636C): Emily shows the player round the varsity courts (the question balloon,
// the player's runs to each court), then leads up the path; exit $0F
export function* varsityCourtTourCutscene(P) {
  respawnActors(P, VarsityCourtTourActors_13);
  beginCutscene(P);
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  setPosition(P, ACTOR_VARSITY_COURT_TOUR_EMILY, 63.0, 63.0);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  setPosition(P, ACTOR_VARSITY_COURT_TOUR_EMILY, 34.0, 51.0);
  moveTarget(P, ACTOR_VARSITY_COURT_TOUR_EMILY, 34.0, 29.0);
  yield* wait(P, 15);
  yield* movePlayer(P, 34.0, 29.0);
  setPosition(P, ACTOR_PLAYER, 34.0, 51.0);
  moveTarget(P, ACTOR_PLAYER, 34.0, 33.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 15);
  moveTarget(P, ACTOR_PLAYER, 32.0, 31.0);
  yield* waitMove(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  face(P, ACTOR_VARSITY_COURT_TOUR_EMILY, FACE_LEFT);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* wait(P, 30);
  yield* movePlayer(P, 12.0, 27.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 30);
  yield* setText(P, Text_30_518);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* wait(P, 15);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 34.0, 29.0);
  yield* waitPlayerMove(P);
  playerSpeed(P, 1.0);
  setPosition(P, ACTOR_VARSITY_COURT_TOUR_BALLOON_QUESTION, 33.0, 29.0);
  sound(P, SFX_EMOTE);
  yield* wait(P, 50);
  setPosition(P, ACTOR_VARSITY_COURT_TOUR_BALLOON_QUESTION, 63.0, 63.0);
  setAnim(P, ACTOR_VARSITY_COURT_TOUR_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* wait(P, 30);
  face(P, ACTOR_VARSITY_COURT_TOUR_EMILY, FACE_DOWN);
  yield* wait(P, 15);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  face(P, ACTOR_VARSITY_COURT_TOUR_EMILY, FACE_LEFT);
  yield* wait(P, 15);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 12.0, 22.0);
  yield* waitPlayerMove(P);
  playerSpeed(P, 1.0);
  yield* wait(P, 60);
  yield* movePlayer(P, 12.0, 34.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 60);
  yield* movePlayer(P, 12.0, 27.0);
  yield* waitPlayerMove(P);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* wait(P, 15);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 34.0, 29.0);
  yield* waitPlayerMove(P);
  playerSpeed(P, 1.0);
  yield* wait(P, 30);
  face(P, ACTOR_VARSITY_COURT_TOUR_EMILY, FACE_RIGHT);
  yield* wait(P, 15);
  face(P, ACTOR_PLAYER, FACE_RIGHT);
  yield* movePlayer(P, 48.0, 38.0);
  yield* waitPlayerMove(P);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* wait(P, 15);
  yield* movePlayer(P, 54.0, 16.0);
  yield* waitPlayerMove(P);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* wait(P, 15);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 34.0, 29.0);
  yield* waitPlayerMove(P);
  playerSpeed(P, 1.0);
  yield* wait(P, 15);
  face(P, ACTOR_VARSITY_COURT_TOUR_EMILY, FACE_DOWN);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* wait(P, 30);
  face(P, ACTOR_PLAYER, FACE_UP);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 15);
  setAnim(P, ACTOR_VARSITY_COURT_TOUR_EMILY, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  setAnim(P, ACTOR_PLAYER, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 30);
  setAnim(P, ACTOR_VARSITY_COURT_TOUR_EMILY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  yield* speak(P, ACTOR_VARSITY_COURT_TOUR_EMILY);
  moveTarget(P, ACTOR_PLAYER, 34.0, 31.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* wait(P, 15);
  moveTarget(P, ACTOR_VARSITY_COURT_TOUR_EMILY, 34.0, 7.0);
  yield* wait(P, 5);
  moveTarget(P, ACTOR_PLAYER, 34.0, 7.0);
  yield* wait(P, 10);
  yield* movePlayer(P, 34.0, 13.0);
  yield* waitMove(P, ACTOR_PLAYER);
  requestExit(P, 0x0F);
}

// Unused_13_DecompressVarsityCourtTourRecords (13:667A): (WRAM 1 mapped meanwhile) the four LZ records
// (VarsityCourtTourLzPtrs_13) decompressed into wDecompBuffer and queued to VRAM bank 1's $8000 + n * $100, 16
// blocks each; the palette to object palette 0. Nothing calls it. Returns a = the WRAM bank put back, F as at the
// call, b kept, c = 0 (the loop's), the palette load's.
export function unusedDecompressVarsityCourtTourRecords(P, entry) {
  const old = P.V.wramBank, buffer = P.A.decompBuffer;
  const r = withWram(P, WRAM_STAGING, () => {
    let q = {};
    for (let n = 0; n < 4; n++) {
      decompressData(P, P.rom.u16(BANK, addToHL(VarsityCourtTourLzPtrs_13, n * 2).hl), buffer);
      q = queueVRAMCopy(P, buffer, (vTiles0 + VRAM_BANK1 + (n << 8)) & 0xFFFF, 16);
    }
    return { ...q, b: entry.b, c: 0, d: OBJ_PALETTES, e: 1, hl: VarsityCourtTourPalette_13,
      ...loadPaletteShadow(P, VarsityCourtTourPalette_13, OBJ_PALETTES, 1) };
  });
  return { ...r, a: old, f: entry.f };
}
// Unused_13_QueueVarsityCourtTourSprites (13:66C3), a frame task: with the camera at (>= $18, >= $10) tiles, the
// tour's animated sprite (frame by the VBlank counter / 8) at ($70, $20) less the scroll, from VRAM bank 1.
// Nothing registers it. Returns the registers it leaves.
export function unusedQueueVarsityCourtTourSprites(P) {
  const cx = P.bus.u8(P.A.cameraX + 1);
  if (cx < 0x18) return { a: cx, f: sub8(cx, 0x18).f };      // (cp: a kept)
  const cy = P.bus.u8(P.A.cameraY + 1);
  if (cy < 0x10) return { a: cy, f: sub8(cy, 0x10).f };
  const frame = (P.V.vBlankCounter >> 3) & 0x03;
  const template = P.rom.u16(BANK, addToHL(VarsityCourtTourSpritePtrs_13, frame * 2).hl);
  return queueSpriteTemplate(P, template, sub8(0x70, P.V.scrollX).a, sub8(0x20, P.V.scrollY).a, frame << 4, OAM_BANK1);
}

// SetupStoryMinigameMatch0 (13:6A10): the varsity practice match (singles): Kevin, Curt, Beth and Fay to their
// places, the player to the court (12, 28)
export function* setupStoryMinigameMatch0(P) {
  nullScript(P, ACTOR_VARSITY_COURT_A_FAY);
  setAnim(P, ACTOR_VARSITY_COURT_A_FAY, ANIM_WALK);
  nullScript(P, ACTOR_VARSITY_COURT_A_BETH);
  setSpeed(P, ACTOR_VARSITY_COURT_A_BETH, 0.75);
  setActorScript(P, ACTOR_VARSITY_COURT_A_KEVIN, ActorScript_13_04);
  setActorScript(P, ACTOR_VARSITY_COURT_A_CURT, ActorScript_13_06);
  setActorScript(P, ACTOR_VARSITY_COURT_A_BETH, ActorScript_13_08);
  setActorScript(P, ACTOR_VARSITY_COURT_A_FAY, ActorScript_13_10);
  yield* movePlayer(P, 12.0, 28.0);
  yield* waitPlayerMove(P);
  setActorScript(P, ACTOR_PLAYER, ActorScript_13_16);
  yield* waitActorScript(P, ACTOR_VARSITY_COURT_A_FAY);
  yield* playStoryMatch(P, MATCHLIST_SINGLES, STORYMATCH_VARSITY_PRACTICE);
}

// SetupVarsityCourtDoublesMatch_13 (13:6A89): the same for doubles (Fay's nod first)
export function* setupVarsityCourtDoublesMatch(P) {
  nullScript(P, ACTOR_VARSITY_COURT_B_FAY);
  nullScript(P, ACTOR_VARSITY_COURT_B_BETH);
  setSpeed(P, ACTOR_VARSITY_COURT_B_BETH, 0.75);
  setAnim(P, ACTOR_VARSITY_COURT_B_FAY, ANIM_WALK);
  setAnim(P, ACTOR_VARSITY_COURT_B_FAY, ANIM_NOD);
  yield* waitIdle(P, ACTOR_VARSITY_COURT_B_FAY);
  setActorScript(P, ACTOR_VARSITY_COURT_B_FAY, ActorScript_13_10);
  setActorScript(P, ACTOR_VARSITY_COURT_B_CURT, ActorScript_13_11);
  setActorScript(P, ACTOR_VARSITY_COURT_B_BETH, ActorScript_13_08);
  setActorScript(P, ACTOR_PLAYER, ActorScript_13_16);
  setActorScript(P, ACTOR_PARTNER, ActorScript_13_15);
  setActorScript(P, ACTOR_VARSITY_COURT_B_KEVIN, ActorScript_13_04);
  yield* movePlayer(P, 12.0, 28.0);
  yield* waitPlayerMove(P);
  yield* waitActorScript(P, ACTOR_VARSITY_COURT_B_FAY);
  yield* playStoryMatch(P, MATCHLIST_DOUBLES, STORYMATCH_VARSITY_PRACTICE);
}

export const HOOKS = [
  // (a script-macro routine: the registers it leaves are read by no caller, and put back as at the call)
  scene(BANK, 0x62BE, function* (P) { applyPartnerCharacterVariant(P); }),
  scene(BANK, 0x62FF, courtyardEntryWalkIn),
  scene(BANK, 0x636C, varsityCourtTourCutscene),
  [BANK, 0x667A, hook((P, c) => unusedDecompressVarsityCourtTourRecords(P, getRegs(c)))],
  [BANK, 0x66C3, hook(unusedQueueVarsityCourtTourSprites)],
  scene(BANK, 0x6A10, setupStoryMinigameMatch0),
  scene(BANK, 0x6A89, setupVarsityCourtDoublesMatch),
];

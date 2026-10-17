// Twin copies: ROM routines that are instruction-identical copies (another bank or address) of routines already
// ported in a verified module, hooked here at the copies' addresses with that same JavaScript. The groups are
// the gerbiljames/mario-tennis-gbc-disasm's (MIT, third_party/mario-tennis-gbc-disasm: src/twins/ and
// tools/twins.py, docs/duplicated_code.md), whose routine names these are; live copies only (the Unused_* ones
// are never called).
// Most of these copies sit in story banks whose own modules are not verified yet: until they are, the copies ran
// as ROM code under the verified hooks. A module that hooks the same address later uses the same body.
// Verified with web/tests/port/routines_twins.mjs (the routines that do not wait) and strict lockstep of the
// recordings that reach the copies.
import * as shot from "../../engine/shot.js";
import { engine } from "../match/engine_port.js";
import { hook, scene } from "../story_scripts/common.js";
import {
  arrivalWalkUp, arrivalWalkDown, arrivalWalkLeft, computeRankingProgressIndex, computeStoryRankTier,
  loadCourtPlayerPartnerObjDefs, readSceneTilemapTile,
} from "../story_scripts/twins.js";
import { developmentFacing01 } from "../story_scripts/devmap_10.js";
import { animateDoorOpen, animateDoorClose } from "../story_scripts/dorm_13.js";
import { queueShortText } from "../story_scripts/actor_0f.js";
import { advancePlaneFrameCounter2 } from "../story_scripts/island_14.js";
import { setPartnerObjDefByGender } from "../story_scripts/ending_varsity_27.js";

// ---- the story banks ----
// [bank, addr, the verified copy it is identical to]
const STORY = [
  // academy_main_bldg_arrival01 (AcademyMainBldgArrival01_10, MapArrivalWalk_11): the player walks up
  scene(0x10, 0x5B97, arrivalWalkUp),                                  // RestaurantArrival01_10
  scene(0x12, 0x40B5, arrivalWalkUp),                                  // DormEntranceArrival01_12
  scene(0x13, 0x405F, arrivalWalkUp),                                  // RestaurantPlazaArrival04_13
  // academy_main_bldg_arrival02 (AcademyMainBldgArrival02_10, AcademyArrivalArrival01_11): the player walks down
  scene(0x12, 0x406F, arrivalWalkDown),                                // DormEntranceArrival02_12
  // restaurant_plaza_arrival06 (Court2EntryWalkIn): the player walks left
  scene(0x13, 0x40A5, arrivalWalkLeft),                                // RestaurantPlazaArrival06_13
  // compute_ranking_progress_index (ComputeRankingProgressIndex_11, Unused_27_ComputeRankingProgressIndex)
  [0x0E, 0x7E5A, hook(P => computeRankingProgressIndex(P))],           // ComputeRankingProgressIndex_0e
  [0x12, 0x7C75, hook(P => computeRankingProgressIndex(P))],           // ComputeRankingProgressIndex_12
  // compute_story_rank_tier (ComputeStoryRankTier_15)
  [0x13, 0x7D58, hook(P => computeStoryRankTier(P))],                  // ComputeStoryRankTier_13
  // QueueShortText (0F:7A8E): short text hl as the next message's string argument
  [0x0E, 0x4F3C, hook((P, c) => { queueShortText(P, c.hl); })],       // FetchAndPushShortTextArg
  [0x12, 0x7A68, hook((P, c) => { queueShortText(P, c.hl); })],       // PushTextArgFetchedString
  // load_court_player_partner_obj_defs (LoadCourtPlayerPartnerObjDefs_14, SetPlayerAndPartnerObjectDefs_11)
  [0x15, 0x475F, hook(P => { loadCourtPlayerPartnerObjDefs(P); })],    // SetPlayerPartnerActorSprites
  // AdvancePlaneFrameCounter2_14 (14:7873): wCutsceneObjX + 1
  [0x14, 0x641F, hook(P => advancePlaneFrameCounter2(P))],             // AdvancePlaneFrameCounter_14
  // AnimateDoorOpen_13 / AnimateDoorClose_13: the door frames over (20, 8)
  scene(0x27, 0x716B, animateDoorOpen),                                // OpenRestaurantEntDoor_27
  scene(0x27, 0x71BF, animateDoorClose),                               // CloseRestaurantEntDoor_27
  // SetPartnerObjDefByGender_27: a male partner's slot $0D wears Harry's sprite
  [0x13, 0x62BE, hook(P => { setPartnerObjDefByGender(P); })],         // ApplyPartnerCharacterVariant_13
  // DevelopmentFacing01_10 / DormRoomFacing01_13: the player's line. (Test2Facing01_10 and Test2Tile01_10, the
  // same twice more on the debug map Test 2, stay the ROM's: no recording reaches them — the map has no action
  // cell, and its trigger cell (50, 12) was not reached.)
  scene(0x12, 0x4CA9, developmentFacing01),                            // WallPracticeRoomFacing01_12
  // read_scene_tilemap_tile (ReadSceneTilemapTile_0f)
  [0x10, 0x7AC8, hook((P, c) => readSceneTilemapTile(P, c.bc, c.d, c.e))],   // ReadSceneTilemapTile_10
];

// ---- the ball-path banks (match/engine_hooks.js hooks one copy of each) ----
const engineHook = (bank, addr, fn) => [bank, addr, (P, c) => { fn(engine(P), c); }];
const SHOT = [
  // SetBallTargetFromAim_20 (20:41F5): the landing prediction hl along the aim line
  ...[[0x21, 0x41F5], [0x22, 0x41F5], [0x23, 0x41F5], [0x24, 0x4201], [0x2C, 0x41F9]].map(([b, a]) =>
    engineHook(b, a, (E, c) => shot.setBallTargetFromAim(E, c.hl))),   // SetBallTargetFromAim_21/22/23/24/2c
  // ApplyBallTrajectory6Capped_20 (20:4102): the bank's 6-byte rows, capped
  ...[0x21, 0x22, 0x23].map(b => engineHook(b, 0x4102, (E, c) => shot.applyBallTrajectory(E, b, c.hl, c.bc, 6, true))),   // ApplyBallTrajectory6Capped_21/22/23
];

export const HOOKS = [...STORY, ...SHOT];

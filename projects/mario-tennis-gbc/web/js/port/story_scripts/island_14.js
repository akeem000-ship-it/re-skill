// The island sky's effects (bank $14, $7190-$7FFF): the sky-effect, distant-plane and twinkle sprites (their
// graphics loads and frame tasks), the departure scene of entry $0E (the twinkle, the plane flying in, the party
// boarding and the plane flying off to the academy entrance), the plane's sound by step; the bank's map-script
// stubs and its copies of the story-rank routines. Tiles, palettes, sprite templates and actor scripts are data.
// Port of src/story/island_14.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are; Unused_14_ComputeRankingProgressIndex is src/twins/
// compute_ranking_progress_index_13.asm (twins.js), and Unused_14_ComputeStoryRankTier has the code of
// compute_story_rank_tier.asm.
// Recordings: out/port/ss1_sky*.mtrec (scripted: the island sky's entries).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FLAG_DOUBLES, testFlag, rd, wr, setPosition, nullScript, playerSpeed,
  movePlayer, wait, fadeInAndWait, fadeOutAndWait, sound, disableLCDSafely, enableLCD, registerFrameTask,
  unregisterFrameTask, queueSpriteTemplate, advanceFrame, goToLocation, loadObjGfx, sub8, vTiles0, VRAM_BANK1,
  OAM_BANK1, TILE_SIZE, hook, scene,
} from "./common.js";
import { computeRankingProgressIndex, computeStoryRankTier } from "./twins.js";
import { unusedMapScriptClearActiveFlag, unusedMapScriptHideLocationName } from "./actor_0f.js";

const BANK = 0x14;
const SFX_PLANE = 0x7B, SFX_FIREWORK_SPARKLE = 0x7D, SFX_TWINKLE = 0x84, SFX_STORY_CUE = 0xA2;
const STORYLOC_ACADEMY_ENTRANCE = 0x14;
// data of this bank
const IslandSkyTilesA_14 = 0x7190, IslandSkyTilesB_14 = 0x7290, IslandSkySpriteData_14 = 0x7350;
const AnimateIslandSkyEffectSprites_14_SpriteTemplate = 0x7371, IslandSkyPalettes_14 = 0x738A;
const DistantPlaneObjGfx = 0x7430, SpriteTemplate_14_3 = 0x7530, TwinkleObjGfx = 0x7580;
const TwinkleObjPalette_14 = 0x7680, IslandObjPalette_14 = 0x5E71;
// this module's frame tasks, and plane_14.asm's (not ported here)
const AnimateIslandSkyEffectSprites_14 = 0x73D8, QueueDistantPlaneSprite_14 = 0x755C;
const QueueTwinkleSprite_14 = 0x76AB;
const LoadPlaneObjGfx2_14 = 0x6238, QueuePlaneSpriteByFrameCounter_14 = 0x625B;

// ---- the sprites ----
// LoadIslandSkyEffectObjGfx_14 (14:73AA): the sky effects' tiles ($8100, $8200) and object palettes 1-3
export const loadIslandSkyEffectObjGfx = P => loadObjGfx(P, [[IslandSkyTilesA_14, vTiles0 + 0x10 * TILE_SIZE, 64],
  [IslandSkyTilesB_14, vTiles0 + 0x20 * TILE_SIZE, 48]], IslandSkyPalettes_14, 1, 3);
// LoadDistantPlaneObjGfx_14 (14:7539) / LoadTwinkleObjGfx_14 (14:7688): to VRAM bank 1's $8000, object palette 0
export const loadDistantPlaneObjGfx = P => loadObjGfx(P, [[DistantPlaneObjGfx, vTiles0 + VRAM_BANK1,
  (SpriteTemplate_14_3 - DistantPlaneObjGfx) / 16]], IslandObjPalette_14, 0, 1);
export const loadTwinkleObjGfx = P => loadObjGfx(P, [[TwinkleObjGfx, vTiles0 + VRAM_BANK1,
  (TwinkleObjPalette_14 - TwinkleObjGfx) / 16]], TwinkleObjPalette_14, 0, 1);

// AnimateIslandSkyEffectSprites_14 (14:73D8), a frame task: the two sky effects at (64, 64) and (104, 80) (less
// the scroll), their frame (1-3) from wCutsceneObjLimit, which counts up while wCutsceneObjActive is 0
export function animateIslandSkyEffectSprites(P) {
  const { V } = P;
  const x1 = sub8(0x40, V.scrollX).a, y1 = sub8(0x40, V.scrollY).a;
  if (!rd(P, "cutsceneObjActive")) wr(P, "cutsceneObjLimit", rd(P, "cutsceneObjLimit") + 1);
  let frame = (rd(P, "cutsceneObjLimit") >> 4) & 0x03;
  if (frame === 0x03) { wr(P, "cutsceneObjLimit", 0); frame = 0; }
  queueSpriteTemplate(P, IslandSkySpriteData_14, x1, y1, 0x10, frame + 1);
  const x2 = sub8(0x68, V.scrollX).a, y2 = sub8(0x50, V.scrollY).a;
  return queueSpriteTemplate(P, AnimateIslandSkyEffectSprites_14_SpriteTemplate, x2, y2, 0x20,
    ((rd(P, "cutsceneObjLimit") >> 4) & 0x03) + 1);
}
// GetSceneObjectScreenPos_14 (14:756D): (d, e) = (wMapSceneStage, wMapSceneStage2) less the scroll; b = hScrollY,
// a = e and the flags of its `sub`
export function getSceneObjectScreenPos(P) {
  const d = sub8(P.V.mapSceneStage, P.V.scrollX).a, e = sub8(P.V.mapSceneStage2, P.V.scrollY);
  return { d, e: e.a, a: e.a, f: e.f, b: P.V.scrollY };
}
// QueueDistantPlaneSprite_14 (14:755C), a frame task: the distant plane at the scene object's position, its
// frame wCutsceneObjPhase
export function queueDistantPlaneSprite(P) {
  const pos = getSceneObjectScreenPos(P);
  return queueSpriteTemplate(P, SpriteTemplate_14_3, pos.d, pos.e, rd(P, "cutsceneObjPhase"), OAM_BANK1);
}
// QueueTwinkleSprite_14 (14:76AB), a frame task: the twinkle at (84, 88) less the scroll, frame wCutsceneObjPhase
export function queueTwinkleSprite(P) {
  const x = sub8(0x54, P.V.scrollX).a, y = sub8(0x58, P.V.scrollY).a;
  return queueSpriteTemplate(P, SpriteTemplate_14_3, x, y, rd(P, "cutsceneObjPhase"), OAM_BANK1);
}
// AdvancePlaneFrameCounter2_14 (14:7873): wCutsceneObjX + 1 (the plane's frame counter)
export function advancePlaneFrameCounter2(P) {
  const a = (rd(P, "cutsceneObjX") + 1) & 0xFF;
  wr(P, "cutsceneObjX", a);
  return { a };
}
// PlayTwinkleAnimation_14 (14:787B): the twinkle's four frames (4 frames each), with its sound
export function* playTwinkleAnimation(P) {
  wr(P, "cutsceneObjPhase", 0);
  yield* advanceFrame(P);
  registerFrameTask(P, 0x01, QueueTwinkleSprite_14);
  sound(P, SFX_TWINKLE);
  for (let h = 4; h > 0; h--) {
    yield* wait(P, 4);
    wr(P, "cutsceneObjPhase", rd(P, "cutsceneObjPhase") + 4);
  }
  unregisterFrameTask(P, QueueTwinkleSprite_14);
}
// PlayPlaneMoveSfx_14 (14:78A7): the plane's sound on the steps whose counter h has bit 1 set (h kept; the loops
// that call it read nothing else it leaves)
export function playPlaneMoveSfx(P, h) {
  if ((h >> 1) & 0x01) sound(P, SFX_PLANE);
}

// ---- the departure (entry $0E) ----
const stage = P => P.V.mapSceneStage, stage2 = P => P.V.mapSceneStage2;
const setStage = (P, v) => { P.V.mapSceneStage = v & 0xFF; };
const setStage2 = (P, v) => { P.V.mapSceneStage2 = v & 0xFF; };
// for h = n down to 1: `frames` frames, the plane's sound, then step(h)
export function* planeSteps(P, n, frames, step) {
  for (let h = n; h > 0; h--) {
    yield* wait(P, frames);
    playPlaneMoveSfx(P, h);
    step(h);
  }
}
// IslandSkyEntry0eScene (14:76C6): the sky effects; the twinkle; the distant plane flies in; the party boards
// (out of sight) and the plane flies off; to the academy entrance (entry 2)
export function* islandSkyEntry0eScene(P) {
  disableLCDSafely(P);
  loadIslandSkyEffectObjGfx(P);
  loadTwinkleObjGfx(P);
  enableLCD(P);
  wr(P, "cutsceneObjLimit", 0, 0);
  wr(P, "cutsceneObjLimit", 0, 1);
  registerFrameTask(P, 0x01, AnimateIslandSkyEffectSprites_14);
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  }
  P.V.storyModeShowLocationName = 0;                    // .loadScene
  yield* fadeInAndWait(P, 6);
  yield* wait(P, 60);
  yield* playTwinkleAnimation(P);
  yield* wait(P, 30);
  loadDistantPlaneObjGfx(P);
  wr(P, "cutsceneObjPhase", 0x08);
  setStage(P, 0x54);
  setStage2(P, 0x58);
  registerFrameTask(P, 0x01, QueueDistantPlaneSprite_14);
  yield* planeSteps(P, 0x4B, 2, h => {                  // .fadeIn: the distant plane comes closer
    setStage2(P, stage2(P) + 1);
    setStage(P, stage(P) + 1);
    if (h === 0x2D) wr(P, "cutsceneObjPhase", 0x0C);
  });
  unregisterFrameTask(P, QueueDistantPlaneSprite_14);
  playerSpeed(P, 0.5625);
  yield* movePlayer(P, 11.0, 24.0);
  yield* planeSteps(P, 0x3C, 2, () => {});              // .burst
  P.callRom(BANK, LoadPlaneObjGfx2_14);
  setStage(P, 0xA4);
  setStage2(P, 0xC6);
  wr(P, "cutsceneObjX", 0x3C);
  registerFrameTask(P, 0x01, QueuePlaneSpriteByFrameCounter_14);
  yield* planeSteps(P, 0x20, 2, () => {                 // .nextBurst
    setStage(P, stage(P) - 1);
    if ((stage(P) & 0x03) === 0x03) setStage2(P, stage2(P) - 1);
    advancePlaneFrameCounter2(P);
  });
  yield* planeSteps(P, 0x18, 2, () => {                 // .finaleLoop
    setStage(P, stage(P) - 1);
    setStage2(P, stage2(P) - (stage(P) & 0x01));
    advancePlaneFrameCounter2(P);
  });
  yield* movePlayer(P, 11.0, 18.0);
  yield* planeSteps(P, 0x18, 3, () => {                 // .speak
    setStage2(P, stage2(P) - 1);
    setStage(P, stage(P) - 1);
    advancePlaneFrameCounter2(P);
  });
  yield* planeSteps(P, 0x08, 4, () => {                 // .fadeOut
    setStage2(P, stage2(P) - 1);
    setStage(P, stage(P) - (stage2(P) & 0x01));
    advancePlaneFrameCounter2(P);
  });
  yield* planeSteps(P, 0x0C, 6, () => {                 // .done
    setStage2(P, stage2(P) - 1);
    advancePlaneFrameCounter2(P);
  });
  sound(P, SFX_FIREWORK_SPARKLE);
  yield* wait(P, 70);
  yield* fadeOutAndWait(P, 4);
  goToLocation(P, STORYLOC_ACADEMY_ENTRANCE, 0x02);
}

const SFX_HOOK = hook(P => { sound(P, SFX_STORY_CUE); });
export const HOOKS = [
  [BANK, 0x73AA, hook(P => { loadIslandSkyEffectObjGfx(P); })],
  [BANK, 0x73D8, hook(P => { animateIslandSkyEffectSprites(P); })],
  [BANK, 0x7539, hook(P => { loadDistantPlaneObjGfx(P); })],
  [BANK, 0x755C, hook(P => { queueDistantPlaneSprite(P); })],
  [BANK, 0x756D, hook(P => getSceneObjectScreenPos(P))],
  [BANK, 0x7688, hook(P => { loadTwinkleObjGfx(P); })],
  [BANK, 0x76AB, hook(P => { queueTwinkleSprite(P); })],
  scene(BANK, 0x76C6, islandSkyEntry0eScene),
  [BANK, 0x7873, hook(P => advancePlaneFrameCounter2(P))],
  scene(BANK, 0x787B, playTwinkleAnimation),
  [BANK, 0x78A7, hook((P, cpu) => { playPlaneMoveSfx(P, cpu.h); })],
  [BANK, 0x78D9, hook(() => {})],                                     // MapScriptNop_14
  [BANK, 0x78DA, hook(P => unusedMapScriptClearActiveFlag(P))],       // Unused_14_MapScriptClearActiveFlag
  [BANK, 0x78DF, SFX_HOOK],                                           // Unused_14_MapScriptPlaySoundA2
  [BANK, 0x78E2, hook(P => unusedMapScriptHideLocationName(P))],      // Unused_14_MapScriptHideLocationName
  [BANK, 0x7A9D, hook(P => computeRankingProgressIndex(P))],          // Unused_14_ComputeRankingProgressIndex
  [BANK, 0x7AE4, hook(P => computeStoryRankTier(P))],                 // Unused_14_ComputeStoryRankTier
];

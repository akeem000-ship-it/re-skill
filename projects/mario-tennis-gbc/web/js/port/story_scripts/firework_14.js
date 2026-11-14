// The island sky's fireworks and departure (bank $14, $6427-$7190): the two firework sprites (their graphics, the
// frame tasks that rise and burst them), the fireworks scene after the Island Open final (entry 8: nine bursts,
// then the awards ceremony), and the departure of entries $0D/$0F (the plane takes the party off the island and
// flies away: on to Peach's Castle or, the first time the story is complete, the main menu). Tiles, palettes, the
// sprite template, the timing tables and the actor list are data.
// Port of src/story/firework_14.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_sky*.mtrec (scripted: the fireworks, the departure).
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FLAG_DOUBLES, BANK_SAVE, testFlag, setFlag, rd, wr, setPosition, nullScript,
  playerSpeed, movePlayer, waitPlayerMove, wait, fadeInAndWait, fadeOutAndWait, sound, disableLCDSafely, enableLCD,
  clearFrameTasks, registerFrameTask, unregisterFrameTask, queueSpriteTemplate, respawnActors, beginCutscene,
  goToLocation, requestExit, saveReturnPoint, loadObjGfx, sub8, vTiles0, TILE_SIZE, hook, scene,
} from "./common.js";
import {
  loadIslandSkyEffectObjGfx, loadDistantPlaneObjGfx, loadTwinkleObjGfx, playTwinkleAnimation, planeSteps,
} from "./island_14.js";

const BANK = 0x14;
const SFX_FIREWORK_LAUNCH = 0x7A, SFX_FIREWORK = 0x81;
const FLAG_STORY_COMPLETE_SINGLES = 0xB0, FLAG_STORY_COMPLETE_DOUBLES = 0xB1;
const FLAG_REACHED_MARIO_WORLD_SINGLES = 0xB2, FLAG_REACHED_MARIO_WORLD_DOUBLES = 0xB3;
const STORYLOC_MAIN_MENU = 0x00, STORYLOC_AWARDS_CEREMONY = 0x1A, STORYLOC_PEACHS_CASTLE = 0x1D;
const SaveStorySlotWithTimer = 0x4D10;
const BUTTON_B = 0x02;
// data of this bank
const Table_14 = 0x64D5, UpdateFirework0_14Table = 0x64D9, UpdateFirework1_14Table = 0x64DD;
const FireworkMapActors_14 = 0x6675, FireworkObjTiles_14 = 0x6680, SpriteTemplate_14_2 = 0x6E80;
const FireworkObjPalettes_14 = 0x6EA1;
// the frame tasks (this module's, island_14's and plane_14.asm's)
const UpdateFirework0_14 = 0x644A, UpdateFirework1_14 = 0x6EF0, QueuePlaneSpriteByHeight_14 = 0x5E9C;
const AnimateIslandSkyEffectSprites_14 = 0x73D8, QueueDistantPlaneSprite_14 = 0x755C;
const LoadPlaneObjGfx_14 = 0x5E79;                      // plane_14.asm (not ported here)
const FIREWORK_DONE = 0x04;                             // wCutsceneObjPhase: 0 rising, 1-3 bursting, 4 over

// LoadFireworkObjGfx_14 (14:6427): the fireworks' tiles ($8100) and object palettes 1-4
export const loadFireworkObjGfx = P => loadObjGfx(P, [[FireworkObjTiles_14, vTiles0 + 0x10 * TILE_SIZE,
  (SpriteTemplate_14_2 - FireworkObjTiles_14) / 16]], FireworkObjPalettes_14, 1, 4);

// UpdateFirework0_14 (14:644A) / UpdateFirework1_14 (14:6EF0), frame tasks: firework i (its wCutsceneObj* bytes
// i): rising while phase 0 (AdvanceFirework*Ascent_14), each phase lasting its Table_14 frames, the burst's sound
// at its start; its sprite at (x, y) less the scroll, the tile from the firework's phase table, the palette from
// its timer
export function updateFirework(P, i, burstTable) {
  if (rd(P, "cutsceneObjPhase", i) >= FIREWORK_DONE) return;
  if (rd(P, "cutsceneObjPhase", i) === 0) advanceFireworkAscent(P, i);
  const x = sub8(rd(P, "cutsceneObjX", i), P.V.scrollX).a, y = sub8(rd(P, "cutsceneObjY", i), P.V.scrollY).a;  // .draw
  const timer = (rd(P, "cutsceneObjTimer", i) - 1) & 0xFF;
  wr(P, "cutsceneObjTimer", timer, i);
  if (!timer) {
    const phase = (rd(P, "cutsceneObjPhase", i) + 1) & 0xFF;
    wr(P, "cutsceneObjPhase", phase, i);
    if (phase >= FIREWORK_DONE) return;
    wr(P, "cutsceneObjTimer", P.rom.u8(BANK, Table_14 + phase), i);
    if (phase === 1 && rd(P, "cutsceneObjTimer", i) === 0x0C) sound(P, SFX_FIREWORK);
  }
  const phase = rd(P, "cutsceneObjPhase", i);           // .burstSprite
  const tile = (P.rom.u8(BANK, burstTable + phase) + 0x10) & 0xFF;
  const palette = ((rd(P, "cutsceneObjTimer", i) >> 1) & 0x03) + 1;
  queueSpriteTemplate(P, SpriteTemplate_14_2, x, y, tile, palette);
}
// AdvanceFirework0Ascent_14 (14:64BE) / AdvanceFirework1Ascent_14 (14:6F64): firework i up 3 pixels a frame,
// 2 from timer $13 down, 1 from 9 down. Returns a (the new y), b (the step) and the `sub`'s flags.
export function advanceFireworkAscent(P, i) {
  const timer = rd(P, "cutsceneObjTimer", i);
  const b = timer >= 0x14 ? 3 : timer >= 0x0A ? 2 : 1;
  const r = sub8(rd(P, "cutsceneObjY", i), b);
  wr(P, "cutsceneObjY", r.a, i);
  return { ...r, b };
}
// firework i from (x, y), its first phase lasting timer frames
function launch(P, i, x, y, timer) {
  wr(P, "cutsceneObjX", x, i);
  wr(P, "cutsceneObjY", y, i);
  wr(P, "cutsceneObjPhase", 0, i);
  wr(P, "cutsceneObjTimer", timer, i);
}

// IslandSkyInitScript_14.scriptRespawnLocationActors (14:64E1), the island sky's entry 8: the fireworks scene's
// actors and the cutscene mode, the fireworks' graphics; the party out of sight
export function* islandSkyFireworkScene(P) {
  respawnActors(P, FireworkMapActors_14);
  beginCutscene(P);
  disableLCDSafely(P);
  loadFireworkObjGfx(P);
  enableLCD(P);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  }
  yield* islandSkyFireworks(P);
}
// IslandSkyInitScript_14.placeActors2 (14:650B): the player too; a fade in, the camera's slow pan, the nine
// bursts; to the awards ceremony (entry $0B in doubles, $0A in singles)
export function* islandSkyFireworks(P) {
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  P.V.storyModeShowLocationName = 0;
  yield* fadeInAndWait(P, 4);
  playerSpeed(P, 0.1875);
  yield* movePlayer(P, 5.0, 35.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 50);
  launch(P, 1, 0x50, 0x28, 0x1E);
  registerFrameTask(P, 0x01, UpdateFirework1_14);
  yield* wait(P, 80);
  launch(P, 0, 0x40, 0x20, 0x1E);
  registerFrameTask(P, 0x01, UpdateFirework0_14);
  yield* wait(P, 80);
  const bursts = [[1, 0x48, 0x28, 0x1E, 40], [0, 0x38, 0x20, 0x1E, 40], [1, 0x50, 0x28, 0x19, 40],
    [0, 0x38, 0x20, 0x1A, 40], [1, 0x58, 0x28, 0x1C, 40], [0, 0x40, 0x20, 0x16, 50], [1, 0x48, 0x28, 0x1C, 72]];
  for (const [i, x, y, timer, frames] of bursts) {
    launch(P, i, x, y, timer);
    yield* wait(P, frames);
  }
  yield* fadeOutAndWait(P, 4);
  clearFrameTasks(P);
  if (testFlag(P, FLAG_DOUBLES)) goToLocation(P, STORYLOC_AWARDS_CEREMONY, 0x0B);
  else islandSkyFireworksToCeremony(P);
}
// IslandSkyInitScript_14.notDoubles (14:6662)
export const islandSkyFireworksToCeremony = P => goToLocation(P, STORYLOC_AWARDS_CEREMONY, 0x0A);

// Unused_14_ResetFireworkObjOnButton (14:6EC1): with B pressed, both fireworks launched again
export function unusedResetFireworkObjOnButton(P) {
  if (!(P.V.inputRisingEdge & BUTTON_B)) return;
  launch(P, 0, 0x40, 0x30, 0x1E);
  launch(P, 1, 0x68, 0x38, 0x1E);
}

// IslandSkyEntry0fAnd0dScene (14:6F7B): the departure: the plane lands (its sprite placed by wMapSceneStage/
// Stage2), the party boards out of sight, the plane takes off and flies into the distance; the twinkle. Entry $0D
// (seen again) leaves through exit 1; else the story's end: the first time to the main menu (the return point at
// Peach's Castle saved), later to Peach's Castle (entry 1 once Mario World is reached, else $0F)
export function* islandSkyEntry0fAnd0dScene(P) {
  const { V } = P;
  const stage = () => V.mapSceneStage, stage2 = () => V.mapSceneStage2;
  const setStage = v => { V.mapSceneStage = v & 0xFF; }, setStage2 = v => { V.mapSceneStage2 = v & 0xFF; };
  disableLCDSafely(P);
  P.callRom(BANK, LoadPlaneObjGfx_14);
  loadIslandSkyEffectObjGfx(P);
  enableLCD(P);
  setStage(0x50);
  setStage2(0x88);
  registerFrameTask(P, 0x01, QueuePlaneSpriteByHeight_14);
  wr(P, "cutsceneObjLimit", 0, 0);
  wr(P, "cutsceneObjLimit", 0, 1);
  wr(P, "cutsceneObjActive", 0);
  registerFrameTask(P, 0x01, AnimateIslandSkyEffectSprites_14);
  setPosition(P, ACTOR_PLAYER, 63.0, 63.0);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  }
  V.storyModeShowLocationName = 0;                      // .fadeIn
  yield* fadeInAndWait(P, 6);
  sound(P, SFX_FIREWORK_LAUNCH);
  yield* wait(P, 60);
  yield* planeSteps(P, 0x08, 6, () => setStage2(stage2() + 1));                                // .planeLoop
  yield* planeSteps(P, 0x08, 4, () => { setStage2(stage2() + 1); setStage(stage() + (stage2() & 0x01)); });  // .planeArrived
  yield* planeSteps(P, 0x18, 3, () => { setStage2(stage2() + 1); setStage(stage() + 1); });  // .descend
  playerSpeed(P, 0.5625);
  yield* movePlayer(P, 11.0, 24.0);
  yield* planeSteps(P, 0x18, 2, () => { setStage(stage() + 1); setStage2(stage2() + (stage() & 0x01)); });  // .land
  yield* planeSteps(P, 0x20, 2, () => {                 // .disembark
    setStage(stage() + 1);
    if ((stage() & 0x03) === 0x03) setStage2(stage2() + 1);
  });
  unregisterFrameTask(P, QueuePlaneSpriteByHeight_14);
  yield* planeSteps(P, 0x1E, 2, () => {});              // .doublesWalkOff
  yield* movePlayer(P, 11.0, 13.0);
  loadDistantPlaneObjGfx(P);
  wr(P, "cutsceneObjPhase", 0x04);
  setStage2(0xA8);
  registerFrameTask(P, 0x01, QueueDistantPlaneSprite_14);
  yield* planeSteps(P, 0x50, 2, h => {                  // .speak: off into the distance
    setStage2(stage2() - 1);
    setStage(stage() - 1);
    if (h === 0x1E) wr(P, "cutsceneObjPhase", 0x00);
  });
  unregisterFrameTask(P, QueueDistantPlaneSprite_14);
  loadTwinkleObjGfx(P);
  yield* playTwinkleAnimation(P);
  yield* wait(P, 70);
  if (V.storyModeEntryPoint === 0x0D) {
    wr(P, "cutsceneObjActive", 1);
    requestExit(P, 0x01);
    return;
  }
  const doubles = testFlag(P, FLAG_DOUBLES);            // .fadeOut / .transition
  const complete = doubles ? FLAG_STORY_COMPLETE_DOUBLES : FLAG_STORY_COMPLETE_SINGLES;
  if (!testFlag(P, complete)) {
    setFlag(P, complete);
    saveReturnPoint(P, STORYLOC_PEACHS_CASTLE, 0x0F);   // .setLocation
    yield* P.runRom(BANK_SAVE, SaveStorySlotWithTimer);
    yield* fadeOutAndWait(P, 1);
    goToLocation(P, STORYLOC_MAIN_MENU, 0x0A);
    return;
  }
  const marioWorld = testFlag(P, doubles ? FLAG_REACHED_MARIO_WORLD_DOUBLES : FLAG_REACHED_MARIO_WORLD_SINGLES);
  yield* fadeOutAndWait(P, 4);                          // .finish / .done
  goToLocation(P, STORYLOC_PEACHS_CASTLE, marioWorld ? 0x01 : 0x0F);
}

export const HOOKS = [
  [BANK, 0x6427, hook(P => { loadFireworkObjGfx(P); })],
  [BANK, 0x644A, hook(P => { updateFirework(P, 0, UpdateFirework0_14Table); })],
  [BANK, 0x64BE, hook(P => advanceFireworkAscent(P, 0))],
  scene(BANK, 0x64E1, islandSkyFireworkScene),                         // IslandSkyInitScript_14.scriptRespawnLocationActors
  scene(BANK, 0x650B, islandSkyFireworks),                             // IslandSkyInitScript_14.placeActors2
  [BANK, 0x6662, hook(P => { islandSkyFireworksToCeremony(P); })],     // IslandSkyInitScript_14.notDoubles
  [BANK, 0x6EC1, hook(P => { unusedResetFireworkObjOnButton(P); })],
  [BANK, 0x6EF0, hook(P => { updateFirework(P, 1, UpdateFirework1_14Table); })],
  [BANK, 0x6F64, hook(P => advanceFireworkAscent(P, 1))],
  scene(BANK, 0x6F7B, islandSkyEntry0fAnd0dScene),
];

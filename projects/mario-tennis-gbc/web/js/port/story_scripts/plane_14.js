// The plane and the water splashes of the island sky (bank $14, $5E79-$6426): the plane's graphics (two sets) and
// its sprite (sized by height, or by the flight's frame counter), the two water splashes (frame tasks: rising,
// hit, scored and respawned at random), and the arrival flight of entry 2 (the plane comes in, lands, the party
// walks off out of sight, the plane leaves; on to the academy entrance). Tiles, palettes, sprite templates and the
// actor script are data.
// Port of src/story/plane_14.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss1_sky*.mtrec (part 1's scripted island sky: the splashes, the plane), out/port/
// ss2_sky02*.mtrec (scripted: entry 2's flight, singles and doubles).
import {
  ACTOR_PARTNER, ACTOR_PLAYER, FC, FH, FLAG_DOUBLES, FZ, OAM_BANK1, OBJ_PALETTES, TILE_SIZE, VRAM_BANK1,
  WRAM_STAGING, clearFlag, clearFrameTasks, disableLCDSafely, enableLCD, fadeIn, fadeOutAndWait, goToLocation, hook,
  movePlayerToActor, nullScript, playerSpeed, queueSpriteTemplate, rd, registerFrameTask, scene, setActive,
  setPosition, sound, sub8, testFlag, tiles, vTiles0, wait, waitFadeEnd, withWram, wr,
} from "./common.js";
import { queueVRAMCopy } from "../home/memory.js";
import { loadPaletteShadow } from "../home/palettes.js";
import { advanceRandomSeed } from "../home/joypad.js";
import { getSceneObjectScreenPos, planeSteps, playPlaneMoveSfx } from "./island_14.js";

const BANK = 0x14;
const ACTOR_ISLAND_SKY_WALK_75_06 = 0x03;
const FLAG_ISLAND_SKY_SCENE_ACTIVE = 0x4F;
const SFX_FIREWORK_LAUNCH = 0x7A, SFX_FIREWORK_SPARKLE = 0x7D, SFX_SPLASH = 0x7E;
const STORYLOC_ACADEMY_ENTRANCE = 0x14;
// data of this bank (read from the ROM)
const PlaneObjTiles_14 = 0x5650, IslandObjTiles_14 = 0x5A50, SpriteTemplate_14_0 = 0x5E50;
const IslandObjPalette_14 = 0x5E71, WaterSplashObjGfx = 0x5ED0, SpriteTemplate_14_1 = 0x6090;
const WaterSplashObjPalette_14 = 0x6099;
const QueuePlaneSpriteByFrameCounter_14 = 0x625B;
const PLANE_TILE_BLOCKS = 96, SPLASH_TILE_BLOCKS = (SpriteTemplate_14_1 - WaterSplashObjGfx) / 16;

// push_wram_bank WRAM_STAGING / QueueVRAMCopy / LoadPaletteShadow / pop_wram_bank: tiles and object palettes
// (first, count); a = the WRAM bank put back, F as at the call, the rest as LoadPaletteShadow leaves them
function loadGfx(P, entryF, tiles, dest, blocks, pals, first, count) {
  const old = P.V.wramBank;
  const r = withWram(P, WRAM_STAGING, () => {
    queueVRAMCopy(P, tiles, dest, blocks);
    return loadPaletteShadow(P, pals, OBJ_PALETTES + first, count);
  });
  return { ...r, a: old, f: entryF };
}
// LoadPlaneObjGfx_14 (14:5E79) / LoadPlaneObjGfx2_14 (14:6238): the plane's tiles (two sets) to VRAM bank 1's
// $8000, object palette 0
export const loadPlaneObjGfx = (P, f) => loadGfx(P, f, PlaneObjTiles_14, vTiles0 + VRAM_BANK1, PLANE_TILE_BLOCKS,
  IslandObjPalette_14, 0, 1);
export const loadPlaneObjGfx2 = (P, f) => loadGfx(P, f, IslandObjTiles_14, vTiles0 + VRAM_BANK1, PLANE_TILE_BLOCKS,
  IslandObjPalette_14, 0, 1);
// LoadWaterSplashObjGfx_14 (14:60A1): the splash's tiles to $8200, object palette 1
export const loadWaterSplashObjGfx = (P, f) => loadGfx(P, f, WaterSplashObjGfx, vTiles0 + 0x20 * TILE_SIZE,
  SPLASH_TILE_BLOCKS, WaterSplashObjPalette_14, 1, 1);

// the plane's sprite (SpriteTemplate_14_0, VRAM bank 1) at the scene object's position, with frame `tile`
function queuePlane(P, tile) {
  const pos = getSceneObjectScreenPos(P);
  return queueSpriteTemplate(P, SpriteTemplate_14_0, pos.d, pos.e, tile, OAM_BANK1);
}
// the frame by the first threshold above v: [[limit, tile], ...], else `last`
const byThreshold = (v, steps, last) => { for (const [limit, tile] of steps) if (v < limit) return tile; return last; };
// QueuePlaneSpriteByHeight_14 (14:5E9C), a frame task: the frame by the height (wMapSceneStage2 - $88): small
// near the water, larger higher up
export const queuePlaneSpriteByHeight = P => queuePlane(P, byThreshold((P.V.mapSceneStage2 - 0x88) & 0xFF,
  [[0x0A, 0x00], [0x14, 0x10], [0x1E, 0x20], [0x50, 0x30], [0x78, 0x20]], 0x10));
// QueuePlaneSpriteByFrameCounter_14 (14:625B), a frame task: the frame by the flight's counter (wCutsceneObjX)
export const queuePlaneSpriteByFrameCounter = P => queuePlane(P, byThreshold(rd(P, "cutsceneObjX"),
  [[0x14, 0x10], [0x1E, 0x20], [0x5A, 0x30], [0x78, 0x20], [0x8C, 0x10]], 0x00));

// ---- the water splashes ----
// AdvanceWaterSplash0Rise_14 (14:616B) / AdvanceWaterSplash1Rise_14 (14:6225): while splash i's rise timer runs,
// it counts down and the splash rises 2 pixels. Returns a and F.
export function advanceWaterSplashRise(P, i) {
  const t = rd(P, "cutsceneObjRiseTimer", i);
  if (!t) return { a: 0, f: FZ | FH };                    // (and a)
  wr(P, "cutsceneObjRiseTimer", t - 1, i);
  const y = sub8(rd(P, "cutsceneObjY", i), 0x02);
  wr(P, "cutsceneObjY", y.a, i);
  return y;
}
// UpdateWaterSplash0_14 (14:60C4) / UpdateWaterSplash1_14 (14:617E), frame tasks: splash i at (x, y + 32) less the
// scroll, rising while inactive. Inactive, or active and past its frame limit: hit (while rising: its timer to 8,
// back to the first frame) or, risen, scored: every 8 frames a step right and the next frame (the splash sound
// from the 9th); past its last frame (and its limit) it respawns at random (x $40-$5E, limit from the random word:
// splash 0 h & $3C, splash 1 l & $3F; y h & $0F; rising 16 frames), not drawn that frame; else drawn (frame + $20)
export function updateWaterSplash(P, i, entry) {
  const obj = (name, v) => (v === undefined ? rd(P, name, i) : wr(P, name, v, i));
  const d = sub8(obj("cutsceneObjX"), P.V.scrollX).a;
  let r = { c: entry.c, h: entry.h, l: entry.l };
  if (!obj("cutsceneObjActive")) advanceWaterSplashRise(P, i);
  const e = (((obj("cutsceneObjY") + 0x20) & 0xFF) - P.V.scrollY) & 0xFF;
  const regs = (a, b, f, more = {}) => ({ ...r, a, b, d, e, f, ...more });
  // cp $14 / jr c, .respawn / cp b / jr c, .done (the phase against the limit); null: past both
  const past = () => {
    const b = obj("cutsceneObjLimit"), a = obj("cutsceneObjPhase");
    if (a < 0x14) return "respawn";
    if (a < b) return regs(a, b, sub8(a, b).f);
    return null;
  };
  let out = obj("cutsceneObjActive") ? past() : null;
  if (out === null) {                                     // .hit
    if (obj("cutsceneObjRiseTimer")) {
      obj("cutsceneObjTimer", 0x08);
      obj("cutsceneObjPhase", 0x00);
      out = "respawn";
    } else {                                              // .scorePoint
      const t = (obj("cutsceneObjTimer") + 1) & 0xFF;
      obj("cutsceneObjTimer", t);
      if (t >= 0x08) {
        if (t !== 0x08) sound(P, SFX_SPLASH);
        obj("cutsceneObjX", obj("cutsceneObjX") + 1);     // .playSfx
        obj("cutsceneObjTimer", 0);
        obj("cutsceneObjPhase", obj("cutsceneObjPhase") + 0x04);
      }
      out = past();                                       // .advance
      if (out === null) {                                 // respawn at random
        const b = obj("cutsceneObjLimit");
        obj("cutsceneObjPhase", 0);
        const hl = advanceRandomSeed(P), h = hl >> 8, l = hl & 0xFF;
        r = { ...r, h, l };
        obj("cutsceneObjX", ((l & 0x0F) * 2 + 0x40) & 0xFF);
        obj("cutsceneObjLimit", i === 0 ? h & 0x3C : l & 0x3F);
        const y = h & 0x0F;
        obj("cutsceneObjY", y);
        obj("cutsceneObjRiseTimer", 0x10);
        out = regs(0x10, b, (y ? 0 : FZ) | FH);
      }
    }
  }
  if (out !== "respawn") return out;
  return queueSpriteTemplate(P, SpriteTemplate_14_1, d, e, (obj("cutsceneObjPhase") + 0x20) & 0xFF, 0x01);
}

// AdvancePlaneFrameCounter_14 (14:641F): the flight's frame counter (wCutsceneObjX) + 1. Returns a and the flags of
// the `inc a` (carry kept).
export function advancePlaneFrameCounter(P, entryF = P.cpu.f) {
  const a = (rd(P, "cutsceneObjX") + 1) & 0xFF;
  wr(P, "cutsceneObjX", a);
  return { a, f: (a ? 0 : FZ) | ((a & 0x0F) === 0 ? FH : 0) | (entryF & FC) };
}
// IslandSkyEntry02Scene (14:628B): the arrival flight. The plane's second graphics and its sprite (by the frame
// counter) at (32, 40); the player out of sight (and the partner); faded in, the launch sound; the plane flies in,
// comes down and lands (the player walks to the plane), flies along the water until it is past x $50, then away;
// the sparkle, faded out, to the academy entrance (entry 2)
export function* islandSkyEntry02Scene(P) {
  const { V } = P;
  const setStage = v => { V.mapSceneStage = v & 0xFF; }, setStage2 = v => { V.mapSceneStage2 = v & 0xFF; };
  const fly = () => { setStage2(V.mapSceneStage2 - 1); advancePlaneFrameCounter(P); };
  clearFlag(P, FLAG_ISLAND_SKY_SCENE_ACTIVE);
  disableLCDSafely(P);
  loadPlaneObjGfx2(P, P.cpu.f);
  enableLCD(P);
  setStage(0x20);
  setStage2(0x28);
  wr(P, "cutsceneObjX", 0x00);
  registerFrameTask(P, 0x01, QueuePlaneSpriteByFrameCounter_14);
  setActive(P, ACTOR_PLAYER, 0x00);
  setActive(P, ACTOR_ISLAND_SKY_WALK_75_06, 0x00);
  if (testFlag(P, FLAG_DOUBLES)) {
    nullScript(P, ACTOR_PARTNER);
    setPosition(P, ACTOR_PARTNER, 63.0, 63.0);
  }
  V.storyModeShowLocationName = 0;                        // .fadeIn
  fadeIn(P, 6);
  yield* waitFadeEnd(P);
  sound(P, SFX_FIREWORK_LAUNCH);
  yield* wait(P, 60);
  setPosition(P, ACTOR_PLAYER, 12.0, 19.0);
  yield* planeSteps(P, 0x08, 6, fly);                     // .planeLoop
  yield* planeSteps(P, 0x08, 5, h => { if (h & 0x01) setStage(V.mapSceneStage + 1); fly(); });   // .planeLoop2
  yield* planeSteps(P, 0x08, 4, () => { setStage(V.mapSceneStage + 1); fly(); });                // .descend
  playerSpeed(P, 0.5625);
  yield* movePlayerToActor(P, ACTOR_PLAYER);
  yield* planeSteps(P, 0x1C, 3, h => { if (h & 0x01) setStage(V.mapSceneStage + 1); fly(); });   // .land
  let h = 0x00;
  do {                                                    // .walkOff
    yield* wait(P, 3);
    h = (h + 1) & 0xFF;
    playPlaneMoveSfx(P, h);
    setStage2(V.mapSceneStage2 - 1);
    if ((V.mapSceneStage2 & 0x03) === 0x03) setStage(V.mapSceneStage + 1);
    advancePlaneFrameCounter(P);                          // .speak
  } while (V.mapSceneStage !== 0x50);
  yield* planeSteps(P, 0x08, 4, fly);                     // .speakDoubles
  yield* planeSteps(P, 0x08, 6, fly);                     // .fadeOut
  yield* planeSteps(P, 0x08, 8, fly);                     // .done
  sound(P, SFX_FIREWORK_SPARKLE);
  yield* wait(P, 50);
  yield* fadeOutAndWait(P, 4);
  clearFrameTasks(P);
  goToLocation(P, STORYLOC_ACADEMY_ENTRANCE, 0x02);
}

export const HOOKS = [
  [BANK, 0x5E79, hook((P, c) => loadPlaneObjGfx(P, c.f))],
  [BANK, 0x5E9C, hook(queuePlaneSpriteByHeight)],
  [BANK, 0x60A1, hook((P, c) => loadWaterSplashObjGfx(P, c.f))],
  [BANK, 0x60C4, hook((P, c) => updateWaterSplash(P, 0, c))],
  [BANK, 0x616B, hook(P => advanceWaterSplashRise(P, 0))],
  [BANK, 0x617E, hook((P, c) => updateWaterSplash(P, 1, c))],
  [BANK, 0x6225, hook(P => advanceWaterSplashRise(P, 1))],
  [BANK, 0x6238, hook((P, c) => loadPlaneObjGfx2(P, c.f))],
  [BANK, 0x625B, hook(queuePlaneSpriteByFrameCounter)],
  scene(BANK, 0x628B, islandSkyEntry02Scene),
  [BANK, 0x641F, hook((P, c) => advancePlaneFrameCounter(P, c.f))],
];

// The special court (bank $0E, $7082-$7B10): the exhibition declined (Bowser's tantrum, the screen shaking), the star
// warp to the court (its sprite flying the path, the sparkle trail, the fade), and the court's init script: the
// match intro by entry point (singles: Toad and the player walk in, Peach's word, Mario takes his side; doubles:
// all four walk in and line up) or the match's result.
// The star warp's palette, tiles, frame and path tables, the court's map tables and actor scripts are data.
// Port of src/story/specialcourt_0e.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/
// mario-tennis-gbc-disasm), whose routine names these are.
// Recordings: out/port/ss2_mw*.mtrec, ss2_special*.mtrec (scripted: the exhibition offer taken and declined, the
// special court's intro in singles and doubles); tests: web/tests/port/routines_story_scripts2.mjs.
import {
  ACTOR_PLAYER, ACTOR_PARTNER, FACE_RIGHT, FACE_DOWN, FACE_LEFT, FACE_UP, ANIM_BOUNCE, ANIM_NOD, FLAG_DOUBLES,
  FZ, FN, FH, FC, WRAM_SCENE, OBJ_PALETTES, vTiles0, VRAM_BANK1, TILE_SIZE, testFlag, setText, speak, setAnim,
  waitIdle, wait, face, setPosition, moveTarget, waitMove, movePlayer, waitPlayerMove, setSpeed, playerSpeed,
  jumpVelocity, setActorScript, waitActorScript, nullScript, copySceneRect, screenShake, fadeIn, waitFadeEnd, sound,
  requestExit, loadPaletteShadow, queueVRAMCopy, registerFrameTask, unregisterFrameTask, advanceFrame, beginFadeOut,
  hook, scene,
} from "./common.js";
import { queueSprite } from "../home/fade.js";
import { prepareStoryMatch, handleExhibitionMatchResult } from "./match_setup_0e.js";

const BANK = 0x0E;
// Mario World's actors (the declined scene's)
const ACTOR_MARIO_WORLD_BALLOON_ANGRY = 0x07, ACTOR_MARIO_WORLD_PEACH = 0x08, ACTOR_MARIO_WORLD_WALUIGI = 0x0E;
const ACTOR_MARIO_WORLD_BOWSER = 0x0F, ACTOR_MARIO_WORLD_WARIO = 0x10;
// the special court's actors (SpecialCourtActors_0e)
const ACTOR_SPECIAL_COURT_PEACH = 0x03, ACTOR_SPECIAL_COURT_MARIO = 0x0D, ACTOR_SPECIAL_COURT_TOAD = 0x0E;
const FLAG_ENDING_CREDITS_RUNNING = 0x6E;
const SFX_IMPACT = 0x70, SFX_APPEAR1 = 0x99, BGM_WIN = 0x09;
const Text_5e_169 = 0x30A9, Text_5e_170 = 0x30AA;
const ActorScript_0e_16 = 0x7B11, ActorScript_0e_17 = 0x7B24, ActorScript_0e_18 = 0x7B2F, ActorScript_0e_19 = 0x7B46;
const ActorScript_0e_20 = 0x7B5D, ActorScript_0e_21 = 0x7B6E, ActorScript_0e_22 = 0x7C6E;
// the star warp (data of this bank)
const StarWarpPalette = 0x72CE, StarWarpTiles = 0x72E0, StarWarpSparkleTiles = 0x7460, StarWarpFrameSprites = 0x7480;
const StarWarpPathX = 0x748C, StarWarpPathY = 0x7541, UpdateStarWarpSprite = 0x71E9;
const STAR_WARP_FRAMES = 6, STAR_WARP_COUNTDOWN = 0x5A, STAR_WARP_FADE_AT = 0x1E;
const SPARKLES = 0x10, SPARKLE_LIFE = 0x10, SPARKLE_SLOTS = 0xD014;   // wStarWarpSparkleLife + 16 + 1: 16 (y, x) pairs
const STAR_ATTR = 0x09, SPARKLE_ATTR = 0x09, SPARKLE_TILE = 0x18;
const ENTRY_RESULT = 0x0A, FIRST_RESULT_ENTRY = 0x07, EXIT_TO_CREDITS = 0x01;
const OFFSTAGE = 63.0;
const rb = (P, a) => P.rom.u8(BANK, a & 0xFFFF);

// ExhibitionDeclinedCutscene (0E:7082): Bowser angry, Peach tries again, Bowser stamps (the screen shakes) and the
// three walk off to the left, facing right
export function* exhibitionDeclinedCutscene(P) {
  yield* wait(P, 10);
  sound(P, SFX_APPEAR1);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY, 20.0, 13.0);
  yield* wait(P, 40);
  yield* speak(P, ACTOR_MARIO_WORLD_BOWSER);
  yield* wait(P, 20);
  setPosition(P, ACTOR_MARIO_WORLD_BALLOON_ANGRY, OFFSTAGE, OFFSTAGE);
  setAnim(P, ACTOR_MARIO_WORLD_PEACH, ANIM_BOUNCE);
  yield* waitIdle(P, ACTOR_MARIO_WORLD_PEACH);
  yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  yield* wait(P, 10);
  setAnim(P, ACTOR_MARIO_WORLD_PEACH, ANIM_NOD);
  yield* waitIdle(P, ACTOR_MARIO_WORLD_PEACH);
  yield* wait(P, 10);
  yield* speak(P, ACTOR_MARIO_WORLD_PEACH);
  jumpVelocity(P, ACTOR_MARIO_WORLD_BOWSER, -2.0);
  yield* wait(P, 20);
  sound(P, SFX_IMPACT);
  screenShake(P, 4);
  yield* wait(P, 10);
  screenShake(P, 0);
  yield* wait(P, 30);
  moveTarget(P, ACTOR_MARIO_WORLD_WARIO, 12.0, 13.0);
  moveTarget(P, ACTOR_MARIO_WORLD_WALUIGI, 12.0, 17.0);
  yield* wait(P, 20);
  moveTarget(P, ACTOR_MARIO_WORLD_BOWSER, 12.0, 15.0);
  yield* waitMove(P, ACTOR_MARIO_WORLD_BOWSER);
  face(P, ACTOR_MARIO_WORLD_WARIO, FACE_RIGHT);
  face(P, ACTOR_MARIO_WORLD_WALUIGI, FACE_RIGHT);
  face(P, ACTOR_MARIO_WORLD_BOWSER, FACE_RIGHT);
}
// PlayStarWarpTransition (0E:7150): the star's palette (OBJ 1) and tiles, its state reset (countdown $5A), three
// rects of the scene copied, the victory jingle and UpdateStarWarpSprite each frame until the countdown ends (a
// fade out from $1E); the WRAM bank back
export function* playStarWarpTransition(P) {
  const old = P.V.wramBank;
  loadPaletteShadow(P, StarWarpPalette, OBJ_PALETTES + 1, 1);
  queueVRAMCopy(P, StarWarpTiles, vTiles0 + VRAM_BANK1, (StarWarpSparkleTiles - StarWarpTiles) / 16);
  queueVRAMCopy(P, StarWarpSparkleTiles, vTiles0 + 0x18 * TILE_SIZE + VRAM_BANK1, (StarWarpFrameSprites - StarWarpSparkleTiles) / 16);
  P.wramBank(WRAM_SCENE);
  const state = P.A.starWarpFrame;
  P.bus.w8(state, 0); P.bus.w8(state + 1, 0); P.bus.w8(state + 2, STAR_WARP_COUNTDOWN);
  for (let i = 3; i < 0x13; i++) P.bus.w8(state + i, 0);            // the 16 sparkles' lives
  yield* copySceneRect(P, 0, 43, 26, 12, 4, 2);
  yield* copySceneRect(P, 4, 45, 20, 20, 6, 2);
  yield* copySceneRect(P, 10, 43, 26, 18, 6, 2);
  sound(P, BGM_WIN);
  registerFrameTask(P, 0x01, UpdateStarWarpSprite);
  P.wramBank(WRAM_SCENE);
  for (;;) {
    yield* advanceFrame(P);
    const n = P.bus.u8(P.A.starWarpCountdown);
    if (n === STAR_WARP_FADE_AT) { beginFadeOut(P, 3); continue; }
    if (!n) break;
  }
  P.wramBank(old);
}
// OffsetStarWarpPathPoint (0E:724A): (d, e) + the path's point wStarWarpPathIndex (StarWarpPathX / Y). Leaves a = e,
// hl = the y entry and the flags of the last `add`.
export function offsetStarWarpPathPoint(P, d, e) {
  const i = P.bus.u8(P.A.starWarpPathIndex);
  const dx = rb(P, StarWarpPathX + i), dy = rb(P, StarWarpPathY + i);
  const nd = (d + dx) & 0xFF, ne = (e + dy) & 0xFF;
  return { a: ne, d: nd, e: ne, hl: (StarWarpPathY + i) & 0xFFFF, f: addFlags8(e, dy) };
}
const addFlags8 = (x, y) => (((x + y) & 0xFF) ? 0 : FZ) | ((x & 0xF) + (y & 0xF) > 0xF ? FH : 0) | (x + y > 0xFF ? FC : 0);
// UpdateStarWarpSprite (0E:71E9), a frame task: every other frame the star's next frame (6); its two 8x16 halves at
// the path's point from (128, 38); the trail point 4 px left of the right half; the sparkles; the path on 2 steps;
// at the countdown's end the task unregistered
export function updateStarWarpSprite(P) {
  P.wramBank(WRAM_SCENE);
  const { bus, A } = P;
  if (!(P.V.vBlankCounter & 1)) {
    const v = (bus.u8(A.starWarpFrame) + 1) & 0xFF;
    bus.w8(A.starWarpFrame, v === STAR_WARP_FRAMES ? 0 : v);
  }
  const sprites = (StarWarpFrameSprites + ((bus.u8(A.starWarpFrame) << 1) & 0xFF)) & 0xFFFF;
  let p = offsetStarWarpPathPoint(P, 0x80, 0x26);
  queueSprite(P, STAR_ATTR, rb(P, sprites), p.d, p.e);
  p = offsetStarWarpPathPoint(P, 0x88, 0x26);
  queueSprite(P, STAR_ATTR, rb(P, sprites + 1), p.d, p.e);
  bus.w8(A.starWarpPathY, p.e);
  bus.w8(A.starWarpPathX, (p.d - 4) & 0xFF);
  let r = updateStarWarpTrailSparkles(P, (p.d - 4) & 0xFF, p.e);
  bus.w8(A.starWarpPathIndex, (bus.u8(A.starWarpPathIndex) + 2) & 0xFF);
  const old = bus.u8(A.starWarpCountdown), n = (old - 1) & 0xFF;
  bus.w8(A.starWarpCountdown, n);
  r = { ...r, a: n, hl: A.starWarpCountdown, f: (n ? 0 : FZ) | FN | ((old & 0xF) === 0 ? FH : 0) | (r.f & FC) };
  if (n) return r;
  return { ...r, ...unregisterFrameTask(P, UpdateStarWarpSprite) };
}
// UpdateStarWarpTrailSparkles (0E:7265): a new sparkle (life 16) in the first free slot at the trail point plus the
// frame counter's low 3 bits; then each live sparkle drawn every other 2 frames of its life, and aged
export function updateStarWarpTrailSparkles(P, d = P.cpu.d, e = P.cpu.e) {
  const { bus, A } = P, life = A.starWarpSparkleLife;
  for (let c = 0; c < SPARKLES; c++) {
    if (bus.u8(life + c)) continue;
    bus.w8(life + c, SPARKLE_LIFE);
    const at = (SPARKLE_SLOTS + c * 2) & 0xFFFF, jitter = P.V.vBlankCounter & 7;
    e = (bus.u8(A.starWarpPathY) + jitter) & 0xFF; d = (bus.u8(A.starWarpPathX) + jitter) & 0xFF;
    bus.w8(at, e);
    bus.w8(at + 1, d);
    break;
  }
  let f = 0, a = 0;
  for (let b = 0; b < SPARKLES; b++) {
    const v = bus.u8(life + b);
    if (v && (v & 2)) {
      const at = (SPARKLE_SLOTS + b * 2) & 0xFFFF;
      e = bus.u8(at); d = bus.u8(at + 1);
      queueSprite(P, SPARKLE_ATTR, SPARKLE_TILE, d, e);
    }
    a = bus.u8(life + b);
    if (a) bus.w8(life + b, a - 1);
    f = (b + 1 === SPARKLES ? FZ : 0) | FN;                          // (`dec c`)
  }
  return { a, b: SPARKLES, c: 0, d, e, hl: (life + SPARKLES) & 0xFFFF, f };
}
// SpecialCourtInitScript_0e (0E:76E7): entries below 7 the match intro, entry $0A the result
export function* specialCourtInitScript(P) {
  const entry = P.V.storyModeEntryPoint;
  if (entry < FIRST_RESULT_ENTRY) return yield* exhibitionMatchIntroCutscene(P);
  if (entry === ENTRY_RESULT) yield* handleExhibitionMatchResult(P);
}
// ExhibitionMatchIntroCutscene (0E:76FB): the match (entry - 1 in wMapScratch + 2); the walk in (Toad first, the
// player, in doubles the partner), Peach's word, the players take their places, PrepareStoryMatch. During the
// credits the walk ends with exit 1.
export function* exhibitionMatchIntroCutscene(P) {
  P.V.storyModeShowLocationName = 0;
  P.bus.w8(P.A.mapScratch + 2, (P.V.storyModeEntryPoint - 1) & 0xFF);
  if (testFlag(P, FLAG_DOUBLES)) return yield* exhibitionMatchIntroDoubles(P);
  setSpeed(P, ACTOR_SPECIAL_COURT_TOAD, 0.625);
  setSpeed(P, ACTOR_PLAYER, 0.625);
  setPosition(P, ACTOR_SPECIAL_COURT_TOAD, 5.0, 35.0);
  setPosition(P, ACTOR_PLAYER, 5.0, 37.0);
  setPosition(P, ACTOR_PARTNER, 5.0, 37.0);
  moveTarget(P, ACTOR_SPECIAL_COURT_TOAD, 5.0, 31.0);
  moveTarget(P, ACTOR_PLAYER, 5.0, 33.0);
  moveTarget(P, ACTOR_PARTNER, 5.0, 35.0);
  playerSpeed(P, 0.625);
  yield* movePlayer(P, 14.0, 27.0);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* waitMove(P, ACTOR_SPECIAL_COURT_TOAD);
  setActorScript(P, ACTOR_SPECIAL_COURT_TOAD, ActorScript_0e_16);
  moveTarget(P, ACTOR_PLAYER, 5.0, 31.0);
  yield* waitMove(P, ACTOR_PLAYER);
  setActorScript(P, ACTOR_PLAYER, ActorScript_0e_16);
  yield* wait(P, 90);
  yield* movePlayer(P, 14.0, 23.0);
  yield* waitActorScript(P, ACTOR_SPECIAL_COURT_TOAD);
  setSpeed(P, ACTOR_SPECIAL_COURT_TOAD, 1.0);
  setActorScript(P, ACTOR_SPECIAL_COURT_TOAD, ActorScript_0e_17);
  yield* waitActorScript(P, ACTOR_SPECIAL_COURT_TOAD);
  yield* wait(P, 60);
  setAnim(P, ACTOR_SPECIAL_COURT_MARIO, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  if (testFlag(P, FLAG_ENDING_CREDITS_RUNNING)) { requestExit(P, EXIT_TO_CREDITS); return; }
  moveTarget(P, ACTOR_PLAYER, 15.0, 26.0);                          // (.doubles: the singles' walk on)
  yield* waitMove(P, ACTOR_PLAYER);
  moveTarget(P, ACTOR_PLAYER, 15.0, 23.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_SPECIAL_COURT_MARIO, FACE_UP);
  yield* wait(P, 20);
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 14.0, 9.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 20);
  setSpeed(P, ACTOR_SPECIAL_COURT_PEACH, 0.625);
  moveTarget(P, ACTOR_SPECIAL_COURT_PEACH, 15.0, 7.0);
  yield* waitMove(P, ACTOR_SPECIAL_COURT_PEACH);
  setAnim(P, ACTOR_SPECIAL_COURT_PEACH, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SPECIAL_COURT_PEACH);
  yield* setText(P, Text_5e_169);
  yield* speak(P, ACTOR_SPECIAL_COURT_PEACH);
  playerSpeed(P, 2.0);
  yield* movePlayer(P, 14.0, 20.0);
  yield* waitPlayerMove(P);
  yield* wait(P, 20);
  face(P, ACTOR_SPECIAL_COURT_MARIO, FACE_RIGHT);
  face(P, ACTOR_PLAYER, FACE_LEFT);
  yield* wait(P, 40);
  setAnim(P, ACTOR_SPECIAL_COURT_MARIO, ANIM_NOD);
  setAnim(P, ACTOR_PLAYER, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  setSpeed(P, ACTOR_PLAYER, 1.0);
  setSpeed(P, ACTOR_SPECIAL_COURT_MARIO, 1.0);
  moveTarget(P, ACTOR_PLAYER, 15.0, 29.0);
  moveTarget(P, ACTOR_SPECIAL_COURT_MARIO, 9.0, 23.0);
  yield* waitMove(P, ACTOR_SPECIAL_COURT_MARIO);
  moveTarget(P, ACTOR_SPECIAL_COURT_MARIO, 9.0, 13.0);
  yield* waitMove(P, ACTOR_PLAYER);
  face(P, ACTOR_PLAYER, FACE_UP);
  yield* waitMove(P, ACTOR_SPECIAL_COURT_MARIO);
  moveTarget(P, ACTOR_SPECIAL_COURT_MARIO, 13.0, 13.0);
  yield* waitMove(P, ACTOR_SPECIAL_COURT_MARIO);
  face(P, ACTOR_SPECIAL_COURT_MARIO, FACE_DOWN);
  yield* wait(P, 40);
  yield* prepareStoryMatch(P);
}
// ExhibitionMatchIntroCutscene.startMatch (0E:7927): the doubles intro: Peach waiting on court, the four walk in in
// file, Peach's word, the pairs take their places (on actor scripts), PrepareStoryMatch
function* exhibitionMatchIntroDoubles(P) {
  setSpeed(P, ACTOR_SPECIAL_COURT_TOAD, 0.625);
  setSpeed(P, ACTOR_PLAYER, 0.625);
  setSpeed(P, ACTOR_PARTNER, 0.625);
  setPosition(P, ACTOR_SPECIAL_COURT_PEACH, 15.0, 23.0);
  nullScript(P, ACTOR_PARTNER);
  setPosition(P, ACTOR_SPECIAL_COURT_TOAD, 5.0, 35.0);
  setPosition(P, ACTOR_PLAYER, 5.0, 37.0);
  setPosition(P, ACTOR_PARTNER, 5.0, 37.0);
  moveTarget(P, ACTOR_SPECIAL_COURT_TOAD, 5.0, 31.0);
  moveTarget(P, ACTOR_PLAYER, 5.0, 33.0);
  moveTarget(P, ACTOR_PARTNER, 5.0, 35.0);
  playerSpeed(P, 0.625);
  yield* movePlayer(P, 14.0, 27.0);
  fadeIn(P, 4);
  yield* waitFadeEnd(P);
  yield* waitMove(P, ACTOR_SPECIAL_COURT_TOAD);
  setActorScript(P, ACTOR_SPECIAL_COURT_TOAD, ActorScript_0e_16);
  moveTarget(P, ACTOR_PLAYER, 5.0, 31.0);
  moveTarget(P, ACTOR_PARTNER, 5.0, 33.0);
  yield* waitMove(P, ACTOR_PLAYER);
  setActorScript(P, ACTOR_PLAYER, ActorScript_0e_16);
  moveTarget(P, ACTOR_PARTNER, 5.0, 31.0);
  yield* waitMove(P, ACTOR_PARTNER);
  setActorScript(P, ACTOR_PARTNER, ActorScript_0e_16);
  yield* wait(P, 90);
  yield* movePlayer(P, 14.0, 23.0);
  yield* waitActorScript(P, ACTOR_SPECIAL_COURT_TOAD);
  setSpeed(P, ACTOR_SPECIAL_COURT_TOAD, 1.0);
  setActorScript(P, ACTOR_SPECIAL_COURT_TOAD, ActorScript_0e_17);
  setActorScript(P, ACTOR_PARTNER, ActorScript_0e_22);
  moveTarget(P, ACTOR_PARTNER, 15.0, 27.0);
  yield* waitActorScript(P, ACTOR_SPECIAL_COURT_TOAD);
  yield* wait(P, 60);
  setAnim(P, ACTOR_SPECIAL_COURT_PEACH, ANIM_NOD);
  yield* waitIdle(P, ACTOR_SPECIAL_COURT_PEACH);
  yield* wait(P, 20);
  if (testFlag(P, FLAG_ENDING_CREDITS_RUNNING)) { requestExit(P, EXIT_TO_CREDITS); return; }
  yield* setText(P, Text_5e_170);                                    // .done
  yield* speak(P, ACTOR_SPECIAL_COURT_PEACH);
  yield* wait(P, 20);
  for (const actor of [ACTOR_SPECIAL_COURT_MARIO, ACTOR_SPECIAL_COURT_PEACH, ACTOR_PARTNER, ACTOR_PLAYER]) setAnim(P, actor, ANIM_NOD);
  yield* waitIdle(P, ACTOR_PLAYER);
  yield* wait(P, 20);
  playerSpeed(P, 1.0);
  yield* movePlayer(P, 14.0, 20.0);
  for (const actor of [ACTOR_PLAYER, ACTOR_PARTNER, ACTOR_SPECIAL_COURT_MARIO, ACTOR_SPECIAL_COURT_PEACH]) setSpeed(P, actor, 1.0);
  setActorScript(P, ACTOR_SPECIAL_COURT_MARIO, ActorScript_0e_18);
  setActorScript(P, ACTOR_SPECIAL_COURT_PEACH, ActorScript_0e_19);
  setActorScript(P, ACTOR_PLAYER, ActorScript_0e_20);
  setActorScript(P, ACTOR_PARTNER, ActorScript_0e_21);
  yield* waitActorScript(P, ACTOR_SPECIAL_COURT_MARIO);
  yield* waitActorScript(P, ACTOR_SPECIAL_COURT_PEACH);
  yield* wait(P, 60);
  yield* prepareStoryMatch(P);
}

export const HOOKS = [
  scene(BANK, 0x7082, exhibitionDeclinedCutscene),
  scene(BANK, 0x7150, playStarWarpTransition),
  [BANK, 0x71E9, hook(P => updateStarWarpSprite(P))],
  [BANK, 0x724A, hook((P, c) => offsetStarWarpPathPoint(P, c.d, c.e))],
  [BANK, 0x7265, hook((P, c) => updateStarWarpTrailSparkles(P, c.d, c.e))],
  scene(BANK, 0x76E7, specialCourtInitScript),
  scene(BANK, 0x76FB, exhibitionMatchIntroCutscene),
];

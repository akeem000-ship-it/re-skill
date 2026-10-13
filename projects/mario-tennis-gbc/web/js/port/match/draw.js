// The match's drawing (bank $08): the sprite slots the frame builds for the ball, its trail and shadows, the
// effects, and the frame's sprite pass that hands them, the characters and the markers to the shadow OAM in depth
// order. Ports of ball_visuals_08, the drawing half of ball_effects_08 and minigame_08, and the court-row upload
// of court_08 in the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm), whose names
// and addresses these are. The slots live in WRAM bank 4 ($DE00-$DE1F, the ball history ring at $DD00) and in
// each character's bank ($DF80-$DF8F); like the ROM, the code reaches them through the bank mapped at the time.
// Bank-0 helpers (the sprite queue, the VRAM copy queue) are called as the ROM's (port hooks run where ported).
// Covered by out/engine/exh1.mtrec and rec1.mtrec (match play; port_lockstep.mjs).
import { engine } from "./engine_port.js";
import { callModeHook } from "./match.js";
import * as variants from "./variants.js";

const OAM_BANK1 = 0x08;
// WRAM bank 4 (WRAM_ACTORS): the ball history ring (6 entries of [x, y projected words, tile, attr], newest at
// +30) and the ball's sprite slots [tile, attr, y, x]
const BALL_HISTORY = 0xDD00, NET_BALL_SLOT = 0xDE00, BALL_SLOT = 0xDE04, BALL_SHADOW_SLOT = 0xDE08, BALL_TRAIL_SLOTS = 0xDE0C;
// each character's bank: the sprite slot, the airborne shadow and the standing shadow, the depth key, the sprite
// descriptor and the screen position
const CHAR_SPRITE_SLOT = 0xDF80, CHAR_AIR_SHADOW_SLOT = 0xDF88, CHAR_GROUND_SHADOW_SLOT = 0xDF8C, CHAR_DEPTH_KEY = 0xDF96;
const CHAR_SPRITE_FRAME = 0xDF1B, CHAR_SCREEN_X = 0xDF53, CHAR_SCREEN_Y = 0xDF54;
const STANDING_SHADOW_TEMPLATE = 0x6301;                 // 08:6301 StandingShadowOamTemplate
const DRAW_LANDING_MARKER_TABLE = 0x5373, DRAW_SPECIAL_HIT_TABLE = 0x546C, DRAW_TOUCH_EFFECT_TABLE = 0x54C2;   // bank 8
const TARGET_ZONE_TEMPLATES = [0x55A0, 0x55A5, 0x55AA, 0x55AF];                // 08: DrawTargetZone_SpriteTemplate0-3

const u8 = v => v & 0xFF, u16 = v => v & 0xFFFF;

// ---- the bank-0 helpers, called as the ROM's code calls them ----
// a bank-0 routine run with ROM bank `romBank` mapped and in hRomBank, as the calling code has it (the sprite
// templates and graphics it reads are in that bank)
export function callHome(P, addr, regs, romBank = 8) {
  const m = P.mem, bank = m.romBank, hBank = m.hram[0x15];
  m.romBank = romBank; m.updateRom(); m.hram[0x15] = romBank;
  try { return P.callRom(0, addr, regs); } finally { m.romBank = bank; m.updateRom(); m.hram[0x15] = hBank; }
}
const queueSprite = (P, b, c, d, e) => P.callRom(0, 0x1F51, { b, c, d, e });                   // QueueSprite
const queueSprite16 = (P, b, c, d, e) => P.callRom(0, 0x1E55, { b, c, d, e });                 // QueueSprite16
const queueSpriteTemplate = (P, hl, b, c, d, e, bank = 8) =>                                     // QueueSpriteTemplate
  callHome(P, 0x1E9D, { h: hl >> 8, l: hl & 0xFF, b, c, d, e }, bank);
const tickTimer = (P, addr) => { const t = P.bus.u8(addr); if (t) P.bus.w8(addr, t - 1); };   // TickTimer (00:2C26)
const word = (P, addr) => P.bus.u16(addr);

// 08:59BB ApplyCameraProjection: a projected point (hl = x, bc = y, 1/32 px) plus the camera offset, in pixels:
// { d: x, e: y } (the high bytes of the sums times 8); hl is left at the y sum times 8
export function applyCameraProjection(P, hl, bc) {
  const V = P.V, x = u16((V.cameraOffsetX + hl) * 8), y = u16((V.cameraOffsetY + bc) * 8);
  return { d: x >> 8, e: y >> 8, hl: y };
}
// 08:59B8 ProjectWorldToScreen_08 (00:2D8C ProjectWorldToScreen): { hl: x, bc: y, de: the depth term }
const project = (P, x, depth, height) => engine(P).M.projectWorldToScreen(u16(x), u16(depth), u16(height));

// ---- the frame's slots (UpdateMatchFrame, UpdateBallVisuals) ----
// 08:630E ClearSpriteSlots: every ball and character slot free ($FF); bank 4 mapped at the end
export function clearSpriteSlots(P) {
  const bus = P.bus;
  for (const a of [NET_BALL_SLOT, BALL_SLOT, BALL_TRAIL_SLOTS, BALL_TRAIL_SLOTS + 4, BALL_TRAIL_SLOTS + 8, BALL_TRAIL_SLOTS + 12, BALL_TRAIL_SLOTS + 16, BALL_SHADOW_SLOT]) bus.w8(a, 0xFF);
  for (const b of [7, 6, 5, 4]) {
    P.wramBank(b);
    bus.w8(CHAR_SPRITE_SLOT, 0xFF); bus.w8(CHAR_AIR_SHADOW_SLOT, 0xFF); bus.w8(CHAR_GROUND_SHADOW_SLOT, 0xFF);
  }
}
// 08:519D BuildBallSlot: the ball's projected position into the history ring (+30) and its slot; the tile by the
// depth term (far $40 / mid $42 / near $44), into the ring's tile and attribute (+34)
export function buildBallSlot(P) {
  const S = engine(P).S, bus = P.bus;
  const p = project(P, S.ballX, S.ballDepth, S.ballHeight);
  bus.w16(BALL_HISTORY + 30, p.hl); bus.w16(BALL_HISTORY + 32, p.bc);
  const { d, e } = applyCameraProjection(P, p.hl, p.bc);
  const q = p.de;
  let tile;
  if (!(q & 0x8000)) tile = q + 0xFE60 > 0xFFFF ? 0x44 : 0x42;
  else tile = q + 0x01A0 > 0xFFFF ? 0x42 : 0x40;
  if (S.ballSpriteEnabled) { bus.w8(BALL_SLOT, tile); bus.w8(BALL_SLOT + 1, 0x08); bus.w8(BALL_SLOT + 2, e); bus.w8(BALL_SLOT + 3, d); }
  bus.w8(BALL_HISTORY + 34, tile + 8); bus.w8(BALL_HISTORY + 35, 0x08);
}
// 08:51FD BuildBallTrailSlots: two trail sprites from the ring while the trail is on, five with a trail colour
export function buildBallTrailSlots(P) {
  const S = engine(P).S;
  if (!S.ballTrailEnabled) return;
  buildTrailSlot(P, BALL_HISTORY + 24, BALL_TRAIL_SLOTS);
  buildTrailSlot(P, BALL_HISTORY + 18, BALL_TRAIL_SLOTS + 4);
  if (!S.ballTrailColor) return;
  buildTrailSlot(P, BALL_HISTORY + 12, BALL_TRAIL_SLOTS + 8);
  buildTrailSlot(P, BALL_HISTORY + 6, BALL_TRAIL_SLOTS + 12);
  buildTrailSlot(P, BALL_HISTORY, BALL_TRAIL_SLOTS + 16);
}
// 08:5237 BuildTrailSlot: one ring entry (hl) on screen now, into the slot at de
export function buildTrailSlot(P, hl, de) {
  const bus = P.bus, { d, e } = applyCameraProjection(P, word(P, hl), word(P, hl + 2));
  bus.w8(de, bus.u8(hl + 4)); bus.w8(de + 1, bus.u8(hl + 5)); bus.w8(de + 2, e); bus.w8(de + 3, d);
}
// 08:5253 BuildBallShadowSlot: the ball's ground projection (wBallGroundProj*, the camera's follow target) and,
// while the shadow is on, its slot (tile $46)
export function buildBallShadowSlot(P) {
  const S = engine(P).S, bus = P.bus, p = project(P, S.ballX, S.ballDepth, 0);
  S.ballGroundProjX = p.hl; S.ballGroundProjY = p.bc;
  if (!S.ballShadowEnabled) return;
  const { d, e } = applyCameraProjection(P, p.hl, p.bc);
  bus.w8(BALL_SHADOW_SLOT, 0x46); bus.w8(BALL_SHADOW_SLOT + 1, 0x08); bus.w8(BALL_SHADOW_SLOT + 2, e); bus.w8(BALL_SHADOW_SLOT + 3, d);
}
// 08:528C BuildNetBallSlot: once the point is over, a ball in the net (depth -$1E0..0, |X| < $240) is drawn again
// at the net band's height (tile $4E, at an X with the scroll's parity)
export function buildNetBallSlot(P) {
  const S = engine(P).S, bus = P.bus;
  if (!S.pointOutcome) return;
  const depth = u16(S.ballDepth);
  if (!(depth & 0x8000)) return;
  if (u16(depth + 0x01E0) & 0x8000) return;
  let x = u16(S.ballX); if (x & 0x8000) x = u16(-x);
  if (x + 0xFDC0 > 0xFFFF) return;
  let { d, e } = applyCameraProjection(P, word(P, BALL_HISTORY + 30), 0xFE80);
  d = (d & 0xFE) | (P.V.scrollX & 1);
  bus.w8(NET_BALL_SLOT, 0x4E); bus.w8(NET_BALL_SLOT + 1, 0x0B); bus.w8(NET_BALL_SLOT + 2, e); bus.w8(NET_BALL_SLOT + 3, d);
}
// 08:5482 DrawBallTouchCharEffect: while its timer runs, the ball-hits-player effect over the touched character,
// its tiles reloaded on the frames DrawBallTouchCharEffectTable names (28:6044 LoadBallTouchCharEffectTilesA)
export function drawBallTouchCharEffect(P) {
  const S = engine(P).S, bus = P.bus;
  if (!S.ballTouchCharTimer) return;
  P.wramBank(u8(S.ballTouchCharIndex + 4));                              // CharIndexToWramBank
  const d = u8(bus.u8(CHAR_SCREEN_X) + 0x08), e = u8(bus.u8(CHAR_SCREEN_Y) + 0xF8);
  P.wramBank(4);
  queueSprite16(P, OAM_BANK1 | 2, 0x78, d, e);
  tickTimer(P, P.A.ballTouchCharTimer);
  const a = P.rom.u8(8, u16(DRAW_TOUCH_EFFECT_TABLE + S.ballTouchCharTimer));
  if (a !== 0xFF) variants.loadBallTouchCharEffectTilesA(P, a);
}
// UpdateBallVisuals 08:5170: the history ring moves on one entry (CopyMemoryBC, $1E bytes)
export function shiftBallHistory(P) {
  const bus = P.bus;
  for (let i = 0; i < 0x1E; i++) bus.w8(BALL_HISTORY + i, bus.u8(BALL_HISTORY + 6 + i));
}

// ---- the sprite pass (UpdateMatchFrame: DrawActorsByDepth, DrawMarkersAndShadows) ----
// 08:64FD DrawSlotSprite: a slot [tile, attr, y, x] to the shadow OAM, unless free
export function drawSlotSprite(P, hl) {
  const bus = P.bus, c = bus.u8(hl);
  if (c === 0xFF) return;
  queueSprite(P, bus.u8(hl + 1), c, bus.u8(hl + 3), bus.u8(hl + 2));
}
// 08:650A DrawCharSprite: the character of the mapped bank, 24x32 or 32x32 by its sprite descriptor
export function drawCharSprite(P, hl) {
  const bus = P.bus, c = bus.u8(hl);
  if (c === 0xFF) return;
  const regs = { c, b: bus.u8(hl + 1), e: bus.u8(hl + 2), d: bus.u8(hl + 3), h: bus.u8(CHAR_SPRITE_FRAME), l: bus.u8(CHAR_SPRITE_FRAME + 1) };
  P.callRom(0, bus.u8(CHAR_SPRITE_FRAME + 2) ? 0x2CED : 0x2C2B, regs);   // QueueSprite32x32 / QueueSprite24x32
}
// 08:6527 DrawStandingShadowSlot: the three-sprite standing shadow at the slot's place
export function drawStandingShadowSlot(P, hl) {
  const bus = P.bus, c = bus.u8(hl);
  if (c === 0xFF) return;
  queueSpriteTemplate(P, STANDING_SHADOW_TEMPLATE, bus.u8(hl + 1), c, bus.u8(hl + 3), bus.u8(hl + 2));
}
// a team's two characters (banks a, b) in the order of their depth keys (b first when a's key is smaller);
// bank `end` mapped after
function drawTeam(P, a, b, end) {
  const bus = P.bus;
  P.wramBank(b); const kb = bus.u8(CHAR_DEPTH_KEY);
  P.wramBank(a); const ka = bus.u8(CHAR_DEPTH_KEY);
  const [first, second] = ka < kb ? [b, a] : [a, b];
  P.wramBank(first); drawCharSprite(P, CHAR_SPRITE_SLOT);
  P.wramBank(second); drawCharSprite(P, CHAR_SPRITE_SLOT);
  P.wramBank(end);
}
// 08:636D DrawNearTeamChars (characters 0 and 2) / 08:63BF DrawFarTeamChars (1 and 3); bank 4 mapped after
export const drawNearTeamChars = P => drawTeam(P, 4, 6, 4);
export const drawFarTeamChars = P => drawTeam(P, 5, 7, 4);
// 08:6411 DrawBallAndEffects: hit spark, special-hit flash, the ball in the net, the ball; mode hook 7
export function drawBallAndEffects(P) {
  drawHitSpark(P);
  drawSpecialHitEffect(P);
  drawSlotSprite(P, NET_BALL_SLOT);
  drawSlotSprite(P, BALL_SLOT);
  callModeHook(P, 0x07);
}
// 08:6429 DrawActorsByDepth: the far team, the ball and the near team, back to front by the two main characters'
// depth keys; once the point is over the ball comes last. The tennis-machine minigame draws a fixed order.
export function drawActorsByDepth(P) {
  const E = engine(P), bus = P.bus;
  if (E.S.minigameUsesTennisMachine) { drawNearTeamChars(P); drawBallAndEffects(P); drawFarTeamChars(P); return; }
  P.wramBank(5); const far = bus.u8(CHAR_DEPTH_KEY);
  P.wramBank(4); const near = bus.u8(CHAR_DEPTH_KEY);
  const order = near >= far
    ? (E.S.pointOutcome ? [drawNearTeamChars, drawFarTeamChars, drawBallAndEffects] : [drawNearTeamChars, drawBallAndEffects, drawFarTeamChars])
    : (E.S.pointOutcome ? [drawFarTeamChars, drawNearTeamChars, drawBallAndEffects] : [drawFarTeamChars, drawBallAndEffects, drawNearTeamChars]);
  for (const fn of order) fn(P);
}
// 08:6481 DrawMarkersAndShadows: target zone, landing marker, the ball's trail, the bounce mark, the airborne
// shadows, the ball's shadow, the standing shadows of characters 1 and 0; bank 4 mapped after
export function drawMarkersAndShadows(P) {
  drawTargetZone(P);
  drawLandingMarker(P);
  for (let i = 0; i < 5; i++) drawSlotSprite(P, BALL_TRAIL_SLOTS + i * 4);
  drawBounceEffect(P);
  for (const b of [7, 6, 5, 4]) { P.wramBank(b); drawSlotSprite(P, CHAR_AIR_SHADOW_SLOT); }
  drawSlotSprite(P, BALL_SHADOW_SLOT);
  P.wramBank(5); drawStandingShadowSlot(P, CHAR_GROUND_SHADOW_SLOT);
  P.wramBank(4); drawStandingShadowSlot(P, CHAR_GROUND_SHADOW_SLOT);
  P.wramBank(4);
}

// ---- effects and markers (ball_effects_08, ball_visuals_08) ----
// 08:53AC DrawBounceEffect: the bounce mark, its second frame for the last 10 frames of its timer
export function drawBounceEffect(P) {
  const S = engine(P).S;
  if (!S.bounceEffectTimer) return;
  const { d, e } = applyCameraProjection(P, u16(S.bounceEffectX), u16(S.bounceEffectY));
  queueSprite(P, 0x0A, S.bounceEffectTimer >= 0x0A ? 0x60 : 0x62, d, e);
}
// 08:540E DrawHitSpark: the spark at the contact point, frames $6E -> $68 as its timer runs down
export function drawHitSpark(P) {
  const S = engine(P).S;
  if (!S.hitSparkTimer) return;
  const { d, e } = applyCameraProjection(P, u16(S.hitEffectX), u16(S.hitEffectY));
  const a = (S.hitSparkTimer >> 2) & 3;
  queueSprite(P, OAM_BANK1 | 2, u8((u8(~a) + 4) * 2 + 0x68), d, e);
}
// 08:5436 DrawSpecialHitEffect: the special-shot flash (its timer ticks here), tiles reloaded every 4 frames
// (28:6030 LoadSpecialHitEffectTiles)
export function drawSpecialHitEffect(P) {
  const S = engine(P).S;
  if (!S.specialHitTimer) return;
  const { d, e } = applyCameraProjection(P, u16(S.hitEffectX), u16(S.hitEffectY));
  queueSprite16(P, OAM_BANK1 | 1, 0x74, d, u8(e + 8));
  tickTimer(P, P.A.specialHitTimer);
  const a = P.rom.u8(8, u16(DRAW_SPECIAL_HIT_TABLE + S.specialHitTimer));
  if (a !== 0xFF) variants.loadSpecialHitEffectTiles(P, a);
}
// 08:5342 DrawLandingMarker: the lob's landing marker, its tiles switched every 8 frames (28:6058
// LoadBallTouchCharEffectTilesB)
export function drawLandingMarker(P) {
  const S = engine(P).S;
  if (!S.landingMarkerActive) return;
  const { d, e } = applyCameraProjection(P, u16(S.landingMarkerX), u16(S.landingMarkerY));
  queueSprite16(P, OAM_BANK1 | 1, 0x7C, d, u8(e + 8));
  const a = P.rom.u8(8, DRAW_LANDING_MARKER_TABLE + (S.matchFrameCounter & 0x0F));
  if (a !== 0xFF) variants.loadBallTouchCharEffectTilesB(P, a);
}
// 08:5522 DrawTargetZone: the four corners of a drill's target zone
export function drawTargetZone(P) {
  const V = P.V;
  if (!V.targetZoneEnabled) return;
  const corners = [[V.targetZoneX1, V.targetZoneDepth1], [V.targetZoneX2, V.targetZoneDepth1], [V.targetZoneX1, V.targetZoneDepth2], [V.targetZoneX2, V.targetZoneDepth2]];
  corners.forEach(([x, depth], i) => {
    const p = project(P, x, depth, 0), { d, e } = applyCameraProjection(P, p.hl, p.bc);
    queueSpriteTemplate(P, TARGET_ZONE_TEMPLATES[i], OAM_BANK1 | 1, 0x20 + i * 2, d, e);
  });
}

// ---- the court picture (court_08) ----
// RefreshCourtAfterEndChange 08:5F61: the scoreboard's five tile rows of the court map and attribute map
// (WRAM bank 2, rows 12-16) queued for upload to the BG map; bank 4 mapped after (08:5F85)
export function uploadCourtScoreboardRows(P) {
  P.wramBank(2);
  P.callRom(0, 0x0480, { h: 0xD1, l: 0x80, d: 0x99, e: 0x80, c: 10 });  // QueueVRAMCopy wCourtTilemap + 12 rows -> vBGMap0 + 12 rows
  P.callRom(0, 0x0480, { h: 0xD5, l: 0x80, d: 0xB9, e: 0x80, c: 10 });  // the attributes -> VRAM bank 1
  P.wramBank(4);
}
// 08:54EA Unused_08_DrawShotAimMarker / 08:5506 UnusedDrawBallTargetMarker: a marker sprite ($5E) at the shot's aim point
// or the ball's target on the ground (unused debug aids)
export function drawShotAimMarker(P) { drawGroundMarker(P, P.V.shotAimTargetX, P.V.shotAimTargetDepth, OAM_BANK1 | 1); }
export function drawBallTargetMarker(P) { drawGroundMarker(P, P.V.ballTargetX, P.V.ballTargetDepth, OAM_BANK1 | 4); }
function drawGroundMarker(P, x, depth, b) {
  const p = project(P, x, depth, 0), { d, e } = applyCameraProjection(P, p.hl, p.bc);
  queueSprite(P, b, 0x5E, d, e);
}
// 08:6537 UnusedDrawStandingShadowSlot16: a slot through QueueSprite16 (nothing calls it)
export function drawSlotSprite16(P, hl) {
  const bus = P.bus, c = bus.u8(hl);
  if (c === 0xFF) return;
  queueSprite16(P, bus.u8(hl + 1), c, bus.u8(hl + 3), bus.u8(hl + 2));
}
// the variant entry points of the team drawers: the partner first (08:63A0 DrawNearTeamCharsDoubles, 08:63F2
// DrawFarTeamCharsDoubles)
function drawTeamPartnerFirst(P, partner, main) {
  P.wramBank(partner); drawCharSprite(P, CHAR_SPRITE_SLOT);
  P.wramBank(main); drawCharSprite(P, CHAR_SPRITE_SLOT);
  P.wramBank(4);
}
// ApplyCameraProjection is also called from outside the match code
export const HOOKS = [
  [8, 0x54EA, P => drawShotAimMarker(P)],
  [8, 0x5506, P => drawBallTargetMarker(P)],
  [8, 0x6537, (P, c) => drawSlotSprite16(P, c.hl)],
  [8, 0x63A0, P => drawTeamPartnerFirst(P, 6, 4)],
  [8, 0x63F2, P => drawTeamPartnerFirst(P, 7, 5)],
  [8, 0x59BB, (P, c) => { const r = applyCameraProjection(P, c.hl, c.bc); c.d = r.d; c.e = r.e; c.hl = r.hl; c.a = P.V.cameraOffsetY & 0xFF; }],   // (a: the y offset's low byte)
  [8, 0x630E, P => clearSpriteSlots(P)],
  [8, 0x519D, P => buildBallSlot(P)],
  [8, 0x51FD, P => buildBallTrailSlots(P)],
  [8, 0x5237, (P, c) => buildTrailSlot(P, c.hl, c.de)],
  [8, 0x5253, P => buildBallShadowSlot(P)],
  [8, 0x528C, P => buildNetBallSlot(P)],
  [8, 0x5482, P => drawBallTouchCharEffect(P)],
  [8, 0x64FD, (P, c) => drawSlotSprite(P, c.hl)],
  [8, 0x650A, (P, c) => drawCharSprite(P, c.hl)],
  [8, 0x6527, (P, c) => drawStandingShadowSlot(P, c.hl)],
  [8, 0x636D, P => drawNearTeamChars(P)],
  [8, 0x63BF, P => drawFarTeamChars(P)],
  [8, 0x6411, P => drawBallAndEffects(P)],
  [8, 0x6429, P => drawActorsByDepth(P)],
  [8, 0x6481, P => drawMarkersAndShadows(P)],
  [8, 0x53AC, P => drawBounceEffect(P)],
  [8, 0x540E, P => drawHitSpark(P)],
  [8, 0x5436, P => drawSpecialHitEffect(P)],
  [8, 0x5342, P => drawLandingMarker(P)],
  [8, 0x5522, P => drawTargetZone(P)],
];

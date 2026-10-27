// The overworld map engine (bank 0A; REVERSE.md "Top level: the map engine"): MapEngine 0A:498C runs MapRun 0A:4A21
// for the current map (wMapId $C450, wMapEntrance $C46A) and then MapTakeWarp 0A:5146, for ever. MapRun loads the
// map's record and header (MapTable 0A:5188; 14-byte headers in banks 30-35), places the player at the entrance,
// starts the music, spawns the actors (bank 04), starts the map graphics (bank 0B) and runs the header's enter
// script (MapRunEnterScript 0A:4F71, MapRunScript 0A:4EFF); a script that asks for a warp (wMapWarpRequest $C441)
// ends the run there, else the map fades in, shows its name banner and runs its event loop.
// The enter scripts are ported per bank (maps/*.js) and found here by their ROM address.
import { navigationMenu } from "./nav.js";
import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as A from "./actors.js";
import * as S from "./script.js";
import { mapStartGfx } from "./mapgfx.js";
import { MAP_SCRIPTS } from "./maps/index.js";
import * as P from "./player.js";
import * as W from "./windows.js";
import { showMessage, showMessageKeepOpen } from "./msgbox.js";
import * as T from "./msgbox.js";
import { restoreShadowFromMap } from "./shadow.js";
import { vectorFromLengthAndAngle } from "./math.js";
import { actorSetAnim } from "./render/actors.js";
import { mapStartMenu } from "./pause.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
const r16 = (w, a) => rd(w, a) | rd(w, (a + 1) & 0xFFFF) << 8;
const testFlag = (w, n) => w.wram[0][0x840 + (n >> 3)] & (0x80 >> (n & 7));
const setFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] |= 0x80 >> (n & 7); };
const clearFlag = (w, n) => { w.wram[0][0x840 + (n >> 3)] &= ~(0x80 >> (n & 7)); };
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}
const h2 = v => v.toString(16).padStart(2, "0"), h4 = v => v.toString(16).padStart(4, "0");

// 0A:5303 MapFindRecord: MapTable 0A:5188 (6 bytes per map; the first when absent)
export function mapFindRecord(a) {
  for (let hl = 0x5188; ; hl += 6) {
    const v = rb(0x0A, hl);
    if (v === 0xFF) return 0x5188;
    if (v === a) return hl;
  }
}
export function mapIndexOf(a) {                  // 0A:5348 MapIndexOf
  let b = 0;
  for (let hl = 0x5188; ; hl += 6, b++) {
    const v = rb(0x0A, hl);
    if (v === a) return b;
    if (v === 0xFF) return 0;
  }
}
// 0A:4B8C ClearC85C / 0A:4B99 MapClearEvents
export function clearC85C(w) { for (let k = 0; k < 4; k++) wr(w, 0xC85C + k, 0); }
export function mapClearEvents(w) { for (let k = 0; k < 5; k++) wr(w, 0xC440 + k, 0); }
// 0A:4BAC MapEventPending: the sum of the five event bytes
export function mapEventPending(w) { let a = 0; for (let k = 0; k < 5; k++) a = (a + rd(w, 0xC440 + k)) & 0xFF; return a; }
// 0A:4BBC MapLoadHeader: the record -> $C450-$C455, its header ((idx, bank) at +2: 00:063B ReadFarVectorEntry, 14
// bytes by 00:0654 FarCopyBytes) -> $C456, wMapBank $C464, the name's text id ($012C + index) -> $C4B4
export function mapLoadHeader(w) {
  const rec = mapFindRecord(rd(w, 0xC450));
  for (let k = 0; k < 6; k++) wr(w, 0xC450 + k, rb(0x0A, rec + k));
  const ref = r16(w, 0xC452), bank = ref >> 8;
  const hl = rw(bank, 0x4000 + (ref & 0xFF));
  wr(w, 0xC464, bank);
  for (let k = 0; k < 0x0E; k++) wr(w, 0xC456 + k, rb(bank, hl + k));
  const id = (0x012C + mapIndexOf(rd(w, 0xC450))) & 0xFFFF;
  wr(w, 0xC4B4, id & 0xFF); wr(w, 0xC4B5, id >> 8);
}
// 0A:4BFF ScriptSetMapField: the word at $C450 + de = hl (patches the record / header: a list replaced)
export function scriptSetMapField(w, hl, de) {
  const p = (0xC450 + de) & 0xFFFF;
  wr(w, p, hl & 0xFF); wr(w, (p + 1) & 0xFFFF, hl >> 8);
}
// 0A:4C0D MapPlaceAtEntrance: wMapEntrance in the header's entrance list (6 bytes each; $FF ends: the first) ->
// $C400 (FarCopyBytes), facing $C465, x $C466, y $C468 ($FA: kept)
export function mapPlaceAtEntrance(w) {
  const want = rd(w, 0xC46A);
  if (want === 0xFA) return;
  const bank = rd(w, 0xC464);
  let hl = r16(w, 0xC456);
  for (;; hl = (hl + 6) & 0xFFFF) {
    const a = rb(bank, hl);
    if (a === 0xFF) { hl = r16(w, 0xC456); break; }
    if (a === want) break;
  }
  for (let k = 0; k < 6; k++) wr(w, 0xC400 + k, rb(bank, hl + k));
  wr(w, 0xC465, rd(w, 0xC401));
  wr(w, 0xC466, rd(w, 0xC402)); wr(w, 0xC467, rd(w, 0xC403));
  wr(w, 0xC468, rd(w, 0xC404)); wr(w, 0xC469, rd(w, 0xC405));
}
// 0A:4E2F TestFlagCondition: de = a flag number, bit 15 inverted: true (the ROM's z) when the flag is clear, or for
// an inverted one when it is set (00:2D10 TestGameFlag on de << 5)
export function testFlagCondition(w, de) {
  const set = !!testFlag(w, (de << 5 & 0xFFFF) >> 5);
  return de & 0x8000 ? set : !set;
}
// 0A:4E70 MapCheckFacing: b = a direction mask ($FF any): the player's facing (+$10 bits 6-7 -> 0A:4E6C $10 $80 $20
// $40) in it; maps WRAM4
export function mapCheckFacing(w, b) {
  setW(w, 4);
  if (b === 0xFF) return 1;
  const p = r16(w, 0xC290);
  const f = rd(w, (p & 0xFF00) | ((p + 0x10) & 0xFF));
  return rb(0x0A, 0x4E6C + ((f >> 6) & 3)) & b ? 1 : 0;
}
// 0A:4EA0 MapListFind / 0A:4EC5 MapListFindIfFlag: id d in a list of 8-byte records [id, facing mask, flag word,
// script, ...] in bank a ($FF ends), with the player's facing in the mask (and the flag condition); the record or 0
export function mapListFind(w, a, hl, d, withFlag = false) {
  for (;; hl = (hl + 8) & 0xFFFF) {
    const c = rb(a, hl), b = rb(a, hl + 1);      // 00:0626 FarReadWord
    if (c === 0xFF) return 0;
    if (c !== d || !mapCheckFacing(w, b)) continue;
    if (!withFlag) return hl;
    const f = rb(a, hl + 2) | rb(a, hl + 3) << 8;
    if (!f || testFlagCondition(w, f)) return hl;
  }
}
// 0A:5146 MapTakeWarp: warp [$C46B] ($FA: the map and entrance already set) from the header's warp list: the record
// -> $C400, wMapId = +6, wMapEntrance = +7
export function mapTakeWarp(w) {
  if (rd(w, 0xC46B) === 0xFA) return;
  const bank = rd(w, 0xC464);
  const hl = mapListFind(w, bank, r16(w, 0xC458), rd(w, 0xC46B), true);
  if (!hl) return;
  for (let k = 0; k < 8; k++) wr(w, 0xC400 + k, rb(bank, hl + k));
  wr(w, 0xC450, rd(w, 0xC406));
  wr(w, 0xC46A, rd(w, 0xC407));
}
// 0A:4F45 MapInitObjects: flag #21 off, the actors reset (04:410D), the player at the entrance (04:510A), the actors
// of the list hl in bank a (04:5084), the partner by flags #144-#147 (04:51D0)
export function mapInitObjects(w, a, hl) {
  clearFlag(w, 21);
  D.inBank(w, 0x04, () => {
    A.actorsInit(w);
    A.spawnPlayerActor(w, r16(w, 0xC466), r16(w, 0xC468), rd(w, 0xC465));
    A.spawnActorList(w, a, hl);
    A.spawnPartnerActor(w);                      // 04:51D0 SpawnPartnerActor
  });
}
// 0A:4120 ScriptRespawnActors: MapInitObjects with the list hl in bank a
export function scriptRespawnActors(w, a, hl) { mapInitObjects(w, a, hl); }

// 0A:4EFF MapRunScript: hl < $2000 is a text (~05:5D49 ShowMessage, not ported here); else code in bank a between
// ScriptBegin and ScriptEnd, the player's +$33 = 0 and +$10 = wPlayerFacing $C28A first. run(sh) is the ported
// script; the script's value is returned (ModeSelectMain's round). end = false leaves ScriptEnd to the caller.
export function* mapRunScript(sh, a, hl, b, end = true) {
  const w = sh.w;
  const wbank = w.high[0x196];
  if (!(hl & 0xE000)) {                          // a text: 0A:48AC WaitScriptActorIdle, 05:5D49 ShowMessage (b = speaker)
    yield* S.waitScriptActorIdle(sh);
    yield* inBankGen(w, 0x05, showMessage(sh, hl, b));
    setW(w, wbank);
    return;
  }
  const key = `${h2(a)}:${h4(hl)}`;
  const fn = MAP_SCRIPTS[key] || LOCAL_SCRIPTS[key];
  if (!fn) notPorted(`the map script ~${h2(a)}:${h4(hl)}`);
  D.inBank(w, 0x0A, () => S.scriptBegin(w));     // 0A:4092
  setW(w, 4);
  const p = r16(w, 0xC290);
  wr(w, p + 0x33, 0); wr(w, p + 0x10, rd(w, 0xC28A));
  const r = yield* inBankGen(w, a, fn(sh, b));   // 00:015E CallHLInBankA
  if (!end || (r !== undefined && r !== null)) { w.mapScriptBank = wbank; return r; }
  D.inBank(w, 0x0A, () => S.scriptEnd(w));       // 0A:40D6
  setW(w, wbank);
  return r;
}

// 0A:536E the partner's talk: the partner faces the player; "Shall we stop here?" ($0C46 + the partner, 0A:53F0 /
// 53FC: ids 4-7 -> 0-3; speaker 0) asked: No: nothing; Yes: $0C4A + the partner, the partner flags #144-#147 cleared,
// its script reset (0A:4342), #118 cleared, the map again at the saved position (warp $FA)
function* partnerTalk(sh) {
  const w = sh.w;
  const idx = id => (id === 4 ? 0 : id === 5 ? 1 : id === 6 ? 2 : id === 7 ? 3 : id);
  S.actorFaceActor(w, rd(w, 0xC298), 0x00);
  T.scriptSetText(w, (0x0C46 + idx(rd(w, 0xC299))) & 0xFFFF);
  yield* T.scriptShowTextKeepOpen(sh, 0x00);
  const a = yield* T.scriptAskYesNo(sh);
  yield* T.scriptCloseText(sh);
  yield* S.scriptWaitFrames(sh, 0x05);
  if (a) return;
  T.scriptSetText(w, (0x0C4A + idx(rd(w, 0xC299))) & 0xFFFF);
  yield* T.scriptShowText(sh, 0x00);
  for (const n of [144, 145, 146, 147]) clearFlag(w, n);
  S.actorResetScript(w, rd(w, 0xC298));
  clearFlag(w, 118);
  wr(w, 0xC441, 0xFA); wr(w, 0xC46A, 0xFA);
  for (let k = 0; k < 4; k++) wr(w, 0xC466 + k, rd(w, 0xC2A0 + k));
  wr(w, 0xC465, rd(w, 0xC2A4));
}
const LOCAL_SCRIPTS = { "0a:536e": partnerTalk };

// 0A:4A21 MapRun, as far as the enter script (0A:4F71 MapRunEnterScript: WY $90; MapRunScript with b = the player's
// slot; the WRAM bank restored after it): returns the script's value. The script's end is mapRunAfterScript.
export function* mapRunToEnterScript(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x0C);
  wr(w, 0xC4BF, 0x10);
  clearC85C(w);
  mapClearEvents(w);
  mapLoadHeader(w);
  mapPlaceAtEntrance(w);
  yield* sh.advance();
  sh.sound(rd(w, 0xC454));                       // 00:2C19 PlaySoundManaged (a = $10 at the test for $FF)
  wr(w, 0xC4BF, 0x20);
  mapInitObjects(w, rd(w, 0xC464), r16(w, 0xC45A));
  A.loadActorPalettes(w);                        // 04:4D2B
  setFlag(w, 20);
  yield* Scr.waitFade(sh);
  clearFlag(w, 20);
  wr(w, 0xC4BF, 0x30);
  wr(w, 0xC320, rd(w, 0xC466)); wr(w, 0xC321, rd(w, 0xC467));
  wr(w, 0xC322, rd(w, 0xC468)); wr(w, 0xC323, rd(w, 0xC469));
  yield* inBankGen(w, 0x0B, mapStartGfx(sh, rd(w, 0xC451)));
  wr(w, 0xC4BF, 0x40);
  if (w.vram) w.lcd.wy = 0x90;
  return yield* mapRunScript(sh, rd(w, 0xC464), r16(w, 0xC462), rd(w, 0xC296), false);
}

// after the enter script: its end (MapRunScript 0A:4F38 ScriptEnd, the WRAM bank as at MapRunEnterScript), MapRun
// 0A:4A90 taking a warp request (none: the map fades in, its name banner, its event loop until a warp), then MapEngine
// 0A:49C1: MapTakeWarp,
// the frame tasks cleared and MapDebugCoordsTask again, ready for the next MapRun
export function* mapRunAfterScript(sh, wbank, restart) {
  yield* mapRunEnd(sh, wbank);
  mapTakeWarp(sh.w);
  restart(sh.w);
}
// the rest of MapRun 0A:4A21 after the enter script (the ending's parts call MapRun itself, 0A:5720): ScriptEnd, the
// WRAM bank back, a warp request taken to $C46B; none: fade in, the name banner, the event loop until a warp
export function* mapRunEnd(sh, wbank) {
  const w = sh.w;
  D.inBank(w, 0x0A, () => S.scriptEnd(w));
  setW(w, wbank);
  const a = rd(w, 0xC441);
  if (a) { wr(w, 0xC441, 0); wr(w, 0xC46B, a); }
  else {                                         // 0A:4A9F: fade in, the name banner, the event loop to a warp
    Scr.beginFadeIn(w, 0x08);
    yield* Scr.waitFade(sh);
    yield* mapShowNameBanner(sh);
    yield* mapEventLoop(sh);
  }
}

// ---- the map's event loop ----
// 0A:4C6A ActorPointAhead: actor hl's position + VectorFromLengthAndAngle(de, its +$29 + a); maps WRAM4
function actorPointAhead(w, hl, a, de) {
  setW(w, 4);
  const [x, y] = vectorFromLengthAndAngle(de, (a + rd(w, hl + 0x29)) & 0xFF);   // 00:0AF2
  return [(r16(w, hl + 4) + x) & 0xFFFF, (r16(w, hl + 6) + y) & 0xFFFF];
}
// 0A:4C9B MapObjectAhead: the event cell $1C0 ahead of the player: its id when its type is 8 (an object), else 0
function mapObjectAhead(w) {
  const [x, y] = actorPointAhead(w, r16(w, 0xC290), 0, 0x01C0);
  const a = P.mapEventAt(w, x >> 8, y >> 8);
  return (a & 0x0F) === 8 ? a >> 4 : 0;
}
// 0A:4CC5 MapTalkTargetAhead: the actor $1C0 ahead of the player ($3C0 across a counter cell, type $C), else $180
// ahead at -$10 and at +$10 (04:56FD BuildActiveActorList, 04:55C4 FindActorNear): its slot, or 0
function mapTalkTargetAhead(w) {
  setW(w, 4);
  P.buildActiveActorList(w);
  const pl = r16(w, 0xC290);
  let [x, y] = actorPointAhead(w, pl, 0, 0x01C0);
  if ((P.mapEventAt(w, x >> 8, y >> 8) & 0x0F) === 0x0C) [x, y] = actorPointAhead(w, pl, 0, 0x03C0);
  let a = P.findActorNear(w, x, y);
  if (a) return a;
  a = P.findActorNear(w, ...actorPointAhead(w, pl, 0xF0, 0x0180));
  if (a) return a;
  return P.findActorNear(w, ...actorPointAhead(w, pl, 0x10, 0x0180));
}
// 0A:4D1F MapTriggerUnderPlayer: the player's cell: a trigger (type 1) whose id the trigger list (+10) has, or 0
function mapTriggerUnderPlayer(w) {
  const p = r16(w, 0xC290);
  const e = P.mapEventAt(w, rd(w, p + 5), rd(w, p + 7));
  if ((e & 0x0F) !== 1) return 0;
  const d = e >> 4;
  return mapListFind(w, rd(w, 0xC464), r16(w, 0xC460), d) ? d : 0;
}
// 0A:49C6 MapFindTalk: the talk target ahead: the partner as it is, another when the talk list (+6) has it for the
// player's facing and flags; else 0
function mapFindTalk(w) {
  const a = mapTalkTargetAhead(w);
  if (!a || a === rd(w, 0xC298)) return a;
  return mapListFind(w, rd(w, 0xC464), r16(w, 0xC45C), a, true) ? a : 0;
}
// 0A:49E9 MapFindObject: the object ahead when the object list (+8) has it (any flags)
function mapFindObject(w) {
  const a = mapObjectAhead(w);
  if (!a) return 0;
  return mapListFind(w, rd(w, 0xC464), r16(w, 0xC45E), a) ? a : 0;
}
// copy a list's 8-byte record to wMapRecord $C400 (00:0654 FarCopyBytes)
const copyRecord = (w, bank, hl) => { for (let k = 0; k < 8; k++) wr(w, 0xC400 + k, rb(bank, hl + k)); };
// 0A:4F96 MapTalkTo: the talk record of actor a: +6 bits: 0 the actor turns to the player (1 turns back after),
// 3 animation 1 while talking ($C29F keeps the old), 4 clear: its script frozen (+$1A = $FF); +$36 = 1 meanwhile
// ($C29E keeps it); the script +4 runs with b = the actor; the partner's talk: 0A:504A
function* mapTalkTo(sh, a) {
  const w = sh.w;
  if (a === rd(w, 0xC298)) {                     // 0A:504A: the record 0A:5365 to $C400, its script with b = a
    for (let k = 0; k < 8; k++) wr(w, 0xC400 + k, rb(0x0A, 0x5365 + k));
    yield* mapRunScript(sh, 0x0A, r16(w, 0xC404), a);
    return;
  }
  const bank = rd(w, 0xC464);
  const hl = mapListFind(w, bank, r16(w, 0xC45C), a, true);
  if (!hl) return;
  copyRecord(w, bank, hl);
  const b = rd(w, 0xC406);
  setW(w, 4);
  const de = A.actorSlotAddr(rd(w, 0xC400));
  wr(w, 0xC29E, rd(w, de + 0x36)); wr(w, de + 0x36, 1);
  if (!(b & 0x10)) wr(w, de + 0x1A, 0xFF);
  if (b & 8) { wr(w, 0xC29F, rd(w, de + 0x31)); if (de >> 8) actorSetAnim(w, de, 1); }   // 04:4E4C
  let c = 0;                                     // (FarCopyBytes left c = 0)
  if (b & 1) { c = rd(w, de + 0x10); wr(w, de + 0x10, (rd(w, 0xC28A) + 0x80) & 0xFF); }
  yield* mapRunScript(sh, bank, r16(w, 0xC404), rd(w, 0xC400));
  if (b & 2) wr(w, de + 0x10, c);
  if (b & 8 && de >> 8) actorSetAnim(w, de, rd(w, 0xC29F));
  if (!(b & 0x10)) wr(w, de + 0x1A, 0);
  wr(w, de + 0x36, rd(w, 0xC29E));
}
// 0A:5066 MapUseObject: object a's record (+8): flag #18 set; its flag word must pass; a script below $1000 clears
// #18 first; the script runs with b = the player's slot
function* mapUseObject(sh, a) {
  const w = sh.w, bank = rd(w, 0xC464);
  const hl = mapListFind(w, bank, r16(w, 0xC45E), a);
  if (!hl) return;
  copyRecord(w, bank, hl);
  setFlag(w, 18);
  const de = r16(w, 0xC402);
  if (de && !testFlagCondition(w, de)) return;
  const s = r16(w, 0xC404);
  if (!(s & 0xF000)) clearFlag(w, 18);
  yield* mapRunScript(sh, bank, s, rd(w, 0xC296));
}
// 0A:50CB MapStepTrigger (a trigger stepped on: runs unless its +6 is 1) / 0A:5109 MapCheckTrigger (A on it: runs
// when its +6 is not 0)
function* mapTrigger(sh, a, onA) {
  const w = sh.w, bank = rd(w, 0xC464);
  const hl = mapListFind(w, bank, r16(w, 0xC460), a, true);
  if (!hl) return;
  copyRecord(w, bank, hl);
  const t = rd(w, 0xC406);
  if (onA ? !t : t === 1) return;
  yield* mapRunScript(sh, bank, r16(w, 0xC404), rd(w, 0xC296));
}
// 0A:4DDB MapShowNameBanner: the map's name (wMapNameText $C4B4; none when 0) in a message box (05:5DE5, speaker
// $83, instant text) for $50 frames or until a button is held; then the box closed and the map redrawn
function* mapShowNameBanner(sh) {
  const w = sh.w, old = w.high[0x196];
  const hl = r16(w, 0xC4B4);
  if (hl) {
    yield* S.waitScriptActorIdle(sh);
    setW(w, 5);
    wr(w, 0xC82D, rd(w, 0xC82D) | 0x80);
    yield* inBankGen(w, 0x05, showMessageKeepOpen(sh, hl, 0x83));
    for (let b = 0x50; b; b--) {
      yield* sh.advance();
      if (w.high[0x190]) break;
    }
    W.closeMessageWindow(w);                     // 05:5F46
    yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
    yield* inBankGen(w, 0x05, W.updateWindows(sh));
    setW(w, 5);
    wr(w, 0xC82D, rd(w, 0xC82D) & 0x7F);
  }
  setW(w, old);
}
// 0A:4AAA MapEventLoop: the player's script stopped (04:44E6: 04:5288) while the events are seen to: a trigger
// stepped on (wMapEvent $C440), a warp ($C441: the loop ends), the start menu ($C444), a bump held $1E frames
// against the same actor ($C443: an action 2 with flag #23), the A button ($C442: talk, object, trigger under the
// player); with none pending the player walks again (04:44F9: 04:527A) until one is
export function* mapEventLoop(sh) {
  const w = sh.w;
  for (;;) {
    setW(w, 4);
    const pl = r16(w, 0xC290);
    if (pl >> 8) D.inBank(w, 0x04, () => A.actorSetScript(w, pl, 0x5288, 0x04));   // 04:44E6 ActorSetScript5288
    wr(w, (pl + 0x35) & 0xFFFF, 1);
    if (mapEventPending(w)) {
      let a = rd(w, 0xC440);
      if (a) { wr(w, 0xC440, 0); yield* mapTrigger(sh, a, false); }
      a = rd(w, 0xC441);
      if (a) { wr(w, 0xC441, 0); wr(w, 0xC46B, a); return; }
      if (rd(w, 0xC444)) {
        wr(w, 0xC444, 0);
        sh.sound(0x62);
        yield* S.waitScriptActorIdle(sh);
        yield* inBankGen(w, 0x41, mapStartMenu(sh));   // 41:6E6E
      }
      clearFlag(w, 23);
      if (rd(w, 0xC443)) {
        wr(w, 0xC443, 0);
        if (rd(w, 0xC28C) && rd(w, 0xC28C) === rd(w, 0xC28D) && rd(w, 0xC28E) >= 0x1E) {
          wr(w, 0xC28E, 0); setFlag(w, 23); wr(w, 0xC442, 2);
        }
      }
      const b = rd(w, 0xC442);
      if (!b) continue;
      wr(w, 0xC442, 0);
      if ((a = mapFindTalk(w))) yield* mapTalkTo(sh, a);
      else if ((a = mapFindObject(w))) yield* mapUseObject(sh, a);
      else if ((a = mapTriggerUnderPlayer(w))) yield* mapTrigger(sh, a, true);
      else if (b !== 2) {
        if (w.high[0x19E]) notPorted("the debug menu (~05:6B2E DebugMenu)");
        if (rd(w, 0xC450) === 2) {
          sh.sound(0x5C);
          yield* S.waitScriptActorIdle(sh);
          yield* inBankGen(w, 0x0A, navigationMenu(sh));   // 0A:7174
        }
      }
      continue;
    }
    yield* Scr.waitFade(sh);                     // 0A:4B6F
    const p = r16(w, 0xC290);
    if (p >> 8) {                                // 04:44F9 ActorSetScript527A
      setW(w, 4);
      D.inBank(w, 0x04, () => A.actorSetScript(w, p, 0x527A, 0x04));
      wr(w, p + 0x17, 0); wr(w, p + 0x1E, 0); wr(w, p + 0x33, 1);
    }
    do yield* sh.advance(); while (!mapEventPending(w));
  }
}

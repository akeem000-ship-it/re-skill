// The drills' briefings (bank $17): the panels of each training-court drill's briefing on the court diagram
// (screen.js: the sprites, the caption, the waits). A panel sets the sprites' places and their frame tasks, writes
// the caption, then waits for A or B; an animated panel steps its animation every 120 frames (the *_TickAnim /
// *_AdvanceAnim pairs: the step 0-3, each sprite's place from a table of (x, y) words by step, the arrows' flips
// by step, the target patch) until A or B.
// The nine briefings, by the drill (ShowDrillBriefingScreen): serve to the targets, the spin serve, serve between
// the poles, serve and volley, serve and smash (two versions), return to the target, return a lob, return down the
// line.
// Port of src/engine/menus/briefing/spin_17.asm, pole_17.asm, drill_17.asm, lob_17.asm, the start of rules_17.asm and
// the end of briefing_diagram_17.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own; the tables are read from the ROM. The
// panels' scripts were drafted from the disassembly with a converter and checked by hand.
// Tests: lockstep on out/port/brief_*.mtrec (each briefing, from story1's drills).
import { rd, wr, clearFrameTasks, hook, hookGen } from "../pause/defs.js";
import {
  BANK_BRIEFING, AnimatedTiles, TargetPalette, Player, Opponent, Ball, HMarker, Swing, Poles, VMarker, SpinMarker,
  RotMarker, Brackets, at, bracketSize, task, nextPanel, fromTable, byteAt, drawBriefingCaption, drawDiagramTargetOverlay,
  waitForInputBlinking, advanceFrameCheckInput, showDrillBriefingScreen, SCREEN_HOOKS,
} from "./screen.js";

// text ids (include/text_ids.inc)
const Text_36_688 = 0x1AB0, Text_36_689 = 0x1AB1, Text_36_690 = 0x1AB2, Text_36_691 = 0x1AB3, Text_36_692 = 0x1AB4;
const Text_36_693 = 0x1AB5, Text_36_694 = 0x1AB6, Text_36_695 = 0x1AB7, Text_36_696 = 0x1AB8, Text_36_697 = 0x1AB9;
const Text_36_698 = 0x1ABA, Text_36_699 = 0x1ABB, Text_36_700 = 0x1ABC, Text_36_701 = 0x1ABD, Text_36_702 = 0x1ABE;
const Text_36_703 = 0x1ABF, Text_36_704 = 0x1AC0, Text_36_705 = 0x1AC1, Text_36_706 = 0x1AC2, Text_36_707 = 0x1AC3;
const Text_36_708 = 0x1AC4, Text_36_709 = 0x1AC5, Text_36_710 = 0x1AC6, Text_36_711 = 0x1AC7, Text_36_712 = 0x1AC8;
const Text_36_713 = 0x1AC9, Text_37_3 = 0x1C03, Text_37_4 = 0x1C04, Text_37_5 = 0x1C05, Text_37_6 = 0x1C06;
const Text_37_7 = 0x1C07, Text_37_8 = 0x1C08, Text_37_9 = 0x1C09, Text_37_10 = 0x1C0A, Text_37_11 = 0x1C0B;
// the animations' tables (bank $17): [the (x, y) places by step], or a byte by step
const ServeToTargetsBriefing_AdvanceAnimTable = 0x57BB, ServeToTargetsBriefing_AdvanceAnim_BallPosTable = 0x57CB;
const ServeToTargetsBriefing_AdvanceAnim_HMarkerUnflippedTable = 0x57DB, ServeToTargetsBriefing_AdvanceAnim_HMarkerPosTable = 0x57DF;
const ServeToTargetsBriefing_AdvanceAnim_RotMarkerDirTable = 0x57EF, ServeToTargetsBriefing_AdvanceAnim_RotMarkerPosTable = 0x57F3;
const ServeToTargetsBriefing_AdvanceAnim_TargetOverlayTable = 0x5803, ServeToTargetsBriefing_AdvanceAnim_BracketPosTable = 0x5807;
const SpinServeBriefing_AdvanceAnimTable = 0x5BE5, SpinServeBriefing_AdvanceAnim_BallPosTable = 0x5BF5;
const SpinServeBriefing_AdvanceAnim_HMarkerUnflippedTable = 0x5C05, SpinServeBriefing_AdvanceAnim_HMarkerPosTable = 0x5C09;
const SpinServeBriefing_RotMarkerDirTable = 0x5C19, SpinServeBriefing_AdvanceAnim_RotMarkerPosTable = 0x5C1D;
const SpinServeBriefing_TargetOverlayTable = 0x5C2D, SpinServeBriefing_AdvanceAnim_BracketPosTable = 0x5C31;
const SpinServeBriefing_AdvanceAnim2_BallPosTable = 0x5C41, SpinServeBriefing_AdvanceAnim2_RotMarkerPosTable = 0x5C49;
const SpinServeBriefing_AdvanceAnim2_SpinMarkerUnflippedTable = 0x5C51, SpinServeBriefing_AdvanceAnim2_SpinMarkerPosTable = 0x5C53;
const SpinServeBriefing_AdvanceAnim2_SwingFrameTable = 0x5C5B, SpinServeBriefing_AdvanceAnim2_SwingPosTable = 0x5C5F;
const DrillBriefing_ServeThroughPolesTable = 0x5F06, PoleServeBriefing_AdvanceAnim2_PlayerPosTable = 0x5F16;
const PoleServeBriefing_AdvanceAnim_BallPosTable = 0x5F26, PoleServeBriefing_HMarkerUnflippedTable = 0x5F36;
const PoleServeBriefing_AdvanceAnim_HMarkerPosTable = 0x5F3A, PoleServeBriefing_AdvanceAnim2_HMarkerPosTable = 0x5F4A;
const PoleServeBriefing_AdvanceAnim_RotMarkerDirTable = 0x5F5A, PoleServeBriefing_AdvanceAnim_RotMarkerPosTable = 0x5F5E;
const PoleServeBriefing_TargetOverlayTable = 0x5F6E, PoleServeBriefing_AdvanceAnim2_BracketPosTable = 0x5F72;
const PoleServeBriefing_AdvanceAnim2_PolePosTable = 0x5F82;
const ServeAndVolleyBriefing_AdvanceAnimTable = 0x61B4, ServeAndVolleyBriefing_AdvanceAnim_OpponentPosTable = 0x61C4;
const ServeAndVolleyBriefing_AdvanceAnim_BallPosTable = 0x61D4, ServeAndVolleyBriefing_AdvanceAnim_HMarkerUnflippedTable = 0x61E4;
const ServeAndVolleyBriefing_AdvanceAnim_HMarkerPosTable = 0x61E8, ServeAndVolleyBriefing_AdvanceAnim_RotMarkerDirTable = 0x61F8;
const ServeAndVolleyBriefing_AdvanceAnim_RotMarkerPosTable = 0x61FC, ServeAndVolleyBriefing_AdvanceAnim_VMarkerUprightTable = 0x620C;
const ServeAndVolleyBriefing_AdvanceAnim_VMarkerPosTable = 0x6210, ServeAndVolleyBriefing_AdvanceAnim_BracketPosTable = 0x6220;
const DrillBriefing_ServeAndSmashTable = 0x64BD, DrillBriefing_ServeAndSmash_OpponentPosTable = 0x64CD;
const DrillBriefing_ServeAndSmash_BallPosTable = 0x64DD, DrillBriefing_ServeAndSmash_RotMarkerDirTable = 0x6501;
const DrillBriefing_ServeAndSmash_RotMarkerPosTable = 0x6505, DrillBriefing_ServeAndSmash_BracketPosTable = 0x6529;
const DrillBriefing_ServeAndSmash2Table = 0x67C6, DrillBriefing_ServeAndSmash2_OpponentPosTable = 0x67D6;
const DrillBriefing_ServeAndSmash2_BallPosTable = 0x67E6, DrillBriefing_ServeAndSmash2_RotMarkerDirTable = 0x680A;
const DrillBriefing_ServeAndSmash2_RotMarkerPosTable = 0x680E, DrillBriefing_ServeAndSmash2_BracketPosTable = 0x6832;
const ReturnToTargetBriefing_AdvanceAnimTable = 0x6A0B, ReturnToTargetBriefing_AdvanceAnim_OpponentPosTable = 0x6A1B;
const ReturnToTargetBriefing_AdvanceAnim_BallPosTable = 0x6A2B, ReturnToTargetBriefing_AdvanceAnim_HMarkerUnflippedTable = 0x6A3B;
const ReturnToTargetBriefing_AdvanceAnim_HMarkerPosTable = 0x6A3F, ReturnToTargetBriefing_AdvanceAnim_RotMarkerDirTable = 0x6A4F;
const ReturnToTargetBriefing_AdvanceAnim_RotMarkerPosTable = 0x6A53, ReturnToTargetBriefing_AdvanceAnim_BracketPosTable = 0x6A63;
const ReturnLobBriefing_AdvanceAnimTable = 0x6C6E, ReturnLobBriefing_AdvanceAnim_OpponentPosTable = 0x6C7E;
const ReturnLobBriefing_AdvanceAnim_BallPosTable = 0x6C8E, ReturnLobBriefing_AdvanceAnim_HMarkerUnflippedTable = 0x6C9E;
const ReturnLobBriefing_AdvanceAnim_HMarkerPosTable = 0x6CA2, ReturnLobBriefing_AdvanceAnim_RotMarkerDirTable = 0x6CB2;
const ReturnLobBriefing_AdvanceAnim_RotMarkerPosTable = 0x6CB6, ReturnLobBriefing_AdvanceAnim_BracketPosTable = 0x6CC6;
const ReturnLobBriefing_AdvanceAnim_SwingFrameTable = 0x6CD6, ReturnLobBriefing_AdvanceAnim_SwingPosTable = 0x6CDA;
const ReturnDownLineBriefing_AdvanceAnimTable = 0x6EB3, ReturnDownLineBriefing_AdvanceAnim_OpponentPosTable = 0x6EC3;
const ReturnDownLineBriefing_AdvanceAnim_BallPosTable = 0x6ED3, ReturnDownLineBriefing_AdvanceAnim_HMarkerUnflippedTable = 0x6EE3;
const ReturnDownLineBriefing_AdvanceAnim_HMarkerPosTable = 0x6EE7, ReturnDownLineBriefing_AdvanceAnim_VMarkerUprightTable = 0x6EF7;
const ReturnDownLineBriefing_AdvanceAnim_VMarkerPosTable = 0x6EFB, ReturnDownLineBriefing_AdvanceAnim_BracketPosTable = 0x6F0B;
const ANIM_STEP_FRAMES = 0x78;                                   // a step every 120 frames
const ANIM_STEPS = 4;

// ---- the animation steps ----
// the next step (0-3): the timer back to 0; returns the step
function nextStep(P) {
  wr(P, "briefingAnimTimer", 0);
  const step = (rd(P, "briefingAnimStep") + 1) & (ANIM_STEPS - 1);
  wr(P, "briefingAnimStep", step);
  return step;
}
// *_TickAnim: the timer up a frame; at 120 the next step
function tick(P, advance) {
  const t = (rd(P, "briefingAnimTimer") + 1) & 0xFF;
  wr(P, "briefingAnimTimer", t);
  if (t >= ANIM_STEP_FRAMES) advance(P);
}
// ServeToTargetsBriefing_AdvanceAnim (17:571B)
export function serveToTargetsBriefingAdvanceAnim(P) {
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", ServeToTargetsBriefing_AdvanceAnimTable, c);
  fromTable(P, "Bracket", ServeToTargetsBriefing_AdvanceAnim_BracketPosTable, c);
  fromTable(P, "Ball", ServeToTargetsBriefing_AdvanceAnim_BallPosTable, c);
  wr(P, "briefingHMarkerUnflipped", byteAt(P, ServeToTargetsBriefing_AdvanceAnim_HMarkerUnflippedTable, step));
  fromTable(P, "HMarker", ServeToTargetsBriefing_AdvanceAnim_HMarkerPosTable, c);
  wr(P, "briefingRotMarkerDir", byteAt(P, ServeToTargetsBriefing_AdvanceAnim_RotMarkerDirTable, step));
  fromTable(P, "RotMarker", ServeToTargetsBriefing_AdvanceAnim_RotMarkerPosTable, c);
  drawDiagramTargetOverlay(P, byteAt(P, ServeToTargetsBriefing_AdvanceAnim_TargetOverlayTable, rd(P, "briefingAnimStep")));
}
// ServeToTargetsBriefing_TickAnim (17:570F)
export const serveToTargetsBriefingTickAnim = P => tick(P, serveToTargetsBriefingAdvanceAnim);
// SpinServeBriefing_AdvanceAnim (17:5A81): the serve's steps
export function spinServeBriefingAdvanceAnim(P) {
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", SpinServeBriefing_AdvanceAnimTable, c);
  fromTable(P, "Bracket", SpinServeBriefing_AdvanceAnim_BracketPosTable, c);
  fromTable(P, "Ball", SpinServeBriefing_AdvanceAnim_BallPosTable, c);
  wr(P, "briefingHMarkerUnflipped", byteAt(P, SpinServeBriefing_AdvanceAnim_HMarkerUnflippedTable, step));
  fromTable(P, "HMarker", SpinServeBriefing_AdvanceAnim_HMarkerPosTable, c);
  wr(P, "briefingRotMarkerDir", byteAt(P, SpinServeBriefing_RotMarkerDirTable, step));
  fromTable(P, "RotMarker", SpinServeBriefing_AdvanceAnim_RotMarkerPosTable, c);
  drawDiagramTargetOverlay(P, byteAt(P, SpinServeBriefing_TargetOverlayTable, rd(P, "briefingAnimStep")));
}
export const spinServeBriefingTickAnim = P => tick(P, spinServeBriefingAdvanceAnim);   // (17:5A75)
// SpinServeBriefing_AdvanceAnim2 (17:5B2D): the spin's two steps (the step toggled), the swing by handedness
export function spinServeBriefingAdvanceAnim2(P) {
  wr(P, "briefingAnimTimer", 0);
  const step = rd(P, "briefingAnimStep") ^ 1, c = step * 4;
  wr(P, "briefingAnimStep", step);
  fromTable(P, "Player", SpinServeBriefing_AdvanceAnimTable, c);
  fromTable(P, "Ball", SpinServeBriefing_AdvanceAnim2_BallPosTable, c);
  wr(P, "briefingRotMarkerDir", byteAt(P, SpinServeBriefing_RotMarkerDirTable, step));
  fromTable(P, "RotMarker", SpinServeBriefing_AdvanceAnim2_RotMarkerPosTable, c);
  wr(P, "briefingSpinMarkerUnflipped", byteAt(P, SpinServeBriefing_AdvanceAnim2_SpinMarkerUnflippedTable, step));
  fromTable(P, "SpinMarker", SpinServeBriefing_AdvanceAnim2_SpinMarkerPosTable, c);
  const lefty = rd(P, "storyModeMainCharacterLeftHanded") ? 2 : 0;
  wr(P, "briefingSwingFrame", byteAt(P, SpinServeBriefing_AdvanceAnim2_SwingFrameTable, rd(P, "briefingAnimStep") + lefty));
  fromTable(P, "Swing", SpinServeBriefing_AdvanceAnim2_SwingPosTable, c);
  drawDiagramTargetOverlay(P, byteAt(P, SpinServeBriefing_TargetOverlayTable, rd(P, "briefingAnimStep")));
}
export const spinServeBriefingTickAnim2 = P => tick(P, spinServeBriefingAdvanceAnim2);   // (17:5B21)
// PoleServeBriefing_AdvanceAnim (17:5DDC): the serve between the poles
export function poleServeBriefingAdvanceAnim(P) {
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", DrillBriefing_ServeThroughPolesTable, c);
  fromTable(P, "Ball", PoleServeBriefing_AdvanceAnim_BallPosTable, c);
  wr(P, "briefingHMarkerUnflipped", byteAt(P, PoleServeBriefing_HMarkerUnflippedTable, step));
  fromTable(P, "HMarker", PoleServeBriefing_AdvanceAnim_HMarkerPosTable, c);
  wr(P, "briefingRotMarkerDir", byteAt(P, PoleServeBriefing_AdvanceAnim_RotMarkerDirTable, step));
  fromTable(P, "RotMarker", PoleServeBriefing_AdvanceAnim_RotMarkerPosTable, c);
  drawDiagramTargetOverlay(P, byteAt(P, PoleServeBriefing_TargetOverlayTable, rd(P, "briefingAnimStep")));
}
export const poleServeBriefingTickAnim = P => tick(P, poleServeBriefingAdvanceAnim);   // (17:5DD0)
// PoleServeBriefing_AdvanceAnim2 (17:5E74): the poles moving with the target (the second pole 8 pixels right)
export function poleServeBriefingAdvanceAnim2(P) {
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", PoleServeBriefing_AdvanceAnim2_PlayerPosTable, c);
  fromTable(P, "Bracket", PoleServeBriefing_AdvanceAnim2_BracketPosTable, c);
  fromTable(P, "Pole1", PoleServeBriefing_AdvanceAnim2_PolePosTable, c);
  wr(P, "briefingPole2X", byteAt(P, PoleServeBriefing_AdvanceAnim2_PolePosTable, c) + 8);
  wr(P, "briefingPole2Y", rd(P, "briefingPole1Y"));
  wr(P, "briefingHMarkerUnflipped", byteAt(P, PoleServeBriefing_HMarkerUnflippedTable, rd(P, "briefingAnimStep")));
  fromTable(P, "HMarker", PoleServeBriefing_AdvanceAnim2_HMarkerPosTable, c);
  drawDiagramTargetOverlay(P, byteAt(P, PoleServeBriefing_TargetOverlayTable, rd(P, "briefingAnimStep")));
}
export const poleServeBriefingTickAnim2 = P => tick(P, poleServeBriefingAdvanceAnim2);   // (17:5E68)
// ServeAndVolleyBriefing_AdvanceAnim (17:60EC)
export function serveAndVolleyBriefingAdvanceAnim(P) {
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", ServeAndVolleyBriefing_AdvanceAnimTable, c);
  fromTable(P, "Opponent", ServeAndVolleyBriefing_AdvanceAnim_OpponentPosTable, c);
  fromTable(P, "Bracket", ServeAndVolleyBriefing_AdvanceAnim_BracketPosTable, c);
  fromTable(P, "Ball", ServeAndVolleyBriefing_AdvanceAnim_BallPosTable, c);
  wr(P, "briefingHMarkerUnflipped", byteAt(P, ServeAndVolleyBriefing_AdvanceAnim_HMarkerUnflippedTable, step));
  fromTable(P, "HMarker", ServeAndVolleyBriefing_AdvanceAnim_HMarkerPosTable, c);
  wr(P, "briefingRotMarkerDir", byteAt(P, ServeAndVolleyBriefing_AdvanceAnim_RotMarkerDirTable, rd(P, "briefingAnimStep")));
  fromTable(P, "RotMarker", ServeAndVolleyBriefing_AdvanceAnim_RotMarkerPosTable, c);
  wr(P, "briefingVMarkerUpright", byteAt(P, ServeAndVolleyBriefing_AdvanceAnim_VMarkerUprightTable, rd(P, "briefingAnimStep")));
  fromTable(P, "VMarker", ServeAndVolleyBriefing_AdvanceAnim_VMarkerPosTable, c);
}
export const serveAndVolleyBriefingTickAnim = P => tick(P, serveAndVolleyBriefingAdvanceAnim);   // (17:60DF)
// the smash briefings' loop step (DrillBriefing_ServeAndSmash .loop 17:6421, ..._ServeAndSmash2 .loop 17:672A)
function smashStep(P, player, opponent, bracket, ball, rotDir, rot) {
  const t = (rd(P, "briefingAnimTimer") + 1) & 0xFF;
  wr(P, "briefingAnimTimer", t);
  if (t < ANIM_STEP_FRAMES) return;
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", player, c);
  fromTable(P, "Opponent", opponent, c);
  fromTable(P, "Bracket", bracket, c);
  fromTable(P, "Ball", ball, c);
  wr(P, "briefingRotMarkerDir", byteAt(P, rotDir, rd(P, "briefingAnimStep")));
  fromTable(P, "RotMarker", rot, c);
}
const serveAndSmashBriefingStep = P => smashStep(P, DrillBriefing_ServeAndSmashTable, DrillBriefing_ServeAndSmash_OpponentPosTable,
  DrillBriefing_ServeAndSmash_BracketPosTable, DrillBriefing_ServeAndSmash_BallPosTable,
  DrillBriefing_ServeAndSmash_RotMarkerDirTable, DrillBriefing_ServeAndSmash_RotMarkerPosTable);
const serveAndSmash2BriefingStep = P => smashStep(P, DrillBriefing_ServeAndSmash2Table, DrillBriefing_ServeAndSmash2_OpponentPosTable,
  DrillBriefing_ServeAndSmash2_BracketPosTable, DrillBriefing_ServeAndSmash2_BallPosTable,
  DrillBriefing_ServeAndSmash2_RotMarkerDirTable, DrillBriefing_ServeAndSmash2_RotMarkerPosTable);
// ReturnToTargetBriefing_AdvanceAnim (17:6965)
export function returnToTargetBriefingAdvanceAnim(P) {
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", ReturnToTargetBriefing_AdvanceAnimTable, c);
  fromTable(P, "Opponent", ReturnToTargetBriefing_AdvanceAnim_OpponentPosTable, c);
  fromTable(P, "Bracket", ReturnToTargetBriefing_AdvanceAnim_BracketPosTable, c);
  fromTable(P, "Ball", ReturnToTargetBriefing_AdvanceAnim_BallPosTable, c);
  wr(P, "briefingHMarkerUnflipped", byteAt(P, ReturnToTargetBriefing_AdvanceAnim_HMarkerUnflippedTable, step));
  fromTable(P, "HMarker", ReturnToTargetBriefing_AdvanceAnim_HMarkerPosTable, c);
  wr(P, "briefingRotMarkerDir", byteAt(P, ReturnToTargetBriefing_AdvanceAnim_RotMarkerDirTable, rd(P, "briefingAnimStep")));
  fromTable(P, "RotMarker", ReturnToTargetBriefing_AdvanceAnim_RotMarkerPosTable, c);
}
export const returnToTargetBriefingTickAnim = P => tick(P, returnToTargetBriefingAdvanceAnim);   // (17:6958)
// ReturnLobBriefing_AdvanceAnim (17:6BA6)
export function returnLobBriefingAdvanceAnim(P) {
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", ReturnLobBriefing_AdvanceAnimTable, c);
  fromTable(P, "Opponent", ReturnLobBriefing_AdvanceAnim_OpponentPosTable, c);
  fromTable(P, "Bracket", ReturnLobBriefing_AdvanceAnim_BracketPosTable, c);
  fromTable(P, "Ball", ReturnLobBriefing_AdvanceAnim_BallPosTable, c);
  wr(P, "briefingHMarkerUnflipped", byteAt(P, ReturnLobBriefing_AdvanceAnim_HMarkerUnflippedTable, step));
  fromTable(P, "HMarker", ReturnLobBriefing_AdvanceAnim_HMarkerPosTable, c);
  wr(P, "briefingRotMarkerDir", byteAt(P, ReturnLobBriefing_AdvanceAnim_RotMarkerDirTable, rd(P, "briefingAnimStep")));
  fromTable(P, "RotMarker", ReturnLobBriefing_AdvanceAnim_RotMarkerPosTable, c);
  wr(P, "briefingSwingFrame", byteAt(P, ReturnLobBriefing_AdvanceAnim_SwingFrameTable, rd(P, "briefingAnimStep")));
  fromTable(P, "Swing", ReturnLobBriefing_AdvanceAnim_SwingPosTable, c);
}
export const returnLobBriefingTickAnim = P => tick(P, returnLobBriefingAdvanceAnim);   // (17:6B99)
// ReturnDownLineBriefing_AdvanceAnim (17:6E0D)
export function returnDownLineBriefingAdvanceAnim(P) {
  const step = nextStep(P), c = step * 4;
  fromTable(P, "Player", ReturnDownLineBriefing_AdvanceAnimTable, c);
  fromTable(P, "Opponent", ReturnDownLineBriefing_AdvanceAnim_OpponentPosTable, c);
  fromTable(P, "Bracket", ReturnDownLineBriefing_AdvanceAnim_BracketPosTable, c);
  fromTable(P, "Ball", ReturnDownLineBriefing_AdvanceAnim_BallPosTable, c);
  wr(P, "briefingHMarkerUnflipped", byteAt(P, ReturnDownLineBriefing_AdvanceAnim_HMarkerUnflippedTable, step));
  fromTable(P, "HMarker", ReturnDownLineBriefing_AdvanceAnim_HMarkerPosTable, c);
  wr(P, "briefingVMarkerUpright", byteAt(P, ReturnDownLineBriefing_AdvanceAnim_VMarkerUprightTable, rd(P, "briefingAnimStep")));
  fromTable(P, "VMarker", ReturnDownLineBriefing_AdvanceAnim_VMarkerPosTable, c);
}
export const returnDownLineBriefingTickAnim = P => tick(P, returnDownLineBriefingAdvanceAnim);   // (17:6E00)

// ---- the briefings ----
// DrillBriefing_ServeToTargets (17:557F): serve to the targets: the serve, its target, the bracketed target box
export function* drillBriefingServeToTargets(P) {
  wr(P, "briefingAnimStep", 0x03);
  serveToTargetsBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  task(P, TargetPalette);
  yield* drawBriefingCaption(P, Text_36_688);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do serveToTargetsBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x00)));
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  serveToTargetsBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, HMarker);
  task(P, TargetPalette);
  bracketSize(P, 0x00, 0x00);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_689);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do serveToTargetsBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x00)));
  nextPanel(P);
  at(P, "Player", 0x54, 0x44);
  task(P, Player);
  at(P, "Ball", 0x4E, 0x38);
  task(P, Ball);
  wr(P, "briefingHMarkerUnflipped", 0x00);
  at(P, "HMarker", 0x3A, 0x24);
  task(P, HMarker);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x52, 0x40);
  task(P, RotMarker);
  drawDiagramTargetOverlay(P, 0x04);
  task(P, TargetPalette);
  bracketSize(P, 0x00, 0x00);
  at(P, "Bracket", 0x40, 0x24);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_690);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  serveToTargetsBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Ball);
  task(P, RotMarker);
  task(P, TargetPalette);
  bracketSize(P, 0x00, 0x00);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_691);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do serveToTargetsBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}
// DrillBriefing_SpinServe (17:5817): the spin serve: the serve, its target, the spin and the swing
export function* drillBriefingSpinServe(P) {
  wr(P, "briefingAnimStep", 0x03);
  spinServeBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  task(P, TargetPalette);
  yield* drawBriefingCaption(P, Text_36_692);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do spinServeBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x00)));
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  spinServeBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, HMarker);
  task(P, TargetPalette);
  bracketSize(P, 0x00, 0x00);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_693);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do spinServeBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x00)));
  nextPanel(P);
  at(P, "Player", 0x52, 0x44);
  task(P, Player);
  at(P, "Ball", 0x4E, 0x38);
  task(P, Ball);
  wr(P, "briefingHMarkerUnflipped", 0x00);
  at(P, "HMarker", 0x3A, 0x24);
  task(P, HMarker);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x52, 0x40);
  task(P, RotMarker);
  drawDiagramTargetOverlay(P, 0x04);
  task(P, TargetPalette);
  bracketSize(P, 0x00, 0x00);
  at(P, "Bracket", 0x40, 0x24);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_694);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  at(P, "Player", 0x52, 0x44);
  task(P, Player);
  at(P, "Ball", 0x46, 0x28);
  task(P, Ball);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x49, 0x2F);
  task(P, RotMarker);
  wr(P, "briefingSpinMarkerUnflipped", 0x01);
  at(P, "SpinMarker", 0x30, 0x22);
  task(P, SpinMarker);
  drawDiagramTargetOverlay(P, 0x04);
  task(P, TargetPalette);
  yield* drawBriefingCaption(P, Text_36_695);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x00);
  spinServeBriefingAdvanceAnim2(P);
  task(P, Player);
  task(P, Ball);
  task(P, RotMarker);
  task(P, SpinMarker);
  task(P, Swing);
  task(P, TargetPalette);
  yield* drawBriefingCaption(P, rd(P, "storyModeMainCharacterLeftHanded") ? Text_36_697 : Text_36_696);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do spinServeBriefingTickAnim2(P); while (!(yield* advanceFrameCheckInput(P, 0x00)));
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  spinServeBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Ball);
  task(P, RotMarker);
  task(P, TargetPalette);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_698);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do spinServeBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}
// DrillBriefing_ServeThroughPoles (17:5C67): serve between the poles
export function* drillBriefingServeThroughPoles(P) {
  wr(P, "briefingAnimStep", 0x03);
  poleServeBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  task(P, TargetPalette);
  yield* drawBriefingCaption(P, Text_36_699);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do poleServeBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x00)));
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  poleServeBriefingAdvanceAnim2(P);
  task(P, Player);
  task(P, HMarker);
  task(P, TargetPalette);
  bracketSize(P, 0x00, 0x00);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_700);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do {
    poleServeBriefingTickAnim2(P);
    fromTable(P, "Player", DrillBriefing_ServeThroughPolesTable, rd(P, "briefingAnimStep") * 4);   // (the first animation's places)
  } while (!(yield* advanceFrameCheckInput(P, 0x00)));
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  poleServeBriefingAdvanceAnim2(P);
  task(P, Player);
  wr(P, "briefingHMarkerUnflipped", 0x00);
  at(P, "HMarker", 0x4B, 0x36);
  task(P, HMarker);
  task(P, Poles);
  task(P, TargetPalette);
  bracketSize(P, 0x00, 0x00);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_701);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  poleServeBriefingAdvanceAnim2(P);
  task(P, Player);
  task(P, Poles);
  task(P, TargetPalette);
  bracketSize(P, 0x00, 0x00);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_702);
  do poleServeBriefingTickAnim2(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}
// DrillBriefing_ServeAndVolley (17:5F92): serve and volley
export function* drillBriefingServeAndVolley(P) {
  at(P, "Player", 0x52, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  at(P, "Ball", 0x4E, 0x38);
  task(P, Ball);
  wr(P, "briefingHMarkerUnflipped", 0x00);
  at(P, "HMarker", 0x3A, 0x3C);
  task(P, HMarker);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x52, 0x40);
  task(P, RotMarker);
  drawDiagramTargetOverlay(P, 0x06);
  task(P, TargetPalette);
  yield* drawBriefingCaption(P, Text_36_703);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  drawDiagramTargetOverlay(P, 0);                   // (b as RegisterFrameTask leaves it)
  wr(P, "briefingAnimStep", 0x03);
  serveAndVolleyBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Opponent);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  task(P, VMarker);
  bracketSize(P, 0x0D, 0x0F);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_704);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  serveAndVolleyBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Opponent);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  task(P, VMarker);
  bracketSize(P, 0x0D, 0x0F);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_705);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do serveAndVolleyBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}
// DrillBriefing_ServeAndSmash (17:6230): serve and smash
export function* drillBriefingServeAndSmash(P) {
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  at(P, "Ball", 0x4E, 0x38);
  task(P, Ball);
  wr(P, "briefingHMarkerUnflipped", 0x00);
  at(P, "HMarker", 0x3A, 0x20);
  task(P, HMarker);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x52, 0x40);
  task(P, RotMarker);
  bracketSize(P, 0x0D, 0x00);
  at(P, "Bracket", 0x3E, 0x22);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_706);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  wr(P, "briefingHMarkerUnflipped", 0x00);
  at(P, "HMarker", 0x3A, 0x3C);
  task(P, HMarker);
  drawDiagramTargetOverlay(P, 0x06);
  task(P, TargetPalette);
  yield* drawBriefingCaption(P, Text_36_707);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  drawDiagramTargetOverlay(P, 0);                   // (b as RegisterFrameTask leaves it)
  at(P, "Player", 0x52, 0x30);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  at(P, "Ball", 0x5D, 0x1B);
  task(P, Ball);
  wr(P, "briefingRotMarkerDir", 0x01);
  at(P, "RotMarker", 0x46, 0x16);
  task(P, RotMarker);
  wr(P, "briefingVMarkerUpright", 0x00);
  at(P, "VMarker", 0x5B, 0x21);
  task(P, VMarker);
  wr(P, "briefingSwingFrame", 0x04);
  at(P, "Swing", 0x2D, 0x30);
  task(P, Swing);
  yield* drawBriefingCaption(P, Text_36_708);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  at(P, "Ball", 0x50, 0x37);
  task(P, Ball);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x54, 0x3D);
  task(P, RotMarker);
  bracketSize(P, 0x0D, 0x00);
  at(P, "Bracket", 0x3E, 0x22);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_709);
  // (the animation goes on from the timer and step the panels before left)
  do serveAndSmashBriefingStep(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}
// DrillBriefing_ServeAndSmash2 (17:6539): serve and smash, the second version
export function* drillBriefingServeAndSmash2(P) {
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  at(P, "Ball", 0x4E, 0x38);
  task(P, Ball);
  wr(P, "briefingHMarkerUnflipped", 0x00);
  at(P, "HMarker", 0x3A, 0x20);
  task(P, HMarker);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x52, 0x40);
  task(P, RotMarker);
  bracketSize(P, 0x0D, 0x00);
  at(P, "Bracket", 0x3E, 0x22);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_710);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  wr(P, "briefingHMarkerUnflipped", 0x00);
  at(P, "HMarker", 0x3A, 0x3C);
  task(P, HMarker);
  drawDiagramTargetOverlay(P, 0x06);
  task(P, TargetPalette);
  yield* drawBriefingCaption(P, Text_36_711);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  drawDiagramTargetOverlay(P, 0);                   // (b as RegisterFrameTask leaves it)
  at(P, "Player", 0x52, 0x30);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  at(P, "Ball", 0x5D, 0x1B);
  task(P, Ball);
  wr(P, "briefingRotMarkerDir", 0x01);
  at(P, "RotMarker", 0x46, 0x16);
  task(P, RotMarker);
  wr(P, "briefingVMarkerUpright", 0x00);
  at(P, "VMarker", 0x5B, 0x21);
  task(P, VMarker);
  wr(P, "briefingSwingFrame", 0x05);
  at(P, "Swing", 0x2D, 0x30);
  task(P, Swing);
  yield* drawBriefingCaption(P, Text_36_712);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x34, 0x06);
  task(P, Opponent);
  at(P, "Ball", 0x50, 0x37);
  task(P, Ball);
  wr(P, "briefingRotMarkerDir", 0x03);
  at(P, "RotMarker", 0x54, 0x3D);
  task(P, RotMarker);
  bracketSize(P, 0x0D, 0x00);
  at(P, "Bracket", 0x3E, 0x22);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_36_713);
  // (the animation goes on from the timer and step the panels before left)
  do serveAndSmash2BriefingStep(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}
// DrillBriefing_ReturnToTarget (17:6842): return to the target
export function* drillBriefingReturnToTarget(P) {
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x3A, 0x03);
  task(P, Opponent);
  at(P, "Ball", 0x54, 0x28);
  task(P, Ball);
  wr(P, "briefingRotMarkerDir", 0x01);
  at(P, "RotMarker", 0x4C, 0x16);
  task(P, RotMarker);
  yield* drawBriefingCaption(P, Text_37_3);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  returnToTargetBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Opponent);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  bracketSize(P, 0x0D, 0x09);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_37_4);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  returnToTargetBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Opponent);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  bracketSize(P, 0x0D, 0x09);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_37_5);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do returnToTargetBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}
// DrillBriefing_ReturnLob (17:6A73): return a lob
export function* drillBriefingReturnLob(P) {
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x3A, 0x03);
  task(P, Opponent);
  at(P, "Ball", 0x56, 0x28);
  task(P, Ball);
  wr(P, "briefingRotMarkerDir", 0x01);
  at(P, "RotMarker", 0x4C, 0x16);
  task(P, RotMarker);
  yield* drawBriefingCaption(P, Text_37_6);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  returnLobBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Opponent);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  task(P, Swing);
  bracketSize(P, 0x0D, 0x09);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_37_7);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  returnLobBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Opponent);
  task(P, Ball);
  task(P, HMarker);
  task(P, RotMarker);
  task(P, Swing);
  bracketSize(P, 0x0D, 0x09);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_37_8);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do returnLobBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}
// DrillBriefing_ReturnDownLine (17:6CEA): return down the line
export function* drillBriefingReturnDownLine(P) {
  at(P, "Player", 0x55, 0x44);
  task(P, Player);
  at(P, "Opponent", 0x3A, 0x03);
  task(P, Opponent);
  at(P, "Ball", 0x54, 0x28);
  task(P, Ball);
  wr(P, "briefingRotMarkerDir", 0x01);
  at(P, "RotMarker", 0x4C, 0x16);
  task(P, RotMarker);
  yield* drawBriefingCaption(P, Text_37_9);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  returnDownLineBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Opponent);
  task(P, Ball);
  task(P, HMarker);
  task(P, VMarker);
  bracketSize(P, 0x00, 0x09);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_37_10);
  yield* waitForInputBlinking(P);
  nextPanel(P);
  wr(P, "briefingAnimStep", 0x03);
  returnDownLineBriefingAdvanceAnim(P);
  task(P, Player);
  task(P, Opponent);
  task(P, Ball);
  task(P, HMarker);
  task(P, VMarker);
  bracketSize(P, 0x00, 0x09);
  task(P, Brackets);
  yield* drawBriefingCaption(P, Text_37_11);
  wr(P, "briefingAnimTimer", 0);
  wr(P, "briefingAnimStep", 0);
  do returnDownLineBriefingTickAnim(P); while (!(yield* advanceFrameCheckInput(P, 0x01)));
  clearFrameTasks(P);
}

// ShowDrillBriefingScreen's table, by briefing
const DRILL_BRIEFINGS = [drillBriefingServeToTargets, drillBriefingSpinServe, drillBriefingServeThroughPoles,
  drillBriefingServeAndVolley, drillBriefingServeAndSmash, drillBriefingServeAndSmash2, drillBriefingReturnToTarget,
  drillBriefingReturnLob, drillBriefingReturnDownLine];

const B = BANK_BRIEFING;
export const HOOKS = [
  ...SCREEN_HOOKS,
  [B, 0x4487, hookGen(P => showDrillBriefingScreen(P, DRILL_BRIEFINGS))],
  [B, 0x557F, hookGen(P => drillBriefingServeToTargets(P))],
  [B, 0x570F, hook(P => { serveToTargetsBriefingTickAnim(P); })],
  [B, 0x571B, hook(P => { serveToTargetsBriefingAdvanceAnim(P); })],
  [B, 0x5817, hookGen(P => drillBriefingSpinServe(P))],
  [B, 0x5A75, hook(P => { spinServeBriefingTickAnim(P); })],
  [B, 0x5A81, hook(P => { spinServeBriefingAdvanceAnim(P); })],
  [B, 0x5B21, hook(P => { spinServeBriefingTickAnim2(P); })],
  [B, 0x5B2D, hook(P => { spinServeBriefingAdvanceAnim2(P); })],
  [B, 0x5C67, hookGen(P => drillBriefingServeThroughPoles(P))],
  [B, 0x5DD0, hook(P => { poleServeBriefingTickAnim(P); })],
  [B, 0x5DDC, hook(P => { poleServeBriefingAdvanceAnim(P); })],
  [B, 0x5E68, hook(P => { poleServeBriefingTickAnim2(P); })],
  [B, 0x5E74, hook(P => { poleServeBriefingAdvanceAnim2(P); })],
  [B, 0x5F92, hookGen(P => drillBriefingServeAndVolley(P))],
  [B, 0x60DF, hook(P => { serveAndVolleyBriefingTickAnim(P); })],
  [B, 0x60EC, hook(P => { serveAndVolleyBriefingAdvanceAnim(P); })],
  [B, 0x6230, hookGen(P => drillBriefingServeAndSmash(P))],
  [B, 0x6539, hookGen(P => drillBriefingServeAndSmash2(P))],
  [B, 0x6842, hookGen(P => drillBriefingReturnToTarget(P))],
  [B, 0x6958, hook(P => { returnToTargetBriefingTickAnim(P); })],
  [B, 0x6965, hook(P => { returnToTargetBriefingAdvanceAnim(P); })],
  [B, 0x6A73, hookGen(P => drillBriefingReturnLob(P))],
  [B, 0x6B99, hook(P => { returnLobBriefingTickAnim(P); })],
  [B, 0x6BA6, hook(P => { returnLobBriefingAdvanceAnim(P); })],
  [B, 0x6CEA, hookGen(P => drillBriefingReturnDownLine(P))],
  [B, 0x6E00, hook(P => { returnDownLineBriefingTickAnim(P); })],
  [B, 0x6E0D, hook(P => { returnDownLineBriefingAdvanceAnim(P); })],
];

// The match engine (web/js/engine) inside the whole-game port. P.E is a MatchEngine over the port's bus, so its
// routines read and write the machine's own RAM. What the engine leaves to E.ext when it runs on its own (the frame
// barrier, music, the pause menu, message windows, the drawing and the HUD objects) is done here by the ROM's own
// routines: ported JS where there is some, else the ROM's code (P.callRom / P.runRom, which run any port hooked at
// the address).
// Routine names and addresses from the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm).
import * as draw from "./draw.js";
import * as obj from "./obj.js";
import { callModeHook } from "./match.js";

// PlaySoundManaged (00:3024): the sound request `rst $08 ; db id` makes, with the id in a
export function playSoundManaged(P, id) { P.callRom(0, 0x3024, { a: id }); }
// a far call into the ROM (farcall: the bank mapped and hRomBank set for the call, then restored)
const far = (P, bank, addr, regs = {}) => P.callRom(bank, addr, regs);
const hl = v => ({ h: (v >> 8) & 0xFF, l: v & 0xFF }), de = v => ({ d: (v >> 8) & 0xFF, e: v & 0xFF }), bc = v => ({ b: (v >> 8) & 0xFF, c: v & 0xFF });

// E.ext for the port (see STANDALONE in web/js/engine/engine.js for the list)
function portExt(P) {
  return {
    *advanceFrame() { yield* P.runRom(0, 0x2631); },                    // AdvanceFrame
    playMusic(E, id) { playSoundManaged(P, id); },
    *runMatchPauseMenu() { yield* P.runRom(6, 0x4074); },                // RunMatchPauseMenu
    *showMessageWindow(E, text, cell, size) { yield* P.runRom(6, 0x44FE, { ...hl(text), ...de(cell), ...bc(size) }); },   // ShowMessageWindow
    *runLinkMatchFrame() { yield* P.runRom(7, 0x4762); },                // RunLinkMatchFrame
    *showMinigamePointResult(E, d) { yield* P.runRom(0x0D, 0x4412, { d }); },   // ShowMinigamePointResult
    // the HUD objects and banners (bank $09, obj.js)
    loadServeGfx() { far(P, 9, 0x6C40); },                               // LoadServeGfx
    updateScorePanelDisplay() { obj.updateScorePanelDisplay(P); },
    updatePointDigitsDisplay() { obj.updatePointDigitsDisplay(P); },
    showCourtBanner(E, id) { obj.showCourtBanner(P, id); },
    hideCourtBanner() { obj.hideCourtBanner(P); },
    setObjPosition(E, slot, pos) { obj.setObjPosition(P, slot, pos); },
    spawnGameScoreDisplayObjs() { obj.spawnGameScoreDisplayObjs(P); },
    dismissGameScoreDisplayObjs() { obj.dismissGameScoreDisplayObjs(P); },
    spawnWinLoseResultObj(E, a) { obj.spawnWinLoseResultObj(P, a); },
    dismissWinLoseResultObj() { obj.dismissWinLoseResultObj(P); },
    spawnGameResultObj() { obj.spawnGameResultObj(P); },
    dismissGameResultObj() { obj.dismissGameResultObj(P); },
    loadPlayer1ScoreDigitGfx(E, a, b) { far(P, 9, 0x612A, { a, b }); },  // LoadPlayer1ScoreDigitGfx
    loadPlayer2ScoreDigitGfx(E, a, b) { far(P, 9, 0x6139, { a, b }); },  // LoadPlayer2ScoreDigitGfx
    spawnServeIndicatorObjs() { obj.spawnServeIndicatorObjs(P); },
    dismissServeIndicatorObjs() { obj.dismissServeIndicatorObjs(P); },
    loadOnCourtCharacterGfx() { obj.loadOnCourtCharacterGfx(P); },
    updateAllObjSprites() { obj.updateAllObjSprites(P); },
    // the court picture (court_08)
    refreshCourtScoreboard() { far(P, 8, 0x5E93); },                     // RefreshCourtScoreboard
    uploadCourtScoreboardRows() { draw.uploadCourtScoreboardRows(P); },
    // the frame's drawing (bank $08, draw.js)
    clearSpriteSlots() { draw.clearSpriteSlots(P); },
    buildBallSlot() { draw.buildBallSlot(P); },
    buildBallTrailSlots() { draw.buildBallTrailSlots(P); },
    buildBallShadowSlot() { draw.buildBallShadowSlot(P); },
    buildNetBallSlot() { draw.buildNetBallSlot(P); },
    drawBallTouchCharEffect() { draw.drawBallTouchCharEffect(P); },
    shiftBallHistory() { draw.shiftBallHistory(P); },
    drawActorsByDepth() { draw.drawActorsByDepth(P); },
    updateMinigameTargets() { far(P, 0x0A, 0x65C3); },                   // UpdateMinigameTargets
    drawMarkersAndShadows() { draw.drawMarkersAndShadows(P); },
    queueCharFrameTiles(E, d) { P.callRom(0, 0x2E6B, de(d)); },          // QueueCharFrameTiles
  };
}

// P.E, set up for this port on first use (E.port marks it): every engine call in web/js/port goes through here
export function engine(P) {
  const E = P.E;
  if (E.port !== P) {
    E.port = P;
    E.ext = portExt(P);
    E.sfx = id => playSoundManaged(P, id);
    E.modeHook = d => callModeHook(P, d);                                 // CallModeHook (the minigames' hooks)
  }
  return E;
}

// The link menu's last item, Options (32:54F2): ModeSelectOptionsMenu 32:79D8, a two-item menu (bank 09) of the golf
// dictionary (3F:4002, dict.js, the whole dictionary from the A-Z index) and data management: DataManageMenu
// 32:7A0A copies a character to a free slot (a new random ID), erases one, or erases the whole save RAM, with the
// character select (06:6071) on the save slots (02:5B5B), the character's Yes / No prompt (41:6784) and windows of
// bank 05 for the messages.
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import * as W from "./windows.js";
import * as Sv from "./save.js";
import { menuTwoItems, menuThreeItems, redrawMenuThreeItems } from "./menu09.js";
import { buildSaveSlotList } from "./modesel.js";
import { characterSelectScreen, resetCharSelectCursor } from "./charsel.js";
import { charYesNoPrompt } from "./levelup.js";
import { restoreShadowFromMap } from "./shadow.js";
import { refreshWindowText, copyWindowToVRAM, removeWindow } from "./msgbox.js";
import { advanceRandomSeed } from "./round.js";
import { golfDictionary } from "./dict.js";

const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// 32:7CFB WaitAnyButtonPress: frames until a button is newly pressed (hJoyPressed), then one more
function* waitAnyButtonPress(sh) {
  do yield* sh.advance(); while (!sh.w.high[0x194]);
  yield* sh.advance();
}
// 32:7DE5 GetLastOpenedWindow: wLastOpenedWindow $D820 (WRAM5; the WRAM bank kept)
function getLastOpenedWindow(w) {
  const old = w.high[0x196];
  setW(w, 5);
  const a = rd(w, 0xD820);
  setW(w, old);
  return a;
}
// 32:7DFB SetWindowTextBank5: SetWindowText 05:5A51 with WRAM5 mapped (the bank kept)
function setWindowTextBank5(w, b, hl) {
  const old = w.high[0x196];
  setW(w, 5);
  W.setWindowText(w, b, hl);
  setW(w, old);
}
// 32:7D10 FindFreeSaveBlock: the first block 0-2 that SaveBlockLoad (to $C800) finds unused or bad, else $FF
function findFreeSaveBlock(w) {
  for (let d = 0; d < 3; d++) if (Sv.saveBlockLoad(w, d, 0xC800)) return d;
  return 0xFF;
}
const zeroScroll = w => { for (let a = 0xC320; a < 0xC324; a++) wr(w, a, 0); };   // wMapScrollX / wMapScrollY

// a message window (32:7AFB ...): OpenWindow at (2, e) 16 x 5 with text hl, the shadow from the map and the windows
// drawn, (an extra frame for 32:7CD2), any button, the window closed (marked; the fade-out hides it)
function* message(sh, e, hl, extraFrame = false) {
  const w = sh.w;
  yield* inBankGen(w, 0x05, W.openWindow(sh, 0x02, e, 0x10, 0x05));   // 05:4AF2
  const s = getLastOpenedWindow(w);
  setWindowTextBank5(w, s, hl);
  yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));   // 05:4492
  yield* inBankGen(w, 0x05, W.updateWindows(sh));         // 05:4949
  if (extraFrame) yield* sh.advance();
  yield* waitAnyButtonPress(sh);
  W.closeWindow(w, s);                           // 05:4C5C (in the mapped WRAM bank)
}

// the character to copy or erase (32:7A33 / 32:7B2E): fade out, the character select on the slot list (b = 1); the
// pick kept at WRAM6 $D251 and its block loaded to $C800; $FF for B (after one more fade-out, 32:7BD8)
function* pickCharacter(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  yield* sh.advance();
  resetCharSelectCursor(w);                      // 06:690F
  const r = yield* inBankGen(w, 0x06, characterSelectScreen(sh, 0xD658, 0x01));   // 06:6071
  if (r === 0xFF) {
    Scr.beginFadeOut(w, 0x10);
    yield* Scr.waitFade(sh);
    return 0xFF;
  }
  const old = w.high[0x196];
  setW(w, 6);
  wr(w, 0xD251, r);
  setW(w, old);
  Sv.saveBlockLoad(w, r, 0xC800);                // 02:4355
  return r;
}
function savedPick(w) {
  const old = w.high[0x196];
  setW(w, 6);
  const h = rd(w, 0xD251);
  setW(w, old);
  return h;
}

// 32:7A0A DataManageMenu: the three-item menu (09:6A74) until B; after each item a fade-out (32:7C9D); after Erase
// All it returns
export function* dataManageMenu(sh) {
  const w = sh.w;
  for (;;) {
    let done = false;
    const item = yield* inBankGen(w, 0x09, menuThreeItems(sh));   // 32:7A0E
    if (item === 0 || item === 1) {
      const n = buildSaveSlotList(w, 0xD658);    // 02:5B5B
      if (n === 0) yield* message(sh, 0x0B, 0x14A6);   // 32:7CAD no data
      else if (item === 0 && n === 3) yield* message(sh, 0x0B, 0x14A7, true);   // 32:7CD2 no free slot
      else if (item === 0) {                     // 32:7A33 copy
        if ((yield* pickCharacter(sh)) !== 0xFF &&
            (yield* inBankGen(w, 0x41, charYesNoPrompt(sh, 0x01, 0x00)))) {   // 41:6784 "Copy <name>?"
          zeroScroll(w);
          yield* inBankGen(w, 0x09, redrawMenuThreeItems(sh));   // 09:6A9B
          yield* sh.advance();
          const src = savedPick(w);
          const dst = findFreeSaveBlock(w);
          if (dst !== 0xFF) {
            Sv.saveBlockLoad(w, src, 0xC800);
            wr(w, 0xC2A5, dst);                  // wSaveSlot
            Sv.restoreGameTimer(w);              // 00:2CDE
            for (let k = 0; k < 5; k++) wr(w, 0xC80B + k, advanceRandomSeed(w) >> 8);   // the character's ID
            Sv.saveGame(w);                      // 02:4489
          }
          yield* message(sh, 0x01, 0x14A5);      // 32:7AFB
        }
      } else {                                   // 32:7B2E erase
        if ((yield* pickCharacter(sh)) !== 0xFF &&
            (yield* inBankGen(w, 0x41, charYesNoPrompt(sh, 0x02, 0x01)))) {   // "Erase <name>?" (No first)
          Sv.saveBlockClear(w, savedPick(w));    // 02:431D
          yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
          yield* inBankGen(w, 0x05, W.updateWindows(sh));
          yield* sh.advance();
          zeroScroll(w);
          yield* inBankGen(w, 0x09, redrawMenuThreeItems(sh));
          yield* sh.advance();
          yield* message(sh, 0x01, 0x14A3);      // 32:7BB2
        }
      }
    } else if (item === 2) {                     // 32:7BE3 erase all
      zeroScroll(w);
      yield* inBankGen(w, 0x09, redrawMenuThreeItems(sh));
      yield* inBankGen(w, 0x05, W.openWindow(sh, 0x02, 0x01, 0x10, 0x05));
      const s = getLastOpenedWindow(w);
      setWindowTextBank5(w, s, 0x1497);
      yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
      yield* inBankGen(w, 0x05, W.updateWindows(sh));
      yield* inBankGen(w, 0x05, W.openMenuWindow(sh, 0x001A, 0x02, 0x0A));   // 05:4BB0 Yes / No
      wr(w, 0xC3F9, 1);                          // wMenuInitCursor: No
      // (the menu's slot taken as 1: the a left by `ld a, 1` above)
      yield* inBankGen(w, 0x05, refreshWindowText(sh, 1));   // 05:6729
      yield* inBankGen(w, 0x05, copyWindowToVRAM(sh, 1));    // 05:679F
      const r = yield* inBankGen(w, 0x05, W.runMenu05(sh));  // 05:4CD7
      if (r === 0) {
        yield* inBankGen(w, 0x05, removeWindow(sh, getLastOpenedWindow(w)));   // 05:67BB
        W.closeWindow(w, s);
        yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
        yield* inBankGen(w, 0x05, W.updateWindows(sh));
        Sv.saveReset(w);                         // 02:424D
        Sv.saveLoad(w);                          // 02:41F6
        D.inBank(w, 0x02, () => Sv.saveCheckAllBlocks(w));   // 02:45D3
        wr(w, 0xCABB, 0);                        // wMainMenuCursor
        yield* message(sh, 0x01, 0x14A2);        // 32:7C58
        done = true;                             // (32:7C7B: then returns)
      } else {                                   // 32:7C8D No / B
        W.closeWindow(w, getLastOpenedWindow(w));
        W.closeWindow(w, s);
        yield* inBankGen(w, 0x05, restoreShadowFromMap(sh));
        yield* inBankGen(w, 0x05, W.updateWindows(sh));
      }
    }
    Scr.beginFadeOut(w, 0x10);                   // 32:7C9D / 32:7C7B
    yield* Scr.waitFade(sh);
    yield* sh.advance();
    if (item > 2 || done) return;
  }
}

// 32:79D8 ModeSelectOptionsMenu: the two-item menu (09:5AC5) until B: the golf dictionary (mode 6) or data
// management; then a fade-out and a frame
export function* modeSelectOptionsMenu(sh) {
  const w = sh.w;
  for (;;) {
    sh.sound(0x01);
    const a = yield* inBankGen(w, 0x09, menuTwoItems(sh));
    if (a === 0) yield* inBankGen(w, 0x3F, golfDictionary(sh, 0x06));
    else if (a === 1) yield* dataManageMenu(sh);
    else break;
  }
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  yield* sh.advance();
}

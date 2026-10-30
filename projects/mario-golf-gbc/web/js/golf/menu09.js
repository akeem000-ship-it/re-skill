// Bank 09's menu engine (the same code as bank 07's at 07:741E-7DAF, with bank 09's graphics) and LinkMenu 09:4A12,
// the first menu after the title. A menu descriptor (wMenuDesc $D200) points at LZ-compressed item pictures, two per
// item and state (normal / highlighted: words at desc + (item x 2 + state) x 2; desc + $28 the extra tiles to $8E00);
// $D202 = the items, $D203 = the first item's slot; each slot has a BG row (09:4400 + slot x 32, attributes filled
// with the palette) and 16 tiles at VRAM1 ($9600 + slot x $100, wrapping into $8600 + ...). The highlighted item
// blinks every 16 frames (wMenuBlink $D204); a sprite bobs beside the menu (MenuBobSpriteTask 09:4990).
import { rb, rw } from "./rom.js";
import * as D from "./render/display.js";
import * as Scr from "./screen.js";
import { clearFrameTasks, registerFrameTask } from "./tasks.js";
import { reloadFontTiles, copyMapToScrollBuffers, initWindowSystem } from "./standings.js";

const B = 0x09;
const rd = D.rd, wr = D.wr;
const setW = (w, n) => D.setWramBank(w, n);
function notPorted(what) { throw new Error(`${what} is not ported`); }
function* inBankGen(w, bank, g) {
  const old = w.high[0x195];
  w.high[0x195] = bank;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// 09:4916 MenuItemGfx09: slot l's picture for state h (LZ to $D000, $D100 for an odd slot, in the mapped WRAM bank)
// queued to VRAM1 at ($A6 + l) << 8, $10 more when that has bit 3 clear
function menuItemGfx(w, h, l) {
  const b = l;
  const e = ((((l << 1) & 0xFF) + h) << 1) & 0xFF;
  const src = rw(B, (r16(w, 0xD200) + e) & 0xFFFF);
  const de = 0xD000 + (b & 1 ? 0x100 : 0);
  D.lzTo(w, B, src, de);
  let a = (b + 0xA6) & 0xFF;
  if (!(a & 8)) a |= 0x10;
  D.queueVRAMCopy(w, de, a << 8, 0x10);
}
const r16 = (w, a) => rd(w, a) | rd(w, a + 1) << 8;

// 09:4949 MenuItemAttrs09: slot l's BG attribute row: 09:4400 + l x 32 to $D000 (or $D100) with bytes 2-17 = c,
// queued to VRAM1 $98A0 + l x 32
function menuItemAttrs(w, c, l) {
  const off = (l << 5) & 0xFFFF;
  const buf = 0xD000 + (l & 1 ? 0x100 : 0);
  D.copyMemoryFast(w, (0x4400 + off) & 0xFFFF, buf, 2);
  for (let k = 0; k < 16; k++) wr(w, buf + 2 + k, c);
  D.queueVRAMCopy(w, buf, (off + 0xB8A0) & 0xFFFF, 2);
}

// 09:48DE MenuDrawItem09 / 09:48F9 MenuItemPalette09: item l's two slots ([$D203] + 2l and the next), one frame
function* menuDrawItem(sh, h, l) {
  const w = sh.w;
  const s = (rd(w, 0xD203) + 2 * l) & 0xFF;
  menuItemGfx(w, h, s);
  menuItemGfx(w, h, (s + 1) & 0xFF);
  yield* sh.advance();
}
function* menuItemPalette(sh, c, l) {
  const w = sh.w;
  const s = (rd(w, 0xD203) + 2 * l) & 0xFF;
  menuItemAttrs(w, c, s);
  menuItemAttrs(w, c, (s + 1) & 0xFF);
  yield* sh.advance();
}

// 09:400A MenuScreenInit09: hl = descriptor, d = items, e = first slot, b = $D205 (link handshake): the font, LCD off,
// scroll 0, the extra tiles (desc + $28 -> $8E00), the screen (09:40CE tiles -> VRAM1 $9000 / $8800, palettes
// 09:4325 and 09:4355, attributes 09:4360 and map 09:45A0), the 10 slots' pictures (state 1) and rows (palette $0B),
// MenuBobSpriteTask, LCD on
export function menuScreenInit(w, hl, d, e, b) {
  setW(w, 6);
  wr(w, 0xD205, b);
  wr(w, 0xD200, hl & 0xFF); wr(w, 0xD201, hl >> 8);
  wr(w, 0xD202, d); wr(w, 0xD203, e);
  clearFrameTasks(w);
  reloadFontTiles(w);                            // 01:421A
  D.disableLCDSafely(w);
  w.high[0x18B] = w.high[0x18A] = 0;
  const extra = rw(B, (r16(w, 0xD200) + 0x28) & 0xFFFF);
  setW(w, 1);
  D.lzTo(w, B, extra, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x14);
  D.lzTo(w, B, 0x40CE, 0xD000);
  D.queueVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x4325, 0x02, 0x06);
  D.loadPalettesMasterOnly(w, 0x4355, 0x0C, 0x01);
  D.queueVRAMCopy(w, 0x4360, 0xB800, 0x24);
  D.queueAndRunVRAMCopy(w, 0x45A0, 0x9800, 0x24);
  setW(w, 6);
  for (let l = 0; l < 10; l++) {
    menuItemGfx(w, 1, l);
    D.processVRAMCopyQueue(w);                   // 00:04DE
    menuItemAttrs(w, 0x0B, l);
    D.processVRAMCopyQueue(w);
  }
  registerFrameTask(w, 0x01, B, 0x4990);         // MenuBobSpriteTask09
  D.enableLCD(w);
}

// 09:4990 MenuBobSpriteTask09: the template 09:49E9 at x 0, y from the table 09:49A9 by the frame
export function menuBobSpriteTask(w) {
  const e = rb(B, 0x49A9 + (w.high[0x18C] & 0x3F));
  D.queueSpriteTemplate(w, 0x49E9, e, 0x00, 0xE0, 0x04);
}

// 09:47E0 MenuSelect09: a = the cursor: the item highlighted (palette $0C) and blinking; Up / Down move it (sound
// $5B, wrapping), A picks it (sound $5C; a = the item), B leaves (sound $5D; $FF). (With the link handshake on
// ($D205) the partner's Start and A on item 1, the link game, are not ported.)
export function* menuSelect(sh, a) {
  const w = sh.w;
  let b = a;
  for (;;) {
    wr(w, 0xD204, 0xFF);                         // 09:47E1
    yield* menuItemPalette(sh, 0x0C, b);
    for (;;) {
      const old = rd(w, 0xD204), now = (old + 1) & 0xFF;   // 09:47EC
      wr(w, 0xD204, now);
      if ((old ^ now) & 0x10) yield* menuDrawItem(sh, (now >> 4) & 1, b);
      yield* sh.advance();
      if (rd(w, 0xD205) && rd(w, 0xCB40) === 0x10) notPorted("the link partner's menu choice (~09:4810)");
      const rep = w.high[0x191];
      if (rep & 2) {                             // B
        sh.sound(0x5D);
        yield* menuDrawItem(sh, 1, b);
        yield* menuItemPalette(sh, 0x0B, b);
        return 0xFF;
      }
      if (rep & 1) {                             // A
        if (rd(w, 0xD205) && b === 1) notPorted("the link game's handshake (~09:488D SerialSendLinkRequest)");
        sh.sound(0x5C);
        yield* menuDrawItem(sh, 0, b & 0x0F);
        return b;
      }
      let d;
      if (rep & 0x40) d = b === 0 ? (rd(w, 0xD202) - 1) & 0xFF : 0xFF;
      else if (rep & 0x80) {
        const last = (rd(w, 0xD202) - 1) & 0xFF;
        d = last === b ? (-last) & 0xFF : 1;
      } else continue;
      sh.sound(0x5B);
      yield* menuDrawItem(sh, 1, b);
      yield* menuItemPalette(sh, 0x0B, b);
      b = (b + d) & 0xFF;
      break;
    }
  }
}

// 09:4A12 LinkMenu: the menu 09:4A4C (4 items from slot 1) with the link handshake, from the cursor $CAB8 (kept
// unless B); fades in and out; returns the item or $FF
export function* linkMenu(sh) {
  const w = sh.w;
  menuScreenInit(w, 0x4A4C, 0x04, 0x01, 0x00);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  wr(w, 0xD205, 1);
  setW(w, 6);
  const a = yield* menuSelect(sh, rd(w, 0xCAB8));
  if (!(a & 0x80)) wr(w, 0xCAB8, a & 0x0F);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// ---- the options menus (ModeSelectOptionsMenu 32:79D8, DataManageMenu 32:7A0A) ----
// 09:7E3B MenuCopyBGToScroll: the screen's maps 09:4360 (attributes) / 09:45A0 (tiles), $400 bytes each, to WRAM1
// $D000 / $D400 and into the scroll buffers (00:0804)
function menuCopyBGToScroll(w) {
  const old = w.high[0x196];
  setW(w, 1);
  D.copyMemoryFast(w, 0x4360, 0xD000, 0x40);
  D.copyMemoryFast(w, 0x45A0, 0xD400, 0x40);
  copyMapToScrollBuffers(w);
  setW(w, old);
}

// 09:7AD5 MenuScreenInitAlt: as MenuScreenInit09 (the font not reloaded; LCD off before the frame tasks are cleared),
// with the screen's tiles 09:7BAC and palettes 09:7E03 / 09:7E33; then InitWindowSystem (05:407A, the WRAM bank
// kept) and MenuCopyBGToScroll
export function* menuScreenInitAlt(sh, hl, d, e, b) {
  const w = sh.w;
  setW(w, 6);
  wr(w, 0xD205, b);
  wr(w, 0xD200, hl & 0xFF); wr(w, 0xD201, hl >> 8);
  wr(w, 0xD202, d); wr(w, 0xD203, e);
  D.disableLCDSafely(w);
  w.high[0x18A] = w.high[0x18B] = 0;
  clearFrameTasks(w);
  const extra = rw(B, (r16(w, 0xD200) + 0x28) & 0xFFFF);
  setW(w, 1);
  D.lzTo(w, B, extra, 0xD000);
  D.queueAndRunVRAMCopy(w, 0xD000, 0x8E00, 0x14);
  D.lzTo(w, B, 0x7BAC, 0xD000);
  D.queueVRAMCopy(w, 0xD000, 0xB000, 0x80);
  D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
  D.loadPalettesMasterOnly(w, 0x7E03, 0x02, 0x06);
  D.loadPalettesMasterOnly(w, 0x7E33, 0x0C, 0x01);
  D.queueVRAMCopy(w, 0x4360, 0xB800, 0x24);
  D.queueAndRunVRAMCopy(w, 0x45A0, 0x9800, 0x24);
  setW(w, 6);
  for (let l = 0; l < 10; l++) {
    menuItemGfx(w, 1, l);
    D.processVRAMCopyQueue(w);                   // 00:04DE
    menuItemAttrs(w, 0x0B, l);
    D.processVRAMCopyQueue(w);
  }
  registerFrameTask(w, 0x01, B, 0x4990);         // MenuBobSpriteTask09
  D.enableLCD(w);
  const old = w.high[0x196];
  yield* inBankGen(w, 0x05, initWindowSystem(sh));   // 05:407A
  setW(w, old);
  menuCopyBGToScroll(w);
}

// 09:5AC5 MenuTwoItems (export 2): the menu 09:5AF6 (2 items from slot 1; the dictionary, data management) from the
// cursor $CAB9 (kept unless B); fades in and out; returns the item or $FF
export function* menuTwoItems(sh) {
  const w = sh.w;
  yield* menuScreenInitAlt(sh, 0x5AF6, 0x02, 0x01, 0x00);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  setW(w, 6);
  const a = yield* menuSelect(sh, rd(w, 0xCAB9));
  if (!(a & 0x80)) wr(w, 0xCAB9, a);
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  return a;
}

// 09:6A74 MenuThreeItems (export 6): the menu 09:6AC0 (3 items: copy, erase, erase all) from the cursor $CABA (kept
// unless B); fades in, not out; returns the item or $FF
export function* menuThreeItems(sh) {
  const w = sh.w;
  yield* menuScreenInitAlt(sh, 0x6AC0, 0x03, 0x01, 0x00);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
  setW(w, 6);
  const a = yield* menuSelect(sh, rd(w, 0xCABA));
  if (!(a & 0x80)) wr(w, 0xCABA, a);
  return a;
}

// 09:6A9B RedrawMenuThreeItems (export 8): fade out, the default palettes (01:41B3), the menu 09:6AC0 drawn again, fade in
export function* redrawMenuThreeItems(sh) {
  const w = sh.w;
  Scr.beginFadeOut(w, 0x10);
  yield* Scr.waitFade(sh);
  D.disableLCDSafely(w);
  D.inBank(w, 0x01, () => {                      // 01:41B3 LoadDefaultPalettes
    D.loadPalettesMasterOnly(w, 0x50A0, 0x00, 0x08);
    D.loadPalettesMasterOnly(w, 0x50E0, 0x08, 0x08);
  });
  D.enableLCD(w);
  yield* menuScreenInitAlt(sh, 0x6AC0, 0x03, 0x01, 0x00);
  Scr.beginFadeIn(w, 0x10);
  yield* Scr.waitFade(sh);
}

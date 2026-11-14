// The link cable's protocol of bank 0 (00:2F93-00:3100). One byte is exchanged per transfer: the clock side
// (hLinkRole 1, the one that got $70) starts one at every VBlank (SerialVBlankTick, SC = $83); the other (role 2)
// answers on the external clock. Idle bytes ($10, or what hSerialIdleByte says: the handshakes' $20 / $21 / $22)
// flow until a block is sent: $40 then its bytes as two $5x nibbles each (wSerialSendBuf $CB00 -> the partner's
// wSerialRecvBuf $CB40). hLinkIdleCount counts the $00 / $FF bytes of a lost partner; AdvanceFrame (00:2E3B) gives
// up at $20 (LinkLostReset 00:2F8D).
// HRAM: $FFC0 hSerialRecv, $FFC1 hSerialIdleByte, $FFC2 hLinkRole, $FFC3 hLinkIdleCount, $FFC4 hSerialSendMode,
// $FFC5 hSerialSendCount, $FFC6 hSerialRecvIndex, $FFC7 hSerialSendIndex, $FFC8 hLinkActive, $FFC9
// hSerialNextIdleByte. The serial registers rSB / rSC are w.high[$101] / [$102] (w.high is $FE00-$FFFF).
// With no partner a transfer on the internal clock completes at once with $FF in (an open cable), and its interrupt
// runs SerialHandler (IE $0D has the serial interrupt). Two native machines linked (NativeCable, w.cable) exchange
// the byte at once instead, both handlers run (see NativeCable).
import { rb } from "./rom.js";
import * as D from "./render/display.js";
import { clearFrameTasks as clearFrameTasksLL } from "./tasks.js";

const rd = D.rd, wr = D.wr;
const SB = 0x101, SC = 0x102;

// rSC written: bits 7, 1, 0 kept; a transfer on the internal clock (bits 7 and 0) ends with $FF received and the
// serial interrupt, its handler at once (00:0058 IntSerial -> 00:2F93). (w.noSerialHW: a test that runs a routine
// on the CPU alone, without the hardware: the transfer stays started)
export function writeSC(w, v) {
  const h = w.high;
  h[SC] = v & 0x83;
  if ((v & 0x81) !== 0x81 || w.noSerialHW) return;
  if (w.cable) { w.cable.transfer(w); return; }
  h[SB] = 0xFF; h[SC] &= 0x7F;
  serialHandler(w);
}

// The cable between two native machines (two GolfMemory w): a transfer on one side's clock exchanges the two serial
// registers at once when the other waits on the external clock (its SC bits 7 set, 0 clear): both get the byte and
// both handlers run (the partner's in its own machine, wherever its code is: the caller decides the order in which
// the two machines' frames run, e.g. by turns); when the other does not wait, the clock side reads $FF. The hardware
// takes 8 bit times (on the fast clock SC $83 a few hundred CPU cycles): by default the native transfer ends at once
// (the transfers the game starts at VBlank, SerialVBlankTick 00:3038, then end inside the VBlank, before the frame's
// code); with defer set, a transfer started waits (SC bit 7 still set) in pending until the driver calls complete()
// (a test that ends each transfer where the cores' clocks put it: web/tests/golf_link_vs_cores.mjs). A machine's
// frames are split in two with a cable: its generator yields "code" after the VBlank work (Shot.advance), so a
// driver can run the other machine's VBlank between them. started[side] counts the transfers each side started.
export class NativeCable {
  constructor(...ends) { this.ends = []; this.log = null; this.defer = false; this.pending = []; this.started = []; for (const w of ends) this.attach(w); }
  attach(w) { this.ends.push(w); this.started.push(0); w.cable = this; }
  peer(w) { return this.ends[0] === w ? this.ends[1] : this.ends[0]; }
  transfer(w) {
    this.started[this.ends.indexOf(w)]++;
    if (this.defer) { this.pending.push(w); return; }
    this.exchange(w);
  }
  complete() { this.exchange(this.pending.shift()); }
  exchange(w) {
    const p = this.peer(w), h = w.high, ph = p ? p.high : null;
    let peerGets = null;
    if (ph && (ph[SC] & 0x81) === 0x80) {
      peerGets = h[SB];
      const v = ph[SB]; ph[SB] = h[SB]; h[SB] = v;
      ph[SC] &= 0x7F;
    } else h[SB] = 0xFF;
    h[SC] &= 0x7F;
    if (this.log) this.log(w, h[SB], peerGets);
    serialHandler(w);
    if (peerGets !== null) serialHandler(p);
  }
}

// 00:304D InitSerialLink: $70 sent on the external clock, the link state reset
export function initSerialLink(w) {
  const h = w.high;
  h[SB] = 0x70;
  h[0x1C0] = 0; h[0x1C1] = 0x10;
  writeSC(w, 0x00); writeSC(w, 0x80);
  h[0x1C2] = 0; h[0x1C3] = 0; h[0x1C4] = 0; h[0x1C8] = 0; h[0x1C9] = 0x10;
}

// 00:2F93 SerialHandler (the serial interrupt): the byte in to hSerialRecv; no role yet: $70 makes this side the
// clock (role 1, SC $03), $71 the other (role 2: the ROM byte at $0070 out, the external clock started); role 1: the
// next byte out (00:2FF8), hLinkIdleCount + 1 on $FF / $00 (else 0), the byte handled (00:3021); role 2: the same,
// the external clock started again and the idle count cleared
export function serialHandler(w) {
  const h = w.high;
  h[0x1C0] = h[SB];
  const role = h[0x1C2];
  if (!role) {
    if (h[0x1C0] === 0x70) { h[0x1C2] = 1; writeSC(w, 0x03); }
    else if (h[0x1C0] === 0x71) { h[0x1C2] = 2; h[SB] = rb(0, 0x0070); writeSC(w, 0x00); writeSC(w, 0x80); }
    return;
  }
  if (role === 1) {
    serialLoadSendByte(w);
    const r = h[0x1C0];
    h[0x1C3] = r === 0xFF || r === 0 ? (h[0x1C3] + 1) & 0xFF : 0;
    serialHandleRecvByte(w);
    return;
  }
  serialLoadSendByte(w);
  writeSC(w, 0x80);
  h[0x1C3] = 0;
  serialHandleRecvByte(w);
}

// 00:2FF8 SerialLoadSendByte: by hSerialSendMode: 0 the idle byte; 1 the next nibble (00:30AD; at the count's end
// mode 0 and the idle byte from hSerialNextIdleByte); 2 the block's $40 (mode 1 next)
export function serialLoadSendByte(w) {
  const h = w.high;
  const m = h[0x1C4];
  if (!m) { h[SB] = h[0x1C1]; return; }
  if (m === 1) {
    h[SB] = serialNextSendNibble(w);
    h[0x1C5] = (h[0x1C5] - 1) & 0xFF;
    if (h[0x1C5]) return;
    h[0x1C4] = (h[0x1C4] - 1) & 0xFF;
    h[0x1C1] = h[0x1C9];
    return;
  }
  h[SB] = 0x40;
  h[0x1C4] = (h[0x1C4] - 1) & 0xFF;
}

// 00:3021 SerialHandleRecvByte: $4x restarts the block (hSerialRecvIndex 0), $5x is a nibble of it (00:30C9)
export function serialHandleRecvByte(w) {
  const h = w.high, b = h[0x1C0], a = b & 0xF0;
  if (a < 0x40) return;
  if (a === 0x40) { h[0x1C6] = 0; return; }
  if (a === 0x50) serialStoreNibble(w, b);
}

// 00:30AD SerialNextSendNibble: $50 | the next nibble of wSerialSendBuf (index hSerialSendIndex: even the high one)
export function serialNextSendNibble(w) {
  const h = w.high, i = h[0x1C7];
  let a = rd(w, 0xCB00 + (i >> 1));
  h[0x1C7] = (i + 1) & 0xFF;
  if (!(i & 1)) a = ((a << 4) | (a >> 4)) & 0xFF;
  return (a & 0x0F) | 0x50;
}

// 00:30C9 SerialStoreNibble: a's nibble into wSerialRecvBuf at hSerialRecvIndex / 2 (& $3F): even the high one (the
// low cleared), odd ORed in
export function serialStoreNibble(w, a) {
  const h = w.high, i = h[0x1C6];
  const p = 0xCB40 + ((i >> 1) & 0x3F);
  if (!(i & 1)) wr(w, p, (((a << 4) | (a >> 4)) & 0xF0));
  else wr(w, p, (a & 0x0F) | rd(w, p));
  h[0x1C6] = (i + 1) & 0xFF;
}

// 00:3038 SerialVBlankTick (VBlank, 00:2F50): role 1 starts the next transfer (SC $83); role 2 counts the frames
// since the last byte (hLinkIdleCount, stopping at $FF)
export function serialVBlankTick(w) {
  const h = w.high, r = h[0x1C2];
  if (!r) return;
  if (r === 1) { writeSC(w, 0x83); return; }
  if (h[0x1C3] !== 0xFF) h[0x1C3]++;
}

// 00:3081 SerialSendBlock: a = bytes of wSerialSendBuf; frames until the last block is out; hSerialSendIndex 0; with
// no link (role 0) returns $FF, else the count 2a nibbles, mode 2 and 0
export function* serialSendBlock(sh, a) {
  const h = sh.w.high;
  while (h[0x1C4]) yield* sh.advance();
  if (sh.w.cable) yield "sync";                  // (linked: a point a driver can order against the other machine's
  h[0x1C7] = 0;                                  // transfers, NativeCable)
  if (!h[0x1C2]) return 0xFF;
  h[0x1C5] = (a << 1) & 0xFF;
  h[0x1C4] = 2;
  return 0;
}
// 00:30EB SerialWaitSendDone: frames until hSerialSendMode is 0
export function* serialWaitSendDone(sh) { while (sh.w.high[0x1C4]) yield* sh.advance(); }
export function setLinkActive(w) { w.high[0x1C8] = 1; }     // 00:30F8 SetLinkActive
export function clearLinkActive(w) { w.high[0x1C8] = 0; }   // 00:30FD ClearLinkActive

// 00:306E SerialSendLinkRequest: $71 out on the internal clock (SC $03, then $83: with no partner it ends at once with
// $FF in), then two VBlanks (00:2F82 WaitVBlankFlag)
export function* serialSendLinkRequest(sh) {
  const w = sh.w;
  w.high[SB] = 0x71;
  writeSC(w, 0x03);
  writeSC(w, 0x83);
  yield* sh.waitVBlankFlag();
  yield* sh.waitVBlankFlag();
}

// ---- the cable lost (AdvanceFrame 00:2E3B: hLinkActive and hLinkIdleCount $20 or more) ----
// a soft reset (00:2DAA SoftReset: the stack dropped, the whole start again): the game loop (boot.js) catches it
export class SoftReset extends Error { constructor() { super("SoftReset 00:2DAA"); } }

// 08:555F LinkLostScreen: ClearFrameTasks; hSerialIdleByte 0, InitSerialLink 00:304D; LCD off, WRAM1, no sprites; the
// LZ tiles 08:55E2 -> VRAM1 $9000 / $8800 ($80 + $80 blocks), the map 08:5E87 -> $9800, the attributes 08:5FD5 ->
// VRAM1 $9800 ($40 each, 00:04DB); no scroll, WX 7, WY $90; the palettes 08:603C (all 8 BG, 00:056C), applied; LCD on;
// song 6; VBlanks (00:2F82) until a button (hJoyPressed). 03:4028 UnusedPictureScreen (unreferenced) is the same
// code with its own picture (03:40AB / 03:4950 / 03:4A9E / 03:4B05: `d`; tools/compare_routines.py)
export const UNUSED_PICTURE_03 = { bank: 0x03, tiles: 0x40AB, map: 0x4950, attr: 0x4A9E, pal: 0x4B05 };
export function* linkLostScreen(sh, d = { bank: 0x08, tiles: 0x55E2, map: 0x5E87, attr: 0x5FD5, pal: 0x603C }) {
  const w = sh.w, h = w.high;
  clearFrameTasksLL(w);
  h[0x1C1] = 0;
  initSerialLink(w);
  if (w.vram) D.disableLCDSafely(w);
  D.setWramBank(w, 1);
  D.resetSprites(w);
  D.inBank(w, d.bank, () => {
    D.lzTo(w, d.bank, d.tiles, 0xD000);
    D.queueAndRunVRAMCopy(w, 0xD000, 0xB000, 0x80);
    D.queueAndRunVRAMCopy(w, 0xD800, 0xA800, 0x80);
    D.lzTo(w, d.bank, d.map, 0xD000);
    D.queueAndRunVRAMCopy(w, 0xD000, 0x9800, 0x40);
    D.lzTo(w, d.bank, d.attr, 0xD000);
    D.queueAndRunVRAMCopy(w, 0xD000, 0xB800, 0x40);
    h[0x18B] = 0; h[0x18A] = 0;
    if (w.vram) { w.lcd.wx = 0x07; w.lcd.wy = 0x90; }
    D.loadPalettesImmediate(w, d.pal, 0x00, 0x08);
  });
  if (w.vram) { D.applyPendingPaletteUpdates(w); D.enableLCD(w); }
  sh.sound(0x06);
  do yield* sh.waitVBlankFlag(); while (!h[0x194]);
}
// 00:2F8D LinkLostReset: 08:555F, then SoftReset 00:2DAA
export function* linkLostReset(sh) {
  yield* inBank08(sh.w, linkLostScreen(sh));
  throw new SoftReset();
}
function* inBank08(w, g) {
  const old = w.high[0x195];
  w.high[0x195] = 0x08;
  try { return yield* g; } finally { w.high[0x195] = old; }
}

// ---- the link round's shot exchange (bank 02; the native engine is one machine: these run with no partner only in
// the routine tests) ----
// 02:47BE JoyPressedIndex: 1-8 for the first newly pressed of A, B, Start, Select, Up, Down, Left, Right (hJoyPressed),
// else 0; it has no ret and runs on into 02:47ED (the sound of that index); returns the index
export function joyPressedIndex(sh) {
  const p = sh.w.high[0x194];
  let a = 0;
  const k = [0, 1, 3, 2, 6, 7, 5, 4].findIndex(b => p & (1 << b));
  if (k >= 0) a = k + 1;
  playLinkCallSound(sh, a);
  return a;
}
// 02:47ED PlayLinkCallSound: a = 1-15: the sound of the table 02:4802 at a & $0F (00:2C19); 0 none
export function playLinkCallSound(sh, a) {
  if (!a) return;
  sh.sound(rb(0x02, 0x4802 + (a & 0x0F)));
}
// 02:4812 LinkPartnerCallTick (the aim loop, 10:5D19): in a link game ($C33F) a received $1x (x not 0), the partner's
// button: its sound (02:47ED)
export function linkPartnerCallTick(sh) {
  const w = sh.w;
  if (!rd(w, 0xC33F)) return;
  const r = w.high[0x1C0];
  if ((r & 0xF0) === 0x10 && (r & 0x0F)) playLinkCallSound(sh, r & 0x0F);
}
// 02:483A LinkReceiveShot (10:594B, the partner's shot): a frame, then a frame at a time (back to 02:483D, the
// second) until $20 / $21 come in ($2E: $D4DB =
// $80, given up); then a frame, and a frame at a time (the loop goes back to 02:4850, the second): $2E gives up; while $21 (the partner aiming) our pressed button goes out
// as the idle byte $1x (02:47BE, its sound too), else $10; until $2F: the block (wSerialRecvBuf): the ball $D400-$D405,
// wLaunchDir $D418-$D419, the club, the shot mode (twice), the swing's power / impact / pad targets $D4D8-$D4DA,
// $D4DB; the idle byte $20
export function* linkReceiveShot(sh) {
  const w = sh.w, h = w.high;
  yield* sh.advance();
  do {
    yield* sh.advance();
    if (h[0x1C0] === 0x2E) { wr(w, 0xD4DB, 0x80); return; }
  } while ((h[0x1C0] & 0xFE) !== 0x20);
  yield* sh.advance();
  do {
    yield* sh.advance();
    if (h[0x1C0] === 0x2E) { wr(w, 0xD4DB, 0x80); return; }
    h[0x1C1] = h[0x1C0] === 0x21 ? (joyPressedIndex(sh) & 0x0F) | 0x10 : 0x10;
  } while (h[0x1C0] !== 0x2F);
  let p = 0xCB40;
  for (let k = 0; k < 6; k++) wr(w, 0xD400 + k, rd(w, p++));
  wr(w, 0xD418, rd(w, p++)); wr(w, 0xD419, rd(w, p++));
  wr(w, 0xD329, rd(w, p++));
  const m = rd(w, p++);
  wr(w, 0xD32A, m); wr(w, 0xD32B, m);
  for (const a of [0xD4D8, 0xD4D9, 0xD4DA, 0xD4DB]) wr(w, a, rd(w, p++));
  h[0x1C1] = 0x20;
}
// 02:48B8 LinkSendShot (10:4929) / 02:4924 LinkSendShotResult (10:5DAA, with b): only when the other player is the
// link partner (its +$13 = 3): frames until a $1x comes in, a frame; $CB4F = 0; the block: the ball, wLaunchDir,
// the club, the shot mode, wSwingPower $D450, wSwingCursor $D44F, $D44D, then 0 (02:48B8) or b (02:4924); $2F to
// follow it (hSerialNextIdleByte); sent ($10 bytes, 00:3081); 02:4924 waits for it to go out (00:30EB)
export function* linkSendShot(sh, b = null) {
  const w = sh.w, h = w.high;
  if (rd(w, 0xC880 + (rd(w, 0xC835) ? 0 : 0x40) + 0x13) !== 3) return;
  while ((h[0x1C0] & 0xF0) !== 0x10) yield* sh.advance();
  yield* sh.advance();
  wr(w, 0xCB4F, 0);
  let p = 0xCB00;
  for (let k = 0; k < 6; k++) wr(w, p++, rd(w, 0xD400 + k));
  wr(w, p++, rd(w, 0xD418)); wr(w, p++, rd(w, 0xD419));
  for (const a of [0xD329, 0xD32A, 0xD450, 0xD44F, 0xD44D]) wr(w, p++, rd(w, a));
  wr(w, p++, b === null ? 0 : b);
  h[0x1C9] = 0x2F;
  yield* serialSendBlock(sh, 0x10);
  if (b !== null) yield* serialWaitSendDone(sh);
}

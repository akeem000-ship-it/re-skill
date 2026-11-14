// The link cable: the serial interrupt handler, setting the link state up, encoding the local pad into link bytes
// and decoding the peer's, and the reset on a link error (vblank_00.asm).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Covered by the routine tests (web/tests/port/routines_home_system.mjs); no recording plays over the link.
// Not ported: ShortDelay and WaitSerialTransfer (see vblank.js).
import { SoftResetSignal } from "../port.js";
import { FLAG_Z, FLAG_N, FLAG_H, FLAG_C, getRegs, setRegs, preserving, spinUntil, push } from "./cpu.js";
import { farCallRom } from "./system.js";
import { LINKSTATE_MASTER, LINKSTATE_SLAVE } from "./vblank.js";

const rSB = 0xFF01, rSC = 0xFF02;
const SC_START = 0x80, SC_FAST = 0x02, SC_EXTERNAL = 0x00;
const LINKMSG_NONE = 0xC0;                                       // nothing to say: sent after the handshake and on a reset
const LINK_FRAME_COUNTER_MAX = 8;
const SFX_BEEP = 0x72;                                           // link-input decode errors
const PAD_ALL_BUTTONS = 0x0F;
// routines other parts of the port own, still run as the ROM's code (they become direct calls once ported)
const PlaySoundManaged = 0x3024;                                 // the sound request with the id in a (as rst $08)
const BANK_LINK_ERROR = 0x3E, ShowLinkErrorScreen = 0x4AA7;

const sound = (P, id) => P.callRom(0, PlaySoundManaged, { a: id });
// the serial port: the byte to send, then start a transfer on the peer's clock
function armTransfer(P, byte) {
  P.bus.w8(rSB, byte);
  P.bus.w8(rSC, SC_FAST | SC_EXTERNAL);
  P.bus.w8(rSC, SC_START | SC_FAST | SC_EXTERNAL);
}

// LinkErrorReset (00:284B): show the link error screen (farcall: it waits for the player), then soft reset
export function* linkErrorReset(P) {
  yield* farCallRom(P, BANK_LINK_ERROR, ShowLinkErrorScreen, 0x284E);
  throw new SoftResetSignal();                                   // jp SoftReset
}

// SerialHandler (00:2861): a byte came in (unless a shift is queued: hLinkShiftQueue bit 7). The master just
// notes it; the slave tracks acknowledgements (hLinkAckRequired / hLinkTxPending / the shift queue), notes a
// finished transfer, and arms the next one with hLinkTxByte.
export function serialHandler(P) {
  const { V, bus } = P;
  if (!(V.linkShiftQueue & 0x80)) V.linkRxByte = bus.u8(rSB);
  if (V.linkState === LINKSTATE_MASTER) { V.linkTransferDone = LINKSTATE_MASTER; return; }
  if (V.linkAckRequired) {
    if (V.linkTxPending) V.linkTxPending = 0;
    else V.linkShiftQueue = 0x40;
  }
  const queue = V.linkShiftQueue;
  V.linkShiftQueue = (queue << 1) & 0xFF;
  if (!(queue & 0x80)) V.linkTransferDone = 1;
  armTransfer(P, V.linkTxByte);
}

// IncrementLinkFrameCounter (00:28AF): count hLinkCounter up to 8 (it stays at 7). Returns a = the count + 1.
export function incrementLinkFrameCounter(P) {
  const a = (P.V.linkCounter + 1) & 0xFF;
  if (a !== LINK_FRAME_COUNTER_MAX) P.V.linkCounter = a;
  return a;
}

// the link variables both resets clear, in the ROM's order
const LINK_VARS = ["linkErrorFlags", "unusedLinkByte", "linkCounter", "linkInput", "linkRemoteInput",
  "linkRemoteInputBuf", "linkTxInput", "linkTransferDone"];
const LINK_VARS_2 = ["linkTxSeqBits", "unusedLinkSlot", "linkLastRxMirror", "linkLastRxByte", "linkPayloadKind",
  "linkRemoteInputPrev"];
const clear = (P, names) => { for (const n of names) P.bus.w8(P.A[n], 0); };
// InitSerialLink (00:28B9): no link: the serial port armed with "nothing to say", every link variable cleared
export function initSerialLink(P) {
  const { V } = P;
  P.bus.w8(rSB, LINKMSG_NONE);
  V.linkRxByte = 0;
  V.linkTxByte = LINKMSG_NONE;
  P.bus.w8(rSC, SC_FAST | SC_EXTERNAL);
  P.bus.w8(rSC, SC_START | SC_FAST | SC_EXTERNAL);
  V.linkState = 0;
  clear(P, LINK_VARS);
  V.linkExchangeActive = 0;
  clear(P, LINK_VARS_2);
  clear(P, ["linkAckRequired", "linkShiftQueue", "linkPlayerCount", "vBlankSuppressed", "matchFrameCounter"]);
}
// ResetSerialState (00:28F8): the same variables, but the link state, the exchange flag and the port are left
export function resetSerialState(P) {
  clear(P, ["linkRxByte", "linkTxByte"]);
  clear(P, LINK_VARS);
  clear(P, LINK_VARS_2);
  clear(P, ["linkShiftQueue", "linkAckRequired", "linkPlayerCount", "vBlankSuppressed", "matchFrameCounter"]);
}

// SerialEncodeInput (00:2924): send the local pad over the link, a few bits a frame. hLinkTxInput holds what is
// still owed: all four buttons go as $3F, else START as $30, else SELECT as $0C, else the d-pad's top bits (as
// bits 5-2) with A and B; what is left goes back to hLinkTxInput. hLinkTxSeqBits is OR'd into every byte (it flips
// each frame: the peer tells a new frame from a repeat). Outside a link (neither master nor slave): a beep and the
// link error reset. A slave owing an acknowledgement waits for the serial handler to take the last byte first.
// Returns a = the byte queued (hLinkTxByte), F from `or`; bc, de, hl kept; interrupts on.
export function* serialEncodeInput(P) {
  const { V } = P;
  const owed = V.linkTxInput, low = owed & 0x0F;
  let byte, rest;
  if (low === PAD_ALL_BUTTONS) { byte = 0x3F; rest = 0x0F; }
  else if (low & 0x08) { byte = 0x30; rest = 0x08; }
  else if (low & 0x04) { byte = 0x0C; rest = 0x04; }
  else { byte = ((owed >> 2) & 0x3C) | (owed & 0x03); rest = owed & 0xF3; }
  V.linkTxInput = rest;
  const state = V.linkState;
  if (state !== LINKSTATE_MASTER && state !== LINKSTATE_SLAVE) {
    sound(P, SFX_BEEP);
    V.linkRemoteInputBuf = 0;
    V.linkTxInput = 0;
    V.linkTxByte = LINKMSG_NONE;
    push(P, 0x2974);                                             // call LinkErrorReset (it does not return)
    yield* linkErrorReset(P);
  }
  if (V.linkAckRequired && state === LINKSTATE_SLAVE) yield* spinUntil(P, () => !V.linkTxPending);
  const out = V.linkTxSeqBits | byte;
  P.di();
  V.linkTxByte = out;
  V.linkTxPending = out;
  P.ei();
  return out;
}

// SerialDecodeInput (00:2994): the peer's pad from hLinkRxByte (a frame byte has bit 7 or 6 set, not both: else a
// beep and no input), decoded as SerialEncodeInput packs it, into hLinkRemoteInput; then hLinkInput: on the master
// a buffered input first, on the slave the input of two frames ago (a two-slot delay line) when none came now.
// All registers kept.
export function serialDecodeInput(P) {
  const { V } = P;
  const rx = V.linkRxByte, kind = rx & 0xC0;
  if (kind !== 0x80 && kind !== 0x40) {
    sound(P, SFX_BEEP);
    V.linkInput = 0;
    return;
  }
  const bits = rx & 0x3F;
  V.linkRemoteInput = bits === 0x3F ? 0x0F : bits === 0x30 ? 0x08 : bits === 0x0C ? 0x04 : ((bits << 2) & 0xF0) | (bits & 0x03);
  if (V.linkState === LINKSTATE_MASTER) {
    V.linkInput = V.linkRemoteInputBuf || V.linkRemoteInput;
  } else {
    const buffered = V.linkRemoteInputBuf;
    V.linkRemoteInputBuf = V.linkRemoteInputPrev;
    V.linkRemoteInputPrev = buffered;
    V.linkInput = V.linkRemoteInput || V.linkRemoteInputBuf;
  }
}

const cpFlags = (a, v) => FLAG_N | (a === v ? FLAG_Z : 0) | ((a & 0xF) < (v & 0xF) ? FLAG_H : 0) | (a < v ? FLAG_C : 0);
export const HOOKS = [
  [0, 0x284B, P => linkErrorReset(P)],
  [0, 0x2861, (P, c) => { const saved = getRegs(c); serialHandler(P); setRegs(c, saved); P.ime = true; }],
  [0, 0x28AF, (P, c) => { const a = incrementLinkFrameCounter(P); setRegs(c, { a, f: cpFlags(a, LINK_FRAME_COUNTER_MAX) }); }],
  [0, 0x28B9, (P, c) => { initSerialLink(P); setRegs(c, { a: 0, f: FLAG_Z }); }],
  [0, 0x28F8, (P, c) => { resetSerialState(P); setRegs(c, { a: 0, f: FLAG_Z }); }],
  [0, 0x2924, (P, c) => (function* () {
    const saved = getRegs(c), a = yield* serialEncodeInput(P);
    setRegs(c, { ...saved, a, f: a ? 0 : FLAG_Z });
  })()],
  [0, 0x2994, preserving(P => { serialDecodeInput(P); })],
];

// Finding the peer and keeping in step (link_handshake_07.asm): the master's probe and the slave's reply, the wait
// for a byte from the master, starting the exchange again after a pause (ResyncLinkSession), the menus' frame of
// commands (RunLinkCommandFrame: cursor moves and choices go across), and what each frame's byte carries. Also the
// two helpers of placement_07.asm the link uses (DecodeLinkCommandCode, ComposeLinkStateByte).
// See common.js for how time is kept.
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
import { readJoypad } from "../../home/joypad.js";
import { resetSerialState, serialEncodeInput } from "../../home/link.js";
import { enableTimerInterrupt } from "../../home/vblank.js";
import { enableLCD } from "../../home/system.js";
import { disableLCDSafely, callShortDelay, LDH, ALU, ALU_N, CB, JR, JR_NOT, PUSH, POP, CALL, RET, LD_RR_NN, INC_DEC_RR } from "../../home/busy.js";
import { playSoundManaged } from "../../audio/requests.js";
import { rSC, rIF, rIE, rLY, SC_INTERNAL, SC_EXTERNAL, LINKSTATE_MASTER, LINKSTATE_SLAVE, LINKMSG_NONE, LINKMSG_PROBE,
  LINKMSG_PROBE_REPLY, TAG_MASTER, TAG_SLAVE, TAG_BITS, LY_EXCHANGE, startTransfer, ei, intr, window, linkError,
  farcall, push, pop } from "./common.js";
import { exchangeLinkFrameByteMaster, exchangeLinkFrameByteSlave } from "./sync.js";

const SFX_BEEP = 0x72;
const BANK_LINK = 0x07, ExchangeLinkReadySignal = 0x477D, PrimeSlaveSerialReply = 0x49E2;
const BANK_LINK_MENUS = 0x3E, AnimateLinkStatusPalette = 0x4A54, ShowLinkStatusMessage = 0x4BA3;
const BANK_MENU_LIB = 0x39, UpdateAnimatedTiles = 0x4342;
const BANK_LINK_CURSOR = 0x38, UpdateMenuCursorFromLinkInput = 0x6C8A;
const LinkStateBytePtrs_07 = 0x4D21;
const AWAIT_TRIES = 0x4E20, PROBE_TRIES = 0x03E8;
const MSG_WAITING = 0x02;                                           // ShowLinkStatusMessage c: "waiting for the other player"
const IE_VBLANK_SERIAL = 0x09;

// a call at pc to a routine that waits (fn): its time and return address, and an interrupt that came in its last
// instruction taken after it
function callWait(P, pc, fn) {
  P.instr(pc, CALL, () => push(P, pc + 3));
  const r = fn();
  P.instr(pc + 3, 0);
  return r;
}

// AwaitSerialByte (07:4A29), called at callPc: wait for a byte from the master, interrupts on between the tries:
// after a VBlank (hVBlankOccurred), up to 20000 tries for the serial handler's note (hLinkTransferDone). Received:
// the note counted down, hVBlankOccurred cleared, carry clear. Timed out: carry set. Returns { a = b = hLinkRxByte,
// carry }; interrupts on.
export function awaitSerialByte(P, callPc) { return callWait(P, callPc, () => awaitSerialByteBody(P, false)); }
// its body (viaHook: entered by the CPU's call, whose return the hook makes)
export function awaitSerialByteBody(P, viaHook) {
  const { V, cpu } = P, I = (pc, n, fn) => P.instr(pc, n, fn);
  {
    I(0x4A29, PUSH, () => push(P, cpu.de));
    I(0x4A2A, LD_RR_NN);
    let de = AWAIT_TRIES, carry;
    for (;;) {
      window(P, 0x4A2D, 2);                                         // .waitLoop: ei / nop / nop / di
      const vb = I(0x4A31, LDH, () => V.vBlankOccurred);
      I(0x4A33, ALU);
      if (!vb) { I(0x4A34, JR); continue; }
      I(0x4A34, JR_NOT);
      const done = I(0x4A36, LDH, () => V.linkTransferDone);
      I(0x4A38, ALU);
      if (done) {                                                   // .received
        I(0x4A39, JR);
        I(0x4A43, ALU);
        I(0x4A44, LDH, () => { V.linkTransferDone = (done - 1) & 0xFF; });
        I(0x4A46, ALU);
        I(0x4A47, LDH, () => { V.vBlankOccurred = 0; });
        I(0x4A49, ALU); I(0x4A4A, ALU);
        carry = false;
        break;
      }
      I(0x4A39, JR_NOT);
      de = (de - 1) & 0xFFFF;
      I(0x4A3B, INC_DEC_RR); I(0x4A3C, ALU); I(0x4A3D, ALU);
      if (de) { I(0x4A3E, JR); continue; }
      I(0x4A3E, JR_NOT); I(0x4A40, ALU); I(0x4A41, JR);
      carry = true;
      break;
    }
    const a = I(0x4A4B, LDH, () => V.linkRxByte);                  // .done
    I(0x4A4D, ALU);
    I(0x4A4E, ALU, () => { cpu.eiPending = true; });
    I(0x4A4F, POP, () => pop(P));
    I(0x4A50, RET, viaHook ? undefined : () => pop(P));
    return { a, b: a, carry };
  }
}

// LongDelay (07:4BC2), called at callPc: 16 ShortDelays (about 60000 cycles)
export function longDelay(P, callPc) { callWait(P, callPc, () => longDelayBody(P, false)); }
export function longDelayBody(P, viaHook) {
  for (let i = 0; i < 16; i++) callShortDelay(P, 0x4BC2 + i * 3);
  P.instr(0x4BF2, RET, viaHook ? undefined : () => pop(P));
}

// PrimeSlaveSerialReply (07:49E2): on the slave, $40 armed on the master's clock (the reply to the master's first
// byte). Keeps every register but a and F.
export function primeSlaveSerialReply(P) {
  if (P.V.linkState === LINKSTATE_SLAVE) startTransfer(P, TAG_MASTER, SC_EXTERNAL);
}

// DecodeLinkCommandCode (07:4CE4): a menu command from the peer's six bits: $14 START ($0F: as all four buttons, the
// way SerialDecodeInput reads them), $15 A ($01), $19 B ($02); anything else nothing. Returns it.
export function decodeLinkCommandCode(a) { return a === 0x14 ? 0x0F : a === 0x15 ? 0x01 : a === 0x19 ? 0x02 : 0; }

// ComposeLinkStateByte (07:4CFE): the byte a frame of play carries (hLinkPayloadKind picks a pair of pointers from
// LinkStateBytePtrs_07): the high nibble of what the first points at, the low nibble of what the second does.
export function composeLinkStateByte(P) {
  const { bus } = P, entry = LinkStateBytePtrs_07 + ((P.V.linkPayloadKind << 2) & 0xFF);
  const rom = a => bus.romByte(BANK_LINK, a), word = a => rom(a) | rom(a + 1) << 8;
  return (bus.u8(word(entry)) & 0xF0) | (bus.u8(word(entry + 2)) & 0x0F);
}

// PrepareLinkStatePayload (07:49F7): before a frame's exchange: the next sequence bit (the one our last byte did not
// have: $40 and $80 by turns), what is still owed of our input set aside (hLinkRemoteInputBuf), the pad read, and
// the new byte to send composed (ComposeLinkStateByte) into hLinkTxInput. Keeps af.
export function prepareLinkStatePayload(P) {
  const { V } = P;
  V.linkTxSeqBits = (V.linkTxByte & TAG_BITS) ^ TAG_BITS;
  V.linkRemoteInputBuf = V.linkTxInput;
  readJoypad(P);
  V.linkTxInput = composeLinkStateByte(P);
}
// PrepareLinkInputPayload (07:4A13): the same for the menus: the buttons pressed this frame (hInputPressed) to send
export function prepareLinkInputPayload(P) {
  const { V } = P;
  V.linkTxSeqBits = (V.linkTxByte & TAG_BITS) ^ TAG_BITS;
  V.linkRemoteInputBuf = V.linkTxInput;
  readJoypad(P);
  V.linkTxInput = V.inputPressed;
}

// ResyncLinkSession (07:4A51) / ResyncLinkSessionWithTimer (07:4AA9): start the exchange again after a screen of
// its own (the menus): only the VBlank and serial interrupts, the LCD off (not WithTimer), the VBlank handler kept
// short (hVBlankSuppressed), the ready signal; the master waits five ShortDelays and sends with the $40 sequence bit,
// the slave clears its note and uses $80; the first byte encoded and the slave's reply primed; the slave
// acknowledges each byte; the LCD on (WithTimer: the timer interrupt on instead); the frame counter cleared.
function* resync(P, withTimer) {
  const { V, bus } = P;
  P.di();
  bus.w8(rIF, 0);
  bus.w8(rIE, bus.u8(rIE) & IE_VBLANK_SERIAL);
  if (!withTimer) {
    ei(P);                                                          // (ei / call DisableLCDSafely: taken as it starts)
    callWait(P, 0x4A5C, () => { disableLCDSafely(P); pop(P); });
  } else ei(P, 0x4AB4, 0x4AB6);                                     // (ei / ld a, $01: taken at the ldh)
  V.vBlankSuppressed = 1;
  V.linkExchangeActive = 1;
  yield* farcall(P, withTimer ? 0x4ABC : 0x4A67, BANK_LINK, ExchangeLinkReadySignal);
  const state = V.linkState;
  if (state === LINKSTATE_SLAVE) {                                  // .asSlave
    V.linkTransferDone = 0;
    V.linkTxSeqBits = TAG_SLAVE;
  } else {
    if (state !== LINKSTATE_MASTER) yield* linkError(P, withTimer ? 0x4AC9 : 0x4A74);
    V.linkTxSeqBits = TAG_MASTER;                                   // .asMaster
    for (let i = 0; i < 5; i++) callShortDelay(P, (withTimer ? 0x4AD0 : 0x4A7B) + i * 3);
  }
  push(P, withTimer ? 0x4AEB : 0x4A96); yield* serialEncodeInput(P); pop(P);   // .encode
  yield* farcall(P, withTimer ? 0x4AEB : 0x4A96, BANK_LINK, PrimeSlaveSerialReply);
  V.linkRemoteInputPrev = 0;
  V.linkAckRequired = 1;
  if (withTimer) enableTimerInterrupt(P); else enableLCD(P);
  V.vBlankSuppressed = 0;
  V.matchFrameCounter = 0;
}
export const resyncLinkSession = P => resync(P, false);
export const resyncLinkSessionWithTimer = P => resync(P, true);

// EnableSerialAndVBlankInterrupts (07:4077): requests cleared, only the VBlank and serial interrupts enabled,
// interrupts on (from after its return)
export function enableSerialAndVBlankInterrupts(P) {
  P.di();
  P.bus.w8(rIF, 0);
  P.bus.w8(rIE, IE_VBLANK_SERIAL);
  ei(P, 0x4080);                                                    // (ei / ret)
}

// TryLinkHandshakeSlave (07:4AFE): the slave's answer: LINKMSG_PROBE_REPLY armed for the serial handler to send,
// then a byte awaited: the master's probe ($C1) is a link (carry clear); a timeout, our own reply, $00 or $FF or
// anything else is none (carry set). Keeps bc, de, hl; interrupts on.
export function tryLinkHandshakeSlave(P) {
  const { V, cpu } = P;
  push(P, cpu.hl); push(P, cpu.de); push(P, cpu.bc);
  push(P, 0x4B04); enableSerialAndVBlankInterrupts(P); pop(P); intr(P, 0x4B04);
  P.di();
  P.bus.w8(rIF, P.bus.u8(rIF) & 0xF7);
  V.linkTransferDone = 0;
  V.linkTxByte = LINKMSG_PROBE_REPLY;
  V.linkTxPending = LINKMSG_PROBE_REPLY;
  ei(P);                                                            // (ei / call AwaitSerialByte)
  const r = awaitSerialByte(P, 0x4B15);
  let carry = true;
  if (!r.carry) {
    P.di();
    const rx = V.linkRxByte;
    carry = rx !== LINKMSG_PROBE;                                   // ($C2, $00, $FF or another: .failed)
  }
  ei(P, 0x4B34, 0x4B35);                                            // .done: ei / pop bc: taken at the pop de
  cpu.bc = pop(P); cpu.de = pop(P); cpu.hl = pop(P);
  return { carry, a: V.linkRxByte };
}

// TryLinkHandshakeMaster (07:4B38): the master's probe: up to 1000 times, at LY $8C with no transfer running, clock
// out LINKMSG_PROBE ($C1) and await a byte (AwaitSerialByte), animating the link screen meanwhile (its palette and
// tiles); the first time round the "waiting" message. The slave's reply ($C2) is a link: carry clear. Otherwise
// (after the tries, a timeout, an echo of the probe, $FF) LINKMSG_NONE is sent, a byte awaited, and the result is
// carry set with a = the tries left. (The timeout's carry is tested after the two far calls: it is the carry they
// leave, which is FarCall's, from the stack pointer.) Keeps bc, de, hl.
export function* tryLinkHandshakeMaster(P) {
  const { V, bus, cpu } = P, I = (pc, n, fn) => P.instr(pc, n, fn);
  const hl0 = cpu.hl, de0 = cpu.de, bc0 = cpu.bc;
  push(P, hl0); push(P, de0); push(P, bc0);
  push(P, 0x4B3E); enableSerialAndVBlankInterrupts(P); pop(P); intr(P, 0x4B3E);
  P.di();
  bus.w8(rSC, bus.u8(rSC) & 0x7F);
  ei(P, 0x4B46, 0x4B48);                                            // (ei / ld a, $c1: taken at the ldh)
  V.linkTxByte = LINKMSG_PROBE;
  let de = PROBE_TRIES, linked = false;
  for (;;) {
    for (;;) {                                                      // .pollLoop: LY $8C and no transfer running
      const ly = I(0x4B50, LDH, () => bus.u8(rLY));
      I(0x4B52, ALU_N);
      if (ly !== LY_EXCHANGE) { I(0x4B54, JR); continue; }
      I(0x4B54, JR_NOT);
      const sc = I(0x4B56, LDH, () => bus.u8(rSC));
      I(0x4B58, CB);
      if (sc & 0x80) { I(0x4B5A, JR); continue; }
      I(0x4B5A, JR_NOT);
      break;
    }
    intr(P, 0x4B5C);
    P.di();
    startTransfer(P, V.linkTxByte, SC_INTERNAL);
    V.linkTransferDone = 0;
    ei(P);                                                          // (ei / call AwaitSerialByte)
    const r = awaitSerialByte(P, 0x4B6F);
    const r1 = yield* farcall(P, 0x4B72, BANK_LINK_MENUS, AnimateLinkStatusPalette, { a: r.a, b: r.b, de, hl: 0x03E8 });
    const r2 = yield* farcall(P, 0x4B75, BANK_MENU_LIB, UpdateAnimatedTiles, { a: r1.a, de, hl: 0x03E8 });
    const a = r2.a;
    if (r2.f & 0x10 || a === LINKMSG_PROBE || a === 0xFF) break;    // jr c / cp $c1 / cp $ff: .sendReady
    if (a === LINKMSG_PROBE_REPLY) { linked = true; break; }        // .failed (the slave answered)
    if (de === PROBE_TRIES) {
      push(P, r2.bc); push(P, de); push(P, r2.hl);
      yield* farcall(P, 0x4B95, BANK_LINK_MENUS, ShowLinkStatusMessage, { c: MSG_WAITING, de, hl: r2.hl });
      pop(P); pop(P); pop(P);
    }
    de = (de - 1) & 0xFFFF;                                         // .retry
    if (!de) break;
  }
  let a, carry;
  if (linked) { a = LINKMSG_PROBE_REPLY; carry = false; }
  else {
    P.di();                                                         // .sendReady
    startTransfer(P, LINKMSG_NONE, SC_INTERNAL);
    V.linkTransferDone = 0;
    ei(P);                                                          // (ei / call AwaitSerialByte)
    awaitSerialByte(P, 0x4BB5);
    a = de & 0xFF; carry = true;
  }
  pop(P); pop(P); pop(P);
  cpu.bc = bc0; cpu.de = de0; cpu.hl = hl0;
  return { a, carry };
}

// SerialEncodeCommand (07:4C24): our menu input to send: the cursor moved by it first (UpdateMenuCursorFromLinkInput,
// with what is owed, hLinkTxInput), then the byte (sequence bit | that input) queued as hLinkTxByte and
// hLinkTxPending; a slave owing an acknowledgement waits (interrupts on) for the serial handler to take the last one
// first. Outside a link: a beep and the link error. Returns a = the byte; keeps bc and hl.
export function* serialEncodeCommand(P) {
  const { V, cpu } = P, I = (pc, n, fn) => P.instr(pc, n, fn);
  push(P, cpu.bc); push(P, cpu.hl);
  const owed = V.linkTxInput;
  push(P, cpu.hl); push(P, cpu.de);
  const r = yield* farcall(P, 0x4C2B, BANK_LINK_CURSOR, UpdateMenuCursorFromLinkInput, { a: owed, b: owed });
  pop(P); pop(P);
  const c = r.b;                                                    // (ld c, b: b as the callee left it)
  const state = V.linkState;
  if (state !== LINKSTATE_MASTER && state !== LINKSTATE_SLAVE) {
    playSoundManaged(P, SFX_BEEP);
    V.linkRemoteInputBuf = 0;
    V.linkTxInput = 0;
    V.linkTxByte = LINKMSG_NONE;
    yield* linkError(P, 0x4C46);
  }
  if (V.linkAckRequired && state === LINKSTATE_SLAVE) {
    for (;;) {                                                      // .waitAck: ei / nop / nop / di / pending?
      window(P, 0x4C54, 2);
      const pending = I(0x4C58, LDH, () => V.linkTxPending);
      I(0x4C5A, ALU);
      if (!pending) { I(0x4C5B, JR_NOT); break; }
      I(0x4C5B, JR);
    }
    intr(P, 0x4C5D);
  }
  const a = V.linkTxSeqBits | c;                                    // .send
  P.di();
  V.linkTxByte = a;
  V.linkTxPending = a;
  ei(P, 0x4C66, 0x4C67);                                            // (ei / pop hl: taken at the pop bc)
  cpu.hl = pop(P); cpu.bc = pop(P);
  return a;
}

// SerialDecodeCommand (07:4C69): the peer's menu input from its byte: a frame byte (tagged $40 or $80, else a beep
// and no input) whose six bits are kept as hLinkRemoteInput; on the master hLinkInput is what is set aside or else
// the decoded command; on the slave the two-slot delay line moves on and hLinkInput is the decoded command or, with
// none, the delayed one. Keeps af and bc.
export function serialDecodeCommand(P) {
  const { V } = P;
  const b = V.linkRxByte, tag = b & TAG_BITS;
  if (tag !== TAG_SLAVE && tag !== TAG_MASTER) {
    playSoundManaged(P, SFX_BEEP);
    V.linkInput = 0;
    return;
  }
  const remote = b & 0x3F;
  V.linkRemoteInput = remote;
  let input;
  if (V.linkState === LINKSTATE_MASTER) input = V.linkRemoteInputBuf || decodeLinkCommandCode(remote);
  else {
    const buffered = V.linkRemoteInputBuf;
    V.linkRemoteInputBuf = V.linkRemoteInputPrev;
    V.linkRemoteInputPrev = buffered;
    input = remote ? decodeLinkCommandCode(remote) : V.linkRemoteInputBuf;
  }
  V.linkInput = input;
}

// RunLinkCommandFrameMaster / Slave (07:4C02 / 4C13): a frame of the link in the menus that takes commands: our
// buttons, the byte exchanged, the peer's command decoded, ours encoded. The master's returns bc and hl swapped (its
// pops are the wrong way round).
export function* runLinkCommandFrameMaster(P) {
  const { cpu } = P, bc = cpu.bc, hl = cpu.hl;
  push(P, bc); push(P, hl);
  prepareLinkInputPayload(P);
  push(P, 0x4C0A); yield* exchangeLinkFrameByteMaster(P); pop(P);
  serialDecodeCommand(P);
  push(P, 0x4C10); const a = yield* serialEncodeCommand(P); pop(P);
  pop(P); pop(P);
  cpu.bc = hl; cpu.hl = bc;
  cpu.a = a;
}
export function* runLinkCommandFrameSlave(P) {
  const { cpu } = P, bc = cpu.bc, hl = cpu.hl;
  push(P, bc); push(P, hl);
  prepareLinkInputPayload(P);
  push(P, 0x4C1B); yield* exchangeLinkFrameByteSlave(P); pop(P);
  serialDecodeCommand(P);
  push(P, 0x4C21); const a = yield* serialEncodeCommand(P); pop(P);
  pop(P); pop(P);
  cpu.bc = bc; cpu.hl = hl;
  cpu.a = a;
}
// RunLinkCommandFrame (07:4BF3): as master or slave
export function* runLinkCommandFrame(P) {
  if (P.V.linkState === LINKSTATE_SLAVE) { push(P, 0x4C01); yield* runLinkCommandFrameSlave(P); pop(P); }
  else { push(P, 0x4BFC); yield* runLinkCommandFrameMaster(P); pop(P); }
}

export { resetSerialState };

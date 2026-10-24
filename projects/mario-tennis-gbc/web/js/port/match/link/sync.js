// The link's frame (link_sync_07.asm): each frame of link play the master clocks one byte each way at LY $8C (the
// slave's serial handler answers it with the byte it has armed), the pads go across in it, and both ends then run the
// frame's work. Also: starting and ending the session of a match, the "ready" signal both ends exchange before one,
// a block of bytes sent both ways (as nibbles: ExchangeLinkDataBlock), and packing / unpacking those nibbles.
// See common.js for how time is kept.
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Not ported: the unused routines (Unused_07_ExchangeHandshakeBlockMaster / Slave, Unused_07_ExchangeLinkBlockToWram5).
// EndLinkSession is in ../match.js.
import { advanceFrame } from "../../home/frame.js";
import { waitVBlank, softResetIfABStartSelect } from "../../home/vblank.js";
import { initSerialLink, serialEncodeInput, serialDecodeInput } from "../../home/link.js";
import { disableLCDSafely, callShortDelay, callWaitSerialTransfer, LDH, ALU, ALU_N, CB, JR, JR_NOT, INC_DEC_RR } from "../../home/busy.js";
import { enableLCD } from "../../home/system.js";
import { playSoundManaged } from "../../audio/requests.js";
import { rSC, rLY, rIF, SC_INTERNAL, SC_EXTERNAL, LINKSTATE_MASTER, LINKSTATE_SLAVE, TAG_MASTER, TAG_SLAVE, TAG_BITS,
  LY_EXCHANGE, IF_SERIAL, wCharInputSource, WRAM_CHAR0, WRAM_CHAR1, INPUT_LINK_MASTER, INPUT_LINK_SLAVE,
  startTransfer, ei, intr, linkError, farcall, push, pop } from "./common.js";
import { awaitSerialByte, prepareLinkStatePayload, prepareLinkInputPayload, primeSlaveSerialReply, longDelay } from "./handshake.js";
import { exchangeNibbleBlockMaster, exchangeNibbleBlockSlave } from "./connect.js";

const BGM_NONE = 0x00;
const READY_MASTER = 0x0B, READY_SLAVE = 0x0A;                       // the "ready" tokens' payloads (6 bits)
const NIBBLES_MAX = 0x5F;                                            // a block's nibbles: fewer than this (47 bytes)
const BANK_LINK = 0x07, SyncLinkFrame = 0x4747, ExchangeLinkReadySignal = 0x477D, PrimeSlaveSerialReply = 0x49E2;

// UnpackBytesToNibbles (07:4656): the c bytes at de as 2c nibbles (high first) into wLinkNibbleBuffer. 2c must stay
// under $5F: else nothing is done. Returns { carry: too long, a: 2c (0 when too long) }.
export function unpackBytesToNibbles(P, c, de) {
  const { bus, A } = P, n = (c << 1) & 0xFF;
  if (n >= NIBBLES_MAX) return { carry: true, a: 0 };
  let hl = A.linkNibbleBuffer, b = 0;
  do {                                                              // (2c = 0: 256 nibbles)
    const v = bus.u8(de);
    if (b & 1) { bus.w8(hl++, v & 0x0F); de = (de + 1) & 0xFFFF; } else bus.w8(hl++, v >> 4);
    b = (b + 1) & 0xFF;
  } while (b !== n);
  return { carry: false, a: n };
}

// PackNibblesToBytes (07:4973): the 2c nibbles in wLinkByteBuffer back into c bytes at hl (high nibble first; a low
// nibble merged into the byte there). 2c too long: the link error. Returns hl after the bytes.
export function* packNibblesToBytes(P, c, hl) {
  const { bus, A } = P, n = (c << 1) & 0xFF;
  if (n >= NIBBLES_MAX) yield* linkError(P, 0x49B6);
  let de = A.linkByteBuffer;
  for (let b = 0; ;) {
    const v = bus.u8(de);
    if (b & 1) bus.w8(hl, (bus.u8(hl) & 0xF0) | (v & 0x0F));
    else bus.w8(hl, (v << 4) & 0xF0);
    b = (b + 1) & 0xFF; de++;
    if (!(b & 1)) hl = (hl + 1) & 0xFFFF;
    if (b >= n) return hl;
  }
}

// ExchangeLinkFrameByteMaster (07:467F): the master's half of a frame. Wait for LY $8C, clock hLinkTxByte out (the
// slave's byte comes in), and AdvanceFrame. The byte that came must be a frame byte (tagged $40 or $80; $00 or $FF:
// no slave, the link error) and not the last one again: a repeat waits two VBlanks and tries the frame again, a
// second one starts the link over and gives the link error. Kept: hLinkLastRxByte and its mirror; hLinkCounter
// cleared. Returns b = the byte.
export function* exchangeLinkFrameByteMaster(P) {
  const { V, bus } = P;
  for (;;) {
    for (;;) {                                                      // di / ldh a, [rLY] / ei / cp $8c / jr nz
      P.instr(0x467F, ALU, () => P.di());
      const ly = P.instr(0x4680, LDH, () => bus.u8(rLY));
      P.instr(0x4682, ALU, () => { P.cpu.eiPending = true; });
      P.instr(0x4683, ALU_N);
      if (ly === LY_EXCHANGE) { P.instr(0x4685, JR_NOT); break; }
      P.instr(0x4685, JR);
    }
    intr(P, 0x4687);
    P.di();
    startTransfer(P, V.linkTxByte, SC_INTERNAL);
    ei(P, 0x4697);                                                  // (ei / call AdvanceFrame: taken as it starts)
    push(P, 0x469A);
    intr(P, 0x2631);
    yield* advanceFrame(P);
    pop(P);
    const b = V.linkRxByte, tag = b & TAG_BITS;
    if (b === 0x00 || (b !== 0xFF && tag !== TAG_SLAVE && tag !== TAG_MASTER)) yield* linkError(P, 0x46AF);   // .badReply
    if (b === 0xFF) yield* linkError(P, 0x46C4);                    // .resetLink
    if (V.linkLastRxByte !== b) {                                   // .store
      V.linkLastRxByte = b;
      V.linkLastRxMirror = b;
      V.linkCounter = 0;
      return b;
    }
    V.linkCounter = (V.linkCounter + 1) & 0xFF;                     // the same byte again
    if (V.linkCounter >= 2) {                                       // .reinitLink
      initSerialLink(P);
      yield* linkError(P, 0x46E3);
    }
    push(P, 0x46DA); intr(P, 0x2814); yield* waitVBlank(P); pop(P);
    push(P, 0x46DD); intr(P, 0x2814); yield* waitVBlank(P); pop(P);
  }
}

// ExchangeLinkFrameByteSlave (07:46EF): the slave's half: wait for the master's byte (AwaitSerialByte: its serial
// handler took it, after a VBlank; a timeout is the link error), AdvanceFrame (the slave's does not wait), and check
// it as the master does, except that a repeat is the link error at once. Returns b = the byte; interrupts on.
export function* exchangeLinkFrameByteSlave(P) {
  const { V } = P;
  const r = awaitSerialByte(P, 0x46EF);
  if (r.carry) yield* linkError(P, 0x470C);
  push(P, 0x46F8);
  intr(P, 0x2631);
  yield* advanceFrame(P);
  pop(P);
  P.di();
  const b = r.b, tag = r.a & TAG_BITS;
  if (r.a === 0x00) yield* linkError(P, 0x470C);
  if (r.a === 0xFF) yield* linkError(P, 0x470F);                   // .resetLinkAgain
  if (tag !== TAG_MASTER && tag !== TAG_SLAVE) yield* linkError(P, 0x470C);
  if (V.linkLastRxByte === b) yield* linkError(P, 0x470C);          // a repeat
  V.linkLastRxByte = b;
  V.linkLastRxMirror = b;
  V.linkCounter = 0;
  P.ei();                                                           // (ei / ret)
  return b;
}

// SyncLinkFrameMaster / Slave (07:4725 / 4736): a frame of the link without play: our pad and the payload of the
// current state (PrepareLinkStatePayload), the byte exchanged, the peer's pad decoded, ours encoded for the next
export function* syncLinkFrameMaster(P) {
  push(P, P.cpu.bc); push(P, P.cpu.hl);
  prepareLinkStatePayload(P);
  push(P, 0x472D); yield* exchangeLinkFrameByteMaster(P); pop(P);
  serialDecodeInput(P);
  push(P, 0x4733); yield* serialEncodeInput(P); pop(P);
  pop(P); pop(P);
}
export function* syncLinkFrameSlave(P) {
  push(P, P.cpu.bc); push(P, P.cpu.hl);
  prepareLinkStatePayload(P);
  push(P, 0x473E); yield* exchangeLinkFrameByteSlave(P); pop(P);
  serialDecodeInput(P);
  push(P, 0x4744); yield* serialEncodeInput(P); pop(P);
  pop(P); pop(P);
}
// SyncLinkFrame (07:4747): the link's frame counter (hMatchFrameCounter) up, and the frame as master or slave.
// Every register kept.
export function* syncLinkFrame(P) {
  const { V, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  V.matchFrameCounter = (V.matchFrameCounter + 1) & 0xFF;
  if (V.linkState === LINKSTATE_SLAVE) { push(P, 0x475D); yield* syncLinkFrameSlave(P); }
  else { push(P, 0x4758); yield* syncLinkFrameMaster(P); }
  pop(P);
  cpu.hl = pop(P); cpu.de = pop(P); cpu.bc = pop(P); const af = pop(P); cpu.a = af >> 8; cpu.f = af & 0xF0;
}

// RunLinkMatchFrame (07:4762): a frame of a link match: the counter up, then RunLinkMatchFrameMaster / Slave
// (connect.js: the pads exchanged, the match's frame). Every register kept.
export function* runLinkMatchFrame(P, master, slave) {
  const { V, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  V.matchFrameCounter = (V.matchFrameCounter + 1) & 0xFF;
  if (V.linkState === LINKSTATE_SLAVE) { push(P, 0x4778); yield* slave(P); }
  else { push(P, 0x4773); yield* master(P); }
  pop(P);
  cpu.hl = pop(P); cpu.de = pop(P); cpu.bc = pop(P); const af = pop(P); cpu.a = af >> 8; cpu.f = af & 0xF0;
}

// ExchangeLinkReadySignal (07:477D): both ends say they are ready: the master after 100 ShortDelays (the slave is
// armed by then), each with its token (ExchangeReadyTokenMaster / Slave). Neither master nor slave: the link error.
// Keeps af and bc.
export function* exchangeLinkReadySignal(P) {
  const { V, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc);
  const state = V.linkState;
  if (state === LINKSTATE_SLAVE) { push(P, 0x479C); yield* exchangeReadyTokenSlave(P); pop(P); }
  else {
    if (state !== LINKSTATE_MASTER) yield* linkError(P, 0x478B);
    for (let c = 0x64; ;) {                                         // .delayLoop: call ShortDelay / dec c / jr nz
      callShortDelay(P, 0x478E);
      c--; P.instr(0x4791, ALU);
      if (!c) { P.instr(0x4792, JR_NOT); break; }
      P.instr(0x4792, JR);
    }
    push(P, 0x4797); yield* exchangeReadyTokenMaster(P); pop(P);
  }
  pop(P); pop(P);
}

// ExchangeReadyTokenMaster (07:479F): stop any transfer of ours, then up to 10000 times: wait while a transfer runs
// (SC bit 7), clock out the master's token ($4B) and give it a ShortDelay; done when the slave's token ($0A in the
// low six bits) has come in. Else the link error.
export function* exchangeReadyTokenMaster(P) {
  const { V, bus, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.de);
  bus.w8(rSC, bus.u8(rSC) & 0x7F);
  for (let de = 0x2710; ;) {
    for (;;) {                                                      // .retry: ldh a, [rSC] / bit 7, a / jr nz
      const sc = P.instr(0x47AA, LDH, () => bus.u8(rSC));
      P.instr(0x47AC, CB);
      if (!(sc & 0x80)) { P.instr(0x47AE, JR_NOT); break; }
      P.instr(0x47AE, JR);
    }
    intr(P, 0x47B0);
    P.di();
    startTransfer(P, READY_MASTER | TAG_MASTER, SC_INTERNAL);
    ei(P);                                                          // (ei / call ShortDelay)
    callShortDelay(P, 0x47C2);
    const rx = P.instr(0x47C5, LDH, () => V.linkRxByte);           // ldh / and $3f / cp $0a / jr z
    P.instr(0x47C7, ALU_N); P.instr(0x47C9, ALU_N);
    if ((rx & 0x3F) === READY_SLAVE) { P.instr(0x47CB, JR); break; }
    P.instr(0x47CB, JR_NOT);
    de = (de - 1) & 0xFFFF;                                         // dec de / ld a, d / or e / jr nz
    P.instr(0x47CD, INC_DEC_RR); P.instr(0x47CE, ALU); P.instr(0x47CF, ALU);
    if (de) { P.instr(0x47D0, JR); continue; }
    P.instr(0x47D0, JR_NOT);
    yield* linkError(P, 0x47D2);
  }
  intr(P, 0x47D5);
  pop(P); pop(P);
}

// ExchangeReadyTokenSlave (07:47D8): the slave's token ($8A) armed on the master's clock (and as hLinkTxByte, for
// the serial handler to arm again), then up to 3 WaitSerialTransfer waits for the master's ($0B in the low six bits).
// Else the link error.
export function* exchangeReadyTokenSlave(P) {
  const { V, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.de);
  P.di();
  V.linkTxByte = READY_SLAVE | TAG_SLAVE;
  startTransfer(P, READY_SLAVE | TAG_SLAVE, SC_EXTERNAL);
  ei(P);                                                            // (ei / call WaitSerialTransfer)
  for (let de = 3; ;) {
    callWaitSerialTransfer(P, 0x47F1);                              // .retry
    const rx = P.instr(0x47F4, LDH, () => V.linkRxByte);           // ldh / and $3f / cp $0b / jr z
    P.instr(0x47F6, ALU_N); P.instr(0x47F8, ALU_N);
    if ((rx & 0x3F) === READY_MASTER) { P.instr(0x47FA, JR); break; }
    P.instr(0x47FA, JR_NOT);
    de = (de - 1) & 0xFFFF;                                         // dec de / ld a, d / or e / jr nz
    P.instr(0x47FC, INC_DEC_RR); P.instr(0x47FD, ALU); P.instr(0x47FE, ALU);
    if (de) { P.instr(0x47FF, JR); continue; }
    P.instr(0x47FF, JR_NOT);
    yield* linkError(P, 0x4801);
  }
  intr(P, 0x4804);
  pop(P); pop(P);
}

// RunLinkInputFrameMaster / Slave (07:4807 / 481D): a frame of the link in the menus: our pad as it is (the button
// edges: PrepareLinkInputPayload), the byte exchanged, the peer's pad decoded (A+B+START+SELECT on it: a soft
// reset), ours encoded. The master's pops bc and hl the wrong way round: it returns with them swapped.
export function* runLinkInputFrameMaster(P) {
  const { V, cpu } = P, bc = cpu.bc, hl = cpu.hl;
  push(P, bc); push(P, hl);
  prepareLinkInputPayload(P);
  push(P, 0x480F); yield* exchangeLinkFrameByteMaster(P); pop(P);
  serialDecodeInput(P);
  softResetIfABStartSelect(P, V.linkInput);
  push(P, 0x481A); const a = yield* serialEncodeInput(P); pop(P);
  pop(P); pop(P);
  cpu.bc = hl; cpu.hl = bc;                                         // pop bc / pop hl
  cpu.a = a; cpu.f = a ? 0 : 0x80;
}
export function* runLinkInputFrameSlave(P) {
  const { V, cpu } = P, bc = cpu.bc, hl = cpu.hl;
  push(P, bc); push(P, hl);
  prepareLinkInputPayload(P);
  push(P, 0x4825); yield* exchangeLinkFrameByteSlave(P); pop(P);
  serialDecodeInput(P);
  softResetIfABStartSelect(P, V.linkInput);
  push(P, 0x4830); const a = yield* serialEncodeInput(P); pop(P);
  pop(P); pop(P);
  cpu.bc = bc; cpu.hl = hl;
  cpu.a = a; cpu.f = a ? 0 : 0x80;
}
// RunLinkInputFrame (07:4833): the counter up, and the frame as master or slave
export function* runLinkInputFrame(P) {
  const { V } = P;
  V.matchFrameCounter = (V.matchFrameCounter + 1) & 0xFF;
  if (V.linkState === LINKSTATE_SLAVE) { push(P, 0x4845); yield* runLinkInputFrameSlave(P); pop(P); }
  else { push(P, 0x4840); yield* runLinkInputFrameMaster(P); pop(P); }
}

// UpdateLinkSession (07:4846), as a match starts: in a link match (wLinkSessionActive), the first time (no exchange
// yet): the music stopped, the LCD off, the ready signal; the master then waits 16 ShortDelays and sends with the
// $40 sequence bit, the slave clears hLinkTransferDone and uses $80; the first pad byte encoded, the slave's reply
// primed; the master drives character 0 and the slave character 1 (wCharInputSource 5 and 6); the slave acknowledges
// each byte from now on (hLinkAckRequired); the LCD on. Every time: the frame counter cleared and three link frames.
// Every register kept.
export function* updateLinkSession(P) {
  const { V, bus, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  if (bus.u8(P.A.linkSessionActive)) {
    if (!V.linkExchangeActive) {
      playSoundManaged(P, BGM_NONE);
      P.instr(0x4859, 24, () => push(P, 0x485C)); disableLCDSafely(P); pop(P); intr(P, 0x485C);   // call DisableLCDSafely
      V.linkExchangeActive = 1;
      yield* farcall(P, 0x4860, BANK_LINK, ExchangeLinkReadySignal);
      const state = V.linkState;
      if (state === LINKSTATE_SLAVE) {                              // .asSlave
        V.linkTransferDone = 0;
        V.linkTxSeqBits = TAG_SLAVE;
      } else {
        if (state !== LINKSTATE_MASTER) yield* linkError(P, 0x486E);
        V.linkTxSeqBits = TAG_MASTER;                               // .asMaster
        for (let i = 0; i < 16; i++) callShortDelay(P, 0x4875 + i * 3);
      }
      V.linkPlayerCount = 0;                                        // .encode
      push(P, 0x48B4); yield* serialEncodeInput(P); pop(P);
      yield* farcall(P, 0x48B4, BANK_LINK, PrimeSlaveSerialReply);
      V.linkRemoteInputPrev = 0;
      P.wramBank(WRAM_CHAR0); bus.w8(wCharInputSource, INPUT_LINK_MASTER);
      P.wramBank(WRAM_CHAR1); bus.w8(wCharInputSource, INPUT_LINK_SLAVE);
      P.wramBank(WRAM_CHAR0);
      V.linkRxByte = 0;
      V.linkTransferDone = 0;
      V.linkAckRequired = 1;
      enableLCD(P);
    }
    V.matchFrameCounter = 0;                                        // .frameLoop
    for (const pc of [0x48E3, 0x48E8, 0x48ED]) {
      push(P, cpu.a << 8 | cpu.f);                                  // (push af / farcall / pop af)
      yield* farcall(P, pc, BANK_LINK, SyncLinkFrame);
      pop(P);
    }
  }
  cpu.hl = pop(P); cpu.de = pop(P); cpu.bc = pop(P); const af = pop(P); cpu.a = af >> 8; cpu.f = af & 0xF0;
}

// ExchangeLinkDataBlock (07:496E): c bytes at de go to the peer and its c bytes come into hl, as nibbles, with
// the LCD off: a VBlank, the LCD off, the serial interrupt request dropped, three LongDelays, then the block
// exchanged as master or slave (ExchangeNibbleBlockMaster / Slave: with a checksum, again until it is right), the
// nibbles packed into hl, the VBlank and serial interrupts requested, the LCD on.
export function* exchangeLinkDataBlock(P, hl, de, c) {
  const { V, bus, cpu } = P;
  push(P, hl); push(P, de); push(P, cpu.bc);
  push(P, 0x4974); intr(P, 0x2814); yield* waitVBlank(P); pop(P);
  P.instr(0x4974, 24, () => push(P, 0x4977)); disableLCDSafely(P); pop(P); intr(P, 0x4977);   // call DisableLCDSafely
  P.di();
  bus.w8(rIF, bus.u8(rIF) & IF_SERIAL);                             // (and $08: only a serial request stays)
  ei(P, 0x497F, 0x4980);                                            // (ei / xor a: taken at the ldh)
  V.linkExchangeActive = 0;
  for (const pc of [0x4982, 0x4985, 0x4988]) longDelay(P, pc);
  pop(P); pop(P); pop(P);
  const state = V.linkState;
  if (state === LINKSTATE_SLAVE) { push(P, 0x49A3); yield* exchangeNibbleBlockSlave(P, c, de); pop(P); }
  else {
    if (state !== LINKSTATE_MASTER) yield* linkError(P, 0x4998);
    push(P, 0x499E); yield* exchangeNibbleBlockMaster(P, c, de); pop(P);
  }
  push(P, 0x49A6); yield* packNibblesToBytes(P, c, hl); pop(P);     // .unpack
  P.di();
  bus.w8(rIF, 0x09);                                                // (VBlank and serial requested)
  ei(P, 0x49AC);                                                    // (ei / call EnableLCD: taken as it starts)
  push(P, 0x49AF); intr(P, 0x0376); enableLCD(P); pop(P);
}

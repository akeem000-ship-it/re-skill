// Connecting and the big transfers (link_connect_07.asm): which end is the master (TryEstablishLink: the end that
// finds the other's probe already waiting is the slave), a frame of a link match, and a block of bytes sent both
// ways as tagged nibbles with a checksum (ExchangeNibbleBlockMaster / Slave, again until both sums agree).
// See common.js for how time is kept.
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Not ported: Unused_07_DelayByLinkPhase.
import { serialEncodeInput, serialDecodeInput } from "../../home/link.js";
import { softResetIfABStartSelect } from "../../home/vblank.js";
import { callShortDelay, callWaitSerialTransfer } from "../../home/busy.js";
import { SC_INTERNAL, SC_EXTERNAL, LINKSTATE_MASTER, LINKSTATE_SLAVE, LINKMSG_PROBE, LINKMSG_SYNC_MASTER, LINKMSG_SYNC_SLAVE,
  LINKMSG_BLOCK_END, LINKMSG_BLOCK_END_ACK, LINKMSG_CHECKSUM, LINKMSG_CHECKSUM_BAD, LINKMSG_BLOCK_OK, TAG_MASTER,
  TAG_SLAVE, TAG_BITS, hLinkBlockChecksum, startTransfer, dropSerialRequest, ei, intr, window, linkError, farcall,
  push, pop } from "./common.js";
import { resetSerialState, tryLinkHandshakeMaster, tryLinkHandshakeSlave, prepareLinkStatePayload } from "./handshake.js";
import { exchangeLinkFrameByteMaster, exchangeLinkFrameByteSlave, unpackBytesToNibbles } from "./sync.js";
import { computeNibbleBufferChecksum, pollSerialResponse, sendByteAwaitEchoMaster, sendByteGetReplyMaster,
  sendByteGetReplySlave, exchangeChecksumMaster, exchangeChecksumSlave } from "./nibble.js";

const BANK_MATCH = 0x08, UpdateMatchFrame = 0x41F7;
const SYNC_TRIES = 0x64;

// TryEstablishLink (07:4048), from the main menu's Link cell: if the peer's probe is already in (hLinkRxByte $C1),
// be the slave (TryLinkHandshakeSlave), else the master (TryLinkHandshakeMaster). No link: the serial variables
// reset (ResetSerialState). Returns { a, carry }: carry clear for a link, set for none.
export function* tryEstablishLink(P) {
  const { V } = P;
  P.di();
  const rx = V.linkRxByte;
  ei(P, 0x404C, 0x404E);                                            // (ei / cp $c1: taken at the jr)
  if (rx !== LINKMSG_PROBE) {
    V.linkState = LINKSTATE_MASTER;
    push(P, 0x4057); const r = yield* tryLinkHandshakeMaster(P); pop(P);
    if (!r.carry) return r;
    resetSerialState(P);
    return { a: r.a, carry: true };
  }
  P.di();                                                           // .probe
  V.linkRxByte = 0;
  V.linkTransferDone = 0;
  ei(P, 0x4069, 0x406B);                                            // (ei / ld a, LINKSTATE_SLAVE: taken at the ldh)
  V.linkState = LINKSTATE_SLAVE;
  push(P, 0x4070); const r = tryLinkHandshakeSlave(P); pop(P);
  if (!r.carry) return r;
  resetSerialState(P);
  return { a: 0, carry: true };
}

// RunLinkMatchFrameMaster / Slave (07:4081 / 409A): a frame of a link match: our state's byte (PrepareLinkStatePayload),
// the exchange, the peer's pad decoded (A+B+START+SELECT on it: a soft reset), the match's frame (UpdateMatchFrame),
// our pad encoded for the next. Keeps bc and hl.
function* runLinkMatchFrameEnd(P, exchange, at) {
  const { V, cpu } = P;
  push(P, cpu.bc); push(P, cpu.hl);
  prepareLinkStatePayload(P);
  push(P, at.exchangeRet); yield* exchange(P); pop(P);
  serialDecodeInput(P);
  softResetIfABStartSelect(P, V.linkInput);
  yield* farcall(P, at.matchFrame, BANK_MATCH, UpdateMatchFrame);
  push(P, at.encodeRet); yield* serialEncodeInput(P); pop(P);
  cpu.hl = pop(P); cpu.bc = pop(P);
}
export const runLinkMatchFrameMaster = P => runLinkMatchFrameEnd(P, exchangeLinkFrameByteMaster, { exchangeRet: 0x4089, matchFrame: 0x4091, encodeRet: 0x4097 });
export const runLinkMatchFrameSlave = P => runLinkMatchFrameEnd(P, exchangeLinkFrameByteSlave, { exchangeRet: 0x40A2, matchFrame: 0x40AA, encodeRet: 0x40B0 });

// the tail both ends share: the block's checksums compared (ours, of what we sent, against the peer's sum of what
// it received). Returns true when they agree.
function checksumsAgree(P, hl) { return hl === P.bus.u16(hLinkBlockChecksum); }

// ExchangeNibbleBlockMaster (07:40B3): the c bytes at de go to the slave as 2c nibbles (tagged $40) while the slave's
// come back (tagged $80) into wLinkByteBuffer. Four ShortDelays, then the sync: LINKMSG_SYNC_MASTER until the slave's
// LINKMSG_SYNC_SLAVE (100 tries, else the link error); each nibble sent until it is answered; then the block's end
// (echoed), the checksums exchanged (ExchangeChecksumMaster) and the verdict sent: a bad sum or the slave's
// asking for it again starts the block over. Keeps every register.
export function* exchangeNibbleBlockMaster(P, c, de0) {
  const { V, bus, A, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  const u = unpackBytesToNibbles(P, c, de0);
  if (u.carry) yield* linkError(P, 0x40BC);
  const n = u.a;
  computeNibbleBufferChecksum(P, n);
  for (;;) {                                                        // .startBlock
    for (const pc of [0x40C3, 0x40C6, 0x40C9, 0x40CC]) callShortDelay(P, pc);
    for (let e = SYNC_TRIES; ;) {                                   // .syncLoop
      P.di();
      startTransfer(P, LINKMSG_SYNC_MASTER, SC_INTERNAL);
      ei(P);                                                        // (ei / call WaitSerialTransfer)
      callWaitSerialTransfer(P, 0x40E1);
      callShortDelay(P, 0x40E4);
      callShortDelay(P, 0x40E7);
      P.di();
      const rx = V.linkRxByte;
      ei(P, 0x40EE, 0x40F0);                                        // (ei / cp $c4: taken at the jr)
      if (rx === LINKMSG_SYNC_SLAVE) break;
      e = (e - 1) & 0xFF;
      if (!e) yield* linkError(P, 0x40F5);
    }
    V.linkNibbleAccum = 0;                                          // .synced
    V.linkBlockOffset = 0;
    let sum = 0;
    for (let b = n; ;) {                                            // .nibbleLoop
      V.linkTxByte = bus.u8((A.linkNibbleBuffer + V.linkBlockOffset) & 0xFFFF);
      let reply;
      for (;;) {                                                    // .sendRetry
        startTransfer(P, V.linkTxByte | TAG_MASTER, SC_INTERNAL);
        callWaitSerialTransfer(P, 0x411E);
        callShortDelay(P, 0x4121);
        callShortDelay(P, 0x4124);
        push(P, 0x412A); reply = pollSerialResponse(P); pop(P); intr(P, 0x412A);
        if (!reply.carry) break;
      }
      if ((reply.a & TAG_BITS) !== TAG_SLAVE) yield* linkError(P, 0x4133);
      const v = reply.a & 0x3F;                                     // .storeRxNibble
      bus.w8((A.linkByteBuffer + V.linkNibbleAccum) & 0xFFFF, v);
      sum = (sum + v) & 0xFFFF;
      V.linkCounter = 0;                                            // .nextNibble
      V.linkBlockOffset = (V.linkBlockOffset + 1) & 0xFF;
      V.linkNibbleAccum = (V.linkNibbleAccum + 1) & 0xFF;
      b = (b - 1) & 0xFF;
      if (!b) break;
    }
    push(P, 0x4160);
    const echoed = !sendByteAwaitEchoMaster(P, LINKMSG_BLOCK_END, LINKMSG_BLOCK_END_ACK);
    pop(P);
    if (!echoed) yield* linkError(P, 0x4162);
    push(P, 0x416A); const r1 = yield* sendByteGetReplyMaster(P, LINKMSG_CHECKSUM); pop(P);   // .sendBlockEnd
    if (r1 !== LINKMSG_CHECKSUM) yield* linkError(P, 0x416E);
    push(P, 0x4174); const hl = yield* exchangeChecksumMaster(P, sum); pop(P);
    if (checksumsAgree(P, hl)) {                                    // .checksumOk
      push(P, 0x41A0); const v = yield* sendByteGetReplyMaster(P, LINKMSG_BLOCK_OK); pop(P);
      if (v === LINKMSG_BLOCK_OK) break;
      if (v === LINKMSG_CHECKSUM_BAD) continue;
      yield* linkError(P, 0x41A9);
    }
    push(P, 0x418E); const v = yield* sendByteGetReplyMaster(P, LINKMSG_CHECKSUM_BAD); pop(P);
    if (v === LINKMSG_BLOCK_OK || v === LINKMSG_CHECKSUM_BAD) continue;
    yield* linkError(P, 0x4198);
  }
  cpu.hl = pop(P); cpu.de = pop(P); cpu.bc = pop(P); const af = pop(P); cpu.a = af >> 8; cpu.f = af & 0xF0;
}

// ExchangeNibbleBlockSlave (07:41EF): the slave's side. Armed with LINKMSG_SYNC_SLAVE (and its first nibble queued for
// the serial handler), it waits for the master's LINKMSG_SYNC_MASTER (100 bytes, else the link error); then each
// nibble the master clocks in (tagged $40) is answered with our next one (tagged $80), the last answered with
// LINKMSG_BLOCK_END_ACK; the master's LINKMSG_CHECKSUM, the checksums (ExchangeChecksumSlave), and the verdict: a bad
// sum asks for the block again (LINKMSG_CHECKSUM_BAD sent first, armed directly). Keeps every register.
export function* exchangeNibbleBlockSlave(P, c, de0) {
  const { V, bus, A, cpu } = P;
  push(P, cpu.a << 8 | cpu.f); push(P, cpu.bc); push(P, cpu.de); push(P, cpu.hl);
  const u = unpackBytesToNibbles(P, c, de0);
  if (u.carry) yield* linkError(P, 0x41F8);
  const n = u.a;
  computeNibbleBufferChecksum(P, n);
  for (;;) {                                                        // .startBlock
    P.di();
    startTransfer(P, LINKMSG_SYNC_SLAVE, SC_EXTERNAL);
    window(P, 0x420E, 2);                                           // ei / nop / nop / di
    V.linkTxByte = bus.u8(A.linkNibbleBuffer) | TAG_SLAVE;
    ei(P, 0x421A);                                                  // (ei / ld e, $64: taken at the call)
    for (let e = SYNC_TRIES; ;) {                                   // .syncLoop
      const timedOut = callWaitSerialTransfer(P, 0x421C).f & 0x10;
      if (timedOut) yield* linkError(P, 0x422C);
      P.di();
      const rx = V.linkRxByte;
      ei(P, 0x4225, 0x4227);                                        // (ei / cp $c3: taken at the jr)
      if (rx === LINKMSG_SYNC_MASTER) break;
      e = (e - 1) & 0xFF;
      if (!e) yield* linkError(P, 0x422C);
    }
    V.linkBlockOffset = 1;                                          // .synced
    V.linkNibbleAccum = 0;
    let sum = 0;
    const store = v => {
      bus.w8((A.linkByteBuffer + V.linkNibbleAccum) & 0xFFFF, v & 0x3F);
      sum = (sum + (v & 0x3F)) & 0xFFFF;
    };
    for (let b = (n - 1) & 0xFF; ;) {                               // .nibbleLoop
      P.di();
      dropSerialRequest(P);
      V.linkTransferDone = 0;
      V.linkTxByte = bus.u8((A.linkNibbleBuffer + V.linkBlockOffset) & 0xFFFF) | TAG_SLAVE;
      ei(P);                                                        // (ei / call WaitSerialTransfer)
      if (callWaitSerialTransfer(P, 0x4255).f & 0x10) yield* linkError(P, 0x425A);
      push(P, 0x4260); const reply = pollSerialResponse(P); pop(P); intr(P, 0x4260);
      if (reply.carry) yield* linkError(P, 0x4262);
      if ((reply.a & TAG_BITS) !== TAG_MASTER) yield* linkError(P, 0x426C);
      store(reply.a);                                               // .storeRxNibble
      V.linkCounter = 0;                                            // .nextNibble
      V.linkBlockOffset = (V.linkBlockOffset + 1) & 0xFF;
      V.linkNibbleAccum = (V.linkNibbleAccum + 1) & 0xFF;
      b = (b - 1) & 0xFF;
      if (!b) break;
    }
    P.di();
    dropSerialRequest(P);
    V.linkTransferDone = 0;
    V.linkTxByte = LINKMSG_BLOCK_END_ACK;
    ei(P);                                                          // (ei / call WaitSerialTransfer)
    callWaitSerialTransfer(P, 0x429F);
    P.di();
    const last = V.linkRxByte;
    ei(P, 0x42A6, 0x42A7);                                          // (ei / ld b, a: taken at the and)
    if ((last & TAG_BITS) !== TAG_MASTER) yield* linkError(P, 0x42AD);
    store(last);                                                    // .storeLastNibble
    push(P, 0x42C8); const r1 = yield* sendByteGetReplySlave(P, LINKMSG_CHECKSUM); pop(P);   // .sendBlockEnd
    if (r1 !== LINKMSG_BLOCK_END) yield* linkError(P, 0x42CC);
    push(P, 0x42D2); const hl = yield* exchangeChecksumSlave(P, sum); pop(P);
    if (checksumsAgree(P, hl)) {                                    // .checksumOk
      push(P, 0x4317); const v = yield* sendByteGetReplySlave(P, LINKMSG_BLOCK_OK); pop(P);
      if (v === LINKMSG_CHECKSUM_BAD) continue;
      if (v === LINKMSG_BLOCK_OK) break;
      yield* linkError(P, 0x4320);
    }
    P.di();
    dropSerialRequest(P);
    V.linkTransferDone = 0;
    startTransfer(P, LINKMSG_CHECKSUM_BAD, SC_EXTERNAL);
    ei(P, 0x4300, 0x4302);                                          // (ei / ld a, $cb: taken at the call)
    push(P, 0x4305); const v = yield* sendByteGetReplySlave(P, LINKMSG_CHECKSUM_BAD); pop(P);
    if (v === LINKMSG_CHECKSUM_BAD || v === LINKMSG_BLOCK_OK) continue;
    yield* linkError(P, 0x430F);
  }
  cpu.hl = pop(P); cpu.de = pop(P); cpu.bc = pop(P); const af = pop(P); cpu.a = af >> 8; cpu.f = af & 0xF0;
}

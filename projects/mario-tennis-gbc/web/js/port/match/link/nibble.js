// Link blocks, byte by byte (nibble_07.asm): sending one byte and getting the peer's, polling for a reply, and the
// checksum of a block (its nibbles summed) exchanged nibble by nibble. See common.js for how time is kept.
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
// Not ported: the unused routines (Unused_07_SendNibbleBlockSlave, Unused_07_ReceiveNibbleBlockMaster,
// Unused_07_SendByteAwaitEchoSlave, Unused_07_SendByteAwaitReplyMaster).
import { incrementLinkFrameCounter } from "../../home/link.js";
import { callShortDelay, callWaitSerialTransfer } from "../../home/busy.js";
import { SC_INTERNAL, TAG_MASTER, TAG_SLAVE, TAG_BITS, LINKMSG_CHECKSUM, LINKMSG_BLOCK_OK, hLinkBlockChecksum,
  startTransfer, ei, window, linkError, push, pop } from "./common.js";

// ShiftNibbleIntoChecksum (07:43F6): hl = hl << 4 | the low nibble of b. Returns hl.
export const shiftNibbleIntoChecksum = (hl, b) => ((hl << 4) | (b & 0x0F)) & 0xFFFF;

// ComputeNibbleBufferChecksum (07:440C): the sum of the c nibbles in wLinkNibbleBuffer (c = 0: 256) into
// hLinkBlockChecksum (a word). Every register kept.
export function computeNibbleBufferChecksum(P, c) {
  const { bus, A } = P;
  let sum = 0, i = 0;
  do { sum = (sum + bus.u8(A.linkNibbleBuffer + i)) & 0xFFFF; i++; c = (c - 1) & 0xFF; } while (c);
  bus.w16(hLinkBlockChecksum, sum);
}

// PollSerialResponse (07:452F): what the peer sent (hLinkRxByte). $00 or $FF: nothing (the link's frame counter
// counts up: IncrementLinkFrameCounter), carry set; else the counter cleared, carry clear. Returns { a: the byte,
// carry }; interrupts on.
export function pollSerialResponse(P) {
  const { V } = P;
  P.di();
  const b = V.linkRxByte;
  let carry;
  if (b === 0x00 || b === 0xFF) { incrementLinkFrameCounter(P); carry = true; }
  else { V.linkCounter = 0; carry = false; }
  ei(P, 0x4548, 0x4549);                                         // (ei / ld a, b / pop bc: taken at the pop)
  return { a: b, carry };
}

// SendByteAwaitEchoMaster (07:454B): send a (master's clock) until the peer answers b, up to 20 answers that are
// something else; no answer ($00 / $FF) does not count, the link's frame counter does. Each try: the transfer, then
// two ShortDelays. Returns carry: clear when b came, set when the tries ran out.
export function sendByteAwaitEchoMaster(P, a, b) {
  const { V } = P;
  V.linkTxByte = a;
  for (let c = 0x14; ;) {
    P.di();                                                      // .sendLoop
    startTransfer(P, V.linkTxByte, SC_INTERNAL);
    ei(P);
    callWaitSerialTransfer(P, 0x4560);
    callShortDelay(P, 0x4563);
    callShortDelay(P, 0x4566);
    P.di();
    const rx = V.linkRxByte;
    ei(P, 0x456D, 0x456F);                                       // (ei / cp $00: an interrupt is taken at the jr)
    if (rx === 0x00 || rx === 0xFF) { incrementLinkFrameCounter(P); continue; }   // .retry
    if (rx === b) return false;                                  // .success
    V.linkCounter = 0;
    c = (c - 1) & 0xFF;
    if (!c) return true;
  }
}

// SendByteGetReplyMaster (07:45C1): send a (master's clock) and return what the peer sent back: up to 100 tries
// while it answers nothing ($00 / $FF), then the link error. Each try opens an interrupt window, the transfer, two
// ShortDelays. Returns the reply; interrupts on.
export function* sendByteGetReplyMaster(P, a) {
  const { V } = P;
  V.linkTxByte = a;
  for (let c = 0x64; ;) {
    window(P, 0x45C6, 1);                                        // .sendLoop: ei / nop / di
    startTransfer(P, V.linkTxByte, SC_INTERNAL);
    ei(P);
    callWaitSerialTransfer(P, 0x45D8);
    callShortDelay(P, 0x45DB);
    callShortDelay(P, 0x45DE);
    P.di();
    const rx = V.linkRxByte;
    if (rx !== 0x00 && rx !== 0xFF) { P.ei(); return rx; }       // .done: ei / pop bc / ret
    c = (c - 1) & 0xFF;                                          // .retry
    if (!c) { ei(P, 0x45F2); yield* linkError(P, 0x45F2); }
  }
}

// SendByteGetReplySlave (07:4624): a goes out as the slave's next byte (hLinkTxByte, hLinkTxPending: the serial
// handler arms it after the master's next transfer); any serial request not taken yet is dropped. Then up to 100
// WaitSerialTransfer waits for a reply that is not $00 / $FF, else the link error. Returns the reply.
export function* sendByteGetReplySlave(P, a) {
  const { V } = P;
  P.di();
  V.linkTxPending = a;
  V.linkTxByte = a;
  P.bus.w8(0xFF0F, P.bus.u8(0xFF0F) & 0xF7);
  V.linkTransferDone = 0;
  ei(P, 0x4634);                                                 // (ei / ld c, $64: taken at the call)
  for (let c = 0x64; ;) {
    const timedOut = callWaitSerialTransfer(P, 0x4636).f & 0x10;  // .waitLoop
    if (!timedOut) {
      P.di();
      const rx = V.linkRxByte;
      ei(P, 0x463F, 0x4641);                                     // (ei / cp $00: taken at the jr)
      if (rx !== 0x00 && rx !== 0xFF) { V.linkCounter = 0; return rx; }
    }
    c = (c - 1) & 0xFF;                                          // .retry
    if (!c) yield* linkError(P, 0x4651);
  }
}

// ExchangeChecksumMaster (07:4328): our sum of the nibbles received (de) goes to the slave a nibble at a time
// (tagged $40), and the slave's four nibbles (tagged $80, else the link error) come back into hl. Then two
// ShortDelays. Returns hl.
export function* exchangeChecksumMaster(P, de) {
  let hl = 0;
  const nibbles = [de >> 12, (de >> 8) & 0x0F, (de >> 4) & 0x0F, de & 0x0F];
  const errorAt = [0x433D, 0x4352, 0x4369, 0x437E];
  for (let i = 0; i < 4; i++) {
    const b = yield* sendByteGetReplyMaster(P, nibbles[i] | TAG_MASTER);
    if ((b & TAG_BITS) !== TAG_SLAVE) yield* linkError(P, errorAt[i]);
    hl = shiftNibbleIntoChecksum(hl, b);
  }
  callShortDelay(P, 0x4384);
  callShortDelay(P, 0x4387);
  return hl;
}

// ExchangeChecksumSlave (07:438C): the same from the slave: our sum's nibbles (tagged $80) answer the master's one
// byte later, so the first reply must be its LINKMSG_CHECKSUM, then come the master's four nibbles (tagged $40, else
// the link error), the last in reply to LINKMSG_BLOCK_OK. Returns hl.
export function* exchangeChecksumSlave(P, de) {
  let hl = 0;
  if ((yield* sendByteGetReplySlave(P, (de >> 12) | TAG_SLAVE)) !== LINKMSG_CHECKSUM) yield* linkError(P, 0x439E);
  const sends = [((de >> 8) & 0x0F) | TAG_SLAVE, ((de >> 4) & 0x0F) | TAG_SLAVE, (de & 0x0F) | TAG_SLAVE, LINKMSG_BLOCK_OK];
  const errorAt = [0x43B0, 0x43C7, 0x43DC, 0x43EE];
  for (let i = 0; i < 4; i++) {
    const b = yield* sendByteGetReplySlave(P, sends[i]);
    if ((b & TAG_BITS) !== TAG_MASTER) yield* linkError(P, errorAt[i]);
    hl = shiftNibbleIntoChecksum(hl, b);
  }
  return hl;
}

export { push, pop };

// The link cable code of bank 07 (link_connect, link_sync, link_handshake, nibble_07.asm; two helpers of
// placement_07.asm), as hooks at the ROM's addresses: what the ROM's own callers (the menus, the match) reach.
// Checked against the ROM's code by playing link mode on two machines joined by an emulated cable, once with these
// routines and once with the ROM's, everything else the same (web/tests/port/link_pair.mjs --check).
// Port of the gerbiljames/mario-tennis-gbc-disasm (MIT, third_party/mario-tennis-gbc-disasm): names and addresses.
import { FLAG_Z, FLAG_C, setRegs } from "../../home/cpu.js";
import { tryEstablishLink, runLinkMatchFrameMaster, runLinkMatchFrameSlave, exchangeNibbleBlockMaster,
  exchangeNibbleBlockSlave } from "./connect.js";
import { unpackBytesToNibbles, packNibblesToBytes, exchangeLinkFrameByteMaster, exchangeLinkFrameByteSlave,
  syncLinkFrameMaster, syncLinkFrameSlave, syncLinkFrame, runLinkMatchFrame, exchangeLinkReadySignal,
  exchangeReadyTokenMaster, exchangeReadyTokenSlave, runLinkInputFrameMaster, runLinkInputFrameSlave, runLinkInputFrame,
  updateLinkSession, exchangeLinkDataBlock } from "./sync.js";
import { awaitSerialByteBody, longDelayBody, primeSlaveSerialReply, decodeLinkCommandCode, composeLinkStateByte,
  prepareLinkStatePayload, prepareLinkInputPayload, resyncLinkSession, resyncLinkSessionWithTimer,
  enableSerialAndVBlankInterrupts, tryLinkHandshakeSlave, tryLinkHandshakeMaster, serialEncodeCommand,
  serialDecodeCommand, runLinkCommandFrameMaster, runLinkCommandFrameSlave, runLinkCommandFrame } from "./handshake.js";
import { shiftNibbleIntoChecksum, computeNibbleBufferChecksum, pollSerialResponse, sendByteAwaitEchoMaster,
  sendByteGetReplyMaster, sendByteGetReplySlave, exchangeChecksumMaster, exchangeChecksumSlave } from "./nibble.js";

const B = 0x07;
const gen = fn => (P, c) => fn(P, c);                               // a routine that may wait (a generator)
const carryOut = (c, carry, a) => setRegs(c, { a, f: carry ? FLAG_C : 0 });

export const LINK_HOOKS = [
  // link_connect_07
  [B, 0x4048, (P, c) => (function* () { const r = yield* tryEstablishLink(P); carryOut(c, r.carry, r.a); })()],
  [B, 0x4077, (P, c) => { enableSerialAndVBlankInterrupts(P); setRegs(c, { a: 0x09 }); }],
  [B, 0x4081, gen(P => runLinkMatchFrameMaster(P))],
  [B, 0x409A, gen(P => runLinkMatchFrameSlave(P))],
  [B, 0x40B3, gen((P, c) => exchangeNibbleBlockMaster(P, c.c, c.de))],
  [B, 0x41EF, gen((P, c) => exchangeNibbleBlockSlave(P, c.c, c.de))],
  // link_sync_07
  [B, 0x4656, (P, c) => { const r = unpackBytesToNibbles(P, c.c, c.de); carryOut(c, r.carry, r.a); }],
  [B, 0x467F, (P, c) => (function* () { c.b = yield* exchangeLinkFrameByteMaster(P); })()],
  [B, 0x46EF, (P, c) => (function* () { c.b = yield* exchangeLinkFrameByteSlave(P); })()],
  [B, 0x4725, gen(P => syncLinkFrameMaster(P))],
  [B, 0x4736, gen(P => syncLinkFrameSlave(P))],
  [B, 0x4747, gen(P => syncLinkFrame(P))],
  [B, 0x4762, gen(P => runLinkMatchFrame(P, runLinkMatchFrameMaster, runLinkMatchFrameSlave))],
  [B, 0x477D, gen(P => exchangeLinkReadySignal(P))],
  [B, 0x479F, gen(P => exchangeReadyTokenMaster(P))],
  [B, 0x47D8, gen(P => exchangeReadyTokenSlave(P))],
  [B, 0x4807, gen(P => runLinkInputFrameMaster(P))],
  [B, 0x481D, gen(P => runLinkInputFrameSlave(P))],
  [B, 0x4833, gen(P => runLinkInputFrame(P))],
  [B, 0x4846, gen(P => updateLinkSession(P))],
  [B, 0x496E, gen((P, c) => exchangeLinkDataBlock(P, c.hl, c.de, c.c))],
  [B, 0x49B0, (P, c) => (function* () { c.hl = yield* packNibblesToBytes(P, c.c, c.hl); })()],
  // link_handshake_07
  [B, 0x49E2, P => { primeSlaveSerialReply(P); }],
  [B, 0x49F7, P => { prepareLinkStatePayload(P); }],
  [B, 0x4A13, P => { prepareLinkInputPayload(P); }],
  [B, 0x4A29, (P, c) => { const r = awaitSerialByteBody(P, true); setRegs(c, { a: r.a, b: r.b, f: r.carry ? FLAG_C : 0 }); }],
  [B, 0x4A51, gen(P => resyncLinkSession(P))],
  [B, 0x4AA9, gen(P => resyncLinkSessionWithTimer(P))],
  [B, 0x4AFE, (P, c) => { const r = tryLinkHandshakeSlave(P); carryOut(c, r.carry, r.a); }],
  [B, 0x4B38, (P, c) => (function* () { const r = yield* tryLinkHandshakeMaster(P); carryOut(c, r.carry, r.a); })()],
  [B, 0x4BC2, P => { longDelayBody(P, true); }],
  [B, 0x4BF3, gen(P => runLinkCommandFrame(P))],
  [B, 0x4C02, gen(P => runLinkCommandFrameMaster(P))],
  [B, 0x4C13, gen(P => runLinkCommandFrameSlave(P))],
  [B, 0x4C24, (P, c) => (function* () { const a = yield* serialEncodeCommand(P); setRegs(c, { a, f: a ? 0 : FLAG_Z }); })()],
  [B, 0x4C69, P => { serialDecodeCommand(P); }],
  // placement_07
  [B, 0x4CE4, (P, c) => { c.a = decodeLinkCommandCode(c.a); }],
  [B, 0x4CFE, (P, c) => { c.a = composeLinkStateByte(P); }],
  // nibble_07
  [B, 0x4328, (P, c) => (function* () { c.hl = yield* exchangeChecksumMaster(P, c.de); })()],
  [B, 0x438C, (P, c) => (function* () { c.hl = yield* exchangeChecksumSlave(P, c.de); })()],
  [B, 0x43F6, (P, c) => { c.hl = shiftNibbleIntoChecksum(c.hl, c.b); c.a = c.l; }],
  [B, 0x440C, (P, c) => { computeNibbleBufferChecksum(P, c.c); }],
  [B, 0x452F, (P, c) => { const r = pollSerialResponse(P); carryOut(c, r.carry, r.a); }],
  [B, 0x454B, (P, c) => { const carry = sendByteAwaitEchoMaster(P, c.a, c.b); setRegs(c, { f: carry ? FLAG_C : 0 }); }],
  [B, 0x45C1, (P, c) => (function* () { c.a = yield* sendByteGetReplyMaster(P, c.a); })()],
  [B, 0x4624, (P, c) => (function* () { c.a = yield* sendByteGetReplySlave(P, c.a); })()],
];
export const HOOKS = LINK_HOOKS;

// A link cable between two emulated Game Boy Colors, each running in its own thread (a worker) and sharing one
// SharedArrayBuffer: for the tests that play link mode (web/tests/port/link_pair.mjs). Not used by the page.
//
// The two machines run in step: every SLICE dots (single-speed clocks: real time, whatever each CPU's speed) both
// stop at a barrier, at the end of the instruction that reached it, and wait for the other. At a barrier each side
// shows the other its serial registers (SB, SC) and whether a transfer it clocks (SC bit 0: internal clock) has
// finished; then both apply the exchange. A transfer takes 8 bits of its clock (CGB fast clock, SC bit 1: 16 dots a
// bit; else 512) from the write that started it, and finishes at the first barrier after that. The side that
// clocks it gets the peer's SB if the peer is waiting for a transfer on the external clock (SC bit 7 set, bit 0
// clear), else $FF (no one shifting out); the peer gets its SB in that case. Each finished side clears SC bit 7 and
// requests the serial interrupt. When one side's run ends, the other runs on alone (transfers then get $FF).
// Deterministic: the same programs and inputs give the same run.
export const SLICE = 64;
const BIT_FAST = 16, BIT_SLOW = 512;
// shared Int32 slots: 0 arrived, 1 generation, 2 a side ended; 4 + side * 4: SB, SC, finished
export const CABLE_WORDS = 16;

export class CableEnd {
  constructor(gb, shared, side) {
    this.gb = gb; this.mem = gb.mem; this.S = new Int32Array(shared); this.side = side;
    this.dots = 0; this.next = SLICE; this.doneAt = -1; this.alone = false;
    this.mem.cable = this;
    const sync = gb.sync.bind(gb);
    gb.sync = cycles => { sync(cycles); this.advance(this.mem.doubleSpeed ? cycles >> 1 : cycles); };
  }
  // SC written with a start on the internal clock
  start() { this.doneAt = this.dots + 8 * (this.mem.io[2] & 2 ? BIT_FAST : BIT_SLOW); }
  advance(dots) {
    this.dots += dots;
    while (this.dots >= this.next) { this.barrier(); this.next += SLICE; }
  }
  wait() {
    const S = this.S, g = Atomics.load(S, 1);
    if (Atomics.add(S, 0, 1) === 1) { Atomics.store(S, 0, 0); Atomics.add(S, 1, 1); Atomics.notify(S, 1); return true; }
    while (Atomics.load(S, 1) === g) {
      if (Atomics.load(S, 2)) return false;                    // the other side ended
      Atomics.wait(S, 1, g, 50);
    }
    return true;
  }
  barrier() {
    const S = this.S, m = this.mem, me = 4 + this.side * 4, peer = 4 + (1 - this.side) * 4;
    const finished = this.doneAt >= 0 && this.doneAt <= this.next;
    if (this.alone || Atomics.load(S, 2)) { this.alone = true; if (finished) this.finish(0xFF); return; }
    S[me] = m.io[1]; S[me + 1] = m.io[2]; S[me + 2] = finished ? 1 : 0;
    if (!this.wait()) { this.alone = true; if (finished) this.finish(0xFF); return; }
    const pSB = S[peer], pSC = S[peer + 1], pFinished = S[peer + 2], mySC = S[me + 1];
    const waiting = sc => (sc & 0x81) === 0x80;
    if (finished) this.finish(waiting(pSC) && !pFinished ? pSB : 0xFF);
    else if (pFinished && waiting(mySC)) this.finish(pSB);
    if (!this.wait()) this.alone = true;                       // (both have read before either goes on)
  }
  finish(byte) { const m = this.mem; m.io[1] = byte; m.io[2] &= 0x7F; m.requestInterrupt(8); this.doneAt = -1; }
  end() { Atomics.store(this.S, 2, 1); Atomics.notify(this.S, 1); }
}

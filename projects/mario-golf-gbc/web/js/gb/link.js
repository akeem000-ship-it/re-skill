// The link cable between two cores (tests only, like the rest of web/js/gb): connect(a, b) sets each machine's
// `link`. A transfer started on the internal clock (SC bits 7 and 0) ends 8 bit times later (gbc.js startSerial); at
// its end, when the partner waits on the external clock (its SC bits 7 set, 0 clear), the two serial registers are
// exchanged and both get the serial interrupt (their SC bit 7 cleared); when the partner does not wait (bit 7 clear,
// or its own clock), the clock side reads $FF (nothing drives the line) and only it is interrupted. The bits are
// exchanged at once at the end (no side reads SB in the middle of a transfer in this game). A halted side wakes
// at either side's transfer end (gbc.js cyclesToEvent), so the two stay in step to the instruction when run by a
// scheduler that always steps the side behind (web/tests/golf/linkcores.mjs).
// onTransfer(gb, sideGets, peerGets | null): every transfer's end (the recorder's log).
export class LinkCable {
  constructor(a, b) {
    this.ends = [a, b];
    a.link = this; b.link = this;
    this.onTransfer = null;
  }
  peer(gb) { return this.ends[0] === gb ? this.ends[1] : this.ends[0]; }
  wakeAt(gb) {                                   // the next transfer end that concerns gb (0: none)
    const p = this.peer(gb), t = [gb.serialDue, p.serialDue].filter(Boolean);
    return t.length ? Math.min(...t) : 0;
  }
  tick(gb) {
    if (gb.serialDue && gb.dots >= gb.serialDue) this.complete(gb);
  }
  complete(gb) {
    gb.serialDue = 0;
    const p = this.peer(gb), m = gb.mem, pm = p.mem;
    let peerGets = null;
    if ((pm.io[2] & 0x81) === 0x80) {
      peerGets = m.io[1];
      const v = pm.io[1]; pm.io[1] = m.io[1]; m.io[1] = v;
      pm.io[2] &= 0x7F; pm.requestInterrupt(8);
    } else m.io[1] = 0xFF;
    m.io[2] &= 0x7F; m.requestInterrupt(8);
    if (this.onTransfer) this.onTransfer(gb, m.io[1], peerGets);
  }
}

// One side of a recorded linked session replayed on a single core: `events` [[dots, byte], ...] (this side's serial
// register at the end of each transfer that reached it, at its own base-clock count): at that count the byte is in
// SB, SC bit 7 cleared and the serial interrupt raised, as in the two-core run; a transfer this side starts is left to
// the script (its end is one of the events).
export class ScriptCable {
  constructor(gb, events) {
    this.events = events; this.k = 0;
    gb.link = this;
    this.started = 0;
  }
  peer() { return { serialDue: 0 }; }
  wakeAt() { return this.k < this.events.length ? this.events[this.k][0] : 0; }
  tick(gb) {
    while (this.k < this.events.length && gb.dots >= this.events[this.k][0]) {
      const [, v] = this.events[this.k++];
      gb.mem.io[1] = v; gb.mem.io[2] &= 0x7F; gb.mem.requestInterrupt(8);
    }
  }
}

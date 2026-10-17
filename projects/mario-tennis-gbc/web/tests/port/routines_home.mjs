// Routine tests for web/js/port/home (run by web/tests/port_routines.mjs).
const pads = [0x00, 0x01, 0x0F, 0x10, 0xF0, 0x81, 0x22];
export const ROUTINES = [
  // the pad as recorded at the state, and other pads; the repeat timer forced to its edge cases
  { name: "ReadJoypad", bank: 0, addr: 0x02EB, out: ["a", "b", "c"] },
  ...pads.map((p, i) => ({
    name: `ReadJoypad pad ${p.toString(16)}`, bank: 0, addr: 0x02EB, out: ["a", "b", "c"],
    prep(mem, s) {
      mem.joypad.set({ a: !!(p & 1), b: !!(p & 2), select: !!(p & 4), start: !!(p & 8), right: !!(p & 16), left: !!(p & 32), up: !!(p & 64), down: !!(p & 128) });
      mem.hram[0x13] = [1, 2, 0x12, 1, 0, 1, 3][i];       // hInputRepeatTimer
      if (i & 1) mem.hram[0x12] = p;                        // hInputRepeatButtons = the held buttons
    },
  })),
  { name: "AdvanceRandomSeed", bank: 0, addr: 0x0A3A, out: ["h", "l"] },
];

// The game's entry points and interrupt handlers as a GamePort program, without the ported routines
// (program.js adds those as hooks).
export const entry = {
  // EntryPoint (00:0100): the boot, then InitAndRunGame — still the ROM's until the boot is ported
  *main(P) { P.cpu.pc = 0x0100; yield* P.continueCpu(); },
  // SoftReset (00:2582), reached from the VBlank handler on A+B+START+SELECT
  *softReset(P) { P.cpu.pc = 0x2582; yield* P.continueCpu(); },
  vblank: null,                // null: the handler at the vector, through the CPU (ported handlers are hooks)
  lcdStat: null,
  timer: null,
  serial: null,
};

// The game as a GamePort program: its entry points, interrupt handlers and the ported routines that replace ROM
// code (hooks). Every module of the port registers its routines here as [bank, addr, fn]; anything not listed
// still runs as the ROM's code (port.js, "Not yet ported code").
import { HOOKS as HOME } from "./home/index.js";
import { HOOKS as AUDIO } from "./audio/index.js";
import { HOOKS as TEXT } from "./text/index.js";
import { HOOKS as SAVE } from "./save/index.js";
import { HOOKS as CUTSCENES } from "./cutscenes/index.js";
import { HOOKS as MENUS } from "./menus/index.js";
import { HOOKS as STORY } from "./story/index.js";
import { HOOKS as MINIGAMES } from "./minigames/index.js";
import { HOOKS as MATCH } from "./match/index.js";

export const program = {
  // EntryPoint (00:0100): the boot, then InitAndRunGame — still the ROM's until the boot is ported
  *main(P) { P.cpu.pc = 0x0100; yield* P.continueCpu(); },
  // SoftReset (00:2582), reached from the VBlank handler on A+B+START+SELECT
  *softReset(P) { P.cpu.pc = 0x2582; yield* P.continueCpu(); },
  vblank: null,                // null: the ROM's handler, through the CPU
  lcdStat: null,
  timer: null,
  serial: null,
  hooks: [...HOME, ...AUDIO, ...TEXT, ...SAVE, ...CUTSCENES, ...MENUS, ...STORY, ...MINIGAMES, ...MATCH],
};

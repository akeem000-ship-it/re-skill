// save: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
// The battery save (bank 3, $404A-$5956), ported from the gerbiljames/mario-tennis-gbc-disasm (MIT): defs.js (the
// save format, SRAM access), saveheader.js (the header and block directory), signature.js (checksum, mirror,
// power-on check, block writes), storyslots.js (block reads, story saves, save flags), saveslots.js (erasing,
// exhibition image, minigame records), results.js (the star grid, the debug editor), repair.js (power-on repair,
// N64 records and unlockables, blocks 6-10).
import { HOOKS as SAVEHEADER } from "./saveheader.js";
import { HOOKS as SIGNATURE } from "./signature.js";
import { HOOKS as STORYSLOTS } from "./storyslots.js";
import { HOOKS as SAVESLOTS } from "./saveslots.js";
import { HOOKS as RESULTS } from "./results.js";
import { HOOKS as REPAIR } from "./repair.js";
export const HOOKS = [...SAVEHEADER, ...SIGNATURE, ...STORYSLOTS, ...SAVESLOTS, ...RESULTS, ...REPAIR];

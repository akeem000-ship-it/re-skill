// Bank 0 ("home"): the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js).
import { HOOKS as JOYPAD } from "./joypad.js";
import { HOOKS as MATH } from "./math.js";
import { HOOKS as SYSTEM } from "./system.js";
import { HOOKS as MEMORY } from "./memory.js";
import { HOOKS as PALETTES } from "./palettes.js";
import { HOOKS as DECOMPRESS } from "./decompress.js";
import { HOOKS as VIEW } from "./view.js";
import { HOOKS as COLORFADE } from "./colorfade.js";
import { HOOKS as FADE } from "./fade.js";
import { HOOKS as FLAGS } from "./flags.js";
import { HOOKS as DEBUGTEXT } from "./debugtext.js";
import { HOOKS as UI } from "./ui.js";
import { HOOKS as BGBLIT } from "./bgblit.js";
import { HOOKS as LINK } from "./link.js";
import { HOOKS as VBLANK } from "./vblank.js";
import { HOOKS as FRAME } from "./frame.js";
export const HOOKS = [...JOYPAD, ...MATH, ...SYSTEM, ...MEMORY, ...PALETTES, ...DECOMPRESS, ...VIEW, ...COLORFADE, ...FADE,
  ...FLAGS, ...DEBUGTEXT, ...UI, ...BGBLIT, ...LINK, ...VBLANK, ...FRAME];

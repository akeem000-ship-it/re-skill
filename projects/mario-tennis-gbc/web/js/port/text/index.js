// text: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
// The text and window engine, bank $05 (src/engine/text/*_05.asm of the gerbiljames/mario-tennis-gbc-disasm, MIT).
import { HOOKS as WINDOW_TILEMAP } from "./window_tilemap.js";
import { HOOKS as SHADOW } from "./shadow.js";
import { HOOKS as WINDOW_CREATE } from "./window_create.js";
import { HOOKS as PAGED } from "./paged.js";
import { HOOKS as CURSOR } from "./cursor.js";
import { HOOKS as ARG } from "./arg.js";
import { HOOKS as CONTROL } from "./control.js";
import { HOOKS as WINDOW_TEXT } from "./window_text.js";
import { HOOKS as DIALOGUE } from "./dialogue.js";
import { HOOKS as PROPORTIONAL } from "./proportional.js";
import { HOOKS as WINDOW_REDRAW } from "./window_redraw.js";
import { HOOKS as DEBUG_FLAGS } from "./debug_flags.js";
import { HOOKS as DEBUG_PALETTE } from "./debug_palette.js";
import { HOOKS as WINDOW_ALLOC } from "./window_alloc.js";
import { HOOKS as ROWS } from "./rows.js";
import { HOOKS as GLYPH_BUFFER } from "./glyph_buffer.js";
import { HOOKS as GLYPH_FONT } from "./glyph_font.js";
export const HOOKS = [
  ...WINDOW_TILEMAP, ...SHADOW, ...WINDOW_CREATE, ...PAGED, ...CURSOR, ...ARG, ...CONTROL, ...WINDOW_TEXT, ...DIALOGUE,
  ...PROPORTIONAL, ...WINDOW_REDRAW, ...DEBUG_FLAGS, ...DEBUG_PALETTE, ...WINDOW_ALLOC, ...ROWS, ...GLYPH_BUFFER, ...GLYPH_FONT,
];

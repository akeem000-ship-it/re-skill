// audio: the ported routines, by module. Each module exports HOOKS = [[bank, addr, fn(P, cpu)], ...]:
// ROM code reaching bank:addr runs fn instead (web/js/port/port.js). Add each module here.
// The sound driver (bank 0, $2F1A-$3FC7), ported from the gerbiljames/mario-tennis-gbc-disasm (MIT): defs.js (its
// model and state blocks), engine.js (the tick), script.js (the channel scripts), channel.js (notes, envelopes, APU
// registers), requests.js (sound requests: rst $08, PlaySound), bgm.js (music on/off helpers).
import { HOOKS as ENGINE } from "./engine.js";
import { HOOKS as REQUESTS } from "./requests.js";
import { HOOKS as BGM } from "./bgm.js";
export const HOOKS = [...ENGINE, ...REQUESTS, ...BGM];

// The on-court characters (bank $08: char_update_08, char_states_08, char_movement_08, char_input_08,
// shot_select_08 in the disassembly). One struct per WRAM bank 4-7 (E.C is the mapped one).

// 08:6A1C SetCharState: state, phase 0, AI phase 0, freeze timer 0, AI action timer 0
export function setCharState(E, state) {
  const C = E.C; C.state = state; C.statePhase = 0; C.aiPhase = 0; C.freezeTimer = 0; C.aiActionTimer = 0;
}
// 08:6A3A ForEachCharBank: fn in banks 7, 6, 5, 4; bank 4 stays mapped
export function forEachCharBank(E, fn) { for (const k of [3, 2, 1, 0]) { E.setBank(4 + k); fn(); } }

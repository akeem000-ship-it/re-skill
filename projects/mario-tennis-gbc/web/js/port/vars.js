// Named access to the game's RAM for the port: A.name is a variable's address, V.name its value (1-byte fields as
// u8, 2-byte fields as u16 little-endian; bigger ones are buffers: use A.name with the bus). Variables in a
// switchable WRAM bank are read and written in that bank whatever is mapped. Names come from fields.js
// (the disassembly's symbols without the w/h prefix: wCurMapID -> curMapID, hWramBank -> wramBank).
import { RAM_FIELDS } from "./fields.js";

export function makeVars(bus) {
  const A = {}, V = {}, B = {};
  for (const [name, bank, addr, size] of RAM_FIELDS) {
    A[name] = addr; B[name] = bank;
    const banked = bank !== 0 && addr >= 0xD000 && addr < 0xE000;
    const rd = size === 2 ? () => bus.u16(addr) : () => bus.u8(addr);
    const wr = size === 2 ? v => bus.w16(addr, v) : v => bus.w8(addr, v);
    Object.defineProperty(V, name, banked
      ? { get: () => bus.withBank(bank, rd), set: v => bus.withBank(bank, () => wr(v)), enumerable: true }
      : { get: rd, set: wr, enumerable: true });
  }
  return { A, V, B };
}

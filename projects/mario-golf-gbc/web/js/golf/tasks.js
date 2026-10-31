// The frame task table wFrameTasks $C1C0: 16 entries of (flags, address, bank), run by RunFrameTasks 00:247D after
// each AdvanceFrame (flags 1-$7F) and in VBlank (flags $81-$FF), in table order; the table is kept sorted by the
// flags byte, highest first (SortFrameTasks 00:24BD, a bubble sort that also swaps equal entries, so tasks of one
// priority change places at each registration). $FF8F = 0 stops them.
// The engine runs a task by its ROM address: run(w, dispatch) calls dispatch["bank:addr"] for each due entry, reading
// the table as it goes (a task may register or remove tasks while they run, as on the Game Boy).
const T = 0x1C0;
const key = (bank, addr) => `${bank.toString(16).padStart(2, "0")}:${addr.toString(16).padStart(4, "0")}`;

export function clearFrameTasks(w) {             // 00:23B6 ClearFrameTasks
  w.high[0x18F] = 0;
  w.wram[0].fill(0, T, T + 0x40);
  w.high[0x18F] = 1;
}

function sortFrameTasks(w) {                     // 00:24BD SortFrameTasks
  const t = w.wram[0];
  for (let c = 0x0F; c; c--) {
    let hl = T;
    for (let b = c; b; b--) {
      const de = hl + 4;
      if (t[de] >= t[hl]) {                      // jr c: kept only when the next one is lower
        for (let k = 0; k < 4; k++) { const v = t[hl + k]; t[hl + k] = t[de + k]; t[de + k] = v; }
      }
      hl += 4;
    }
  }
}

export function registerFrameTask(w, flags, bank, addr) {   // 00:23E8 RegisterFrameTask (hROMBank: the task's bank)
  const t = w.wram[0];
  w.high[0x18F] = 0;
  let found = false;
  for (let p = T + 1, c = 0x10; c; c--, p += 4)
    if (t[p] === (addr & 0xFF) && t[p + 1] === addr >> 8 && t[p + 2] === bank) { found = true; break; }
  if (!found) {
    for (let p = T, c = 0x16; c; c--, p += 4) {  // (22 slots scanned: past the table's end when it is full)
      if (!(t[p + 1] | t[p + 2] | t[p + 3])) { t[p] = flags; t[p + 1] = addr & 0xFF; t[p + 2] = addr >> 8; t[p + 3] = bank; break; }
    }
  }
  sortFrameTasks(w);
  w.high[0x18F] = 1;
}

export function unregisterFrameTask(w, bank, addr) {   // 00:2449 UnregisterFrameTask
  const t = w.wram[0];
  w.high[0x18F] = 0;
  for (let p = T + 1, c = 0x10; c; c--, p += 4) {
    if (t[p] === (addr & 0xFF) && t[p + 1] === addr >> 8 && t[p + 2] === bank) { t[p - 1] = t[p] = t[p + 1] = t[p + 2] = 0; break; }
  }
  w.high[0x18F] = 1;
}

export function isRegistered(w, bank, addr) {
  const t = w.wram[0];
  for (let p = T; p < T + 0x40; p += 4)
    if (t[p] && (t[p + 1] | t[p + 2] << 8) === addr && t[p + 3] === bank) return true;
  return false;
}

// 00:247D RunFrameTasks: vblank = false after AdvanceFrame (flags 1-$7F), true in VBlank (flags $81-$FF)
export function runFrameTasks(w, vblank, dispatch) {
  if (!w.high[0x18F]) return;
  const t = w.wram[0], b = vblank ? 0x80 : 0;
  const romBank = w.high[0x195], wramBank = w.high[0x196];
  for (let p = T; p < T + 0x40; p += 4) {
    const a = (t[p] ^ b) & 0xFF;
    if (!(a & 0x7F) || (a & 0x80)) continue;
    const k = key(t[p + 3], t[p + 1] | t[p + 2] << 8);
    const fn = dispatch[k];
    if (!fn) throw new Error(`frame task ${k} is not ported`);
    w.high[0x195] = t[p + 3];
    fn();
  }
  w.high[0x195] = romBank; w.high[0x196] = wramBank;
}

// on / off flags over the table for the engine's code: {name: [flags, bank, addr]}; setting one registers or
// removes that task
export function taskFacade(w, tasks) {
  const o = {};
  for (const [k, [f, b, a]] of Object.entries(tasks))
    Object.defineProperty(o, k, { enumerable: true, get: () => isRegistered(w, b, a),
      set: v => (v ? registerFrameTask(w, f, b, a) : unregisterFrameTask(w, b, a)) });
  return o;
}

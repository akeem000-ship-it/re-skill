// Which of the ROM's routines the whole-game port has not replaced, by reading the disassembly rather than playing
// recordings (web/tests/port_rom_trace.mjs is the other way round): every global label of the vendored disassembly
// (third_party/mario-tennis-gbc-disasm/src) that starts code (its first statement an SM83 instruction or a code
// macro, not data or a script's bytecode), with its address from build/mariotennis.sym, checked against the hooks
// of program.js. A routine counts as covered when it is hooked, or when the code before it falls through into it
// and that one is covered (a tail inside a ported routine), or when only covered code or data refers to it (see
// below), or when it is an Unused_* routine (no caller).
// usage: node web/tests/port_static_coverage.mjs [--all] [--file substring]
//   prints the uncovered routines by source file (--all: the covered ones too)
import fs from "fs";
import path from "path";
import { program } from "../js/port/program.js";
import { hookKey } from "../js/port/port.js";

const a = process.argv.slice(2), opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
const ROOT = "third_party/mario-tennis-gbc-disasm", only = opt("--file", "");
const sym = new Map();
for (const l of fs.readFileSync(`${ROOT}/build/mariotennis.sym`, "utf8").split("\n")) {
  const m = /^([0-9a-f]{2}):([0-9a-f]{4}) (\S+)/i.exec(l);
  if (m) sym.set(m[3], [parseInt(m[1], 16), parseInt(m[2], 16)]);
}
const hooked = new Set(program.hooks.map(([b, ad]) => hookKey(b, ad)));
const SM83 = new Set("ld ldh ldi ldd push pop add adc sub sbc and or xor cp inc dec daa cpl ccf scf nop halt stop di ei rlca rla rrca rra rlc rl rrc rr sla sra swap srl bit set res jp jr call ret reti rst".split(" "));
const CODE_MACROS = new Set(["farcall", "wram_bank", "sound", "test_flag", "set_flag", "clear_flag", "push_wram_bank", "pop_wram_bank", "ld_hl_indexed", "twin", "jumptable"]);
const files = [];
const walk = d => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (f.endsWith(".asm")) files.push(p); } };
walk(`${ROOT}/src`);
const rows = [];                                   // {file, name, bank, addr, covered, why}
for (const f of files.sort()) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  let prevCovered = false, prevFalls = false;      // the routine before: covered, and its last statement falls through
  for (let i = 0; i < lines.length; i++) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(lines[i]);
    if (!m) continue;
    let j = i + 1, first = null;
    for (; j < lines.length; j++) {
      const t = lines[j].replace(/;.*/, "").trim();
      if (!t) continue;
      if (/^\.[A-Za-z0-9_]+:/.test(t)) continue;   // a local label first: look on
      first = t.split(/[\s,]+/)[0].toLowerCase(); break;
    }
    const isCode = first && (SM83.has(first) || CODE_MACROS.has(first));
    if (!isCode) { prevCovered = false; prevFalls = false; continue; }
    const s = sym.get(m[1]); if (!s) continue;
    const [bank, addr] = s; if (addr >= 0x8000) continue;
    const k = hookKey(bank, addr);
    let why = hooked.has(k) ? "hooked" : prevCovered && prevFalls ? "tail" : m[1].startsWith("Unused") ? "unused" : "";
    rows.push({ file: path.relative(`${ROOT}/src`, f), name: m[1], bank, addr, covered: !!why, why });
    prevCovered = !!why;
    // does this routine's last statement fall into the next label? (not after jp / jr / ret / reti without a condition)
    let last = "";
    for (let q = i + 1; q < lines.length && !/^[A-Za-z_][A-Za-z0-9_]*:/.test(lines[q]); q++) { const t = lines[q].replace(/;.*/, "").trim(); if (t && !/^\.[A-Za-z0-9_]+:/.test(t)) last = t.toLowerCase(); }
    prevFalls = !(/^(jp|jr)\s+[^,]+$/.test(last) || last === "ret" || last === "reti" || /^jp\s+hl$/.test(last));
  }
}
// A routine no ROM code can reach any more: every place that names it (a call, a jump, a table entry) lies in a
// covered routine or in data. The covered code that holds those places is ported, and its port does what the
// reference did (the jump-table cases a ported dispatcher runs, the inner steps of a routine ported whole). Repeated
// until nothing changes (a chain of such routines).
const byName = new Map(rows.map(r => [r.name, r]));
const refs = new Map();                            // name -> [the global label holding each reference, or "data"]
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n");
  let owner = null, ownerIsCode = false;
  for (const l of lines) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):/.exec(l);
    if (m) { owner = m[1]; ownerIsCode = byName.has(owner); continue; }
    const t = l.replace(/;.*/, "");
    for (const w of t.match(/[A-Za-z_][A-Za-z0-9_]*/g) || []) {
      if (!byName.has(w) || w === owner) continue;
      if (!refs.has(w)) refs.set(w, []);
      refs.get(w).push(ownerIsCode ? owner : "data");
    }
  }
}
for (let changed = true; changed;) {
  changed = false;
  for (const r of rows) {
    if (r.covered) continue;
    const at = refs.get(r.name) || [];
    if (at.length && at.every(o => o === "data" || byName.get(o).covered)) { r.covered = true; r.why = "inside ported code"; changed = true; }
  }
}
const sel = rows.filter(r => !only || r.file.includes(only));
const miss = sel.filter(r => !r.covered);
const byFile = new Map();
for (const r of a.includes("--all") ? sel : miss) { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); }
for (const [f, rs] of [...byFile].sort()) {
  console.log(`${f}: ${rs.length}`);
  for (const r of rs) console.log(`  ${r.bank.toString(16).padStart(2, "0")}:${r.addr.toString(16).padStart(4, "0")} ${r.name}${r.why ? " (" + r.why + ")" : ""}`);
}
const n = w => sel.filter(r => r.why === w).length;
console.log(`\n${sel.length} code routines: ${n("hooked")} hooked, ${n("tail")} tails of covered code, ${n("inside ported code")} reached only from ported code, ${n("unused")} unused; ${miss.length} not covered in ${new Set(miss.map(r => r.file)).size} files`);

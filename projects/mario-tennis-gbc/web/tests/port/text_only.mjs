// Run a port test harness with only some areas' hooks (the others' code runs as the ROM's), to check the text
// engine's port (web/js/port/text) on its own while other areas are being ported.
// usage: node web/tests/port/text_only.mjs [--areas text,home] [--cov] web/tests/port_lockstep.mjs [its arguments...]
//        node web/tests/port/text_only.mjs web/tests/port_routines.mjs Fetch --rec out/port/story1.mtrec
// --cov: count the calls of each kept hook and print them at the end (which routines a recording exercises)
import path from "path"; import { pathToFileURL } from "url";
import { program } from "../../js/port/program.js";

const argv = process.argv;
let areas = ["text", "home"];
if (argv[2] === "--areas") { areas = argv[3].split(",").filter(Boolean); argv.splice(2, 2); }
let cov = null;
if (argv[2] === "--cov") { cov = new Map(); argv.splice(2, 1); }
const keep = new Set();
for (const area of areas) for (const h of (await import(`../../js/port/${area}/index.js`)).HOOKS) keep.add(h[2]);
program.hooks = program.hooks.filter(h => keep.has(h[2]));
if (cov) {
  const sym = new Map();
  try { for (const l of (await import("fs")).readFileSync("third_party/mario-tennis-gbc-disasm/build/mariotennis.sym", "utf8").split("\n")) { const [ba, n] = l.split(" "); if (n && !n.includes(".")) sym.set(ba, n); } } catch (e) { /* no build */ }
  program.hooks = program.hooks.map(([bank, addr, fn]) => {
    const key = `${(addr < 0x4000 ? 0 : bank).toString(16).padStart(2, "0")}:${addr.toString(16).padStart(4, "0")}`;
    cov.set(key, 0);
    return [bank, addr, (P, cpu) => { cov.set(key, cov.get(key) + 1); return fn(P, cpu); }];
  });
  process.on("exit", () => {
    const hit = [...cov].filter(([, n]) => n), miss = [...cov].filter(([, n]) => !n);
    console.log(`hooks called: ${hit.length}/${cov.size}`);
    console.log(hit.map(([k, n]) => `${k} ${sym.get(k) || ""} ${n}`).join("\n"));
    console.log("not called: " + miss.map(([k]) => sym.get(k) || k).join(" "));
  });
}
const script = argv.splice(2, 1)[0];
await import(pathToFileURL(path.resolve(script)).href);

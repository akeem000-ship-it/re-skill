// The portrait kit and the look generator: every hairstyle x face part draws at the three sizes, and a look built from the
// user's ROM only touches what it should (same-size head rewrites, region planes for the LZ portraits; the LZ streams stay).
// usage: node web/tests/look_faces.mjs   (needs rom/mario_tennis.gbc)
import fs from "fs";
import { drawFace, FACE, STYLE_NAMES, normalizeFace } from "../js/look/portrait.js";
import { LookManager, PRESETS, SWATCHES, normalizeLook } from "../js/look/index.js";
import { STYLES } from "../js/look/label.js";

let bad = 0; const check = (ok, what) => { if (!ok) { bad++; console.log("FAIL", what); } };
// 1. the kit draws every combination at every size
const colours = { skin: SWATCHES.skin[5], hair: SWATCHES.hair[2], hat: SWATCHES.cloth[2], top: SWATCHES.cloth[7] };
let n = 0;
for (const hero of ["boy", "girl"]) for (const style of STYLE_NAMES) for (const shape of FACE.shapes) for (const eyes of FACE.eyes) for (const mouth of FACE.mouths) for (const size of [24, 32, 16]) for (const mood of ["neutral", "win", "lose"]) {
  const im = drawFace({ hero, style, size, mood, face: { shape, eyes, brows: "arched", mouth, extras: ["freckles", "glasses", "blush"] }, colours });
  n++;
  check(im.w === size && im.h === size && im.px.length === size * size, `size ${hero} ${style} ${size}`);
  const cover = im.px.filter(c => c >= 0).length;
  check(size === 16 ? cover > 60 : cover === size * size, `coverage ${hero} ${style} ${size} ${cover}`);
}
console.log("drawn", n);
for (const hero of ["alex", "nina"]) for (const s of STYLES[hero]) check(STYLE_NAMES.includes(s), `portrait style for ${hero} ${s}`);
check(JSON.stringify(normalizeFace({ eyes: "nope", extras: ["glasses", "x"] }, "girl")) === JSON.stringify({ shape: "oval", eyes: "bright", brows: "arched", mouth: "smile", extras: ["glasses"] }), "normalizeFace");
// 2. a look built from the ROM
const romf = new URL("../../rom/mario_tennis.gbc", import.meta.url);
if (fs.existsSync(romf)) {
  const pristine = new Uint8Array(fs.readFileSync(romf));
  const none = new LookManager().prepare(Uint8Array.from(pristine), null);
  check(!none.built && none.undo.length === 0, "no look: nothing built");
  for (const [hero, list] of Object.entries(PRESETS)) for (const p of list) {
    const rom = Uint8Array.from(pristine), mgr = new LookManager().prepare(rom, { [hero]: p.look });
    if (!p.look) { check(rom.every((v, i) => v === pristine[i]), "classic preset leaves the ROM alone"); continue; }
    let changed = 0; for (let i = 0; i < rom.length; i++) if (rom[i] !== pristine[i]) changed++;
    check(mgr.notes.length === 0 && (changed > 0 || p.look.style === (hero === "boy" ? "cap" : "pigtails")), `preset ${hero} ${p.name}: ${mgr.notes}`);   // (the default hairstyle changes no bytes: its colours are render-time)
    check(mgr.built.poolTop === undefined, `default portraits use no colour pool ${hero} ${p.name}`);
    mgr.set(null); check(rom.every((v, i) => v === pristine[i]), `restore ${hero} ${p.name}`);
    const rom2 = Uint8Array.from(pristine), red = new LookManager().prepare(rom2, { [hero]: p.look, portraits: "redrawn" });      // Portraits: Redrawn
    let ch2 = 0; for (let i = 0; i < rom2.length; i++) if (rom2[i] !== pristine[i]) ch2++;
    check(ch2 > 0, `redrawn ${hero} ${p.name} rewrites the heads`);
    check(red.built.poolTop >= 100, `colour pool ${hero} ${p.name} ${red.built.poolTop}`);
    red.set(null); check(rom2.every((v, i) => v === pristine[i]), `restore redrawn ${hero} ${p.name}`);
  }
  // both heroes, every style: the head sprites and frames rewrite in place (same length), the rest of the ROM is untouched
  for (const style of STYLES.alex) {
    const rom = Uint8Array.from(pristine), mgr = new LookManager().prepare(rom, { boy: { style, colours }, girl: { style, colours } });
    for (const p of mgr.undo) check(p.bytes.length > 0, "patch size");
    const lo = Math.min(...mgr.undo.map(p => p.off)), hi = Math.max(...mgr.undo.map(p => p.off + p.bytes.length));
    check(hi - lo < 0x200000, "patch span");
    check(normalizeLook({ boy: { style, colours, face: { eyes: "sharp" } } }).boy.face.eyes === "sharp", "face kept in the look");
  }
  // 3. portraits: by default the game's own (recoloured through region planes, the heads rewritten in place); "redrawn" brings the kit's faces
  {
    const look = { boy: { style: "cap", colours, face: { eyes: "sharp" } } };
    const g = new LookManager().prepare(Uint8Array.from(pristine), look), r = new LookManager().prepare(Uint8Array.from(pristine), { ...look, portraits: "redrawn" });
    check(!g.built.faces && !g.built.faceTiles, "default portraits: no redrawn faces");
    check(r.built.faces && r.built.faces.boy && r.built.faceTiles.size > 0, "Portraits: Redrawn builds the kit's faces");
    check(g.built.contentRegions.size > 40, `default portraits: the game's portrait tiles are recoloured (${g.built.contentRegions.size} tiles)`);
    check(g.undo.some(p => p.bytes.length === 64) && r.undo.some(p => p.bytes.length === 64), "HUD heads rewritten in place in both modes");
    check(normalizeLook({ ...look, portraits: "redrawn" }).portraits === "redrawn" && !normalizeLook({ ...look, portraits: "x" }).portraits, "portraits setting kept in the look");
  }
} else console.log("no ROM: part 2 skipped");
console.log(bad ? `${bad} failures` : "ok");
process.exit(bad ? 1 : 0);

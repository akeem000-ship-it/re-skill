// The portrait kit and the look generator: every hairstyle x face part draws at the three sizes, and a look built from the
// user's ROM only touches what it should (same-size head rewrites, region planes for the LZ portraits; the LZ streams stay).
// usage: node web/tests/look_faces.mjs   (needs rom/mario_tennis.gbc)
import fs from "fs";
import { drawFace, FACE, STYLE_NAMES, normalizeFace } from "../js/look/portrait.js";
import { LookManager, PRESETS, SWATCHES, normalizeLook } from "../js/look/index.js";
import { STYLES, labelPortrait, labelSprite, REG } from "../js/look/label.js";
import { ART, FRAMES, hasHairArt, applyHairArt, applyFaceTemplate } from "../js/look/hairart.js";
import { HEROES, off } from "../js/look/build.js";
import { lzDecompress } from "../js/look/lz.js";
import { decodeRowMajor, decodeColMajor } from "../js/look/gfx.js";

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
  // 4. the hand-pixelled portraits (hairart.js): every style but the hero's own has art for all four frames; the art draws over the
  //    game's face (the eyes' rows are the game's pixels), the LZ streams are never rewritten, each frame's plane is its own
  for (const [name, hero] of [["alex", "boy"], ["nina", "girl"]]) {
    const own = name === "alex" ? "cap" : "pigtails", H = HEROES[name];
    for (const style of STYLES[name]) for (const fr of FRAMES) check(hasHairArt(name, style, fr) === (style !== own), `hair art ${name} ${style} ${fr}`);
    for (const style of Object.keys(ART[name])) {
      for (const fr of FRAMES) {                                                       // the art applies without an unknown letter, and changes the hair rows only
        let st, plain;
        if (fr === "head") { const im = decodeColMajor(pristine, off(0x18, H.heads[0]), 2, 2); st = labelSprite(im, name, "head"); plain = labelSprite(im, name, "head"); }
        else { const [b, a] = fr === "portrait" ? H.portraits[0] : H.winlose[fr === "win" ? 0 : 1], cols = fr === "portrait" ? 3 : 4, im = decodeRowMajor(lzDecompress(pristine, off(b, a)).data, 0, cols, cols); st = labelPortrait(im, name); plain = labelPortrait(im, name); }
        check(applyHairArt(st, name, style, fr), `applies ${name} ${style} ${fr}`);
        let hair = 0, kept = 0; for (let i = 0; i < st.reg.length; i++) { if (st.reg[i] === REG.HAIR || st.reg[i] === REG.HAIR2 || st.reg[i] === REG.HAIR3 || st.reg[i] === REG.HAT) hair++; }
        check(hair > (fr === "head" ? 20 : 40), `hair drawn ${name} ${style} ${fr} (${hair})`);
        const y0 = fr === "head" ? 9 : fr === "portrait" ? 15 : 19, y1 = fr === "head" ? 13 : fr === "portrait" ? 19 : 22, w = st.w;    // the eyes and mouth rows: the game's pixels, centre columns
        for (let y = y0; y <= y1; y++) for (let x = (w * 0.38) | 0; x < ((w * 0.62) | 0); x++) if (st.idx[y * w + x] === plain.idx[y * w + x]) kept++;
        check(kept === (y1 - y0 + 1) * (((w * 0.62) | 0) - ((w * 0.38) | 0)), `face kept ${name} ${style} ${fr} (${kept})`);
      }
      const look = { [hero]: { style, colours } }, mgr = new LookManager().prepare(Uint8Array.from(pristine), look);
      check(mgr.notes.length === 0 && mgr.built.poolTop === undefined, `builds ${name} ${style}`);
      for (const p of mgr.undo) check(p.off < off(0x16, 0x4000) || p.off >= off(0x19, 0x4000) || (p.off >= off(0x18, 0x4000) && p.bytes.length === 64), `only heads rewritten in bank 16-18 ${name} ${style} ${p.off.toString(16)}`);
      const game = new LookManager().prepare(Uint8Array.from(pristine), { [hero]: { style: own, colours } });
      let differ = 0; for (const [h, list] of mgr.built.contentRegions) { const o = game.built.contentRegions.get(h); if (!o) { differ++; continue; } for (const e of list) { const g = o.find(x => x.bytes.every((v, i) => v === e.bytes[i])); if (!g || g.plane.some((v, i) => v !== e.plane[i])) differ++; } }
      check(differ >= 20, `portrait planes restyled ${name} ${style} (${differ})`);
    }
  }
  for (const name of ["alex", "nina"]) for (const fr of FRAMES) {                   // the bald templates: no letter outside the legend
    const H = HEROES[name]; let st;
    if (fr === "head") st = labelSprite(decodeColMajor(pristine, off(0x18, H.heads[1]), 2, 2), name, "head");
    else { const [b, a] = fr === "portrait" ? H.portraits[1] : H.winlose[fr === "win" ? 0 : 1], cols = fr === "portrait" ? 3 : 4; st = labelPortrait(decodeRowMajor(lzDecompress(pristine, off(b, a)).data, 0, cols, cols), name); }
    check(applyFaceTemplate(st, name, fr) === st, `template ${name} ${fr}`);
  }
} else console.log("no ROM: part 2 skipped");
console.log(bad ? `${bad} failures` : "ok");
process.exit(bad ? 1 : 0);

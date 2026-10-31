// The native sound driver (web/js/sound/driver.js) against the game's own sound code on the CPU core
// (web/tests/sound_ref.mjs): the sound-register writes (FF10-FF3F, values and order) must be identical at
// SoundInit, at every command and in every frame.
// Cases: every song alone; every effect id alone and over a song (the ball height for effect command $Ex varies by
// frame); every jingle over a song; and random command sequences (songs, jingles, effects, at random frames).
// usage: node web/tests/sound_vs_core.mjs [--frames N] [--random N] [--only songs|sfx|sfxsong|jingles|random]
import { SoundDriver, soundIds } from "../js/sound/driver.js";
import { RomSound, loadRom, fmtWrites } from "./sound_ref.mjs";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const FRAMES = +opt("--frames", 3600), RANDOM = +opt("--random", 40), ONLY = opt("--only", "");
const rom = loadRom();
const { songs, effects } = soundIds(rom);

class Mismatch extends Error {}
function same(where, js, ref) {
  const n = Math.max(js.length, ref.length);
  for (let i = 0; i < n; i++) {
    const a = js[i], b = ref[i];
    if (!a || !b || a[0] !== b[0] || a[1] !== b[1])
      throw new Mismatch(`${where}: write #${i} differs: js ${a ? fmtWrites([a]) : "(none)"}, game ${b ? fmtWrites([b]) : "(none)"}\n` +
        `    js:   ${fmtWrites(js)}\n    game: ${fmtWrites(ref)}`);
  }
}

// run one case: script = Map frame -> list of ops ({sound}, {song}); the ball height follows heightAt(frame)
function runCase(script, frames, { heightAt = null, stopWhenQuiet = false } = {}) {
  const js = new SoundDriver(rom), ref = new RomSound(rom);
  same("init", js.init(), ref.init());
  let quiet = 0;
  for (let f = 0; f < frames; f++) {
    for (const op of script.get(f) || []) {
      if (op.sound !== undefined) same(`frame ${f} command $${op.sound.toString(16)}`, js.playSound(op.sound), ref.playSound(op.sound));
      else same(`frame ${f} song ${op.song}`, js.playSong(op.song), ref.playSong(op.song));
    }
    if (heightAt) { const h = heightAt(f); js.setBallHeight(h); ref.setBallHeight(h); }
    same(`frame ${f}`, js.frame(), ref.frame());
    if (stopWhenQuiet) {
      quiet = js.sfxPlaying || ref.ram(0xC4CC) ? 0 : quiet + 1;
      if (quiet > 8 && f > script.size) return f + 1;
    }
  }
  return frames;
}

const results = { pass: 0, fail: 0, failures: [] };
function test(name, fn) {
  try { const n = fn(); results.pass++; return n; }
  catch (e) {
    results.fail++;
    const msg = e instanceof Mismatch ? e.message : `error: ${e.message}`;
    results.failures.push(`${name}: ${msg}`);
    console.log(`FAIL ${name}: ${msg}`);
  }
}
const h2 = v => v.toString(16).padStart(2, "0");
const ballHeight = f => (f * 7) % 0x200;

if (!ONLY || ONLY === "songs") {
  let ok = 0;
  for (let s = 0; s < songs; s++) if (test(`song $${h2(s)}`, () => runCase(new Map([[0, [{ sound: s }]]]), FRAMES))) ok++;
  console.log(`songs: ${ok}/${songs} identical for ${FRAMES} frames`);
}
if (!ONLY || ONLY === "sfx") {
  let ok = 0;
  for (const e of effects)
    if (test(`effect $${h2(e)} (command $${h2(0x40 + e)})`, () =>
      runCase(new Map([[0, [{ sound: 0x40 + e }]]]), 1800, { heightAt: ballHeight, stopWhenQuiet: true }))) ok++;
  console.log(`effects alone: ${ok}/${effects.length} identical until they end`);
}
if (!ONLY || ONLY === "sfxsong") {
  let ok = 0;
  for (const e of effects) {
    const song = 1 + (e % (songs - 1));
    if (test(`effect $${h2(e)} over song $${h2(song)}`, () =>
      runCase(new Map([[0, [{ sound: song }]], [45, [{ sound: 0x40 + e }]]]), 600, { heightAt: ballHeight }))) ok++;
  }
  console.log(`effects over a song: ${ok}/${effects.length} identical for 600 frames`);
}
if (!ONLY || ONLY === "jingles") {
  let ok = 0;
  for (let j = 0x36; j <= 0x3A; j++)
    if (test(`jingle $${h2(j)} over song $02`, () => runCase(new Map([[0, [{ sound: 2 }]], [30, [{ sound: j }]]]), 1500))) ok++;
  console.log(`jingles: ${ok}/5 identical for 1500 frames`);
}
if (!ONLY || ONLY === "random") {
  let ok = 0;
  for (let seed = 1; seed <= RANDOM; seed++) {
    let x = seed * 2654435761 >>> 0;
    const rnd = n => { x ^= x << 13; x >>>= 0; x ^= x >> 17; x ^= x << 5; x >>>= 0; return x % n; };
    const script = new Map();
    for (let f = 0; f < 2400; f++) {
      const k = rnd(1000);
      let op = null;
      if (k < 3) op = { sound: rnd(songs) };
      else if (k < 4) op = { sound: 0x36 + rnd(5) };
      else if (k < 30) op = { sound: 0x40 + effects[rnd(effects.length)] };
      else if (k < 31) op = { song: rnd(0x30) };
      else if (k < 32) op = { sound: rnd(0x100) };
      if (op) script.set(f, [op]);
    }
    if (test(`random sequence ${seed}`, () => runCase(script, 2400, { heightAt: ballHeight }))) ok++;
  }
  console.log(`random sequences: ${ok}/${RANDOM} identical for 2400 frames`);
}
console.log(`${results.pass} passed, ${results.fail} failed`);
process.exit(results.fail ? 1 : 0);

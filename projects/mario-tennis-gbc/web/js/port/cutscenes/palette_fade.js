// The palette fade of the story's ending scenes (bank $03): the screen's palettes drained to grey (or, unused, to
// black) a step of every color component at a time, for the palettes picked by a mask.
// Port of src/engine/cutscenes/palettefade_03.asm of the gerbiljames/mario-tennis-gbc-disasm (MIT,
// third_party/mario-tennis-gbc-disasm): names and addresses are its own.
//
// Use (credits_0a.asm, scene_assets_18.asm): InitGrayscalePaletteFade (the live and target copies of the 16
// palettes from wMasterPalettes, the targets made grey); SetupPaletteFadeMask b, c, d (the palettes to fade: bits of
// b for palettes 0-7, of c for 8-15; d steps, d / 31 frames apart); AnimatePaletteFadeToTarget (each step moves every
// component of the masked palettes' live colors one unit toward the target and loads them; at the end the targets
// are copied in whole). Buffers in WRAM 6: wPaletteFadeTarget, wPaletteFadeLive (16 palettes of 4 colors each),
// wPaletteFadeMask (16 bytes), wPaletteColorSplit (live r g b, target r g b).
// Reached only from the story's ending, which no recording reaches: covered by the routine tests
// (web/tests/port/routines_cutscenes.mjs); AnimatePaletteFadeToTarget waits and is checked there in pieces.
import { splitColorComponents, combineColorComponents } from "../home/colorfade.js";
import { WRAM_SCENE, HOME, callHome, loadPalettesImmediate, advanceFrame, pushWramBank, popWramBank, hook, FZ, FN, FH, FC, cpFlags, andFlags } from "./common.js";

const BANK = 0x03;
const wMasterPalettes = 0xC200, wPaletteFadeTarget = 0xD0A0, wPaletteFadeLive = 0xD140, wPaletteFadeMask = 0xD1E0;
const wPaletteFadeAmount = 0xD1F0, wPaletteFadeIndex = 0xD1F1, wPaletteColorSplit = 0xD1F2, wPaletteFadeFrameDelay = 0xD1F9;
const PALETTES = 16, COLORS = 64, PALETTE_SIZE = 8, PALETTES_SIZE = 0x80;
const MAX_COMPONENT = 0x1F;

// InitGrayscalePaletteFade (03:75AB) / Unused_03_InitBlackPaletteFade (03:75CA): no palette masked, the live and
// target copies from wMasterPalettes, the targets made grey (or black). Leaves a = the WRAM bank restored and the
// entry flags, b = 0, de = wPaletteColorSplit (black: 0), hl past the targets.
function initPaletteFade(P, toBlack) {
  pushWramBank(P, WRAM_SCENE);
  for (let i = 0; i < PALETTES; i++) P.bus.w8(wPaletteFadeMask + i, 0);
  copyMasterPalettesToFadeBuffers(P);
  const r = toBlack ? clearFadeTargetPalettes(P) : desaturateFadeTargetPalettes(P);
  const af = popWramBank(P);
  return { ...r, a: af >> 8, f: af & 0xF0 };
}
export const initGrayscalePaletteFade = P => initPaletteFade(P, false);
export const initBlackPaletteFade = P => initPaletteFade(P, true);
// CopyMasterPalettesToFadeBuffers (03:75E9): wMasterPalettes into the live copy, then into the target copy
export function copyMasterPalettesToFadeBuffers(P, f = 0) {
  const { bus } = P;
  for (const dest of [wPaletteFadeLive, wPaletteFadeTarget]) for (let i = 0; i < PALETTES_SIZE; i++) bus.w8(dest + i, bus.u8(wMasterPalettes + i));
  return { a: bus.u8(wMasterPalettes + PALETTES_SIZE - 1), b: 0, de: wPaletteFadeTarget + PALETTES_SIZE, hl: wMasterPalettes + PALETTES_SIZE, f: FZ | FN | (f & FC) };
}
// Unused_03_ClearFadeTargetPalettes (03:7606): the targets black
export function clearFadeTargetPalettes(P, f = 0) {
  for (let i = 0; i < PALETTES_SIZE; i++) P.bus.w8(wPaletteFadeTarget + i, 0);
  return { a: 0, b: 0, de: 0, hl: wPaletteFadeTarget + PALETTES_SIZE, f: FZ | FN | (f & FC) };
}
// DesaturateFadeTargetPalettes (03:7616): each target color split into wPaletteColorSplit, made grey there
// (ComputeGrayscaleColor) and put back
export function desaturateFadeTargetPalettes(P) {
  const { bus } = P;
  let red = 0;
  for (let i = 0; i < COLORS; i++) {
    const at = wPaletteFadeTarget + 2 * i, s = splitColorComponents(bus.u16(at));
    bus.w8(wPaletteColorSplit, s.a); bus.w8(wPaletteColorSplit + 1, s.b); bus.w8(wPaletteColorSplit + 2, s.c);
    computeGrayscaleColor(P, wPaletteColorSplit);
    red = bus.u8(wPaletteColorSplit);
    const color = combineColorComponents(red, bus.u8(wPaletteColorSplit + 1), bus.u8(wPaletteColorSplit + 2));
    bus.w16(at, color);
  }
  return { a: red, b: 0, de: wPaletteColorSplit, hl: wPaletteFadeTarget + PALETTES_SIZE };
}
// ComputeGrayscaleColor (03:7648): the components r g b at de become (sum / 2, at most $1F when it reaches $20;
// sum / 4; sum / 8) with sum = r + g + b (8 bits). de is kept.
export function computeGrayscaleColor(P, de) {
  const { bus } = P;
  const sum = (bus.u8(de) + bus.u8(de + 1) + bus.u8(de + 2)) & 0xFF;
  bus.w8(de + 2, sum >> 3);
  bus.w8(de + 1, ((sum * 2) >> 3) & 0xFF);
  const half = ((sum * 4) >> 3) & 0xFF, red = half & 0x20 ? MAX_COMPONENT : half;
  bus.w8(de, red);
  return { a: red, b: 0, c: sum, hl: half, de, f: (half & 0x20 ? 0 : FZ) | FH | (sum & 1 ? FC : 0) };
}

// SetupPaletteFadeMask (03:7687): d steps (wPaletteFadeAmount), d / 31 frames apart (wPaletteFadeFrameDelay); the
// palettes of the set bits of b (bit 7: palette 0 ... bit 0: palette 7) and c (8-15) masked in. Leaves a = the
// WRAM bank restored and the entry flags, de = 31, hl = the mask's last byte.
export function setupPaletteFadeMask(P, b, c, d) {
  const { bus } = P;
  pushWramBank(P, WRAM_SCENE);
  bus.w8(wPaletteFadeAmount, d);
  const delay = callHome(P, HOME.DivHLByDE, { h: 0, l: d, d: 0, e: 0x1F }).l;
  bus.w8(wPaletteFadeFrameDelay, delay);
  const bits = b << 8 | c;
  for (let i = 0; i < PALETTES; i++) if (bits & (0x8000 >> i)) bus.w8(wPaletteFadeMask + i, 1);
  const af = popWramBank(P);
  return { a: af >> 8, f: af & 0xF0, de: 0x1F, hl: wPaletteFadeMask + PALETTES - 1, b, c };
}

// AnimatePaletteFadeToTarget (03:7719): the fade (above): wait the delay, step the masked palettes, load all 16
// at once, a frame; wPaletteFadeAmount times; then SnapPalettesToTarget. Leaves a = the WRAM bank restored and the
// entry flags.
export function* animatePaletteFadeToTarget(P) {
  const { bus } = P;
  pushWramBank(P, WRAM_SCENE);
  do {
    for (let n = bus.u8(wPaletteFadeFrameDelay); n; n--) yield* advanceFrame(P);
    for (let i = 0; i < PALETTES; i++) if (bus.u8(wPaletteFadeMask + i)) stepPaletteColorsTowardTarget(P, i, P.cpu.c);
    loadPalettesImmediate(P, wPaletteFadeLive, 0, PALETTES);
    yield* advanceFrame(P);
    bus.w8(wPaletteFadeAmount, bus.u8(wPaletteFadeAmount) - 1);
  } while (bus.u8(wPaletteFadeAmount));
  snapPalettesToTarget(P);
  const af = popWramBank(P);
  return { a: af >> 8, f: af & 0xF0 };
}
// StepPaletteColorsTowardTarget (03:7764): palette `index`'s 4 live colors one unit nearer their targets in each
// component (through wPaletteColorSplit). Leaves b = 0, c as it came, de / hl past the target / live palette.
export function stepPaletteColorsTowardTarget(P, index, c) {
  const { bus } = P;
  bus.w8(wPaletteFadeIndex, index);
  const target = advanceToPaletteEntry(wPaletteFadeTarget, index), live = advanceToPaletteEntry(wPaletteFadeLive, index);
  let lo = 0;
  for (let k = 0; k < 4; k++) {
    const l = splitColorComponents(bus.u16(live + 2 * k)), t = splitColorComponents(bus.u16(target + 2 * k));
    [l.a, l.b, l.c, t.a, t.b, t.c].forEach((v, i) => bus.w8(wPaletteColorSplit + i, v));
    for (let i = 0; i < 3; i++) stepColorComponentTowardTarget(P, wPaletteColorSplit + i, wPaletteColorSplit + 3 + i);
    const color = combineColorComponents(bus.u8(wPaletteColorSplit), bus.u8(wPaletteColorSplit + 1), bus.u8(wPaletteColorSplit + 2));
    bus.w16(live + 2 * k, color);
    lo = color & 0xFF;
  }
  return { a: lo, b: 0, c, de: target + PALETTE_SIZE, hl: live + PALETTE_SIZE, f: FZ | FN };
}
// StepColorComponentTowardTarget (03:77D0): the component at hl one unit toward the one at de (wrapping in 5 bits)
export function stepColorComponentTowardTarget(P, hl, de) {
  const { bus } = P, live = bus.u8(hl), target = bus.u8(de);
  if (target === live) return { a: 0, b: live, f: cpFlags(target, live) };
  const v = ((target > live ? live + 1 : live - 1)) & MAX_COMPONENT;
  bus.w8(hl, v);
  return { a: v, b: live, f: andFlags(v) };
}
// SnapPalettesToTarget (03:77E2): the masked palettes' live copies = their targets; all 16 loaded
export function snapPalettesToTarget(P) {
  const { bus } = P;
  for (let i = 0; i < PALETTES; i++) {
    if (!bus.u8(wPaletteFadeMask + i)) continue;
    const t = advanceToPaletteEntry(wPaletteFadeTarget, i), l = advanceToPaletteEntry(wPaletteFadeLive, i);
    for (let k = 0; k < PALETTE_SIZE; k++) bus.w8(l + k, bus.u8(t + k));
  }
  return loadPalettesImmediate(P, wPaletteFadeLive, 0, PALETTES);
}
// AdvanceToPaletteEntry (03:7829): hl + 8 * b (leaves a = b = 0, flags of `and a`)
export function advanceToPaletteEntry(hl, b) { return (hl + PALETTE_SIZE * b) & 0xFFFF; }

export const HOOKS = [
  hook(BANK, 0x75AB, initGrayscalePaletteFade),
  hook(BANK, 0x75CA, initBlackPaletteFade),
  hook(BANK, 0x75E9, (P, c) => copyMasterPalettesToFadeBuffers(P, c.f)),
  hook(BANK, 0x7606, (P, c) => clearFadeTargetPalettes(P, c.f)),
  hook(BANK, 0x7616, desaturateFadeTargetPalettes),
  hook(BANK, 0x7648, (P, c) => computeGrayscaleColor(P, c.de)),
  hook(BANK, 0x7687, (P, c) => setupPaletteFadeMask(P, c.b, c.c, c.d)),
  hook(BANK, 0x7719, animatePaletteFadeToTarget),
  hook(BANK, 0x7764, (P, c) => stepPaletteColorsTowardTarget(P, c.b, c.c)),
  hook(BANK, 0x77D0, (P, c) => stepColorComponentTowardTarget(P, c.hl, c.de)),
  hook(BANK, 0x77E2, snapPalettesToTarget),
  hook(BANK, 0x7829, (P, c) => ({ hl: advanceToPaletteEntry(c.hl, c.b), a: 0, b: 0, f: FZ | FH })),
];

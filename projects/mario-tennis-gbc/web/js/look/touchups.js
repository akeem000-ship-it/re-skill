// Hand-made pixel touch-ups where the automatic labelling or a hairstyle edit is rough. Each entry is a list of
// { x, y, r } (coordinates in the frame, r a REG value), keyed by asset ("walk:frame:facing", "walkB:...",
// "match:<frame address hex>", "head:<address hex>", "portrait", "win", "lose") and by style ("*" = always).
// These are drawn by hand for this project; nothing here is taken from the ROM.
import { REG } from "./label.js";
const { NONE, OUT, SKIN, HAIR, HAT, TOP } = REG;
const px = (r, pts) => pts.map(([x, y]) => ({ x, y, r }));

export const TOUCHUPS = {
  alex: {},
  nina: {},
};
export { px, NONE, OUT, SKIN, HAIR, HAT, TOP };

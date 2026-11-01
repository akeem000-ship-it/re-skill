// The play page's picture options (web/play.html, wired in js/play.js): how the game's frame is shown, never what the game does.
//   Text   Game (the game's own font) | Itim | Kode Mono: the game's text redrawn in a high-resolution font (hdtext.js)
//   UI     Game | HD: menus, windows, cursors, frames and the HUD redrawn as clean 4x art (hdui.js and its painters, hdmenus/)
//   View   10:9 (the Game Boy's screen) | 4:3 | Fill (the space the picture has) | Wide 16:9: the wider ones with the real map on both
//          sides where the screen shows a map (wide.js); the 3D view takes the same shape (g3d/hud3d.js keeps the HUD's corners in the corners)
// With all three off the page draws exactly as before (present() returns false and play.js puts its own image). Settings are kept in
// localStorage (mg-font, mg-ui, mg-view) and can be given in the URL (?font=itim&ui=hd&view=wide). Nothing here writes to the game's
// memory: the display model is read through GbView (gbview.js).
import { GbView } from "./gbview.js";
import { HDText, FONTS, FONT_ORDER, HD } from "./hdtext.js";
import { composeWide, mapPlace, WIDE_H } from "./wide.js";
import { scale2x } from "./hdui_cursors.js";

const stored = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const keep = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
export const WIDE_W = 256;                           // 16:9
// View: the picture's shape. 10:9 the Game Boy's; 4:3, Fill (the space it has) and Wide 16:9 add the real map at both sides (wide.js)
export const VIEWS = ["normal", "4:3", "fill", "wide"];
const VIEW_NAMES = { normal: "10:9", "4:3": "4:3", fill: "Fill", wide: "Wide 16:9" };
const viewOf = v => (VIEWS.includes(v) ? v : "normal");

export class HDView {
  // canvas: the page's #screen; getRom(): the ROM bytes
  constructor(canvas, getRom) {
    this.cv = canvas; this.g = canvas.getContext("2d"); this.getRom = getRom;
    const q = new URLSearchParams(location.search);
    this.font = q.get("font") || stored("mg-font") || "game"; if (!FONTS[this.font]) this.font = "game";
    this.ui = (q.get("ui") || stored("mg-ui") || "game") === "hd" ? "hd" : "game";
    const touchy = /MarioGolfWrapper|MarioTennisWrapper/.test(navigator.userAgent) || (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches);
    this.view = viewOf(q.get("view") || stored("mg-view") || (touchy ? "fill" : "normal"));   // (a phone: Fill unless chosen, as Mario Tennis)
    this.gbv = new GbView(); this.hd = null; this.w = null; this.width = 160; this.frameKey = -1; this.wideOn = false;
    this.small = document.createElement("canvas"); this.sg = this.small.getContext("2d");
    this.wideImg = null; this.wide32 = null;
    this.sprCv = document.createElement("canvas"); this.sprCv.width = 160; this.sprCv.height = 144; this.sprG = this.sprCv.getContext("2d");
    this.sprImg = this.sprG.createImageData(160, 144); this.spr32 = new Uint32Array(this.sprImg.data.buffer);
    this.bgImg = this.sprG.createImageData(160, 144); this.bg32 = new Uint32Array(this.bgImg.data.buffer);
    this.listeners = [];
  }
  get on() { return this.font !== "game" || this.ui === "hd" || this.view !== "normal"; }
  // the picture's width (Game Boy px, 144 high): 10:9 160, 4:3 192, Wide 16:9 256, Fill as wide as the space the picture has
  // (a phone held sideways: the whole screen; upright: the game's part of it; a computer: the window's shape), even, 160 to 400
  pictureW() {
    if (this.view === "wide") return WIDE_W;
    if (this.view === "4:3") return 192;
    if (this.view !== "fill") return 160;
    const b = document.body, touch = b.classList.contains("touch"), portrait = b.classList.contains("portrait");
    // (the page's own visible size, not the window's: an app's browser can report a window wider than the page while it lays it out, and
    // a picture made for that widened the page, which widened the window... rounded down, so it never comes out wider than the screen)
    const de = document.documentElement, vw = de.clientWidth || innerWidth, vh = de.clientHeight || innerHeight;
    const ar = portrait ? vw / (vh * 0.6) : vw / Math.max(1, vh);   // (a phone held sideways: edge to edge, page.js FULL SCREEN)
    return Math.max(160, Math.min(400, Math.floor(144 * ar / 2) * 2));
  }
  onChange(fn) { this.listeners.push(fn); }
  set(k, v) {
    if (k === "font") { this.font = FONTS[v] ? v : "game"; keep("mg-font", this.font); if (this.hd) this.hd.setFont(this.font); }
    if (k === "ui") { this.ui = v === "hd" ? "hd" : "game"; keep("mg-ui", this.ui); if (this.hd) this.hd.setUI(this.ui === "hd"); }
    if (k === "view") { this.view = viewOf(v); keep("mg-view", this.view); }
    this.frameKey = -1;
    for (const f of this.listeners) f();
  }
  // the option selectors, put after `after` (an element of the page)
  mountControls(after) {
    const d = document.createElement("div"); d.id = "hdopts"; d.className = "dim";
    const sel = (id, label, opts, cur, k) => {
      const l = document.createElement("label"); l.textContent = label + " ";
      const s = document.createElement("select"); s.id = id;
      for (const [v, t] of opts) { const o = document.createElement("option"); o.value = v; o.textContent = t; s.appendChild(o); }
      s.value = cur; s.addEventListener("change", () => { this.set(k, s.value); s.blur(); });
      l.appendChild(s); d.appendChild(l); d.appendChild(document.createTextNode(" "));
      return s;
    };
    sel("hdfont", "Text", FONT_ORDER.map(f => [f, f === "game" ? "Game font" : FONTS[f].label + " (HD)"]), this.font, "font");
    sel("hdui", "Menus", [["game", "Game"], ["hd", "HD"]], this.ui, "ui");
    sel("hdview", "View", VIEWS.map(v => [v, VIEW_NAMES[v]]), this.view, "view");
    after.after(d);
    return d;
  }
  // the frame on the canvas: false when all options are off (the caller draws its own image as before)
  present(w, frames, image) {
    const cv = this.cv, g = this.g, rgba = new Uint32Array(image.data.buffer);
    if (!this.on) {
      if (cv.width !== 160 || cv.height !== 144) { cv.width = 160; cv.height = 144; this.layout(160); }
      this.w = w; return false;
    }
    if (w !== this.w) { this.w = w; this.hd = null; }
    const textOrUi = this.font !== "game" || this.ui === "hd";
    if (textOrUi && !this.hd) {
      this.gbv.refresh(w, frames, this.getRom());
      this.hd = new HDText(this.gbv); this.hd.onload = () => { this.frameKey = -1; };
      this.hd.setFont(this.font); this.hd.setUI(this.ui === "hd");
    }
    this.gbv.refresh(w, frames, this.getRom());
    const hd = this.hd && this.hd.active ? this.hd : null;
    if (hd) hd.update();
    // the picture W x 144: the game's frame (or the map-widened one)
    const W = this.pictureW(), pad = (W - 160) >> 1;
    if (W !== this.width) this.layout(W);
    const ui = !!(hd && hd.ui);                                // HD menus: the base is the picture without sprites, smoothed; the
    let base = rgba;                                           // sprites go on top of the art, smoothed too (drawSprites)
    if (ui) { this.bg32.set(this.gbv.ppu.bgFrame); base = this.bg32; }
    let src = ui ? this.bgImg : image, s32 = ui ? this.bg32 : rgba;
    this.wideOn = false;
    if (W !== 160) {
      if (!this.wideImg || this.wideImg.width !== W) { this.wideImg = new ImageData(W, WIDE_H); this.wide32 = new Uint32Array(this.wideImg.data.buffer); }
      this.wideOn = composeWide(w, base, this.wide32, W, mapPlace(w));
      if (!this.wideOn) { this.wide32.fill(0xFF000000); for (let y = 0; y < 144; y++) this.wide32.set(base.subarray(y * 160, y * 160 + 160), y * W + pad); }
      src = this.wideImg; s32 = this.wide32;
    }
    const S = hd ? HD : (W === 160 ? 1 : 4);                  // (wide alone: drawn 4x so the sides stay sharp next to the pixels)
    if (cv.width !== W * S || cv.height !== 144 * S) { cv.width = W * S; cv.height = 144 * S; }
    if (ui) {                                                  // Scale2x twice: the pixel art's stairs smoothed, its colours kept
      if (!this.baseImg || this.baseImg.width !== W * 4) { this.baseCv = document.createElement("canvas"); this.baseCv.width = W * 4; this.baseCv.height = 576; this.baseG = this.baseCv.getContext("2d"); this.baseImg = this.baseG.createImageData(W * 4, 576); }
      new Uint32Array(this.baseImg.data.buffer).set(scale2x(scale2x(s32, W, 144), W * 2, 288));
      this.baseG.putImageData(this.baseImg, 0, 0); g.drawImage(this.baseCv, 0, 0);
    } else {
      if (this.small.width !== W) { this.small.width = W; this.small.height = 144; }
      this.sg.putImageData(src, 0, 0);
      g.imageSmoothingEnabled = false; g.drawImage(this.small, 0, 0, W * S, 144 * S);
    }
    if (!hd) return true;
    g.imageSmoothingEnabled = true;
    if (hd.has.under) g.drawImage(hd.canvas.under, pad * HD, 0);
    if (hd.has.bg) g.drawImage(hd.canvas.bg, pad * HD, 0);
    if (hd.has.win) g.drawImage(hd.canvas.win, pad * HD, 0);
    if (ui) { this.drawSprites(rgba, pad); if (hd.has.spr) { g.imageSmoothingEnabled = true; g.drawImage(hd.canvas.spr, pad * HD, 0); } }
    return true;
  }
  // the HD UI art covers the screen's tiles; the sprites' own pixels (where the frame differs from the BG-only picture) go back on
  // top, sharp, less the ones the art replaced (and what lay below those)
  drawSprites(a, pad) {
    const b = this.gbv.ppu.bgFrame, s = this.spr32, hd = this.hd; let any = false;
    for (let i = 0; i < a.length; i++) { if (a[i] !== b[i]) { s[i] = a[i]; any = true; } else s[i] = 0; }
    if (hd.hiddenOam.size) {
      const hp = hd.hiddenPx; for (let i = 0; i < hp.length; i++) if (hp[i]) s[i] = 0;
      const th = hd.through; for (let k = 0; k < th.length; k += 2) s[th[k]] = th[k + 1]; any = true;
    }
    if (!any) return;
    // smoothed to 4x as the picture under them (golf_common.js): Scale2x twice
    if (!this.bigImg) { this.bigCv = document.createElement("canvas"); this.bigCv.width = 640; this.bigCv.height = 576; this.bigG = this.bigCv.getContext("2d"); this.bigImg = this.bigG.createImageData(640, 576); }
    new Uint32Array(this.bigImg.data.buffer).set(scale2x(scale2x(s, 160, 144), 320, 288));
    this.bigG.putImageData(this.bigImg, 0, 0); this.g.imageSmoothingEnabled = false; this.g.drawImage(this.bigCv, pad * HD, 0, 160 * HD, 144 * HD);
  }
  // the canvas's CSS shape for a picture W px wide
  layout(W) {
    this.width = W;
    document.body.classList.toggle("wide", W !== 160);
    this.cv.style.aspectRatio = `${W} / 144`;
    this.cv.style.maxWidth = W === 160 ? "" : `${Math.round(640 * W / 160)}px`;
    for (const f of this.listeners) f();
  }
}

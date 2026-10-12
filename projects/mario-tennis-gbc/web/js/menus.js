// Exhibition menus rebuilt from the ROM's own data (REVERSE.md "Menus"): main menu 3B:55D1,
// play menu 3B:5CF3, character select 38:7408, court select 3E:5D11.
// Backgrounds, icons, badges, fonts, portraits and palettes come from the ROM; the cursor logic,
// text ids and layout tables below were read from the menu code and from PPU dumps of the real game.
import { palettes } from "./rom.js";
import { ROSTER, screenImage, screenPalettes, tilesCanvas, cached, palKey, uiFont, iconTiles,
         charPalette, greyPalette, facePortrait, getText, newCanvas } from "./assets.js";

// Exhibition roster in the game's menu order (verified live: Luigi, Baby Mario, DK, Allie, Joy, Brian are
// available on a fresh save); the remaining Mushroom Kingdom cast is normally unlocked by playing.
export const MENU_ROSTER = [23, 25, 24, 4, 5, 6, 26, 31, 28, 27, 30, 29];
const COURT_MAP = [5, 4, 2, 8];            // court id -> map id (hard, clay, grass, composition), verified live
const T = 0x30;                            // menu text bank

class Assets {
  constructor(rom) {
    this.rom = rom; this.font = uiFont(rom);
    // stadium background used by the main / play / court menus (39:4C38: refs 3C:08 tiles, 0A map, 0C attrs, 0E palette)
    this.st = { tiles: rom.lzRef(0x08, 0x3C), map: rom.lzRef(0x0A, 0x3C), attr: rom.lzRef(0x0C, 0x3C), pal: palettes(rom.rawRef(0x0E, 0x3C, 64)) };
    this.objPal0 = palettes(rom.slice(0x39, 0x4619, 8), 1)[0];      // badges
    this.objPal1 = palettes(rom.slice(0x39, 0x4B65, 8), 1)[0];      // marquee title
    this.orange = screenImage(rom, 1); this.orangePal = screenPalettes(rom, 1);
    this.mainIcons = [...Array(6)].map((_, i) => rom.lzRef(rom.u8(0x3B, 0x57E0 + i * 2), rom.u8(0x3B, 0x57E1 + i * 2)));
    this.playIcons = [...Array(7)].map((_, i) => rom.lzRef(rom.u8(0x3B, 0x5EBD + i * 2), rom.u8(0x3B, 0x5EBE + i * 2)));
    this.courtIcons = [...Array(4)].map((_, i) => rom.lzRef(rom.u8(0x3E, 0x5DF1 + i * 2), rom.u8(0x3E, 0x5DF2 + i * 2)));
    this.cursor = iconTiles(rom, 0x1B); this.bracket = rom.lz(0x39, 0x44F6); this.arrows = rom.lz(0x38, 0x50A7);   // LZ streams called directly (not bank-table refs)
    this.courtSpeed = rom.slice(0x3E, 0x608A, 9); this.courtBounce = rom.slice(0x3E, 0x60C1, 9);
  }
  stadium() {
    return cached("stadium", () => {
      const { tiles, map, attr, pal } = this.st, c = newCanvas(160, 144), g = c.getContext("2d");
      for (let ty = 0; ty < 18; ty++) for (let tx = 0; tx < 20; tx++) {
        const i = ty * 32 + tx, t = map[i], at = attr[i], n = (t < 128 ? t + 256 : t) - 0x80;
        g.drawImage(tilesCanvas(tiles, [n], 1, pal[at & 7], { flipX: !!(at & 0x20), flipY: !!(at & 0x40) }), tx * 8, ty * 8);
      }
      return c;
    });
  }
  // 5x3-tile icon (15 tiles, row-major) with a palette
  icon(tiles, key, pal) { return cached("icon" + key + palKey(pal), () => tilesCanvas(tiles, [...Array(15).keys()], 5, pal)); }
  // badge / marquee strips: N tiles -> N/2 sprites of 8x16 side by side
  strip(tiles, key, pal) {
    return cached("strip" + key + palKey(pal), () => {
      const n = tiles.length >> 5, c = newCanvas(n * 8, 16), g = c.getContext("2d");
      for (let k = 0; k < n; k++) g.drawImage(tilesCanvas(tiles, [2 * k, 2 * k + 1], 1, pal, { transparent: true }), k * 8, 0);
      return c;
    });
  }
  sprite16(tiles, key, i, pal, fx = false, fy = false) {
    return cached("s16" + key + i + fx + fy + palKey(pal), () => {
      const c = newCanvas(8, 16), g = c.getContext("2d");
      const a = tilesCanvas(tiles, [i], 1, pal, { transparent: true, flipX: fx, flipY: fy });
      const b = tilesCanvas(tiles, [i + 1], 1, pal, { transparent: true, flipX: fx, flipY: fy });
      g.drawImage(fy ? b : a, 0, 0); g.drawImage(fy ? a : b, 0, 8);
      return c;
    });
  }
  // description bar (rows 15-17) in the stadium menus
  bar(g, lines) {
    const p = this.st.pal[0];
    g.fillStyle = `rgb(${p[2].join(",")})`; g.fillRect(0, 120, 160, 24);
    g.fillStyle = `rgb(${p[1].join(",")})`; g.fillRect(1, 121, 158, 22);
    lines.forEach((s, i) => this.font.draw(g, s, 8, lines.length === 1 ? 128 : 123 + i * 10, p));
  }
  marquee(g, tiles, key, frame) {
    const s = this.strip(tiles, key, this.objPal1), x = 160 - (frame % (160 + s.width));
    g.drawImage(s, x, 0);
  }
  text(i) { return getText(this.rom, T, i); }
}

export class Menus {
  constructor(rom, gameFont) {
    this.rom = rom; this.a = new Assets(rom); this.gf = gameFont; this.frame = 0; this.msg = 0;
    this.screen = "main"; this.main = { col: 0, row: 0 };
    this.play = { row: 0, choice: [0, 0, 0] };            // singles/doubles, 2/6 games, 1/3/5 sets
    this.char = { i: 0, p1: -1 }; this.diff = 1; this.courtSel = { col: 0, row: 0 };
    this.result = null;
  }
  update(input) {
    this.frame++; if (this.msg > 0) this.msg--;
    const k = input;
    switch (this.screen) {
      case "main": {
        const m = this.main;
        if (k.left) m.col = (m.col + 2) % 3; if (k.right) m.col = (m.col + 1) % 3;
        if (k.up) m.row = (m.row + 2) % 3; if (k.down) m.row = (m.row + 1) % 3;
        if (k.a) { if (m.row === 0 && m.col === 0) this.screen = "play"; else this.msg = 60; }
        break;
      }
      case "play": {
        const p = this.play, n = [2, 2, 3][p.row];
        if (k.up) p.row = (p.row + 2) % 3; if (k.down) p.row = (p.row + 1) % 3;
        if (k.left) p.choice[p.row] = (p.choice[p.row] + n - 1) % n; if (k.right) p.choice[p.row] = (p.choice[p.row] + 1) % n;
        if (k.b) this.screen = "main";
        if (k.a) { if (p.choice[0] === 1) this.msg = 60; else { this.screen = "charP1"; this.char.i = 0; } }
        break;
      }
      case "charP1": case "charP2": {
        const c = this.char, n = MENU_ROSTER.length, p2 = this.screen === "charP2";
        if (k.right) c.i = (c.i + 1) % n; if (k.left) c.i = (c.i + n - 1) % n;
        if (k.b) { if (p2) { this.screen = "charP1"; c.i = MENU_ROSTER.indexOf(c.p1); } else this.screen = "play"; }
        if (k.a) {
          if (!p2) { c.p1 = MENU_ROSTER[c.i]; this.screen = "charP2"; }      // the opponent cursor starts on slot 0 (verified)
          else if (MENU_ROSTER[c.i] !== c.p1) { c.p2 = MENU_ROSTER[c.i]; this.screen = "diff"; }
        }
        break;
      }
      case "diff":
        if (k.left) this.diff = Math.max(0, this.diff - 1); if (k.right) this.diff = Math.min(3, this.diff + 1);
        if (k.b) this.screen = "charP2";
        if (k.a) this.screen = "court";
        break;
      case "court": {
        const s = this.courtSel;
        if (k.left || k.right) s.col ^= 1; if (k.up || k.down) s.row ^= 1;
        if (k.b) this.screen = "diff";
        if (k.a) {
          const court = s.row * 2 + s.col;
          this.result = { p1: this.char.p1, p2: this.char.p2, difficulty: this.diff, court: COURT_MAP[court],
                          games: [2, 6][this.play.choice[1]], sets: [1, 3, 5][this.play.choice[2]] };
        }
        break;
      }
    }
  }
  draw(g) {
    const A = this.a, f = this.frame, bob = Math.floor(f / 16) % 2;
    const arrowsAt = (x, y) => {
      g.drawImage(A.sprite16(A.cursor, "cur", 0, A.objPal0), x + 12, y + 14 - bob);
      g.drawImage(A.sprite16(A.cursor, "cur", 2, A.objPal0), x + 20, y + 14 - bob);
    };
    if (this.screen === "main") {
      g.drawImage(A.stadium(), 0, 0);
      const m = this.main, sel = m.row * 3 + m.col, grey = A.st.pal[5];
      const SEL = [0x5A7C, 0x5A8C, 0x5A94, 0x5A7C, 0x5A7C, 0x5A7C, 0x5A9C, 0x5A84, 0x5AA4];   // 3B:5A6A
      const BADGE = { 0: 0x1D, 1: 0x1E, 2: 0x1F, 6: 0x20, 7: 0x21, 8: 0x22 };               // 3B:592D
      const BPOS = [[-4, 46], [38, 46], [92, 46], [-2, 82], [44, 82], [94, 82], [-4, 104], [44, 104], [94, 104]]; // 3B:591B
      for (let gi = 0; gi < 9; gi++) {
        const row = Math.floor(gi / 3), col = gi % 3, on = gi === sel;
        const pal = on ? palettes(this.rom.slice(0x3B, SEL[gi], 8), 1)[0] : grey;
        if (row === 1) {          // file slots: the digits are part of the stadium tile set (3x3 tiles)
          const x = (2 + 6 * col) * 8, y = 56, { tiles, map, attr } = A.st;
          for (let ty = 0; ty < 3; ty++) for (let tx = 0; tx < 3; tx++) {
            const i = (7 + ty) * 32 + 2 + 6 * col + tx, t = map[i], at = attr[i], n = (t < 128 ? t + 256 : t) - 0x80;
            g.drawImage(tilesCanvas(tiles, [n], 1, pal, { flipX: !!(at & 0x20), flipY: !!(at & 0x40) }), x + tx * 8, y + ty * 8);
          }
          if (on) arrowsAt(x - 8, y);
        } else {
          const ic = row === 0 ? gi : gi - 3, x = (1 + 6 * col) * 8, y = (row === 0 ? 3 : 11) * 8;
          g.drawImage(A.icon(A.mainIcons[ic], "main" + ic, pal), x, y);
          if (on) {
            arrowsAt(x, y);
            const pal = gi === 1 ? palettes(this.rom.slice(0x18, 0x4308, 8), 1)[0] : A.objPal0;
            g.drawImage(A.strip(iconTiles(this.rom, BADGE[gi]), "badge" + BADGE[gi], pal), BPOS[gi][0], BPOS[gi][1]);
          }
        }
      }
      A.marquee(g, iconTiles(this.rom, 0x3E), "mq-main", f);
      const DESC = [125, 126, 127, 124, 124, 124, 128, 129, 130];
      A.bar(g, [this.msg ? A.text(131) : A.text(DESC[sel])]);
    } else if (this.screen === "play") {
      g.drawImage(A.stadium(), 0, 0);
      const p = this.play, grey = A.st.pal[5];
      const ROWPAL = [0x5DD4, 0x5DDC, 0x5DE4].map(a => palettes(this.rom.slice(0x3B, a, 8), 1)[0]);
      const CELLS = [[[3, 3], [12, 3]], [[3, 7], [12, 7]], [[1, 11], [7, 11], [13, 11]]], FIRST = [0, 2, 4];
      CELLS.forEach((cells, row) => cells.forEach(([cx, cy], j) => {
        const on = p.choice[row] === j, x = cx * 8, y = cy * 8;
        g.drawImage(A.icon(A.playIcons[FIRST[row] + j], "play" + (FIRST[row] + j), on ? ROWPAL[row] : grey), x, y);
        if (on && row === p.row) {
          arrowsAt(x, y);
          const id = 0x23 + FIRST[row] + j, s = A.strip(iconTiles(this.rom, id), "badge" + id, A.objPal0);
          g.drawImage(s, x + 20 - (s.width >> 1), y + 20);
        }
      }));
      A.marquee(g, iconTiles(this.rom, 0x3F), "mq-play", f);
      const TXT = [[135, 136], [137, 138], [139, 140, 141]];
      A.bar(g, [this.msg ? A.text(131) : A.text(TXT[p.row][p.choice[p.row]])]);
    } else if (this.screen === "court") {
      g.drawImage(A.stadium(), 0, 0);
      const s = this.courtSel, sel = s.row * 2 + s.col, grey = A.st.pal[5];
      const CELLS = [[4, 4], [11, 4], [4, 9], [11, 9]], BPOS = [[20, 57], [76, 57], [20, 97], [72, 97]];   // 3E:5FD6, 3E:5F41
      CELLS.forEach(([cx, cy], i) => {
        const on = i === sel, x = cx * 8, y = cy * 8;
        g.drawImage(A.icon(A.courtIcons[i], "court" + i, on ? palettes(this.rom.slice(0x3E, 0x6003 + 8 * i, 8), 1)[0] : grey), x, y);
        if (on) { arrowsAt(x, y); g.drawImage(A.strip(iconTiles(this.rom, 0x65 + i), "badge" + (0x65 + i), A.objPal0), BPOS[i][0], BPOS[i][1]); }
      });
      A.marquee(g, iconTiles(this.rom, 0x40), "mq-court", f);
      A.bar(g, ["Ball Speed: " + A.text(169 + A.courtSpeed[sel]), "Bounce: " + A.text(169 + A.courtBounce[sel])]);
    } else {                       // character select, opponent select, difficulty
      g.drawImage(A.orange, 0, 0);
      const pal0 = A.orangePal[0], c = this.char, n = MENU_ROSTER.length, p2 = this.screen !== "charP1";
      A.font.draw(g, A.text(this.screen === "charP1" ? 142 : this.screen === "charP2" ? 144 : 149), 8, 24, pal0);
      const taken = r => p2 && r === c.p1;
      for (let s = 0; s < 3; s++) {
        const r = MENU_ROSTER[(c.i + s) % n], pal = charPalette(this.rom, r);
        g.drawImage(facePortrait(this.rom, r, taken(r) ? greyPalette(pal) : pal), 10 + 24 * s, 47);
      }
      const br = (x, y, fx, fy) => g.drawImage(A.sprite16(A.bracket, "br", 0, A.objPal0, fx, fy), x, y);
      if (this.screen !== "diff") { br(5, 44, false, false); br(21, 44, true, false); br(5, 52, false, true); br(21, 52, true, true); }
      g.drawImage(A.sprite16(A.arrows, "arr", 0, A.objPal0), -2, 65); g.drawImage(A.sprite16(A.arrows, "arr", 2, A.objPal0), 76, 65);
      const cur = MENU_ROSTER[c.i], name = ROSTER[cur];
      g.fillStyle = `rgb(${pal0[1].join(",")})`; g.fillRect(8, 100, 144, 36);     // the lower panel (covers the VS screen's "LV")
      A.font.draw(g, "1P", 96, 48, pal0); A.font.draw(g, "2C", 88, 72, pal0);
      const p1 = p2 ? c.p1 : cur, pp = charPalette(this.rom, p1);
      g.drawImage(facePortrait(this.rom, p1, pp), 136, 44);
      if (p2) g.drawImage(facePortrait(this.rom, cur, charPalette(this.rom, cur)), 136, 66);
      if (this.screen === "diff") {
        // EASY / NORMAL / HARD / INTENSE in the game's narrow dialogue font; bracket cursor as in the real screen
        const X = [8, 42, 92, 118], L = ["EASY", "NORMAL", "HARD", "INTENSE"], ink = pal0[3], sh = pal0[1];   // shade = panel colour
        L.forEach((t, i) => this.gf.draw(g, t, X[i], 130, ink, sh));
        const x0 = X[this.diff] - 9, x1 = X[this.diff] + this.gf.width(L[this.diff]) + 1;
        br(x0, 123, false, false); br(x1, 123, true, false); br(x0, 129, false, true); br(x1, 129, true, true);
        A.font.draw(g, name, 80 - name.length * 4, 104, pal0);
      } else {
        A.font.draw(g, name, 80 - name.length * 4, 104, pal0);
        A.font.draw(g, A.text(153 + Math.min(5, this.rom.u8(0x38, 0x58FB + cur))), 24, 120, pal0);
      }
      A.marquee(g, iconTiles(this.rom, 0x64), "mq-char", f);
    }
  }
}

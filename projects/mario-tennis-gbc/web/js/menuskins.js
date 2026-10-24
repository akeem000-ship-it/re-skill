// MENU: Wheel, the sub-menus: the main menu's ball-wheel look carried on through the screens after it. The game's own screens keep
// running underneath (they take the pad, play their sounds, and decide); the port's menu loops only say which screen is up and where
// its cursor is (P.menuWheel.skin = { id, at: the frame, ... }, read-only, written every frame of the loop), and the overlay
// (menuwheel.js) draws the screen again here:
//   format   the exhibition's match format (bank $3B RunMatchFormatSelect): players, games and sets as three pills by the ball,
//            each with its choices, the chosen row gold; the panel shows the row's options large and the game's own caption
//   court    the court select (bank $3E, four or nine courts): the courts round the ball; the panel plays a little film of the
//            chosen court (its own picture from the ROM, the camera gliding in over it while a ball is hit back and forth),
//            with its name and its ball speed and bounce (the court table 08:5DC4: friction, bounce)
//   chars    the exhibition's character select (bank $38 RunExhibitionCharSelectScreen): the grid's characters round the ball (the
//            ones already picked ticked); the panel shows the one under the cursor standing (match frame 4, coloured as on the court:
//            the anime mods' too), their name and type (the game's own words, text bank $30) or a created character's levels, the
//            players picked so far, and the CPU level chips while the game asks for one. Read from the screen's state (WRAM 3:
//            wCharGridEntries $DA00, the slots $D814-$D834) and the ROM, never written
//   files    Status and Erase (bank $3B RunSavedDataSourceSelect / RunEraseSavedDataSelect: the three tour files over the Game
//            Pak's and the N64's data): the five round the ball; the panel shows a file's player standing with their level and
//            play time (the summaries at WRAM 3 $D300, as the main menu reads them), or what the cell holds; Erase in red
//   minigames the Mario mini-games (bank $3B RunMinigameSelect, 6 or 9 cells): their names (text 30:178 + cell) round the ball, the
//            chosen one's host standing in the panel (match frame 4), a locked one as "? ? ?"
//   tabs     the two-to-four-choice panels: Play Alone / with Partner (3E:5192), a minigame's levels (1B:6E31 / 6FD2: the second
//            locked until the first is cleared), Status's data types (1B:715D), the N64 record types (3B:71B0) and transfer
//            items (3B:74BF): the choices (the game's own words, text bank $30) round the ball, the chosen one large in the
//            panel with an icon and the game's own caption line
//   confirm  the erase warning (3E:4C12): its own words (text bank $30, by the warning's kind) in a red panel, YES / NO round the ball
//   cardconfirm  the file-erase question over the character-data cards (1A:7945): the game's own cards (its picture) in the
//            panel, "Erase this data?" (text 30:313), YES / NO round the ball
//   dict     the tennis dictionary's list page (3F:407A): the terms of the category shown round the ball (the term grid
//            3F:539E filtered by wTennisDictCategoryMask; the cursor wTennisDictScrollTop + CursorRow), the chosen term
//            with its definition in the panel (names: text 34:240 on into bank $35; definitions: 35:48 + term); the index
//            page: its nine rows of letters (3F:545F: each row's first letter; letters 35:143 + n) round the ball, the row's
//            terms in the panel
// The link screens use the same skins (rules: format; courts; characters), with their link titles.
import { courtImage } from "./assets.js";
import { matchPicture, charScheme } from "./crowdfans.js";
import { Rom } from "./rom.js";

const FONT = "MT Luckiest Guy", BODY = "Itim, system-ui, sans-serif";
const COURT_TABLE = 0x5DC4;                                          // 08:5DC4: per court 4 bytes: friction, bounce, map, music
const COURT_NAMES = ["HARD", "CLAY", "GRASS", "COMPOSITION", "MARIO COURT", "PEACH COURT", "YOSHI COURT", "DK COURT", "WARIO COURT"];
const NAME_BANK = 0x30, NAME_TABLE = 0x4004, NAME_COUNT = 560, TEXT_NAME = 0x1B, TEXT_TYPE = 0x99;   // text 30:27 + char, 30:153 + type
const CHAR_TYPE_TABLE = 0x58FB, SLOT_RING = 0x5C8F, SPRITE_OF = 0x1DA50;     // 38:58FB, 38:5C8F (per mode a list $FF, slots..., 4), RosterToSprite 07:5A50
const W3 = a => a - 0xD000, ENTRIES = 0xDA00, CREATED = 0xD900, SLOT = 0xD814, MODE = 0xD813, PICKS = 0xD816, HANDED = 0xDF00;
const PROMPT = 0xD824, LEVEL = 0xD826, CURSOR_X = 0xCB04 - 0xC000, CURSOR_Y = 0xCB05 - 0xC000, PAGE = 0xD811;
const SLOT_NAMES = ["YOUR PLAYER", "YOUR PARTNER", "OPPONENT", "THEIR PARTNER"], SLOT_TAGS = ["1P", "PARTNER", "CPU", "CPU 2"];
const LEVELS = ["EASY", "NORMAL", "HARD", "EXPERT"];
const COURT_LINES = ["A fast, true bounce", "Slow and high: long rallies", "Quick and low: serve and volley", "Lively, a fair bounce"];   // (bonus courts: "A bonus court")

// the menu's text lines from the HD reader (the game's own words), at a screen row band
function gameText(hd, y0, y1) {
  const L = (hd && hd.screen && hd.screen.lines) || (hd && hd.lines) || [];
  return L.filter(l => l.y >= y0 && l.y < y1).sort((a, b) => a.y - b.y || a.x - b.x).map(l => l.text.trim()).join("  ");
}

export class MenuSkins {
  constructor(mw) { this.mw = mw; this.courts = new Map(); this.rom = null; this.pos = 0; this.id = ""; }
  // draw `skin` (P.menuWheel.skin) into the overlay canvas g (W x H device pixels)
  draw(g, W, H, skin, gb, hd) {
    if (skin.id !== this.id) { this.id = skin.id; this.pos = skin.sel ?? skin.row ?? 0; this.t0 = performance.now() / 1000; }
    g.clearRect(0, 0, W, H);
    const k = Math.min(W / 1280, H / 720);
    if (skin.id === "court") this.court(g, W, H, k, skin, gb);
    else if (skin.id === "format") this.format(g, W, H, k, skin, hd);
    else if (skin.id === "chars") this.chars(g, W, H, k, gb);
    else if (skin.id === "files") this.files(g, W, H, k, skin, gb);
    else if (skin.id === "minigames") this.minigames(g, W, H, k, skin, gb, hd);
    else if (skin.id === "tabs") this.tabs(g, W, H, k, skin, gb, hd);
    else if (skin.id === "confirm") this.confirm(g, W, H, k, skin, gb);
    else if (skin.id === "cardconfirm") this.cardConfirm(g, W, H, k, skin, gb);
    else if (skin.id === "dict") (skin.index ? this.dictIndex(g, W, H, k, gb) : this.dict(g, W, H, k, gb));
  }
  // the turning: the ball's position eases to the chosen item, the shorter way round n
  ease(sel, n) { let d = sel - this.pos; if (n > 5) { if (d > n / 2) d -= n; if (d < -n / 2) d += n; } this.pos += d * 0.3; if (Math.abs(d) < 0.01) this.pos = sel; return this.pos; }   // (a short list does not wrap)
  // the ball on the left and the items on its arc (the main menu's layout); labels: [text], the chosen one on a gold pill
  arc(g, k, H, labels, sel, step = 0.3) {
    const mw = this.mw, cy = H / 2, br = 250 * k, bx = -60 * k, n = labels.length, pos = this.ease(sel, n);
    mw.menuBall(g, bx, cy, br, -pos * 0.35);
    for (let i = 0; i < n; i++) {
      let o = i - pos; if (n > 5) { if (o > n / 2) o -= n; if (o < -n / 2) o += n; } if (Math.abs(o) > 3.6) continue;
      const a = o * step, rr = br + 80 * k + (Math.abs(o) < 0.5 ? 40 * k * (1 - Math.abs(o) * 2) : 0), x = bx + rr * Math.cos(a), y = cy + rr * Math.sin(a), label = labels[i];
      if (i === sel) {
        g.font = `${44 * k}px "${FONT}", ${BODY}`; const tw = g.measureText(label).width;
        g.fillStyle = "#ffd65a"; mw.pill(g, x - 20 * k, y - 36 * k, tw + 60 * k, 72 * k, 36 * k); g.fill();
        g.fillStyle = "#281e0a"; g.textBaseline = "middle"; g.fillText(label, x + 10 * k, y + 3 * k);
      } else {
        g.globalAlpha = Math.max(0.25, 1 - Math.abs(o) * 0.22); g.font = `${30 * k}px "${FONT}", ${BODY}`; g.textBaseline = "middle";
        g.fillStyle = "#000"; g.fillText(label, x + 2 * k, y + 2 * k); g.fillStyle = "#c8d0eb"; g.fillText(label, x, y); g.globalAlpha = 1;
      }
    }
  }
  // the white panel on the right with its gold rim; returns its box
  panel(g, W, k, top = 110, h = 470) {
    const px = W - 520 * k, py = top * k, pw = 460 * k, ph = h * k;
    g.fillStyle = "rgba(250,250,255,0.94)"; this.mw.pill(g, px, py, pw, ph, 30 * k); g.fill(); g.lineWidth = 4 * k; g.strokeStyle = "#ffd65a"; g.stroke();
    return { px, py, pw, ph };
  }
  title(g, k, text) {
    g.font = `${54 * k}px "${FONT}", ${BODY}`; g.textBaseline = "top"; g.fillStyle = "rgba(0,0,0,0.5)"; g.fillText(text, 404 * k, 34 * k);
    g.fillStyle = "#ffd65a"; g.fillText(text, 400 * k, 30 * k); g.textBaseline = "alphabetic";
  }
  hint(g, W, H, k, text) { g.fillStyle = "#dce2f5"; g.font = `${24 * k}px ${BODY}`; g.textAlign = "right"; g.fillText(text, W - 60 * k, H - 40 * k); g.textAlign = "start"; }

  // ---- the match format ----
  format(g, W, H, k, s, hd) {
    const rows = [["PLAYERS", ["SINGLES", "DOUBLES"], s.doubles], ["GAMES", ["2 GAMES", "6 GAMES"], s.games], ["SETS", ["1 SET", "3 SETS", "5 SETS"], s.sets]];
    this.title(g, k, s.title || "MATCH");
    this.arc(g, k, H, rows.map(r => r[1][r[2]] || r[0]), s.row, 0.42);
    const { px, py, pw } = this.panel(g, W, k, 130, 430), r = rows[s.row] || rows[0];
    g.textAlign = "center"; g.fillStyle = "#8a7a50"; g.font = `${26 * k}px "${FONT}", ${BODY}`; g.fillText(r[0], px + pw / 2, py + 60 * k);
    // the row's choices as chips, the chosen one gold, with the arrows that change it
    const n = r[1].length, cw = 128 * k, gap = 12 * k, x0 = px + (pw - (n * cw + (n - 1) * gap)) / 2, cy = py + 110 * k;
    for (let i = 0; i < n; i++) {
      const on = i === r[2], x = x0 + i * (cw + gap);
      g.fillStyle = on ? "#ffd65a" : "#e4e6f0"; this.mw.pill(g, x, cy, cw, 64 * k, 20 * k); g.fill();
      g.fillStyle = on ? "#281e0a" : "#7a7f98"; g.font = `${(r[1][i].length > 7 ? 22 : 26) * k}px "${FONT}", ${BODY}`; g.fillText(r[1][i], x + cw / 2, cy + 42 * k);
    }
    g.fillStyle = "#c79a2a"; g.font = `${36 * k}px ${BODY}`; g.fillText("◀", px + 36 * k, cy + 46 * k); g.fillText("▶", px + pw - 36 * k, cy + 46 * k);
    // the game's own caption for the choice ("One-on-One", "Play Alone", ...)
    const cap = gameText(hd, 120, 144);
    g.fillStyle = "#281e0a"; g.font = `${40 * k}px "${FONT}", ${BODY}`; g.fillText(cap ? cap.toUpperCase() : r[1][r[2]], px + pw / 2, py + 260 * k);
    g.fillStyle = "#464a64"; g.font = `${24 * k}px ${BODY}`;
    const sum = `${rows[0][1][s.doubles] || ""}  ·  ${rows[1][1][s.games] || ""}  ·  ${rows[2][1][s.sets] || ""}`;
    g.fillText(sum.toLowerCase().replace(/^./, c => c.toUpperCase()), px + pw / 2, py + 320 * k); g.textAlign = "start";
    this.hint(g, W, H, k, "▲ ▼ choose   ◀ ▶ change   A play   B back");
  }

  // ---- the character select ----
  // a string of text bank $30 (names, types) from the ROM as it is now (a mod's names are patched in there)
  text(rom, i) {
    const base = NAME_BANK * 0x4000, at = rom[base + NAME_TABLE - 0x4000 + 2 * i] | rom[base + NAME_TABLE - 0x4000 + 2 * i + 1] << 8;
    let o = base + NAME_TABLE + 2 * NAME_COUNT - 0x4000 + at, t = ""; while (rom[o] && t.length < 24) { const c = rom[o++]; if (c >= 32 && c < 127) t += String.fromCharCode(c); }
    return t.trim();
  }
  // the grid's entries [{ n, id, sprite, name, type, taken, rec }] (empty ones left out), and the picks so far
  roster(gb) {
    const w = gb.mem.wram[3], rom = gb.mem.rom, out = [];
    for (let n = 0; n < 32; n++) {
      const e = W3(ENTRIES) + n * 4, id = w[e]; if (id === 0xFF) continue;
      const created = id < 4, rec = W3(CREATED) + w[e + 3] * 0x20;
      let name = created ? "" : this.text(rom, TEXT_NAME + id);
      if (created) for (let i = 0; i < 11 && w[rec + 7 + i] && w[rec + 7 + i] !== 0xFF; i++) { const c = w[rec + 7 + i]; if (c >= 32 && c < 127) name += String.fromCharCode(c); }
      out.push({ n, id, sprite: rom[SPRITE_OF + id], name: (name || "?").trim(), type: created ? "" : this.text(rom, TEXT_TYPE + rom[0x38 * 0x4000 + CHAR_TYPE_TABLE - 0x4000 + id]),
        taken: !!w[e + 2], colour: (w[e + 1] - 1) & 0xFF, lv: created ? [w[rec + 2], w[rec + 3], w[rec + 4], w[rec + 5], w[rec + 6]] : null });
    }
    return out;
  }
  // the slots this mode fills, in order (38:5C8F)
  ring(gb) {
    const rom = gb.mem.rom, mode = gb.mem.wram[3][W3(MODE)], b = 0x38 * 0x4000 - 0x4000, p = rom[b + SLOT_RING + 2 * mode] | rom[b + SLOT_RING + 2 * mode + 1] << 8, out = [];
    for (let i = 1; i < 8; i++) { const v = rom[b + p + i]; if (v > 3) break; out.push(v); }
    return out.length ? out : [0, 2];
  }
  // character ch standing (match frame 4 of its sprite set), in its colour scheme (CharPaletteIndexTable, or `scheme`: a created
  // player's chosen colour) and the look's colours where it has them
  figure(gb, ch, scheme) {
    const rom = gb.mem.rom, sc = scheme ?? charScheme(rom, ch), key = ch + ":" + sc; this.figs = this.figs || new Map();
    if (this.figLook !== gb.look) { this.figs.clear(); this.figLook = gb.look; }
    if (!this.figs.has(key)) { let c = null; try { c = matchPicture(gb, rom[SPRITE_OF + ch], 4, { fd: gb.look ? 0 : -1, scheme: sc }); } catch (e) { /* not a sprite set */ } this.figs.set(key, c); }
    return this.figs.get(key);
  }
  chars(g, W, H, k, gb) {
    const w = gb.mem.wram[3], w0 = gb.mem.wram[0], list = this.roster(gb), slot = w[W3(SLOT)], ring = this.ring(gb);
    const cur = (w0[CURSOR_X] + w0[CURSOR_Y] * 3 + w[W3(PAGE)] * 3) & 0xFF, prompt = !!w[W3(PROMPT)];
    let sel = list.findIndex(e => e.n === cur); if (sel < 0) sel = Math.max(0, list.findIndex(e => e.n > cur));
    const at = list[sel], picks = ring.map(s => ({ s, e: ring.indexOf(s) < ring.indexOf(slot) || slot > 3 ? list.find(x => x.n === w[W3(PICKS) + s]) : null }));
    this.title(g, k, SLOT_NAMES[slot] || "PLAYERS");
    this.arc(g, k, H, list.map(e => e.name.toUpperCase() + (e.taken ? " ✓" : "")), sel, 0.26);
    const { px, py, pw, ph } = this.panel(g, W, k, 96, 540);
    if (at) {
      // the figure on a stage: a soft light behind, a shadow at the feet, the pixels kept sharp
      const fx = px + pw / 2, fb = py + 300 * k, gr = g.createRadialGradient(fx, fb - 120 * k, 10 * k, fx, fb - 120 * k, 190 * k);
      gr.addColorStop(0, "rgba(255,214,90,0.55)"); gr.addColorStop(1, "rgba(255,214,90,0)"); g.fillStyle = gr; g.fillRect(px, py, pw, 320 * k);
      g.fillStyle = "rgba(40,30,10,0.18)"; g.beginPath(); g.ellipse(fx, fb, 80 * k, 16 * k, 0, 0, 6.2832); g.fill();
      const fig = this.figure(gb, at.id, at.colour), gone = at.taken && !prompt;           // (while the game asks for the CPU level the one just picked is shown)
      if (fig) {
        const s = Math.floor(Math.min(240 * k / fig.height, 200 * k / fig.width)), bob = Math.round(Math.sin(performance.now() / 420) * 3 * k);
        g.imageSmoothingEnabled = false; g.save(); if (gone) { g.filter = "grayscale(0.85)"; g.globalAlpha = 0.6; } g.drawImage(fig, fx - fig.width * s / 2, fb - fig.height * s + bob, fig.width * s, fig.height * s); g.restore();
      }
      g.textAlign = "center"; g.fillStyle = "#281e0a"; g.font = `${44 * k}px "${FONT}", ${BODY}`; g.fillText(at.name.toUpperCase(), fx, fb + 58 * k);
      g.fillStyle = "#464a64"; g.font = `${24 * k}px ${BODY}`;
      const hand = at.id >= 0x17 && at.id <= 0x1F ? [" · right-handed", " · left-handed", ""][w[W3(HANDED)]] || "" : "";
      if (at.lv) g.fillText(`LV ${at.lv[0]}   ·   SPIN ${at.lv[1]}   POWER ${at.lv[2]}   CONTROL ${at.lv[3]}   SPEED ${at.lv[4]}`, fx, fb + 94 * k);
      else g.fillText((at.type || "") + hand, fx, fb + 94 * k);
      if (gone) { g.fillStyle = "#c79a2a"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText("ALREADY PICKED", fx, py + 40 * k); }
      g.textAlign = "start";
    }
    // the bottom of the panel: the CPU level while the game asks for it, else the players picked so far
    const by = py + ph - 116 * k;
    g.strokeStyle = "rgba(70,74,100,0.18)"; g.lineWidth = 2 * k; g.beginPath(); g.moveTo(px + 30 * k, by - 14 * k); g.lineTo(px + pw - 30 * k, by - 14 * k); g.stroke();
    if (prompt) {
      g.textAlign = "center"; g.fillStyle = "#8a7a50"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText("CPU LEVEL", px + pw / 2, by + 14 * k);
      const cw = 96 * k, gap = 8 * k, x0 = px + (pw - (4 * cw + 3 * gap)) / 2, lv = w[W3(LEVEL)];
      for (let i = 0; i < 4; i++) {
        const on = i === lv, x = x0 + i * (cw + gap); g.fillStyle = on ? "#ffd65a" : "#e4e6f0"; this.mw.pill(g, x, by + 32 * k, cw, 54 * k, 18 * k); g.fill();
        g.fillStyle = on ? "#281e0a" : "#7a7f98"; g.font = `${(LEVELS[i].length > 5 ? 18 : 21) * k}px "${FONT}", ${BODY}`; g.fillText(LEVELS[i], x + cw / 2, by + 67 * k);
      }
      g.textAlign = "start";
    } else {
      const n = picks.length, cw = Math.min(150, 400 / n) * k, x0 = px + (pw - n * cw) / 2;
      picks.forEach((p, i) => {
        const x = x0 + i * cw + cw / 2, on = p.s === slot; g.textAlign = "center";
        g.fillStyle = on ? "#ffd65a" : "#e4e6f0"; g.beginPath(); g.arc(x, by + 36 * k, 34 * k, 0, 6.2832); g.fill();
        const fig = p.e ? this.figure(gb, p.e.id, p.e.colour) : null;
        if (fig) { const hh = Math.min(fig.height, Math.round(fig.width * 0.9)), s = 52 * k / Math.max(fig.width, hh); g.imageSmoothingEnabled = false; g.drawImage(fig, 0, 0, fig.width, hh, x - fig.width * s / 2, by + 36 * k - hh * s / 2, fig.width * s, hh * s); }
        else { g.fillStyle = on ? "#281e0a" : "#9aa0b8"; g.font = `${34 * k}px "${FONT}", ${BODY}`; g.fillText("?", x, by + 48 * k); }
        g.fillStyle = on ? "#281e0a" : "#7a7f98"; g.font = `${17 * k}px "${FONT}", ${BODY}`; g.fillText(SLOT_TAGS[p.s], x, by + 92 * k); g.textAlign = "start";
      });
    }
    this.hint(g, W, H, k, prompt ? "◀ ▶ level   A ok   B back" : "▲ ▼ ◀ ▶ choose   A pick   B back   START hand");
  }

  // ---- Status and Erase: the tour files, the Game Pak, the N64 ----
  files(g, W, H, k, s, gb) {
    const erase = s.mode === "erase", F = [0, 1, 2].map(i => this.mw.file(gb, i)), w3 = gb.mem.wram[3];
    const labels = [...F.map((f, i) => f ? f.name.toUpperCase() : "FILE " + (i + 1)), ...(erase ? [204, 205] : [201, 199]).map(t => this.text(gb.mem.rom, t).replace(/^Erase /, "").toUpperCase())];   // (the game's own words: Mario Char. Data / N64 Tennis Data; Erase: N64 Data / All Data)
    this.title(g, k, erase ? "ERASE" : "STATUS");
    this.arc(g, k, H, labels, s.sel, 0.4);
    const { px, py, pw, ph } = this.panel(g, W, k, 110, 500), cx = px + pw / 2, red = "#d8443a";
    if (erase) { g.lineWidth = 6 * k; g.strokeStyle = red; this.mw.pill(g, px, py, pw, ph, 30 * k); g.stroke(); }
    g.textAlign = "center";
    if (s.sel < 3) {
      const f = F[s.sel], fb = py + 290 * k;
      g.fillStyle = "#8a7a50"; g.font = `${24 * k}px "${FONT}", ${BODY}`; g.fillText("TOUR FILE " + (s.sel + 1), cx, py + 50 * k);
      if (f) {
        const gr = g.createRadialGradient(cx, fb - 110 * k, 10 * k, cx, fb - 110 * k, 170 * k); gr.addColorStop(0, erase ? "rgba(216,68,58,0.35)" : "rgba(255,214,90,0.55)"); gr.addColorStop(1, "rgba(255,214,90,0)");
        g.fillStyle = gr; g.fillRect(px, py + 60 * k, pw, 260 * k);
        g.fillStyle = "rgba(40,30,10,0.18)"; g.beginPath(); g.ellipse(cx, fb, 70 * k, 14 * k, 0, 0, 6.2832); g.fill();
        const id = w3[0x300 + s.sel * 16], fig = id < 4 ? this.figure(gb, id, w3[0x300 + s.sel * 16 + 1]) : null;
        if (fig) { const sc = Math.floor(Math.min(200 * k / fig.height, 170 * k / fig.width)); g.imageSmoothingEnabled = false; g.drawImage(fig, cx - fig.width * sc / 2, fb - fig.height * sc + Math.round(Math.sin(performance.now() / 420) * 3 * k), fig.width * sc, fig.height * sc); }
        g.fillStyle = "#281e0a"; g.font = `${44 * k}px "${FONT}", ${BODY}`; g.fillText(f.name.toUpperCase(), cx, fb + 60 * k);
        g.fillStyle = "#464a64"; g.font = `${24 * k}px ${BODY}`; g.fillText(`Level ${f.level}  ·  ${f.h} h ${String(f.m).padStart(2, "0")} m played`, cx, fb + 98 * k);
        if (erase) { g.fillStyle = red; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText("A ERASES THIS FILE", cx, fb + 140 * k); }
      } else {
        g.fillStyle = "#9aa0b8"; g.font = `${110 * k}px "${FONT}", ${BODY}`; g.fillText("—", cx, py + 250 * k);
        g.fillStyle = "#464a64"; g.font = `${26 * k}px ${BODY}`; g.fillText("No tour on this file", cx, py + 330 * k);
      }
    } else {
      const n64 = erase ? s.sel === 3 : s.sel === 4, icon = n64 ? "N64" : erase ? "ALL" : "DATA";
      g.fillStyle = erase ? red : "#ffd65a"; this.mw.pill(g, cx - 90 * k, py + 90 * k, 180 * k, 150 * k, 26 * k); g.fill();
      g.fillStyle = erase ? "#fff" : "#281e0a"; g.font = `${64 * k}px "${FONT}", ${BODY}`; g.fillText(icon, cx, py + 190 * k);
      g.fillStyle = "#281e0a"; g.font = `${38 * k}px "${FONT}", ${BODY}`; g.fillText(labels[s.sel], cx, py + 310 * k);
      g.fillStyle = "#464a64"; g.font = `${23 * k}px ${BODY}`;
      const lines = erase ? (n64 ? ["The records sent over from", "Mario Tennis on the N64"] : ["Every tour file and record", "on this Game Pak"])
                          : (n64 ? ["The records sent over from", "Mario Tennis on the N64"] : ["The Mario characters'", "exhibition and mini-game records"]);
      lines.forEach((t, i) => g.fillText(t, cx, py + 352 * k + i * 32 * k));
      if (erase) { g.fillStyle = red; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText("CANNOT BE UNDONE", cx, py + 440 * k); }
    }
    g.textAlign = "start";
    this.hint(g, W, H, k, erase ? "▲ ▼ ◀ ▶ choose   A erase   B back" : "▲ ▼ ◀ ▶ choose   A view   B back");
  }

  // ---- the Mario mini-games ----
  minigames(g, W, H, k, s, gb, hd) {
    const rom = gb.mem.rom, locked = c => c === 0x15, names = s.cells.map((c, i) => locked(c) ? "? ? ?" : this.text(rom, 0xB2 + i).toUpperCase());
    this.title(g, k, "MINI-GAMES");
    this.arc(g, k, H, names, s.sel, 0.34);
    const { px, py, pw } = this.panel(g, W, k, 110, 500), cx = px + pw / 2, c = s.cells[s.sel], fb = py + 300 * k;
    g.textAlign = "center";
    if (!locked(c)) {
      const gr = g.createRadialGradient(cx, fb - 110 * k, 10 * k, cx, fb - 110 * k, 170 * k); gr.addColorStop(0, "rgba(255,214,90,0.55)"); gr.addColorStop(1, "rgba(255,214,90,0)");
      g.fillStyle = gr; g.fillRect(px, py + 40 * k, pw, 280 * k);
      g.fillStyle = "rgba(40,30,10,0.18)"; g.beginPath(); g.ellipse(cx, fb, 70 * k, 14 * k, 0, 0, 6.2832); g.fill();
      const fig = this.figure(gb, c);
      if (fig) { const sc = Math.floor(Math.min(220 * k / fig.height, 180 * k / fig.width)); g.imageSmoothingEnabled = false; g.drawImage(fig, cx - fig.width * sc / 2, fb - fig.height * sc + Math.round(Math.sin(performance.now() / 420) * 3 * k), fig.width * sc, fig.height * sc); }
      g.fillStyle = "#8a7a50"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText(this.text(rom, TEXT_NAME + c).toUpperCase() + "'S GAME", cx, py + 48 * k);
    } else { g.fillStyle = "#9aa0b8"; g.font = `${130 * k}px "${FONT}", ${BODY}`; g.fillText("?", cx, py + 270 * k); }
    g.fillStyle = "#281e0a"; g.font = `${(names[s.sel].length > 14 ? 34 : 42) * k}px "${FONT}", ${BODY}`; g.fillText(names[s.sel], cx, fb + 62 * k);
    g.fillStyle = "#464a64"; g.font = `${24 * k}px ${BODY}`; if (locked(c)) g.fillText(this.text(rom, 0xBB) || "Not unlocked yet", cx, fb + 100 * k);   // (the game's own "can't play yet")
    g.textAlign = "start";
    this.hint(g, W, H, k, "▲ ▼ ◀ ▶ choose   A play   B back");
  }

  // ---- the small choice panels ----
  tabs(g, W, H, k, s, gb, hd) {
    const rom = gb.mem.rom, labels = s.labels || s.texts.map(t => this.text(rom, t)), locked = s.locked || [];
    this.title(g, k, s.titleText != null ? this.text(rom, s.titleText).toUpperCase() : s.title);
    this.arc(g, k, H, labels.map((l, i) => locked[i] ? "? ? ?" : l.toUpperCase()), s.sel, 0.5);
    const { px, py, pw } = this.panel(g, W, k, 130, 440), cx = px + pw / 2, on = !locked[s.sel], label = labels[s.sel] || "";
    this.icon(g, cx, py + 150 * k, k, s.icon, s.sel, on, label);
    g.textAlign = "center"; g.fillStyle = on ? "#281e0a" : "#9aa0b8"; g.font = `${(label.length > 15 ? 32 : 40) * k}px "${FONT}", ${BODY}`;
    g.fillText(on ? label.toUpperCase() : "? ? ?", cx, py + 300 * k);
    const cap = gameText(hd, 120, 144);                                        // the game's own caption ("Clear this first.", ...)
    if (cap && cap.toLowerCase() !== label.toLowerCase()) { g.fillStyle = "#464a64"; g.font = `${24 * k}px ${BODY}`; g.fillText(cap, cx, py + 345 * k); }
    // the choices as dots, the chosen one gold
    const n = labels.length; for (let i = 0; i < n; i++) { g.fillStyle = i === s.sel ? "#ffd65a" : locked[i] ? "#d0d3de" : "#a9adc2"; g.beginPath(); g.arc(cx + (i - (n - 1) / 2) * 26 * k, py + 395 * k, (i === s.sel ? 8 : 6) * k, 0, 6.2832); g.fill(); }
    g.textAlign = "start";
    this.hint(g, W, H, k, (n > 3 ? "▲ ▼ ◀ ▶" : "◀ ▶") + " choose   A ok   B back");
  }
  // ---- the erase warning ----
  confirm(g, W, H, k, s, gb) {
    const red = "#d8443a", T = (s.texts || []).map(t => this.text(gb.mem.rom, t));   // [warning 1, warning 2, question, "data? OK?"]
    this.title(g, k, "ERASE");
    this.arc(g, k, H, ["YES", "NO"], s.sel, 0.5);
    const { px, py, pw, ph } = this.panel(g, W, k, 130, 420), cx = px + pw / 2;
    g.lineWidth = 6 * k; g.strokeStyle = red; this.mw.pill(g, px, py, pw, ph, 30 * k); g.stroke();
    g.fillStyle = red; g.beginPath(); g.arc(cx, py + 85 * k, 46 * k, 0, 6.2832); g.fill();
    g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `${68 * k}px "${FONT}", ${BODY}`; g.fillText("!", cx, py + 109 * k);
    g.fillStyle = "#281e0a"; g.font = `${32 * k}px "${FONT}", ${BODY}`;
    [T[0], T[1]].forEach((t, i) => t && g.fillText(t.toUpperCase(), cx, py + 190 * k + i * 42 * k));
    g.fillStyle = "#464a64"; g.font = `${26 * k}px ${BODY}`; g.fillText([T[2], T[3]].filter(Boolean).join(" "), cx, py + 300 * k);
    g.fillStyle = s.sel === 0 ? red : "#7a7f98"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText(s.sel === 0 ? "A ERASES IT: IT CANNOT BE UNDONE" : "A KEEPS IT", cx, py + ph - 40 * k);
    g.textAlign = "start";
    this.hint(g, W, H, k, "▲ ▼ choose   A ok   B keep");
  }
  // the file-erase question: the cards as the game draws them (LCD rows 24-143, below its own question box), large and sharp
  cardConfirm(g, W, H, k, s, gb) {
    const red = "#d8443a";
    this.title(g, k, "ERASE FILE");
    this.arc(g, k, H, ["YES", "NO"], s.sel, 0.5);
    const { px, py, pw, ph } = this.panel(g, W, k, 96, 540), cx = px + pw / 2;
    g.lineWidth = 6 * k; g.strokeStyle = red; this.mw.pill(g, px, py, pw, ph, 30 * k); g.stroke();
    const fr = gb.ppu.frame, y0 = 24, ch = 120, cv = this.cardCv || (this.cardCv = document.createElement("canvas")); cv.width = 160; cv.height = ch;
    const cg = cv.getContext("2d"), im = cg.createImageData(160, ch), u32 = new Uint32Array(im.data.buffer);
    for (let y = 0; y < ch; y++) for (let x = 0; x < 160; x++) u32[y * 160 + x] = fr[(y0 + y) * 160 + x] | 0xFF000000;
    cg.putImageData(im, 0, 0);
    const sc = Math.min((pw - 40 * k) / 160, 340 * k / ch); g.imageSmoothingEnabled = false;
    g.save(); this.mw.pill(g, cx - 80 * sc, py + 24 * k, 160 * sc, ch * sc, 14 * k); g.clip(); g.drawImage(cv, cx - 80 * sc, py + 24 * k, 160 * sc, ch * sc); g.restore();
    g.textAlign = "center"; g.fillStyle = "#281e0a"; g.font = `${34 * k}px "${FONT}", ${BODY}`; g.fillText(this.text(gb.mem.rom, 313).toUpperCase(), cx, py + 24 * k + ch * sc + 52 * k);
    g.fillStyle = s.sel === 0 ? red : "#7a7f98"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText(s.sel === 0 ? "A ERASES IT: IT CANNOT BE UNDONE" : "A KEEPS IT", cx, py + ph - 30 * k);
    g.textAlign = "start";
    this.hint(g, W, H, k, "▲ ▼ choose   A ok   B keep");
  }
  // ---- the tennis dictionary ----
  // a string of text bank b, message i, as plain words: control codes dropped, a page break ({02}) a new paragraph
  textAt(rom, bank, i) {
    const base = bank * 0x4000 - 0x4000, at = rom[base + 0x4004 + 2 * i] | rom[base + 0x4004 + 2 * i + 1] << 8;
    const stub = rom[base + 0x4000] | rom[base + 0x4001] << 8, call = rom[base + stub + 4] | rom[base + stub + 5] << 8;   // (dump_text.py: the stub's ld hl, BASE)
    let p = base + call; for (let n = 0; n < 0x20 && !(rom[p] === 0x21 && rom[p - 1] === 0x56); n++) p++;
    const tb = rom[p + 1] | rom[p + 2] << 8; let o = base + tb + at, t = "";
    for (let n = 0; n < 400; n++) { const c = rom[o++]; if (!c || c === 0x03) break; t += c === 0x01 ? " " : c === 0x02 ? "\n" : c >= 32 && c < 127 ? String.fromCharCode(c) : ""; }
    return t.replace(/ +/g, " ").trim();
  }
  dictTerms(rom, mask) {
    const key = mask; if (this.dictKey === key) return this.dictList;
    const out = []; let o = 0x3F * 0x4000 - 0x4000 + 0x539E, d = 0;
    for (let n = 0; n < 400; n++) { const a = rom[o++]; if (a === 0x40) break; if (!a) continue; if (a & mask) out.push(d); d++; }
    this.dictKey = key; return (this.dictList = out);
  }
  // the grid's letter groups (A-Z): the first term of each and how many
  dictGroups(rom) {
    if (this.dictG) return this.dictG;
    const G = []; let o = 0x3F * 0x4000 - 0x4000 + 0x539E, n = 0, cur = { first: 0, count: 0 };
    for (let i = 0; i < 400; i++) { const a = rom[o++]; if (a === 0x40) break; if (!a) { G.push(cur); cur = { first: n, count: 0 }; continue; } cur.count++; n++; }
    G.push(cur); return (this.dictG = G);
  }
  dictIndex(g, W, H, k, gb) {
    const rom = gb.mem.rom, w = gb.mem.wram[0], G = this.dictGroups(rom), first = Array.from({ length: 9 }, (_, r) => rom[0x3F * 0x4000 - 0x4000 + 0x545F + r]);
    const letter = i => this.textAt(rom, 0x35, 143 + i), rows = first.map((a, r) => { const b = (r < 8 ? first[r + 1] : G.length) - 1; return a === b ? letter(a) : letter(a) + " – " + letter(b); });
    const sel = Math.min(8, w[0xB2E]), a = first[sel], b = sel < 8 ? first[sel + 1] : G.length;
    this.title(g, k, "DICTIONARY");
    this.arc(g, k, H, rows, sel, 0.3);
    const { px, py, pw, ph } = this.panel(g, W, k, 96, 540), cx = px + pw / 2;
    // the row's letters as tiles, then its terms
    const L = []; for (let i = a; i < b; i++) L.push(i);
    const tw = Math.min(70, 360 / L.length) * k; g.textAlign = "center";
    L.forEach((i, j) => { const x = cx + (j - (L.length - 1) / 2) * (tw + 10 * k); g.fillStyle = G[i] && G[i].count ? "#ffd65a" : "#e4e6f0"; this.mw.pill(g, x - tw / 2, py + 30 * k, tw, tw, 12 * k); g.fill();
      g.fillStyle = G[i] && G[i].count ? "#281e0a" : "#9aa0b8"; g.font = `${tw * 0.6}px "${FONT}", ${BODY}`; g.fillText(letter(i), x, py + 30 * k + tw * 0.72); });
    const terms = []; for (let i = a; i < b; i++) if (G[i]) for (let t = 0; t < G[i].count; t++) terms.push(G[i].first + t);
    g.fillStyle = "#8a7a50"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText(terms.length + (terms.length === 1 ? " TERM" : " TERMS"), cx, py + 30 * k + tw + 44 * k);
    g.fillStyle = "#281e0a"; g.font = `${25 * k}px ${BODY}`;
    const top = py + 30 * k + tw + 84 * k, rowsFit = Math.floor((py + ph - 30 * k - top) / (32 * k)), cols = terms.length > rowsFit ? 2 : 1;
    terms.slice(0, rowsFit * cols).forEach((t, j) => { const c = cols === 2 ? Math.floor(j / rowsFit) : 0, r = cols === 2 ? j % rowsFit : j;
      g.fillText(this.dictName(rom, t), cols === 2 ? px + pw * (c ? 0.73 : 0.27) : cx, top + r * 32 * k); });
    g.textAlign = "start";
    this.hint(g, W, H, k, "▲ ▼ choose   A open   B back");
  }
  dictName(rom, i) { return i < 47 ? this.textAt(rom, 0x34, 240 + i) : this.textAt(rom, 0x35, i - 47); }
  dict(g, W, H, k, gb) {
    const rom = gb.mem.rom, w = gb.mem.wram[0], terms = this.dictTerms(rom, w[0xB32]), n = terms.length || 1;
    const sel = (w[0xB2D] + w[0xB2E]) % n, term = terms[sel] ?? 0;
    this.title(g, k, "DICTIONARY");
    this.arc(g, k, H, terms.map(t => this.dictName(rom, t).toUpperCase()), sel, 0.26);
    const { px, py, pw, ph } = this.panel(g, W, k, 96, 540), cx = px + pw / 2;
    g.textAlign = "center"; g.fillStyle = "#8a7a50"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText(`${sel + 1} / ${terms.length}`, cx, py + 46 * k);
    const name = this.dictName(rom, term); g.fillStyle = "#281e0a"; g.font = `${(name.length > 14 ? 36 : 46) * k}px "${FONT}", ${BODY}`; g.fillText(name.toUpperCase(), cx, py + 100 * k);
    // the definition, wrapped to the panel; its pages as paragraphs
    g.fillStyle = "#464a64"; g.font = `${25 * k}px ${BODY}`; g.textAlign = "start";
    let y = py + 160 * k; const maxW = pw - 70 * k, x0 = px + 35 * k;
    for (const para of this.textAt(rom, 0x35, 48 + term).split("\n")) {
      let line = ""; for (const word of para.split(" ")) { const t = line ? line + " " + word : word; if (g.measureText(t).width > maxW && line) { g.fillText(line, x0, y); y += 34 * k; line = word; } else line = t; }
      if (line) { g.fillText(line, x0, y); y += 34 * k; } y += 12 * k; if (y > py + ph - 30 * k) break;
    }
    this.hint(g, W, H, k, "▲ ▼ choose   ◀ ▶ letter   A read   B back");
  }
  // an icon for a choice: players (one ball or two), a level's medal, a data chart, the N64
  icon(g, x, y, k, kind, i, on, label) {
    g.save(); if (!on) g.globalAlpha = 0.4;
    if (kind === "players") { const n = i + 1; for (let j = 0; j < n; j++) this.mw.menuBall(g, x + (j - (n - 1) / 2) * 120 * k, y, 62 * k, performance.now() / 1600 + j); }
    else if (kind === "level") {
      const cols = ["#d9a35a", "#c9ced8", "#ffd65a"], r = 78 * k;
      g.fillStyle = "#3d6fd8"; g.beginPath(); g.moveTo(x - 40 * k, y - r - 30 * k); g.lineTo(x - 10 * k, y - r + 20 * k); g.lineTo(x + 10 * k, y - r + 20 * k); g.lineTo(x + 40 * k, y - r - 30 * k); g.fill();   // the ribbon
      g.fillStyle = cols[i % 3]; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); g.lineWidth = 6 * k; g.strokeStyle = "rgba(0,0,0,0.18)"; g.stroke();
      g.fillStyle = "#281e0a"; g.textAlign = "center"; g.font = `${96 * k}px "${FONT}", ${BODY}`; g.fillText(on ? String(i + 1) : "?", x, y + 34 * k);
    } else if (kind === "data") {
      g.fillStyle = "#e4e6f0"; this.mw.pill(g, x - 110 * k, y - 80 * k, 220 * k, 160 * k, 20 * k); g.fill();
      [0.5, 0.8, 0.35, 0.95, 0.65].forEach((h, j) => { g.fillStyle = j === 3 ? "#ffb43a" : "#7a9be0"; g.fillRect(x - 85 * k + j * 36 * k, y + 60 * k - h * 120 * k, 24 * k, h * 120 * k); });
    } else {
      g.fillStyle = "#3a3f9a"; this.mw.pill(g, x - 100 * k, y - 75 * k, 200 * k, 150 * k, 26 * k); g.fill();
      g.fillStyle = "#fff"; g.textAlign = "center"; g.font = `${66 * k}px "${FONT}", ${BODY}`; g.fillText("N64", x, y + 24 * k);
    }
    g.restore(); g.textAlign = "start";
  }

  // ---- the court select ----
  courtPic(gb, mapId) {
    if (!this.rom) this.rom = new Rom(gb.mem.rom);
    if (!this.courts.has(mapId)) { let c = null; try { c = courtImage(this.rom, mapId); } catch (e) { /* not a court picture */ } this.courts.set(mapId, c); }
    return this.courts.get(mapId);
  }
  court(g, W, H, k, s, gb) {
    const names = s.ids.map((c, i) => s.locked[i] ? "? ? ?" : COURT_NAMES[c] || "COURT " + (c + 1));
    this.title(g, k, "COURT");
    this.arc(g, k, H, names, s.sel);
    const c = s.ids[s.sel] ?? 0, locked = s.locked[s.sel], rom = gb.mem.rom, row = 8 * 0x4000 + COURT_TABLE - 0x4000 + c * 4;
    const fr = rom[row], bo = rom[row + 1], mapId = rom[row + 2];
    const { px, py, pw } = this.panel(g, W, k, 96, 520);
    // the film: the court's own picture, the camera gliding over it (a ground plane drawn row by row), a rally on it
    const fx = px + 24 * k, fy = py + 24 * k, fw = pw - 48 * k, fh = 250 * k, T = performance.now() / 1000 - this.t0;
    g.save(); this.mw.pill(g, fx, fy, fw, fh, 18 * k); g.clip();
    const pic = locked ? null : this.courtPic(gb, mapId);
    if (pic) this.film(g, pic, fx, fy, fw, fh, T); else { g.fillStyle = "#2a2f45"; g.fillRect(fx, fy, fw, fh); g.fillStyle = "#8a90b0"; g.font = `${90 * k}px "${FONT}", ${BODY}`; g.textAlign = "center"; g.fillText("?", fx + fw / 2, fy + fh / 2 + 32 * k); g.textAlign = "start"; }
    g.restore();
    g.textAlign = "center"; g.fillStyle = "#281e0a"; g.font = `${42 * k}px "${FONT}", ${BODY}`; g.fillText(names[s.sel], px + pw / 2, fy + fh + 64 * k);
    g.fillStyle = "#464a64"; g.font = `${23 * k}px ${BODY}`; g.fillText(locked ? "Not unlocked yet" : COURT_LINES[c] || "A bonus court", px + pw / 2, fy + fh + 102 * k); g.textAlign = "start";
    if (!locked) {                                                        // ball speed and bounce, from the court's own bytes
      const bar = (label, v, y) => {
        g.fillStyle = "#7a7f98"; g.font = `${22 * k}px "${FONT}", ${BODY}`; g.fillText(label, px + 40 * k, y + 18 * k);
        const bx = px + 200 * k, bw = pw - 240 * k; g.fillStyle = "#e4e6f0"; this.mw.pill(g, bx, y, bw, 22 * k, 11 * k); g.fill();
        g.fillStyle = "#ffb43a"; this.mw.pill(g, bx, y, Math.max(22 * k, bw * Math.min(1, Math.max(0.08, v))), 22 * k, 11 * k); g.fill();
      };
      bar("BALL SPEED", (fr - 150) / 100, fy + fh + 128 * k); bar("BOUNCE", (bo - 130) / 110, fy + fh + 166 * k);
    }
    this.hint(g, W, H, k, "▲ ▼ ◀ ▶ choose   A play   B back");
  }
  // a court seen from a camera gliding in low over its near baseline: each screen row below the horizon is a row of the picture
  // (the ground plane), scaled by its distance; a ball crosses it on an arc, bouncing once each way
  film(g, pic, x, y, w, h, T) {
    const N = Math.min(256, pic.width), hy = y + h * 0.3, rows = Math.ceil(y + h - hy), cam = 0.5 + 0.5 * Math.sin(T * 0.25);   // (the court: the map's first 32 x 32 tiles)
    const camY = N * (1.02 - 0.16 * cam), camX = N / 2 + N * 0.05 * Math.sin(T * 0.17), H0 = N * 0.17, tan = 0.95;
    const sky = g.createLinearGradient(0, y, 0, hy); sky.addColorStop(0, "#1a2a5a"); sky.addColorStop(1, "#6a8ac8"); g.fillStyle = sky; g.fillRect(x, y, w, hy - y + 1);
    g.imageSmoothingEnabled = false;
    for (let r = 0; r < rows; r++) {
      const p = (r + 0.5) / rows, dist = H0 / p, v = camY - dist; if (v < 0) continue;
      const hw = dist * tan, sx = camX - hw;
      g.drawImage(pic, Math.max(0, sx), v, Math.min(N, sx + 2 * hw) - Math.max(0, sx), 1, x + (Math.max(0, sx) - sx) / (2 * hw) * w, hy + r, (Math.min(N, sx + 2 * hw) - Math.max(0, sx)) / (2 * hw) * w, 1.5);
    }
    // the ball: from the near court to the far one and back (2 s a crossing), a bounce in each half
    const u = (T % 4) / 2, back = u > 1, q = back ? u - 1 : u, by = back ? N * (0.25 + 0.5 * q) : N * (0.75 - 0.5 * q), bxx = N / 2 + N * 0.12 * Math.sin(T * 1.3);
    const hgt = Math.abs(Math.sin(q * Math.PI * 2)) * N * 0.05, dist = camY - by; if (dist <= 2) return;
    const p = H0 / dist, sy = hy + p * rows, sxx = x + w / 2 + (bxx - camX) / (dist * tan) * w / 2, rr = Math.max(2, 3 * p * w / N * 2.2);
    g.fillStyle = "rgba(0,0,0,0.35)"; g.beginPath(); g.ellipse(sxx, sy, rr, rr * 0.4, 0, 0, 6.2832); g.fill();
    const gy = sy - hgt * p * (w / N) * 2.4; g.fillStyle = "#e8f04a"; g.beginPath(); g.arc(sxx, gy - rr, rr, 0, 6.2832); g.fill();
  }
}

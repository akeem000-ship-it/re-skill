// The creator ("Appearance"): pick the boy's or the girl's hairstyle and colours with a live preview from the
// game's own frames. Offered when the game's Create a Character screen is up (both heroes' portraits in VRAM)
// and from the LOOK button. The look is kept in localStorage (the last one, and one per story save slot),
// applied at ROM load (LookManager.prepare) and changed in play with LookManager.set.
import { LookManager, normalizeLook, lookKey, PRESETS, SWATCHES, css15, rgb15 } from "./index.js";
import { normalizeMod } from "./mods.js";
import { STYLES } from "./label.js";
import { heroPreview, blit, POSES, detailPoses } from "./preview.js";
import { FACE, FACE_LABEL, normalizeFace } from "./portrait.js";
import { hdFaceCanvas } from "./hdface.js";
import { SpriteDetail } from "./spritedetail.js";
import { faceColours } from "./faces.js";
import { lzDecompress } from "./lz.js";
import { HEROES } from "./build.js";

const KEY = "mt-look", SLOT_KEY = n => "mt-look-slot-" + n;
const load = k => { try { return normalizeLook(JSON.parse(localStorage.getItem(k) || "null")); } catch (e) { return null; } };
const save = (k, v) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch (e) { /* private mode */ } };
// opponent mods (mods.js): the library (imported files are kept here; bundled ones are fetched from mods/index.json at each
// start), and which are on. The stored looks never hold the mods: the enabled ones are merged in whenever a look is applied.
const MODS_LIB = "mt-mods-lib", MODS_ON = "mt-mods-on";
const stripMods = look => { if (!look) return look; const o = { ...look }; delete o.mods; return normalizeLook(o); };
const STYLE_LABEL = { cap: "Cap", headband: "Headband", ponytail: "Ponytail", short: "Short hair", pigtails: "Pigtails", bob: "Bob", afro: "Afro", puffs: "Puffs", cornrows: "Cornrows", locs: "Locs", braids: "Box braids", fade: "Fade", twists: "Twists", long: "Long hair" };
const FACE_ROWS = [["shape", "Face shape", FACE.shapes], ["eyes", "Eyes", FACE.eyes], ["brows", "Eyebrows", FACE.brows], ["mouth", "Mouth", FACE.mouths]];
const PARTS = [["skin", "Skin", "skin"], ["hair", "Hair", "hair"], ["hat", "Hat / band", "cloth"], ["top", "Top", "cloth"], ["bottom", "Shorts / skirt", "cloth"], ["shoes", "Shoes", "cloth"], ["racket", "Racket", "cloth"]];
const WRAM_STORY_SLOT = 0x36C, WRAM_HANDEDNESS = 0xB50;   // wCurrentStorySlot $C36C, wCharSelectHandedness $CB50
// story mode's junior class titles (wGameFlags $C9C0: flag n is byte n >> 3, bit $80 >> (n & 7)): singles $53, doubles $42
const JUNIOR_TITLE = [[0x9C0 + (0x53 >> 3), 0x80 >> (0x53 & 7)], [0x9C0 + (0x42 >> 3), 0x80 >> (0x42 & 7)]];

const CSS = `
#lookpanel { position: fixed; inset: 0; z-index: 20; background: rgba(8,10,16,.72); display: flex; align-items: flex-start; justify-content: center; overflow-y: auto; padding: 12px 8px; box-sizing: border-box; }
#lookpanel[hidden] { display: none; }
#lookpanel .card { background: #1d2230; color: #eee; border: 1px solid #444b5e; border-radius: 12px; width: 100%; max-width: 520px; padding: 12px 14px 14px; box-sizing: border-box; font: 14px system-ui, sans-serif; }
#lookpanel h2 { margin: 0 0 8px; font-size: 18px; display: flex; align-items: center; justify-content: space-between; }
#lookpanel .x { background: none; border: 0; color: #ccc; font-size: 22px; cursor: pointer; padding: 0 4px; }
#lookpanel .row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
#lookpanel .lab { width: 100%; font-size: 12px; color: #aab; margin-top: 6px; }
#lookpanel .chip { background: #2c3140; border: 1px solid #555; border-radius: 16px; color: #fff; padding: 4px 11px; cursor: pointer; font-size: 13px; }
#lookpanel .chip.on { background: #e05a2a; border-color: #ff9a6a; }
#lookpanel .sw { width: 26px; height: 26px; border-radius: 6px; border: 2px solid #0000; box-shadow: inset 0 0 0 1px #0006; cursor: pointer; padding: 0; }
#lookpanel .sw.on { border-color: #fff; }
#lookpanel .sw.none { background: repeating-linear-gradient(45deg,#555 0 4px,#333 4px 8px); }
#lookpanel .custom { position: relative; width: 26px; height: 26px; border-radius: 13px; background: conic-gradient(red, yellow, lime, cyan, blue, magenta, red); cursor: pointer; border: 2px solid #0000; box-sizing: border-box; }
#lookpanel .custom.on { border-color: #fff; }
#lookpanel .custom input { position: absolute; inset: 0; opacity: 0; width: 100%; height: 100%; cursor: pointer; }
#lookpanel canvas { position: static; transform: none; aspect-ratio: auto; width: 100%; max-width: 392px; height: auto; margin: 4px auto; image-rendering: pixelated; background: #4a8a58; border-radius: 8px; display: block; }
#lookpanel .acts { display: flex; gap: 8px; justify-content: flex-end; margin-top: 12px; flex-wrap: wrap; }
#lookpanel .btn { background: #2c3140; border: 1px solid #666; border-radius: 8px; color: #fff; padding: 7px 14px; cursor: pointer; font-size: 14px; }
#lookpanel .btn.go { background: #e05a2a; border-color: #ff9a6a; }
#lookpanel .note { font-size: 12px; color: #aab; }
#lookoffer { position: fixed; left: 50%; top: 10px; transform: translateX(-50%); z-index: 15; background: #e05a2a; color: #fff; border: 2px solid #ffd0b0; border-radius: 20px; padding: 7px 16px; font: 600 14px system-ui, sans-serif; cursor: pointer; box-shadow: 0 3px 12px #0008; }
#lookoffer[hidden] { display: none; }
body.touch #lookoffer { top: 44px; }
`;

export function mountCreator({ hud, keys, pause, onChange }) {
  const mgr = new LookManager();
  // "Sprites: Game / Detailed": the characters redrawn at 3x from their own pixels (spritedetail.js); kept per browser, ?sprites=detail|game overrides
  const SPR_KEY = "mt-sprites", detail = new SpriteDetail();
  let sprMode = (() => { const q = new URLSearchParams(location.search).get("sprites"); if (q === "detail" || q === "game") return q; try { return localStorage.getItem(SPR_KEY) === "detail" ? "detail" : "game"; } catch (e) { return "game"; } })();
  let gb = null, open = false, draft = null, hero = "boy", pristine = null, detectAt = 0, onPick = false, offered = false, lastSlot = -1, pressFrames = 0, wasPaused = false;
  let portraitSets = null, inStory = false, seniorUp = true;
  // mods' "from": "senior" characters: their look only outside story mode (the map last walked is not an RPG map) or once a junior
  // class title is won; re-checked with the look detection and the look rebuilt when it changes
  mgr.gate = ch => ch.from !== "senior" || seniorUp;
  // the switched-on mods' character `ch` (a roster id) as it plays now (gated), or null: its lines (intro.js, matchfx.js)
  const modChar = ch => { const L = mgr.look; for (const m of (L && L.mods) || []) for (const c of m.chars) if (c.char === ch && mgr.gate(c)) return c; return null; };
  const gateNow = () => {
    const w = gb.mem.wram[0], map = w[0x32E];
    if (map >= 17 && map <= 36) inStory = true; else if (map === 16) inStory = false;   // (a court keeps what led to it)
    return !inStory || JUNIOR_TITLE.some(([a, m]) => w[a] & m);
  };
  // ---- mods: library = id -> { def, bundled } ; prefs = id -> bool (explicit choices; a bundled mod is on until switched off)
  const library = new Map(); let prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(MODS_ON) || "{}") || {}; } catch (e) { prefs = {}; }
  try { for (const m of JSON.parse(localStorage.getItem(MODS_LIB) || "[]")) { const d = normalizeMod(m); if (d) library.set(d.id, { def: d, bundled: false }); } } catch (e) { /* none */ }
  const ready = (async () => {                                    // a private build bundles mods/*.json and lists them in mods/index.json
    try {
      const r = await fetch("mods/index.json"); if (!r.ok) return;
      for (const n of await r.json()) { try { const d = normalizeMod(await (await fetch("mods/" + n)).json()); if (d) library.set(d.id, { def: d, bundled: true }); } catch (e) { /* skip */ } }
    } catch (e) { /* no bundled mods */ }
  })();
  const isOn = id => id in prefs ? !!prefs[id] : !!(library.get(id) && library.get(id).bundled);
  const modsNow = () => [...library].filter(([id]) => isOn(id)).map(([, v]) => v.def);
  const withMods = look => { const o = look ? { ...look } : { boy: null, girl: null }, mods = modsNow(); if (mods.length) o.mods = mods; else delete o.mods; return normalizeLook(o); };
  function saveMods(look) {
    const on = new Set(((look && look.mods) || []).map(m => m.id));
    for (const id of library.keys()) prefs[id] = on.has(id);
    try { localStorage.setItem(MODS_ON, JSON.stringify(prefs)); localStorage.setItem(MODS_LIB, JSON.stringify([...library.values()].filter(v => !v.bundled).map(v => v.def))); } catch (e) { /* private mode */ }
  }
  import("../hdui.js").then(() => import("./hdportrait.js")).then(m => m.installHDPortraits()).catch(() => { /* no HD UI on this page */ });
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  const btn = document.createElement("span"); btn.className = "k"; btn.id = "lookbtn"; btn.textContent = "LOOK"; btn.title = "your player's appearance (hairstyle and colours)";
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(btn);
  const sprBtn = document.createElement("span"); sprBtn.className = "k"; sprBtn.id = "sprbtn"; sprBtn.title = "sprites: the game's own, or redrawn at 3x resolution with outlines, shading and faces with expressions";
  const showSpr = () => { sprBtn.textContent = "SPRITES: " + (sprMode === "detail" ? "Detailed" : "Game"); sprBtn.classList.toggle("on", sprMode === "detail"); };
  function setSprites(mode) {
    sprMode = mode; showSpr(); try { localStorage.setItem(SPR_KEY, mode); } catch (e) { /* private mode */ }
    mgr.setDetail(mode === "detail"); detail.setEnabled(mode === "detail");
  }
  sprBtn.addEventListener("pointerdown", () => setSprites(sprMode === "detail" ? "game" : "detail"));
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(sprBtn); showSpr();
  const offer = document.createElement("button"); offer.id = "lookoffer"; offer.hidden = true; offer.textContent = "✦ Customize your player's look";
  document.body.appendChild(offer);
  const panel = document.createElement("div"); panel.id = "lookpanel"; panel.hidden = true;
  panel.innerHTML = `<div class="card" role="dialog" aria-label="Appearance">
    <h2>Appearance <button class="x" aria-label="close">×</button></h2>
    <div class="row" data-k="hero"></div>
    <canvas width="392" height="196"></canvas>
    <canvas class="faces" width="392" height="104" title="the portrait, win and lose faces and HUD heads"></canvas>
    <canvas class="hdfaces" width="392" height="100" title="the same faces in the HD UI"></canvas>
    <canvas class="dposes" width="392" height="100" title="Sprites: Detailed - the court frames redrawn at 3x, with the face's expression (stand, swing, point won, point lost)"></canvas>
    <div class="lab">Presets</div><div class="row" data-k="presets"></div>
    <div class="lab">Hairstyle</div><div class="row" data-k="style"></div>
    <div class="lab">Portraits</div><div class="row" data-k="portraits"></div>
    <div class="note" data-k="pnote"></div>
    <div data-k="face"></div>
    <div data-k="colours"></div>
    <div class="row"><label class="note"><input type="checkbox" data-k="lefty"> Left-handed (the game's START: Change Hands on Create a Character)</label></div>
    <div class="lab">Mods</div><div data-k="mods"></div>
    <div class="note" data-k="msg"></div>
    <div class="acts"><button class="btn" data-k="classic">Game's look</button><button class="btn" data-k="cancel">Cancel</button><button class="btn go" data-k="apply">Apply</button></div>
  </div>`;
  document.body.appendChild(panel);
  const q = k => panel.querySelector(`[data-k="${k}"]`), cv = panel.querySelector("canvas"), ctx = cv.getContext("2d"), fcv = panel.querySelector("canvas.faces"), fctx = fcv.getContext("2d"), hcv = panel.querySelector("canvas.hdfaces"), hctx = hcv.getContext("2d"), dcv = panel.querySelector("canvas.dposes"), dctx = dcv.getContext("2d");
  const name = () => hero === "boy" ? "alex" : "nina";

  function cur() { return draft[hero]; }
  function ensure() {
    if (!draft[hero]) { const base = PRESETS[hero][1].look; draft[hero] = { style: STYLES[name()][0], colours: { ...base.colours }, face: normalizeFace(null, hero) }; }
    return draft[hero];
  }
  function chip(label, on, fn) { const b = document.createElement("button"); b.className = "chip" + (on ? " on" : ""); b.textContent = label; b.onclick = fn; return b; }
  function render() {
    const hn = q("hero"); hn.replaceChildren(chip("Boy", hero === "boy", () => { hero = "boy"; render(); }), chip("Girl", hero === "girl", () => { hero = "girl"; render(); }));
    const pr = q("presets"); pr.replaceChildren(...PRESETS[hero].map(p => chip(p.name, lookKey({ [hero]: p.look }) === lookKey({ [hero]: cur() }), () => { draft[hero] = p.look ? JSON.parse(JSON.stringify(p.look)) : null; render(); })));
    const c = cur();
    q("style").replaceChildren(...STYLES[name()].map(s => chip(STYLE_LABEL[s] || s, c && c.style === s, () => { ensure().style = s; render(); })));
    const redrawn = draft.portraits === "redrawn";
    q("portraits").replaceChildren(chip("Game", !redrawn, () => { delete draft.portraits; render(); }), chip("Redrawn", redrawn, () => { draft.portraits = "redrawn"; render(); }));
    q("pnote").textContent = redrawn ? "Redrawn: the portrait kit's faces (24 / 32 / 16 px in the game, 96 px in the HD UI). Face options below." : "Game: the game's own portraits, win / lose faces and heads, recoloured by your skin, hair, hat and top colours.";
    hcv.style.display = redrawn ? "block" : "none";
    const fb = q("face"); fb.replaceChildren();
    const face = normalizeFace(c && c.face, hero), setFace = patch => { const L = ensure(); L.face = normalizeFace({ ...normalizeFace(L.face, hero), ...patch }, hero); render(); };
    if (redrawn) for (const [k, label, list] of FACE_ROWS) {
      const lab = document.createElement("div"); lab.className = "lab"; lab.textContent = label; fb.appendChild(lab);
      const row = document.createElement("div"); row.className = "row";
      for (const v of list) row.appendChild(chip(FACE_LABEL[v] || v, face[k] === v, () => setFace({ [k]: v })));
      fb.appendChild(row);
    }
    if (redrawn) {
      const lab = document.createElement("div"); lab.className = "lab"; lab.textContent = "Extras"; fb.appendChild(lab);
      const row = document.createElement("div"); row.className = "row";
      for (const v of FACE.extras) row.appendChild(chip(FACE_LABEL[v] || v, face.extras.includes(v), () => setFace({ extras: face.extras.includes(v) ? face.extras.filter(e => e !== v) : [...face.extras, v] })));
      fb.appendChild(row);
    }
    const box = q("colours"); box.replaceChildren();
    for (const [k, label, set] of PARTS) {
      const lab = document.createElement("div"); lab.className = "lab"; lab.textContent = label; box.appendChild(lab);
      const row = document.createElement("div"); row.className = "row";
      const val = c && c.colours ? c.colours[k] : undefined;
      if (k === "shoes" || k === "racket") { const b = document.createElement("button"); b.className = "sw none" + (val === undefined ? " on" : ""); b.title = k === "shoes" ? "as the shorts" : "the game's"; b.onclick = () => { delete ensure().colours[k]; render(); }; row.appendChild(b); }
      for (const v of SWATCHES[set]) { const b = document.createElement("button"); b.className = "sw" + (val === v ? " on" : ""); b.style.background = css15(v); b.title = css15(v); b.onclick = () => { ensure().colours[k] = v; render(); }; row.appendChild(b); }
      const cust = document.createElement("label"); cust.className = "custom" + (val !== undefined && !SWATCHES[set].includes(val) ? " on" : ""); cust.title = "any colour (rounded to the Game Boy Color's 15 bits)";
      const inp = document.createElement("input"); inp.type = "color"; cust.appendChild(inp);
      if (val !== undefined) inp.value = "#" + [val & 31, (val >> 5) & 31, (val >> 10) & 31].map(x => (x * 255 / 31 | 0).toString(16).padStart(2, "0")).join("");
      inp.oninput = () => { const h = inp.value; ensure().colours[k] = rgb15(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)); render(); };
      row.appendChild(cust); box.appendChild(row);
    }
    q("lefty").checked = !!(c && c.lefty); q("lefty").onchange = e => { ensure().lefty = e.target.checked || undefined; render(); };
    renderMods();
    drawPreview();
  }
  function renderMods() {
    const box = q("mods"); box.replaceChildren();
    const on = new Set((draft.mods || []).map(m => m.id));
    for (const [id, v] of library) {
      const row = document.createElement("div"); row.className = "row";
      const lab = document.createElement("label"); lab.className = "note"; const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = on.has(id);
      cb.onchange = () => { draft.mods = (draft.mods || []).filter(m => m.id !== id); if (cb.checked) draft.mods.push(v.def); render(); };
      lab.append(cb, " " + (v.def.title || id) + " (" + v.def.chars.length + " characters)"); row.appendChild(lab); box.appendChild(row);
    }
    const row = document.createElement("div"); row.className = "row";
    const imp = document.createElement("label"); imp.className = "btn"; imp.textContent = "Import a mod file…";
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".json,application/json"; inp.hidden = true;
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try { const d = normalizeMod(JSON.parse(await f.text())); if (!d) throw new Error("not a mod file"); library.set(d.id, { def: d, bundled: false }); draft.mods = (draft.mods || []).filter(m => m.id !== d.id).concat([d]); q("msg").textContent = "Imported \"" + (d.title || d.id) + "\": Apply to switch it on."; }
      catch (e) { q("msg").textContent = "Could not read that mod file: " + e.message; }
      renderMods();
    };
    imp.appendChild(inp); row.appendChild(imp); box.appendChild(row);
  }
  let anim = 0, hdKey = "", dKey = "";
  function drawPreview() {
    if (!pristine) return;
    const n = name(), L = cur(), redrawn = draft.portraits === "redrawn", P = heroPreview(pristine, n, L, (anim >> 1) & 1, redrawn);
    ctx.fillStyle = "#4a8a58"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#c48a3a"; ctx.fillRect(0, 0, cv.width, 80);           // a path for the overworld row
    P.walk.forEach((im, i) => blit(ctx, im, 10 + i * 66, 8, 4));
    blit(ctx, P.portrait, 290, 4, 3);
    fctx.fillStyle = "#2a2f3e"; fctx.fillRect(0, 0, fcv.width, fcv.height);
    blit(fctx, P.portrait, 6, 6, 4); blit(fctx, P.faces[0], 108, 4, 3); blit(fctx, P.faces[1], 210, 4, 3);
    { const hero = n === "alex" ? "boy" : "girl", base = { hero, style: L && L.style || undefined, face: L && L.face, colours: faceColours(hero, L && L.colours) };
      const key = JSON.stringify([L && base, redrawn]);
      if (redrawn && key !== hdKey) {                                                  // the vector art is drawn once per change
        hdKey = key; hctx.fillStyle = "#2a2f3e"; hctx.fillRect(0, 0, hcv.width, hcv.height);
        if (L) ["neutral", "win", "lose"].forEach((mood, i) => hctx.drawImage(hdFaceCanvas({ ...base, mood }, 96), 4 + i * 100, 2, 96, 96));
        else { hctx.fillStyle = "#aab"; hctx.font = "13px system-ui"; hctx.fillText("the game's own faces", 10, 50); }
      } }
    { const key = JSON.stringify([n, L]);
      if (key !== dKey) {                                               // the detailed court frames, redrawn when the look changes
        dKey = key; dctx.fillStyle = "#3a6e9a"; dctx.fillRect(0, 0, dcv.width, dcv.height);
        detailPoses(pristine, n, L).forEach((im, i) => { const c = document.createElement("canvas"); c.width = im.w; c.height = im.h; c.getContext("2d").putImageData(new ImageData(im.data, im.w, im.h), 0, 0); dctx.imageSmoothingEnabled = false; dctx.drawImage(c, Math.round(4 + i * 98 + (94 - im.w) / 2), 2); });
      } }
    fctx.fillStyle = "#4a8a58"; fctx.fillRect(314, 6, 76, 40); blit(fctx, P.heads[0], 318, 8, 2); blit(fctx, P.heads[1], 354, 8, 2);
    ctx.fillStyle = "#3a6e9a"; ctx.fillRect(0, 80, cv.width, cv.height - 80); ctx.fillStyle = "#e8eef4"; ctx.fillRect(0, 188, cv.width, 2);
    const lefty = !!(L && L.lefty);
    P.poses.slice(0, 5).forEach((im, i) => blit(ctx, im, 4 + i * 78, 86, 3, lefty));
  }
  setInterval(() => { if (open) { anim++; drawPreview(); } }, 260);

  function openPanel() {
    if (!gb) return;
    draft = JSON.parse(JSON.stringify(mgr.look || { boy: null, girl: null }));
    if (!("boy" in draft)) draft.boy = null; if (!("girl" in draft)) draft.girl = null;
    // the hero being created / played: the girl when the save's main character is Nina
    open = true; panel.hidden = false; offer.hidden = true; wasPaused = pause(true);
    q("msg").textContent = onPick ? "You're creating your player: Apply, then pick the boy or the girl as usual." : "Changes show at once; the faces in menus update when their screen is next drawn.";
    render();
  }
  function closePanel() { open = false; panel.hidden = true; pause(wasPaused); }
  btn.addEventListener("pointerdown", openPanel);
  offer.addEventListener("click", () => { offered = true; openPanel(); });
  panel.querySelector(".x").onclick = closePanel; q("cancel").onclick = closePanel;
  panel.addEventListener("pointerdown", e => { if (e.target === panel) closePanel(); });
  q("classic").onclick = () => { draft[hero] = null; render(); };
  q("apply").onclick = () => {
    const look = normalizeLook(draft);
    apply(look, true);
    const L = look && look[hero];
    if (L && L.lefty && onPick && gb && !gb.mem.wram[0][WRAM_HANDEDNESS]) pressFrames = 6;   // press START (Change Hands) for the player
    closePanel();
  };
  function apply(look, store) {
    if (lookKey(look) === lookKey(mgr.look)) return;
    mgr.set(look);
    if (store) { saveMods(look); save(KEY, stripMods(look)); const s = gb ? gb.mem.wram[0][WRAM_STORY_SLOT] : -1; if (s >= 0 && s < 3) save(SLOT_KEY(s), look); }
    onChange(mgr.look);
  }
  function portraitKeys(rom) {
    const sets = {};
    for (const n of ["alex", "nina"]) {
      const s = new Set(), [b, a] = HEROES[n].portraits[0], { data } = lzDecompress(rom, b * 0x4000 + a - 0x4000);
      for (let t = 0; t < 9; t++) { let k = ""; for (let i = 0; i < 16; i++) k += String.fromCharCode(data[t * 16 + i]); s.add(k); }
      sets[n] = s;
    }
    return sets;
  }
  function detect() {
    const sets = [portraitSets, mgr.rom && mgr.look ? portraitKeys(mgr.rom) : null].filter(Boolean), hits = { alex: 0, nina: 0 };
    for (let bank = 0; bank < 2; bank++) {
      const v = gb.mem.vram[bank];
      for (let t = 0; t < 384; t++) { let k = ""; for (let i = 0; i < 16; i++) k += String.fromCharCode(v[t * 16 + i]); for (const S of sets) for (const n in S) if (S[n].has(k)) hits[n]++; }
    }
    return hits.alex >= 4 && hits.nina >= 4;
  }
  return {
    manager: mgr,
    // before the machine: apply the stored look to the ROM bytes
    ready,
    prepare(bytes) { pristine = Uint8Array.from(bytes); portraitSets = portraitKeys(pristine); mgr.prepare(bytes, withMods(load(KEY)), { detail: sprMode === "detail" }); },
    attach(machine) { gb = machine; mgr.attach(gb); gb.modChar = modChar; lastSlot = -1; detail.attach(gb, document.getElementById("screen")); detail.setEnabled(sprMode === "detail"); },
    get look() { return mgr.look; },
    open: openPanel,
    // once per emulated frame (after it ran)
    frame() {
      if (!gb) return;
      detail.frame();
      if (pressFrames > 0) { keys.Enter = pressFrames > 3; pressFrames--; if (!pressFrames) keys.Enter = false; }
      if (gb.frames < detectAt) return; detectAt = gb.frames + 20;
      const up = gateNow(); if (up !== seniorUp) { seniorUp = up; if (mgr.look && mgr.look.mods) { mgr.set(mgr.look); onChange(mgr.look); } }
      const pick = detect();
      if (pick && !onPick && !offered && !open) offer.hidden = false;
      if (!pick) offer.hidden = true;
      onPick = pick;
      const s = gb.mem.wram[0][WRAM_STORY_SLOT];
      if (s !== lastSlot) { if (lastSlot >= 0 && s < 3) { const L = load(SLOT_KEY(s)); if (L) apply(withMods(L), false); } lastSlot = s; }
    },
  };
}

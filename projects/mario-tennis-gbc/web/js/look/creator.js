// The creator ("Appearance"): pick the boy's or the girl's hairstyle and colours with a live preview from the
// game's own frames. Offered when the game's Create a Character screen is up (both heroes' portraits in VRAM)
// and from the LOOK button. The look is kept in localStorage (the last one, and one per story save slot),
// applied at ROM load (LookManager.prepare) and changed in play with LookManager.set.
import { LookManager, normalizeLook, lookKey, PRESETS, SWATCHES, css15, rgb15 } from "./index.js";
import { STYLES } from "./label.js";
import { heroPreview, blit, POSES } from "./preview.js";
import { lzDecompress } from "./lz.js";
import { HEROES } from "./build.js";

const KEY = "mt-look", SLOT_KEY = n => "mt-look-slot-" + n;
const load = k => { try { return normalizeLook(JSON.parse(localStorage.getItem(k) || "null")); } catch (e) { return null; } };
const save = (k, v) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch (e) { /* private mode */ } };
const STYLE_LABEL = { cap: "Cap", headband: "Headband", ponytail: "Ponytail", short: "Short hair", pigtails: "Pigtails", bob: "Bob" };
const PARTS = [["skin", "Skin", "skin"], ["hair", "Hair", "hair"], ["hat", "Hat / band", "cloth"], ["top", "Top", "cloth"], ["bottom", "Shorts / skirt", "cloth"], ["shoes", "Shoes", "cloth"], ["racket", "Racket", "cloth"]];
const WRAM_STORY_SLOT = 0x36C, WRAM_HANDEDNESS = 0xB50;   // wCurrentStorySlot $C36C, wCharSelectHandedness $CB50

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
  let gb = null, open = false, draft = null, hero = "boy", pristine = null, detectAt = 0, onPick = false, offered = false, lastSlot = -1, pressFrames = 0, wasPaused = false;
  let portraitSets = null;
  const st = document.createElement("style"); st.textContent = CSS; document.head.appendChild(st);
  const btn = document.createElement("span"); btn.className = "k"; btn.id = "lookbtn"; btn.textContent = "LOOK"; btn.title = "your player's appearance (hairstyle and colours)";
  hud.appendChild(document.createTextNode(" ")); hud.appendChild(btn);
  const offer = document.createElement("button"); offer.id = "lookoffer"; offer.hidden = true; offer.textContent = "✦ Customize your player's look";
  document.body.appendChild(offer);
  const panel = document.createElement("div"); panel.id = "lookpanel"; panel.hidden = true;
  panel.innerHTML = `<div class="card" role="dialog" aria-label="Appearance">
    <h2>Appearance <button class="x" aria-label="close">×</button></h2>
    <div class="row" data-k="hero"></div>
    <canvas width="392" height="196"></canvas>
    <div class="lab">Presets</div><div class="row" data-k="presets"></div>
    <div class="lab">Hairstyle</div><div class="row" data-k="style"></div>
    <div data-k="colours"></div>
    <div class="row"><label class="note"><input type="checkbox" data-k="lefty"> Left-handed (the game's START: Change Hands on Create a Character)</label></div>
    <div class="note" data-k="msg"></div>
    <div class="acts"><button class="btn" data-k="classic">Game's look</button><button class="btn" data-k="cancel">Cancel</button><button class="btn go" data-k="apply">Apply</button></div>
  </div>`;
  document.body.appendChild(panel);
  const q = k => panel.querySelector(`[data-k="${k}"]`), cv = panel.querySelector("canvas"), ctx = cv.getContext("2d");
  const name = () => hero === "boy" ? "alex" : "nina";

  function cur() { return draft[hero]; }
  function ensure() { if (!draft[hero]) draft[hero] = { style: STYLES[name()][0], colours: {} }; return draft[hero]; }
  function chip(label, on, fn) { const b = document.createElement("button"); b.className = "chip" + (on ? " on" : ""); b.textContent = label; b.onclick = fn; return b; }
  function render() {
    const hn = q("hero"); hn.replaceChildren(chip("Boy", hero === "boy", () => { hero = "boy"; render(); }), chip("Girl", hero === "girl", () => { hero = "girl"; render(); }));
    const pr = q("presets"); pr.replaceChildren(...PRESETS[hero].map(p => chip(p.name, lookKey({ [hero]: p.look }) === lookKey({ [hero]: cur() }), () => { draft[hero] = p.look ? JSON.parse(JSON.stringify(p.look)) : null; render(); })));
    const c = cur();
    q("style").replaceChildren(...STYLES[name()].map(s => chip(STYLE_LABEL[s] || s, c && c.style === s, () => { ensure().style = s; render(); })));
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
    drawPreview();
  }
  let anim = 0;
  function drawPreview() {
    if (!pristine) return;
    const n = name(), L = cur(), P = heroPreview(pristine, n, L, (anim >> 1) & 1);
    ctx.fillStyle = "#4a8a58"; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = "#c48a3a"; ctx.fillRect(0, 0, cv.width, 80);           // a path for the overworld row
    P.walk.forEach((im, i) => blit(ctx, im, 10 + i * 66, 8, 4));
    blit(ctx, P.portrait, 290, 4, 3);
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
    if (store) { save(KEY, look); const s = gb ? gb.mem.wram[0][WRAM_STORY_SLOT] : -1; if (s >= 0 && s < 3) save(SLOT_KEY(s), look); }
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
    prepare(bytes) { pristine = Uint8Array.from(bytes); portraitSets = portraitKeys(pristine); mgr.prepare(bytes, load(KEY)); },
    attach(machine) { gb = machine; mgr.attach(gb); lastSlot = -1; },
    get look() { return mgr.look; },
    open: openPanel,
    // once per emulated frame (after it ran)
    frame() {
      if (!gb) return;
      if (pressFrames > 0) { keys.Enter = pressFrames > 3; pressFrames--; if (!pressFrames) keys.Enter = false; }
      if (gb.frames < detectAt) return; detectAt = gb.frames + 20;
      const pick = detect();
      if (pick && !onPick && !offered && !open) offer.hidden = false;
      if (!pick) offer.hidden = true;
      onPick = pick;
      const s = gb.mem.wram[0][WRAM_STORY_SLOT];
      if (s !== lastSlot) { if (lastSlot >= 0 && s < 3) { const L = load(SLOT_KEY(s)); if (L) apply(L, false); } lastSlot = s; }
    },
  };
}

// The LIGHT settings panel (tap LIGHT): overworld time of day (Off / Day / the phone's clock / Custom with a slider), match time (same as the
// overworld / Day / Night / Random: each match rolls morning, noon, sunset or night once), effect toggles (shadows, glow, tilt-shift,
// vignette, night lights), quality (Auto / Low / Medium / High) and the crowd size by class of match (STADIUM: 3D). Everything is remembered
// (lighting.js saveCfg -> localStorage mt-lightcfg; the crowd sizes by stadium3d.js in mt-crowd). Render-time settings only: the game never changes.
import { hourName, MATCH_NAMES } from "./lighting.js";

const CSS = `
#lightpanel { position: fixed; inset: 0; z-index: 60; display: flex; align-items: flex-start; justify-content: center; background: rgba(8,10,16,.72); overflow-y: auto; -webkit-overflow-scrolling: touch; }
#lightpanel[hidden] { display: none; }
#lightpanel .sheet { width: min(560px, 100%); box-sizing: border-box; padding: 14px 14px 28px; color: #e9ecf4; font: 14px/1.35 system-ui, sans-serif; }
#lightpanel h2 { margin: 4px 2px 10px; font-size: 18px; display: flex; justify-content: space-between; align-items: center; }
#lightpanel h2 button { background: #2c3143; color: #e9ecf4; border: 0; border-radius: 10px; padding: 6px 12px; font-size: 14px; }
#lightpanel .card { background: #222736; border: 1px solid #343b52; border-radius: 14px; padding: 12px 14px; margin: 0 0 10px; }
#lightpanel h3 { margin: 0 0 8px; font-size: 14px; color: #f58a2a; font-weight: 650; }
#lightpanel .row { display: flex; flex-wrap: wrap; gap: 6px; }
#lightpanel .pill { background: #343950; color: #e9ecf4; border-radius: 999px; padding: 7px 13px; font-size: 13px; cursor: pointer; user-select: none; }
#lightpanel .pill.on { background: #f58a2a; color: #1a1205; font-weight: 650; }
#lightpanel .note { color: #98a0b8; font-size: 12px; margin-top: 8px; }
#lightpanel .sw { display: flex; justify-content: space-between; align-items: center; padding: 7px 0; }
#lightpanel .tog { width: 46px; height: 26px; border-radius: 13px; background: #454b63; position: relative; flex: none; cursor: pointer; }
#lightpanel .tog::after { content: ""; position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 50%; background: #fff; transition: left .12s; }
#lightpanel .tog.on { background: #f58a2a; } #lightpanel .tog.on::after { left: 23px; }
#lightpanel input[type=range] { width: 100%; accent-color: #f58a2a; }
#lightpanel .sl { display: grid; grid-template-columns: 1fr 1.3fr 44px; gap: 8px; align-items: center; padding: 5px 0; }
#lightpanel .sl b { font-weight: 500; text-align: right; color: #98a0b8; font-size: 12px; }
`;
const CLASSES = [["junior", "Junior class courts"], ["senior", "Senior class courts"], ["major", "Tournaments / Island Open / finals"]];
const fmt = h => { const hh = Math.floor(h), mm = Math.round((h - hh) * 60); return String(hh % 24).padStart(2, "0") + ":" + String(mm === 60 ? 0 : mm).padStart(2, "0"); };

export function attachLightPanel(voxel) {
  const L = voxel.light; if (!L) return null;
  if (!document.getElementById("lightpanel-css")) { const st = document.createElement("style"); st.id = "lightpanel-css"; st.textContent = CSS; document.head.appendChild(st); }
  const root = document.createElement("div"); root.id = "lightpanel"; root.hidden = true; document.body.appendChild(root);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const card = (title, note) => { const c = el("div", "card"); c.appendChild(el("h3", null, title)); return c; };
  const pills = (items, cur, pick) => { const r = el("div", "row"); for (const [v, label] of items) { const p = el("span", "pill" + (v === cur ? " on" : ""), label); p.addEventListener("click", () => { pick(v); build(); }); r.appendChild(p); } return r; };
  const toggle = (label, on, set) => { const r = el("div", "sw"); r.appendChild(el("span", null, label)); const t = el("span", "tog" + (on ? " on" : "")); t.addEventListener("click", () => { set(!on); build(); }); r.appendChild(t); return r; };
  function build() {
    const keep = root.scrollTop; root.textContent = "";
    const sheet = el("div", "sheet"); root.appendChild(sheet);
    const h = el("h2", null, "LIGHT settings"); const x = el("button", null, "Close"); x.addEventListener("click", close); h.appendChild(x); sheet.appendChild(h);
    const C = L.cfg;
    // overworld
    let c = card("Overworld time of day");
    c.appendChild(pills([["off", "Off"], ["day", "Day"], ["clock", "Follow phone clock"], ["custom", "Custom"]], C.world, w => L.setWorld(w)));
    if (C.world === "custom") {
      const r = el("input"); r.type = "range"; r.min = 0; r.max = 24; r.step = 0.25; r.value = C.customHour; const lab = el("div", "note");
      const upd = () => { lab.textContent = "time " + fmt(+r.value) + "  " + hourName(+r.value); };
      r.addEventListener("input", () => { L.setCustomHour(+r.value); upd(); }); upd(); c.appendChild(r); c.appendChild(lab);
    } else if (C.world === "clock") c.appendChild(el("div", "note", "now " + fmt(new Date().getHours() + new Date().getMinutes() / 60) + "  " + hourName(new Date().getHours() + new Date().getMinutes() / 60)));
    sheet.appendChild(c);
    // matches
    c = card("Matches");
    c.appendChild(pills([["same", "Same as overworld"], ["day", "Day"], ["night", "Night"], ["random", "Random"]], C.matches, m => L.setMatches(m)));
    c.appendChild(el("div", "note", C.matches === "random" ? "Each match rolls " + MATCH_NAMES.join(", ") + " once (seeded by when the match starts, so a recording replays the same). Night: floodlights on, crowd lit by the towers." : C.matches === "same" ? "Matches use the overworld setting." : "Every match is played in " + (C.matches === "day" ? "daylight" : "the floodlit night") + "."));
    sheet.appendChild(c);
    // effects
    c = card("Effects");
    for (const [k, label] of [["shadows", "Sun / moon shadows"], ["bloom", "Glow (bloom) on bright lights"], ["tilt", "Tilt-shift blur at the top and bottom"], ["vignette", "Vignette (darker corners)"], ["night", "Night lights: windows, lamps, fountains, floodlights"]])
      c.appendChild(toggle(label, C.fx[k], on => L.setFx(k, on)));
    sheet.appendChild(c);
    // quality
    c = card("Quality");
    c.appendChild(pills([["auto", "Auto (recommended)"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]], C.quality, q => L.setQuality(q)));
    c.appendChild(el("div", "note", "Low: colour grade and glow only. Medium: + shadows and tilt-shift. High: + smooth edges (multisampling). Auto steps down if the phone cannot keep up."));
    sheet.appendChild(c);
    // crowd
    const st = voxel.stadium;
    if (st && st.crowdSizes) {
      c = card("Crowd size by class (STADIUM: 3D)");
      for (const [k, label] of CLASSES) {
        const r = el("div", "sl"); r.appendChild(el("span", null, label)); const s = el("input"); s.type = "range"; s.min = 0; s.max = 1; s.step = 0.05; s.value = st.crowdSizes[k];
        const v = el("b", null, Math.round(st.crowdSizes[k] * 100) + "%"); s.addEventListener("input", () => { st.setCrowdSize(k, +s.value); v.textContent = Math.round(+s.value * 100) + "%"; });
        r.appendChild(s); r.appendChild(v); c.appendChild(r);
      }
      sheet.appendChild(c);
    }
    root.scrollTop = keep;
  }
  const open = () => { build(); root.hidden = false; };
  const close = () => { root.hidden = true; };
  root.addEventListener("pointerdown", e => { if (e.target === root) close(); });
  L.openPanel = () => { if (root.hidden) open(); else close(); };
  return { open, close };
}

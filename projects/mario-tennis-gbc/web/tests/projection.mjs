// ProjectPoint port vs values the game stored (wDD1E/wDD20 in states/rec_rally1.npy, see tools/analyze_projection.py)
import { project, Camera } from "../js/camera.js";
let fails = 0;
const eq = (what, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) fails++; console.log(ok ? "ok  " : "FAIL", what, JSON.stringify(got), ok ? "" : "want " + JSON.stringify(want)); };
let p = project(-402, -569, -182); eq("ball frame 100", [p.xp, p.pp], [-1536, -1504]);
p = project(18, 978, -112); eq("ball frame 300", [p.xp, p.pp], [88, 1240]);
p = project(-629, 1563, -18); eq("ball frame 600", [p.xp, p.pp], [-2728, 2688]);
p = project(93, 1273, 0); eq("P1 frame 300", [p.xp, p.pp], [408, 2200]);   // -> OAM bottom-centre (91, 120) below
const c = new Camera(); c.x = 113; c.y = 1712; eq("scroll frame 300", c.scroll(), { scx: 50, scy: 77, offX: 2512, offY: 1648 });
eq("P1 screen frame 300", c.screen(93, 1273).map(Math.floor), [91, 120]);
process.exit(fails ? 1 : 0);

import { newBall, step, FX } from "../js/physics.js";
import fs from "fs";
import { fileURLToPath } from "url";
const here = p => fileURLToPath(new URL(p, import.meta.url));
const ref = JSON.parse(fs.readFileSync(here("../../states/phys_ref.json")));
for (const [s, real] of [["start66", "real66"], ["start116", "real116"]]) {
  const b = Object.assign(newBall(), ref[s]); let worst = 0;
  for (let i = 1; i < ref[real].length; i++) {
    step(b); const r = ref[real][i];
    worst = Math.max(worst, Math.abs(b.X - r.X) / FX, Math.abs(b.Y - r.Y) / FX, Math.abs(b.Z - r.Z) / FX);
  }
  console.log(s, "frames", ref[real].length - 1, "max err px", worst.toFixed(4));
}
{
  const b = Object.assign(newBall(), ref.start116); const rows = [];
  for (let i = 1; i < ref.real116.length; i++) { step(b); rows.push([b.X, b.Y, b.Z, b.vX, b.vY, b.vZ]); }
  fs.writeFileSync(here("../../states/js116.json"), JSON.stringify(rows));
}

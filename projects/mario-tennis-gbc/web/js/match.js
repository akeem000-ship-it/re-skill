// Match logic. Decoded and verified parts (see REVERSE.md): court constants, in/out limits,
// serve box rule, point counting with deuce, faults/double faults, stat -> movement formulas,
// shot spin/speed tables, ball physics. NOT decoded (approximated here, marked APPROX): the CPU
// AI, swing timing windows, and how the game picks targets (banks 20-23 trajectory tables).
import { FX, COURT, newBall, step, launch, aimShot, predictBounce } from "./physics.js";
import { shotRow, SHOT } from "./assets.js";

const POINT_NAMES = ["0", "15", "30", "40"];
const REACH_X = 110, REACH_Y = 140;          // APPROX swing reach (world units)

export class Match {
  constructor(rom, p1, p2, opts = {}) {
    this.rom = rom;
    this.gamesToWin = opts.games || 2;
    // APPROX CPU error model (the real AI is not decoded): per-approach whiff chance and extra aim
    // spread per difficulty EASY / NORMAL / HARD / INTENSE (the game's CPU difficulty menu)
    this.difficulty = opts.difficulty ?? 1;
    this.whiff = [0.30, 0.16, 0.09, 0.06][this.difficulty];
    this.spread = [140, 90, 55, 30][this.difficulty];
    this.players = [this.mkPlayer(p1, 0, false), this.mkPlayer(p2, 1, true)];
    this.points = [0, 0]; this.games = [0, 0];
    this.server = 0; this.serveSide = 1;    // +1 = deuce court (X > 0 for the near player)
    this.secondServe = false;
    this.ball = newBall();
    this.message = ""; this.msgTimer = 0; this.over = false; this.winner = -1;
    this.resetPoint();
  }

  mkPlayer(data, side, cpu) {
    return { data, side, cpu, X: 0, Y: 0, vx: 0, vy: 0, swing: 0, swingType: 0, facing: 1,
             anim: 0, cooldown: 0, react: 0, targetX: 0, targetY: 0 };
  }
  dir(p) { return p.side === 0 ? 1 : -1; }    // near player lives at +Y

  resetPoint() {
    const b = this.ball = newBall();
    this.state = "serve"; this.tossT = 0; this.bounceSide = 0; this.served = false;
    const s = this.players[this.server], r = this.players[1 - this.server];
    const sx = 288 * this.serveSide * this.dir(s);
    s.X = sx; s.Y = COURT.baseline * this.dir(s); s.vx = s.vy = 0;
    r.X = -sx * 0.9; r.Y = (COURT.baseline + 60) * this.dir(r); r.vx = r.vy = 0;
    b.X = s.X * FX; b.Y = s.Y * FX; b.Z = -64 * FX;
    for (const p of this.players) { p.swing = 0; p.cooldown = 20; p.react = 0; }
    this.lastHitter = -1;
  }

  say(text, t = 90) { this.message = text; this.msgTimer = t; }

  scoreText() {
    const [a, b] = this.points;
    if (this.tiebreak) return `TB ${a}-${b}`;
    if (a >= 3 && b >= 3) return a === b ? "DEUCE" : (a > b ? "ADV " : "ADV ") + (a > b ? "P1" : "P2");
    return `${POINT_NAMES[Math.min(a, 3)]}-${POINT_NAMES[Math.min(b, 3)]}`;
  }

  get tiebreak() { return this.games[0] === this.gamesToWin && this.games[1] === this.gamesToWin; }

  awardPoint(w, why) {
    this.points[w]++;
    const [a, b] = this.points, need = this.tiebreak ? 7 : 4;   // DeuceCompress(7) = tiebreak cap
    if ((a >= need || b >= need) && Math.abs(a - b) >= 2) {
      const tb = this.tiebreak;
      this.games[w]++; this.points = [0, 0];
      this.server = 1 - this.server;
      const g = this.games, N = this.gamesToWin;
      if (tb || (g[w] >= N && g[w] - g[1 - w] >= 2)) {
        this.over = true; this.winner = w; this.say(`GAME SET  ${this.players[w].data.name}`, 9999);
      } else this.say(`${why}  GAME ${this.games[0]}-${this.games[1]}`, 100);
    } else this.say(`${why}  ${this.scoreText()}`, 90);
    this.serveSide = (this.points[0] + this.points[1]) % 2 === 0 ? 1 : -1;
    this.secondServe = false;
    this.state = "dead"; this.deadT = 70;
  }

  fault() {
    if (this.secondServe) { this.secondServe = false; this.awardPoint(1 - this.server, "DOUBLE FAULT"); }
    else { this.secondServe = true; this.say("FAULT", 60); this.state = "dead"; this.deadT = 60; this.refault = true; }
  }

  // ---- shots ---------------------------------------------------------------
  hit(p, kind) {              // kind 0 = A (topspin), 1 = B (slice)
    const b = this.ball, st = p.data.stats, d = this.dir(p);
    const from = { X: b.X / FX, Y: b.Y / FX, Z: Math.min(-24, b.Z / FX) };
    let speed, top, side;
    if (this.state === "toss") {      // serve: topspin (A) or slice (B) serve table, row = Serve speed / Top|Slice spin
      const sp = shotRow(this.rom, kind ? SHOT.serveSlice : SHOT.serveTop, st.Serve);
      const sr = shotRow(this.rom, kind ? SHOT.serveSlice : SHOT.serveTop, kind ? st.Slice : st.Top);
      const timing = 1 - Math.min(0.25, Math.abs(b.vZ / FX) / 40);   // APPROX: best at the top of the toss
      speed = sp.speed * timing; top = sr.top; side = sr.side * this.serveSide;
      const g2 = () => (Math.random() + Math.random() - 1);
      const sErr = s => s.cpu ? this.spread * 0.6 : 40;
      const tgt = { X: -this.serveSide * (130 + Math.random() * 200 + g2() * sErr(p)) * d,
                    Y: -d * (COURT.serviceLine - 90 - Math.random() * 160 + g2() * sErr(p)) };
      const aim = aimShot(b, from, tgt, speed, top, side);
      launch(b, speed, aim.elev, aim.heading, top, side);
      this.state = "rally"; this.served = true; this.serveLanding = true;
    } else {
      // strokes: measured launch speeds 30-37 px/frame; spins from tables scaled as measured
      // (topspin 3072 + 512*Top, side 448 + 64*Top; slice = slice-table row x 0.375 side)
      speed = 28 + st.Stroke + Math.random() * 3;
      if (kind === 0) { top = 3072 + 512 * st.Top; side = 448 + 64 * st.Top; }
      else { const r = shotRow(this.rom, SHOT.strokeSlice, st.Slice); top = -912; side = Math.round(r.side * 0.375); }
      const err = p.data.aimError * 8 + (p.cpu ? this.spread : 0);
      let tx = p.cpu ? (Math.random() * 2 - 1) * 300 : p.aimX * 330;
      const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      const tgt = { X: tx + gauss() * err, Y: -d * (850 + Math.random() * 280 + gauss() * err * 0.8) };
      side *= tgt.X > from.X ? -d : d;
      const aim = aimShot(b, from, tgt, speed, top, side);
      launch(b, speed, aim.elev, aim.heading, top, side);
    }
    b.bounces = 0; this.lastHitter = p.side; this.bounceSide = 0;
    p.swing = 14; p.swingType = kind; p.cooldown = 24;
    for (const q of this.players) q.react = q.data.reaction;   // receivers wait 6+Reaction frames
  }

  canHit(p) {
    const b = this.ball, bx = b.X / FX, by = b.Y / FX, bz = b.Z / FX;
    if (p.cooldown > 0 || this.lastHitter === p.side) return false;
    return Math.abs(bx - p.X) < REACH_X && Math.abs(by - p.Y) < REACH_Y && bz > -330;
  }

  // ---- per-frame update -----------------------------------------------------
  update(input) {
    if (this.msgTimer > 0) this.msgTimer--;
    if (this.over) return;
    const [hp, cp] = this.players;
    hp.aimX = input.left ? -1 : input.right ? 1 : 0;

    if (this.state === "dead") {
      if (--this.deadT <= 0) { if (this.refault) { this.refault = false; this.resetPointKeepScore(); } else this.resetPoint(); }
      this.movePlayers(input); return;
    }
    if (this.state === "serve") {
      const s = this.players[this.server];
      if (s.cpu ? ++this.tossT > 50 : input.aPressed || input.bPressed) {
        this.state = "toss"; this.tossT = 0;
        this.ball.vZ = Math.round(-12.9 * FX);   // toss from Z=-64 peaking at Z ~ -349 (measured)
      }
      if (!s.cpu) this.moveServer(s, input);
      return;
    }
    if (this.state === "toss") {
      const s = this.players[this.server], b = this.ball;
      b.Z += b.vZ; b.vZ += 0x4A00;            // toss: gravity only (0.289/frame^2, measured)
      this.tossT++;
      const want = s.cpu ? (b.vZ > 0 && b.Z < -280 * FX) : (input.aPressed || input.bPressed);
      if (want && b.Z < -150 * FX) this.hit(s, s.cpu ? (Math.random() < 0.5 ? 0 : 1) : (input.bPressed ? 1 : 0));
      else if (b.Z >= -64 * FX && this.tossT > 10) { this.state = "serve"; b.Z = -64 * FX; b.vZ = 0; }
      return;
    }
    // rally
    step(this.ball);
    this.judge();
    if (this.state !== "rally") return;
    for (const p of this.players) {
      if (p.cooldown > 0) p.cooldown--;
      if (p.swing > 0) p.swing--;
      if (p.react > 0) p.react--;
    }
    if (!hp.cpu && input.aPressed && this.canHit(hp)) this.hit(hp, 0);
    else if (!hp.cpu && input.bPressed && this.canHit(hp)) this.hit(hp, 1);
    for (const p of this.players) {
      if (!p.cpu) continue;
      const reach = this.canHit(p);
      if (reach && !p.decided) { p.decided = true; p.willWhiff = Math.random() < this.whiff; }
      if (!reach) p.decided = false;
      if (reach && !p.willWhiff && Math.random() < 0.6) this.hit(p, Math.random() < 0.7 ? 0 : 1);
    }
    this.movePlayers(input);
  }

  resetPointKeepScore() { const s = this.secondServe; this.resetPoint(); this.secondServe = s; }

  judge() {
    const b = this.ball;
    if (b.event === 1) {                       // ground contact
      const x = b.X / FX, y = b.Y / FX, side = y > 0 ? 0 : 1;   // whose half it landed in
      if (b.bounces === 1) {
        const hitter = this.lastHitter;
        if (this.serveLanding) {                // serve must land in the diagonal service box
          this.serveLanding = false;
          const s = this.players[this.server], d = this.dir(s);
          const inBox = side !== s.side && Math.abs(y) <= COURT.serviceLine && Math.abs(x) <= COURT.singles &&
                        Math.sign(x) === -this.serveSide * d;
          if (!inBox) return this.fault();
        } else if (side === hitter || Math.abs(x) > COURT.singles || Math.abs(y) > COURT.baseline) {
          return this.awardPoint(1 - hitter, side === hitter ? "NET" : "OUT");
        }
        this.bounceSide = side;
      } else if (b.bounces >= 2) {
        return this.awardPoint(1 - this.bounceSide, "WINNER");
      }
    }
    if (b.event === 2 && b.bounces === 0) return this.awardPoint(1 - this.lastHitter, "OUT");
  }

  moveServer(s, input) {
    const d = this.dir(s), lo = 38, hi = 378;          // serve walk 10 units/frame, X in 38..378 (measured)
    if (input.left) s.X -= 10 * d; if (input.right) s.X += 10 * d;
    const ax = s.X * this.serveSide * d;
    s.X = Math.max(lo, Math.min(hi, ax)) * this.serveSide * d;
    this.ball.X = s.X * FX;
  }

  movePlayers(input) {
    for (const p of this.players) {
      let tx = 0, ty = 0;
      if (!p.cpu) {
        tx = (input.right ? 1 : 0) - (input.left ? 1 : 0); ty = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      } else if (this.state === "rally" && p.react === 0) {
        const b = this.ball, coming = (b.vY > 0) === (p.side === 0);
        if (coming) {                               // APPROX AI: intercept at our baseline depth
          const c = { ...b }; let f = 0;
          while (f++ < 120 && Math.abs(c.Y / FX) < Math.abs(p.Y) - 20 && c.bounces < 2) step(c);
          p.targetX = c.X / FX; p.targetY = this.dir(p) * Math.max(900, Math.min(1300, Math.abs(c.Y / FX) + 40));
        } else { p.targetX = 0; p.targetY = this.dir(p) * 1150; }
        const dx = p.targetX - p.X, dy = p.targetY - p.Y;
        tx = Math.abs(dx) > 14 ? Math.sign(dx) : 0; ty = Math.abs(dy) > 30 ? Math.sign(dy) : 0;
      }
      // accel = Dash/64, top speed = Speed param + 0.5, braking ~ Stop (REVERSE.md)
      const D = p.data, len = Math.hypot(tx, ty) || 1;
      const wx = tx / len * D.runSpeed, wy = ty / len * D.runSpeed;
      const approach = (v, w) => {
        if (w === 0) return Math.abs(v) <= D.brake ? 0 : v - Math.sign(v) * D.brake;
        return Math.abs(w - v) <= D.accel ? w : v + Math.sign(w - v) * D.accel;
      };
      p.vx = approach(p.vx, wx); p.vy = approach(p.vy, wy);
      if (p.swing > 0) { p.vx *= 0.5; p.vy *= 0.5; }
      p.X = Math.max(-850, Math.min(850, p.X + p.vx));
      const d = this.dir(p);
      p.Y = d * Math.max(80, Math.min(1700, d * (p.Y + p.vy)));
      if (Math.abs(p.vx) > 0.5) p.facing = Math.sign(p.vx);
      p.anim += Math.hypot(p.vx, p.vy) / 40;
    }
  }
}

// Match logic. Decoded and verified parts (see REVERSE.md): court constants, in/out limits,
// serve box rule, point counting with deuce, faults/double faults, stat -> movement formulas,
// shot spin/speed tables, ball physics, aiming and trajectory-table selection (shots.js). NOT
// decoded (approximated here, marked APPROX): the CPU AI details and the swing contact test.
import { FX, COURT, newBall, step, launch } from "./physics.js";
import { computeShot, shotType, toLaunch, atan2Rom } from "./shots.js";

const POINT_NAMES = ["0", "15", "30", "40"];

export class Match {
  constructor(rom, p1, p2, opts = {}) {
    this.rom = rom;
    this.gamesToWin = opts.games || 2;
    // CPU parameters: DifficultyTable 38:5FFB (REVERSE.md "CPU AI"): reaction delay for deep /
    // short balls (+ rand 0-3 frames), positioning error, smart-placement probability /256,
    // shot profile 0-3 (02:5E23 tables), quick-serve chance /8 (08:7A9D)
    this.difficulty = opts.difficulty ?? 1;
    const D = [[28, 24, 12, 60, 0], [18, 15, 9, 120, 1], [10, 9, 5, 190, 2], [2, 2, 0, 230, 3]][this.difficulty];
    this.cpu = { deep: D[0], short: D[1], posErr: D[2], place: D[3], profile: D[4], quick: [0, 3, 6, 8][D[4]] };
    this.profileTable = [
      [0x10,0x10,0x10,0x10,0x10,0x10,0x10,0x30,0x20,0x20,0x20,0x20,0x20,0x20,0x20,0x30],
      [0x10,0x10,0x10,0x10,0x20,0x20,0x20,0x20,0x10,0x11,0x11,0x30,0x20,0x22,0x22,0x30],
      [0x10,0x10,0x10,0x30,0x20,0x20,0x20,0x30,0x11,0x11,0x11,0x12,0x22,0x22,0x22,0x21],
      [0x30,0x30,0x30,0x11,0x11,0x11,0x11,0x11,0x22,0x22,0x22,0x22,0x20,0x10,0x12,0x21]][this.cpu.profile];
    this.players = [this.mkPlayer(p1, 0, false), this.mkPlayer(p2, 1, true)];
    this.points = [0, 0]; this.games = [0, 0]; this.pointNo = 0; this.hits = 0;
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
    this.pointNo++; this.hits = 0;                 // wC4B6 hit count (1 = serve in flight)
    this.state = "serve"; this.tossT = 0; this.bounceSide = 0; this.served = false;
    const s = this.players[this.server], r = this.players[1 - this.server];
    const sx = 288 * this.serveSide * this.dir(s);
    s.X = sx; s.Y = COURT.baseline * this.dir(s); s.vx = s.vy = 0;
    if (s.cpu) s.X = [32, 32, 128, 224, 320, 384, 384, 384][Math.floor(Math.random() * 8)] * this.serveSide * this.dir(s);   // 08:7A3D
    r.X = -sx * 0.9; r.Y = (COURT.baseline + 60) * this.dir(r); r.vx = r.vy = 0;
    b.X = s.X * FX; b.Y = s.Y * FX; b.Z = -64 * FX;
    for (const p of this.players) { p.swing = 0; p.cooldown = 20; p.ai = { state: "idle", t: 0 }; }
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
    this.points[w]++; this.pointWinner = w;
    const [a, b] = this.points, need = this.tiebreak ? 7 : 4;   // DeuceCompress(7) = tiebreak cap
    if ((a >= need || b >= need) && Math.abs(a - b) >= 2) {
      const tb = this.tiebreak;
      this.games[w]++; this.points = [0, 0];
      this.server = tb ? 1 - this.tbServer : 1 - this.server;
      if (this.tiebreak) this.tbServer = this.server;
      const g = this.games, N = this.gamesToWin;
      if (tb || (g[w] >= N && g[w] - g[1 - w] >= 2)) {
        this.over = true; this.winner = w; this.say(`GAME SET  ${this.players[w].data.name}`, 9999);
      } else this.say(`${why}  GAME ${this.games[0]}-${this.games[1]}`, 100);
    } else {
      // tiebreak serving (rotation table 08:49D9 rows by wC8ED): one point, then two each
      if (this.tiebreak) this.server = this.tbServer ^ (((a + b + 1) >> 1) & 1);
      this.say(`${why}  ${this.scoreText()}`, 90);
    }
    this.serveSide = (this.points[0] + this.points[1]) % 2 === 0 ? 1 : -1;
    this.secondServe = false;
    this.state = "dead"; this.deadT = 70;
  }

  fault() {
    if (this.secondServe) { this.secondServe = false; this.awardPoint(1 - this.server, "DOUBLE FAULT"); }
    else { this.secondServe = true; this.say("FAULT", 60); this.state = "dead"; this.deadT = 60; this.refault = true; }
  }

  // ---- shots ---------------------------------------------------------------
  cpuShotCode(p) {            // 08:7B7B: A+B when the opponent is inside 320 and the profile allows it; 50% a
    const opp = this.players[1 - p.side], t = this.profileTable, b = this.ball;   // profile pick; a far ball with
    if (Math.abs(opp.Y) < 320 && t.includes(0x30)) return 0x30;                   // the opponent deep -> drop ($12)
    if (Math.random() < 0.5 && Math.abs(b.Y / FX - p.Y) >= 320 && t.includes(0x12) && Math.abs(opp.Y) > 1000) return 0x12;
    return t[Math.floor(Math.random() * 16)];
  }

  // ---- CPU (REVERSE.md "CPU AI": PlayerCpuThink 08:7863, sub-states wDF1A, plan mode wDF7F) ----
  cpuEnter(p, state) {
    const ai = p.ai;
    if (state === "react") {                 // 08:7D0A: think timer = net/baseline delay + rand 0-3
      ai.state = "react"; ai.t = (Math.abs(p.Y) < COURT.serviceLine ? this.cpu.deep : this.cpu.short) + Math.floor(Math.random() * 4);
      ai.target = null; ai.crossed = (this.ball.Y > 0) === (p.side === 0);
    } else if (state === "recover") {        // 08:7CAE: X = landingX/4, depth by plan mode
      const L = this.ball.landing, mode = p.data.cpuMode, d = this.dir(p);
      const depth = mode === 0 || mode === 5 ? 1120 : mode === 1 ? Math.abs(p.Y) : 384;
      ai.state = "recover"; ai.target = [L ? L.X / 4 : 0, d * depth];
    } else ai.state = state;
  }
  // 08:7C57 BallCrossingAt: landing point + dist along the ball's heading; 08:7C86: X where the line crosses depth
  cpuAlong(dist) { const b = this.ball, h = b.heading * 2 * Math.PI / 65536; return [b.landing.X + dist * Math.cos(h), b.landing.Y + dist * Math.sin(h)]; }
  cpuInterceptAt(depthY) {
    const b = this.ball, h = b.heading * 2 * Math.PI / 65536, sn = Math.sin(h);
    if (Math.abs(sn) < 0.05) return [b.landing.X, depthY];
    return [b.landing.X + (depthY - b.landing.Y) * Math.cos(h) / sn, depthY];
  }
  cpuPlan(p) {                               // 08:7D23 by plan mode; lob/drop/weak incoming -> 08:796D
    const b = this.ball, d = this.dir(p), mode = p.data.cpuMode, atNet = Math.abs(p.Y) < COURT.serviceLine;
    const lob = b.shotType === 10 || b.shotType === 11 || b.weak;
    const beforeBounce = () => {             // 352 before the bounce; near the centre -> stand at depth 256
      const [x, y] = this.cpuAlong(-0x160);
      return [x, Math.abs(x) < 256 ? d * 256 : d * Math.abs(y)];
    };
    if (mode === 2) return lob ? beforeBounce() : this.cpuInterceptAt(p.Y);                       // 08:7D41
    if (mode === 1 && atNet) return lob ? beforeBounce() : this.cpuInterceptAt(d * 512);         // 08:7D58
    if (mode === 1) return lob ? beforeBounce() : this.cpuAlong(0xC0);
    return this.cpuAlong(0xC0);                                                                   // mode 0: 08:7992
  }
  cpuTick(p) {
    const ai = p.ai, b = this.ball, coming = this.lastHitter !== p.side && this.lastHitter >= 0;
    if (!coming) return;
    switch (ai.state) {
      case "idle": case "recover": this.cpuEnter(p, "react"); break;
      case "react": if (--ai.t <= 0) { ai.target = this.cpuPlan(p); ai.state = "move"; } break;
      case "move": {                         // 08:7D73: arrive (within 24) or contact -> swing delay DF59 = DF7B
        const mySide = (b.Y > 0) === (p.side === 0);
        if (mySide && !ai.crossed) { ai.crossed = true; ai.target = this.cpuInterceptAt(this.dir(p) * 512); }   // 08:7D93: re-plan when the ball crosses the net
        const arrived = Math.abs(ai.target[0] - p.X) < 24 && Math.abs(ai.target[1] - p.Y) < 24;
        if (arrived || this.canHit(p)) { ai.state = "wait"; ai.t = this.cpu.posErr; }
        break;
      }
      case "wait":                           // 08:7DAD: count the delay down unless the ball is already in reach
        if (this.canHit(p) || --ai.t <= 0) {
          const code = this.cpuShotCode(p), opp = this.players[1 - p.side];
          const smart = Math.random() * 256 < this.cpu.place;                                    // 08:7B13 / 7AEB
          p.aimDir = smart ? -Math.sign(opp.X || 1) * this.dir(p) : Math.floor(Math.random() * 3) - 1;
          this.startSwing(p, code >> 4, code & 0xF); ai.state = "swing";
        }
        break;
      case "swing": break;                   // the swing request contacts the ball (tickSwing), then hit() -> recover
    }
  }

  // ROM shot pipeline (REVERSE.md "Aiming and launch", web/js/shots.js). button 1 A, 2 B, 3 A+B;
  // variant 0 single press, 1/2 double press (CPU shot codes $11/$22/$12/$21); charge = frames from the
  // press to the contact (wDF4B). The contact test itself (08:7267) is still approximated by canHit().
  hit(p, button, variant = 0, charge = 0) {
    const b = this.ball, d = this.dir(p), serve = this.state === "toss";
    const bx = b.X / FX, by = b.Y / FX, bz = b.Z / FX;
    let type;
    if (serve) type = button === 2 ? 13 : button === 3 ? 14 : 12;
    else {
      type = shotType(button, variant, this.volleyZone(p));
      if (type === 4 && this.highBall(bx, by, bz) && -bz > 220 && Math.abs(by) < 700) type = 9;   // 07:5525 + overhead swing (APPROX: near the net) -> smash
    }
    const deuce = this.serveSide === 1;
    const posCode = (p.side ? 2 : 0) | ((p.side === 0) === deuce ? 0 : 1);   // bit1 far end, bit0 ad court
    const mirror = (p.side === 0 ? 1 : 0) ^ (serve ? 0 : (bx > p.X ? 1 : 0));  // 07:53EF: sprite flip ^ backhand ^ rally
    const lunge = !serve && Math.abs(bx - p.X) > 60;                             // APPROX wDF0F bit1 (running/lunging shot)
    const r = computeShot(this.rom, {
      type, charge, mirror, posCode, aimDir: p.cpu ? p.aimDir | 0 : p.aimX,
      stats: p.data.stats, lobRow: 0, dropRow: 0,
      ball: { X: Math.trunc(bx), Y: Math.trunc(by), Z: Math.trunc(bz), vy: Math.trunc(b.vY / 256) },
      player: { X: p.X, vy: Math.round(p.vy * 256), moving: lunge },
    });
    const L = toLaunch(r);
    b.Z = r.launchZ * FX;
    launch(b, L.speed, L.elev, L.heading, L.top, L.side);
    b.landing = r.landing; b.shotType = type; b.weak = r.fallback;
    if (serve) { this.state = "rally"; this.served = true; this.serveLanding = true; }
    b.bounces = 0; this.lastHitter = p.side; this.bounceSide = 0; this.hits++;
    p.swing = 14; p.swingType = button === 2 ? 1 : button === 3 ? 2 : 0; p.cooldown = 24; p.swingReq = null;
    // animation (recorded in PyBoy): forehand 9 when the ball is on the player's right, backhand 10,
    // high balls 11; the serve uses 7
    const rel = (bx - p.X) * d;
    p.swingAnim = serve ? 7 : -bz > 220 ? 11 : rel >= 0 ? 9 : 10;
    b.heading = r.heading;
    // 08:6A1C: the hitter goes to its recovery state (wDF18 = 2), the opponent to receiving (1)
    for (const q of this.players) if (q.cpu) this.cpuEnter(q, q === p ? "recover" : "react");
  }

  // 07:5525: Z flag clear (high ball) when atan2(Z+112, 0.75|Y|) + atan2(-Z, |Y|+1248) < 0
  highBall(bx, by, bz) {
    if (bz + 0x70 >= 0) return false;
    const ay = Math.abs(Math.trunc(by));
    const a1 = atan2Rom(this.rom, Math.trunc(bz) + 0x70, (ay + (ay >> 1)) >> 1);
    const a2 = atan2Rom(this.rom, -Math.trunc(bz), ay + 0x4E0);
    return ((a1 + a2) & 0x8000) !== 0;
  }
  // 08:6E64: wDF50 bit4 = player inside the service line -> the 08:709B type table (types 8/6/7, 5 for low balls)
  volleyZone(p) { return Math.abs(p.Y) < COURT.serviceLine; }

  // a swing request: the button was pressed, the racket meets the ball when it enters the reach box;
  // the frames in between are the charge (wDF4B). Too long without contact -> whiff (APPROX window).
  startSwing(p, button, variant = 0) {
    if (p.swingReq || p.cooldown > 0 || p.swing > 0) return;
    p.swingReq = { button, variant, t: 0 };
  }
  tickSwing(p) {
    const r = p.swingReq;
    if (!r) return;
    if (r.t < 4 && r.button !== 3 && this.input && (this.input.aPressed || this.input.bPressed) && !p.cpu) r.button = 3;
    if (this.canHit(p)) { this.hit(p, r.button, r.variant, Math.min(63, r.t)); return; }
    r.t++;
    const b = this.ball, passed = (b.Y / FX - p.Y) * this.dir(p) > 96 || (b.vY > 0) !== (p.side === 0);
    if (r.t > 8 && passed || r.t > 120) { p.swingReq = null; p.swing = 10; p.cooldown = 20; p.swingAnim = 9; }
  }

  canHit(p) {                 // 08:702A contact box: |dY| < 96, |dX| < 1.5 * SideReach (no height test)
    const b = this.ball, bx = b.X / FX, by = b.Y / FX;
    if (p.cooldown > 0 || this.lastHitter === p.side) return false;
    return Math.abs(bx - p.X) < 1.5 * p.data.sideReach && Math.abs(by - p.Y) < 96;
  }


  // ---- per-frame update -----------------------------------------------------
  update(input) {
    if (this.msgTimer > 0) this.msgTimer--;
    if (this.over) return;
    const [hp, cp] = this.players;
    this.input = input;
    hp.aimX = input.left ? -1 : input.right ? 1 : 0;

    if (this.state === "dead") {
      if (--this.deadT <= 0) { if (this.refault) { this.refault = false; this.resetPointKeepScore(); } else this.resetPoint(); }
      this.movePlayers(input); return;
    }
    if (this.state === "serve") {
      const s = this.players[this.server];
      if (this.serveWait === undefined) this.serveWait = (!this.secondServe && Math.random() * 8 < this.cpu.quick) ? 35 : 50;
      if (s.cpu ? ++this.tossT > this.serveWait : input.aPressed || input.bPressed) {
        this.serveWait = undefined;
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
      if (s.cpu) s.aimDir = this.serveAim !== undefined ? this.serveAim : (this.serveAim = Math.floor(Math.random() * 3) - 1);
      if (want && b.Z < -150 * FX) { this.hit(s, s.cpu ? (Math.random() < 0.5 ? 1 : 2) : (input.bPressed ? 2 : 1)); this.serveAim = undefined; }
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
    }
    if (!hp.cpu && (input.aPressed || input.bPressed)) this.startSwing(hp, input.aPressed && input.bPressed ? 3 : input.bPressed ? 2 : 1);
    for (const p of this.players) if (p.cpu) this.cpuTick(p);
    for (const p of this.players) this.tickSwing(p);
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
      } else if (this.state === "rally" && p.ai.target) {   // 08:7908: d-pad towards the target, 08:78BE arrival within 24
        const dx = p.ai.target[0] - p.X, dy = p.ai.target[1] - p.Y;
        tx = Math.abs(dx) >= 24 ? Math.sign(dx) : 0; ty = Math.abs(dy) >= 24 ? Math.sign(dy) : 0;
      }
      // PlayerMove 08:73CA, per axis in 1/256 px: input on the axis -> v += 4*round(Dash*c/128),
      // clamp |v| <= 2*((Run*c)>>8)+128 (c = 128 straight, 91 diagonal: sine table 00:0B5C);
      // no input (or swinging: DF0F bits 0/1 drop the input) -> v moves to 0 by Stop.
      const D = p.data, c = tx && ty ? 91 : 128;
      if (p.swing > 0) tx = ty = 0;
      const axis = (v, t) => {
        if (t === 0) return Math.abs(v) <= D.brake ? 0 : v - Math.sign(v) * D.brake;
        v += t * 4 * Math.round(D.dash * c / 128) / 256;
        const cap = (2 * ((D.run256 * c) >> 8) + 128) / 256;
        return Math.abs(v) > cap ? t * cap : v;
      };
      p.vx = axis(p.vx, tx); p.vy = axis(p.vy, ty);
      p.X = Math.max(-850, Math.min(850, p.X + p.vx));
      const d = this.dir(p);
      p.Y = d * Math.max(80, Math.min(1700, d * (p.Y + p.vy)));
      if (Math.abs(p.vx) > 0.5) p.facing = Math.sign(p.vx);
      p.anim += Math.hypot(p.vx, p.vy) / 40;
    }
  }
}

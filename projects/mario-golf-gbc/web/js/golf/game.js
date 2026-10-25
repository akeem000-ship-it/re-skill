// A round of golf played natively: GolfRound 10:4451 from its entry to the end of the round, the player's
// buttons from input() each frame. Between the shots the screens and captions are not ported yet; their frames
// are left out (the round's play does not depend on them).
import { Shot, runSync } from "./shot.js";
import * as H from "./hole.js";
import * as R from "./round.js";

// onShot(info) is told each shot's outcome; returns the outcomes and each hole's strokes and putts. A generator:
// each next() runs one frame (shot.js Shot.advance); playRound() below runs it to the end.
export function* playRoundFrames(w, roundId, input, { ev = () => {}, maxHoles = 18, onShot = () => {}, onHoleEnd = () => {} } = {}) {
  const sh = new Shot(w, null, ev, input);
  const result = { shots: [], holes: [] };
  yield* R.golfRoundStart(sh, roundId);
  yield* R.holeStart(sh);
  for (;;) {
    const a = yield* H.addressLoop(sh);                 // the swing, the flight: the outcome (10:4A25)
    yield* H.postShot(sh, a);                    // 10:4A82
    result.shots.push(a);
    onShot({ outcome: a, hole: w.wram[0][0x837] });
    if (!(yield* R.afterShot(sh, a))) { yield* R.nextShot(sh); continue; }
    const w0 = w.wram[0], p = 0x880 + (w0[0x835] ? 0x40 : 0);
    result.holes.push({ hole: w0[0x837], strokes: w0[p + 0x20], putts: w0[p + 0x21] });
    onHoleEnd(result);
    if (result.holes.length >= maxHoles) break;
    if (!R.holeEnd(w)) { R.roundEnd(w); break; }
    yield* R.holeStart(sh);
  }
  return result;
}

export function playRound(...args) { return runSync(playRoundFrames(...args)); }

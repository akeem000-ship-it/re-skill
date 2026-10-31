// The effect layers of the 3D view (each a class with a layer key; scene.js calls its steps: holeBuilt, frame (each game frame),
// update / drawGround / draw / drawOverlay / drawInset / bodies (each drawn frame), drawOther (a screen that is not a hole view),
// holdsScene (keep drawing the hole after the game has left it)).
import { BallFx } from "./ballfx.js";
import { Wear } from "./wear.js";
import { Ambience } from "./ambience.js";
import { Gallery } from "./gallery.js";
import { Moments } from "./moments.js";
import { Replay } from "./replay.js";
import { CloseCall } from "./closecall.js";
import { TitleShow } from "./titleshow.js";
import { Field3D } from "./field3d.js";
import { FieldLife } from "./fieldlife.js";
export const FX = [Wear, BallFx, Ambience, Gallery, Moments, Replay, CloseCall, TitleShow, Field3D, FieldLife];

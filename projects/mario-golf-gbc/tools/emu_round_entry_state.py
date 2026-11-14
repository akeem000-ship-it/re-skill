"""Save the game a few frames before GolfRound's entry (10:4451) of the Stroke practice round (fresh boot, the
button script tools/emu_script.py STROKE_HOLE1, frame 4108; GolfRound is entered at frame 4109) as
states/round_entry.state and its JS-core snapshot out/round_entry_snap.json (tools/emu_dump_snapshot.py). The
native-render test (web/tests/golf_render_vs_core.mjs) runs the emulator core from there as its reference.
usage: emu_round_entry_state.py
"""
import sys, os, subprocess
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools.emu.session import Emu
from tools.emu_script import STROKE_HOLE1, run_script

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    e = Emu(fresh=True)
    run_script(e, 4108, STROKE_HOLE1)
    state = os.path.join(HERE, "states", "round_entry.state")
    e.save(state)
    e.stop()
    subprocess.run([sys.executable, os.path.join(HERE, "tools", "emu_dump_snapshot.py"), state,
                    os.path.join(HERE, "out", "round_entry_snap.json")], check=True)
    print(state, "out/round_entry_snap.json")


if __name__ == "__main__":
    main()

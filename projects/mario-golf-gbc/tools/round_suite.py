"""Record the round test set for web/tests/golf_vs_recordings.mjs: each case is a saved state, a frame count and
the button script a bot played over several holes (made with tools/emu_play_hole.py --plan --holes N: every
swing chosen by the Python engine, A between shots for the messages). Records out/round_<name>.json with
emu_shot_record.py --from-address (every address step is an A event); the JS engine plays it through the hole
ends and the next holes' set-up.
Also out/roundin_r18.json for web/tests/golf_native_round.mjs: the bot plays all 18 holes of the Stroke round
(emu_play_hole.py --plan --holes 18; deterministic) and tools/emu_round_inputs.py records its joypad, address
steps, outcomes and hole ends.
And out/roundin_cpu18.json: the computer golfer plays the 18 holes (player 1's PlayerField $13 = 1, poked at
GolfRound's entry after a fresh boot; A every 20 frames for the captions).
And out/roundin_match18.json: match play (wGameMode $C834 = 2) of the computer as Mario against the computer as Luigi:
at GolfRound's entry player 1 is made a computer golfer and player 2's record ($C8C0-$C8FF) is what the VS menus'
SetupPlayerGolfer 02:4A28 makes for preset golfer 9 (computed by tools/player_record.py from the ROM).
usage: round_suite.py [NAME ...]   (r3, r18, cpu18, match18)
"""
import json
import sys, os, subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# name: (state, frames, presses)
CASES = {
    "r3": ("stroke_hole1", 8300, "180:a 224:a 284:a 344:a 394:a 454:a 514:a 574:a 634:a 694:a 754:a 814:a 874:a 1130:a 1175:a 1235:a 1295:a 1345:a 1405:a 1465:a 1525:a 1585:a 1645:a 1705:a 1765:a 1825:a 1885:a 2246:a 2257:a 2277:a 2427:a 2487:a 2547:a 2947:a 2958:a 2965:a 3271:a 3331:a 3391:a 3451:a 3511:a 3572:a 3617:a 3677:a 3737:a 3787:a 3847:a 3907:a 3967:a 4027:a 4087:a 4147:a 4399:a 4443:a 4503:a 4561:a 4613:a 4673:a 4733:a 4793:a 4853:a 4913:a 5129:a 5179:a 5231:a 5283:a 5349:a 5409:a 5469:a 5529:a 5589:a 5937:a 5948:a 5988:a 6118:a 6178:a 6385:a 6445:a 6505:a 6565:a 6621:a 6668:a 6728:a 6786:a 6838:a 6898:a 6958:a 7018:a 7078:a 7138:a 7198:a 7258:a 7318:a 7378:a 7762:a 7773:a 7799:a 7943:a 8003:a 8238:a"),       # holes 1-3 of the Stroke practice round
}


def r18():
    run = lambda args: subprocess.run([sys.executable] + args, cwd=HERE, capture_output=True, text=True).stdout.strip()
    run(["tools/emu_play_hole.py", "out/round18_bot.json", "80000", "--plan", "--holes", "18"])
    bot = json.load(open(os.path.join(HERE, "out/round18_bot.json")))
    presses = ["%s:%s" % (f, b) for f, b in sorted(bot["presses"].items(), key=lambda x: int(x[0]))]
    print(run(["tools/emu_round_inputs.py", "out/roundin_r18.json", "55800", "--state", "states/stroke_hole1.state",
               "--press"] + presses))


def cpu18():
    print(subprocess.run([sys.executable, "tools/emu_round_inputs.py", "out/roundin_cpu18.json", "80000", "--boot",
                          "--poke", "C893=01", "--every", "20", "--holes", "18"],
                         cwd=HERE, capture_output=True, text=True).stdout.strip())


def match18():
    rec = subprocess.run([sys.executable, "tools/player_record.py", "9", "1"], cwd=HERE, capture_output=True,
                         text=True).stdout.split()
    print(subprocess.run([sys.executable, "tools/emu_round_inputs.py", "out/roundin_match18.json", "90000", "--boot",
                          "--poke", "C893=01", "C834=02"] + rec + ["--every", "20", "--holes", "18"],
                         cwd=HERE, capture_output=True, text=True).stdout.strip())


def main():
    names = [x for x in sys.argv[1:] if not x.startswith("--")] or list(CASES) + ["r18", "cpu18", "match18"]
    for name in names:
        if name in ("r18", "cpu18", "match18"):
            {"r18": r18, "cpu18": cpu18, "match18": match18}[name]()
            continue
        state, frames, presses = CASES[name]
        out = subprocess.run([sys.executable, "tools/emu_shot_record.py", "out/round_%s.json" % name, str(frames),
                              "--state", "states/%s.state" % state, "--from-address", "--press"] + presses.split(),
                             cwd=HERE, capture_output=True, text=True).stdout.strip()
        print(out)


if __name__ == "__main__":
    main()

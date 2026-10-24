"""Record and replay whole holes: each case is a saved state and the button script a bot played (made with
tools/emu_play_hole.py --plan: every swing chosen by the Python engine; the A presses between shots clear the
messages). Records out/hole_<name>.json with emu_shot_record.py and runs tools/hole_run.py: every shot frame by
frame, the state at every address step, and the round and player records at the end must match the game.

usage: hole_suite.py [NAME ...] [--replay-only]
"""
import sys, os, subprocess

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# name: (state, recording mode, frames, presses)
CASES = {
    "hole1": ("stroke_hole1", "--from-address", 3300,
        "180:a 224:a 284:a 344:a 394:a 454:a 514:a 574:a 634:a 694:a 754:a 814:a 874:a 1130:a 1175:a 1235:a 1295:a 1345:a 1405:a 1465:a 1525:a 1585:a 1645:a 1705:a 1765:a 1825:a 1885:a 2246:a 2257:a 2277:a 2427:a 2487:a 2547:a 2947:a 2958:a 2965:a 3271:a"),
    "hole2": ("h2_tee", "--from-address", 4000,
        "180:a 240:a 300:a 360:a 420:a 480:a 540:a 600:a 660:a 720:a 962:a 1007:a 1037:a 1067:a 1177:a 1426:a 1470:a 1530:a 1588:a 1640:a 1700:a 1760:a 1820:a 1880:a 1940:a 2180:a 2225:a 2277:a 2329:a 2395:a 2455:a 2515:a 2770:a 2819:a 2871:a 2923:a 2989:a 3049:a 3109:a 3169:a 3229:a 3464:a 3475:a 3517:a 3645:a 3705:a 3921:a"),
    "hole2_water": ("h2_overwater", "--hole", 3700,
        "265:a 311:a 371:a 431:a 481:a 541:a 601:a 661:a 721:a 781:a 841:a 1075:a 1120:a 1180:a 1242:a 1290:a 1350:a 1410:a 1470:a 1530:a 1590:a 1650:a 1862:a 1907:a 1959:a 2011:a 2077:a 2137:a 2197:a 2257:a 2456:a 2504:a 2556:a 2608:a 2674:a 2734:a 2794:a 2854:a 2914:a 3114:a 3125:a 3163:a 3295:a 3355:a 3590:a"),
    "hole1_ob": ("suite_out_of_bounds", "--hole", 4500,
        "292:a 336:a 396:a 456:a 506:a 566:a 626:a 686:a 746:a 806:a 866:a 926:a 986:a 1243:a 1287:a 1347:a 1407:a 1457:a 1517:a 1577:a 1637:a 1697:a 1757:a 1817:a 1877:a 1937:a 1997:a 2218:a 2229:a 2249:a 2399:a 2459:a 2519:a 2777:a 2788:a 2795:a 3101:a"),
}
EXTRA = {"hole1_ob": "suite_out_of_bounds"}     # a state shot_suite.py makes (poked: sent out of bounds)


def run(args):
    return subprocess.run([sys.executable] + args, cwd=HERE, capture_output=True, text=True).stdout.strip()


def main():
    a = sys.argv[1:]
    names = [x for x in a if not x.startswith("--")] or list(CASES)
    bad = 0
    for name in names:
        state, mode, frames, presses = CASES[name]
        if name in EXTRA and not os.path.exists(os.path.join(HERE, "states/%s.state" % state)):
            run(["tools/shot_suite.py", "out_of_bounds"])
        rec = "out/hole_%s.json" % name
        if "--replay-only" not in a or not os.path.exists(os.path.join(HERE, rec)):
            run(["tools/emu_shot_record.py", rec, str(frames), "--state", "states/%s.state" % state, mode, "--press"]
                + presses.split())
        out = run(["tools/hole_run.py", rec])
        ok = "hole done" in out and "records ($C800-$C8FF) at the end: match" in out
        bad += not ok
        summary = [l for l in out.splitlines() if l.startswith(("shot", "hole done"))]
        print("%-12s %s  %s" % (name, "ok  " if ok else "FAIL", " / ".join(summary) if ok else out.replace("\n", " / ")))
    print("%d of %d holes ok" % (len(names) - bad, len(names)))


if __name__ == "__main__":
    main()

"""Rebuild every derived file from rom/mario_golf.gbc (all gitignored).

  docs/text_dump.txt        dump_text.py
  gfx/map_XX.png            render_map.py all
  gfx/lz_BB_AAAA.png        extract_tiles.py on the banks with LZ entries
  gfx/raw_03_50f0.png       the font
  gfx/hole_XX.png           render_hole.py: the 90 course holes ($0A-$63) and their terrain maps
usage: gen_all.py
"""
import os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
LZ_BANKS = ["28", "29", "2a", "2b", "2c", "2d", "2e", "2f", "40", "4b", "4c", "4d", "4e", "58", "72", "73", "74"]


def run(args, out=None):
    cmd = [sys.executable, os.path.join(HERE, args[0])] + args[1:]
    if out:
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w") as f:
            subprocess.run(cmd, check=True, stdout=f)
    else:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    print(" ".join(args))


def main():
    run(["dump_text.py"], os.path.join(ROOT, "docs", "text_dump.txt"))
    run(["render_map.py", "all"])
    run(["extract_tiles.py"] + LZ_BANKS)
    run(["extract_tiles.py", "--raw", "03:50f0", "102"])
    for h in range(0x0A, 0x64):
        run(["render_hole.py", "%02x" % h, "--terrain"])


if __name__ == "__main__":
    main()

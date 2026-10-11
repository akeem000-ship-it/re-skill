"""Regenerate every derived asset from rom/mario_tennis.gbc (nothing derived is committed).

usage: python3 tools/gen_all.py
"""
import os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STEPS = [
    ["tools/render_screen.py", "--tiles", "01:607c@9000", "--map", "01:6903", "--signed", "-o", "gfx/screen_dmg_only.png"],
    ["tools/extract_tiles.py"],
    ["tools/render_map.py", "all"],
    ["tools/dump_text.py", "--out", "docs/text_dump.txt"],
    ["tools/render_sprites.py", "all", "--frames", "145"],
]
os.makedirs(os.path.join(ROOT, "gfx"), exist_ok=True)
for s in STEPS:
    print("$ python3", " ".join(s))
    subprocess.run([sys.executable, "-I"] + [os.path.join(ROOT, s[0])] + s[1:], cwd=ROOT, check=True)

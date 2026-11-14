"""Check a built APK of the golf app: its assets/web/ must be web/ (less web/tests and what is gitignored there, such
as web/gen) byte for byte, and no ROM (no .gbc / .gb file, nothing the size of the ROM) may be inside.

usage: python3 tools/check_apk.py [out/MarioGolfGBC-native-debug.apk]
"""
import os
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
apk = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "out", "MarioGolfGBC-native-debug.apk")
web = os.path.join(HERE, "web")
ignored = set(subprocess.run(["git", "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "web"],
                             cwd=HERE, capture_output=True, text=True).stdout.split())
want = {}
for root, dirs, files in os.walk(web):
    rel = os.path.relpath(root, web)
    if rel == "tests" or rel.startswith("tests" + os.sep):
        continue
    for f in files:
        p = os.path.join(root, f)
        r = os.path.relpath(p, HERE).replace(os.sep, "/")
        if any(r == i.rstrip("/") or r.startswith(i if i.endswith("/") else i + "/") for i in ignored):
            continue
        want["assets/web/" + os.path.relpath(p, web).replace(os.sep, "/")] = p
ok = True
with zipfile.ZipFile(apk) as z:
    names = set(z.namelist())
    got = {n for n in names if n.startswith("assets/web/")}
    for n, p in sorted(want.items()):
        if n not in names:
            print("missing in the APK:", n); ok = False; continue
        if z.read(n) != open(p, "rb").read():
            print("differs:", n); ok = False
    for n in sorted(got - set(want)):
        print("extra in the APK:", n); ok = False
    roms = [i.filename for i in z.infolist() if i.filename.lower().endswith((".gbc", ".gb")) or i.file_size == 2 * 1024 * 1024]
    if roms:
        print("a ROM inside:", roms); ok = False
    print(f"{apk}: {len(want)} web files checked, {len(names)} entries in all; {'OK' if ok else 'FAILED'}")
sys.exit(0 if ok else 1)

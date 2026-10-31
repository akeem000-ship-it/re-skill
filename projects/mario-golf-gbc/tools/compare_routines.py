"""Compare two routines instruction by instruction, with ROM addresses in the switchable bank ($4000-$7FFF) masked:
shows whether a routine is a copy of another at a shifted address (e.g. bank 07's menu engine and bank 09's).
usage: compare_routines.py BB:AAAA BB:AAAA NBYTES   (prints the differing lines, then "same" or the count)
"""
import sys, os, re, subprocess
HERE = os.path.dirname(os.path.abspath(__file__))


def norm(spec, n):
    b, a = spec.split(":")
    out = subprocess.run([sys.executable, os.path.join(HERE, "disasm.py"), b, a, str(n)], capture_output=True,
                         text=True).stdout.splitlines()
    rows = []
    for line in out:
        m = re.match(r"^[0-9a-f]{2}:[0-9a-f]{4}\s+(?:[0-9a-f]{2} ?)+\s+(.*)$", line)
        if not m:
            continue
        ins = m.group(1).split(";")[0].strip()
        ins = re.sub(r"\$([4-7][0-9a-f]{3})\b", "$XXXX", ins)
        rows.append(ins)
    return rows


def main():
    a, b, n = sys.argv[1], sys.argv[2], int(sys.argv[3], 0)
    ra, rb = norm(a, n), norm(b, n)
    diff = 0
    for k, (x, y) in enumerate(zip(ra, rb)):
        if x != y:
            diff += 1
            print("%3d  %-30s %s" % (k, x, y))
    print("same" if not diff and len(ra) == len(rb) else "%d differ (%d / %d instructions)" % (diff, len(ra), len(rb)))


if __name__ == "__main__":
    main()

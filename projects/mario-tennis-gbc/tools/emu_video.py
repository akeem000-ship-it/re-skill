"""Record the original game in PyBoy to PNG frames + a WAV soundtrack (mux with ffmpeg).

usage: emu_video.py OUTDIR FRAMES [--state S | --fresh] [--keys F:button[:hold],...] [--every N]
Frames go to OUTDIR/fNNNNNN.png (every N-th frame, default 1), audio to OUTDIR/audio.wav
(all frames, PyBoy's APU output) and OUTDIR/frames.ffconcat, which gives every image its real
duration (audio samples / rate — frames with the LCD off are shorter). Mux:
  ffmpeg -f concat -i OUTDIR/frames.ffconcat -i OUTDIR/audio.wav -c:v libx264 -pix_fmt yuv420p -c:a aac out.mp4 Example (power-on → exhibition match):
  emu_video.py out 5200 --fresh --keys 1000:start,1400:start,1700:a,...
"""
import sys, os, wave
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import numpy as np
from tools.emu.session import Emu

a = sys.argv[1:]
def opt(n, d): return a[a.index(n) + 1] if n in a else d
out, N = a[0], int(a[1]); every = int(opt("--every", "1"))
os.makedirs(out, exist_ok=True)
press, release = {}, {}
for k in [k for k in opt("--keys", "").split(",") if k]:
    p = k.split(":"); f = int(p[0]); hold = int(p[2]) if len(p) > 2 else 6
    press.setdefault(f, []).append(p[1]); release.setdefault(f + hold, []).append(p[1])
e = Emu(fresh="--fresh" in a, sound=True)
if "--state" in a: e.load(opt("--state", ""))
rate = e.pb.sound.sample_rate; chunks = []; n = 0; durs = []; acc = 0
for f in range(N):
    for b in press.get(f, []): e.pb.button_press(b)
    for b in release.get(f, []): e.pb.button_release(b)
    e.run(1)
    snd = np.array(e.pb.sound.ndarray, dtype=np.int8).copy(); chunks.append(snd)
    if f % every == 0:
        if n: durs.append(acc)
        acc = 0
        e.pb.screen.image.convert("RGB").save(os.path.join(out, "f%06d.png" % n)); n += 1
    acc += len(snd)
e.stop()
pcm = (np.concatenate(chunks).astype(np.int16) * 256)
with wave.open(os.path.join(out, "audio.wav"), "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm.tobytes())
durs.append(acc)
with open(os.path.join(out, "frames.ffconcat"), "w") as fc:
    fc.write("ffconcat version 1.0\n")
    for i, d in enumerate(durs):
        fc.write("file f%06d.png\nduration %.6f\n" % (i, max(d, 1) / rate))
    fc.write("file f%06d.png\n" % (len(durs) - 1))
print(n, "frames,", len(pcm) / rate, "s audio at", rate, "Hz ->", out)
